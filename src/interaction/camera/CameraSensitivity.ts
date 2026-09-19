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

export interface NavigationSpeedControls {
  azimuthRotateSpeed: number
  polarRotateSpeed: number
  dollySpeed: number
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

/** Input response follows the pivot geometry, not a discontinuous mode label. */
export function applyNavigationSensitivity(
  controls: NavigationSpeedControls,
  distanceToEarthCenterKm: number,
  distanceToTargetKm: number,
  targetDistanceToEarthKm: number,
  deltaSeconds: number,
): void {
  const earthWeight = 1 - smoothstep01(targetDistanceToEarthKm / EARTH_RADIUS_KM)
  const localScale = smoothstep01((distanceToTargetKm - 60) / (3000 - 60))
  const localRotation = 0.35 + 0.65 * localScale
  const rotation = localRotation + (getEarthRotationSensitivity(distanceToEarthCenterKm) - localRotation) * earthWeight
  const earthDolly = 0.08 + 0.92 * smoothstep01((distanceToEarthCenterKm - 6500) / 4000)
  const localDolly = 0.45 + 0.55 * localScale
  const dolly = localDolly + (earthDolly - localDolly) * earthWeight
  const blend = 1 - Math.exp(-12 * Math.max(0, deltaSeconds))
  const epsilon = EARTH_ROTATION_SENSITIVITY.updateEpsilon

  if (Math.abs(controls.azimuthRotateSpeed - rotation) > epsilon) {
    controls.azimuthRotateSpeed += (rotation - controls.azimuthRotateSpeed) * blend
  }
  if (Math.abs(controls.polarRotateSpeed - rotation) > epsilon) {
    controls.polarRotateSpeed += (rotation - controls.polarRotateSpeed) * blend
  }
  if (Math.abs(controls.dollySpeed - dolly) > epsilon) {
    controls.dollySpeed += (dolly - controls.dollySpeed) * blend
  }
}
