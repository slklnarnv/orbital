// ─── ISSModelLod.test.ts — Locate-tier LOD derivation contracts ─────────────
//
// The Locate LOD is derived from the high build's master at build time:
// detail/handrail meshes are dropped (except the named silhouette payloads),
// emptied leaves are removed unless the rig names them, the kept geometry is
// simplified, textures become small KTX2, and the published candidate must
// keep every rig node. These cases exercise the actual
// helper functions on small synthetic documents and validate the shipped LOD
// with the same contract gate used by the build.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Document, type Mesh, type Node as GltfNode, type Primitive } from '@gltf-transform/core'

import { validateCandidate } from '../../../scripts/build-iss-model.mjs'
import {
  buildLocateDocument,
  pruneEmptyLeaves,
  stripDetailMeshes,
} from '../../../scripts/build-iss-locate-lod.mjs'
import { PROTECTED_FRAMES, REQUIRED_NODES } from '../../../scripts/iss-rig-manifest.mjs'

const LOD_ASSET = path.resolve(__dirname, '../../../public/models/iss_igoal_locate.glb')
const HIGH_ASSET = path.resolve(__dirname, '../../../public/models/iss_igoal.glb')

function trianglePrim(doc: Document, positions: number[], indices: number[]): Primitive {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()
  const position = doc
    .createAccessor('positions', buffer)
    .setType('VEC3')
    .setArray(new Float32Array(positions))
  const indexAccessor = doc
    .createAccessor('indices', buffer)
    .setType('SCALAR')
    .setArray(new Uint32Array(indices))
  const prim = doc.createPrimitive()
  prim.setAttribute('POSITION', position)
  prim.setIndices(indexAccessor)
  return prim
}

function meshWithQuad(doc: Document): Mesh {
  const mesh = doc.createMesh()
  mesh.addPrimitive(trianglePrim(doc, [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]))
  return mesh
}

function sceneWithNodes(doc: Document, names: string[]): void {
  const scene = doc.createScene('scene')
  for (const name of names) {
    const node = doc.createNode(name)
    node.setMesh(meshWithQuad(doc))
    scene.addChild(node)
  }
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

describe('stripDetailMeshes', () => {
  it('drops greeble/handrail meshes but keeps the named silhouette payloads and structure', () => {
    const doc = new Document()
    sceneWithNodes(doc, ['AMS_Details', 'Truss_S0_Details_Misc', 'Truss_S0', 'USLab_Details_Handrails'])
    const result = stripDetailMeshes(doc)
    expect(result).toEqual({ strippedNodes: 2, keptDetailNodes: 1 })

    const byName = new Map(doc.getRoot().listNodes().map((node) => [node.getName(), node]))
    expect(byName.get('AMS_Details')?.getMesh()).not.toBeNull()
    expect(byName.get('Truss_S0_Details_Misc')?.getMesh()).toBeNull()
    expect(byName.get('Truss_S0')?.getMesh()).not.toBeNull()
    expect(byName.get('USLab_Details_Handrails')?.getMesh()).toBeNull()
  })
})

describe('buildLocateDocument', () => {
  it('keeps the rig node tree while shrinking the kept geometry', async () => {
    const doc = new Document()
    sceneWithNodes(doc, ['AMS_Details', 'Truss_S0_Details_Misc', 'Truss_S0'])
    const stats = await buildLocateDocument(doc)
    expect(stats.strippedNodes).toBe(1)
    expect(stats.trianglesAfter).toBeLessThanOrEqual(stats.trianglesBefore)

    expect(stats.emptyNodesRemoved).toBe(1)

    // Geometry now lives in each part's rigid batch (a child of the part).
    const byName = new Map(doc.getRoot().listNodes().map((node) => [node.getName(), node]))
    const hasGeometry = (node: GltfNode | undefined): boolean =>
      !!node && (!!node.getMesh() || node.listChildren().some(hasGeometry))
    expect(hasGeometry(byName.get('AMS_Details'))).toBe(true)
    expect(byName.has('Truss_S0_Details_Misc')).toBe(false)
    expect(hasGeometry(byName.get('Truss_S0'))).toBe(true)
  })
})

describe('pruneEmptyLeaves', () => {
  it('removes emptied branches but keeps rig-named nodes, including empty attachment frames', () => {
    const doc = new Document()
    const scene = doc.createScene('scene')
    const frame = PROTECTED_FRAMES[0].node
    const parent = doc.createNode('Node2')
    const emptyBranch = doc.createNode('Bracket').addChild(doc.createNode('Bracket_Details'))
    parent.addChild(doc.createNode(frame)).addChild(emptyBranch)
    parent.addChild(doc.createNode('Truss_S0').setMesh(meshWithQuad(doc)))
    scene.addChild(parent)

    expect(pruneEmptyLeaves(doc)).toEqual({ emptyNodesRemoved: 2 })
    const names = doc.getRoot().listNodes().map((node) => node.getName())
    expect(names).toEqual(expect.arrayContaining(['Node2', frame, 'Truss_S0']))
    expect(names).not.toContain('Bracket')
    expect(names).not.toContain('Bracket_Details')
  })
})

describe('published Locate LOD', () => {
  it('passes the same rig/format/budget contract as the high asset', async () => {
    // validateCandidate already enforces the rig; the stripped LOD is smaller
    // than the 703-node high tree but still names every required node.
    const summary = await validateCandidate(LOD_ASSET)
    expect(summary.nodes).toBeGreaterThanOrEqual(REQUIRED_NODES.length)
    expect(summary.nodes).toBeLessThan(703)
    expect(summary.extensionsUsed).toContain('KHR_texture_basisu')
    expect(summary.textureGpuMiBUpperBound).toBeLessThan(32)
    expect(summary.bytes).toBeLessThan(10 * 1024 * 1024)
    expect(summary.triangles).toBeGreaterThan(100_000)
    expect(summary.triangles).toBeLessThan(1_200_000)
  }, 30_000)

  it('is materially smaller than the high asset', async () => {
    const [lod, high] = await Promise.all([readFile(LOD_ASSET), readFile(HIGH_ASSET)])
    expect(lod.byteLength).toBeLessThan(high.byteLength * 0.35)
  })
})

describe('CLI guard', () => {
  it('importing the LOD build module does not rewrite the published asset', async () => {
    const before = await sha256(LOD_ASSET)
    await import('../../../scripts/build-iss-locate-lod.mjs')
    expect(await sha256(LOD_ASSET)).toBe(before)
  })
})
