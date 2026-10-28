import * as THREE from 'three'
import type CameraControls from 'camera-controls'
import { preserveUserControlFlags } from './FreeOrbitControls'

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

const _eye = new THREE.Vector3()
const _target = new THREE.Vector3()
const _endEye = new THREE.Vector3()
const _endTarget = new THREE.Vector3()
const _up = new THREE.Vector3()

/**
 * Apply one frame's station rotation to camera-controls: the rendered pose
 * AND the end pose it is easing toward, with the user-control flags kept.
 *
 * Carrying only the rendered pose (`setLookAt(…, false)`) also reset the end
 * pose to it, every frame the clock ran: a wheel dolly kept one frame of its
 * smoothing and stopped (ten ticks moved 352 → 328 km instead of ~100 km),
 * and the cleared `_isUserControlling*` flags switched gestures to
 * programmatic damping. Same pattern as `rotateOrbit` (FreeOrbitControls).
 * Order as in `syncRenderedPoseToControls`: read both poses in the current
 * up-space, adopt the carried up, then set them.
 */
export function carryControls(controls: CameraControls, rotation: THREE.Quaternion): void {
  const camera = controls.camera
  controls.getPosition(_eye, false)
  controls.getTarget(_target, false)
  controls.getPosition(_endEye, true)
  controls.getTarget(_endTarget, true)
  _up.copy(camera.up)
  carryPose(_eye, _target, _up, rotation)
  _endEye.sub(_endTarget).applyQuaternion(rotation).add(_endTarget)
  camera.up.copy(_up)
  controls.updateCameraUp()
  preserveUserControlFlags(controls, () => {
    void controls.setLookAt(_eye.x, _eye.y, _eye.z, _target.x, _target.y, _target.z, false)
    void controls.setLookAt(_endEye.x, _endEye.y, _endEye.z, _endTarget.x, _endTarget.y, _endTarget.z, true)
  })
}
