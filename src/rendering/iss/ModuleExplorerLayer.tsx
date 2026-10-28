// ─── ModuleExplorerLayer — picking, highlight and explode for one IGOAL tier ─
//
// Mounted beside ISSAnimations in every IGOAL detail instance. Each instance
// indexes its own cloned scene (moduleExplorer.ts); only the VISIBLE one
// picks, highlights and publishes the camera focus, while every instance
// keeps its explode pose in step with the shared progress so a tier swap
// shows the same station.
//
// Highlight swaps the material REFERENCE on this clone's meshes for a cached
// emissive copy (docs/ISS_MODEL_CONTEXT.md §8: never touch the cached GLTF's
// materials). The copy has the same program key, so no shader compiles, and
// the geometry does not move, so the cached station shadow stays valid.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { applyHighlightKnee } from './highlightKnee'
import { useCameraStore } from '@/stores/cameraStore'
import { useExplorerStore } from '@/stores/explorerStore'
import { FRAME_PRIORITY } from '../framePriority'
import {
  applyExplode,
  buildStationModuleIndex,
  moduleOffsetAt,
  pickNearest,
  type StationModuleIndex,
} from './moduleExplorer'
import { attachExplorerPointer, explorerRuntime, tickExplorer } from './explorerRuntime'

/** The tracking glint's light blue: a white tint vanished on the white
 *  modules in daylight. */
const HIGHLIGHT_COLOR = new THREE.Color('#A8D8FF')
const HOVER_EMISSIVE = 0.3
const SELECTED_EMISSIVE = 0.55
/** Albedo scale of the other modules while one is selected. */
const DIMMED_ALBEDO = 0.5
/** Hover picks at most this often (ms); a click picks at once. */
const HOVER_PICK_INTERVAL_MS = 90

type HighlightKind = 'hover' | 'selected' | 'dimmed'
const highlightCache = new WeakMap<THREE.Material, Record<HighlightKind, THREE.Material>>()

function highlightMaterial(base: THREE.Material, kind: HighlightKind): THREE.Material {
  let entry = highlightCache.get(base)
  if (!entry) {
    const make = (intensity: number, albedo = 1): THREE.Material => {
      const copy = base.clone()
      // clone() drops onBeforeCompile: re-apply the highlight knee so the copy
      // keeps the base's program key (no compile) and its glints stay rounded.
      applyHighlightKnee(copy)
      if (copy instanceof THREE.MeshStandardMaterial) {
        if (intensity > 0) {
          copy.emissive.copy(HIGHLIGHT_COLOR)
          copy.emissiveIntensity = intensity
        }
        copy.color.multiplyScalar(albedo)
      }
      return copy
    }
    entry = { hover: make(HOVER_EMISSIVE), selected: make(SELECTED_EMISSIVE), dimmed: make(0, DIMMED_ALBEDO) }
    highlightCache.set(base, entry)
  }
  return entry[kind]
}

export interface ModuleExplorerLayerProps {
  /** The instance's cloned GLTF scene, on its authored pose. */
  scene: THREE.Object3D
  /** Asset metres → render km. */
  renderScale: number
  /** This instance is the visible model. */
  active: boolean
}

export function ModuleExplorerLayer({ scene, renderScale, active }: ModuleExplorerLayerProps): null {
  const { camera, gl } = useThree()
  // Indexed before ISSAnimations' mount effect turns any joint.
  const index = useMemo<StationModuleIndex | null>(() => buildStationModuleIndex(scene), [scene])
  const baseMaterials = useMemo(() => {
    const map = new Map<THREE.Mesh, THREE.Material>()
    for (const mesh of index?.meshes ?? []) map.set(mesh, mesh.material as THREE.Material)
    return map
  }, [index])
  const ownerRef = useRef({})
  const appliedEasedRef = useRef(0)
  const highlightRef = useRef<{ hovered: string | null; selected: string | null }>({ hovered: null, selected: null })
  const lastHoverPickRef = useRef(0)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])

  useEffect(() => {
    if (index && index.unknown.length > 0) {
      console.warn('[ModuleExplorer] batches without a catalogue entry:', index.unknown)
    }
  }, [index])

  const setHighlight = (hovered: string | null, selected: string | null): void => {
    const current = highlightRef.current
    if (current.hovered === hovered && current.selected === selected) return
    highlightRef.current = { hovered, selected }
    if (!index) return
    for (const mesh of index.meshes) {
      const id = index.moduleOf.get(mesh)
      const base = baseMaterials.get(mesh)!
      mesh.material = id === selected ? highlightMaterial(base, 'selected')
        : id === hovered ? highlightMaterial(base, 'hover')
          : selected !== null ? highlightMaterial(base, 'dimmed')
            : base
    }
  }

  // Restore this clone's materials and cursor when the instance goes away.
  useEffect(() => () => {
    for (const [mesh, base] of baseMaterials) mesh.material = base
    if (explorerRuntime.focusAnchor?.owner === ownerRef.current) explorerRuntime.focusAnchor = null
  }, [baseMaterials])

  useEffect(() => {
    if (active) return
    gl.domElement.style.cursor = ''
    setHighlight(null, null)
    if (explorerRuntime.focusAnchor?.owner === ownerRef.current) explorerRuntime.focusAnchor = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, gl])

  // Explode first, before the camera (priority 0) reads the focus point.
  useFrame((state, delta) => {
    tickExplorer(state.clock.elapsedTime, delta)
    if (!index) return
    if (explorerRuntime.eased !== appliedEasedRef.current) {
      applyExplode(index, explorerRuntime.eased)
      appliedEasedRef.current = explorerRuntime.eased
    }
    if (!active) return

    const store = useExplorerStore.getState()
    const usable = store.open && store.availability === 'available'

    // Camera focus: publish the selected module's anchor for the controller.
    const focusId = usable && store.focused ? store.selectedId : null
    const focusModule = focusId ? index.modules.get(focusId) : undefined
    if (focusModule) {
      const anchor = explorerRuntime.focusAnchor
      if (!anchor || anchor.owner !== ownerRef.current || anchor.moduleId !== focusModule.id) {
        explorerRuntime.focusAnchor = {
          moduleId: focusModule.id, anchor: focusModule.anchor, local: focusModule.anchorCenter, owner: ownerRef.current,
        }
      }
    } else if (explorerRuntime.focusAnchor?.owner === ownerRef.current) {
      explorerRuntime.focusAnchor = null
    }
    const selectedModule = store.selectedId ? index.modules.get(store.selectedId) : undefined
    store.setFocusOffsetKm(selectedModule && store.focused
      ? moduleOffsetAt(selectedModule.radius, store.exploded ? 1 : 0) * renderScale
      : 0)

    setHighlight(usable ? store.hoveredId : null, usable ? store.selectedId : null)

    const pointer = explorerRuntime.pointer
    if (!usable || useCameraStore.getState().isTransitioning) {
      pointer.click = null
      if (gl.domElement.style.cursor) gl.domElement.style.cursor = ''
      return
    }
    const pickAt = (ndc: THREE.Vector2): string | null => {
      raycaster.setFromCamera(ndc, camera)
      const hit = pickNearest(raycaster, index.meshes)
      return hit ? index.moduleOf.get(hit.object as THREE.Mesh) ?? null : null
    }
    if (pointer.click) {
      store.select(pickAt(pointer.click))
      pointer.click = null
    }
    const now = performance.now()
    if (!pointer.hovering) {
      if (store.hoveredId !== null) store.hover(null)
    } else if (!pointer.down && pointer.moved && now - lastHoverPickRef.current >= HOVER_PICK_INTERVAL_MS) {
      lastHoverPickRef.current = now
      pointer.moved = false
      store.hover(pickAt(pointer.ndc))
    }
    const cursor = useExplorerStore.getState().hoveredId ? 'pointer' : ''
    if (gl.domElement.style.cursor !== cursor) gl.domElement.style.cursor = cursor
  }, FRAME_PRIORITY.stationPose)

  return null
}

/**
 * Always mounted with the station: ticks the explode (so it settles even
 * with no IGOAL tier on screen), owns the canvas pointer listeners and
 * publishes availability from the camera mode and the visible model.
 */
export function ModuleExplorerDriver({ igoalVisible }: { igoalVisible: boolean }): null {
  const gl = useThree((state) => state.gl)
  const mode = useCameraStore((state) => state.mode)
  const isTransitioning = useCameraStore((state) => state.isTransitioning)

  useEffect(() => attachExplorerPointer(gl.domElement), [gl])

  // Inspect and Follow track the station; the detail tiers only draw inside
  // the near band, so a visible IGOAL tier means Inspect or close Follow.
  const tracking = !isTransitioning && (mode === 'INSPECT' || mode === 'FOLLOW')
  const availability = !tracking ? 'hidden' : igoalVisible ? 'available' : 'unavailable'
  useEffect(() => {
    useExplorerStore.getState().setAvailability(availability)
  }, [availability])

  useFrame((state, delta) => tickExplorer(state.clock.elapsedTime, delta), FRAME_PRIORITY.stationPose)
  return null
}
