// ─── Attitude (LVLH + TEA) ───────────────────────────────────────────────────
//
// Until now the ISS rendered frozen in the inertial frame — modules pointed
// at arbitrary, time-invariant directions as it orbited. The real station
// flies Local-Vertical/Local-Horizontal (LVLH) attitude in Torque
// Equilibrium Attitude (TEA): body +X along the velocity vector (V-bar),
// body +Z toward nadir, with a small ~−8° yaw bias that balances gravity-
// gradient and aerodynamic torques. That orientation is what makes the
// solar arrays sweep the sky correctly and gives the station its "flying"
// look from every angle.
//
// Implementation: each frame we build the LVLH orthonormal basis from the
// live telemetry state (V-bar from velocityECI, nadir from −positionECI,
// both mapped through the same TEME→world axis swap as position), convert
// to a quaternion, apply the TEA yaw bias about the body nadir axis, and
// slerp the group quaternion toward it. The exponential slerp is rate-
// limited (never snaps) so Locate flights and mode switches stay smooth.
//
// Model independence: the ISS group rotation is identical for both detailed
// models. Each model's native axis convention is absorbed INSIDE ISSModel by
// a per-model pre-rotation constant (MODEL_PRE_ROTATION) applied on the
// model's own subtree, so this file never cares which GLB is loaded.

import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { ISSModel } from './ISSModel'
import { OrbitalRenderInterpolator } from './OrbitalRenderInterpolator'

// TEA yaw bias (rad) — the real station trims ~−8° west of V-bar.
const TEA_YAW_BIAS_RAD = (-8 * Math.PI) / 180
// Exponential slerp stiffness (1/s) — higher = snappier attitude capture.
const ATTITUDE_SMOOTHING = 1.6

const _vbar = new THREE.Vector3()
const _nadir = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _basis = new THREE.Matrix4()
const _targetQuat = new THREE.Quaternion()
const _yawQuat = new THREE.Quaternion()
const _Z = new THREE.Vector3(0, 0, 1)

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ISSGroup — the ISS scene sub-tree, positioned in the ECI inertial frame
 * and rotated to the LVLH/TEA flight attitude.
 *
 * Mount as a direct child of the R3F Canvas, sibling to EarthGroup.
 * Never nest inside EarthGroup (which is ECEF/rotating).
 *
 * Frame semantics (CRITICAL — must match EarthGroup and shaders):
 *   EarthGroup ROTATES by simTime.gmst → Earth-fixed (ECEF) frame.
 *   This group does NOT rotate with Earth — position stays inertial (ECI);
 *   the quaternion set below is the station's attitude, not a frame change.
 *
 * Coordinate axis swap (TEME → Three.js world space):
 *   positionECI.x → world.x, positionECI.z → world.y, positionECI.y → −world.z
 *   (temeToWorld() in CoordinateConversions.ts) — applied consistently to
 *   position, velocity, and sun direction.
 *
 * Performance contract:
 *   - ZERO useState() or Zustand updates inside useFrame; refs only.
 *   - Position/quaternion mutated directly on groupRef.current.
 *   - telemetryManager.lastState is the latest application-runtime snapshot.
 *   - Render-only interpolation bridges 10 Hz snapshots to the display frame
 *     rate. No redundant SGP4 calls occur here.
 *
 * IMPORTANT — OrbitLine is NOT a child of this group.
 *   OrbitLine generates points in Earth-centered absolute world space.
 *   Mounting it here would add the ISSGroup.position offset to every orbit
 *   point, displacing the orbit ring and spiraling the path into Earth.
 *   OrbitLine is mounted at the scene root in SceneRoot.tsx instead.
 */
interface ISSGroupProps {
  groupRef: RefObject<THREE.Group>
}

export function ISSGroup({ groupRef }: ISSGroupProps): JSX.Element {
  const interpolatorRef = useRef<OrbitalRenderInterpolator | null>(null)
  const interpolator = interpolatorRef.current ??= new OrbitalRenderInterpolator()
  // Current attitude (smoothed) — starts unrotated and converges to LVLH.
  const attitudeRef = useRef(new THREE.Quaternion())

  useFrame(({ clock }, delta) => {
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

    // ─── Attitude: LVLH + TEA yaw bias ───
    // V-bar from velocity, nadir from −position (same TEME→world swap as the
    // interpolator applies to position). Guarded until the propagator has a
    // real velocity so we never orient on a zero vector.
    _vbar.set(state.velocityECI.x, state.velocityECI.z, -state.velocityECI.y)
    if (_vbar.lengthSq() < 1e-9) return
    _vbar.normalize()

    _nadir.copy(groupRef.current.position).multiplyScalar(-1)
    if (_nadir.lengthSq() < 1e-9) return
    _nadir.normalize()

    // Degenerate-frame guard (plan 001 F): radial motion or mixed-time data
    // can make nadir and V-bar collapse toward parallel, and normalizing a
    // near-zero cross product would randomize the attitude. Keep the
    // previous attitude for the frame instead.
    _normal.crossVectors(_nadir, _vbar)
    if (_normal.lengthSq() < 1e-8) return
    _normal.normalize()
    // Re-orthogonalize nadir against the (vbar, normal) pair so the basis
    // stays orthonormal as velocity and position slowly diverge from 90°.
    _nadir.crossVectors(_vbar, _normal)
    if (_nadir.lengthSq() < 1e-8) return
    _nadir.normalize()

    _basis.makeBasis(_vbar, _normal, _nadir)
    _targetQuat.setFromRotationMatrix(_basis)

    // TEA: the small equilibrium yaw trim about the body nadir axis.
    _yawQuat.setFromAxisAngle(_Z, TEA_YAW_BIAS_RAD)
    _targetQuat.multiply(_yawQuat)

    // Rate-limited capture: exponential slerp never snaps, even when the
    // camera's Locate flight or a mode change hands us a new geometry.
    const clampedDelta = Math.min(delta, 0.1)
    attitudeRef.current.slerp(_targetQuat, 1 - Math.exp(-ATTITUDE_SMOOTHING * clampedDelta))
    groupRef.current.quaternion.copy(attitudeRef.current)
  })

  return (
    <group ref={groupRef}>
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
