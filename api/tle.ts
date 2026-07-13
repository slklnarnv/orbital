import { parseTLEString } from '../src/core/orbital/TLEParser'
import type { TLEData } from '../src/types/orbital'

const ISS_NORAD_ID = 25544

const CELESTRAK_ORG = (id: number) =>
  `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`

const CELESTRAK_COM = (id: number) =>
  `https://celestrak.com/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`

const WHERETHEISS_TLE =
  `https://api.wheretheiss.at/v1/satellites/${ISS_NORAD_ID}/tles?format=text`

type FetchImplementation = typeof fetch

async function tryFetchWithSignal(
  fetchImplementation: FetchImplementation,
  url: string,
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<string | null> {
  const controller = new AbortController()
  const onParentAbort = () => controller.abort()
  parentSignal.addEventListener('abort', onParentAbort)
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

  const tle = parseTLEString(text, 'celestrak', ISS_NORAD_ID)
  if (!tle) throw new Error('TLE source returned invalid data')
  return tle
}

function setCorsHeaders(res: any): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  )
}

/** Exported factory keeps method and upstream behavior testable without network I/O. */
export function createTLEHandler(fetchImplementation: FetchImplementation = fetch) {
  return async function handler(req: any, res: any): Promise<void> {
    setCorsHeaders(res)

    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, OPTIONS')
      res.statusCode = 204
      res.end()
      return
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'application/json')
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    const controller = new AbortController()
    const signal = controller.signal
    const requests = [
      fetchAndParse(fetchImplementation, CELESTRAK_ORG(ISS_NORAD_ID), 10_000, signal),
      fetchAndParse(fetchImplementation, CELESTRAK_COM(ISS_NORAD_ID), 10_000, signal),
      fetchAndParse(fetchImplementation, WHERETHEISS_TLE, 20_000, signal),
    ]

    try {
      const tle = await Promise.any(requests)
      controller.abort()
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=300')
      res.setHeader('Content-Type', 'application/json')
      res.statusCode = 200
      res.end(JSON.stringify(tle))
    } catch {
      controller.abort()
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'application/json')
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'TLE sources unavailable' }))
    }
  }
}

export default createTLEHandler()
