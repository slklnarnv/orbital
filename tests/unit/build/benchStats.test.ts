import { describe, expect, it } from 'vitest'
import { percentile, summariseFrames, summariseGpu } from '../../../scripts/bench/stats.mjs'
import { CPU_BUSY_PCT, descendantPids, summariseCounterRows, summariseCpu } from '../../../scripts/bench/contention.mjs'

describe('bench stats', () => {
  it('uses nearest-rank percentiles', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(sorted, 50)).toBe(5)
    expect(percentile(sorted, 90)).toBe(9)
    expect(percentile(sorted, 99)).toBe(10)
    expect(percentile([], 50)).toBeNull()
  })

  it('summarises frame times from rAF stamps, counting frames over 20 ms', () => {
    // 59 frames at 16.7 ms then one 50 ms hitch.
    const stamps = [0]
    for (let i = 0; i < 59; i++) stamps.push(stamps[stamps.length - 1] + 16.7)
    stamps.push(stamps[stamps.length - 1] + 50)
    const s = summariseFrames(stamps)
    expect(s.frames).toBe(60)
    expect(s.p50).toBe(16.7)
    expect(s.p99).toBe(50)
    expect(s.over20ms).toBe(1)
    expect(s.fps).toBeCloseTo((60 * 1000) / (59 * 16.7 + 50), 1)
  })

  it('reports intermittent passes per run and per frame', () => {
    const frames = [
      { total: 10, draws: 40, passes: { 'fb1 1920x1080': 8, 'fb2 2048x2048': 2 } },
      { total: 8, draws: 38, passes: { 'fb1 1920x1080': 8 } },
    ]
    const s = summariseGpu(frames)!
    expect(s.meanMs).toBe(9)
    const shadow = s.passes.find((p) => p.name === 'fb2 2048x2048')!
    expect(shadow.meanMs).toBe(2)
    expect(shadow.perFrameMs).toBe(1)
    expect(shadow.ranInPct).toBe(50)
    expect(s.passes[0].name).toBe('fb1 1920x1080')
  })
})

describe('GPU contention guard', () => {
  it('takes each process\'s busiest 3D/compute engine, ignoring video and copy', () => {
    const rows = [
      { i: 'pid_100_luid_0x0_phys_0_eng_0_engtype_3D', v: 80 },
      { i: 'pid_100_luid_0x0_phys_0_eng_1_engtype_3D', v: 20 },
      { i: 'pid_200_luid_0x0_phys_0_eng_3_engtype_Video Decode', v: 40 },
      { i: 'pid_300_luid_0x0_phys_0_eng_2_engtype_Compute_0', v: 12 },
      { i: 'not a gpu engine instance', v: 99 },
    ]
    const out = summariseCounterRows(rows)
    expect(out.find((r) => r.pid === 100)).toMatchObject({ pct: 80, engine: '3D' })
    expect(out.find((r) => r.pid === 200)).toMatchObject({ pct: 0, anyPct: 40 })
    expect(out.find((r) => r.pid === 300)).toMatchObject({ pct: 12 })
    expect(out).toHaveLength(3)
  })

  it('sums foreign CPU over the window and leaves the bench processes out', () => {
    const own = new Set([10])
    const names = new Map([[10, 'msedge.exe'], [20, 'msedge.exe'], [30, 'dwm.exe'], [40, 'node.exe']])
    const samples = [
      [{ pid: 10, pct: 30 }, { pid: 20, pct: 40 }, { pid: 30, pct: 5 }],
      [{ pid: 10, pct: 30 }, { pid: 20, pct: 30 }, { pid: 40, pct: 2 }],
    ]
    const out = summariseCpu(samples, own, names)
    expect(out.foreignPct).toBe(36) // (40 + 30) / 2 + 2 / 2; dwm never counts
    expect(out.ownPct).toBe(30)
    expect(out.busy).toBe(out.foreignPct >= CPU_BUSY_PCT)
    expect(out.top[0]).toMatchObject({ pid: 20, pct: 35 })
  })

  it('walks the process tree from the bench roots', () => {
    const processes = [
      { ProcessId: 1, ParentProcessId: 0 },
      { ProcessId: 2, ParentProcessId: 1 },
      { ProcessId: 3, ParentProcessId: 2 },
      { ProcessId: 4, ParentProcessId: 0 },
    ]
    expect([...descendantPids(processes, [1])].sort()).toEqual([1, 2, 3])
  })
})
