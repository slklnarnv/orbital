import { describe, expect, it } from 'vitest'
import { CameraStateMachine } from '@/interaction/camera/CameraStateMachine'
import type { CameraMode } from '@/types/camera'

describe('camera mode transitions', () => {
  it('keeps planetary mode stable while zoom oscillates around its entry boundary', () => {
    let mode: CameraMode = CameraStateMachine.determineModeFromDistance(35_001, 30_000, 'ORBITAL')
    expect(mode).toBe('PLANETARY')
    for (const distance of [34_999, 35_002, 34_000]) {
      mode = CameraStateMachine.determineModeFromDistance(distance, 30_000, mode)
      expect(mode).toBe('PLANETARY')
    }
    expect(CameraStateMachine.determineModeFromDistance(32_999, 30_000, mode)).toBe('ORBITAL')
  })

  it('keeps close-up tracking stable across the inspect entry boundary', () => {
    expect(CameraStateMachine.determineModeFromDistance(7000, 199, 'FOLLOW')).toBe('INSPECT')
    expect(CameraStateMachine.determineModeFromDistance(7000, 210, 'INSPECT')).toBe('INSPECT')
    expect(CameraStateMachine.determineModeFromDistance(7000, 221, 'INSPECT')).toBe('FOLLOW')
  })

  it('leaves ISS tracking only after passing the approach exit band', () => {
    expect(CameraStateMachine.determineModeFromDistance(18000, 12_500, 'APPROACH')).toBe('APPROACH')
    expect(CameraStateMachine.determineModeFromDistance(18000, 13_001, 'APPROACH')).toBe('ORBITAL')
  })

  it('never steals a free or Earth-focused pivot because the ISS is nearby', () => {
    expect(CameraStateMachine.determineModeFromDistance(6800, 1, 'ORBITAL')).toBe('ORBITAL')
    expect(CameraStateMachine.determineModeFromDistance(6800, 1, 'FREE')).toBe('FREE')
    expect(CameraStateMachine.determineModeFromDistance(50000, 60000, 'FREE')).toBe('FREE')
  })

  it('leaves detached inspection for Earth navigation when Free zooms out', () => {
    expect(CameraStateMachine.determineModeFromDistance(9000, 4000, 'FREE', true)).toBe('ORBITAL')
    expect(CameraStateMachine.determineModeFromDistance(45000, 40000, 'FREE', true)).toBe('PLANETARY')
    expect(CameraStateMachine.determineModeFromDistance(9000, 4000, 'FREE', false)).toBe('FREE')
  })

  it('keeps the zoom meter bounded and monotonic over the full navigation range', () => {
    let previous = 1
    for (const distance of [0, 5, 60, 200, 3000, 6500, 35000, 100000, 200000]) {
      const depth = CameraStateMachine.getZoomProgress(distance)
      expect(depth).toBeGreaterThanOrEqual(0)
      expect(depth).toBeLessThanOrEqual(previous)
      previous = depth
    }
    expect(previous).toBe(0)
  })
})

describe('free zoom-out release', () => {
  it('releases a close inspect pan after roughly the gesture that leaves INSPECT', () => {
    // A 150 km inspect pan must not demand a 3,300 km pivot distance.
    expect(CameraStateMachine.isFreeZoomOut(220, 150)).toBe(true)
    expect(CameraStateMachine.isFreeZoomOut(219, 150)).toBe(false)
    // A max-zoom inspect pan (60 km) needs a large relative zoom-out, matching
    // how far the same user would have to scroll out of INSPECT itself.
    expect(CameraStateMachine.isFreeZoomOut(220, 60)).toBe(true)
    expect(CameraStateMachine.isFreeZoomOut(219, 60)).toBe(false)
  })

  it('keeps wide pans attached until the zoom clearly exceeds the entry distance', () => {
    expect(CameraStateMachine.isFreeZoomOut(6500 * 1.24, 6500)).toBe(false)
    expect(CameraStateMachine.isFreeZoomOut(6500 * 1.26, 6500)).toBe(true)
    expect(CameraStateMachine.isFreeZoomOut(18000 * 1.24, 18000)).toBe(false)
    expect(CameraStateMachine.isFreeZoomOut(18000 * 1.26, 18000)).toBe(true)
  })

  it('never releases while zooming in on the detached pivot', () => {
    expect(CameraStateMachine.isFreeZoomOut(80, 150)).toBe(false)
    expect(CameraStateMachine.isFreeZoomOut(5000, 6500)).toBe(false)
  })
})
