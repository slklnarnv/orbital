import { UNIX_EPOCH_JULIAN } from '@/utils/constants'
import type { SimulationTime } from '@/types/orbital'


export type { SimulationTime }

// ─── GMST Computation ────────────────────────────────────────────────────────

/**
 * Compute Greenwich Mean Sidereal Time (radians) from Julian date.
 * Uses the IAU 1982 expression — accurate to ~0.1s over centuries.
 */
export function computeGMST(julianDate: number): number {
  const T = (julianDate - 2451545.0) / 36525.0;
  // GMST in seconds of arc
  let gmst =
    67310.54841 +
    (876600 * 3600 + 8640184.812866) * T +
    0.093104 * T * T -
    6.2e-6 * T * T * T;

  // Convert arc-seconds to radians
  gmst = ((gmst % 86400) * (2 * Math.PI)) / 86400;
  // Normalize to [0, 2π]
  return ((gmst % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

// ─── Build SimulationTime from epoch ─────────────────────────────────────────

export function buildSimulationTime(
  epochMs: number,
  deltaMs: number,
  simDeltaMs: number
): SimulationTime {
  // JS Date for julian conversion
  const julianDate = epochMs / 86400000 + UNIX_EPOCH_JULIAN;
  const gmst = computeGMST(julianDate);

  return { epochMs, julianDate, gmst, deltaMs, simDeltaMs }
}
