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

    const simDelta = this._mode === 'PAUSED' ? 0 : clampedDelta * this._timeScale
    this._epochMs += simDelta

    const simTime = buildSimulationTime(this._epochMs, clampedDelta, simDelta)
    this._lastSimTime = simTime

    // Notify all subscribers
    this._subscribers.forEach(cb => cb(simTime))

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
