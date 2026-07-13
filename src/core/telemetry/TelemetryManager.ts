import { fetchTLEFromCelesTrak } from '../api/CelesTrakClient'
import { tleCache } from '../api/TLECache'
import { ApiRateLimiter } from '../api/ApiRateLimiter'
import { networkMonitor } from './NetworkMonitor'
import { InterpolationService } from './InterpolationService'
import { telemetryBus } from './TelemetryEventBus'
import type { OrbitalEntity } from '../entities/OrbitalEntity'
import type { OrbitalState, TelemetryMode, SimulationTime, TLEData } from '@/types/orbital'
import { TLE_REFRESH_INTERVAL_MS, TLE_STALE_THRESHOLD_MS } from '@/utils/constants'
import { validateTLEData } from '../orbital/TLEParser'
import { simulationClock } from '../clock/SimulationClock'

// ─── Telemetry Manager ────────────────────────────────────────────────────────
/**
 * Orchestrates the 4-mode telemetry pipeline: LIVE → HYBRID → OFFLINE → RECOVERY.
 *
 * Responsibilities:
 * - Holds reference to OrbitalEntity (ISS)
 * - Manages TLE refresh cadence
 * - Switches modes based on network status and TLE age
 * - Produces OrbitalState snapshots on the application runtime cadence
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
  private _hasValidatedState = false
  private _isFetching = false
  private _fetchPromise: Promise<void> | null = null
  private _started = false
  private _lifecycleGeneration = 0
  private _startPromise: Promise<void> | null = null
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
    if (this._started) {
      await this._startPromise
      return
    }

    this._started = true
    const generation = ++this._lifecycleGeneration
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

    // Try to load cached TLE, then attempt live fetch. The generation guard keeps
    // an async StrictMode mount from publishing after its matching stop().
    const startPromise = this._bootstrap(generation)
    this._startPromise = startPromise
    try {
      await startPromise
    } finally {
      if (this._lifecycleGeneration === generation) {
        this._startPromise = null
      }
    }
  }

  stop(): void {
    if (!this._started) return

    this._started = false
    this._lifecycleGeneration += 1
    networkMonitor.stop()
    if (this._unsubscribeNetworkStatus) {
      this._unsubscribeNetworkStatus()
      this._unsubscribeNetworkStatus = null
    }
  }

  // ── Runtime Update ────────────────────────────────────────────────────────

  /**
   * Called by the application runtime independently of the rendering layer.
   * Returns the current OrbitalState (or null if not ready).
   */
  update(simTime: SimulationTime): OrbitalState | null {
    // Check if TLE refresh is due.
    // CRITICAL: Gate on !_isFetching BEFORE evaluating shouldRequest().
    // Without this, when resetBackoff() is called while a fetch is in-flight
    // (e.g. by the RECOVERY branch or NETWORK_STATUS handler), it sets
    // _lastRequestMs=0 and _currentDelay=0. The in-flight fetch's _isFetching
    // guard prevents recordRequest() from ever running, so shouldRequest()
    // returns `now - 0 >= 0` on every runtime step until the in-flight fetch completes.
    if (this._started && !this._isFetching && this._rateLimiter.shouldRequest()) {
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
    if (!this._isFiniteOrbitalState(rawState)) return null
    if (!this._hasValidatedState) {
      const tle = this._entity.currentTLE
      if (!tle || !validateTLEData(tle, this._entity.config.noradId).ok) return null
      this._hasValidatedState = true
    }

    const smoothed = this._interpolation.smooth(rawState, simTime.deltaMs)
    this._lastState = smoothed

    // Throttle STATE_UPDATE bus emissions to 10 Hz (100ms intervals).
    // Rendering components read `telemetryManager.lastState` without subscribing.
    // UI subscribers throttle further to 1 Hz, while this 10 Hz ceiling prevents
    // accidental duplicate dispatch if the runtime cadence is ever increased.
    if (now - this._lastBusEmitTime >= 100) {
      telemetryBus.emit('STATE_UPDATE', smoothed)
      this._lastBusEmitTime = now
    }

    return smoothed
  }

  get mode(): TelemetryMode { return this._mode }
  get lastState(): OrbitalState | null { return this._lastState }

  // ── Private ────────────────────────────────────────────────────────────────

  private isActive(generation: number): boolean {
    return this._started && generation === this._lifecycleGeneration
  }

  private async _bootstrap(generation: number): Promise<void> {
    // A replacement lifecycle waits for an old, cancelled fetch to settle before
    // issuing its own request. This prevents overlap without accepting stale results.
    if (this._fetchPromise) await this._fetchPromise
    if (!this.isActive(generation)) return

    // Try IndexedDB cache first
    const cached = await tleCache.get(this._entity.config.noradId)
    if (!this.isActive(generation)) return

    if (cached) {
      const installed = await this._installCandidate(cached, generation, false)
      if (!this.isActive(generation)) return
      if (!installed) await tleCache.remove(this._entity.config.noradId)
    }

    // Attempt live fetch regardless (update silently if successful)
    await this._refreshTLEAsync(generation)
    if (this.isActive(generation)) this._recalculateMode()
  }

  private _refreshTLEAsync(generation: number = this._lifecycleGeneration): Promise<void> {
    if (!this.isActive(generation)) return Promise.resolve()
    if (this._fetchPromise) return this._fetchPromise

    this._isFetching = true
    const request = this._performRefresh(generation)
    const trackedRequest = request.finally(() => {
      if (this._fetchPromise === trackedRequest) {
        this._fetchPromise = null
        this._isFetching = false
      }
    })
    this._fetchPromise = trackedRequest
    return trackedRequest
  }

  private async _performRefresh(generation: number): Promise<void> {
    this._rateLimiter.recordRequest() // Immediately mark as requested to prevent parallel tick triggers

    if (!networkMonitor.isOnline) {
      if (this.isActive(generation)) this._rateLimiter.recordFailure()
      return
    }

    try {
      const tle = await fetchTLEFromCelesTrak(this._entity.config.noradId)
      if (!this.isActive(generation)) return

      if (tle && await this._installCandidate(tle, generation, true)) {
        if (!this.isActive(generation)) return
        this._rateLimiter.recordSuccess()
        networkMonitor.recordSuccess()
        this._recalculateMode()
      } else {
        if (this.isActive(generation)) this._recordRefreshFailure(new Error('TLE fetch or installation failed'))
      }
    } catch (err) {
      if (!this.isActive(generation)) return
      this._recordRefreshFailure(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private async _installCandidate(
    tle: TLEData,
    generation: number,
    persist: boolean,
  ): Promise<boolean> {
    if (!validateTLEData(tle, this._entity.config.noradId).ok) return false

    const previousTLE = this._entity.currentTLE
    const previousState = this._lastState
    const previousValidatedState = this._hasValidatedState
    const rollback = () => {
      if (previousTLE) this._entity.loadTLE(previousTLE)
      else this._entity.clearTLE()
      this._hasValidatedState = previousValidatedState
    }

    if (!this._entity.loadTLE(tle)) return false

    const propagated = this._entity.propagate(simulationClock.now())
    if (!propagated || !this._isFiniteOrbitalState(propagated)) {
      rollback()
      return false
    }

    try {
      if (persist) await tleCache.set(this._entity.config.noradId, tle)
    } catch {
      rollback()
      return false
    }

    if (!this.isActive(generation)) {
      rollback()
      return false
    }

    this._hasValidatedState = true
    this._interpolation.onTLEUpdate(previousState)
    if (!previousState) this._lastState = propagated
    telemetryBus.emit('TLE_REFRESHED', {
      entityId: this._entity.config.id,
      tle,
    })
    telemetryBus.emit('STATE_UPDATE', propagated)
    this._lastBusEmitTime = Date.now()
    return true
  }

  private _recordRefreshFailure(error: Error): void {
    this._rateLimiter.recordFailure()
    networkMonitor.recordFailure()
    telemetryBus.emit('API_ERROR', { source: 'celestrak', error })
    this._recalculateMode()
  }

  private _isFiniteOrbitalState(state: OrbitalState): boolean {
    const vectors = [state.positionECI, state.velocityECI]
    const scalarValues = [
      state.timestamp,
      state.latitude,
      state.longitude,
      state.altitude,
      state.speed,
      state.orbitalPeriod,
      state.inclination,
      state.tleAgeHours,
      state.confidence,
    ]
    return vectors.every(vector => [vector.x, vector.y, vector.z].every(Number.isFinite))
      && scalarValues.every(Number.isFinite)
  }

  private _recalculateMode(): void {
    if (!this._started) return

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

    if (
      online
      && this._hasValidatedState
      && tle?.source === 'celestrak'
      && tleAge < TLE_STALE_THRESHOLD_MS
    ) {
      newMode = 'LIVE'
    } else if (this._hasValidatedState && tle && tleAge < TLE_STALE_THRESHOLD_MS * 7) {
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
