import { describe, expect, it } from 'vitest'
import { depthBiasPullKm, GROUND_TRACK_DEPTH_BIAS_NDC } from '@/rendering/earth/groundTrackDepth'

const NEAR_KM = 1

describe('ground track depth bias', () => {
  it('beats the ~20.7 km depth gap at the 25,000 km home view', () => {
    const pull = depthBiasPullKm(GROUND_TRACK_DEPTH_BIAS_NDC, 18_629, NEAR_KM)
    expect(pull).toBeGreaterThanOrEqual(40)
    expect(pull).toBeLessThanOrEqual(120)
  })

  it('still clears the surface at 13,629 km', () => {
    const pull = depthBiasPullKm(GROUND_TRACK_DEPTH_BIAS_NDC, 13_629, NEAR_KM)
    expect(pull).toBeGreaterThanOrEqual(20)
    expect(pull).toBeLessThanOrEqual(80)
  })

  it('cannot lift the track over the station at Follow range', () => {
    expect(depthBiasPullKm(GROUND_TRACK_DEPTH_BIAS_NDC, 478, NEAR_KM)).toBeLessThan(0.1)
  })
})
