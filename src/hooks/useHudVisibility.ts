import { useEffect } from 'react'

/**
 * Keyboard shortcut that hides the whole HUD for an unobstructed view —
 * presentation mode, or a clean screenshot. The 3D scene keeps rendering;
 * only the overlay layers are hidden.
 *
 * `H` toggles. The hidden state lives on `document.documentElement` (not in
 * React) because `App` deliberately never re-renders: the scene must not be
 * rebuilt for a UI concern. CSS does the rest — `.hud-hidden` hides the HUD
 * layers and nothing else.
 *
 * Deliberately NOT persisted: a reload restores the HUD, so a shortcut press
 * can never leave someone staring at a chrome-less screen with no way back.
 * (The shortcut is also the way back, but discoverability is the point.)
 */
export function useHudVisibility(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyH') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // Typing keeps its letters: inputs, textareas and contentEditable.
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      document.documentElement.classList.toggle('hud-hidden')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
