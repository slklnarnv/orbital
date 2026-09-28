import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimulationClock } from '@/core/clock/SimulationClock'

afterEach(() => {
  vi.useRealTimers()
})

describe('SimulationClock', () => {
  it('snaps REALTIME to wall time after a long scheduler gap', () => {
    const startEpochMs = Date.UTC(2026, 6, 13, 12, 0, 0)
    vi.useFakeTimers()
    vi.setSystemTime(startEpochMs)
    const clock = new SimulationClock(startEpochMs)

    vi.setSystemTime(startEpochMs + 5 * 60 * 1000)
    const time = clock.tick(16)

    expect(time.epochMs).toBe(startEpochMs + 5 * 60 * 1000)
    expect(time.deltaMs).toBe(16)
    expect(time.simDeltaMs).toBe(5 * 60 * 1000)
  })

  it('clamps delayed ACCELERATED updates before applying time scale', () => {
    const clock = new SimulationClock(1_000)
    clock.setMode('ACCELERATED')
    clock.setTimeScale(10)

    const time = clock.tick(5 * 60 * 1000)

    expect(time.epochMs).toBe(2_000)
    expect(time.deltaMs).toBe(100)
    expect(time.simDeltaMs).toBe(1_000)
  })

  it('keeps PAUSED simulation time fixed while reporting wall delta', () => {
    const clock = new SimulationClock(1_000)
    clock.setMode('PAUSED')

    const time = clock.tick(75)

    expect(time.epochMs).toBe(1_000)
    expect(time.deltaMs).toBe(75)
    expect(time.simDeltaMs).toBe(0)
  })

  it('updates synchronous readers immediately after a seek', () => {
    const clock = new SimulationClock(1_000)

    clock.seekTo(42_000)

    expect(clock.now().epochMs).toBe(42_000)
  })

  // ─── Time-control contracts ────────────────────────────────────────────────
  // The transport UI (simulationStore.seek / togglePause) is built on these:
  // a seek sticks only while detached from the wall, and pause/resume never
  // moves the epoch.

  it('advances ACCELERATED time from the seeked epoch', () => {
    const clock = new SimulationClock(1_000)
    clock.setMode('ACCELERATED')
    clock.setTimeScale(1)
    clock.seekTo(50_000)

    const time = clock.tick(100)

    expect(time.epochMs).toBe(50_100)
  })

  it('re-pins REALTIME to wall time after a seek (seeks must detach first)', () => {
    const startEpochMs = Date.UTC(2026, 6, 13, 12, 0, 0)
    vi.useFakeTimers()
    vi.setSystemTime(startEpochMs)
    const clock = new SimulationClock(startEpochMs)

    clock.seekTo(startEpochMs + 3_600_000) // seeked an hour into the future
    const time = clock.tick(16) // the next REALTIME tick snaps back to the wall

    expect(time.epochMs).toBe(startEpochMs)
  })

  it('freezes the epoch across PAUSED and resumes ACCELERATED from it', () => {
    const clock = new SimulationClock(1_000)
    clock.setMode('ACCELERATED')
    clock.setTimeScale(10)
    clock.tick(100)
    expect(clock.now().epochMs).toBe(2_000)

    clock.setMode('PAUSED')
    clock.tick(100)
    expect(clock.now().epochMs).toBe(2_000)

    clock.setMode('ACCELERATED')
    const time = clock.tick(100)
    expect(time.epochMs).toBe(3_000)
  })
})
