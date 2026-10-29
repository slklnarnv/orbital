import type { JSX } from 'react'
import React, { useEffect, useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { cloudRotationAtEpoch, liveCloudRotation } from './CloudMotion'
import type { LiveClouds } from './liveClouds'
import { useEarthDetailUpgrade } from './useEarthDetailUpgrade'
import { GibsDetailStream } from './GibsDetailStream'
import { DAY_LAYER, DETAIL_LEVELS, NIGHT_LAYER } from './surfaceDetail'
import { useSettingsStore } from '@/stores/settingsStore'
import { EARTH_RADIUS, EARTH_SPHERE_SEGMENTS, EARTH_TEXTURES } from './EarthConstants'
import vertexShader from '../shaders/earthSurface.vert'
import fragmentShader from '../shaders/earthSurface.frag'

// ─── Preload 4K Earth Textures at Module Scope ────────────────────────────────
// Pre-warms the runtime-sized 4K maps via Drei's preload system, which
// integrates with DefaultLoadingManager and is covered by the loading gate.
useTexture.preload(EARTH_TEXTURES.dayMap)
useTexture.preload(EARTH_TEXTURES.nightMap)
useTexture.preload(EARTH_TEXTURES.specularMap)
useTexture.preload(EARTH_TEXTURES.cloudMap)

// Close-range imagery: at most one tile upload per frame across all streams.
const DETAIL_UPLOADS_PER_FRAME = 1
// Sun elevation (sine) at the inset centre that splits day from night
// streaming, with an overlap across the terminator where both show.
const DAY_STREAM_MIN_SUN = -0.2
const NIGHT_STREAM_MAX_SUN = 0.2

const _viewDir = new THREE.Vector3()
const _hit = new THREE.Vector3()
const _local = new THREE.Vector3()

/**
 * Where the close-range inset centres: the ground point at the middle of the
 * view, or the point under the camera when the view misses the Earth. In the
 * sphere's own texture coordinates (three's SphereGeometry UVs), so the
 * shader and the tiles agree without any longitude convention.
 */
function insetCenterUv(camera: THREE.Camera, earth: THREE.Object3D): { u: number; v: number } {
  camera.getWorldDirection(_viewDir)
  const o = camera.position
  const b = o.dot(_viewDir)
  const disc = b * b - (o.lengthSq() - EARTH_RADIUS * EARTH_RADIUS)
  if (disc >= 0 && -b - Math.sqrt(disc) > 0) _hit.copy(o).addScaledVector(_viewDir, -b - Math.sqrt(disc))
  else _hit.copy(o).setLength(EARTH_RADIUS)
  earth.worldToLocal(_local.copy(_hit))
  // SphereGeometry: x = −cos(2πu)·sinθ, z = sin(2πu)·sinθ, y = cosθ, v = 1 − θ/π.
  const phi = Math.atan2(_local.z, -_local.x)
  const u = phi / (2 * Math.PI)
  return { u: u - Math.floor(u), v: 1 - Math.acos(THREE.MathUtils.clamp(_local.y / _local.length(), -1, 1)) / Math.PI }
}

/** Helper to apply optimal visual and GPU rendering parameters on loaded textures */
const configureTexture = (texture: THREE.Texture, isSRGB: boolean, maxAnisotropy: number) => {
  texture.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.RepeatWrapping
  // Equirectangular maps wrap at the date line, never between opposite poles.
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = maxAnisotropy
  texture.generateMipmaps = true
  texture.needsUpdate = true
}

/**
 * EarthSurface renders the solid terrain shell of the Earth.
 *
 * It binds a custom ShaderMaterial that blends day and night textures
 * based on the Sun's dynamic angle, computing ocean specular highlights
 * on the dayside.
 */
export const EarthSurface = React.memo(function EarthSurface({ clouds }: { clouds: LiveClouds }): JSX.Element {
  const { gl } = useThree()
  const meshRef = useRef<THREE.Mesh>(null)

  // Load high-resolution day, night, and specular maps directly (blocks Suspense)
  const earthTextures = useTexture({
    day: EARTH_TEXTURES.dayMap,
    night: EARTH_TEXTURES.nightMap,
    specular: EARTH_TEXTURES.specularMap,
    clouds: EARTH_TEXTURES.cloudMap,
  })

  // Initialize uniforms
  const uniformsRef = useRef({
    dayMap: { value: null as THREE.Texture | null },
    nightMap: { value: null as THREE.Texture | null },
    specularMap: { value: null as THREE.Texture | null },
    cloudMap: { value: null as THREE.Texture | null },
    cloudTexelSize: { value: new THREE.Vector2(1 / 4096, 1 / 2048) },
    cloudRotation: { value: 0 },
    cloudMapB: { value: null as THREE.Texture | null },
    cloudOffsetB: { value: 0 },
    cloudBlend: { value: 0 },
    sunDirection: { value: new THREE.Vector3(0, 0, 1) },
    nightIntensity: { value: 4.2 },
  })

  // NASA GIBS close-range imagery (roadmap D.8), one ring buffer per level;
  // their uniforms join the surface material's by reference.
  const detail = useMemo(() => DETAIL_LEVELS.map((level) => new GibsDetailStream(level, DAY_LAYER)), [])
  const nightDetail = useMemo(() => DETAIL_LEVELS.map((level) => new GibsDetailStream(level, NIGHT_LAYER)), [])
  useEffect(() => () => [...detail, ...nightDetail].forEach((stream) => stream.dispose()), [detail, nightDetail])
  const surfaceImagery = useSettingsStore((state) => state.surfaceImagery)
  const saveData = useMemo(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    return connection?.saveData === true
  }, [])
  const uniforms = useMemo(() => {
    const all: Record<string, THREE.IUniform> = { ...uniformsRef.current }
    detail.forEach((stream, i) => {
      all[`detailMap${i}`] = stream.uniforms.map
      all[`detailWindow${i}`] = stream.uniforms.window
      all[`detailCenter${i}`] = stream.uniforms.center
      all[`detailSlots${i}`] = stream.uniforms.slots
      all[`detailOn${i}`] = stream.uniforms.on
    })
    nightDetail.forEach((stream, i) => {
      all[`detailNightMap${i}`] = stream.uniforms.map
      all[`detailNightWindow${i}`] = stream.uniforms.window
      all[`detailNightCenter${i}`] = stream.uniforms.center
      all[`detailNightSlots${i}`] = stream.uniforms.slots
      all[`detailNightOn${i}`] = stream.uniforms.on
    })
    return all
  }, [detail, nightDetail])

  // Configure and assign the high-res textures once they are loaded
  useEffect(() => {
    if (!earthTextures.day || !earthTextures.night || !earthTextures.specular || !earthTextures.clouds) return
    const maxAnisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())

    configureTexture(earthTextures.day, true, maxAnisotropy)
    configureTexture(earthTextures.night, true, maxAnisotropy)
    configureTexture(earthTextures.specular, false, maxAnisotropy) // Non-sRGB specular mask
    configureTexture(earthTextures.clouds, false, maxAnisotropy) // Linear cloud-density mask

    uniformsRef.current.dayMap.value = earthTextures.day
    uniformsRef.current.nightMap.value = earthTextures.night
    uniformsRef.current.specularMap.value = earthTextures.specular
    uniformsRef.current.cloudMap.value = earthTextures.clouds

    const cloudImage = earthTextures.clouds.image as { width?: number; height?: number } | undefined
    if (cloudImage?.width && cloudImage?.height) {
      uniformsRef.current.cloudTexelSize.value.set(1 / cloudImage.width, 1 / cloudImage.height)
    }
  }, [earthTextures.day, earthTextures.night, earthTextures.specular, earthTextures.clouds, gl])

  // After first paint, capable desktops swap in the 8K day and night maps
  // (KTX2, streamed and uploaded without a hitch); everyone else keeps 4K.
  useEarthDetailUpgrade(uniformsRef.current)

  useFrame((state, delta) => {
    const earth = meshRef.current
    const streaming = surfaceImagery && !saveData && earth !== null
    const altitude = state.camera.position.length() - EARTH_RADIUS
    const center = streaming ? insetCenterUv(state.camera, earth) : null
    const simTime = simulationClock.now()
    const sunDir = sunDirectionWorld(simTime.julianDate)
    // Day tiles where the inset centre is lit, night tiles where it is dark.
    const sunAtCenter = center ? (_hit.x * sunDir.x + _hit.y * sunDir.y + _hit.z * sunDir.z) / EARTH_RADIUS : 0
    const dayCenter = center && sunAtCenter > DAY_STREAM_MIN_SUN ? center : null
    const nightCenter = center && sunAtCenter < NIGHT_STREAM_MAX_SUN ? center : null
    let budget = DETAIL_UPLOADS_PER_FRAME
    for (const stream of detail) budget -= stream.update(gl, dayCenter, altitude, delta, budget)
    for (const stream of nightDetail) budget -= stream.update(gl, nightCenter, altitude, delta, budget)

    // Dynamically update the sun direction vector uniform (world space)
    uniformsRef.current.sunDirection.value.set(sunDir.x, sunDir.y, sunDir.z)
    // The surface shader samples the same cloud field to cast aligned soft shadows.
    // The same frame state as CloudLayer, so the shadows stay under the clouds.
    const frame = clouds.frame(performance.now(), cloudRotationAtEpoch(simTime.epochMs), liveCloudRotation(simTime.epochMs, Date.now()))
    const u = uniformsRef.current
    u.cloudRotation.value = frame.rotationA
    u.cloudMap.value = frame.mapA ?? earthTextures.clouds
    u.cloudMapB.value = frame.mapB
    u.cloudOffsetB.value = frame.offsetB
    u.cloudBlend.value = frame.blend
  })

  // Uniforms go in through the constructor, which keeps this object by
  // reference: R3F 9 copies a `uniforms` prop into new uniform objects, so
  // later writes to ours never reached the GPU (the black Earth, 2026-10-28).
  // Memoized: R3F rebuilds the material whenever `args` changes identity.
  const materialArgs = useMemo<[THREE.ShaderMaterialParameters]>(() => [{ uniforms }], [uniforms])

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      {/* 6,371 km Earth radius with high resolution segmentation */}
      <sphereGeometry args={[EARTH_RADIUS, EARTH_SPHERE_SEGMENTS, EARTH_SPHERE_SEGMENTS]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        args={materialArgs}
        depthWrite={true}
        depthTest={true}
      />
    </mesh>
  )
})
