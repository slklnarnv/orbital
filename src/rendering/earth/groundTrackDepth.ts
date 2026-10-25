/**
 * Clip-space depth bias (NDC units) applied to the ground track: ~3 ulps of a
 * 24-bit depth buffer. A constant NDC pull buys a world-space pull that grows
 * with the square of the view distance, so the surface-hugging track wins
 * against the globe at every zoom while the limb and the station still
 * occlude it. Re-derive with `depthBiasPullKm` if camera near/far change.
 */
export const GROUND_TRACK_DEPTH_BIAS_NDC = 4e-7

/**
 * World-space pull (km) a given NDC bias buys at view depth `viewDepthKm`
 * (perspective, far >> near): NDC z ~ 1 - 2·near/z, so dz = bias·z² / (2·near).
 */
export function depthBiasPullKm(biasNdc: number, viewDepthKm: number, nearKm: number): number {
  return (biasNdc * viewDepthKm * viewDepthKm) / (2 * nearKm)
}
