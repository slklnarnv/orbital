// ─── NightLightsBudget.test.ts — city lights up close stay under bloom ──────
//
// Close to the night side the Black Marble texels span 10–20 pixels, and the
// 4.2x city-light gain put dense cores far over the bloom threshold:
// UnrealBloom drew them as glowing squares. Up close the shader now rolls the
// lights off with a knee below the threshold (as for the sun and the station
// highlights), reconstructs the map with a B-spline and splits lit texels
// into points of light. The overview keeps the old path.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { BLOOM_THRESHOLD } from '@/rendering/post/bloomConfig'

const shader = readFileSync('src/rendering/shaders/earthSurface.frag', 'utf8')

function constant(name: string): number {
  const match = new RegExp(`const float ${name} = ([0-9.]+);`).exec(shader)
  if (!match) throw new Error(`${name} not found`)
  return Number(match[1])
}

describe('city lights up close', () => {
  it('knees every light below the bloom threshold', () => {
    const start = constant('NIGHT_KNEE_START')
    const ceiling = constant('NIGHT_KNEE_CEILING')
    expect(start).toBeLessThan(ceiling)
    expect(ceiling).toBeLessThan(BLOOM_THRESHOLD)
    expect(shader).toContain('nightKnee(nightColor)')
  })

  it('applies the close-range work only once the map is magnified', () => {
    // Weights that are 0 below one pixel per texel leave the overview as it was.
    expect(shader).toContain('smoothstep(1.0, 2.0, pixelsPerTexel)')
    expect(shader).toMatch(/mix\(nightColor, nightKnee\(nightColor\), smoothW\)/)
    expect(shader).toContain('if (nightMask > 0.0)')
  })

  it('keeps point radius and cells sane', () => {
    expect(constant('NIGHT_CELLS')).toBeGreaterThanOrEqual(2)
    expect(constant('NIGHT_POINT_FLOOR')).toBeGreaterThan(0)
    expect(constant('NIGHT_POINT_FLOOR')).toBeLessThan(1)
  })
})
