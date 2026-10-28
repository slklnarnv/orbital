/* global window, Image, OffscreenCanvas -- used inside page.evaluate callbacks, which run in the browser */
// check-visual.mjs — `npm run check:visual`: does the built app actually draw?
//
// Unit tests and the Playwright suites check the DOM, never pixels, and on
// 2026-10-28 a dependency upgrade shipped a black Earth (R3F 9 copied the
// `uniforms` prop, so the textures never reached the material) with every
// check green. This builds the production bundle in bench mode (production
// code plus the window.__orbital* hooks), serves it with `vite preview`,
// renders it in installed Edge on the real GPU at three fixed times and
// fails if the Earth's disc renders dark or the page logs an error.
//
// Windows + installed Edge (as `npm run bench`). Screenshots land in
// .visual-check/ for a human look. Exit code 1 on failure.

import { execSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const ROOT = process.cwd()
const OUT = path.join(ROOT, '.visual-check')
const DIST = '.visual-check/dist'
const PORT = Number(process.env.VISUAL_PORT) || 4195
// Mean luminance (0-255) of the central disc region in the Earth overview.
// A working build measures 40-66 at these times; the black Earth measured 0.
const MIN_DISC_BRIGHTNESS = 20
const TIMES = [
  ['overview-1205Z', '2026-10-28T12:05:13Z'],
  ['overview-0600Z', '2026-10-28T06:00:00Z'],
  ['overview-1800Z', '2026-10-28T18:00:00Z'],
]

mkdirSync(OUT, { recursive: true })
console.log('[visual] building (vite build --mode bench) …')
execSync(`npx vite build --mode bench --outDir ${DIST} --emptyOutDir`, { cwd: ROOT, stdio: 'ignore' })
const server = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true })
const url = `http://localhost:${PORT}/`

let failed = false
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) break } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  // vite preview has no /api/tle; the app falls back to the packaged set.
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()) })
  await page.addInitScript(() => { try { localStorage.setItem('orbital-tour-seen', '1') } catch { /* no storage */ } })
  await page.goto(url)
  await page.getByText(/^Loading \d+%$/).waitFor({ state: 'detached', timeout: 120_000 })
  await page.waitForTimeout(4000)

  const results = {}
  for (const [name, iso] of TIMES) {
    await page.evaluate((t) => window.__orbitalSimulation.getState().seek(Date.parse(t)), iso)
    await page.waitForTimeout(3000)
    const png = await page.screenshot({ path: path.join(OUT, `${name}.png`) })
    results[name] = await page.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = new OffscreenCanvas(img.width, img.height)
      const g = canvas.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(Math.round(img.width * 0.35), Math.round(img.height * 0.3),
        Math.round(img.width * 0.3), Math.round(img.height * 0.4)).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      return Math.round((sum / (d.length / 4)) * 10) / 10
    }, png.toString('base64'))
  }
  await browser.close()

  for (const [name, value] of Object.entries(results)) {
    const ok = value >= MIN_DISC_BRIGHTNESS
    if (!ok) failed = true
    console.log(`[visual] ${name.padEnd(16)} disc brightness ${String(value).padStart(5)} ${ok ? 'ok' : 'FAIL (Earth not drawing?)'}`)
  }
  if (errors.length) {
    failed = true
    for (const e of errors) console.log(`[visual] page error: ${e}`)
  }
  writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ results, errors }, null, 2))
  console.log(failed ? '[visual] FAILED — look at .visual-check/*.png' : '[visual] passed — screenshots in .visual-check/')
} finally {
  server.kill()
}
process.exit(failed ? 1 : 0)
