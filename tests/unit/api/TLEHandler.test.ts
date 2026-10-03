import { describe, expect, it, vi } from 'vitest'
import { GET, OPTIONS, createTLEHandler } from '../../../api/tle'

const VALID_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   26194.12129675  .00004316  00000+0  86456-4 0  9991',
  '2 25544  51.6304 171.7447 0006685 289.3803  70.6462 15.48996109575778',
].join('\n')

const request = (method = 'GET') => new Request('https://orbital.example/api/tle', { method })

describe('/api/tle', () => {
  it('exports Vercel\'s Web HTTP method handler contract', () => {
    expect(GET).toEqual(expect.any(Function))
    expect(OPTIONS).toEqual(expect.any(Function))
  })

  it.each(['POST', 'PUT', 'DELETE'])('rejects %s without contacting an upstream', async method => {
    const upstream = vi.fn()
    const response = await createTLEHandler(upstream as typeof fetch)(request(method))

    expect(upstream).not.toHaveBeenCalled()
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, HEAD, OPTIONS')
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

  it('refuses query strings with a cacheable 404 before any upstream work', async () => {
    const upstream = vi.fn()
    const handler = createTLEHandler(upstream as typeof fetch)
    const response = await handler(new Request('https://orbital.example/api/tle?x=1'))

    expect(upstream).not.toHaveBeenCalled()
    expect(response.status).toBe(404)
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe('max-age=86400')
  })

  it('answers HEAD with headers and no body', async () => {
    const upstream = vi.fn(async () => new Response(VALID_TLE, { status: 200 }))
    const response = await createTLEHandler(upstream as typeof fetch)(request('HEAD'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(await response.text()).toBe('')
  })

  it('shares one upstream race between concurrent requests', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const upstream = vi.fn(async () => {
      await gate
      return new Response(VALID_TLE, { status: 200 })
    })
    const handler = createTLEHandler(upstream as typeof fetch)

    const pending = [handler(request()), handler(request()), handler(request())]
    release()
    const responses = await Promise.all(pending)

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
    // One race = one call per source (3), not one race per request (9).
    expect(upstream).toHaveBeenCalledTimes(3)
  })

  it('reuses the warm memo inside its minimum age and refetches after it', async () => {
    let clock = 1_000_000
    const upstream = vi.fn(async () => new Response(VALID_TLE, { status: 200 }))
    const handler = createTLEHandler(upstream as typeof fetch, { now: () => clock, memoMinAgeMs: 60_000 })

    await handler(request())
    const callsAfterFirst = upstream.mock.calls.length
    clock += 30_000
    expect((await handler(request())).status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(callsAfterFirst)

    clock += 60_000
    await handler(request())
    expect(upstream.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('serves the last good TLE, marked stale, when every upstream later fails', async () => {
    let clock = 1_000_000
    let healthy = true
    const upstream = vi.fn(async () =>
      healthy ? new Response(VALID_TLE, { status: 200 }) : new Response('down', { status: 503 }),
    )
    const handler = createTLEHandler(upstream as typeof fetch, { now: () => clock, memoMinAgeMs: 60_000 })

    const first = await (await handler(request())).json()
    healthy = false
    clock += 120_000
    const response = await handler(request())

    expect(response.status).toBe(200)
    expect(response.headers.get('X-TLE-Stale')).toBe('1')
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe('max-age=300')
    await expect(response.json()).resolves.toEqual(first)
  })

  it('does not start an upstream race for an already-aborted request', async () => {
    const upstream = vi.fn()
    const controller = new AbortController()
    controller.abort()
    const response = await createTLEHandler(upstream as typeof fetch)(
      new Request('https://orbital.example/api/tle', { signal: controller.signal }),
    )

    expect(upstream).not.toHaveBeenCalled()
    expect(response.status).toBe(502)
  })
})
