// ─── HighlightKnee.test.ts — station glints stay under the bloom threshold ──
//
// A specular glint off a flat station panel (whole panel at one normal) went
// far above BLOOM_THRESHOLD and UnrealBloom drew it as a white square with a
// square halo between the array wings. The knee caps every station fragment
// below the threshold, as the sun already is (SunGlareBudget.test.ts).

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { BLOOM_THRESHOLD } from '@/rendering/post/bloomConfig'
import {
  HIGHLIGHT_KNEE_GLSL,
  KNEE_CEILING,
  KNEE_START,
  applyHighlightKnee,
  highlightKnee,
} from '@/rendering/iss/highlightKnee'

describe('highlightKnee', () => {
  it('leaves ordinary radiance untouched', () => {
    for (const v of [0, 0.4, 1, KNEE_START]) expect(highlightKnee(v)).toBe(v)
  })

  it('is continuous and monotonic, and never reaches the bloom threshold', () => {
    let previous = 0
    for (let v = 0; v <= 1000; v += 0.05) {
      const out = highlightKnee(v)
      expect(out).toBeGreaterThanOrEqual(previous - 1e-12)
      expect(out).toBeLessThan(BLOOM_THRESHOLD)
      previous = out
    }
    expect(KNEE_CEILING).toBeLessThan(BLOOM_THRESHOLD)
    // A roughness-0.3 mirror glint (~9 linear) lands just under the ceiling.
    expect(highlightKnee(9)).toBeGreaterThan(KNEE_CEILING - 0.01)
  })

  it('the shader uses the same constants', () => {
    expect(HIGHLIGHT_KNEE_GLSL).toContain(KNEE_START.toFixed(4))
    expect(HIGHLIGHT_KNEE_GLSL).toContain((KNEE_CEILING - KNEE_START).toFixed(4))
  })
})

describe('applyHighlightKnee', () => {
  it('patches a lit material once, under a stable program key', () => {
    const material = new THREE.MeshStandardMaterial()
    applyHighlightKnee(material)
    const hook = material.onBeforeCompile
    applyHighlightKnee(material)
    expect(material.onBeforeCompile).toBe(hook)
    const shader = { fragmentShader: '#include <opaque_fragment>' } as THREE.WebGLProgramParametersWithUniforms
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    expect(shader.fragmentShader).toContain('orbitalPeak')
    expect(shader.fragmentShader.trim().endsWith('#include <opaque_fragment>')).toBe(true)
  })

  it('re-applies to a clone, which three does not carry the hook to', () => {
    const base = new THREE.MeshStandardMaterial()
    applyHighlightKnee(base)
    const copy = base.clone()
    applyHighlightKnee(copy)
    expect(copy.customProgramCacheKey()).toBe(base.customProgramCacheKey())
    expect(copy.onBeforeCompile).not.toBe(THREE.Material.prototype.onBeforeCompile)
  })

  it('ignores unlit materials', () => {
    const basic = new THREE.MeshBasicMaterial()
    const key = basic.customProgramCacheKey()
    applyHighlightKnee(basic)
    expect(basic.customProgramCacheKey()).toBe(key)
  })
})
