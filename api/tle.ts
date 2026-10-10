import * as satellite from 'satellite.js'

const ISS_NORAD_ID = 25544

const CELESTRAK_ORG = (id: number) =>
  `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`

const CELESTRAK_COM = (id: number) =>
  `https://celestrak.com/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`

const WHERETHEISS_TLE =
  `https://api.wheretheiss.at/v1/satellites/${ISS_NORAD_ID}/tles?format=text`

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers':
    'Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
}

const ALLOW = 'GET, HEAD, OPTIONS'
// Upstreams publish new ISS elements a few times a day. A warm instance
// reuses its last good answer for this long, so a burst of edge-cache misses
// (cold POPs, purges) costs one upstream race instead of one per request.
const MEMO_MIN_AGE_MS = 15 * 60_000
// Identify ourselves to CelesTrak/wheretheiss.at; anonymous bulk traffic is
// what their fair-use policies throttle first.
const USER_AGENT = 'orbital-iss-visualizer (Vercel function; ISS TLE proxy)'

interface TLEData {
  line1: string
  line2: string
  fetchedAt: number
  source: 'celestrak'
}

type FetchImplementation = typeof fetch

function hasValidChecksum(line: string): boolean {
  let checksum = 0
  for (const char of line.slice(0, 68)) {
    if (char >= '0' && char <= '9') checksum += Number(char)
    else if (char === '-') checksum += 1
  }
  return checksum % 10 === Number(line[68])
}

function hasFiniteVector(vector: unknown): boolean {
  if (!vector || typeof vector === 'boolean') return false
  const value = vector as { x?: unknown; y?: unknown; z?: unknown }
  return [value.x, value.y, value.z].every(
    component => typeof component === 'number' && Number.isFinite(component),
  )
}

function extractTLEEpoch(line1: string): Date | null {
  const epochField = line1.slice(18, 32)
  if (!/^\d{2}\d{3}\.\d{8}$/.test(epochField)) return null

  const shortYear = Number(epochField.slice(0, 2))
  const dayOfYear = Number(epochField.slice(2))
  const fullYear = shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear
  const leapYear = fullYear % 4 === 0 && (fullYear % 100 !== 0 || fullYear % 400 === 0)
  const maximumDay = leapYear ? 366 : 365
  if (!Number.isFinite(dayOfYear) || dayOfYear < 1 || dayOfYear >= maximumDay + 1) {
    return null
  }

  const epoch = new Date(Date.UTC(fullYear, 0, 1))
  epoch.setUTCDate(epoch.getUTCDate() + Math.floor(dayOfYear) - 1)
  epoch.setUTCMilliseconds((dayOfYear - Math.floor(dayOfYear)) * 86_400_000)
  return Number.isFinite(epoch.getTime()) ? epoch : null
}

/**
 * Keep the serverless boundary self-contained. Importing browser application
 * modules here couples the Vercel function to path aliases and project references
 * that the standalone Functions compiler does not support.
 */
function parseTLEString(raw: string): TLEData | null {
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const line1 = lines.find(line => line.startsWith('1 '))
  const line2 = lines.find(line => line.startsWith('2 '))
  if (!line1 || !line2 || line1.length !== 69 || line2.length !== 69) return null
  if (!/^\d$/.test(line1[68]) || !/^\d$/.test(line2[68])) return null
  if (!hasValidChecksum(line1) || !hasValidChecksum(line2)) return null

  const catalog1 = Number(line1.slice(2, 7).trim())
  const catalog2 = Number(line2.slice(2, 7).trim())
  if (catalog1 !== ISS_NORAD_ID || catalog2 !== ISS_NORAD_ID) return null

  const epoch = extractTLEEpoch(line1)
  if (!epoch) return null

  try {
    const satrec = satellite.twoline2satrec(line1, line2)
    if (satrec.error !== 0) return null
    const propagated = satellite.propagate(satrec, epoch)
    if (!hasFiniteVector(propagated.position) || !hasFiniteVector(propagated.velocity)) {
      return null
    }
  } catch {
    return null
  }

  // 'celestrak' means "validated live network element set", regardless of
  // which upstream won the race (CelesTrak mirrors or wheretheiss.at). It is
  // a provenance class, not a hostname: the client keys its LIVE gate on it
  // (TelemetryManager) and OrbitalEngine maps it to state source 'live'.
  return { line1, line2, fetchedAt: Date.now(), source: 'celestrak' }
}

async function tryFetchWithSignal(
  fetchImplementation: FetchImplementation,
  url: string,
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<string | null> {
  const controller = new AbortController()
  const onParentAbort = () => controller.abort()
  parentSignal.addEventListener('abort', onParentAbort, { once: true })
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImplementation(url, {
      headers: { Accept: 'text/plain', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
    parentSignal.removeEventListener('abort', onParentAbort)
  }
}

async function fetchAndParse(
  fetchImplementation: FetchImplementation,
  url: string,
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<TLEData> {
  const text = await tryFetchWithSignal(fetchImplementation, url, timeoutMs, parentSignal)
  if (!text) throw new Error('TLE source unavailable')

  const tle = parseTLEString(text)
  if (!tle) throw new Error('TLE source returned invalid data')
  return tle
}

export interface TLEHandlerOptions {
  /** Injectable clock for memo-age tests. */
  now?: () => number
  memoMinAgeMs?: number
}

function reply(method: string, status: number, body: unknown, headers: Record<string, string>): Response {
  const merged = { ...CORS_HEADERS, ...headers }
  if (method === 'HEAD') {
    return new Response(null, { status, headers: { 'Content-Type': 'application/json', ...merged } })
  }
  return Response.json(body, { status, headers: merged })
}

const FRESH_HEADERS = {
  'Cache-Control': 'public, max-age=60',
  'Vercel-CDN-Cache-Control': 'max-age=3600, stale-while-revalidate=300',
}
// Served from the warm memo after every upstream failed: short edge life so a
// recovered upstream is picked up quickly. The body's fetchedAt stays the
// original fetch time, so the client's own staleness accounting is truthful.
const STALE_HEADERS = {
  'Cache-Control': 'public, max-age=60',
  'Vercel-CDN-Cache-Control': 'max-age=300',
  'X-TLE-Stale': '1',
}

/**
 * Exported factory keeps upstream behavior testable without network I/O.
 *
 * Abuse/upstream protection (pattern from gcdatlas's api/_lib/guard.js,
 * adapted to the Web Request/Response handler):
 *  - Only the bare path is served. The edge cache keys on the full URL, so
 *    `?x=1`, `?x=2`… would each miss, run the function and hit CelesTrak.
 *    Query strings get a cacheable 404 before any upstream work.
 *  - A warm instance reuses its last good TLE for MEMO_MIN_AGE_MS, and
 *    concurrent misses share one upstream race.
 *  - If every upstream fails, the last good TLE is served (marked stale)
 *    instead of a 502.
 */
export function createTLEHandler(
  fetchImplementation: FetchImplementation = fetch,
  options: TLEHandlerOptions = {},
) {
  const now = options.now ?? Date.now
  const memoMinAgeMs = options.memoMinAgeMs ?? MEMO_MIN_AGE_MS
  let memo: { at: number; tle: TLEData } | null = null
  let inflight: Promise<TLEData> | null = null

  // The race is deliberately NOT tied to any one request's signal: it is
  // shared, so one client disconnecting must not fail the others waiting on
  // it. Per-source timeouts (≤20 s, under maxDuration 30) bound it.
  const load = (): Promise<TLEData> => {
    if (inflight) return inflight
    const controller = new AbortController()
    inflight = Promise.any([
      fetchAndParse(fetchImplementation, CELESTRAK_ORG(ISS_NORAD_ID), 10_000, controller.signal),
      fetchAndParse(fetchImplementation, CELESTRAK_COM(ISS_NORAD_ID), 10_000, controller.signal),
      fetchAndParse(fetchImplementation, WHERETHEISS_TLE, 20_000, controller.signal),
    ])
      .then((tle) => {
        memo = { at: now(), tle }
        return tle
      })
      .finally(() => {
        controller.abort() // cancel the losing racers
        inflight = null
      })
    return inflight
  }

  return async function handler(request: Request): Promise<Response> {
    const method = request.method
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS_HEADERS, Allow: ALLOW } })
    }
    if (method !== 'GET' && method !== 'HEAD') {
      return reply(method, 405, { error: 'Method not allowed' }, { Allow: ALLOW, 'Cache-Control': 'no-store' })
    }
    if (new URL(request.url).search !== '') {
      return reply(method, 404, { error: 'Not found' }, {
        'Cache-Control': 'public, max-age=3600',
        'Vercel-CDN-Cache-Control': 'max-age=86400',
      })
    }

    if (memo && now() - memo.at < memoMinAgeMs) return reply(method, 200, memo.tle, FRESH_HEADERS)
    // Nobody is listening; do not spend an upstream race on it.
    if (request.signal.aborted) {
      return reply(method, 502, { error: 'TLE sources unavailable' }, { 'Cache-Control': 'no-store' })
    }

    try {
      return reply(method, 200, await load(), FRESH_HEADERS)
    } catch {
      if (memo) return reply(method, 200, memo.tle, STALE_HEADERS)
      return reply(method, 502, { error: 'TLE sources unavailable' }, { 'Cache-Control': 'no-store' })
    }
  }
}

const handler = createTLEHandler()

/** Vercel Web-standard method exports for the standalone `/api/tle` function. */
export const GET = handler
export const HEAD = handler
export const OPTIONS = handler
