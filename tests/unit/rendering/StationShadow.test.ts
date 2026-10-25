import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  SHADOW_HALF_EXTENT,
  SUN_LIGHT_DISTANCE,
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
