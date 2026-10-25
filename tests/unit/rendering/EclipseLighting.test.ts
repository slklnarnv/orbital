import { describe, expect, it } from 'vitest'
import { eclipseLighting } from '@/rendering/iss/eclipseLighting'

describe('eclipseLighting', () => {
  it('reproduces the old sunlit values at shade 0', () => {
    expect(eclipseLighting(0)).toEqual({ exposureBoost: 1, ambient: 0.24, earthshine: 0 })
  })

  it('reproduces the old eclipse values at shade 1', () => {
    const l = eclipseLighting(1)
    expect(l.exposureBoost).toBeCloseTo(2.3, 12)
    expect(l.ambient).toBeCloseTo(0.42, 12)
    expect(l.earthshine).toBeCloseTo(0.65, 12)
  })

  it('is linear in between', () => {
    const l = eclipseLighting(0.5)
    expect(l.exposureBoost).toBeCloseTo(1.65, 12)
    expect(l.ambient).toBeCloseTo(0.33, 12)
    expect(l.earthshine).toBeCloseTo(0.325, 12)
  })

  it('clamps shade outside [0, 1]', () => {
    expect(eclipseLighting(-1)).toEqual(eclipseLighting(0))
    expect(eclipseLighting(2)).toEqual(eclipseLighting(1))
  })
})
