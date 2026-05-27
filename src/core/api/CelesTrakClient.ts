import { parseTLEString } from '../orbital/TLEParser'
import { networkMonitor } from '../telemetry/NetworkMonitor'
import type { TLEData } from '@/types/orbital'
import { ISS_NORAD_ID } from '@/utils/constants'

// ─── CelesTrak Client ─────────────────────────────────────────────────────────
const CELESTRAK_URL = (noradId: number) =>
  `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=TLE`

/**
 * Fetches fresh TLE data from CelesTrak.
 * Returns null on failure — caller falls back to cached/fallback TLE.
 */
export async function fetchTLEFromCelesTrak(
  noradId: number = ISS_NORAD_ID
): Promise<TLEData | null> {
  try {
    const response = await fetch(CELESTRAK_URL(noradId), {
      headers: { 'Accept': 'text/plain' },
      signal: AbortSignal.timeout(10_000), // 10s timeout
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const text = await response.text()
    const tle = parseTLEString(text, 'celestrak')

    if (!tle) {
      throw new Error('Failed to parse TLE response')
    }

    networkMonitor.recordSuccess()
    return tle
  } catch (err) {
    networkMonitor.recordFailure()
    console.warn('[CelesTrakClient] TLE fetch failed:', err)
    return null
  }
}
