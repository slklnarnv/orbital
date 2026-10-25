import type { Page } from '@playwright/test'
import fallback from '../../src/data/fallback-tle.json' with { type: 'json' }

export interface StubOptions {
  /** `ok` serves the packaged TLE from /api/tle; `fail` answers 503. */
  tle?: 'ok' | 'fail'
}

/**
 * `vite preview` serves dist/ only (no /api/tle) and the app calls several
 * third-party APIs, so every network dependency is stubbed. Call before
 * `page.goto`.
 */
export async function stubNetwork(page: Page, opts: StubOptions = {}): Promise<void> {
  const tle = opts.tle ?? 'ok'

  await page.route('**/api/tle', (route) => {
    if (tle === 'fail') return route.fulfill({ status: 503, body: 'unavailable' })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        line1: fallback.line1,
        line2: fallback.line2,
        fetchedAt: Date.now(),
        source: 'celestrak',
      }),
    })
  })

  await page.route('https://api.wheretheiss.at/**', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  )

  await page.route('https://api.bigdatacloud.net/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ countryName: 'Australia', continent: 'Oceania', locality: '' }),
    }),
  )

  await page.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        timezone: 'Australia/Brisbane',
        timezone_abbreviation: 'AEST',
        utc_offset_seconds: 36000,
        current: { temperature_2m: 24.5, weather_code: 1 },
      }),
    }),
  )
}

/**
 * Collects console errors and uncaught page errors. Entries are prefixed
 * `console: ` or `pageerror: ` so specs can filter by origin. The returned
 * array is live: it keeps filling as the page runs.
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`)
  })
  return errors
}
