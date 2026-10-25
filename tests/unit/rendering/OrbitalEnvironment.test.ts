import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  ORBITAL_ENV_INTENSITY,
  ORBITAL_ENV_NIGHT_FLOOR,
  earthBelowBrightness,
  environmentRotationForNadir,
  orientOrbitalEnvironment,
} from '@/rendering/scene/orbitalEnvironment'

/** The matrix three's WebGLMaterials builds from scene.environmentRotation for a PMREM map. */
function samplingMatrix(rotation: THREE.Euler): THREE.Matrix4 {
  const e = rotation.clone()
  e.x *= -1
  e.y *= -1
  e.z *= -1
  return new THREE.Matrix4().makeRotationFromEuler(e)
}

describe('environmentRotationForNadir', () => {
  const nadirs = [
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0.3, -0.2, 0.93),
    new THREE.Vector3(-4200, 3100, -4400),
  ]

  it.each(nadirs.map((n) => [n.toArray().join(', '), n] as const))(
    'makes the map sample its Earth (−Y) along nadir %s',
    (_, nadir) => {
      const rotation = environmentRotationForNadir(nadir, new THREE.Euler())
      const sampled = nadir.clone().normalize().applyMatrix4(samplingMatrix(rotation))
      expect(sampled.x).toBeCloseTo(0, 6)
      expect(sampled.y).toBeCloseTo(-1, 6)
      expect(sampled.z).toBeCloseTo(0, 6)
    },
  )

  it('keeps zenith on the map’s space side', () => {
    const nadir = new THREE.Vector3(0.6, 0.0, -0.8)
    const rotation = environmentRotationForNadir(nadir, new THREE.Euler())
    const zenith = nadir.clone().negate().applyMatrix4(samplingMatrix(rotation))
    expect(zenith.y).toBeCloseTo(1, 6)
  })
})

describe('earthBelowBrightness', () => {
  it('is dark at local midnight and full under a zenith sun', () => {
    expect(earthBelowBrightness(-1)).toBe(0)
    expect(earthBelowBrightness(-0.5)).toBe(0)
    expect(earthBelowBrightness(1)).toBeCloseTo(1, 9)
  })

  it('rises monotonically across the terminator', () => {
    let previous = -Infinity
    for (let c = -1; c <= 1; c += 0.05) {
      const value = earthBelowBrightness(c)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    // Sub-station point on the terminator: half the visible cap lit, grazing sun.
    expect(earthBelowBrightness(0)).toBeCloseTo(0.5 * 0.35, 9)
  })
})

describe('orientOrbitalEnvironment', () => {
  it('scales the environment between the night floor and full daylight', () => {
    const scene = new THREE.Scene()
    const sun = new THREE.Vector3(1, 0, 0)
    orientOrbitalEnvironment(scene, new THREE.Vector3(6800, 0, 0), sun)
    expect(scene.environmentIntensity).toBeCloseTo(ORBITAL_ENV_INTENSITY, 9)
    orientOrbitalEnvironment(scene, new THREE.Vector3(-6800, 0, 0), sun)
    expect(scene.environmentIntensity).toBeCloseTo(ORBITAL_ENV_NIGHT_FLOOR, 9)
    // The map's Earth now lies toward the planet's centre from the station.
    const sampled = new THREE.Vector3(1, 0, 0).applyMatrix4(samplingMatrix(scene.environmentRotation))
    expect(sampled.y).toBeCloseTo(-1, 6)
  })

  it('leaves the scene untouched for a degenerate position', () => {
    const scene = new THREE.Scene()
    scene.environmentIntensity = 0.7
    orientOrbitalEnvironment(scene, new THREE.Vector3(), new THREE.Vector3(1, 0, 0))
    expect(scene.environmentIntensity).toBe(0.7)
  })
})
