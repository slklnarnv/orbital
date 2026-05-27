import type { Vec3 } from '@/utils/math'

// ─── Coordinate Conversions ───────────────────────────────────────────────────
// Pure math — ZERO Three.js imports. Safe in core/ layer.
// These functions convert satellite.js TEME output to Three.js-compatible coords.

/**
 * Convert TEME (satellite.js output) position to Three.js world coordinates.
 *
 * TEME frame: Z-up (Earth rotation axis), right-handed
 * Three.js:   Y-up, right-handed
 *
 * Mapping:
 *   TEME X → Three.js X  (unchanged)
 *   TEME Z → Three.js Y  (north pole becomes "up")
 *   TEME Y → Three.js -Z (right-hand flip)
 *
 * Units: input in km, output in km (1 world unit = 1 km)
 *
 * WARNING: This mapping MUST be consistent across all systems:
 * Earth texture orientation, sun direction, orbit line, camera up-vector.
 */
export function temeToWorld(teme: Vec3): Vec3 {
  return {
    x:  teme.x,
    y:  teme.z,   // TEME Z (north pole) → Three.js Y (up)
    z: -teme.y,   // TEME Y → Three.js -Z
  }
}

/**
 * Convert ECEF (Earth-Centered Earth-Fixed) position to geodetic coordinates.
 * Uses iterative Bowring method for WGS84.
 *
 * @param ecef - ECEF position in km
 * @returns latitude (deg), longitude (deg), altitude (km)
 */
export function ecefToGeodetic(ecef: Vec3): {
  latitude: number
  longitude: number
  altitude: number
} {
  // WGS84 constants
  const a = 6378.137        // semi-major axis km
  const f = 1 / 298.257223563
  const e2 = 2 * f - f * f  // first eccentricity squared

  const { x, y, z } = ecef
  const p = Math.sqrt(x * x + y * y)
  const longitude = Math.atan2(y, x) * (180 / Math.PI)

  // Iterative solution for latitude
  let lat = Math.atan2(z, p * (1 - e2))
  for (let i = 0; i < 5; i++) {
    const sinLat = Math.sin(lat)
    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat)
    lat = Math.atan2(z + e2 * N * sinLat, p)
  }

  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat)
  const altitude = Math.abs(cosLat) > 1e-10
    ? p / cosLat - N
    : Math.abs(z) / sinLat - N * (1 - e2)

  return {
    latitude: lat * (180 / Math.PI),
    longitude,
    altitude,
  }
}

/**
 * Rotate TEME (inertial) position to ECEF (Earth-fixed) using GMST.
 * Equivalent to satellite.js eciToEcf but without the dependency.
 */
export function temeToECEF(teme: Vec3, gmst: number): Vec3 {
  const cosG = Math.cos(gmst)
  const sinG = Math.sin(gmst)
  return {
    x:  teme.x * cosG + teme.y * sinG,
    y: -teme.x * sinG + teme.y * cosG,
    z:  teme.z,
  }
}

/**
 * Convert TEME position directly to geodetic lat/lon/alt.
 */
export function temeToGeodetic(
  teme: Vec3,
  gmst: number
): { latitude: number; longitude: number; altitude: number } {
  const ecef = temeToECEF(teme, gmst)
  return ecefToGeodetic(ecef)
}

/**
 * Compute approximate sun direction vector in TEME/ECI frame from Julian date.
 * Uses low-precision solar position — accurate to ~1° over decades.
 * Output is a unit vector in TEME frame (same frame as SGP4 output).
 */
export function sunDirectionTEME(julianDate: number): Vec3 {
  const DEG2RAD = Math.PI / 180
  const d = julianDate - 2451545.0 // days since J2000

  // Mean longitude and anomaly (degrees)
  const L = (280.460 + 0.9856474 * d) % 360
  const g = (357.528 + 0.9856003 * d) % 360

  // Ecliptic longitude (degrees)
  const lambda =
    L + 1.915 * Math.sin(g * DEG2RAD) + 0.020 * Math.sin(2 * g * DEG2RAD)

  // Obliquity of ecliptic (degrees)
  const epsilon = 23.439 - 0.0000004 * d

  const lambdaRad = lambda * DEG2RAD
  const epsilonRad = epsilon * DEG2RAD

  // Sun direction in ECI (TEME frame)
  return {
    x: Math.cos(lambdaRad),
    y: Math.sin(lambdaRad) * Math.cos(epsilonRad),
    z: Math.sin(lambdaRad) * Math.sin(epsilonRad),
  }
}

let _lastJulianDate = 0
const _cachedSunDirection: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * Convert a TEME sun direction to Three.js world space.
 * Applies the same axis mapping as temeToWorld().
 *
 * Memoized to prevent redundant heavy trigonometric calculations across multiple
 * frame-loop rendering calls per frame.
 */
export function sunDirectionWorld(julianDate: number): Vec3 {
  if (julianDate === _lastJulianDate) {
    return _cachedSunDirection
  }
  const sunDir = temeToWorld(sunDirectionTEME(julianDate))
  _cachedSunDirection.x = sunDir.x
  _cachedSunDirection.y = sunDir.y
  _cachedSunDirection.z = sunDir.z
  _lastJulianDate = julianDate
  return _cachedSunDirection
}
