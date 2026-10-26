// ─── ModuleExplorer.test.ts — module map, explode vectors, picking (017 X1) ─
//
// The module map and the explode are checked against the PUBLISHED assets'
// node trees (built from the GLB JSON, as ISSRigSimulation does: transforms
// plus accessor-bounds boxes, no geometry decoded). Picking order and the
// focus/clearance math run on synthetic scenes.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'

import { ISS_MODULES, formatModuleMass } from '@/data/issModules'
import { ISS_MODEL_CLEARANCE_KM } from '@/interaction/camera/CameraStateMachine'
import {
  EXPLODE_FACTOR,
  FOCUS_DURATION_S,
  FocusTween,
  advanceProgress,
  applyExplode,
  buildStationModuleIndex,
  explodeDisplacement,
  explodeEase,
  explodedClearanceKm,
  explorerMinDistanceKm,
  moduleIdForNames,
  moduleOffsetAt,
  partKeyFromName,
  pickNearest,
  pointInAncestor,
} from '@/rendering/iss/moduleExplorer'
import { IGOAL_JOINT_DEFS, IGOAL_OSCILLATOR_SPECS, IGOAL_TRRJ_LIMITS } from '@/rendering/iss/ISSJointKinematics'
import { MAX_WALL_DEG_PER_SECOND, RigAnimator } from '@/rendering/iss/ISSRigAnimator'
import { SHADOW_HALF_EXTENT, explodedShadowHalfExtent } from '@/rendering/iss/stationShadow'
import { useExplorerStore } from '@/stores/explorerStore'
import { parseGlbJsonDeclarations } from '../../../scripts/iss-rig-manifest.mjs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GlbJson = Record<string, any>

const MODELS = path.resolve(__dirname, '../../../public/models')
const ASSETS = ['iss_igoal_locate.glb', 'iss_igoal.glb']
// Mirrors ISSModel.tsx (IGOAL_DETAILED / IGOAL_LOCATE).
const RENDER_SCALE = 109 / 108.293

/** Node tree from the GLB JSON; names live in userData.name like GLTFLoader's. */
function loadNodeTree(file: string): THREE.Group {
  const json = parseGlbJsonDeclarations(readFileSync(path.join(MODELS, file))) as GlbJson
  const objects: THREE.Object3D[] = json.nodes.map((n: GlbJson) => {
    const box = n.mesh === undefined ? null : new THREE.Box3()
    if (box) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION]
        box.union(new THREE.Box3(new THREE.Vector3().fromArray(acc.min), new THREE.Vector3().fromArray(acc.max)))
      }
    }
    let o: THREE.Object3D
    if (box) {
      const geometry = new THREE.BufferGeometry()
      geometry.boundingBox = box
      o = new THREE.Mesh(geometry)
    } else {
      o = new THREE.Object3D()
    }
    o.userData.name = n.name ?? ''
    // GLTFLoader's sanitized name (dots dropped) — the index must not rely on it.
    o.name = THREE.PropertyBinding.sanitizeNodeName(n.name ?? '')
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale)
    if (n.translation) o.position.fromArray(n.translation)
    if (n.rotation) o.quaternion.fromArray(n.rotation)
    if (n.scale) o.scale.fromArray(n.scale)
    return o
  })
  json.nodes.forEach((n: GlbJson, i: number) => (n.children ?? []).forEach((c: number) => objects[i].add(objects[c])))
  const root = new THREE.Group()
  for (const i of json.scenes[json.scene ?? 0].nodes) root.add(objects[i])
  return root
}

function rootPoint(root: THREE.Object3D, object: THREE.Object3D, local: THREE.Vector3): THREE.Vector3 {
  root.updateMatrixWorld(true)
  return local.clone().applyMatrix4(object.matrixWorld).applyMatrix4(root.matrixWorld.clone().invert())
}

describe('module catalogue', () => {
  it('has unique ids and parts, sentence-case names and plausible facts', () => {
    const ids = new Set<string>()
    const parts = new Set<string>()
    for (const module of ISS_MODULES) {
      expect(ids.has(module.id)).toBe(false)
      ids.add(module.id)
      for (const part of module.parts) {
        expect(parts.has(part)).toBe(false)
        parts.add(part)
      }
      expect(module.launchYear).toBeGreaterThanOrEqual(1998)
      expect(module.launchYear).toBeLessThanOrEqual(2026)
      expect(module.name).not.toMatch(/^[A-Z ]{6,}$/)
      expect(module.purpose.length).toBeGreaterThan(20)
    }
  })

  it('formats NASA pound masses in kilograms and unknowns as a dash', () => {
    expect(formatModuleMass(42600)).toBe('19,320 kg') // Zarya
    expect(formatModuleMass(3115.1)).toBe('1,410 kg') // BEAM
    expect(formatModuleMass(null)).toBe('—')
  })
})

describe('picking id mapping', () => {
  it('strips the batch suffix and resolves through ancestors', () => {
    expect(partKeyFromName('Zvezda_SM.batch.ELC_Base')).toBe('Zvezda_SM')
    expect(partKeyFromName('Node 2_3')).toBe('Node 2_3')
    expect(moduleIdForNames(['Columbus.batch.Columbus.Payloads_01'])).toBe('columbus')
    expect(moduleIdForNames(['PORT_BETA_ROT_4A.batch.IROSA', 'PORT_BETA_ROT_4A', 'Truss_P4', 'PORT_ALPHA_ROT'])).toBe('p4-arrays')
    expect(moduleIdForNames(['JEM_PM_Details_Camera_Fwd_Tilt.batch.ELC_Base', 'JEM_PM_Details_Camera_Fwd_Tilt', 'JEM_PM'])).toBe('kibo-pm')
    expect(moduleIdForNames(['Nothing.batch.X'])).toBeNull()
  })

  for (const asset of ASSETS) {
    describe(asset, () => {
      const root = loadNodeTree(asset)
      const index = buildStationModuleIndex(root)!

      it('maps every batch to a catalogue module and every module to geometry', () => {
        expect(index).not.toBeNull()
        expect(index.unknown).toEqual([])
        expect(index.meshes.length).toBe(asset === 'iss_igoal.glb' ? 217 : 176)
        expect([...index.modules.keys()].sort()).toEqual(ISS_MODULES.map((m) => m.id).sort())
      })

      it('keeps rotating parts apart from their truss', () => {
        const byName = (name: string) => {
          let found: THREE.Object3D | undefined
          root.traverse((o) => { if (o.userData.name === name) found = o })
          return found!
        }
        expect(index.moduleOf.get(byName('PORT_BETA_ROT_2B.batch.IROSA') as THREE.Mesh)).toBe('p6-arrays')
        expect(index.moduleOf.get(byName('PORT_TRRJ_GAMMA_ROT.batch.Radiator_Panel_Coating') as THREE.Mesh)).toBe('p1-radiator')
        expect(index.moduleOf.get(byName('PORT_ALPHA_ROT.batch.Truss') as THREE.Mesh)).toBe('port-outboard')
      })

      it('places the station centroid where ISSModel pivots it', () => {
        // pivotOffset is the negated decoded centre (0.0025, 6.8026, −0.0006).
        // Accessor boxes of rotated batches are looser than the decoded
        // vertices, and the LOD strips detail, so allow a few decimetres.
        expect(index.center.distanceTo(new THREE.Vector3(-0.0025, -6.8026, 0.0006))).toBeLessThan(0.3)
      })

      it('explodes every hub child outward along its centroid vector and back', () => {
        expect(index.groups.length).toBe(39)
        const hub = index.groups[0].objects[0].parent!
        const before = index.groups.map((g) => g.objects.map((o) => o.position.clone()))
        applyExplode(index, 1)
        for (const group of index.groups) {
          // The displacement, mapped back to the asset frame, is the factor
          // times the centroid vector.
          const moved = rootPoint(root, hub, group.objects[0].position)
            .sub(rootPoint(root, hub, group.basePositions[0]))
          const expected = explodeDisplacement(group.center, index.center)
          expect(moved.distanceTo(expected)).toBeLessThan(1e-3 * Math.max(1, expected.length()))
          expect(moved.dot(group.center.clone().sub(index.center))).toBeGreaterThanOrEqual(0)
        }
        applyExplode(index, 0)
        index.groups.forEach((g, i) => g.objects.forEach((o, j) => expect(o.position.distanceTo(before[i][j])).toBeLessThan(1e-9)))
      })

      it('stays inside the exploded clearance sphere', () => {
        applyExplode(index, 1)
        root.updateMatrixWorld(true)
        const inverse = root.matrixWorld.clone().invert()
        let farthest = 0
        const corner = new THREE.Vector3()
        for (const mesh of index.meshes) {
          const box = mesh.geometry.boundingBox!
          const m = inverse.clone().multiply(mesh.matrixWorld)
          for (let i = 0; i < 8; i++) {
            corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
              .applyMatrix4(m)
            farthest = Math.max(farthest, corner.distanceTo(index.center) * RENDER_SCALE)
          }
        }
        applyExplode(index, 0)
        expect(farthest).toBeGreaterThan(ISS_MODEL_CLEARANCE_KM) // it really grows
        expect(farthest).toBeLessThan(explodedClearanceKm(1))
        expect(explodedShadowHalfExtent(1, EXPLODE_FACTOR)).toBeGreaterThan(farthest)
      })

      it('carries each module centre in its anchor frame', () => {
        for (const module of index.modules.values()) {
          const point = pointInAncestor(module.anchor, module.anchorCenter, root, new THREE.Vector3())!
          expect(point.distanceTo(module.center)).toBeLessThan(1e-3)
          expect(moduleOffsetAt(module.radius, 1)).toBeCloseTo(module.radius * (1 + EXPLODE_FACTOR))
        }
      })
    })
  }

  it('does not index a model without the IGOAL hub', () => {
    const legacy = new THREE.Group()
    legacy.add(new THREE.Mesh(new THREE.BoxGeometry()))
    expect(buildStationModuleIndex(legacy)).toBeNull()
  })
})

describe('pickNearest', () => {
  function box(z: number, name: string): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    mesh.position.z = z
    mesh.name = name
    mesh.updateMatrixWorld(true)
    return mesh
  }

  it('returns the nearest mesh along the ray and stops testing early', () => {
    const near = box(-10, 'near')
    const far = box(-30, 'far')
    const side = box(-20, 'side')
    side.position.x = 10
    side.updateMatrixWorld(true)
    let farTests = 0
    const raycastFar = far.raycast.bind(far)
    far.raycast = (raycaster, hits) => { farTests += 1; raycastFar(raycaster, hits) }
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
    const hit = pickNearest(raycaster, [far, side, near])
    expect(hit?.object).toBe(near)
    expect(hit?.distance).toBeCloseTo(9)
    expect(farTests).toBe(0)
  })

  it('skips hidden meshes and misses cleanly', () => {
    const near = box(-10, 'near')
    near.visible = false
    const far = box(-30, 'far')
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
    expect(pickNearest(raycaster, [near, far])?.object).toBe(far)
    raycaster.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0))
    expect(pickNearest(raycaster, [near, far])).toBeNull()
  })
})

describe('explode timing and camera floor', () => {
  it('advances on wall time, eases, and jumps under reduced motion', () => {
    expect(advanceProgress(0, 1, 0.07, 1.4, false)).toBeCloseTo(0.05)
    expect(advanceProgress(0.5, 0, 0.07, 1.4, false)).toBeCloseTo(0.45)
    expect(advanceProgress(0.99, 1, 0.1, 1.4, false)).toBe(1)
    expect(advanceProgress(0, 1, 5, 1.4, false)).toBeCloseTo(0.1 / 1.4) // a hitch frame is capped
    expect(advanceProgress(0, 1, 0.016, 1.4, true)).toBe(1)
    expect(explodeEase(0)).toBe(0)
    expect(explodeEase(1)).toBe(1)
    expect(explodeEase(0.5)).toBeCloseTo(0.5)
  })

  it('raises the eye floor with the explode and the focus offset', () => {
    expect(explodedClearanceKm(0)).toBe(ISS_MODEL_CLEARANCE_KM)
    expect(explodedClearanceKm(1)).toBeCloseTo(ISS_MODEL_CLEARANCE_KM * (1 + EXPLODE_FACTOR))
    expect(explorerMinDistanceKm(0, 0)).toBe(ISS_MODEL_CLEARANCE_KM)
    expect(explorerMinDistanceKm(1, 40)).toBeCloseTo(ISS_MODEL_CLEARANCE_KM * (1 + EXPLODE_FACTOR) + 40)
  })

  it('keeps the eye outside the clearance sphere through a focus move', () => {
    // Worst case: the camera looks along the module's own offset from the
    // far side, so moving the target onto the module carries the eye inward.
    const module = new THREE.Vector3(0, 0, -50)
    const eyeDir = new THREE.Vector3(0, 0, 1)
    const tween = new FocusTween()
    tween.sample(null, new THREE.Vector3(), 0, false)
    let distance = ISS_MODEL_CLEARANCE_KM
    for (let t = 0; t <= FOCUS_DURATION_S + 0.1; t += 1 / 60) {
      tween.sample('m', module, 1 / 60, false)
      distance = Math.max(distance, explorerMinDistanceKm(0, tween.current.length()))
      const eye = tween.current.clone().addScaledVector(eyeDir, distance)
      expect(eye.length()).toBeGreaterThanOrEqual(ISS_MODEL_CLEARANCE_KM - 1e-9)
    }
    expect(tween.current.distanceTo(module)).toBeLessThan(1e-9)
  })

  it('retargets from where it is and snaps under reduced motion', () => {
    const tween = new FocusTween()
    const a = new THREE.Vector3(10, 0, 0)
    tween.sample('a', a, 0, false)
    tween.sample('a', a, FOCUS_DURATION_S / 2, false)
    const mid = tween.current.clone()
    expect(mid.x).toBeGreaterThan(0)
    expect(mid.x).toBeLessThan(10)
    tween.sample(null, new THREE.Vector3(), 0, false)
    expect(tween.current.distanceTo(mid)).toBeLessThan(1e-9) // no jump on retarget
    tween.sample('b', new THREE.Vector3(0, 5, 0), 0, true)
    expect(tween.current.y).toBe(5)
  })

  it('grows the shadow box in quarter steps that always cover the station', () => {
    expect(explodedShadowHalfExtent(0, EXPLODE_FACTOR)).toBe(SHADOW_HALF_EXTENT)
    expect(explodedShadowHalfExtent(0.1, EXPLODE_FACTOR)).toBeCloseTo(SHADOW_HALF_EXTENT * (1 + EXPLODE_FACTOR / 4))
    expect(explodedShadowHalfExtent(0.25, EXPLODE_FACTOR)).toBeCloseTo(SHADOW_HALF_EXTENT * (1 + EXPLODE_FACTOR / 4))
    expect(explodedShadowHalfExtent(1, EXPLODE_FACTOR)).toBeCloseTo(SHADOW_HALF_EXTENT * (1 + EXPLODE_FACTOR))
    for (let e = 0; e <= 1; e += 0.01) {
      expect(explodedShadowHalfExtent(e, EXPLODE_FACTOR)).toBeGreaterThanOrEqual(SHADOW_HALF_EXTENT * (1 + EXPLODE_FACTOR * e) - 1e-9)
    }
  })
})

describe('joints parked for the exploded view', () => {
  function rig() {
    const root = loadNodeTree('iss_igoal_locate.glb')
    const station = new THREE.Group()
    const pivot = new THREE.Group()
    station.add(pivot)
    pivot.add(root)
    station.position.set(6771, 0, 0)
    station.updateMatrixWorld(true)
    const shared = new Map<string, { applied: number }>()
    const animator = new RigAnimator(pivot, {
      joints: IGOAL_JOINT_DEFS, oscillators: IGOAL_OSCILLATOR_SPECS, limits: IGOAL_TRRJ_LIMITS,
    }, shared as never)
    expect(animator.failures).toEqual([])
    const sun = new THREE.Vector3(0.3, 0.8, -0.52).normalize()
    const frame = (t: number, parked: boolean, snap = false) => animator.step({
      sunWorld: sun, epochMs: 1_700_000_000_000 + t * 1000, wallDeltaSec: 0.1, nowWallMs: t * 1000, parked, snap,
    })
    return { shared, frame }
  }

  it('glide to the authored pose at the wall-clock cap and rejoin the target', () => {
    const { shared, frame } = rig()
    const reference = rig() // never parked
    frame(0, false)
    reference.frame(0, false)
    const tracked = new Map([...shared].map(([id, s]) => [id, s.applied]))
    const capRad = MAX_WALL_DEG_PER_SECOND * Math.PI / 180 * 0.1
    frame(0.1, true)
    for (const [id, s] of shared) {
      expect(Math.abs(s.applied)).toBeCloseTo(Math.max(0, Math.abs(tracked.get(id)!) - capRad), 6)
    }
    for (let i = 2; i < 200; i++) frame(i * 0.1, true)
    for (const s of shared.values()) expect(s.applied).toBe(0)
    // Back to tracking: a glide (never a jump) that ends on the target.
    frame(20, false)
    for (const s of shared.values()) expect(Math.abs(s.applied)).toBeLessThanOrEqual(capRad + 1e-9)
    for (let i = 1; i <= 200; i++) frame(20 + i * 0.1, false)
    for (let i = 1; i <= 400; i++) reference.frame(i * 0.1, false)
    for (const id of ['SARJ_PORT', 'SARJ_STBD']) {
      expect(Math.abs(shared.get(id)!.applied - reference.shared.get(id)!.applied)).toBeLessThan(1e-6)
    }
    // Reduced motion parks at once.
    frame(60, true, true)
    for (const s of shared.values()) expect(s.applied).toBe(0)
  })
})

describe('explorer store', () => {
  beforeEach(() => {
    const store = useExplorerStore.getState()
    store.setAvailability('hidden')
    store.setAvailability('available')
  })

  it('only picks, focuses and explodes while open and available', () => {
    const store = useExplorerStore.getState
    store().select('columbus')
    expect(store().selectedId).toBeNull()
    store().setOpen(true)
    store().select('columbus')
    store().setFocused(true)
    store().setExploded(true)
    expect(store()).toMatchObject({ selectedId: 'columbus', focused: true, exploded: true })
    store().select('cupola') // focus follows a new selection
    expect(store()).toMatchObject({ selectedId: 'cupola', focused: true })
    store().select(null)
    expect(store().focused).toBe(false)
  })

  it('clears everything when the tier or the tracking goes away', () => {
    const store = useExplorerStore.getState
    store().setOpen(true)
    store().select('zarya')
    store().setFocused(true)
    store().setExploded(true)
    store().setAvailability('unavailable')
    expect(store()).toMatchObject({ open: true, selectedId: null, focused: false, exploded: false })
    store().setExploded(true)
    expect(store().exploded).toBe(false)
    store().setAvailability('hidden')
    expect(store().open).toBe(false)
  })

  it('collapses on close', () => {
    const store = useExplorerStore.getState
    store().setOpen(true)
    store().select('unity')
    store().setExploded(true)
    store().setOpen(false)
    expect(store()).toMatchObject({ open: false, selectedId: null, exploded: false })
  })
})
