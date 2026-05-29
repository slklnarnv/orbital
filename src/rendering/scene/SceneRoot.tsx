import React, { Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import { simulationClock } from '@/core/clock/SimulationClock'
import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { EnvironmentLayer } from './EnvironmentLayer'
import { EarthGroup } from '../earth/EarthGroup'
import { ISSGroup } from '../iss/ISSGroup'
import { OrbitLine } from '../iss/OrbitLine'
import { CameraController } from '@/interaction/camera/CameraController'
import { cameraControlsRef } from './cameraControlsRef'
import { useCameraStore } from '@/stores/cameraStore'

/**
 * Internal loop controller that executes once per frame inside the Canvas context.
 *
 * Responsibilities:
 * 1. Ticks the centralized SimulationClock with the frame delta (ms).
 * 2. Ticks the TelemetryManager to propagate orbital state updates.
 */
const SimulationLoop = React.memo(function SimulationLoop(): null {
  useFrame((_, delta) => {
    // R3F frame delta is in seconds; convert to milliseconds for simulation clock
    const simTime = simulationClock.tick(delta * 1000)

    // Propagate state through orbital propagation logic
    telemetryManager.update(simTime)
  })

  return null
})

/**
 * Sub-component isolating camera store subscriptions to protect parent Canvas from re-renders.
 */
const AppCameraControls = React.memo(function AppCameraControls(): JSX.Element {
  const mode = useCameraStore((state) => state.mode)
  const transition = useCameraStore((state) => state.transition)
  const isTransitioning = useCameraStore((state) => state.isTransitioning)

  // Use the transition's destination mode if currently flying, otherwise use active mode.
  // This drops the minDistance constraint to 5 km immediately at transition start,
  // preventing CameraControls from clutching/bouncing camera coordinates during flight.
  const activeTargetMode = (isTransitioning && transition) ? transition.toMode : mode

  // Dynamic minDistance:
  // - Focused on Earth (PLANETARY/ORBITAL/FREE) -> 6,500 km to prevent camera clipping inside the Earth sphere.
  // - Focused on/tracking the ISS (FOLLOW/INSPECT/APPROACH) -> 5 km to enable close-up visual module inspection.
  const minDistance = (activeTargetMode === 'PLANETARY' || activeTargetMode === 'ORBITAL' || activeTargetMode === 'FREE') ? 6500 : 5

  return (
    <CameraControls
      ref={(c) => { cameraControlsRef.current = c }}
      makeDefault={true}
      minDistance={minDistance} // Bound to reactive dynamic distance constraints
      maxDistance={100000}       // Cap maximum zoom-out distance (matches CAMERA_ZOOM_RANGES)
    />
  )
})

/**
 * SceneRoot bootstraps the React Three Fiber rendering pipeline.
 *
 * It integrates the layered production Earth visual pipeline alongside
 * non-disruptive diagnostic coordinate tools.
 */
export const SceneRoot = React.memo(function SceneRoot(): JSX.Element {
  return (
    <div className="w-full h-full bg-[#000000]">
      <Canvas
        gl={{
          antialias: true,
        }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.0 // Calibrated highlight compression for deep blacks
          gl.outputColorSpace = THREE.SRGBColorSpace // Photographic color space
          scene.background = new THREE.Color(0x000000) // Explicitly set background to pure neutral black
        }}
        camera={{
          fov: 45,
          near: 1.0,
          far: 2000000,
          position: [0, 0, 18000], // Earth at (0,0,0) is 6371km, placing camera at 18000km offers a clean planetary scale view
        }}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          {/* Centralized ticker for clock and telemetry propagation */}
          <SimulationLoop />

          {/* Celestial environment (stars and solar light) */}
          <EnvironmentLayer />

          {/* ─── Layered Earth Rendering System ─── */}
          {/* EarthGroup rotates by GMST — represents the ECEF (Earth-fixed) frame */}
          <EarthGroup />

          {/*
           * ─── ISS Entity Integration ────────────────────────────────────────
           * ISSGroup does NOT rotate — it stays in the ECI inertial frame.
           */}
          <ISSGroup />

          {/*
           * ─── Orbit Prediction Arc ───────────────────────────────────────
           * MUST be at scene root.
           */}
          <OrbitLine />

          {/* Foundational Camera System (Layer 4) */}
          <CameraController />

          {/* Isolated programmatic camera controls */}
          <AppCameraControls />
        </Suspense>
      </Canvas>
    </div>
  )
})

