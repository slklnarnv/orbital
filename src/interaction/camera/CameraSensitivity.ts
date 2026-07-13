import type { CameraMode } from '@/types/camera'
import { EARTH_RADIUS_KM } from '@/utils/constants'

export const EARTH_ROTATION_SENSITIVITY = {
  closeCenterDistanceKm: 6_500,
  overviewCenterDistanceKm: 18_000,
  farCenterDistanceKm: 35_000,
  closeMultiplier: 0.05,
  overviewMultiplier: 0.6,
  farMultiplier: 1.0,
  updateEpsilon: 0.001,
} as const

export interface RotationSpeedControls {
  azimuthRotateSpeed: number
  polarRotateSpeed: number
}

function smoothstep01(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

function interpolateSmooth(
  value: number,
  lowerValue: number,
  upperValue: number,
  lowerOutput: number,
  upperOutput: number,
): number {
  const range = upperValue - lowerValue
  if (range <= 0) return upperOutput

  const progress = smoothstep01((value - lowerValue) / range)
  return lowerOutput + (upperOutput - lowerOutput) * progress
}

/**
 * Maps Earth surface clearance to a bounded rotation multiplier.
 *
 * camera-controls maps pointer pixels to a fixed angular rotation. Scaling that
 * angle by clearance keeps close surface navigation precise while preserving the
 * existing far-view response. The piecewise smoothstep curve is continuous at the
 * overview calibration point and clamps outside the supported camera range.
 */
export function getEarthRotationSensitivity(distanceToEarthCenterKm: number): number {
  if (Number.isNaN(distanceToEarthCenterKm)) {
    return EARTH_ROTATION_SENSITIVITY.farMultiplier
  }

  if (distanceToEarthCenterKm === Infinity) {
    return EARTH_ROTATION_SENSITIVITY.farMultiplier
  }

  if (distanceToEarthCenterKm === -Infinity) {
    return EARTH_ROTATION_SENSITIVITY.closeMultiplier
  }

  const surfaceClearanceKm = Math.max(0, distanceToEarthCenterKm - EARTH_RADIUS_KM)
  const closeClearanceKm = EARTH_ROTATION_SENSITIVITY.closeCenterDistanceKm - EARTH_RADIUS_KM
  const overviewClearanceKm = EARTH_ROTATION_SENSITIVITY.overviewCenterDistanceKm - EARTH_RADIUS_KM
  const farClearanceKm = EARTH_ROTATION_SENSITIVITY.farCenterDistanceKm - EARTH_RADIUS_KM

  if (surfaceClearanceKm <= closeClearanceKm) {
    return EARTH_ROTATION_SENSITIVITY.closeMultiplier
  }

  if (surfaceClearanceKm < overviewClearanceKm) {
    return interpolateSmooth(
      surfaceClearanceKm,
      closeClearanceKm,
      overviewClearanceKm,
      EARTH_ROTATION_SENSITIVITY.closeMultiplier,
      EARTH_ROTATION_SENSITIVITY.overviewMultiplier,
    )
  }

  if (surfaceClearanceKm < farClearanceKm) {
    return interpolateSmooth(
      surfaceClearanceKm,
      overviewClearanceKm,
      farClearanceKm,
      EARTH_ROTATION_SENSITIVITY.overviewMultiplier,
      EARTH_ROTATION_SENSITIVITY.farMultiplier,
    )
  }

  return EARTH_ROTATION_SENSITIVITY.farMultiplier
}

export function isEarthFocusedMode(mode: CameraMode): boolean {
  return mode === 'PLANETARY' || mode === 'ORBITAL'
}

/**
 * Applies transient input configuration directly to camera-controls.
 * Returns true only when a property write was required.
 */
export function applyRotationSensitivity(
  controls: RotationSpeedControls,
  mode: CameraMode,
  distanceToEarthCenterKm: number,
): boolean {
  const target = isEarthFocusedMode(mode)
    ? getEarthRotationSensitivity(distanceToEarthCenterKm)
    : EARTH_ROTATION_SENSITIVITY.farMultiplier

  if (
    Math.abs(controls.azimuthRotateSpeed - target) <= EARTH_ROTATION_SENSITIVITY.updateEpsilon
    && Math.abs(controls.polarRotateSpeed - target) <= EARTH_ROTATION_SENSITIVITY.updateEpsilon
  ) {
    return false
  }

  controls.azimuthRotateSpeed = target
  controls.polarRotateSpeed = target
  return true
}
