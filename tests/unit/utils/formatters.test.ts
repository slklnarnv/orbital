import { describe, expect, it } from 'vitest'
import {
  formatCountdown,
  formatLatitude,
  formatLongitude,
  formatPeriod,
  formatUtcClockParts,
} from '@/utils/formatters'
import { periodMsOf } from '@/utils/orbitalTime'
import { telemetryModeVisual } from '@/ui/common/telemetryModeVisual'
import type { TelemetryMode } from '@/types/orbital'

const NOMINAL_MS = 92.68 * 60000

describe('formatPeriod', () => {
  it.each([
    [92.68, '92m 41s'],
    [92.9999, '93m 00s'], // seconds round to 60 -> carry, never "92m 60s"
    [90, '90m 00s'],
  ])('formats %s min as %s', (min, text) => {
    expect(formatPeriod(min)).toBe(text)
  })
})

describe('formatUtcClockParts', () => {
  it.each([
    [Date.UTC(2026, 0, 1, 0, 0, 0), '00:00:00', '2026.001'],
    [Date.UTC(2026, 11, 31, 23, 59, 59), '23:59:59', '2026.365'],
    [Date.UTC(2028, 11, 31, 12), '12:00:00', '2028.366'], // leap year
    [Date.UTC(2028, 1, 29), '00:00:00', '2028.060'],
  ])('splits %s into %s / %s', (epochMs, time, date) => {
    expect(formatUtcClockParts(epochMs)).toEqual({ time, date })
  })
})

describe('coordinate formatters', () => {
  it('formats latitude with hemisphere and precision', () => {
    expect(formatLatitude(-23.45, 2)).toBe('23.45° S')
    expect(formatLatitude(51.5074)).toBe('51.5074° N')
  })

  it('formats longitude with hemisphere and precision', () => {
    expect(formatLongitude(-0.1278)).toBe('0.1278° W')
    expect(formatLongitude(123.456)).toBe('123.4560° E')
  })
})

describe('periodMsOf', () => {
  it('converts minutes to milliseconds', () => {
    expect(periodMsOf(92.68)).toBe(NOMINAL_MS)
  })

  it.each([[0], [null], [undefined], [NaN]])(
    'falls back to the nominal period for %s',
    (value) => {
      expect(periodMsOf(value)).toBe(NOMINAL_MS)
    },
  )

  it('floors at 10 minutes (minutes, not seconds)', () => {
    expect(periodMsOf(5)).toBe(10 * 60000)
  })
})

describe('telemetryModeVisual', () => {
  it.each([
    ['LIVE', 'Live'],
    ['HYBRID', 'Cached'],
    ['RECOVERY', 'Recovery'],
    ['OFFLINE', 'Fallback'],
  ] as Array<[TelemetryMode, string]>)('%s reads as %s', (mode, label) => {
    const v = telemetryModeVisual(mode)
    expect(v.label).toBe(label)
    expect(v.dotClass.length).toBeGreaterThan(0)
    expect(v.color).toMatch(/^var\(--signal-[a-z]+\)$/)
  })
})

describe('formatCountdown', () => {
  it.each([
    [0, '00:00'],
    [761_000, '12:41'],
    [3_725_000, '1:02:05'],
    [-1, '—'],
    [NaN, '—'],
  ])('formats %s ms as %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text)
  })
})
