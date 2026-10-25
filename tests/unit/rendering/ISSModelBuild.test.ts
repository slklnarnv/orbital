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

import {
  applySourceMaterials,
  batchRigidMeshes,
  classifyTextureUsage,
  ktxCreateArgs,
  readSourceMaterials,
  SOURCE_METALLIC_SCALE,
  splitRadiatorPanels,
  stripVertexColors,
  validateCandidate,
} from '../../../scripts/build-iss-model.mjs'
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

describe('stripVertexColors', () => {
  it('drops COLOR_0 from every primitive and reports counts per material', () => {
    const doc = new Document()
    const mesh = doc.createMesh()
    const hull = trianglePrim(doc, 'MLM', [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])
    const buffer = doc.getRoot().listBuffers()[0]
    // Baked near-black shading layer, as on Nauka's hull in the source FBX.
    hull.prim.setAttribute(
      'COLOR_0',
      doc.createAccessor('colors', buffer).setType('VEC4').setArray(new Float32Array(12).fill(0.05)),
    )
    const plain = trianglePrim(doc, 'Truss', [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])
    mesh.addPrimitive(hull.prim)
    mesh.addPrimitive(plain.prim)
    sceneWithMesh(doc, mesh, 'MLM')

    const stripped = stripVertexColors(doc)

    expect(hull.prim.getAttribute('COLOR_0')).toBeNull()
    expect(hull.prim.getAttribute('POSITION')).not.toBeNull()
    expect(stripped.get('MLM')).toBe(1)
    expect(stripped.has('Truss')).toBe(false)
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

// ─── Source-material graft ────────────────────────────────────────────────────

async function solidPng(color: string): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: color } }).png().toBuffer()
}

describe('readSourceMaterials + applySourceMaterials', () => {
  it('grafts factors and maps by name, keeps FBX images, and restores only the listed cutouts', async () => {
    // Source GLB: what Blender renders.
    const source = new Document()
    const tex = (name: string, png: Buffer) => source.createTexture(name).setImage(png).setMimeType('image/png')
    const [red, green, blue] = await Promise.all([solidPng('red'), solidPng('green'), solidPng('blue')])
    const mesh = source.createMesh()
    for (const [name, setup] of [
      ['ELC_Base', (m: Material) => m.setAlphaMode('BLEND').setBaseColorTexture(tex('ELC_src', red)).setMetallicRoughnessTexture(tex('ELC_MR', green))],
      ['Truss', (m: Material) => m.setAlphaMode('BLEND').setMetallicRoughnessTexture(tex('Truss_MR', green))],
      ['MLI.Generic', (m: Material) => m.setMetallicFactor(0).setRoughnessFactor(0.5).setBaseColorTexture(tex('MLI_Diffuse', blue)).setNormalTexture(tex('MLI_Normal', blue)).setNormalScale(3)],
    ] as const) {
      const { prim, material } = trianglePrim(source, name, [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])
      setup(material)
      mesh.addPrimitive(prim)
    }
    sceneWithMesh(source, mesh, 'IGOAL_SSREF')
    const sourcePath = path.join(workDir, 'source.glb')
    await new NodeIO().write(sourcePath, source)
    const materials = readSourceMaterials(await readFile(sourcePath))
    expect([...materials.keys()]).toEqual(['ELC_Base', 'Truss', 'MLI.Generic'])
    expect(materials.get('MLI.Generic')?.normalScale).toBe(3)

    // Target: FBX2glTF output — Phong defaults, its own lossless base images.
    const target = new Document()
    const fbxBase = target.createTexture('ELC_fbx').setImage(red).setMimeType('image/png')
    const byName = new Map<string, Material>()
    for (const name of ['ELC_Base', 'Truss', 'MLI.Generic', 'Extra']) {
      byName.set(name, target.createMaterial(name).setMetallicFactor(0.4).setRoughnessFactor(0.272))
    }
    byName.get('ELC_Base')?.setBaseColorTexture(fbxBase)
    byName.get('MLI.Generic')?.setBaseColorFactor([0.8, 0.8, 0.8, 1]).setNormalTexture(target.createTexture('MLI_fbx_n').setImage(blue).setMimeType('image/png'))

    const report = applySourceMaterials(target, materials)
    expect(report).toMatchObject({ matched: 3, unmatched: ['Extra'], metallicRoughness: 2, baseColor: 1, normal: 0, cutouts: ['ELC_Base'] })

    const elc = byName.get('ELC_Base')
    expect(elc?.getBaseColorTexture()).toBe(fbxBase) // the FBX's lossless image wins
    expect(elc?.getMetallicRoughnessTexture()?.getName()).toBe('ELC_MR')
    // Single-sided: double-sided thin blankets z-fight front against back.
    expect([elc?.getAlphaMode(), elc?.getAlphaCutoff(), elc?.getDoubleSided()]).toEqual(['MASK', 0.5, false])
    expect([elc?.getMetallicFactor(), elc?.getRoughnessFactor()]).toEqual([SOURCE_METALLIC_SCALE, 1])
    // BLEND in the source, but not a listed cutout: stays as the repairs left it.
    expect(byName.get('Truss')?.getAlphaMode()).toBe('OPAQUE')
    const mli = byName.get('MLI.Generic')
    expect(mli?.getBaseColorTexture()?.getName()).toBe('MLI_Diffuse') // absent from the FBX
    expect(mli?.getNormalTexture()?.getName()).toBe('MLI_fbx_n')
    expect(mli?.getNormalScale()).toBe(3)
    expect(mli?.getBaseColorFactor()).toEqual([1, 1, 1, 1])
    expect([mli?.getMetallicFactor(), mli?.getRoughnessFactor()]).toEqual([0, 0.5])
  })
})

describe('KTX2 encode plan', () => {
  it('encodes colour slots sRGB, data slots linear, and keeps alpha only where a material reads it', async () => {
    const doc = new Document()
    const png = await solidPng('white')
    const t = (name: string) => doc.createTexture(name).setImage(png).setMimeType('image/png')
    const [opaqueBase, maskBase, normal, mr] = [t('opaque'), t('mask'), t('normal'), t('mr')]
    doc.createMaterial('A').setBaseColorTexture(opaqueBase).setNormalTexture(normal).setMetallicRoughnessTexture(mr)
    doc.createMaterial('B').setAlphaMode('MASK').setBaseColorTexture(maskBase)

    const usage = classifyTextureUsage(doc)
    expect(usage.get(opaqueBase)).toEqual({ color: true, data: false, alpha: false })
    expect(usage.get(maskBase)).toEqual({ color: true, data: false, alpha: true })
    expect(usage.get(normal)).toEqual({ color: false, data: true, alpha: false })

    const args = (entry: { color: boolean; data: boolean; alpha: boolean }) => ktxCreateArgs(entry, 'in.png', 'out.ktx2').join(' ')
    expect(args({ color: true, data: false, alpha: false })).toContain('--format R8G8B8_SRGB --assign-oetf srgb --encode basis-lz')
    expect(args({ color: true, data: false, alpha: true })).toContain('--format R8G8B8A8_SRGB')
    expect(args({ color: false, data: true, alpha: false })).toContain('--format R8G8B8_UNORM --assign-oetf linear')
    expect(args({ color: false, data: true, alpha: false })).toMatch(/--generate-mipmap in\.png out\.ktx2$/)
  })

  it('rejects a texture shared between a colour and a data slot', async () => {
    const doc = new Document()
    const shared = doc.createTexture('shared').setImage(await solidPng('white')).setMimeType('image/png')
    doc.createMaterial('A').setBaseColorTexture(shared).setMetallicRoughnessTexture(shared)
    expect(() => classifyTextureUsage(doc)).toThrow(/both colour and data/)
  })
})

describe('published high asset', () => {
  it('ships KTX2 textures and the authored materials, not the converter defaults', async () => {
    const json = parseGlbJsonDeclarations(await readFile(PUBLISHED_ASSET)) as GlbJson
    expect(json.extensionsRequired).toContain('KHR_texture_basisu')
    expect(json.images.every((image: GlbJson) => image.mimeType === 'image/ktx2')).toBe(true)
    const materials: GlbJson[] = json.materials
    const byName = new Map(materials.map((m) => [m.name, m]))
    // FBX2glTF's Phong conversion stamps metallic 0.4 / roughness 0.272 on
    // every material; none may survive the graft.
    const converterDefault = materials.filter((m) =>
      m.pbrMetallicRoughness?.metallicFactor === 0.4 &&
      Math.abs((m.pbrMetallicRoughness?.roughnessFactor ?? 1) - 0.2722) < 1e-3)
    expect(converterDefault.map((m) => m.name)).toEqual([])
    expect(materials.filter((m) => m.pbrMetallicRoughness?.metallicRoughnessTexture).length).toBeGreaterThanOrEqual(35)
    expect(byName.get('MLI.Generic')?.pbrMetallicRoughness?.baseColorTexture).toBeDefined()
    for (const cutout of ['ELC_Base', 'IROSA']) {
      expect(byName.get(cutout)).toMatchObject({ alphaMode: 'MASK', alphaCutoff: 0.5 })
      expect(byName.get(cutout)?.doubleSided ?? false).toBe(false)
    }
    expect(byName.get('Truss')?.alphaMode ?? 'OPAQUE').toBe('OPAQUE')
    // Authored metalness is halved (SOURCE_METALLIC_SCALE): no factor above it.
    expect(Math.max(...materials.map((m) => m.pbrMetallicRoughness?.metallicFactor ?? 1))).toBeLessThanOrEqual(SOURCE_METALLIC_SCALE)
  })
})

// ─── Rigid batching (Phase D) ─────────────────────────────────────────────────

describe('batchRigidMeshes', () => {
  /**
   * World-space triangles with their EFFECTIVE facing: three.js flips the
   * front face of a mirrored (negative-determinant) object, so the rendered
   * normal is the winding normal times the sign of the world determinant.
   * Vertices are sorted, so a winding reversal alone does not count as change.
   */
  function worldTriangles(doc: Document): Array<{ verts: number[][]; facing: number[] }> {
    const out: Array<{ verts: number[][]; facing: number[] }> = []
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh()
      if (!mesh) continue
      const m = node.getWorldMatrix()
      const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])
      const apply = (p: number[]) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')
        const idx = prim.getIndices()
        if (!pos || !idx) continue
        for (let i = 0; i < idx.getCount(); i += 3) {
          const tri = [0, 1, 2].map((k) => apply(pos.getElement(idx.getScalar(i + k), [])))
          const u = tri[1].map((v, c) => v - tri[0][c])
          const v = tri[2].map((w, c) => w - tri[0][c])
          const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
          const sorted = [...tri].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
          out.push({ verts: sorted, facing: n.map((c) => c * Math.sign(det)) })
        }
      }
    }
    const key = (t: { verts: number[][] }) => t.verts.map((p) => p.map((c) => c.toFixed(4)).join(',')).join('|')
    return out.sort((a, b) => key(a).localeCompare(key(b)))
  }

  function station(): { doc: Document; joint: GltfNode } {
    const doc = new Document()
    const scene = doc.createScene('scene')
    const hub = doc.createNode('SSREF').setScale([2, 2, 2])
    scene.addChild(doc.createNode('RootNode').addChild(hub))
    const material = doc.createMaterial('Truss')
    const part = (name: string, t: [number, number, number], s: [number, number, number] = [1, 1, 1]) => {
      const { prim } = trianglePrim(doc, 'unused', [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])
      prim.setMaterial(material)
      return doc.createNode(name).setTranslation(t).setScale(s).setMesh(doc.createMesh(name).addPrimitive(prim))
    }
    // Static module with two parts (one authored mirrored), a joint subtree.
    hub.addChild(doc.createNode('Node1').addChild(part('A', [1, 0, 0])).addChild(part('B', [0, 3, 0], [-1, 1, 1])))
    const joint = doc.createNode('PORT_ALPHA_ROT').setTranslation([0, 0, 5])
    joint.addChild(part('Truss_P4', [2, 0, 0])).addChild(part('Truss_P5', [4, 0, 0]))
    hub.addChild(joint)
    return { doc, joint }
  }

  it('merges per rigid part and module while preserving every world-space triangle and its facing', () => {
    const { doc, joint } = station()
    const before = worldTriangles(doc)
    const report = batchRigidMeshes(doc)
    expect(report).toMatchObject({ primitivesBefore: 4, primitivesAfter: 2 })
    const after = worldTriangles(doc)
    expect(after).toHaveLength(before.length)
    after.forEach((t, i) => {
      t.verts.forEach((p, k) => p.forEach((c, j) => expect(c).toBeCloseTo(before[i].verts[k][j], 6)))
      // Same rendered facing: the mirrored part's winding was reversed with its bake.
      t.facing.forEach((c, j) => expect(c).toBeCloseTo(before[i].facing[j], 6))
    })
    // The joint's geometry stays under the joint, so it still turns with it.
    expect(joint.listChildren().some((child) => !!child.getMesh())).toBe(true)
  })
})
