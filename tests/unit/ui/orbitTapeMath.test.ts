import { describe, expect, it } from 'vitest'
import { argumentOfLatitudeDeg, wrapPhaseTowards } from '@/ui/clusters/orbitTapeMath'

const INC = 51.6
const RAD = Math.PI / 180

/** asin(sin(lat) / sin(inc)) in degrees, the un-quadranted argument of latitude. */
const ascendingOf = (latDeg: number, incDeg = INC) =>
  (Math.asin(Math.sin(latDeg * RAD) / Math.sin(incDeg * RAD)) * 180) / Math.PI

describe('argumentOfLatitudeDeg', () => {
  it('is 0 at the ascending node (northbound equator crossing)', () => {
    expect(argumentOfLatitudeDeg(0, -1, INC)).toBeCloseTo(0, 9)
  })

  it('is 90 at the northern apex', () => {
    expect(argumentOfLatitudeDeg(51.6, 51, INC)).toBeCloseTo(90, 6)
  })

  it('is 180 at the descending node (southbound equator crossing)', () => {
    expect(argumentOfLatitudeDeg(0, 1, INC)).toBeCloseTo(180, 9)
  })

  it('is 270 at the southern apex reached southbound', () => {
    expect(argumentOfLatitudeDeg(-51.6, -51, INC)).toBeCloseTo(270, 6)
  })

  it('maps a northbound southern latitude into [270, 360)', () => {
    const expected = 360 + ascendingOf(-30)
    const u = argumentOfLatitudeDeg(-30, -31, INC)!
    expect(u).toBeCloseTo(expected, 9)
    expect(u).toBeGreaterThanOrEqual(270)
    expect(u).toBeLessThan(360)
  })

  it('maps a southbound southern latitude into (180, 270]', () => {
    const u = argumentOfLatitudeDeg(-30, -29, INC)!
    expect(u).toBeCloseTo(180 - ascendingOf(-30), 9)
    expect(u).toBeGreaterThan(180)
    expect(u).toBeLessThanOrEqual(270)
  })

  it('treats an unchanged latitude as northbound', () => {
    expect(argumentOfLatitudeDeg(20, 20, INC)).toBeCloseTo(ascendingOf(20), 9)
  })

  it('uses the northern-half estimate on the first sample (no previous latitude)', () => {
    expect(argumentOfLatitudeDeg(20, null, INC)).toBeCloseTo(ascendingOf(20), 9)
    expect(argumentOfLatitudeDeg(-20, null, INC)).toBeCloseTo(180 - ascendingOf(-20), 9)
  })

  it('clamps latitude slightly beyond the inclination instead of returning NaN', () => {
    expect(argumentOfLatitudeDeg(51.7, 51.6, INC)).toBeCloseTo(90, 6)
  })

  it.each([[0], [-0], [1e-9]])('returns null for inclination %s', (inc) => {
    expect(argumentOfLatitudeDeg(10, null, inc)).toBeNull()
  })

  it('stays within [0, 360) across a full synthetic revolution', () => {
    let prev: number | null = null
    for (let k = 0; k < 720; k++) {
      const u0 = (k / 720) * 2 * Math.PI
      const lat = (Math.asin(Math.sin(INC * RAD) * Math.sin(u0)) * 180) / Math.PI
      const u = argumentOfLatitudeDeg(lat, prev, INC)!
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(360)
      // once a trend exists the recovered phase matches the true one
      if (prev !== null && k % 180 !== 90 && k % 180 !== 0) {
        const truth = (k / 720) * 360
        expect(u).toBeCloseTo(truth, 4)
      }
      prev = lat
    }
  })
})

describe('wrapPhaseTowards', () => {
  it.each([
    [0.99, 0.01, 0.01], // across the wrap, not backwards
    [0.01, 0.99, 0.99],
    [0.2, 0.3, 0.3],
    [0.3, 0.2, 0.2],
  ])('moves %s toward %s', (current, target, expected) => {
    expect(wrapPhaseTowards(current, target)).toBeCloseTo(expected, 12)
  })

  it('returns a phase in [0, 1)', () => {
    for (const c of [0, 0.25, 0.5, 0.75, 0.999]) {
      for (const t of [0, 0.1, 0.5, 0.9, 0.999]) {
        const r = wrapPhaseTowards(c, t)
        expect(r).toBeGreaterThanOrEqual(0)
        expect(r).toBeLessThan(1)
      }
    }
  })
})
