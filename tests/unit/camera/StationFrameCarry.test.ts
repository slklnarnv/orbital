// ─── StationFrameCarry.test.ts — station-locked tracking camera ──────────────
//
// Scrubbing the orbit tape in Follow swung the camera around the station:
// the offset stayed fixed in inertial space while the station's Earth-facing
// frame turned. The carry rotates the eye and up with the station.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import CameraControls from 'camera-controls'

import { StationFrameCarry, carryControls, carryPose } from '@/interaction/camera/StationFrameCarry'

const station = (angleRad: number) =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.3, 0.9, 0.2).normalize(), angleRad)

describe('StationFrameCarry', () => {
  it('yields nothing on the first frame after a reset', () => {
    const carry = new StationFrameCarry()
    expect(carry.step(station(0.4), new THREE.Quaternion())).toBeNull()
    carry.reset()
    expect(carry.step(station(0.9), new THREE.Quaternion())).toBeNull()
  })

  it('yields the rotation between consecutive attitudes', () => {
    const carry = new StationFrameCarry()
    carry.step(station(0.2), new THREE.Quaternion())
    const rotation = carry.step(station(0.5), new THREE.Quaternion())!
    expect(rotation.clone().multiply(station(0.2)).angleTo(station(0.5))).toBeLessThan(1e-6)
  })
})

describe('carryPose', () => {
  it('keeps the eye fixed in the station frame across a half-orbit scrub', () => {
    const carry = new StationFrameCarry()
    const pivot = new THREE.Vector3(6800, 0, 0)
    const eye = pivot.clone().add(new THREE.Vector3(250, 0, 250))
    const up = new THREE.Vector3(0, 1, 0)
    // The eye's offset expressed in the station's own frame at the start.
    let attitude = station(0)
    carry.step(attitude, new THREE.Quaternion())
    const local = eye.clone().sub(pivot).applyQuaternion(attitude.clone().invert())
    // Many uneven steps, as a scrub produces, then one big seek.
    for (const angle of [0.05, 0.12, 0.13, 0.4, 0.41, 0.9, Math.PI]) {
      attitude = station(angle)
      const rotation = carry.step(attitude, new THREE.Quaternion())!
      carryPose(eye, pivot, up, rotation)
    }
    const after = eye.clone().sub(pivot).applyQuaternion(attitude.clone().invert())
    expect(after.distanceTo(local)).toBeLessThan(1e-6)
    expect(eye.distanceTo(pivot)).toBeCloseTo(Math.hypot(250, 250), 6)
    expect(up.length()).toBeCloseTo(1, 12)
    // The up vector rode along too: it is the start up in station coordinates.
    expect(up.clone().applyQuaternion(attitude.clone().invert()).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-9)
  })
})

describe('carryControls (wheel zoom while tracking)', () => {
  // Regression: carrying only the rendered pose reset camera-controls' end
  // pose every frame the clock ran, so a smoothed dolly stalled after one
  // frame (ten wheel ticks: 352 → 328 km instead of ~100 km).
  CameraControls.install({ THREE })
  // camera-controls builds a DOMRect for its element bounds; node has none.
  globalThis.DOMRect ??= class {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
  } as unknown as typeof DOMRect

  function controlsAt(distance: number): CameraControls {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 2e6)
    const controls = new CameraControls(camera)
    void controls.setLookAt(0, 0, distance, 0, 0, 0, false)
    controls.update(0)
    return controls
  }

  /** The 2026-10-26 carry: rendered pose only (it reset the end pose). */
  function renderedPoseOnly(controls: CameraControls, rotation: THREE.Quaternion): void {
    const eye = controls.getPosition(new THREE.Vector3(), false)
    const target = controls.getTarget(new THREE.Vector3(), false)
    const up = controls.camera.up.clone()
    carryPose(eye, target, up, rotation)
    controls.camera.up.copy(up)
    controls.updateCameraUp()
    void controls.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, false)
  }

  type Carry = (controls: CameraControls, rotation: THREE.Quaternion) => void

  /** A smoothed dolly to `goal`, stepped at 60 fps with the station turning 0.065°/s. */
  function dolly(goal: number, carry: Carry | null): number {
    const controls = controlsAt(352)
    void controls.dollyTo(goal, true)
    const step = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (0.065 * Math.PI) / 180 / 60)
    for (let frame = 0; frame < 240; frame++) {
      controls.update(1 / 60)
      carry?.(controls, step)
      controls.update(0)
    }
    return controls.distance
  }

  it('reaches the same distance with the station carry running as without', () => {
    const still = dolly(102, null)
    expect(still).toBeLessThan(110)
    expect(Math.abs(dolly(102, carryControls) - still)).toBeLessThan(1)
  })

  it('documents the bug: carrying only the rendered pose stalls the dolly', () => {
    expect(dolly(102, renderedPoseOnly)).toBeGreaterThan(300)
  })

  it('keeps the user-control flags of a gesture in progress', () => {
    const controls = controlsAt(352)
    const internals = controls as unknown as { _isUserControllingDolly?: boolean }
    internals._isUserControllingDolly = true
    carryControls(controls, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1e-4))
    expect(internals._isUserControllingDolly).toBe(true)
  })
})
