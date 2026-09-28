import { describe, expect, it } from 'vitest'
import { analyzeShaderSource } from '../../../scripts/check-shader-ramps.mjs'

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

// Ramp table — 2026-09-28/29 visual refresh: the three painted sunset bands
// were replaced by one physical low-sun warmth window shared by terrain and
// clouds (`lowSun`), and the sun was rebuilt as a single radial profile (real
// 0.66° photosphere + tight glare + wide power-law haze) on a 0.185 rad
// billboard, kept entirely below the bloom threshold. Sun edges are quoted in
// billboard UV units: 0.00575 rad / 0.185 rad = 0.0311 for the disc radius.
const fallingRamps = [
  { name: 'Earth night mask', low: -0.14, high: 0.02 },
  { name: 'Earth low-sun warmth', low: 0.02, high: 0.35 },
  { name: 'Cloud low-sun warmth', low: 0.02, high: 0.35 },
  { name: 'Atmosphere twilight falloff', low: 0.02, high: 0.35 },
  { name: 'Sun limb shoulder', low: 0.0249, high: 0.0357 },
  { name: 'Sun billboard edge fade', low: 0.32, high: 0.46 },
]

describe('portable inverse shader ramps', () => {
  for (const ramp of fallingRamps) {
    it(`${ramp.name} falls from one to zero with the original thresholds`, () => {
      const midpoint = (ramp.low + ramp.high) / 2
      const value = (input: number) => 1 - smoothstep(ramp.low, ramp.high, input)

      expect(value(ramp.low - 1)).toBe(1)
      expect(value(ramp.low)).toBe(1)
      expect(value(midpoint)).toBeCloseTo(0.5, 12)
      expect(value(ramp.high)).toBe(0)
      expect(value(ramp.high + 1)).toBe(0)
    })
  }
})

describe('shader ramp static analysis', () => {
  it('accepts ascending literal edges', () => {
    expect(analyzeShaderSource('float x = smoothstep(-0.2, 0.4, value);'))
      .toEqual([expect.objectContaining({ literal: true, reversed: false })])
  })

  it('rejects reversed literal edges, including exponent notation', () => {
    expect(analyzeShaderSource('float x = smoothstep(2e-1, -4.0e-1, value);'))
      .toEqual([expect.objectContaining({ literal: true, reversed: true })])
  })

  it('reports dynamic edges for human review without claiming their order', () => {
    expect(analyzeShaderSource('float x = smoothstep(lowerEdge, upperEdge, value);'))
      .toEqual([expect.objectContaining({ literal: false, reversed: false })])
  })

  it('ignores smoothstep examples inside comments', () => {
    const source = `// smoothstep(1.0, 0.0, x)\n/* smoothstep(2.0, 1.0, x) */`
    expect(analyzeShaderSource(source)).toEqual([])
  })
})
