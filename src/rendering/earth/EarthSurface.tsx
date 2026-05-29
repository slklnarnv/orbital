import React, { useEffect, useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { EARTH_RADIUS, EARTH_TEXTURES } from './EarthConstants'
import vertexShader from '../shaders/earthSurface.vert'
import fragmentShader from '../shaders/earthSurface.frag'

const PLACEHOLDERS = {
  day: '/textures/earth_daymap_2048.jpg',
  night: '/textures/earth_nightmap_2048.jpg',
}

// ─── Preload Earth Textures at Module Scope ──────────────────────────────────
// Pre-warms the lightweight placeholders and high-resolution targets immediately on startup
useTexture.preload(PLACEHOLDERS.day)
useTexture.preload(PLACEHOLDERS.night)

/** Helper to create a 1x1 black CanvasTexture to keep land matte on initial load */
const createBlackTexture = (): THREE.Texture => {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, 1, 1)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

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

  // Load low-res Day and Night placeholder maps (loads instantly, prevents Suspense pop-in)
  const lowRes = useTexture({
    day: PLACEHOLDERS.day,
    night: PLACEHOLDERS.night,
  })

  // Re-use single loader instance across frames
  const loader = useMemo(() => new THREE.TextureLoader(), [])

  // Initialize uniforms with placeholders — specularMap initialized to matte black to prevent pop-in flash
  const uniformsRef = useRef({
    dayMap: { value: null as THREE.Texture | null },
    nightMap: { value: null as THREE.Texture | null },
    specularMap: { value: createBlackTexture() },
    sunDirection: { value: new THREE.Vector3(0, 0, 1) },
    nightIntensity: { value: 5.5 }, // Boosted to compensate for amber tint multiplier in shader
  })

  const highResLoadedRef = useRef(false)

  // Apply texture configuration and stream high-resolution textures progressively
  useEffect(() => {
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy()

    // 1. Configure and assign low-res placeholders first (instant visual appearance)
    if (lowRes.day) {
      configureTexture(lowRes.day, true, maxAnisotropy)
      uniformsRef.current.dayMap.value = lowRes.day
    }
    if (lowRes.night) {
      configureTexture(lowRes.night, true, maxAnisotropy)
      uniformsRef.current.nightMap.value = lowRes.night
    }

    if (highResLoadedRef.current) return
    highResLoadedRef.current = true

    // 2. Progressive background loading of high-resolution 8K textures
    // Defer heavy assets to avoid initial startup blocking.
    loader.load(EARTH_TEXTURES.dayMap, (tex) => {
      configureTexture(tex, true, maxAnisotropy)
      uniformsRef.current.dayMap.value = tex

      // Defer night lights map load until day map is ready
      loader.load(EARTH_TEXTURES.nightMap, (nightTex) => {
        configureTexture(nightTex, true, maxAnisotropy)
        uniformsRef.current.nightMap.value = nightTex
      })

      // Defer specular mask map load until day map is ready
      loader.load(EARTH_TEXTURES.specularMap, (specTex) => {
        const oldTex = uniformsRef.current.specularMap.value
        configureTexture(specTex, false, maxAnisotropy)
        uniformsRef.current.specularMap.value = specTex
        oldTex?.dispose() // Clean up the 1×1 black canvas texture
      })
    })
  }, [lowRes.day, lowRes.night, gl, loader])

  // Clean up manually loaded 8K textures on unmount to prevent GPU memory leaks.
  //
  // IMPORTANT: We must NOT dispose Drei-managed low-res placeholder textures.
  // `useTexture` caches textures globally. Calling .dispose() on a cached texture
  // permanently invalidates it — if the component remounts (HMR, Strict Mode, routes),
  // Drei returns the disposed texture and Earth renders as a broken solid black sphere.
  //
  // Guard: only dispose if the current texture has been swapped out for the high-res
  // version (i.e. is no longer the cached placeholder). Pattern mirrors CloudLayer.tsx.
  useEffect(() => {
    return () => {
      const maps = uniformsRef.current
      if (maps.dayMap.value && maps.dayMap.value !== lowRes.day) {
        maps.dayMap.value.dispose()
      }
      if (maps.nightMap.value && maps.nightMap.value !== lowRes.night) {
        maps.nightMap.value.dispose()
      }
      // specularMap is never Drei-managed (initialized as 1×1 black CanvasTexture,
      // then replaced by a manually loaded 8K map) — always safe to dispose.
      if (maps.specularMap.value) {
        maps.specularMap.value.dispose()
      }
    }
  }, [lowRes.day, lowRes.night])

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
