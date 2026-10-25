// ─── ISSRigSimulation.test.ts — the rig, flown through real orbits ──────────
//
// Drives the app's own RigAnimator (the per-frame step ISSAnimations runs)
// over whole orbits, on the PUBLISHED asset's node tree in the true flight
// attitude, and measures what the mechanism is for:
//   - every solar wing's blanket faces the sun through daylight (SARJ + BGA);
//   - each radiator runs edge-on to the sun in daylight and faces the Earth in
//     eclipse, within the ±105° TRRJ travel;
//   - the camera idle sweeps keep each camera on its mount.
// The node tree is built from the GLB's JSON alone (transforms + accessor
// bounds), so no geometry is decoded.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as satellite from 'satellite.js'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { isSunlit } from '@/core/orbital/SunVisibility'
import { UNIX_EPOCH_JULIAN } from '@/utils/constants'
import {
  IGOAL_JOINT_DEFS,
  IGOAL_OSCILLATOR_SPECS,
  IGOAL_TRRJ_LIMITS,
} from '@/rendering/iss/ISSJointKinematics'
import { RigAnimator } from '@/rendering/iss/ISSRigAnimator'
import { lvlhAttitude } from '@/rendering/iss/stationAttitude'
import { parseGlbJsonDeclarations } from '../../../scripts/iss-rig-manifest.mjs'
import fallback from '../../../src/data/fallback-tle.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GlbJson = Record<string, any>

const MODELS = path.resolve(__dirname, '../../../public/models')
// Mirrors ISSModel.tsx: IGOAL_DETAILED / IGOAL_LOCATE and HIGH_PRE_ROTATION.
const WINGSPAN_M = 108.293
const PIVOT_OFFSET: [number, number, number] = [0.0025, 6.8026, -0.0006]
const PRE_ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))

const WINGS = ['P4_Array_2A', 'P4_Array_4A', 'P6_2B_Array', 'P6_4B_Array', 'S4_Array_1A', 'S4_Array_3A', 'S6_1B_Array', 'S6_3B_Array']
const RADIATORS = ['P1_Radiator', 'S1_Radiator']
const MODEL_Y = new THREE.Vector3(0, 1, 0)
const DEG2RAD = Math.PI / 180

/** The asset's node tree: named Object3Ds with authored transforms; each mesh
 *  node gets an unnamed stub child carrying its accessor-bounds box. */
function loadNodeTree(file: string): THREE.Group {
  const json = parseGlbJsonDeclarations(readFileSync(path.join(MODELS, file))) as GlbJson
  const objects: THREE.Object3D[] = json.nodes.map((n: GlbJson) => {
    const o = new THREE.Object3D()
    o.name = n.name ?? ''
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale)
    if (n.translation) o.position.fromArray(n.translation)
    if (n.rotation) o.quaternion.fromArray(n.rotation)
    if (n.scale) o.scale.fromArray(n.scale)
    if (n.mesh !== undefined) {
      const box = new THREE.Box3()
      for (const prim of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION]
        box.union(new THREE.Box3(new THREE.Vector3().fromArray(acc.min), new THREE.Vector3().fromArray(acc.max)))
      }
      const geometry = new THREE.BufferGeometry()
      geometry.boundingBox = box
      o.add(new THREE.Mesh(geometry))
    }
    return o
  })
  json.nodes.forEach((n: GlbJson, i: number) => (n.children ?? []).forEach((c: number) => objects[i].add(objects[c])))
  const sceneRoot = new THREE.Group()
  for (const i of json.scenes[json.scene ?? 0].nodes) sceneRoot.add(objects[i])
  return sceneRoot
}

/** World ← station group (orbit + attitude) ← normalization ← pivot root ← asset. */
function mountStation(file: string): { station: THREE.Group; pivotRoot: THREE.Group; asset: THREE.Group } {
  const station = new THREE.Group()
  const normalized = new THREE.Group()
  normalized.scale.setScalar(109 / WINGSPAN_M)
  normalized.quaternion.copy(PRE_ROTATION)
  const pivotRoot = new THREE.Group()
  pivotRoot.position.fromArray(PIVOT_OFFSET)
  const asset = loadNodeTree(file)
  pivotRoot.add(asset)
  normalized.add(pivotRoot)
  station.add(normalized)
  return { station, pivotRoot, asset }
}

const satrec = satellite.twoline2satrec(fallback.line1, fallback.line2)
const _vel = new THREE.Vector3()

/** Place and orient the station at `epochMs` exactly as ISSGroup does (TEME → world: x, z, −y). */
function flyTo(station: THREE.Group, epochMs: number): void {
  const pv = satellite.propagate(satrec, new Date(epochMs))
  if (!pv.position || typeof pv.position === 'boolean' || !pv.velocity || typeof pv.velocity === 'boolean') {
    throw new Error('propagation failed')
  }
  station.position.set(pv.position.x, pv.position.z, -pv.position.y)
  _vel.set(pv.velocity.x, pv.velocity.z, -pv.velocity.y)
  if (!lvlhAttitude(station.position, _vel, station.quaternion)) throw new Error('degenerate attitude')
  station.updateMatrixWorld(true)
}

function sunAt(epochMs: number): THREE.Vector3 {
  const s = sunDirectionWorld(epochMs / 86_400_000 + UNIX_EPOCH_JULIAN)
  return new THREE.Vector3(s.x, s.y, s.z).normalize()
}

/** Orientation of `node` relative to `root` (strips attitude + pre-rotation). */
function relativeQuat(root: THREE.Object3D, node: THREE.Object3D): THREE.Quaternion {
  const r = root.getWorldQuaternion(new THREE.Quaternion()).invert()
  return r.multiply(node.getWorldQuaternion(new THREE.Quaternion()))
}

interface OrbitStats {
  daylightSamples: number
  eclipseSamples: number
  /** Per wing: worst cos(blanket normal, sun) over settled daylight. */
  wingMinCos: Record<string, number>
  /** Per radiator: worst |cos(panel normal, sun)| in daylight (0 = edge-on). */
  radiatorMaxSunCos: Record<string, number>
  /** Per radiator: worst |cos(panel normal, nadir)| in eclipse (1 = face-on). */
  radiatorMinNadirCos: Record<string, number>
}

function flyOrbits(file: string, startMs: number, orbits: number): OrbitStats {
  const { station, pivotRoot } = mountStation(file)
  flyTo(station, startMs)
  const animator = new RigAnimator(pivotRoot, {
    joints: IGOAL_JOINT_DEFS,
    oscillators: IGOAL_OSCILLATOR_SPECS,
    limits: IGOAL_TRRJ_LIMITS,
  }, new Map())
  expect(animator.failures).toEqual([])

  const parts = [...WINGS, ...RADIATORS].map((name) => {
    const node = pivotRoot.getObjectByName(name)
    if (!node) throw new Error(`missing ${name}`)
    return { name, node, rest: relativeQuat(pivotRoot, node) }
  })
  const stats: OrbitStats = {
    daylightSamples: 0,
    eclipseSamples: 0,
    wingMinCos: Object.fromEntries(WINGS.map((w) => [w, 1])),
    radiatorMaxSunCos: Object.fromEntries(RADIATORS.map((r) => [r, 0])),
    radiatorMinNadirCos: Object.fromEntries(RADIATORS.map((r) => [r, 1])),
  }

  const periodMs = ((2 * Math.PI) / satrec.no) * 60_000
  const stepMs = 1000
  const settleMs = 10 * 60_000
  // Joint state at the light/shadow switch lags its new target while the
  // TRRJ slews; only judge the radiators once that slew has had time.
  const trrjSettleMs = 4 * 60_000
  let lastSwitchMs = startMs
  let wasSunlit: boolean | null = null
  const n = new THREE.Vector3()
  const sunModel = new THREE.Vector3()
  const nadirModel = new THREE.Vector3()
  for (let t = startMs; t <= startMs + orbits * periodMs; t += stepMs) {
    flyTo(station, t)
    const sun = sunAt(t)
    animator.step({ sunWorld: sun, epochMs: t, wallDeltaSec: 0.1, nowWallMs: t })
    pivotRoot.updateMatrixWorld(true)
    const sunlit = isSunlit(station.position, sun)
    if (sunlit !== wasSunlit) lastSwitchMs = t
    wasSunlit = sunlit
    if (t - startMs < settleMs) continue

    const toModel = pivotRoot.getWorldQuaternion(new THREE.Quaternion()).invert()
    sunModel.copy(sun).applyQuaternion(toModel)
    nadirModel.copy(station.position).negate().normalize().applyQuaternion(toModel)
    if (sunlit) stats.daylightSamples += 1
    else stats.eclipseSamples += 1
    for (const part of parts) {
      // The part's authored +Y (blanket / panel normal), carried by its joints.
      n.copy(MODEL_Y).applyQuaternion(relativeQuat(pivotRoot, part.node).multiply(part.rest.clone().invert()))
      if (WINGS.includes(part.name)) {
        if (sunlit) stats.wingMinCos[part.name] = Math.min(stats.wingMinCos[part.name], n.dot(sunModel))
      } else if (t - lastSwitchMs > trrjSettleMs) {
        if (sunlit) stats.radiatorMaxSunCos[part.name] = Math.max(stats.radiatorMaxSunCos[part.name], Math.abs(n.dot(sunModel)))
        else stats.radiatorMinNadirCos[part.name] = Math.min(stats.radiatorMinNadirCos[part.name], Math.abs(n.dot(nadirModel)))
      }
    }
  }
  return stats
}

const EPOCH_MS = Date.parse(fallback.epoch)
const DAY = 86_400_000

describe('rig simulation on the published Locate LOD', () => {
  // Three seasons: the beta angle (and the eclipse fraction) differs widely.
  for (const offsetDays of [0, 23, 47]) {
    it(`keeps the cells on the sun and the radiators edge-on over two orbits (epoch +${offsetDays} d)`, () => {
      const stats = flyOrbits('iss_igoal_locate.glb', EPOCH_MS + offsetDays * DAY, 2)
      expect(stats.daylightSamples).toBeGreaterThan(3000)
      expect(stats.eclipseSamples).toBeGreaterThan(1000)
      // +Y is each wing's cell face (verified against the blanket texture:
      // dark cells on +Y, gold Kapton backing on −Y, iROSA overlays alike).
      for (const wing of WINGS) expect(stats.wingMinCos[wing], wing).toBeGreaterThan(Math.cos(3 * DEG2RAD))
      for (const radiator of RADIATORS) {
        expect(stats.radiatorMaxSunCos[radiator], radiator).toBeLessThan(Math.sin(2 * DEG2RAD))
        // Face-to-Earth is limited by how far nadir leaves the radiator's
        // roll plane (high beta); it stays within ~15°.
        expect(stats.radiatorMinNadirCos[radiator], radiator).toBeGreaterThan(Math.cos(15 * DEG2RAD))
      }
    }, 60_000)
  }
})

describe('camera idle sweeps on the published high asset', () => {
  it('keep every camera on its mount through the sweep', () => {
    const { station, pivotRoot } = mountStation('iss_igoal.glb')
    flyTo(station, EPOCH_MS)
    const animator = new RigAnimator(pivotRoot, {
      joints: IGOAL_JOINT_DEFS,
      oscillators: IGOAL_OSCILLATOR_SPECS,
      limits: IGOAL_TRRJ_LIMITS,
    }, new Map())
    expect(animator.failures).toEqual([])
    // Camera geometry centre in the frame of the part the camera is mounted on.
    const cameras = IGOAL_OSCILLATOR_SPECS.map((spec) => {
      const part = pivotRoot.getObjectByName(spec.target as string)
      if (!part?.parent) throw new Error(`missing ${String(spec.target)}`)
      return { name: part.name, part, mount: part.parent }
    })
    const centerOnMount = (c: (typeof cameras)[number]): THREE.Vector3 => {
      pivotRoot.updateMatrixWorld(true)
      return c.mount.worldToLocal(new THREE.Box3().setFromObject(c.part).getCenter(new THREE.Vector3()))
    }
    const rest = cameras.map(centerOnMount)
    const size = cameras.map((c) => new THREE.Box3().setFromObject(c.part).getSize(new THREE.Vector3()).length())
    let worst = 0
    for (let t = 0; t < 120_000; t += 2_500) {
      animator.step({ sunWorld: sunAt(EPOCH_MS + t), epochMs: EPOCH_MS + t, wallDeltaSec: 0.1, nowWallMs: t })
      cameras.forEach((c, i) => {
        // Displacement in the mount's frame, relative to the camera's own size.
        const moved = centerOnMount(c).distanceTo(rest[i]) * c.mount.getWorldScale(new THREE.Vector3()).x
        worst = Math.max(worst, moved / size[i])
      })
    }
    // A pan/tilt turns the camera in place: its centre may shift by a few
    // percent of its size (tilt hinges sit slightly off-centre), never swing
    // off the mount (the old ELP/SHP pan pivot moved it ~65% of its size).
    expect(worst).toBeLessThan(0.1)
  }, 60_000)
})
