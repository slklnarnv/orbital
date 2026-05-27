import { fetchTLEFromCelesTrak } from '../api/CelesTrakClient'
import { tleCache } from '../api/TLECache'
import { ApiRateLimiter } from '../api/ApiRateLimiter'
import { networkMonitor } from './NetworkMonitor'
import { InterpolationService } from './InterpolationService'
import { telemetryBus } from './TelemetryEventBus'
import type { OrbitalEntity } from '../entities/OrbitalEntity'
import type { OrbitalState, TelemetryMode, SimulationTime } from '@/types/orbital'
import { TLE_REFRESH_INTERVAL_MS, TLE_STALE_THRESHOLD_MS } from '@/utils/constants'

// ─── Telemetry Manager ────────────────────────────────────────────────────────
/**
 * Orchestrates the 4-mode telemetry pipeline: LIVE → HYBRID → OFFLINE → RECOVERY.
 *
 * Responsibilities:
 * - Holds reference to OrbitalEntity (ISS)
 * - Manages TLE refresh cadence
 * - Switches modes based on network status and TLE age
 * - Emits OrbitalState every frame via telemetryBus
 */
export class TelemetryManager {
  private _mode: TelemetryMode = 'OFFLINE'
  private _entity: OrbitalEntity
  private _interpolation = new InterpolationService()
  private _rateLimiter = new ApiRateLimiter({
    normalIntervalMs: TLE_REFRESH_INTERVAL_MS,
    baseDelayMs: 5_000,
    maxDelayMs: 30 * 60 * 1000,
  })
  private _lastState: OrbitalState | null = null
  private _isFetching = false
  private _unsubscribeNetworkStatus: (() => void) | null = null

  constructor(entity: OrbitalEntity) {
    this._entity = entity
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    networkMonitor.start()

    // Subscribe to network changes to trigger mode recalculation
    this._unsubscribeNetworkStatus = telemetryBus.on('NETWORK_STATUS', () => this._recalculateMode())

    // Try to load cached TLE, then attempt live fetch
    await this._bootstrap()
  }

  stop(): void {
    networkMonitor.stop()
    if (this._unsubscribeNetworkStatus) {
      this._unsubscribeNetworkStatus()
      this._unsubscribeNetworkStatus = null
    }
  }

  // ── Per-Frame Update ──────────────────────────────────────────────────────

  /**
   * Called every frame by the rendering layer hook.
   * Returns the current OrbitalState (or null if not ready).
   */
  update(simTime: SimulationTime): OrbitalState | null {
    // Check if TLE refresh is due
    if (this._rateLimiter.shouldRequest()) {
      this._refreshTLEAsync() // fire-and-forget
    }

    const rawState = this._entity.propagate(simTime)
    if (!rawState) return null

    const smoothed = this._interpolation.smooth(rawState, simTime.deltaMs)
    this._lastState = smoothed

    telemetryBus.emit('STATE_UPDATE', smoothed)
    return smoothed
  }

  get mode(): TelemetryMode { return this._mode }
  get lastState(): OrbitalState | null { return this._lastState }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _bootstrap(): Promise<void> {
    // Try IndexedDB cache first
    const cached = await tleCache.get(this._entity.config.noradId)
    if (cached) {
      const prevState = this._lastState
      this._entity.loadTLE(cached)
      this._interpolation.onTLEUpdate(prevState)
      telemetryBus.emit('TLE_REFRESHED', {
        entityId: this._entity.config.id,
        tle: cached,
      })
    }

    // Attempt live fetch regardless (update silently if successful)
    await this._refreshTLEAsync()
    this._recalculateMode()
  }

  private async _refreshTLEAsync(): Promise<void> {
    if (this._isFetching) return
    this._isFetching = true
    this._rateLimiter.recordRequest() // Immediately mark as requested to prevent parallel tick triggers

    if (!networkMonitor.isOnline) {
      this._rateLimiter.recordFailure()
      this._isFetching = false
      return
    }

    try {
      const tle = await fetchTLEFromCelesTrak(this._entity.config.noradId)

      if (tle) {
        this._rateLimiter.recordSuccess()
        // Cache it
        await tleCache.set(this._entity.config.noradId, tle)
        // Capture current state for blending
        const prevState = this._lastState
        // Load into entity
        this._entity.loadTLE(tle)
        this._interpolation.onTLEUpdate(prevState)

        telemetryBus.emit('TLE_REFRESHED', {
          entityId: this._entity.config.id,
          tle,
        })
        this._recalculateMode()
      } else {
        this._rateLimiter.recordFailure()
        telemetryBus.emit('API_ERROR', {
          source: 'celestrak',
          error: new Error('TLE fetch failed'),
        })
        this._recalculateMode()
      }
    } catch (err) {
      this._rateLimiter.recordFailure()
      telemetryBus.emit('API_ERROR', {
        source: 'celestrak',
        error: err instanceof Error ? err : new Error(String(err)),
      })
      this._recalculateMode()
    } finally {
      this._isFetching = false
    }
  }

  private _recalculateMode(): void {
    const online = networkMonitor.isOnline
    const tle = this._entity.currentTLE
    
    // ARCHITECTURAL NOTE: This reads Date.now() (wall-clock time) intentionally
    // to assess the real-world freshness of the downloaded TLE data for telemetry 
    // mode routing (e.g. LIVE vs HYBRID vs OFFLINE), which is independent of the 
    // visualizer's simulated replay or accelerated time scaling.
    const tleAge = tle
      ? (Date.now() - tle.fetchedAt)
      : Infinity

    let newMode: TelemetryMode

    if (online && tle && tleAge < TLE_STALE_THRESHOLD_MS) {
      newMode = 'LIVE'
    } else if (tle && tleAge < TLE_STALE_THRESHOLD_MS * 7) {
      newMode = online ? 'HYBRID' : 'OFFLINE'
    } else if (online && this._mode === 'OFFLINE') {
      newMode = 'RECOVERY'
    } else {
      newMode = 'OFFLINE'
    }

    if (newMode !== this._mode) {
      this._mode = newMode
      telemetryBus.emit('MODE_CHANGE', newMode)
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
import { issEntity } from '../entities/ISSEntity'
export const telemetryManager = new TelemetryManager(issEntity)

