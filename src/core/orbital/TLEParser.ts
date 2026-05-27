import type { TLEData } from '@/types/orbital'

// ─── TLE Parser ───────────────────────────────────────────────────────────────

/** Validate basic TLE line format */
function isValidTLELine(line: string, expectedLineNumber: number): boolean {
  if (!line || line.length < 69) return false
  const lineNum = parseInt(line[0])
  return lineNum === expectedLineNumber
}

/** Parse a raw TLE string block into a TLEData object */
export function parseTLEString(
  raw: string,
  source: TLEData['source'] = 'cached'
): TLEData | null {
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  // Accept 2-line or 3-line TLE (3-line has name on first line)
  let line1: string, line2: string

  if (lines.length >= 3 && isValidTLELine(lines[1], 1) && isValidTLELine(lines[2], 2)) {
    line1 = lines[1]
    line2 = lines[2]
  } else if (lines.length >= 2 && isValidTLELine(lines[0], 1) && isValidTLELine(lines[1], 2)) {
    line1 = lines[0]
    line2 = lines[1]
  } else {
    console.warn('[TLEParser] Could not parse TLE from string:', raw.substring(0, 100))
    return null
  }

  return { line1, line2, fetchedAt: Date.now(), source }
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
