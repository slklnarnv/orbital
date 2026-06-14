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
  /** Timestamp of last STATE_UPDATE bus emission (used for 10 Hz throttle). */
  private _lastBusEmitTime = 0
  /** Timestamp of last mode recalculation (B-6: keep mode fresh between fetches). */
  private _lastModeRecalcMs = 0
  /**
   * Tracks the previous online state so the NETWORK_STATUS handler can distinguish
   * a genuine offline→online recovery from a routine event (e.g. successful fetch).
   * Resetting backoff on every NETWORK_STATUS event caused a feedback loop that
   * prevented backoff from ever engaging (Bug A).
   */
  private _wasOffline = false

  constructor(entity: OrbitalEntity) {
    this._entity = entity
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    networkMonitor.start()

    // Subscribe to network changes to trigger mode recalculation and recovery
    this._unsubscribeNetworkStatus = telemetryBus.on('NETWORK_STATUS', () => {
      this._recalculateMode()
      // Only reset backoff and force a retry on a true offline → online transition.
      // Bug A fix: Previously resetBackoff() was called on every NETWORK_STATUS event
      // (including the one emitted by recordFailure()), creating a loop where every
      // 10s timeout immediately triggered another fetch, bypassing all backoff logic.
      // Now _wasOffline tracks whether we were actually disconnected, so a browser
      // online event (navigator.onLine flip) is the only trigger for an eager retry.
      //
      // Additionally guarded by !_isFetching: if a fetch is already in-flight,
      // resetBackoff() would set _lastRequestMs=0, _currentDelay=0, but the in-flight
      // fetch's _isFetching guard prevents recordRequest() from running, leaving
      // shouldRequest() returning true at 60fps until the fetch completes.
      if (networkMonitor.isOnline && this._wasOffline) {
        this._wasOffline = false
        if (!this._isFetching) {
          this._rateLimiter.resetBackoff()
          this._refreshTLEAsync() // fire-and-forget
        }
      } else if (!networkMonitor.isOnline) {
        this._wasOffline = true
      }
    })

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
    // Check if TLE refresh is due.
    // CRITICAL: Gate on !_isFetching BEFORE evaluating shouldRequest().
    // Without this, when resetBackoff() is called while a fetch is in-flight
    // (e.g. by the RECOVERY branch or NETWORK_STATUS handler), it sets
    // _lastRequestMs=0 and _currentDelay=0. The in-flight fetch's _isFetching
    // guard prevents recordRequest() from ever running, so shouldRequest()
    // returns `now - 0 >= 0` = true EVERY FRAME at 60fps — a fetch storm of
    // hundreds of no-op calls per second until the in-flight fetch completes.
    if (!this._isFetching && this._rateLimiter.shouldRequest()) {
      this._refreshTLEAsync() // fire-and-forget
    }

    // B-6 FIX: Recalculate mode every 60s to keep mode/confidence fresh as the
    // TLE ages across LIVE→HYBRID→stale thresholds between 4-hour fetches.
    const now = Date.now()
    if (now - this._lastModeRecalcMs >= 60_000) {
      this._lastModeRecalcMs = now
      this._recalculateMode()
    }

    const rawState = this._entity.propagate(simTime)
    if (!rawState) return null

    const smoothed = this._interpolation.smooth(rawState, simTime.deltaMs)
    this._lastState = smoothed

    // Throttle STATE_UPDATE bus emissions to 10 Hz (100ms intervals).
    // Rendering components read position directly from `telemetryManager.lastState`
    // every frame, so they are unaffected by this throttle.
    // UI subscribers (e.g. telemetryStore) already throttle to 1 Hz internally,
    // so 10 Hz bus emissions still provide 10× more update opportunities than needed
    // while eliminating ~50 no-op dispatch iterations per second.
    if (now - this._lastBusEmitTime >= 100) {
      telemetryBus.emit('STATE_UPDATE', smoothed)
      this._lastBusEmitTime = now
    }

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
    } else if (online) {
      // Bug B FIX: When TLE age exceeds 7 days (or no TLE at all) AND we are online,
      // always enter RECOVERY regardless of the current mode.
      newMode = 'RECOVERY'
    } else {
      newMode = 'OFFLINE'
    }

    if (newMode !== this._mode) {
      this._mode = newMode
      telemetryBus.emit('MODE_CHANGE', newMode)

      // Trigger a recovery fetch ONLY on the initial transition INTO RECOVERY.
      // Previously this was in the mode-determination block above and ran on
      // every 60s B-6 recalculation while mode was already RECOVERY — that
      // called resetBackoff() every 60s, defeating the exponential ramp
      // (5s → 10s → 20s → ... → 30min) and capping retries at 60s intervals.
      // Now: initial entry resets backoff and fires one fetch; subsequent retries
      // are driven by the update() loop with proper exponential backoff.
      if (newMode === 'RECOVERY' && !this._isFetching) {
        this._rateLimiter.resetBackoff()
        this._refreshTLEAsync()
      }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
import { issEntity } from '../entities/ISSEntity'
export const telemetryManager = new TelemetryManager(issEntity)

