import { useEffect } from 'react'
import { useCameraStore } from '@/stores/cameraStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { requestResetView } from '@/interaction/camera/resetView'
import { closeOverlay, isModalOpen, toggleOverlay, useOverlayStore } from '../overlay/overlay'
import { describeTarget, matchShortcut, type ShortcutAction } from './shortcutRegistry'

/**
 * Hides the whole HUD for an unobstructed view — presentation mode, or a
 * clean screenshot. The 3D scene keeps rendering; only the overlay layers
 * are hidden.
 *
 * The hidden state lives on `document.documentElement` (not in React)
 * because `App` deliberately never re-renders: the scene must not be rebuilt
 * for a UI concern. CSS does the rest — `.hud-hidden` hides the HUD layers
 * and nothing else. Deliberately NOT persisted: a reload restores the HUD,
 * so a key press can never leave someone staring at a chrome-less screen.
 */
function toggleHud(): void {
  const hidden = document.documentElement.classList.toggle('hud-hidden')
  // A popover left open would sit invisible, holding focus.
  if (hidden && !isModalOpen()) closeOverlay({ restoreFocus: false })
}

function run(action: ShortcutAction): void {
  switch (action.kind) {
    case 'togglePause':
      useSimulationStore.getState().togglePause()
      return
    case 'toggleHud':
      toggleHud()
      return
    case 'locate':
      useCameraStore.getState().triggerLocateISS()
      return
    case 'resetView':
      requestResetView()
      return
    case 'rate':
      useSimulationStore.getState().setRate(action.rate)
      return
    case 'live':
      useSimulationStore.getState().setMode('REALTIME')
      return
    case 'toggleOverlay':
      // A keyboard open moves focus into the panel.
      toggleOverlay(action.overlay, { focusIn: true })
      return
    case 'close':
      closeOverlay()
      return
  }
}

/**
 * The single global keydown handler for the shortcut registry
 * (`shortcutRegistry.ts`). Mounted once, by the HUD.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A control that handled the key itself (tape arrows, radio groups,
      // the place search) has the last word.
      if (event.defaultPrevented) return
      const shortcut = matchShortcut(event, describeTarget(event.target), { modalOpen: isModalOpen() })
      if (shortcut === null) return
      // Escape with nothing open stays the browser's (exit full screen…).
      if (shortcut.action.kind === 'close' && useOverlayStore.getState().open === null) return
      event.preventDefault()
      // Held keys auto-repeat keydown; one press is one action.
      if (event.repeat) return
      run(shortcut.action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
