import { describe, expect, it } from 'vitest'
import * as satellite from 'satellite.js'
import { buildSimulationTime, computeGMST } from '@/core/clock/SimulationTime'

const TWO_PI = 2 * Math.PI

/** Same epoch-ms -> Julian date formula buildSimulationTime uses. */
const jdOf = (epochMs: number) => epochMs / 86400000 + 2440587.5

describe('buildSimulationTime', () => {
  it('maps the Unix epoch to JD 2440587.5', () => {
    expect(buildSimulationTime(0, 0, 0).julianDate).toBe(2440587.5)
  })

  it('carries epoch and deltas through and derives gmst from the Julian date', () => {
    const epochMs = Date.UTC(2026, 9, 24, 12, 34, 56)
    const t = buildSimulationTime(epochMs, 16, 160)
    expect(t.epochMs).toBe(epochMs)
    expect(t.deltaMs).toBe(16)
    expect(t.simDeltaMs).toBe(160)
    expect(t.julianDate).toBe(jdOf(epochMs))
    expect(t.gmst).toBe(computeGMST(t.julianDate))
  })
})

describe('computeGMST', () => {
  const cases: Array<[string, number]> = [
    ['J2000', 2451545.0],
    ['2026-10-24T00:00:00Z', jdOf(Date.UTC(2026, 9, 24, 0, 0, 0))],
    ['2026-10-24T12:34:56Z', jdOf(Date.UTC(2026, 9, 24, 12, 34, 56))],
    ['1990-06-15T06:00:00Z', jdOf(Date.UTC(1990, 5, 15, 6, 0, 0))],
  ]

  it.each(cases)('agrees with satellite.gstime at %s', (_label, jd) => {
    expect(Math.abs(computeGMST(jd) - satellite.gstime(jd))).toBeLessThan(1e-6)
  })

  it('is always in [0, 2π)', () => {
    for (let jd = 2415020.5; jd < 2488069.5; jd += 1234.5678) {
      const g = computeGMST(jd)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThan(TWO_PI)
    }
  })

  it('advances one sidereal rotation plus ~0.9856 deg per solar day', () => {
    const jd = 2461000.5
    const diff = (computeGMST(jd + 1) - computeGMST(jd) + TWO_PI) % TWO_PI
    expect(diff).toBeCloseTo((0.98564736 * Math.PI) / 180, 5)
  })
})
