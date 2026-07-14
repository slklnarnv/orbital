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
//   - telemetryManager.lastState is the latest application-runtime snapshot.
//   - Render-only interpolation bridges 10 Hz snapshots to the display frame rate.
//     No redundant SGP4 calls occur here and simulation truth remains untouched.
//
// IMPORTANT — OrbitLine is NOT a child of this group.
//   OrbitLine generates points in Earth-centered absolute world space.
//   Mounting it here would add the ISSGroup.position offset to every orbit point,
//   displacing the orbit ring by the ISS position vector and causing the path
//   to spiral into Earth on the opposite side.
//   OrbitLine is mounted at the scene root in SceneRoot.tsx instead.

import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { ISSModel } from './ISSModel'
import { OrbitalRenderInterpolator } from './OrbitalRenderInterpolator'

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ISSGroup — the ISS scene sub-tree in the ECI inertial frame.
 *
 * Mount as a direct child of the R3F Canvas, sibling to EarthGroup.
 * Never nest inside EarthGroup (which is ECEF/rotating).
 */
interface ISSGroupProps {
  groupRef: RefObject<THREE.Group>
}

export function ISSGroup({ groupRef }: ISSGroupProps): JSX.Element {
  const interpolatorRef = useRef<OrbitalRenderInterpolator | null>(null)
  const interpolator = interpolatorRef.current ??= new OrbitalRenderInterpolator()

  useFrame(({ clock }) => {
    if (!groupRef.current) return

    // Read the last propagated orbital state from TelemetryManager.
    // SimulationRuntime updates telemetry independently at 10 Hz. Rendering consumes
    // the latest snapshot here — no duplicate SGP4 calls or render-owned truth.
    const state = telemetryManager.lastState
    if (!state) return

    // Smooth render motion between the application runtime's 10 Hz snapshots.
    // The interpolator also owns the canonical TEME → Three.js axis mapping.
    interpolator.sample(
      state,
      clock.elapsedTime,
      groupRef.current.position,
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
