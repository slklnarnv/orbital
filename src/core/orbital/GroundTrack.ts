import { computeGMST } from '@/core/clock/SimulationTime'
import { UNIX_EPOCH_JULIAN } from '@/utils/constants'
import type { OrbitalEngine } from './OrbitalEngine'
import { temeToECEF, temeToGeodetic } from './CoordinateConversions'

export interface GroundTrackPoint {
  epochMs: number
  latitude: number // degrees
  longitude: number // degrees, [-180, 180]
  /** Earth-fixed position (km) of the propagated station, for 3D use. */
  ecef: { x: number; y: number; z: number }
}

/**
 * Samples the sub-satellite point from `centerMs - pastMs` to
 * `centerMs + futureMs` every `stepMs` (inclusive ends, exact step count —
 * the last sample lands on the end). Each sample uses ITS OWN GMST: the
 * Earth turns ~23° under the station per orbit, which is what makes the
 * track a sine wave rather than a great circle. Samples whose propagation
 * fails are skipped.
 *
 * Pure math — no React, no three. When the span is not a whole number of
 * steps, the step count is rounded and the spacing adjusted slightly so both
 * ends are hit exactly.
 */
export function sampleGroundTrack(
  engine: Pick<OrbitalEngine, 'propagateAt'>,
  centerMs: number,
  options: { pastMs: number; futureMs: number; stepMs: number },
): GroundTrackPoint[] {
  const { pastMs, futureMs, stepMs } = options
  const startMs = centerMs - pastMs
  const endMs = centerMs + futureMs
  const spanMs = endMs - startMs
  const points: GroundTrackPoint[] = []
  if (!(spanMs >= 0) || !(stepMs > 0)) return points

  const steps = Math.max(1, Math.round(spanMs / stepMs))
  for (let i = 0; i <= steps; i++) {
    const epochMs = i === steps ? endMs : startMs + (spanMs * i) / steps
    const teme = engine.propagateAt(epochMs)
    if (!teme) continue
    const gmst = computeGMST(epochMs / 86_400_000 + UNIX_EPOCH_JULIAN)
    const { latitude, longitude } = temeToGeodetic(teme, gmst)
    points.push({ epochMs, latitude, longitude, ecef: temeToECEF(teme, gmst) })
  }
  return points
}
