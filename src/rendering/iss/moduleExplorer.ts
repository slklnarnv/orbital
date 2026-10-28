// ─── moduleExplorer — pure parts of the module explorer (plan 017 X1) ───────
//
// Everything here is free of React and of the frame loop, so the module map,
// the explode vectors and the picking order are unit-tested against the
// published assets (tests/unit/rendering/ModuleExplorer.test.ts).
//
// The asset contract this relies on (docs/ISS_MODEL_CONTEXT.md §1.1 step 6):
// rigid batching leaves one primitive per (rigid part × module × material),
// named `<module>.batch.<material>`. Static batches hang directly under the
// hub `SSREF_IGOAL`; a driven joint's batches hang under the joint node and
// carry the joint's name as their module. GLTFLoader sanitizes names (dots
// are dropped), so the original name is read from `userData.name`.
//
// Exploding moves each hub child (a static batch, or a node such as a SARJ or
// a module that holds rig nodes) out along the vector from the station
// centroid to its group's centroid. Only translations are written, and only
// on hub children, so no joint's frame or pivot changes: the rig keeps
// working on the exploded station.

import * as THREE from 'three'
import { ISS_MODULES, type IssModule } from '@/data/issModules'
import { ISS_MODEL_CLEARANCE_KM } from '@/interaction/camera/CameraStateMachine'
import { easeInOutCubic } from '@/utils/math'

/** Hub whose children are the modules (the IGOAL conversion root). */
export const EXPLORER_HUB_NAME = 'SSREF_IGOAL'

/** Exploded positions sit (1 + factor) times as far from the centroid. */
export const EXPLODE_FACTOR = 0.6
/** Wall-clock seconds for a full explode or assemble. */
export const EXPLODE_DURATION_S = 1.4
/** Wall-clock seconds for the camera to move onto a focused module. */
export const FOCUS_DURATION_S = 0.9

const MODULE_BY_PART = new Map<string, IssModule>()
for (const module of ISS_MODULES) for (const part of module.parts) MODULE_BY_PART.set(part, module)

const MODULE_BY_ID = new Map<string, IssModule>(ISS_MODULES.map((module) => [module.id, module]))

export function moduleById(id: string | null): IssModule | null {
  return id === null ? null : MODULE_BY_ID.get(id) ?? null
}

/** The authored name of an object (GLTFLoader keeps it in userData). */
export function authoredName(object: THREE.Object3D): string {
  const name = (object.userData as { name?: unknown }).name
  return typeof name === 'string' ? name : object.name
}

/** `Zvezda_SM.batch.ELC_Base` → `Zvezda_SM`; other names unchanged. */
export function partKeyFromName(name: string): string {
  const at = name.indexOf('.batch.')
  return at < 0 ? name : name.slice(0, at)
}

/**
 * Module of a batch, from its own name then its ancestors' (nearest first):
 * the first part key the catalogue knows. A camera batch such as
 * `JEM_PM_Details_Camera_Fwd_Tilt.batch.ELC_Base` resolves through its
 * ancestor `JEM_PM`.
 */
export function moduleIdForNames(names: readonly string[]): string | null {
  for (const name of names) {
    const module = MODULE_BY_PART.get(partKeyFromName(name))
    if (module) return module.id
  }
  return null
}

function nameChain(object: THREE.Object3D, stop: THREE.Object3D): string[] {
  const names: string[] = []
  for (let o: THREE.Object3D | null = object; o && o !== stop; o = o.parent) names.push(authoredName(o))
  return names
}

export interface ExplodeGroup {
  /** Hub-level key (batch prefix or node name). */
  key: string
  /** Hub children moved together, with their authored positions. */
  objects: THREE.Object3D[]
  basePositions: THREE.Vector3[]
  /** Full-explode displacement in the hub's local frame. */
  hubDelta: THREE.Vector3
  /** Centroid in the asset (scene-root) frame, metres. */
  center: THREE.Vector3
}

export interface IndexedModule {
  id: string
  meshes: THREE.Mesh[]
  /** A mesh of the module: the focus point is carried in its frame. */
  anchor: THREE.Mesh
  /** Module centre in the anchor's local frame. */
  anchorCenter: THREE.Vector3
  /** Centre in the asset frame (authored pose), metres. */
  center: THREE.Vector3
  /** Distance of the centre from the station centroid (asset metres). */
  radius: number
}

export interface StationModuleIndex {
  meshes: THREE.Mesh[]
  /** Pick id per mesh. */
  moduleOf: Map<THREE.Mesh, string>
  modules: Map<string, IndexedModule>
  groups: ExplodeGroup[]
  /** Station centroid in the asset frame, metres. */
  center: THREE.Vector3
  /** Batches the catalogue does not cover (should be empty). */
  unknown: string[]
}

const _rootInverse = new THREE.Matrix4()
const _relative = new THREE.Matrix4()
const _box = new THREE.Box3()

function relativeMatrix(object: THREE.Object3D, rootInverse: THREE.Matrix4, out: THREE.Matrix4): THREE.Matrix4 {
  return out.multiplyMatrices(rootInverse, object.matrixWorld)
}

/**
 * Index an IGOAL scene for picking and exploding. Call on the authored pose
 * (before the rig turns a joint). Returns null for an asset without the hub
 * (the legacy model and Model A are not explorable).
 */
export function buildStationModuleIndex(root: THREE.Object3D, factor = EXPLODE_FACTOR): StationModuleIndex | null {
  let hub: THREE.Object3D | null = null
  root.traverse((object) => { if (!hub && authoredName(object) === EXPLORER_HUB_NAME) hub = object })
  if (!hub) return null
  const hubNode: THREE.Object3D = hub
  root.updateMatrixWorld(true)
  _rootInverse.copy(root.matrixWorld).invert()

  const meshes: THREE.Mesh[] = []
  const moduleOf = new Map<THREE.Mesh, string>()
  const moduleBoxes = new Map<string, { box: THREE.Box3; meshes: THREE.Mesh[] }>()
  const groupBoxes = new Map<string, THREE.Box3>()
  const stationBox = new THREE.Box3()
  const unknown: string[] = []

  hubNode.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const geometry = object.geometry as THREE.BufferGeometry
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    if (!geometry.boundingBox) return
    _box.copy(geometry.boundingBox).applyMatrix4(relativeMatrix(object, _rootInverse, _relative))
    stationBox.union(_box)
    const chain = nameChain(object, hubNode)
    const groupKey = partKeyFromName(chain[chain.length - 1])
    const groupBox = groupBoxes.get(groupKey) ?? new THREE.Box3()
    groupBoxes.set(groupKey, groupBox.union(_box))
    const id = moduleIdForNames(chain)
    if (id === null) {
      unknown.push(chain[0])
      return
    }
    meshes.push(object)
    moduleOf.set(object, id)
    const entry = moduleBoxes.get(id) ?? { box: new THREE.Box3(), meshes: [] }
    entry.box.union(_box)
    entry.meshes.push(object)
    moduleBoxes.set(id, entry)
  })

  const center = stationBox.getCenter(new THREE.Vector3())

  const modules = new Map<string, IndexedModule>()
  for (const [id, { box, meshes: list }] of moduleBoxes) {
    const moduleCenter = box.getCenter(new THREE.Vector3())
    const anchor = list[0]
    const anchorCenter = moduleCenter.clone().applyMatrix4(
      relativeMatrix(anchor, _rootInverse, new THREE.Matrix4()).invert(),
    )
    modules.set(id, {
      id, meshes: list, anchor, anchorCenter, center: moduleCenter,
      radius: moduleCenter.distanceTo(center),
    })
  }

  // Hub-local displacement: the hub children's positions live in the hub's
  // frame, so the asset-frame vector goes through the hub's linear part.
  const hubLinearInverse = new THREE.Matrix3().setFromMatrix4(
    relativeMatrix(hubNode, _rootInverse, new THREE.Matrix4()),
  ).invert()
  const byKey = new Map<string, ExplodeGroup>()
  for (const child of hubNode.children) {
    const key = partKeyFromName(authoredName(child))
    const box = groupBoxes.get(key)
    if (!box) continue
    let group = byKey.get(key)
    if (!group) {
      const groupCenter = box.getCenter(new THREE.Vector3())
      group = {
        key, objects: [], basePositions: [], center: groupCenter,
        hubDelta: explodeDisplacement(groupCenter, center, factor).applyMatrix3(hubLinearInverse),
      }
      byKey.set(key, group)
    }
    group.objects.push(child)
    group.basePositions.push(child.position.clone())
  }

  return { meshes, moduleOf, modules, groups: [...byKey.values()], center, unknown }
}

/** Full-explode displacement of a part centred at `partCenter`. */
export function explodeDisplacement(
  partCenter: THREE.Vector3,
  stationCenter: THREE.Vector3,
  factor = EXPLODE_FACTOR,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out.subVectors(partCenter, stationCenter).multiplyScalar(factor)
}

/** Place every group at `eased` (0 assembled … 1 exploded). */
export function applyExplode(index: StationModuleIndex, eased: number): void {
  for (const group of index.groups) {
    for (let i = 0; i < group.objects.length; i++) {
      group.objects[i].position.copy(group.basePositions[i]).addScaledVector(group.hubDelta, eased)
    }
  }
}

/** Eased explode amount for a linear progress. */
export function explodeEase(progress: number): number {
  return easeInOutCubic(THREE.MathUtils.clamp(progress, 0, 1))
}

/**
 * Advance a linear 0…1 progress toward `target` at 1/duration per second of
 * wall-clock time; `instant` (reduced motion) jumps.
 */
export function advanceProgress(current: number, target: number, wallDeltaSec: number, durationSec: number, instant: boolean): number {
  if (instant || durationSec <= 0) return target
  const step = Math.max(0, Math.min(wallDeltaSec, 0.1)) / durationSec
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step)
}

/**
 * Eye clearance from the station centre (km). The explode scales every
 * point's distance from the centroid by at most (1 + factor·eased), so the
 * assembled clearance scales with it.
 */
export function explodedClearanceKm(eased: number, factor = EXPLODE_FACTOR): number {
  return ISS_MODEL_CLEARANCE_KM * (1 + factor * THREE.MathUtils.clamp(eased, 0, 1))
}

/**
 * Smallest camera-to-target distance that keeps the eye outside the
 * clearance sphere when the target sits `focusOffsetKm` from the station
 * centre: an orbit of that radius about the target encloses the sphere.
 */
export function explorerMinDistanceKm(eased: number, focusOffsetKm: number, factor = EXPLODE_FACTOR): number {
  return explodedClearanceKm(eased, factor) + Math.max(0, focusOffsetKm)
}

/** Distance of a module centre from the station centre at `eased` explode. */
export function moduleOffsetAt(radius: number, eased: number, factor = EXPLODE_FACTOR): number {
  return radius * (1 + factor * THREE.MathUtils.clamp(eased, 0, 1))
}

const _sphere = new THREE.Sphere()
const _hitPoint = new THREE.Vector3()

interface PickCandidate { mesh: THREE.Mesh; entry: number }

/**
 * Nearest hit of the ray among `meshes`. Candidates are tested in order of
 * their bounding-sphere entry distance and the search stops once the best
 * hit is nearer than the next sphere: a full raycast of the 2.7M-triangle
 * station costs tens of ms, while this usually tests one to three batches.
 */
export function pickNearest(raycaster: THREE.Raycaster, meshes: readonly THREE.Mesh[]): THREE.Intersection | null {
  const candidates: PickCandidate[] = []
  const ray = raycaster.ray
  for (const mesh of meshes) {
    if (!mesh.visible || !isVisibleChain(mesh)) continue
    const geometry = mesh.geometry as THREE.BufferGeometry
    if (!geometry.boundingSphere) geometry.computeBoundingSphere()
    if (!geometry.boundingSphere) continue
    _sphere.copy(geometry.boundingSphere).applyMatrix4(mesh.matrixWorld)
    const hit = ray.intersectSphere(_sphere, _hitPoint)
    if (!hit) continue
    // Inside the sphere the entry point is behind the origin: distance 0.
    const entry = ray.origin.distanceToSquared(_sphere.center) <= _sphere.radius * _sphere.radius ? 0 : ray.origin.distanceTo(hit)
    candidates.push({ mesh, entry })
  }
  candidates.sort((a, b) => a.entry - b.entry)
  let best: THREE.Intersection | null = null
  const hits: THREE.Intersection[] = []
  for (const { mesh, entry } of candidates) {
    if (best && best.distance < entry) break
    hits.length = 0
    mesh.raycast(raycaster, hits)
    for (const hit of hits) if (!best || hit.distance < best.distance) best = hit
  }
  return best
}

function isVisibleChain(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false
  return true
}

const _compose = new THREE.Matrix4()

/**
 * `local` (in `object`'s frame) expressed in `ancestor`'s frame, from the
 * CURRENT local transforms — not matrixWorld, which is only refreshed at
 * render, so the camera can read this frame's explode and joint pose.
 */
export function pointInAncestor(
  object: THREE.Object3D,
  local: THREE.Vector3,
  ancestor: THREE.Object3D,
  out: THREE.Vector3,
): THREE.Vector3 | null {
  out.copy(local)
  for (let o: THREE.Object3D | null = object; o !== ancestor; o = o.parent) {
    if (!o) return null
    out.applyMatrix4(_compose.compose(o.position, o.quaternion, o.scale))
  }
  return out
}

/**
 * Moves the camera's tracked point between the station centre and a module
 * over FOCUS_DURATION_S, from wherever it was when the goal changed, onto a
 * goal that may itself move (explode, joint motion).
 */
export class FocusTween {
  private readonly from = new THREE.Vector3()
  readonly current = new THREE.Vector3()
  private goalKey: string | null = null
  private t = 1

  reset(): void {
    this.from.set(0, 0, 0)
    this.current.set(0, 0, 0)
    this.goalKey = null
    this.t = 1
  }

  /**
   * `goal` is the station-local focus point (zero = the station centre);
   * `goalKey` identifies it, so a change restarts the tween from the
   * current point. Returns the eased progress of the move (1 when settled).
   */
  sample(goalKey: string | null, goal: THREE.Vector3, wallDeltaSec: number, instant: boolean): number {
    if (goalKey !== this.goalKey) {
      this.goalKey = goalKey
      this.from.copy(this.current)
      this.t = instant ? 1 : 0
    } else {
      this.t = advanceProgress(this.t, 1, wallDeltaSec, FOCUS_DURATION_S, instant)
    }
    const eased = easeInOutCubic(this.t)
    this.current.lerpVectors(this.from, goal, eased)
    return eased
  }
}
