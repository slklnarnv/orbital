import { describe, expect, it } from 'vitest'
import {
  describeCameraMode,
  describeDaylightChange,
  describeScene,
  inMinutes,
  type SceneFacts,
} from '@/ui/a11y/sceneSummary'

const base: SceneFacts = {
  placeName: null,
  continent: null,
  sunlit: null,
  shadowTransitionInMs: null,
  accelerated: false,
  timeScale: 1,
}

describe('scene summary', () => {
  it('says place, daylight and countdown in one sentence', () => {
    expect(describeScene({
      ...base,
      placeName: 'South Pacific Ocean',
      sunlit: true,
      shadowTransitionInMs: 26 * 60_000 + 40_000,
    })).toBe('The ISS is over the South Pacific Ocean, in daylight; sunset in 26 minutes.')
  })

  it('names countries without an article and counts down to sunrise in shadow', () => {
    expect(describeScene({
      ...base,
      placeName: 'Australia',
      continent: 'Oceania',
      sunlit: false,
      shadowTransitionInMs: 60_000,
    })).toBe('The ISS is over Australia, in Earth’s shadow; sunrise in 1 minute.')
  })

  it('leaves unknown facts out instead of guessing', () => {
    expect(describeScene(base)).toBe('The ISS position is loading.')
    expect(describeScene({ ...base, sunlit: true })).toBe('The ISS is in daylight; no sunset this orbit.')
  })

  it('withholds the place while time is accelerated, as the HUD does', () => {
    expect(describeScene({
      ...base,
      placeName: 'Japan',
      continent: 'Asia',
      sunlit: true,
      shadowTransitionInMs: 5 * 60_000,
      accelerated: true,
      timeScale: 300,
    })).toBe('The ISS is in daylight; sunset in 5 minutes. Time runs at 300×.')
  })

  it('changes once a minute, not every second', () => {
    expect(inMinutes(26 * 60_000)).toBe(inMinutes(26 * 60_000 + 59_000))
    expect(inMinutes(30_000)).toBe('in under a minute')
    expect(inMinutes(65 * 60_000)).toBe('in 1 hour 5 minutes')
    expect(inMinutes(120 * 60_000)).toBe('in 2 hours')
  })

  it('has words for every camera mode and both daylight flips', () => {
    for (const mode of ['PLANETARY', 'ORBITAL', 'APPROACH', 'FOLLOW', 'INSPECT', 'FREE'] as const) {
      expect(describeCameraMode(mode)).toMatch(/^[A-Z][a-z]/)
    }
    expect(describeDaylightChange(true)).not.toBe(describeDaylightChange(false))
  })
})
