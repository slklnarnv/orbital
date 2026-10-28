const TWO_PI = Math.PI * 2
const SECONDS_PER_DAY = 24 * 60 * 60

// A single cloud composite should drift slowly relative to the rotating terrain.
// The previous 8.73-hour revolution made the whole weather system read as a second,
// colliding globe. Five days keeps motion visible without looking mechanically fast.
export const CLOUD_ROTATION_PERIOD_S = 5 * SECONDS_PER_DAY
const CLOUD_ANGULAR_SPEED_RAD_S = TWO_PI / CLOUD_ROTATION_PERIOD_S

/** The composite's deck rotation, derived from absolute simulation time. */
export function cloudRotationAtEpoch(epochMs: number): number {
  const secondsWithinRotation = (epochMs / 1000) % CLOUD_ROTATION_PERIOD_S
  return secondsWithinRotation * CLOUD_ANGULAR_SPEED_RAD_S
}

/**
 * Live clouds' rotation: none at the present, where they are what the
 * satellites saw, then the composite's mean eastward rate as the simulation
 * moves away from it (orbit-tape scrubs, 60×/300×, Set time), so the deck
 * still visibly travels over the ground. A stand-in for the prevailing
 * winds, not a forecast or a hindcast.
 */
export function liveCloudRotation(epochMs: number, presentMs: number): number {
  return ((epochMs - presentMs) / 1000) * CLOUD_ANGULAR_SPEED_RAD_S
}
