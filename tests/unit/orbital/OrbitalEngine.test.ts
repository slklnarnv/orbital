import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as satellite from 'satellite.js'
import fallback from '@/data/fallback-tle.json'
import { OrbitalEngine } from '@/core/orbital/OrbitalEngine'
import { buildSimulationTime } from '@/core/clock/SimulationTime'
import type { TLEData } from '@/types/orbital'

const EPOCH_MS = Date.parse(fallback.epoch)
const HOUR_MS = 3_600_000

const makeTle = (source: TLEData['source'] = 'fallback'): TLEData => ({
  line1: fallback.line1,
  line2: fallback.line2,
  fetchedAt: EPOCH_MS,
  source,
})

const mag = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z)

describe('OrbitalEngine', () => {
  let engine: OrbitalEngine
  const tle = makeTle()

  beforeEach(() => {
    engine = new OrbitalEngine('iss')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('loads the packaged TLE', () => {
    expect(engine.hasTLE()).toBe(false)
    expect(engine.loadTLE(tle)).toBe(true)
    expect(engine.hasTLE()).toBe(true)
    expect(engine.currentTLE).toBe(tle)
  })

  it('matches raw satellite.js position and velocity at the TLE epoch', () => {
    engine.loadTLE(tle)
    const state = engine.propagate(buildSimulationTime(EPOCH_MS, 100, 100))
    expect(state).not.toBeNull()
    const raw = satellite.propagate(
      satellite.twoline2satrec(fallback.line1, fallback.line2),
      new Date(EPOCH_MS),
    )
    const p = raw.position as { x: number; y: number; z: number }
    const v = raw.velocity as { x: number; y: number; z: number }
    for (const k of ['x', 'y', 'z'] as const) {
      expect(Math.abs(state!.positionECI[k] - p[k])).toBeLessThan(1e-9)
      expect(Math.abs(state!.velocityECI[k] - v[k])).toBeLessThan(1e-9)
    }
    expect(Math.abs(state!.speed - mag(v))).toBeLessThan(1e-9)
  })

  it('reports physically sensible ISS telemetry', () => {
    engine.loadTLE(tle)
    const state = engine.propagate(buildSimulationTime(EPOCH_MS, 100, 100))!
    expect(state.entityId).toBe('iss')
    expect(state.timestamp).toBe(EPOCH_MS)
    expect(state.altitude).toBeGreaterThanOrEqual(380)
    expect(state.altitude).toBeLessThanOrEqual(450)
    expect(Math.abs(state.latitude)).toBeLessThanOrEqual(state.inclination + 0.1)
    expect(Math.abs(state.inclination - 51.6)).toBeLessThanOrEqual(0.2)
    expect(state.orbitalPeriod).toBe(engine.periodMinutes)
    expect(state.orbitalPeriod).toBeGreaterThanOrEqual(91)
    expect(state.orbitalPeriod).toBeLessThanOrEqual(94)
  })

  it('computes TLE age from the element epoch', () => {
    engine.loadTLE(tle)
    const atEpoch = engine.propagate(buildSimulationTime(EPOCH_MS, 100, 100))!
    const dayLater = engine.propagate(
      buildSimulationTime(EPOCH_MS + 24 * HOUR_MS, 100, 100),
    )!
    expect(atEpoch.tleAgeHours).toBeCloseTo(0, 1)
    expect(dayLater.tleAgeHours).toBeCloseTo(24, 1)
  })

  it.each([
    ['fallback', 'propagated'],
    ['celestrak', 'live'],
    ['cached', 'cached'],
  ] as const)('maps TLE source %s to state source %s', (tleSource, stateSource) => {
    engine.loadTLE(makeTle(tleSource))
    const state = engine.propagate(buildSimulationTime(EPOCH_MS, 100, 100))
    expect(state!.source).toBe(stateSource)
  })

  it('handles a corrupted line 2 without throwing', () => {
    const bad: TLEData = {
      ...tle,
      line2: fallback.line2.slice(0, 52) + 'XXXXXXXXXXX' + fallback.line2.slice(63),
    }
    let loaded: boolean | undefined
    expect(() => {
      loaded = engine.loadTLE(bad)
    }).not.toThrow()
    if (loaded) {
      expect(() => engine.propagate(buildSimulationTime(EPOCH_MS, 100, 100))).not.toThrow()
    } else {
      expect(engine.hasTLE()).toBe(false)
      expect(engine.propagate(buildSimulationTime(EPOCH_MS, 100, 100))).toBeNull()
    }
  })

  it('returns null everywhere once the TLE is cleared', () => {
    engine.loadTLE(tle)
    engine.clearTLE()
    expect(engine.hasTLE()).toBe(false)
    expect(engine.currentTLE).toBeNull()
    expect(engine.propagate(buildSimulationTime(EPOCH_MS, 100, 100))).toBeNull()
    expect(engine.propagateAt(EPOCH_MS)).toBeNull()
    expect(engine.periodMinutes).toBeNull()
  })

  it('returns null before any TLE is loaded', () => {
    expect(engine.propagate(buildSimulationTime(EPOCH_MS, 100, 100))).toBeNull()
    expect(engine.propagateAt(EPOCH_MS)).toBeNull()
    expect(engine.periodMinutes).toBeNull()
  })

  it('propagateAt agrees with propagate().positionECI', () => {
    engine.loadTLE(tle)
    const t = EPOCH_MS + 37 * 60_000
    const viaState = engine.propagate(buildSimulationTime(t, 100, 100))!.positionECI
    expect(engine.propagateAt(t)).toEqual(viaState)
  })
})
