import type { PerspectiveCamera } from 'three'
import { useCameraStore } from '@/stores/cameraStore'
import { cameraControlsRef } from '@/rendering/scene/cameraControlsRef'
import { CameraStateMachine } from './CameraStateMachine'

/**
 * Flies home to the Earth overview framed for the current viewport. Shared
 * by the Reset View button and the `R` shortcut; a no-op until the camera
 * controls have mounted.
 */
export function requestResetView(): void {
  const controls = cameraControlsRef.current
  if (!controls) return
  const camera = controls.camera as PerspectiveCamera
  useCameraStore
    .getState()
    .triggerResetView(CameraStateMachine.overviewDistanceForViewport(camera, controls.maxDistance))
}
