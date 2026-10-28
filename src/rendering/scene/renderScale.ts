// ─── Render scale ─────────────────────────────────────────────────────────────
/**
 * Pixel-ratio policy (roadmap D.6 / plan 017 R6). Pure, so the numbers are
 * unit-tested; `AdaptiveDpr` in SceneRoot applies them.
 *
 * Fill rate is this scene's dominant cost, and it grows with the square of the
 * pixel ratio: a DPR-3 phone at full resolution shades 9× the pixels of DPR 1.
 * Two levers:
 *  - a ceiling — the DprGovernor never climbs past it;
 *  - a manual override that PINS the ratio at a fraction of the ceiling. While
 *    pinned the governor is not sampled at all (multiplying its output would
 *    fight its own history); returning to Auto starts a fresh governor.
 */

/** Settings value: adaptive, or a fixed fraction of the ceiling. */
export type RenderScale = 'auto' | 1 | 0.75 | 0.5

export const RENDER_SCALES: readonly RenderScale[] = ['auto', 1, 0.75, 0.5]

/**
 * Ceiling on touch-first (`pointer: coarse`) devices. Phones ship at DPR 3;
 * 2 keeps text-sharp edges at under half the fill cost.
 */
export const COARSE_POINTER_MAX_DPR = 2
/** Ceiling elsewhere (R3F's own default, kept explicit here). */
export const FINE_POINTER_MAX_DPR = 2
/** No pin goes below this (unless the ceiling itself is lower). */
export const MIN_PINNED_DPR = 0.5

/** The highest pixel ratio the renderer may use on this device. */
export function dprCeiling(deviceDpr: number, coarsePointer: boolean): number {
  const dpr = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1
  return Math.min(dpr, coarsePointer ? COARSE_POINTER_MAX_DPR : FINE_POINTER_MAX_DPR)
}

/** The governor's floor: never above the ceiling, never above 1. */
export function dprFloor(ceiling: number): number {
  return Math.min(ceiling, 1)
}

/** The pinned pixel ratio for a manual scale, or null for adaptive. */
export function pinnedDpr(ceiling: number, scale: RenderScale): number | null {
  if (scale === 'auto') return null
  return Math.max(Math.min(MIN_PINNED_DPR, ceiling), ceiling * scale)
}

export function isRenderScale(value: unknown): value is RenderScale {
  return RENDER_SCALES.includes(value as RenderScale)
}
