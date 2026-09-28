import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { simulationClock } from '@/core/clock/SimulationClock'
import { useSimulationStore } from '@/stores/simulationStore'

// Deterministic wall clock: the seek clamp and detach logic compare against
// Date.now(), so pin it before resetting the store.
const WALL_NOW = Date.UTC(2026, 8, 28, 12, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000

describe('simulationStore (time control)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(WALL_NOW)
    useSimulationStore.setState(useSimulationStore.getInitialState(), true)
    simulationClock.setMode('REALTIME')
    simulationClock.setTimeScale(1)
    simulationClock.seekTo(WALL_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes mode changes through to the clock', () => {
    useSimulationStore.getState().setMode('PAUSED')

    expect(useSimulationStore.getState().mode).toBe('PAUSED')
    expect(simulationClock.mode).toBe('PAUSED')
  })

  it('setRate enters ACCELERATED at the preset scale from any mode', () => {
    useSimulationStore.getState().setRate(60)
    expect(useSimulationStore.getState().mode).toBe('ACCELERATED')
    expect(useSimulationStore.getState().timeScale).toBe(60)
    expect(simulationClock.mode).toBe('ACCELERATED')
    expect(simulationClock.timeScale).toBe(60)

    useSimulationStore.getState().setMode('PAUSED')
    useSimulationStore.getState().setRate(10)
    expect(simulationClock.mode).toBe('ACCELERATED')
    expect(simulationClock.timeScale).toBe(10)
  })

  it('seek detaches from REALTIME into PAUSED and moves the epoch', () => {
    useSimulationStore.getState().seek(WALL_NOW + 60_000)

    expect(useSimulationStore.getState().mode).toBe('PAUSED')
    expect(simulationClock.mode).toBe('PAUSED')
    expect(simulationClock.now().epochMs).toBe(WALL_NOW + 60_000)
    // The resume point keeps the pre-seek Live state for Play.
    expect(useSimulationStore.getState().resumeMode).toBe('REALTIME')
    expect(useSimulationStore.getState().resumeScale).toBe(1)
  })

  it('seek while ACCELERATED keeps the mode and rate at the new epoch', () => {
    useSimulationStore.getState().setRate(60)
    useSimulationStore.getState().seek(WALL_NOW + 600_000)

    expect(useSimulationStore.getState().mode).toBe('ACCELERATED')
    expect(useSimulationStore.getState().timeScale).toBe(60)
    expect(simulationClock.now().epochMs).toBe(WALL_NOW + 600_000)
  })

  it('clamps seeks to ±7 days from wall now', () => {
    useSimulationStore.getState().seek(WALL_NOW + 30 * DAY_MS)
    expect(simulationClock.now().epochMs).toBe(WALL_NOW + 7 * DAY_MS)

    useSimulationStore.getState().seek(WALL_NOW - 30 * DAY_MS)
    expect(simulationClock.now().epochMs).toBe(WALL_NOW - 7 * DAY_MS)
  })

  it('togglePause saves the running rate and restores it on resume', () => {
    useSimulationStore.getState().setRate(300)
    useSimulationStore.getState().togglePause()
    expect(useSimulationStore.getState().mode).toBe('PAUSED')

    // A paused seek must not disturb the resume point.
    useSimulationStore.getState().seek(WALL_NOW + 60_000)
    expect(useSimulationStore.getState().mode).toBe('PAUSED')

    useSimulationStore.getState().togglePause()
    expect(useSimulationStore.getState().mode).toBe('ACCELERATED')
    expect(useSimulationStore.getState().timeScale).toBe(300)
    expect(simulationClock.mode).toBe('ACCELERATED')
    expect(simulationClock.timeScale).toBe(300)
    expect(simulationClock.now().epochMs).toBe(WALL_NOW + 60_000)
  })

  it('togglePause from REALTIME resumes Live (which re-pins to the wall)', () => {
    useSimulationStore.getState().togglePause()
    expect(useSimulationStore.getState().mode).toBe('PAUSED')
    expect(useSimulationStore.getState().resumeMode).toBe('REALTIME')

    useSimulationStore.getState().togglePause()
    expect(useSimulationStore.getState().mode).toBe('REALTIME')
  })

  it('re-pausing after a resume saves the resumed rate again', () => {
    useSimulationStore.getState().setRate(10)
    useSimulationStore.getState().togglePause() // pause
    useSimulationStore.getState().togglePause() // resume ACCELERATED@10
    useSimulationStore.getState().togglePause() // pause again

    expect(useSimulationStore.getState().mode).toBe('PAUSED')
    expect(useSimulationStore.getState().resumeMode).toBe('ACCELERATED')
    expect(useSimulationStore.getState().resumeScale).toBe(10)
  })
})
