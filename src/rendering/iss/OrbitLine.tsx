// ─── OrbitLine ────────────────────────────────────────────────────────────────
//
// Renders the ISS one-period orbit prediction arc as a fading polyline.
//
// Architecture:
//   - BufferGeometry is created ONCE with a pre-allocated Float32Array max-size.
//   - In-place attribute updates are applied via needsUpdate — no geometry disposal.
//   - Path generation runs at most once per ORBIT_PATH_REFRESH_MS (60 s).
//   - ZERO React state mutations inside useFrame — strictly refs + buffer writes.
//
// Coordinate system:
//   OrbitPredictor uses temeToWorld() internally, so points arrive already
//   converted to Three.js world space (Y-up, km units). No further conversion needed.
//
// Visual encoding:
//   alpha = 0.0  → trailing edge (past orbit)  → nearly transparent
//   alpha = 1.0  → leading edge (future arc)   → full brightness
//   Shader applies cubic ease-in for natural luminosity falloff.

import { useMemo, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { simulationClock } from '@/core/clock/SimulationClock'
import { issEntity } from '@/core/entities/ISSEntity'
import { generateOrbitPath } from '@/core/orbital/OrbitPredictor'
import { ORBIT_PATH_REFRESH_MS } from '@/utils/constants'

import orbitLineVert from '@/rendering/shaders/orbitLine.vert'
import orbitLineFrag from '@/rendering/shaders/orbitLine.frag'

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of points in the pre-allocated buffer.
 * ISS period ≈ 92.68 min at 30 s steps → ~185 points per period.
 * 220 gives a safe headroom margin.
 */
const MAX_ORBIT_POINTS = 220

/** ISS orbital track color — pale cornflower blue (#93C5FD) */
const ORBIT_COLOR = new THREE.Color(0x93c5fd)

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * OrbitLine renders the ISS one-period orbit prediction arc.
 *
 * Wraps a THREE.Line with a custom ShaderMaterial so per-vertex alpha
 * can drive the trail→future fade effect without postprocessing.
 */
export function OrbitLine(): JSX.Element {
  // Track last refresh epoch — initialized to -Infinity so first frame always triggers
  const lastRefreshRef = useRef<number>(-Infinity)

  // ── Geometry — pre-allocated, mutated in place ─────────────────────────────
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()

    // Pre-allocate max-size buffers — avoids GPU buffer reallocation on every update
    const posArray   = new Float32Array(MAX_ORBIT_POINTS * 3)
    const alphaArray = new Float32Array(MAX_ORBIT_POINTS)

    geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
    geo.setAttribute('alpha',    new THREE.BufferAttribute(alphaArray, 1))

    // Start with zero visible points — line is invisible until first propagation
    geo.setDrawRange(0, 0)

    return geo
  }, [])

  // ── Material — custom shader for per-vertex alpha fade ─────────────────────
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   orbitLineVert,
    fragmentShader: orbitLineFrag,
    uniforms: {
      orbitColor: { value: ORBIT_COLOR },
    },
    transparent:  true,
    depthWrite:   false,              // Don't occlude ISS model or atmosphere shell
    depthTest:    true,               // Line is hidden where Earth blocks it (physically correct)
    blending:     THREE.NormalBlending,  // Grounded in 3D — not a holographic overlay
  }), [])


  // ── THREE.Line object — created once ───────────────────────────────────────
  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material])

  // ── Cleanup — dispose GPU resources on unmount ─────────────────────────────
  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  // ── Per-frame throttled path update ───────────────────────────────────────
  useFrame(() => {
    const simTime = simulationClock.now()
    const nowMs   = simTime.epochMs

    // Throttle: only regenerate the path once per ORBIT_PATH_REFRESH_MS
    if (nowMs - lastRefreshRef.current < ORBIT_PATH_REFRESH_MS) return
    lastRefreshRef.current = nowMs

    // Generate the prediction path in Three.js world space (TEME→world applied inside)
    const path  = generateOrbitPath(issEntity.engine, nowMs)
    const count = Math.min(path.length, MAX_ORBIT_POINTS)

    // ── In-place attribute mutation — no geometry disposal needed ─────────────
    const positions = geometry.attributes.position as THREE.BufferAttribute
    const alphas    = geometry.attributes.alpha    as THREE.BufferAttribute

    for (let i = 0; i < count; i++) {
      const pt = path[i]
      positions.setXYZ(i, pt.x, pt.y, pt.z)
      alphas.setX(i, pt.alpha)
    }

    positions.needsUpdate = true
    alphas.needsUpdate    = true

    // Restrict draw to the actual point count — no garbage vertices rendered
    geometry.setDrawRange(0, count)
  })

  // Render via primitive — Three.js Line object owns the geometry and material
  return <primitive object={line} />
}
