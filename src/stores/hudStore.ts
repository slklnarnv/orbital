import { create } from 'zustand'

/**
 * Whether the HUD is hidden (`H`). The overlay layers hide through the
 * `hud-hidden` class on <html> (CSS); the scene's annotations — the orbit
 * line and the optional 3D ground track — read this store, so a clean view
 * hides them too while the station, Earth and sky keep rendering. Not
 * persisted: a reload always restores the HUD.
 */
interface HudStore {
  hidden: boolean
  setHidden: (hidden: boolean) => void
}

export const useHudStore = create<HudStore>((set) => ({
  hidden: false,
  setHidden: (hidden) => {
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('hud-hidden', hidden)
    set({ hidden })
  },
}))
