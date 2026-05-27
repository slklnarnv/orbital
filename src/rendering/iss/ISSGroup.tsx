// ─── ISSGroup — ECI Inertial Frame Container ─────────────────────────────────
//
// This component positions the ISS in the Three.js scene using coordinates
// computed by the orbital engine in the TEME/ECI (Earth-Centered Inertial) frame.
//
// Frame semantics (CRITICAL — must match EarthGroup and shaders):
//   EarthGroup ROTATES by simTime.gmst every frame → Earth-fixed (ECEF) frame.
//   ISSGroup does NOT rotate → stays in the inertial (ECI) frame.
//   The ISS position is already in ECI, so it naturally orbits over correct
//   geographic locations as Earth rotates beneath it.
//
// Coordinate axis swap (TEME → Three.js world space):
//   positionECI.x → world.x  (unchanged)
//   positionECI.z → world.y  (TEME north-pole axis → Three.js Y-up)
//   positionECI.y → world.z  (negated — right-hand flip)
//
// Defined in CoordinateConversions.ts as temeToWorld() and consistent
// across all systems: earth texture, sun direction, orbit line generation.
//
// Performance contract:
//   - ZERO useState() or Zustand updates inside useFrame.
//   - Position mutated directly on groupRef.current — Three.js ref only.
//   - telemetryManager.lastState is the already-propagated state from SimulationLoop.
//     No redundant SGP4 calls occur here.
//
// IMPORTANT — OrbitLine is NOT a child of this group.
//   OrbitLine generates points in Earth-centered absolute world space.
//   Mounting it here would add the ISSGroup.position offset to every orbit point,
//   displacing the orbit ring by the ISS position vector and causing the path
//   to spiral into Earth on the opposite side.
//   OrbitLine is mounted at the scene root in SceneRoot.tsx instead.

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { ISSModel } from './ISSModel'

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ISSGroup — the ISS scene sub-tree in the ECI inertial frame.
 *
 * Mount as a direct child of the R3F Canvas, sibling to EarthGroup.
 * Never nest inside EarthGroup (which is ECEF/rotating).
 */
export function ISSGroup(): JSX.Element {
  const groupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!groupRef.current) return

    // Read the last propagated orbital state from TelemetryManager.
    // SimulationLoop (in SceneRoot) calls telemetryManager.update() every frame,
    // so lastState is always current — no duplicate SGP4 calls needed here.
    const state = telemetryManager.lastState
    if (!state) return

    // ── TEME → Three.js world space axis swap ──────────────────────────────
    // positionECI is in TEME frame (km). Apply the canonical mapping:
    //   TEME X →  Three.js X  (no change)
    //   TEME Z →  Three.js Y  (north pole = up)
    //   TEME Y → -Three.js Z  (right-hand flip)
    groupRef.current.position.set(
      state.positionECI.x,
       state.positionECI.z,  // TEME Z → Three.js Y
      -state.positionECI.y,  // TEME Y → Three.js -Z
    )
  })

  return (
    <group ref={groupRef}>
      {/* Placeholder spacecraft geometry — model-agnostic, replace in Phase 3 */}
      <ISSModel />
      {/*
       * OrbitLine is intentionally NOT mounted here.
       * It generates Earth-centered absolute world-space positions and must
       * live at the scene root (SceneRoot.tsx) as a sibling of ISSGroup.
       * Mounting it here would offset every orbit point by ISSGroup.position.
       */}
    </group>
  )
}
