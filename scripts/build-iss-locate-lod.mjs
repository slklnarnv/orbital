// ─── build-iss-locate-lod.mjs — Locate-tier IGOAL LOD ────────────────────────
//
// Derives the fast Locate/Follow model from the high build's master
// (.tmp-iss-build/iss_igoal_master.glb: full geometry, lossless textures, rig
// extras — written by build-iss-model.mjs). The high model is deliberately
// deferred and large (~2.67M triangles). A cold Locate on a slow connection
// cannot finish it inside the 8 s departure gate, so the camera departs on the
// schematic Model A and swaps to IGOAL mid-flight — the visible pop this LOD
// removes.
//
// What is stripped and why:
//   - 76% of the high model's triangles (2.02M of 2.665M) sit in nodes named
//     *Details* / *Handrails* — greebles, handrails and small hardware that
//     are sub-pixel at the 353 km Follow standoff. Uniform simplification is
//     NOT enough on this CAD-style mesh (measured: even aggressive per-primitive
//     simplification removes only ~14% because most parts are small and
//     disconnected); removing those meshes is the effective lever.
//   - A short keep-list preserves the payloads that define the silhouette
//     (AMS, Bartolomeo, ELCs, the ERA-containing MLM detail mesh, radiators,
//     iROSA mod kits), so Follow still reads as the real station.
//   - The kept geometry is simplified and textures become KTX2 / ETC1S at
//     512 px (albedo) / 256 px (normal, metallic-roughness). Empty leaf nodes left by the strip are removed unless the
//     rig names them. The full high model remains for Inspect (<200 km).
//
// The LOD keeps the complete 703-node rig: 12 joints, 8 oscillators, the six
// protected attachment frames and `extras.orbitalRig` — so ISSAnimations and
// the normalization constants are shared with the high model untouched.
//
// Publication is candidate-first: write to .tmp-iss-build, decode and validate
// (rig, KTX2 textures, finite geometry, truss span, budget), then copy to
// public/models/iss_igoal_locate.glb. A failure leaves the published asset
// untouched.
//
// Usage: node scripts/build-iss-locate-lod.mjs   (after build-iss-model.mjs;
//        KTX_BIN names the `ktx` executable when it is not on PATH)
// Importing is side-effect free; the CLI runs via the main guard.

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { draco, prune, simplifyPrimitive } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { batchRigidMeshes, createIO, encodeTexturesKtx2, pruneEmptyLeaves, validateCandidate } from './build-iss-model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK_DIR = path.join(root, '.tmp-iss-build')
const MASTER_PATH = path.join(WORK_DIR, 'iss_igoal_master.glb')
const OUT_PATH = path.join(root, 'public/models/iss_igoal_locate.glb')
const CANDIDATE_PATH = path.join(WORK_DIR, 'iss_igoal_locate_candidate.glb')

/** Nodes whose geometry survives the Locate LOD. Everything else matching
 *  STRIP_PATTERN is dropped. Keep this list aligned with the visible hardware
 *  at Follow range; add a name here only if its absence is noticeable. */
export const KEEP_DETAIL_PATTERN = /AMS_Details|Columbus_BARTOLOMEO_Details|Airlock_Details|MLM_Details_Misc|Node3_Details|P6_Batteries_Details|Columbus_Details|Payload_MBSU_Covered_Details|ELC\d*_Details|Bishop_Details_Misc/i
export const STRIP_PATTERN = /details|handrail|greeble/i

// Follow frames the whole station in a few hundred pixels: albedo keeps 512,
// normal and metallic-roughness detail is sub-pixel there, so 256 suffices.
const MAX_COLOR_TEXTURE_EDGE = 512
const MAX_DATA_TEXTURE_EDGE = 256
const SIMPLIFY_RATIO = 0.3
const SIMPLIFY_ERROR = 0.03

/**
 * Drop detail/handrail meshes, keeping the named silhouette payloads. Nodes
 * stay in the tree (including the six protected empty frames), so the rig and
 * joint resolution are unaffected.
 */
export function stripDetailMeshes(document, { keep = KEEP_DETAIL_PATTERN, strip = STRIP_PATTERN } = {}) {
  let strippedNodes = 0
  let keptDetailNodes = 0
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const name = node.getName()
    if (strip.test(name) && !keep.test(name)) {
      strippedNodes += 1
      node.setMesh(null)
    } else if (strip.test(name)) {
      keptDetailNodes += 1
    }
  }
  return { strippedNodes, keptDetailNodes }
}

// Shared with the high build (the strip above leaves the same emptied leaves).
export { pruneEmptyLeaves }

/**
 * Simplify every primitive still reachable after the strip. The high asset is
 * CAD-style (many small disconnected parts), so this is a secondary lever —
 * the strip above is what removes most triangles. Failures are skipped; the
 * candidate validation below is the gate.
 */
export async function simplifyKeptPrimitives(document, { ratio = SIMPLIFY_RATIO, error = SIMPLIFY_ERROR } = {}) {
  await MeshoptSimplifier.ready
  let before = 0
  let after = 0
  let simplified = 0
  let skipped = 0
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices()
      if (!indices) continue
      before += indices.getCount() / 3
      try {
        simplifyPrimitive(primitive, { ratio, error, simplifier: MeshoptSimplifier })
        const afterIndices = primitive.getIndices()
        after += afterIndices ? afterIndices.getCount() / 3 : 0
        simplified += 1
      } catch {
        skipped += 1
        after += indices.getCount() / 3
      }
    }
  }
  return { trianglesBefore: Math.round(before), trianglesAfter: Math.round(after), simplified, skipped }
}

/**
 * Transform the master document into the Locate document in place: strip,
 * drop emptied leaves, prune the orphaned meshes/accessors/materials,
 * simplify, batch the rigid geometry, encode KTX2 textures, then Draco.
 */
export async function buildLocateDocument(document) {
  const stripped = stripDetailMeshes(document)
  const emptied = pruneEmptyLeaves(document)
  await document.transform(prune({ keepLeaves: true }))
  const simplified = await simplifyKeptPrimitives(document)
  const { primitivesBefore, primitivesAfter, emptyNodesRemoved: batchEmptied } = batchRigidMeshes(document)
  await document.transform(prune({ keepLeaves: true }))
  await encodeTexturesKtx2(document, {
    maxEdge: (usage) => (usage.color ? MAX_COLOR_TEXTURE_EDGE : MAX_DATA_TEXTURE_EDGE),
  })
  await document.transform(
    draco({
      method: 'edgebreaker',
      quantizePosition: 12,
      quantizeNormal: 8,
      quantizeTexcoord: 10,
    }),
  )
  await document.transform(prune({ keepLeaves: true }))
  return {
    ...stripped,
    ...simplified,
    emptyNodesRemoved: emptied.emptyNodesRemoved + batchEmptied,
    batchedPrimitives: `${primitivesBefore} → ${primitivesAfter}`,
  }
}

function fail(message) {
  console.error(`[build-iss-locate-lod] ${message}`)
  process.exit(1)
}

/** Build the candidate, validate it, and publish only on success. */
export async function buildLocateLod({
  highPath = MASTER_PATH,
  outPath = OUT_PATH,
  candidatePath = CANDIDATE_PATH,
} = {}) {
  const io = await createIO()
  const sourceHash = createHash('sha256').update(await readFile(highPath)).digest('hex')

  console.log('[build-iss-locate-lod] Reading the high build master...')
  const document = await io.read(highPath)
  const stats = await buildLocateDocument(document)

  console.log('[build-iss-locate-lod] Writing candidate...')
  await mkdir(WORK_DIR, { recursive: true })
  await io.write(candidatePath, document)

  // Full contract gate on the decoded candidate: rig, KTX2 textures, finite
  // positions, truss span, budget. Throws before publication on any failure.
  const summary = await validateCandidate(candidatePath)
  await copyFile(candidatePath, outPath)
  const outStat = await stat(outPath)
  const mib = outStat.size / (1024 * 1024)

  const report = {
    source: path.relative(root, highPath),
    sourceSha256: sourceHash,
    published: path.relative(root, outPath),
    mib,
    bytes: outStat.size,
    ...stats,
    ...summary,
  }
  await writeFile(path.join(WORK_DIR, 'locate-lod-report.json'), JSON.stringify(report, null, 2))
  return report
}

async function main() {
  const report = await buildLocateLod()
  console.log('──────────── Locate LOD build report ────────────')
  console.log(`source:           ${report.source}`)
  console.log(`published:        ${report.published} — ${report.mib.toFixed(2)} MiB`)
  console.log(`nodes:            ${report.nodes} (mesh instances: ${report.meshInstances}, stored meshes: ${report.storedMeshes})`)
  console.log(`triangles:        ${(report.triangles / 1000).toFixed(0)}k (strip: ${report.strippedNodes} nodes, simplify: ${report.simplified} prims)`)
  console.log(`vertices:         ${(report.vertices / 1000).toFixed(0)}k`)
  console.log(`textures:         ${report.textures} KTX2`)
  console.log(`draw primitives:  ${report.batchedPrimitives} (rigid batching)`)
  console.log(`extensions:       ${report.extensionsUsed.join(', ')}`)
  console.log(`bounds (m):       ${report.bounds.size.join(' × ')}`)
  console.log(`source sha256:    ${report.sourceSha256}`)
  console.log('──────────────────────────────────────────────────')
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => fail(String(error?.stack ?? error)))
}
