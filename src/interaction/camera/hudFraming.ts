// ─── HUD-aware framing (plan 017 R2) ──────────────────────────────────────────
/**
 * Tracking centres the station on the canvas, but on a portrait phone the
 * bottom ~40% of the canvas is HUD, so the centre sits under the clock. The
 * fix shifts the projection — never the camera or its target — so the optical
 * centre lands in the middle of the band the HUD leaves free.
 *
 * Pure geometry on screen rectangles (CSS px, viewport origin top-left); the
 * DOM measurement and `camera.setViewOffset` live in HudAwareFraming.tsx.
 */

export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface ViewportSize {
  width: number
  height: number
}

/**
 * Width of the centred column, as a fraction of the viewport, that a HUD box
 * must reach into to count as an obstruction. Corner clusters on a wide
 * screen sit outside it and leave the framing alone; on a phone the clusters
 * span the width and all count.
 */
export const FRAMING_COLUMN_FRACTION = 0.5

/** The shift never exceeds this fraction of the viewport height. */
export const MAX_SHIFT_FRACTION = 0.25

/** Ease time constant: the shift settles in roughly a third of a second. */
export const SHIFT_TIME_CONSTANT_S = 0.12

/**
 * The vertical band of the centred column that no HUD box covers. Boxes whose
 * centre lies in the top half push the band's top down; the rest push its
 * bottom up. A band squeezed shut falls back to the whole height (no shift)
 * rather than producing a meaningless centre.
 */
export function unobstructedBand(
  viewport: ViewportSize,
  rects: readonly ScreenRect[],
  columnFraction = FRAMING_COLUMN_FRACTION,
): { top: number; bottom: number } {
  const centreX = viewport.width / 2
  const halfColumn = (viewport.width * columnFraction) / 2
  const midY = viewport.height / 2
  let top = 0
  let bottom = viewport.height
  for (const rect of rects) {
    if (rect.right <= rect.left || rect.bottom <= rect.top) continue
    if (rect.right <= centreX - halfColumn || rect.left >= centreX + halfColumn) continue
    if ((rect.top + rect.bottom) / 2 < midY) top = Math.max(top, rect.bottom)
    else bottom = Math.min(bottom, rect.top)
  }
  if (bottom - top < viewport.height * 0.2) return { top: 0, bottom: viewport.height }
  return { top: Math.max(0, top), bottom: Math.min(viewport.height, bottom) }
}

/**
 * CSS px to move the optical centre UP (negative moves it down) so it sits in
 * the middle of the unobstructed band, clamped to MAX_SHIFT_FRACTION.
 */
export function framingShiftPx(
  viewport: ViewportSize,
  rects: readonly ScreenRect[],
  columnFraction = FRAMING_COLUMN_FRACTION,
): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 0
  const band = unobstructedBand(viewport, rects, columnFraction)
  const shift = viewport.height / 2 - (band.top + band.bottom) / 2
  const max = viewport.height * MAX_SHIFT_FRACTION
  return Math.round(Math.min(max, Math.max(-max, shift)))
}

/**
 * Frame-rate-independent exponential approach toward `target`, snapping once
 * within a quarter pixel so the projection stops being rewritten.
 */
export function easeShift(
  current: number,
  target: number,
  deltaS: number,
  timeConstantS = SHIFT_TIME_CONSTANT_S,
): number {
  if (!(deltaS > 0)) return current
  const next = current + (target - current) * (1 - Math.exp(-deltaS / timeConstantS))
  return Math.abs(target - next) < 0.25 ? target : next
}
