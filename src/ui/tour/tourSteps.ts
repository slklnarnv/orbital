// ─── Guided tour (first visit, replayable from About and `?`) ────────────────
// Pure: the steps, where the spotlight and the card go, and the "seen" flag.
// No DOM beyond an injected Storage, so the rules are unit-tested in node.

export interface TourStep {
  id: string
  title: string
  body: string
  /** CSS selector of the control to spotlight; null centres the card. */
  target: string | null
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Orbital',
    body: 'The International Space Station, live: its position is computed in your browser from public orbital elements. Here is a one-minute look at the controls.',
    target: null,
  },
  {
    id: 'camera',
    title: 'Find the station',
    body: 'Locate flies the camera to the ISS and follows it; Reset view goes back to the whole Earth. Drag to orbit, scroll or pinch to zoom. Keys: L and R.',
    target: '.hud-camera',
  },
  {
    id: 'time',
    title: 'Control time',
    body: 'Pause, run up to 300× faster, or set any date and time. Live returns to now. Keys: Space, 1–4 and 0.',
    target: '.hud-bottom-center',
  },
  {
    id: 'tape',
    title: 'Scrub the orbit',
    body: 'The tape is one revolution, about 92 minutes. Drag along it, or use the arrow keys on it, to move the station through its orbit.',
    target: '.hud-tape',
  },
  {
    id: 'passes',
    title: 'See it from the ground',
    body: 'Passes lists when the station is visible from your city over the next two days. Watch plays a pass from just before it rises. Key: P.',
    target: '#btn-passes',
  },
  {
    id: 'modules',
    title: 'Explore the modules',
    body: 'Modules flies to the station and names its parts: click one for its history, or explode the station to see how it fits together. Key: M.',
    target: '#btn-module-explorer',
  },
  {
    id: 'settings',
    title: 'Tune the view',
    body: 'Settings switches the station model, the orbit line, bloom, lens flare, shadows and the render scale. Key: G.',
    target: '#btn-settings',
  },
  {
    id: 'more',
    title: 'Keys and the rest',
    body: 'Press ? for every shortcut and H to hide the HUD for a clean view. About explains what is measured and what is illustrative, and replays this tour.',
    target: '#btn-about',
  },
]

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Space between a control and its spotlight ring. */
export const SPOT_PAD = 8
/** Gap between the spotlight and the card, and the card's viewport margin. */
export const CARD_GAP = 12

/** The spotlight ring around `target`, padded and kept inside the viewport. */
export function spotlightBox(target: Box, viewport: { width: number; height: number }, pad = SPOT_PAD): Box {
  const left = Math.max(2, target.left - pad)
  const top = Math.max(2, target.top - pad)
  const right = Math.min(viewport.width - 2, target.left + target.width + pad)
  const bottom = Math.min(viewport.height - 2, target.top + target.height + pad)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/**
 * Where the step card goes: below the spotlight when it fits, else above,
 * else beside; centred on the screen with no spotlight. Always clamped
 * inside the viewport by CARD_GAP.
 */
export function placeCard(
  spot: Box | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const clampX = (x: number): number => Math.min(Math.max(CARD_GAP, x), Math.max(CARD_GAP, viewport.width - card.width - CARD_GAP))
  const clampY = (y: number): number => Math.min(Math.max(CARD_GAP, y), Math.max(CARD_GAP, viewport.height - card.height - CARD_GAP))
  if (spot === null) {
    return { left: clampX((viewport.width - card.width) / 2), top: clampY((viewport.height - card.height) / 2) }
  }
  const centreX = clampX(spot.left + spot.width / 2 - card.width / 2)
  const below = spot.top + spot.height + CARD_GAP
  if (below + card.height + CARD_GAP <= viewport.height) return { left: centreX, top: below }
  const above = spot.top - CARD_GAP - card.height
  if (above >= CARD_GAP) return { left: centreX, top: above }
  // Neither fits (a tall target on a short screen): beside it, on the wider side.
  const centreY = clampY(spot.top + spot.height / 2 - card.height / 2)
  const roomRight = viewport.width - (spot.left + spot.width)
  return roomRight >= spot.left
    ? { left: clampX(spot.left + spot.width + CARD_GAP), top: centreY }
    : { left: clampX(spot.left - CARD_GAP - card.width), top: centreY }
}

export const TOUR_SEEN_KEY = 'orbital-tour-seen'

/** Storage can throw (private mode, blocked site data): treat as unseen. */
export function readTourSeen(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(TOUR_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markTourSeen(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(TOUR_SEEN_KEY, '1')
  } catch {
    // Without storage the tour is offered again next visit; nothing breaks.
  }
}
