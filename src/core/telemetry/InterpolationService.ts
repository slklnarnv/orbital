import { easeInOutCubic } from '@/utils/math'
import type { OrbitalState } from '@/types/orbital'

// ─── Interpolation Service ────────────────────────────────────────────────────
/**
 * Smooths discontinuities when a new TLE is loaded mid-session.
 * Without this, the ISS would visibly "snap" when a fresh TLE is applied.
 *
 * Strategy: offset decay. On the first step after a swap, the difference
 * between the old-TLE state and the new-TLE state is captured once; it then
 * eases to zero over BLEND_DURATION_MS while the new state keeps moving.
 * (Lerping from a frozen origin instead made the blended station lag its own
 * motion — ~15 km mid-blend at 1×, thousands of km at 300×.)
 *
 * Every displayed quantity decays together — ECI vectors for the renderer and
 * the geodetic/speed scalars for the HUD — so gauges and the 3D model never
 * disagree during a blend.
 */

interface BlendOffset {
  px: number; py: number; pz: number
  vx: number; vy: number; vz: number
  latitude: number
  /** Shortest signed longitude difference, degrees (wraps across ±180°). */
  longitude: number
  altitude: number
  speed: number
}

export class InterpolationService {
  private static readonly BLEND_DURATION_MS = 2000

  private _blendFactor = 1.0  // 1.0 = no blending needed
  private _blendOrigin: OrbitalState | null = null
  private _offset: BlendOffset | null = null

  /**
   * Call this whenever a new TLE is applied to an entity.
   *
   * Preferred form: pass `previous` (old element set) AND `next` (new element
   * set) propagated to the SAME instant. The offset is then frozen immediately,
   * so it contains only the element-set disagreement. Deriving it lazily on a
   * later tick compared states at different times, folding orbital motion
   * (>= 30 sim-s, ~230 km at 300x) into the blend.
   *
   * With only `previous`, the old-TLE state is captured as the blend origin and
   * the offset is derived on the first `smooth()` call (legacy behaviour).
   */
  onTLEUpdate(previous: OrbitalState | null, next?: OrbitalState | null): void {
    if (!previous) return
    this._blendOrigin = previous
    this._offset = next ? InterpolationService.computeOffset(previous, next) : null
    this._blendFactor = 0.0
  }

  /** Abort any pending blend (e.g. the TLE install was rolled back). */
  cancel(): void {
    this._blendOrigin = null
    this._offset = null
    this._blendFactor = 1.0
  }

  private static computeOffset(origin: OrbitalState, target: OrbitalState): BlendOffset {
    const dLon = ((origin.longitude - target.longitude + 540) % 360) - 180
    return {
      px: origin.positionECI.x - target.positionECI.x,
      py: origin.positionECI.y - target.positionECI.y,
      pz: origin.positionECI.z - target.positionECI.z,
      vx: origin.velocityECI.x - target.velocityECI.x,
      vy: origin.velocityECI.y - target.velocityECI.y,
      vz: origin.velocityECI.z - target.velocityECI.z,
      latitude: origin.latitude - target.latitude,
      longitude: dLon,
      altitude: origin.altitude - target.altitude,
      speed: origin.speed - target.speed,
    }
  }

  /**
   * Advance the blend and return the smoothed state.
   * Call once per runtime step with the newly propagated state and deltaMs.
   */
  smooth(newState: OrbitalState, deltaMs: number): OrbitalState {
    const origin = this._blendOrigin
    if (this._blendFactor >= 1.0 || !origin) return newState

    if (!this._offset) this._offset = InterpolationService.computeOffset(origin, newState)

    this._blendFactor = Math.min(
      1.0,
      this._blendFactor + deltaMs / InterpolationService.BLEND_DURATION_MS,
    )
    if (this._blendFactor >= 1.0) {
      this._blendOrigin = null
      this._offset = null
      return newState
    }

    const o = this._offset
    const k = 1 - easeInOutCubic(this._blendFactor)
    const longitude = newState.longitude + o.longitude * k
    return {
      ...newState,
      positionECI: {
        x: newState.positionECI.x + o.px * k,
        y: newState.positionECI.y + o.py * k,
        z: newState.positionECI.z + o.pz * k,
      },
      velocityECI: {
        x: newState.velocityECI.x + o.vx * k,
        y: newState.velocityECI.y + o.vy * k,
        z: newState.velocityECI.z + o.vz * k,
      },
      latitude: newState.latitude + o.latitude * k,
      longitude: ((longitude + 540) % 360) - 180,
      altitude: newState.altitude + o.altitude * k,
      speed: newState.speed + o.speed * k,
    }
  }
}
