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
  /** Wall time of a Modules click made before the camera reached the
   *  station: the explorer opens when it becomes available (Locate first). */
  pendingOpenAt: number | null

  setAvailability: (availability: ExplorerAvailability) => void
  setOpen: (open: boolean) => void
  hover: (id: string | null) => void
  select: (id: string | null) => void
  setFocused: (focused: boolean) => void
  setExploded: (exploded: boolean) => void
  setFocusOffsetKm: (km: number) => void
  /** Open the explorer once the station is tracked (the caller locates). */
  requestOpenOnArrival: (nowMs: number) => void
  /** Drop a pending open: the user flew elsewhere (Reset view). */
  cancelOpenOnArrival: () => void
}

/**
 * A Modules click waits this long for the Locate it started to land. Long,
 * because the first Locate on a slow device waits for the station model
 * (software WebGL in CI took 2.5 min); Reset view cancels it sooner.
 */
export const PENDING_OPEN_MS = 300_000

const CLEARED = { hoveredId: null, selectedId: null, focused: false, exploded: false, focusOffsetKm: 0 } as const

export const useExplorerStore = create<ExplorerState>((set) => ({
  availability: 'hidden',
  open: false,
  pendingOpenAt: null,
  ...CLEARED,

  setAvailability: (availability) => set((state) => {
    if (state.availability === availability) return state
    // A Modules click from far away asked for the explorer on arrival.
    const pending = state.pendingOpenAt !== null && availability !== 'hidden'
      && Date.now() - state.pendingOpenAt < PENDING_OPEN_MS
    const opened = pending ? { open: true, pendingOpenAt: null } : {}
    if (availability === 'available') return { availability, ...opened }
    return { availability, ...CLEARED, open: availability === 'hidden' ? false : state.open, ...opened }
  }),

  requestOpenOnArrival: (nowMs) => set({ pendingOpenAt: nowMs }),

  cancelOpenOnArrival: () => set((state) => (state.pendingOpenAt === null ? state : { pendingOpenAt: null })),

  setOpen: (open) => set((state) => (
    state.open === open ? state : open ? { open, pendingOpenAt: null } : { open, pendingOpenAt: null, ...CLEARED }
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
