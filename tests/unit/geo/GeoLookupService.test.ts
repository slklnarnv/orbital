import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { simulationClock } from '@/core/clock/SimulationClock'
import { useTelemetryStore } from '@/stores/telemetryStore'
import { useGeoStore } from '@/stores/geoStore'
import {
  GeoLookupService,
  cellKeyFor,
  describeWeatherCode,
  formatLocalClock,
  placeFromBigDataCloud,
  weatherFromOpenMeteo,
} from '@/core/geo/GeoLookupService'

describe('cellKeyFor', () => {
  it('snaps a position onto its 2-degree ground cell', () => {
    expect(cellKeyFor(51.64, 170.71)).toBe('52,170')
  })

  it('handles the southern and western hemispheres', () => {
    expect(cellKeyFor(-33.87, -58.04)).toBe('-34,-58')
  })

  it('wraps longitude snapping without exceeding ±180', () => {
    // 179.9 rounds to the 180 cell — rendering only; cache key is stable either way
    const key = cellKeyFor(10.0, 179.9)
    expect(key).toBe('10,180')
  })
})

describe('placeFromBigDataCloud', () => {
  it('resolves the marine region from locality over open water', () => {
    const place = placeFromBigDataCloud({
      continent: '',
      countryName: '',
      locality: 'Pacific Ocean',
    })
    expect(place).toEqual({ placeName: 'Pacific Ocean', continent: null })
  })

  it('names the country and continent over land', () => {
    const place = placeFromBigDataCloud({
      continent: 'Asia',
      countryName: 'Japan',
      locality: 'Shibuya',
    })
    expect(place).toEqual({ placeName: 'Japan', continent: 'Asia' })
  })

  it('prefers the country over the finer locality', () => {
    const place = placeFromBigDataCloud({
      continent: 'Europe',
      countryName: 'United Kingdom',
      locality: 'England',
    })
    expect(place).toEqual({ placeName: 'United Kingdom', continent: 'Europe' })
  })

  it('returns null for empty or malformed payloads', () => {
    expect(placeFromBigDataCloud({ countryName: '', locality: '' })).toBeNull()
    expect(placeFromBigDataCloud({ error: true })).toBeNull()
    expect(placeFromBigDataCloud(null)).toBeNull()
  })
})

describe('weatherFromOpenMeteo', () => {
  it('extracts weather and timezone facts', () => {
    const wx = weatherFromOpenMeteo({
      timezone: 'Asia/Tokyo',
      timezone_abbreviation: 'JST',
      utc_offset_seconds: 32400,
      current: { temperature_2m: 21.4, weather_code: 2 },
    })
    expect(wx).toEqual({
      timezone: 'Asia/Tokyo',
      tzAbbreviation: 'JST',
      utcOffsetSeconds: 32400,
      temperatureC: 21.4,
      weatherCode: 2,
    })
  })

  it('returns null when the current block is missing or non-numeric', () => {
    expect(weatherFromOpenMeteo({ error: true })).toBeNull()
    expect(weatherFromOpenMeteo({ current: { temperature_2m: '21' } })).toBeNull()
    expect(weatherFromOpenMeteo(null)).toBeNull()
  })
})

describe('describeWeatherCode', () => {
  it('maps WMO codes to HUD vocabulary', () => {
    expect(describeWeatherCode(0)).toBe('Clear')
    expect(describeWeatherCode(61)).toBe('Rain')
    expect(describeWeatherCode(95)).toBe('Thunderstorm')
  })

  it('degrades unknown codes to an em dash', () => {
    expect(describeWeatherCode(142)).toBe('—')
  })
})

describe('formatLocalClock', () => {
  it('shifts the UTC clock by the ground-point offset', () => {
    const epochMs = Date.UTC(2026, 8, 2, 14, 32, 0)
    expect(formatLocalClock(epochMs, 0)).toBe('14:32')
    expect(formatLocalClock(epochMs, 9 * 3600)).toBe('23:32')
  })

  it('rolls across the date boundary without leaking it into the time', () => {
    const epochMs = Date.UTC(2026, 8, 2, 23, 59, 0)
    expect(formatLocalClock(epochMs, 3600)).toBe('00:59')
  })
})

describe('GeoLookupService time-control gate', () => {
  const TOKYO = { latitude: 35.68, longitude: 139.77 }
  const BUENOS_AIRES = { latitude: -33.87, longitude: -58.04 }

  let service: GeoLookupService
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 8, 28, 12, 0, 0))
    useTelemetryStore.setState(useTelemetryStore.getInitialState(), true)
    useGeoStore.setState(useGeoStore.getInitialState(), true)
    simulationClock.setMode('REALTIME')
    simulationClock.setTimeScale(1)

    // One mock answers both endpoints so a passed gate performs real
    // fetches and the limiters record successes (no backoff skew).
    fetchMock = vi.fn(async (url: unknown) => {
      const payload = String(url).includes('open-meteo')
        ? {
            timezone: 'Asia/Tokyo',
            timezone_abbreviation: 'JST',
            utc_offset_seconds: 32400,
            current: { temperature_2m: 21.4, weather_code: 2 },
          }
        : { countryName: 'Japan', continent: 'Asia', locality: '' }
      return { ok: true, json: async () => payload }
    })
    vi.stubGlobal('fetch', fetchMock)

    service = new GeoLookupService()
  })

  afterEach(() => {
    service.stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('suppresses lookups while time is accelerated and resumes in Live', async () => {
    simulationClock.setMode('ACCELERATED')
    service.start()
    useTelemetryStore.setState(TOKYO) // latches the real-fix flag via subscribe

    await vi.advanceTimersByTimeAsync(3_000 + 21_000)
    expect(fetchMock).not.toHaveBeenCalled()

    simulationClock.setMode('REALTIME')
    await vi.advanceTimersByTimeAsync(6_000)
    expect(fetchMock.mock.calls.length).toBe(2) // place + weather for the cell
  })

  it('fills in once per cell while paused, so a paused seek gets its fix', async () => {
    service.start()
    useTelemetryStore.setState(TOKYO)
    simulationClock.setMode('PAUSED')

    await vi.advanceTimersByTimeAsync(3_000 + 6_000)
    expect(fetchMock.mock.calls.length).toBe(2)

    // Seek to a different ground cell while paused: a fill-in fires for the
    // NEW cell. (The geo/weather limiters may split it across ticks — the
    // weather limiter's interval is shorter — so assert on the call targets,
    // not an exact count.)
    const callsAfterFirstCell = fetchMock.mock.calls.length
    useTelemetryStore.setState(BUENOS_AIRES)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstCell)
    const targets = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(targets.some((url) => url.includes('latitude=-33.87'))).toBe(true)
  })

  it('retries a failed place lookup for a cell whose weather was cached', async () => {
    // First place request fails; weather succeeds and caches the cell with
    // placeName null. The cached entry must not pin "—" for the place TTL.
    let placeCalls = 0
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes('open-meteo')) {
        return {
          ok: true,
          json: async () => ({
            timezone: 'Asia/Tokyo',
            timezone_abbreviation: 'JST',
            utc_offset_seconds: 32400,
            current: { temperature_2m: 21.4, weather_code: 2 },
          }),
        }
      }
      placeCalls += 1
      if (placeCalls === 1) return { ok: false, status: 503, json: async () => ({}) }
      return { ok: true, json: async () => ({ countryName: 'Japan', continent: 'Asia', locality: '' }) }
    })

    service.start()
    useTelemetryStore.setState(TOKYO)

    await vi.advanceTimersByTimeAsync(3_000 + 1_000)
    expect(placeCalls).toBe(1)
    expect(useGeoStore.getState().placeName).toBeNull()

    // Past the geo limiter's failure backoff the place is re-requested.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(placeCalls).toBe(2)
    expect(useGeoStore.getState().placeName).toBe('Japan')
  })

  it('skips lookups while the tab is hidden and resumes when visible', async () => {
    const doc = { visibilityState: 'hidden' as DocumentVisibilityState }
    vi.stubGlobal('document', doc)
    service.start()
    useTelemetryStore.setState(TOKYO)

    await vi.advanceTimersByTimeAsync(3_000 + 21_000)
    expect(fetchMock).not.toHaveBeenCalled()

    doc.visibilityState = 'visible'
    await vi.advanceTimersByTimeAsync(6_000)
    expect(fetchMock.mock.calls.length).toBe(2)
  })
})
