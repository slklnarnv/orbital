// ─── ISSModelBuild.test.ts — Phase A asset/rig contract regressions ──────────
//
// Exercises the actual build/manifest helper functions (plan 001 §6,
// "Focused regression files") on small synthetic documents:
//   - the independent declared-vs-decoded bounds comparison detects stale
//     GLB JSON declarations that recomputed comparisons cannot;
//   - prune({ keepLeaves: true }) — the build's actual call — preserves empty
//     authored attachment frames (and their transforms);
//   - splitRadiatorPanels splits only ±Y panel faces out of the shared
//     `Truss` primitives and leaves everything else untouched;
//   - textureCompress + the build's I/O registration emit a conforming
//     EXT_texture_webp declaration with readable dimensions;
//   - validateCandidate rejects an invalid candidate and the published
//     runtime asset is never written by imported helpers.
//
// NOTE: statically importing the two CLI modules is itself part of the
// contract — if either ran its CLI at import time, it would exit the test
// process (no GLB argument) and every case in this file would fail.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Document, NodeIO, type Material, type Mesh, type Node as GltfNode, type Primitive, type Scene } from '@gltf-transform/core'
import { EXTTextureWebP } from '@gltf-transform/extensions'
import { prune, textureCompress } from '@gltf-transform/functions'
import sharp from 'sharp'

import { validateCandidate, splitRadiatorPanels } from '../../../scripts/build-iss-model.mjs'
import { checkDeclaredBounds } from '../../../scripts/iss-model-manifest.mjs'
import {
  PROTECTED_FRAMES,
  REQUIRED_NODES,
  parseGlbJsonDeclarations,
  validateDocumentRig,
} from '../../../scripts/iss-rig-manifest.mjs'

// Parsed GLB JSON chunks are untyped by nature; one alias keeps the escape hatch explicit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GlbJson = Record<string, any>

const PUBLISHED_ASSET = path.resolve(__dirname, '../../../public/models/iss_igoal.glb')

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

let workDir: string
beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'iss-model-build-'))
})
afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

// ─── Small-document helpers ───────────────────────────────────────────────────

function trianglePrim(
  doc: Document,
  materialName: string,
  positions: number[],
  indices: number[],
): { prim: Primitive; material: Material } {
  const material = doc.createMaterial(materialName)
  // Programmatic documents need accessors attached to a Buffer for writing.
  // NOTE: createAccessor's first argument is the NAME; the type is set
  // separately (same pattern as build-iss-model.mjs).
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()
  const position = doc
    .createAccessor('positions', buffer)
    .setType('VEC3')
    .setArray(new Float32Array(positions))
  const indicesAccessor = doc
    .createAccessor('indices', buffer)
    .setType('SCALAR')
    .setArray(new Uint32Array(indices))
  const prim = doc.createPrimitive()
  prim.setAttribute('POSITION', position)
  prim.setIndices(indicesAccessor)
  prim.setMaterial(material)
  return { prim, material }
}

function sceneWithMesh(doc: Document, mesh: Mesh, nodeName: string): Scene {
  const scene = doc.createScene('scene')
  const node = doc.createNode(nodeName)
  node.setMesh(mesh)
  scene.addChild(node)
  return scene
}

/** Re-serialize a GLB container with a mutated JSON chunk (BIN preserved). */
function rewriteGlbJson(buffer: Buffer, mutate: (json: GlbJson) => void): Buffer {
  const jsonLen = buffer.readUInt32LE(12)
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLen))
  mutate(json)
  const binOffset = 20 + jsonLen
  const binLen = buffer.readUInt32LE(binOffset)
  const bin = buffer.subarray(binOffset + 8, binOffset + 8 + binLen)

  let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const pad = (4 - (jsonBytes.length % 4)) % 4
  if (pad > 0) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(pad, 0x20)])

  const total = 12 + 8 + jsonBytes.length + 8 + bin.length
  const out = Buffer.alloc(total)
  out.writeUInt32LE(0x46546c67, 0) // 'glTF'
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonBytes.length, 12)
  out.writeUInt32LE(0x4e4f534a, 16) // 'JSON'
  jsonBytes.copy(out, 20)
  const binHeader = 20 + jsonBytes.length
  out.writeUInt32LE(bin.length, binHeader)
  out.writeUInt32LE(0x004e4942, binHeader + 4) // 'BIN\0'
  bin.copy(out, binHeader + 8)
  return out
}

// ─── CLI guards ───────────────────────────────────────────────────────────────

describe('CLI entry-point guards', () => {
  it('imports both CLI modules without executing a conversion or touching the published asset', async () => {
    const before = await sha256(PUBLISHED_ASSET)
    await import('../../../scripts/build-iss-model.mjs')
    await import('../../../scripts/iss-model-manifest.mjs')
    expect(await sha256(PUBLISHED_ASSET)).toBe(before)
  })
})

// ─── Declared-vs-decoded bounds (V1) ──────────────────────────────────────────

describe('checkDeclaredBounds', () => {
  it('detects stale JSON declarations that a recomputed comparison would miss', async () => {
    const doc = new Document()
    const mesh = doc.createMesh()
    const { prim } = trianglePrim(
      doc,
      'Mat',
      [0, 0, 0, 1, 0, 0, 0, 2, -1],
      [0, 1, 2],
    )
    mesh.addPrimitive(prim)
    // Real files declare POSITION bounds (spec requirement): the glTF-Transform
    // writer computes and emits them for POSITION-attribute accessors, so the
    // fixture matches the production shape without manual setters.
    sceneWithMesh(doc, mesh, 'Node')

    const io = new NodeIO()
    const cleanPath = path.join(workDir, 'clean.glb')
    await io.write(cleanPath, doc)

    const original = await readFile(cleanPath)
    const originalJson = parseGlbJsonDeclarations(original) as GlbJson
    const positionAccessor = originalJson.accessors.find((a: GlbJson) => a.type === 'VEC3')
    expect(positionAccessor?.min).toBeDefined()
    expect(positionAccessor?.max).toBeDefined()

    // Corrupt only the DECLARATIONS (+5 on every component); the geometry
    // bytes are untouched, so the decoded root is identical.
    const stalePath = path.join(workDir, 'stale.glb')
    await writeFile(
      stalePath,
      rewriteGlbJson(original, (json) => {
        for (const accessor of json.accessors) {
          if (accessor.type !== 'VEC3') continue
          accessor.min = accessor.min.map((v: number) => v + 5)
          accessor.max = accessor.max.map((v: number) => v + 5)
        }
      }),
    )

    const staleDoc = await io.read(stalePath)
    const result = await checkDeclaredBounds(stalePath, staleDoc.getRoot())
    expect(result.supported).toBe(true)
    expect(result.compared).toBeGreaterThanOrEqual(1)
    // A recomputed min/max (Accessor.getMin/getMax) would report ~0 here and
    // "prove" the stale file clean; the independent comparison must not.
    expect(result.maxDelta).toBeGreaterThan(4)
  })

  it('reports clean files as non-diverged', async () => {
    const doc = new Document()
    const mesh = doc.createMesh()
    const { prim } = trianglePrim(doc, 'Mat', [0, 0, 0, 1, 0, 0, 0, 2, -1], [0, 1, 2])
    mesh.addPrimitive(prim)
    sceneWithMesh(doc, mesh, 'Node')

    const cleanPath = path.join(workDir, 'clean2.glb')
    await new NodeIO().write(cleanPath, doc)
    const doc2 = await new NodeIO().read(cleanPath)
    const result = await checkDeclaredBounds(cleanPath, doc2.getRoot())
    expect(result.supported).toBe(true)
    expect(result.diverged).toBe(0)
  })

  it('returns supported:false for non-GLB input instead of throwing', async () => {
    const gltfPath = path.join(workDir, 'plain.gltf')
    await writeFile(gltfPath, '{ "asset": { "version": "2.0" } }')
    const doc = await new NodeIO().read(gltfPath)
    const result = await checkDeclaredBounds(gltfPath, doc.getRoot())
    expect(result.supported).toBe(false)
  })

  it('parseGlbJsonDeclarations rejects non-GLB buffers', () => {
    expect(parseGlbJsonDeclarations(Buffer.from('not a glb'))).toBeNull()
  })
})

// ─── Attachment-frame preservation (P3) ───────────────────────────────────────

describe('attachment frame preservation', () => {
  function docWithEmptyFrame(): Document {
    const doc = new Document()
    const scene = doc.createScene('scene')
    const parent = doc.createNode('WRR')
    const frame = doc.createNode('SSRMS_WRY_AttachmentPoint')
    frame.setTranslation([1, 2, 3])
    parent.addChild(frame)
    scene.addChild(parent)
    return doc
  }

  it('prune({ keepLeaves: true }) — the build call — preserves empty frames and their transforms', async () => {
    const doc = docWithEmptyFrame()
    await doc.transform(prune({ keepLeaves: true }))
    const frame = doc.getRoot().listNodes().find((n) => n.getName() === 'SSRMS_WRY_AttachmentPoint')
    expect(frame).toBeDefined()
    expect(Array.from(frame!.getTranslation())).toEqual([1, 2, 3])
    expect(frame!.getParentNode()?.getName()).toBe('WRR')
  })

  it('default prune removes the same frame — keepLeaves is what protects it', async () => {
    const doc = docWithEmptyFrame()
    await doc.transform(prune())
    expect(
      doc.getRoot().listNodes().find((n) => n.getName() === 'SSRMS_WRY_AttachmentPoint'),
    ).toBeUndefined()
  })
})

// ─── Rig contract reporting ───────────────────────────────────────────────────

describe('validateDocumentRig', () => {
  it('names missing required nodes and misparented protected frames', () => {
    const doc = new Document()
    const scene = doc.createScene('scene')
    const wrongParent = doc.createNode('NotMBS')
    const frame = doc.createNode('MBS_MGF_1')
    wrongParent.addChild(frame)
    scene.addChild(wrongParent)

    const result = validateDocumentRig(doc)
    for (const required of REQUIRED_NODES) {
      if (required === 'MBS_MGF_1') continue
      expect(result.errors).toContain(`missing required node "${required}"`)
    }
    expect(result.errors).toContain(
      'protected frame "MBS_MGF_1" has parent "NotMBS", expected "MBS"',
    )
  })

  it('passes on a document carrying the protected frames with expected parents', () => {
    const doc = new Document()
    const scene = doc.createScene('scene')
    const byParent = new Map<string, GltfNode>()
    for (const frame of PROTECTED_FRAMES) {
      let parent = byParent.get(frame.parent)
      if (!parent) {
        parent = doc.createNode(frame.parent)
        scene.addChild(parent)
        byParent.set(frame.parent, parent)
      }
      parent.addChild(doc.createNode(frame.node))
    }
    const result = validateDocumentRig(doc)
    expect(result.errors.filter((e: string) => e.includes('protected frame'))).toEqual([])
  })
})

// ─── Radiator panel split (M4 build-time material split) ─────────────────────

describe('splitRadiatorPanels', () => {
  function radiatorDoc(): { doc: Document; mesh: Mesh; trussMaterial: Material } {
    const doc = new Document()
    const mesh = doc.createMesh()
    // Primitive 0: MLI base-beam stand-in — a +Y-facing triangle that must
    // NOT be classified as panel (only `Truss`-material primitives split).
    const mli = trianglePrim(doc, 'MLI.Generic', [0, 0, 0, 1, 0, 0, 0, 0, -1], [0, 1, 2])
    mesh.addPrimitive(mli.prim)
    // Primitive 1: shared-`Truss` material holding one +Y panel triangle and
    // one +X structure triangle.
    const truss = trianglePrim(
      doc,
      'Truss',
      [0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 1],
      [0, 1, 2, 0, 3, 4],
    )
    mesh.addPrimitive(truss.prim)

    const scene = doc.createScene('scene')
    // Non-uniform-free ancestor scale exercises the world-matrix transform.
    const scaleNode = doc.createNode('ScaleRoot')
    scaleNode.setScale([2, 2, 2])
    const radiator = doc.createNode('P1_Radiator')
    radiator.setMesh(mesh)
    scaleNode.addChild(radiator)
    scene.addChild(scaleNode)
    return { doc, mesh, trussMaterial: truss.material }
  }

  it('splits only the ±Y faces of the Truss primitive into a dedicated coating', () => {
    const { doc, mesh, trussMaterial } = radiatorDoc()
    const splits = splitRadiatorPanels(doc)
    expect(splits).toHaveLength(1)

    const prims = mesh.listPrimitives()
    expect(prims).toHaveLength(3)

    // MLI primitive untouched.
    expect(prims[0].getMaterial()?.getName()).toBe('MLI.Generic')
    expect(prims[0].getIndices()?.getCount()).toBe(3)

    // Truss primitive keeps only the structure triangle.
    expect(prims[1].getMaterial()?.getName()).toBe('Truss')
    expect(prims[1].getIndices()?.getCount()).toBe(3)

    // New panel primitive: coating material, panel indices, SHARED attributes.
    expect(prims[2].getMaterial()?.getName()).toBe('Radiator_Panel_Coating')
    expect(prims[2].getIndices()?.getCount()).toBe(3)
    expect(prims[2].getAttribute('POSITION')).toBe(prims[1].getAttribute('POSITION'))

    // The shared Truss material itself is never modified.
    expect(trussMaterial.getBaseColorFactor()).toEqual([1, 1, 1, 1])
  })

  it('shares one coating material across both radiators and skips non-radiator nodes', () => {
    const doc = radiatorDoc().doc
    // Add an S1 radiator with the same shape and an unrelated node.
    const mesh = doc.createMesh()
    const truss = trianglePrim(doc, 'Truss', [0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 1], [0, 1, 2, 0, 3, 4])
    mesh.addPrimitive(truss.prim)
    const s1 = doc.createNode('S1_Radiator')
    s1.setMesh(mesh)
    doc.getRoot().listScenes()[0].addChild(s1)
    const unrelated = doc.createNode('Truss_S4_Details_Misc')
    const otherMesh = doc.createMesh()
    const other = trianglePrim(doc, 'Truss', [0, 0, 0, 1, 0, 0, 0, 0, -1], [0, 1, 2])
    otherMesh.addPrimitive(other.prim)
    unrelated.setMesh(otherMesh)
    doc.getRoot().listScenes()[0].addChild(unrelated)

    splitRadiatorPanels(doc)

    const coatings = doc
      .getRoot()
      .listMaterials()
      .filter((m) => m.getName() === 'Radiator_Panel_Coating')
    expect(coatings).toHaveLength(1)
    // Only nodes named P1_Radiator/S1_Radiator are processed.
    expect(otherMesh.listPrimitives()).toHaveLength(1)
  })
})

// ─── WebP extension serialization (P1) ───────────────────────────────────────

describe('WebP extension serialization', () => {
  it('textureCompress + registered NodeIO emit a conforming EXT_texture_webp declaration', async () => {
    const doc = new Document()
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    const material = doc.createMaterial('Mat')
    const texture = doc.createTexture('Tex').setImage(png).setMimeType('image/png')
    material.setBaseColorTexture(texture)
    const mesh = doc.createMesh()
    const { prim } = trianglePrim(doc, 'unused', [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])
    prim.setMaterial(material)
    mesh.addPrimitive(prim)
    sceneWithMesh(doc, mesh, 'Node')

    await doc.transform(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [64, 64] }),
    )
    expect(doc.getRoot().listTextures()[0].getMimeType()).toBe('image/webp')

    const io = new NodeIO().registerExtensions([EXTTextureWebP])
    const outPath = path.join(workDir, 'webp.glb')
    await io.write(outPath, doc)

    const json = parseGlbJsonDeclarations(await readFile(outPath)) as GlbJson
    expect(json.extensionsUsed).toContain('EXT_texture_webp')
    expect(json.extensionsRequired).toContain('EXT_texture_webp')
    const textureDef = json.textures[0]
    expect(textureDef.extensions.EXT_texture_webp.source).toBe(json.images.findIndex(() => true))

    // Re-reading through the registered IO exposes real dimensions.
    const reread = await io.read(outPath)
    const size = reread.getRoot().listTextures()[0].getSize()
    if (size === null) throw new Error('re-read texture has no size')
    expect(size[0]).toBeGreaterThan(0)
    expect(size[1]).toBeGreaterThan(0)
  })

  it('an unregistered NodeIO drops the declaration — reproducing the shipped-asset defect', async () => {
    const doc = new Document()
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } })
      .png()
      .toBuffer()
    const material = doc.createMaterial('Mat')
    const texture = doc.createTexture('Tex').setImage(png).setMimeType('image/webp')
    material.setBaseColorTexture(texture)
    const mesh = doc.createMesh()
    const { prim } = trianglePrim(doc, 'unused', [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])
    prim.setMaterial(material)
    mesh.addPrimitive(prim)
    sceneWithMesh(doc, mesh, 'Node')

    const outPath = path.join(workDir, 'webp-unregistered.glb')
    await new NodeIO().write(outPath, doc)
    const json = parseGlbJsonDeclarations(await readFile(outPath)) as GlbJson
    expect(json.extensionsUsed ?? []).not.toContain('EXT_texture_webp')
  })
})

// ─── Candidate validation gate (P2) ──────────────────────────────────────────

describe('validateCandidate', () => {
  it('rejects a candidate missing the rig contract and leaves the published asset byte-identical', async () => {
    const doc = new Document()
    const mesh = doc.createMesh()
    const { prim } = trianglePrim(doc, 'Mat', [0, 0, 0, 1, 0, 0, 0, 2, -1], [0, 1, 2])
    mesh.addPrimitive(prim)
    sceneWithMesh(doc, mesh, 'JustANode')
    const candidatePath = path.join(workDir, 'iss_igoal_candidate.glb')
    await new NodeIO().write(candidatePath, doc)

    const publishedBefore = await sha256(PUBLISHED_ASSET)
    await expect(validateCandidate(candidatePath)).rejects.toThrow(/rig contract violations/)
    expect(await sha256(PUBLISHED_ASSET)).toBe(publishedBefore)
  })
})
