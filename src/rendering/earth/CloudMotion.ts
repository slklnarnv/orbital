const TWO_PI = Math.PI * 2
const SECONDS_PER_DAY = 24 * 60 * 60

// A single cloud composite should drift slowly relative to the rotating terrain.
// The previous 8.73-hour revolution made the whole weather system read as a second,
// colliding globe. Five days keeps motion visible without looking mechanically fast.
export const CLOUD_ROTATION_PERIOD_S = 5 * SECONDS_PER_DAY
const CLOUD_ANGULAR_SPEED_RAD_S = TWO_PI / CLOUD_ROTATION_PERIOD_S

/** Deterministic cloud-deck rotation derived from absolute simulation time. */
export function cloudRotationAtEpoch(epochMs: number): number {
  const secondsWithinRotation = (epochMs / 1000) % CLOUD_ROTATION_PERIOD_S
  return secondsWithinRotation * CLOUD_ANGULAR_SPEED_RAD_S
}
