import { describe, expect, it } from 'vitest'
import { analyzeShaderSource } from '../../../scripts/check-shader-ramps.mjs'

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
