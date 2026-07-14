import React, { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { cloudRotationAtEpoch } from './CloudMotion'
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
export const EarthSurface = React.memo(function EarthSurface(): JSX.Element {
  const { gl } = useThree()

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
    sunDirection: { value: new THREE.Vector3(0, 0, 1) },
    nightIntensity: { value: 4.2 },
  })

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

  useFrame(() => {
    const simTime = simulationClock.now()
    const sunDir = sunDirectionWorld(simTime.julianDate)

    // Dynamically update the sun direction vector uniform (world space)
    uniformsRef.current.sunDirection.value.set(sunDir.x, sunDir.y, sunDir.z)
    // The surface shader samples the same cloud field to cast aligned soft shadows.
    uniformsRef.current.cloudRotation.value = cloudRotationAtEpoch(simTime.epochMs)
  })

  return (
    <mesh position={[0, 0, 0]}>
      {/* 6,371 km Earth radius with high resolution segmentation */}
      <sphereGeometry args={[EARTH_RADIUS, EARTH_SPHERE_SEGMENTS, EARTH_SPHERE_SEGMENTS]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniformsRef.current}
        depthWrite={true}
        depthTest={true}
      />
    </mesh>
  )
})
