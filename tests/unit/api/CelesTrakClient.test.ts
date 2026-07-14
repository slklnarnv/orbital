import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchTLEFromCelesTrak } from '@/core/api/CelesTrakClient'

const VALID_TLE = {
  line1: '1 25544U 98067A   26194.12129675  .00004316  00000+0  86456-4 0  9991',
  line2: '2 25544  51.6304 171.7447 0006685 289.3803  70.6462 15.48996109575778',
  fetchedAt: Date.now(),
  source: 'celestrak',
}

const VALID_TLE_TEXT = ['ISS (ZARYA)', VALID_TLE.line1, VALID_TLE.line2].join('\n')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CelesTrakClient', () => {
  it('accepts a validated TLE from the same-origin proxy', async () => {
    const fetchMock = vi.fn(async () => Response.json(VALID_TLE))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(fetchTLEFromCelesTrak()).resolves.toMatchObject({
      line1: VALID_TLE.line1,
      line2: VALID_TLE.line2,
      source: VALID_TLE.source,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/tle', expect.any(Object))
  })

  it('uses only the CORS-open mirror when the proxy fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/tle') {
        return Response.json({ error: 'unavailable' }, { status: 502 })
      }
      return new Response(VALID_TLE_TEXT)
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTLEFromCelesTrak()).resolves.toMatchObject({
      line1: VALID_TLE.line1,
      line2: VALID_TLE.line2,
      source: VALID_TLE.source,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tle')
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.wheretheiss.at/v1/satellites/25544/tles?format=text',
    )
    const requestedUrls = fetchMock.mock.calls.map(call => String(call[0]))
    expect(requestedUrls.some(url => url.includes('celestrak.org'))).toBe(false)
    expect(requestedUrls.some(url => url.includes('celestrak.com'))).toBe(false)
    expect(warning).toHaveBeenCalledTimes(1)
  })

  it('returns null after both the proxy and browser fallback return invalid data', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      input === '/api/tle'
        ? Response.json({ line1: 'invalid' })
        : new Response('not a TLE')
    ))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTLEFromCelesTrak()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledTimes(2)
  })

  it('classifies malformed proxy JSON before using the browser fallback', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      input === '/api/tle'
        ? new Response('{not-json', { headers: { 'Content-Type': 'application/json' } })
        : new Response(VALID_TLE_TEXT)
    ))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTLEFromCelesTrak()).resolves.toMatchObject({
      line1: VALID_TLE.line1,
      line2: VALID_TLE.line2,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('invalid JSON'))
  })

  it('clamps a server timestamp ahead of the client clock without discarding valid telemetry', async () => {
    const clientNow = Date.now()
    const fetchMock = vi.fn(async () => Response.json({
      ...VALID_TLE,
      fetchedAt: clientNow + 10 * 60_000,
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const tle = await fetchTLEFromCelesTrak()
    expect(tle).not.toBeNull()
    expect(tle!.fetchedAt).toBeLessThanOrEqual(Date.now())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
