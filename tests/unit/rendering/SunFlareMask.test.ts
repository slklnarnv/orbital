// ─── SunFlareMask.test.ts — Earth disc mask radius ───────────────────────────
//
// The shader-side Earth mask must not project a mirrored disc when Earth's
// centre is behind the camera plane (a negative radius disables the mask).

import { describe, expect, it } from 'vitest'

import { earthMaskRadius } from '@/rendering/post/SunFlare'

describe('earthMaskRadius', () => {
  const angEarth = 0.5
  const tanHalf = Math.tan(Math.PI / 8)

  it('is the projected angular radius when Earth is in front', () => {
    const r = earthMaskRadius(-10, angEarth, tanHalf)
    expect(r).toBeGreaterThan(0)
    expect(r).toBeCloseTo(Math.tan(angEarth) / tanHalf, 12)
  })

  it('is -1 (mask disabled) when Earth is behind the camera', () => {
    expect(earthMaskRadius(10, angEarth, tanHalf)).toBe(-1)
    expect(earthMaskRadius(0, angEarth, tanHalf)).toBe(-1)
  })

  it('is 0 for a degenerate field of view', () => {
    expect(earthMaskRadius(-10, angEarth, 0)).toBe(0)
  })
})
