import { describe, expect, it } from 'vitest'
import {
  SUN_ANGULAR_RADIUS_RAD,
  isSunlit,
  sunVisibility,
} from '@/core/orbital/SunVisibility'
import { EARTH_RADIUS_KM } from '@/utils/constants'

const R = 6771
const SUN = { x: 1, y: 0, z: 0 }
const rhoE = Math.asin(EARTH_RADIUS_KM / R)
const rhoS = SUN_ANGULAR_RADIUS_RAD

/** Station at radius R whose Earth-centre-to-Sun angle is `theta`. */
function atTheta(theta: number, r = R) {
  return { x: -r * Math.cos(theta), y: r * Math.sin(theta), z: 0 }
}

describe('sunVisibility', () => {
  it('is 0 directly behind Earth', () => {
    expect(sunVisibility({ x: -R, y: 0, z: 0 }, SUN)).toBe(0)
  })

  it('is 1 at the terminator side and sub-solar point', () => {
    expect(sunVisibility({ x: 0, y: R, z: 0 }, SUN)).toBe(1)
    expect(sunVisibility({ x: R, y: 0, z: 0 }, SUN)).toBe(1)
  })

  it('is 0.5 at the geometric limb and counts as sunlit', () => {
    const p = atTheta(rhoE)
    expect(sunVisibility(p, SUN)).toBeCloseTo(0.5, 9)
    expect(isSunlit(p, SUN)).toBe(true)
  })

  it('reaches full sun and full umbra one solar radius from the limb', () => {
    expect(sunVisibility(atTheta(rhoE + rhoS), SUN)).toBeCloseTo(1, 9)
    expect(sunVisibility(atTheta(rhoE - rhoS), SUN)).toBeCloseTo(0, 9)
  })

  it('is monotonic non-decreasing across the penumbra', () => {
    let prev = -Infinity
    for (let i = 0; i < 200; i++) {
      const theta = rhoE - 2 * rhoS + (4 * rhoS * i) / 199
      const v = sunVisibility(atTheta(theta), SUN)
      expect(v).toBeGreaterThanOrEqual(prev)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      prev = v
    }
  })

  it('has a penumbra roughly 63 km wide at ISS radius', () => {
    // Arc length between the 0 and 1 edges, measured from the visibility curve.
    const a = atTheta(rhoE - rhoS)
    const b = atTheta(rhoE + rhoS)
    const width = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    expect(sunVisibility(a, SUN)).toBeCloseTo(0, 9)
    expect(sunVisibility(b, SUN)).toBeCloseTo(1, 9)
    expect(width).toBeGreaterThan(56)
    expect(width).toBeLessThan(70)
  })

  it('agrees with the old cylinder test away from the penumbra', () => {
    let seed = 12345
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x100000000
    }
    let checked = 0
    for (let i = 0; i < 1000; i++) {
      const r = 6600 + rand() * 400
      const u = rand() * 2 - 1
      const phi = rand() * 2 * Math.PI
      const s = Math.sqrt(1 - u * u)
      const p = { x: r * s * Math.cos(phi), y: r * s * Math.sin(phi), z: r * u }
      const along = p.x * SUN.x + p.y * SUN.y + p.z * SUN.z
      const theta = Math.acos(Math.max(-1, Math.min(1, -along / r)))
      const limb = (theta - Math.asin(EARTH_RADIUS_KM / r)) / rhoS
      if (Math.abs(limb) <= 1.5) continue
      checked++
      const perpSq = r * r - along * along
      const cylinderSunlit = !(along < 0 && perpSq < EARTH_RADIUS_KM * EARTH_RADIUS_KM)
      expect(isSunlit(p, SUN)).toBe(cylinderSunlit)
    }
    // The penumbra is a sliver of the sphere, so nearly every sample is checked.
    expect(checked).toBeGreaterThan(950)
  })

  it('reports shade behind Earth and sun elsewhere as booleans', () => {
    expect(isSunlit({ x: -R, y: 0, z: 0 }, SUN)).toBe(false)
    expect(isSunlit({ x: 0, y: 0, z: R }, SUN)).toBe(true)
  })

  it('is 0 at or below the Earth surface', () => {
    expect(sunVisibility({ x: EARTH_RADIUS_KM, y: 0, z: 0 }, SUN)).toBe(0)
    expect(sunVisibility({ x: 0, y: 100, z: 0 }, SUN)).toBe(0)
  })
})
