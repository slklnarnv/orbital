import { describe, expect, it } from 'vitest'
import {
  applyRotationSensitivity,
  EARTH_ROTATION_SENSITIVITY,
  getEarthRotationSensitivity,
} from '@/interaction/camera/CameraSensitivity'

describe('getEarthRotationSensitivity', () => {
  it('matches the three calibrated camera distances', () => {
    expect(getEarthRotationSensitivity(6_500)).toBeCloseTo(0.05, 8)
    expect(getEarthRotationSensitivity(18_000)).toBeCloseTo(0.6, 8)
    expect(getEarthRotationSensitivity(35_000)).toBeCloseTo(1, 8)
  })

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

describe('applyRotationSensitivity', () => {
  it('updates both axes for Earth-focused modes', () => {
    const controls = { azimuthRotateSpeed: 1, polarRotateSpeed: 1 }

    expect(applyRotationSensitivity(controls, 'ORBITAL', 6_500)).toBe(true)
    expect(controls).toEqual({ azimuthRotateSpeed: 0.05, polarRotateSpeed: 0.05 })
  })

  it('restores default rotation speed for ISS-focused modes', () => {
    const controls = { azimuthRotateSpeed: 0.05, polarRotateSpeed: 0.05 }

    expect(applyRotationSensitivity(controls, 'FOLLOW', 6_500)).toBe(true)
    expect(controls).toEqual({ azimuthRotateSpeed: 1, polarRotateSpeed: 1 })
  })

  it('avoids writes when both axes are already within epsilon', () => {
    const controls = { azimuthRotateSpeed: 0.6005, polarRotateSpeed: 0.5995 }

    expect(applyRotationSensitivity(controls, 'PLANETARY', 18_000)).toBe(false)
    expect(controls).toEqual({ azimuthRotateSpeed: 0.6005, polarRotateSpeed: 0.5995 })
  })
})
