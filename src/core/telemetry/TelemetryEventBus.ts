import type { OrbitalState, TLEData, TelemetryMode, NetworkStatus } from '@/types/orbital'

// ─── Event Types ─────────────────────────────────────────────────────────────
export type TelemetryEventMap = {
  'STATE_UPDATE':    OrbitalState
  'TLE_REFRESHED':   { entityId: string; tle: TLEData }
  'MODE_CHANGE':     TelemetryMode
  'API_ERROR':       { source: string; error: Error }
  'NETWORK_STATUS':  NetworkStatus
  'DRIFT_DETECTED':  { entityId: string; driftKm: number }
}

export type TelemetryEventType = keyof TelemetryEventMap

type Listener<T extends TelemetryEventType> = (
  payload: TelemetryEventMap[T]
) => void

// ─── Telemetry Event Bus ──────────────────────────────────────────────────────
/**
 * Lightweight pub/sub bus decoupling telemetry producers from consumers.
 * Rendering layer subscribes here without knowing the data source.
 */
export class TelemetryEventBus {
  private _listeners = new Map<string, Set<Listener<TelemetryEventType>>>()

  on<T extends TelemetryEventType>(
    event: T,
    listener: Listener<T>
  ): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    const set = this._listeners.get(event)!
    set.add(listener as Listener<TelemetryEventType>)
    return () => set.delete(listener as Listener<TelemetryEventType>)
  }

  emit<T extends TelemetryEventType>(
    event: T,
    payload: TelemetryEventMap[T]
  ): void {
    this._listeners.get(event)?.forEach(listener => {
      try {
        listener(payload)
      } catch (err) {
        console.error(`[TelemetryEventBus] Error in ${event} listener:`, err)
      }
    })
  }

  clear(): void {
    this._listeners.clear()
  }
}

export const telemetryBus = new TelemetryEventBus()
