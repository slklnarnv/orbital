import * as THREE from 'three'

/**
 * The station's flight attitude: LVLH in Torque Equilibrium Attitude (TEA).
 * Body +X along the velocity vector (V-bar), +Z toward nadir, +Y = −orbit
 * normal (starboard), with the small ~−8° equilibrium yaw trim about the body
 * nadir axis. Pure, so the rig simulation tests fly the same attitude as
 * ISSGroup.
 */

/** TEA yaw bias (rad) — the real station trims ~−8° west of V-bar. */
export const TEA_YAW_BIAS_RAD = (-8 * Math.PI) / 180

const _vbar = new THREE.Vector3()
const _nadir = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _basis = new THREE.Matrix4()
const _yawQuat = new THREE.Quaternion()
const _Z = new THREE.Vector3(0, 0, 1)

/**
 * Write the LVLH/TEA attitude for a world position and velocity (same frame,
 * Earth at the origin) into `out`. Returns false — leaving `out` untouched —
 * when the frame is degenerate (no velocity yet, or radial motion collapsing
 * nadir and V-bar toward parallel), so the caller keeps its previous attitude.
 */
export function lvlhAttitude(positionWorld: THREE.Vector3, velocityWorld: THREE.Vector3, out: THREE.Quaternion): boolean {
  _vbar.copy(velocityWorld)
  if (_vbar.lengthSq() < 1e-9) return false
  _vbar.normalize()

  _nadir.copy(positionWorld).multiplyScalar(-1)
  if (_nadir.lengthSq() < 1e-9) return false
  _nadir.normalize()

  // Degenerate-frame guard (plan 001 F): normalizing a near-zero cross
  // product would randomize the attitude.
  _normal.crossVectors(_nadir, _vbar)
  if (_normal.lengthSq() < 1e-8) return false
  _normal.normalize()
  // Re-orthogonalize nadir against the (vbar, normal) pair so the basis
  // stays orthonormal as velocity and position slowly diverge from 90°.
  _nadir.crossVectors(_vbar, _normal)
  if (_nadir.lengthSq() < 1e-8) return false
  _nadir.normalize()

  _basis.makeBasis(_vbar, _normal, _nadir)
  out.setFromRotationMatrix(_basis)
  // TEA: the small equilibrium yaw trim about the body nadir axis.
  out.multiply(_yawQuat.setFromAxisAngle(_Z, TEA_YAW_BIAS_RAD))
  return true
}

/**
 * Per-frame target change treated as a jump (seek, TLE swap) rather than
 * orbital motion. The LVLH frame turns ~0.065°/s; even at 300× and a 0.1 s
 * frame that is ~2° per frame.
 */
export const ATTITUDE_JUMP_RAD = (5 * Math.PI) / 180

/**
 * Follows the LVLH target without lag while smoothing discontinuities.
 *
 * A plain exponential slerp toward the target lags a target that turns at a
 * steady rate by rate/stiffness: ~12° of pitch at 300×. Instead the shown
 * attitude is `offset · target`: the target is followed exactly every frame,
 * and only `offset` — created when the target jumps (or on the first capture)
 * so the shown attitude stays continuous — decays to identity at
 * `stiffness` (1/s).
 */
export class AttitudeFollower {
  private readonly offset = new THREE.Quaternion()
  private readonly lastTarget = new THREE.Quaternion()
  private readonly _inverse = new THREE.Quaternion()
  private readonly _identity = new THREE.Quaternion()
  private hasTarget = false

  constructor(
    private readonly current: THREE.Quaternion,
    private readonly stiffness: number,
  ) {}

  /**
   * Show `target` exactly, dropping any easing in progress. Used while the
   * clock is paused: scrubs and seeks are the user moving time, not a glitch
   * to smooth over, and an eased attitude would turn the station against the
   * station-locked tracking camera.
   */
  snap(target: THREE.Quaternion): THREE.Quaternion {
    this.offset.identity()
    this.lastTarget.copy(target)
    this.hasTarget = true
    return this.current.copy(target)
  }

  /** Advance one frame toward `target`; writes and returns the shown attitude. */
  step(target: THREE.Quaternion, deltaSec: number): THREE.Quaternion {
    const jumped = !this.hasTarget || this.lastTarget.angleTo(target) > ATTITUDE_JUMP_RAD
    if (jumped) {
      // Re-base so the shown attitude does not move this frame.
      this.offset.copy(this.current).multiply(this._inverse.copy(target).invert())
    }
    this.lastTarget.copy(target)
    this.hasTarget = true
    const dt = Math.min(Math.max(deltaSec, 0), 0.1)
    this.offset.slerp(this._identity, 1 - Math.exp(-this.stiffness * dt))
    return this.current.copy(this.offset).multiply(target)
  }
}
