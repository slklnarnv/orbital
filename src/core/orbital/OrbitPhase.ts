// ─── Orbit phase ──────────────────────────────────────────────────────────────
//
// The dashed orbit line keys its pattern on the station's orbital phase: how
// many revolutions of the mean motion have elapsed at a point's epoch. That
// is the mean argument of latitude up to a constant per element set, and the
// constant only rotates the whole pattern, so it is left out.
//
// Why time rather than the geometric argument of latitude (the angle from the
// ascending node, measured from positions): the predictor regenerates the
// arc every minute of sim time, and in every arc a point on the ring is
// labelled with the epoch at which the station passes it (vertices carry
// their sample epoch; the GPU interpolates between them). A phase that is a
// function of epoch alone therefore gives that point the same value in every
// arc, whatever the refresh cadence or sim rate: the pattern cannot crawl,
// with no state to keep. The geometric
// angle is measured from a node that precesses (~5°/day): every refresh
// would relabel every point by ~4e-5 rad (~0.26 km, about a pixel at Follow
// distance) — small, but a tick once a minute where this has none.

/** Revolutions of the mean motion since the Unix epoch at `epochMs`. */
export function orbitPhase(epochMs: number, periodMs: number): number {
  return epochMs / periodMs
}

/**
 * Whole revolutions to subtract from an arc's phases before they go to the
 * GPU. Absolute phases are ~3e5 revolutions, which float32 holds to ~0.03
 * of a revolution; relative to the arc's first point they stay in [0, 2),
 * where float32 resolves ~2e-7 of a revolution (~10 m). The offset is a
 * whole number, so it changes no dash: those depend only on the fraction.
 */
export function arcPhaseOrigin(firstEpochMs: number, periodMs: number): number {
  return Math.floor(orbitPhase(firstEpochMs, periodMs))
}
