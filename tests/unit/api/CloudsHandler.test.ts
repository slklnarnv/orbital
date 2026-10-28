import { describe, expect, it } from 'vitest'
import {
  CLOUD_MAP_H,
  CLOUD_MAP_W,
  type GmgsiGrid,
  clearSkyReference,
  createCloudsHandler,
  dayPrefix,
  featherSeams,
  latestKey,
  reproject,
} from '../../../api/clouds'

const KEY = (h: string) => `GMGSI_LW/2026/10/28/${h}/GLOBCOMPLIR_v3r0_blend_s20261028${h}00000_e20261028${h}09599_c1.nc`
const listing = (...keys: string[]) => `<ListBucketResult>${keys.map((k) => `<Key>${k}</Key>`).join('')}</ListBucketResult>`
const request = (method = 'GET', query = '') => new Request(`https://orbital.example/api/clouds${query}`, { method })
const WEBP = new Uint8Array([82, 73, 70, 70])

/** A fake bucket: listings per day prefix, downloads return the key's bytes. */
function bucket(days: Record<string, string[]>, opts: { failDownload?: boolean; failList?: boolean } = {}) {
  const calls = { list: 0, download: 0 }
  const fetchImpl = (async (url: string) => {
    if (url.includes('list-type')) {
      calls.list++
      if (opts.failList) throw new Error('network')
      const prefix = decodeURIComponent(new URL(url).searchParams.get('prefix') ?? '')
      return new Response(listing(...(days[prefix] ?? [])))
    }
    calls.download++
    if (opts.failDownload) return new Response('no', { status: 503 })
    return new Response(new Uint8Array([1, 2, 3]))
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('/api/clouds upstream parsing', () => {
  it('picks the newest hour and its scan time', () => {
    const latest = latestKey(listing(KEY('16'), KEY('17'), KEY('09')))
    expect(latest?.key).toBe(KEY('17'))
    expect(latest?.time.toISOString()).toBe('2026-10-28T17:00:00.000Z')
    expect(latestKey(listing())).toBeNull()
  })

  it('builds UTC day prefixes', () => {
    expect(dayPrefix(new Date('2026-01-02T23:59:00Z'))).toBe('GMGSI_LW/2026/01/02/')
  })
})

describe('/api/clouds handler', () => {
  const now = () => Date.parse('2026-10-28T17:40:00Z')
  const convert = async () => WEBP

  it('serves the newest hour as WebP with its time, cached at the edge', async () => {
    const { fetchImpl } = bucket({ 'GMGSI_LW/2026/10/28/': [KEY('16'), KEY('17')] })
    const response = await createCloudsHandler(fetchImpl, { now, convert })(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(response.headers.get('X-Clouds-Time')).toBe('2026-10-28T17:00:00.000Z')
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toContain('max-age=1200')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WEBP)
  })

  it('falls back to yesterday just after midnight', async () => {
    const { fetchImpl } = bucket({ 'GMGSI_LW/2026/10/27/': [KEY('23').replace('/28/', '/27/').replace('20261028', '20261027')] })
    const handler = createCloudsHandler(fetchImpl, { now: () => Date.parse('2026-10-28T00:20:00Z'), convert })
    const response = await handler(request())
    expect(response.headers.get('X-Clouds-Time')).toBe('2026-10-27T23:00:00.000Z')
  })

  it('reuses a warm map: no listing inside the memo window, no download for the same hour', async () => {
    let t = now()
    const { fetchImpl, calls } = bucket({ 'GMGSI_LW/2026/10/28/': [KEY('17')] })
    let converted = 0
    const handler = createCloudsHandler(fetchImpl, { now: () => t, memoMinAgeMs: 60_000, convert: async () => { converted++; return WEBP } })
    await handler(request())
    await handler(request())
    expect(calls).toEqual({ list: 1, download: 1 })
    t += 120_000
    await handler(request())
    expect(calls).toEqual({ list: 2, download: 1 })
    expect(converted).toBe(1)
  })

  it('shares one conversion between concurrent misses', async () => {
    const { fetchImpl, calls } = bucket({ 'GMGSI_LW/2026/10/28/': [KEY('17')] })
    const handler = createCloudsHandler(fetchImpl, { now, convert })
    const responses = await Promise.all([handler(request()), handler(request()), handler(request())])
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
    expect(calls.download).toBe(1)
  })

  it('serves the last good map, marked stale, when NOAA fails; 502 with none', async () => {
    let t = now()
    let fail = false
    const days = { 'GMGSI_LW/2026/10/28/': [KEY('17')] }
    const ok = bucket(days).fetchImpl
    const broken = bucket(days, { failList: true }).fetchImpl
    const handler = createCloudsHandler(((url: string) => (fail ? broken : ok)(url)) as typeof fetch, { now: () => t, memoMinAgeMs: 1, convert })
    await handler(request())
    fail = true
    t += 10
    const stale = await handler(request())
    expect(stale.status).toBe(200)
    expect(stale.headers.get('X-Clouds-Stale')).toBe('1')

    const cold = createCloudsHandler(bucket(days, { failDownload: true }).fetchImpl, { now, convert })
    const response = await cold(request())
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('refuses query strings and other methods; HEAD has no body', async () => {
    const { fetchImpl, calls } = bucket({ 'GMGSI_LW/2026/10/28/': [KEY('17')] })
    const handler = createCloudsHandler(fetchImpl, { now, convert })
    expect((await handler(request('GET', '?x=1'))).status).toBe(404)
    expect((await handler(request('POST'))).status).toBe(405)
    expect(calls.list).toBe(0)
    const head = await handler(request('HEAD'))
    expect(head.status).toBe(200)
    expect((await head.arrayBuffer()).byteLength).toBe(0)
  })
})

describe('cloud map pipeline', () => {
  /** A synthetic GMGSI hour: equal-angle rows ±72°, constant counts, one fake seam. */
  function grid(value: (row: number, col: number) => number): GmgsiGrid {
    const rows = 300
    const cols = 500
    const data = new Float32Array(rows * cols)
    const latRows = new Float64Array(rows)
    for (let r = 0; r < rows; r++) {
      latRows[r] = 72 - (144 * r) / (rows - 1)
      for (let c = 0; c < cols; c++) data[r * cols + c] = value(r, c)
    }
    return { data, rows, cols, latRows, lon0: 180 }
  }

  it('finds a stitching seam and spreads its step', () => {
    const g = grid((_r, c) => (c > 250 ? 140 : 100))
    const seams = featherSeams(g)
    expect(seams).toEqual([250])
    const row = 150 * g.cols
    // The 40-count cliff between columns 250 and 251 is gone…
    expect(Math.abs(g.data[row + 251] - g.data[row + 250])).toBeLessThan(2)
    // …and became a ramp of at most ~1 count per column.
    for (let c = 200; c < 300; c++) expect(Math.abs(g.data[row + c + 1] - g.data[row + c])).toBeLessThan(1.5)
  })

  it('reprojects onto the equirectangular grid and leaves the poles and missing data out', () => {
    const g = grid((r, c) => (c < 50 ? 255 : 100 + (r % 3)))
    const { ir, valid } = reproject(g)
    const at = (lat: number, lon: number) => Math.floor(((90 - lat) / 180) * CLOUD_MAP_H) * CLOUD_MAP_W + Math.floor(((lon + 180) / 360) * CLOUD_MAP_W)
    expect(valid[at(0, 30)]).toBe(1)
    expect(ir[at(0, 30)]).toBeGreaterThanOrEqual(100)
    expect(ir[at(0, 30)]).toBeLessThanOrEqual(102)
    expect(valid[at(80, 30)]).toBe(0) // beyond the mosaic's ±72°
    // Columns 0–49 (the 255 'missing' fill) start at 180° and span 36°.
    expect(valid[at(0, -170)]).toBe(0)
  })

  it('takes the clear-sky reference from the sea, so coasts do not read as cloud', () => {
    // Quarter grid: sea (clear, 100 counts) west of 0°, hot land (60) east.
    const ocean = new Float32Array((CLOUD_MAP_W / 4) * (CLOUD_MAP_H / 4))
    const ir = new Float32Array(CLOUD_MAP_W * CLOUD_MAP_H)
    for (let y = 0; y < CLOUD_MAP_H; y++) {
      for (let x = 0; x < CLOUD_MAP_W; x++) ir[y * CLOUD_MAP_W + x] = x < CLOUD_MAP_W / 2 ? 100 : 60
    }
    for (let y = 0; y < CLOUD_MAP_H / 4; y++) {
      for (let x = 0; x < CLOUD_MAP_W / 8; x++) ocean[y * (CLOUD_MAP_W / 4) + x] = 1
    }
    const ref = clearSkyReference(ir, ocean)
    // The sea pixel next to the coast: its clear reference is the sea's 100,
    // not the land's 60 (which made the coast 40 counts 'colder than clear').
    const coastSea = 256 * (CLOUD_MAP_W / 4) + CLOUD_MAP_W / 8 - 2
    expect(ref[coastSea]).toBeGreaterThanOrEqual(99)
  })
})
