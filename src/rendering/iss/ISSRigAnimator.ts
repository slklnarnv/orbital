// ─── ISSRigAnimator — the per-frame rig step, free of React ──────────────────
//
// ISSAnimations owns the lifecycle (mount, visibility, the frame loop); this
// class owns everything that happens inside a frame, so the whole mechanism
// can be driven from tests against the real asset's node tree (see
// tests/unit/rendering/ISSRigSimulation.test.ts). Behaviour per joint role is
// documented in ISSAnimations.tsx and ISSJointKinematics.ts.

import * as THREE from 'three'
import { isSunlit } from '@/core/orbital/SunVisibility'
import {
  BGA_SLEW_DEG_PER_SIM_SECOND,
  advanceToward,
  applyJointAngle,
  applyOscillators,
  bgaTargetAngle,
  freshHandoff,
  resolveJoint,
  resolveOscillators,
  sarjTargetAngle,
  trrjAdvance,
  trrjTargetAngle,
  wrapPi,
  type JointDefinition,
  type OscillatorEntry,
  type OscillatorSpec,
  type ResolvedJoint,
  type SharedJointState,
  type TrrjLimits,
} from './ISSJointKinematics'

export interface RigConfig {
  joints: JointDefinition[]
  oscillators: OscillatorSpec[]
  limits: TrrjLimits
}

export interface RigFrame {
  /** Unit sun direction, world frame. */
  sunWorld: THREE.Vector3
  /** Simulation epoch (ms). Slews integrate epoch deltas, not frame deltas. */
  epochMs: number
  /** Render-frame delta (s) for the wall-clock slew cap. */
  wallDeltaSec: number
  /** performance.now() of this frame, for the tier hand-off. */
  nowWallMs: number
}

interface JointRuntime {
  joint: ResolvedJoint
  /** Applied shaft angle (radians). SARJ: wrapped to [−π,π); TRRJ: bounded. */
  applied: number
  initialized: boolean
  /** Simulation epoch of the last slew integration (epoch deltas, not
   * render tick deltas — the clock can repeat one tick across frames). */
  lastEpochMs: number | null
}

const DEG2RAD = Math.PI / 180

// Slew limits are in simulation seconds; at 300× that alone would let the
// BGAs (2°/sim-s) and TRRJs (0.75°/sim-s) sweep 225–600°/s on screen after a
// seek or an eclipse transition. This caps the on-screen rate too, so every
// catch-up reads as a glide. The SARJs are deliberately uncapped: they follow
// their sun-tracking target exactly, which at 300× legitimately moves faster.
export const MAX_WALL_DEG_PER_SECOND = 12

/** Joint state published by the visible detail model, keyed by joint id. */
export const sharedJointStates = new Map<string, SharedJointState>()

export class RigAnimator {
  /** Unresolvable joints (`node: reason`); a non-empty list means: do not animate. */
  readonly failures: string[] = []
  private readonly joints: JointRuntime[] = []
  private readonly oscillators: OscillatorEntry[]
  private readonly limits: TrrjLimits

  private readonly _rootQuat = new THREE.Quaternion()
  private readonly _worldPos = new THREE.Vector3()
  private readonly _sunLocal = new THREE.Vector3()
  private readonly _nadirLocal = new THREE.Vector3()
  private readonly _sunParent = new THREE.Vector3()
  private readonly _nadirParent = new THREE.Vector3()
  private readonly _deltaQuat = new THREE.Quaternion()
  private readonly _parentQuat = new THREE.Quaternion()

  /** Resolve at mount, on the authored pose. */
  constructor(
    private readonly root: THREE.Object3D,
    config: RigConfig,
    private readonly shared: Map<string, SharedJointState> = sharedJointStates,
  ) {
    this.limits = config.limits
    root.updateWorldMatrix(true, true)
    for (const def of config.joints) {
      const result = resolveJoint(root, def)
      if (result.ok) {
        this.joints.push({ joint: result.joint, applied: 0, initialized: false, lastEpochMs: null })
      } else {
        this.failures.push(`${result.nodeName}: ${result.reason}`)
      }
    }
    this.oscillators = this.failures.length === 0 ? resolveOscillators(root, config.oscillators) : []
  }

  /** Hidden: forget the pose so the next visible frame re-enters through the
   *  hand-off (or the target). */
  deactivate(): void {
    for (const state of this.joints) state.initialized = false
  }

  step({ sunWorld, epochMs, wallDeltaSec, nowWallMs }: RigFrame): void {
    if (this.failures.length > 0) return
    applyOscillators(this.oscillators, epochMs / 1000)
    if (this.joints.length === 0) return

    const root = this.root
    root.getWorldQuaternion(this._rootQuat)
    root.getWorldPosition(this._worldPos)
    // The TRRJ law switches at the penumbra midpoint (sunVisibility = 0.5).
    const sunlit = isSunlit(this._worldPos, sunWorld)

    // Sun/nadir in model space: the pivot root carries the normalization
    // pre-rotation and the live LVLH attitude, both cancelled by its inverse.
    this._rootQuat.invert()
    this._sunLocal.copy(sunWorld).applyQuaternion(this._rootQuat)
    this._nadirLocal.copy(this._worldPos).multiplyScalar(-1).normalize().applyQuaternion(this._rootQuat)

    const limitRad = this.limits.softwareLimitDeg * DEG2RAD
    const slewRadPerSimSec = this.limits.slewDegPerSimSecond * DEG2RAD
    const bgaSlewRadPerSimSec = BGA_SLEW_DEG_PER_SIM_SECOND * DEG2RAD
    const wallCapRad = MAX_WALL_DEG_PER_SECOND * DEG2RAD * Math.min(wallDeltaSec, 0.1)

    for (const state of this.joints) {
      const { joint } = state
      if (!state.initialized) {
        const handoff = freshHandoff(this.shared.get(joint.def.id), nowWallMs)
        if (handoff) {
          state.applied = handoff.applied
          state.lastEpochMs = handoff.lastEpochMs
          state.initialized = true
        }
      }

      if (joint.def.role === 'bga') {
        // Live parent frame: the SARJ above this BGA was applied earlier in
        // this loop (joint order), so refresh the ancestor matrices first.
        const parent = joint.node.parent
        if (!parent) continue
        parent.updateWorldMatrix(true, false)
        parent.getWorldQuaternion(this._parentQuat).invert()
        this._sunParent.copy(sunWorld).applyQuaternion(this._parentQuat)
        const dtSim = state.lastEpochMs === null ? 0 : Math.max(0, (epochMs - state.lastEpochMs) / 1000)
        state.lastEpochMs = epochMs
        // Track through eclipse too: holding there and re-adopting the target
        // at sunrise snapped the wings by up to |β| in one frame.
        const target = bgaTargetAngle(joint, this._sunParent)
        if (target === null) continue
        if (!state.initialized) {
          state.applied = target
          state.initialized = true
        } else {
          state.applied = advanceToward(state.applied, target, Math.min(bgaSlewRadPerSimSec * dtSim, wallCapRad))
        }
        applyJointAngle(joint, state.applied, this._deltaQuat)
        this.publish(state, nowWallMs)
        continue
      }

      this._sunParent.copy(this._sunLocal).applyQuaternion(joint.modelToParent)

      if (joint.def.role === 'sarj') {
        const target = sarjTargetAngle(joint, this._sunParent)
        if (target === null) continue // gimbal singularity: hold
        if (!state.initialized) {
          // Adopt the first valid target directly: the authored pose is only
          // on screen for the mount frame, and unwinding from it would spin
          // the assembly across up to half a revolution for nothing.
          state.applied = wrapPi(target)
          state.initialized = true
        } else {
          // Shortest-path unwrap keeps the sweep continuous across ±π while
          // the applied value stays wrapped to [−π,π).
          state.applied = wrapPi(state.applied + wrapPi(target - state.applied))
        }
        applyJointAngle(joint, state.applied, this._deltaQuat)
        this.publish(state, nowWallMs)
        continue
      }

      // Bounded illustrative TRRJ law (see ISSAnimations header).
      this._nadirParent.copy(this._nadirLocal).applyQuaternion(joint.modelToParent)
      const target = trrjTargetAngle(joint, state.applied, this._sunParent, this._nadirParent, sunlit, limitRad)
      const dtSim = state.lastEpochMs === null ? 0 : Math.max(0, (epochMs - state.lastEpochMs) / 1000)
      state.lastEpochMs = epochMs
      if (target === null) continue // gimbal singularity: hold
      if (!state.initialized) {
        state.applied = target
        state.initialized = true
      } else {
        // Slew in simulation seconds via epoch deltas: PAUSED advances the
        // epoch by 0 (no repeated integration), 120× advances it faster, and
        // a repeated tick inside one frame yields dtSim = 0, never a doubled
        // rate. trrjAdvance relabels the two-sided branch at a travel stop
        // instead of slewing the equivalent antipode.
        state.applied = trrjAdvance(state.applied, target, Math.min(slewRadPerSimSec * dtSim, wallCapRad), limitRad)
      }
      applyJointAngle(joint, state.applied, this._deltaQuat)
      this.publish(state, nowWallMs)
    }
  }

  private publish(state: JointRuntime, wallMs: number): void {
    const id = state.joint.def.id
    const shared = this.shared.get(id)
    if (shared) {
      shared.applied = state.applied
      shared.lastEpochMs = state.lastEpochMs
      shared.wallMs = wallMs
    } else {
      this.shared.set(id, { applied: state.applied, lastEpochMs: state.lastEpochMs, wallMs })
    }
  }
}
