// ─── PassPredictor.test.ts — visible passes (roadmap B.3) ────────────────────
//
// Known answers come from Skyfield 1.55 (de421 ephemeris), an independent
// implementation: the same element set, the same three conditions (ISS above
// 10°, ISS sunlit, Sun below −6° at the observer) sampled every second over
// 48 h from 2026-10-25 00:00 UTC. The element set is embedded because the
// packaged fallback is refreshed twice a week.

import { describe, expect, it } from 'vitest'
import * as satellite from 'satellite.js'

import {
  compassPoint,
  findVisiblePasses,
  samplePass,
  type Observer,
} from '@/core/orbital/PassPredictor'

const LINE1 = '1 25544U 98067A   26297.20915682  .00007800  00000+0  14938-3 0  9991'
const LINE2 = '2 25544  51.6335  21.6229 0006884 302.9098  57.1228 15.49030149591752'
const satrec = satellite.twoline2satrec(LINE1, LINE2)
const FROM = Date.UTC(2026, 9, 25, 0, 0, 0)

const CITIES: Record<string, Observer> = {
  London: { latitudeDeg: 51.5074, longitudeDeg: -0.1278 },
  NewYork: { latitudeDeg: 40.7128, longitudeDeg: -74.006 },
  Sydney: { latitudeDeg: -33.8688, longitudeDeg: 151.2093 },
  Tokyo: { latitudeDeg: 35.6762, longitudeDeg: 139.6503 },
}

/** Skyfield: [start UTC, end UTC, peak elevation °] per visible window. */
const SKYFIELD: Record<string, Array<[string, string, number]>> = {
  London: [
    ['2026-10-25T04:37:11Z', '2026-10-25T04:40:39Z', 86.6],
    ['2026-10-26T03:51:39Z', '2026-10-26T03:53:09Z', 24.1],
    ['2026-10-26T05:24:37Z', '2026-10-26T05:29:59Z', 80.4],
  ],
  NewYork: [
    ['2026-10-25T09:16:05Z', '2026-10-25T09:16:56Z', 12.5],
    ['2026-10-26T10:03:30Z', '2026-10-26T10:07:14Z', 14.5],
  ],
  Sydney: [
    ['2026-10-25T10:10:30Z', '2026-10-25T10:13:01Z', 40.1],
    ['2026-10-26T09:23:14Z', '2026-10-26T09:27:33Z', 29.3],
    ['2026-10-26T11:00:17Z', '2026-10-26T11:00:31Z', 11.2],
  ],
  Tokyo: [],
}

describe('findVisiblePasses', () => {
  for (const [city, expected] of Object.entries(SKYFIELD)) {
    it(`matches Skyfield for ${city}`, () => {
      const passes = findVisiblePasses(satrec, CITIES[city], FROM)
      expect(passes).toHaveLength(expected.length)
      passes.forEach((pass, i) => {
        const [start, end, peak] = expected[i]
        // Seconds-level agreement: SGP4 and the frame chain differ slightly
        // between libraries, and the visible edges are bisected to 1 s.
        expect(Math.abs(pass.start.epochMs - Date.parse(start))).toBeLessThan(6_000)
        expect(Math.abs(pass.end.epochMs - Date.parse(end))).toBeLessThan(6_000)
        expect(Math.abs(pass.peak.elevationDeg - peak)).toBeLessThan(1.2)
      })
    })
  }

  it('reports windows whose edges are the visibility conditions', () => {
    const observer = CITIES.London
    for (const pass of findVisiblePasses(satrec, observer, FROM)) {
      const visible = (ms: number): boolean => {
        const s = samplePass(satrec, observer, ms)!
        return s.elevationDeg > 10 && s.issSunlit && s.sunElevationDeg < -6
      }
      expect(visible(pass.start.epochMs + 1_500)).toBe(true)
      expect(visible(pass.end.epochMs - 1_500)).toBe(true)
      expect(visible(pass.start.epochMs - 2_000)).toBe(false)
      expect(visible(pass.end.epochMs + 2_000)).toBe(false)
      expect(pass.peak.elevationDeg).toBeGreaterThanOrEqual(Math.max(pass.start.elevationDeg, pass.end.elevationDeg))
    }
  })

  it('marks evening passes that end in Earth\'s shadow', () => {
    // Sydney's passes run after sunset and end while the ISS is still high.
    const passes = findVisiblePasses(satrec, CITIES.Sydney, FROM)
    expect(passes.every((pass) => pass.endsInShadow)).toBe(true)
  })

  it('starts an in-progress pass at the search time', () => {
    const midPass = Date.parse('2026-10-25T04:38:30Z')
    const [first] = findVisiblePasses(satrec, CITIES.London, midPass)
    expect(first.inProgress).toBe(true)
    expect(first.start.epochMs).toBe(midPass)
    expect(Math.abs(first.end.epochMs - Date.parse('2026-10-25T04:40:39Z'))).toBeLessThan(6_000)
  })

  it('finds nothing where a 51.6° orbit never clears 10°', () => {
    expect(findVisiblePasses(satrec, { latitudeDeg: 85, longitudeDeg: 0 }, FROM)).toEqual([])
  })
})

describe('samplePass', () => {
  it('agrees with satellite.js look angles', () => {
    const at = new Date(Date.parse('2026-10-25T04:39:00Z'))
    const gd = { latitude: 51.5074 * Math.PI / 180, longitude: -0.1278 * Math.PI / 180, height: 0 }
    const eci = satellite.propagate(satrec, at).position as satellite.EciVec3<number>
    const look = satellite.ecfToLookAngles(gd, satellite.eciToEcf(eci, satellite.gstime(at)))
    const sample = samplePass(satrec, CITIES.London, at.getTime())!
    expect(sample.elevationDeg).toBeCloseTo(look.elevation * 180 / Math.PI, 9)
  })
})

describe('compassPoint', () => {
  it('names 16 points and wraps', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(11)).toBe('N')
    expect(compassPoint(12)).toBe('NNE')
    expect(compassPoint(225)).toBe('SW')
    expect(compassPoint(359)).toBe('N')
    expect(compassPoint(-90)).toBe('W')
  })
})
