// ─── OrbitLine ────────────────────────────────────────────────────────────────
//
// Renders the ISS one-period orbit prediction arc as a fading polyline.
//
// Design (deliberately boring — an earlier version grew a custom tick-mask
// shader, arc-length re-subdivision with hysteresis, and a frame-order bug
// that meant the arc never rendered at all):
//   - Line2 "fat line" (three/examples/jsm/lines) — a proper ~2 px
//     anti-aliased stroke instead of the unfixable 1 px WebGL hairline.
//   - The dash lives in the shader (`orbitLineMaterial.ts`,
//     `shaders/orbitDash.glsl`), keyed on each vertex's orbital phase
//     (OrbitPhase.ts) and sized on screen with derivatives, so it is anchored
//     to the orbit by construction and needs no per-frame CPU work or phase
//     state. (The CPU-sized dash it replaced crawled ~1.8 pitches per
//     refresh at 1x until it grew an inertial phase origin, and slid whenever
//     the camera-to-station distance changed.) Dashed/Continuous is a
//     uniform: switching never recompiles.
//   - Per-point opacity rides in an injected `instanceAlphaStart/End`
//     attribute, evaluated on the CPU at each refresh:
//       past trail (alpha 0 → 0.5):  fades 0 → 0.30
//       future arc (0.5 → 1.0):      held at 0.60
//   - Path generation runs at most once per ORBIT_PATH_REFRESH_MS of sim time
//     AND past a 250 ms wall-time floor (backwards seeks regenerate; 300×
//     cannot spend every frame on ~185 SGP4 propagations). It is the frame
//     loop's only job; gating it on the arc it produces was a bootstrap
//     deadlock (the bug that left this line permanently invisible).
//   - The vertex buffers are allocated ONCE at MAX_ORBIT_POINTS and mutated
//     in place. LineGeometry.setPositions() and computeLineDistances()
//     REPLACE instance buffers, and three frees a replaced attribute's GL
//     buffer only for the geometry's CURRENT attributes on dispose — calling
//     them per refresh orphaned VBOs (~4/s at the wall floor), invisible in
//     the frame rate, unbounded in GPU memory.
//
// Coordinate system: OrbitPredictor returns Three.js world space (Y-up, km).
//
// Visual encoding: NormalBlending + depthTest keep the arc "grounded" (not a
// holographic overlay) and hidden behind Earth.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'

import { simulationClock } from '@/core/clock/SimulationClock'
import { issEntity } from '@/core/entities/ISSEntity'
import { generateOrbitPath, MAX_ORBIT_POINTS, type OrbitPathPoint } from '@/core/orbital/OrbitPredictor'
import { useSettingsStore } from '@/stores/settingsStore'
import { ORBIT_PATH_REFRESH_MS } from '@/utils/constants'
import { createOrbitLineMaterial } from './orbitLineMaterial'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Wall-time floor between path regenerations (sim-throttle complement). */
const ORBIT_PATH_MIN_WALL_MS = 250

/** Per-point opacity: past ramp height / future plateau. */
const PAST_MAX_ALPHA = 0.3
const FUTURE_ALPHA = 0.6

function smoothstepJs(low: number, high: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

/** The orbit-line fade curve, evaluated per point at refresh time. */
function alphaCurve(temporalAlpha: number): number {
  const past = (temporalAlpha / 0.5) * PAST_MAX_ALPHA
  return past + (FUTURE_ALPHA - past) * smoothstepJs(0.45, 0.55, temporalAlpha)
}

/** Adds a per-segment endpoint pair (LineSegmentsGeometry's interleaved layout). */
function addEndpointPair(geo: LineGeometry, start: string, end: string): void {
  const pairs = new THREE.InstancedInterleavedBuffer(new Float32Array((MAX_ORBIT_POINTS - 1) * 2), 2, 1)
  geo.setAttribute(start, new THREE.InterleavedBufferAttribute(pairs, 1, 0))
  geo.setAttribute(end, new THREE.InterleavedBufferAttribute(pairs, 1, 1))
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * OrbitLine renders the ISS one-period orbit prediction arc as a fat,
 * anti-aliased line whose opacity encodes time: invisible at the trailing
 * edge, dim along the past trail, constant ahead of the station.
 */
export function OrbitLine(): JSX.Element {
  const size = useThree((state) => state.size)
  const orbitLineStyle = useSettingsStore((state) => state.orbitLineStyle)

  // Last refresh stamps — initialized so the first frame always triggers.
  const lastRefreshRef = useRef<number>(-Infinity)
  const lastWallRefreshRef = useRef<number>(-Infinity)

  // ── Geometry — allocated ONCE at max size, then mutated in place ───────────
  const geometry = useMemo(() => {
    const geo = new LineGeometry()
    geo.setPositions(new Float32Array(MAX_ORBIT_POINTS * 3))
    addEndpointPair(geo, 'instanceAlphaStart', 'instanceAlphaEnd')
    // Orbital phase per endpoint, in LineMaterial's dash-distance slots.
    addEndpointPair(geo, 'instanceDistanceStart', 'instanceDistanceEnd')
    geo.instanceCount = 0 // nothing drawn until the first propagation
    return geo
  }, [])

  // ── Material — fat screen-space line + shader dash + per-vertex alpha ──────
  const material = useMemo(createOrbitLineMaterial, [])

  const line = useMemo(() => {
    const l = new Line2(geometry, material)
    // Instanced frustum culling on a regenerated path is not worth the risk.
    l.frustumCulled = false
    return l
  }, [geometry, material])

  // ── Uniform sync — viewport (LineMaterial is screen-space) and style ──────
  useEffect(() => {
    material.resolution.set(size.width, size.height)
  }, [size, material])

  useEffect(() => {
    material.uniforms.orbitDashed.value = orbitLineStyle === 'dashed' ? 1 : 0
  }, [orbitLineStyle, material])

  // ── Cleanup — dispose GPU resources on unmount ─────────────────────────────
  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  // ── Refresh — rewrite the live span of the fat-line buffers ───────────────
  const refreshPath = (path: OrbitPathPoint[]): void => {
    const segmentCount = Math.max(0, Math.min(path.length, MAX_ORBIT_POINTS) - 1)

    // `instanceStart`/`instanceEnd` are an INTERLEAVED SEGMENT-PAIR buffer
    // (stride 6): element k holds start.xyz then end.xyz. Writing a polyline
    // FLAT into it pairs points (0,1), (2,3), … — dropping every other
    // connection (measured: a 229.8 km gap, exactly one polyline step,
    // between consecutive segments). Write the pairs explicitly.
    const positions = (geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data
    const alphas = (geometry.attributes.instanceAlphaStart as THREE.InterleavedBufferAttribute).data
    const phases = (geometry.attributes.instanceDistanceStart as THREE.InterleavedBufferAttribute).data
    const positionArray = positions.array as Float32Array
    const alphaArray = alphas.array as Float32Array
    const phaseArray = phases.array as Float32Array

    for (let k = 0; k < segmentCount; k++) {
      const from = path[k]
      const to = path[k + 1]
      const offset = k * 6
      positionArray[offset] = from.x
      positionArray[offset + 1] = from.y
      positionArray[offset + 2] = from.z
      positionArray[offset + 3] = to.x
      positionArray[offset + 4] = to.y
      positionArray[offset + 5] = to.z
      alphaArray[k * 2] = alphaCurve(from.alpha)
      alphaArray[k * 2 + 1] = alphaCurve(to.alpha)
      phaseArray[k * 2] = from.phase
      phaseArray[k * 2 + 1] = to.phase
    }

    positions.needsUpdate = true
    alphas.needsUpdate = true
    phases.needsUpdate = true
    // Draw only the live segments — the GL buffers keep their max-size
    // allocation, so nothing is orphaned.
    geometry.instanceCount = segmentCount
  }

  // ── Frame loop — throttled path regeneration, nothing else ─────────────────
  useFrame(() => {
    // At most one regeneration per ORBIT_PATH_REFRESH_MS of sim time AND past
    // the wall-time floor. A backward epoch (time-control seek) must
    // regenerate too — the signed comparison would otherwise hold the arc
    // frozen at its pre-seek epoch until sim time climbed back.
    const nowMs = simulationClock.now().epochMs
    const wallMs = performance.now()
    if (wallMs - lastWallRefreshRef.current < ORBIT_PATH_MIN_WALL_MS) return
    const simSinceRefresh = nowMs >= lastRefreshRef.current
      ? nowMs - lastRefreshRef.current
      : Infinity // backward seek → regenerate now
    if (simSinceRefresh < ORBIT_PATH_REFRESH_MS) return
    lastRefreshRef.current = nowMs
    lastWallRefreshRef.current = wallMs
    refreshPath(generateOrbitPath(issEntity.engine, nowMs))
  })

  // Render via primitive — the Line2 object owns the geometry and material
  return <primitive object={line} />
}
