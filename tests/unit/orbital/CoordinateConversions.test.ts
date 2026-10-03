import { describe, expect, it } from 'vitest'
import * as satellite from 'satellite.js'
import {
  ecefToGeodetic,
  sunDirectionTEME,
  sunDirectionWorld,
  temeToECEF,
  temeToGeodetic,
  temeToWorld,
} from '@/core/orbital/CoordinateConversions'

const DEG = Math.PI / 180
const WGS84_A = 6378.137
const WGS84_F = 1 / 298.257223563
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F
const WGS84_B = WGS84_A * (1 - WGS84_F)

/** Closed-form geodetic → ECEF (the inverse the iterative solver must match). */
function geodeticToEcef(latDeg: number, lonDeg: number, altKm: number) {
  const lat = latDeg * DEG
  const lon = lonDeg * DEG
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2)
  return {
    x: (n + altKm) * Math.cos(lat) * Math.cos(lon),
    y: (n + altKm) * Math.cos(lat) * Math.sin(lon),
    z: (n * (1 - WGS84_E2) + altKm) * Math.sin(lat),
  }
}

/** Angle between two unit vectors, degrees. */
function angleDeg(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z
  return Math.acos(Math.min(1, Math.max(-1, dot))) / DEG
}

describe('temeToWorld', () => {
  it('maps TEME Z (north) to world Y and TEME Y to world -Z', () => {
    expect(temeToWorld({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 3, z: -2 })
  })
})

describe('ecefToGeodetic', () => {
  it('puts the equator/prime-meridian surface point at 0°, 0°, 0 km', () => {
    const g = ecefToGeodetic({ x: WGS84_A, y: 0, z: 0 })
    expect(g.latitude).toBeCloseTo(0, 9)
    expect(g.longitude).toBeCloseTo(0, 9)
    expect(g.altitude).toBeCloseTo(0, 6)
  })

  it.each([
    [0, 0, 420],
    [51.6, -120, 420],
    [-51.6, 170, 410],
    [45, 90, 0],
    [-89.9, -45, 400],
  ])('round-trips lat %f lon %f alt %f km', (lat, lon, alt) => {
    const g = ecefToGeodetic(geodeticToEcef(lat, lon, alt))
    expect(g.latitude).toBeCloseTo(lat, 8)
    expect(g.longitude).toBeCloseTo(lon, 8)
    expect(g.altitude).toBeCloseTo(alt, 5)
  })

  it.each([
    ['north', 1],
    ['south', -1],
  ])('gives the polar radius at the %s pole (degenerate cos(lat) branch)', (_name, sign) => {
    const g = ecefToGeodetic({ x: 0, y: 0, z: sign * (WGS84_B + 400) })
    expect(g.latitude).toBeCloseTo(sign * 90, 9)
    expect(g.altitude).toBeCloseTo(400, 5)
  })
})

describe('temeToECEF', () => {
  it('is the identity at GMST 0 and a −GMST rotation about Z otherwise', () => {
    expect(temeToECEF({ x: 1, y: 2, z: 3 }, 0)).toEqual({ x: 1, y: 2, z: 3 })
    const r = temeToECEF({ x: 1, y: 0, z: 5 }, Math.PI / 2)
    expect(r.x).toBeCloseTo(0, 12)
    expect(r.y).toBeCloseTo(-1, 12)
    expect(r.z).toBe(5)
  })

  it('matches satellite.js eciToEcf', () => {
    const teme = { x: 4200.5, y: -3100.25, z: 4100.75 }
    const gmst = 1.2345
    const ours = temeToECEF(teme, gmst)
    const theirs = satellite.eciToEcf(teme, gmst)
    expect(ours.x).toBeCloseTo(theirs.x, 9)
    expect(ours.y).toBeCloseTo(theirs.y, 9)
    expect(ours.z).toBeCloseTo(theirs.z, 9)
  })

  it('composes into temeToGeodetic', () => {
    const teme = geodeticToEcef(30, 0, 420)
    // GMST of +60° means the Earth-fixed meridian under TEME X is at −60°.
    const g = temeToGeodetic(teme, 60 * DEG)
    expect(g.latitude).toBeCloseTo(30, 8)
    expect(g.longitude).toBeCloseTo(-60, 8)
    expect(g.altitude).toBeCloseTo(420, 5)
  })
})

describe('sunDirectionTEME', () => {
  it('returns a unit vector', () => {
    for (const jd of [2451545, 2460389.5, 2470000.25]) {
      const s = sunDirectionTEME(jd)
      expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 12)
    }
  })

  it('points along +X at the March 2024 equinox (2024-03-20 03:06 UTC)', () => {
    expect(angleDeg(sunDirectionTEME(2460389.629), { x: 1, y: 0, z: 0 })).toBeLessThan(1)
  })

  it('reaches +23.44° declination at the June 2024 solstice (2024-06-20 20:51 UTC)', () => {
    const s = sunDirectionTEME(2460482.369)
    expect(Math.asin(s.z) / DEG).toBeCloseTo(23.44, 1)
    expect(angleDeg(s, { x: 0, y: Math.cos(23.44 * DEG), z: Math.sin(23.44 * DEG) })).toBeLessThan(1)
  })
})

describe('sunDirectionWorld', () => {
  it('applies the world axis mapping and dedupes calls within a frame', () => {
    const jd = 2460482.369
    const first = sunDirectionWorld(jd)
    const expected = temeToWorld(sunDirectionTEME(jd))
    expect(first.x).toBeCloseTo(expected.x, 12)
    expect(first.y).toBeCloseTo(expected.y, 12)
    expect(first.z).toBeCloseTo(expected.z, 12)
    // Same julianDate → the same cached object (intra-frame dedup contract).
    expect(sunDirectionWorld(jd)).toBe(first)
    // A new date recomputes in place.
    const next = sunDirectionWorld(jd + 0.5)
    expect(next.x).not.toBeCloseTo(expected.x, 6)
  })
})
