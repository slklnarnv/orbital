import { useCameraStore } from '@/stores/cameraStore'
import { useExplorerStore } from '@/stores/explorerStore'

/**
 * The Modules control (button and `M`): toggles the explorer while the
 * station is tracked; from anywhere else it flies there first (Locate) and
 * the explorer opens on arrival, so the control is never a dead end.
 */
export function toggleModuleExplorer(): void {
  const explorer = useExplorerStore.getState()
  if (explorer.open) {
    explorer.setOpen(false)
    return
  }
  if (explorer.availability !== 'hidden') {
    explorer.setOpen(true)
    return
  }
  explorer.requestOpenOnArrival(Date.now())
  useCameraStore.getState().triggerLocateISS()
}
