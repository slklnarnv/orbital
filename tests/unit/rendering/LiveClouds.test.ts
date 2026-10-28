import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CLOUD_FADE_MS, cloudFrame } from '@/rendering/earth/liveClouds'

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

describe('cloudFrame (live clouds crossfade)', () => {
  const live = new THREE.Texture()
  const newer = new THREE.Texture()

  it('shows the drifting composite until a live map arrives', () => {
    const f = cloudFrame({ current: null, next: null, fadeStart: 0 }, 1000, 1.2)
    expect(f).toEqual({ mapA: null, rotationA: 1.2, mapB: null, offsetB: 1.2 / (2 * Math.PI), blend: 0 })
  })

  it('fades live in over the composite at the composite’s frame offset', () => {
    const mid = cloudFrame({ current: null, next: live, fadeStart: 0 }, CLOUD_FADE_MS / 2, 1.2)
    expect(mid.mapB).toBe(live)
    expect(mid.rotationA).toBe(1.2)
    // B is unrotated: in A's rotated frame it sits rotation/2π further east.
    expect(mid.offsetB).toBeCloseTo(1.2 / (2 * Math.PI), 12)
    expect(mid.blend).toBeCloseTo(0.5, 12)
    expect(cloudFrame({ current: null, next: live, fadeStart: 0 }, CLOUD_FADE_MS * 2, 1.2).blend).toBe(1)
  })

  it('stops drifting once live, and fades hour to hour without an offset', () => {
    const f = cloudFrame({ current: live, next: newer, fadeStart: 0 }, CLOUD_FADE_MS / 4, 1.2)
    expect(f.rotationA).toBe(0)
    expect(f.offsetB).toBe(0)
    expect(f.blend).toBeGreaterThan(0)
    expect(f.blend).toBeLessThan(0.5)
  })
})

describe('cloud shaders sample both maps the same way', () => {
  it('offsets map B from map A in the shell and in the surface shadows alike', () => {
    expect(read('src/rendering/shaders/clouds.frag')).toContain(
      'cloudMap, vUv, cloudMapB, vec2(vUv.x + cloudOffsetB, vUv.y), cloudBlend,',
    )
    expect(read('src/rendering/shaders/earthSurface.frag')).toContain(
      'cloudMap, cloudUv, cloudMapB, vec2(cloudUv.x + cloudOffsetB, cloudUv.y), cloudBlend,',
    )
  })

  it('samples each map only while it contributes', () => {
    const glsl = read('src/rendering/shaders/cloudDensity.glsl')
    expect(glsl).toContain('float a = blend < 1.0 ? sampleCloudMap(mapA, uvA, texSize) : 0.0;')
    expect(glsl).toContain('if (blend <= 0.0) return a;')
  })
})
