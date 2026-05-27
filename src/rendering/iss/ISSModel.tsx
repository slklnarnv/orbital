// ─── ISSModel — Normalized Production Geometry & LOD ─────────────────────────
//
// Represents the ISS at true physical scale and centered rotation, utilizing
// Draco-compressed high-detail models and lightweight LOD fallbacks.
//
// Physical ISS dimensions:
//   Solar array wingspan: ~109 m (0.109 km)
//   Truss / module length: ~73 m  (0.073 km)
//   Height extents: ~30 m (0.030 km)
//
// Level of Detail (LOD) Strategy:
//   - Near Range (< 2,800–3,200 km): Model Draco (303k Verts, PBR textures, emissive windows).
//   - Far Range (3,000–12,000 km): Model A (7.5k Verts, flat schematic PBR colors).
//   - Deep Planetary Scale (> 12,000 km): Model A + unlit Beacon sphere (8.0 km radius) to
//     ensure spatial tracking visibility above Earth at global distances.
//
// Hysteresis implementation:
//   To prevent LOD flickering/thrashing near the boundary:
//   - Enter Near Range at < 2,800 km
//   - Exit Near Range at > 3,200 km
//
// Memory & Performance Guarantees:
//   - Module-level preloading via useGLTF.preload() to prevent shader/texture hitching.
//   - Group ref visibility mutated directly inside useFrame() to avoid React state re-renders.

import React, { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'

// ─── Preload Assets ──────────────────────────────────────────────────────────
// Pre-warmed on page startup to bypass loading delays and frame drops
useGLTF.preload('/models/international_space_station.glb')
useGLTF.preload('/models/International Space Station (ISS) (A).glb')

// ─── Normalization & Pivot Offsets Constants ─────────────────────────────────
// Computed from physical extents and binary glTF bounds analysis

/** Physical wingspan of the real-world ISS solar arrays (meters) */
const PHYSICAL_ISS_WINGSPAN_M = 109.0

// Model Draco: Max dimensions [31.070, 24.200, 75.109]m. Wingspan is Z-extent (75.109m).
const MODEL_DRACO_WINGSPAN_M = 75.109
const NORMALIZATION_SCALE_DRACO = PHYSICAL_ISS_WINGSPAN_M / MODEL_DRACO_WINGSPAN_M // ≈ 1.451
const PIVOT_OFFSET_DRACO_Y = 3.506 // Center of geometry is offset by -3.506m in local space

// Model A: Max dimensions [37.772, 22.671, 23.539]m. Max extent is X truss span (37.772m).
const MODEL_A_WINGSPAN_M = 37.772
const NORMALIZATION_SCALE_A = PHYSICAL_ISS_WINGSPAN_M / MODEL_A_WINGSPAN_M // ≈ 2.885
const PIVOT_OFFSET_A_X = -0.002
const PIVOT_OFFSET_A_Y = 5.720
const PIVOT_OFFSET_A_Z = 2.196

/** Planetary tracking beacon radius (km) */
const BEACON_RADIUS_KM = 8.0

/** LOD hysteresis bands to prevent boundary thrashing (km) */
const LOD_ENTER_NEAR_KM = 2800
const LOD_EXIT_NEAR_KM = 3200

/** Planetary scale boundary for beacon visibility (km) */
const BEACON_ACTIVATE_KM = 12000

const _sunDirVec = new THREE.Vector3()
const _inspectionLightPos = new THREE.Vector3()

// ─── Component ────────────────────────────────────────────────────────────────

export const ISSModel = React.memo(function ISSModel(): JSX.Element {
  const groupRef = useRef<THREE.Group>(null)

  // Element Refs for direct vis/light mutation (zero garbage collection)
  const dracoRef = useRef<THREE.Group>(null)
  const fallbackRef = useRef<THREE.Group>(null)
  const beaconRef = useRef<THREE.Group>(null)
  const auraRef = useRef<THREE.Mesh>(null)
  const lightPrimaryRef = useRef<THREE.PointLight>(null)
  const lightSecondaryRef = useRef<THREE.PointLight>(null)
  const lightAmbientRef = useRef<THREE.HemisphereLight>(null)
  const lightInspectionRef = useRef<THREE.PointLight>(null)

  // Tracking refs to maintain stable hysteresis states across frames
  const isNearRef = useRef(false)
  const worldPos = useRef(new THREE.Vector3())

  // Load target visual assets
  const dracoGltf = useGLTF('/models/international_space_station.glb')
  const fallbackGltf = useGLTF('/models/International Space Station (ISS) (A).glb')

  // Clone loaded geometries to ensure absolute instance isolation in the scene graph
  const dracoScene = useMemo(() => dracoGltf.scene.clone(), [dracoGltf.scene])
  const fallbackScene = useMemo(() => fallbackGltf.scene.clone(), [fallbackGltf.scene])

  // Dispose cloned geometries and materials on unmount to prevent GPU resource leaks
  useEffect(() => {
    return () => {
      const disposeScene = (scene: THREE.Group) => {
        scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            (child as THREE.Mesh).geometry?.dispose()
            const mat = (child as THREE.Mesh).material
            if (Array.isArray(mat)) mat.forEach(m => m.dispose())
            else mat?.dispose()
          }
        })
      }
      disposeScene(dracoScene)
      disposeScene(fallbackScene)
    }
  }, [dracoScene, fallbackScene])

  useFrame((state) => {
    if (!groupRef.current) return

    // Retrieve absolute world coordinates of the ISS model center
    groupRef.current.getWorldPosition(worldPos.current)
    const distanceKm = state.camera.position.distanceTo(worldPos.current)

    // 1. Evaluate LOD Near/Far state using hysteresis bands
    if (isNearRef.current) {
      if (distanceKm > LOD_EXIT_NEAR_KM) {
        isNearRef.current = false
      }
    } else {
      if (distanceKm < LOD_ENTER_NEAR_KM) {
        isNearRef.current = true
      }
    }

    const isNear = isNearRef.current

    // 2. Evaluate planetary beacon visibility
    const isBeaconVisible = !isNear && distanceKm > BEACON_ACTIVATE_KM

    // 3. Compute distance-adaptive optical glint halo (Amber/Blue glow)
    // The halo represents photovoltaic solar panel glint visible at mid-range distances.
    // Restrained: invisible close-up (protects ISS model detail), subtle at range.
    let auraOpacity = 0.0
    if (distanceKm > 150.0) {
      if (distanceKm < 2000.0) {
        // Smoothly fade in from 150 km to 2000 km, peaking at 0.35
        auraOpacity = ((distanceKm - 150.0) / 1850.0) * 0.35
      } else {
        // Decays slowly to a faint, stable 0.15 at far planetary distances
        auraOpacity = 0.35 - Math.min(0.20, ((distanceKm - 2000.0) / 10000.0) * 0.20)
      }
    }

    // 3b. Shadow detection for dynamic color-shifting halo
    const simTime = simulationClock.now()
    const sunDir = sunDirectionWorld(simTime.julianDate)
    _sunDirVec.set(sunDir.x, sunDir.y, sunDir.z).normalize()
    const p = worldPos.current.dot(_sunDirVec)
    const perpSq = worldPos.current.lengthSq() - p * p
    const isShadowed = p < 0 && perpSq < 6371.0 * 6371.0

    // 3c. Dynamic camera-distance-based local point lights exposure scaling
    // Lights are 0.0 at far planetary ranges (3000 km) and scale smoothly to 1.0 during close zoom (100 km)
    const minLightDist = 100.0
    const maxLightDist = 3000.0
    const lightFactor = 1.0 - THREE.MathUtils.clamp((distanceKm - minLightDist) / (maxLightDist - minLightDist), 0.0, 1.0)
    const smoothMultiplier = Math.pow(lightFactor, 2.0) // Soft quadratic ease-in for simulated exposure adaptation

    // Physical Camera Exposure Adaptation
    // When the ISS is in shadow, we boost light exposure by 2.3x so modules remain engineered and visible.
    const shadowExposureBoost = isShadowed ? 2.3 : 1.0

    if (lightPrimaryRef.current) {
      lightPrimaryRef.current.intensity = 1.6 * smoothMultiplier * shadowExposureBoost
    }
    if (lightSecondaryRef.current) {
      lightSecondaryRef.current.intensity = 0.8 * smoothMultiplier * shadowExposureBoost
    }
    if (lightAmbientRef.current) {
      lightAmbientRef.current.intensity = 0.05 * smoothMultiplier * shadowExposureBoost // Faint ambient fill to prevent total black crush
    }

    // 3d. Dynamic camera-linked inspection headlight
    // Active strictly close-up (< 100 km), scaling up smoothly as the camera approaches minDistance
    if (lightInspectionRef.current) {
      _inspectionLightPos.subVectors(state.camera.position, worldPos.current)
      lightInspectionRef.current.position.copy(_inspectionLightPos)
      const headlightFactor = 1.0 - THREE.MathUtils.clamp((distanceKm - 5.0) / 95.0, 0.0, 1.0)
      const smoothHeadlight = Math.pow(headlightFactor, 2.0)
      lightInspectionRef.current.intensity = 0.45 * smoothHeadlight * shadowExposureBoost
    }

    // 4. Mutate Three.js object visibility and matrices directly (bypasses React virtual DOM rendering)
    if (dracoRef.current) {
      dracoRef.current.visible = isNear
    }
    if (fallbackRef.current) {
      fallbackRef.current.visible = !isNear
    }
    if (beaconRef.current) {
      beaconRef.current.visible = isBeaconVisible
      // Rotate the telemetry tracking ring to face the camera perfectly
      beaconRef.current.lookAt(state.camera.position)
      // Dynamic screen-proportional scaling so the locator remains readable at global scales
      // Calibration: Math.max(1.2, distanceKm / 6800.0) ensures clean visibility against the Earth limb.
      const dynamicScale = Math.max(1.2, distanceKm / 6800.0)
      // Add a gentle, slow scientific telemetry pulse (0.4 Hz)
      const pulse = 1.0 + 0.16 * Math.sin(simTime.epochMs * 0.0025)
      beaconRef.current.scale.setScalar(dynamicScale * pulse)
    }
    if (auraRef.current) {
      auraRef.current.visible = distanceKm > 150.0

      // Dynamic screen-proportional scaling so the halo remains readable at global scales
      const dynamicScale = Math.max(1.0, distanceKm / 800.0)
      auraRef.current.scale.setScalar(dynamicScale)

      const mat = auraRef.current.material as THREE.MeshBasicMaterial
      if (mat) {
        mat.opacity = auraOpacity
        // Dynamic daylight (warm amber glint) vs. shadow (cool blue/cyan) color shift
        mat.color.set(isShadowed ? '#80D0FF' : '#FFD580')
      }
    }
  })

  return (
    <group ref={groupRef}>
      {/* ─── Level of Detail 0: Near-Range Premium Draco Model ─── */}
      <group
        ref={dracoRef}
        scale={NORMALIZATION_SCALE_DRACO}
        visible={false} // Managed dynamically by useFrame loop
      >
        <primitive
          object={dracoScene}
          position={[0, PIVOT_OFFSET_DRACO_Y, 0]} // Center pivot translation
        />
      </group>

      {/* ─── Level of Detail 1: Far-Range Schematic Model A ─── */}
      <group
        ref={fallbackRef}
        scale={NORMALIZATION_SCALE_A}
        visible={true} // Managed dynamically by useFrame loop
      >
        <primitive
          object={fallbackScene}
          position={[PIVOT_OFFSET_A_X, PIVOT_OFFSET_A_Y, PIVOT_OFFSET_A_Z]} // Center pivot translation
        />
      </group>

      {/* ─── Concentric Telemetry Tracking Beacon Ring ─── */}
      <group
        ref={beaconRef}
        visible={false} // Managed dynamically by useFrame loop
      >
        {/* Outer tracking ring */}
        <mesh>
          <ringGeometry args={[BEACON_RADIUS_KM - 0.8, BEACON_RADIUS_KM, 32]} />
          <meshBasicMaterial
            color="#90e0ff" // Bright luminous aerospace blue/cyan
            transparent={true}
            opacity={0.85}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* Inner core telemetry tracking dot */}
        <mesh>
          <sphereGeometry args={[1.5, 8, 8]} />
          <meshBasicMaterial
            color="#bae6fd"
            transparent={true}
            opacity={0.85}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      {/* ─── Photographic Optical Aura / Glint Halo ─── */}
      <mesh
        ref={auraRef}
        visible={false} // Managed dynamically by useFrame loop
      >
        <sphereGeometry args={[6.0, 16, 16]} />
        <meshBasicMaterial
          color="#FFD580" // Photographic warm amber — restrained solar panel glint
          transparent={true}
          opacity={0.0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* ─── Soft earthshine point fill-lights to keep structural detail readable close-up inside shadow ─── */}
      {/* Primary central earthshine fill: cooler tone, broad reach, positioned at positive truss offset */}
      <pointLight
        ref={lightPrimaryRef}
        intensity={0.0}  // Mutated dynamically in useFrame loop
        position={[0, 4.0, 48.0]} // Positioned near solar array Z-truss end
        distance={100.0} // Broad reach to prevent local light spotting
        decay={1.0}      // Soft linear falloff
        color="#eef6ff"
      />
      {/* Secondary offset fill: creates soft directionality along negative truss end */}
      <pointLight
        ref={lightSecondaryRef}
        intensity={0.0}  // Mutated dynamically in useFrame loop
        position={[0, 4.0, -48.0]} // Positioned near opposite Z-truss end
        distance={100.0} // Broad reach to prevent local light spotting
        decay={1.0}      // Soft linear falloff
        color="#e6f0ff"
      />

      {/* ─── Dynamic Camera-Linked Warm Soft Inspection Headlight ─── */}
      <pointLight
        ref={lightInspectionRef}
        intensity={0.0}
        distance={75.0}
        decay={1.0}
        color="#ffeedb" // Warm soft tone to capture module details beautifully
      />

      {/* ─── Very subtle ambient-style orbital fill attached only near the ISS group, dynamically scaled ─── */}
      <hemisphereLight
        ref={lightAmbientRef}
        intensity={0.0}       // Mutated dynamically in useFrame loop
        color="#dfe8ff"       // Cool neutral space bounce
        groundColor="#030305" // Deep dark space ground bounce
      />
    </group>
  )
})
