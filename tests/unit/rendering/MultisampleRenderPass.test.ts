// ─── MultisampleRenderPass.test.ts — MSAA only where there are edges ─────────
//
// The Bloom composer spent ~10 of its 18.5 GPU ms per frame on a 4× MSAA
// HalfFloat target that the bloom blend wrote back into and three resolved
// twice, depth included. The scene pass now owns the only multisampled
// target, resolves color only, and the composer's own targets are
// single-sample. No GL here: this pins the pass's contract.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { MultisampleRenderPass } from '@/rendering/post/MultisampleRenderPass'

describe('MultisampleRenderPass', () => {
  const pass = new MultisampleRenderPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 4)

  it('multisamples the scene into a HalfFloat target', () => {
    expect(pass.target.samples).toBe(4)
    expect(pass.target.texture.type).toBe(THREE.HalfFloatType)
  })

  it('resolves color only — nothing downstream reads the depth', () => {
    expect(pass.target.resolveDepthBuffer).toBe(false)
  })

  it('draws into the read buffer like RenderPass (no swap)', () => {
    expect(pass.needsSwap).toBe(false)
  })

  it('follows the composer size', () => {
    pass.setSize(1920, 1070)
    expect([pass.target.width, pass.target.height]).toEqual([1920, 1070])
  })
})
