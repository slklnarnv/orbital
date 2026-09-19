import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import CameraControls from 'camera-controls'
import { rotateOrbit } from '@/interaction/camera/FreeOrbitControls'

beforeEach(() => {
  vi.stubGlobal('DOMRect', class {})
  CameraControls.install({ THREE })
})
afterEach(() => vi.unstubAllGlobals())

describe('unrestricted camera orbit', () => {
  it('continues through both poles and completes a full vertical revolution', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000)
    const controls = new CameraControls(camera)
    try {
      void controls.setLookAt(0, 0, 10000, 0, 0, 0, false)
      controls.update(0)
      const initial = camera.quaternion.clone()
      rotateOrbit(controls, 0, -Math.PI / 2)
      expect(camera.position.y).toBeCloseTo(10000, 6)
      rotateOrbit(controls, 0, -Math.PI / 2)
      expect(camera.position.z).toBeCloseTo(-10000, 6)
      rotateOrbit(controls, 0, -Math.PI / 2)
      expect(camera.position.y).toBeCloseTo(-10000, 6)
      rotateOrbit(controls, 0, -Math.PI / 2)
      expect(camera.position.z).toBeCloseTo(10000, 6)
      expect(camera.quaternion.angleTo(initial)).toBeLessThan(1e-6)
    } finally {
      controls.dispose()
    }
  })

  it('preserves a queued zoom while rotating across a pole', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000)
    const controls = new CameraControls(camera)
    try {
      void controls.setLookAt(0, 0, 18000, 0, 0, 0, false)
      controls.update(0)
      void controls.dollyTo(9000, true)
      rotateOrbit(controls, 0.3, -2)
      expect(camera.position.length()).toBeCloseTo(18000, 6)
      expect(controls.getPosition(new THREE.Vector3()).length()).toBeCloseTo(9000, 6)
      for (let i = 0; i < 240; i++) controls.update(1 / 60)
      expect(camera.position.length()).toBeCloseTo(9000, 3)
    } finally {
      controls.dispose()
    }
  })

  it('keeps an ISS inspection pivot and its orbit distance intact', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000)
    const controls = new CameraControls(camera)
    const pivot = new THREE.Vector3(6700, 0, 0)
    try {
      void controls.setLookAt(7000, 300, 0, pivot.x, pivot.y, pivot.z, false)
      controls.update(0)
      const distance = camera.position.distanceTo(pivot)
      for (let i = 0; i < 50; i++) rotateOrbit(controls, 0.2, -0.2)
      expect(camera.position.distanceTo(pivot)).toBeCloseTo(distance, 6)
      expect(controls.getTarget(new THREE.Vector3(), false).toArray()).toEqual(pivot.toArray())
    } finally {
      controls.dispose()
    }
  })
})
