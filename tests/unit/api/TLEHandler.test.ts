import { describe, expect, it, vi } from 'vitest'
import tleFunction, { createTLEHandler } from '../../../api/tle'

const VALID_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   26194.12129675  .00004316  00000+0  86456-4 0  9991',
  '2 25544  51.6304 171.7447 0006685 289.3803  70.6462 15.48996109575778',
].join('\n')

const request = (method = 'GET') => new Request('https://orbital.example/api/tle', { method })

describe('/api/tle', () => {
  it('exports Vercel\'s Web fetch handler contract', () => {
    expect(tleFunction).toEqual({ fetch: expect.any(Function) })
  })

  it.each(['POST', 'PUT', 'DELETE'])('rejects %s without contacting an upstream', async method => {
    const upstream = vi.fn()
    const response = await createTLEHandler(upstream as typeof fetch)(request(method))

    expect(upstream).not.toHaveBeenCalled()
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, OPTIONS')
  })

  it('handles preflight without contacting an upstream', async () => {
    const upstream = vi.fn()
    const response = await createTLEHandler(upstream as typeof fetch)(request('OPTIONS'))

    expect(upstream).not.toHaveBeenCalled()
    expect(response.status).toBe(204)
  })

  it('returns only a strictly validated TLE with bounded edge staleness', async () => {
    const upstream = vi.fn(async () => new Response(VALID_TLE, { status: 200 }))
    const response = await createTLEHandler(upstream as typeof fetch)(request())

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=3600, stale-while-revalidate=300',
    )
    await expect(response.json()).resolves.toMatchObject({ source: 'celestrak' })
  })

  it('validates propagation at the element epoch instead of the wall clock', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2050-01-01T00:00:00Z'))

    try {
      const upstream = vi.fn(async () => new Response(VALID_TLE, { status: 200 }))
      const response = await createTLEHandler(upstream as typeof fetch)(request())
      expect(response.status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns 502 and no-store when every upstream payload is invalid', async () => {
    const upstream = vi.fn(async () => new Response('not a TLE', { status: 200 }))
    const response = await createTLEHandler(upstream as typeof fetch)(request())

    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ error: 'TLE sources unavailable' })
  })
})
