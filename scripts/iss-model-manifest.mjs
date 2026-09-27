// ─── iss-model-manifest.mjs — forensic audit manifest for a GLB ──────────────
//
// Walks a glTF/GLB with @gltf-transform and emits a JSON manifest describing
// every node: name, parent path, children, local TRS, world matrix, exact
// bounding boxes (local + world), mesh/primitive stats (vertex, index,
// triangle counts), material assignments, and the texture inventory (with
// dimensions, byte size, and the material slots that reference each texture).
//
// Also writes a human-readable tree.txt and, with --export-textures, dumps
// every embedded image to <out>/textures/ so the asset can be reviewed
// without a glTF loader.
//
// Usage:
//   node scripts/iss-model-manifest.mjs <input.glb> <out-dir> [--export-textures]
//   node scripts/iss-model-manifest.mjs <input.glb> --check-only
//
// Importing this module is side-effect free; the CLI runs via runCli(), and
// the validation helpers (createManifestIO, positionBounds,
// checkDeclaredBounds) are exported for the test suite.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import {
  EXTTextureWebP,
  KHRDracoMeshCompression,
  KHRMaterialsEmissiveStrength,
  KHRMaterialsIOR,
  KHRMaterialsSpecular,
  KHRMaterialsUnlit,
  KHRTextureTransform,
} from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { parseGlbJsonDeclarations, validateDocumentRig } from './iss-rig-manifest.mjs'

const MAX_ASSET_BYTES = 35 * 1024 * 1024

function fail(message, { usage = false } = {}) {
  console.error(`[iss-model-manifest] ${message}`)
  process.exit(usage ? 2 : 1)
}

const r3 = (v) => (typeof v === 'number' ? Number(v.toFixed(5)) : v)
const r3arr = (a) => (a ? Array.from(a, r3) : a)

export async function createManifestIO() {
  return new NodeIO()
    .registerExtensions([
      KHRDracoMeshCompression,
      EXTTextureWebP, // the asset's images are WebP; without this registration
      // the writer/reader drop the extension and dimension reads return null
      KHRMaterialsIOR,
      KHRMaterialsSpecular,
      KHRMaterialsUnlit,
      KHRMaterialsEmissiveStrength,
      KHRTextureTransform,
    ])
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    })
}

function textureInfo(texture) {
  if (!texture) return null
  const size = texture.getSize()
  return {
    texture: texture.getName() || '(unnamed)',
    mimeType: texture.getMimeType(),
    dimensions: size ? { width: size[0], height: size[1] } : null,
  }
}

function materialInfo(material) {
  if (!material) return null
  const extensions = material.listExtensions?.().map((e) => e.extensionName) ?? []
  return {
    name: material.getName() || '(unnamed)',
    alphaMode: material.getAlphaMode(),
    alphaCutoff: material.getAlphaMode() === 'MASK' ? material.getAlphaCutoff() : undefined,
    doubleSided: material.getDoubleSided(),
    baseColorFactor: r3arr(material.getBaseColorFactor()),
    metallicFactor: r3(material.getMetallicFactor()),
    roughnessFactor: r3(material.getRoughnessFactor()),
    emissiveFactor: r3arr(material.getEmissiveFactor()),
    extensions,
    slots: {
      baseColorTexture: textureInfo(material.getBaseColorTexture()),
      metallicRoughnessTexture: textureInfo(material.getMetallicRoughnessTexture()),
      normalTexture: textureInfo(material.getNormalTexture()),
      emissiveTexture: textureInfo(material.getEmissiveTexture()),
      occlusionTexture: textureInfo(material.getOcclusionTexture()),
    },
  }
}

// Iterate the POSITION accessor to get exact min/max. Reads the underlying
// array directly (compact non-interleaved case) with an `getElement` fallback,
// because Accessor.getScalar(index, component = 0) takes an ELEMENT index plus
// component — indexing it as a flat scalar array (getScalar(i * 3 + c)) reads
// the X component of every third vertex and garbles every bound.
// NOTE: declared accessor min/max are NOT read here. glTF-Transform's
// Accessor.getMin/getMax recompute from the decoded array, so comparing them
// against the same decoded values can never detect a stale file declaration.
// The independent comparison lives in checkDeclaredBounds(), which parses the
// original GLB JSON before decoding.
export function positionBounds(primitive) {
  const attr = primitive.getAttribute('POSITION')
  if (!attr) return null
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const elemCount = attr.getCount()
  let nonfinite = 0
  const arr = attr.getArray()
  if (arr && arr.length === elemCount * 3) {
    for (let i = 0; i < elemCount; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        const v = arr[i * 3 + c]
        if (!Number.isFinite(v)) nonfinite += 1
        if (v < min[c]) min[c] = v
        if (v > max[c]) max[c] = v
      }
    }
  } else {
    const v = [0, 0, 0]
    for (let i = 0; i < elemCount; i += 1) {
      attr.getElement(i, v)
      for (let c = 0; c < 3; c += 1) {
        if (!Number.isFinite(v[c])) nonfinite += 1
        if (v[c] < min[c]) min[c] = v[c]
        if (v[c] > max[c]) max[c] = v[c]
      }
    }
  }
  return { min, max, nonfinite }
}

/**
 * Independent declared-vs-decoded bounds comparison: reads min/max straight
 * from the GLB container's JSON chunk (pre-decode declarations) and compares
 * them with the decoded accessor arrays by accessor index (gltf-Transform
 * preserves accessor definition order). Quantization (Draco) legitimately
 * shifts declared values by small amounts, so divergence is REPORTED with the
 * max observed delta rather than treated as a binary stale/clean verdict.
 */
export async function checkDeclaredBounds(input, root) {
  const buffer = await readFile(input)
  const json = parseGlbJsonDeclarations(buffer)
  if (!json || !Array.isArray(json.accessors)) {
    return { supported: false, note: 'not a GLB container or no accessors — declared comparison skipped' }
  }
  const accessors = root.listAccessors()
  const declared = new Map()
  json.accessors.forEach((a, i) => {
    if (a.min && a.max) declared.set(i, { min: a.min, max: a.max })
  })
  let compared = 0
  let diverged = 0
  let maxDelta = 0
  accessors.forEach((attr, i) => {
    const d = declared.get(i)
    if (!d || attr.getType() !== 'VEC3') return
    const count = attr.getCount()
    const arr = attr.getArray()
    if (!arr || arr.length !== count * 3) return
    compared += 1
    const dmin = [Infinity, Infinity, Infinity]
    const dmax = [-Infinity, -Infinity, -Infinity]
    for (let vi = 0; vi < count; vi += 1) {
      for (let c = 0; c < 3; c += 1) {
        const v = arr[vi * 3 + c]
        if (v < dmin[c]) dmin[c] = v
        if (v > dmax[c]) dmax[c] = v
      }
    }
    for (let c = 0; c < 3; c += 1) {
      maxDelta = Math.max(maxDelta, Math.abs(d.min[c] - dmin[c]), Math.abs(d.max[c] - dmax[c]))
    }
  })
  // Draco's 14-bit quantization over a ~108 m model gives ~6.6e-3 m envelope;
  // report divergence, only flag it if it exceeds that plausible envelope.
  diverged = maxDelta > 1e-6 ? compared : 0
  return { supported: true, compared, diverged, maxDelta: Number(maxDelta.toExponential(3)) }
}

const CORNERS = []
for (let i = 0; i < 8; i += 1) CORNERS.push([i & 1, i & 2, i & 4])

// Transform a mesh-space AABB through matrix m using all 8 corners (exact for
// the affine transforms glTF allows on nodes).
function transformBounds(bounds, m) {
  if (!bounds) return null
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const [cx, cy, cz] of CORNERS) {
    const x = cx ? bounds.max[0] : bounds.min[0]
    const y = cy ? bounds.max[1] : bounds.min[1]
    const z = cz ? bounds.max[2] : bounds.min[2]
    const wx = m[0] * x + m[4] * y + m[8] * z + m[12]
    const wy = m[1] * x + m[5] * y + m[9] * z + m[13]
    const wz = m[2] * x + m[6] * y + m[10] * z + m[14]
    min[0] = Math.min(min[0], wx); max[0] = Math.max(max[0], wx)
    min[1] = Math.min(min[1], wy); max[1] = Math.max(max[1], wy)
    min[2] = Math.min(min[2], wz); max[2] = Math.max(max[2], wz)
  }
  return { min: min.map(r3), max: max.map(r3) }
}

function mergeBounds(target, bounds) {
  if (!bounds) return
  for (let i = 0; i < 3; i += 1) {
    target.min[i] = Math.min(target.min[i], bounds.min[i])
    target.max[i] = Math.max(target.max[i], bounds.max[i])
  }
}

function sizeOf(bounds) {
  if (!bounds) return null
  return {
    x: r3(bounds.max[0] - bounds.min[0]),
    y: r3(bounds.max[1] - bounds.min[1]),
    z: r3(bounds.max[2] - bounds.min[2]),
  }
}

// ─── CLI (the only place module side effects are allowed) ────────────────────

async function runCli() {
  // Flags can appear in any position; positional args are <input.glb> [out-dir].
  const argv = process.argv.slice(2)
  const flags = argv.filter((arg) => arg.startsWith('--'))
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  const input = positional[0]
  const outDirArg = positional[1]
  if (!input || (!outDirArg && !flags.includes('--check-only'))) {
    fail('usage: node scripts/iss-model-manifest.mjs <input.glb> <out-dir> [--check-only] [--export-textures]', { usage: true })
  }
  const checkOnly = flags.includes('--check-only')
  const outDir = outDirArg ?? '.tmp-iss-build/check-only-unused'
  const exportTextures = flags.includes('--export-textures')

  const io = await createManifestIO()

  console.log(`[iss-model-manifest] reading ${input} (this can take a while for large files)...`)
  const document = await io.read(input)
  const root = document.getRoot()
  const asset = root.getAsset()

  // ─── Textures inventory (+ optional export) ────────────────────────────────

  const mimeExt = { 'image/webp': '.webp', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/bmp': '.bmp' }
  const textureUsage = new Map() // texture -> [{material, slot}]
  for (const material of root.listMaterials()) {
    const slots = {
      baseColorTexture: material.getBaseColorTexture(),
      metallicRoughnessTexture: material.getMetallicRoughnessTexture(),
      normalTexture: material.getNormalTexture(),
      emissiveTexture: material.getEmissiveTexture(),
      occlusionTexture: material.getOcclusionTexture(),
    }
    for (const [slot, texture] of Object.entries(slots)) {
      if (!texture) continue
      if (!textureUsage.has(texture)) textureUsage.set(texture, [])
      textureUsage.get(texture).push({ material: material.getName() || '(unnamed)', slot })
    }
  }

  const texturesDir = path.join(outDir, 'textures')
  if (exportTextures) await mkdir(texturesDir, { recursive: true })

  const textureRecords = []
  for (const [index, texture] of root.listTextures().entries()) {
    const size = texture.getSize()
    const image = texture.getImage()
    const sanitized = (texture.getName() || 'texture').replace(/[^\w.-]+/g, '_').slice(0, 80)
    const ext = mimeExt[texture.getMimeType()] ?? '.bin'
    let exportedFile
    if (exportTextures && image) {
      exportedFile = `${String(index).padStart(3, '0')}_${sanitized}${ext}`
      await writeFile(path.join(texturesDir, exportedFile), Buffer.from(image))
    }
    textureRecords.push({
      index,
      name: texture.getName() || '(unnamed)',
      mimeType: texture.getMimeType(),
      dimensions: size ? { width: size[0], height: size[1] } : null,
      byteLength: image ? image.length : 0,
      exportedFile,
      usedBy: textureUsage.get(texture) ?? [],
    })
  }

  // ─── Materials inventory ───────────────────────────────────────────────────

  const materialRecords = root.listMaterials().map((material) => materialInfo(material))

  // ─── Meshes inventory ──────────────────────────────────────────────────────

  const meshRecords = root.listMeshes().map((mesh, meshIndex) => {
    let vertices = 0
    let triangles = 0
    const primitives = mesh.listPrimitives().map((primitive, primIndex) => {
      const position = primitive.getAttribute('POSITION')
      const indices = primitive.getIndices()
      const vertCount = position ? position.getCount() : 0
      const indexCount = indices ? indices.getCount() : vertCount
      vertices += vertCount
      triangles += Math.floor(indexCount / 3)
      const attributes = {}
      for (const semantic of primitive.listSemantics()) {
        attributes[semantic] = primitive.getAttribute(semantic)?.getCount() ?? 0
      }
      return {
        primitiveIndex: primIndex,
        mode: primitive.getMode(),
        material: materialInfo(primitive.getMaterial()),
        attributes,
        vertexCount: vertCount,
        indexCount,
        triangleCount: Math.floor(indexCount / 3),
      }
    })
    return {
      index: meshIndex,
      name: mesh.getName() || '(unnamed)',
      usedByNodes: mesh.listParents
        ? mesh.listParents().filter((p) => p.propertyType === 'Node').map((n) => n.getName() || '(unnamed)')
        : [],
      primitiveCount: primitives.length,
      vertexCount: vertices,
      triangleCount: triangles,
      primitives,
    }
  })

  // ─── Node walk (scene graph order, DFS) ────────────────────────────────────

  const nodeRecords = []
  const treeLines = []
  const roots = []
  let totalVertices = 0
  let totalTriangles = 0
  let nonfiniteTotal = 0
  const worldMin = [Infinity, Infinity, Infinity]
  const worldMax = [-Infinity, -Infinity, -Infinity]

  function visitNode(node, parentRecord, depth) {
    const name = node.getName() || `(node#${nodeRecords.length})`
    const parentName = parentRecord ? parentRecord.name : null
    const ancestry = []
    let ancestor = node.getParentNode()
    while (ancestor && ancestor.propertyType === 'Node') {
      ancestry.unshift(ancestor.getName() || '(unnamed)')
      ancestor = ancestor.getParentNode()
    }

    const localMatrix = node.getMatrix()
    const worldMatrix = node.getWorldMatrix()
    const translation = node.getTranslation()
    const rotation = node.getRotation()
    const scale = node.getScale()

    const record = {
      name,
      parent: parentName,
      path: [...ancestry, name].join('/'),
      children: node.listChildren().map((c) => c.getName() || '(unnamed-child)'),
      translation: r3arr(translation),
      rotationQuaternionXYZW: r3arr(rotation),
      scale: r3arr(scale),
      localMatrix: r3arr(localMatrix),
      worldMatrix: r3arr(worldMatrix),
    }

    const mesh = node.getMesh()
    if (mesh) {
      const meshIndex = root.listMeshes().indexOf(mesh)
      const meshRecord = meshRecords[meshIndex]
      // Bounds: each primitive's DECODED mesh-space box (tight in mesh space)
      // transformed by the world/local matrix. Transforming a box yields a
      // CONSERVATIVE bound on transformed geometry under rotation — labeled as
      // such rather than as an exact vertex AABB.
      const worldBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
      const localBoxAcc = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
      const meshSpaceBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
      const prims = []
      for (const primitive of mesh.listPrimitives()) {
        const bounds = positionBounds(primitive)
        if (!bounds) continue
        mergeBounds(meshSpaceBox, bounds)
        mergeBounds(worldBox, transformBounds(bounds, worldMatrix))
        mergeBounds(localBoxAcc, transformBounds(bounds, localMatrix))
        if (bounds.nonfinite) nonfiniteTotal += bounds.nonfinite
        const position = primitive.getAttribute('POSITION')
        const indices = primitive.getIndices()
        const vertCount = position ? position.getCount() : 0
        const indexCount = indices ? indices.getCount() : vertCount
        totalVertices += vertCount
        totalTriangles += Math.floor(indexCount / 3)
        prims.push({
          material: primitive.getMaterial()?.getName() || '(unnamed)',
          vertexCount: vertCount,
          indexCount,
          triangleCount: Math.floor(indexCount / 3),
        })
      }
      record.geometry = {
        mesh: mesh.getName() || `(mesh#${meshIndex})`,
        meshIndex,
        meshTriangleTotal: meshRecord?.triangleCount,
        primitives: prims,
        vertexCount: prims.reduce((a, p) => a + p.vertexCount, 0),
        triangleCount: prims.reduce((a, p) => a + p.triangleCount, 0),
        boundsMeshSpace: { min: meshSpaceBox.min.map(r3), max: meshSpaceBox.max.map(r3) },
        boundsLocal: { min: localBoxAcc.min.map(r3), max: localBoxAcc.max.map(r3) },
        boundsWorld: { min: worldBox.min.map(r3), max: worldBox.max.map(r3) },
      }
      mergeBounds({ min: worldMin, max: worldMax }, worldBox)
    }

    nodeRecords.push(record)
    treeLines.push(`${'  '.repeat(depth)}${name}${mesh ? `  [mesh: ${record.geometry.mesh}, ${record.geometry.triangleCount} tris]` : ''}`)

    for (const child of node.listChildren()) {
      visitNode(child, record, depth + 1)
    }
  }

  for (const scene of root.listScenes()) {
    const sceneName = scene.getName() || '(scene)'
    const sceneRoots = scene.listChildren().map((c) => c.getName() || '(unnamed)')
    roots.push({ scene: sceneName, rootNodes: sceneRoots })
    treeLines.push(`SCENE ${sceneName}`)
    for (const child of scene.listChildren()) {
      visitNode(child, null, 1)
    }
  }

  // glTF animations (fbx2gltf static models usually have none)
  const animations = root.listAnimations().map((animation) => ({
    name: animation.getName() || '(unnamed)',
    channels: animation.listChannels().length,
    samplers: animation.listSamplers().length,
  }))

  // ─── Checks (run for both modes) ───────────────────────────────────────────

  const rig = validateDocumentRig(document)
  const declaredBounds = await checkDeclaredBounds(input, root)
  const extensionsUsed = root.listExtensionsUsed().map((e) => e.extensionName)
  const hasWebp = root.listTextures().some((t) => t.getMimeType() === 'image/webp')
  const webpDeclared = extensionsUsed.includes('EXT_texture_webp')
  const fileStat = await stat(input)
  const withinBudget = fileStat.size <= MAX_ASSET_BYTES

  const checkErrors = [
    ...rig.errors,
    ...(nonfiniteTotal > 0 ? [`${nonfiniteTotal} non-finite POSITION components`] : []),
    ...(hasWebp && !webpDeclared
      ? ['asset has image/webp textures but does not declare EXT_texture_webp (nonconforming; Three tolerates it, the file is still wrong)']
      : []),
    ...(!withinBudget
      ? [`asset is ${(fileStat.size / (1024 * 1024)).toFixed(1)} MiB, over the ${MAX_ASSET_BYTES / (1024 * 1024)} MiB budget`]
      : []),
  ]

  // ─── Emit ──────────────────────────────────────────────────────────────────

  if (!checkOnly) await mkdir(outDir, { recursive: true })

  const summary = {
    nodes: nodeRecords.length,
    namedNodes: nodeRecords.filter((n) => n.name !== '(unnamed)').length,
    meshes: meshRecords.length,
    materials: materialRecords.length,
    textures: textureRecords.length,
    vertices: totalVertices,
    triangles: totalTriangles,
    worldBounds: {
      method: 'conservative-8-corner (decoded vertices; conservative under rotation, not the tight vertex AABB)',
      min: worldMin.map(r3),
      max: worldMax.map(r3),
      sizeMeters: sizeOf({ min: worldMin, max: worldMax }),
    },
    scenes: roots,
    animations,
    declaredBoundsComparison: declaredBounds,
    checks: {
      rigErrors: rig.errors,
      rigWarnings: rig.warnings,
      nonfinitePositionComponents: nonfiniteTotal,
      webpExtensionDeclared: hasWebp ? webpDeclared : 'no webp images',
      bytes: fileStat.size,
      withinBudget,
    },
    unitsNote:
      'glTF units are meters, +Y up, right-handed. boundsWorld values are in the GLB native frame (as authored), transformed conservatively (8-corner).',
  }

  if (checkOnly) {
    const result = {
      input: path.resolve(input),
      checks: summary.checks,
      declaredBoundsComparison: summary.declaredBoundsComparison,
      worldBounds: summary.worldBounds,
      ok: checkErrors.length === 0,
      errors: checkErrors,
    }
    console.log('[iss-model-manifest] check-only result:', JSON.stringify(result, null, 2))
    process.exit(result.ok ? 0 : 1)
  }

  const manifest = {
    inputFile: path.resolve(input),
    asset: { version: asset?.version, generator: asset?.generator, copyright: asset?.copyright },
    extensionsUsed: root.listExtensionsUsed().map((e) => e.extensionName),
    summary,
    nodes: nodeRecords,
    meshes: meshRecords,
    materials: materialRecords,
    textures: textureRecords,
  }

  const base = path.basename(input, path.extname(input))
  await writeFile(path.join(outDir, `${base}.manifest.json`), JSON.stringify(manifest, null, 2))
  await writeFile(path.join(outDir, `${base}.tree.txt`), treeLines.join('\n') + '\n')

  console.log('[iss-model-manifest] summary:', JSON.stringify(summary, null, 2))
  console.log(`[iss-model-manifest] wrote ${path.join(outDir, `${base}.manifest.json`)}`)
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  runCli().catch((error) => fail(String(error?.stack ?? error)))
}
