import { describe, expect, it } from 'vitest'
import { footprintHalfAngleRad, writeFootprintRing } from '@/core/orbital/Footprint'

const R = 6371

function angleBetween(a: [number, number, number], b: [number, number, number]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const na = Math.hypot(...a)
  const nb = Math.hypot(...b)
  return Math.acos(Math.min(1, Math.max(-1, dot / (na * nb))))
}

describe('footprintHalfAngleRad', () => {
  it('is about 20.3 degrees at 420 km altitude', () => {
    const deg = (footprintHalfAngleRad(R, 420) * 180) / Math.PI
    expect(Math.abs(deg - 20.3)).toBeLessThan(0.1)
  })
})

describe('writeFootprintRing', () => {
  const segments = 64
  const cases: Array<[string, { x: number; y: number; z: number }]> = [
    ['mid latitude', { x: 3000, y: 4000, z: 4500 }],
    ['equator', { x: R + 420, y: 0, z: 0 }],
    ['north pole', { x: 0, y: 0, z: R + 420 }],
    ['south pole', { x: 0, y: 0, z: -(R + 420) }],
  ]

  it.each(cases)('ring points are at angle lambda and the ring radius (%s)', (_name, ecef) => {
    const out = new Float32Array(3 * (segments + 1))
    const ringRadius = R + 2
    writeFootprintRing(ecef, R, ringRadius, segments, out)
    const lambda = footprintHalfAngleRad(R, Math.hypot(ecef.x, ecef.y, ecef.z) - R)
    for (let k = 0; k <= segments; k++) {
      const p: [number, number, number] = [out[3 * k], out[3 * k + 1], out[3 * k + 2]]
      expect(Number.isFinite(p[0] + p[1] + p[2])).toBe(true)
      // Float32 storage limits the achievable precision (~5e-4 km at 6373 km).
      expect(Math.abs(angleBetween(p, [ecef.x, ecef.y, ecef.z]) - lambda)).toBeLessThan(1e-6)
      expect(Math.abs(Math.hypot(...p) - ringRadius)).toBeLessThan(1e-2)
    }
  })

  it('is closed: first point equals last', () => {
    const out = new Float32Array(3 * (segments + 1))
    writeFootprintRing({ x: 3000, y: 4000, z: 4500 }, R, R + 2, segments, out)
    expect([out[3 * segments], out[3 * segments + 1], out[3 * segments + 2]]).toEqual([out[0], out[1], out[2]])
  })
})
