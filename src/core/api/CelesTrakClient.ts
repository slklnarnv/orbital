import { parseTLEString, validateTLEData } from '../orbital/TLEParser'
import type { TLEData } from '@/types/orbital'
import { ISS_NORAD_ID } from '@/utils/constants'

// ─── TLE Fetch Endpoints ──────────────────────────────────────────────────────
// Multiple sources in priority order. Each is tried independently; the first
// successful parse wins and is returned. All are publicly accessible with
// no authentication and return plain TLE-format text.

/** CelesTrak primary (.org, mirrors Space-Track) */
const CELESTRAK_ORG = (id: number) =>
  `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`

/** CelesTrak alternate domain (.com, same CDN) */
const CELESTRAK_COM = (id: number) =>
  `https://celestrak.com/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`

/** wheretheiss.at — CORS-open, mirrors Space-Track TLEs, ISS only */
const WHERETHEISS_TLE = `https://api.wheretheiss.at/v1/satellites/${ISS_NORAD_ID}/tles?format=text`

/**
 * Attempt a fetch linked to a parent abort signal and an individual source timeout.
 * Returns null on any failure, timeout, or abort.
 */
async function tryFetchWithSignal(
  url: string,
  timeoutMs: number,
  parentSignal: AbortSignal
): Promise<string | null> {
  const controller = new AbortController()

  // Forward the parent signal abort to our local fetch controller
  const onParentAbort = () => controller.abort()
  parentSignal.addEventListener('abort', onParentAbort)

  // Enforce the individual timeout by aborting the local fetch controller
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/plain' },
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
    parentSignal.removeEventListener('abort', onParentAbort)
  }
}

/**
 * Fetch from a source and validate the parsed TLE. Rejects (throws) on any failure.
 */
async function fetchAndParse(
  url: string,
  timeoutMs: number,
  parentSignal: AbortSignal,
  sourceName: string,
  expectedNoradId: number,
): Promise<TLEData> {
  const startTime = performance.now()
  let text: string | null = null
  try {
    text = await tryFetchWithSignal(url, timeoutMs, parentSignal)
    const elapsed = performance.now() - startTime

    if (!text) {
      console.warn(`[TLE] ${sourceName} failed in ${elapsed.toFixed(0)}ms`)
      throw new Error(`Fetch failed or timed out for ${sourceName}`)
    }

    console.log(`[TLE] ${sourceName} success in ${elapsed.toFixed(0)}ms`)
  } catch (err) {
    const elapsed = performance.now() - startTime
    if (parentSignal.aborted) {
      console.log(`[TLE] ${sourceName} aborted/cancelled in ${elapsed.toFixed(0)}ms`)
    } else if (text === null) {
      console.warn(`[TLE] ${sourceName} failed in ${elapsed.toFixed(0)}ms`)
    }
    throw err
  }

  const tle = parseTLEString(text, 'celestrak', expectedNoradId)
  if (!tle) {
    console.warn(`[TLE] parse failed for ${sourceName}`)
    throw new Error(`Failed to parse TLE from ${sourceName}`)
  }

  console.log(`[TLE] parse succeeded for ${sourceName}`)
  return tle
}

/**
 * Fetches a fresh ISS TLE.
 * Attempts to load from the serverless API proxy (`/api/tle`) first to minimize client load
 * and bypass regional ISP CelesTrak blocks. Falls back to a concurrent client-side race if needed.
 *
 * Client sources raced:
 *   1. celestrak.org  (primary, 10 s timeout)
 *   2. celestrak.com  (alternate domain, 10 s timeout)
 *   3. wheretheiss.at (CORS-open fallback, 20 s timeout, ISS-only)
 */
export async function fetchTLEFromCelesTrak(
  noradId: number = ISS_NORAD_ID
): Promise<TLEData | null> {
  // 1. Try Vercel Serverless Proxy first
  try {
    const startTime = performance.now()
    const response = await fetch('/api/tle', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000), // 10s timeout for the proxy fetch
    })
    const elapsed = performance.now() - startTime

    if (response.ok) {
      const candidate: unknown = await response.json()
      const validated = validateTLEData(candidate, noradId)
      if (validated.ok) {
        console.log(`[TLE] Serverless proxy success in ${elapsed.toFixed(0)}ms`)
        return validated.tle
      }
    }
    console.warn(`[TLE] Serverless proxy failed with status ${response.status} in ${elapsed.toFixed(0)}ms`)
  } catch {
    console.warn(`[TLE] Serverless proxy unreachable, falling back to client-side race...`)
  }

  // 2. Fallback: Concurrent Client-Side Race
  const controller = new AbortController()
  const signal = controller.signal

  const promises: Promise<TLEData>[] = [
    fetchAndParse(CELESTRAK_ORG(noradId), 10_000, signal, 'celestrak-org', noradId),
    fetchAndParse(CELESTRAK_COM(noradId), 10_000, signal, 'celestrak-com', noradId),
  ]

  if (noradId === ISS_NORAD_ID) {
    promises.push(fetchAndParse(WHERETHEISS_TLE, 20_000, signal, 'wheretheiss', noradId))
  }

  try {
    const tle = await Promise.any(promises)
    // Cancel the other pending requests as we have a winner
    controller.abort()
    return tle
  } catch {
    // In case of any leftover requests (though all should have rejected/failed)
    controller.abort()
    console.warn(
      '[CelesTrakClient] All TLE sources failed (CelesTrak ×2, wheretheiss.at). Will retry after backoff.'
    )
    return null
  }
}
