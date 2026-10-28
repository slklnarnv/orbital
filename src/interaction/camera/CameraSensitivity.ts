import { EARTH_RADIUS_KM } from '@/utils/constants'
import { ISS_MODEL_CLEARANCE_KM } from '@/interaction/camera/CameraStateMachine'

export const EARTH_ROTATION_SENSITIVITY = {
  closeCenterDistanceKm: 6_500,
  overviewCenterDistanceKm: 18_000,
  farCenterDistanceKm: 35_000,
  closeMultiplier: 0.05,
  overviewMultiplier: 0.6,
  farMultiplier: 1.0,
  /** Relative: speeds near the ground are a few thousandths. */
  updateEpsilon: 0.001,
} as const

/**
 * Near-ground tracking. With the pivot far beyond the ground in view (a pan
 * from the overview leaves it near Earth's centre, then the wheel brings the
 * eye down to the surface), a drag moves the pivot by the cursor's angle but
 * the ground under the view by pivotDistance / clearance times that: at 130 km
 * up it slid ~25 screen pixels per pixel of drag (rotate and pan alike).
 * Rotation and pan scale by NEAR_GROUND_TRACKING × clearance / pivotDistance,
 * capped at 1, so the ground follows the cursor about 1:1 up close. At the
 * overview (11,600 km over a pivot 18,000 km away) and whenever the pivot is
 * nearer than the ground (Follow, Inspect) the factor is 1: unchanged.
 */
export const NEAR_GROUND_TRACKING = 2
export const NEAR_GROUND_MIN_SCALE = 0.005

export function getNearGroundScale(clearanceKm: number, pivotDistanceKm: number): number {
  if (!(pivotDistanceKm > 0) || !Number.isFinite(clearanceKm)) return 1
  const scale = (NEAR_GROUND_TRACKING * Math.max(0, clearanceKm)) / pivotDistanceKm
  return Math.min(1, Math.max(NEAR_GROUND_MIN_SCALE, scale))
}

/** camera-controls' pan (truck) speed before near-ground scaling. */
export const BASE_TRUCK_SPEED = 1

export interface NavigationSpeedControls {
  azimuthRotateSpeed: number
  polarRotateSpeed: number
  dollySpeed: number
  truckSpeed: number
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
  // The close-range floor follows the ISS model-clearance envelope, so the
  // rotation scale's domain starts exactly where the camera is allowed to be.
  const localScale = smoothstep01(
    (distanceToTargetKm - ISS_MODEL_CLEARANCE_KM) / (3000 - ISS_MODEL_CLEARANCE_KM),
  )
  const localRotation = 0.35 + 0.65 * localScale
  const nearGround = getNearGroundScale(distanceToEarthCenterKm - EARTH_RADIUS_KM, distanceToTargetKm)
  const rotation = (localRotation + (getEarthRotationSensitivity(distanceToEarthCenterKm) - localRotation) * earthWeight) * nearGround
  const truck = BASE_TRUCK_SPEED * nearGround
  const earthDolly = 0.08 + 0.92 * smoothstep01((distanceToEarthCenterKm - 6500) / 4000)
  const localDolly = 0.45 + 0.55 * localScale
  const dolly = localDolly + (earthDolly - localDolly) * earthWeight
  const blend = 1 - Math.exp(-12 * Math.max(0, deltaSeconds))
  const settle = (current: number, goal: number) =>
    Math.abs(current - goal) > EARTH_ROTATION_SENSITIVITY.updateEpsilon * goal
      ? current + (goal - current) * blend
      : current

  controls.azimuthRotateSpeed = settle(controls.azimuthRotateSpeed, rotation)
  controls.polarRotateSpeed = settle(controls.polarRotateSpeed, rotation)
  controls.dollySpeed = settle(controls.dollySpeed, dolly)
  controls.truckSpeed = settle(controls.truckSpeed, truck)
}
