import React, { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { useCameraStore } from '@/stores/cameraStore'
import { FRAME_PRIORITY } from '@/rendering/framePriority'
import { easeShift, framingShiftPx, type ScreenRect } from './hudFraming'

/**
 * HUD clusters that cover the canvas. Popovers are left out on purpose: they
 * are transient and the view should not jump when one opens. The tape counts
 * by its visible line, not its (taller, mostly transparent) hit area.
 */
const HUD_SELECTORS = [
  '.hud-corner--tl',
  '.hud-corner--tr',
  '.hud-camera',
  '.hud-bottom-left',
  '.hud-bottom-center',
  '.hud-bottom-right',
  '.hud-tape__line',
]

/** Backstop re-measure: cluster contents change size at 1 Hz at most. */
const MEASURE_INTERVAL_MS = 1000

function measureTargetShift(): number {
  if (document.documentElement.classList.contains('hud-hidden')) return 0
  const rects: ScreenRect[] = []
  for (const selector of HUD_SELECTORS) {
    const element = document.querySelector(selector)
    if (!element) continue
    const { left, top, right, bottom } = element.getBoundingClientRect()
    rects.push({ left, top, right, bottom })
  }
  return framingShiftPx({ width: window.innerWidth, height: window.innerHeight }, rects)
}

/**
 * HudAwareFraming — plan 017 R2. While the camera tracks the station (or
 * flies to it), shift the projection so the station, which tracking holds at
 * the optical centre, sits in the middle of the canvas area the HUD leaves
 * free instead of under the clock on a portrait phone.
 *
 * Projection only: `camera.setViewOffset` moves the image, not the camera or
 * its target, so the frame-order contract (ISSGroup −2 → CameraControls −1 →
 * CameraController retarget + update(0)) and every pose read stay untouched.
 * The shift eases in and out so a mode change never cuts the view.
 *
 * The target shift is measured from the DOM on resize, orientation change,
 * the H toggle (a class on <html>) and once a second; the frame loop only
 * eases toward the cached number.
 */
export const HudAwareFraming = React.memo(function HudAwareFraming(): null {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const size = useThree((state) => state.size)
  const targetRef = useRef(0)
  const currentRef = useRef(0)
  const appliedRef = useRef({ shift: 0, width: 0, height: 0 })

  useEffect(() => {
    const measure = (): void => {
      targetRef.current = measureTargetShift()
    }
    measure()
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    const observer = new MutationObserver(measure)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const interval = window.setInterval(measure, MEASURE_INTERVAL_MS)
    return () => {
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      observer.disconnect()
      window.clearInterval(interval)
    }
  }, [])

  // The camera outlives this component only in theory; never leave a stale
  // offset behind on it.
  useEffect(() => () => {
    camera.clearViewOffset()
  }, [camera])

  useFrame((_, delta) => {
    const store = useCameraStore.getState()
    const framingStation = store.isTracking
      || (store.isTransitioning && store.transition?.toMode === 'FOLLOW')
    const target = framingStation ? targetRef.current : 0
    const shift = easeShift(currentRef.current, target, Math.min(delta, 0.1))
    currentRef.current = shift

    const applied = appliedRef.current
    const width = Math.round(size.width)
    const height = Math.round(size.height)
    if (applied.shift === shift && applied.width === width && applied.height === height) return
    applied.shift = shift
    applied.width = width
    applied.height = height
    if (shift === 0 || width === 0 || height === 0) {
      camera.clearViewOffset()
    } else {
      // A full-size window displaced down by `shift` within the full frame:
      // the optical centre lands `shift` px above the canvas centre.
      camera.setViewOffset(width, height, 0, shift, width, height)
    }
  }, FRAME_PRIORITY.viewOffset)

  return null
})
