// ─── OrbitLine ────────────────────────────────────────────────────────────────
//
// Renders the ISS one-period orbit prediction arc as a fading polyline.
//
// Design (deliberately boring — this component was rewritten after an earlier
// version grew a custom tick-mask shader, arc-length re-subdivision with
// hysteresis, and a frame-order bug that meant the arc never rendered at all):
//   - Line2 "fat line" (three/examples/jsm/lines) — a proper ~2 px
//     anti-aliased stroke instead of the unfixable 1 px WebGL hairline.
//   - The dash is LineMaterial's OWN (USE_DASH compiled in permanently). The
//     Dashed/Continuous setting only moves dashSize/gapSize, so switching
//     styles never recompiles the program. Continuous = one dash spanning the
//     whole arc. Both sizes are recomputed every frame from the camera
//     geometry, which keeps the on-screen pitch constant while zooming.
//   - Per-point opacity via a custom instanced `instanceAlphaStart/End`
//     attribute injected into LineMaterial with onBeforeCompile (LineMaterial
//     has no per-vertex alpha of its own; the injection mirrors the built-in
//     instanceColorStart/End pattern). The fade curve is evaluated on the CPU
//     at each refresh:
//       past trail (alpha 0 → 0.5):  fades 0 → 0.30
//       future arc (0.5 → 1.0):      held at 0.60
//   - Path generation runs at most once per ORBIT_PATH_REFRESH_MS of sim time
//     AND past a 250 ms wall-time floor (backwards seeks regenerate; 300×
//     cannot spend every frame on ~185 SGP4 propagations). The refresh runs
//     FIRST in the frame loop — before anything early-returns on "no arc yet"
//     — because gating the refresh on the arc it produces is a bootstrap
//     deadlock (the bug that left this line permanently invisible).
//   - Both vertex buffers are allocated ONCE at MAX_ORBIT_POINTS and mutated
//     in place — the refresh path allocates nothing and never replaces an
//     attribute. LineGeometry.setPositions() REPLACES its instance buffers
//     wholesale, and three frees a replaced attribute's GL buffer only via
//     WebGLAttributes.remove, which the renderer reaches from
//     onGeometryDispose for the geometry's CURRENT attributes alone. Calling
//     setPositions per refresh therefore orphans two VBOs every refresh
//     (~4/s at the wall floor) — invisible in the frame rate, unbounded in
//     GPU memory.
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
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

import { simulationClock } from '@/core/clock/SimulationClock'
import { issEntity } from '@/core/entities/ISSEntity'
import { generateOrbitPath } from '@/core/orbital/OrbitPredictor'
import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { useSettingsStore } from '@/stores/settingsStore'
import { ORBIT_PATH_REFRESH_MS } from '@/utils/constants'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of points in the prediction arc (185 at a 30 s step). */
const MAX_ORBIT_POINTS = 220

/** Wall-time floor between path regenerations (sim-throttle complement). */
const ORBIT_PATH_MIN_WALL_MS = 250

/** ISS orbital track color — pale cornflower blue (#93C5FD). */
const ORBIT_COLOR = 0x93c5fd

/** Screen-space stroke width in pixels. */
const LINE_WIDTH_PX = 2.0

/** Dash + gap pitch in SCREEN pixels (dashed style only). */
const DASH_SCREEN_PX = 7
const GAP_SCREEN_PX = 6

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

/** Frame-loop scratch for the station's world position (TEME (x,y,z) → world (x,z,−y)). */
const _liveWorldPos = new THREE.Vector3()

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
  /** Cumulative arc length of the live polyline, in km (set by refreshPath). */
  const totalArcRef = useRef(0)

  // ── Geometry — allocated ONCE at max size, then mutated in place ───────────
  const geometry = useMemo(() => {
    const geo = new LineGeometry()
    geo.setPositions(new Float32Array(MAX_ORBIT_POINTS * 3))

    // Per-SEGMENT endpoint alphas (instanced pairs), mirroring
    // LineSegmentsGeometry's instanceColor interleaved-buffer layout.
    const alphaPairs = new THREE.InstancedInterleavedBuffer(
      new Float32Array((MAX_ORBIT_POINTS - 1) * 2),
      2,
      1,
    )
    geo.setAttribute('instanceAlphaStart', new THREE.InterleavedBufferAttribute(alphaPairs, 1, 0))
    geo.setAttribute('instanceAlphaEnd', new THREE.InterleavedBufferAttribute(alphaPairs, 1, 1))

    // Cumulative arc length per segment endpoint, in world units — LineMaterial
    // reads these (instanceDistanceStart/End) to place its dash pattern. Built
    // here rather than via LineSegmentsGeometry.computeLineDistances(), which
    // allocates a fresh InstancedInterleavedBuffer (the same leak the
    // setPositions note above describes).
    const distances = new THREE.InstancedInterleavedBuffer(
      new Float32Array((MAX_ORBIT_POINTS - 1) * 2),
      2,
      1,
    )
    geo.setAttribute('instanceDistanceStart', new THREE.InterleavedBufferAttribute(distances, 1, 0))
    geo.setAttribute('instanceDistanceEnd', new THREE.InterleavedBufferAttribute(distances, 1, 1))
    geo.instanceCount = 0 // nothing drawn until the first propagation
    return geo
  }, [])

  // ── Material — fat screen-space line + injected per-vertex alpha ───────────
  const material = useMemo(() => {
    const mat = new LineMaterial({
      color: ORBIT_COLOR,
      linewidth: LINE_WIDTH_PX,
      transparent: true,
      depthWrite: false, // Don't occlude ISS model or atmosphere shell
      depthTest: true,   // Line is hidden where Earth blocks it (physically correct)
      blending: THREE.NormalBlending,
      // USE_DASH is compiled in permanently; the style toggle only moves
      // dashSize/gapSize (see the frame loop), so switching never recompiles.
      dashed: true,
    })

    // LineMaterial has no per-vertex alpha; inject one, mirroring the built-in
    // instanceColorStart/End attribute pattern (endpoint selected by the
    // unit-box `position.y` sign). Anchor strings verified against the
    // installed three r170 LineMaterial sources.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          'attribute vec3 instanceEnd;',
          [
            'attribute vec3 instanceEnd;',
            'attribute float instanceAlphaStart;',
            'attribute float instanceAlphaEnd;',
            'varying float vInstanceAlpha;',
          ].join('\n'),
        )
        .replace(
          'float aspect = resolution.x / resolution.y;',
          [
            'vInstanceAlpha = ( position.y < 0.5 ) ? instanceAlphaStart : instanceAlphaEnd;',
            'float aspect = resolution.x / resolution.y;',
          ].join('\n'),
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'varying float vLineDistance;',
          ['varying float vLineDistance;', 'varying float vInstanceAlpha;'].join('\n'),
        )
        .replace(
          'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
          'gl_FragColor = vec4( diffuseColor.rgb, alpha * vInstanceAlpha );',
        )
    }
    return mat
  }, [])

  const line = useMemo(() => {
    const l = new Line2(geometry, material)
    // Instanced frustum culling on a regenerated path is not worth the risk.
    l.frustumCulled = false
    return l
  }, [geometry, material])

  // ── Resolution sync — LineMaterial is screen-space and needs the viewport ──
  useEffect(() => {
    material.resolution.set(size.width, size.height)
  }, [size, material])

  // ── Cleanup — dispose GPU resources on unmount ─────────────────────────────
  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  // ── Refresh — rewrite the live span of the fat-line buffers ───────────────
  const refreshPath = (path: Array<{ x: number; y: number; z: number; alpha: number }>): void => {
    const count = Math.min(path.length, MAX_ORBIT_POINTS)
    const segmentCount = Math.max(0, count - 1)

    // `instanceStart`/`instanceEnd` are an INTERLEAVED SEGMENT-PAIR buffer
    // (stride 6): element k holds start.xyz then end.xyz. LineGeometry builds
    // it that way from a polyline; writing a polyline FLAT into it pairs
    // points (0,1), (2,3), … — dropping every other connection and rendering
    // a dashed line (measured: a 229.8 km gap, exactly one polyline step,
    // between consecutive segments). Write the pairs explicitly.
    const positions = (geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data
    const alphas = (geometry.attributes.instanceAlphaStart as THREE.InterleavedBufferAttribute).data
    const distances = (geometry.attributes.instanceDistanceStart as THREE.InterleavedBufferAttribute).data
    const positionArray = positions.array as Float32Array
    const alphaArray = alphas.array as Float32Array
    const distanceArray = distances.array as Float32Array

    // Cumulative arc length to each endpoint, in world units — the dash
    // pattern LineMaterial applies is keyed on this.
    let arc = 0
    for (let k = 0; k < segmentCount; k++) {
      const offset = k * 6
      const from = path[k]
      const to = path[k + 1]
      positionArray[offset] = from.x
      positionArray[offset + 1] = from.y
      positionArray[offset + 2] = from.z
      positionArray[offset + 3] = to.x
      positionArray[offset + 4] = to.y
      positionArray[offset + 5] = to.z

      distanceArray[k * 2] = arc
      arc += Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
      distanceArray[k * 2 + 1] = arc

      alphaArray[k * 2] = alphaCurve(from.alpha)
      alphaArray[k * 2 + 1] = alphaCurve(to.alpha)
    }

    positions.needsUpdate = true
    alphas.needsUpdate = true
    distances.needsUpdate = true
    // The dash sizing reads this total every frame.
    totalArcRef.current = arc
    // Draw only the live segments — the GL buffers stay at their max-size
    // allocation, so their identity (and three's WebGLAttributes entry) never
    // changes and nothing is orphaned.
    geometry.instanceCount = segmentCount
  }

  // ── Frame loop — refresh FIRST, then dash sizing ───────────────────────────
  useFrame((state) => {
    const simTime = simulationClock.now()
    const nowMs = simTime.epochMs

    // 1. Path regeneration, throttled. At most one regeneration per
    //    ORBIT_PATH_REFRESH_MS of sim time AND past the wall-time floor. A
    //    backward epoch (time-control seek) must regenerate too — the signed
    //    comparison would otherwise hold the arc frozen at its pre-seek epoch
    //    until sim time climbed back. This MUST come before any early return:
    //    gating it on state only a successful refresh produces (a nonzero
    //    arc) starves the first refresh forever.
    const wallMs = performance.now()
    if (wallMs - lastWallRefreshRef.current >= ORBIT_PATH_MIN_WALL_MS) {
      const simSinceRefresh = nowMs >= lastRefreshRef.current
        ? nowMs - lastRefreshRef.current
        : Infinity // backward seek → regenerate now
      if (simSinceRefresh >= ORBIT_PATH_REFRESH_MS) {
        lastRefreshRef.current = nowMs
        lastWallRefreshRef.current = wallMs
        refreshPath(generateOrbitPath(issEntity.engine, nowMs))
      }
    }

    // 2. Dash sizing, every frame. The pattern lives in WORLD units, so its
    //    on-screen pitch holds only if dashSize/gapSize track the camera
    //    geometry. The scale reference is the STATION, not Earth's centre:
    //    the near half of the arc (the part you actually look at) sits at the
    //    station's depth, and measuring to Earth's centre would stretch the
    //    ticks ~20× in Follow mode, where the camera is 70–350 km out.
    const totalArc = totalArcRef.current
    if (totalArc <= 0) return

    const halfFovRad = (state.camera as THREE.PerspectiveCamera).getEffectiveFOV() * Math.PI / 360
    // Depth reference from the latest 10 Hz snapshot (≤100 ms old → <0.1%
    // pitch error), not a fresh SGP4 propagation every frame.
    const liveState = telemetryManager.lastState
    const referenceDepthKm = liveState
      ? state.camera.position.distanceTo(_liveWorldPos.set(
          liveState.positionECI.x, liveState.positionECI.z, -liveState.positionECI.y,
        ))
      : state.camera.position.length()

    const worldPerPx =
      (2 * Math.tan(halfFovRad) * referenceDepthKm) / Math.max(1, state.size.height)

    if (orbitLineStyle === 'dashed') {
      material.uniforms.dashSize.value = DASH_SCREEN_PX * worldPerPx
      material.uniforms.gapSize.value = GAP_SCREEN_PX * worldPerPx
    } else {
      // One dash covering the whole arc: mod(vLineDistance, dash + gap) can
      // never leave [0, totalArc), so every fragment survives the dash test.
      material.uniforms.dashSize.value = totalArc
      material.uniforms.gapSize.value = 0
    }
  })

  // Render via primitive — the Line2 object owns the geometry and material
  return <primitive object={line} />
}
