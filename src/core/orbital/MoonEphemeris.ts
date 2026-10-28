import { JULIAN_DATE_J2000 } from '@/utils/constants'
import type { Vec3 } from '@/utils/math'

// ─── The Moon's geocentric position, and precession for the star catalogue ───
//
// The Moon: Meeus, Astronomical Algorithms (2nd ed.), ch. 47, with the
// largest terms of tables 47.A and 47.B (every longitude term above 0.002°,
// every latitude term above 0.002°). Against the full series that is ~0.01°
// in longitude and latitude and ~50 km in distance — far below the Moon's
// 0.5° disc, and the same frame the sun model uses (ecliptic and equinox of
// date, rotated by the mean obliquity), so phases and eclipses line up.

const DEG = Math.PI / 180

/** TT − UTC, near enough for 2020–2035. The Moon moves 0.01° in it. */
const DELTA_T_DAYS = 69 / 86400

// [D, M, M', F, Σl (1e-6 deg), Σr (1e-3 km)]
const LONGITUDE_DISTANCE_TERMS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
]

// [D, M, M', F, Σb (1e-6 deg)]
const LATITUDE_TERMS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
]

export interface MoonEcliptic {
  /** Ecliptic longitude of date, degrees [0, 360). */
  longitudeDeg: number
  /** Ecliptic latitude, degrees. */
  latitudeDeg: number
  /** Earth-centre to Moon-centre distance, km. */
  distanceKm: number
}

/** The Moon's geocentric ecliptic position (of date) at a UTC Julian date. */
export function moonEcliptic(julianDate: number): MoonEcliptic {
  const T = (julianDate + DELTA_T_DAYS - JULIAN_DATE_J2000) / 36525
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
  const D = (297.8501921 + 445267.1114034 * T - 0.0018819 * T * T) * DEG
  const M = (357.5291092 + 35999.0502909 * T - 0.0001536 * T * T) * DEG
  const Mp = (134.9633964 + 477198.8675055 * T + 0.0087414 * T * T) * DEG
  const F = (93.272095 + 483202.0175233 * T - 0.0036539 * T * T) * DEG
  // Terms in M are scaled by the shrinking eccentricity of Earth's orbit.
  const E = 1 - 0.002516 * T - 0.0000074 * T * T

  let sl = 0
  let sr = 0
  for (const [d, m, mp, f, l, r] of LONGITUDE_DISTANCE_TERMS) {
    const arg = d * D + m * M + mp * Mp + f * F
    const e = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E
    sl += l * e * Math.sin(arg)
    sr += r * e * Math.cos(arg)
  }
  let sb = 0
  for (const [d, m, mp, f, b] of LATITUDE_TERMS) {
    const e = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E
    sb += b * e * Math.sin(d * D + m * M + mp * Mp + f * F)
  }

  const longitude = (((Lp + sl / 1e6) % 360) + 360) % 360
  return { longitudeDeg: longitude, latitudeDeg: sb / 1e6, distanceKm: 385000.56 + sr / 1000 }
}

/**
 * The Moon's geocentric position in TEME (equator and equinox of date), km.
 * Uses the sun model's mean obliquity (`sunDirectionTEME`) so the two agree.
 */
export function moonPositionTEME(julianDate: number): Vec3 {
  const { longitudeDeg, latitudeDeg, distanceKm } = moonEcliptic(julianDate)
  const l = longitudeDeg * DEG
  const b = latitudeDeg * DEG
  const eps = (23.439 - 0.0000004 * (julianDate - JULIAN_DATE_J2000)) * DEG
  const xe = Math.cos(b) * Math.cos(l)
  const ye = Math.cos(b) * Math.sin(l)
  const ze = Math.sin(b)
  return {
    x: distanceKm * xe,
    y: distanceKm * (Math.cos(eps) * ye - Math.sin(eps) * ze),
    z: distanceKm * (Math.sin(eps) * ye + Math.cos(eps) * ze),
  }
}

/**
 * Precession from J2000 to the mean equator and equinox of date (IAU 1976,
 * Meeus 21.2–21.4), row-major 3×3. The star catalogue is J2000; the sun and
 * Moon are of date — 26 years apart that is 0.36°, most of a Moon width.
 */
export function precessionJ2000ToDate(julianDate: number): number[] {
  const T = (julianDate - JULIAN_DATE_J2000) / 36525
  const arcsec = DEG / 3600
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * arcsec
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * arcsec
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * arcsec
  const cz = Math.cos(zeta), sz = Math.sin(zeta)
  const cZ = Math.cos(z), sZ = Math.sin(z)
  const ct = Math.cos(theta), st = Math.sin(theta)
  return [
    cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st,
    sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st,
    st * cz, -st * sz, ct,
  ]
}
