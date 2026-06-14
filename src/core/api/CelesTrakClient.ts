import { parseTLEString } from '../orbital/TLEParser'
import { networkMonitor } from '../telemetry/NetworkMonitor'
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

/** Attempt a fetch with a per-source timeout. Returns null on any failure. */
async function tryFetch(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Fetches a fresh ISS TLE from CelesTrak, falling back to wheretheiss.at.
 *
 * Source priority:
 *   1. celestrak.org  (primary, 10 s timeout)
 *   2. celestrak.com  (alternate domain, 10 s timeout)
 *   3. wheretheiss.at (CORS-open fallback, 8 s timeout, ISS-only)
 *
 * Returns null only when all three sources fail, so the caller falls back
 * to the IndexedDB-cached or bundled fallback TLE.
 */
export async function fetchTLEFromCelesTrak(
  noradId: number = ISS_NORAD_ID
): Promise<TLEData | null> {
  // Source 1: CelesTrak primary
  const text1 = await tryFetch(CELESTRAK_ORG(noradId), 10_000)
  if (text1) {
    const tle = parseTLEString(text1, 'celestrak')
    if (tle) { networkMonitor.recordSuccess(); return tle }
  }

  // Source 2: CelesTrak alternate domain
  const text2 = await tryFetch(CELESTRAK_COM(noradId), 10_000)
  if (text2) {
    const tle = parseTLEString(text2, 'celestrak')
    if (tle) { networkMonitor.recordSuccess(); return tle }
  }

  // Source 3: wheretheiss.at (ISS only — ignore noradId for non-ISS calls)
  if (noradId === ISS_NORAD_ID) {
    const text3 = await tryFetch(WHERETHEISS_TLE, 8_000)
    if (text3) {
      const tle = parseTLEString(text3, 'celestrak')
      if (tle) { networkMonitor.recordSuccess(); return tle }
    }
  }

  networkMonitor.recordFailure()
  console.warn('[CelesTrakClient] All TLE sources failed (CelesTrak ×2, wheretheiss.at). Will retry after backoff.')
  return null
}

