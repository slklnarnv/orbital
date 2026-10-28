import { expect, test, type Locator, type Page } from '@playwright/test'
import { collectErrors, stubNetwork } from './fixtures'

// Smoke suite against `vite preview`. Assertions are on user-visible DOM only;
// the dev/bench-only scene hooks are absent from the production bundle.

/**
 * Click by coordinates. The rAF render loop defeats Playwright's actionability
 * waits on this app (docs/HANDOFF.md), so locator.click() can time out.
 */
async function clickByCoordinates(page: Page, locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible' })
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no bounding box')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/**
 * The full-screen loading overlay (z-9999) swallows pointer events until the
 * assets finish and it fades out, so clicks sent earlier are silently lost.
 * Software WebGL makes that window long; wait for the overlay to unmount.
 * The percentage leaves first (the bar holds at "Ready" for 400 ms, still
 * catching clicks), so wait for the overlay element itself too.
 */
async function waitForLoadingScreenGone(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading \d+%$/)).toHaveCount(0, { timeout: 90_000 })
  await expect(page.locator('.boot')).toHaveCount(0, { timeout: 10_000 })
}

async function openSettings(page: Page): Promise<void> {
  await clickByCoordinates(page, page.locator('button[aria-label="Render settings"]'))
}

/** Telemetry mode label shown top-left (the clock caption repeats it, hence first()). */
function modeLabel(page: Page, pattern: RegExp): Locator {
  return page.locator('.hud-label').filter({ hasText: pattern }).first()
}

async function bootLive(page: Page): Promise<void> {
  await stubNetwork(page)
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(modeLabel(page, /^Live$/)).toBeVisible({ timeout: 30_000 })
  await waitForLoadingScreenGone(page)
}

/** Focus a non-interactive spot so key shortcuts are not swallowed by a button. */
async function focusBody(page: Page): Promise<void> {
  await page.locator('body').focus()
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) active.blur()
  })
}

test('boots clean', async ({ page }) => {
  const errors = collectErrors(page)
  await bootLive(page)
  await page.waitForTimeout(5_000)
  expect(errors).toEqual([])
})

test('Locate reaches Follow · Locked', async ({ page }) => {
  // Software WebGL decodes the Locate LOD slowly on CI runners.
  test.setTimeout(360_000)
  await bootLive(page)
  await clickByCoordinates(page, page.locator('#btn-locate-iss'))
  await expect(page.locator('.hud-camera__status')).toHaveText(/Follow\s*·\s*Locked/, {
    timeout: 270_000,
  })
})

test('Space toggles pause', async ({ page }) => {
  await bootLive(page)
  await focusBody(page)
  await page.keyboard.press('Space')
  await expect(page.locator('button[aria-label="Resume time"]')).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.locator('button[aria-label="Pause time"]')).toBeVisible()
})

test('H hides the HUD', async ({ page }) => {
  await bootLive(page)
  await focusBody(page)
  await page.keyboard.press('h')
  await expect(page.locator('html')).toHaveClass(/hud-hidden/)
  await page.keyboard.press('h')
  await expect(page.locator('html')).not.toHaveClass(/hud-hidden/)
})

test('settings survive reload', async ({ page }) => {
  await bootLive(page)

  const readStyle = () =>
    page.evaluate(() => {
      const raw = window.localStorage.getItem('orbital-settings')
      if (!raw) return null
      const parsed = JSON.parse(raw) as { state?: { orbitLineStyle?: string } }
      return parsed.state?.orbitLineStyle ?? null
    })
  // Nothing is persisted until the first change; the store default applies.
  const initial = (await readStyle()) ?? 'continuous'

  const dialog = page.locator('div[role="dialog"][aria-label="Render settings"]')
  const group = dialog.locator('[role="radiogroup"][aria-label="Orbit line style"]')

  await openSettings(page)
  await expect(group).toBeVisible()
  const target = group.locator('[role="radio"][aria-checked="false"]').first()
  const targetText = ((await target.textContent()) ?? '').trim()
  expect(targetText).not.toBe('')
  await clickByCoordinates(page, target)

  await expect.poll(readStyle).not.toBe(initial)
  const changed = await readStyle()

  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(modeLabel(page, /^Live$/)).toBeVisible({ timeout: 30_000 })
  await waitForLoadingScreenGone(page)
  expect(await readStyle()).toBe(changed)

  await openSettings(page)
  await expect(group).toBeVisible()
  await expect(
    group.locator('[role="radio"]').filter({ hasText: targetText }),
  ).toHaveAttribute('aria-checked', 'true')
})

test('TLE failure degrades gracefully', async ({ page }) => {
  await stubNetwork(page, { tle: 'fail' })
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible()

  await expect(modeLabel(page, /^(Cached|Recovery|Fallback)$/)).toBeVisible({ timeout: 45_000 })
  await expect(modeLabel(page, /^Live$/)).toHaveCount(0)
  expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([])
})

// ─── Keyboard, overlays and About (roadmap 017 A1–A3, P) ────────────────────

test('? opens the shortcut overlay; Escape closes it', async ({ page }) => {
  await bootLive(page)
  await focusBody(page)
  await page.keyboard.press('Shift+Slash')
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(help).toBeVisible()
  await expect(help).toBeFocused()
  for (const label of ['Pause or resume', 'Locate the ISS', 'Reset to the Earth overview', 'Run at 300×', 'Return to live time', 'Visible passes', 'Render settings']) {
    await expect(help.getByText(label, { exact: true })).toBeVisible()
  }
  // Modal: other shortcuts pause while it is open.
  await page.keyboard.press('Space')
  await expect(page.locator('button[aria-label="Pause time"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(help).toHaveCount(0)
})

test('rate and live shortcuts drive the transport', async ({ page }) => {
  await bootLive(page)
  await focusBody(page)
  await page.keyboard.press('4')
  await expect(page.locator('button[aria-label="Time rate 300×"]')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('0')
  await expect(page.locator('button[aria-label^="Live"]')).toHaveAttribute('aria-pressed', 'true')
})

test('shortcuts never fire while typing in the place search', async ({ page }) => {
  await bootLive(page)
  await focusBody(page)
  await page.keyboard.press('p')
  const search = page.getByRole('combobox', { name: 'Observer location' })
  await expect(search).toBeFocused()
  await page.keyboard.type('h 1 g0')
  await expect(search).toHaveValue('h 1 g0')
  await expect(page.locator('html')).not.toHaveClass(/hud-hidden/)
  await expect(page.locator('button[aria-label^="Live"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('dialog', { name: 'Render settings' })).toHaveCount(0)
  // Escape still closes, and focus returns to the Passes trigger.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Visible passes' })).toHaveCount(0)
  await expect(page.locator('button[aria-label="Visible passes"]')).toBeFocused()
})

test('G opens settings and Escape returns focus to the gear', async ({ page }) => {
  await bootLive(page)
  await focusBody(page)
  await page.keyboard.press('g')
  const dialog = page.getByRole('dialog', { name: 'Render settings' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#btn-settings')).toBeFocused()
})

test('About shows what is real, credits and the build, and links to the shortcuts', async ({ page }) => {
  await bootLive(page)
  await clickByCoordinates(page, page.getByRole('button', { name: 'About', exact: true }))
  const about = page.getByRole('dialog', { name: 'About Orbital' })
  await expect(about).toBeVisible()
  for (const text of ['Measured', 'Illustrative', 'Data and credits', 'CelesTrak', 'Natural Earth', 'Open-Meteo']) {
    await expect(about.getByText(text, { exact: true }).first()).toBeVisible()
  }
  await expect(about.getByText(/^Build \S+$/)).toBeVisible()
  await about.getByRole('button', { name: /Keyboard shortcuts/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await expect(about).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'About', exact: true })).toBeFocused()
})

test('skip link, scene summary and a focus ring on every control', async ({ page }) => {
  await bootLive(page)
  await focusBody(page)
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to time and camera controls' })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#hud-main')).toBeFocused()

  await expect(page.locator('#scene-summary')).toHaveText(/^The ISS (is|position)/)
  await expect(page.getByRole('img', { name: /3D view of Earth/ })).toHaveAttribute('aria-describedby', 'scene-summary')

  // Tab through the whole HUD; every stop must draw a visible outline.
  await focusBody(page)
  const unringed: string[] = []
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const style = getComputedStyle(el)
      const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName
      return { name, ringed: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 }
    })
    if (info === null) break
    if (!info.ringed) unringed.push(info.name)
  }
  expect(unringed).toEqual([])
})

test('first visit offers the tour; it steps through the tools and stays dismissed', async ({ page }) => {
  await stubNetwork(page, { tour: true })
  await page.goto('/')
  await waitForLoadingScreenGone(page)
  const tour = page.getByRole('dialog', { name: 'Welcome to Orbital' })
  await expect(tour).toBeVisible({ timeout: 15_000 })
  await expect(tour).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('dialog', { name: 'Find the station' })).toBeVisible()
  // Modal: shortcuts pause while it is open.
  await page.keyboard.press('g')
  await expect(page.getByRole('dialog', { name: 'Render settings' })).toHaveCount(0)
  for (const title of ['Control time', 'Scrub the orbit', 'See it from the ground', 'Explore the modules', 'Tune the view', 'Keys and the rest']) {
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('dialog', { name: title })).toBeVisible()
  }
  await expect(page.locator('.hud-tour-spot')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.hud-panel--tour')).toHaveCount(0)
  await page.reload()
  await waitForLoadingScreenGone(page)
  await page.waitForTimeout(3_000)
  await expect(page.locator('.hud-panel--tour')).toHaveCount(0)
})

test('the tool row labels Passes, Modules and Settings; M from afar starts Locate', async ({ page }) => {
  await bootLive(page)
  for (const name of ['Passes', 'Modules', 'Settings']) {
    await expect(page.locator('.hud-corner--tr .hud-tool__label', { hasText: name })).toBeVisible()
  }
  await focusBody(page)
  await page.keyboard.press('m')
  // Locate first; the explorer opens on arrival (moduleExplorerControl.test.ts
  // covers that rule: under software WebGL the flight takes minutes).
  await expect(page.locator('#btn-locate-iss')).toHaveAttribute('aria-busy', 'true')
})
