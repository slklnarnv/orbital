import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { FRAME_PRIORITY } from '@/rendering/framePriority'
import {
  SHADOW_HALF_EXTENT,
  SHADOW_MAP_SIZE,
  SUN_LIGHT_DISTANCE,
  SEEK_MIN_INTERVAL_MS,
  ShadowRefreshScheduler,
  aimSunLightAt,
  configureStationShadow,
} from '@/rendering/iss/stationShadow'

const DEG = Math.PI / 180

describe('aimSunLightAt', () => {
  it('keeps the light direction on the sun while centring the shadow box on the station', () => {
    const light = new THREE.DirectionalLight()
    configureStationShadow(light)
    const station = new THREE.Vector3(4200, 3100, -4400)
    const sun = new THREE.Vector3(0.3, -0.4, 0.866).normalize()
    aimSunLightAt(light, station, sun)
    const direction = light.position.clone().sub(light.target.position).normalize()
    expect(direction.distanceTo(sun)).toBeLessThan(1e-9)
    // The station projects to the centre of the shadow map, at mid depth.
    const ndc = station.clone().applyMatrix4(light.shadow.camera.matrixWorldInverse).applyMatrix4(light.shadow.camera.projectionMatrix)
    expect(Math.hypot(ndc.x, ndc.y)).toBeLessThan(1e-6)
    expect(Math.abs(ndc.z)).toBeLessThan(0.01)
    // A point at the box edge stays inside it.
    const edge = station.clone().add(new THREE.Vector3(1, 0, 0).cross(sun).normalize().multiplyScalar(SHADOW_HALF_EXTENT - 1))
    const edgeNdc = edge.applyMatrix4(light.shadow.camera.matrixWorldInverse).applyMatrix4(light.shadow.camera.projectionMatrix)
    expect(Math.max(Math.abs(edgeNdc.x), Math.abs(edgeNdc.y))).toBeLessThan(1)
  })

  it('configures a cached (manually redrawn) shadow around the light distance', () => {
    const light = new THREE.DirectionalLight()
    configureStationShadow(light)
    expect(light.shadow.autoUpdate).toBe(false)
    expect(light.shadow.camera.near).toBeLessThan(SUN_LIGHT_DISTANCE - SHADOW_HALF_EXTENT)
    expect(light.shadow.camera.far).toBeGreaterThan(SUN_LIGHT_DISTANCE + SHADOW_HALF_EXTENT)
  })
})

describe('ShadowRefreshScheduler', () => {
  const sun = (deg: number) => new THREE.Vector3(Math.cos(deg * DEG), Math.sin(deg * DEG), 0)

  it('redraws first, then only when the sun or a joint moves past the threshold', () => {
    const scheduler = new ShadowRefreshScheduler(0.15 * DEG, 50, 2000)
    expect(scheduler.shouldRefresh(0, sun(0), [0, 0])).toBe(true)
    expect(scheduler.shouldRefresh(100, sun(0.1), [0, 0])).toBe(false)
    expect(scheduler.shouldRefresh(200, sun(0.2), [0, 0])).toBe(true)
    expect(scheduler.shouldRefresh(300, sun(0.2), [0, 0.1 * DEG])).toBe(false)
    expect(scheduler.shouldRefresh(400, sun(0.2), [0, 0.3 * DEG])).toBe(true)
  })

  it('caps redraws at the minimum interval (300× time warp)', () => {
    const scheduler = new ShadowRefreshScheduler(0.15 * DEG, 50, 2000)
    let redraws = 0
    // 19.5°/s of sun motion in the station frame, 60 fps, one second.
    for (let frame = 0; frame < 60; frame += 1) {
      if (scheduler.shouldRefresh(frame * (1000 / 60), sun(frame * (19.5 / 60)), [])) redraws += 1
    }
    expect(redraws).toBeLessThanOrEqual(21)
    expect(redraws).toBeGreaterThanOrEqual(15)
  })

  it('redraws at least every maxInterval, and at once after invalidate()', () => {
    const scheduler = new ShadowRefreshScheduler(0.15 * DEG, 50, 2000)
    scheduler.shouldRefresh(0, sun(0), [])
    expect(scheduler.shouldRefresh(1999, sun(0), [])).toBe(false)
    expect(scheduler.shouldRefresh(2000, sun(0), [])).toBe(true)
    scheduler.invalidate()
    expect(scheduler.shouldRefresh(2010, sun(0), [])).toBe(true)
  })
})

describe('cached shadow map alignment (Follow-mode flicker)', () => {
  // The map is drawn on one frame and sampled, unchanged, on later frames.
  // A station-fixed point must land on the same texel on both, whatever the
  // station moved in between: the interpolated step varies 0–160 m per frame.
  const sun = new THREE.Vector3(0.3, -0.4, 0.866).normalize()
  const texelKm = (2 * SHADOW_HALF_EXTENT) / SHADOW_MAP_SIZE
  const along = new THREE.Vector3(0.6, 0.8, 0).cross(sun).normalize() // in the map plane
  const pointOnArray = new THREE.Vector3(48, 3, -6) // station-fixed offset (km)

  /** Shadow-map texel a world point maps to with the light aimed at `aim`. */
  function texelOf(world: THREE.Vector3, aim: THREE.Vector3): THREE.Vector2 {
    const light = new THREE.DirectionalLight()
    configureStationShadow(light)
    aimSunLightAt(light, aim, sun)
    const uv = world.clone().applyMatrix4(light.shadow.matrix)
    return new THREE.Vector2(uv.x, uv.y).multiplyScalar(SHADOW_MAP_SIZE)
  }

  // Frame k: the map is drawn after a 0 m step; frame n samples it after 160 m.
  const before = new THREE.Vector3(4200, 3100, -4400)
  const drawn = before.clone()
  const previous = before.clone().addScaledVector(along, 300)
  const sampled = previous.clone().addScaledVector(along, 0.16)

  it('stays on the same texel when the light is aimed at the current frame pose', () => {
    const atDraw = texelOf(drawn.clone().add(pointOnArray), drawn)
    const atSample = texelOf(sampled.clone().add(pointOnArray), sampled)
    expect(atSample.distanceTo(atDraw)).toBeLessThan(0.01)
  })

  it('drifts by over two texels when aimed at the previous frame pose', () => {
    // The bug: aimed one frame behind, the map's offset is the step taken on
    // the frame it was DRAWN, but it is sampled with a different step.
    const atDraw = texelOf(drawn.clone().add(pointOnArray), drawn) // drawn after a 0 m step
    const atSample = texelOf(sampled.clone().add(pointOnArray), previous) // sampled one step behind
    expect(texelKm).toBeLessThan(0.16 / 2)
    expect(atSample.distanceTo(atDraw)).toBeGreaterThan(2)
  })

  it('the station pose advances before every consumer', () => {
    // Equal priorities run in subscription order, children first; the pose
    // must not depend on where a consumer sits in the tree.
    const { stationPose, cameraControls, scene, composer } = FRAME_PRIORITY
    expect(stationPose).toBeLessThan(cameraControls)
    expect(cameraControls).toBeLessThan(scene)
    expect(scene).toBeLessThan(composer)
    // Any priority > 0 takes over R3F's render loop; only the composer may.
    expect([stationPose, cameraControls, scene].every((priority) => priority <= 0)).toBe(true)
  })
})

describe('ShadowRefreshScheduler while seeking', () => {
  const sun = (deg: number) => new THREE.Vector3(Math.cos(deg * DEG), Math.sin(deg * DEG), 0)
  it('redraws at most every SEEK_MIN_INTERVAL_MS during a scrub', () => {
    const scheduler = new ShadowRefreshScheduler()
    let redraws = 0
    // One second of a scrub at 60 fps, the sun swinging 2° per frame.
    for (let frame = 0; frame < 60; frame++) {
      if (scheduler.shouldRefresh(frame * (1000 / 60), sun(frame * 2), [], true)) redraws += 1
    }
    expect(redraws).toBeLessThanOrEqual(Math.ceil(1000 / SEEK_MIN_INTERVAL_MS) + 1)
    expect(redraws).toBeGreaterThanOrEqual(6)
  })

  it('keeps the normal floor when not seeking', () => {
    const scheduler = new ShadowRefreshScheduler()
    let redraws = 0
    for (let frame = 0; frame < 60; frame++) {
      if (scheduler.shouldRefresh(frame * (1000 / 60), sun(frame * 2), [])) redraws += 1
    }
    expect(redraws).toBeGreaterThanOrEqual(19)
  })
})
