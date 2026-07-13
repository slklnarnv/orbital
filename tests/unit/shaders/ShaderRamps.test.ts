import { describe, expect, it } from 'vitest'
import { analyzeShaderSource } from '../../../scripts/check-shader-ramps.mjs'

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

const fallingRamps = [
  { name: 'Earth night mask', low: -0.12, high: 0.04 },
  { name: 'Earth terrain sunset', low: 0.0, high: 0.12 },
  { name: 'Cloud sunset', low: 0.0, high: 0.15 },
  { name: 'Atmosphere twilight falloff', low: -0.04, high: 0.08 },
  { name: 'Sun disc', low: 0.006, high: 0.015 },
  { name: 'Sun lens-ring falloff', low: 0.20, high: 0.22 },
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
