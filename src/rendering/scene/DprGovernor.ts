// ─── DPR Governor ─────────────────────────────────────────────────────────────
/**
 * Frame-time-driven device-pixel-ratio governor (idea adapted from gcdatlas's
 * render loop: EMA of frame time, a wide hysteresis band, hitch frames
 * excluded, decisions at most once per second, and a per-session cap on
 * changes so it can never oscillate).
 *
 * Pure logic: the caller feeds wall-clock frame deltas and applies the DPR it
 * returns. Fill rate is the dominant cost of this scene (bloom mips, 4k Earth
 * shaders at up to 2× DPR), so pixel ratio is the one lever that matters.
 */

export interface DprGovernorOptions {
  maxDpr: number
  minDpr?: number
  step?: number
}

/** EMA above this (≈36 fps) for DOWN_AFTER_S seconds lowers the DPR. */
const SLOW_MS = 28
/** EMA below this (≈55 fps, i.e. vsync-bound with headroom) raises it back. */
const FAST_MS = 18
const DOWN_AFTER_S = 2
const UP_AFTER_S = 10
/** A frame this long is a hitch (shader link, texture upload, GC, tab switch), not load. */
const HITCH_MS = 100
const MAX_DOWNS = 3
const MAX_UPS = 3

export class DprGovernor {
  readonly maxDpr: number
  readonly minDpr: number
  readonly step: number
  private _dpr: number
  private _ema = 16.7
  private _sinceCheck = 0
  private _slowS = 0
  private _fastS = 0
  private _downs = 0
  private _ups = 0

  constructor({ maxDpr, minDpr = 1, step = 0.25 }: DprGovernorOptions) {
    this.maxDpr = Math.max(minDpr, maxDpr)
    this.minDpr = minDpr
    this.step = step
    this._dpr = this.maxDpr
  }

  get dpr(): number { return this._dpr }
  get emaMs(): number { return this._ema }

  /**
   * Feed one frame. Returns the new DPR when it changes, otherwise null.
   * `visible` false (hidden tab) skips the frame entirely.
   */
  sample(deltaMs: number, visible = true): number | null {
    if (!visible || !Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs >= HITCH_MS) return null
    this._ema = this._ema * 0.95 + deltaMs * 0.05
    this._sinceCheck += deltaMs / 1000
    if (this._sinceCheck < 1) return null
    const elapsed = this._sinceCheck
    this._sinceCheck = 0

    this._slowS = this._ema > SLOW_MS ? this._slowS + elapsed : 0
    this._fastS = this._ema < FAST_MS ? this._fastS + elapsed : 0

    let next = this._dpr
    if (this._slowS >= DOWN_AFTER_S && this._downs < MAX_DOWNS && this._dpr > this.minDpr) {
      next = Math.max(this.minDpr, this._dpr - this.step)
      this._downs += 1
    } else if (this._fastS >= UP_AFTER_S && this._ups < MAX_UPS && this._dpr < this.maxDpr) {
      next = Math.min(this.maxDpr, this._dpr + this.step)
      this._ups += 1
    }
    if (next === this._dpr) return null

    this._dpr = next
    // Every transition restarts measurement: the new resolution's cost is unknown.
    this._ema = 16.7
    this._slowS = 0
    this._fastS = 0
    return next
  }
}
