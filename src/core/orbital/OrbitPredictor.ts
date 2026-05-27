import { temeToWorld } from './CoordinateConversions'
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
}

// ─── Orbit Predictor ──────────────────────────────────────────────────────────
/**
 * Generates an array of world-space orbit path points by propagating
 * the orbital engine over one full period forward.
 *
 * Points are spaced ORBIT_PATH_STEP_S seconds apart.
 * Alpha fades from 0 (trail) to 1 (future prediction) — for visual styling.
 */
export function generateOrbitPath(
  engine: OrbitalEngine,
  centerEpochMs: number,
  periodMinutes = ISS_ORBITAL_PERIOD_MIN
): OrbitPathPoint[] {
  const periodMs = periodMinutes * 60 * 1000
  const stepMs = ORBIT_PATH_STEP_S * 1000
  const halfPeriod = periodMs / 2

  // Generate from -halfPeriod to +halfPeriod around current time
  const points: OrbitPathPoint[] = []
  const startMs = centerEpochMs - halfPeriod
  const endMs = centerEpochMs + halfPeriod

  let t = startMs
  while (t <= endMs) {
    const posTEME = engine.propagateAt(t)

    if (posTEME) {
      const worldPos = temeToWorld(posTEME)
      // Alpha: 0 at trail start, 1 at future end
      const alpha = (t - startMs) / (endMs - startMs)
      points.push({ ...worldPos, alpha, epochMs: t })
    }

    t += stepMs
  }

  return points
}
