/**
 * R3F `useFrame` priorities, lowest first.
 *
 * Callbacks with the SAME priority run in subscription order, and children
 * subscribe before their parents. A child of ISSGroup reading the station's
 * pose at priority 0 therefore saw the PREVIOUS frame's pose: ISSModel aimed
 * the cached self-shadow one frame behind the rendered station, and because
 * the interpolated step varies 0–160 m per frame (over two 68 m shadow
 * texels), the solar arrays fell into their own shadow on roughly one frame
 * in ten — the Follow-mode flicker. The station pose now advances before
 * everything else, so every consumer reads this frame's pose regardless of
 * where it sits in the tree.
 */
export const FRAME_PRIORITY = {
  /** ISSGroup advances the station position and attitude. */
  stationPose: -2,
  /** drei CameraControls' own update (set by drei, not here). */
  cameraControls: -1,
  /** Default scene work. */
  scene: 0,
  /** The Bloom composer renders the frame; any priority > 0 takes over R3F's render. */
  composer: 1,
} as const
