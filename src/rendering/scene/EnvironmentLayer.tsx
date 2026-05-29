import React, { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import sunVert from '../shaders/sun.vert'
import sunFrag from '../shaders/sun.frag'

// ─── Preload Starmap Texture at Module Scope ─────────────────────────────────
// Pre-warms the new high-quality starmap immediately on page startup
useTexture.preload('/textures/starmap-4k.jpg')

// ─── Hoisted Static Vectors for Zero-GC Frame Loop ───────────────────────────
// Reused every frame inside useFrame; never re-allocated after module init.
const _sunDirVec = new THREE.Vector3()
const _cameraDir = new THREE.Vector3()

// ─── Starmap Sphere Orientation Constants ─────────────────────────────────────
// Orients the NASA starmap panorama so the galactic plane runs at a natural
// oblique angle and the Milky Way core sits in the lower-right quadrant of view.
// Values were tuned against astrophotographic reference imagery.
const STARMAP_ROTATION_X = Math.PI * 0.15  // Tilt galactic plane
const STARMAP_ROTATION_Y = Math.PI * 0.45  // Azimuthal alignment to galactic core
const STARMAP_ROTATION_Z = Math.PI * 0.08  // Minor roll correction for star density

/**
 * Generates randomly distributed stars on a single sphere with varying physical color temperatures and luminances.
 * Highly restrained and dim to complement the real NASA starmap-4k.jpg panorama backdrop.
 */
function generateRestrainedStars(count: number) {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)

  const colorTemps = [
    new THREE.Color('#ffffff'), // White
    new THREE.Color('#e5f0ff'), // Blue-white
    new THREE.Color('#ffebd0'), // Warm amber
    new THREE.Color('#ffd5cc'), // Red giant (subtle)
  ]

  for (let i = 0; i < count; i++) {
    // Generate uniform random spherical coordinates
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos((Math.random() * 2) - 1)

    // Placed far outside the Earth/ISS orbits (radius ~280,000 to 295,000 km)
    const r = 280000 + Math.random() * 15000

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)

    // Select color temperature distribution
    const randTemp = Math.random()
    let baseColor = colorTemps[0]
    if (randTemp > 0.70 && randTemp <= 0.90) baseColor = colorTemps[1]
    else if (randTemp > 0.90 && randTemp <= 0.98) baseColor = colorTemps[2]
    else if (randTemp > 0.98) baseColor = colorTemps[3]

    // Astro-luminance hierarchy - calibrated to complement the real NASA starmap
    const randLuminance = Math.random()
    let brightness = 0.0

    if (randLuminance <= 0.95) {
      // Faint background stars (1.5x boosted: 0.027 to 0.068 brightness)
      brightness = 0.027 + Math.random() * 0.041
    } else if (randLuminance > 0.95 && randLuminance <= 0.995) {
      // Medium stars (1.5x boosted: 0.068 to 0.135 brightness)
      brightness = 0.068 + Math.random() * 0.067
    } else {
      // Bright primary stars (1.5x boosted: 0.135 to 0.27 brightness)
      brightness = 0.135 + Math.random() * 0.135
    }

    colors[i * 3] = baseColor.r * brightness
    colors[i * 3 + 1] = baseColor.g * brightness
    colors[i * 3 + 2] = baseColor.b * brightness
  }

  return { positions, colors }
}

/**
 * EnvironmentLayer manages cosmic lighting, background starfields, and the NASA panorama.
 *
 * It uses the SimulationClock to compute the precise relative position of the Sun
 * relative to the Earth (0,0,0) and positions a bright DirectionalLight accordingly.
 */
export const EnvironmentLayer = React.memo(function EnvironmentLayer(): JSX.Element {
  const { gl } = useThree()
  const sunLightRef = useRef<THREE.DirectionalLight>(null)
  const sunMeshRef = useRef<THREE.Mesh>(null)

  // Load the new high-quality starmap (starmap-4k.jpg) from MAP8K as a subtle astrophotography backdrop
  const starmapTex = useTexture('/textures/starmap-4k.jpg')

  // Configure background starmap texture with anisotropy, mipmaps, and correct colorspace
  useEffect(() => {
    if (starmapTex) {
      const maxAnisotropy = gl.capabilities.getMaxAnisotropy()
      starmapTex.colorSpace = THREE.SRGBColorSpace
      starmapTex.minFilter = THREE.LinearMipmapLinearFilter
      starmapTex.magFilter = THREE.LinearFilter
      starmapTex.generateMipmaps = true
      starmapTex.anisotropy = maxAnisotropy
      starmapTex.needsUpdate = true
    }
  }, [starmapTex, gl])

  // Pre-generate static procedural star coordinates once to guarantee 0 per-frame garbage collection
  const stars = useMemo(() => generateRestrainedStars(40000), []) // Reduced density to complement panorama

  useFrame((state, delta) => {
    if (!sunLightRef.current) return
    const simTime = simulationClock.now()
    const sunDir = sunDirectionWorld(simTime.julianDate)

    // Reuse hoisted vector — zero GC allocation
    _sunDirVec.set(sunDir.x, sunDir.y, sunDir.z).normalize()

    // Position sun light at a distance well beyond orbital scale (e.g. 300,000 units)
    // 1 unit = 1 km, Earth radius = 6371 units, ISS radius = 6779 units
    const solarDistance = 300000
    sunLightRef.current.position.set(
      sunDir.x * solarDistance,
      sunDir.y * solarDistance,
      sunDir.z * solarDistance
    )

    // Position and orient the procedural sun billboard
    if (sunMeshRef.current) {
      // Place the sun billboard at 270,000 km from Earth center in the sun direction
      const sunBillboardDist = 270000
      sunMeshRef.current.position.set(
        sunDir.x * sunBillboardDist,
        sunDir.y * sunBillboardDist,
        sunDir.z * sunBillboardDist
      )
      sunMeshRef.current.lookAt(state.camera.position)

      // Dynamically scale the sun billboard to maintain a constant apparent angular size.
      // Without this, zooming out to maxDistance (500,000 km) makes the billboard resolve
      // into a visible finite-size plane instead of looking like a distant point source.
      //
      // Physics: the real sun subtends ~0.53° (0.00925 rad) from 1 AU. The shader's bright
      // core disc occupies ~3% of billboard UV space, so a billboard angular size of 0.20 rad
      // yields a core of 0.20 × 0.03 = 0.006 rad ≈ 0.34° — slightly smaller than the real
      // sun for a restrained, cinematic look. Corona extends to ~0.20 × 0.20 = 0.04 rad (~2.3°).
      const camToSun = state.camera.position.distanceTo(sunMeshRef.current.position)
      const targetAngularSize = 0.20 // radians — yields ~0.34° core + ~2.3° corona glow
      const dynamicScale = camToSun * targetAngularSize
      sunMeshRef.current.scale.setScalar(dynamicScale / 110000) // normalize against the base 110K geometry
    }

    // ─── Dynamic Camera-Solar Exposure Adaptation ─────────────────────────────
    // Calculate the camera forward vector alignment relative to the Sun
    // Reuse hoisted vector — zero GC allocation
    state.camera.getWorldDirection(_cameraDir)
    const cameraSunDot = _cameraDir.dot(_sunDirVec) // -1.0 (looking away) to 1.0 (looking at sun)

    // Blinding sun adjusts exposure down to 0.75; dark space boosts it up to 1.05
    const sunAlignment = Math.max(0.0, cameraSunDot)
    const targetExposure = 1.05 - 0.30 * Math.pow(sunAlignment, 2.0)

    // Smoothly interpolate the renderer's exposure using dynamic temporal damping
    gl.toneMappingExposure = THREE.MathUtils.damp(gl.toneMappingExposure, targetExposure, 4.0, delta)
  })

  return (
    <>
      {/* Ambient background illumination so completely shadowed areas are slightly visible */}
      <ambientLight intensity={0.02} />

      {/* Primary directional light source representing the Sun */}
      <directionalLight
        ref={sunLightRef}
        intensity={1.8}         // Calibrated: slightly restrained for photographic contrast
        color="#fff8f0"          // Subtle warmth — sun at orbital distance is slightly warm
        castShadow={false}
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
          transparent={true}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          depthTest={true}
        />
      </mesh>

      {/* ─── Layered Starfield System (THREE.Points) ─── */}
      {/* renderOrder=1: renders AFTER the starmap sphere but BEFORE the sun billboard.
          This prevents star points (NormalBlending) from painting dark pixels over the
          sun's AdditiveBlending glow — the sun always composites on top. */}
      <points renderOrder={1}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[stars.positions, 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[stars.colors, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.85}                 // Boosted star point legibility
          vertexColors={true}
          sizeAttenuation={false}    // Positioned at infinity; bypass size oblique math on GPU
          transparent={true}
          opacity={0.88}             // Dense background stars
          depthWrite={false}
        />
      </points>

      {/* ─── Real NASA Astrophotography Background Sphere ─── */}
      {/* renderOrder=0: renders FIRST in the transparent pass — serves as the deepest
          background layer behind all star points and the sun billboard. */}
      {starmapTex && (
        <mesh rotation={[STARMAP_ROTATION_X, STARMAP_ROTATION_Y, STARMAP_ROTATION_Z]} renderOrder={0}>
          {/* Extremely large inverted sphere to enclose the starfield and camera paths (16x16 segments saves obverse triangles) */}
          <sphereGeometry args={[296000, 16, 16]} />
          <meshBasicMaterial
            map={starmapTex}
            side={THREE.BackSide}        // Render on inside faces
            transparent={true}
            opacity={0.48}                // Boosted to 0.48 to reveal rich galactic dust lanes and Milky Way (matching reference)
            depthWrite={false}
            toneMapped={false}           // Keeps black levels deep and unaffected by ACES exposure
            blending={THREE.NormalBlending} // Contributes deep black structure rather than glow
          />
        </mesh>
      )}
    </>
  )
})

