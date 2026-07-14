import { validateTLEData } from '../orbital/TLEParser'
import type { TLEData } from '@/types/orbital'
import { ISS_NORAD_ID } from '@/utils/constants'

const PROXY_TIMEOUT_MS = 25_000
const BROWSER_FALLBACK_TIMEOUT_MS = 20_000
const WHERETHEISS_TLE =
  `https://api.wheretheiss.at/v1/satellites/${ISS_NORAD_ID}/tles?format=text`

async function fetchBrowserFallback(noradId: number): Promise<TLEData | null> {
  if (noradId !== ISS_NORAD_ID) return null

  const startTime = performance.now()
  try {
    const response = await fetch(WHERETHEISS_TLE, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(BROWSER_FALLBACK_TIMEOUT_MS),
    })
    const elapsed = performance.now() - startTime

    if (!response.ok) {
      console.warn(`[TLE] Browser fallback failed with status ${response.status} in ${elapsed.toFixed(0)}ms`)
      return null
    }

    const raw = await response.text()
    const lines = raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    const candidate = {
      line1: lines.find(line => line.startsWith('1 ')),
      line2: lines.find(line => line.startsWith('2 ')),
      fetchedAt: Date.now(),
      source: 'celestrak',
    }
    const validated = validateTLEData(candidate, noradId)
    if (!validated.ok) {
      console.warn(`[TLE] Browser fallback returned invalid data in ${elapsed.toFixed(0)}ms`)
      return null
    }

    console.log(`[TLE] Browser fallback success in ${elapsed.toFixed(0)}ms`)
    return validated.tle
  } catch (error) {
    const elapsed = performance.now() - startTime
    const timedOut = error instanceof DOMException
      && (error.name === 'TimeoutError' || error.name === 'AbortError')
    console.warn(`[TLE] Browser fallback ${timedOut ? 'timed out' : 'unreachable'} in ${elapsed.toFixed(0)}ms`)
    return null
  }
}

/**
 * Fetches a fresh TLE through the same-origin Vercel Function.
 *
 * CelesTrak requests intentionally stay inside `/api/tle`, keeping telemetry
 * independent of end-user ISP blocks and avoiding known browser CORS failures.
 * If the proxy itself is unavailable, the client retains one emergency request
 * to the CORS-open wheretheiss.at mirror before TelemetryManager falls back to
 * cached or packaged telemetry.
 */
export async function fetchTLEFromCelesTrak(
  noradId: number = ISS_NORAD_ID,
): Promise<TLEData | null> {
  const startTime = performance.now()

  try {
    const response = await fetch('/api/tle', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    })
    const elapsed = performance.now() - startTime

    if (!response.ok) {
      console.warn(`[TLE] Proxy request failed with status ${response.status} in ${elapsed.toFixed(0)}ms`)
      return fetchBrowserFallback(noradId)
    }

    const candidate: unknown = await response.json()
    const validated = validateTLEData(candidate, noradId)
    if (!validated.ok) {
      console.warn(`[TLE] Proxy returned invalid data in ${elapsed.toFixed(0)}ms`)
      return fetchBrowserFallback(noradId)
    }

    console.log(`[TLE] Proxy success in ${elapsed.toFixed(0)}ms`)
    return validated.tle
  } catch (error) {
    const elapsed = performance.now() - startTime
    const timedOut = error instanceof DOMException
      && (error.name === 'TimeoutError' || error.name === 'AbortError')
    console.warn(`[TLE] Proxy ${timedOut ? 'timed out' : 'unreachable'} in ${elapsed.toFixed(0)}ms`)
    return fetchBrowserFallback(noradId)
  }
}
