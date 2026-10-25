import { expect, test, type Locator, type Page } from '@playwright/test'
import { collectErrors, stubNetwork } from './fixtures'

// Smoke suite against `vite preview`. Assertions are on user-visible DOM only;
// the DEV-only scene hooks are absent from the production bundle.

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
 */
async function waitForLoadingScreenGone(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading \d+%$/)).toHaveCount(0, { timeout: 90_000 })
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
  await expect(page.locator('[role="status"]').first()).toHaveText(/Follow\s*·\s*Locked/, {
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
