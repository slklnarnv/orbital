import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRateLimiter } from '@/core/api/ApiRateLimiter'

const FOUR_HOURS = 4 * 60 * 60 * 1000

describe('ApiRateLimiter', () => {
  let random: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    random = vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    random.mockRestore()
  })

  const make = (extra: { baseDelayMs?: number; maxDelayMs?: number } = {}) =>
    new ApiRateLimiter({ normalIntervalMs: FOUR_HOURS, ...extra })

  it('starts eligible only once now reaches the normal interval', () => {
    const limiter = make()
    expect(limiter.shouldRequest(0)).toBe(false)
    expect(limiter.shouldRequest(FOUR_HOURS - 1)).toBe(false)
    expect(limiter.shouldRequest(FOUR_HOURS)).toBe(true)
    // real wall-clock values are far past the interval
    expect(limiter.shouldRequest(Date.now())).toBe(true)
  })

  it('first failure waits baseDelayMs', () => {
    const limiter = make({ baseDelayMs: 5000 })
    limiter.recordRequest(1000)
    limiter.recordFailure(1000)
    expect(limiter.shouldRequest(5999)).toBe(false)
    expect(limiter.shouldRequest(6000)).toBe(true)
  })

  it('second failure doubles the delay (no jitter)', () => {
    const limiter = make({ baseDelayMs: 5000 })
    limiter.recordFailure(1000)
    limiter.recordFailure(1000)
    expect(limiter.shouldRequest(1000 + 9999)).toBe(false)
    expect(limiter.shouldRequest(1000 + 10000)).toBe(true)
  })

  it('second failure adds up to base * 0.5 of jitter', () => {
    random.mockReturnValue(1)
    const limiter = make({ baseDelayMs: 5000 })
    limiter.recordFailure(1000)
    limiter.recordFailure(1000)
    expect(limiter.shouldRequest(1000 + 12499)).toBe(false)
    expect(limiter.shouldRequest(1000 + 12500)).toBe(true)
  })

  it('caps repeated failures at maxDelayMs', () => {
    const limiter = make({ baseDelayMs: 5000, maxDelayMs: 30000 })
    for (let i = 0; i < 20; i++) limiter.recordFailure(0)
    expect(limiter.shouldRequest(29999)).toBe(false)
    expect(limiter.shouldRequest(30000)).toBe(true)
  })

  it('success returns to the normal cadence', () => {
    const limiter = make({ baseDelayMs: 5000 })
    limiter.recordFailure(0)
    limiter.recordFailure(0)
    limiter.recordSuccess(100_000)
    expect(limiter.shouldRequest(100_000 + FOUR_HOURS - 1)).toBe(false)
    expect(limiter.shouldRequest(100_000 + FOUR_HOURS)).toBe(true)
  })

  it('resetBackoff makes the next check eligible and restarts the ramp at base', () => {
    const limiter = make({ baseDelayMs: 5000 })
    limiter.recordFailure(1000)
    limiter.recordFailure(1000)
    limiter.resetBackoff()
    expect(limiter.shouldRequest(0)).toBe(true)
    expect(limiter.shouldRequest(123)).toBe(true)

    limiter.recordFailure(2000)
    expect(limiter.shouldRequest(2000 + 4999)).toBe(false)
    expect(limiter.shouldRequest(2000 + 5000)).toBe(true)
  })
})
