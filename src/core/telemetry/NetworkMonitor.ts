import { telemetryBus } from './TelemetryEventBus'
import type { NetworkStatus } from '@/types/orbital'

// ─── Network Monitor ──────────────────────────────────────────────────────────
/**
 * Monitors browser online/offline state and emits network status events.
 * The TelemetryManager uses this to switch between LIVE/OFFLINE modes.
 */
export class NetworkMonitor {
  private _status: NetworkStatus = {
    online: navigator.onLine,
    lastSuccessfulFetch: null,
    consecutiveFailures: 0,
  }

  private _handlers = {
    online:  () => this._handleOnline(),
    offline: () => this._handleOffline(),
  }

  start(): void {
    window.addEventListener('online', this._handlers.online)
    window.addEventListener('offline', this._handlers.offline)
  }

  stop(): void {
    window.removeEventListener('online', this._handlers.online)
    window.removeEventListener('offline', this._handlers.offline)
  }

  get status(): Readonly<NetworkStatus> {
    return this._status
  }

  get isOnline(): boolean {
    return this._status.online
  }

  recordSuccess(): void {
    this._status = {
      ...this._status,
      lastSuccessfulFetch: Date.now(),
      consecutiveFailures: 0,
      online: true,
    }
    telemetryBus.emit('NETWORK_STATUS', this._status)
  }

  recordFailure(): void {
    this._status = {
      ...this._status,
      consecutiveFailures: this._status.consecutiveFailures + 1,
    }
    telemetryBus.emit('NETWORK_STATUS', this._status)
  }

  private _handleOnline(): void {
    this._status = { ...this._status, online: true }
    telemetryBus.emit('NETWORK_STATUS', this._status)
  }

  private _handleOffline(): void {
    this._status = { ...this._status, online: false }
    telemetryBus.emit('NETWORK_STATUS', this._status)
  }
}

export const networkMonitor = new NetworkMonitor()
