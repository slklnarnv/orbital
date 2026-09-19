import React, { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import CameraControlsImpl from 'camera-controls'

import { useCameraStore } from '@/stores/cameraStore'
import { CameraStateMachine } from './CameraStateMachine'
import { applyNavigationSensitivity } from './CameraSensitivity'
import { CameraNavigationConstraint } from './CameraNavigationConstraint'
import { CameraFlightPath } from './CameraFlightPath'
import { FlightHorizon } from './FlightHorizon'
import { FreeOrbitControls } from './FreeOrbitControls'
import { cameraControlsRef } from '@/rendering/scene/cameraControlsRef'
import { telemetryManager } from '@/core/telemetry/TelemetryManager'
import { useLoadingStore } from '@/stores/loadingStore'
import { easeInOutCubic } from '@/utils/math'
import type { CameraTransitionState } from '@/types/camera'

// ─── Hoisted Static Vectors to Achieve Complete Zero-GC Frame Loops ──────────
const _earthCenterTarget = new THREE.Vector3()
const _earthCenterPos = new THREE.Vector3()
const _earthCenterEndPos = new THREE.Vector3()

const _transVelocityWorld = new THREE.Vector3()
const _transU = new THREE.Vector3()
const _transInTrack = new THREE.Vector3()
const _transCamPos = new THREE.Vector3()
const _flightEye = new THREE.Vector3()
const _flightTarget = new THREE.Vector3()
const _flightView = new THREE.Vector3()
const _flightUp = new THREE.Vector3()
const _flightLook = new THREE.Matrix4()

const _currentISSPos = new THREE.Vector3()
const _currentTarget = new THREE.Vector3()
const _currentCameraPos = new THREE.Vector3()
const _panTarget = new THREE.Vector3()
const _panCurrentTarget = new THREE.Vector3()
const PAN_ACTIONS = CameraControlsImpl.ACTION.TRUCK
  | CameraControlsImpl.ACTION.SCREEN_PAN

const _rightVec = new THREE.Vector3()
const _syncUp = new THREE.Vector3()
const _syncEye = new THREE.Vector3()
const _syncTargetA = new THREE.Vector3()
const _rollReference = new THREE.Vector3()

/**
 * Make camera-controls adopt the exact rendered pose, roll included. Flights
 * drive its internal state with a world-up frame while the rendered orientation
 * is transported manually — every takeover (completion, cancellation) must run
 * this or the internal representation snaps the roll on its next update.
 *
 * Order matters: the pose is read in the CURRENT up-space first, and only then
 * is the rendered up adopted. Changing the up-space first would re-project the
 * read eye through the new space and land it ~35° away — the offset survives
 * the space change while its world direction does not.
 */
function syncRenderedPoseToControls(controls: CameraControlsImpl, camera: THREE.Camera): void {
  controls.getPosition(_syncEye, false)
  controls.getTarget(_syncTargetA, false)
  _syncUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
  camera.up.copy(_syncUp)
  controls.updateCameraUp()
  void controls.setLookAt(
    _syncEye.x, _syncEye.y, _syncEye.z,
    _syncTargetA.x, _syncTargetA.y, _syncTargetA.z, false,
  )
  controls.update(0)
}

/** Roll between a transported horizon and the world-up horizon, in radians. */
function initialRollErrorRad(view: THREE.Vector3, up: THREE.Vector3): number {
  _rollReference.set(0, 1, 0).addScaledVector(view, -view.y)
  if (_rollReference.lengthSq() < 1e-6) return 0
  _rollReference.normalize()
  return Math.acos(THREE.MathUtils.clamp(up.dot(_rollReference), -1, 1))
}


interface CameraControllerProps {
  issGroupRef: RefObject<THREE.Group>
}

export const CameraController = React.memo(function CameraController({
  issGroupRef,
}: CameraControllerProps): null {
  const { camera, gl } = useThree()

  // Batch all camera store subscriptions into a single shallow selector to minimise
  // subscription count and prevent unnecessary re-renders when unrelated store
  // fields change. Previously 6 separate useCameraStore() calls.
  const {
    mode,
    isTransitioning,
    transition,
    setMode,
    completeTransition,
    setZoomProgress,
  } = useCameraStore(
    useShallow((state) => ({
      mode: state.mode,
      isTransitioning: state.isTransitioning,
      transition: state.transition,
      setMode: state.setMode,
      completeTransition: state.completeTransition,
      setZoomProgress: state.setZoomProgress,
    }))
  )

  const navigationRef = useRef<CameraNavigationConstraint | null>(null)
  const navigation = navigationRef.current ??= new CameraNavigationConstraint()
  const transitionFrameRef = useRef(false)
  const recenteringEarthRef = useRef(false)
  const recenterFromRef = useRef(new THREE.Vector3())
  const recenterElapsedRef = useRef(0)
  const freeOrbitRef = useRef<FreeOrbitControls | null>(null)
  const freeZoomEntryRef = useRef<number | null>(null)
  // The framing the Reset View button measures against: the camera pose at first
  // mount, replaced by each completed Reset. Any user orbit, zoom, or pan
  // deviates from it and makes the button appear.
  const homePoseRef = useRef<{ eye: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const flightRef = useRef<{
    transition: CameraTransitionState
    path: CameraFlightPath
    durationMs: number
    elapsedMs: number
    horizon: FlightHorizon
  } | null>(null)

  // BUG-04: Track listener registration status and callback references to ensure clean setup and tear down
  const listenersAttachedRef = useRef(false)
  const handleControlStartRef = useRef<(() => void) | null>(null)
  const handleControlRef = useRef<(() => void) | null>(null)
  const wheelCancelRef = useRef<(() => void) | null>(null)

  // Unsubscribe listeners cleanly on unmount
  useEffect(() => {
    return () => {
      const controls = cameraControlsRef.current
      if (controls) {
        if (handleControlStartRef.current) {
          controls.removeEventListener('controlstart', handleControlStartRef.current)
        }
        if (handleControlRef.current) {
          controls.removeEventListener('control', handleControlRef.current)
        }
      }
    }
  }, [])

  // The wheel listener lives on the canvas element, which outlives the controls ref.
  useEffect(() => {
    const canvas = gl.domElement
    return () => {
      if (wheelCancelRef.current) {
        canvas.removeEventListener('wheel', wheelCancelRef.current)
        wheelCancelRef.current = null
      }
    }
  }, [gl])

  useEffect(() => {
    const orbit = new FreeOrbitControls(gl.domElement)
    freeOrbitRef.current = orbit
    return () => {
      orbit.dispose()
      freeOrbitRef.current = null
    }
  }, [gl])

  useEffect(() => {
    let origin: { x: number; y: number; pivot: THREE.Vector3 } | null = null
    const start = (event: TouchEvent) => {
      const controls = cameraControlsRef.current
      if (event.touches.length < 2 || !controls) { origin = null; return }
      let x = 0
      let y = 0
      for (const touch of event.touches) { x += touch.clientX; y += touch.clientY }
      origin = {
        x: x / event.touches.length, y: y / event.touches.length,
        pivot: controls.getTarget(new THREE.Vector3(), false),
      }
    }
    const move = (event: TouchEvent) => {
      if (!origin || event.touches.length < 2) return
      let x = 0
      let y = 0
      for (const touch of event.touches) { x += touch.clientX; y += touch.clientY }
      const dx = x / event.touches.length - origin.x
      const dy = y / event.touches.length - origin.y
      const store = useCameraStore.getState()
      if (store.isTransitioning) return
      // Pointer events arrive finger-by-finger; their intermediate centroid can
      // falsely report a pan during a centred pinch. TouchEvent sees the pair.
      if (dx * dx + dy * dy > 16) {
        store.setMode('FREE')
        origin = null
      } else if (!store.isTracking) {
        void cameraControlsRef.current?.moveTo(origin.pivot.x, origin.pivot.y, origin.pivot.z, false)
      }
    }
    const canvas = gl.domElement
    canvas.addEventListener('touchstart', start, { passive: true })
    canvas.addEventListener('touchmove', move, { passive: true })
    canvas.addEventListener('touchend', start, { passive: true })
    canvas.addEventListener('touchcancel', start, { passive: true })
    return () => {
      canvas.removeEventListener('touchstart', start)
      canvas.removeEventListener('touchmove', move)
      canvas.removeEventListener('touchend', start)
      canvas.removeEventListener('touchcancel', start)
    }
  }, [gl])

  // Earth-mode handoffs change the focus, not the camera's world-space position.
  useEffect(() => {
    freeZoomEntryRef.current = null
    const controls = cameraControlsRef.current
    if (!controls) return
    controls.getTarget(_earthCenterTarget, false)
    recenteringEarthRef.current = (mode === 'PLANETARY' || mode === 'ORBITAL')
      && _earthCenterTarget.lengthSq() > 0
    if (recenteringEarthRef.current) {
      recenterFromRef.current.copy(_earthCenterTarget)
      recenterElapsedRef.current = 0
    }
  }, [mode])


  // Run our frame-rate independent camera tracking loop
  useFrame((_, delta) => {
    transitionFrameRef.current = useCameraStore.getState().isTransitioning
    const controls = cameraControlsRef.current
    if (!controls) return
    freeOrbitRef.current?.update(controls, delta, !transitionFrameRef.current)

    // BUG-04: Attach event listeners inside the frame loop once the controls become available
    if (!listenersAttachedRef.current) {
      const cancelActiveFlight = () => {
        const store = useCameraStore.getState()
        if (!store.isTransitioning) return
        // Adopt the rendered pose before handing control back: the flight's
        // rendered orientation diverges from camera-controls' internal world-up
        // state, and an unsynced takeover snaps the roll.
        syncRenderedPoseToControls(controls, camera)
        store.cancelTransition()
        if (flightRef.current) store.setMode('FREE')
        flightRef.current = null
        freeZoomEntryRef.current = null
      }

      const handleControlStart = () => cancelActiveFlight()
      // Wheel gestures never emit controlstart; scrolling must cancel a flight
      // exactly like dragging does.
      const handleWheelCancel = () => cancelActiveFlight()

      const handleControl = () => {
        if (!(controls.currentAction & PAN_ACTIONS)) return
        const store = useCameraStore.getState()
        if (store.isTransitioning || store.mode === 'FREE') return
        controls.getTarget(_panTarget)
        controls.getTarget(_panCurrentTarget, false)
        // Release on intentional pan motion, not after a 10 km threshold that
        // tracking could erase every frame. Rotation and centred pinches keep lock.
        if (_panTarget.distanceToSquared(_panCurrentTarget) > 1e-8) store.setMode('FREE')
      }

      controls.addEventListener('controlstart', handleControlStart)
      controls.addEventListener('control', handleControl)
      gl.domElement.addEventListener('wheel', handleWheelCancel, { passive: true })

      handleControlStartRef.current = handleControlStart
      handleControlRef.current = handleControl
      wheelCancelRef.current = handleWheelCancel
      listenersAttachedRef.current = true
    }


    const state = telemetryManager.lastState
    const renderedISS = issGroupRef.current

    // ISSGroup's useFrame is registered before this controller in SceneRoot, so its
    // transform is already current for this frame. Reading that transform directly
    // guarantees the camera and visible spacecraft use one identical motion sample.
    if (renderedISS) _currentISSPos.copy(renderedISS.position)

    if (isTransitioning && transition && !transition.isCompleted) {
      if (transition.toMode === 'FOLLOW') {
        const detailStatus = useLoadingStore.getState().issDetailStatus
        if (!state || !renderedISS || (detailStatus !== 'ready' && detailStatus !== 'failed')) return

        // Retain the existing radial/in-track ISS arrival framing.
        _transU.copy(_currentISSPos).normalize()
        _transVelocityWorld.set(state.velocityECI.x, state.velocityECI.z, -state.velocityECI.y).normalize()
        _transInTrack.copy(_transU).multiplyScalar(_transVelocityWorld.dot(_transU))
        _transInTrack.subVectors(_transVelocityWorld, _transInTrack).normalize()
        _transCamPos.copy(_currentISSPos)
          .addScaledVector(_transU, 250)
          .addScaledVector(_transInTrack, 250)
      }

      // Capture the real pose once model preparation finishes. Route choice is
      // geometric, independent of Free/Inspect/Orbital labels or a zoom threshold.
      if (flightRef.current?.transition !== transition) {
        const path = new CameraFlightPath(
          controls.getPosition(new THREE.Vector3(), false),
          controls.getTarget(new THREE.Vector3(), false),
        )
        const view = camera.getWorldDirection(new THREE.Vector3())
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
        const horizon = new FlightHorizon(view, up)
        // Navigation carries its up vector across the poles. Flights settle to
        // world-up, but preserve the rendered starting orientation without a snap.
        camera.up.set(0, 1, 0)
        controls.updateCameraUp()
        void controls.setLookAt(
          path.position.x, path.position.y, path.position.z,
          path.target.x, path.target.y, path.target.z, false,
        )
        flightRef.current = {
          transition, path, elapsedMs: 0, horizon,
          // Time scales with the visible work: the route's own estimate, plus
          // the horizon roll to settle — only Reset settles onto world-up;
          // Locate keeps the horizon as transported, so it has no roll debt.
          durationMs: (transition.toMode === 'FOLLOW'
            ? path.planLocate(_transCamPos, _currentISSPos)
            : transition.durationMs)
            + (transition.toMode === 'ORBITAL' ? initialRollErrorRad(view, up) * 250 : 0),
        }
      } else {
        flightRef.current.elapsedMs += Math.min(delta, 0.05) * 1000
      }
      const flight = flightRef.current
      const progress = Math.min(1, flight.elapsedMs / flight.durationMs)

      if (transition.toMode === 'ORBITAL') {
        flight.path.sampleReset(transition.overviewDistanceKm, progress, _flightEye, _flightTarget)
        void controls.setLookAt(
          _flightEye.x, _flightEye.y, _flightEye.z,
          _flightTarget.x, _flightTarget.y, _flightTarget.z, false,
        )
      } else {
        flight.path.sampleLocate(_transCamPos, _currentISSPos, progress, _flightEye, _flightTarget)
        void controls.setLookAt(
          _flightEye.x, _flightEye.y, _flightEye.z,
          _flightTarget.x, _flightTarget.y, _flightTarget.z, false,
        )
      }
      controls.update(0)
      // Horizon: transport with the view. Locate keeps the user's horizon as-is
      // (no forced arrival orientation — forcing it was the end-of-flight roll);
      // Reset still settles onto world-up for a north-up globe overview.
      flight.horizon.update(
        _flightView.subVectors(_flightTarget, _flightEye).normalize(),
        progress, delta, _flightUp,
        transition.toMode === 'ORBITAL' ? 1 : 0,
      )
      _flightLook.lookAt(_flightEye, _flightTarget, _flightUp)
      camera.quaternion.setFromRotationMatrix(_flightLook)
      if (progress === 1) {
        // Hand the rendered orientation to camera-controls (shared with the
        // cancellation path): the flight drove its internal state with a
        // world-up frame, so the next tracking update would otherwise snap the
        // residual roll back on the completion frame.
        syncRenderedPoseToControls(controls, camera)
        // A completed Reset defines the home framing the Reset View button
        // measures deviations against; landing there hides the button again.
        if (transition.toMode === 'ORBITAL') {
          const home = homePoseRef.current ??= {
            eye: new THREE.Vector3(),
            target: new THREE.Vector3(),
          }
          controls.getPosition(home.eye, false)
          controls.getTarget(home.target, false)
        }
        flightRef.current = null
        completeTransition()
      }
      return
    }
    flightRef.current = null
    if (!state || !renderedISS) return

    // ── 1. ACTIVE TRACKING (FOLLOW / INSPECT / APPROACH) ──────────────────────
    if (useCameraStore.getState().isTracking && !isTransitioning) {

      // Tracking can set the target directly; unlike a flight it has no
      // in-progress target interpolation to preserve.
      controls.moveTo(
        _currentISSPos.x,
        _currentISSPos.y,
        _currentISSPos.z,
        false // Direct mutation, no slow transition interpolation
      )

      // JITTER FIX: drei's CameraControls update loop runs at useFrame priority −1,
      // BEFORE ISSGroup advances the spacecraft this frame. Left to its own schedule,
      // the rendered camera would aim one frame behind the rendered ISS, and the
      // interpolation's frame-to-frame step variance (0–160 m) shows up as visible
      // micro-jitter at close range. update(0) re-derives the eye from this frame's
      // target with zero damping, so the rendered camera and the rendered spacecraft
      // move as one rigid body regardless of zoom distance.
      controls.update(0)
    }

    // ── 2. MEASURE AND CATEGORIZE (SCROLL & ZOOM DETECTIONS) ───────────────────
    // Read the controls' authoritative eye after this frame's tracking update.
    controls.getPosition(_currentCameraPos, false)
    const distanceToEarth = _currentCameraPos.length()
    const distanceToISS = _currentCameraPos.distanceTo(_currentISSPos)

    controls.getTarget(_currentTarget, false)
    const navigationMode = useCameraStore.getState().mode
    const pivotDistance = _currentCameraPos.distanceTo(_currentTarget)
    if (navigationMode === 'FREE') freeZoomEntryRef.current ??= pivotDistance
    else freeZoomEntryRef.current = null
    const freeZoomOut = navigationMode === 'FREE'
      && CameraStateMachine.isFreeZoomOut(pivotDistance, freeZoomEntryRef.current!)
    const zoomProgress = CameraStateMachine.getZoomProgress(pivotDistance)

    // NEW-07: Throttle Zustand writes inside frame loop to prevent 60 FPS panel re-renders
    const currentProgress = useCameraStore.getState().zoomProgress
    if (Math.abs(zoomProgress - currentProgress) > 0.01) {
      setZoomProgress(zoomProgress)
    }

    // Auto-transition zoom levels instantly when the user is NOT in an active programmatic transition
    if (!isTransitioning) {
      const targetMode = CameraStateMachine.determineModeFromDistance(
        distanceToEarth,
        distanceToISS,
        navigationMode,
        freeZoomOut
      )

      if (targetMode !== navigationMode) {
        // Safe programmatic mode updates
        setMode(targetMode)
      }
    }

  })

  // Runs after tracking above and before R3F renders. Keep this outside the
  // telemetry-dependent branch: Free/Earth navigation must be safe without a fix.
  useFrame((_, delta) => {
    const controls = cameraControlsRef.current
    if (!controls) return
    if (transitionFrameRef.current) {
      navigation.reset(controls)
      return
    }
    const navigationMode = useCameraStore.getState().mode
    if (recenteringEarthRef.current && (navigationMode === 'PLANETARY' || navigationMode === 'ORBITAL')) {
      controls.getPosition(_earthCenterPos, false)
      controls.getPosition(_earthCenterEndPos)
      // A fixed-duration eased glide instead of an exponential decay: the decay
      // moves fastest on its first frame and reads as a kick at the Free→Earth
      // handoff. easeInOutCubic starts and ends at zero velocity.
      recenterElapsedRef.current += Math.min(delta, 0.1)
      const t = Math.min(1, recenterElapsedRef.current / 1.2)
      _earthCenterTarget.copy(recenterFromRef.current).multiplyScalar(1 - easeInOutCubic(t))
      if (t >= 1) {
        _earthCenterTarget.set(0, 0, 0)
        recenteringEarthRef.current = false
      }
      // Preserve both the rendered eye and any queued user zoom while easing
      // the pivot to Earth. Spherical target interpolation alone swings the eye.
      void controls.setLookAt(
        _earthCenterPos.x, _earthCenterPos.y, _earthCenterPos.z,
        _earthCenterTarget.x, _earthCenterTarget.y, _earthCenterTarget.z, false,
      )
      void controls.setLookAt(
        _earthCenterEndPos.x, _earthCenterEndPos.y, _earthCenterEndPos.z,
        _earthCenterTarget.x, _earthCenterTarget.y, _earthCenterTarget.z, true,
      )
      controls.update(0)
    }
    navigation.update(controls, navigationMode === 'FREE')
    controls.getTarget(_currentTarget, false)
    applyNavigationSensitivity(
      controls, camera.position.length(), camera.position.distanceTo(_currentTarget),
      _currentTarget.length(), Math.min(delta, 0.1),
    )

    // Reset View appears the moment the view leaves its home framing and hides
    // again when a Reset (or an exact manual return) restores it. Written only
    // on change; the pose comparison is frame-cheap. Level horizon is judged on
    // the camera's right vector: world-up itself tilts with latitude when
    // looking at Earth's center, so it is not a usable roll reference. The
    // viewport-fit condition keeps the button honest across resizes — a home
    // pose captured on desktop no longer fits a portrait viewport.
    const home = homePoseRef.current ??= {
      eye: controls.getPosition(new THREE.Vector3(), false),
      target: controls.getTarget(new THREE.Vector3(), false),
    }
    controls.getPosition(_currentCameraPos, false)
    _rightVec.set(1, 0, 0).applyQuaternion(camera.quaternion)
    const isHome = _currentCameraPos.distanceToSquared(home.eye) < 1
      && _currentTarget.distanceToSquared(home.target) < 1
      && Math.abs(_rightVec.y) < 0.02
      && _currentCameraPos.length() >= CameraStateMachine.earthFitDistanceForViewport(
        camera as THREE.PerspectiveCamera,
      ) - 1
    const store = useCameraStore.getState()
    if (store.isHomeView !== isHome) store.setHomeView(isHome)
  })

  // Drei updates controls at priority -1. Our commands run after ISSGroup's
  // position update and explicitly flush with update(0) before rendering.

  return null
})
