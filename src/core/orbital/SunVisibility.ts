import type { Vec3 } from '@/utils/math'
import { EARTH_RADIUS_KM } from '@/utils/constants'

/** Apparent solar radius at 1 AU: 695,700 km / 149,597,870.7 km (rad). */
export const SUN_ANGULAR_RADIUS_RAD = 695_700 / 149_597_870.7

/**
 * Fraction of the solar disc visible from `positionKm` (any Earth-centred
 * frame) given the unit `sunDir` in the SAME frame: 1 in full sun, 0 in umbra,
 * and the visible-segment fraction across the penumbra. Earth is a sphere of
 * EARTH_RADIUS_KM; its limb is treated as straight across the tiny solar disc
 * (Earth subtends ~65° at ISS altitude vs the Sun's 0.27°), which makes the
 * visible fraction the circular-segment area below. The 0.5 crossing is
 * exactly the old cylinder edge, so a boolean `>= 0.5` reproduces it.
 */
export function sunVisibility(positionKm: Vec3, sunDir: Vec3): number {
  const r = Math.sqrt(
    positionKm.x * positionKm.x + positionKm.y * positionKm.y + positionKm.z * positionKm.z,
  )
  if (r <= EARTH_RADIUS_KM) return 0

  // Angular radius of Earth's disc as seen from the station.
  const rhoE = Math.asin(EARTH_RADIUS_KM / r)
  // Angle between the direction to Earth's centre and the direction to the Sun.
  const along = positionKm.x * sunDir.x + positionKm.y * sunDir.y + positionKm.z * sunDir.z
  const cosTheta = Math.max(-1, Math.min(1, -along / r))
  const theta = Math.acos(cosTheta)

  // Signed limb distance in solar radii; positive = Sun centre outside Earth's disc.
  const x = (theta - rhoE) / SUN_ANGULAR_RADIUS_RAD
  if (x >= 1) return 1
  if (x <= -1) return 0
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI
}

/** Boolean sunlit state: the penumbra midpoint, i.e. the old cylinder edge. */
export function isSunlit(positionKm: Vec3, sunDir: Vec3): boolean {
  return sunVisibility(positionKm, sunDir) >= 0.5
}
