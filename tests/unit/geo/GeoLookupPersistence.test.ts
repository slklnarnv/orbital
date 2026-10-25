import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory stand-in for IndexedDB, which does not exist in the node test env.
const { store, delSpy } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  delSpy: vi.fn(),
}))

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
  del: vi.fn(async (key: string) => {
    delSpy(key)
    store.delete(key)
  }),
  delMany: vi.fn(async (keys: string[]) => { for (const key of keys) store.delete(key) }),
  entries: vi.fn(async () => [...store.entries()]),
}))

import { simulationClock } from '@/core/clock/SimulationClock'
import { useTelemetryStore } from '@/stores/telemetryStore'
import { useGeoStore } from '@/stores/geoStore'
import { GeoLookupService, isGeoSnapshot, type PlaceResolver } from '@/core/geo/GeoLookupService'

describe('GeoLookupService persisted cells', () => {
  const TOKYO = { latitude: 35.68, longitude: 139.77 }
  const KEY = 'geo_v2_36,140' // Tokyo's 2-degree cell
  const LEGACY_KEY = 'geo_cell_36,140' // the same cell, written in the BigDataCloud era

  let service: GeoLookupService
  let fetchMock: ReturnType<typeof vi.fn>
  let placeMock: ReturnType<typeof vi.fn<PlaceResolver>>

  beforeEach(() => {
    store.clear()
    delSpy.mockClear()
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 8, 28, 12, 0, 0))
    useTelemetryStore.setState(useTelemetryStore.getInitialState(), true)
    useGeoStore.setState(useGeoStore.getInitialState(), true)
    simulationClock.setMode('REALTIME')
    simulationClock.setTimeScale(1)

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
    placeMock = vi.fn<PlaceResolver>(async () => ({ placeName: 'Japan', continent: 'Asia' }))

    service = new GeoLookupService(placeMock)
  })

  afterEach(() => {
    service.stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('drops a corrupt persisted cell and refetches instead of throwing', async () => {
    store.set(KEY, {
      placeName: { evil: true },
      continent: null,
      timezone: null,
      tzAbbreviation: null,
      utcOffsetSeconds: null,
      temperatureC: null,
      weatherCode: 'toString',
      fetchedAt: Date.now(),
    })

    service.start()
    useTelemetryStore.setState(TOKYO)
    await vi.advanceTimersByTimeAsync(3_000 + 6_000)

    expect(delSpy).toHaveBeenCalledWith(KEY)
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(placeMock).toHaveBeenCalledTimes(1)
    expect(urls.some((url) => url.includes('open-meteo'))).toBe(true)

    // The cell was rewritten from the live answers, and the HUD shows them.
    expect(isGeoSnapshot(store.get(KEY))).toBe(true)
    const state = useGeoStore.getState()
    expect(state.placeName).toBe('Japan')
    expect(state.weatherLabel).toBe('Partly cloudy')
  })

  it('serves a valid persisted cell without fetching the place again', async () => {
    store.set(KEY, {
      placeName: 'Japan',
      continent: 'Asia',
      timezone: 'Asia/Tokyo',
      tzAbbreviation: 'JST',
      utcOffsetSeconds: 32400,
      temperatureC: 18,
      weatherCode: 61,
      fetchedAt: Date.now(),
      placeFetchedAt: Date.now(),
      weatherFetchedAt: Date.now(),
    })

    service.start()
    useTelemetryStore.setState(TOKYO)
    await vi.advanceTimersByTimeAsync(3_000 + 1_000)

    expect(delSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(placeMock).not.toHaveBeenCalled()
    expect(useGeoStore.getState().weatherLabel).toBe('Rain')
  })

  it('prunes BigDataCloud-era rows and names the cell from the place index', async () => {
    store.set(LEGACY_KEY, {
      placeName: 'Pacific Ocean',
      continent: null,
      timezone: 'Asia/Tokyo',
      tzAbbreviation: 'JST',
      utcOffsetSeconds: 32400,
      temperatureC: 18,
      weatherCode: 61,
      fetchedAt: Date.now(),
    })

    service.start()
    useTelemetryStore.setState(TOKYO)
    await vi.advanceTimersByTimeAsync(3_000 + 1_000)

    expect(store.has(LEGACY_KEY)).toBe(false)
    expect(placeMock).toHaveBeenCalledTimes(1)
    expect(useGeoStore.getState().placeName).toBe('Japan')
  })
})
