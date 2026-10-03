// ─── ISSJointKinematics — deterministic mechanism math for the IGOAL rig ─────
//
// Pure, React-free, frame-loop-free joint math (plan 001 Phase B). The
// component (ISSAnimations.tsx) owns effect/frame orchestration and scratch
// objects; everything testable lives here.
//
// Mechanism facts (plan 001 M1, measured on the authored asset):
//   - SARJ shaft (PORT/STBD_ALPHA_ROT) = native model Z — the main truss
//     axis; node origins sit on the beamline at z = ∓17.78.
//   - TRRJ shaft (PORT/STBD_TRRJ_GAMMA_ROT) = native model X — the radiator
//     beam's OWN long axis (perpendicular to the truss, per the NASA ATCS
//     bearing drawings); the authored origins at x ≈ −6.775 lie ON that
//     shaft, and any point on a rotation axis is an equivalent pivot, so
//     there is NO hinge/end-edge compensation (the previous box-derived
//     hinge was a misreading of an axis line as an edge hinge).
//   - Panel reference normals = native ±Y at authored pose.
//
// All joint rotations are composed from the immutable authored pose
// (dq ∘ baseQuaternion, premultiplied — parent-frame deltas premultiply),
// never by mutating an accumulated state, so repeated application is
// idempotent and resolution is repeatable.

import * as THREE from 'three'

// ─── Rig contract types (mirror of scripts/iss-rig-manifest.mjs) ─────────────

export const RIG_SCHEMA_VERSION = 1

export type JointRole = 'sarj' | 'trrj' | 'bga'
export type Axis = 'x' | 'y' | 'z'

export interface JointDefinition {
  id: string
  nodeName: string
  role: JointRole
  /** Unit shaft direction in the GLB's native model frame. */
  axisModel: [number, number, number]
  /** Unit panel-normal reference at authored pose (⊥ axisModel). */
  normalModel: [number, number, number]
}

export interface OscillatorSpec {
  target: string | RegExp
  axis: Axis
  amplitudeDeg: number
  periodSec: number
  phaseDeg?: number
}

export interface TrrjLimits {
  softwareLimitDeg: number
  hardwareLimitDeg: number
  slewDegPerSimSecond: number
}

const SARJ_DEFS: JointDefinition[] = [
  { id: 'SARJ_PORT', nodeName: 'PORT_ALPHA_ROT', role: 'sarj', axisModel: [0, 0, 1], normalModel: [0, 1, 0] },
  { id: 'SARJ_STBD', nodeName: 'STBD_ALPHA_ROT', role: 'sarj', axisModel: [0, 0, 1], normalModel: [0, 1, 0] },
]

const TRRJ_DEFS: JointDefinition[] = [
  { id: 'TRRJ_PORT', nodeName: 'PORT_TRRJ_GAMMA_ROT', role: 'trrj', axisModel: [1, 0, 0], normalModel: [0, 1, 0] },
  { id: 'TRRJ_STBD', nodeName: 'STBD_TRRJ_GAMMA_ROT', role: 'trrj', axisModel: [1, 0, 0], normalModel: [0, 1, 0] },
]

// Beta Gimbal Assemblies (measured 2026-10-04 on the rebuilt asset): each
// BGA origin lies on its wing's mast centreline; masts run native ±X
// (perpendicular to the truss), blankets face native ±Y at authored pose.
// The reference normal is +Y for every wing: the same face the SARJ law
// turns toward the sun, so the BGA only adds the out-of-plane (beta) tilt.
const BGA_DEFS: JointDefinition[] = [
  { id: 'BGA_2A', nodeName: 'PORT_BETA_ROT_2A', role: 'bga', axisModel: [-1, 0, 0], normalModel: [0, 1, 0] },
  { id: 'BGA_4A', nodeName: 'PORT_BETA_ROT_4A', role: 'bga', axisModel: [1, 0, 0], normalModel: [0, 1, 0] },
  { id: 'BGA_2B', nodeName: 'PORT_BETA_ROT_2B', role: 'bga', axisModel: [1, 0, 0], normalModel: [0, 1, 0] },
  { id: 'BGA_4B', nodeName: 'PORT_BETA_ROT_4B', role: 'bga', axisModel: [-1, 0, 0], normalModel: [0, 1, 0] },
  { id: 'BGA_1A', nodeName: 'STBD_BETA_ROT_1A', role: 'bga', axisModel: [1, 0, 0], normalModel: [0, 1, 0] },
  { id: 'BGA_3A', nodeName: 'STBD_BETA_ROT_3A', role: 'bga', axisModel: [-1, 0, 0], normalModel: [0, 1, 0] },
  { id: 'BGA_1B', nodeName: 'STBD_BETA_ROT_1B', role: 'bga', axisModel: [-1, 0, 0], normalModel: [0, 1, 0] },
  { id: 'BGA_3B', nodeName: 'STBD_BETA_ROT_3B', role: 'bga', axisModel: [1, 0, 0], normalModel: [0, 1, 0] },
]

/** IGOAL driven joints — mirror of JOINTS in scripts/iss-rig-manifest.mjs.
 *  Order matters: SARJs first, because each BGA's live parent frame is read
 *  after its SARJ has been applied this frame. */
export const IGOAL_JOINT_DEFS: JointDefinition[] = [...SARJ_DEFS, ...TRRJ_DEFS, ...BGA_DEFS]

/** Illustrative BGA slew rate (simulation seconds). Fast enough to follow a
 *  seek within a few seconds, slow enough that nothing snaps on screen. */
export const BGA_SLEW_DEG_PER_SIM_SECOND = 2

/** IGOAL camera idle oscillators — mirror of OSCILLATORS in the manifest. */
export const IGOAL_OSCILLATOR_SPECS: OscillatorSpec[] = [
  { target: 'JEM_PM_Details_Camera_Fwd_Pan', axis: 'y', amplitudeDeg: 8, periodSec: 62, phaseDeg: 0 },
  { target: 'JEM_PM_Details_Camera_Fwd_Tilt', axis: 'x', amplitudeDeg: 6, periodSec: 47, phaseDeg: 90 },
  { target: 'JEM_PM_Details_Camera_Aft_Pan', axis: 'y', amplitudeDeg: 8, periodSec: 71, phaseDeg: 140 },
  { target: 'JEM_PM_Details_Camera_Aft_Tilt', axis: 'x', amplitudeDeg: 6, periodSec: 53, phaseDeg: 230 },
  { target: 'ELP_PRIME_Details_Camera_Pan', axis: 'y', amplitudeDeg: 7, periodSec: 59, phaseDeg: 40 },
  { target: 'ELP_PRIME_Details_Camera_Tilt', axis: 'x', amplitudeDeg: 5, periodSec: 44, phaseDeg: 300 },
  { target: 'SHP_PRIME_Details_Camera_Pan', axis: 'y', amplitudeDeg: 7, periodSec: 67, phaseDeg: 190 },
  { target: 'SHP_PRIME_Details_Camera_Tilt', axis: 'x', amplitudeDeg: 5, periodSec: 49, phaseDeg: 20 },
]

/** NASA ATCS TRRJ travel/rate limits (software range is the command bound). */
export const IGOAL_TRRJ_LIMITS: TrrjLimits = {
  softwareLimitDeg: 105,
  hardwareLimitDeg: 115,
  slewDegPerSimSecond: 0.75,
}

// ─── Joint resolution (rig frames, not AABB guesses — M2) ────────────────────

export interface ResolvedJoint {
  def: JointDefinition
  node: THREE.Object3D
  /** Authored orientation the extra rotation composes onto (immutable). */
  baseQuaternion: THREE.Quaternion
  /** Authored local translation (never modified — the origin is on the shaft). */
  basePosition: THREE.Vector3
  /** Maps model-root directions into the joint's parent frame. */
  modelToParent: THREE.Quaternion
  /** Rotation shaft in the joint's PARENT frame (unit). */
  axis: THREE.Vector3
  /** Panel-normal reference at authored pose (unit, ⊥ axis). */
  normalRef: THREE.Vector3
}

export type ResolveResult =
  | { ok: true; joint: ResolvedJoint }
  | { ok: false; nodeName: string; reason: string }

function determinant3(m: THREE.Matrix4): number {
  const e = m.elements
  return (
    e[0] * (e[5] * e[10] - e[6] * e[9]) -
    e[4] * (e[1] * e[10] - e[2] * e[9]) +
    e[8] * (e[1] * e[6] - e[2] * e[5])
  )
}

/**
 * Resolve one authored rotary joint into its parent frame.
 *
 * Axes/normals come from the rig definitions above (build-time measured
 * data), mapped through parent-relative quaternions — the live LVLH
 * attitude and the normalization pre-rotation sit ABOVE the model root and
 * cancel in the root-relative mapping, so the resolution is invariant under
 * arbitrary outer translation/rotation/uniform scale (M2). No bounding-box
 * inference anywhere; a mirrored (negative-determinant) ancestor above the
 * joint is rejected instead of silently dropped by the quaternion mapping.
 *
 * Must run on a freshly mounted (authored-pose) scene — the mount pipeline
 * clones the GLTF scene per asset, which this relies on.
 */
export function resolveJoint(root: THREE.Object3D, def: JointDefinition): ResolveResult {
  const node = root.getObjectByName(def.nodeName)
  if (!node) {
    return { ok: false, nodeName: def.nodeName, reason: 'joint node not found under model root' }
  }
  const parent = node.parent
  if (!parent) {
    return { ok: false, nodeName: def.nodeName, reason: 'joint node has no parent' }
  }
  parent.updateWorldMatrix(true, false)

  for (let ancestor: THREE.Object3D | null = parent; ancestor; ancestor = ancestor.parent) {
    if (determinant3(ancestor.matrixWorld) <= 0) {
      return {
        ok: false,
        nodeName: def.nodeName,
        reason: `mirrored ancestor "${ancestor.name || '(unnamed)'}" — quaternion mapping would drop the mirror`,
      }
    }
  }

  // Parent frame RELATIVE to the model root: (rootWorld⁻¹ · parentWorld)⁻¹.
  const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion())
  const rootWorld = root.getWorldQuaternion(new THREE.Quaternion())
  const modelToParent = parentWorld.premultiply(rootWorld.invert()).invert()

  const axis = new THREE.Vector3(...def.axisModel).applyQuaternion(modelToParent)
  if (!Number.isFinite(axis.lengthSq()) || axis.lengthSq() < 1e-12) {
    return { ok: false, nodeName: def.nodeName, reason: 'shaft axis collapsed under frame mapping' }
  }
  axis.normalize()

  const normalRef = new THREE.Vector3(...def.normalModel).applyQuaternion(modelToParent)
  if (!Number.isFinite(normalRef.lengthSq()) || normalRef.lengthSq() < 1e-12) {
    return { ok: false, nodeName: def.nodeName, reason: 'panel reference collapsed under frame mapping' }
  }
  // Validate BEFORE orthogonalizing/normalizing — never launder a bad
  // reference into a plausible-looking unit vector (M2 invariant).
  if (Math.abs(normalRef.dot(axis)) > 1e-4) {
    return {
      ok: false,
      nodeName: def.nodeName,
      reason: `axis/normal not orthogonal after mapping (dot=${normalRef.dot(axis).toExponential(3)})`,
    }
  }
  normalRef.addScaledVector(axis, -normalRef.dot(axis)).normalize()

  return {
    ok: true,
    joint: {
      def,
      node,
      baseQuaternion: node.quaternion.clone(),
      basePosition: node.position.clone(),
      modelToParent,
      axis,
      normalRef,
    },
  }
}

/**
 * Apply a shaft rotation. PRE-multiplied onto the authored base: the delta
 * rotates about the PARENT-frame axis through the node's own origin, which
 * lies ON the shaft. Post-multiplying would rotate about a node-LOCAL axis,
 * which the authored ±90° joint bases turn into a perpendicular.
 */
export function applyJointAngle(joint: ResolvedJoint, angleRad: number, deltaQuat: THREE.Quaternion): void {
  deltaQuat.setFromAxisAngle(joint.axis, angleRad)
  joint.node.quaternion.copy(joint.baseQuaternion).premultiply(deltaQuat)
}

// ─── Target-angle laws ────────────────────────────────────────────────────────

/** Near-zero sun/nadir projection onto the gimbal plane: ill-conditioned — hold. */
export const GIMBAL_SINGULARITY_EPSILON = 0.02

const DEG2RAD = Math.PI / 180

/** Wrap an angle into [−π, π). */
export function wrapPi(angle: number): number {
  return (((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
}

// Module-level scratch: these run per joint per frame; no allocations here.
// (Single-threaded; each function consumes the scratch before returning.)
const _projected = new THREE.Vector3()
const _cross = new THREE.Vector3()

function signedAngle(from: THREE.Vector3, to: THREE.Vector3, axis: THREE.Vector3): number {
  _cross.crossVectors(from, to)
  return Math.atan2(_cross.dot(axis), from.dot(to))
}

/**
 * SARJ solar-tracking target: signed angle from the authored panel normal to
 * the sun's projection on the gimbal plane, about the shaft. Full-revolution
 * kinematic tracking (one revolution per orbit — measured correct in the
 * 2026-09-27 follow-up audit). Returns null at gimbal singularity (hold).
 */
export function sarjTargetAngle(joint: ResolvedJoint, sunParent: THREE.Vector3): number | null {
  _projected.copy(sunParent).addScaledVector(joint.axis, -sunParent.dot(joint.axis))
  if (_projected.lengthSq() < GIMBAL_SINGULARITY_EPSILON * GIMBAL_SINGULARITY_EPSILON) return null
  _projected.normalize()
  return signedAngle(joint.normalRef, _projected, joint.axis)
}

/**
 * BGA beta-tilt target: signed angle about the mast from the blanket normal
 * to the sun's projection on the plane ⊥ mast. `sunParent` MUST be in the
 * BGA's LIVE parent frame (after this frame's SARJ rotation): the parent
 * turns once per orbit with the SARJ, and a mount-time mapping would make
 * the target sweep a full circle per orbit. With the SARJ tracking, the
 * result is the out-of-plane residual (≈ the orbit's beta angle), nearly
 * constant over an orbit. The branch nearest zero keeps the face the SARJ
 * already turned toward the sun. Returns null when the sun lies along the
 * mast (hold).
 */
export function bgaTargetAngle(joint: ResolvedJoint, sunParent: THREE.Vector3): number | null {
  _projected.copy(sunParent).addScaledVector(joint.axis, -sunParent.dot(joint.axis))
  if (_projected.lengthSq() < GIMBAL_SINGULARITY_EPSILON * GIMBAL_SINGULARITY_EPSILON) return null
  _projected.normalize()
  const base = wrapPi(signedAngle(joint.normalRef, _projected, joint.axis))
  // Beyond ±90° the sun is behind the face the SARJ chose (e.g. the SARJ
  // held at a singularity this frame): hold rather than flip the wing over.
  return Math.abs(base) <= Math.PI / 2 ? base : null
}

/**
 * Bounded TRRJ thermal target (plan 001 M3) — an ILLUSTRATIVE autotracking
 * mode, not flight telemetry: real TRRJs are usually parked.
 *
 * Daylight: edge-to-Sun — the panel normal ⊥ the projected sun direction.
 * Eclipse: face-to-Earth — the panel normal as close as possible to the
 * projected nadir. The radiator panel is two-sided, so antipodal normals are
 * equivalent; both branches are considered and the in-limit branch closest
 * to `currentAngle` wins (continuous branch choice — never a modulo wrap
 * through the hard stop). Returns null at gimbal singularity (hold).
 */
export function trrjTargetAngle(
  joint: ResolvedJoint,
  currentAngle: number,
  sunParent: THREE.Vector3,
  nadirParent: THREE.Vector3,
  sunlit: boolean,
  limitRad: number,
): number | null {
  const source = sunlit ? sunParent : nadirParent
  if (sunlit) {
    _projected.copy(source).addScaledVector(joint.axis, -source.dot(joint.axis))
    if (_projected.lengthSq() < GIMBAL_SINGULARITY_EPSILON * GIMBAL_SINGULARITY_EPSILON) return null
    _projected.normalize()
    // An in-plane direction ⊥ the sun projection (one of the two edges).
    _projected.crossVectors(joint.axis, _projected)
  } else {
    _projected.copy(source).addScaledVector(joint.axis, -source.dot(joint.axis))
    if (_projected.lengthSq() < GIMBAL_SINGULARITY_EPSILON * GIMBAL_SINGULARITY_EPSILON) return null
    _projected.normalize()
  }

  const base = signedAngle(joint.normalRef, _projected, joint.axis)
  // Two-sided equivalence: the antipodal pose is the same physical pose.
  const candidates = [wrapPi(base), wrapPi(base + Math.PI)]
  const inLimit = candidates.filter((c) => Math.abs(c) <= limitRad)
  if (inLimit.length > 0) {
    let best = inLimit[0]
    let bestTravel = Math.abs(wrapPi(best - currentAngle))
    for (let i = 1; i < inLimit.length; i += 1) {
      const travel = Math.abs(wrapPi(inLimit[i] - currentAngle))
      if (travel < bestTravel) {
        best = inLimit[i]
        bestTravel = travel
      }
    }
    return best
  }
  // Unreachable for antipodal candidates when limitRad > π/2, but keep an
  // explicit bounded fallback: clamp the nearer branch to the nearest stop.
  const nearer = Math.abs(wrapPi(candidates[0] - currentAngle)) <=
    Math.abs(wrapPi(candidates[1] - currentAngle))
    ? candidates[0]
    : candidates[1]
  return THREE.MathUtils.clamp(nearer, -limitRad, limitRad)
}

/**
 * Move `current` toward `target` by at most `maxStep` radians (0 disables
 * motion — e.g. a paused clock). Stepping continues through the wrapped
 * branch only; there is no full-revolution unwind for the bounded law.
 */
export function advanceToward(current: number, target: number, maxStep: number): number {
  if (maxStep <= 0) return current
  const delta = wrapPi(target - current)
  if (Math.abs(delta) <= maxStep) return wrapPi(target)
  return wrapPi(current + Math.sign(delta) * maxStep)
}

/**
 * How close to a travel stop the tracked branch must be for an antipodal
 * target to be treated as a branch relabel rather than real travel.
 */
export const BRANCH_FLIP_WINDOW_RAD = 5 * DEG2RAD

/**
 * TRRJ slew integration with two-sided branch relabeling.
 *
 * When the tracked branch reaches a travel stop and the only in-limit
 * realization of the desired pose is its antipode (~180° away as an angle,
 * but the SAME physical pose for a two-sided radiator), relabel instantly.
 * Slewing that angular "distance" would visibly roll the panel through its
 * perpendicular for nothing (plan 001 M3: explicit bounded flip, never a
 * modulo wrap through the hard stop). A genuine large sun jump away from the
 * stop keeps the bounded slew; a paused clock (maxStep = 0) never moves.
 */
export function trrjAdvance(
  applied: number,
  target: number,
  maxStep: number,
  limitRad: number,
): number {
  if (maxStep <= 0) return applied
  const travel = Math.abs(wrapPi(target - applied))
  if (travel > Math.PI / 2 && Math.abs(applied) >= limitRad - BRANCH_FLIP_WINDOW_RAD) {
    return target
  }
  return advanceToward(applied, target, maxStep)
}

// ─── Oscillators (A1: each entry owns its spec) ───────────────────────────────

export interface OscillatorEntry {
  part: THREE.Object3D
  /** Authored rotation value the sweep composes onto. */
  base: number
  spec: OscillatorSpec
}

function specMatches(spec: OscillatorSpec['target'], name: string): boolean {
  if (typeof spec === 'string') return spec === name
  return spec.test(name)
}

/**
 * Resolve oscillator targets. Every entry carries its OWN spec, so a missing
 * target contributes no entries and a multi-match target contributes one
 * entry per match — neither can borrow another camera's axis or period.
 */
export function resolveOscillators(root: THREE.Object3D, specs: OscillatorSpec[]): OscillatorEntry[] {
  const entries: OscillatorEntry[] = []
  for (const spec of specs) {
    root.traverse((object) => {
      if (specMatches(spec.target, object.name)) {
        entries.push({ part: object, base: object.rotation[spec.axis], spec })
      }
    })
  }
  return entries
}

/** Advance the idle sweep for every entry at simulation time `epochSec`. */
export function applyOscillators(entries: OscillatorEntry[], epochSec: number): void {
  for (const entry of entries) {
    const phaseRad = (entry.spec.phaseDeg ?? 0) * DEG2RAD
    const amplitudeRad = entry.spec.amplitudeDeg * DEG2RAD
    entry.part.rotation[entry.spec.axis] =
      entry.base + amplitudeRad * Math.sin((2 * Math.PI * epochSec) / entry.spec.periodSec + phaseRad)
  }
}

// ─── Asset-embedded rig metadata (extras.orbitalRig) ─────────────────────────

export interface ValidatedRigMetadata {
  joints: JointDefinition[]
  oscillators: OscillatorSpec[]
  limits: TrrjLimits
}

export type RigMetadataParse =
  | { status: 'absent' }
  | { status: 'valid'; metadata: ValidatedRigMetadata }
  | { status: 'invalid'; errors: string[] }

function isVec3Array(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
}

function validateJointDef(raw: unknown, errors: string[], index: number): JointDefinition | null {
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`joint[${index}] is not an object`)
    return null
  }
  const j = raw as Record<string, unknown>
  const id = typeof j.id === 'string' ? j.id : `joint[${index}]`
  if (j.role !== 'sarj' && j.role !== 'trrj' && j.role !== 'bga') {
    errors.push(`joint "${id}" has unknown role ${JSON.stringify(j.role)}`)
    return null
  }
  if (typeof j.nodeName !== 'string' || j.nodeName.length === 0) {
    errors.push(`joint "${id}" has no nodeName`)
    return null
  }
  if (!isVec3Array(j.axisModel) || !isVec3Array(j.normalModel)) {
    errors.push(`joint "${id}" axisModel/normalModel are not finite 3-vectors`)
    return null
  }
  const axis = new THREE.Vector3(...j.axisModel)
  const normal = new THREE.Vector3(...j.normalModel)
  if (Math.abs(axis.length() - 1) > 1e-3 || Math.abs(normal.length() - 1) > 1e-3) {
    errors.push(`joint "${id}" axisModel/normalModel are not unit vectors`)
    return null
  }
  if (Math.abs(axis.dot(normal)) > 1e-4) {
    errors.push(`joint "${id}" axisModel/normalModel are not orthogonal`)
    return null
  }
  return {
    id,
    nodeName: j.nodeName,
    role: j.role,
    axisModel: j.axisModel,
    normalModel: j.normalModel,
  }
}

function validateOscillatorSpec(raw: unknown, errors: string[], index: number): OscillatorSpec | null {
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`oscillator[${index}] is not an object`)
    return null
  }
  const o = raw as Record<string, unknown>
  const target = typeof o.target === 'string' ? o.target : `oscillator[${index}]`
  if (typeof o.target !== 'string') {
    errors.push(`oscillator "${target}" has a non-string target`)
    return null
  }
  if (o.axis !== 'x' && o.axis !== 'y' && o.axis !== 'z') {
    errors.push(`oscillator "${target}" has unknown axis ${JSON.stringify(o.axis)}`)
    return null
  }
  if (typeof o.amplitudeDeg !== 'number' || !(o.amplitudeDeg > 0) ||
      typeof o.periodSec !== 'number' || !(o.periodSec > 0)) {
    errors.push(`oscillator "${target}" has invalid amplitudeDeg/periodSec`)
    return null
  }
  if (o.phaseDeg !== undefined && typeof o.phaseDeg !== 'number') {
    errors.push(`oscillator "${target}" has a non-numeric phaseDeg`)
    return null
  }
  return {
    target: o.target,
    axis: o.axis,
    amplitudeDeg: o.amplitudeDeg,
    periodSec: o.periodSec,
    phaseDeg: o.phaseDeg,
  }
}

/**
 * Validate the rig metadata a GLB may embed in its scene extras
 * (`extras.orbitalRig` → `gltf.scene.userData.orbitalRig`). Absent metadata
 * is normal for pre-rebuild assets; PRESENT-but-invalid metadata is an asset
 * contract violation the caller must not paper over (plan 001 B.6: validate
 * before declaring the detail ready).
 */
export function parseRigMetadata(sceneUserData: unknown): RigMetadataParse {
  if (sceneUserData === null || sceneUserData === undefined) return { status: 'absent' }
  const raw = (sceneUserData as { orbitalRig?: unknown }).orbitalRig
  if (raw === null || raw === undefined) return { status: 'absent' }

  const errors: string[] = []
  if (typeof raw !== 'object') {
    return { status: 'invalid', errors: ['orbitalRig is not an object'] }
  }
  const rig = raw as Record<string, unknown>
  if (rig.schemaVersion !== RIG_SCHEMA_VERSION) {
    errors.push(`unsupported orbitalRig schemaVersion ${JSON.stringify(rig.schemaVersion)}`)
  }
  const joints: JointDefinition[] = []
  if (!Array.isArray(rig.joints)) {
    errors.push('orbitalRig.joints is not an array')
  } else {
    rig.joints.forEach((j, i) => {
      const def = validateJointDef(j, errors, i)
      if (def) joints.push(def)
    })
  }
  const oscillators: OscillatorSpec[] = []
  if (!Array.isArray(rig.oscillators)) {
    errors.push('orbitalRig.oscillators is not an array')
  } else {
    rig.oscillators.forEach((o, i) => {
      const spec = validateOscillatorSpec(o, errors, i)
      if (spec) oscillators.push(spec)
    })
  }
  const limitsRaw = rig.trrjLimits as Record<string, unknown> | undefined
  if (
    typeof limitsRaw !== 'object' ||
    limitsRaw === null ||
    typeof limitsRaw.softwareLimitDeg !== 'number' ||
    !(limitsRaw.softwareLimitDeg > 0) ||
    typeof limitsRaw.hardwareLimitDeg !== 'number' ||
    !(limitsRaw.hardwareLimitDeg > 0) ||
    typeof limitsRaw.slewDegPerSimSecond !== 'number' ||
    !(limitsRaw.slewDegPerSimSecond > 0)
  ) {
    errors.push('orbitalRig.trrjLimits is missing or invalid')
  }
  if (errors.length > 0) return { status: 'invalid', errors }

  return {
    status: 'valid',
    metadata: {
      joints,
      oscillators,
      limits: limitsRaw as unknown as TrrjLimits,
    },
  }
}
