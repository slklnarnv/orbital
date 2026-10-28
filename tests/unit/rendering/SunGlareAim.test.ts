// ─── SunGlareAim.test.ts — the glare overlay follows the drawing camera ──────
//
// Locate and Reset flights set the camera's orientation after the priority-0
// frame callbacks. The overlay used to be aimed there, with the pre-flight
// orientation, and landed up to ~945 px from the sun mid-flight; it is now
// aimed in onBeforeRender with the camera that draws the frame.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { projectGlareCenter } from '@/rendering/scene/sunGlareConfig'

function cameraLooking(direction: THREE.Vector3): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 2e6)
  camera.position.set(6800, 0, 0)
  camera.lookAt(camera.position.clone().add(direction))
  camera.updateMatrixWorld()
  return camera
}

describe('projectGlareCenter', () => {
  const sunPoint = new THREE.Vector3(6800, 60_000, -270_000)

  it('projects through the camera it is given, not an earlier one', () => {
    const beforeFlight = cameraLooking(new THREE.Vector3(0, 0.1, -1))
    const midFlight = cameraLooking(new THREE.Vector3(0.25, 0.35, -1))
    const ndc = new THREE.Vector2()
    expect(projectGlareCenter(sunPoint, midFlight, ndc)).toBe(true)
    const truth = sunPoint.clone().project(midFlight)
    expect(ndc.x).toBeCloseTo(truth.x, 9)
    expect(ndc.y).toBeCloseTo(truth.y, 9)
    // The stale camera would have put it somewhere else entirely.
    const stale = sunPoint.clone().project(beforeFlight)
    expect(Math.hypot(stale.x - ndc.x, stale.y - ndc.y)).toBeGreaterThan(0.2)
  })

  it('reports a sun behind the camera as not drawable', () => {
    const facingAway = cameraLooking(new THREE.Vector3(0, -0.2, 1))
    expect(projectGlareCenter(sunPoint, facingAway, new THREE.Vector2())).toBe(false)
  })
})
