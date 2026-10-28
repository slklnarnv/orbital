import { describe, expect, it } from 'vitest'
import {
  BASE_TRUCK_SPEED,
  EARTH_ROTATION_SENSITIVITY,
  NEAR_GROUND_MIN_SCALE,
  applyNavigationSensitivity,
  getEarthRotationSensitivity,
  getNearGroundScale,
} from '@/interaction/camera/CameraSensitivity'

/** Settle the smoothed speeds for a pose (many frames). */
function settled(eyeFromCentreKm: number, pivotKm: number, pivotFromCentreKm: number) {
  const controls = { azimuthRotateSpeed: 1, polarRotateSpeed: 1, dollySpeed: 1, truckSpeed: 1 }
  for (let i = 0; i < 600; i++) applyNavigationSensitivity(controls, eyeFromCentreKm, pivotKm, pivotFromCentreKm, 1 / 60)
  return controls
}

describe('near-ground tracking (Free after an overview pan, zoomed in)', () => {
  it('leaves the overview, Follow and Inspect untouched', () => {
    expect(getNearGroundScale(18_000 - 6_371, 18_000)).toBe(1)
    expect(getNearGroundScale(686, 354)).toBe(1) // Follow: the station pivot is nearer than the ground
    expect(getNearGroundScale(430, 120)).toBe(1) // Inspect
  })

  it('slows rotate and pan so the ground tracks the cursor near 1:1', () => {
    // Measured 2026-10-28 on a production build: at 129 km over a pivot
    // 6,480 km away (497 km from Earth's centre), a drag slid the ground
    // under the view ~25 px per px for rotate and pan alike. Ground speed is
    // proportional to pivotDistance / clearance, so the scale must undo it.
    const before = 6_480 / 129
    const after = before * getNearGroundScale(129, 6_480)
    expect(after).toBeGreaterThan(1.5)
    expect(after).toBeLessThan(2.5)

    const close = settled(6_371 + 129, 6_480, 497)
    const free = settled(6_371 + 129, 6_480, 6_000) // pivot off-centre: no Earth weighting
    expect(close.truckSpeed / BASE_TRUCK_SPEED).toBeCloseTo(getNearGroundScale(129, 6_480), 3)
    expect(close.azimuthRotateSpeed).toBeLessThan(0.01)
    expect(free.truckSpeed).toBeCloseTo(close.truckSpeed, 6)
  })

  it('is continuous in the clearance and safe for degenerate input', () => {
    let previous = 0
    for (let c = 0; c <= 20_000; c += 50) {
      const s = getNearGroundScale(c, 6_500)
      expect(s).toBeGreaterThanOrEqual(previous)
      expect(s - previous).toBeLessThan(0.02)
      previous = s
    }
    expect(getNearGroundScale(0, 6_500)).toBe(NEAR_GROUND_MIN_SCALE)
    expect(getNearGroundScale(100, 0)).toBe(1)
    expect(getNearGroundScale(Number.NaN, 6_500)).toBe(1)
  })

  it('settles exactly even at the tiny near-ground speeds (relative epsilon)', () => {
    // From the overview's speeds down to near-ground ones (~1/500 of them):
    // the smoothing must still converge, not stop 0.001 short in absolute terms.
    const c = settled(6_371 + 129, 6_480, 497)
    const more = { ...c }
    for (let i = 0; i < 600; i++) applyNavigationSensitivity(more, 6_371 + 129, 6_480, 497, 1 / 60)
    expect(c.azimuthRotateSpeed).toBeLessThan(0.01)
    expect(Math.abs(more.azimuthRotateSpeed - c.azimuthRotateSpeed) / c.azimuthRotateSpeed)
      .toBeLessThan(EARTH_ROTATION_SENSITIVITY.updateEpsilon * 1.01)
    expect(Math.abs(more.truckSpeed - c.truckSpeed) / c.truckSpeed).toBeLessThan(EARTH_ROTATION_SENSITIVITY.updateEpsilon * 1.01)
  })
})

describe('getEarthRotationSensitivity', () => {

  it('clamps below and above the calibrated range', () => {
    expect(getEarthRotationSensitivity(0)).toBe(EARTH_ROTATION_SENSITIVITY.closeMultiplier)
    expect(getEarthRotationSensitivity(6_371)).toBe(EARTH_ROTATION_SENSITIVITY.closeMultiplier)
    expect(getEarthRotationSensitivity(100_000)).toBe(EARTH_ROTATION_SENSITIVITY.farMultiplier)
  })

  it('is finite and monotonic over the supported Earth camera range', () => {
    let previous = 0

    for (let distance = 6_000; distance <= 100_000; distance += 100) {
      const current = getEarthRotationSensitivity(distance)
      expect(Number.isFinite(current)).toBe(true)
      expect(current).toBeGreaterThanOrEqual(previous)
      expect(current).toBeGreaterThanOrEqual(0.05)
      expect(current).toBeLessThanOrEqual(1)
      previous = current
    }
  })

  it('stays continuous around each calibration point', () => {
    for (const distance of [6_500, 18_000, 35_000]) {
      const before = getEarthRotationSensitivity(distance - 0.001)
      const at = getEarthRotationSensitivity(distance)
      const after = getEarthRotationSensitivity(distance + 0.001)

      expect(Math.abs(at - before)).toBeLessThan(0.000_001)
      expect(Math.abs(after - at)).toBeLessThan(0.000_001)
    }
  })

  it('reduces an equal close-view drag below ten percent of overview rotation', () => {
    const closeMultiplier = getEarthRotationSensitivity(6_500)
    const overviewMultiplier = getEarthRotationSensitivity(18_000)

    // camera-controls' pointer-to-angle formula is linear in this multiplier,
    // so the multiplier ratio is also the angular-displacement ratio.
    expect(closeMultiplier / overviewMultiplier).toBeLessThan(0.1)
  })

  it('returns safe finite values for invalid and infinite inputs', () => {
    expect(getEarthRotationSensitivity(Number.NaN)).toBe(1)
    expect(getEarthRotationSensitivity(Infinity)).toBe(1)
    expect(getEarthRotationSensitivity(-Infinity)).toBe(0.05)
  })
})

