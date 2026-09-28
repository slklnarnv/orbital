import { ISS_ORBITAL_PERIOD_MIN } from './constants'

/**
 * Sanity floor for one revolution, in minutes. Guards a zero/NaN period out of
 * live telemetry; the real station is nowhere near this (`ISS_ORBITAL_PERIOD_MIN`
 * is ~92.68 min).
 */
const MIN_PERIOD_MIN = 10

/**
 * One orbital revolution in milliseconds, from a telemetry period in minutes.
 *
 * Shared by the two time-control surfaces that convert a phase offset to a
 * time offset (the orbit tape's scrub and the seek popover's ±orbit nudge).
 * They MUST agree: this floor was once scaled as seconds instead of minutes,
 * which silently made every scrub offset 6.45× too large, and two copies of
 * the formula is two places to reintroduce that.
 */
export function periodMsOf(orbitalPeriodMinutes: number | null | undefined): number {
  return Math.max(MIN_PERIOD_MIN, orbitalPeriodMinutes || ISS_ORBITAL_PERIOD_MIN) * 60_000
}
