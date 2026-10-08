import { describe, expect, it } from 'vitest'
import { DprGovernor } from '@/rendering/scene/DprGovernor'

/** Feeds `seconds` of frames at `frameMs` each; returns every DPR change. */
function run(governor: DprGovernor, frameMs: number, seconds: number, visible = true): number[] {
  const changes: number[] = []
  const frames = Math.round((seconds * 1000) / frameMs)
  for (let i = 0; i < frames; i++) {
    const next = governor.sample(frameMs, visible)
    if (next !== null) changes.push(next)
  }
  return changes
}

describe('DprGovernor', () => {
  it('holds the ceiling on a vsync-bound 60 fps scene', () => {
    const governor = new DprGovernor({ maxDpr: 2, minDpr: 1 })
    expect(run(governor, 16.7, 60)).toEqual([])
    expect(governor.dpr).toBe(2)
  })

  it('steps down on sustained slow frames, never below the floor', () => {
    const governor = new DprGovernor({ maxDpr: 2, minDpr: 1.5, step: 0.25 })
    const changes = run(governor, 40, 60)
    expect(changes).toEqual([1.75, 1.5])
    expect(governor.dpr).toBe(1.5)
  })

  it('ignores hitch frames and hidden-tab frames', () => {
    const governor = new DprGovernor({ maxDpr: 2 })
    // Shader links / tab switches: huge single frames say nothing about load.
    expect(run(governor, 250, 30)).toEqual([])
    expect(run(governor, 40, 30, false)).toEqual([])
    expect(governor.dpr).toBe(2)
  })

  it('recovers after a calm stretch, and caps transitions per session', () => {
    const governor = new DprGovernor({ maxDpr: 2, minDpr: 1, step: 0.25 })
    // 2 s of sustained slow frames trigger a step; each step restarts the
    // measurement, so 3 s yields exactly one (a second would need 4 s).
    expect(run(governor, 40, 3)).toEqual([1.75])
    expect(run(governor, 10, 15)).toEqual([2]) // calm for 10 s → back up

    // Oscillating load: count every decrease, not one per cycle.
    let downs = 1
    let previous = governor.dpr
    for (let cycle = 0; cycle < 10; cycle++) {
      for (const next of [...run(governor, 40, 3), ...run(governor, 10, 15)]) {
        if (next < previous) downs += 1
        previous = next
      }
    }
    expect(downs).toBe(3) // MAX_DOWNS: the governor can never oscillate forever
    expect(governor.dpr).toBeGreaterThanOrEqual(1)
    expect(governor.dpr).toBeLessThanOrEqual(2)
  })

  it('treats a 1× device as already at the floor', () => {
    const governor = new DprGovernor({ maxDpr: 1, minDpr: 1 })
    expect(run(governor, 50, 30)).toEqual([])
    expect(governor.dpr).toBe(1)
  })
})
