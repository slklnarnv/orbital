import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { AttitudeFollower, TEA_YAW_BIAS_RAD, lvlhAttitude } from '@/rendering/iss/stationAttitude'

const DEG = Math.PI / 180

describe('lvlhAttitude', () => {
  const position = new THREE.Vector3(6790, 0, 0)
  const velocity = new THREE.Vector3(0, 4.7, 6.0)

  it('points body +Z at nadir and body +X along V-bar, trimmed by the TEA yaw', () => {
    const q = new THREE.Quaternion()
    expect(lvlhAttitude(position, velocity, q)).toBe(true)
    const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
    expect(z.distanceTo(position.clone().negate().normalize())).toBeLessThan(1e-9)
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
    // The yaw turns body +X about nadir, off V-bar by exactly the bias.
    expect(x.angleTo(velocity.clone().normalize())).toBeCloseTo(Math.abs(TEA_YAW_BIAS_RAD), 9)
    // Starboard (+Y) is −orbit normal, up to the same yaw.
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
    const minusNormal = position.clone().cross(velocity).negate().normalize()
    expect(y.angleTo(minusNormal)).toBeCloseTo(Math.abs(TEA_YAW_BIAS_RAD), 9)
  })

  it('leaves the attitude untouched for a degenerate frame', () => {
    const q = new THREE.Quaternion(0.1, 0.2, 0.3, 0.9).normalize()
    const before = q.clone()
    expect(lvlhAttitude(position, new THREE.Vector3(), q)).toBe(false)
    expect(lvlhAttitude(position, position.clone(), q)).toBe(false)
    expect(q.equals(before)).toBe(true)
  })
})

describe('AttitudeFollower', () => {
  const AXIS = new THREE.Vector3(0.2, 1, 0.1).normalize()
  /** LVLH turn rate at 300× (one orbit per ~5,560 s). */
  const RATE = 300 * (2 * Math.PI) / 5560
  const target = (t: number) => new THREE.Quaternion().setFromAxisAngle(AXIS, RATE * t)

  it('follows a target turning at 300× with no lag (a plain slerp trailed ~12°)', () => {
    const current = new THREE.Quaternion()
    const follower = new AttitudeFollower(current, 1.6)
    const slerped = new THREE.Quaternion()
    const dt = 1 / 60
    for (let t = 0; t <= 8; t += dt) {
      follower.step(target(t), dt)
      slerped.slerp(target(t), 1 - Math.exp(-1.6 * dt))
    }
    expect(current.angleTo(target(8 - (8 % dt)))).toBeLessThan(0.01 * DEG)
    // The old behaviour, for the record: steady lag = rate / stiffness.
    expect(slerped.angleTo(target(8 - (8 % dt))) / DEG).toBeGreaterThan(10)
  })

  it('eases a jump in without moving the shown attitude on the jump frame', () => {
    const current = new THREE.Quaternion()
    const follower = new AttitudeFollower(current, 1.6)
    const dt = 1 / 60
    let t = 0
    for (; t < 5; t += dt) follower.step(target(t), dt)
    const beforeJump = current.clone()
    const jumped = target(t).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 90 * DEG))
    follower.step(jumped, dt)
    // Only one frame of decay: 90° × (1 − e^(−1.6/60)) ≈ 2.4°.
    expect(current.angleTo(beforeJump) / DEG).toBeLessThan(2.6)
    for (let i = 0; i < 4 / dt; i += 1) follower.step(jumped, dt)
    expect(current.angleTo(jumped) / DEG).toBeLessThan(0.2)
  })

  it('captures the first target smoothly from the starting attitude', () => {
    const current = new THREE.Quaternion()
    const follower = new AttitudeFollower(current, 1.6)
    const goal = new THREE.Quaternion().setFromAxisAngle(AXIS, 120 * DEG)
    follower.step(goal, 1 / 60)
    expect(current.angleTo(new THREE.Quaternion()) / DEG).toBeLessThan(5)
    for (let i = 0; i < 300; i += 1) follower.step(goal, 1 / 60)
    expect(current.angleTo(goal) / DEG).toBeLessThan(1)
  })
})
