import { describe, expect, it } from 'vitest'
import { parseTLEString, validateTLEData } from '@/core/orbital/TLEParser'
import fallbackTLE from '@/data/fallback-tle.json'
import type { TLEData } from '@/types/orbital'

const VALID_LINE_1 = '1 25544U 98067A   26194.12129675  .00004316  00000+0  86456-4 0  9991'
const VALID_LINE_2 = '2 25544  51.6304 171.7447 0006685 289.3803  70.6462 15.48996109575778'

function withChecksum(line: string): string {
  const body = line.slice(0, 68)
  let checksum = 0
  for (const character of body) {
    if (/\d/.test(character)) checksum += Number(character)
    else if (character === '-') checksum += 1
  }
  return `${body}${checksum % 10}`
}

function candidate(overrides: Partial<TLEData> = {}): TLEData {
  return {
    line1: VALID_LINE_1,
    line2: VALID_LINE_2,
    fetchedAt: Date.now(),
    source: 'celestrak',
    ...overrides,
  }
}

describe('TLE validation', () => {
  it('accepts a checksummed ISS TLE and the packaged fallback', () => {
    expect(validateTLEData(candidate(), 25544).ok).toBe(true)
    expect(validateTLEData({
      line1: fallbackTLE.line1,
      line2: fallbackTLE.line2,
      fetchedAt: new Date(fallbackTLE.epoch).getTime(),
      source: 'fallback',
    }, 25544).ok).toBe(true)
  })

  it('rejects checksum corruption, catalog substitution, and malformed epochs', () => {
    expect(validateTLEData(candidate({
      line2: `${VALID_LINE_2.slice(0, 68)}0`,
    }), 25544)).toMatchObject({ ok: false, reason: 'checksum-mismatch' })

    const otherCatalog = withChecksum(`${VALID_LINE_2.slice(0, 2)}99999${VALID_LINE_2.slice(7)}`)
    expect(validateTLEData(candidate({ line2: otherCatalog }), 25544)).toMatchObject({
      ok: false,
      reason: 'catalog-mismatch',
    })

    const badEpoch = withChecksum(`${VALID_LINE_1.slice(0, 18)}26999.12129675${VALID_LINE_1.slice(32)}`)
    expect(validateTLEData(candidate({ line1: badEpoch }), 25544)).toMatchObject({
      ok: false,
      reason: 'invalid-epoch-day',
    })

    const nonLeapDay366 = withChecksum(`${VALID_LINE_1.slice(0, 18)}26366.12129675${VALID_LINE_1.slice(32)}`)
    expect(validateTLEData(candidate({ line1: nonLeapDay366 }), 25544)).toMatchObject({
      ok: false,
      reason: 'invalid-epoch-day',
    })
  })

  it('requires the requested NORAD object and exact fixed-width lines', () => {
    expect(validateTLEData(candidate(), 12345)).toMatchObject({
      ok: false,
      reason: 'unexpected-catalog',
    })
    expect(parseTLEString(`${VALID_LINE_1.slice(0, -1)}\n${VALID_LINE_2}`, 'celestrak', 25544)).toBeNull()
  })
})
