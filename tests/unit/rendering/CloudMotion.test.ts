import { describe, expect, it } from 'vitest'
import { CLOUD_ROTATION_PERIOD_S, cloudRotationAtEpoch } from '@/rendering/earth/CloudMotion'

describe('cloudRotationAtEpoch', () => {
  it('advances exactly once from absolute simulation time', () => {
    const epochMs = Date.UTC(2026, 6, 13)
    const start = cloudRotationAtEpoch(epochMs)
    const oneSecondLater = cloudRotationAtEpoch(epochMs + 1000)
    const delta = oneSecondLater >= start
      ? oneSecondLater - start
      : oneSecondLater + Math.PI * 2 - start

    expect(delta).toBeCloseTo((Math.PI * 2) / CLOUD_ROTATION_PERIOD_S, 10)
  })

  it('returns the same angle when a render frame rereads one runtime snapshot', () => {
    const epochMs = Date.UTC(2026, 6, 13, 12, 0, 0)

    expect(cloudRotationAtEpoch(epochMs)).toBe(cloudRotationAtEpoch(epochMs))
  })

  it('completes one slow relative revolution every five days', () => {
    const epochMs = Date.UTC(2026, 6, 13)

    expect(CLOUD_ROTATION_PERIOD_S).toBe(5 * 24 * 60 * 60)
    expect(cloudRotationAtEpoch(epochMs + CLOUD_ROTATION_PERIOD_S * 1000))
      .toBeCloseTo(cloudRotationAtEpoch(epochMs), 10)
  })
})
