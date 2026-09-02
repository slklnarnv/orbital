import React, { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'

import { useCameraStore } from '@/stores/cameraStore'
import { CameraStateMachine } from './CameraStateMachine'
import { applyRotationSensitivity } from './CameraSensitivity'
import { cameraControlsRef } from '@/rendering/scene/cameraControlsRef'
import { telemetryManager } from '@/core/telemetry/TelemetryManager'

// ─── Hoisted Static Vectors to Achieve Complete Zero-GC Frame Loops ──────────
const _earthCenterTarget = new THREE.Vector3()
const _earthCenterPos = new THREE.Vector3()
const _earthCenterDirection = new THREE.Vector3()
const _earthCenterNewCamPos = new THREE.Vector3()

const _transIssPos = new THREE.Vector3()
const _transVelocityWorld = new THREE.Vector3()
const _transU = new THREE.Vector3()
const _transInTrack = new THREE.Vector3()
const _transCamPos = new THREE.Vector3()

const _currentISSPos = new THREE.Vector3()
const _currentTarget = new THREE.Vector3()
const _currentCameraPos = new THREE.Vector3()

// ─── Floating Origin Shift (Phase 3 Scaffolding) ────────────────────────────────
/**
 * Scaffolding interface for future Phase 3 precision origin shift.
 * At extremely close inspect distances (< 100 km), float32 precision degrades,
 * requiring the scene graph to center around the ISS at (0,0,0) with Earth offset.
 *
 * Defined at module scope (not inside the component) to avoid recreating the
 * function reference on every render, which would introduce stale-closure risk
 * inside useFrame.
 */
function handleFloatingOriginShift(_distanceToISSKm: number): void {
  if (_distanceToISSKm < 100) {
    // Future Phase 3 hook trigger boundary
    // Trigger a store event or emit a warning if drift exceeds acceptable limits
  }
}

interface CameraControllerProps {
  issGroupRef: RefObject<THREE.Group>
}

export const CameraController = React.memo(function CameraController({
  issGroupRef,
}: CameraControllerProps): null {
  const { camera } = useThree()

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

  // Flag to lock and prevent auto-transitions while user is actively navigating
  const isUserNavigatingRef = useRef<boolean>(false)

  // BUG-04: Track listener registration status and callback references to ensure clean setup and tear down
  const listenersAttachedRef = useRef(false)
  const handleControlStartRef = useRef<(() => void) | null>(null)
  const handleControlEndRef = useRef<(() => void) | null>(null)

  // Unsubscribe listeners cleanly on unmount
  useEffect(() => {
    return () => {
      const controls = cameraControlsRef.current
      if (controls) {
        if (handleControlStartRef.current) {
          controls.removeEventListener('controlstart', handleControlStartRef.current)
        }
        if (handleControlEndRef.current) {
          controls.removeEventListener('controlend', handleControlEndRef.current)
        }
      }
    }
  }, [])

  // Trigger smooth centering of Earth when returning to PLANETARY/ORBITAL from tracking modes.
  // This shifts the camera look-at target back to Earth center (0,0,0) smoothly,
  // resolving off-center globe bugs and ensuring planetary manual rotation is centered.
  useEffect(() => {
    const controls = cameraControlsRef.current
    if (!controls) return

    if (mode === 'PLANETARY' || mode === 'ORBITAL') {
      controls.getTarget(_earthCenterTarget)

      if (_earthCenterTarget.length() > 10) { // If offset is significant (Earth center is 0,0,0)
        controls.getPosition(_earthCenterPos)

        // Calculate new camera position centered around Earth, keeping the same relative distance
        const dist = _earthCenterPos.distanceTo(_earthCenterTarget)
        _earthCenterDirection.subVectors(_earthCenterPos, _earthCenterTarget).normalize()
        _earthCenterNewCamPos.copy(_earthCenterDirection).multiplyScalar(dist)

        void controls.setLookAt(
          _earthCenterNewCamPos.x, _earthCenterNewCamPos.y, _earthCenterNewCamPos.z, // Center-adjusted eye position
          0, 0, 0,                                                                  // Earth center look-at
          true                                                                      // Smooth transition
        )
      }
    }
  }, [mode])

  // Handle active programmatic transitions
  useEffect(() => {
    let cancelled = false
    const controls = cameraControlsRef.current
    if (!controls || !transition || transition.isCompleted) return

    const state = telemetryManager.lastState
    if (!state) {
      // CAM-4 FIX: Must call completeTransition() on ALL early-return paths.
      // Returning without it permanently latches isTransitioning=true, which disables
      // both the tracking branch and auto-transitions with no recovery path.
      completeTransition()
      return
    }

    const renderedISS = issGroupRef.current
    if (!renderedISS) {
      completeTransition()
      return
    }

    // Start from the exact position rendered by ISSGroup. CameraController reads
    // this same transform every frame, so the cinematic destination can keep moving
    // with the spacecraft instead of becoming stale during the two-second flight.
    _transIssPos.copy(renderedISS.position)

    const vx = state.velocityECI.x
    const vy = state.velocityECI.z
    const vz = -state.velocityECI.y
    _transVelocityWorld.set(vx, vy, vz).normalize()

    if (transition.toMode === 'FOLLOW') {
      // Oblique RIC (Radial, In-track, Cross-track) Cinematic & Spatially Coherent Framing:
      // Instead of looking straight down radially (which stretches Earth textures and flattens the view),
      // we offset the camera obliqely in the orbital plane using the radial vector and velocity direction.
      // This naturally captures the Earth's curvature, the glowing blue atmospheric limb,
      // and silhouettes the detailed ISS against the deep starfield.
      const issDistFromCenter = _transIssPos.length()
      if (issDistFromCenter < 1) {
        // CAM-4 FIX: Also call completeTransition() on this early-return path.
        completeTransition()
        return
      }

      _transU.copy(_transIssPos).normalize() // Radial Vertical Vector
      // Project velocity to be strictly orthogonal to U in the orbital plane (In-track)
      _transInTrack.copy(_transU).multiplyScalar(_transVelocityWorld.dot(_transU))
      _transInTrack.subVectors(_transVelocityWorld, _transInTrack).normalize()

      // Oblique offset: 250 km radially outwards, 250 km tangentially ahead along the orbit path.
      // Total distance = sqrt(250^2 + 250^2) = 353 km (stably within the 200-3,000 km FOLLOW range).
      const offsetRadial = 250
      const offsetInTrack = 250
      _transCamPos.copy(_transIssPos)
        .addScaledVector(_transU, offsetRadial)
        .addScaledVector(_transInTrack, offsetInTrack)

      // CameraControls owns the safe spherical cinematic. The frame loop below
      // translates its target with the rendered ISS while this flight settles.
      void controls.setLookAt(
        _transCamPos.x, _transCamPos.y, _transCamPos.z,
        _transIssPos.x, _transIssPos.y, _transIssPos.z,
        true,
      ).then(() => {
        if (!cancelled) {
          completeTransition()
        }
      })
    } else {
      // Generic transition handling for other modes if needed
      if (!cancelled) {
        completeTransition()
      }
    }

    return () => {
      cancelled = true
    }
  }, [transition, completeTransition, issGroupRef])

  // Run our frame-rate independent camera tracking loop
  useFrame(() => {
    const controls = cameraControlsRef.current
    if (!controls) return

    // BUG-04: Attach event listeners inside the frame loop once the controls become available
    if (!listenersAttachedRef.current) {
      const handleControlStart = () => {
        isUserNavigatingRef.current = true

        // If the user starts panning, zooming, or manual drag while in an active transition flight,
        // they are explicitly canceling the flight. Release the transition lock in the store
        // instantly so that active target follow locks and auto-transitions take over without lag!
        const store = useCameraStore.getState()
        if (store.isTransitioning) {
          store.completeTransition()
        }
      }

      const handleControlEnd = () => {
        isUserNavigatingRef.current = false
      }

      controls.addEventListener('controlstart', handleControlStart)
      controls.addEventListener('controlend', handleControlEnd)

      handleControlStartRef.current = handleControlStart
      handleControlEndRef.current = handleControlEnd
      listenersAttachedRef.current = true
    }

    // camera-controls maps pointer movement to a fixed angular rotation. Scale
    // only Earth-focused rotation by camera clearance so close navigation remains
    // precise. Truck/pan already scales with target distance inside camera-controls.
    const renderedDistanceToEarth = camera.position.length()
    applyRotationSensitivity(controls, mode, renderedDistanceToEarth)

    const state = telemetryManager.lastState
    const renderedISS = issGroupRef.current
    if (!state || !renderedISS) return

    // ISSGroup's useFrame is registered before this controller in SceneRoot, so its
    // transform is already current for this frame. Reading that transform directly
    // guarantees the camera and visible spacecraft use one identical motion sample.
    _currentISSPos.copy(renderedISS.position)

    // Keep the cinematic's focus attached to the exact rendered spacecraft. moveTo
    // translates the current and end target together while preserving CameraControls'
    // in-progress spherical camera interpolation, eliminating the handoff catch-up.
    if (isTransitioning && transition?.toMode === 'FOLLOW') {
      void controls.moveTo(
        _currentISSPos.x,
        _currentISSPos.y,
        _currentISSPos.z,
        false,
      )
    }

    // ── 1. ACTIVE TRACKING (FOLLOW / INSPECT / APPROACH) ──────────────────────
    if ((mode === 'FOLLOW' || mode === 'INSPECT' || mode === 'APPROACH') && !isTransitioning) {
      if (isUserNavigatingRef.current) {
        // Check if the user is actively panning (right-click dragging target away)
        controls.getTarget(_currentTarget)
        const panDistance = _currentTarget.distanceTo(_currentISSPos)

        // If the user right-click drags/pans the target away by more than 10 km, they break active lock
        if (panDistance > 10) {
          setMode('FREE')
          isUserNavigatingRef.current = false
          return
        }
      }

      // Directly move the controls focus to the exact current ISS position.
      // This shifts both the target and camera position in lockstep every frame,
      // completely eliminating target drift/offset and locking target focus perfectly 
      // without jitter while keeping manual orbits and zoom distance completely intact.
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
    // CameraControls applies commands later in this frame. Read its authoritative
    // end position so mode classification observes the tracking command we just
    // issued rather than the previous rendered camera pose and dropping the lock.
    controls.getPosition(_currentCameraPos)
    const distanceToEarth = _currentCameraPos.length()
    const distanceToISS = _currentCameraPos.distanceTo(_currentISSPos)

    // Calculate normalized progress (0-1) for UI meters
    const zoomProgress = CameraStateMachine.getZoomProgress(distanceToEarth, distanceToISS, mode)

    // NEW-07: Throttle Zustand writes inside frame loop to prevent 60 FPS panel re-renders
    const currentProgress = useCameraStore.getState().zoomProgress
    if (Math.abs(zoomProgress - currentProgress) > 0.01) {
      setZoomProgress(zoomProgress)
    }

    // Auto-transition zoom levels instantly when the user is NOT in an active programmatic transition
    if (!isTransitioning && mode !== 'FREE') {
      const targetMode = CameraStateMachine.determineModeFromDistance(
        distanceToEarth,
        distanceToISS,
        mode
      )

      if (targetMode !== mode) {
        // Safe programmatic mode updates
        setMode(targetMode)
      }
    }

    // ── 3. FLOATING ORIGIN PREPARATION HOOK (SCAFFOLDED) ──────────────────────
    handleFloatingOriginShift(distanceToISS)
  })

  // MOUNT ORDER NOTE: AppCameraControls (which owns the CameraControls instance and
  // populates cameraControlsRef) is declared AFTER CameraController in SceneRoot's JSX.
  // CameraControls.update() is called by Drei's internal loop, which runs after all
  // useFrame hooks registered in JSX order. CameraController's moveTo() mutations are
  // therefore always flushed before AppCameraControls.update() executes — preserving
  // deterministic frame-loop ordering. This implicit dependency MUST be maintained.

  return null
})
