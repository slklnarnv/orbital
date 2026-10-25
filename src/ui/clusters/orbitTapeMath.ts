/**
 * Argument of latitude (degrees, [0, 360)) from the sub-satellite latitude,
 * the inclination, and the previous latitude sample (trend -> quadrant).
 * Null when the inclination is ~0 (u is undefined from latitude alone).
 */
export function argumentOfLatitudeDeg(
  latitudeDeg: number,
  prevLatitudeDeg: number | null,
  inclinationDeg: number,
): number | null {
  const sinInc = Math.sin((inclinationDeg * Math.PI) / 180)
  if (!(Math.abs(sinInc) > 1e-6)) return null

  const sinLat = Math.sin((latitudeDeg * Math.PI) / 180)
  const clamped = Math.max(-1, Math.min(1, sinLat / sinInc))
  const ascending = (Math.asin(clamped) * 180) / Math.PI // [-90, 90]

  if (prevLatitudeDeg === null) {
    // No trend yet: first sample. Northern half as the interim estimate —
    // the glide corrects it once the trend resolves.
    return latitudeDeg >= 0 ? ascending : 180 - ascending
  }
  if (latitudeDeg >= prevLatitudeDeg) {
    // Northbound: u in [0,90) climbing, or [270,360) after the south apex
    return ascending >= 0 ? ascending : 360 + ascending
  }
  // Southbound: u in (90,270]
  return 180 - ascending
}

/** Moves `current` toward `target` (both phases in [0, 1)) the short way. */
export function wrapPhaseTowards(current: number, target: number): number {
  // Shortest-path target update so the glide never cuts across the
  // 0/360 wrap and trend noise at the apex latitudes cannot yank it.
  let delta = target - current
  delta = ((delta + 1.5) % 1) - 0.5
  return (current + delta + 1) % 1
}
