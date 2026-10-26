import { expect, test, type Page } from '@playwright/test'
import { stubNetwork } from './fixtures'

// Viewport audit (plan 017 R7): the HUD layout across phones, tablets and
// large screens, so a CSS change cannot break one of them silently. DOM
// boxes only, so it runs against the production preview; the station-framing
// check needs the DEV scene hooks and runs only under E2E_DEV=1 (see
// playwright.config.ts).

type Size = readonly [width: number, height: number]

const TOUCH_SIZES: readonly Size[] = [[360, 640], [390, 844], [844, 390], [768, 1024], [1024, 768]]
const DESKTOP_SIZES: readonly Size[] = [[1366, 768], [1920, 1080], [2560, 1440], [3440, 1440]]

interface Audit {
  coarse: boolean
  hscroll: boolean
  hudZoom: string
  overlaps: string[]
  offscreen: string[]
  smallText: string[]
  smallTargets: string[]
  hudFraction: number
}

/**
 * Runs in the page. Clusters are the frame's anchored groups; the tape is
 * judged by its visible line, because its hit area deliberately runs under
 * the instrument row on short screens (pointer-events pass through there).
 */
function auditHud(): Audit {
  const width = window.innerWidth
  const height = window.innerHeight
  const visible = (el: Element): boolean => {
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }
  const clusterSelectors = [
    '.hud-corner--tl', '.hud-corner--tr', '.hud-camera',
    '.hud-bottom-left', '.hud-bottom-center', '.hud-bottom-right', '.hud-tape__line',
  ]
  const boxes: Array<{ name: string; rect: DOMRect }> = []
  for (const selector of clusterSelectors) {
    const el = document.querySelector(selector)
    if (el && visible(el)) boxes.push({ name: selector, rect: el.getBoundingClientRect() })
  }

  const overlaps: string[] = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].rect
      const b = boxes[j].rect
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        overlaps.push(`${boxes[i].name} × ${boxes[j].name}`)
      }
    }
  }

  const targets = [...document.querySelectorAll('.hud-frame button, .hud-corner button, .hud-camera button, .hud-tape')]
    .filter(visible)
  const offscreen = [...boxes.map(({ name, rect }) => ({ name, rect })),
    ...targets.map((el) => ({ name: el.getAttribute('aria-label') ?? el.className, rect: el.getBoundingClientRect() }))]
    .filter(({ rect }) => rect.left < -0.5 || rect.top < -0.5 || rect.right > width + 0.5 || rect.bottom > height + 0.5)
    .map(({ name }) => name)

  const smallText: string[] = []
  for (const el of document.querySelectorAll('.hud-frame *, .hud-corner *, .hud-camera *')) {
    if (![...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) continue
    if (!visible(el)) continue
    const size = parseFloat(getComputedStyle(el).fontSize)
    if (size < 9) smallText.push(`${size}px "${el.textContent?.trim().slice(0, 24)}"`)
  }

  const coarse = window.matchMedia('(pointer: coarse)').matches
  const smallTargets = coarse
    ? targets
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width < 44 || rect.height < 44)
      .map(({ el, rect }) => `${Math.round(rect.width)}×${Math.round(rect.height)} ${el.getAttribute('aria-label') ?? ''}`)
    : []

  // Share of the height the HUD bands take: top clusters down to their
  // lowest edge, bottom clusters up to their highest.
  let top = 0
  let bottom = height
  for (const { rect } of boxes) {
    if ((rect.top + rect.bottom) / 2 < height / 2) top = Math.max(top, rect.bottom)
    else bottom = Math.min(bottom, rect.top)
  }

  return {
    coarse,
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    hudZoom: getComputedStyle(document.documentElement).getPropertyValue('--hud-zoom').trim(),
    overlaps,
    offscreen,
    smallText,
    smallTargets,
    hudFraction: (top + height - bottom) / height,
  }
}

async function boot(page: Page): Promise<void> {
  await stubNetwork(page)
  await page.goto('/')
  await expect(page.locator('.hud-label').filter({ hasText: /^Live$/ }).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/^Loading \d+%$/)).toHaveCount(0, { timeout: 90_000 })
}

async function auditAt(page: Page, [width, height]: Size): Promise<Audit> {
  await page.setViewportSize({ width, height })
  // Layout settles on the next frames; the ground lines refresh at 1 Hz.
  await page.waitForTimeout(1_500)
  return page.evaluate(auditHud)
}

function expectClean(audit: Audit, label: string): void {
  expect.soft(audit.hscroll, `${label}: horizontal scroll`).toBe(false)
  expect.soft(audit.overlaps, `${label}: overlapping HUD clusters`).toEqual([])
  expect.soft(audit.offscreen, `${label}: off-screen HUD`).toEqual([])
  expect.soft(audit.smallText, `${label}: text below 9 px`).toEqual([])
  expect.soft(audit.smallTargets, `${label}: touch targets below 44 px`).toEqual([])
}

test.describe('touch viewports', () => {
  test.use({ hasTouch: true, isMobile: true })

  test('HUD fits phones and tablets, portrait and landscape', async ({ page }) => {
    await boot(page)
    for (const size of TOUCH_SIZES) {
      const label = `${size[0]}×${size[1]}`
      const audit = await auditAt(page, size)
      expect(audit.coarse, `${label}: coarse pointer emulated`).toBe(true)
      expectClean(audit, label)
      // R1: landscape phones keep the HUD to under a third of the height.
      if (size[1] <= 500) expect.soft(audit.hudFraction, `${label}: HUD height share`).toBeLessThanOrEqual(0.3)
    }
    // Orientation change back to portrait restores the stacked layout.
    expectClean(await auditAt(page, [390, 844]), '390×844 after rotation')
  })
})

test.describe('desktop viewports', () => {
  test('HUD fits laptop, 1080p, QHD and ultrawide', async ({ page }) => {
    await boot(page)
    for (const size of DESKTOP_SIZES) {
      const label = `${size[0]}×${size[1]}`
      const audit = await auditAt(page, size)
      expectClean(audit, label)
      // R5: the HUD scales up from QHD.
      const zoom = Number(audit.hudZoom)
      if (size[1] >= 1404) expect.soft(zoom, `${label}: HUD zoom`).toBeGreaterThan(1)
      else expect.soft(zoom, `${label}: HUD zoom`).toBe(1)
    }
  })
})

/** Runs in the page (dev only): the tracked station's projected box. */
function stationBox(): { left: number; top: number; right: number; bottom: number } | null {
  const w = window as unknown as Record<string, unknown>
  // Minimal structural types for the DEV hooks; three is not on window.
  type V3 = { x: number; y: number; z: number; clone(): V3; applyMatrix4(m: unknown): V3; project(c: unknown): V3; distanceTo(v: V3): number }
  type Obj = {
    type: string; isMesh?: boolean; visible: boolean; children: Obj[]; position: V3; matrixWorld: unknown
    geometry?: { boundingBox: { min: V3; max: V3 } | null; computeBoundingBox(): void }
    traverse(fn: (o: Obj) => void): void; updateMatrixWorld(force: boolean): void
  }
  const controls = w.__orbitalControls as { camera: { position: V3 }; getTarget(out: V3, smooth: boolean): V3 } | undefined
  const scene = w.__orbitalScene as Obj | undefined
  if (!controls || !scene) return null
  const camera = controls.camera
  const Vec = camera.position.constructor as new (x?: number, y?: number, z?: number) => V3
  const target = controls.getTarget(new Vec(), false)
  let group: Obj | null = null
  scene.traverse((o) => {
    if (!group && o.type === 'Group' && o.children.length > 0 && o.position.distanceTo(target) < 0.5) group = o
  })
  if (!group) return null
  const station = group as Obj
  station.updateMatrixWorld(true)
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  station.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry) return
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
    const box = o.geometry.boundingBox!
    for (let i = 0; i < 8; i++) {
      const p = new Vec(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
        .applyMatrix4(o.matrixWorld).project(camera)
      const x = ((p.x + 1) / 2) * window.innerWidth
      const y = ((1 - p.y) / 2) * window.innerHeight
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  })
  return { left, top, right, bottom }
}

test.describe('station framing', () => {
  test.use({ hasTouch: true, isMobile: true })

  for (const size of [[360, 640], [390, 844], [844, 390]] as const) {
    test(`tracked station clears the clock and gauges at ${size[0]}×${size[1]}`, async ({ page }) => {
      test.setTimeout(360_000)
      await page.setViewportSize({ width: size[0], height: size[1] })
      await boot(page)
      const hasHooks = await page.evaluate(() => '__orbitalControls' in window)
      test.skip(!hasHooks, 'needs the DEV scene hooks: run with E2E_DEV=1')

      const locate = await page.locator('#btn-locate-iss').boundingBox()
      if (!locate) throw new Error('Locate has no box')
      await page.touchscreen.tap(locate.x + locate.width / 2, locate.y + locate.height / 2)
      await expect(page.locator('[role="status"]').first()).toHaveText(/Follow\s*·\s*Locked/, { timeout: 270_000 })
      // Let the framing shift finish easing in.
      await page.waitForTimeout(2_000)

      const station = await page.evaluate(stationBox)
      expect(station, 'station box').not.toBeNull()
      for (const selector of ['.hud-bottom-center', '.hud-bottom-left']) {
        const box = await page.locator(selector).boundingBox()
        if (!box || !station) continue
        const hit = station.left < box.x + box.width && box.x < station.right
          && station.top < box.y + box.height && box.y < station.bottom
        expect.soft(hit, `station box ${JSON.stringify(station)} intersects ${selector}`).toBe(false)
      }
    })
  }
})
