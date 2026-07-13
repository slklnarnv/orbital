import type { TLEData } from '@/types/orbital'
import * as satellite from 'satellite.js'

// ─── TLE Parser ───────────────────────────────────────────────────────────────


/** Parse a raw TLE string block into a TLEData object */
export function parseTLEString(
  raw: string,
  source: TLEData['source'] = 'cached',
  expectedNoradId?: number,
): TLEData | null {
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  const line1 = lines.find(l => l.startsWith('1 '))
  const line2 = lines.find(l => l.startsWith('2 '))
  if (!line1 || !line2) return null

  const candidate: TLEData = { line1, line2, fetchedAt: Date.now(), source }
  return validateTLEData(candidate, expectedNoradId).ok ? candidate : null
}

export type TLEValidationResult =
  | { ok: true; tle: TLEData; noradId: number; epochMs: number }
  | { ok: false; reason: string }

const VALID_SOURCES: ReadonlySet<string> = new Set(['celestrak', 'cached', 'fallback'])

function hasValidChecksum(line: string): boolean {
  let checksum = 0
  for (const char of line.slice(0, 68)) {
    if (char >= '0' && char <= '9') checksum += Number(char)
    else if (char === '-') checksum += 1
  }
  return checksum % 10 === Number(line[68])
}

function finiteVector(vector: unknown): boolean {
  if (!vector || typeof vector === 'boolean') return false
  const value = vector as { x?: unknown; y?: unknown; z?: unknown }
  return [value.x, value.y, value.z].every(component =>
    typeof component === 'number' && Number.isFinite(component),
  )
}

/**
 * Validate an untrusted TLE before it crosses the telemetry installation boundary.
 * This intentionally verifies both the fixed-width wire format and satellite.js'
 * ability to parse and propagate the element set at its own epoch.
 */
export function validateTLEData(
  candidate: unknown,
  expectedNoradId?: number,
): TLEValidationResult {
  if (!candidate || typeof candidate !== 'object') return { ok: false, reason: 'not-an-object' }

  const tle = candidate as Partial<TLEData>
  if (typeof tle.line1 !== 'string' || typeof tle.line2 !== 'string') {
    return { ok: false, reason: 'missing-lines' }
  }
  if (tle.line1.length !== 69 || tle.line2.length !== 69) {
    return { ok: false, reason: 'invalid-line-length' }
  }
  if (!tle.line1.startsWith('1 ') || !tle.line2.startsWith('2 ')) {
    return { ok: false, reason: 'invalid-line-prefix' }
  }
  if (!/^\d$/.test(tle.line1[68]) || !/^\d$/.test(tle.line2[68])) {
    return { ok: false, reason: 'missing-checksum' }
  }
  if (!hasValidChecksum(tle.line1) || !hasValidChecksum(tle.line2)) {
    return { ok: false, reason: 'checksum-mismatch' }
  }

  const catalog1 = Number(tle.line1.slice(2, 7).trim())
  const catalog2 = Number(tle.line2.slice(2, 7).trim())
  if (!Number.isInteger(catalog1) || catalog1 <= 0 || catalog1 !== catalog2) {
    return { ok: false, reason: 'catalog-mismatch' }
  }
  if (expectedNoradId !== undefined && catalog1 !== expectedNoradId) {
    return { ok: false, reason: 'unexpected-catalog' }
  }

  if (typeof tle.fetchedAt !== 'number' || !Number.isFinite(tle.fetchedAt) || tle.fetchedAt < 0) {
    return { ok: false, reason: 'invalid-fetch-time' }
  }
  if (tle.fetchedAt > Date.now() + 5 * 60_000) {
    return { ok: false, reason: 'future-fetch-time' }
  }
  if (typeof tle.source !== 'string' || !VALID_SOURCES.has(tle.source)) {
    return { ok: false, reason: 'invalid-source' }
  }

  const epochField = tle.line1.slice(18, 32)
  if (!/^\d{2}\d{3}\.\d{8}$/.test(epochField)) {
    return { ok: false, reason: 'invalid-epoch-format' }
  }
  const dayOfYear = Number(epochField.slice(2))
  const shortYear = Number(epochField.slice(0, 2))
  const fullYear = shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear
  const leapYear = fullYear % 4 === 0 && (fullYear % 100 !== 0 || fullYear % 400 === 0)
  const maximumDay = leapYear ? 366 : 365
  if (!Number.isFinite(dayOfYear) || dayOfYear < 1 || dayOfYear >= maximumDay + 1) {
    return { ok: false, reason: 'invalid-epoch-day' }
  }
  const epochMs = extractTLEEpoch(tle.line1).getTime()
  if (!Number.isFinite(epochMs)) return { ok: false, reason: 'invalid-epoch' }

  try {
    const satrec = satellite.twoline2satrec(tle.line1, tle.line2)
    if (satrec.error !== 0) return { ok: false, reason: 'satellite-parse-error' }
    const propagated = satellite.propagate(satrec, new Date(epochMs))
    if (!finiteVector(propagated.position) || !finiteVector(propagated.velocity)) {
      return { ok: false, reason: 'satellite-propagation-error' }
    }
  } catch {
    return { ok: false, reason: 'satellite-parse-error' }
  }

  return { ok: true, tle: tle as TLEData, noradId: catalog1, epochMs }
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
