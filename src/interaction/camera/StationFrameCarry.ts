import * as THREE from 'three'

/**
 * Station-locked tracking: the Follow/Inspect camera rides in the station's
 * own frame instead of holding a fixed direction in inertial space.
 *
 * The station flies an Earth-facing attitude, so its frame turns once per
 * orbit. A camera offset fixed in inertial space therefore swung around the
 * station whenever time moved quickly — scrubbing half a revolution on the
 * orbit tape carried the view from above the station to beneath it, with
 * Earth's limb wheeling across the frame. Applying each frame's station
 * rotation to the eye (about the station) and to the camera's up vector keeps
 * the user's chosen framing; at 1× the difference is 0.065°/s.
 */
export class StationFrameCarry {
  private readonly last = new THREE.Quaternion()
  private readonly _inverse = new THREE.Quaternion()
  private hasLast = false

  /** Forget the last attitude (tracking stopped, a flight took over). */
  reset(): void {
    this.hasLast = false
  }

  /**
   * World rotation the station made since the previous call, written to
   * `out`; null on the first call after a reset.
   */
  step(attitude: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion | null {
    if (!this.hasLast) {
      this.last.copy(attitude)
      this.hasLast = true
      return null
    }
    out.copy(attitude).multiply(this._inverse.copy(this.last).invert())
    this.last.copy(attitude)
    return out
  }
}

/** Rotate `eye` about `pivot`, and `up`, by `rotation` (in place). */
export function carryPose(
  eye: THREE.Vector3,
  pivot: THREE.Vector3,
  up: THREE.Vector3,
  rotation: THREE.Quaternion,
): void {
  eye.sub(pivot).applyQuaternion(rotation).add(pivot)
  up.applyQuaternion(rotation).normalize()
}

/** Rotations below this angle (rad) are skipped: re-basing the controls costs more than it shows. */
export const MIN_CARRY_ANGLE_RAD = 1e-7
