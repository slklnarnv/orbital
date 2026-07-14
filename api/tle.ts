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
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers':
    'Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
}

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

  const epochField = line1.slice(18, 32)
  if (!/^\d{2}\d{3}\.\d{8}$/.test(epochField)) return null

  try {
    const satrec = satellite.twoline2satrec(line1, line2)
    if (satrec.error !== 0) return null
    const propagated = satellite.propagate(satrec, new Date())
    if (!hasFiniteVector(propagated.position) || !hasFiniteVector(propagated.velocity)) {
      return null
    }
  } catch {
    return null
  }

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
      headers: { Accept: 'text/plain' },
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

/** Exported factory keeps upstream behavior testable without network I/O. */
export function createTLEHandler(fetchImplementation: FetchImplementation = fetch) {
  return async function handler(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...CORS_HEADERS, Allow: 'GET, OPTIONS' },
      })
    }

    if (request.method !== 'GET') {
      return Response.json(
        { error: 'Method not allowed' },
        {
          status: 405,
          headers: {
            ...CORS_HEADERS,
            Allow: 'GET, OPTIONS',
            'Cache-Control': 'no-store',
          },
        },
      )
    }

    const controller = new AbortController()
    const onRequestAbort = () => controller.abort()
    request.signal.addEventListener('abort', onRequestAbort, { once: true })

    const requests = [
      fetchAndParse(fetchImplementation, CELESTRAK_ORG(ISS_NORAD_ID), 10_000, controller.signal),
      fetchAndParse(fetchImplementation, CELESTRAK_COM(ISS_NORAD_ID), 10_000, controller.signal),
      fetchAndParse(fetchImplementation, WHERETHEISS_TLE, 20_000, controller.signal),
    ]

    try {
      const tle = await Promise.any(requests)
      return Response.json(tle, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Cache-Control': 'public, max-age=60',
          'Vercel-CDN-Cache-Control': 'max-age=3600, stale-while-revalidate=300',
        },
      })
    } catch {
      return Response.json(
        { error: 'TLE sources unavailable' },
        {
          status: 502,
          headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' },
        },
      )
    } finally {
      controller.abort()
      request.signal.removeEventListener('abort', onRequestAbort)
    }
  }
}

export default { fetch: createTLEHandler() }
