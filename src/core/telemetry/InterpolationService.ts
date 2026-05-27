import { lerpVec3, easeInOutCubic } from '@/utils/math'
import type { OrbitalState } from '@/types/orbital'

// ─── Interpolation Service ────────────────────────────────────────────────────
/**
 * Smooths discontinuities when a new TLE is loaded mid-session.
 * Without this, the ISS would visibly "snap" when a fresh TLE is applied.
 *
 * Strategy: When a new TLE arrives, blend linearly from old to new position
 * over BLEND_DURATION_MS milliseconds.
 */
export class InterpolationService {
  private static readonly BLEND_DURATION_MS = 2000

  private _blendFactor = 1.0  // 1.0 = no blending needed
  private _blendOrigin: OrbitalState | null = null

  /**
   * Call this whenever a new TLE is applied to an entity.
   * Captures the current state as the blend origin.
   */
  onTLEUpdate(currentState: OrbitalState | null): void {
    if (currentState) {
      this._blendOrigin = currentState
      this._blendFactor = 0.0
    }
  }

  /**
   * Advance the blend and return the smoothed state.
   * Call once per frame with the newly propagated state and deltaMs.
   */
  smooth(newState: OrbitalState, deltaMs: number): OrbitalState {
    // No blending needed — return as-is
    if (this._blendFactor >= 1.0 || !this._blendOrigin) {
      return newState
    }

    this._blendFactor = Math.min(
      1.0,
      this._blendFactor + deltaMs / InterpolationService.BLEND_DURATION_MS
    )

    const t = easeInOutCubic(this._blendFactor)

    return {
      ...newState,
      positionECI: lerpVec3(
        this._blendOrigin.positionECI,
        newState.positionECI,
        t
      ),
      velocityECI: lerpVec3(
        this._blendOrigin.velocityECI,
        newState.velocityECI,
        t
      ),
    }
  }

  reset(): void {
    this._blendFactor = 1.0
    this._blendOrigin = null
  }
}
