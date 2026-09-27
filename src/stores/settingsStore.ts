import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Which detailed near-range ISS model the renderer loads.
 *  - 'high':   IGOAL-derived model (public/models/iss_igoal.glb) — full part
 *              hierarchy, drives array/radiator/camera animations.
 *  - 'legacy': the proven original detailed model, kept as a selectable
 *              fallback. Uses the exact pre-existing load pipeline. */
export type IssModelQuality = 'high' | 'legacy'

interface SettingsStore {
  issModelQuality: IssModelQuality
  /** Bumped on every explicit selection — even re-selecting the current
   *  value — so a session latched onto the fallback can be returned to the
   *  preferred model by choosing it again (plan 001 R3). */
  selectionNonce: number
  setIssModelQuality: (quality: IssModelQuality) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      issModelQuality: 'high',
      selectionNonce: 0,
      setIssModelQuality: (issModelQuality) => set((state) => ({
        issModelQuality,
        selectionNonce: state.selectionNonce + 1,
      })),
    }),
    {
      name: 'orbital-settings',
      // The nonce is runtime intent; persisting it would let a stale counter
      // suppress the next session's first re-selection.
      partialize: (state) => ({ issModelQuality: state.issModelQuality }),
    },
  ),
)
