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
    const first = orbitalState(1_000, { x: 100, y: 0, z: 0 })
    const resumed = orbitalState(6_000, { x: 100, y: 0, z: 0 })

    interpolator.sample(first, 0, result)
    interpolator.sample(resumed, 5, result)
    interpolator.sample(resumed, 5.25, result)

    expect(result.x).toBe(100)
  })

  // ─── Discontinuous seeks (plan 001 phase F / O2) ───

  it('snaps across an antipodal seek instead of interpolating a chord through Earth', () => {
    const interpolator = new OrbitalRenderInterpolator()
    const result = new THREE.Vector3()
    // Half an orbit apart: the straight chord between these positions passes
    // through Earth's interior (the pre-fix defect measured a rendered radius
    // dipping to 2,253 km).
    const before = orbitalState(1_000, { x: 6794, y: 0, z: 0 })
    const after = orbitalState(3_100_000, { x: -6794, y: 0, z: 0 })

    interpolator.sample(before, 0, result)
    interpolator.sample(after, 0.1, result)
    // First frame after the seek: already at the new truth, not mid-chord.
    expect(result.length()).toBeCloseTo(6794, -1)
    // Well inside the (would-be) transition window the position must remain
    // on the orbit, never sweep through the interior.
    interpolator.sample(after, 3, result)
    expect(result.length()).toBeCloseTo(6794, -1)
    interpolator.sample(after, 10, result)
    expect(result.length()).toBeCloseTo(6794, -1)
  })

  it('snaps across a quarter-orbit seek and never yields a sub-Earth radius', () => {
    const interpolator = new OrbitalRenderInterpolator()
    const result = new THREE.Vector3()
    const before = orbitalState(1_000, { x: 6794, y: 0, z: 0 })
    const after = orbitalState(775_000, { x: 0, y: 0, z: 6794 })

    interpolator.sample(before, 0, result)
    // The chord midpoint sits at ~4,800 km — inside Earth. Every sampled
    // frame after the seek must stay at orbital radius instead.
    for (let frame = 0; frame <= 20; frame += 1) {
      interpolator.sample(after, 0.1 + frame * 0.016, result)
      expect(result.length()).toBeGreaterThanOrEqual(6794 - 1)
    }
  })

  it('keeps ordinary continuous interpolation smooth after a discontinuity', () => {
    const interpolator = new OrbitalRenderInterpolator()
    const result = new THREE.Vector3()
    const before = orbitalState(1_000, { x: 6794, y: 0, z: 0 })
    const seekTarget = orbitalState(500_000, { x: 0, y: 6794, z: 0 })
    const next = orbitalState(500_100, { x: 7, y: 6794, z: 0 })

    interpolator.sample(before, 0, result)
    interpolator.sample(seekTarget, 0.1, result)
    // Ordinary 10 Hz motion resumes: the new snapshot opens a fresh 50 ms
    // transition from the reseeded position, and halfway across it the
    // rendered position sits halfway along the small step.
    interpolator.sample(next, 0.15, result)
    expect(result.x).toBeCloseTo(0, 3)
    // Halfway across the observed 50 ms interval...
    interpolator.sample(next, 0.175, result)
    expect(result.x).toBeCloseTo(3.5, 3)
    // ECI (0, 6794, 0) maps to world (0, 0, -6794) — constant world Z.
    expect(result.z).toBeCloseTo(-6794, 3)
    interpolator.sample(next, 0.2, result)
    expect(result.x).toBeCloseTo(7, 3)
  })
})
