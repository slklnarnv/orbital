// ─── StationFrameCarry.test.ts — station-locked tracking camera ──────────────
//
// Scrubbing the orbit tape in Follow swung the camera around the station:
// the offset stayed fixed in inertial space while the station's Earth-facing
// frame turned. The carry rotates the eye and up with the station.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { StationFrameCarry, carryPose } from '@/interaction/camera/StationFrameCarry'

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
