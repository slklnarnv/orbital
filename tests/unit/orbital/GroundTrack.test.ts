import { beforeAll, describe, expect, it, vi } from 'vitest'
import fallback from '@/data/fallback-tle.json'
import { OrbitalEngine } from '@/core/orbital/OrbitalEngine'
import { sampleGroundTrack } from '@/core/orbital/GroundTrack'
import { temeToGeodetic } from '@/core/orbital/CoordinateConversions'
import { computeGMST } from '@/core/clock/SimulationTime'
import { UNIX_EPOCH_JULIAN } from '@/utils/constants'

const EPOCH_MS = Date.parse(fallback.epoch)
const STEP_MS = 30_000
const INCLINATION_DEG = 51.6

/** Wrap-aware signed longitude difference b - a, in (-180, 180]. */
const lonDiff = (a: number, b: number): number => {
  let d = b - a
  while (d > 180) d -= 360
  while (d <= -180) d += 360
  return d
}

describe('sampleGroundTrack', () => {
  let engine: OrbitalEngine
  let periodMs: number

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    engine = new OrbitalEngine('iss')
    engine.loadTLE({
      line1: fallback.line1,
      line2: fallback.line2,
      fetchedAt: EPOCH_MS,
      source: 'fallback',
    })
    periodMs = (engine.periodMinutes ?? 92.68) * 60_000
  })

  it('returns the expected count with exact ends for a +-half-period window', () => {
    const track = sampleGroundTrack(engine, EPOCH_MS, {
      pastMs: periodMs / 2,
      futureMs: periodMs / 2,
      stepMs: STEP_MS,
    })
    const expected = Math.round(periodMs / STEP_MS) + 1
    expect(Math.abs(track.length - expected)).toBeLessThanOrEqual(1)
    expect(track[0].epochMs).toBe(EPOCH_MS - periodMs / 2)
    expect(track[track.length - 1].epochMs).toBe(EPOCH_MS + periodMs / 2)
  })

  it('keeps latitude within the inclination and reaches it over a full orbit', () => {
    const track = sampleGroundTrack(engine, EPOCH_MS, {
      pastMs: 0,
      futureMs: periodMs,
      stepMs: STEP_MS,
    })
    const maxLat = Math.max(...track.map((p) => Math.abs(p.latitude)))
    for (const p of track) {
      expect(Math.abs(p.latitude)).toBeLessThanOrEqual(INCLINATION_DEG + 0.2)
    }
    expect(Math.abs(maxLat - INCLINATION_DEG)).toBeLessThan(1)
  })

  it('centre sample equals direct propagation + geodetic conversion', () => {
    const track = sampleGroundTrack(engine, EPOCH_MS, {
      pastMs: 15 * 60_000,
      futureMs: 15 * 60_000,
      stepMs: STEP_MS,
    })
    const centre = track.find((p) => p.epochMs === EPOCH_MS)
    expect(centre).toBeDefined()
    const teme = engine.propagateAt(EPOCH_MS)!
    const gmst = computeGMST(EPOCH_MS / 86_400_000 + UNIX_EPOCH_JULIAN)
    const expected = temeToGeodetic(teme, gmst)
    expect(centre!.latitude).toBeCloseTo(expected.latitude, 9)
    expect(centre!.longitude).toBeCloseTo(expected.longitude, 9)
    // ECEF radius is frame-independent: matches the TEME radius.
    const r = Math.hypot(centre!.ecef.x, centre!.ecef.y, centre!.ecef.z)
    expect(r).toBeCloseTo(Math.hypot(teme.x, teme.y, teme.z), 6)
  })

  it('is continuous: 30 s apart moves < 3 deg in latitude, longitudes stay in range', () => {
    const track = sampleGroundTrack(engine, EPOCH_MS, {
      pastMs: periodMs / 2,
      futureMs: periodMs / 2,
      stepMs: STEP_MS,
    })
    for (let i = 1; i < track.length; i++) {
      expect(Math.abs(track[i].latitude - track[i - 1].latitude)).toBeLessThan(3)
    }
    for (const p of track) {
      expect(p.longitude).toBeGreaterThanOrEqual(-180)
      expect(p.longitude).toBeLessThanOrEqual(180)
    }
  })

  it('drifts west by ~22-25 deg per orbit (Earth rotation)', () => {
    const start = sampleGroundTrack(engine, EPOCH_MS, { pastMs: 0, futureMs: 0, stepMs: STEP_MS })[0]
    const end = sampleGroundTrack(engine, EPOCH_MS + periodMs, { pastMs: 0, futureMs: 0, stepMs: STEP_MS })[0]
    const drift = lonDiff(start.longitude, end.longitude)
    expect(drift).toBeLessThan(-22)
    expect(drift).toBeGreaterThan(-25)
  })

  it('skips samples whose propagation fails, without throwing', () => {
    const failFrom = EPOCH_MS + 10 * 60_000
    const stub = {
      propagateAt: (ms: number) => (ms >= failFrom ? null : engine.propagateAt(ms)),
    }
    let track: ReturnType<typeof sampleGroundTrack> = []
    expect(() => {
      track = sampleGroundTrack(stub, EPOCH_MS, {
        pastMs: 0,
        futureMs: 20 * 60_000,
        stepMs: STEP_MS,
      })
    }).not.toThrow()
    expect(track.length).toBeGreaterThan(0)
    expect(track.length).toBeLessThan(41)
    expect(track.every((p) => p.epochMs < failFrom)).toBe(true)
  })

  it('returns an empty list for a degenerate request', () => {
    expect(
      sampleGroundTrack(engine, EPOCH_MS, { pastMs: 0, futureMs: 1000, stepMs: 0 }),
    ).toEqual([])
  })
})
