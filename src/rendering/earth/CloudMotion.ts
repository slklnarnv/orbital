const TWO_PI = Math.PI * 2
const CLOUD_ANGULAR_SPEED_RAD_S = 0.0002
const CLOUD_ROTATION_PERIOD_S = TWO_PI / CLOUD_ANGULAR_SPEED_RAD_S

/** Deterministic cloud-deck rotation derived from absolute simulation time. */
export function cloudRotationAtEpoch(epochMs: number): number {
  const secondsWithinRotation = (epochMs / 1000) % CLOUD_ROTATION_PERIOD_S
  return secondsWithinRotation * CLOUD_ANGULAR_SPEED_RAD_S
}
