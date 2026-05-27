import React, { useEffect, useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { CLOUD_RADIUS, EARTH_TEXTURES } from './EarthConstants'
import vertexShader from '../shaders/clouds.vert'
import fragmentShader from '../shaders/clouds.frag'

const PLACEHOLDER_CLOUD = '/textures/earth_clouds_2048.jpg'

// ─── Preload Cloud Textures at Module Scope ──────────────────────────────────
// Pre-warms the lightweight cloud placeholder immediately on startup
useTexture.preload(PLACEHOLDER_CLOUD)

/** Helper to configure cloud density textures - Hoisted to module scope to avoid re-creations */
const configureCloudTexture = (texture: THREE.Texture, maxAnisotropy: number) => {
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = maxAnisotropy
  texture.generateMipmaps = true
  texture.needsUpdate = true
}

/**
 * CloudLayer renders the dynamic cloud deck of the Earth.
 *
 * Key pipeline invariants:
 * 1. Texture is fully configured (colorSpace, filtering, anisotropy, wrapping) BEFORE
 *    it is assigned to the uniform value — avoids initialization race with useTexture.
 * 2. Anisotropy pulled from renderer capabilities for maximum hardware filtering quality.
 * 3. Cloud texture is a grayscale density mask — must use NoColorSpace to avoid sRGB gamma correction.
 * 4. RepeatWrapping prevents seam artifacts at the prime meridian.
 * 5. depthWrite=false prevents alpha sorting artifacts with the atmosphere shell.
 */
export const CloudLayer = React.memo(function CloudLayer(): JSX.Element {
  const { gl } = useThree()

  // Load the lightweight cloud placeholder instantly (prevents initial startup Suspense stalls)
  const lowResCloud = useTexture(PLACEHOLDER_CLOUD)

  const cloudMeshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  // Re-use single loader instance across frames
  const loader = useMemo(() => new THREE.TextureLoader(), [])

  // Initialize uniforms with null texture — will be assigned after configuration
  const uniformsRef = useRef({
    cloudMap: { value: null as THREE.Texture | null },
    sunDirection: { value: new THREE.Vector3(0, 0, 1) },
    opacity: { value: 0.32 }, // Subtle, photographic cloud density
  })

  const highResLoadedRef = useRef(false)

  useEffect(() => {
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy()

    // 1. Configure and assign low-res placeholder first (instant visual appearance)
    if (lowResCloud) {
      configureCloudTexture(lowResCloud, maxAnisotropy)
      uniformsRef.current.cloudMap.value = lowResCloud
      if (materialRef.current) {
        materialRef.current.needsUpdate = true
      }
    }

    if (highResLoadedRef.current) return
    highResLoadedRef.current = true

    // 2. Stream the high-resolution 8K cloud density map in the background (deferred)
    loader.load(EARTH_TEXTURES.cloudMap, (highResTex) => {
      configureCloudTexture(highResTex, maxAnisotropy)
      uniformsRef.current.cloudMap.value = highResTex
      if (materialRef.current) {
        materialRef.current.needsUpdate = true
      }
    })
  }, [lowResCloud, gl, loader])

  // Clean up manually loaded 8K texture on unmount to prevent GPU memory leaks
  useEffect(() => {
    return () => {
      if (uniformsRef.current.cloudMap.value && uniformsRef.current.cloudMap.value !== lowResCloud) {
        uniformsRef.current.cloudMap.value.dispose()
      }
    }
  }, [lowResCloud])

  useFrame(() => {
    const simTime = simulationClock.now()

    // 1. Slow wind current drift (auto-rotation around Y axis in ECEF, tied to simulation clock)
    if (cloudMeshRef.current) {
      cloudMeshRef.current.rotation.y += 0.0002 * (simTime.simDeltaMs / 1000)
    }

    // 2. Propagate dynamic sun vector uniform
    const sunDir = sunDirectionWorld(simTime.julianDate)
    uniformsRef.current.sunDirection.value.set(sunDir.x, sunDir.y, sunDir.z)
  })

  return (
    <mesh ref={cloudMeshRef} position={[0, 0, 0]}>
      {/* Cloud shell radius is ~6,390 km (CLOUD_RADIUS_FACTOR ≈ 1.003) */}
      <sphereGeometry args={[CLOUD_RADIUS, 64, 64]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniformsRef.current}
        transparent={true}
        depthWrite={false}  // Prevent depth buffer sorting glitches with atmospheric rim
        depthTest={true}
        blending={THREE.NormalBlending}
      />
    </mesh>
  )
})
