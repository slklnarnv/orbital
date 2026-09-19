import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { Vector3 } from 'three'
import CameraControls from 'camera-controls'
import { CameraNavigationConstraint, resolveEarthCollision } from '@/interaction/camera/CameraNavigationConstraint'
import { CAMERA_ZOOM_RANGES } from '@/interaction/camera/CameraStateMachine'

const radius = CAMERA_ZOOM_RANGES.ORBITAL.minDistance

describe('Earth camera clearance', () => {
  it('stops an inward movement before the eye enters the planet', () => {
    const result = new Vector3()
    resolveEarthCollision(new Vector3(radius + 100, 0, 0), new Vector3(radius - 200, 0, 0), result)
    expect(result.x).toBeGreaterThanOrEqual(radius)
    expect(result.x).toBeLessThan(radius + 1)
    expect(result.y).toBe(0)
  })

  it('slides along contact instead of discarding tangential drag', () => {
    const result = new Vector3()
    resolveEarthCollision(new Vector3(radius + 10, 0, 0), new Vector3(radius - 100, 100, 0), result)
    expect(result.length()).toBeGreaterThanOrEqual(radius)
    expect(result.y).toBeGreaterThan(50)
    expect(result.x).toBeGreaterThan(0)
  })

  it('blocks a fast pan through Earth even when both endpoints are outside', () => {
    const result = new Vector3()
    resolveEarthCollision(new Vector3(radius + 100, 0, 0), new Vector3(-radius - 100, 0, 0), result)
    expect(result.x).toBeGreaterThanOrEqual(radius)
    expect(result.x).toBeLessThan(radius + 1)
  })

  it('allows moving away from contact without sticking to the surface', () => {
    const desired = new Vector3(radius + 500, 200, 0)
    const result = new Vector3()
    resolveEarthCollision(new Vector3(radius, 0, 0), desired, result)
    expect(result.toArray()).toEqual(desired.toArray())
  })

  it('does not mistake Earth-centred spherical rotation for a straight pan', () => {
    const desired = new Vector3(-radius, 0, 0)
    const result = new Vector3()
    resolveEarthCollision(new Vector3(radius, 0, 0), desired, result, false)
    expect(result.toArray()).toEqual(desired.toArray())
  })

  it('recovers an initially underground eye, including the zero-vector case', () => {
    const result = new Vector3()
    resolveEarthCollision(new Vector3(), new Vector3(), result)
    expect(result.length()).toBeGreaterThanOrEqual(radius)
    expect(result.toArray().every(Number.isFinite)).toBe(true)
  })

  it('keeps repeated grazing and polar movements outside the clearance sphere', () => {
    const previous = new Vector3(0, radius + 10, 0)
    const desired = new Vector3()
    const result = new Vector3()
    for (let i = 0; i < 500; i++) {
      desired.copy(previous).multiplyScalar(0.98)
      desired.x += Math.sin(i * 0.13) * 120
      desired.z += Math.cos(i * 0.17) * 120
      resolveEarthCollision(previous, desired, result)
      expect(result.length()).toBeGreaterThanOrEqual(radius)
      previous.copy(result)
    }
  })
})

describe('camera-controls collision integration', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves orbit distance through a blocked damped Free pan', () => {
    vi.stubGlobal('DOMRect', class {})
    CameraControls.install({ THREE })
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000)
    const controls = new CameraControls(camera)
    const constraint = new CameraNavigationConstraint()
    try {
      void controls.setLookAt(0, 0, 9000, 0, 0, 8000, false)
      controls.update(0)
      constraint.reset(controls)
      void controls.moveTo(0, 0, -9000, true)
      const pivot = new Vector3()
      for (let frame = 0; frame < 180; frame++) {
        controls.update(1 / 60)
        constraint.update(controls, true)
        controls.getTarget(pivot, false)
        expect(camera.position.length()).toBeGreaterThanOrEqual(radius)
        expect(camera.position.distanceTo(pivot)).toBeCloseTo(1000, 6)
      }
      expect(camera.position.z).toBeLessThan(radius + 1)
      expect(pivot.z).toBeGreaterThan(0)
    } finally {
      controls.dispose()
    }
  })

  it('keeps the ISS pivot fixed when an orbit hits Earth', () => {
    vi.stubGlobal('DOMRect', class {})
    CameraControls.install({ THREE })
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000)
    const controls = new CameraControls(camera)
    const constraint = new CameraNavigationConstraint()
    try {
      void controls.setLookAt(0, 0, 6800, 0, 0, 7000, false)
      controls.update(0)
      constraint.reset(controls)
      void controls.dollyTo(2000, true)
      for (let frame = 0; frame < 180; frame++) {
        controls.update(1 / 60)
        constraint.update(controls, false)
        expect(camera.position.length()).toBeGreaterThanOrEqual(radius)
      }
      expect(controls.getTarget(new Vector3(), false).toArray()).toEqual([0, 0, 7000])
      expect(camera.position.z).toBeLessThan(radius + 1)
    } finally {
      controls.dispose()
    }
  })

  it('does not correct a safe grazing orbit around a detached pivot', () => {
    vi.stubGlobal('DOMRect', class {})
    CameraControls.install({ THREE })
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000)
    const controls = new CameraControls(camera)
    const constraint = new CameraNavigationConstraint()
    // The pivot sits below the eye and off-axis, so the eye hugs the clearance
    // sphere while orbiting the pivot. The arc keeps its Earth radius; only the
    // straight chord between endpoints dips inside — the orbit must not be
    // "corrected" for that phantom collision.
    const pivot = new Vector3(0, 0, 6400)
    const startEye = new Vector3(1136.35, 0, 6400)
    startEye.setLength(radius + 0.1)
    const endEye = startEye.clone().applyAxisAngle(new Vector3(0, 0, 1), 5 * Math.PI / 180)
    expect(startEye.length()).toBeGreaterThanOrEqual(radius)
    expect(endEye.length()).toBeCloseTo(startEye.length(), 6)
    try {
      void controls.setLookAt(startEye.x, startEye.y, startEye.z, pivot.x, pivot.y, pivot.z, false)
      controls.update(0)
      constraint.reset(controls)
      void controls.setLookAt(endEye.x, endEye.y, endEye.z, pivot.x, pivot.y, pivot.z, false)
      controls.update(0)
      constraint.update(controls, true)
      expect(camera.position.distanceTo(endEye)).toBeLessThan(0.05)
      expect(camera.position.length()).toBeGreaterThanOrEqual(radius)
    } finally {
      controls.dispose()
    }
  })
})
