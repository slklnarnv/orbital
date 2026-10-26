import { temeToWorld } from './CoordinateConversions'
import { arcPhaseOrigin, orbitPhase } from './OrbitPhase'
import { ORBIT_PATH_STEP_S, ISS_ORBITAL_PERIOD_MIN } from '@/utils/constants'
import type { OrbitalEngine } from './OrbitalEngine'

// ─── Orbit Path Point ─────────────────────────────────────────────────────────
export interface OrbitPathPoint {
  /** World-space position (km) */
  x: number; y: number; z: number
  /** Normalized alpha 0–1 for fade effect */
  alpha: number
  /** epochMs of this point */
  epochMs: number
  /**
   * Orbital phase in revolutions, relative to a whole-revolution origin, so
   * it lies in [0, 2) and rises by exactly 1 across the arc (see OrbitPhase).
   */
  phase: number
}

/**
 * Point budget for one revolution. The fat-line buffers in `OrbitLine` are
 * allocated at this size, so the predictor must never exceed it — and must
 * never truncate to reach it either (see the closure note below).
 */
export const MAX_ORBIT_POINTS = 220

// ─── Orbit Predictor ──────────────────────────────────────────────────────────
/**
 * Generates the world-space arc for one revolution, from half a period before
 * `centerEpochMs` to half a period after.
 *
 * **Closure.** The first and last points are one full period apart, so they
 * must land on the same orbital position: the arc is a closed ring whose two
 * ends meet at the point opposite the station. Two things are required for
 * that, and the original version had neither:
 *
 *  1. The span must be the LIVE period. `ISS_ORBITAL_PERIOD_MIN` is a nominal
 *     92.68 min, while the current element set runs 92.98 min; a 0.3 min
 *     shortfall is ~130 km of missing arc.
 *  2. The last sample must land exactly on `start + period`. Stepping a fixed
 *     30 s and stopping at `t <= end` leaves the final partial step unpainted.
 *
 * Together those left a measured 214 km gap (~11 px at the home view) in the
 * ring at the station's antipode. Closing it exactly leaves the SGP4 residual
 * alone — ~31 km, because an SGP4 orbit does not repeat bit-exactly.
 *
 * The step is nudged to divide the period evenly rather than being truncated,
 * so a longer period (a reboost, or another vehicle) cannot silently drop the
 * tail and reopen the seam.
 */
export function generateOrbitPath(
  engine: OrbitalEngine,
  centerEpochMs: number,
  periodMinutes = engine.periodMinutes ?? ISS_ORBITAL_PERIOD_MIN,
): OrbitPathPoint[] {
  const periodMs = periodMinutes * 60 * 1000
  const halfPeriod = periodMs / 2
  const startMs = centerEpochMs - halfPeriod
  const endMs = centerEpochMs + halfPeriod

  // Round to the nearest whole step so the sampling density stays at ~30 s,
  // then clamp to the buffer budget. `steps` segments means `steps + 1` points.
  const steps = Math.max(
    1,
    Math.min(Math.round(periodMs / (ORBIT_PATH_STEP_S * 1000)), MAX_ORBIT_POINTS - 1),
  )

  const phaseOrigin = arcPhaseOrigin(startMs, periodMs)
  const points: OrbitPathPoint[] = []
  for (let i = 0; i <= steps; i++) {
    const t = startMs + (periodMs * i) / steps
    const posTEME = engine.propagateAt(t)
    if (!posTEME) continue
    points.push({
      ...temeToWorld(posTEME),
      // Alpha: 0 at the trailing edge, 1 at the leading edge.
      alpha: (t - startMs) / (endMs - startMs),
      epochMs: t,
      phase: orbitPhase(t, periodMs) - phaseOrigin,
    })
  }

  return points
}
