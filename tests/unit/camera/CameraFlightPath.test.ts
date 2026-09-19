import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { CameraFlightPath } from '@/interaction/camera/CameraFlightPath'

const origin = new Vector3()
const CLEARANCE = 6500

describe('Reset View flight', () => {
  it('eases away from close view instead of completing most movement immediately', () => {
    const path = new CameraFlightPath(new Vector3(0, 0, 7000), new Vector3(0, 0, 6800))
    const eye = new Vector3()
    const target = new Vector3()
    path.sampleReset(25000, 0, eye, target)
    expect(eye.toArray()).toEqual([0, 0, 7000])
    expect(target.toArray()).toEqual([0, 0, 6800])
    path.sampleReset(25000, 0.1, eye, target)
    expect(eye.length() - 7000).toBeLessThan(200)
    path.sampleReset(25000, 0.5, eye, target)
    expect(eye.length()).toBeCloseTo(16000)
    path.sampleReset(25000, 1, eye, target)
    expect(eye.length()).toBeCloseTo(25000)
    expect(target.length()).toBeLessThan(1e-8)
  })

  it('turns smoothly when the initial free view points away from Earth', () => {
    const path = new CameraFlightPath(new Vector3(0, 0, 7000), new Vector3(0, 0, 10000))
    const eye = new Vector3()
    const target = new Vector3()
    const previousDirection = new Vector3(0, 0, 1)
    const direction = new Vector3()
    for (let i = 0; i <= 200; i++) {
      path.sampleReset(25000, i / 200, eye, target)
      expect(eye.distanceTo(target)).toBeGreaterThan(1000)
      direction.subVectors(target, eye).normalize()
      expect(direction.dot(previousDirection)).toBeGreaterThan(0.998)
      expect(eye.x).toBe(0)
      expect(eye.y).toBe(0)
      previousDirection.copy(direction)
    }
    expect(direction.z).toBeCloseTo(-1)
  })
})

describe('simple Locate sweep', () => {
  it('starts at the captured view and ends centered on the station', () => {
    // Departure from overview looking at Earth's center: the first sampled
    // view must equal the captured one, and the last must land on the station.
    const start = new Vector3(0, 0, 18000)
    const path = new CameraFlightPath(start, origin.clone())
    const station = new Vector3(2326, 0, -6390)
    const up = station.clone().normalize()
    const tangent = new Vector3().crossVectors(up, new Vector3(0, 1, 0)).normalize()
    const arrival = station.clone().addScaledVector(up, 250).addScaledVector(tangent, 250)
    path.planLocate(arrival, station)
    const eye = new Vector3()
    const target = new Vector3()
    path.sampleLocate(arrival, station, 0, eye, target)
    const capturedView = origin.clone().sub(start).normalize()
    const firstView = target.clone().sub(eye).normalize()
    expect(firstView.angleTo(capturedView)).toBeLessThan(1e-9)
    path.sampleLocate(arrival, station, 1, eye, target)
    expect(target.distanceTo(station)).toBeLessThan(1e-9)
    expect(eye.distanceTo(arrival)).toBeLessThan(1e-6)
  })

  it('stays outside Earth and never approaches the station inside its standoff', () => {
    // Far-side station at planetary distance: the sweep must round the globe
    // without dipping into the clearance sphere or swinging through the model.
    const start = new Vector3(0, 0, 60000)
    const path = new CameraFlightPath(start, origin.clone())
    const station = new Vector3(Math.sin(160 * Math.PI / 180) * 6800, 0, Math.cos(160 * Math.PI / 180) * 6800)
    const up = station.clone().normalize()
    const tangent = new Vector3().crossVectors(up, new Vector3(0, 1, 0)).normalize()
    const arrival = station.clone().addScaledVector(up, 250).addScaledVector(tangent, 250)
    path.planLocate(arrival, station)
    const eye = new Vector3()
    const target = new Vector3()
    let previousRadius = start.length()
    for (let i = 0; i <= 300; i++) {
      path.sampleLocate(arrival, station, i / 300, eye, target)
      const radius = eye.length()
      expect(radius).toBeGreaterThanOrEqual(CLEARANCE)
      expect(radius).toBeLessThanOrEqual(previousRadius + 1e-6) // monotonic descent
      previousRadius = radius
      expect(eye.distanceTo(station)).toBeGreaterThanOrEqual(250 - 1e-6)
    }
    expect(eye.distanceTo(arrival)).toBeLessThan(1e-6)
  })

  it('keeps per-sample motion continuous for a near-antipodal departure', () => {
    // The station almost exactly behind the globe: the interpolated direction
    // would cross zero without the sideways bow; the sweep must stay smooth.
    const start = new Vector3(0, 0, 60000)
    const path = new CameraFlightPath(start, origin.clone())
    const station = new Vector3(0, 0, -6800)
    const up = station.clone().normalize()
    const tangent = new Vector3().crossVectors(up, new Vector3(0, 1, 0)).normalize()
    const arrival = station.clone().addScaledVector(up, 250).addScaledVector(tangent, 250)
    path.planLocate(arrival, station)
    const eye = new Vector3()
    const target = new Vector3()
    const view = new Vector3()
    const previousView = new Vector3()
    let maxStep = 0
    for (let i = 0; i <= 400; i++) {
      path.sampleLocate(arrival, station, i / 400, eye, target)
      view.subVectors(target, eye).normalize()
      if (i > 0) maxStep = Math.max(maxStep, view.angleTo(previousView))
      previousView.copy(view)
      expect(Number.isFinite(eye.x + eye.y + eye.z)).toBe(true)
      expect(eye.length()).toBeGreaterThanOrEqual(CLEARANCE)
    }
    expect(maxStep).toBeLessThan(0.06)
    path.sampleLocate(arrival, station, 1, eye, target)
    expect(target.distanceTo(station)).toBeLessThan(1e-9)
  })

  it('rotates the world once on a far-side route', () => {
    // The view pans from the captured pivot to the station while the eye
    // sweeps — the total view travel must track the route sweep, not double it.
    const start = new Vector3(0, 0, 60000)
    const path = new CameraFlightPath(start, origin.clone())
    const station = new Vector3(Math.sin(160 * Math.PI / 180) * 6800, 0, Math.cos(160 * Math.PI / 180) * 6800)
    const up = station.clone().normalize()
    const tangent = new Vector3().crossVectors(up, new Vector3(0, 1, 0)).normalize()
    const arrival = station.clone().addScaledVector(up, 250).addScaledVector(tangent, 250)
    path.planLocate(arrival, station)
    const eye = new Vector3()
    const target = new Vector3()
    const view = new Vector3()
    const previousView = new Vector3()
    let totalViewTravel = 0
    for (let i = 0; i <= 300; i++) {
      path.sampleLocate(arrival, station, i / 300, eye, target)
      view.subVectors(target, eye).normalize()
      if (i > 0) totalViewTravel += view.angleTo(previousView)
      previousView.copy(view)
    }
    const routeSweep = 160 * Math.PI / 180
    expect(totalViewTravel).toBeLessThan(routeSweep * 1.5)
    expect(totalViewTravel).toBeGreaterThan(routeSweep * 0.6)
  })

  it('eases departure and arrival without a waypoint pause', () => {
    const path = new CameraFlightPath(new Vector3(0, 0, 18000), origin.clone())
    const station = new Vector3(Math.sin(50 * Math.PI / 180) * 6800, 0, Math.cos(50 * Math.PI / 180) * 6800)
    const up = station.clone().normalize()
    const tangent = new Vector3().crossVectors(up, new Vector3(0, 1, 0)).normalize()
    const arrival = station.clone().addScaledVector(up, 250).addScaledVector(tangent, 250)
    path.planLocate(arrival, station)
    const a = new Vector3()
    const b = new Vector3()
    const t1 = new Vector3()
    const t2 = new Vector3()
    path.sampleLocate(arrival, station, 0, a, t1)
    path.sampleLocate(arrival, station, 0.001, b, t2)
    expect(a.distanceTo(b)).toBeLessThan(1)
    expect(t1.distanceTo(t2)).toBeLessThan(5)
    path.sampleLocate(arrival, station, 0.49, a, t1)
    path.sampleLocate(arrival, station, 0.51, b, t2)
    expect(a.distanceTo(b)).toBeGreaterThan(1)
    path.sampleLocate(arrival, station, 0.999, a, t1)
    path.sampleLocate(arrival, station, 1, b, t2)
    expect(a.distanceTo(b)).toBeLessThan(1)
  })
})
