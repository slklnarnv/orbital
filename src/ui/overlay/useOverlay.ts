import { useCallback, useEffect, useRef, type MouseEvent } from 'react'
import {
  closeOverlay,
  focusInitial,
  registerOverlayTrigger,
  toggleOverlay,
  useOverlayStore,
  type OverlayId,
} from './overlay'

export interface OverlayHandle<T extends HTMLElement> {
  isOpen: boolean
  triggerRef: React.RefObject<T>
  panelRef: React.RefObject<HTMLDivElement>
  /** onClick for the trigger: a keyboard click (detail 0) moves focus in. */
  onTriggerClick: (event: MouseEvent) => void
}

/**
 * Binds one HUD popover or panel to the shared overlay store: registers its
 * trigger for focus return, moves focus in on a keyboard open, and closes on
 * a pointerdown outside both the panel and the trigger.
 */
export function useOverlay<T extends HTMLElement = HTMLButtonElement>(
  id: OverlayId,
  initialFocus: 'first' | 'panel' = 'first',
): OverlayHandle<T> {
  const isOpen = useOverlayStore((state) => state.open === id)
  const triggerRef = useRef<T>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => registerOverlayTrigger(id, triggerRef.current), [id])

  useEffect(() => {
    if (!isOpen) return
    if (useOverlayStore.getState().focusIn) focusInitial(panelRef.current, initialFocus)
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      closeOverlay({ restoreFocus: false })
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen, initialFocus])

  const onTriggerClick = useCallback(
    (event: MouseEvent) => toggleOverlay(id, { focusIn: event.detail === 0 }),
    [id],
  )

  return { isOpen, triggerRef, panelRef, onTriggerClick }
}
