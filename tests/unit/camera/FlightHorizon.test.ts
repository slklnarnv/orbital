import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { FlightHorizon } from '@/interaction/camera/FlightHorizon'

const WORLD_UP = new Vector3(0, 1, 0)
const DT = 1 / 60

/** Signed roll of an up vector against the world-up horizon, about the view axis. */
function rollErrorDeg(view: Vector3, up: Vector3): number {
  const projected = WORLD_UP.clone().addScaledVector(view, -view.y).normalize()
  const cross = new Vector3().crossVectors(up, projected)
  return Math.atan2(view.dot(cross), up.dot(projected)) * 180 / Math.PI
}

describe('FlightHorizon', () => {
  it('starts exactly at the captured orientation and ends level with world-up', () => {
    // Planetary-scale Locate with the station at the globe's top: the view
    // sweeps ~86° while descending. The horizon must not roll with it.
    const view0 = new Vector3(0, 0, -1)
    const up0 = new Vector3(0, 1, 0)
    const horizon = new FlightHorizon(view0, up0)
    const sweepAxis = new Vector3(1, 0, 0)
    const result = new Vector3()

    // First frame: exactly the captured up, no snap.
    horizon.update(view0, 0, DT, result)
    expect(result.angleTo(up0)).toBeLessThan(1e-9)

    // Sweep the view 86° with an eased profile over 240 frames.
    const totalSweep = 86 * Math.PI / 180
    let maxAbsRoll = 0
    for (let i = 1; i <= 240; i++) {
      const progress = i / 240
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2
      const view = view0.clone().applyAxisAngle(sweepAxis, -totalSweep * eased)
      horizon.update(view, progress, DT, result)
      maxAbsRoll = Math.max(maxAbsRoll, Math.abs(rollErrorDeg(view, result)))
    }

    // The image must never spin far from the world-up horizon mid-sweep...
    expect(maxAbsRoll).toBeLessThan(25)
    // ...and must arrive exactly level.
    const finalView = view0.clone().applyAxisAngle(sweepAxis, -totalSweep)
    horizon.update(finalView, 1, DT, result)
    expect(Math.abs(rollErrorDeg(finalView, result))).toBeLessThan(1e-6)
  })

  it('converges a fully rolled departure to level without a first-frame snap', () => {
    // Free-orbit departure rolled upside down: the first frame keeps the
    // rendered orientation, and the horizon settles by arrival.
    const view0 = new Vector3(0, 0, -1)
    const up0 = new Vector3(0, -1, 0) // rolled 180°
    const horizon = new FlightHorizon(view0, up0)
    const result = new Vector3()

    horizon.update(view0, 0, DT, result)
    expect(result.angleTo(up0)).toBeLessThan(1e-9)

    const sweepAxis = new Vector3(1, 0, 0)
    const totalSweep = 60 * Math.PI / 180
    let previousRoll = 180
    for (let i = 1; i <= 240; i++) {
      const progress = i / 240
      const view = view0.clone().applyAxisAngle(sweepAxis, -totalSweep * progress)
      horizon.update(view, progress, DT, result)
      const roll = Math.abs(rollErrorDeg(view, result))
      expect(roll).toBeLessThanOrEqual(previousRoll + 1e-6) // monotonic settle
      previousRoll = roll
    }
    const finalView = view0.clone().applyAxisAngle(sweepAxis, -totalSweep)
    horizon.update(finalView, 1, DT, result)
    expect(Math.abs(rollErrorDeg(finalView, result))).toBeLessThan(1e-6)
  })

  it('keeps the roll bounded across a world-pole pass', () => {
    // Routes that sweep near the scene's Y pole hit the projected-horizon
    // singularity; the correction must freeze through the pass and unwind
    // smoothly after, never kicking.
    const view0 = new Vector3(0, 0, -1)
    const up0 = new Vector3(0, 1, 0)
    const horizon = new FlightHorizon(view0, up0)
    const result = new Vector3()
    // Sweep the view through the +Y pole: 200° of pitch about X.
    const sweepAxis = new Vector3(1, 0, 0)
    const totalSweep = 200 * Math.PI / 180
    let maxRightStep = 0
    let previousRight: Vector3 | null = null
    let previousUp = up0.clone()
    for (let i = 1; i <= 300; i++) {
      const progress = i / 300
      const view = view0.clone().applyAxisAngle(sweepAxis, -totalSweep * progress)
      horizon.update(view, progress, DT, result)
      const right = new Vector3().crossVectors(result, view).normalize()
      if (previousRight) {
        maxRightStep = Math.max(maxRightStep, right.angleTo(previousRight) * 180 / Math.PI)
      }
      previousRight = right
      previousUp = result.clone()
    }
    // No frame may snap the horizon; rate-capped unwinding stays gentle.
    expect(maxRightStep).toBeLessThan(3)
  })

  it('with the world-up blend disabled, the up is pure transport through a pole pass', () => {
    // Locate keeps the horizon exactly as the user had it: no forced arrival
    // orientation, so a route sweeping through both world poles never flips
    // and never references the world-up singularity.
    const view0 = new Vector3(0, 0, -1)
    const up0 = new Vector3(0, 1, 0)
    const horizon = new FlightHorizon(view0, up0)
    const sweepAxis = new Vector3(1, 0, 0)
    const result = new Vector3()
    const totalSweep = 2 * Math.PI // full revolution, through both poles
    for (let i = 1; i <= 300; i++) {
      const view = view0.clone().applyAxisAngle(sweepAxis, totalSweep * i / 300)
      horizon.update(view, i / 300, DT, result, 0)
      expect(Number.isFinite(result.x + result.y + result.z)).toBe(true)
      expect(Math.abs(result.dot(view))).toBeLessThan(1e-6) // stays perpendicular
    }
    // The final up is exactly the initial up carried through the same rotation.
    const expected = up0.clone().applyAxisAngle(sweepAxis, totalSweep)
    expect(result.angleTo(expected)).toBeLessThan(1e-6)
  })
})
