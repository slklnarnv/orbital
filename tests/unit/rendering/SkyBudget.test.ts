// ─── SkyBudget.test.ts — the stars and the Moon stay under the bloom threshold ─
//
// UnrealBloom turns a compact HDR source into a square (sun.frag header), so
// the brightest star sprite and the brightest lunar texel must stay below
// BLOOM_THRESHOLD, and both must go through the renderer's tone and colour
// pipeline like every other layer.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BLOOM_THRESHOLD } from '@/rendering/post/bloomConfig'
import {
  MOON_EARTHSHINE,
  MOON_RADIANCE_CAP,
  MOON_SUN_GAIN,
  STAR_BRIGHTNESS_CAP,
  starBrightness,
  starSizePx,
} from '@/rendering/scene/skyConfig'

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

describe('sky bloom budget', () => {
  it('caps every star and the Moon under the threshold', () => {
    expect(starBrightness(-1.46)).toBe(STAR_BRIGHTNESS_CAP) // Sirius
    expect(STAR_BRIGHTNESS_CAP).toBeLessThan(BLOOM_THRESHOLD)
    expect(MOON_RADIANCE_CAP).toBeLessThan(BLOOM_THRESHOLD)
    // A white texel at full sun plus earthshine would exceed the cap; the shader clamps it.
    expect(MOON_SUN_GAIN + MOON_EARTHSHINE).toBeGreaterThanOrEqual(MOON_RADIANCE_CAP)
    expect(read('src/rendering/shaders/moon.frag')).toContain('min(radiance, vec3(uRadianceCap))')
  })

  it('orders stars by magnitude: brighter is never dimmer or smaller', () => {
    for (let m = -1.5; m < 6.5; m += 0.25) {
      expect(starBrightness(m)).toBeGreaterThanOrEqual(starBrightness(m + 0.25))
      expect(starSizePx(m)).toBeGreaterThanOrEqual(starSizePx(m + 0.25))
    }
    // The faint end sits with the random stars the catalogue replaced (0.024–0.06).
    expect(starBrightness(6.5)).toBeGreaterThan(0.015)
    expect(starBrightness(5)).toBeLessThan(0.07)
  })

  it('mirrors the shader formulas', () => {
    const vert = read('src/rendering/shaders/stars.vert')
    expect(vert).toContain('min(uBrightnessCap, uZeroMagBrightness * pow(10.0, -uMagSlope * aMag))')
    expect(vert).toContain('clamp((uSizeGrowMag - aMag) / uSizeGrowRange, 0.0, 1.0)')
  })

  it('draws stars and Moon through the tone and colour pipeline', () => {
    for (const shader of ['src/rendering/shaders/stars.frag', 'src/rendering/shaders/moon.frag']) {
      const source = read(shader)
      expect(source.indexOf('#include <tonemapping_fragment>')).toBeGreaterThan(0)
      expect(source.indexOf('#include <tonemapping_fragment>'))
        .toBeLessThan(source.indexOf('#include <colorspace_fragment>'))
    }
    // The Milky Way keeps the old panorama's look: blended, not tone mapped.
    const milkyWay = read('src/rendering/shaders/milkyWay.frag')
    expect(milkyWay).not.toContain('tonemapping_fragment')
    expect(milkyWay).toContain('#include <colorspace_fragment>')
  })
})
