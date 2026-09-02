import { create } from 'zustand'
import type { GeoSnapshot } from '@/core/geo/GeoLookupService'

// ─── Geo Store ────────────────────────────────────────────────────────────────
/**
 * Ground-point presentation state: what the station is passing over, the
 * local clock there, and current weather. Written only by GeoLookupService;
 * UI components read it at the 5 s service cadence — never per frame.
 */
interface GeoStoreState {
  /** idle: no data yet · ready: showing facts · unavailable: network said no */
  status: 'idle' | 'ready' | 'unavailable'
  snapshot: GeoSnapshot | null
  placeName: string | null
  continent: string | null
  /** "HH:MM" at the ground point, refreshed each service tick */
  localTime: string | null
  tzAbbr: string | null
  temperatureC: number | null
  /** WMO code resolved to HUD vocabulary */
  weatherLabel: string | null
  updatedAt: number | null
}

export const useGeoStore = create<GeoStoreState>(() => ({
  status: 'idle',
  snapshot: null,
  placeName: null,
  continent: null,
  localTime: null,
  tzAbbr: null,
  temperatureC: null,
  weatherLabel: null,
  updatedAt: null,
}))
