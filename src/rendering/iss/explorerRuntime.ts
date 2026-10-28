// ─── explorerRuntime — per-frame module explorer state shared across tiers ───
//
// Like `sharedJointStates`, this lives outside React so the explode progress
// and the focus survive a tier swap (Locate LOD ⇄ full model) and so the rig,
// the cached shadow and the camera read one value per frame. The progress is
// advanced once per frame by whichever caller ticks first (the frame time is
// the key), so the order of the callers does not matter.

import * as THREE from 'three'
import { useExplorerStore } from '@/stores/explorerStore'
import { EXPLODE_DURATION_S, advanceProgress, explodeEase } from './moduleExplorer'

export interface FocusAnchor {
  moduleId: string
  /** Object the focus point is carried in (moves with explode and joints). */
  anchor: THREE.Object3D
  /** Focus point in the anchor's local frame. */
  local: THREE.Vector3
  /** Identifies the publishing model instance. */
  owner: object
}

export interface ExplorerPointer {
  /** Pointer in normalized device coordinates. */
  ndc: THREE.Vector2
  /** Over the canvas with a hover-capable pointer (mouse, pen). */
  hovering: boolean
  /** A button is held (orbiting, panning): no hover picking. */
  down: boolean
  /** Moved since the last hover pick. */
  moved: boolean
  /** A click (press and release without a drag) waiting to be picked. */
  click: THREE.Vector2 | null
}

export const explorerRuntime = {
  /** Linear explode progress 0…1 and its eased value. */
  progress: 0,
  eased: 0,
  frameTime: Number.NaN,
  reducedMotion: false,
  focusAnchor: null as FocusAnchor | null,
  pointer: {
    ndc: new THREE.Vector2(),
    hovering: false,
    down: false,
    moved: false,
    click: null,
  } as ExplorerPointer,
}

let reducedMotionQuery: MediaQueryList | null | undefined

/** Read per frame so an OS toggle applies at once; guarded for Node. */
function prefersReducedMotion(): boolean {
  if (reducedMotionQuery === undefined) {
    reducedMotionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
  }
  return reducedMotionQuery?.matches ?? false
}

/** Advance the explode toward the store's request (idempotent per frame). */
export function tickExplorer(frameTime: number, wallDeltaSec: number): void {
  if (frameTime === explorerRuntime.frameTime) return
  explorerRuntime.frameTime = frameTime
  explorerRuntime.reducedMotion = prefersReducedMotion()
  const target = useExplorerStore.getState().exploded ? 1 : 0
  explorerRuntime.progress = advanceProgress(
    explorerRuntime.progress, target, wallDeltaSec, EXPLODE_DURATION_S, explorerRuntime.reducedMotion,
  )
  explorerRuntime.eased = explodeEase(explorerRuntime.progress)
}

/** Joints park while the station is exploded or exploding. */
export function explorerParked(): boolean {
  return useExplorerStore.getState().exploded || explorerRuntime.progress > 0
}

/** Clicks move less than this (CSS px) between press and release. */
const CLICK_SLOP_PX = 5

/** Canvas pointer listeners feeding `explorerRuntime.pointer`; returns the cleanup. */
export function attachExplorerPointer(canvas: HTMLCanvasElement): () => void {
  const pointer = explorerRuntime.pointer
  let press: { x: number; y: number; id: number } | null = null
  const toNdc = (event: PointerEvent, out: THREE.Vector2): THREE.Vector2 => {
    const rect = canvas.getBoundingClientRect()
    return out.set(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    )
  }
  const move = (event: PointerEvent) => {
    pointer.hovering = event.pointerType !== 'touch'
    toNdc(event, pointer.ndc)
    pointer.moved = true
  }
  const down = (event: PointerEvent) => {
    pointer.down = true
    press = event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null
  }
  const up = (event: PointerEvent) => {
    pointer.down = false
    if (press && press.id === event.pointerId
      && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= CLICK_SLOP_PX) {
      pointer.click = toNdc(event, new THREE.Vector2())
    }
    press = null
  }
  const leave = () => {
    pointer.hovering = false
    pointer.moved = true
  }
  const cancel = () => {
    pointer.down = false
    press = null
  }
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointerleave', leave)
  canvas.addEventListener('pointercancel', cancel)
  return () => {
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointerleave', leave)
    canvas.removeEventListener('pointercancel', cancel)
    pointer.hovering = false
    pointer.down = false
    pointer.click = null
  }
}
