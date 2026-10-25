// ─── LoadStallGuard.test.ts — a never-settling load must fail, not hang ──────
//
// The live-site KTX2 hang never rejected: the transcoder worker died at init
// and never answered, so the detail model stayed suspended and the "High
// fidelity" spinner never finished. guardLoadStall bounds each texture load so
// that state becomes an ordinary error the reliability ladder handles.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KTX2_TEXTURE_STALL_MS, guardLoadStall } from '@/rendering/iss/loadStallGuard'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('guardLoadStall', () => {
  it('fails a load that never settles once the bound elapses', () => {
    const onLoad = vi.fn()
    const onError = vi.fn()
    guardLoadStall(onLoad, onError, 1_000, 'KTX2 texture')
    vi.advanceTimersByTime(999)
    expect(onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(String(onError.mock.calls[0][0])).toMatch(/KTX2 texture did not settle within 1000 ms/)
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('passes a timely load through and disarms the timer', () => {
    const onLoad = vi.fn()
    const onError = vi.fn()
    const guarded = guardLoadStall<string>(onLoad, onError, 1_000, 'KTX2 texture')
    guarded.onLoad('texture')
    vi.advanceTimersByTime(5_000)
    expect(onLoad).toHaveBeenCalledWith('texture')
    expect(onError).not.toHaveBeenCalled()
  })

  it('passes a real error through once', () => {
    const onError = vi.fn()
    const guarded = guardLoadStall(vi.fn(), onError, 1_000, 'KTX2 texture')
    const failure = new Error('transcode failed')
    guarded.onError(failure)
    vi.advanceTimersByTime(5_000)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('ignores a late result after the stall fired', () => {
    const onLoad = vi.fn()
    const onError = vi.fn()
    const guarded = guardLoadStall<string>(onLoad, onError, 1_000, 'KTX2 texture')
    vi.advanceTimersByTime(1_000)
    guarded.onLoad('late texture')
    guarded.onError(new Error('late error'))
    expect(onLoad).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('bounds well beyond the Locate departure gate', () => {
    // The 8 s Locate gate flies to Model A and keeps loading; the stall bound
    // must not cut off a slow-but-healthy transcode before then.
    expect(KTX2_TEXTURE_STALL_MS).toBeGreaterThanOrEqual(20_000)
  })
})
