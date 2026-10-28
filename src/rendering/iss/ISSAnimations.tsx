// ─── ISSAnimations — Procedural Part Animation (IGOAL model) ─────────────────
//
// Lifecycle only: the per-frame step lives in ISSRigAnimator.ts and every
// mechanism calculation in ISSJointKinematics.ts (both free of React, driven
// by tests against the real asset's node tree). Behavior:
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
//   - Pan/tilt TV cameras sweep with a slow sinusoidal idle about their own
//     local axis, pivoting on the camera when the authored origin is off it.
//
// Only the VISIBLE detail model animates; it publishes each joint's state so
// the next tier (Locate LOD ⇄ full model) continues the same pose — a swap in
// the middle of a slew neither snaps nor restarts it.
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
import type { DetailQuality } from '@/stores/loadingStore'
import {
  IGOAL_JOINT_DEFS,
  IGOAL_OSCILLATOR_SPECS,
  IGOAL_TRRJ_LIMITS,
  type RigMetadataParse,
} from './ISSJointKinematics'
import { RigAnimator, type RigConfig } from './ISSRigAnimator'
import { explorerParked, explorerRuntime } from './explorerRuntime'

const STATIC_CONFIG: RigConfig = {
  joints: [],
  oscillators: [],
  limits: IGOAL_TRRJ_LIMITS,
}

function configForQuality(quality: DetailQuality, rigMetadata: RigMetadataParse | undefined): RigConfig {
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
  // The Locate LOD is derived from the IGOAL asset and shares its rig, so it
  // falls back to the same definitions as high. Only legacy is deliberately
  // static.
  if (quality === 'legacy') return STATIC_CONFIG
  return {
    joints: IGOAL_JOINT_DEFS,
    oscillators: IGOAL_OSCILLATOR_SPECS,
    limits: IGOAL_TRRJ_LIMITS,
  }
}

export interface IssAnimationsProps {
  rootRef: React.RefObject<THREE.Group | null>
  quality: DetailQuality
  /** The model is on screen. Hidden models skip the rig entirely. */
  active: boolean
  /** Validated scene-extras rig metadata (absent for pre-rebuild assets). */
  rigMetadata?: RigMetadataParse
  /** Detail contract failure (missing/unresolvable rig) — must not animate
   * a partially resolved rig, so the caller fails the detail instead. */
  onError: () => void
}

export function ISSAnimations({ rootRef, quality, active, rigMetadata, onError }: IssAnimationsProps): null {
  const config = useMemo(() => configForQuality(quality, rigMetadata), [quality, rigMetadata])
  const animatorRef = useRef<RigAnimator | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const _sunWorld = useRef(new THREE.Vector3())

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const animator = new RigAnimator(root, config)
    if (animator.failures.length > 0) {
      // A required joint is missing or unresolvable — do not animate a
      // half-rig (plan 001 stop condition: no silent skipping).
      console.error('[ISSAnimations] rig resolution failed:', animator.failures)
      onErrorRef.current()
      return
    }
    animatorRef.current = animator
    return () => { animatorRef.current = null }
  }, [config, rootRef])

  useFrame((_, delta) => {
    const animator = animatorRef.current
    if (!animator) return
    if (!active) {
      animator.deactivate()
      return
    }
    const simTime = simulationClock.now()
    // One solar ephemeris per frame feeds tracking, the eclipse test, and the
    // eclipse target; the same sun vector the lighting consumers use.
    const sun = sunDirectionWorld(simTime.julianDate)
    animator.step({
      sunWorld: _sunWorld.current.set(sun.x, sun.y, sun.z).normalize(),
      epochMs: simTime.epochMs,
      wallDeltaSec: delta,
      nowWallMs: performance.now(),
      // The module explorer's exploded view parks every joint.
      parked: explorerParked(),
      snap: explorerRuntime.reducedMotion,
    })
  })

  return null
}
