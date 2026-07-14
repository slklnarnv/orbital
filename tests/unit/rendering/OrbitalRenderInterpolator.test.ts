import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { OrbitalRenderInterpolator } from '@/rendering/iss/OrbitalRenderInterpolator'
import type { OrbitalState } from '@/types/orbital'

function orbitalState(
  timestamp: number,
  positionECI: OrbitalState['positionECI'],
): OrbitalState {
  return {
    entityId: 'iss',
    timestamp,
    positionECI,
    velocityECI: { x: 0, y: 0, z: 0 },
    latitude: 0,
    longitude: 0,
    altitude: 400,
    speed: 0,
    orbitalPeriod: 90,
    inclination: 51.6,
    source: 'live',
    tleAgeHours: 0,
    confidence: 1,
  }
}

describe('OrbitalRenderInterpolator', () => {
  it('maps the first TEME snapshot directly into Three.js world space', () => {
    const interpolator = new OrbitalRenderInterpolator()
    const result = new THREE.Vector3()

    interpolator.sample(orbitalState(1_000, { x: 10, y: 20, z: 30 }), 5, result)

    expect(result.toArray()).toEqual([10, 30, -20])
  })

  it('moves continuously between 10 Hz snapshots', () => {
    const interpolator = new OrbitalRenderInterpolator()
    const result = new THREE.Vector3()
    const first = orbitalState(1_000, { x: 0, y: 0, z: 0 })
    const second = orbitalState(1_100, { x: 10, y: 20, z: 30 })

    interpolator.sample(first, 1, result)
    interpolator.sample(second, 1.1, result)
    expect(result.length()).toBe(0)

    interpolator.sample(second, 1.15, result)
    expect(result.x).toBeCloseTo(5)
    expect(result.y).toBeCloseTo(15)
    expect(result.z).toBeCloseTo(-10)

    interpolator.sample(second, 1.2, result)
    expect(result.x).toBeCloseTo(10)
    expect(result.y).toBeCloseTo(30)
    expect(result.z).toBeCloseTo(-20)
  })

  it('continues from the rendered position when a new sample arrives early', () => {
    const interpolator = new OrbitalRenderInterpolator()
    const result = new THREE.Vector3()
    const first = orbitalState(1_000, { x: 0, y: 0, z: 0 })
    const second = orbitalState(1_100, { x: 10, y: 0, z: 0 })
    const third = orbitalState(1_200, { x: 20, y: 0, z: 0 })

    interpolator.sample(first, 0, result)
    interpolator.sample(second, 0.1, result)
    interpolator.sample(second, 0.15, result)
    expect(result.x).toBeCloseTo(5)

    interpolator.sample(third, 0.18, result)
    expect(result.x).toBeCloseTo(8)
  })

  it('caps smoothing after a suspended frame loop', () => {
    const interpolator = new OrbitalRenderInterpolator()
    const result = new THREE.Vector3()
    const first = orbitalState(1_000, { x: 0, y: 0, z: 0 })
    const resumed = orbitalState(6_000, { x: 100, y: 0, z: 0 })

    interpolator.sample(first, 0, result)
    interpolator.sample(resumed, 5, result)
    interpolator.sample(resumed, 5.25, result)

    expect(result.x).toBe(100)
  })
})
