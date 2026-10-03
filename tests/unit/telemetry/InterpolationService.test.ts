import { describe, expect, it } from 'vitest'
import { InterpolationService } from '@/core/telemetry/InterpolationService'
import type { OrbitalState } from '@/types/orbital'

function state(overrides: Partial<OrbitalState> = {}): OrbitalState {
  return {
    entityId: 'iss',
    timestamp: 0,
    positionECI: { x: 6000, y: 0, z: 0 },
    velocityECI: { x: 0, y: 7.66, z: 0 },
    latitude: 10,
    longitude: 20,
    altitude: 420,
    speed: 7.66,
    orbitalPeriod: 92.9,
    inclination: 51.6,
    source: 'live',
    tleAgeHours: 1,
    confidence: 1,
    ...overrides,
  }
}

describe('InterpolationService', () => {
  it('passes states through untouched when no TLE swap is pending', () => {
    const service = new InterpolationService()
    const next = state()
    expect(service.smooth(next, 16)).toBe(next)
  })

  it('starts HUD scalars at the old-TLE values and converges on the new ones', () => {
    const service = new InterpolationService()
    service.onTLEUpdate(state({ latitude: 12, altitude: 425, speed: 7.70 }))
    const next = state()

    const first = service.smooth(next, 0)
    expect(first.latitude).toBeCloseTo(12)
    expect(first.altitude).toBeCloseTo(425)
    expect(first.speed).toBeCloseTo(7.70)

    const mid = service.smooth(next, 1000)
    expect(mid.latitude).toBeGreaterThan(10)
    expect(mid.latitude).toBeLessThan(12)

    const done = service.smooth(next, 1000)
    expect(done).toBe(next)
  })

  it('blends longitude the short way across the antimeridian', () => {
    const service = new InterpolationService()
    service.onTLEUpdate(state({ longitude: 179 }))
    const next = state({ longitude: -179 })

    expect(service.smooth(next, 0).longitude).toBeCloseTo(179)
    const mid = service.smooth(next, 1000).longitude
    // Midpoint sits at ±180, never swings back through 0.
    expect(Math.abs(mid)).toBeGreaterThan(178)
  })

  it('tracks the moving new state instead of lagging a frozen origin', () => {
    const service = new InterpolationService()
    service.onTLEUpdate(state({ positionECI: { x: 6010, y: 0, z: 0 } }))
    service.smooth(state(), 0)
    const moved = service.smooth(state({ positionECI: { x: 6000, y: 500, z: 0 } }), 1000)
    expect(moved.positionECI.y).toBeCloseTo(500)
    expect(moved.positionECI.x).toBeGreaterThan(6000)
    expect(moved.positionECI.x).toBeLessThan(6010)
  })
})
