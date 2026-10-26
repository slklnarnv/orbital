#!/usr/bin/env node
// `npm run bench` — the measured performance harness (roadmap A.2).
//
// Builds the app in bench mode (production React and minification, plus the
// window.__orbital* hooks; see src/utils/debugHooks.ts), serves it with
// `vite preview` (production headers, CSP included) and drives installed
// Microsoft Edge headless on the machine's real GPU (ANGLE / D3D11) through
// these scenarios, each with Bloom on and off:
//
//   overview       the boot view of the whole Earth
//   follow         after Locate, at the Follow framing (Locate LOD)
//   follow-scrub   dragging the orbit tape back and forth in Follow
//   inspect        dollied into Inspect once the full model has settled
//   inspect-scrub  the same tape scrub in Inspect
//
// Per scenario: fps, p50/p90/p99 frame time, frames over 20 ms, GPU ms per
// frame and per pass (EXT_disjoint_timer_query_webgl2; scripts/bench/
// page-probe.js), and tracked GPU memory. Results go to a JSON file.
//
// Contention: before launching, and continuously while measuring, the
// Windows GPU engine counters and per-process CPU are sampled. Another
// process using the GPU's 3D/compute engines (a game), or other processes
// together using 15% of all cores (other agents' SwiftShader browsers),
// refuses the run, or with --allow-busy-gpu marks every affected scenario as
// contended. See contention.mjs.
//
// Usage: npm run bench -- [--scenarios overview,follow] [--duration 8]
//        [--settle 3] [--width 1280 --height 720 --dpr 1.5] [--at <ISO|ms>]
//        [--live] [--no-build] [--headed] [--label text] [--out file.json]
//        [--allow-busy-gpu] [--port 4180]
// page.evaluate / waitForFunction callbacks run in the page:
/* global window */
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { describeContention, sampleContention, startContentionMonitor } from './contention.mjs'
import { mib, summariseFrames, summariseGpu } from './stats.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const { chromium } = require('@playwright/test')

const ALL_SCENARIOS = ['overview', 'follow', 'follow-scrub', 'inspect', 'inspect-scrub']
/** Inspect framing: wheel-zoom until inside this distance (the band is 70–200 km). */
const INSPECT_DISTANCE_KM = 130

const { values: args } = parseArgs({
  options: {
    scenarios: { type: 'string', default: ALL_SCENARIOS.join(',') },
    bloom: { type: 'string', default: 'on,off' },
    duration: { type: 'string', default: '8' },
    settle: { type: 'string', default: '3' },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '720' },
    dpr: { type: 'string', default: '1.5' },
    at: { type: 'string' },
    live: { type: 'boolean', default: false },
    'no-build': { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
    label: { type: 'string', default: '' },
    out: { type: 'string' },
    'allow-busy-gpu': { type: 'boolean', default: false },
    port: { type: 'string', default: '4180' },
  },
})

const scenarios = args.scenarios.split(',').map((s) => s.trim()).filter(Boolean)
for (const s of scenarios) {
  if (!ALL_SCENARIOS.includes(s)) throw new Error(`unknown scenario "${s}" (known: ${ALL_SCENARIOS.join(', ')})`)
}
const bloomModes = args.bloom.split(',').map((s) => s.trim() === 'on')
const durationMs = Number(args.duration) * 1000
const settleMs = Number(args.settle) * 1000
const port = Number(args.port)
const baseUrl = `http://localhost:${port}`
const outDir = path.join(root, '.bench')
const distDir = path.join(outDir, 'dist')

const log = (...parts) => console.log('[bench]', ...parts)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function loud(lines) {
  const bar = '!'.repeat(78)
  console.error(`\n${bar}\n${lines.map((l) => `!! ${l}`).join('\n')}\n${bar}\n`)
}


function vite(viteArgs, opts = {}) {
  return spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), ...viteArgs], {
    cwd: root,
    stdio: opts.stdio ?? 'inherit',
    windowsHide: true,
  })
}

async function build() {
  log('building (vite build --mode bench) …')
  const child = vite(['build', '--mode', 'bench', '--outDir', distDir, '--emptyOutDir', '--logLevel', 'warn'])
  const code = await new Promise((resolve) => child.on('exit', resolve))
  if (code !== 0) throw new Error(`bench build failed (exit ${code})`)
}

async function startPreview() {
  const child = vite(['preview', '--mode', 'bench', '--outDir', distDir, '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return child
    } catch {
      // not up yet
    }
    await sleep(250)
  }
  child.kill()
  throw new Error(`vite preview did not answer on ${baseUrl}`)
}

async function stubNetwork(page) {
  const fallback = JSON.parse(await readFile(path.join(root, 'src/data/fallback-tle.json'), 'utf8'))
  await page.route('**/api/tle', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ line1: fallback.line1, line2: fallback.line2, fetchedAt: Date.now(), source: 'celestrak' }),
  }))
  await page.route('https://api.wheretheiss.at/**', (route) => route.fulfill({ status: 503, body: 'unavailable' }))
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ timezone: 'UTC', timezone_abbreviation: 'UTC', utc_offset_seconds: 0, current: { temperature_2m: 20, weather_code: 1 } }),
  }))
}

function gitDescribe() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== ''
    return dirty ? `${sha}+dirty` : sha
  } catch {
    return 'unknown'
  }
}

// ─── Page helpers ─────────────────────────────────────────────────────────────

async function clickCentre(page, selector) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} has no bounding box`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

async function waitFor(page, fn, arg, timeout = 60_000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 250 })
  } catch (error) {
    // Say where the app was stuck, not just that it timed out.
    const state = await pageState(page).catch(() => null)
    throw new Error(`${error instanceof Error ? error.message : error}
app state: ${JSON.stringify(state)}`, { cause: error })
  }
}

async function pageState(page) {
  return page.evaluate(() => {
    const stores = window.__orbitalStores
    const camera = stores.camera.getState()
    const detail = stores.loading.getState().issDetail
    const telemetry = stores.telemetry.getState()
    const renderer = window.__orbitalRenderer
    const controls = window.__orbitalControls
    const canvas = renderer.domElement
    return {
      mode: camera.mode,
      transitioning: camera.isTransitioning,
      detail: { status: detail.status, active: detail.activeQuality },
      bloom: stores.settings.getState().postprocessing,
      sunlit: telemetry.sunlit,
      altitudeKm: Math.round(telemetry.altitude),
      simEpoch: new Date(window.__orbitalClock.now().epochMs).toISOString(),
      clockMode: window.__orbitalSimulation.getState().mode,
      cameraDistanceKm: controls ? Math.round(controls.distance) : null,
      pixelRatio: renderer.getPixelRatio(),
      drawingBuffer: `${canvas.width}x${canvas.height}`,
      rendererInfo: {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? null,
      },
    }
  })
}

/** Seek so the station stays sunlit (≥ 25 min of daylight left) for the run. */
async function seekToDaylight(page) {
  for (let i = 0; i < 4; i++) {
    await waitFor(page, () => window.__orbitalStores?.telemetry.getState().sunlit !== null, undefined, 30_000)
    const { sunlit, flipIn, epochMs } = await page.evaluate(() => {
      const t = window.__orbitalStores.telemetry.getState()
      return { sunlit: t.sunlit, flipIn: t.shadowTransitionInMs, epochMs: window.__orbitalClock.now().epochMs }
    })
    if (sunlit && (flipIn === null || flipIn > 25 * 60_000)) return epochMs
    const target = epochMs + (flipIn ?? 30 * 60_000) + 90_000
    await page.evaluate((t) => {
      const sim = window.__orbitalSimulation.getState()
      sim.seek(t)
      sim.setRate(1)
    }, target)
    await sleep(2500)
  }
  return page.evaluate(() => window.__orbitalClock.now().epochMs)
}

async function setBloom(page, on) {
  const changed = await page.evaluate((value) => {
    const settings = window.__orbitalStores.settings.getState()
    if (settings.postprocessing === value) return false
    settings.setPostprocessing(value)
    return true
  }, on)
  if (changed) await sleep(2500) // composer (re)build + shader compile
}

async function ensureFollow(page) {
  const state = await pageState(page)
  if (state.mode === 'FOLLOW' && !state.transitioning) return
  await clickCentre(page, '#btn-locate-iss')
  await waitFor(page, () => {
    const s = window.__orbitalStores
    const camera = s.camera.getState()
    return camera.mode === 'FOLLOW' && !camera.isTransitioning && s.loading.getState().issDetail.activeQuality !== null
  }, undefined, 120_000)
  await sleep(1500)
}

async function ensureInspect(page) {
  await ensureFollow(page)
  const state = await pageState(page)
  if (state.mode !== 'INSPECT') {
    // Wheel-zoom on the canvas, as a user does (the tracking controller owns
    // the camera, so a programmatic dolly is undone the next frame). The clock
    // is paused while zooming: with it running, the station-frame carry's
    // per-frame setLookAt cancels each smoothed wheel dolly after one frame
    // (~1% per tick; a known bug, see docs/NEXT_STEPS.md).
    const viewport = page.viewportSize()
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await page.evaluate(() => window.__orbitalSimulation.getState().togglePause())
    for (let i = 0; i < 40; i++) {
      const { mode, cameraDistanceKm } = await pageState(page)
      if (mode === 'INSPECT' && cameraDistanceKm <= INSPECT_DISTANCE_KM) break
      await page.mouse.wheel(0, -200)
      await sleep(300)
    }
    await page.evaluate(() => window.__orbitalSimulation.getState().togglePause())
  }
  await waitFor(page, () => {
    const s = window.__orbitalStores
    const detail = s.loading.getState().issDetail
    return s.camera.getState().mode === 'INSPECT' && detail.activeQuality === 'high' && detail.status === 'ready'
  }, undefined, 180_000)
  // "After the full model settles": texture batches, shader warm-up, first shadow.
  await sleep(5000)
}

/** Drag the orbit tape between 25% and 75% (a triangle wave, 4 s period). */
async function scrubTape(page, ms) {
  const box = await page.locator('.hud-tape').boundingBox()
  if (!box) throw new Error('orbit tape not found')
  const y = box.y + box.height / 2
  const xAt = (f) => box.x + box.width * f
  await page.mouse.move(xAt(0.25), y)
  await page.mouse.down()
  const start = Date.now()
  while (Date.now() - start < ms) {
    const phase = ((Date.now() - start) / 4000) % 1
    const f = 0.25 + 0.5 * (phase < 0.5 ? phase * 2 : 2 - phase * 2)
    await page.mouse.move(xAt(f), y)
    await sleep(16)
  }
  await page.mouse.move(xAt(0.25), y)
  await page.mouse.up()
  // Back where the drag started; resume the 1× run.
  await page.evaluate(() => {
    const sim = window.__orbitalSimulation.getState()
    if (sim.mode === 'PAUSED') sim.togglePause()
  })
}

async function measure(page, drive) {
  await page.evaluate(() => window.__bench.start())
  const from = Date.now()
  if (drive) await drive(durationMs)
  else await sleep(durationMs)
  const to = Date.now()
  await page.evaluate(() => window.__bench.stop())
  await sleep(500) // let the last timer queries resolve
  const raw = await page.evaluate(() => window.__bench.collect())
  const memory = await page.evaluate(() => window.__bench.memory())
  return { from, to, raw, memory }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const preflight = await sampleContention({ pids: [process.pid] })
  if (preflight.supported) {
    if (preflight.contended) {
      const lines = [
        `The machine is busy: ${describeContention(preflight)}.`,
        'Frame times measured now are not this app\'s. Close it and re-run.',
      ]
      if (!args['allow-busy-gpu']) {
        loud([...lines, 'Refusing to run (pass --allow-busy-gpu to measure anyway, marked contended).'])
        process.exitCode = 2
        return
      }
      loud([...lines, '--allow-busy-gpu: running anyway; results are marked contended.'])
    } else {
      log(`GPU and CPU idle before launch (other CPU use ${preflight.cpu.foreignPct}%, busiest GPU user: ${preflight.gpuAll[0]?.name ?? 'none'})`)
    }
  } else {
    loud(['The contention check is Windows-only; nothing was checked on this platform.'])
  }

  if (!args['no-build']) await build()
  const preview = await startPreview()
  const monitor = startContentionMonitor()
  const viewport = { width: Number(args.width), height: Number(args.height) }
  // A fresh profile per run; its path marks this run's Edge processes so the
  // contention check can tell them from every other Edge on the machine.
  const profileDir = path.join(outDir, `profile-${process.pid}-${Date.now()}`)
  const own = { pids: [process.pid, preview.pid], marker: profileDir }

  const results = []
  let anyContended = false
  let context = null
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'msedge',
      headless: !args.headed,
      args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
      viewport,
      deviceScaleFactor: Number(args.dpr),
    })
    const page = context.pages()[0] ?? await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.addInitScript({ path: path.join(root, 'scripts/bench/page-probe.js') })
    await stubNetwork(page)
    await page.goto(baseUrl)
    await waitFor(page, () => !!window.__orbitalStores && !!window.__orbitalRenderer && !!window.__bench, undefined, 60_000)
    await page.getByText(/^Loading \d+%$/).waitFor({ state: 'detached', timeout: 120_000 })

    const gpu = await page.evaluate(() => {
      const gl = window.__orbitalRenderer.getContext()
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        timerQueries: window.__bench.timerSupported,
      }
    })
    log(`GPU: ${gpu.renderer}; timer queries ${gpu.timerQueries ? 'on' : 'UNAVAILABLE (no per-pass GPU ms)'}`)

    let epochMs
    if (args.at) {
      epochMs = /^\d+$/.test(args.at) ? Number(args.at) : Date.parse(args.at)
      await page.evaluate((t) => { const sim = window.__orbitalSimulation.getState(); sim.seek(t); sim.setRate(1) }, epochMs)
    } else if (!args.live) {
      epochMs = await seekToDaylight(page)
    }
    if (epochMs !== undefined) log(`simulation time ${new Date(epochMs).toISOString()} (re-run with --at ${epochMs})`)
    await sleep(settleMs)

    for (const scenario of scenarios) {
      for (const bloom of bloomModes) {
        if (scenario === 'follow' || scenario === 'follow-scrub') await ensureFollow(page)
        if (scenario === 'inspect' || scenario === 'inspect-scrub') await ensureInspect(page)
        await setBloom(page, bloom)
        await sleep(settleMs)
        const drive = scenario.endsWith('-scrub') ? (ms) => scrubTape(page, ms) : null
        const { from, to, raw, memory } = await measure(page, drive)
        const state = await pageState(page)
        const contention = await monitor.window(from, to, own)
        const frames = summariseFrames(raw.frameStamps)
        const gpuSummary = summariseGpu(raw.gpuFrames)
        const contended = contention.contended
        anyContended ||= contended
        const result = {
          id: `${scenario}/${bloom ? 'bloom' : 'no-bloom'}`,
          scenario,
          bloom,
          frames,
          gpu: gpuSummary,
          gpuDisjointFrames: raw.disjointFrames,
          memory: {
            trackedMiB: mib(memory.textureBytes + memory.renderbufferBytes + memory.bufferBytes + memory.drawingBufferBytes),
            texturesMiB: mib(memory.textureBytes),
            textureCount: memory.textureCount,
            renderbuffersMiB: mib(memory.renderbufferBytes),
            buffersMiB: mib(memory.bufferBytes),
            drawingBufferMiB: mib(memory.drawingBufferBytes),
            largestTextures: memory.largestTextures.map((t) => ({ size: `${t.w}x${t.h}`, format: `0x${t.format.toString(16)}`, MiB: mib(t.bytes) })),
          },
          state,
          contention,
        }
        results.push(result)
        const gpuText = gpuSummary ? `gpu ${gpuSummary.meanMs} ms` : 'gpu —'
        log(`${result.id.padEnd(26)} ${String(frames.fps).padStart(5)} fps  p50 ${frames.p50}  p99 ${frames.p99}  >20ms ${frames.over20ms}  ${gpuText}  dpr ${state.pixelRatio}`)
        if (contended) loud([`${result.id}: contended during measurement: ${describeContention(contention)}.`])
      }
    }
    if (errors.length > 0) log(`page errors: ${errors.slice(0, 5).join(' | ')}`)

    const report = {
      schema: 1,
      label: args.label,
      startedAt: new Date().toISOString(),
      commit: gitDescribe(),
      contended: anyContended,
      machine: {
        os: `${os.type()} ${os.release()}`,
        cpu: os.cpus()[0]?.model?.trim() ?? 'unknown',
        ramGiB: Math.round(os.totalmem() / 2 ** 30),
        gpu,
        browser: `msedge ${context.browser()?.version() ?? await page.evaluate(() => navigator.userAgent)}`,
      },
      config: {
        viewport,
        deviceScaleFactor: Number(args.dpr),
        durationS: durationMs / 1000,
        settleS: settleMs / 1000,
        simulationEpochMs: epochMs ?? null,
        inspectDistanceKm: INSPECT_DISTANCE_KM,
      },
      preflight,
      pageErrors: errors,
      scenarios: results,
    }
    const outFile = args.out
      ? path.resolve(args.out)
      : path.join(outDir, 'results', `bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    await mkdir(path.dirname(outFile), { recursive: true })
    await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`)
    log(`wrote ${path.relative(root, outFile)}`)
    if (anyContended) {
      loud(['Some scenarios ran on a contended machine (see "contention" in the JSON). Do not trust their fps.'])
      process.exitCode = 3
    }
  } finally {
    await context?.close()
    await monitor.stop()
    preview.kill()
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
