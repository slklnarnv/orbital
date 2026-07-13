import { describe, expect, it } from 'vitest'
import { cloudRotationAtEpoch } from '@/rendering/earth/CloudMotion'

describe('cloudRotationAtEpoch', () => {
  it('advances exactly once from absolute simulation time', () => {
    const epochMs = Date.UTC(2026, 6, 13)
    const start = cloudRotationAtEpoch(epochMs)
    const oneSecondLater = cloudRotationAtEpoch(epochMs + 1000)
    const delta = oneSecondLater >= start
      ? oneSecondLater - start
      : oneSecondLater + Math.PI * 2 - start

    expect(delta).toBeCloseTo(0.0002, 10)
  })

  it('returns the same angle when a render frame rereads one runtime snapshot', () => {
    const epochMs = Date.UTC(2026, 6, 13, 12, 0, 0)

    expect(cloudRotationAtEpoch(epochMs)).toBe(cloudRotationAtEpoch(epochMs))
  })
})
