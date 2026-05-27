import { create } from 'zustand'
import { telemetryBus } from '@/core/telemetry/TelemetryEventBus'
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
}

export const useTelemetryStore = create<TelemetryStore>(() => ({
  mode: 'OFFLINE',
  networkStatus: { online: navigator.onLine, lastSuccessfulFetch: null, consecutiveFailures: 0 },
  tleAgeHours: 0,
  confidence: 0,
  latitude: 0,
  longitude: 0,
  altitude: 408,
  speed: 7.66,
  orbitalPeriod: 92.68,
  inclination: 51.64,
}))

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
    useTelemetryStore.setState({
      tleAgeHours: state.tleAgeHours,
      confidence: state.confidence,
      latitude: state.latitude,
      longitude: state.longitude,
      altitude: state.altitude,
      speed: state.speed,
      orbitalPeriod: state.orbitalPeriod,
      inclination: state.inclination,
    })
  })

  return () => {
    unsubMode()
    unsubNetwork()
    unsubState()
  }
}
