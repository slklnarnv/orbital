import type { Vec3 } from '@/utils/math'
import { isSunlit } from './SunVisibility'

/** Position + Sun direction (same frame) at an epoch, or null if propagation failed. */
export type GeometryAt = (epochMs: number) => { position: Vec3; sunDir: Vec3 } | null

export interface ShadowForecast {
  /** Sunlit at `fromMs` (sun visibility >= 0.5). */
  sunlit: boolean
  /** Next epoch (ms) where sunlit flips, within +toleranceMs; null if none within the horizon. */
  transitionMs: number | null
}

export interface ShadowForecastOptions {
  stepMs?: number
  horizonMs?: number
  toleranceMs?: number
}

const DEFAULT_STEP_MS = 10_000
const DEFAULT_HORIZON_MS = 2 * 93 * 60_000
const DEFAULT_TOLERANCE_MS = 1_000

function sunlitAt(geometryAt: GeometryAt, epochMs: number): boolean | null {
  const g = geometryAt(epochMs)
  return g ? isSunlit(g.position, g.sunDir) : null
}

/**
 * Steps forward at `stepMs` from `fromMs` until the sunlit state flips or
 * `horizonMs` elapses, then bisects the flip to `toleranceMs`. Uses the
 * penumbra midpoint (visibility 0.5), the same edge the TRRJ law uses.
 * The returned transition is the bisection's far bracket, so it always lies
 * on the new side of the flip (at most `toleranceMs` late).
 */
export function forecastShadowTransition(
  geometryAt: GeometryAt,
  fromMs: number,
  options: ShadowForecastOptions = {},
): ShadowForecast | null {
  const stepMs = options.stepMs ?? DEFAULT_STEP_MS
  const horizonMs = options.horizonMs ?? DEFAULT_HORIZON_MS
  const toleranceMs = options.toleranceMs ?? DEFAULT_TOLERANCE_MS

  const sunlit = sunlitAt(geometryAt, fromMs)
  if (sunlit === null) return null

  let lo = fromMs
  const end = fromMs + horizonMs
  while (lo < end) {
    const hi = Math.min(lo + stepMs, end)
    const state = sunlitAt(geometryAt, hi)
    if (state === null) return { sunlit, transitionMs: null }
    if (state !== sunlit) {
      let a = lo
      let b = hi
      while (b - a > toleranceMs) {
        const mid = (a + b) / 2
        const midState = sunlitAt(geometryAt, mid)
        if (midState === null) break
        if (midState === sunlit) a = mid
        else b = mid
      }
      return { sunlit, transitionMs: b }
    }
    lo = hi
  }
  return { sunlit, transitionMs: null }
}

/** Caches a forecast and recomputes it only when it can have gone stale. */
export class ShadowForecaster {
  private cached: ShadowForecast | null = null
  private cachedKey: string | null = null
  private computedAtMs = 0

  constructor(
    private readonly geometryAt: GeometryAt,
    private readonly options: ShadowForecastOptions = {},
  ) {}

  /**
   * Returns the cached forecast, recomputing only when needed: no cache yet,
   * `key` changed (new element set), `simMs` moved backwards past the last
   * compute (a seek), `simMs` reached the cached transition, or
   * `simMs` advanced beyond half the horizon without a transition.
   */
  update(simMs: number, key: string): ShadowForecast | null {
    const horizonMs = this.options.horizonMs ?? DEFAULT_HORIZON_MS
    const stale =
      this.cachedKey === null ||
      this.cachedKey !== key ||
      simMs < this.computedAtMs ||
      (this.cached?.transitionMs != null && simMs >= this.cached.transitionMs) ||
      (this.cached?.transitionMs == null && simMs - this.computedAtMs > horizonMs / 2)
    if (stale) {
      this.cached = forecastShadowTransition(this.geometryAt, simMs, this.options)
      this.cachedKey = key
      this.computedAtMs = simMs
    }
    return this.cached
  }
}
