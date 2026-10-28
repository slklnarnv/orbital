import type { JSX } from 'react'
import React, { Suspense, useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { SUN_LIGHT_DISTANCE, SUN_LIGHT_NAME } from '../iss/stationShadow'
import { SUN_BILLBOARD_DISTANCE_KM } from '@/utils/constants'
import sunVert from '../shaders/sun.vert'
import sunFrag from '../shaders/sun.frag'
import { SunGlare } from './SunGlare'
import { SkyLayer } from './SkyLayer'
import { MoonLayer } from './MoonLayer'
import { DARK_SKY_EXPOSURE, SUN_EXPOSURE_DROP } from './sunGlareConfig'

// ─── Hoisted Static Vectors for Zero-GC Frame Loop ───────────────────────────
// Reused every frame inside useFrame; never re-allocated after module init.
const _sunDirVec = new THREE.Vector3()
const _cameraDir = new THREE.Vector3()
const _sunPoint = new THREE.Vector3()

/**
 * EnvironmentLayer manages the sun (light, billboard, glare), the sky and the Moon.
 *
 * It uses the SimulationClock to compute the precise relative position of the Sun
 * relative to the Earth (0,0,0) and positions a bright DirectionalLight accordingly.
 */
export const EnvironmentLayer = React.memo(function EnvironmentLayer(): JSX.Element {
  const { gl } = useThree()
  const sunLightRef = useRef<THREE.DirectionalLight>(null)
  const sunMeshRef = useRef<THREE.Mesh>(null)

  // The camera point-spread function around the sun: the billboard's core
  // uniforms, the screen-space halo overlay and the occlusion probe.
  const glare = useMemo(() => new SunGlare(), [])
  useEffect(() => () => glare.dispose(), [glare])

  useFrame((state, delta) => {
    if (!sunLightRef.current) return
    const simTime = simulationClock.now()
    const sunDir = sunDirectionWorld(simTime.julianDate)

    // Reuse hoisted vector — zero GC allocation
    _sunDirVec.set(sunDir.x, sunDir.y, sunDir.z).normalize()

    // A directional light shines along position → target, so only the
    // direction matters for lighting. The light follows its target along the
    // sun direction: the ISS aims the target at the station for its cached
    // self-shadow (stationShadow.ts); otherwise the target stays at Earth's
    // centre. Either way the light direction is the sun direction.
    const light = sunLightRef.current
    light.position.copy(light.target.position).addScaledVector(_sunDirVec, SUN_LIGHT_DISTANCE)

    // The sun billboard's point along the sun direction. The lens flare, the
    // glare overlay and the atmosphere's sunrise band all aim at this same point.
    _sunPoint.set(sunDir.x, sunDir.y, sunDir.z).multiplyScalar(SUN_BILLBOARD_DISTANCE_KM)

    // Position and orient the procedural sun billboard
    if (sunMeshRef.current) {
      sunMeshRef.current.position.copy(_sunPoint)
      sunMeshRef.current.lookAt(state.camera.position)

      // Dynamically scale the sun billboard to maintain a constant apparent angular size.
      // Without this, zooming out to maxDistance makes the billboard resolve
      // into a visible finite-size plane instead of looking like a distant point source.
      //
      // Angular budget: billboard = 0.185 rad (~10.6°). The shader's disc edge
      // sits at d ≈ 0.031 of UV space → ~0.66° visible disc (the real solar disc
      // is 0.53°), with the haze dying out by ~3.5°. The extra quad width is
      // what lets the shader carry the WHOLE halo: at the old 0.078 rad the
      // billboard's axis edge sat at ~2.2°, so anything wider had to come from
      // the bloom pass — which turned the compact core into a square. See
      // sun.frag; PLANE_FULL_RAD there must track this number.
      const camToSun = state.camera.position.distanceTo(sunMeshRef.current.position)
      const targetAngularSize = 0.185 // radians — ~0.66° disc + ~3.5° haze
      const dynamicScale = camToSun * targetAngularSize
      sunMeshRef.current.scale.setScalar(dynamicScale / 110000) // normalize against the base 110K geometry
    }

    // ─── Dynamic Camera-Solar Exposure Adaptation ─────────────────────────────
    // Calculate the camera forward vector alignment relative to the Sun
    // Reuse hoisted vector — zero GC allocation
    state.camera.getWorldDirection(_cameraDir)
    const cameraSunDot = _cameraDir.dot(_sunDirVec) // -1.0 (looking away) to 1.0 (looking at sun)

    // Blinding sun adjusts exposure down to 0.75; dark space boosts it up to 1.05.
    // Only a sun that is actually seen counts: behind the Earth or the
    // station it no longer stops the camera down (SunGlare.measure).
    const sunVisibility = glare.measure(state.camera, _sunPoint, delta)
    const sunAlignment = Math.max(0.0, cameraSunDot)
    const targetExposure = DARK_SKY_EXPOSURE - SUN_EXPOSURE_DROP * Math.pow(sunAlignment, 2.0) * sunVisibility

    // Smoothly interpolate the renderer's exposure using dynamic temporal damping
    gl.toneMappingExposure = THREE.MathUtils.damp(gl.toneMappingExposure, targetExposure, 4.0, delta)

    // Scale the glare by the exposure just chosen and aim the overlay/probe.
    glare.apply(state.camera as THREE.PerspectiveCamera, _sunPoint, gl.toneMappingExposure)
  })

  // Uniforms go in through the constructor, which keeps this object by
  // reference: R3F 9 copies a `uniforms` prop into new uniform objects, so
  // later writes to ours never reached the GPU (the black Earth, 2026-10-28).
  // Memoized: R3F rebuilds the material whenever `args` changes identity.
  const materialArgs = useMemo<[THREE.ShaderMaterialParameters]>(() => [{ uniforms: glare.billboardUniforms }], [glare])

  return (
    <>
      {/* Ambient background illumination so completely shadowed areas are slightly visible */}
      <ambientLight intensity={0.02} />

      {/* Primary directional light source representing the Sun */}
      <directionalLight
        ref={sunLightRef}
        name={SUN_LIGHT_NAME}
        intensity={1.9}         // Slightly lifted to keep the smaller sun disc dominant
        color="#fff3e2"          // Warm solar white — warms further via the terminator shading
      />

      {/* ─── Procedural Cinematic Solar Presence ─── */}
      {/* renderOrder=2: renders LAST in the transparent pass, ensuring the sun's
          AdditiveBlending composites on top of stars and starmap, never behind them.
          depthTest=true: the opaque Earth writes to the depth buffer and correctly
          occludes the sun when it's behind the planet. Stars and starmap all have
          depthWrite=false, so they can never occlude the sun via depth testing —
          the renderOrder alone handles their compositing sequence. */}
      <mesh ref={sunMeshRef} renderOrder={2}>
        <planeGeometry args={[110000, 110000]} />
        <shaderMaterial
          vertexShader={sunVert}
          fragmentShader={sunFrag}
          args={materialArgs}
          transparent={true}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          depthTest={true}
        />
      </mesh>

      {/* ─── Sun glare: the halo, and the occlusion probe ───
          The overlay (renderOrder 3) has no depth test: lens glare lies over
          everything in the frame. The probe draws no colour; an occlusion
          query on it tells the glare when the station hides the sun.
          SunGlare owns and disposes both (dispose={null}). */}
      <primitive object={glare.overlay} dispose={null} />
      <primitive object={glare.probeMesh} dispose={null} />

      {/* ─── The sky: Milky Way + catalogue stars (render orders 0 and 1) ─── */}
      <SkyLayer />

      {/* ─── The Moon: opaque, hides the stars behind it; its map loads on
          its own so it never holds up first paint ─── */}
      <Suspense fallback={null}>
        <MoonLayer />
      </Suspense>
    </>
  )
})
