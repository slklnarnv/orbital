import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { simulationClock } from '@/core/clock/SimulationClock'
import { useTelemetryStore } from '@/stores/telemetryStore'
import { useGeoStore } from '@/stores/geoStore'
import {
  GeoLookupService,
  type PlaceResolver,
  cellKeyFor,
  describeWeatherCode,
  formatLocalClock,
  isGeoSnapshot,
  weatherFromOpenMeteo,
} from '@/core/geo/GeoLookupService'

const JAPAN = { placeName: 'Japan', continent: 'Asia' }

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

  it('labels a known code', () => {
    expect(describeWeatherCode(2)).toBe('Partly cloudy')
  })

  it('never resolves inherited prototype members or non-integers', () => {
    expect(describeWeatherCode('toString' as unknown as number)).toBe('—')
    expect(describeWeatherCode(2.5)).toBe('—')
  })
})

describe('isGeoSnapshot', () => {
  const VALID = {
    placeName: 'Japan',
    continent: 'Asia',
    timezone: 'Asia/Tokyo',
    tzAbbreviation: 'JST',
    utcOffsetSeconds: 32400,
    temperatureC: 21.4,
    weatherCode: 2,
    fetchedAt: 1_700_000_000_000,
    placeFetchedAt: 1_700_000_000_000,
    weatherFetchedAt: 1_700_000_000_000,
  }

  it('accepts a valid row and an old-schema row without the per-field stamps', () => {
    expect(isGeoSnapshot(VALID)).toBe(true)
    const { placeFetchedAt: _p, weatherFetchedAt: _w, ...oldSchema } = VALID
    expect(isGeoSnapshot(oldSchema)).toBe(true)
  })

  it('accepts null fields', () => {
    expect(isGeoSnapshot({
      ...VALID,
      placeName: null,
      continent: null,
      timezone: null,
      tzAbbreviation: null,
      utcOffsetSeconds: null,
      temperatureC: null,
      weatherCode: null,
      weatherFetchedAt: null,
    })).toBe(true)
  })

  it('rejects wrong types and out-of-range values', () => {
    expect(isGeoSnapshot({ ...VALID, placeName: {} })).toBe(false)
    expect(isGeoSnapshot({ ...VALID, weatherCode: '2' })).toBe(false)
    expect(isGeoSnapshot({ ...VALID, weatherCode: 2.5 })).toBe(false)
    expect(isGeoSnapshot({ ...VALID, utcOffsetSeconds: 1e9 })).toBe(false)
    expect(isGeoSnapshot({ ...VALID, temperatureC: 500 })).toBe(false)
    expect(isGeoSnapshot({ ...VALID, placeName: 'x'.repeat(121) })).toBe(false)
    expect(isGeoSnapshot({ ...VALID, fetchedAt: Number.NaN })).toBe(false)
    expect(isGeoSnapshot({ ...VALID, weatherFetchedAt: '1' })).toBe(false)
    expect(isGeoSnapshot(null)).toBe(false)
    expect(isGeoSnapshot('row')).toBe(false)
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
  let placeMock: ReturnType<typeof vi.fn<PlaceResolver>>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 8, 28, 12, 0, 0))
    useTelemetryStore.setState(useTelemetryStore.getInitialState(), true)
    useGeoStore.setState(useGeoStore.getInitialState(), true)
    simulationClock.setMode('REALTIME')
    simulationClock.setTimeScale(1)

    // Both sources answer, so a passed gate performs real lookups and the
    // limiters record successes (no backoff skew).
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        timezone: 'Asia/Tokyo',
        timezone_abbreviation: 'JST',
        utc_offset_seconds: 32400,
        current: { temperature_2m: 21.4, weather_code: 2 },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    placeMock = vi.fn<PlaceResolver>(async () => JAPAN)

    service = new GeoLookupService(placeMock)
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
    expect(placeMock).not.toHaveBeenCalled()

    simulationClock.setMode('REALTIME')
    await vi.advanceTimersByTimeAsync(6_000)
    // Place + weather for the cell.
    expect(placeMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fills in once per cell while paused, so a paused seek gets its fix', async () => {
    service.start()
    useTelemetryStore.setState(TOKYO)
    simulationClock.setMode('PAUSED')

    await vi.advanceTimersByTimeAsync(3_000 + 6_000)
    expect(placeMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Seek to a different ground cell while paused: a fill-in fires for the
    // NEW cell. (The weather limiter may delay its half by a tick, so assert
    // on the call targets, not an exact count.)
    useTelemetryStore.setState(BUENOS_AIRES)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(placeMock).toHaveBeenCalledWith(BUENOS_AIRES.latitude, BUENOS_AIRES.longitude)
    const targets = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(targets.some((url) => url.includes('latitude=-33.87'))).toBe(true)
  })

  it('retries a failed place lookup for a cell whose weather was cached', async () => {
    // First place lookup fails (the index did not load); weather succeeds and
    // caches the cell with placeName null. The cached entry must not pin "—"
    // for the place TTL.
    placeMock.mockRejectedValueOnce(new Error('index unavailable'))

    service.start()
    useTelemetryStore.setState(TOKYO)

    await vi.advanceTimersByTimeAsync(3_000 + 1_000)
    expect(placeMock).toHaveBeenCalledTimes(1)
    expect(useGeoStore.getState().placeName).toBeNull()

    // Past the place limiter's failure backoff the place is re-requested.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(placeMock).toHaveBeenCalledTimes(2)
    expect(useGeoStore.getState().placeName).toBe('Japan')
  })

  it('skips lookups while the tab is hidden and resumes when visible', async () => {
    const doc = { visibilityState: 'hidden' as DocumentVisibilityState }
    vi.stubGlobal('document', doc)
    service.start()
    useTelemetryStore.setState(TOKYO)

    await vi.advanceTimersByTimeAsync(3_000 + 21_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(placeMock).not.toHaveBeenCalled()

    doc.visibilityState = 'visible'
    await vi.advanceTimersByTimeAsync(6_000)
    expect(placeMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('GeoLookupService freshness and clock', () => {
  const TOKYO = { latitude: 35.68, longitude: 139.77 }
  const BUENOS_AIRES = { latitude: -33.87, longitude: -58.04 }
  const MINUTE = 60_000

  const WEATHER_OK = {
    timezone: 'Asia/Tokyo',
    timezone_abbreviation: 'JST',
    utc_offset_seconds: 32400,
    current: { temperature_2m: 21.4, weather_code: 2 },
  }
  let service: GeoLookupService
  let fetchMock: ReturnType<typeof vi.fn>
  let placeMock: ReturnType<typeof vi.fn<PlaceResolver>>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 8, 28, 12, 0, 0))
    useTelemetryStore.setState(useTelemetryStore.getInitialState(), true)
    useGeoStore.setState(useGeoStore.getInitialState(), true)
    simulationClock.setMode('REALTIME')
    simulationClock.setTimeScale(1)

    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    placeMock = vi.fn<PlaceResolver>(async () => JAPAN)
    service = new GeoLookupService(placeMock)
  })

  afterEach(() => {
    service.stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('does not carry the previous cell\'s local time onto a cell without an offset', async () => {
    let weatherFails = false
    fetchMock.mockImplementation(async () => (weatherFails
      ? { ok: false, status: 503, json: async () => ({}) }
      : { ok: true, json: async () => WEATHER_OK }))

    service.start()
    useTelemetryStore.setState(TOKYO)
    await vi.advanceTimersByTimeAsync(3_000 + 6_000)
    expect(useGeoStore.getState().localTime).toBe('21:00')

    // New cell: place answers, weather (and with it the UTC offset) does not.
    weatherFails = true
    useTelemetryStore.setState(BUENOS_AIRES)
    await vi.advanceTimersByTimeAsync(30_000)

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('open-meteo') && url.includes('latitude=-33.87'))).toBe(true)
    expect(placeMock).toHaveBeenCalledWith(BUENOS_AIRES.latitude, BUENOS_AIRES.longitude)
    const state = useGeoStore.getState()
    expect(state.snapshot?.utcOffsetSeconds).toBeNull()
    expect(state.localTime).toBeNull()
  })

  it('hides weather older than an hour but keeps the place', async () => {
    let weatherFails = false
    fetchMock.mockImplementation(async () => (weatherFails
      ? { ok: false, status: 503, json: async () => ({}) }
      : { ok: true, json: async () => WEATHER_OK }))

    service.start()
    useTelemetryStore.setState(TOKYO)
    await vi.advanceTimersByTimeAsync(3_000 + 6_000)
    expect(useGeoStore.getState().temperatureC).toBe(21.4)

    weatherFails = true
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    // Past the 15 min refetch TTL but inside the hour: still shown.
    expect(useGeoStore.getState().weatherLabel).toBe('Partly cloudy')

    await vi.advanceTimersByTimeAsync(31 * MINUTE)
    const state = useGeoStore.getState()
    expect(state.temperatureC).toBeNull()
    expect(state.weatherLabel).toBeNull()
    expect(state.placeName).toBe('Japan')
    expect(state.localTime).not.toBeNull()
  })

  it('does not let a place refetch make old weather displayable again', async () => {
    let weatherCalls = 0
    fetchMock.mockImplementation(async () => {
      weatherCalls += 1
      if (weatherCalls > 1) return { ok: false, status: 503, json: async () => ({}) }
      return { ok: true, json: async () => WEATHER_OK }
    })
    // Place keeps failing until the weather is past the display window.
    placeMock.mockImplementation(async () => {
      if (Date.now() < Date.UTC(2026, 8, 28, 12, 0, 0) + 61 * MINUTE) throw new Error('index unavailable')
      return JAPAN
    })

    service.start()
    useTelemetryStore.setState(TOKYO)
    await vi.advanceTimersByTimeAsync(3_000 + 6_000)
    expect(useGeoStore.getState().weatherLabel).toBe('Partly cloudy')
    expect(useGeoStore.getState().placeName).toBeNull()

    await vi.advanceTimersByTimeAsync(72 * MINUTE)
    const state = useGeoStore.getState()
    expect(state.placeName).toBe('Japan')
    expect(state.weatherLabel).toBeNull()
    expect(state.temperatureC).toBeNull()
    // The place fetch advanced only its own stamp.
    expect(state.snapshot?.placeFetchedAt).toBeGreaterThan(state.snapshot?.weatherFetchedAt ?? Infinity)
  })
})

describe('GeoLookupService default place source', () => {
  const TOKYO = { latitude: 35.68, longitude: 139.77 }
  const INDEX_JSON = readFileSync(path.resolve(__dirname, '../../../src/data/place-index.json'), 'utf8')

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('names the cell from the same-origin place index, never a geocoding API', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 8, 28, 12, 0, 0))
    useTelemetryStore.setState(useTelemetryStore.getInitialState(), true)
    useGeoStore.setState(useGeoStore.getInitialState(), true)
    simulationClock.setMode('REALTIME')

    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('place-index')) return { ok: true, json: async () => JSON.parse(INDEX_JSON) }
      return {
        ok: true,
        json: async () => ({
          timezone: 'Asia/Tokyo',
          timezone_abbreviation: 'JST',
          utc_offset_seconds: 32400,
          current: { temperature_2m: 21.4, weather_code: 2 },
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const service = new GeoLookupService()
    service.start()
    useTelemetryStore.setState(TOKYO)
    await vi.advanceTimersByTimeAsync(3_000 + 1_000)
    service.stop()

    expect(useGeoStore.getState().placeName).toBe('Japan')
    expect(useGeoStore.getState().continent).toBe('Asia')
    const hosts = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => /^https?:/.test(url))
      .map((url) => new URL(url).host)
    expect(hosts).toEqual(['api.open-meteo.com'])
  })
})
