// ─── ISSJointKinematics.test.ts — Phase B mechanism regressions ──────────────
//
// Real Three.js hierarchies (no transform-echoing mocks):
//   - outer-frame invariance incl. the Rx45°/Rz60° cases where the previous
//     inverse-world-AABB inference produced zero/parallel references (M2);
//   - axis-frame composition: premultiplied parent-frame deltas (M1);
//   - stationary shaft landmarks: the rotating radiator beam stays coaxial —
//     on-axis points never move (no sweeping the length around the truss);
//   - TRRJ travel limits, two-sided branch continuity, slew in simulation
//     time, singularity holds (M3);
//   - oscillator ownership: missing/multi targets never borrow another
//     camera's axis or period (A1);
//   - runtime definitions stay in sync with scripts/iss-rig-manifest.mjs.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  GIMBAL_SINGULARITY_EPSILON,
  IGOAL_JOINT_DEFS,
  IGOAL_OSCILLATOR_SPECS,
  IGOAL_TRRJ_LIMITS,
  RIG_SCHEMA_VERSION,
  advanceToward,
  applyJointAngle,
  applyOscillators,
  parseRigMetadata,
  resolveJoint,
  resolveOscillators,
  sarjTargetAngle,
  trrjAdvance,
  trrjTargetAngle,
  wrapPi,
  type ResolvedJoint,
} from '@/rendering/iss/ISSJointKinematics'
import { JOINTS, OSCILLATORS, TRRJ_LIMITS } from '../../../scripts/iss-rig-manifest.mjs'

const DEG2RAD = Math.PI / 180
const LIMIT_RAD = IGOAL_TRRJ_LIMITS.softwareLimitDeg * DEG2RAD
const SLEW_RAD_PER_SIM_S = IGOAL_TRRJ_LIMITS.slewDegPerSimSecond * DEG2RAD

const TRRJ_DEF = IGOAL_JOINT_DEFS.find((j) => j.nodeName === 'PORT_TRRJ_GAMMA_ROT')!
const SARJ_DEF = IGOAL_JOINT_DEFS.find((j) => j.nodeName === 'PORT_ALPHA_ROT')!

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps
}

function approxQuat(a: THREE.Quaternion, b: THREE.Quaternion, eps = 1e-9): boolean {
  return Math.abs(a.dot(b)) >= 1 - eps
}

function approxVec(a: THREE.Vector3, b: THREE.Vector3, eps = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps
}

/**
 * A miniature IGOAL-style mount: mixed ancestor scales (×100 ssref, 0.0254
 * truss) and compensating authored base rotation, with the joint node's
 * origin ON its shaft and real geometry extending along the shaft — the
 * asset's actual pattern, small enough to assert on numerically.
 */
function buildRigFixture() {
  const root = new THREE.Group()
  root.name = 'PivotRoot'

  const ssref = new THREE.Group()
  ssref.name = 'SSREF_IGOAL'
  ssref.rotation.x = -Math.PI / 2
  ssref.scale.setScalar(100)
  root.add(ssref)

  const truss = new THREE.Group()
  truss.name = 'Truss_P1'
  truss.rotation.y = Math.PI
  truss.scale.setScalar(0.0254)
  ssref.add(truss)

  const jointNode = new THREE.Group()
  jointNode.name = TRRJ_DEF.nodeName
  truss.add(jointNode)

  // Net parent scale: 100 × 0.0254 = 2.54 (jointNode-local → model).
  root.updateWorldMatrix(true, true)

  // Authored compensating base: jointNode's model-frame rotation is identity
  // (its local axes ARE model axes), like the asset's authored bases.
  const qTrussRelative = truss.getWorldQuaternion(new THREE.Quaternion())
  jointNode.quaternion.copy(qTrussRelative.invert())

  // Place the joint origin at a point on its shaft (model space): the TRRJ
  // shaft is the radiator beam's own long axis, model X at y=0, z=−14.68.
  const originModel = new THREE.Vector3(-6.775, 0, -14.68)
  jointNode.position.copy(
    originModel
      .clone()
      .applyMatrix4(root.matrixWorld.clone().invert())
      .applyMatrix4(truss.matrixWorld.clone().invert()),
  )

  // Real geometry along the shaft (joint-local X ≡ model X): axis base/tip
  // plus cross-section corners off-axis.
  const beam = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0, 0, 0, // on-axis: bearing seat
          -9, 0, 0, // on-axis: deployed tip (≈ −22.9 model units)
          -9, 0.2, 1.0, // off-axis corners (panel edges)
          -9, -0.2, 1.0,
          -9, 0, -1.0,
        ],
        3,
      ),
    ),
    new THREE.MeshBasicMaterial(),
  )
  beam.name = 'P1_Radiator'
  jointNode.add(beam)
  root.updateWorldMatrix(true, true)

  const modelFromWorld = root.matrixWorld.clone().invert()
  const toModel = (local: THREE.Vector3) =>
    beam.localToWorld(local.clone()).applyMatrix4(modelFromWorld)

  return { root, jointNode, beam, toModel }
}

/** Wrap the model root in an arbitrary outer (attitude/scale/translate) frame. */
function attachOuter(root: THREE.Group, kind: string): THREE.Group {
  const outer = new THREE.Group()
  if (kind === 'identity') {
    // no transform
  } else if (kind === 'translation') {
    outer.position.set(500, -250, 125)
  } else if (kind === 'uniform-scale') {
    outer.scale.setScalar(3)
  } else if (kind === 'rx45') {
    outer.rotation.x = Math.PI / 4
  } else if (kind === 'rz60') {
    outer.rotation.z = (60 * Math.PI) / 180
  } else {
    outer.position.set(-90, 40, 7)
    outer.scale.setScalar(2)
    outer.quaternion.setFromEuler(new THREE.Euler(Math.PI / 4, 0.3, (60 * Math.PI) / 180, 'XYZ'))
  }
  outer.add(root)
  outer.updateWorldMatrix(true, true)
  return outer
}

const OUTER_KINDS = ['identity', 'translation', 'uniform-scale', 'rx45', 'rz60', 'compound']

// ─── Resolution invariance (M2) ───────────────────────────────────────────────

describe('resolveJoint: outer-frame invariance', () => {
  it('resolves identical parent-frame axes/references under identity, translation, scale, Rx45, Rz60, and compound outers', () => {
    let reference: { axis: THREE.Vector3; normalRef: THREE.Vector3 } | null = null
    for (const kind of OUTER_KINDS) {
      const { root } = buildRigFixture()
      attachOuter(root, kind)
      const result = resolveJoint(root, TRRJ_DEF)
      expect(result.ok, `${kind}: ${result.ok ? '' : result.reason}`).toBe(true)
      if (!result.ok) continue
      const { axis, normalRef } = result.joint
      expect(axis.length()).toBeCloseTo(1, 10)
      expect(normalRef.length()).toBeCloseTo(1, 10)
      expect(Math.abs(axis.dot(normalRef))).toBeLessThan(1e-12)
      if (reference === null) {
        reference = { axis: axis.clone(), normalRef: normalRef.clone() }
      } else {
        expect(approxVec(axis, reference.axis, 1e-10), kind).toBe(true)
        expect(approxVec(normalRef, reference.normalRef, 1e-10), kind).toBe(true)
      }
    }
  })

  it('composes the rig frames such that parentWorld · modelToParent = rootWorld', () => {
    for (const kind of OUTER_KINDS) {
      const { root } = buildRigFixture()
      attachOuter(root, kind)
      const result = resolveJoint(root, TRRJ_DEF)
      if (!result.ok) throw new Error(`${kind}: ${result.reason}`)
      const { joint } = result
      const rootWorld = root.getWorldQuaternion(new THREE.Quaternion())
      const parentWorld = joint.node.parent!.getWorldQuaternion(new THREE.Quaternion())
      const composed = parentWorld.clone().multiply(joint.modelToParent)
      expect(approxQuat(composed, rootWorld, 1e-10), kind).toBe(true)
    }
  })

  it('rejects a mirrored (negative-determinant) ancestor instead of dropping the mirror silently', () => {
    const { root } = buildRigFixture()
    const outer = new THREE.Group()
    outer.scale.set(1, 1, -1)
    outer.add(root)
    outer.updateWorldMatrix(true, true)
    const result = resolveJoint(root, TRRJ_DEF)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/mirrored ancestor/)
  })

  it('reports missing joints instead of skipping them silently', () => {
    const root = new THREE.Group()
    const result = resolveJoint(root, TRRJ_DEF)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.nodeName).toBe(TRRJ_DEF.nodeName)
      expect(result.reason).toMatch(/not found/)
    }
  })
})

// ─── Rotation application (M1 composition + stationary shaft) ────────────────

describe('applyJointAngle: composition and stationary shaft', () => {
  it('composes parent-frame deltas premultiplied onto the authored base', () => {
    const { root, jointNode } = buildRigFixture()
    attachOuter(root, 'compound')
    const result = resolveJoint(root, TRRJ_DEF)
    if (!result.ok) throw new Error(result.reason)
    const { joint } = result

    const before = jointNode.getWorldQuaternion(new THREE.Quaternion())
    const angle = 30 * DEG2RAD
    const dq = new THREE.Quaternion()
    applyJointAngle(joint, angle, dq)
    root.updateWorldMatrix(true, true)
    const after = jointNode.getWorldQuaternion(new THREE.Quaternion())

    // world_after = (parentWorld · dq · parentWorld⁻¹) · world_before —
    // the parent-frame delta conjugated into world space, premultiplied.
    const parentWorld = joint.node.parent!.getWorldQuaternion(new THREE.Quaternion())
    const dqWorld = parentWorld
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(joint.axis, angle))
      .multiply(parentWorld.clone().invert())
    const expected = dqWorld.multiply(before)
    expect(approxQuat(after, expected, 1e-10)).toBe(true)
  })

  it('keeps every on-axis landmark exactly fixed through the whole ±105° travel', () => {
    const { root, toModel } = buildRigFixture()
    const result = resolveJoint(root, TRRJ_DEF)
    if (!result.ok) throw new Error(result.reason)
    const { joint } = result

    const axisBaseModel = toModel(new THREE.Vector3(0, 0, 0))
    const axisTipModel = toModel(new THREE.Vector3(-9, 0, 0))
    const dq = new THREE.Quaternion()
    for (const deg of [15, 45, 90, 105, -105, -90]) {
      applyJointAngle(joint, deg * DEG2RAD, dq)
      root.updateWorldMatrix(true, true)
      expect(approxVec(toModel(new THREE.Vector3(0, 0, 0)), axisBaseModel, 1e-8), `${deg}° base`).toBe(true)
      expect(approxVec(toModel(new THREE.Vector3(-9, 0, 0)), axisTipModel, 1e-8), `${deg}° tip`).toBe(true)
    }
  })

  it('rolls rigidly about the shaft: off-axis landmarks keep their distance to the axis line', () => {
    const { root, toModel } = buildRigFixture()
    const result = resolveJoint(root, TRRJ_DEF)
    if (!result.ok) throw new Error(result.reason)
    const { joint } = result

    // Distance from a world point to the shaft line (origin + t·axisWorld).
    const originWorld = joint.node.getWorldPosition(new THREE.Vector3())
    const axisWorld = joint.axis
      .clone()
      .applyQuaternion(joint.node.parent!.getWorldQuaternion(new THREE.Quaternion()))
      .normalize()
    const distanceToShaft = (point: THREE.Vector3) => {
      const rel = point.clone().sub(originWorld)
      const along = rel.dot(axisWorld)
      return rel.addScaledVector(axisWorld, -along).length()
    }

    const cornerLocal = new THREE.Vector3(-9, 0.2, 1.0)
    const dq = new THREE.Quaternion()
    let reference: number | null = null
    for (const deg of [0, 30, 90, 105, -105]) {
      applyJointAngle(joint, deg * DEG2RAD, dq)
      root.updateWorldMatrix(true, true)
      const cornerWorld = beamWorld(root, cornerLocal)
      const d = distanceToShaft(cornerWorld)
      if (reference === null) reference = d
      else expect(Math.abs(d - reference)).toBeLessThan(1e-8)
    }
  })

  it('the shaft direction stays model-space X (coaxial) at every allowed angle', () => {
    const { root, toModel } = buildRigFixture()
    const result = resolveJoint(root, TRRJ_DEF)
    if (!result.ok) throw new Error(result.reason)
    const { joint } = result

    const dq = new THREE.Quaternion()
    for (const deg of [45, 105, -105]) {
      applyJointAngle(joint, deg * DEG2RAD, dq)
      root.updateWorldMatrix(true, true)
      const base = toModel(new THREE.Vector3(0, 0, 0))
      const tip = toModel(new THREE.Vector3(-9, 0, 0))
      const direction = tip.clone().sub(base).normalize()
      // model-space shaft = ±X
      expect(Math.abs(direction.x)).toBeCloseTo(1, 8)
      expect(Math.abs(direction.y)).toBeLessThan(1e-8)
      expect(Math.abs(direction.z)).toBeLessThan(1e-8)
    }
  })

  it('repeated application from the authored pose is idempotent (no accumulation)', () => {
    const { root, jointNode } = buildRigFixture()
    const first = resolveJoint(root, TRRJ_DEF)
    if (!first.ok) throw new Error(first.reason)
    const dq = new THREE.Quaternion()
    applyJointAngle(first.joint, 0.7, dq)
    root.updateWorldMatrix(true, true)
    const once = jointNode.quaternion.clone()

    // Re-applying the same angle (fresh resolve on an authored clone is the
    // only supported re-resolve; same-angle reapply must be a no-op).
    applyJointAngle(first.joint, 0.7, dq)
    expect(jointNode.quaternion.equals(once)).toBe(true)
    expect(jointNode.position).toEqual(first.joint.basePosition)
  })
})

// ─── Target laws (M3) ─────────────────────────────────────────────────────────

/** Simple parent≡model joint for law tests. */
function makeLawJoint(nodeName: string): ResolvedJoint {
  const root = new THREE.Group()
  const parent = new THREE.Group()
  const node = new THREE.Group()
  const def = IGOAL_JOINT_DEFS.find((j) => j.nodeName === nodeName)!
  if (!def) throw new Error(`no joint def for ${nodeName}`)
  node.name = nodeName
  parent.add(node)
  root.add(parent)
  const result = resolveJoint(root, def)
  if (!result.ok) throw new Error(result.reason)
  return result.joint
}

describe('sarjTargetAngle', () => {
  it('points the reference normal at the sun projection (full-revolution tracking)', () => {
    const joint = makeLawJoint(SARJ_DEF.nodeName)
    // Axis = model Z; pick a sun in the gimbal plane.
    const sun = new THREE.Vector3(0.3, -0.8, 0.2).normalize()
    const target = sarjTargetAngle(joint, sun)
    expect(target).not.toBeNull()
    const rotated = joint.normalRef.clone().applyAxisAngle(joint.axis, target!)
    const projected = sun.clone().addScaledVector(joint.axis, -sun.dot(joint.axis)).normalize()
    expect(rotated.dot(projected)).toBeCloseTo(1, 10)
  })

  it('returns null at gimbal singularity (sun parallel to shaft)', () => {
    const joint = makeLawJoint(SARJ_DEF.nodeName)
    expect(sarjTargetAngle(joint, new THREE.Vector3(0, 0, 1))).toBeNull()
    expect(sarjTargetAngle(joint, new THREE.Vector3(0, 1e-3, 1).normalize())).toBeNull()
  })
})

describe('trrjTargetAngle: limits, branches, singularity', () => {
  it('stays inside ±105° for a full sweep of daylight sun and eclipse nadir directions', () => {
    const joint = makeLawJoint(TRRJ_DEF.nodeName)
    for (let i = 0; i < 64; i += 1) {
      // Deterministic pseudo-random directions from golden-angle spacing.
      const a = i * 2.399963
      const daylight = new THREE.Vector3(Math.cos(a), Math.sin(a), Math.cos(a * 0.37)).normalize()
      const targetDay = trrjTargetAngle(joint, 0, daylight, new THREE.Vector3(0, -1, 0), true, LIMIT_RAD)
      expect(targetDay).not.toBeNull()
      expect(Math.abs(targetDay!)).toBeLessThanOrEqual(LIMIT_RAD + 1e-12)

      const nadir = new THREE.Vector3(Math.sin(a), Math.cos(a), Math.sin(a * 0.53)).normalize()
      const targetNight = trrjTargetAngle(joint, 0, daylight, nadir, false, LIMIT_RAD)
      expect(targetNight).not.toBeNull()
      expect(Math.abs(targetNight!)).toBeLessThanOrEqual(LIMIT_RAD + 1e-12)
    }
  })

  it('realizes the daylight intent: panel normal ⊥ projected sun (edge-to-Sun)', () => {
    const joint = makeLawJoint(TRRJ_DEF.nodeName)
    const sun = new THREE.Vector3(0, 0.6, 0.8).normalize()
    const target = trrjTargetAngle(joint, 0, sun, new THREE.Vector3(), true, LIMIT_RAD)
    expect(target).not.toBeNull()
    const normal = joint.normalRef.clone().applyAxisAngle(joint.axis, target!)
    const projected = sun.clone().addScaledVector(joint.axis, -sun.dot(joint.axis)).normalize()
    expect(normal.dot(projected)).toBeCloseTo(0, 10)
  })

  it('realizes the eclipse intent: panel normal as close as possible to projected nadir', () => {
    const joint = makeLawJoint(TRRJ_DEF.nodeName)
    const nadir = new THREE.Vector3(0, -0.6, -0.8).normalize()
    const target = trrjTargetAngle(joint, 0, new THREE.Vector3(), nadir, false, LIMIT_RAD)
    expect(target).not.toBeNull()
    const normal = joint.normalRef.clone().applyAxisAngle(joint.axis, target!)
    const projected = nadir.clone().addScaledVector(joint.axis, -nadir.dot(joint.axis)).normalize()
    // Two-sided equivalence: parallel (either sign).
    expect(Math.abs(normal.dot(projected))).toBeCloseTo(1, 10)
  })

  it('keeps the continuous branch: no wrap through the hard stop as the sun sweeps', () => {
    const joint = makeLawJoint(TRRJ_DEF.nodeName)
    // Sun rotating slowly (0.5°/step) in the gimbal plane about the model X
    // axis. `applied` starts by adopting the first computed target, exactly
    // like the component's initialization; stepping uses trrjAdvance with an
    // effectively unlimited step to isolate branch logic from slew lag.
    const unlimited = Math.PI
    let applied = 0
    let previous = Number.NaN
    let maxPoseStep = 0
    for (let step = 0; step <= 720; step += 1) {
      const theta = (100 - step * 0.5) * DEG2RAD
      const sun = new THREE.Vector3(0, Math.cos(theta), Math.sin(theta)).normalize()
      const target = trrjTargetAngle(joint, applied, sun, new THREE.Vector3(0, -1, 0), true, LIMIT_RAD)
      expect(target).not.toBeNull()
      applied = trrjAdvance(applied, target!, unlimited, LIMIT_RAD)
      // The applied label never exceeds the travel bound...
      expect(Math.abs(applied)).toBeLessThanOrEqual(LIMIT_RAD + 1e-12)
      // ...and the PHYSICAL pose (two-sided: ±normal equivalent) moves at
      // most ~one sun step per step — stop relabels are pose-continuous.
      if (!Number.isNaN(previous)) {
        const labelStep = Math.abs(wrapPi(applied - previous))
        const poseStep = Math.min(labelStep, Math.abs(wrapPi(applied - previous + Math.PI)))
        maxPoseStep = Math.max(maxPoseStep, poseStep)
      }
      previous = applied
    }
    expect(maxPoseStep).toBeLessThanOrEqual(2.5 * DEG2RAD)
  })

  it('trrjAdvance: relabels the antipodal branch only at a stop, never mid-range or while paused', () => {
    const appliedAtStop = 104 * DEG2RAD
    const antipodalTarget = wrapPi(-80 * DEG2RAD)
    // At the stop: relabel instantly (the bounded flip).
    expect(trrjAdvance(appliedAtStop, antipodalTarget, 10, LIMIT_RAD)).toBeCloseTo(antipodalTarget, 12)
    // Mid-range: the same far (>90°) target is real travel — bounded slew.
    const farTarget = wrapPi(100 * DEG2RAD)
    expect(trrjAdvance(0, farTarget, 0.1, LIMIT_RAD)).toBeCloseTo(0.1, 12)
    // Paused (maxStep = 0): nothing moves, even at the stop.
    expect(trrjAdvance(appliedAtStop, antipodalTarget, 0, LIMIT_RAD)).toBe(appliedAtStop)
    // Near-target tracking at the stop stays slewed (partial step), not
    // teleported: 0.005 rad of budget against 1° of travel.
    expect(trrjAdvance(appliedAtStop, 103 * DEG2RAD, 0.005, LIMIT_RAD))
      .toBeCloseTo(wrapPi(appliedAtStop - 0.005), 12)
  })

  it('holds at gimbal singularity', () => {
    const joint = makeLawJoint(TRRJ_DEF.nodeName)
    const axisDir = new THREE.Vector3(1, 0, 0)
    expect(trrjTargetAngle(joint, 0, axisDir, new THREE.Vector3(0, -1, 0), true, LIMIT_RAD)).toBeNull()
    expect(trrjTargetAngle(joint, 0, new THREE.Vector3(0, 1, 0), axisDir, false, LIMIT_RAD)).toBeNull()
  })
})

describe('advanceToward: simulation-time slew', () => {
  it('moves exactly maxStep toward the target and converges', () => {
    expect(advanceToward(0, 1, 0.25)).toBeCloseTo(0.25, 12)
    expect(advanceToward(0.9, 1, 0.25)).toBeCloseTo(1, 12)
    expect(advanceToward(0, -1, 0.25)).toBeCloseTo(-0.25, 12)
  })

  it('zero maxStep (paused clock / repeated tick) never moves the joint', () => {
    let angle = 0.4
    for (let i = 0; i < 100; i += 1) angle = advanceToward(angle, 1.5, 0)
    expect(angle).toBeCloseTo(0.4, 12)
  })

  it('bounded steps cannot overshoot across the wrapped branch', () => {
    // Target is one radian "behind" the wrap boundary: slew steps approach it
    // without a ±2π unwind.
    const current = 3.0
    const target = wrapPi(-3.0) // ≈ +3.2832 — nearest branch is forward
    let angle = current
    let steps = 0
    while (Math.abs(wrapPi(target - angle)) > 1e-9 && steps < 1000) {
      angle = advanceToward(angle, target, 0.1)
      steps += 1
      expect(Math.abs(wrapPi(angle - current))).toBeLessThanOrEqual(steps * 0.1 + 1e-9)
    }
    expect(angle).toBeCloseTo(target, 9)
    expect(steps).toBeLessThan(10)
  })

  it('slew rate is per simulation second: 0.75°/sim-s applied over dt', () => {
    const dtSimSeconds = 2
    const after = advanceToward(0, 90 * DEG2RAD, SLEW_RAD_PER_SIM_S * dtSimSeconds)
    expect(after).toBeCloseTo(2 * SLEW_RAD_PER_SIM_S, 12)
  })
})

// ─── Oscillator ownership (A1) ────────────────────────────────────────────────

describe('oscillator ownership', () => {
  function makeCameras(): { root: THREE.Group; cams: Record<string, THREE.Object3D> } {
    const root = new THREE.Group()
    const cams: Record<string, THREE.Object3D> = {}
    for (const name of ['cam1', 'cam2', 'cam3']) {
      const cam = new THREE.Object3D()
      cam.name = name
      cam.rotation.set(0.1, 0.2, 0.3)
      root.add(cam)
      cams[name] = cam
    }
    return { root, cams }
  }

  const specB = { target: 'cam2', axis: 'x' as const, amplitudeDeg: 5, periodSec: 10, phaseDeg: 90 }
  const specRegex = { target: /cam[13]/, axis: 'y' as const, amplitudeDeg: 10, periodSec: 20 }

  it('a missing earlier target contributes nothing and later targets keep their own spec', () => {
    const { root, cams } = makeCameras()
    const specs = [{ target: 'missing_cam', axis: 'y' as const, amplitudeDeg: 99, periodSec: 1 }, specB, specRegex]
    const entries = resolveOscillators(root, specs)
    expect(entries).toHaveLength(3)
    applyOscillators(entries, 1.25)

    // cam2 driven by specB's axis/period — not shifted by the missing entry.
    const expectedB = 0.1 + 5 * DEG2RAD * Math.sin((2 * Math.PI * 1.25) / 10 + (Math.PI / 2))
    expect(cams.cam2.rotation.x).toBeCloseTo(expectedB, 12)
    expect(cams.cam2.rotation.y).toBeCloseTo(0.2, 12)

    // cam1/cam3 driven by the regex spec.
    const expectedR = 0.2 + 10 * DEG2RAD * Math.sin((2 * Math.PI * 1.25) / 20)
    expect(cams.cam1.rotation.y).toBeCloseTo(expectedR, 12)
    expect(cams.cam3.rotation.y).toBeCloseTo(expectedR, 12)
    expect(cams.cam1.rotation.x).toBeCloseTo(0.1, 12)
  })

  it('a spec matching several parts gives every match the same (its own) spec', () => {
    const { root, cams } = makeCameras()
    const entries = resolveOscillators(root, [specRegex])
    expect(entries).toHaveLength(2)
    applyOscillators(entries, 3)
    const expected = 0.2 + 10 * DEG2RAD * Math.sin((2 * Math.PI * 3) / 20)
    expect(cams.cam1.rotation.y).toBeCloseTo(expected, 12)
    expect(cams.cam3.rotation.y).toBeCloseTo(expected, 12)
  })

  it('removing an earlier target does not re-map the remaining entries', () => {
    const expectedB = 0.1 + 5 * DEG2RAD * Math.sin((2 * Math.PI * 0.5) / 10 + (Math.PI / 2))

    const { root: rootA, cams: camsA } = makeCameras()
    const withMissing = resolveOscillators(rootA, [
      { target: 'missing_cam', axis: 'z' as const, amplitudeDeg: 50, periodSec: 2 },
      specB,
    ])
    expect(withMissing).toHaveLength(1)
    applyOscillators(withMissing, 0.5)
    expect(camsA.cam2.rotation.x).toBeCloseTo(expectedB, 12)

    const { root: rootB, cams: camsB } = makeCameras()
    const withoutMissing = resolveOscillators(rootB, [specB])
    applyOscillators(withoutMissing, 0.5)
    expect(camsB.cam2.rotation.x).toBeCloseTo(expectedB, 12)
  })
})

// ─── Rig metadata validation (B.6) ────────────────────────────────────────────

describe('parseRigMetadata', () => {
  const validPayload = {
    schemaVersion: RIG_SCHEMA_VERSION,
    joints: [
      { id: 'TRRJ_PORT', nodeName: 'PORT_TRRJ_GAMMA_ROT', role: 'trrj', axisModel: [1, 0, 0], normalModel: [0, 1, 0] },
    ],
    oscillators: [{ target: 'Cam_Pan', axis: 'y', amplitudeDeg: 8, periodSec: 62, phaseDeg: 0 }],
    trrjLimits: { softwareLimitDeg: 105, hardwareLimitDeg: 115, slewDegPerSimSecond: 0.75 },
  }

  it('reports absent for empty or missing userData/orbitalRig', () => {
    expect(parseRigMetadata(null).status).toBe('absent')
    expect(parseRigMetadata(undefined).status).toBe('absent')
    expect(parseRigMetadata({}).status).toBe('absent')
    expect(parseRigMetadata({ other: 1 }).status).toBe('absent')
  })

  it('accepts a well-formed payload', () => {
    const result = parseRigMetadata({ orbitalRig: validPayload })
    expect(result.status).toBe('valid')
    if (result.status === 'valid') {
      expect(result.metadata.joints).toHaveLength(1)
      expect(result.metadata.oscillators).toHaveLength(1)
      expect(result.metadata.limits.softwareLimitDeg).toBe(105)
    }
  })

  it('rejects present-but-invalid payloads with named errors', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['schema', { ...validPayload, schemaVersion: 99 }],
      ['non-orthogonal', {
        ...validPayload,
        joints: [{ ...validPayload.joints[0], normalModel: [1, 1, 0] }],
      }],
      ['non-unit axis', {
        ...validPayload,
        joints: [{ ...validPayload.joints[0], axisModel: [2, 0, 0] }],
      }],
      ['bad oscillator axis', {
        ...validPayload,
        oscillators: [{ target: 'Cam', axis: 'w', amplitudeDeg: 8, periodSec: 62 }],
      }],
      ['bad limits', { ...validPayload, trrjLimits: null }],
      ['joints not array', { ...validPayload, joints: 'nope' }],
    ]
    for (const [name, payload] of cases) {
      const result = parseRigMetadata({ orbitalRig: payload })
      expect(result.status, name).toBe('invalid')
      if (result.status === 'invalid') expect(result.errors.length, name).toBeGreaterThan(0)
    }
  })
})

// ─── Sync with the build-time rig authority ───────────────────────────────────

describe('manifest sync', () => {
  it('runtime joint/oscillator/limit definitions mirror scripts/iss-rig-manifest.mjs', () => {
    expect(IGOAL_JOINT_DEFS).toEqual(JOINTS)
    expect(IGOAL_OSCILLATOR_SPECS).toEqual(OSCILLATORS)
    expect(IGOAL_TRRJ_LIMITS).toEqual(TRRJ_LIMITS)
  })

  it('keeps the module-level singularity constant positive and small', () => {
    expect(GIMBAL_SINGULARITY_EPSILON).toBeGreaterThan(0)
    expect(GIMBAL_SINGULARITY_EPSILON).toBeLessThan(0.1)
  })
})

/** World position of a point expressed in the fixture beam's local space. */
function beamWorld(root: THREE.Object3D, local: THREE.Vector3): THREE.Vector3 {
  const beam = root.getObjectByName('P1_Radiator')!
  return beam.localToWorld(local.clone())
}
