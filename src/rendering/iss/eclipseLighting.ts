/**
 * Lighting response to the station's shade (1 − sun visibility). Endpoints
 * reproduce the pre-penumbra values exactly: shade 0 = the old sunlit branch,
 * shade 1 = the old eclipse branch; values between are linear in shade.
 */
export interface EclipseLighting {
  /** Key-light exposure multiplier: 1.0 sunlit → 2.3 in full shade. */
  exposureBoost: number
  /** Ambient fill intensity: 0.24 sunlit → 0.42 in full shade. */
  ambient: number
  /** Earthshine key-light intensity: 0 sunlit → 0.65 in full shade. */
  earthshine: number
}

export function eclipseLighting(shade: number): EclipseLighting {
  const s = Math.max(0, Math.min(1, shade))
  return {
    exposureBoost: 1 + 1.3 * s,
    ambient: 0.24 + 0.18 * s,
    earthshine: 0.65 * s,
  }
}
