import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Which detailed near-range ISS model the renderer loads.
 *  - 'high':   IGOAL-derived model (public/models/iss_igoal.glb) — full part
 *              hierarchy, drives array/radiator/camera animations.
 *  - 'legacy': the proven original detailed model, kept as a selectable
 *              fallback. Uses the exact pre-existing load pipeline. */
export type IssModelQuality = 'high' | 'legacy'

/** Orbit-track stroke: one solid stroke, or ticks along the arc. */
export type OrbitLineStyle = 'continuous' | 'dashed'

interface SettingsStore {
  issModelQuality: IssModelQuality
  /** Bumped on every explicit selection — even re-selecting the current
   *  value — so a session latched onto the fallback can be returned to the
   *  preferred model by choosing it again (plan 001 R3). */
  selectionNonce: number
  /** HDR bloom + OutputPass compositing. Off renders exactly like the
   *  pre-composer pipeline: plain per-material ACES, no extra pass. */
  postprocessing: boolean
  /** Orbit-track stroke style (see OrbitLine.tsx). */
  orbitLineStyle: OrbitLineStyle
  /** Screen-space lens flare — halo + iris ghosts around the sun, gated by
   *  Earth occlusion. A composer pass, so it needs `postprocessing` on. */
  lensFlare: boolean
  setIssModelQuality: (quality: IssModelQuality) => void
  setPostprocessing: (on: boolean) => void
  setOrbitLineStyle: (style: OrbitLineStyle) => void
  setLensFlare: (on: boolean) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      issModelQuality: 'high',
      selectionNonce: 0,
      postprocessing: true,
      orbitLineStyle: 'continuous',
      lensFlare: false,
      setIssModelQuality: (issModelQuality) => set((state) => ({
        issModelQuality,
        selectionNonce: state.selectionNonce + 1,
      })),
      setPostprocessing: (postprocessing) => set({ postprocessing }),
      setOrbitLineStyle: (orbitLineStyle) => set({ orbitLineStyle }),
      setLensFlare: (lensFlare) => set({ lensFlare }),
    }),
    {
      name: 'orbital-settings',
      // The nonce is runtime intent; persisting it would let a stale counter
      // suppress the next session's first re-selection. A store written before
      // these keys existed keeps their defaults — zustand's default merge is
      // shallow over the initial state.
      partialize: (state) => ({
        issModelQuality: state.issModelQuality,
        postprocessing: state.postprocessing,
        orbitLineStyle: state.orbitLineStyle,
        lensFlare: state.lensFlare,
      }),
    },
  ),
)
