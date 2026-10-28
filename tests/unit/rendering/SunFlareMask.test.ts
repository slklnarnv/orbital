// ─── SunFlareMask.test.ts — Earth disc mask radius ───────────────────────────
//
// The shader-side Earth mask must not project a mirrored disc when Earth's
// centre is behind the camera plane (a negative radius disables the mask).

import { describe, expect, it } from 'vitest'

import { earthMaskRadius, viewOffsetNdc } from '@/rendering/post/SunFlare'

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

describe('viewOffsetNdc', () => {
  it('is zero without an enabled view offset', () => {
    expect(viewOffsetNdc(null, { x: 1, y: 1 })).toEqual({ x: 0, y: 0 })
    expect(viewOffsetNdc({ enabled: false, fullWidth: 360, fullHeight: 640, offsetX: 0, offsetY: 60 }, { x: 1, y: 1 }))
      .toEqual({ x: 0, y: 0 })
  })

  it('matches the projection three.js builds for a shifted window', async () => {
    const THREE = await import('three')
    const camera = new THREE.PerspectiveCamera(45, 360 / 640, 1, 1000)
    const point = new THREE.Vector3(3, -7, -100)
    const plain = point.clone().project(camera)
    camera.setViewOffset(360, 640, 0, 60, 360, 640)
    const shifted = point.clone().project(camera)
    const ndc = viewOffsetNdc(camera.view, { x: 0, y: 0 })
    expect(shifted.x).toBeCloseTo(plain.x + ndc.x, 9)
    expect(shifted.y).toBeCloseTo(plain.y + ndc.y, 9)
    expect(ndc.y).toBeGreaterThan(0)
  })
})
