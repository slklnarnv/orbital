import type { SimulationTime } from '@/types/orbital'

const DEFAULT_CADENCE_MS = 100

export interface RuntimeClock {
  tick(wallDeltaMs: number): SimulationTime
}

export interface RuntimeTelemetry {
  update(simTime: SimulationTime): unknown
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>

export interface SimulationRuntimeOptions {
  cadenceMs?: number
  now?: () => number
  setTimeoutFn?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimeoutFn?: (handle: TimerHandle) => void
}

/**
 * Advances simulation truth independently of React and WebGL rendering.
 *
 * A recursive timeout schedules only after the current step completes, preventing
 * slow telemetry work from accumulating overlapping callbacks. Each callback uses
 * elapsed wall time, so a throttled background tab catches REALTIME up in one step.
 */
export class SimulationRuntime {
  private readonly cadenceMs: number
  private readonly now: () => number
  private readonly setTimeoutFn: (callback: () => void, delayMs: number) => TimerHandle
  private readonly clearTimeoutFn: (handle: TimerHandle) => void
  private timer: TimerHandle | null = null
  private running = false
  private generation = 0
  private lastWallMs = 0

  constructor(
    private readonly clock: RuntimeClock,
    private readonly telemetry: RuntimeTelemetry,
    options: SimulationRuntimeOptions = {},
  ) {
    this.cadenceMs = options.cadenceMs ?? DEFAULT_CADENCE_MS
    this.now = options.now ?? Date.now
    // Browser timer functions require their Window receiver in some engines. Keep
    // the global lookup inside a wrapper instead of storing an unbound native method.
    this.setTimeoutFn = options.setTimeoutFn ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs))
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => globalThis.clearTimeout(handle))

    if (!Number.isFinite(this.cadenceMs) || this.cadenceMs <= 0) {
      throw new Error('SimulationRuntime cadence must be a positive finite number')
    }
  }

  start(): void {
    if (this.running) return

    this.running = true
    const generation = ++this.generation
    this.lastWallMs = this.now()
    this.run(generation)
  }

  stop(): void {
    if (!this.running && this.timer === null) return

    this.running = false
    this.generation += 1
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer)
      this.timer = null
    }
  }

  step(): void {
    const wallNow = this.now()
    const wallDeltaMs = Math.max(0, wallNow - this.lastWallMs)
    this.lastWallMs = wallNow

    const simTime = this.clock.tick(wallDeltaMs)
    this.telemetry.update(simTime)
  }

  get isRunning(): boolean {
    return this.running
  }

  private run(generation: number): void {
    if (!this.running || generation !== this.generation) return

    this.step()
    if (!this.running || generation !== this.generation) return

    this.timer = this.setTimeoutFn(() => {
      this.timer = null
      this.run(generation)
    }, this.cadenceMs)
  }
}
