// ─── build-iss-model.mjs — IGOAL sources → optimized runtime GLB ──────────────
//
// Converts the high-detail "International Space Station (ISS) (D) (IGOAL)"
// sources into the deferred-load runtime asset public/models/iss_igoal.glb,
// plus the intermediate master the Locate LOD is derived from.
//
// Sources (both from NASA IGOAL's ISS_External_26.05_revA.blend, exported by
// Blender 5.0.1; sha256 of each is printed in the build report):
//   - The FBX is the GEOMETRY authority: 702 named nodes with the real part
//     hierarchy — 8 solar array wings (P4_Array_2A/4A, P6_2B/4B, S4_1A/3A,
//     S6_1B/3B), P1/S1_Radiator rotary radiators, JEM/ELP/SHP camera pan/tilt
//     nodes, Cupola shutters, Canadarm2. It carries no animation, pivots or
//     custom properties: the rig lives in scripts/iss-rig-manifest.mjs.
//   - The GLB of the same scene is the MATERIAL authority. Its geometry is one
//     merged mesh (unusable), but its materials are exactly what Blender
//     renders: packed metallic-roughness maps, factors, normal strengths and
//     the albedo maps the FBX does not embed (MLI blankets, GEDI). FBX2glTF
//     drops every metallic-roughness map and substitutes its Phong defaults
//     (metallic 0.4, roughness 0.272) on all 47 materials.
//
// Pipeline:
//   1. FBX2glTF (binary, via npm fbx2gltf) → hierarchy-preserving GLB.
//   2. Material repairs, then the authored materials grafted by name from the
//      source GLB (lossless FBX images win where both exist); genuine alpha
//      cutouts (ELC grating, iROSA perforations) render MASK.
//   3. glTF-Transform: dedupe, prune (keepLeaves — preserves the six empty
//      rig attachment frames), weld; textures resized to ≤2048 (metallic-
//      roughness ≤1024) as lossless PNG.
//   4. EATCS panel split: the ±Y-facing panel triangles inside the long
//      `Truss`-material primitives of P1/S1_Radiator get a dedicated white
//      radiator-coating material; support hardware keeps its materials.
//   5. Selective decimation: only nodes whose name matches /details/i are
//      simplified ~50%. Arrays, trusses, modules, radiators stay full-res.
//   6. The master (uncompressed geometry, PNG textures, rig extras) is written
//      to .tmp-iss-build for scripts/build-iss-locate-lod.mjs.
//   7. Textures → KTX2 / Basis ETC1S (`ktx create`, KTX-Software ≥4.3): GPU-
//      compressed, ~4–8× less texture memory than decoded WebP and transcoded
//      off the main thread. Geometry → Draco with raised normal quantization.
//   8. Rig contract validation (scripts/iss-rig-manifest.mjs) + format/budget
//      checks on the DECODED CANDIDATE. Only a fully valid candidate is
//      published to public/models/iss_igoal.glb; a failure leaves the
//      previous runtime asset untouched.
//
// Usage:  node scripts/build-iss-model.mjs <IGOAL.fbx> <IGOAL.glb>
//         (KTX_BIN names the `ktx` executable when it is not on PATH)
// Importing this module is side-effect free; the CLI runs via main().

import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import convert from 'fbx2gltf'

import { NodeIO } from '@gltf-transform/core'
import {
  EXTTextureWebP,
  KHRDracoMeshCompression,
  KHRMaterialsIOR,
  KHRTextureBasisu,
  KHRMaterialsSpecular,
  KHRMaterialsUnlit,
  KHRTextureTransform,
} from '@gltf-transform/extensions'
import {
  dedup,
  draco,
  prune,
  simplifyPrimitive,
  textureCompress,
  weld,
} from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import {
  TRRJ_LIMITS,
  runtimeSubset,
  validateDocumentRig,
} from './iss-rig-manifest.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PATH = path.join(root, 'public/models/iss_igoal.glb')
const WORK_DIR = path.join(root, '.tmp-iss-build')
const CANDIDATE_PATH = path.join(WORK_DIR, 'iss_igoal_candidate.glb')

const MASTER_PATH = path.join(WORK_DIR, 'iss_igoal_master.glb')

const MAX_TEXTURE_EDGE = 2048
// Metallic-roughness maps carry low-frequency data and arrive as JPEG from the
// source GLB; 1024 keeps their detail at a quarter of the 2048 cost.
const MAX_DATA_TEXTURE_EDGE = 1024
const MAX_ASSET_BYTES = 35 * 1024 * 1024 // hard gate on the published candidate
const DETAILS_RATIO = 0.5 // decimate only "Details_" greeble sub-meshes
// Error is relative to each primitive's own extent, so small greebles stay
// sub-centimeter accurate while big Detail_ meshes shrink meaningfully.
const DETAILS_ERROR = 0.005
// Panel-face classifier for the EATCS split: triangles whose world-frame
// face normal is predominantly ±Y are radiator panel surfaces (measured:
// ~500 m² of panel faces across P1/S1; support frames/edges stay put).
const PANEL_NORMAL_Y_THRESHOLD = 0.7

export async function createIO() {
  return new NodeIO()
    .registerExtensions([
      KHRDracoMeshCompression,
      EXTTextureWebP, // legacy assets and intermediate stages only
      KHRTextureBasisu, // runtime assets: every texture is KTX2 / Basis ETC1S
      KHRMaterialsIOR,
      KHRMaterialsSpecular,
      KHRMaterialsUnlit,
      KHRTextureTransform,
    ])
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    })
}

function fail(message) {
  console.error(`[build-iss-model] ${message}`)
  process.exit(1)
}

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// ─── Step 1: FBX → GLB ───────────────────────────────────────────────────────

async function convertFbx(fbxPath) {
  await mkdir(WORK_DIR, { recursive: true })
  const rawGlb = path.join(WORK_DIR, 'igoal_raw.glb')
  console.log('[build-iss-model] FBX2glTF: converting (this can take a minute for 172 MB input)...')
  // --pbr-metallic-roughness gleans native PBR attributes from the FBX.
  // NOTE: FBX2glTF's default V-flip is REQUIRED — FBX stores UVs top-left
  // origin, glTF bottom-left. Never pass --no-flip-v here.
  await convert(fbxPath, rawGlb, ['--binary', '--pbr-metallic-roughness'])
  return rawGlb
}

// sharp's bundled libvips has no BMP loader ("unsupported image format"),
// even for bog-standard files. Decode the one BMP flavor this model embeds —
// 24-bit uncompressed — into raw RGB so sharp can re-encode it like the rest.
async function decodeBmpToSharpRaw(bytes) {
  const buffer = Buffer.from(bytes)
  const dataOffset = buffer.readUInt32LE(10)
  const width = buffer.readInt32LE(18)
  const heightRaw = buffer.readInt32LE(22)
  const bpp = buffer.readUInt16LE(28)
  const compression = buffer.readUInt32LE(30)
  if (bpp !== 24 || compression !== 0) {
    throw new Error(`unsupported BMP variant (bpp=${bpp}, compression=${compression})`)
  }
  const topDown = heightRaw < 0
  const height = Math.abs(heightRaw)
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    const srcY = topDown ? y : height - 1 - y
    const rowStart = dataOffset + srcY * rowSize
    for (let x = 0; x < width; x += 1) {
      const si = rowStart + x * 3
      const di = (y * width + x) * 3
      raw[di] = buffer[si + 2]
      raw[di + 1] = buffer[si + 1]
      raw[di + 2] = buffer[si]
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

// ─── Step 2: material/texture repairs ────────────────────────────────────────

export async function repairMaterialsAndTextures(document) {
  // Strip bogus transparency: FBX2glTF flags ~13 module materials (Zvezda,
  // Zarya, JEM, Truss, Cupola, ELC...) as alphaMode BLEND from a vestigial
  // FBX transparency channel. Most of their textures carry a stale grayscale
  // mask in the alpha channel (RGB under "transparent" pixels is intact hull
  // color — a complete image, not cutouts). Rendering them as BLEND drops
  // the whole station into three.js's depth-sorted transparent pass, which
  // ghosts large parts of the model at certain viewing angles. The genuine
  // cutouts are restored as MASK by applySourceMaterials (CUTOUT_MATERIALS).
  // Materials whose base-color FACTOR is semi-transparent stay untouched.
  let opaqueFixed = 0
  for (const material of document.getRoot().listMaterials()) {
    if (material.getAlphaMode() !== 'BLEND') continue
    const alpha = material.getBaseColorFactor()?.[3] ?? 1
    if (alpha >= 1) {
      material.setAlphaMode('OPAQUE')
      opaqueFixed += 1
    }
  }

  // FBX-embedded images can arrive without a usable mimeType (letters.bmp
  // exports as "image/unknown"), which makes the WebP pass skip them and
  // browsers fail to decode the passthrough. Sniff magic bytes; BMPs get
  // decoded manually (sharp lacks a BMP loader) and re-embedded as PNG.
  for (const texture of document.getRoot().listTextures()) {
    const mime = texture.getMimeType()
    if (mime && mime !== 'image/unknown') continue
    const bytes = texture.getImage()
    if (!bytes || bytes.length < 2) continue
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      try {
        const png = await decodeBmpToSharpRaw(bytes)
        texture.setImage(png).setMimeType('image/png')
      } catch (error) {
        console.warn(`[build-iss-model] BMP decode failed for "${texture.getName()}": ${String(error)}`)
      }
    } else if (bytes[0] === 0x89 && bytes[1] === 0x50) texture.setMimeType('image/png')
    else if (bytes[0] === 0xff && bytes[1] === 0xd8) texture.setMimeType('image/jpeg')
    else console.warn(`[build-iss-model] unrecognized image format for "${texture.getName()}" — left as ${mime}`)
  }
  return opaqueFixed
}

// ─── Step 2b: authored materials from the Blender source GLB ─────────────────

/**
 * Materials whose base-colour alpha is a genuine cutout (inspected: the ELC
 * deck grating and perforated plates, the iROSA hex-hole panels). They render
 * MASK and double-sided so the far side shows through the holes. `Truss` is
 * BLEND in the source as well, but its alpha also hides the radiator edge
 * rails and support members, so it stays OPAQUE.
 */
export const CUTOUT_MATERIALS = new Set(['ELC_Base', 'IROSA'])
export const CUTOUT_ALPHA = 0.5

/**
 * Read the source GLB's materials without decoding its geometry: factors,
 * normal strength and the embedded images behind the base-colour, metallic-
 * roughness and normal slots. Returns Map<materialName, spec>.
 */
export function readSourceMaterials(glb) {
  const buffer = Buffer.from(glb)
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('source materials: not a GLB')
  const jsonLength = buffer.readUInt32LE(12)
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength))
  const binStart = 20 + jsonLength + 8
  const image = (textureInfo) => {
    if (!textureInfo) return null
    if (textureInfo.extensions?.KHR_texture_transform || (textureInfo.texCoord ?? 0) !== 0) {
      throw new Error('source materials: texture transforms / secondary UVs are not supported')
    }
    const source = json.images[json.textures[textureInfo.index].source]
    const view = json.bufferViews[source.bufferView]
    const offset = binStart + (view.byteOffset ?? 0)
    return {
      name: source.name ?? `image_${json.textures[textureInfo.index].source}`,
      mimeType: source.mimeType,
      bytes: new Uint8Array(buffer.subarray(offset, offset + view.byteLength)),
    }
  }
  const materials = new Map()
  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness ?? {}
    materials.set(material.name, {
      alphaMode: material.alphaMode ?? 'OPAQUE',
      baseColorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1],
      metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1,
      normalScale: material.normalTexture ? (material.normalTexture.scale ?? 1) : null,
      baseColor: image(pbr.baseColorTexture),
      metallicRoughness: image(pbr.metallicRoughnessTexture),
      normal: image(material.normalTexture),
    })
  }
  return materials
}

/**
 * Graft the source materials onto the FBX-converted document, by material
 * name. Run before dedup: FBX2glTF emits untextured look-alikes (e.g. GEDI)
 * that dedup would otherwise merge before they receive their own maps.
 *   - factors and metallic-roughness maps come from the source;
 *   - base-colour and normal maps keep the FBX's lossless images and only fall
 *     back to the source's (JPEG) ones where the FBX has none;
 *   - CUTOUT_MATERIALS render MASK, double-sided.
 */
export function applySourceMaterials(document, sourceMaterials) {
  const report = { matched: 0, unmatched: [], metallicRoughness: 0, baseColor: 0, normal: 0, cutouts: [] }
  const textures = new Map()
  const textureFor = (image) => {
    if (!textures.has(image.name)) {
      textures.set(
        image.name,
        document.createTexture(image.name).setImage(image.bytes).setMimeType(image.mimeType),
      )
    }
    return textures.get(image.name)
  }
  for (const material of document.getRoot().listMaterials()) {
    const name = material.getName()
    const source = sourceMaterials.get(name)
    if (!source) {
      report.unmatched.push(name)
      continue
    }
    report.matched += 1
    material
      .setBaseColorFactor(source.baseColorFactor)
      .setMetallicFactor(source.metallicFactor)
      .setRoughnessFactor(source.roughnessFactor)
    if (source.metallicRoughness) {
      material.setMetallicRoughnessTexture(textureFor(source.metallicRoughness))
      report.metallicRoughness += 1
    }
    if (!material.getBaseColorTexture() && source.baseColor) {
      material.setBaseColorTexture(textureFor(source.baseColor))
      report.baseColor += 1
    }
    if (!material.getNormalTexture() && source.normal) {
      material.setNormalTexture(textureFor(source.normal))
      report.normal += 1
    }
    if (material.getNormalTexture() && source.normalScale !== null) {
      material.setNormalScale(source.normalScale)
    }
    if (CUTOUT_MATERIALS.has(name)) {
      material.setAlphaMode('MASK').setAlphaCutoff(CUTOUT_ALPHA).setDoubleSided(true)
      report.cutouts.push(name)
    }
  }
  return report
}

// ─── Step 7: KTX2 / Basis ETC1S textures ─────────────────────────────────────

/**
 * How each texture is sampled: colour slots are sRGB, everything else is
 * linear data; alpha is kept only where a non-OPAQUE material reads it.
 * A texture shared between a colour and a data slot cannot be encoded for
 * both and is rejected.
 */
export function classifyTextureUsage(document) {
  const usage = new Map()
  const mark = (texture, kind, alpha = false) => {
    if (!texture) return
    const entry = usage.get(texture) ?? { color: false, data: false, alpha: false }
    entry[kind] = true
    entry.alpha ||= alpha
    usage.set(texture, entry)
  }
  for (const material of document.getRoot().listMaterials()) {
    mark(material.getBaseColorTexture(), 'color', material.getAlphaMode() !== 'OPAQUE')
    mark(material.getEmissiveTexture(), 'color')
    mark(material.getNormalTexture(), 'data')
    mark(material.getMetallicRoughnessTexture(), 'data')
    mark(material.getOcclusionTexture(), 'data')
  }
  for (const [texture, entry] of usage) {
    if (entry.color && entry.data) {
      throw new Error(`texture "${texture.getName()}" is used as both colour and data`)
    }
  }
  return usage
}

/**
 * `ktx create` arguments for one texture. ETC1S at quality 255 measured on
 * par with the WebP q80 it replaces (albedo 36.1 vs 36.7 dB PSNR; normals
 * 3.9° vs 3.5° mean angular error). Plain RGB normals are deliberate: three.js
 * does not read the two-channel `--normal-mode` layout.
 */
export function ktxCreateArgs(entry, input, output) {
  const channels = entry.alpha ? 'R8G8B8A8' : 'R8G8B8'
  return [
    'create',
    '--format', entry.color ? `${channels}_SRGB` : `${channels}_UNORM`,
    '--assign-oetf', entry.color ? 'srgb' : 'linear',
    '--encode', 'basis-lz',
    '--clevel', '2',
    '--qlevel', '255',
    '--generate-mipmap',
    input,
    output,
  ]
}

/**
 * Encode every used texture in place as KTX2 (optionally downscaled first)
 * and require KHR_texture_basisu. `maxEdge` is a number or a function of the
 * texture's usage entry. `ktx` (KTX-Software ≥4.3) is a build-time tool only;
 * KTX_BIN overrides the executable.
 */
export async function encodeTexturesKtx2(document, { maxEdge = Infinity, ktx = process.env.KTX_BIN || 'ktx' } = {}) {
  const usage = classifyTextureUsage(document)
  if (usage.size === 0) return { encoded: 0 }
  const run = promisify(execFile)
  const tmp = await mkdtemp(path.join(WORK_DIR, 'ktx-'))
  let encoded = 0
  try {
    const jobs = [...usage].map(([texture, entry], index) => async () => {
      let image = sharp(Buffer.from(texture.getImage()))
      const edge = typeof maxEdge === 'function' ? maxEdge(entry) : maxEdge
      if (Number.isFinite(edge)) image = image.resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
      image = entry.alpha ? image.ensureAlpha() : image.removeAlpha()
      const input = path.join(tmp, `${index}.png`)
      const output = path.join(tmp, `${index}.ktx2`)
      await writeFile(input, await image.png().toBuffer())
      try {
        await run(ktx, ktxCreateArgs(entry, input, output), { maxBuffer: 16 * 1024 * 1024 })
      } catch (error) {
        throw new Error(`ktx create failed for "${texture.getName()}" (is KTX-Software ≥4.3 installed? set KTX_BIN)`, { cause: error })
      }
      texture.setImage(new Uint8Array(await readFile(output))).setMimeType('image/ktx2')
      encoded += 1
    })
    // `ktx create` is itself multithreaded; two in flight keeps the cores busy.
    const queue = [...jobs]
    await Promise.all([0, 1].map(async () => {
      while (queue.length > 0) await queue.shift()()
    }))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  document.createExtension(KHRTextureBasisu).setRequired(true)
  return { encoded }
}

// ─── Step 3: EATCS panel material split ──────────────────────────────────────

/**
 * The deployed EATCS panel surfaces live inside the long `Truss`-material
 * primitives of P1_Radiator/S1_Radiator (primitive 0's MLI.Generic is the
 * short base beam — support hardware, kept as-is). Split each such primitive
 * into panel triangles (|world normal · Y| > threshold) with a dedicated
 * white Z-93-style coating, and structural triangles that keep `Truss`.
 * The shared Truss material itself is never touched.
 */
export function splitRadiatorPanels(document) {
  const RADIATOR_NODES = ['P1_Radiator', 'S1_Radiator']
  let coating // created lazily, shared by both radiators
  const splits = []
  for (const node of document.getRoot().listNodes()) {
    if (!RADIATOR_NODES.includes(node.getName())) continue
    const mesh = node.getMesh()
    if (!mesh) continue
    const worldMatrix = node.getWorldMatrix()
    for (const prim of [...mesh.listPrimitives()]) {
      const material = prim.getMaterial()
      if (!material || material.getName() !== 'Truss') continue
      const position = prim.getAttribute('POSITION')
      const indices = prim.getIndices()
      if (!position || !indices) continue
      const arr = position.getArray()
      const idx = indices.getArray()
      const triangleCount = idx.length / 3
      const panelTriangles = []
      const structureTriangles = []
      const p = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
      for (let t = 0; t < triangleCount; t += 1) {
        for (let v = 0; v < 3; v += 1) {
          const vi = idx[t * 3 + v]
          const lx = arr[vi * 3]
          const ly = arr[vi * 3 + 1]
          const lz = arr[vi * 3 + 2]
          p[v] = [
            worldMatrix[0] * lx + worldMatrix[4] * ly + worldMatrix[8] * lz + worldMatrix[12],
            worldMatrix[1] * lx + worldMatrix[5] * ly + worldMatrix[9] * lz + worldMatrix[13],
            worldMatrix[2] * lx + worldMatrix[6] * ly + worldMatrix[10] * lz + worldMatrix[14],
          ]
        }
        const abx = p[1][0] - p[0][0]
        const aby = p[1][1] - p[0][1]
        const abz = p[1][2] - p[0][2]
        const acx = p[2][0] - p[0][0]
        const acy = p[2][1] - p[0][1]
        const acz = p[2][2] - p[0][2]
        const nx = aby * acz - abz * acy
        const ny = abz * acx - abx * acz
        const nz = abx * acy - aby * acx
        const norm = Math.hypot(nx, ny, nz)
        const isPanel = norm > 0 && Math.abs(ny) / norm > PANEL_NORMAL_Y_THRESHOLD
        const bucket = isPanel ? panelTriangles : structureTriangles
        bucket.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2])
      }
      if (panelTriangles.length === 0 || structureTriangles.length === 0) continue
      if (!coating) {
        coating = document.createMaterial('Radiator_Panel_Coating')
        // Z-93-style white thermal coating: matte, near-nonmetal, bright.
        coating.setBaseColorFactor([0.93, 0.94, 0.96, 1])
        coating.setMetallicFactor(0.1)
        coating.setRoughnessFactor(0.55)
      }
      const panelPrim = document.createPrimitive()
      for (const semantic of prim.listSemantics()) {
        panelPrim.setAttribute(semantic, prim.getAttribute(semantic))
      }
      panelPrim.setMaterial(coating)
      panelPrim.setIndices(
        document.createAccessor().setType('SCALAR').setArray(new Uint32Array(panelTriangles)),
      )
      mesh.addPrimitive(panelPrim)
      prim.setIndices(
        document.createAccessor().setType('SCALAR').setArray(new Uint32Array(structureTriangles)),
      )
      splits.push(`${node.getName()}: ${panelTriangles.length / 3} panel / ${structureTriangles.length / 3} structure tris`)
    }
  }
  for (const s of splits) console.log(`[build-iss-model] radiator panel split — ${s}`)
  return splits
}

// ─── Step 3b: strip baked vertex colours ─────────────────────────────────────

/**
 * FBX2glTF exports the source's per-vertex colour layer as COLOR_0, and
 * three.js multiplies it into the albedo. Every material's COLOR_0 is pure
 * white (a no-op) except Nauka's `MLM`, whose hull carries a stale baked
 * shading layer (≈11% of its vertices near-black) that renders the cream-white
 * module dark over a correct texture. Dropping COLOR_0 everywhere removes the
 * defect and is visually identical for every other material.
 * Returns per-material counts of stripped primitives.
 */
export function stripVertexColors(document) {
  const stripped = new Map()
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getAttribute('COLOR_0')) continue
      prim.setAttribute('COLOR_0', null)
      const name = prim.getMaterial()?.getName() ?? '(none)'
      stripped.set(name, (stripped.get(name) ?? 0) + 1)
    }
  }
  const total = [...stripped.values()].reduce((a, b) => a + b, 0)
  if (total > 0) console.log(`[build-iss-model] stripped COLOR_0 from ${total} primitives`)
  return stripped
}

// ─── Step 4: optimize into a CANDIDATE (not the runtime asset) ───────────────

export async function optimize(rawGlb, sourceMaterials) {
  const io = await createIO()

  console.log('[build-iss-model] Reading raw GLB...')
  const document = await io.read(rawGlb)

  const opaqueFixed = await repairMaterialsAndTextures(document)
  if (opaqueFixed > 0) {
    console.log(`[build-iss-model] forced ${opaqueFixed} falsely-transparent materials to OPAQUE`)
  }
  const grafted = applySourceMaterials(document, sourceMaterials)
  console.log(
    `[build-iss-model] source materials: ${grafted.matched} matched, ` +
      `${grafted.metallicRoughness} metallic-roughness / ${grafted.baseColor} base-colour / ` +
      `${grafted.normal} normal maps added, cutouts: ${grafted.cutouts.join(', ') || 'none'}`,
  )
  if (grafted.unmatched.length > 0) {
    throw new Error(`materials missing from the source GLB: ${grafted.unmatched.join(', ')}`)
  }
  // Before dedup/weld/prune so orphaned colour accessors are dropped.
  stripVertexColors(document)

  await document.transform(
    dedup(),
    // keepLeaves: preserve the six empty rig attachment frames (JEM_WRR,
    // MBS_MGF_1/3, SSRMS_WRY_AttachmentPoint, Node2_PDGF_Attach,
    // USLab_PDGFMount) — lost semantics, no triangles.
    prune({ keepLeaves: true }),
    weld(),
    // Lossless PNG here: the KTX2 encode at the end (and the Locate LOD,
    // which starts from the master) must not inherit a lossy intermediate.
    textureCompress({
      encoder: sharp,
      targetFormat: 'png',
      slots: /metallicRoughness/,
      resize: [MAX_DATA_TEXTURE_EDGE, MAX_DATA_TEXTURE_EDGE],
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: 'png',
      resize: [MAX_TEXTURE_EDGE, MAX_TEXTURE_EDGE],
    }),
  )

  splitRadiatorPanels(document)

  // Selective decimation — walk nodes named like "*Details*" and simplify
  // those primitives only. Labeled structures (arrays, trusses, modules,
  // radiators, cameras) are deliberately untouched.
  await MeshoptSimplifier.ready
  let decimatedCount = 0
  let decimatedTrisBefore = 0
  let decimatedTrisAfter = 0
  for (const node of document.getRoot().listNodes()) {
    if (!/details/i.test(node.getName())) continue
    const mesh = node.getMesh()
    if (!mesh) continue
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION')
      const indices = primitive.getIndices()
      const before = indices ? indices.getCount() / 3 : position.getCount() / 3
      try {
        simplifyPrimitive(primitive, { ratio: DETAILS_RATIO, error: DETAILS_ERROR, simplifier: MeshoptSimplifier })
      } catch (error) {
        console.warn(`[build-iss-model] simplify skipped for "${node.getName()}": ${String(error)}`)
        continue
      }
      const indicesAfter = primitive.getIndices()
      const after = indicesAfter ? indicesAfter.getCount() / 3 : position.getCount() / 3
      decimatedCount += 1
      decimatedTrisBefore += before
      decimatedTrisAfter += after
    }
  }
  console.log(
    `[build-iss-model] Decimated ${decimatedCount} Details_ primitives: ` +
      `${Math.round(decimatedTrisBefore / 1000)}k → ${Math.round(decimatedTrisAfter / 1000)}k tris`,
  )

  // Emit the validated runtime rig subset into the scene extras; the loader
  // exposes it as gltf.scene.userData.orbitalRig.
  const scene = document.getRoot().listScenes()[0]
  if (scene) scene.setExtras({ orbitalRig: runtimeSubset() })
  await document.transform(prune({ keepLeaves: true }))

  // The Locate LOD's source: full geometry, lossless textures, rig extras.
  console.log('[build-iss-model] Writing master GLB...')
  await mkdir(WORK_DIR, { recursive: true })
  await io.write(MASTER_PATH, document)

  console.log('[build-iss-model] Encoding KTX2 textures...')
  const { encoded } = await encodeTexturesKtx2(document)
  console.log(`[build-iss-model] ${encoded} textures → KTX2 / ETC1S`)

  await document.transform(
    draco({
      method: 'edgebreaker',
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
    }),
    prune({ keepLeaves: true }),
  )

  console.log('[build-iss-model] Writing candidate GLB...')
  await io.write(CANDIDATE_PATH, document)
  return document
}

// ─── Step 5: validate the decoded candidate; report; publish ────────────────

/**
 * Decode the candidate from disk with a fresh reader and enforce the full
 * contract: rig structure, WebP extension conformance, finite geometry,
 * decoded cost summary, conservative world bounds. Throws on any failure —
 * the caller must not publish unless this returns.
 */
export async function validateCandidate(candidatePath) {
  const io = await createIO()
  const document = await io.read(candidatePath)
  const root_ = document.getRoot()

  const rig = validateDocumentRig(document)
  if (rig.errors.length > 0) {
    throw new Error(`rig contract violations: ${rig.errors.join('; ')}`)
  }

  // Every runtime texture is GPU-compressed KTX2: a stray PNG/WebP would decode
  // to RGBA8 and quietly spend 4–8× the texture memory budgeted for it.
  const extensionsUsed = root_.listExtensionsUsed().map((e) => e.extensionName)
  const textures = root_.listTextures()
  if (textures.length > 0) {
    const basisu = root_.listExtensionsUsed().find((e) => e.extensionName === 'KHR_texture_basisu')
    if (!basisu?.isRequired()) {
      throw new Error('asset has textures but does not require KHR_texture_basisu (nonconforming)')
    }
  }
  let texturePixels = 0
  for (const texture of textures) {
    if (texture.getMimeType() !== 'image/ktx2') {
      throw new Error(`texture "${texture.getName()}" is ${texture.getMimeType()}, not KTX2`)
    }
    const size = texture.getSize()
    if (!size) throw new Error(`KTX2 texture "${texture.getName()}" has unreadable dimensions`)
    texturePixels += size[0] * size[1]
  }

  let tris = 0
  let verts = 0
  let nonfinite = 0
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const node of root_.listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const wm = node.getWorldMatrix()
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION')
      if (!position) continue
      const arr = position.getArray()
      const count = position.getCount()
      verts += count
      const primMin = [Infinity, Infinity, Infinity]
      const primMax = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < count; i += 1) {
        for (let c = 0; c < 3; c += 1) {
          const v = arr[i * 3 + c]
          if (!Number.isFinite(v)) nonfinite += 1
          if (v < primMin[c]) primMin[c] = v
          if (v > primMax[c]) primMax[c] = v
        }
      }
      // Conservative world AABB (8-corner transform of the prim box).
      for (let cx = 0; cx < 2; cx += 1) {
        for (let cy = 0; cy < 2; cy += 1) {
          for (let cz = 0; cz < 2; cz += 1) {
            const x = cx ? primMax[0] : primMin[0]
            const y = cy ? primMax[1] : primMin[1]
            const z = cz ? primMax[2] : primMin[2]
            const w = [
              wm[0] * x + wm[4] * y + wm[8] * z + wm[12],
              wm[1] * x + wm[5] * y + wm[9] * z + wm[13],
              wm[2] * x + wm[6] * y + wm[10] * z + wm[14],
            ]
            for (let i = 0; i < 3; i += 1) {
              if (w[i] < min[i]) min[i] = w[i]
              if (w[i] > max[i]) max[i] = w[i]
            }
          }
        }
      }
      const idxAcc = prim.getIndices()
      tris += Math.floor((idxAcc ? idxAcc.getCount() : count) / 3)
    }
  }
  if (nonfinite > 0) {
    throw new Error(`${nonfinite} non-finite POSITION components in candidate`)
  }

  const candidateStat = await stat(candidatePath)
  if (candidateStat.size > MAX_ASSET_BYTES) {
    throw new Error(
      `candidate is ${(candidateStat.size / (1024 * 1024)).toFixed(1)} MiB, over the ${MAX_ASSET_BYTES / (1024 * 1024)} MiB budget`,
    )
  }

  const sceneInstances = root_.listNodes().filter((n) => n.getMesh()).length
  const summary = {
    nodes: root_.listNodes().length,
    meshInstances: sceneInstances,
    storedMeshes: root_.listMeshes().length,
    materials: root_.listMaterials().length,
    textures: textures.length,
    // ETC1S transcodes to ≤1 byte/texel on GPU formats; mip chains add ⅓.
    textureGpuMiBUpperBound: Number(((texturePixels * 4) / 3 / (1024 * 1024)).toFixed(1)),
    triangles: tris,
    vertices: verts,
    bounds: {
      // Conservative: per-primitive mesh-space boxes transformed by 8 corners.
      method: 'conservative-8-corner',
      min: min.map((v) => Number(v.toFixed(4))),
      max: max.map((v) => Number(v.toFixed(4))),
      size: max.map((v, i) => Number((v - min[i]).toFixed(4))),
      center: min.map((v, i) => Number(((v + max[i]) / 2).toFixed(4))),
    },
    bytes: candidateStat.size,
    extensionsUsed,
    rigWarnings: rig.warnings,
  }
  if (summary.bounds.size[2] < 100 || summary.bounds.size[2] > 116) {
    throw new Error(`truss span (Z) measured ${summary.bounds.size[2]} m — expected ≈108.3 m`)
  }
  return summary
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [fbxPath, sourceGlbPath] = process.argv.slice(2)
  if (!fbxPath || !sourceGlbPath) fail('usage: node scripts/build-iss-model.mjs <IGOAL.fbx> <IGOAL.glb>')
  if (!(await exists(fbxPath))) fail(`FBX not found: ${fbxPath}`)
  if (!(await exists(sourceGlbPath))) fail(`source GLB not found: ${sourceGlbPath}`)

  const fbxHash = createHash('sha256').update(await readFile(fbxPath)).digest('hex')
  const sourceGlb = await readFile(sourceGlbPath)
  const glbHash = createHash('sha256').update(sourceGlb).digest('hex')

  const rawGlb = await convertFbx(fbxPath)
  await optimize(rawGlb, readSourceMaterials(sourceGlb))

  let summary
  try {
    summary = await validateCandidate(CANDIDATE_PATH)
  } catch (error) {
    fail(`candidate rejected — previous runtime asset left untouched: ${String(error)}`)
  }

  await copyFile(CANDIDATE_PATH, OUT_PATH)
  const outStat = await stat(OUT_PATH)
  const mib = outStat.size / (1024 * 1024)

  console.log('──────────────── ISS IGOAL build report ────────────────')
  console.log(`nodes:            ${summary.nodes} (mesh instances: ${summary.meshInstances}, stored meshes: ${summary.storedMeshes})`)
  console.log(`triangles:        ${(summary.triangles / 1e6).toFixed(2)} M`)
  console.log(`vertices:         ${(summary.vertices / 1e6).toFixed(2)} M`)
  console.log(`textures:         ${summary.textures} KTX2 (≤${summary.textureGpuMiBUpperBound} MiB on GPU)`)
  console.log(`extensions:       ${summary.extensionsUsed.join(', ')}`)
  console.log(`bounds (m):       ${summary.bounds.size.join(' × ')} (conservative)`)
  console.log(`bounds center:    [${summary.bounds.center.join(', ')}]`)
  console.log(`trrj limits:      ±${TRRJ_LIMITS.softwareLimitDeg}° software, ${TRRJ_LIMITS.slewDegPerSimSecond}°/sim-s`)
  console.log(`published:        ${path.relative(root, OUT_PATH)} — ${mib.toFixed(1)} MiB`)
  console.log(`source fbx sha256: ${fbxHash}`)
  console.log(`source glb sha256: ${glbHash}`)
  if (summary.rigWarnings.length > 0) console.warn(`rig warnings: ${summary.rigWarnings.join('; ')}`)
  console.log('─────────────────────────────────────────────────────────')

  await writeFile(
    path.join(WORK_DIR, 'bounds-report.json'),
    JSON.stringify({ mib, sourceFbxSha256: fbxHash, sourceGlbSha256: glbHash, ...summary }, null, 2),
  )
  console.log('[build-iss-model] done.')
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => fail(String(error?.stack ?? error)))
}
