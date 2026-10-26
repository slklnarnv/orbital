import { describe, expect, it } from 'vitest'
import * as satellite from 'satellite.js'
import { arcPhaseOrigin, orbitPhase } from '@/core/orbital/OrbitPhase'
import { generateOrbitPath, type OrbitPathPoint } from '@/core/orbital/OrbitPredictor'
import type { OrbitalEngine } from '@/core/orbital/OrbitalEngine'
import fallbackTLE from '@/data/fallback-tle.json'

const satrec = satellite.twoline2satrec(fallbackTLE.line1, fallbackTLE.line2)
const epochMs = Date.parse(fallbackTLE.epoch)
const periodMinutes = (2 * Math.PI) / satrec.no
const periodMs = periodMinutes * 60_000

/** The predictor only calls `periodMinutes` and `propagateAt`. */
const engine = {
  periodMinutes,
  propagateAt: (ms: number) => {
    const p = satellite.propagate(satrec, new Date(ms)).position
    return p && typeof p !== 'boolean' ? p : null
  },
} as unknown as OrbitalEngine

/** Finest dash level in orbitDash.glsl: 2^17 dashes per revolution. */
const FINEST_LEVEL = 17

/** Fraction of a dash pitch at `level`, from the float32 value the GPU sees. */
function dashFraction(phase: number, level: number): number {
  const scaled = Math.fround(phase) * 2 ** level
  return scaled - Math.floor(scaled)
}

/** Circular distance between two fractions of a pitch. */
function fractionGap(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, 1 - d)
}

/** Phase at `epoch` on an arc, interpolated the way the GPU does. */
function phaseOnArc(path: OrbitPathPoint[], epoch: number): number {
  const k = path.findIndex((p, i) => i > 0 && p.epochMs >= epoch)
  const a = path[k - 1]
  const b = path[k]
  const t = (epoch - a.epochMs) / (b.epochMs - a.epochMs)
  return Math.fround(a.phase) + t * (Math.fround(b.phase) - Math.fround(a.phase))
}

describe('orbitPhase', () => {
  it('advances by exactly one revolution per period', () => {
    expect(orbitPhase(epochMs + periodMs, periodMs) - orbitPhase(epochMs, periodMs)).toBeCloseTo(1, 9)
  })

  it('takes a whole-revolution origin, so no dash moves', () => {
    const origin = arcPhaseOrigin(epochMs, periodMs)
    expect(Number.isInteger(origin)).toBe(true)
    const relative = orbitPhase(epochMs, periodMs) - origin
    expect(relative).toBeGreaterThanOrEqual(0)
    expect(relative).toBeLessThan(1)
  })
})

describe('arc phases from generateOrbitPath', () => {
  it('rise by exactly one revolution across the arc and stay in float32 range', () => {
    const path = generateOrbitPath(engine, epochMs)
    expect(path[0].phase).toBeGreaterThanOrEqual(0)
    expect(path[0].phase).toBeLessThan(1)
    expect(path[path.length - 1].phase - path[0].phase).toBeCloseTo(1, 9)
    for (let k = 1; k < path.length; k++) expect(path[k].phase).toBeGreaterThan(path[k - 1].phase)
  })

  it('label a point on the ring the same in every arc (no crawl at any rate or seek)', () => {
    // The old dash slid ~1.8 pitches per refresh at 1x because it was keyed
    // to the arc's moving trailing edge. Regenerate the arc as 1x (+60 s),
    // 300x (+75 s per wall-floor refresh), a scrub and a backward seek would,
    // and compare the phase each arc gives the same epochs — off the sample
    // grid, where the GPU interpolates.
    const reference = generateOrbitPath(engine, epochMs)
    const shifts = [60_000, 75_000, 4 * 75_000, 17_321, -70_000, -periodMs / 5]
    for (const shift of shifts) {
      const arc = generateOrbitPath(engine, epochMs + shift)
      const lo = Math.max(reference[0].epochMs, arc[0].epochMs) + 1
      const hi = Math.min(reference[reference.length - 1].epochMs, arc[arc.length - 1].epochMs) - 1
      for (let i = 0; i <= 40; i++) {
        const epoch = lo + ((hi - lo) * i) / 40
        const gap = fractionGap(
          dashFraction(phaseOnArc(reference, epoch), FINEST_LEVEL),
          dashFraction(phaseOnArc(arc, epoch), FINEST_LEVEL),
        )
        // Even at the finest level the two arcs agree to a few percent of a
        // dash pitch (float32 rounding); a crawl would be a sizeable fraction.
        expect(gap).toBeLessThan(0.05)
      }
    }
  })

  it('needs no state: the same epoch gives the same phases', () => {
    const a = generateOrbitPath(engine, epochMs + 123_456)
    const b = generateOrbitPath(engine, epochMs + 123_456)
    expect(a.map((p) => p.phase)).toEqual(b.map((p) => p.phase))
  })
})
