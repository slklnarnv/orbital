import type { PerspectiveCamera } from 'three'
import { useCameraStore } from '@/stores/cameraStore'
import { useExplorerStore } from '@/stores/explorerStore'
import { cameraControlsRef } from '@/rendering/scene/cameraControlsRef'
import { CameraStateMachine } from './CameraStateMachine'

/**
 * Flies home to the Earth overview framed for the current viewport. Shared
 * by the Reset View button and the `R` shortcut; a no-op until the camera
 * controls have mounted. Going home also drops a pending Modules open, so a
 * later Locate does not open the explorer unasked.
 */
export function requestResetView(): void {
  useExplorerStore.getState().cancelOpenOnArrival()
  const controls = cameraControlsRef.current
  if (!controls) return
  const camera = controls.camera as PerspectiveCamera
  useCameraStore
    .getState()
    .triggerResetView(CameraStateMachine.overviewDistanceForViewport(camera, controls.maxDistance))
}
