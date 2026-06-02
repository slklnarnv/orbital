import React, { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { CLOUD_RADIUS, EARTH_TEXTURES } from './EarthConstants'
import vertexShader from '../shaders/clouds.vert'
import fragmentShader from '../shaders/clouds.frag'

// ─── Preload 8K Cloud Texture at Module Scope ────────────────────────────────
// Pre-warms the high-resolution cloud map via Drei's preload system, which
// integrates with DefaultLoadingManager and is covered by the loading gate.
// F-04: The 2K placeholder pipeline is removed — the loading gate (opaque UI overlay)
// makes the progressive placeholder→8K transition invisible to the user, so the
// extra 2K placeholder download and swap are pure overhead.
useTexture.preload(EARTH_TEXTURES.cloudMap)

/**
 * CloudLayer renders the dynamic cloud deck of the Earth.
 *
 * Key pipeline invariants:
 * 1. Texture is fully configured (colorSpace, filtering, anisotropy, wrapping) in
 *    a useEffect after load — avoids initialization race with useTexture.
 * 2. Anisotropy pulled from renderer capabilities for maximum hardware filtering quality.
 * 3. Cloud texture is a grayscale density mask — must use NoColorSpace to avoid sRGB gamma correction.
 * 4. RepeatWrapping prevents seam artifacts at the prime meridian.
 * 5. depthWrite=false prevents alpha sorting artifacts with the atmosphere shell.
 */
export const CloudLayer = React.memo(function CloudLayer(): JSX.Element {
  const { gl } = useThree()

  // Load the 8K cloud density map directly — covered by the loading gate
  const cloudTexture = useTexture(EARTH_TEXTURES.cloudMap)

  const cloudMeshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  // Initialize uniforms with null texture — will be assigned after configuration
  const uniformsRef = useRef({
    cloudMap: { value: null as THREE.Texture | null },
    sunDirection: { value: new THREE.Vector3(0, 0, 1) },
    opacity: { value: 0.32 }, // Subtle, photographic cloud density
  })

  // Configure and assign the cloud texture once it's loaded
  useEffect(() => {
    if (!cloudTexture) return
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy()

    // N-4 FIX: needsUpdate = true is NOT needed on ShaderMaterial after changing a
    // uniform value. Uniform updates are consumed by the renderer every frame automatically.
    // needsUpdate=true forces a full shader program recompile, which causes a 1-3 frame
    // stutter and is incorrect for uniform-only changes. Only the texture itself needs
    // needsUpdate=true after its properties are changed (colorSpace, filtering, etc.).
    cloudTexture.colorSpace = THREE.NoColorSpace
    cloudTexture.wrapS = THREE.RepeatWrapping
    cloudTexture.wrapT = THREE.RepeatWrapping
    cloudTexture.minFilter = THREE.LinearMipmapLinearFilter
    cloudTexture.magFilter = THREE.LinearFilter
    cloudTexture.anisotropy = maxAnisotropy
    cloudTexture.generateMipmaps = true
    cloudTexture.needsUpdate = true  // Correct: applies filter/wrapping changes to GPU

    uniformsRef.current.cloudMap.value = cloudTexture
    // No materialRef.current.needsUpdate = true here — not needed for uniform assignments
  }, [cloudTexture, gl])

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


