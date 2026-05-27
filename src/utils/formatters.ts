/**
 * Reusable formatting utilities for telemetry and scientific readouts.
 * Inspired by NASA/JPL/ESA mission-control interface standards.
 */

/**
 * Formats a latitude coordinate (degrees) into cardinal notation.
 * Example: 51.5074 -> "51.5074° N", -23.45 -> "23.4500° S"
 */
export function formatLatitude(lat: number, precision = 4): string {
  const absLat = Math.abs(lat).toFixed(precision)
  const direction = lat >= 0 ? 'N' : 'S'
  return `${absLat}° ${direction}`
}

/**
 * Formats a longitude coordinate (degrees) into cardinal notation.
 * Example: -0.1278 -> "0.1278° W", 123.456 -> "123.4560° E"
 */
export function formatLongitude(lon: number, precision = 4): string {
  const absLon = Math.abs(lon).toFixed(precision)
  const direction = lon >= 0 ? 'E' : 'W'
  return `${absLon}° ${direction}`
}

/**
 * Formats an altitude or absolute distance in kilometers with unit.
 * Example: 408.234 -> "408.2 km"
 */
export function formatKilometers(km: number, precision = 1): string {
  return `${km.toFixed(precision)} km`
}

/**
 * Formats a velocity or linear speed in kilometers per second with unit.
 * Example: 7.6612 -> "7.66 km/s"
 */
export function formatKilometersPerSecond(kms: number, precision = 2): string {
  return `${kms.toFixed(precision)} km/s`
}

/**
 * Formats an orbital period in minutes to a clean scientific duration readout.
 * Example: 92.68 -> "92m 41s"
 */
export function formatPeriod(periodMinutes: number): string {
  const mins = Math.floor(periodMinutes)
  const secs = Math.round((periodMinutes - mins) * 60)
  return `${mins}m ${secs.toString().padStart(2, '0')}s`
}

/**
 * Formats a Julian date into a clean monospace display string.
 * Example: 2461186.9548 -> "2461186.95480"
 */
export function formatJulianDate(jd: number, precision = 5): string {
  return jd.toFixed(precision)
}

/**
 * Formats Greenwich Mean Sidereal Time (radians) into a clean format.
 * Example: 0.82901 -> "0.82901 rad"
 */
export function formatGmst(gmstRad: number, precision = 5): string {
  return `${gmstRad.toFixed(precision)} rad`
}

/**
 * Formats a millisecond timestamp into standard high-precision UTC digital clock format.
 * Example: 1779788713076 -> "2026.146 | 11:05:13 UTC" (where 146 is the day of year)
 */
export function formatUtcClock(epochMs: number): string {
  const date = new Date(epochMs)
  
  const year = date.getUTCFullYear()
  const hours = date.getUTCHours().toString().padStart(2, '0')
  const minutes = date.getUTCMinutes().toString().padStart(2, '0')
  const seconds = date.getUTCSeconds().toString().padStart(2, '0')
  
  // Calculate Day of Year (DOY) for professional flight tracking
  const start = Date.UTC(year, 0, 0)
  const diff = epochMs - start
  const oneDay = 1000 * 60 * 60 * 24
  const doy = Math.floor(diff / oneDay).toString().padStart(3, '0')
  
  return `${year}.${doy} | ${hours}:${minutes}:${seconds} UTC`
}
