import type { CameraMode } from '@/types/camera'

// ─── Words for the canvas (roadmap 017 A3) ──────────────────────────────────
// The 3D view is a picture a screen reader cannot see. These pure functions
// say what it shows in a sentence ("The ISS is over the South Pacific Ocean,
// in daylight; sunset in 26 minutes.") and phrase the changes worth a polite
// announcement. Counts are whole minutes so the text changes once a minute,
// not every second.

export interface SceneFacts {
  placeName: string | null
  /** Continent when over land; null over water (or unknown). */
  continent: string | null
  sunlit: boolean | null
  /** Simulation ms to the next sunrise or sunset; null when none is due. */
  shadowTransitionInMs: number | null
  /** Accelerated time withholds the place, as the HUD does. */
  accelerated: boolean
  timeScale: number
}

/** "in under a minute", "in 1 minute", "in 26 minutes", "in 1 hour 5 minutes". */
export function inMinutes(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'in under a minute'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const minutePart = `${rest} minute${rest === 1 ? '' : 's'}`
  if (hours === 0) return `in ${minutePart}`
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`
  return rest === 0 ? `in ${hourPart}` : `in ${hourPart} ${minutePart}`
}

/** Seas and oceans take "the"; countries are named bare. */
function overPlace(placeName: string, continent: string | null): string {
  return continent === null ? `over the ${placeName}` : `over ${placeName}`
}

function daylightPhrase(sunlit: boolean, inMs: number | null): string {
  if (sunlit) return inMs === null ? 'in daylight; no sunset this orbit' : `in daylight; sunset ${inMinutes(inMs)}`
  return inMs === null ? 'in Earth’s shadow' : `in Earth’s shadow; sunrise ${inMinutes(inMs)}`
}

/** One sentence for what the canvas shows; unknown facts are left out. */
export function describeScene(facts: SceneFacts): string {
  const parts: string[] = []
  if (facts.placeName !== null && !facts.accelerated) parts.push(overPlace(facts.placeName, facts.continent))
  if (facts.sunlit !== null) parts.push(daylightPhrase(facts.sunlit, facts.shadowTransitionInMs))
  const sentence = parts.length > 0 ? `The ISS is ${parts.join(', ')}.` : 'The ISS position is loading.'
  return facts.accelerated ? `${sentence} Time runs at ${facts.timeScale}×.` : sentence
}

const MODE_WORDS: Record<CameraMode, string> = {
  PLANETARY: 'Earth overview',
  ORBITAL: 'Orbital view',
  APPROACH: 'Approaching the station',
  FOLLOW: 'Following the station',
  INSPECT: 'Inspecting the station',
  FREE: 'Free camera',
}

/** The announcement for a settled camera mode. */
export function describeCameraMode(mode: CameraMode): string {
  return MODE_WORDS[mode]
}

/** The announcement for a sunlit flip. */
export function describeDaylightChange(sunlit: boolean): string {
  return sunlit ? 'Sunrise on the station.' : 'The station enters Earth’s shadow.'
}
