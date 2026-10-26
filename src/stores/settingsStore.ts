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
  /** Screen-space lens flare — iris ghosts mirrored from the sun, gated by
   *  the sun glare's visibility. A composer pass, so it needs
   *  `postprocessing` on. Off by default: the glare (always on, both
   *  pipelines) carries the blinding read; ghosts are an optional extra. */
  lensFlare: boolean
  /** Optional 3D ground track + visibility footprint on the globe
   *  (see rendering/earth/GroundTrack.tsx). Off keeps the calibrated look. */
  groundTrack: boolean
  /** Station self-shadowing from the sun (detail model only; the shadow map
   *  is cached and redrawn only when the sun angle or a joint moves). */
  shadows: boolean
  setIssModelQuality: (quality: IssModelQuality) => void
  setPostprocessing: (on: boolean) => void
  setOrbitLineStyle: (style: OrbitLineStyle) => void
  setLensFlare: (on: boolean) => void
  setGroundTrack: (on: boolean) => void
  setShadows: (on: boolean) => void
}

const MODEL_QUALITIES: readonly IssModelQuality[] = ['high', 'legacy']
const ORBIT_LINE_STYLES: readonly OrbitLineStyle[] = ['continuous', 'dashed']

type PersistedSettings = Partial<Pick<SettingsStore, 'issModelQuality' | 'postprocessing' | 'orbitLineStyle' | 'lensFlare' | 'groundTrack' | 'shadows'>>

/** Keeps only known, well-typed persisted settings (exported for tests). */
export function sanitizePersistedSettings(persisted: unknown): PersistedSettings {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return {}
  const raw = persisted as Record<string, unknown>
  const out: PersistedSettings = {}
  if (MODEL_QUALITIES.includes(raw.issModelQuality as IssModelQuality)) {
    out.issModelQuality = raw.issModelQuality as IssModelQuality
  }
  if (ORBIT_LINE_STYLES.includes(raw.orbitLineStyle as OrbitLineStyle)) {
    out.orbitLineStyle = raw.orbitLineStyle as OrbitLineStyle
  }
  if (typeof raw.postprocessing === 'boolean') out.postprocessing = raw.postprocessing
  if (typeof raw.lensFlare === 'boolean') out.lensFlare = raw.lensFlare
  if (typeof raw.groundTrack === 'boolean') out.groundTrack = raw.groundTrack
  if (typeof raw.shadows === 'boolean') out.shadows = raw.shadows
  return out
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      issModelQuality: 'high',
      selectionNonce: 0,
      postprocessing: true,
      orbitLineStyle: 'continuous',
      lensFlare: false,
      groundTrack: false,
      shadows: true,
      setIssModelQuality: (issModelQuality) => set((state) => ({
        issModelQuality,
        selectionNonce: state.selectionNonce + 1,
      })),
      setPostprocessing: (postprocessing) => set({ postprocessing }),
      setOrbitLineStyle: (orbitLineStyle) => set({ orbitLineStyle }),
      setLensFlare: (lensFlare) => set({ lensFlare }),
      setGroundTrack: (groundTrack) => set({ groundTrack }),
      setShadows: (shadows) => set({ shadows }),
    }),
    {
      name: 'orbital-settings',
      // The nonce is runtime intent; persisting it would let a stale counter
      // suppress the next session's first re-selection.
      partialize: (state) => ({
        issModelQuality: state.issModelQuality,
        postprocessing: state.postprocessing,
        orbitLineStyle: state.orbitLineStyle,
        lensFlare: state.lensFlare,
        groundTrack: state.groundTrack,
        shadows: state.shadows,
      }),
      // localStorage is user-editable and outlives schema changes. Zustand's
      // default merge spreads whatever is stored over the defaults, so a
      // hand-edited or legacy value (e.g. issModelQuality: 'ultra') would reach
      // MODEL_SPECS[quality] as undefined. Accept only known keys with valid
      // values; anything else keeps its default.
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedSettings(persisted) }),
    },
  ),
)
