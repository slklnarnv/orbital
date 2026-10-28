import { describe, expect, it } from 'vitest'
import {
  SUN_DISC_RADIUS_RAD,
  apparentSunFlux,
  atmosphereTransmittance,
  sunElevationAboveLimb,
  tangentHeightKm,
  type Rgb,
} from '@/core/orbital/SunAppearance'
import { EARTH_RADIUS_KM, SUN_BILLBOARD_DISTANCE_KM } from '@/utils/constants'

const R_ISS = EARTH_RADIUS_KM + 420
const rgb = (): Rgb => ({ r: 0, g: 0, b: 0 })

/**
 * Camera at ISS altitude on the +y axis, sun point at the billboard distance
 * placed so that it sits `elevationDeg` above the limb as seen from the camera.
 */
function limbScene(elevationDeg: number) {
  const camera = { x: 0, y: R_ISS, z: 0 }
  const fromNadir = Math.asin(EARTH_RADIUS_KM / R_ISS) + (elevationDeg * Math.PI) / 180
  // Direction from the camera, rotated from nadir (-y) toward +x.
  const dir = { x: Math.sin(fromNadir), y: -Math.cos(fromNadir), z: 0 }
  const sunPoint = {
    x: camera.x + dir.x * SUN_BILLBOARD_DISTANCE_KM,
    y: camera.y + dir.y * SUN_BILLBOARD_DISTANCE_KM,
    z: 0,
  }
  return { camera, sunPoint }
}

function flux(elevationDeg: number): Rgb {
  const { camera, sunPoint } = limbScene(elevationDeg)
  return apparentSunFlux(camera, sunPoint, SUN_DISC_RADIUS_RAD, rgb())
}

describe('tangentHeightKm', () => {
  it('is the altitude when the ray climbs away from Earth', () => {
    expect(tangentHeightKm({ x: 0, y: R_ISS, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(420, 9)
  })

  it('is negative for a ray into the planet and zero for a grazing ray', () => {
    expect(tangentHeightKm({ x: 0, y: R_ISS, z: 0 }, { x: 0, y: -1, z: 0 })).toBeCloseTo(-EARTH_RADIUS_KM, 6)
    const graze = Math.asin(EARTH_RADIUS_KM / R_ISS)
    const h = tangentHeightKm({ x: 0, y: R_ISS, z: 0 }, { x: Math.sin(graze), y: -Math.cos(graze), z: 0 })
    expect(Math.abs(h)).toBeLessThan(1e-6)
  })
})

describe('atmosphereTransmittance', () => {
  it('is black below the surface and clear high up', () => {
    expect(atmosphereTransmittance(-1, rgb())).toEqual({ r: 0, g: 0, b: 0 })
    const high = atmosphereTransmittance(120, rgb())
    expect(high.r).toBeGreaterThan(0.999)
    expect(high.b).toBeGreaterThan(0.99)
  })

  it('reddens a grazing ray: red survives longest', () => {
    for (const h of [5, 10, 20, 30]) {
      const t = atmosphereTransmittance(h, rgb())
      expect(t.r).toBeGreaterThan(t.g)
      expect(t.g).toBeGreaterThan(t.b)
    }
  })

  it('is monotonic in height', () => {
    let prev = atmosphereTransmittance(0, rgb()).g
    for (let h = 1; h <= 60; h++) {
      const g = atmosphereTransmittance(h, rgb()).g
      expect(g).toBeGreaterThanOrEqual(prev)
      prev = g
    }
  })
})

describe('apparentSunFlux', () => {
  it('is the full sun well above the limb and nothing well below it', () => {
    const up = flux(5)
    expect(up.r).toBeGreaterThan(0.999)
    expect(up.b).toBeGreaterThan(0.999)
    expect(flux(-2)).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('fades gradually and turns red as the disc sinks into the limb', () => {
    let prev = flux(3).g
    let steps = 0
    for (let e = 3; e >= -1; e -= 0.05) {
      const f = flux(e)
      expect(f.g).toBeLessThanOrEqual(prev + 1e-12)
      if (f.g > 0.01 && f.g < 0.99) steps++
      prev = f.g
    }
    // The fade spans many 0.05° steps rather than a single cut.
    expect(steps).toBeGreaterThan(8)
    const setting = flux(0.5)
    expect(setting.r).toBeGreaterThan(setting.b * 1.5)
  })

  it('is half the clear value, roughly, with the disc centre on the geometric limb', () => {
    // Half the disc is below the limb; the upper half still grazes the
    // atmosphere, so it is less than half and red-heavy.
    const f = flux(0)
    expect(f.r).toBeLessThan(0.5)
    expect(f.r).toBeGreaterThan(f.b)
  })

  it('handles a sun point straight above or below the camera', () => {
    const camera = { x: 0, y: R_ISS, z: 0 }
    expect(apparentSunFlux(camera, { x: 0, y: 270_000, z: 0 }, SUN_DISC_RADIUS_RAD, rgb()).g).toBeGreaterThan(0.999)
    expect(apparentSunFlux(camera, { x: 0, y: -270_000, z: 0 }, SUN_DISC_RADIUS_RAD, rgb()).g).toBe(0)
  })
})

describe('sunElevationAboveLimb', () => {
  it('recovers the constructed elevation', () => {
    for (const e of [-4, -1, 0, 0.5, 3, 20]) {
      const { camera, sunPoint } = limbScene(e)
      expect((sunElevationAboveLimb(camera, sunPoint) * 180) / Math.PI).toBeCloseTo(e, 9)
    }
  })
})
