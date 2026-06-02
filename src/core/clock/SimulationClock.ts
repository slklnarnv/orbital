import { buildSimulationTime } from './SimulationTime'
import type { SimulationTime } from '@/types/orbital'

// ─── Clock Modes ─────────────────────────────────────────────────────────────
export type ClockMode = 'REALTIME' | 'ACCELERATED' | 'PAUSED' | 'REPLAY'

type TickCallback = (simTime: SimulationTime) => void
type Unsubscribe = () => void

// ─── SimulationClock ─────────────────────────────────────────────────────────
/**
 * The single authoritative time source for the entire platform.
 *
 * Rules:
 * - No system reads Date.now() directly — they call clock.now()
 * - tick() is called exactly once per requestAnimationFrame
 * - timeScale 1.0 = real-time, 10.0 = 10× speed, 0 = paused
 */
export class SimulationClock {
  private _mode: ClockMode = 'REALTIME'
  private _timeScale = 1.0
  private _epochMs: number
  private _lastSimTime: SimulationTime | null = null
  private _subscribers = new Set<TickCallback>()

  constructor(startEpochMs?: number) {
    this._epochMs = startEpochMs ?? Date.now()
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get mode(): ClockMode { return this._mode }
  get timeScale(): number { return this._timeScale }

  now(): SimulationTime {
    if (!this._lastSimTime) {
      return buildSimulationTime(this._epochMs, 0, 0)
    }
    return this._lastSimTime
  }

  /** Called once per animation frame with wall-clock delta in milliseconds */
  tick(wallDeltaMs: number): SimulationTime {
    const clampedDelta = Math.min(wallDeltaMs, 100) // guard against tab-suspension spikes

    let simDelta: number

    if (this._mode === 'PAUSED') {
      // No advancement in paused mode
      simDelta = 0
    } else if (this._mode === 'REALTIME') {
      // N-2 FIX: In REALTIME mode, synchronize directly to wall-clock every frame.
      // Previously, _epochMs was accumulated from clamped frame deltas, which caused:
      //   1. Startup drift: module-load → first-RAF gap (~1-5s) was never added.
      //   2. Ongoing drift: every frame > 100ms lost its excess forever.
      // At ISS ground speed of 7.66 km/s, a 4s drift = ~30 km position error.
      const wallNow = Date.now()
      simDelta = wallNow - this._epochMs
      this._epochMs = wallNow
    } else {
      // ACCELERATED / REPLAY: accumulate scaled deltas
      simDelta = clampedDelta * this._timeScale
      this._epochMs += simDelta
    }

    const simTime = buildSimulationTime(this._epochMs, clampedDelta, simDelta)
    this._lastSimTime = simTime

    // Notify all subscribers with error isolation
    this._subscribers.forEach(cb => {
      try { cb(simTime) } catch (err) {
        console.error('[SimulationClock] Tick subscriber threw:', err)
      }
    })

    return simTime
  }

  /** Set clock mode */
  setMode(mode: ClockMode): void {
    this._mode = mode
  }

  /** Set time scale multiplier (ignored in PAUSED/REPLAY mode) */
  setTimeScale(scale: number): void {
    this._timeScale = Math.max(0.1, Math.min(scale, 1000))
  }

  /** Jump to a specific time (for replay/seek) */
  seekTo(epochMs: number): void {
    this._epochMs = epochMs
    // CLK-1 FIX: Rebuild _lastSimTime immediately so that synchronous now() calls
    // after seekTo() return the correct post-seek time, not the stale pre-seek value.
    this._lastSimTime = buildSimulationTime(epochMs, 0, 0)
  }

  /** Subscribe to every tick */
  onTick(callback: TickCallback): Unsubscribe {
    this._subscribers.add(callback)
    return () => this._subscribers.delete(callback)
  }

  /** Dispose all subscriptions */
  dispose(): void {
    this._subscribers.clear()
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
// One clock for the entire application lifetime.
export const simulationClock = new SimulationClock()
