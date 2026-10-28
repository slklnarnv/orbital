import type { JSX } from 'react'
import React, { Suspense, useCallback, useMemo, useRef, useEffect, Component, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EnvironmentLayer } from './EnvironmentLayer'
import { PostprocessingGate } from '../post/Postprocessing'
import { EarthGroup } from '../earth/EarthGroup'
import { ISSGroup } from '../iss/ISSGroup'
import { OrbitLine } from '../iss/OrbitLine'
import { CameraController } from '@/interaction/camera/CameraController'
import { HudAwareFraming } from '@/interaction/camera/HudAwareFraming'
import { cameraControlsRef } from './cameraControlsRef'
import { useCameraStore } from '@/stores/cameraStore'
import { CAMERA_ZOOM_RANGES } from '@/interaction/camera/CameraStateMachine'
import CameraControlsImpl from 'camera-controls'
import { DprGovernor } from './DprGovernor'
import { DEBUG_HOOKS, exposeDebugHook } from '@/utils/debugHooks'
import { useExplorerStore } from '@/stores/explorerStore'
import { explorerMinDistanceKm } from '../iss/moduleExplorer'
import { dprCeiling, dprFloor, pinnedDpr } from './renderScale'
import { useSettingsStore } from '@/stores/settingsStore'

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
  // Module explorer: an exploded station or a focused module raises the
  // zoom floor (CameraController pushes the eye out to it while it grows).
  const explorerFloor = useExplorerStore((state) => explorerMinDistanceKm(
    state.exploded ? 1 : 0, state.focused ? state.focusOffsetKm : 0,
  ))
  const mouseButtons = useMemo(() => ({
    left: isTransitioning ? CameraControlsImpl.ACTION.ROTATE : CameraControlsImpl.ACTION.NONE,
    middle: CameraControlsImpl.ACTION.DOLLY,
    right: CameraControlsImpl.ACTION.TRUCK,
    wheel: CameraControlsImpl.ACTION.DOLLY,
  }), [isTransitioning])
  const touches = useMemo(() => ({
    one: isTransitioning ? CameraControlsImpl.ACTION.TOUCH_ROTATE : CameraControlsImpl.ACTION.NONE,
    two: CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK,
    three: CameraControlsImpl.ACTION.TOUCH_TRUCK,
  }), [isTransitioning])

  // Keep Locate's existing flight limits. Earth clearance during manual
  // navigation is owned by CameraNavigationConstraint (the eye's clearance
  // sphere), not by a pivot-distance clamp: clamping the pivot distance to
  // 6,500 km would teleport the eye during the Free→Earth handoff, where the
  // pivot legitimately sits far from Earth's center while the eye grazes the
  // clearance sphere. Manual ISS navigation shares one model-clearance limit.
  const activeTargetMode = (isTransitioning && transition) ? transition.toMode : mode
  const minDistance = isTransitioning ? 5
    : activeTargetMode === 'FOLLOW' || activeTargetMode === 'INSPECT' || activeTargetMode === 'APPROACH'
      ? Math.max(CAMERA_ZOOM_RANGES.INSPECT.minDistance, explorerFloor)
      : CAMERA_ZOOM_RANGES.FREE.minDistance

  // Store-2 FIX: Hoist ref callback with useCallback so it is not recreated every render.
  // An inline arrow function causes React to call ref(null) then ref(instance) on every
  // AppCameraControls re-render (every camera-mode change), briefly nulling the shared ref.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setCameraRef = useCallback((c: any) => {
    cameraControlsRef.current = c
    // DEBUG HOOK (dev + bench builds): the controls instance for camera diagnostics
    if (DEBUG_HOOKS) exposeDebugHook('__orbitalControls', c)
  }, [])

  return (
    <CameraControls
      ref={setCameraRef}
      makeDefault={true}
      minDistance={minDistance} // Bound to reactive dynamic distance constraints
      maxDistance={100000}       // Cap maximum zoom-out distance (matches CAMERA_ZOOM_RANGES)
      truckSpeed={1}
      mouseButtons={mouseButtons}
      touches={touches}
    />
  )
})

/**
 * AdaptiveDpr — applies the pixel-ratio policy (renderScale.ts). On Auto it
 * feeds wall-clock frame deltas to the DprGovernor, which starts at the
 * device ceiling (min(devicePixelRatio, 2), coarse pointers included) and
 * only steps down on sustained slow frames; hidden-tab and hitch frames are
 * ignored. A manual render scale pins the ratio and stops sampling, and a
 * return to Auto starts a fresh governor: the old one's history measured a
 * different resolution.
 */
const AdaptiveDpr = React.memo(function AdaptiveDpr(): null {
  const setDpr = useThree((state) => state.setDpr)
  const renderScale = useSettingsStore((state) => state.renderScale)
  const ceilingRef = useRef<number | null>(null)
  if (ceilingRef.current === null) {
    const deviceDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true
    ceilingRef.current = dprCeiling(deviceDpr, coarse)
  }
  const ceiling = ceilingRef.current
  const pinned = pinnedDpr(ceiling, renderScale)
  const governorRef = useRef<DprGovernor | null>(null)

  useEffect(() => {
    if (pinned !== null) {
      governorRef.current = null
      setDpr(pinned)
      return
    }
    const governor = new DprGovernor({ maxDpr: ceiling, minDpr: dprFloor(ceiling) })
    governorRef.current = governor
    setDpr(governor.dpr)
  }, [pinned, ceiling, setDpr])

  useFrame((_, delta) => {
    const governor = governorRef.current
    if (!governor) return
    const next = governor.sample(delta * 1000, document.visibilityState === 'visible')
    if (next !== null) setDpr(next)
  })

  return null
})

/**
 * RuntimeEnvironment — locally generated image-based lighting for PBR
 * indirect specular. Without an environment term, metallic surfaces (solar
 * panel backs, radiators) render flat: nothing mirrors the Earth or stars.
 * RoomEnvironment is procedural (no CDN fetch) and PMREM-processed once;
 * scene.environmentIntensity keeps it subordinate to the calibrated
 * sun + earthshine + fill rig. Custom Earth/ISS shader materials ignore
 * scene.environment, so only glTF PBR materials are affected.
 */
const RuntimeEnvironment = React.memo(function RuntimeEnvironment(): null {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    let pmrem: THREE.PMREMGenerator | null = null
    let room: RoomEnvironment | null = null
    // Keep the render target, not just its texture: three ignores dispose() on a
    // render-target texture, so only the target's dispose() frees the
    // framebuffer and depth attachments.
    let envTarget: THREE.WebGLRenderTarget | null = null

    const release = () => {
      envTarget?.dispose()
      room?.dispose()
      pmrem?.dispose()
      envTarget = null
      room = null
      pmrem = null
    }

    const build = () => {
      release()
      pmrem = new THREE.PMREMGenerator(gl)
      room = new RoomEnvironment()
      envTarget = pmrem.fromScene(room, 0.04)
      scene.environment = envTarget.texture
      scene.environmentIntensity = 0.28
    }

    // The PMREM output lives in a render target: its GPU contents are lost
    // with the context and three.js cannot re-upload them from a CPU source.
    // The renderer registers its own restore handler at construction, so by
    // the time this listener runs the renderer state is already rebuilt.
    const canvas = gl.domElement
    canvas.addEventListener('webglcontextrestored', build)
    build()

    return () => {
      canvas.removeEventListener('webglcontextrestored', build)
      scene.environment = null
      scene.environmentIntensity = 1.0
      release()
    }
  }, [gl, scene])

  return null
})

/**
 * SceneRoot bootstraps the React Three Fiber rendering pipeline.
 *
 * It integrates the layered production Earth visual pipeline alongside
 * non-disruptive diagnostic coordinate tools.
 */
export const SceneRoot = React.memo(function SceneRoot(): JSX.Element {
  const issGroupRef = useRef<THREE.Group>(null)

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
          // Shadow maps exist only for the station's cached self-shadow; each
          // light opts in (castShadow) and redraws on demand (stationShadow.ts).
          gl.shadowMap.enabled = true
          gl.shadowMap.type = THREE.PCFShadowMap
          scene.background = new THREE.Color(0x000000) // Explicitly set background to pure neutral black
          // DEBUG HOOK (dev + bench builds): scene and renderer access for runtime
          // diagnostics (matching __orbitalControls)
          if (DEBUG_HOOKS) {
            exposeDebugHook('__orbitalScene', scene)
            exposeDebugHook('__orbitalRenderer', gl)
          }
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

          {/* HDR bloom + output compositing. Mounted only while the
              render-settings toggle is on — with it off, the direct pipeline
              renders exactly as before. */}
          <PostprocessingGate />

          {/* PBR indirect-specular environment (local RoomEnvironment, low intensity) */}
          <RuntimeEnvironment />

          {/* ─── Layered Earth Rendering System ─── */}
          {/* EarthGroup rotates by GMST — represents the ECEF (Earth-fixed) frame */}
          {/* Earth texture failures degrade to an empty scene region rather
              than replacing the whole app with the crash screen. */}
          <CanvasErrorBoundary name="EarthGroup">
            <EarthGroup />
          </CanvasErrorBoundary>

          {/*
           * ─── ISS Entity Integration ────────────────────────────────────────
           * ISSGroup does NOT rotate — it stays in the ECI inertial frame.
           * F-02: Wrapped in CanvasErrorBoundary so a GLB / Draco decode failure
           * degrades gracefully (ISS disappears) rather than crashing the whole app.
           */}
          <CanvasErrorBoundary name="ISSGroup">
            <ISSGroup groupRef={issGroupRef} />
          </CanvasErrorBoundary>

          {/*
           * ─── Orbit Prediction Arc ───────────────────────────────────────
           * MUST be at scene root.
           */}
          <CanvasErrorBoundary name="OrbitLine">
            <OrbitLine />
          </CanvasErrorBoundary>

          {/* Foundational Camera System (Layer 4) */}
          <CameraController issGroupRef={issGroupRef} />

          {/* Centres the tracked station in the area the HUD leaves free
              (projection offset only; plan 017 R2) */}
          <HudAwareFraming />

          {/* Isolated programmatic camera controls */}
          <AppCameraControls />

          {/* Frame-time-driven pixel-ratio governor */}
          <AdaptiveDpr />
        </Suspense>
      </Canvas>
    </div>
  )
})
