// ─── DetailPreparation.test.ts — preparation render-target binding ───────────
//
// withPreparationTarget binds an offscreen target around GL work so detail
// prep warms the shader variant the bloom composer draws. A fake renderer
// records target changes; no GL is needed.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  countMissingTextures,
  createPreparationTarget,
  withPreparationTarget,
  type PreparationRenderer,
} from '@/rendering/iss/detailPreparation'

function fakeRenderer(initial: THREE.WebGLRenderTarget | null = null) {
  let current = initial
  const calls: Array<THREE.WebGLRenderTarget | null> = []
  const gl: PreparationRenderer = {
    getRenderTarget: () => current,
    setRenderTarget: (target) => {
      calls.push(target)
      current = target
    },
  }
  return { gl, calls, bound: () => current }
}

describe('withPreparationTarget', () => {
  it('runs the work untouched when there is no target', () => {
    const { gl, calls } = fakeRenderer()
    let ran = false
    withPreparationTarget(gl, null, () => { ran = true })
    expect(ran).toBe(true)
    expect(calls).toEqual([])
  })

  it('binds the target for the work, then restores the previous one', () => {
    const previous = new THREE.WebGLRenderTarget(1, 1)
    const target = new THREE.WebGLRenderTarget(1, 1)
    const { gl, calls, bound } = fakeRenderer(previous)
    let seen: THREE.WebGLRenderTarget | null = null
    withPreparationTarget(gl, target, () => { seen = bound() })
    expect(seen).toBe(target)
    expect(calls).toEqual([target, previous])
    expect(bound()).toBe(previous)
  })

  it('restores the previous target and propagates when the work throws', () => {
    const target = new THREE.WebGLRenderTarget(1, 1)
    const { gl, calls, bound } = fakeRenderer(null)
    expect(() =>
      withPreparationTarget(gl, target, () => { throw new Error('boom') }),
    ).toThrow('boom')
    expect(calls).toEqual([target, null])
    expect(bound()).toBeNull()
  })

  it('passes the work result through', () => {
    const target = new THREE.WebGLRenderTarget(1, 1)
    expect(withPreparationTarget(fakeRenderer().gl, target, () => 42)).toBe(42)
    expect(withPreparationTarget(fakeRenderer().gl, null, () => 'x')).toBe('x')
  })
})

describe('createPreparationTarget', () => {
  it('matches the composer colour format (HalfFloat)', () => {
    expect(createPreparationTarget().texture.type).toBe(THREE.HalfFloatType)
  })
})

describe('countMissingTextures', () => {
  it('counts textures the GLTF parser resolved to null', () => {
    const texture = new THREE.Texture()
    expect(countMissingTextures([texture, texture])).toBe(0)
    expect(countMissingTextures([texture, null, undefined])).toBe(2)
    expect(countMissingTextures([])).toBe(0)
  })
})
