// ─── API Rate Limiter ─────────────────────────────────────────────────────────
/**
 * Exponential backoff with jitter for API request management.
 * Prevents thundering herd after network recovery.
 *
 * N-1 FIX: Previously _currentDelay was seeded at _normalIntervalMs (4h), but
 * _maxDelayMs is only 30 min. So the very first failure clamped immediately to
 * 30 min, killing the intended 5s → 10s → 20s exponential ramp entirely.
 * Fix: track backoff state separately; first failure starts at _baseDelayMs.
 */
export class ApiRateLimiter {
  private _baseDelayMs: number
  private _maxDelayMs: number
  private _multiplier: number
  private _currentDelay: number
  private _lastRequestMs = 0
  private _normalIntervalMs: number
  /** True when we are actively backing off from a failure; false during normal cadence */
  private _isInBackoff = false

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

  /** Mark a successful request — reset backoff to normal cadence */
  recordSuccess(nowMs = Date.now()): void {
    this._lastRequestMs = nowMs
    this._currentDelay  = this._normalIntervalMs
    this._isInBackoff   = false
  }

  /**
   * Mark a failed request — apply exponential backoff with jitter.
   * First failure starts at _baseDelayMs (not _normalIntervalMs) so the ramp
   * follows the intended 5s → 10s → 20s → … → 30min sequence.
   */
  recordFailure(nowMs = Date.now()): void {
    this._lastRequestMs = nowMs
    if (!this._isInBackoff) {
      // First failure: seed backoff at the base delay (e.g. 5 s)
      this._currentDelay = this._baseDelayMs
      this._isInBackoff  = true
    } else {
      // Subsequent failures: double with jitter, cap at maxDelayMs
      const jitter = this._baseDelayMs * (Math.random() * 0.5)
      this._currentDelay = Math.min(
        this._currentDelay * this._multiplier + jitter,
        this._maxDelayMs
      )
    }
  }

  /**
   * Reset backoff state and force next shouldRequest() check to be eligible immediately.
   * Call this when coming back online so the app retries without waiting out the backoff.
   */
  resetBackoff(): void {
    this._currentDelay  = 0
    this._isInBackoff   = false
    this._lastRequestMs = 0
  }

  /** How many ms until the next request is allowed */
  msUntilNext(nowMs = Date.now()): number {
    return Math.max(0, this._lastRequestMs + this._currentDelay - nowMs)
  }

  reset(): void {
    this._currentDelay  = this._normalIntervalMs
    this._lastRequestMs = 0
    this._isInBackoff   = false
  }
}
