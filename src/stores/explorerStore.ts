import { create } from 'zustand'

/**
 * Module explorer UI state (plan 017 X1). Written on user actions and on
 * hover changes only — never per frame; the render loop reads it with
 * getState().
 *
 * Availability:
 * - 'hidden': the camera is not tracking the station (no explorer control);
 * - 'unavailable': tracking, but the visible model is not an IGOAL tier
 *   (the legacy model or Model A);
 * - 'available': tracking a visible IGOAL tier (Inspect or close Follow).
 * Losing availability clears the selection, the focus and the explode, so
 * the station never stays exploded off screen.
 */
export type ExplorerAvailability = 'hidden' | 'unavailable' | 'available'

interface ExplorerState {
  availability: ExplorerAvailability
  open: boolean
  hoveredId: string | null
  selectedId: string | null
  focused: boolean
  exploded: boolean
  /** Selected module's distance from the station centre at the requested
   *  explode (km), published by the visible model for the camera floor. */
  focusOffsetKm: number

  setAvailability: (availability: ExplorerAvailability) => void
  setOpen: (open: boolean) => void
  hover: (id: string | null) => void
  select: (id: string | null) => void
  setFocused: (focused: boolean) => void
  setExploded: (exploded: boolean) => void
  setFocusOffsetKm: (km: number) => void
}

const CLEARED = { hoveredId: null, selectedId: null, focused: false, exploded: false, focusOffsetKm: 0 } as const

export const useExplorerStore = create<ExplorerState>((set) => ({
  availability: 'hidden',
  open: false,
  ...CLEARED,

  setAvailability: (availability) => set((state) => {
    if (state.availability === availability) return state
    if (availability === 'available') return { availability }
    return { availability, ...CLEARED, open: availability === 'hidden' ? false : state.open }
  }),

  setOpen: (open) => set((state) => (
    state.open === open ? state : open ? { open } : { open, ...CLEARED }
  )),

  hover: (id) => set((state) => (
    state.hoveredId === id || (id !== null && (!state.open || state.availability !== 'available'))
      ? state
      : { hoveredId: id }
  )),

  select: (id) => set((state) => {
    if (id !== null && (!state.open || state.availability !== 'available')) return state
    if (state.selectedId === id) return state
    // A new selection keeps an active focus (the camera moves on to it);
    // clearing the selection releases the camera.
    return id === null ? { selectedId: null, focused: false, focusOffsetKm: 0 } : { selectedId: id }
  }),

  setFocused: (focused) => set((state) => {
    if (focused && (state.selectedId === null || state.availability !== 'available')) return state
    return state.focused === focused ? state : { focused }
  }),

  setExploded: (exploded) => set((state) => {
    if (exploded && (!state.open || state.availability !== 'available')) return state
    return state.exploded === exploded ? state : { exploded }
  }),

  setFocusOffsetKm: (km) => set((state) => (
    Math.abs(state.focusOffsetKm - km) < 0.01 ? state : { focusOffsetKm: km }
  )),
}))
