import { describe, expect, it, vi } from 'vitest'
import { createTLEHandler } from '../../../api/tle'

const VALID_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   26194.12129675  .00004316  00000+0  86456-4 0  9991',
  '2 25544  51.6304 171.7447 0006685 289.3803  70.6462 15.48996109575778',
].join('\n')

function responseRecorder() {
  const headers = new Map<string, string>()
  return {
    headers,
    body: '',
    statusCode: 0,
    setHeader(name: string, value: string) { headers.set(name, value) },
    end(body = '') { this.body = body },
  }
}

describe('/api/tle', () => {
  it.each(['POST', 'PUT', 'DELETE'])('rejects %s without contacting an upstream', async method => {
    const upstream = vi.fn()
    const res = responseRecorder()
    await createTLEHandler(upstream as typeof fetch)({ method }, res)

    expect(upstream).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET, OPTIONS')
  })

  it('handles preflight without contacting an upstream', async () => {
    const upstream = vi.fn()
    const res = responseRecorder()
    await createTLEHandler(upstream as typeof fetch)({ method: 'OPTIONS' }, res)

    expect(upstream).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(204)
  })

  it('returns only a strictly validated TLE with bounded edge staleness', async () => {
    const upstream = vi.fn(async () => new Response(VALID_TLE, { status: 200 }))
    const res = responseRecorder()
    await createTLEHandler(upstream as typeof fetch)({ method: 'GET' }, res)

    expect(res.statusCode).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('s-maxage=3600, stale-while-revalidate=300')
    expect(JSON.parse(res.body)).toMatchObject({ source: 'celestrak' })
  })

  it('returns 502 and no-store when every upstream payload is invalid', async () => {
    const upstream = vi.fn(async () => new Response('not a TLE', { status: 200 }))
    const res = responseRecorder()
    await createTLEHandler(upstream as typeof fetch)({ method: 'GET' }, res)

    expect(res.statusCode).toBe(502)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(JSON.parse(res.body)).toEqual({ error: 'TLE sources unavailable' })
  })
})
