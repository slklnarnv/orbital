// ─── iss-rig-manifest.mjs — build-time authority for the IGOAL rig ───────────
//
// Single source of truth for the articulated-mechanism contract of
// public/models/iss_igoal.glb: joint roles and axes (in the asset's NATIVE
// model frame), panel reference normals, oscillator parameters, protected
// attachment frames, and required node identity. Both build-time tools
// (build-iss-model.mjs, iss-model-manifest.mjs) import this module for
// validation; a vitest suite asserts the runtime TypeScript definitions in
// src/rendering/iss/ISSJointKinematics.ts stay in sync with it.
//
// Mechanism facts (measured on the authored asset, native model meters,
// truss beamline x=y=0 along Z):
//   - SARJ (PORT/STBD_ALPHA_ROT): shaft = truss axis, native Z. Origins sit
//     on the beamline at z = ∓17.78.
//   - TRRJ (PORT/STBD_TRRJ_GAMMA_ROT): shaft = the radiator beam's own long
//     axis, native X (both TRRJ node-local +Y axes map to native +X; the
//     deployed radiator extends native −X along that shaft; NASA ATCS
//     drawings show the bearing/torque-box axis perpendicular to the main
//     truss). Origins at x ≈ −6.775 lie ON the shaft — any point on a
//     rotation axis is an equivalent pivot; no end-edge relocation applies.
//   - Panel reference normals: solar blankets and radiator panels face
//     native ±Y at authored pose (thin bbox axis), front ≈ +Y.

export const SCHEMA_VERSION = 1

/**
 * Joint definitions. `axisModel`/`normalModel` are unit directions in the
 * GLB's native model frame (before the app's pre-rotation/attitude).
 */
export const JOINTS = [
  {
    id: 'SARJ_PORT',
    nodeName: 'PORT_ALPHA_ROT',
    role: 'sarj',
    axisModel: [0, 0, 1],
    normalModel: [0, 1, 0],
  },
  {
    id: 'SARJ_STBD',
    nodeName: 'STBD_ALPHA_ROT',
    role: 'sarj',
    axisModel: [0, 0, 1],
    normalModel: [0, 1, 0],
  },
  {
    id: 'TRRJ_PORT',
    nodeName: 'PORT_TRRJ_GAMMA_ROT',
    role: 'trrj',
    axisModel: [1, 0, 0],
    normalModel: [0, 1, 0],
  },
  {
    id: 'TRRJ_STBD',
    nodeName: 'STBD_TRRJ_GAMMA_ROT',
    role: 'trrj',
    axisModel: [1, 0, 0],
    normalModel: [0, 1, 0],
  },
  // Beta Gimbal Assemblies: mast = native ±X (measured; pivots on the mast
  // centreline), blanket normal +Y (the face the SARJ tracks to the sun).
  ...[
    ['BGA_2A', 'PORT_BETA_ROT_2A', -1], ['BGA_4A', 'PORT_BETA_ROT_4A', 1],
    ['BGA_2B', 'PORT_BETA_ROT_2B', 1], ['BGA_4B', 'PORT_BETA_ROT_4B', -1],
    ['BGA_1A', 'STBD_BETA_ROT_1A', 1], ['BGA_3A', 'STBD_BETA_ROT_3A', -1],
    ['BGA_1B', 'STBD_BETA_ROT_1B', -1], ['BGA_3B', 'STBD_BETA_ROT_3B', 1],
  ].map(([id, nodeName, sx]) => ({ id, nodeName, role: 'bga', axisModel: [sx, 0, 0], normalModel: [0, 1, 0] })),
]

/**
 * Camera pan/tilt oscillators (idle sweep). Each target must resolve to
 * exactly one node; entries are independent (A1: no shared-index coupling).
 */
export const OSCILLATORS = [
  { target: 'JEM_PM_Details_Camera_Fwd_Pan', axis: 'y', amplitudeDeg: 8, periodSec: 62, phaseDeg: 0 },
  { target: 'JEM_PM_Details_Camera_Fwd_Tilt', axis: 'x', amplitudeDeg: 6, periodSec: 47, phaseDeg: 90 },
  { target: 'JEM_PM_Details_Camera_Aft_Pan', axis: 'y', amplitudeDeg: 8, periodSec: 71, phaseDeg: 140 },
  { target: 'JEM_PM_Details_Camera_Aft_Tilt', axis: 'x', amplitudeDeg: 6, periodSec: 53, phaseDeg: 230 },
  { target: 'ELP_PRIME_Details_Camera_Pan', axis: 'y', amplitudeDeg: 7, periodSec: 59, phaseDeg: 40 },
  { target: 'ELP_PRIME_Details_Camera_Tilt', axis: 'x', amplitudeDeg: 5, periodSec: 44, phaseDeg: 300 },
  { target: 'SHP_PRIME_Details_Camera_Pan', axis: 'y', amplitudeDeg: 7, periodSec: 67, phaseDeg: 190 },
  { target: 'SHP_PRIME_Details_Camera_Tilt', axis: 'x', amplitudeDeg: 5, periodSec: 49, phaseDeg: 20 },
]

/**
 * Empty authored attachment frames pruned by earlier builds. Restoring them
 * preserves future robotics/articulation anchors (they have no triangles).
 */
export const PROTECTED_FRAMES = [
  { node: 'JEM_WRR', parent: 'JEM_WR_ROT', purpose: 'JEM wrist/end frame' },
  { node: 'MBS_MGF_1', parent: 'MBS', purpose: 'Mobile-base mount frame' },
  { node: 'MBS_MGF_3', parent: 'MBS', purpose: 'Mobile-base mount frame' },
  { node: 'SSRMS_WRY_AttachmentPoint', parent: 'WRR', purpose: 'Canadarm2 end frame' },
  { node: 'Node2_PDGF_Attach', parent: 'Node2', purpose: 'Grapple/base attachment frame' },
  { node: 'USLab_PDGFMount', parent: 'USLab', purpose: 'Grapple/base attachment frame' },
]

/** NASA ATCS TRRJ travel/rate limits (software range is the command bound). */
export const TRRJ_LIMITS = {
  softwareLimitDeg: 105,
  hardwareLimitDeg: 115,
  slewDegPerSimSecond: 0.75,
}

/** Every node identity the repaired asset must contain. */
export const REQUIRED_NODES = [
  ...JOINTS.map((j) => j.nodeName),
  ...OSCILLATORS.map((o) => o.target),
  ...PROTECTED_FRAMES.map((f) => f.node),
  // Wings and major hardware:
  'P4_Array_2A', 'P4_Array_4A', 'P6_2B_Array', 'P6_4B_Array',
  'S4_Array_1A', 'S4_Array_3A', 'S6_1B_Array', 'S6_3B_Array',
  'IROSA_Deployed_P44A', 'IROSA_Deployed_P62B', 'IROSA_Deployed_P64B',
  'IROSA_Deployed_S41A', 'IROSA_Deployed_S43A', 'IROSA_Deployed_S61B',
  'P1_Radiator', 'S1_Radiator',
  'JEM_PM_Details_Camera_Fwd_Pan', 'ELP_PRIME_Details_Camera_Pan',
]

/** Runtime subset emitted into the GLB scene extras as `extras.orbitalRig`. */
export function runtimeSubset() {
  return {
    schemaVersion: SCHEMA_VERSION,
    source: 'scripts/iss-rig-manifest.mjs',
    joints: JOINTS.map(({ id, nodeName, role, axisModel, normalModel }) => ({
      id, nodeName, role, axisModel, normalModel,
    })),
    oscillators: OSCILLATORS,
    trrjLimits: TRRJ_LIMITS,
  }
}

/**
 * Parse the ORIGINAL glTF JSON declarations out of a GLB container, before
 * any decoder touches the buffers. glTF-Transform's `Accessor.getMin/getMax`
 * recompute from the decoded array, so they can NEVER detect a stale or
 * quantization-shifted file declaration — comparing against them is not an
 * independent check. Returns the parsed JSON (accessors included), or null
 * for non-GLB inputs.
 */
export function parseGlbJsonDeclarations(buffer) {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) return null // 'glTF' magic
  const chunk0Length = dv.getUint32(12, true)
  const chunk0Type = dv.getUint32(16, true)
  if (chunk0Type !== 0x4e4f534a) return null // 'JSON'
  const jsonBytes = Buffer.from(buffer.buffer, buffer.byteOffset + 20, chunk0Length)
  return JSON.parse(jsonBytes.toString('utf8'))
}

/** Structural validation of a glTF-Transform document against this contract. */
export function validateDocumentRig(document) {
  const errors = []
  const warnings = []
  const nodeNames = new Set()
  const nodesByParent = new Map()
  for (const node of document.getRoot().listNodes()) {
    const name = node.getName()
    if (!name) continue
    if (nodeNames.has(name)) warnings.push(`duplicate node name "${name}"`)
    nodeNames.add(name)
    const parent = node.getParentNode()
    nodesByParent.set(name, parent ? parent.getName() : null)
  }
  for (const required of REQUIRED_NODES) {
    if (!nodeNames.has(required)) errors.push(`missing required node "${required}"`)
  }
  for (const frame of PROTECTED_FRAMES) {
    if (!nodeNames.has(frame.node)) continue // already reported as missing
    const actualParent = nodesByParent.get(frame.node)
    if (actualParent !== frame.parent) {
      errors.push(`protected frame "${frame.node}" has parent "${actualParent}", expected "${frame.parent}"`)
    }
  }
  for (const joint of JOINTS) {
    const node = document.getRoot().listNodes().find((n) => n.getName() === joint.nodeName)
    if (!node) continue
    if (!node.getParentNode()) errors.push(`joint "${joint.nodeName}" has no parent`)
  }
  // Orthogonality of each joint's authored axis/reference (model frame).
  for (const joint of JOINTS) {
    const dot =
      joint.axisModel[0] * joint.normalModel[0] +
      joint.axisModel[1] * joint.normalModel[1] +
      joint.axisModel[2] * joint.normalModel[2]
    if (Math.abs(dot) > 1e-6) errors.push(`joint "${joint.id}" axis/normal not orthogonal (dot=${dot})`)
  }
  return { errors, warnings, nodeCount: nodeNames.size }
}
