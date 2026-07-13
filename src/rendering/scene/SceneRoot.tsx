import React, { Suspense, useCallback, Component, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import { EnvironmentLayer } from './EnvironmentLayer'
import { EarthGroup } from '../earth/EarthGroup'
import { ISSGroup } from '../iss/ISSGroup'
import { OrbitLine } from '../iss/OrbitLine'
import { CameraController } from '@/interaction/camera/CameraController'
import { cameraControlsRef } from './cameraControlsRef'
import { useCameraStore } from '@/stores/cameraStore'

/**
 * F-02 FIX: Error boundary that catches asset-load failures inside the 3D scene.
 * Wraps ISS model/orbit subtrees so a GLB or Draco decode failure degrades
 * gracefully (ISS disappears + logs) rather than crashing the entire app to
 * the top-level red error screen.
 */
class CanvasErrorBoundary extends Component<
  { children: ReactNode; name?: string },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    const name = (this.props as { name?: string }).name ?? 'unknown'
    console.error(`[SceneRoot:${name}] Asset load error caught — degrading gracefully:`, error)
  }

  render() {
    if (this.state.hasError) return null // Fail silently inside the Canvas
    return this.props.children
  }
}

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
  // - PLANETARY/ORBITAL (Earth-focused): 6,500 km prevents camera clipping inside Earth sphere.
  // - FREE: 5 km — CAM-1 FIX: FREE was previously grouped with Earth modes (6,500 km), which
  //   ejected the camera to 6,500 km the instant the user panned away from the ISS in close-up.
  //   FREE must allow close proximity so panning from INSPECT/FOLLOW stays at the same distance.
  // - INSPECT: 60 km — N-3 FIX: The ISS is rendered ~109 km wide (1000× real size for visibility).
  //   The model's half-span is ~55 km, so 5 km places the camera inside the solar arrays.
  //   60 km keeps the camera just outside the full model extent.
  // - FOLLOW/APPROACH: 5 km (well outside model at those ranges).
  const minDistance =
    (activeTargetMode === 'PLANETARY' || activeTargetMode === 'ORBITAL') ? 6500
      : activeTargetMode === 'INSPECT' ? 60
        : 5

  // Store-2 FIX: Hoist ref callback with useCallback so it is not recreated every render.
  // An inline arrow function causes React to call ref(null) then ref(instance) on every
  // AppCameraControls re-render (every camera-mode change), briefly nulling the shared ref.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setCameraRef = useCallback((c: any) => {
    cameraControlsRef.current = c
  }, [])

  return (
    <CameraControls
      ref={setCameraRef}
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
          powerPreference: 'high-performance', // Bug C: reduces chance of browser downgrading context in long-running tabs
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
          {/* Celestial environment (stars and solar light) */}
          <EnvironmentLayer />

          {/* ─── Layered Earth Rendering System ─── */}
          {/* EarthGroup rotates by GMST — represents the ECEF (Earth-fixed) frame */}
          <EarthGroup />

          {/*
           * ─── ISS Entity Integration ────────────────────────────────────────
           * ISSGroup does NOT rotate — it stays in the ECI inertial frame.
           * F-02: Wrapped in CanvasErrorBoundary so a GLB / Draco decode failure
           * degrades gracefully (ISS disappears) rather than crashing the whole app.
           */}
          <CanvasErrorBoundary name="ISSGroup">
            <ISSGroup />
          </CanvasErrorBoundary>

          {/*
           * ─── Orbit Prediction Arc ───────────────────────────────────────
           * MUST be at scene root.
           */}
          <CanvasErrorBoundary name="OrbitLine">
            <OrbitLine />
          </CanvasErrorBoundary>

          {/* Foundational Camera System (Layer 4) */}
          <CameraController />

          {/* Isolated programmatic camera controls */}
          <AppCameraControls />


        </Suspense>
      </Canvas>
    </div>
  )
})
