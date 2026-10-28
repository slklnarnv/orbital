// ─── SunGlareBudget.test.ts — the sun stays under the bloom threshold ─────────
//
// UnrealBloom's 1/16 mip turns a compact HDR source into a rounded square
// (sun.frag header), so the disc + core (capped by a soft knee) plus the glare
// overlay (capped by min() and scaled to GLARE_PEAK) must never reach
// BLOOM_THRESHOLD in the composer's pre-exposure buffer.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BLOOM_THRESHOLD } from '@/rendering/post/bloomConfig'
import {
  GLARE_DITHER_HEADROOM,
  GLARE_PEAK,
  SUN_CORE_KNEE,
} from '@/rendering/scene/sunGlareConfig'

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

describe('sun glare bloom budget', () => {
  it('keeps disc + core + overlay + dither below the threshold', () => {
    const sunDither = 0.8 / 255
    const peak = SUN_CORE_KNEE + GLARE_PEAK * GLARE_DITHER_HEADROOM + sunDither
    expect(peak).toBeLessThan(BLOOM_THRESHOLD)
  })

  it('caps the billboard with the soft knee and the overlay profile at 1', () => {
    const sun = read('src/rendering/shaders/sun.frag')
    expect(sun).toContain('uKnee * (vec3(1.0) - exp(-x / uKnee))')

    const glare = read('src/rendering/shaders/sunGlare.frag')
    expect(glare).toContain('min(1.0, halo + spikes)')
    // ±4% dither, matching GLARE_DITHER_HEADROOM.
    expect(glare).toContain('(hash21(gl_FragCoord.xy) - 0.5) * 0.08')
    expect(1 + 0.08 / 2).toBeCloseTo(GLARE_DITHER_HEADROOM, 12)
  })

  it('draws both layers through the renderer tone and colour pipeline', () => {
    for (const shader of ['src/rendering/shaders/sun.frag', 'src/rendering/shaders/sunGlare.frag']) {
      const source = read(shader)
      expect(source.indexOf('#include <tonemapping_fragment>')).toBeGreaterThan(0)
      expect(source.indexOf('#include <tonemapping_fragment>'))
        .toBeLessThan(source.indexOf('#include <colorspace_fragment>'))
    }
  })
})
