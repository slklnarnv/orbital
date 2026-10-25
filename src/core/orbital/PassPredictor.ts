import * as satellite from 'satellite.js'
import type { Vec3 } from '@/utils/math'
import { UNIX_EPOCH_JULIAN } from '@/utils/constants'
import { sunDirectionTEME } from './CoordinateConversions'
import { isSunlit } from './SunVisibility'

// ─── Visible-pass prediction (roadmap B.3) ───────────────────────────────────
//
// A pass is *visible* to an observer while three things hold at once:
//   - the ISS is above the observer's horizon mask (10° by default),
//   - the ISS is in sunlight (SunVisibility's penumbra midpoint, the same
//     edge the HUD countdown uses) — it shines only by reflected sunlight,
//   - the observer's sky is dark: the Sun is below civil twilight (−6°).
// The search samples SGP4 every 30 s over 48 h, then bisects each visibility
// edge to ~1 s and refines the peak elevation. Pure math (no DOM); it runs in
// a Web Worker in the app and directly in the unit tests.

const DEG = Math.PI / 180

export interface Observer {
  latitudeDeg: number
  longitudeDeg: number
  /** Height above the WGS84 ellipsoid (km); 0 when unknown. */
  heightKm?: number
}

/** The ISS as the observer sees it at one instant. */
export interface PassPoint {
  epochMs: number
  elevationDeg: number
  /** Compass bearing, 0° = north, clockwise. */
  azimuthDeg: number
}

export interface VisiblePass {
  start: PassPoint
  peak: PassPoint
  end: PassPoint
  /** The pass began before the search window (already visible at `fromMs`). */
  inProgress: boolean
  /** It disappears into Earth's shadow while still above the horizon mask. */
  endsInShadow: boolean
  /** It appears out of Earth's shadow rather than rising over the mask. */
  startsFromShadow: boolean
}

export interface PassSearchOptions {
  horizonMs?: number
  stepMs?: number
  minElevationDeg?: number
  /** The observer's sky counts as dark below this solar elevation. */
  maxSunElevationDeg?: number
  toleranceMs?: number
}

export const PASS_SEARCH_DEFAULTS: Required<PassSearchOptions> = {
  horizonMs: 48 * 3_600_000,
  stepMs: 30_000,
  minElevationDeg: 10,
  maxSunElevationDeg: -6,
  toleranceMs: 1_000,
}

/** Everything the visibility test needs at one instant. */
export interface PassSample {
  elevationDeg: number
  azimuthDeg: number
  issSunlit: boolean
  sunElevationDeg: number
}

/**
 * Look angles of the ISS and the Sun's elevation for `observer` at `epochMs`,
 * or null if SGP4 fails. Both bodies use the same TEME → ECF rotation (GMST),
 * so the station's sunlight and the observer's sky are frame-consistent.
 */
export function samplePass(satrec: satellite.SatRec, observer: Observer, epochMs: number): PassSample | null {
  const date = new Date(epochMs)
  const pv = satellite.propagate(satrec, date)
  if (!pv.position || typeof pv.position === 'boolean') return null
  const position = pv.position as Vec3
  const gmst = satellite.gstime(date)
  const geodetic: satellite.GeodeticLocation = {
    latitude: observer.latitudeDeg * DEG,
    longitude: observer.longitudeDeg * DEG,
    height: observer.heightKm ?? 0,
  }
  const look = satellite.ecfToLookAngles(geodetic, satellite.eciToEcf(pv.position, gmst))

  const sunTeme = sunDirectionTEME(epochMs / 86_400_000 + UNIX_EPOCH_JULIAN)
  // A unit direction rotates like a position; parallax is negligible at 1 AU.
  const sunEcf = satellite.eciToEcf(sunTeme, gmst)
  const cosLat = Math.cos(geodetic.latitude)
  const up = { x: cosLat * Math.cos(geodetic.longitude), y: cosLat * Math.sin(geodetic.longitude), z: Math.sin(geodetic.latitude) }
  const sunUp = sunEcf.x * up.x + sunEcf.y * up.y + sunEcf.z * up.z

  return {
    elevationDeg: look.elevation / DEG,
    azimuthDeg: ((look.azimuth / DEG) % 360 + 360) % 360,
    issSunlit: isSunlit(position, sunTeme),
    sunElevationDeg: Math.asin(Math.max(-1, Math.min(1, sunUp))) / DEG,
  }
}

function isVisible(sample: PassSample, options: Required<PassSearchOptions>): boolean {
  return sample.elevationDeg > options.minElevationDeg
    && sample.issSunlit
    && sample.sunElevationDeg < options.maxSunElevationDeg
}

function pointAt(satrec: satellite.SatRec, observer: Observer, epochMs: number): PassPoint | null {
  const sample = samplePass(satrec, observer, epochMs)
  return sample ? { epochMs, elevationDeg: sample.elevationDeg, azimuthDeg: sample.azimuthDeg } : null
}

/**
 * Visible passes for `observer` from `fromMs` over the search horizon, in
 * time order. A pass already visible at `fromMs` starts there
 * (`inProgress`); one still visible at the horizon ends there. Windows
 * shorter than the sampling step can be missed — they are a few seconds of
 * a grazing pass at most.
 */
export function findVisiblePasses(
  satrec: satellite.SatRec,
  observer: Observer,
  fromMs: number,
  options: PassSearchOptions = {},
): VisiblePass[] {
  const opts = { ...PASS_SEARCH_DEFAULTS, ...options }
  const visibleAt = (ms: number): boolean => {
    const sample = samplePass(satrec, observer, ms)
    return sample !== null && isVisible(sample, opts)
  }
  /** Bisect a visibility edge between `a` (state `stateA`) and `b`; returns the first instant of the new state. */
  const edge = (a: number, b: number, stateA: boolean): number => {
    while (b - a > opts.toleranceMs) {
      const mid = (a + b) / 2
      if (visibleAt(mid) === stateA) a = mid
      else b = mid
    }
    return stateA ? a : b
  }
  const shadowEdgeAt = (ms: number): boolean => {
    const sample = samplePass(satrec, observer, ms)
    return sample !== null && sample.elevationDeg > opts.minElevationDeg && !sample.issSunlit
  }

  const passes: VisiblePass[] = []
  const endMs = fromMs + opts.horizonMs
  let previous = fromMs
  let wasVisible = visibleAt(fromMs)
  let windowStart = wasVisible ? fromMs : null
  let inProgress = wasVisible

  const closeWindow = (startMs: number, stopMs: number, truncated: boolean): void => {
    const pass = buildPass(satrec, observer, startMs, stopMs, opts)
    if (!pass) return
    pass.inProgress = inProgress
    pass.startsFromShadow = !inProgress && shadowEdgeAt(startMs - opts.toleranceMs)
    pass.endsInShadow = !truncated && shadowEdgeAt(stopMs + opts.toleranceMs)
    passes.push(pass)
  }

  for (let t = fromMs + opts.stepMs; t <= endMs; t += opts.stepMs) {
    const visible = visibleAt(t)
    if (visible !== wasVisible) {
      const at = edge(previous, t, wasVisible)
      if (visible) {
        windowStart = at
      } else if (windowStart !== null) {
        closeWindow(windowStart, at, false)
        windowStart = null
        inProgress = false
      }
      wasVisible = visible
    }
    previous = t
  }
  if (windowStart !== null) closeWindow(windowStart, previous, true)
  return passes
}

/** Peak by golden-section search on elevation inside [startMs, stopMs]. */
function buildPass(
  satrec: satellite.SatRec,
  observer: Observer,
  startMs: number,
  stopMs: number,
  opts: Required<PassSearchOptions>,
): VisiblePass | null {
  const start = pointAt(satrec, observer, startMs)
  const end = pointAt(satrec, observer, stopMs)
  if (!start || !end) return null
  const elevation = (ms: number): number => samplePass(satrec, observer, ms)?.elevationDeg ?? -90
  const ratio = (Math.sqrt(5) - 1) / 2
  let a = startMs
  let b = stopMs
  let c = b - ratio * (b - a)
  let d = a + ratio * (b - a)
  while (b - a > opts.toleranceMs) {
    if (elevation(c) > elevation(d)) b = d
    else a = c
    c = b - ratio * (b - a)
    d = a + ratio * (b - a)
  }
  // A window cut by shadow or the search bounds can peak at an end.
  const candidates = [start, end, pointAt(satrec, observer, (a + b) / 2)]
    .filter((point): point is PassPoint => point !== null)
  const peak = candidates.reduce((best, point) => (point.elevationDeg > best.elevationDeg ? point : best))
  return { start, peak, end, inProgress: false, endsInShadow: false, startsFromShadow: false }
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** 16-point compass name for an azimuth in degrees. */
export function compassPoint(azimuthDeg: number): string {
  const index = Math.round((((azimuthDeg % 360) + 360) % 360) / 22.5) % 16
  return COMPASS[index]
}
