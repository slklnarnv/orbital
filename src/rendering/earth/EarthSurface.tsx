import React, { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { EARTH_RADIUS, EARTH_TEXTURES } from './EarthConstants'
import vertexShader from '../shaders/earthSurface.vert'
import fragmentShader from '../shaders/earthSurface.frag'

// ─── Preload 8K Earth Textures at Module Scope ────────────────────────────────
// Pre-warms the high-resolution 8K maps via Drei's preload system, which
// integrates with DefaultLoadingManager and is covered by the loading gate.
useTexture.preload(EARTH_TEXTURES.dayMap)
useTexture.preload(EARTH_TEXTURES.nightMap)
useTexture.preload(EARTH_TEXTURES.specularMap)

/** Helper to apply optimal visual and GPU rendering parameters on loaded textures */
const configureTexture = (texture: THREE.Texture, isSRGB: boolean, maxAnisotropy: number) => {
  texture.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
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
  })

  // Initialize uniforms
  const uniformsRef = useRef({
    dayMap: { value: null as THREE.Texture | null },
    nightMap: { value: null as THREE.Texture | null },
    specularMap: { value: null as THREE.Texture | null },
    sunDirection: { value: new THREE.Vector3(0, 0, 1) },
    nightIntensity: { value: 5.5 }, // Boosted to compensate for amber tint multiplier in shader
  })

  // Configure and assign the high-res textures once they are loaded
  useEffect(() => {
    if (!earthTextures.day || !earthTextures.night || !earthTextures.specular) return
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy()

    configureTexture(earthTextures.day, true, maxAnisotropy)
    configureTexture(earthTextures.night, true, maxAnisotropy)
    configureTexture(earthTextures.specular, false, maxAnisotropy) // Non-sRGB specular mask

    uniformsRef.current.dayMap.value = earthTextures.day
    uniformsRef.current.nightMap.value = earthTextures.night
    uniformsRef.current.specularMap.value = earthTextures.specular
  }, [earthTextures.day, earthTextures.night, earthTextures.specular, gl])

  useFrame(() => {
    const simTime = simulationClock.now()
    const sunDir = sunDirectionWorld(simTime.julianDate)

    // Dynamically update the sun direction vector uniform (world space)
    uniformsRef.current.sunDirection.value.set(sunDir.x, sunDir.y, sunDir.z)
  })

  return (
    <mesh position={[0, 0, 0]}>
      {/* 6,371 km Earth radius with high resolution segmentation */}
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
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
