import type { TLEData } from '@/types/orbital'

// ─── TLE Parser ───────────────────────────────────────────────────────────────


/** Parse a raw TLE string block into a TLEData object */
export function parseTLEString(
  raw: string,
  source: TLEData['source'] = 'cached'
): TLEData | null {
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  // Find the first line starting with "1 " and the first line starting with "2 " of valid TLE length
  const line1 = lines.find(l => l.startsWith('1 ') && l.length >= 68)
  const line2 = lines.find(l => l.startsWith('2 ') && l.length >= 68)

  if (line1 && line2) {
    const cat1 = line1.substring(2, 7).trim()
    const cat2 = line2.substring(2, 7).trim()
    if (cat1 === cat2) {
      return { line1, line2, fetchedAt: Date.now(), source }
    } else {
      console.warn(`[TLEParser] Catalog numbers do not match: ${cat1} vs ${cat2}`)
    }
  }

  console.warn('[TLEParser] Could not parse TLE from string:', raw.substring(0, 100))
  return null
}

/** Extract the TLE epoch as a JS Date from line 1 */
export function extractTLEEpoch(line1: string): Date {
  // Field: columns 19-32 — epoch in YYDDD.DDDDDDDD format
  const epochStr = line1.substring(18, 32).trim()
  const year2digit = parseInt(epochStr.substring(0, 2))
  const doy = parseFloat(epochStr.substring(2))

  // Y2K: 00-56 → 2000-2056, 57-99 → 1957-1999
  const year = year2digit >= 57 ? 1900 + year2digit : 2000 + year2digit

  // Day of year (1-based) to Date
  const date = new Date(Date.UTC(year, 0, 1))
  date.setUTCDate(date.getUTCDate() + Math.floor(doy) - 1)
  const fractionalDay = doy - Math.floor(doy)
  date.setUTCMilliseconds(fractionalDay * 86400000)

  return date
}

/** Calculate TLE age in hours from current simulation time */
export function getTLEAgeHours(tle: TLEData, nowMs: number): number {
  const epoch = extractTLEEpoch(tle.line1)
  return (nowMs - epoch.getTime()) / (1000 * 3600)
}

/** Compute confidence score (0–1) based on TLE age */
export function tleConfidence(ageHours: number): number {
  if (ageHours < 24) return 1.0
  if (ageHours < 72) return 0.9
  if (ageHours < 168) return 0.7  // 7 days
  return 0.4
}
