// ─── ISSAnimations — Procedural Part Animation (IGOAL model) ─────────────────
//
// Frame-loop orchestration only: every mechanism calculation lives in
// ISSJointKinematics.ts (pure, unit-tested without a WebGL tree). Behavior:
//   - Solar Alpha Rotary Joints (PORT/STBD_ALPHA_ROT): full-revolution solar
//     tracking about the truss axis — one revolution per orbit, verified
//     numerically in the 2026-09-27 follow-up audit.
//   - Thermal Radiator Rotary Joints (PORT/STBD_TRRJ_GAMMA_ROT): rotate the
//     radiator beams about their OWN long axis (native X, perpendicular to
//     the truss — plan 001 M1; the previous truss-axis + box-hinge version
//     swept the whole 23 m assembly around the truss). The commanded law is
//     an ILLUSTRATIVE autotracking mode (edge-to-Sun in daylight, face-to-
//     Earth in eclipse) bounded to the real ±105° software travel at
//     0.75°/simulation-second. Real TRRJs are usually parked; this is a
//     visualization of contingency autotracking, not flight telemetry.
//   - Beta Gimbal Assemblies (PORT/STBD_BETA_ROT_*): each wing tilts about
//     its own mast to take out the out-of-plane (beta) residual the SARJ
//     cannot. The sun is mapped into each BGA's LIVE parent frame (after the
//     SARJ is applied this frame); the 2026-09-28 attempt read as broken
//     because a mount-time frame made the target sweep once per orbit.
//     Slew-limited, so seeks and singularity holds never snap.
//   - Pan/tilt TV cameras sweep with a slow sinusoidal idle.
//
// The legacy detailed model and Model A are DELIBERATELY STATIC (empty
// config): their value is proven reliability; the IGOAL model carries the
// animation showpiece.
//
// Joint frames are resolved at mount from parent-relative quaternions and
// rig-frame axis/normal data (no bounding-box inference — resolution is
// invariant under the station's attitude at mount). The config is stable per
// mount: `quality` changes remount the whole detail subtree (keyed by asset
// URL in ISSModel), and `rigMetadata` is derived from the same cloned scene,
// so joints are always resolved from an authored pose.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import type { IssModelQuality } from '@/stores/settingsStore'
import {
  BGA_SLEW_DEG_PER_SIM_SECOND,
  IGOAL_JOINT_DEFS,
  IGOAL_OSCILLATOR_SPECS,
  IGOAL_TRRJ_LIMITS,
  advanceToward,
  applyJointAngle,
  applyOscillators,
  bgaTargetAngle,
  resolveJoint,
  resolveOscillators,
  sarjTargetAngle,
  trrjAdvance,
  trrjTargetAngle,
  wrapPi,
  type JointDefinition,
  type OscillatorSpec,
  type ResolvedJoint,
  type RigMetadataParse,
  type TrrjLimits,
} from './ISSJointKinematics'

interface ModelAnimationConfig {
  joints: JointDefinition[]
  oscillators: OscillatorSpec[]
  limits: TrrjLimits
}

const STATIC_CONFIG: ModelAnimationConfig = {
  joints: [],
  oscillators: [],
  limits: IGOAL_TRRJ_LIMITS,
}

function configForQuality(quality: IssModelQuality, rigMetadata: RigMetadataParse | undefined): ModelAnimationConfig {
  // A rebuilt asset embeds its rig contract in scene extras; use it when it
  // validates (it mirrors the built-in definitions, which remain the
  // fallback for pre-rebuild assets). Invalid metadata never reaches here:
  // ISSModel fails the detail before this component animates.
  if (rigMetadata?.status === 'valid') {
    return {
      joints: rigMetadata.metadata.joints,
      oscillators: rigMetadata.metadata.oscillators,
      limits: rigMetadata.metadata.limits,
    }
  }
  if (quality !== 'high') return STATIC_CONFIG
  return {
    joints: IGOAL_JOINT_DEFS,
    oscillators: IGOAL_OSCILLATOR_SPECS,
    limits: IGOAL_TRRJ_LIMITS,
  }
}

interface JointRuntime {
  joint: ResolvedJoint
  /** Applied shaft angle (radians). SARJ: wrapped to [−π,π); TRRJ: bounded. */
  applied: number
  initialized: boolean
  /** Simulation epoch of the last TRRJ slew integration (epoch deltas, not
   * render tick deltas — the clock can repeat one tick across frames). */
  lastEpochMs: number | null
}

export interface IssAnimationsProps {
  rootRef: React.RefObject<THREE.Group | null>
  quality: IssModelQuality
  /** Validated scene-extras rig metadata (absent for pre-rebuild assets). */
  rigMetadata?: RigMetadataParse
  /** Detail contract failure (missing/unresolvable rig) — must not animate
   * a partially resolved rig, so the caller fails the detail instead. */
  onError: () => void
}

const DEG2RAD = Math.PI / 180
// The BGA slew limit is in simulation seconds; at 300× that alone would let
// a catch-up (after a seek or an eclipse hold) sweep ~600°/s on screen. This
// caps the on-screen rate too, so a catch-up always reads as a glide.
const BGA_MAX_WALL_DEG_PER_SECOND = 12
// Sphere-Earth shadow test, identical to the lighting/exposure consumers
// (ISSModel) and the analytic terminator inputs — one solar ephemeris only.
const EARTH_RADIUS_KM = 6371
const EARTH_RADIUS_KM_SQ = EARTH_RADIUS_KM * EARTH_RADIUS_KM

export function ISSAnimations({ rootRef, quality, rigMetadata, onError }: IssAnimationsProps): null {
  const config = useMemo(() => configForQuality(quality, rigMetadata), [quality, rigMetadata])
  const jointsRef = useRef<JointRuntime[]>([])
  const oscillatorsRef = useRef<ReturnType<typeof resolveOscillators>>([])
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const _rootQuat = useRef(new THREE.Quaternion())
  const _worldPos = useRef(new THREE.Vector3())
  const _sunWorld = useRef(new THREE.Vector3())
  const _sunLocal = useRef(new THREE.Vector3())
  const _nadirLocal = useRef(new THREE.Vector3())
  const _sunParent = useRef(new THREE.Vector3())
  const _nadirParent = useRef(new THREE.Vector3())
  const _deltaQuat = useRef(new THREE.Quaternion())
  const _parentQuat = useRef(new THREE.Quaternion())

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const runtimes: JointRuntime[] = []
    const failures: string[] = []
    root.updateWorldMatrix(true, true)
    for (const def of config.joints) {
      const result = resolveJoint(root, def)
      if (result.ok) {
        runtimes.push({ joint: result.joint, applied: 0, initialized: false, lastEpochMs: null })
      } else {
        failures.push(`${result.nodeName}: ${result.reason}`)
      }
    }
    if (failures.length > 0) {
      // A required joint is missing or unresolvable — do not animate a
      // half-rig (plan 001 stop condition: no silent skipping).
      console.error('[ISSAnimations] rig resolution failed:', failures)
      onErrorRef.current()
      return
    }

    jointsRef.current = runtimes
    oscillatorsRef.current = resolveOscillators(root, config.oscillators)
    return () => {
      jointsRef.current = []
      oscillatorsRef.current = []
    }
  }, [config, rootRef])

  useFrame((_, delta) => {
    const root = rootRef.current
    if (!root) return

    const simTime = simulationClock.now()
    const epochMs = simTime.epochMs

    // Camera idle sweeps run for every mounted detail model (empty config on
    // the static fallbacks).
    applyOscillators(oscillatorsRef.current, epochMs / 1000)
    if (jointsRef.current.length === 0) return

    // One solar ephemeris per frame feeds tracking, the eclipse test, and the
    // eclipse target; the same sun vector the lighting consumers use.
    const sunWorld = sunDirectionWorld(simTime.julianDate)
    root.getWorldQuaternion(_rootQuat.current)
    root.getWorldPosition(_worldPos.current)
    _sunWorld.current.set(sunWorld.x, sunWorld.y, sunWorld.z).normalize()
    const alongSun = _worldPos.current.dot(_sunWorld.current)
    const perpSq = _worldPos.current.lengthSq() - alongSun * alongSun
    const sunlit = !(alongSun < 0 && perpSq < EARTH_RADIUS_KM_SQ)

    // Sun/nadir in model space: the pivot root carries the normalization
    // pre-rotation and the live LVLH attitude, both cancelled by its inverse.
    _rootQuat.current.invert()
    _sunLocal.current.copy(_sunWorld.current).applyQuaternion(_rootQuat.current)
    _nadirLocal.current
      .copy(_worldPos.current)
      .multiplyScalar(-1)
      .normalize()
      .applyQuaternion(_rootQuat.current)

    const limitRad = config.limits.softwareLimitDeg * DEG2RAD
    const slewRadPerSimSec = config.limits.slewDegPerSimSecond * DEG2RAD
    const bgaSlewRadPerSimSec = BGA_SLEW_DEG_PER_SIM_SECOND * DEG2RAD

    for (const state of jointsRef.current) {
      const { joint } = state

      if (joint.def.role === 'bga') {
        // Live parent frame: the SARJ above this BGA was applied earlier in
        // this loop (joint order), so refresh the ancestor matrices first.
        const parent = joint.node.parent
        if (!parent) continue
        parent.updateWorldMatrix(true, false)
        parent.getWorldQuaternion(_parentQuat.current).invert()
        _sunParent.current.copy(_sunWorld.current).applyQuaternion(_parentQuat.current)
        const dtSim =
          state.lastEpochMs === null ? 0 : Math.max(0, (epochMs - state.lastEpochMs) / 1000)
        state.lastEpochMs = epochMs
        // In eclipse there is nothing to track: hold the last tilt.
        const target = sunlit ? bgaTargetAngle(joint, _sunParent.current) : null
        if (target === null) continue
        if (!state.initialized) {
          state.applied = target
          state.initialized = true
        } else {
          const step = Math.min(
            bgaSlewRadPerSimSec * dtSim,
            BGA_MAX_WALL_DEG_PER_SECOND * DEG2RAD * Math.min(delta, 0.1),
          )
          state.applied = advanceToward(state.applied, target, step)
        }
        applyJointAngle(joint, state.applied, _deltaQuat.current)
        continue
      }

      _sunParent.current.copy(_sunLocal.current).applyQuaternion(joint.modelToParent)

      if (joint.def.role === 'sarj') {
        const target = sarjTargetAngle(joint, _sunParent.current)
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
        applyJointAngle(joint, state.applied, _deltaQuat.current)
        continue
      }

      // Bounded illustrative TRRJ law (see module header).
      _nadirParent.current.copy(_nadirLocal.current).applyQuaternion(joint.modelToParent)
      const target = trrjTargetAngle(
        joint,
        state.applied,
        _sunParent.current,
        _nadirParent.current,
        sunlit,
        limitRad,
      )
      const dtSim =
        state.lastEpochMs === null ? 0 : Math.max(0, (epochMs - state.lastEpochMs) / 1000)
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
        state.applied = trrjAdvance(state.applied, target, slewRadPerSimSec * dtSim, limitRad)
      }
      applyJointAngle(joint, state.applied, _deltaQuat.current)
    }
  })

  return null
}
