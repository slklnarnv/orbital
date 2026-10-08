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
   * Captures the current (old-TLE) state as the blend origin.
   */
  onTLEUpdate(currentState: OrbitalState | null): void {
    if (currentState) {
      this._blendOrigin = currentState
      this._offset = null
      this._blendFactor = 0.0
    }
  }

  /**
   * Advance the blend and return the smoothed state.
   * Call once per runtime step with the newly propagated state and deltaMs.
   */
  smooth(newState: OrbitalState, deltaMs: number): OrbitalState {
    const origin = this._blendOrigin
    if (this._blendFactor >= 1.0 || !origin) return newState

    if (!this._offset) {
      const dLon = ((origin.longitude - newState.longitude + 540) % 360) - 180
      this._offset = {
        px: origin.positionECI.x - newState.positionECI.x,
        py: origin.positionECI.y - newState.positionECI.y,
        pz: origin.positionECI.z - newState.positionECI.z,
        vx: origin.velocityECI.x - newState.velocityECI.x,
        vy: origin.velocityECI.y - newState.velocityECI.y,
        vz: origin.velocityECI.z - newState.velocityECI.z,
        latitude: origin.latitude - newState.latitude,
        longitude: dLon,
        altitude: origin.altitude - newState.altitude,
        speed: origin.speed - newState.speed,
      }
    }

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
