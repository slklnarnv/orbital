// ─── GroundTrack ──────────────────────────────────────────────────────────────
//
// Optional 3D ground track (one orbit of sub-satellite points) and the
// station's visibility footprint, drawn on the globe as thin lines.
//
// Mounted as a child of EarthGroup, so every position is Earth-fixed: an ECEF
// point (x, y, z) in km sits at world-frame child position (x, z, -y) and the
// group's GMST rotation carries it to the right place in the scene.
//
// Depth: the lines hug the surface (R + 2 km), far inside the ~20 km depth
// resolution of the home view, so plain depth testing would z-fight. The
// vertex shader pulls clip-space depth toward the camera by a constant NDC
// amount (see groundTrackDepth.ts) — the world-space pull grows with the
// square of the distance, so the track wins against the globe at every zoom
// while the limb still hides the far side and the station still occludes it.
//
// Colours stay <= 1.0 so the track never crosses the bloom threshold.

import type { JSX } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { computeGMST } from '@/core/clock/SimulationTime'
import { simulationClock } from '@/core/clock/SimulationClock'
import { issEntity } from '@/core/entities/ISSEntity'
import { temeToECEF } from '@/core/orbital/CoordinateConversions'
import { writeFootprintRing } from '@/core/orbital/Footprint'
import { sampleGroundTrack } from '@/core/orbital/GroundTrack'
import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { EARTH_RADIUS_KM, ISS_ORBITAL_PERIOD_MIN, UNIX_EPOCH_JULIAN } from '@/utils/constants'
import { GROUND_TRACK_DEPTH_BIAS_NDC } from './groundTrackDepth'

// ─── Constants ────────────────────────────────────────────────────────────────

/** The HUD glint's light blue. */
const TRACK_COLOR = 0xa8d8ff

/** Lines sit just above the surface; the depth bias does the real work. */
const TRACK_RADIUS_KM = EARTH_RADIUS_KM + 2

const MAX_TRACK_POINTS = 256
const TRACK_STEP_MS = 30_000
/** Sim-ms the track may drift from its sampling centre before it is rebuilt. */
const TRACK_REFRESH_MS = 60_000

const FOOTPRINT_SEGMENTS = 64
const FOOTPRINT_ALPHA = 0.35
const PAST_ALPHA = 0.22
const FUTURE_ALPHA = 0.6

const VERTEX_SHADER = /* glsl */ `
  attribute float alpha;
  uniform float uDepthBiasNdc;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Constant NDC pull toward the camera (see groundTrackDepth.ts): the
    // surface-hugging track wins against the globe at every zoom while the
    // limb and the station still occlude it.
    clip.z -= uDepthBiasNdc * clip.w;
    gl_Position = clip;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Earth-fixed ECEF (x, y, z) -> EarthGroup-child position (x, z, -y). */
function writeWorldPosition(out: Float32Array, index: number, x: number, y: number, z: number, scale: number): void {
  out[index * 3] = x * scale
  out[index * 3 + 1] = z * scale
  out[index * 3 + 2] = -y * scale
}

function makeLineGeometry(maxPoints: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3))
  geometry.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(maxPoints), 1))
  geometry.setDrawRange(0, 0)
  return geometry
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Ground track and footprint lines. Rendered only while the "Ground track"
 * setting is on (EarthGroup gates the mount), and disposed on unmount.
 */
export function GroundTrack(): JSX.Element {
  const lastCenterMsRef = useRef<number>(Number.NaN)
  const lastTleLineRef = useRef<string | null>(null)
  const lastFootprintStampRef = useRef<number>(Number.NaN)

  const { trackLine, footprintLine, trackGeometry, footprintGeometry, material } = useMemo(() => {
    const trackGeometry = makeLineGeometry(MAX_TRACK_POINTS)
    const footprintGeometry = makeLineGeometry(FOOTPRINT_SEGMENTS + 1)
    const footprintAlpha = footprintGeometry.getAttribute('alpha') as THREE.BufferAttribute
    ;(footprintAlpha.array as Float32Array).fill(FOOTPRINT_ALPHA)

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: new THREE.Color(TRACK_COLOR) },
        uDepthBiasNdc: { value: GROUND_TRACK_DEPTH_BIAS_NDC },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    })

    const trackLine = new THREE.Line(trackGeometry, material)
    const footprintLine = new THREE.Line(footprintGeometry, material)
    for (const line of [trackLine, footprintLine]) {
      // The buffers are rewritten in place; culling against a stale bound is
      // not worth the risk.
      line.frustumCulled = false
      line.renderOrder = 2
    }
    return { trackLine, footprintLine, trackGeometry, footprintGeometry, material }
  }, [])

  useEffect(() => {
    return () => {
      trackGeometry.dispose()
      footprintGeometry.dispose()
      material.dispose()
    }
  }, [trackGeometry, footprintGeometry, material])

  const footprintScratch = useMemo(() => new Float32Array((FOOTPRINT_SEGMENTS + 1) * 3), [])

  useFrame(() => {
    const simNow = simulationClock.now().epochMs

    // ── Track: rebuild on first use, a new TLE, or a >= 60 s sim-time drift
    //    (the signed distance covers seeks in both directions).
    const tleLine = issEntity.currentTLE?.line1 ?? null
    const needsTrack =
      Number.isNaN(lastCenterMsRef.current) ||
      tleLine !== lastTleLineRef.current ||
      Math.abs(simNow - lastCenterMsRef.current) >= TRACK_REFRESH_MS
    if (needsTrack) {
      lastCenterMsRef.current = simNow
      lastTleLineRef.current = tleLine
      const periodMs = (issEntity.engine.periodMinutes ?? ISS_ORBITAL_PERIOD_MIN) * 60_000
      const points = sampleGroundTrack(issEntity.engine, simNow, {
        pastMs: periodMs / 2,
        futureMs: periodMs / 2,
        stepMs: TRACK_STEP_MS,
      })
      const count = Math.min(points.length, MAX_TRACK_POINTS)
      const positions = trackGeometry.getAttribute('position') as THREE.BufferAttribute
      const alphas = trackGeometry.getAttribute('alpha') as THREE.BufferAttribute
      const positionArray = positions.array as Float32Array
      const alphaArray = alphas.array as Float32Array
      for (let i = 0; i < count; i++) {
        const p = points[i]
        const norm = Math.hypot(p.ecef.x, p.ecef.y, p.ecef.z)
        const scale = norm > 0 ? TRACK_RADIUS_KM / norm : 0
        writeWorldPosition(positionArray, i, p.ecef.x, p.ecef.y, p.ecef.z, scale)
        alphaArray[i] = p.epochMs < simNow ? PAST_ALPHA : FUTURE_ALPHA
      }
      positions.needsUpdate = true
      alphas.needsUpdate = true
      trackGeometry.setDrawRange(0, count)
    }

    // ── Footprint: follow the 10 Hz telemetry snapshot, only when it changes.
    const state = telemetryManager.lastState
    if (state && state.timestamp !== lastFootprintStampRef.current) {
      lastFootprintStampRef.current = state.timestamp
      const gmst = computeGMST(state.timestamp / 86_400_000 + UNIX_EPOCH_JULIAN)
      const ecef = temeToECEF(state.positionECI, gmst)
      writeFootprintRing(ecef, EARTH_RADIUS_KM, TRACK_RADIUS_KM, FOOTPRINT_SEGMENTS, footprintScratch)
      const positions = footprintGeometry.getAttribute('position') as THREE.BufferAttribute
      const positionArray = positions.array as Float32Array
      for (let i = 0; i <= FOOTPRINT_SEGMENTS; i++) {
        // The ring is already Earth-fixed (x, y, z) at the target radius.
        writeWorldPosition(
          positionArray, i,
          footprintScratch[i * 3], footprintScratch[i * 3 + 1], footprintScratch[i * 3 + 2], 1,
        )
      }
      positions.needsUpdate = true
      footprintGeometry.setDrawRange(0, FOOTPRINT_SEGMENTS + 1)
    }
  })

  return (
    <>
      <primitive object={trackLine} />
      <primitive object={footprintLine} />
    </>
  )
}
