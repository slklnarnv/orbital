import { create } from 'zustand'
import { telemetryBus } from '@/core/telemetry/TelemetryEventBus'
import { issEntity } from '@/core/entities/ISSEntity'
import { ShadowForecaster, type GeometryAt } from '@/core/orbital/EclipseForecast'
import { sunDirectionTEME } from '@/core/orbital/CoordinateConversions'
import { UNIX_EPOCH_JULIAN } from '@/utils/constants'
import type { TelemetryMode, NetworkStatus, OrbitalState } from '@/types/orbital'

interface TelemetryStore {
  mode: TelemetryMode
  networkStatus: NetworkStatus
  tleAgeHours: number
  confidence: number
  // Last known lat/lon/alt — updated at most 1/sec for UI
  latitude: number
  longitude: number
  altitude: number
  speed: number
  orbitalPeriod: number
  inclination: number
  /** Sunlit now (null until a forecast exists) */
  sunlit: boolean | null
  /** Simulation milliseconds until the next sunlit flip (null: unknown or none in horizon) */
  shadowTransitionInMs: number | null
}

export const useTelemetryStore = create<TelemetryStore>(() => ({
  mode: 'OFFLINE',
  // Node 20 (CI) has no global navigator; only the browser does.
  networkStatus: { online: typeof navigator !== 'undefined' ? navigator.onLine : true, lastSuccessfulFetch: null, consecutiveFailures: 0 },
  tleAgeHours: 0,
  confidence: 0,
  latitude: 0,
  longitude: 0,
  altitude: 408,
  speed: 7.66,
  orbitalPeriod: 92.68,
  inclination: 51.64,
  sunlit: null,
  shadowTransitionInMs: null,
}))

// Built lazily on first use so importing the store never touches the entity.
let _forecaster: ShadowForecaster | null = null

function getForecaster(): ShadowForecaster {
  if (!_forecaster) {
    // Both TEME, so position and Sun direction are frame-consistent.
    const geometryAt: GeometryAt = (ms) => {
      const position = issEntity.engine.propagateAt(ms)
      if (!position) return null
      return { position, sunDir: sunDirectionTEME(ms / 86_400_000 + UNIX_EPOCH_JULIAN) }
    }
    _forecaster = new ShadowForecaster(geometryAt)
  }
  return _forecaster
}

// Throttled UI update — at most once per second
let _lastUiUpdate = 0

export function initTelemetryStoreListeners(): () => void {
  const unsubMode = telemetryBus.on('MODE_CHANGE', (mode) => {
    useTelemetryStore.setState({ mode })
  })

  const unsubNetwork = telemetryBus.on('NETWORK_STATUS', (networkStatus) => {
    useTelemetryStore.setState({ networkStatus })
  })

  const unsubState = telemetryBus.on('STATE_UPDATE', (state: OrbitalState) => {
    const now = Date.now()
    if (now - _lastUiUpdate < 1000) return // throttle to 1 Hz for UI
    _lastUiUpdate = now
    const tle = issEntity.currentTLE
    const key = tle ? tle.line1 + tle.line2 : ''
    const forecast = key ? getForecaster().update(state.timestamp, key) : null
    useTelemetryStore.setState({
      tleAgeHours: state.tleAgeHours,
      confidence: state.confidence,
      latitude: state.latitude,
      longitude: state.longitude,
      altitude: state.altitude,
      speed: state.speed,
      orbitalPeriod: state.orbitalPeriod,
      inclination: state.inclination,
      sunlit: forecast?.sunlit ?? null,
      shadowTransitionInMs:
        forecast?.transitionMs != null ? Math.max(0, forecast.transitionMs - state.timestamp) : null,
    })
  })

  return () => {
    unsubMode()
    unsubNetwork()
    unsubState()
  }
}
