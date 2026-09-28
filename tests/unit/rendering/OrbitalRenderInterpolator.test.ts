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

  // ─── Time-control strides (300× preset) ───
  // At 300× accelerated time the 10 Hz snapshot stride is ~30 s of orbital
  // motion ≈ 230 km — genuine continuous motion that must stay INTERPOLATED.
  // The pre-time-control bound (50 km) reseeded every such snapshot, stepping
  // the station at 10 Hz. Deliberate jumps (the ±1 min seek nudge ≈ 460 km)
  // must still snap.

  it('interpolates a 300× snapshot stride (~230 km) instead of reseeding', () => {
    const interpolator = new OrbitalRenderInterpolator()
    const result = new THREE.Vector3()
    // Along-track positions one 30 s stride apart on the r = 6794 km orbit:
    // theta = 230/6794 ≈ 0.03385 rad → (6790.11, 229.97, 0).
    const theta = 230 / 6794
    const before = { ...orbitalState(1_000, { x: 6794, y: 0, z: 0 }), speed: 7.66 }
    const after = {
      ...orbitalState(31_000, {
        x: 6794 * Math.cos(theta),
        y: 6794 * Math.sin(theta),
        z: 0,
      }),
      speed: 7.66,
    }

    interpolator.sample(before, 0, result)
    interpolator.sample(after, 0.1, result)
    // Halfway across the observed 100 ms transition the render sits halfway
    // along the stride — proof of interpolation, not a reseed snap. (ECI y
    // maps to world −z.)
    interpolator.sample(after, 0.15, result)
    expect(result.z).toBeCloseTo((-6794 * Math.sin(theta)) / 2, 0)
    interpolator.sample(after, 0.2, result)
    expect(result.z).toBeCloseTo(-6794 * Math.sin(theta), 0)
  })

  it('stays interpolated across SUSTAINED accelerated strides (no anchor drift)', () => {
    const interpolator = new OrbitalRenderInterpolator()
    const result = new THREE.Vector3()
    // Five consecutive 300× strides. The discontinuity anchor must advance
    // with each accepted snapshot: an anchor frozen at the last reseed
    // measures the accumulated arc (2 strides = 460 km > 400 km bound) and
    // reseeds every second snapshot — the hold-then-teleport Follow-mode
    // stutter. Collinear km positions keep the arithmetic transparent.
    const strideKm = 230
    const timestamps = [1_000, 31_000, 61_000, 91_000, 121_000]

    interpolator.sample({ ...orbitalState(timestamps[0], { x: 0, y: 0, z: 0 }), speed: 7.66 }, 0, result)
    for (let k = 1; k < timestamps.length; k += 1) {
      const snapshot = {
        ...orbitalState(timestamps[k], { x: k * strideKm, y: 0, z: 0 }),
        speed: 7.66,
      }
      const arrival = 0.1 * k
      interpolator.sample(snapshot, arrival, result)
      // At arrival the previous transition has completed: exactly on stride k−1.
      expect(result.x).toBeCloseTo((k - 1) * strideKm, 0)
      // Halfway into the new transition: halfway along stride k — a reseed
      // here would hold the render at k × strideKm instead.
      interpolator.sample(snapshot, arrival + 0.05, result)
      expect(result.x).toBeCloseTo((k - 1) * strideKm + strideKm / 2, 0)
    }
  })

  it('still snaps a ±1 min seek nudge (~460 km jump)', () => {
    const interpolator = new OrbitalRenderInterpolator()
    const result = new THREE.Vector3()
    // The smallest seek the transport offers: 60 s of orbital motion.
    const theta = 460 / 6794
    const before = { ...orbitalState(1_000, { x: 6794, y: 0, z: 0 }), speed: 7.66 }
    const after = {
      ...orbitalState(61_000, {
        x: 6794 * Math.cos(theta),
        y: 6794 * Math.sin(theta),
        z: 0,
      }),
      speed: 7.66,
    }

    interpolator.sample(before, 0, result)
    interpolator.sample(after, 0.1, result)
    // First frame after the nudge is already at the new truth — a seek is a
    // snap, never a fast-forward slide. (ECI y maps to world −z.)
    expect(result.z).toBeCloseTo(-6794 * Math.sin(theta), -1)
    interpolator.sample(after, 0.15, result)
    expect(result.z).toBeCloseTo(-6794 * Math.sin(theta), -1)
  })
})
