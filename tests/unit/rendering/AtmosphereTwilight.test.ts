// ─── AtmosphereTwilight.test.ts — limb colour and airglow follow the sun ────
//
// The limb's twilight colour and its shadow edge used to come from a
// hand-placed window on the fragment's own normal. They now come from the
// sunlight reaching the air the fragment shows (sunPathHeight: the height of
// that sunlight's grazing path), the model SunAppearance.ts and the sunrise
// band already use. The night limb carries a faint airglow band near 95 km.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { BLOOM_THRESHOLD } from '@/rendering/post/bloomConfig'
import { ATMOSPHERE_RADIUS } from '@/rendering/earth/EarthConstants'
import { EARTH_RADIUS_KM } from '@/utils/constants'

const shader = readFileSync('src/rendering/shaders/atmosphere.frag', 'utf8')

function constant(name: string): number {
  const match = new RegExp(`const float ${name} = ([0-9.]+);`).exec(shader)
  if (!match) throw new Error(`${name} not found`)
  return Number(match[1])
}

/** JS mirror of the shader's sunPathHeight (km), for the continuity check. */
function sunPathHeight(point: [number, number, number], h: number, sun: [number, number, number]): number {
  const along = point[0] * sun[0] + point[1] * sun[1] + point[2] * sun[2]
  if (along >= 0) return h + along
  const q = point.map((v, i) => v - along * sun[i])
  return Math.hypot(q[0], q[1], q[2]) - EARTH_RADIUS_KM
}

describe('atmosphere twilight', () => {
  it('uses the sun path for the shadow edge, not the fragment normal', () => {
    expect(shader).toContain('float extinction = smoothstep(-6.0, 14.0, hSunAir);')
    expect(shader).not.toContain('twilightWeight')
  })

  it('sunPathHeight is continuous across the terminator and signs day and shadow', () => {
    const sun: [number, number, number] = [1, 0, 0]
    const h = 20
    const r = EARTH_RADIUS_KM + h
    for (const eps of [1e-3, 1e-6]) {
      const day = sunPathHeight([eps, r, 0], h, sun)
      const night = sunPathHeight([-eps, r, 0], h, sun)
      expect(Math.abs(day - night)).toBeLessThan(0.01)
    }
    expect(sunPathHeight([r, 0, 0], h, sun)).toBeGreaterThan(1000) // sub-solar: deep in sunlight
    expect(sunPathHeight([-r, 0, 0], h, sun)).toBeLessThan(-6000) // anti-solar: deep in shadow
  })

  it('places a faint airglow band inside the shell', () => {
    const alt = constant('AIRGLOW_ALT')
    expect(alt).toBeGreaterThan(80)
    expect(alt).toBeLessThan(ATMOSPHERE_RADIUS - EARTH_RADIUS_KM)
    expect(constant('AIRGLOW_GAIN')).toBeLessThan(0.2 * BLOOM_THRESHOLD)
  })
})
