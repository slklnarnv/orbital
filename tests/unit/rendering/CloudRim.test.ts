// ─── CloudRim.test.ts — cloud tops keep the sun past the terminator ─────────
//
// Cloud tops ~10 km up see the sun for ~3.5 deg past the ground's terminator,
// lit by sunlight that has skimmed the lower air (the orange-red cloud rim of
// every orbital sunset). clouds.frag adds that light only where the day
// shading has run out, through the same sun-path model as the atmosphere
// (sunPath.glsl), so the two cannot drift apart.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { BLOOM_THRESHOLD } from '@/rendering/post/bloomConfig'

const clouds = readFileSync('src/rendering/shaders/clouds.frag', 'utf8')
const atmosphere = readFileSync('src/rendering/shaders/atmosphere.frag', 'utf8')

function constant(name: string): number {
  const match = new RegExp(`const float ${name} = ([0-9.]+);`).exec(clouds)
  if (!match) throw new Error(`${name} not found`)
  return Number(match[1])
}

describe('cloud rim', () => {
  it('shares one sun-path model with the atmosphere', () => {
    expect(clouds).toContain('#include "./sunPath.glsl"')
    expect(atmosphere).toContain('#include "./sunPath.glsl"')
    expect(atmosphere).not.toMatch(/^vec3 transmittance\(/m)
  })

  it('lights only past the terminator, at a real cloud-top height', () => {
    expect(clouds).toContain('float rimW = 1.0 - smoothstep(-0.01, 0.03, sunDot);')
    const top = constant('CLOUD_TOP_KM')
    expect(top).toBeGreaterThanOrEqual(6)
    expect(top).toBeLessThanOrEqual(15)
  })

  it('stays far under the bloom threshold (transmittance <= 1)', () => {
    expect(constant('CLOUD_RIM_GAIN') + 1.12).toBeLessThan(BLOOM_THRESHOLD)
  })
})
