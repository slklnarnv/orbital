import { useId, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { closeOverlay, focusableWithin } from './overlay'

interface HudPanelProps {
  title: string
  panelRef: RefObject<HTMLDivElement>
  className: string
  /** Holds Tab inside the panel (the help overlay). */
  modal?: boolean
  children: ReactNode
}

/** Tab and Shift+Tab wrap inside a modal panel instead of leaving it. */
function trapTab(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return
  const focusable = focusableWithin(event.currentTarget)
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || active === event.currentTarget)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * The frame shared by the text panels of the overlay system — About and the
 * keyboard-shortcut overlay: a titled dialog with a Close control. The panel
 * itself takes focus on a keyboard open (tabIndex −1), so a screen reader
 * announces the title before the content.
 */
export function HudPanel({ title, panelRef, className, modal = false, children }: HudPanelProps): JSX.Element {
  const titleId = useId()
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`hud-panel ${className} hud-text`}
      data-overlay=""
      onKeyDown={modal ? trapTab : undefined}
    >
      <div className="hud-panel__head">
        <h2 id={titleId} className="hud-panel__title">{title}</h2>
        <button
          type="button"
          className="hud-label hud-btn-text"
          aria-keyshortcuts="Escape"
          onClick={() => closeOverlay()}
        >
          Close
        </button>
      </div>
      {children}
    </div>
  )
}
