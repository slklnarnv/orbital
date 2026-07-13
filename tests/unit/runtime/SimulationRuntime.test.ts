import { describe, expect, it, vi } from 'vitest'
import { SimulationRuntime, type RuntimeClock, type RuntimeTelemetry } from '@/core/runtime/SimulationRuntime'
import type { SimulationTime } from '@/types/orbital'

type TimerHandle = ReturnType<typeof globalThis.setTimeout>

function simTime(epochMs: number): SimulationTime {
  return { epochMs, julianDate: 0, gmst: 0, deltaMs: 0, simDeltaMs: 0 }
}

function createHarness() {
  let wallNow = 1_000
  let nextTimerId = 1
  const timers = new Map<number, { callback: () => void; delayMs: number }>()
  const calls: string[] = []

  const clock: RuntimeClock = {
    tick: vi.fn((deltaMs: number) => {
      calls.push(`clock:${deltaMs}`)
      return simTime(wallNow)
    }),
  }
  const telemetry: RuntimeTelemetry = {
    update: vi.fn((time: SimulationTime) => {
      calls.push(`telemetry:${time.epochMs}`)
    }),
  }

  const runtime = new SimulationRuntime(clock, telemetry, {
    cadenceMs: 100,
    now: () => wallNow,
    setTimeoutFn: (callback, delayMs) => {
      const id = nextTimerId++
      timers.set(id, { callback, delayMs })
      return id as unknown as TimerHandle
    },
    clearTimeoutFn: (handle) => {
      timers.delete(handle as unknown as number)
    },
  })

  function runNextTimer(elapsedMs = 100): void {
    const entry = timers.entries().next().value as [number, { callback: () => void; delayMs: number }] | undefined
    if (!entry) throw new Error('No scheduled timer')
    const [id, timer] = entry
    timers.delete(id)
    wallNow += elapsedMs
    timer.callback()
  }

  return {
    runtime,
    clock,
    telemetry,
    timers,
    calls,
    runNextTimer,
    setWallNow: (value: number) => { wallNow = value },
  }
}

describe('SimulationRuntime', () => {
  it('starts immediately and remains idempotent', () => {
    const harness = createHarness()

    harness.runtime.start()
    harness.runtime.start()

    expect(harness.runtime.isRunning).toBe(true)
    expect(harness.clock.tick).toHaveBeenCalledTimes(1)
    expect(harness.telemetry.update).toHaveBeenCalledTimes(1)
    expect(harness.timers.size).toBe(1)
  })

  it('ticks the clock before telemetry at a recursive 10 Hz cadence', () => {
    const harness = createHarness()
    harness.runtime.start()
    harness.calls.length = 0

    harness.runNextTimer()

    expect(harness.calls).toEqual(['clock:100', 'telemetry:1100'])
    expect(harness.timers.size).toBe(1)
    expect([...harness.timers.values()][0]?.delayMs).toBe(100)
  })

  it('catches up a delayed background callback in one step', () => {
    const harness = createHarness()
    harness.runtime.start()
    harness.calls.length = 0

    harness.runNextTimer(5 * 60 * 1000)

    expect(harness.calls).toEqual(['clock:300000', 'telemetry:301000'])
    expect(harness.clock.tick).toHaveBeenCalledTimes(2)
  })

  it('cancels scheduled and late callbacks when stopped', () => {
    const harness = createHarness()
    harness.runtime.start()
    const lateCallback = [...harness.timers.values()][0]?.callback

    harness.runtime.stop()
    harness.runtime.stop()
    lateCallback?.()

    expect(harness.runtime.isRunning).toBe(false)
    expect(harness.timers.size).toBe(0)
    expect(harness.clock.tick).toHaveBeenCalledTimes(1)
  })

  it('does not pass a negative delta after a wall-clock correction', () => {
    const harness = createHarness()
    harness.runtime.start()
    harness.setWallNow(500)

    harness.runtime.step()

    expect(harness.clock.tick).toHaveBeenLastCalledWith(0)
  })

  it('rejects invalid scheduler cadences', () => {
    const clock: RuntimeClock = { tick: () => simTime(0) }
    const telemetry: RuntimeTelemetry = { update: () => undefined }

    expect(() => new SimulationRuntime(clock, telemetry, { cadenceMs: 0 })).toThrow(
      'SimulationRuntime cadence must be a positive finite number',
    )
  })

  it('uses default timer functions without detaching their global receiver', () => {
    vi.useFakeTimers()
    const clock: RuntimeClock = { tick: () => simTime(0) }
    const telemetry: RuntimeTelemetry = { update: () => undefined }
    const runtime = new SimulationRuntime(clock, telemetry)

    expect(() => runtime.start()).not.toThrow()
    runtime.stop()

    vi.useRealTimers()
  })
})
