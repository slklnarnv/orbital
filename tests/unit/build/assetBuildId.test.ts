// ─── assetBuildId.test.ts — stable cache-busting id ──────────────────────────
//
// The id versions `/models` and `/textures` URLs. It must depend only on the
// versioned `.glb`/`.webp` bytes: the earlier all-files hash included
// `public/textures/README.md`, whose checkout line endings differ between
// Windows and Linux, producing two ids for the same commit.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeAssetBuildId } from '../../../scripts/asset-build-id.mjs'

let root: string
let model: string
let texture: string
let readme: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'orbital-asset-hash-'))
  await mkdir(path.join(root, 'public/models'), { recursive: true })
  await mkdir(path.join(root, 'public/textures'), { recursive: true })
  model = path.join(root, 'public/models/iss.glb')
  texture = path.join(root, 'public/textures/earth.webp')
  readme = path.join(root, 'public/textures/README.md')
  await writeFile(model, Buffer.from([1, 2, 3, 4]))
  await writeFile(texture, Buffer.from([5, 6, 7]))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('computeAssetBuildId', () => {
  it('changes when a deferred .ktx2 texture changes', async () => {
    const ktx2 = path.join(root, 'public/textures/earth-day-8k.ktx2')
    await writeFile(ktx2, Buffer.from([9, 9]))
    const before = computeAssetBuildId(root)
    await writeFile(ktx2, Buffer.from([9, 8]))
    expect(computeAssetBuildId(root)).not.toBe(before)
  })

  it('hashes only .glb/.webp bytes — README line endings and other files do not change it', async () => {
    await writeFile(readme, 'a\r\nb\r\n')
    const crlf = computeAssetBuildId(root)

    await writeFile(readme, 'a\nb\n')
    expect(computeAssetBuildId(root)).toBe(crlf)

    await writeFile(path.join(root, 'public/models/notes.txt'), 'not a versioned asset')
    expect(computeAssetBuildId(root)).toBe(crlf)
    expect(crlf).toMatch(/^[a-f0-9]{12}$/)
  })

  it('changes when the star catalogue (.bin) changes', async () => {
    const stars = path.join(root, 'public/textures/stars.bin')
    await writeFile(stars, Buffer.from([1]))
    const before = computeAssetBuildId(root)
    await writeFile(stars, Buffer.from([2]))
    expect(computeAssetBuildId(root)).not.toBe(before)
  })

  it('changes when a versioned asset changes', async () => {
    const before = computeAssetBuildId(root)
    await writeFile(model, Buffer.from([1, 2, 3, 5]))
    expect(computeAssetBuildId(root)).not.toBe(before)
  })

  it('is order-independent for the same file set', async () => {
    const first = computeAssetBuildId(root)
    const other = await mkdtemp(path.join(tmpdir(), 'orbital-asset-hash-'))
    try {
      // Same bytes, created in the opposite directory/file order.
      await mkdir(path.join(other, 'public/textures'), { recursive: true })
      await mkdir(path.join(other, 'public/models'), { recursive: true })
      await writeFile(path.join(other, 'public/textures/earth.webp'), Buffer.from([5, 6, 7]))
      await writeFile(path.join(other, 'public/models/iss.glb'), Buffer.from([1, 2, 3, 4]))
      expect(computeAssetBuildId(other)).toBe(first)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})
