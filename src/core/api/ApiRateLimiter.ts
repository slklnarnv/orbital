// ─── API Rate Limiter ─────────────────────────────────────────────────────────
/**
 * Exponential backoff with jitter for API request management.
 * Prevents thundering herd after network recovery.
 */
export class ApiRateLimiter {
  private _baseDelayMs: number
  private _maxDelayMs: number
  private _multiplier: number
  private _currentDelay: number
  private _lastRequestMs = 0
  private _normalIntervalMs: number

  constructor(options: {
    baseDelayMs?: number
    maxDelayMs?: number
    multiplier?: number
    normalIntervalMs: number
  }) {
    this._baseDelayMs      = options.baseDelayMs ?? 1000
    this._maxDelayMs       = options.maxDelayMs ?? 5 * 60 * 1000 // 5 min max
    this._multiplier       = options.multiplier ?? 2.0
    this._normalIntervalMs = options.normalIntervalMs
    this._currentDelay     = this._normalIntervalMs
  }

  /** Should we attempt a request right now? */
  shouldRequest(nowMs = Date.now()): boolean {
    return nowMs - this._lastRequestMs >= this._currentDelay
  }

  /** Record the start of a request to prevent duplicate parallel fetches */
  recordRequest(nowMs = Date.now()): void {
    this._lastRequestMs = nowMs
  }

  /** Mark a successful request — reset backoff */
  recordSuccess(nowMs = Date.now()): void {
    this._lastRequestMs = nowMs
    this._currentDelay  = this._normalIntervalMs
  }

  /** Mark a failed request — apply exponential backoff with jitter */
  recordFailure(nowMs = Date.now()): void {
    this._lastRequestMs = nowMs
    const jitter = this._baseDelayMs * (Math.random() * 0.5)
    this._currentDelay = Math.min(
      this._currentDelay * this._multiplier + jitter,
      this._maxDelayMs
    )
  }

  /** How many ms until the next request is allowed */
  msUntilNext(nowMs = Date.now()): number {
    return Math.max(0, this._lastRequestMs + this._currentDelay - nowMs)
  }

  reset(): void {
    this._currentDelay  = this._normalIntervalMs
    this._lastRequestMs = 0
  }
}
