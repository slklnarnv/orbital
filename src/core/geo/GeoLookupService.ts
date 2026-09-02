import { get, set } from 'idb-keyval'
import { ApiRateLimiter } from '@/core/api/ApiRateLimiter'
import { useTelemetryStore } from '@/stores/telemetryStore'
import { useGeoStore } from '@/stores/geoStore'

// ─── Geo Lookup Service ───────────────────────────────────────────────────────
/**
 * Answers "what is the station passing over right now": place name
 * (country + continent, or ocean/sea), local time at the ground point, and
 * current weather.
 *
 * Two free, keyless, CORS-enabled services, queried sparingly:
 *  - BigDataCloud reverse-geocode-client — place naming; over water its
 *    locality resolves to the marine region ("Pacific Ocean"), over land to
 *    the country, with the continent alongside
 *  - Open-Meteo forecast — weather + IANA timezone + UTC offset
 *
 * Results are cached per ground-track cell (2° grid) in memory and IndexedDB,
 * so revisited ground persists across sessions and the services see roughly
 * one request pair per ~30 s of flight — well inside their fair-use policies.
 * Every failure path degrades silently: the HUD keeps showing the last good
 * snapshot and the service retries on backoff.
 *
 * DEPLOYMENT NOTE: this app is hosted on Vercel, and telemetry fetches go
 * through a same-origin serverless proxy (api/tle.ts) because end-user
 * networks can be unreliable. These two lookups currently fetch
 * direct-from-browser (both providers are CORS-open). If field reliability
 * becomes a problem, add an api/geo.ts proxy following the api/tle.ts
 * pattern and flip this service to proxy-first — see docs/HANDOFF.md.
 */

const GEOCODE_ENDPOINT = 'https://api.bigdatacloud.net/data/reverse-geocode-client'
const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

const CELL_DEG = 2
const GEO_CELL_TTL_MS = 30 * 24 * 60 * 60 * 1000   // place names are stable
const WX_CELL_TTL_MS = 15 * 60 * 1000              // weather is not
const TICK_INTERVAL_MS = 5_000
const FIRST_TICK_DELAY_MS = 3_000                  // let telemetry leave its 0,0 seed
const FETCH_TIMEOUT_MS = 9_000

const IDB_KEY_PREFIX = 'geo_cell_'

// ─── WMO weather codes → HUD vocabulary ───────────────────────────────────────

const WEATHER_LABELS: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Snow',
  77: 'Snow',
  80: 'Showers',
  81: 'Showers',
  82: 'Showers',
  85: 'Snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
}

export function describeWeatherCode(code: number): string {
  return WEATHER_LABELS[code] ?? '—'
}

// ─── Snapshot shape ───────────────────────────────────────────────────────────

export interface GeoSnapshot {
  /** "Japan" or "North Pacific Ocean" — null when lookup answered nothing */
  placeName: string | null
  /** Continent when over land, else null */
  continent: string | null
  timezone: string | null
  tzAbbreviation: string | null
  utcOffsetSeconds: number | null
  temperatureC: number | null
  weatherCode: number | null
  fetchedAt: number
}

/** Ground-track cell key on a CELL_DEG grid — the cache unit. */
export function cellKeyFor(lat: number, lon: number): string {
  const latCell = Math.round(lat / CELL_DEG) * CELL_DEG
  const lonCell = Math.round(lon / CELL_DEG) * CELL_DEG
  return `${latCell},${lonCell}`
}

/**
 * Extracts the display place from a BigDataCloud reverse-geocode response.
 * Over land: the country with its continent. Over water: the locality field
 * carries the marine region ("Pacific Ocean"). Null when neither is present.
 */
export function placeFromBigDataCloud(payload: unknown): { placeName: string; continent: string | null } | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as { countryName?: unknown; continent?: unknown; locality?: unknown }

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null)

  const country = str(p.countryName)
  if (country) {
    return { placeName: country, continent: str(p.continent) }
  }

  const locality = str(p.locality)
  if (locality) {
    return { placeName: locality, continent: null }
  }

  return null
}

interface OpenMeteoCurrent {
  temperature_2m?: number
  weather_code?: number
}

/**
 * Extracts weather + timezone facts from an Open-Meteo forecast response.
 * Null unless the current block is present and numeric.
 */
export function weatherFromOpenMeteo(payload: unknown): {
  timezone: string | null
  tzAbbreviation: string | null
  utcOffsetSeconds: number | null
  temperatureC: number | null
  weatherCode: number | null
} | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as { current?: unknown; timezone?: unknown; timezone_abbreviation?: unknown; utc_offset_seconds?: unknown }
  const current = p.current as OpenMeteoCurrent | undefined
  if (!current || typeof current !== 'object') return null
  if (typeof current.temperature_2m !== 'number' || typeof current.weather_code !== 'number') return null

  return {
    timezone: typeof p.timezone === 'string' ? p.timezone : null,
    tzAbbreviation: typeof p.timezone_abbreviation === 'string' ? p.timezone_abbreviation : null,
    utcOffsetSeconds: typeof p.utc_offset_seconds === 'number' ? p.utc_offset_seconds : null,
    temperatureC: current.temperature_2m,
    weatherCode: current.weather_code,
  }
}

/** Wall-clock "HH:MM" at the ground point, from epoch + UTC offset. */
export function formatLocalClock(epochMs: number, utcOffsetSeconds: number): string {
  const shifted = new Date(epochMs + utcOffsetSeconds * 1000)
  const hours = shifted.getUTCHours().toString().padStart(2, '0')
  const minutes = shifted.getUTCMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class GeoLookupService {
  private _geoLimiter = new ApiRateLimiter({
    normalIntervalMs: 11_000,   // Nominatim fair use: well under 1 req/s sustained
    baseDelayMs: 30_000,
    maxDelayMs: 10 * 60_000,
  })
  private _wxLimiter = new ApiRateLimiter({
    normalIntervalMs: 10_000,
    baseDelayMs: 15_000,
    maxDelayMs: 10 * 60_000,
  })

  private _memCache = new Map<string, GeoSnapshot>()
  private _timerId: ReturnType<typeof setInterval> | null = null
  private _tickTimeoutId: ReturnType<typeof setTimeout> | null = null
  private _hasRealFix = false
  private _geoInFlight = false
  private _wxInFlight = false
  private _unsubscribe: (() => void) | null = null

  start(): void {
    if (this._timerId !== null) return  // idempotent (StrictMode-style remounts)

    // 0,0 in the store is the pre-telemetry seed, never a fix. Latch on the
    // first update that moves off it, then trust every subsequent position.
    this._unsubscribe = useTelemetryStore.subscribe((state) => {
      if (!this._hasRealFix && (state.latitude !== 0 || state.longitude !== 0)) {
        this._hasRealFix = true
      }
    })

    this._tickTimeoutId = setTimeout(() => {
      this._tick()
      this._timerId = setInterval(() => this._tick(), TICK_INTERVAL_MS)
    }, FIRST_TICK_DELAY_MS)
  }

  stop(): void {
    if (this._tickTimeoutId !== null) {
      clearTimeout(this._tickTimeoutId)
      this._tickTimeoutId = null
    }
    if (this._timerId !== null) {
      clearInterval(this._timerId)
      this._timerId = null
    }
    if (this._unsubscribe !== null) {
      this._unsubscribe()
      this._unsubscribe = null
    }
  }

  private async _tick(): Promise<void> {
    // Local clock refresh comes first — it must keep ticking even when every
    // fetch is cached or in backoff.
    const current = useGeoStore.getState().snapshot
    if (current?.utcOffsetSeconds !== null && current?.utcOffsetSeconds !== undefined) {
      useGeoStore.setState({
        localTime: formatLocalClock(Date.now(), current.utcOffsetSeconds),
      })
    }

    if (!this._hasRealFix) return
    const { latitude, longitude } = useTelemetryStore.getState()
    const cellKey = cellKeyFor(latitude, longitude)

    const cached = await this._lookupCell(cellKey)
    if (cached) {
      this._applySnapshot(cached)
      return
    }

    // New cell (or long-expired): enrich it. Place first — weather seconds
    // behind it is fine, both land on the same 5 s tick eventually.
    if (!this._geoInFlight && this._geoLimiter.shouldRequest()) {
      this._geoInFlight = true
      this._geoLimiter.recordRequest()
      void this._fetchPlace(latitude, longitude, cellKey)
    }
    if (!this._wxInFlight && this._wxLimiter.shouldRequest()) {
      this._wxInFlight = true
      this._wxLimiter.recordRequest()
      void this._fetchWeather(latitude, longitude, cellKey)
    }
  }

  /** Returns a fresh-enough snapshot for the cell from memory or IndexedDB. */
  private async _lookupCell(cellKey: string): Promise<GeoSnapshot | null> {
    const mem = this._memCache.get(cellKey)
    if (mem && Date.now() - mem.fetchedAt <= WX_CELL_TTL_MS) return mem

    if (mem && Date.now() - mem.fetchedAt <= GEO_CELL_TTL_MS) {
      // Place still fresh but weather stale — re-fetch weather only, keep the
      // cached place visible meanwhile.
      if (!this._wxInFlight && this._wxLimiter.shouldRequest()) {
        this._wxInFlight = true
        this._wxLimiter.recordRequest()
        const [lat, lon] = cellKey.split(',').map(Number)
        void this._fetchWeather(lat, lon, cellKey)
      }
      return mem
    }

    try {
      const stored = await get<GeoSnapshot>(`${IDB_KEY_PREFIX}${cellKey}`)
      if (stored && Date.now() - stored.fetchedAt <= GEO_CELL_TTL_MS) {
        this._memCache.set(cellKey, stored)
        // Same split decision as the memory path above.
        if (Date.now() - stored.fetchedAt > WX_CELL_TTL_MS && !this._wxInFlight && this._wxLimiter.shouldRequest()) {
          this._wxInFlight = true
          this._wxLimiter.recordRequest()
          const [lat, lon] = cellKey.split(',').map(Number)
          void this._fetchWeather(lat, lon, cellKey)
        }
        return stored
      }
    } catch {
      // IndexedDB unavailable — memory cache still covers this session
    }

    return null
  }

  private _applySnapshot(snapshot: GeoSnapshot): void {
    const state = useGeoStore.getState()
    useGeoStore.setState({
      status: 'ready',
      snapshot,
      placeName: snapshot.placeName,
      continent: snapshot.continent,
      tzAbbr: snapshot.tzAbbreviation,
      temperatureC: snapshot.temperatureC,
      weatherLabel: snapshot.weatherCode !== null ? describeWeatherCode(snapshot.weatherCode) : null,
      localTime: snapshot.utcOffsetSeconds !== null
        ? formatLocalClock(Date.now(), snapshot.utcOffsetSeconds)
        : state.localTime,
      updatedAt: Date.now(),
    })
  }

  private async _fetchPlace(lat: number, lon: number, cellKey: string): Promise<void> {
    const url = `${GEOCODE_ENDPOINT}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&localityLanguage=en`
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload: unknown = await response.json()

      const place = placeFromBigDataCloud(payload)
      const existing = this._memCache.get(cellKey)
      this._memCache.set(cellKey, {
        placeName: place?.placeName ?? null,
        continent: place?.continent ?? null,
        timezone: existing?.timezone ?? null,
        tzAbbreviation: existing?.tzAbbreviation ?? null,
        utcOffsetSeconds: existing?.utcOffsetSeconds ?? null,
        temperatureC: existing?.temperatureC ?? null,
        weatherCode: existing?.weatherCode ?? null,
        fetchedAt: Date.now(),
      })
      this._geoLimiter.recordSuccess()
      this._persistCell(cellKey)
      this._applySnapshot(this._memCache.get(cellKey)!)
    } catch {
      this._geoLimiter.recordFailure()
      useGeoStore.setState((s) => (s.status === 'idle' ? { status: 'unavailable' } : {}))
    } finally {
      this._geoInFlight = false
    }
  }

  private async _fetchWeather(lat: number, lon: number, cellKey: string): Promise<void> {
    const url = `${OPEN_METEO_ENDPOINT}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,weather_code&timezone=auto`
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload: unknown = await response.json()

      const wx = weatherFromOpenMeteo(payload)
      if (!wx) throw new Error('Malformed payload')
      const existing = this._memCache.get(cellKey)
      this._memCache.set(cellKey, {
        placeName: existing?.placeName ?? null,
        continent: existing?.continent ?? null,
        timezone: wx.timezone,
        tzAbbreviation: wx.tzAbbreviation,
        utcOffsetSeconds: wx.utcOffsetSeconds,
        temperatureC: wx.temperatureC,
        weatherCode: wx.weatherCode,
        // Weather freshness governs the whole entry's cache clock, so a fresh
        // weather read refreshes fetchedAt even when the place came from IDB.
        fetchedAt: Date.now(),
      })
      this._wxLimiter.recordSuccess()
      this._persistCell(cellKey)
      this._applySnapshot(this._memCache.get(cellKey)!)
    } catch {
      this._wxLimiter.recordFailure()
      useGeoStore.setState((s) => (s.status === 'idle' ? { status: 'unavailable' } : {}))
    } finally {
      this._wxInFlight = false
    }
  }

  private _persistCell(cellKey: string): void {
    const snapshot = this._memCache.get(cellKey)
    if (!snapshot) return
    void set(`${IDB_KEY_PREFIX}${cellKey}`, snapshot).catch(() => { /* silent */ })
  }
}

export const geoLookupService = new GeoLookupService()
