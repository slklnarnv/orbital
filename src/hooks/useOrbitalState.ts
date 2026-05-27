import { useTelemetryStore } from '@/stores/telemetryStore'
import { useShallow } from 'zustand/react/shallow'
import type { TelemetryMode } from '@/types/orbital'

interface OrbitalStateHookResult {
  latitude: number
  longitude: number
  altitude: number
  speed: number
  mode: TelemetryMode
  confidence: number
  tleAgeHours: number
  orbitalPeriod: number
  inclination: number
}

/**
 * React hook to retrieve the current 1Hz-throttled orbital state from the Telemetry store.
 * Safe for UI components as it relies on throttled store updates and returns a stable
 * shallow projection of the store state to prevent unnecessary cascading renders.
 */
export function useOrbitalState(): OrbitalStateHookResult {
  return useTelemetryStore(
    useShallow((state) => ({
      latitude: state.latitude,
      longitude: state.longitude,
      altitude: state.altitude,
      speed: state.speed,
      mode: state.mode,
      confidence: state.confidence,
      tleAgeHours: state.tleAgeHours,
      orbitalPeriod: state.orbitalPeriod,
      inclination: state.inclination,
    }))
  )
}

