# ISS Model — Full Context Briefing for Audit/Repair Agents

> Status 2026-10-25: this briefing describes the code as implemented by plan
> 001 (rig data, the TRRJ axis, the build-time radiator coating, BGA tracking),
> the Locate LOD, and the source-material / KTX2 rebuild (authored PBR grafted
> from the source GLB, GPU-compressed textures, joint hand-off between tiers). §3 is audit history and stays in the past tense.

Read this completely before touching anything. Every number in here was
verified by decoded-vertex measurement AND cross-checked in the browser with
three.js's own Draco decoder (they agree to 0.01 m). If your measurement
disagrees with a number here, **your measurement is wrong until you have
ruled out the documented traps in §6** — that is not arrogance, it is what
happened twice already (§3).

Related docs: `docs/MODEL_AUDIT.md` (forensic audit report + classifications),
`docs/HANDOFF.md` (app-wide handoff), `docs/NEXT_STEPS.md` (roadmap).

---

## 1. What and where

**App**: ORBITAL — real-time ISS orbital visualization (React 18, TS strict,
Vite 6, R3F + three r170, zustand 5, satellite.js). The ISS is rendered at
**~1,000× real scale** (109 m wingspan → 109 render units = "km"). This is
intentional and the entire camera/LOD system is calibrated to it. **Never
"fix" the scale.**

**The model asset** (the subject of this briefing):
`public/models/iss_igoal.glb` — 27.1 MiB (≈24.2 MB over the wire with brotli),
Draco geometry + KTX2 (Basis ETC1S) textures, built from the two IGOAL
sources below.

**SOURCES — NOT in the repo**: the owner publishes them as the
`source-assets-igoal` release asset `ISSTEST.zip` (315 MB). Both IGOAL files
come from NASA IGOAL's config-controlled `ISS_External_26.05_revA.blend`
(the May 2026 configuration), exported by Blender 5.0.1.

| File in `ISSTEST/` | What it is |
|:--|:--|
| `International Space Station (ISS) (D) (IGOAL).fbx` (172 MB, sha256 `c3c43b9c…`) | **Geometry source of record**: 702 named nodes, the real part hierarchy, lossless PNG textures. No animation stacks, pivots or custom properties (the rig is ours, §5). |
| `International Space Station (ISS) (D) (IGOAL).glb` (65 MB, sha256 `3b03742f…`) | **Material source of record**: a direct Blender glTF export. Its geometry is ONE merged mesh (unusable), but its 44 materials are exactly what Blender renders — packed metallic-roughness maps, factors, normal strengths, and albedo maps the FBX does not embed (MLI blankets, GEDI). Images are mostly JPEG. |
| `ISS_stationary.glb / .gltf + .bin / .usdz` | A different, older ~250k-triangle model — not used |
| `International Space Station (ISS) (C) (High Res)/` | NASA JSC's 2011 LightWave model set — not used |
| `isscomplete.3ds`, `isstextures.zip` | Legacy format + loose textures — not used |

After a build, `.tmp-iss-build/` holds the uncompressed FBX2glTF output
`igoal_raw.glb` (291 MB) and the master `iss_igoal_master.glb` the Locate LOD
is derived from.

### 1.1 Full rebuild recipe (from the sources)

Needs KTX-Software ≥ 4.3 (`ktx` on PATH, or `KTX_BIN=/path/to/ktx`; the
Linux tarball also needs `LD_LIBRARY_PATH=<ktx>/lib`).

```bash
node scripts/build-iss-model.mjs "ISSTEST/International Space Station (ISS) (D) (IGOAL).fbx" \
                                 "ISSTEST/International Space Station (ISS) (D) (IGOAL).glb"
npm run build:iss-lod
```

What it does (all steps are in `scripts/build-iss-model.mjs`, ~3.5 min):
1. FBX2glTF (`--binary --pbr-metallic-roughness`; **never add
   `--no-flip-v`** — the V-flip is required for the FBX UVs) →
   `.tmp-iss-build/igoal_raw.glb` (~1 min).
2. Fixes ~13 falsely-transparent materials to OPAQUE and repairs a BMP whose
   mimeType FBX2glTF mangles. Then **grafts the source GLB's materials by
   name** (`applySourceMaterials`, before dedupe): FBX2glTF drops every
   metallic-roughness map and stamps its Phong conversion (metallic 0.4,
   roughness 0.272) on all 47 materials. The graft restores the factors and
   38 metallic-roughness maps, adds the albedo maps the FBX lacks (MLI
   blankets, GEDI; FBX images win where both exist), sets the authored normal
   strengths (MLI 3, ELC_Payloads_04 2), and renders the genuine alpha
   cutouts `CUTOUT_MATERIALS` = ELC_Base (deck grating, perforated plates) and
   IROSA (hex-hole panels) as MASK 0.5. They stay single-sided although the
   source marks every material double-sided: double-sided thin blankets
   z-fight front against back face (it speckled every iROSA wing tan at orbit
   range). `Truss` is BLEND in the source too, but its alpha also hides the
   radiator edge rails, so it stays OPAQUE. The authored metalness is halved
   (`SOURCE_METALLIC_SCALE = 0.5`): it was tuned for Blender's all-around
   HDRI, and under this app's sun + studio environment + black space the
   full values turned the array backs and truss near-black at night. Halved,
   the asset measures at brightness parity with the previous one (mean
   lit-pixel luminance, app lighting, array close-up: day 104 vs 106,
   eclipse 94 vs 101) while keeping the maps' variation. Then strips the baked `COLOR_0` vertex-colour layer (Nauka's stale
   hull shading), dedupe / prune (`keepLeaves`, which keeps the six empty
   attachment frames) / weld, and resizes textures to lossless PNG ≤2048 px
   (metallic-roughness ≤1024).
3. EATCS panel split (`splitRadiatorPanels()`): ±Y-facing triangles
   (|n_y| > 0.7) inside the `Truss`-material primitives of
   `P1_Radiator`/`S1_Radiator` move onto a dedicated white Z-93-style
   `Radiator_Panel_Coating` (base colour 0.93/0.94/0.96, metallic 0.1,
   roughness 0.55). The shared `Truss` material is untouched.
4. Selective decimation: only nodes matching `/details/i` are simplified
   (ratio 0.5) — arrays, trusses, radiators, modules stay full-res.
5. The runtime rig subset from `scripts/iss-rig-manifest.mjs` is written into
   the scene extras (`extras.orbitalRig`) and the master
   (`.tmp-iss-build/iss_igoal_master.glb`: uncompressed geometry, PNG
   textures) is saved for the Locate LOD.
6. Textures → KTX2 / Basis ETC1S (`encodeTexturesKtx2`, `ktx create
   --encode basis-lz --qlevel 255 --generate-mipmap`): colour slots sRGB,
   normal / metallic-roughness linear, alpha kept only where a MASK material
   reads it. Measured on par with the WebP q80 it replaced (albedo 36.1 vs
   36.7 dB PSNR, normals 3.9° vs 3.5° mean angular error), at ≤228 MiB of GPU
   texture memory for 113 textures — the WebP set decoded to ~700 MiB of RGBA8
   for 73. Before that, **rigid batching** (`batchRigidMeshes`, plan 001
   Phase D): static geometry merges into one primitive per (rigid part ×
   module × material). A rigid part is the static station or the subtree of
   one driven joint / camera (`MOVING_NODES`), stopping at the next driven
   node; the batch hangs under that part's root, so every joint turns exactly
   what it turned before. The static station is split per top-level module,
   so frustum culling keeps module granularity. Each source is baked with its
   own transform (`transformPrimitive` reverses the winding of the eleven
   authored mirrored parts). 993 → 217 primitives (draw calls); emptied leaves
   go, rig-named nodes stay (703 → 294 nodes). Then Draco (14-bit positions,
   10-bit normals — raised from default 8 to avoid visible banding, 12-bit
   UVs), and the build writes a CANDIDATE:
   `.tmp-iss-build/iss_igoal_candidate.glb`.
7. Validation of the DECODED candidate: the rig contract (`REQUIRED_NODES`:
   all joint and oscillator nodes, the six protected attachment frames, the 8
   arrays, the 6 iROSAs, both radiators), every texture KTX2 with
   `KHR_texture_basisu` required, finite POSITION data, a 35 MiB hard budget
   and a plausible truss span. Only a fully valid candidate is copied to
   `public/models/iss_igoal.glb` (current build 27.1 MiB / 24.2 MB brotli,
   294 nodes, 217 draw primitives); a
   failure leaves the previous asset untouched. The bounds report (with both
   source hashes) is written to `.tmp-iss-build/bounds-report.json`.

`node scripts/iss-model-manifest.mjs public/models/iss_igoal.glb --check-only`
runs the same rig/format/budget checks (plus the independent declared-bounds
comparison) on an existing GLB without writing anything.

**After any rebuild**: re-read the fresh bounds report and update
`IGOAL_DETAILED` (`wingspanM`, `pivotOffset`) in `src/rendering/iss/ISSModel.tsx`,
then re-run the whole verification protocol in §7. The animation resolves its
joints at mount from the rig metadata (`extras.orbitalRig`) and the live
parent-relative frames, so no joint geometry is hardcoded in the component; the
build's rig validation rejects a missing node, but a subtly changed hierarchy
would still only show at runtime.

**Other assets** (do not confuse with the above):
- `public/models/international_space_station.glb` — "legacy" detailed model,
  selectable fallback, DELIBERATELY static (no animation).
- `public/models/International Space Station (ISS) (A).glb` — "Model A",
  40 KB always-mounted far-range schematic, single merged mesh.

### 1.2 Locate-tier LOD (2026-10-23)

`public/models/iss_igoal_locate.glb` is derived from the high build's master
(`.tmp-iss-build/iss_igoal_master.glb`) by `scripts/build-iss-locate-lod.mjs`
— do not hand-edit it. Measured: **6.20 MiB (≈5.5 MB brotli), 787k
triangles, ~1.76M vertices, 176 draw primitives (rigid batching, from 438),
113 KTX2 textures (albedo 512 px, normal / metallic-roughness 256 px, ≤20 MiB
on GPU), 253 nodes** — every rig node (12 joints, 8 oscillators, six
protected attachment frames) plus the structure; leaves emptied by the strip
and the batching are removed. It keeps `extras.orbitalRig`, and its decoded truss span is
**108.294 m** (high: 108.293), so `IGOAL_LOCATE` shares the high model's
normalization/pivot constants.

Derivation: strip detail/handrail meshes except the silhouette keep-list in
`build-iss-locate-lod.mjs` (76% of the high model's 2.665M triangles are
`Details_*`), drop emptied leaves unless the rig names them
(`pruneEmptyLeaves`), simplify the kept geometry at 0.3 ratio / 0.03 error,
batch the rigid geometry (as the high build), encode the textures, then Draco (position 12 / normal 8 / UV 10). Uniform
simplification alone only removes ~14% on this CAD-style mesh; stripping the
detail meshes is the effective lever. The build writes a candidate, validates
the full rig/KTX2/geometry/budget contract, then publishes.

Runtime: the `high` setting loads this LOD first and uses it for Locate/Follow.
The full `iss_igoal.glb` is requested only inside the 200/220 km Inspect band
(the `isClose` hysteresis in `ISSModel.tsx`; a close FREE view counts too). A
high-tier failure keeps the LOD; a LOD failure demotes the requested path to
legacy. Rebuild after any high-asset rebuild with `npm run build:iss-lod`.
Both tiers load through drei's `useGLTF` with a `KTX2Loader` (transcoder
self-hosted in `public/basis/`). The `.js` glue is NOT a plain copy of
`three/examples/jsm/libs/basis`: three's embind glue builds its invokers with
`new Function`, which the production CSP (no `'unsafe-eval'`) blocks inside
the blob: transcoder workers — the worker dies at init without answering and
every KTX2 load hangs (the 2026-10-25 live outage). `npm run patch:basis`
(`scripts/patch-basis-transcoder.mjs`) copies three's files and rewrites the
two code-generation sites to closures; re-run it on a three upgrade
(`BasisTranscoderCsp.test.ts` fails if `public/basis/` drifts from three or
the patch no longer applies). Each KTX2 texture load is also bounded
(`loadStallGuard.ts`, 30 s): a transcoder that never answers becomes a load
error. GLTFParser resolves failed textures to null and still finishes the
model, so detail preparation fails any model with missing textures
(`countMissingTextures`) and the ladder demotes instead of showing a grey
station or stranding the spinner. `vite preview`
serves the `vercel.json` headers, so CSP failures reproduce locally. The
transcoder URLs carry `?v=<__BASIS_ID__>` (a content hash of `public/basis/`)
and the route is `immutable`, so a changed transcoder reaches cached clients
at once.

**Selection**: `src/stores/settingsStore.ts` (`issModelQuality: 'high' |
'legacy'`, default `'high'`, persisted). `'high'` → `iss_igoal_locate.glb`
first, then `iss_igoal.glb` inside 200 km. On first-tier failure a ladder
demotes high → legacy → Model A; a full-high failure with a committed LOD keeps
the LOD. At runtime the mounted asset is logged:
`[ISS AUDIT] { quality, url, attempt }` (console; `quality` is `locate`,
`high` or `legacy`).

**Key files**:

| Path | Role |
|:--|:--|
| `src/rendering/iss/ISSModel.tsx` | LOD selection, normalization constants, GPU prep, eclipse lighting, `[ISS AUDIT]` log |
| `src/rendering/iss/ISSAnimations.tsx` | Rig lifecycle: mount, visibility, the frame loop |
| `src/rendering/iss/ISSRigAnimator.ts` | The per-frame rig step (SARJ/TRRJ/BGA joints + camera oscillators, tier hand-off), free of React |
| `src/rendering/iss/ISSJointKinematics.ts` | Pure, unit-tested joint math: rig types, `resolveJoint`, target laws, slew, tier hand-off, `parseRigMetadata` |
| `scripts/iss-rig-manifest.mjs` | Rig contract source of truth: joints, axes, oscillators, TRRJ limits, protected frames, required nodes |
| `src/rendering/iss/ISSGroup.tsx` | Inertial position + smoothed attitude (do not touch for model work) |
| `src/rendering/iss/stationAttitude.ts` | `lvlhAttitude`: the LVLH/TEA attitude, pure (shared with the rig simulation test) |
| `tests/unit/rendering/ISSRigSimulation.test.ts` | Flies the published assets' node trees through real orbits with the app's rig code and measures the result (§7.5) |
| `scripts/build-iss-model.mjs` | IGOAL FBX + GLB → optimized runtime GLB + master (needs both source arguments and `ktx`) |
| `scripts/build-iss-locate-lod.mjs` | Derives the Locate LOD from the high build's master (candidate → validate → publish) |
| `scripts/iss-model-manifest.mjs` | Forensic per-node manifest of a GLB (REPAIRED — see §6.1) |
| `scripts/iss-model-inspector.html` | Browser harness: loads the GLB standalone, logs Box3 measurements, `window.__setView` / `__cam` / `__isolate` / `__restore` hooks |
| `.tmp-iss-build/audit-igoal-fixed/` | Current manifest + tree + exported textures for the shipped GLB |

---

## 2. Verified asset facts (IGOAL, native GLB frame: meters, +Y up, truss along Z)

Whole model (decoded vertices, exact):
- Bounds min `(−36.7163, −22.1156, −54.1457)`, max `(36.7112, 8.5104, 54.1469)`
- Size **73.4275 × 30.6260 × 108.2926 m**, center **(−0.0025, −6.8026, 0.0006)**
- The source hierarchy has 703 named nodes (the six empty attachment frames
  included) and 656 meshes. The runtime asset batches them (§1.1 step 6):
  294 nodes, 217 primitives, 43 materials (including
  `Radiator_Panel_Coating`), 113 KTX2 textures (38 of them
  metallic-roughness), ≈2.67M triangles / ≈6.0M vertices (2,665,353 /
  6,001,154 from the stored accessor counts). Part geometry no longer sits
  on its named node: it lives in `<module>.batch.<material>` nodes under the
  rigid part's root. Per-part inspection uses the master
  (`.tmp-iss-build/iss_igoal_master.glb`), which keeps the source tree.
- Declared POSITION accessor min/max versus decoded vertices: the independent
  JSON-chunk comparison (`checkDeclaredBounds`) reports quantization-level
  deltas only (max ≈ 4.2e-4 m on the shipped asset) — expected under Draco, not
  stale accessors. (An older check compared decoded against decoded and
  overstated this as an exact match.)

Truss beamline: **model-space line x = y = 0, running along Z**. Cross-check:
both SARJ node origins sit at `(0, 0, ∓17.78)`.

### 2.1 Hierarchy (abridged, with authored transforms)

```
RootNode (identity)
└── SSREF_IGOAL                      q=[−0.70711,0,0,0.70711] (−90°X), s=100
    ├── <modules>: Zvezda_SM, Zarya_FGB, USLab, Node1/2/3, JEM_*, Columbus,
    │   MLM, MRM1/2, PMM, Airlock, BEAM, Cupola, ELC_1..4, ESP1/2/3, AMS,
    │   PMA1/2/3, Bishop_Airlock, Russian_RSNode_DockingModule, MT_Location
    │   └── MT_Location/MT/MBS/.../SSRMS_Base/... (Canadarm2 chain + SPDM)
    ├── PORT_ALPHA_ROT (SARJ)        t=[0,0.1778,0]  q=180°Y    s=0.0254   world (0,0,−17.78)
    │   ├── Truss_P4 → PORT_BETA_ROT_2A → P4_Array_2A
    │   │              PORT_BETA_ROT_4A → P4_Array_4A (contains IROSA_Deployed_P44A)
    │   ├── Truss_P5
    │   └── Truss_P6 → PORT_BETA_ROT_2B → P6_2B_Array (IROSA_Deployed_P62B)
    │                → PORT_BETA_ROT_4B → P6_4B_Array (IROSA_Deployed_P64B)
    ├── STBD_ALPHA_ROT (SARJ)        t=[0,−0.1778,0] q=180°X    s=0.0254   world (0,0,+17.78)
    │   ├── Truss_S4 → STBD_BETA_ROT_1A → S4_Array_1A (IROSA_Deployed_S41A)
    │   │              STBD_BETA_ROT_3A → S4_Array_3A (IROSA_Deployed_S43A)
    │   ├── Truss_S5
    │   └── Truss_S6 (s=63.33!) → STBD_BETA_ROT_1B (s=0.01579!) → S6_1B_Array (IROSA_Deployed_S61B)
    │                              STBD_BETA_ROT_3B → S6_3B_Array
    ├── Truss_S0, Truss_P1 → PORT_TRRJ_GAMMA_ROT → P1_Radiator
    ├── Truss_S1 → STBD_TRRJ_GAMMA_ROT → S1_Radiator
    ├── Truss_P3, Truss_S3, Z1
    └── MLM → MLM_Details_* (ERA arm geometry is merged in here — §4.4)
```

**Unit scales are mixed per subtree** (100, 0.0254, 63.33, 0.01579, …) with
compensating pre-rotations — a CAD unit-conversion artifact. Consequence:
never reason about axes/offsets by reading one node's local TRS; always map
through world (or parent-relative) matrices/quaternions numerically.

### 2.2 Solar arrays (all CORRECT — do not rebuild)

| Node | Subtree size (m) | iROSA child |
|:--|:--|:--|
| P4_Array_2A | 37.43 × 1.86 × 11.40 | none (correct — bare wing) |
| P4_Array_4A | 35.35 × 6.18 × 11.40 | IROSA_Deployed_P44A |
| P6_2B_Array | 35.35 × 6.17 × 11.40 | IROSA_Deployed_P62B |
| P6_4B_Array | 35.35 × 6.21 × 11.40 | IROSA_Deployed_P64B |
| S4_Array_1A | 35.35 × 6.22 × 11.40 | IROSA_Deployed_S41A |
| S4_Array_3A | 35.35 × 6.21 × 11.40 | IROSA_Deployed_S43A |
| S6_1B_Array | 35.35 × 6.21 × 11.40 | IROSA_Deployed_S61B |
| S6_3B_Array | 35.35 × 1.82 × 11.40 | none (correct — bare wing) |

- NASA reference: original SAW ≈ 35.1 × 11.7 m → the 35.35 m lengths and
  ~11.4 m widths are correct. Wing length runs along model **X**, width along
  **Z**, blanket normal along **±Y**. **+Y is the cell face** on all eight
  wings and all six iROSAs (sampled from the blanket texture: dark cells on
  +Y, gold Kapton backing on −Y), which is the face the SARJ/BGA laws turn to
  the sun (`normalModel: [0, 1, 0]`).
- NASA reference: iROSA ≈ 18.2 × 6 m → each `IROSA_Deployed_*` measures
  **21.31 × 5.43 × 6.08** (subtree includes end hardware) — correct.
- Exactly six iROSAs installed (4A, 2B, 4B, 1A, 3A, 1B) = the real 2023–2026
  configuration. **Do NOT add an iROSA to 2A or 3B.**

### 2.3 Radiators (EATCS / HRS)

- `P1_Radiator` and `S1_Radiator`: **23.17 × ~4.5 × 11.57 m** each,
  symmetric, spanning model x ∈ [−23.27, −0.1] (extending fore along −X),
  at z = ∓14.68. Present, complete, correct size (real ≈ 23.3 m).
- **TRRJ shaft = native X, and the node origin lies ON it.** The authored
  TRRJ node origins sit at `(−6.78, 0, ∓14.68)`, 6.7 m inside the 23 m
  radiator span. That is not an end-edge hinge problem: the radiator rolls
  about its OWN beam long axis (native X, perpendicular to the main truss), and
  a rotation axis is a line, so any point on it is an equivalent pivot. The
  origin is on that shaft, so the code rotates the node in place — there is no
  hinge point, no per-frame position compensation. Only the SARJs rotate about
  the truss axis (native Z); their origins sit on the beamline.
  `ISSJointKinematics.ts` encodes this as `axisModel: [1, 0, 0]` for both TRRJ
  joints (`[0, 0, 1]` for the SARJs).
- Materials: the short base beam (primitive 0) = `MLI.Generic` — the
  source's wrinkled white MLI albedo, metallic 0 / roughness 0.5, MLI normal
  map at strength 3. The deployed
  panel faces and frames live in the long `Truss`-material primitive (the
  atlas `Truss_Diffuse.png` contains dark photovoltaic bands on its left
  edge), and under directional sun the pleated panels self-shade to near-black
  — the wrong look. **Fix, at build time**: `splitRadiatorPanels()`
  (`build-iss-model.mjs`) moves the ±Y-facing panel triangles of those
  primitives onto a dedicated white `Radiator_Panel_Coating` (§1.1 step 3), so
  `P1_Radiator` ends up with three primitives: `MLI.Generic` (136 tris),
  `Truss` (874) and `Radiator_Panel_Coating` (608); `S1_Radiator` likewise
  (136 / 1000 / 680). There is NO runtime material override — an earlier
  runtime silver override was removed; do not re-add one.

### 2.4 Other verified points

- **Truss architecture CORRECT**: Z1, P1, P3–P6, S0, S1, S3–S6 (11 segments
  + Z1). Leave alone.
- **ERA (European Robotic Arm) is PRESENT** — no node is named ERA; the arm
  is merged into the Nauka detail meshes (`MLM_Details_Misc`, 48 k tris).
  Verified visually (articulated multi-segment arm at Nauka). It has no
  dedicated node, so it cannot be animated without mesh surgery.
- Canadarm2/SPDM chain exists under `MT_Location/MT/MBS/...` with named
  joint chain. JEM/ELP/SHP pan/tilt camera nodes are the oscillators.
- glTF animations: none. All motion is code-driven.

---

## 3. Audit history — what was claimed, what was true

(History, in the past tense: the current state is in §2 and §5.)

An external audit (reusing this repo's manifest tool) produced dramatic
findings. Verdicts after proper measurement:

| External claim | Verdict |
|:--|:--|
| "Solar arrays undersized (1.8–11.4 m vs 35 m)" | **FALSE** — artifact of the getScalar bug (§6.1). All 8 wings are 35.35 m. |
| "iROSAs undersized (~7 m vs 18.2 m)" | **FALSE** — same bug; real 21.31 × 5.43–6.08. |
| "Bounds stale: real 58.51 × 45.00 × 105.62, center (−7.83, −8.09, −1.34)" | **FALSE** — same bug. Real 73.4275 × 30.6260 × 108.2926, center (−0.0025, −6.8026, 0.0006); declared accessors agreed with the decoded vertices (to Draco quantization, ≤ 4.2e-4 m — see §2). |
| "Normalization constants wrong; center km off" | **FALSE** — constants were already correct within 2.5 mm model-scale; now set to exact measured values. |
| "Screenshots probably show the legacy model, not IGOAL" | **FALSE** — default `'high'` loads IGOAL; verified at runtime (network + `[ISS AUDIT]` log + render). |
| "Four radiators missing" | **FALSE** — both TRRJ radiators present and symmetric (the "tiny extents" were measurement bugs). |
| "Radiator material wrong/suspicious" | **TRUE (appearance)** — first patched with a runtime silver override, then replaced by a build-time white coating split (§2.3). |
| "Animation bypasses native SARJ/BGA hierarchy" | **TRUE** — fixed (§5). |
| "Radiator sun-pointing is only an approximation" | **TRUE** — the first fix kept a sun-pointing approximation with fixed per-radiator offsets; it is now replaced by the illustrative edge-to-Sun / face-to-Earth law (§5). |
| "ERA missing" | **FALSE** — present, merged into MLM detail meshes. |

Lesson that repeated twice in one session: measurement bugs produce
confident, coherent, WRONG numbers. Re-derive with the correct APIs (§6)
before believing any new "discrepancy", including your own.

---

## 4. Runtime normalization (ISSModel.tsx)

- `RENDER_ISS_WINGSPAN_UNITS = 109` (render "km"). Scale = 109 / wingspanM.
- IGOAL spec (`IGOAL_DETAILED`, and `IGOAL_LOCATE` which shares it):
  `wingspanM: 108.293` (largest axis = Z), `wingspanAxis: 'z'`,
  `pivotOffset: [0.0025, 6.8026, −0.0006]` = negated decoded-geometry center,
  so the geometric center lands on `ISSGroup.position` (the orbital
  position). If you rebuild the GLB, re-measure and update these — the
  build report prints them.
- Legacy (`LEGACY_DETAILED`): truss along native X, `wingspanM: 111.988429`,
  `wingspanAxis: 'x'`, `pivotOffset: [−0.0000024, −5.3411984, 3.8544638]`
  (native size 111.988429 × 68.784158 × 58.626683 m). Pre-rotation basis
  +X→−Y, +Y→−Z, +Z→+X, i.e. quaternion XYZW [−0.5, +0.5, −0.5, +0.5]
  (forward = native +Z, nadir = native −Y; the earlier Rx(−90°) flew it
  sideways).
- Model A: scale `109 / 25.614240` (truss span = X extent, measured in the GLB
  scene-root frame, i.e. including its authored +90°X node rotation and
  0.6781210899 scale), pivot offsets `(−0.0011162, −1.4887661, +3.8792463)`.
  Pre-rotation basis +X→+Y, +Y→+Z, +Z→+X.
- Pre-rotation `MODEL_PRE_ROTATION.high` (and `.locate`) = `[−π/2, 0, 0]` maps
  model Z (truss) → body +Y (−orbit normal) and model Y → body −Z (zenith).
  Station frame: +X = V-bar, +Y = −orbit normal, +Z = nadir; LVLH/TEA (−8°
  yaw, `lvlhAttitude`) applied by ISSGroup on top. ISSGroup follows that
  target exactly (`AttitudeFollower`): only jumps — the first capture, a seek,
  a TLE swap — ease in, at 1.6/s. A plain slerp toward the target trailed it
  by rate ÷ stiffness, ~12° of pitch at 300×. The velocity behind V-bar is
  blended on the position's schedule (`OrbitalRenderInterpolator.
  sampleVelocity`), so the target turns every frame instead of stepping at
  the 10 Hz telemetry rate.
- Sun direction for animation comes from
  `sunDirectionWorld(simulationClock.now().julianDate)` in world frame.
- Lighting: ISSModel feeds `sunVisibility` (continuous, with a ≈63 km penumbra
  at ISS altitude) through `eclipseLighting()` (`eclipseLighting.ts`) to the
  key-light exposure, ambient and earthshine intensities; the shade-0 and
  shade-1 endpoints equal the old binary sunlit and eclipse values.
- Environment: `SceneRoot`'s `RuntimeEnvironment` (a PMREM'd
  `RoomEnvironment` at intensity 0.28) is the image-based light for every
  glTF PBR material. An Earth-below / space-above environment aimed at nadir
  was built and measured (2026-10-25) and NOT adopted: physically motivated,
  but with black space above, every surface not facing Earth lost its fill —
  daylight mean luminance 79 vs 106, and the array backs went black in
  eclipse — against the app's calibrated, legible look.
- Self-shadowing (`stationShadow.ts`, setting "Shadows", default on): the
  scene's one sun light (`SunLight`, EnvironmentLayer) casts it. The light
  sits `SUN_LIGHT_DISTANCE` (2000 km) up-sun from its target, and ISSModel
  aims the target at the visible station each frame, so the shadow camera is
  a ±70 km box around the station (2048² map ≈ 7 cm of hardware per texel,
  PCF, bias −0.0002 / normalBias 0.05). Only the visible model casts and
  receives. The map is cached (`shadow.autoUpdate = false`): each frame only
  re-fits the matrices to the moving station, and `ShadowRefreshScheduler`
  redraws it when the sun in the station frame or any joint angle moves
  0.15° (at most every 50 ms, at least every 2 s). At 1× that is one redraw
  every ~2 s; a redraw is one depth pass of the 217-primitive model.
  Earth's shadow on the station is NOT this map — it stays the analytic
  `sunVisibility` term above.

---

## 5. Part animation (ISSAnimations.tsx + ISSJointKinematics.ts) — architecture and the math

`ISSAnimations.tsx` only orchestrates the frame loop; all mechanism math is
pure and unit-tested in `ISSJointKinematics.ts`. The joint list is rig data:
the GLB embeds `extras.orbitalRig` (emitted from `scripts/iss-rig-manifest.mjs`
by the build), `parseRigMetadata()` validates it (absent → fall back to the
built-in `IGOAL_JOINT_DEFS`, `IGOAL_OSCILLATOR_SPECS` and `IGOAL_TRRJ_LIMITS`,
present-but-invalid → the detail fails before anything animates). The `locate`
and `high` tiers animate (they share the rig); `legacy` and Model A are
deliberately static. Only the VISIBLE detail model animates (hidden candidates
and far-range models skip the rig). It publishes each joint's applied angle
per joint id; an instance that becomes visible within 500 ms of the last
publication (`JOINT_HANDOFF_FRESH_MS` — a tier swap) continues that pose
exactly, mid-slew included (`freshHandoff`), otherwise it adopts the current
target.

The 12 driven joints (all axes and normals are in the GLB's native model frame):

| Joints | Shaft (`axisModel`) | Law |
|:--|:--|:--|
| `PORT_ALPHA_ROT`, `STBD_ALPHA_ROT` (SARJ) | native Z (the truss) | `sarjTargetAngle`: signed angle from the panel normal (+Y) to the sun's projection on the gimbal plane; one revolution per orbit |
| `PORT_TRRJ_GAMMA_ROT`, `STBD_TRRJ_GAMMA_ROT` (TRRJ) | native X (the radiator beam's own long axis) | `trrjTargetAngle`: illustrative bounded autotrack — edge-to-Sun in daylight, face-to-Earth in eclipse; ±105° software limit (hardware 115°), 0.75°/sim-s via `trrjAdvance` |
| `*_BETA_ROT_*` ×8 (BGA) | ±native X per wing (`BGA_DEFS`) | `bgaTargetAngle`: tilt about the mast toward the sun's projection (the out-of-plane beta residual), 2°/sim-s (`BGA_SLEW_DEG_PER_SIM_SECOND`) |

Real TRRJs are usually parked, so the TRRJ law is a labelled illustration, not
telemetry. The law switches on `isSunlit()` (`SunVisibility.ts`), i.e. at the
0.5 point of the penumbra — the same edge the old cylinder test used. BGA and
TRRJ slews are also capped at `MAX_WALL_DEG_PER_SECOND = 12` °/s of
wall-clock time, so a seek or an eclipse transition at 300× reads as a glide.
The SARJs are NOT capped, deliberately: they follow their sun-tracking target
exactly, which at 300× legitimately moves ~19.5 °/s (a cap would make them
lag the sun), and a time seek moves them with the station's own position.
Camera oscillators (JEM/ELP/SHP pan/tilt sine sweeps) run for the visible
detail model. Each sweep turns the part about its OWN local axis
(pre-multiplied in the parent frame) and pivots on the part itself: the ELP
and SHP pan nodes carry an authored origin 2.7 m / 4.5 m away from their 0.5 m
cameras, so when the origin lies outside the part (`oscillatorPivot`) the
sweep turns about the geometry centre — rotating about that origin had swung
those cameras ~0.3 m off their mounts. (The old sweep also wrote one Euler
component, which is not a rotation about the part's own axis.) Do not re-introduce per-wing independent rotation of the arrays
themselves: the SARJ turns the whole wing set and the BGAs only add the beta
tilt.

`resolveJoint(root, def)` runs AT MOUNT per joint, on an authored-pose scene
(the mount pipeline clones the GLTF scene per asset). No bounding-box
inference is involved; the result is invariant under the station's attitude:

1. Reject a mirrored (negative-determinant) ancestor above the joint, because
   the quaternion mapping below would silently drop the mirror.
2. `modelToParent` = inverse of (the parent's world quaternion **relative to
   the model root**) = `(rootWorld⁻¹ · parentWorld)⁻¹`. This strips the live
   LVLH attitude and the −90°X pre-rotation, which sit ABOVE the model.
3. `axis` = `axisModel` mapped by `modelToParent` (a direction, so a
   quaternion-only mapping is correct); `normalRef` = `normalModel` mapped the
   same way. Both are validated (finite, unit, orthogonal) before being
   orthogonalized — a bad reference is an error, never laundered.
4. The authored `baseQuaternion` and `basePosition` are recorded and never
   modified: the joint origin lies ON its shaft, so the position is left alone.

Per frame (scratch objects, zero allocation):

- Sun → model frame: `sunLocal = sunWorld.applyQuaternion(rootWorldQuat⁻¹)`;
  nadir likewise from the negated world position.
- Sun → joint parent frame: `sunParent = sunLocal.applyQuaternion(modelToParent)`.
  **BGAs are the exception**: their sun vector is mapped through the parent's
  LIVE world quaternion, after this frame's SARJ rotation was applied (SARJs
  come first in the joint order). A mount-time frame made the target sweep a
  full circle per orbit — that was the reverted 2026-09-28 bug.
- Project onto the gimbal plane: `sunProj = sunParent − axis·(sunParent·axis)`.
  **Deadband**: if `|sunProj| < GIMBAL_SINGULARITY_EPSILON` (0.02) hold the
  previous angle.
- Signed angle `atan2(cross(normalRef, sunProj)·axis, normalRef·sunProj)`,
  then the per-joint law above (SARJ shortest-path unwrap wrapped to
  [−π, π); TRRJ branch choice within the travel limit; BGA branch nearest zero).
- **Apply PRE-multiplied** (`applyJointAngle`):
  `node.quaternion = Δq · baseQuaternion` (three.js `.premultiply`).
  Post-multiplying (`base · Δq`) rotates about a node-LOCAL axis, which the
  TRRJs' ±90° authored bases turn into a perpendicular — radiators windmill
  through the truss. This exact bug shipped once (finding 6's ERRATUM in
  MODEL_AUDIT.md).

If you change ANY of this: re-verify per §7.5 — the failure modes are
silent in code and obvious only in render.

---

## 6. Tooling traps (each of these produced a wrong conclusion once)

1. **glTF-Transform v4 `Accessor.getScalar(index, component = 0)`** takes an
   ELEMENT index + component. `getScalar(i*3 + c)` does NOT read a flat
   scalar array — it reads the X component of every third vertex. Every
   bound derived that way is garbage (symmetric "cube" extents, false
   centers, false "stale accessor" divergences). Read vertices via
   `attr.getArray()` (fast path, `arr.length === count*3`) or
   `attr.getElement(i, v)`. The fixed code is in
   `iss-model-manifest.mjs positionBounds()` and
   `build-iss-model.mjs report()` — copy those patterns.
2. **AABB under rotation**: transforming only the min/max corners of a box
   is wrong (axes mix, can even invert → negative sizes). Always transform
   ALL 8 corners. (Pattern in both fixed tools.)
3. **Frames of reference**: the GLB has `SSREF_IGOAL` (−90°X, ×100) between
   the scene root and everything else, the APP adds a −90°X pre-rotation and
   the live LVLH attitude above that, and subtrees carry mixed scales.
   Directions may use quaternion-only mapping; POINTS/offsets need full
   matrices. Strip attitude+pre-rotation by working relative to the model
   root (`rootWorld⁻¹ · parentWorld`), never with raw world quaternions.
4. **Pre- vs post-multiply** (§5): post = node-local axis (wrong here);
   pre = parent-frame axis (correct). And a node's rotation always pivots
   on the node's own origin — which is fine for every driven joint, because
   each origin lies on its shaft (§2.3); a joint whose origin were off the
   shaft would need an explicit position compensation.
5. **`weld()` output**: primitives are indexed; but never assume — the old
   build script had a latent `ReferenceError: position` on the
   non-indexed fallback path (fixed; keep the fallback correct).
6. **Simulation time**: `SimulationClock` in `REALTIME` mode pins to wall
   time and IGNORES `timeScale`. To accelerate:
   `window.__orbitalSimulation.getState().setMode('ACCELERATED');
   setTimeScale(n)`. Restore `setMode('REALTIME'); setTimeScale(1)` after.
   Hooks exposed in dev and bench builds (`src/utils/debugHooks.ts`):
   `__orbitalSimulation`, `__orbitalClock`, `__orbitalTelemetry`,
   `__orbitalStores` (camera, loading, settings, telemetry) from `main.tsx`;
   `__orbitalControls`, `__orbitalScene`, `__orbitalRenderer` from `SceneRoot`.
7. **Texture format**: the runtime assets' textures are KTX2 (Basis ETC1S);
   neither sharp nor the Read tool decodes them — extract with
   `ktx extract --transcode rgba8 --level 0 in.ktx2 out.png`, or inspect the
   PNG textures of `.tmp-iss-build/iss_igoal_master.glb`. One BMP flavor is
   hand-decoded in the build script (sharp lacks a BMP loader). The source
   GLB's images are mostly JPEG; the FBX embeds lossless PNGs.

---

## 7. Verification protocol (do this before claiming anything)

1. **Static**: `npm run verify` = asset budget + shader ramps + tsc + lint +
   the unit suite + production build. All green is the baseline.
2. **Measure**: `node scripts/iss-model-manifest.mjs public/models/iss_igoal.glb .tmp-iss-build/audit-out`
   → check `summary.worldBounds` ≈ §2 numbers, empty `rigErrors`, and a
   `declaredBoundsComparison.maxDelta` of quantization size (≈ 4.2e-4 m). Add
   `--check-only` (and drop the out-dir) for just the checks. The manifest
   reads vertices correctly; if your numbers differ from §2, suspect your own
   read pattern first (§6.1).
3. **Standalone render**: `npm run dev` (read the ACTUAL port from the log —
   5173/5174 are often taken; the app also hot-reloads on edit). Open
   `http://localhost:<port>/scripts/iss-model-inspector.html` — it logs
   three.js `Box3` sizes for key nodes (must match §2.2/§2.3) and has view
   buttons + `window.__isolate('P1_Radiator')` / `__restore()` for
   single-subtree inspection (on the batched runtime asset a subtree is a
   rigid part — e.g. `PORT_TRRJ_GAMMA_ROT` holds the whole port radiator;
   load the master for per-part isolation).
4. **In-app**: open `/`, click the `#btn-locate-iss` button (Playwright
   locator clicks time out on this app — use coordinate clicks, see
   HANDOFF "Debugging playbook"). The network panel must show the Locate tier
   `/models/iss_igoal_locate.glb?v=…` first (the full `/models/iss_igoal.glb`
   is requested only inside the 200/220 km Inspect band), and the console
   shows `[ISS AUDIT] { quality: 'locate', url: '/models/iss_igoal_locate.glb?v=…', attempt }`
   (then `quality: 'high'` at Inspect).
5. **Animation acceptance.** First the automated part:
   `tests/unit/rendering/ISSRigSimulation.test.ts` builds the published
   assets' node trees from their JSON, flies them through two orbits at three
   seasons in the true LVLH/TEA attitude with the app's own `RigAnimator`, and
   asserts: every wing's cell face within 3° of the sun through daylight; each
   radiator edge-on (within 2°) in daylight and facing Earth (within 15°) in
   eclipse; every camera's centre within 10% of its size of its rest place on
   its mount. Then by eye (accelerate time per §6.6 to ~120×):
   - Radiators: each beam rolls about its OWN long axis (native X, ⊥ the
     truss) and stays COAXIAL with its fixed bearing — on-axis landmarks do
     not move, the roll axis is parallel to the beam — never exceeding ±105°,
     never crossing the modules or floating. Check from a side view (truss
     broadside) and an end view.
   - Arrays: stay seated on the outboard truss (no bending/detachment),
     blanket planes track the sun (bright faces toward the sun near
     terminator crossings); the BGAs add only a small, slow beta tilt, with
     no per-frame snap at seeks or eclipse transitions.
   - No NaN/console errors; attitude stays LVLH (truss ⟂ velocity).
6. **Visual ground truth for "correct ISS look"**: real ISS photos — P1/S1
   EATCS radiators are white zigzag panel assemblies mounted at
   the inboard truss, extending perpendicular to the beam; original SAWs are
   dark bronze-gold blankets ~35 m long with the narrower iROSA overlay in
   front of six of them; 2A and 3B are bare.

---

## 8. Standing rules (violating these regressed the project before)

- Do NOT change the 1,000× render scale or the 109 km wingspan.
- Do NOT recolor the shared `Truss` material (197 primitives use it). The
  radiator coating is its own material, assigned at build time by
  `splitRadiatorPanels()`; do not add a runtime material override.
- Do NOT add a 7th iROSA (3B) or one on 2A — six is the correct
  configuration.
- Do NOT re-parent array/radiator nodes onto synthetic pivots — that was
  the original "bent arrays" bug; animate the authored joint nodes.
- Do NOT dispose geometries/materials of `useGLTF`-cached scenes (drei owns
  their lifecycle); replacing a material REFERENCE on a cloned scene mesh is
  safe, but no current code does it for the radiators.
- Do NOT animate the legacy model or Model A (deliberately static).
- Do NOT trust a measurement that disagrees with §2 until you have ruled out
  §6 (read pattern, corner count, frame of reference, pre/post-multiply).

## 8a. Module explorer (plan 017 X1)

The explorer reads the batching contract, not extra metadata:
`src/rendering/iss/moduleExplorer.ts` maps each batch to a catalogue entry
(`src/data/issModules.ts`) by its name prefix or nearest catalogued
ancestor, using `userData.name` (GLTFLoader drops the dots from `name`).
Exploding writes translations on the hub (`SSREF_IGOAL`) children only —
static batches and the nodes that hold rig parts (the SARJs, `Truss_P1/S1`
with the TRRJs, `JEM_PM`, `MT_Location`, `Node2`, `USLab`) — so joint
frames and pivots are unchanged. While exploded the rig parks every joint
on its authored angle (`RigFrame.parked`). If a rebuild renames a module or
changes the batching, `ModuleExplorer.test.ts` fails on the unmapped batch.

## 9. Open items (ranked)

1. **TRRJ law** (re-reviewed 2026-10-25, kept): `trrjTargetAngle` runs
   edge-to-Sun in daylight and face-to-Earth in eclipse. The daylight half
   is the published autotrack mode (the TRRJ "keeps the radiators edge-on to
   the Sun" — Boeing P1 truss release, 2002; Lockheed Martin, 2007). The
   eclipse half is the cold-side choice: the control trades heat rejection
   against ammonia freeze (NASA ICES radiator paper; SAE 981732), and facing
   warm Earth is the protective pose. In operations the joints are often
   parked at fixed angles instead, which needs flight data the app does not
   have; if it ever does, change only the angle law — the plumbing (axis,
   frames, ±105° limits, slew) exists.
2. **Radiator texture** (re-reviewed 2026-10-25, no change): the geometry
   already models each wing's 8 panels with ~5 cm hinge gaps at ~2.65 m
   pitch (measured on the master), and the real Z-93 face sheets are
   uniform white, so the flat `Radiator_Panel_Coating` is faithful. The
   sources carry no radiator art; the only missing detail is the flow-tube
   lines, under a pixel at every camera distance but Inspect.
3. **ERA / Canadarm2 poses** (re-reviewed 2026-10-25, no change): ERA is
   merged into the MLM meshes (no node to drive); Canadarm2 has a named
   joint chain under `MT_Location`, but its real pose varies with each
   operation and is usually a long-held park, so an invented sweep would
   be less accurate than the authored park pose. (The BGAs are driven, §5.)
4. **Geometry memory** (re-reviewed 2026-10-25, still not adopted; download
   would regress): Draco decodes to
   float32 — 214 MB of vertex/index data for the full model. `EXT_meshopt_
   compression` + `KHR_mesh_quantization` (positions 14-bit, normals 8–10-bit,
   UVs 12-bit) measured 113 MB on the GPU and a 1.1–1.2 s parse vs Draco's
   1.7–3.7 s (headless Chromium, 4 cores), but ≈ +9 MB over the wire (25.5 vs
   16.8 MB brotli at the time) and a 50+ MB raw GLB in git, because meshopt
   relies on transport compression. Quantization rewrites mesh-node
   transforms: rig nodes that carry a mesh must first move it onto an
   identity child (rotating a joint whose origin moved breaks its pivot).
5. **Draw calls**: LANDED 2026-10-25 (plan 001 Phase D, §1.1 step 6):
   993 → 217 primitives (full), 438 → 176 (LOD). Identical-view renders
   before/after differ only by sub-pixel edge shifts (mean 0.25–0.54 / 255):
   merged primitives quantize on a coarser Draco grid (≤ ~2.4 mm on the 40 m
   truss segments), far below a pixel at the closest Inspect distance.
6. **Blanket box detail** (cosmetic): the two bare wings (2A, 3B) show the
   blanket-box end hardware more prominently than the iROSA-covered wings;
   correct per asset, listed only so it isn't mistaken for a bug.
7. **Self-shadowing**: LANDED 2026-10-25 (§4): the arrays shade the truss
   and the modules shade each other; a cached map refreshed on sun or joint
   motion, toggle in settings.
