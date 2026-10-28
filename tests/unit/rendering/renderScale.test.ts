import { describe, expect, it } from 'vitest'
import {
  COARSE_POINTER_MAX_DPR,
  dprCeiling,
  dprFloor,
  isRenderScale,
  pinnedDpr,
} from '@/rendering/scene/renderScale'

describe('dprCeiling', () => {
  it('caps a DPR-3 phone at the coarse-pointer ceiling', () => {
    expect(dprCeiling(3, true)).toBe(COARSE_POINTER_MAX_DPR)
    expect(COARSE_POINTER_MAX_DPR).toBeLessThanOrEqual(2)
  })

  it('keeps a lower device ratio as is', () => {
    expect(dprCeiling(1, false)).toBe(1)
    expect(dprCeiling(1.25, true)).toBe(1.25)
  })

  it('treats a missing or invalid ratio as 1', () => {
    expect(dprCeiling(0, false)).toBe(1)
    expect(dprCeiling(Number.NaN, true)).toBe(1)
  })
})

describe('dprFloor', () => {
  it('is 1 or the ceiling, whichever is lower', () => {
    expect(dprFloor(2)).toBe(1)
    expect(dprFloor(0.8)).toBe(0.8)
  })
})

describe('pinnedDpr', () => {
  it('is null for Auto (the governor decides)', () => {
    expect(pinnedDpr(2, 'auto')).toBeNull()
  })

  it('is a fraction of the ceiling', () => {
    expect(pinnedDpr(2, 1)).toBe(2)
    expect(pinnedDpr(2, 0.75)).toBe(1.5)
    expect(pinnedDpr(2, 0.5)).toBe(1)
  })

  it('never pins below 0.5 unless the ceiling is lower', () => {
    expect(pinnedDpr(0.8, 0.5)).toBe(0.5)
    expect(pinnedDpr(0.4, 0.5)).toBe(0.4)
  })
})

describe('isRenderScale', () => {
  it('accepts the four options only', () => {
    expect(['auto', 1, 0.75, 0.5].every(isRenderScale)).toBe(true)
    expect(isRenderScale(2)).toBe(false)
    expect(isRenderScale('1')).toBe(false)
    expect(isRenderScale(null)).toBe(false)
  })
})
