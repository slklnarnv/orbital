import { describe, expect, it } from 'vitest'
import { moonEcliptic, moonPositionTEME, precessionJ2000ToDate } from '@/core/orbital/MoonEphemeris'
import { sunDirectionTEME } from '@/core/orbital/CoordinateConversions'

const DEG = Math.PI / 180
const jdOf = (iso: string) => Date.parse(iso) / 86400000 + 2440587.5

function angleDeg(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const la = Math.hypot(a.x, a.y, a.z)
  const lb = Math.hypot(b.x, b.y, b.z)
  return Math.acos(Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb)))) / DEG
}

describe('moonEcliptic', () => {
  it('matches Meeus example 47.a (1992 April 12, 0h TD)', () => {
    // The module adds TT − UTC itself; feed it the UTC instant of 0h TD.
    const m = moonEcliptic(2448724.5 - 69 / 86400)
    expect(m.longitudeDeg).toBeCloseTo(133.162655, 1)
    expect(Math.abs(m.longitudeDeg - 133.162655)).toBeLessThan(0.02)
    expect(Math.abs(m.latitudeDeg - -3.229126)).toBeLessThan(0.02)
    expect(Math.abs(m.distanceKm - 368409.7)).toBeLessThan(100)
  })
})

describe('moonPositionTEME', () => {
  it('sits opposite the sun at the total lunar eclipse of 2026-03-03', () => {
    const jd = jdOf('2026-03-03T11:33:00Z')
    const sun = sunDirectionTEME(jd)
    const antiSun = { x: -sun.x, y: -sun.y, z: -sun.z }
    // Inside Earth's umbra: within ~0.7° of the antisolar point.
    expect(angleDeg(moonPositionTEME(jd), antiSun)).toBeLessThan(0.7)
  })

  it('sits on the sun at the total solar eclipse of 2026-08-12', () => {
    const jd = jdOf('2026-08-12T17:46:00Z')
    // Geocentric, so the lunar parallax (up to ~0.95°) separates them.
    expect(angleDeg(moonPositionTEME(jd), sunDirectionTEME(jd))).toBeLessThan(1.2)
  })

  it('is full on 2026-10-26 and new on 2026-11-09', () => {
    const full = jdOf('2026-10-26T04:12:00Z')
    expect(angleDeg(moonPositionTEME(full), sunDirectionTEME(full))).toBeGreaterThan(174)
    const fresh = jdOf('2026-11-09T07:02:00Z')
    expect(angleDeg(moonPositionTEME(fresh), sunDirectionTEME(fresh))).toBeLessThan(6)
  })

  it('stays between perigee and apogee', () => {
    for (let jd = jdOf('2026-01-01T00:00:00Z'); jd < jdOf('2027-01-01T00:00:00Z'); jd += 1.7) {
      const p = moonPositionTEME(jd)
      const r = Math.hypot(p.x, p.y, p.z)
      expect(r).toBeGreaterThan(356000)
      expect(r).toBeLessThan(407000)
    }
  })
})

describe('precessionJ2000ToDate', () => {
  it('matches Meeus example 21.b (theta Persei to 2028 Nov 13.19)', () => {
    const ra = 41.054063 * DEG
    const dec = 49.22775 * DEG
    const v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
    const P = precessionJ2000ToDate(2462088.69)
    const w = [0, 1, 2].map((r) => P[r * 3] * v[0] + P[r * 3 + 1] * v[1] + P[r * 3 + 2] * v[2])
    const raOut = (Math.atan2(w[1], w[0]) / DEG + 360) % 360
    const decOut = Math.asin(w[2]) / DEG
    expect(Math.abs(raOut - 41.547214)).toBeLessThan(0.0005)
    expect(Math.abs(decOut - 49.348483)).toBeLessThan(0.0005)
  })

  it('is the identity at J2000 and a rotation always', () => {
    const I = precessionJ2000ToDate(2451545)
    ;[1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(I[i]).toBeCloseTo(v, 12))
    const P = precessionJ2000ToDate(jdOf('2026-10-28T00:00:00Z'))
    for (let r = 0; r < 3; r++) {
      expect(Math.hypot(P[r * 3], P[r * 3 + 1], P[r * 3 + 2])).toBeCloseTo(1, 12)
    }
  })
})
