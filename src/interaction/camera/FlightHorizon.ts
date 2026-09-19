import * as THREE from 'three'
import { smoothstep } from '@/utils/math'

/**
 * Per-frame horizon state for camera flights.
 *
 * The captured up is transported with the view each frame — no first-frame snap,
 * free-orbit roll survives departure — and blended onto the world-up horizon as
 * the flight progresses. Blending (error × settle) replaces the old rate-limited
 * chase, which corrected the full roll error every frame while big sweeps kept
 * regenerating it: an 86° flight rolled its image 194°, spinning the world well
 * past what the route required. The blend keeps the roll monotonic and small
 * during the flight and exactly level at arrival.
 *
 * Corrections freeze near the world-up singularity (the projected horizon
 * direction swings wildly there as routes pass over the scene's poles) and are
 * rate-capped, so roll error accumulated across a pole pass unwinds smoothly
 * instead of kicking.
 */
export class FlightHorizon {
  private readonly up = new THREE.Vector3()
  private readonly view = new THREE.Vector3()
  private readonly turn = new THREE.Quaternion()
  private readonly worldUpProjected = new THREE.Vector3()
  private readonly cross = new THREE.Vector3()

  constructor(view: THREE.Vector3, up: THREE.Vector3) {
    this.view.copy(view).normalize()
    this.up.copy(up).normalize()
  }

  /**
   * Advance to the flight's current view direction and progress.
   * Returns the up vector to render with (unit, perpendicular to the view).
   *
   * `worldUpBlend` scales the world-up settle: 1 keeps the previous behavior
   * (horizon blended onto world-up, used by Reset View), 0 disables it entirely
   * (pure transport — Locate keeps the horizon exactly as the user had it, with
   * no forced arrival orientation and therefore no end-of-flight roll; through
   * a world-pole pass there is no flip event at all because world-up is never
   * referenced).
   */
  update(
    viewNow: THREE.Vector3,
    progress: number,
    deltaSeconds: number,
    result: THREE.Vector3,
    worldUpBlend = 1,
  ): THREE.Vector3 {
    this.turn.setFromUnitVectors(this.view, viewNow)
    this.up.applyQuaternion(this.turn)
    if (worldUpBlend > 0) {
      this.worldUpProjected.set(0, 1, 0).addScaledVector(viewNow, -viewNow.y)
      const projectedLength = Math.sqrt(this.worldUpProjected.lengthSq())
      if (projectedLength > 0.01) {
        this.worldUpProjected.multiplyScalar(1 / projectedLength)
        const roll = Math.atan2(
          viewNow.dot(this.cross.crossVectors(this.up, this.worldUpProjected)),
          this.up.dot(this.worldUpProjected),
        )
        const gain = smoothstep(0, 0.6, progress)
          * smoothstep(0.05, 0.3, projectedLength)
          * Math.min(1, deltaSeconds * 10)
          * worldUpBlend
        const maxStep = 2.5 * deltaSeconds
        this.up.applyAxisAngle(viewNow, THREE.MathUtils.clamp(roll * gain, -maxStep, maxStep))
      }
    }
    this.view.copy(viewNow)
    return result.copy(this.up)
  }
}
