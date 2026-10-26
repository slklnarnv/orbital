import { create } from 'zustand'

// ─── One overlay system for every HUD popover and panel (roadmap 017 A1/A2/P) ─
// Settings, Passes, Set time, About and the `?` help overlay share this
// store: one overlay is open at a time (opening one closes the other), Escape
// closes whichever is open, and focus goes back to the trigger that opened
// it. Keyboard opens (a shortcut, or Enter/Space on the trigger) move focus
// into the panel; pointer opens leave it where it is.
//
// Focus return: only when focus was inside the overlay, on its trigger, or
// nowhere (the panel unmounting drops it on <body>). Focus the user has
// already taken elsewhere is never stolen, and an outside click never pulls
// it back.

export type OverlayId = 'help' | 'about' | 'passes' | 'settings' | 'seek'

/** Overlays that hold focus and pause the other shortcuts while open. */
export const MODAL_OVERLAYS: ReadonlySet<OverlayId> = new Set<OverlayId>(['help'])

interface OverlayState {
  open: OverlayId | null
  /** The overlay whose trigger takes focus back when the chain closes. */
  returnTo: OverlayId | null
  /** Move focus into the overlay when it mounts. */
  focusIn: boolean
}

export const useOverlayStore = create<OverlayState>(() => ({
  open: null,
  returnTo: null,
  focusIn: false,
}))

/** Panels and triggers carry `data-overlay`, so focus there counts as ours. */
const OVERLAY_SELECTOR = '[data-overlay]'

const triggers = new Map<OverlayId, HTMLElement>()

/** Registers the element focus returns to when `id` closes. */
export function registerOverlayTrigger(id: OverlayId, element: HTMLElement | null): () => void {
  if (element === null) return () => {}
  triggers.set(id, element)
  return () => {
    if (triggers.get(id) === element) triggers.delete(id)
  }
}

export function openOverlay(id: OverlayId, options: { focusIn?: boolean } = {}): void {
  useOverlayStore.setState({ open: id, returnTo: id, focusIn: options.focusIn ?? false })
}

/**
 * Opens `id` from inside the open overlay (About → shortcuts): focus moves
 * in, and closing it returns focus to the first overlay's trigger.
 */
export function switchOverlay(id: OverlayId): void {
  const { open, returnTo } = useOverlayStore.getState()
  useOverlayStore.setState({ open: id, returnTo: returnTo ?? open ?? id, focusIn: true })
}

function focusIsOurs(): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  if (active === null || active === document.body) return true
  return active.closest(OVERLAY_SELECTOR) !== null
}

/** Closes the open overlay; `restoreFocus: false` for outside clicks. */
export function closeOverlay(options: { restoreFocus?: boolean } = {}): void {
  const { open, returnTo } = useOverlayStore.getState()
  if (open === null) return
  const restore = (options.restoreFocus ?? true) && focusIsOurs()
  useOverlayStore.setState({ open: null, focusIn: false })
  // Focus before the panel unmounts, so it never falls through to <body>.
  if (restore) triggers.get(returnTo ?? open)?.focus()
}

export function toggleOverlay(id: OverlayId, options: { focusIn?: boolean } = {}): void {
  if (useOverlayStore.getState().open === id) closeOverlay()
  else openOverlay(id, options)
}

export function isModalOpen(): boolean {
  const { open } = useOverlayStore.getState()
  return open !== null && MODAL_OVERLAYS.has(open)
}

const FOCUSABLE = [
  'button:not([disabled]):not([tabindex="-1"])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** The panel's tabbable elements, in DOM order. */
export function focusableWithin(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
}

/** Focus for a keyboard open: the first control, or the panel itself. */
export function focusInitial(panel: HTMLElement | null, initial: 'first' | 'panel'): void {
  if (panel === null) return
  // An autoFocus field (the place search) has already claimed focus.
  if (panel.contains(document.activeElement)) return
  const target = initial === 'first' ? focusableWithin(panel)[0] ?? panel : panel
  target.focus()
}
