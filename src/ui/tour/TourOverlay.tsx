import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useBootStore } from '@/stores/bootStore'
import { useHudStore } from '@/stores/hudStore'
import { assetsSettled } from '../loading/bootProgress'
import { HudPanel } from '../overlay/HudPanel'
import { closeOverlay, openOverlay, useOverlayStore } from '../overlay/overlay'
import { useOverlay } from '../overlay/useOverlay'
import {
  TOUR_STEPS,
  markTourSeen,
  placeCard,
  readTourSeen,
  spotlightBox,
  type Box,
} from './tourSteps'

/** After the assets settle: the loading screen's hold and fade, plus a beat. */
const OFFER_DELAY_MS = 2_000

interface Layout {
  spot: Box | null
  card: { left: number; top: number }
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function measureTarget(selector: string | null): Box | null {
  if (selector === null) return null
  const element = document.querySelector(selector)
  if (element === null) return null
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0 || getComputedStyle(element).visibility === 'hidden') return null
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function sameLayout(a: Layout | null, b: Layout): boolean {
  if (a === null) return false
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 0.5
  const spots = a.spot === null || b.spot === null
    ? a.spot === b.spot
    : near(a.spot.left, b.spot.left) && near(a.spot.top, b.spot.top)
      && near(a.spot.width, b.spot.width) && near(a.spot.height, b.spot.height)
  return spots && near(a.card.left, b.card.left) && near(a.card.top, b.card.top)
}

/**
 * The guided tour: a spotlight on one control at a time and a step card
 * beside it. Offered once, on the first visit, after the loading screen;
 * replayable from About and the `?` overlay. Modal (the other shortcuts
 * pause), Escape or Close ends it, arrow keys step through it.
 */
export function TourOverlay(): JSX.Element | null {
  const { isOpen, panelRef } = useOverlay('tour', 'panel')
  const [index, setIndex] = useState(0)
  const [layout, setLayout] = useState<Layout | null>(null)
  const layoutRef = useRef<Layout | null>(null)
  const wasOpen = useRef(false)

  // First visit: offer the tour once the scene is up and nothing else is open.
  const settled = useBootStore((state) => assetsSettled(state.assets))
  useEffect(() => {
    if (!settled || readTourSeen(storage())) return
    const id = setTimeout(() => {
      if (useOverlayStore.getState().open !== null || useHudStore.getState().hidden) return
      openOverlay('tour', { focusIn: true })
    }, OFFER_DELAY_MS)
    return () => clearTimeout(id)
  }, [settled])

  // Every way out (Close, Escape, Done, a click outside) counts as seen;
  // every way in starts at the first step.
  useEffect(() => {
    if (isOpen) setIndex(0)
    else if (wasOpen.current) markTourSeen(storage())
    wasOpen.current = isOpen
  }, [isOpen])

  // Follow the target while the step is up: the HUD can reflow (a status
  // line changes width, the window resizes) and the card must track it.
  const step = TOUR_STEPS[index]
  useEffect(() => {
    if (!isOpen) {
      layoutRef.current = null
      setLayout(null)
      return
    }
    let frame = 0
    const update = (): void => {
      const panel = panelRef.current
      if (panel !== null) {
        const viewport = { width: window.innerWidth, height: window.innerHeight }
        const target = measureTarget(step.target)
        const spot = target === null ? null : spotlightBox(target, viewport)
        const next = { spot, card: placeCard(spot, { width: panel.offsetWidth, height: panel.offsetHeight }, viewport) }
        if (!sameLayout(layoutRef.current, next)) {
          layoutRef.current = next
          setLayout(next)
        }
      }
      frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [isOpen, step, panelRef])

  if (!isOpen) return null

  const last = index === TOUR_STEPS.length - 1
  const next = (): void => {
    if (last) closeOverlay()
    else setIndex(index + 1)
  }
  const back = (): void => setIndex(Math.max(0, index - 1))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight') next()
    else if (event.key === 'ArrowLeft') back()
    else return
    event.preventDefault()
  }

  return (
    <>
      {layout?.spot
        ? (
          <div
            aria-hidden="true"
            className="hud-tour-spot"
            style={{ left: layout.spot.left, top: layout.spot.top, width: layout.spot.width, height: layout.spot.height }}
          />
        )
        : <div aria-hidden="true" className="hud-panel-backdrop" />}
      <HudPanel
        title={step.title}
        panelRef={panelRef}
        className="hud-panel--tour"
        modal
        onKeyDown={onKeyDown}
        // Transparent until measured, so the first frame never flashes at 0,0
        // (not visibility: hidden, which would refuse the keyboard focus).
        style={layout ? { left: layout.card.left, top: layout.card.top } : { opacity: 0 }}
      >
        <p className="hud-panel__body hud-tour__body" aria-live="polite">{step.body}</p>
        <div className="hud-panel__foot hud-tour__foot">
          <span className="hud-fine" style={{ color: 'var(--hud-lo)' }}>
            {`${index + 1} of ${TOUR_STEPS.length}`}
          </span>
          <span className="hud-tour__actions">
            {index > 0 && (
              <button type="button" className="hud-label hud-btn-text" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="hud-label hud-option hud-option--compact hud-option--on" onClick={next}>
              {index === 0 ? 'Start tour' : last ? 'Done' : 'Next'}
            </button>
          </span>
        </div>
      </HudPanel>
    </>
  )
}
