import { describe, expect, it } from 'vitest'
import * as satellite from 'satellite.js'
import {
  MAX_ORBIT_POINTS,
  generateOrbitPath,
  type OrbitPathPoint,
} from '@/core/orbital/OrbitPredictor'
import type { OrbitalEngine } from '@/core/orbital/OrbitalEngine'
import fallbackTLE from '@/data/fallback-tle.json'

const satrec = satellite.twoline2satrec(fallbackTLE.line1, fallbackTLE.line2)
const epochMs = Date.parse(fallbackTLE.epoch)
const periodMinutes = (2 * Math.PI) / satrec.no

/** The predictor only calls `periodMinutes` and `propagateAt`. */
const engine = {
  periodMinutes,
  propagateAt: (ms: number) => {
    const p = satellite.propagate(satrec, new Date(ms)).position
    return p && typeof p !== 'boolean' ? p : null
  },
} as unknown as OrbitalEngine

function distance(a: OrbitPathPoint, b: OrbitPathPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe('generateOrbitPath', () => {
  it('spans exactly one live period, so the ring closes', () => {
    const path = generateOrbitPath(engine, epochMs)

    // First and last samples are one full period apart, which is the whole
    // point: a nominal 92.68 min constant against a 92.98 min element set
    // left a 214 km gap at the station's antipode. Compared with an absolute
    // tolerance because epoch milliseconds are ~1.7e12 and the difference of
    // two such doubles carries sub-millisecond rounding.
    const spanMs = path[path.length - 1].epochMs - path[0].epochMs
    expect(Math.abs(spanMs - periodMinutes * 60_000)).toBeLessThan(1)

    // The residual is SGP4's own non-closure, not a sampling shortfall.
    // Measured at ~31 km for this element set; 60 km leaves headroom for a
    // reboost without masking a truncated span (which was 214 km).
    expect(distance(path[0], path[path.length - 1])).toBeLessThan(60)
  })

  it('keeps the sampling step near 30 s', () => {
    const path = generateOrbitPath(engine, epochMs)
    const stepMs = path[1].epochMs - path[0].epochMs
    expect(stepMs).toBeGreaterThan(25_000)
    expect(stepMs).toBeLessThan(35_000)
  })

  it('never exceeds the fat-line buffer budget', () => {
    // A much slower orbit must clamp rather than overflow the fixed-size
    // instance buffers in OrbitLine.
    const path = generateOrbitPath(engine, epochMs, 400)
    expect(path.length).toBeLessThanOrEqual(MAX_ORBIT_POINTS)
  })

  it('fades monotonically from the trailing to the leading edge', () => {
    const path = generateOrbitPath(engine, epochMs)
    expect(path[0].alpha).toBe(0)
    expect(path[path.length - 1].alpha).toBeCloseTo(1, 6)
    for (let i = 1; i < path.length; i++) {
      expect(path[i].alpha).toBeGreaterThan(path[i - 1].alpha)
    }
  })

  it('is centred on the requested epoch', () => {
    const path = generateOrbitPath(engine, epochMs)
    const centre = path[Math.round((path.length - 1) / 2)]
    expect(Math.abs(centre.epochMs - epochMs)).toBeLessThan(40_000)
  })
})
