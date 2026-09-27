# ISS Model — Full Context Briefing for Audit/Repair Agents

> ## ⚠ ERRATA (2026-09-27, plan 001 implementation) — read before trusting §2–§7
>
> Plan 001 (`plans/001-iss-model-audit-and-repair.md`) implemented and
> re-measured the items below. The affected sections above/below are kept as
> history; where they contradict this list, this list wins.
>
> 1. **TRRJ shaft is native model X, not Z (§2.3, §5 are wrong).** The
>    radiator rolls about its OWN beam long axis (native X, perpendicular to
>    the main truss). Only the SARJs rotate about the truss axis (native Z).
> 2. **The "mid-assembly origin quirk" and its hinge compensation are WRONG
>    (§2.3 CRITICAL QUIRK, §5 step 4).** A rotation axis is a line: the
>    authored TRRJ origin at x ≈ −6.775 lies ON the shaft and is a valid
>    pivot. There is NO end-edge hinge and NO per-frame position
>    compensation in the current code; `resolveJoint`/`hingeParent` as
>    described in §5 no longer exist.
> 3. **Bounding-box normal/axis inference is gone (§5 steps 1–3).** Axes and
>    panel references are rig data: `scripts/iss-rig-manifest.mjs`, emitted
>    into the GLB as `extras.orbitalRig`, validated at load by
>    `src/rendering/iss/ISSJointKinematics.ts` (`parseRigMetadata`). Whole-
>    subtree AABB inversion was mount-attitude-dependent (plan M2) and is
>    deleted. TRRJs are bounded to ±105° at 0.75°/sim-second with a
>    clearly-labeled illustrative autotrack law — NOT the old ±0.7 rad
>    sun-pointing offsets, and not flight telemetry.
> 4. **Radiator materials (§2.3, §7.6).** The panel faces live in the long
>    `Truss` primitive (primitive 0, `MLI.Generic`, is the short base beam).
>    The build now splits ±Y-facing panel triangles onto a dedicated white
>    `Radiator_Panel_Coating`; the runtime silver override
>    (`RADIATOR_SILVER_MATERIAL`) is REMOVED — do not re-add it.
> 5. **"Declared accessors match decoded exactly" (§2) was overstated.** The
>    old check compared decoded-vs-decoded. The independent JSON-chunk
>    comparison (`checkDeclaredBounds`) reports quantization-level deltas
>    (max ≈ 4.2e-4 m on the shipped asset) — expected under Draco, not a
>    defect.
> 6. **Acceptance §7.5 "hinged at their END EDGE … sweep about the truss
>    axis" is wrong.** Correct acceptance: the beam stays COAXIAL with its
>    fixed bearing (on-axis landmarks immobile, roll axis ∥ beam), never
>    exceeding ±105°.
> 7. **Rebuild pipeline (§1.1).** `build-iss-model.mjs` now writes a
>    validated CANDIDATE (`.tmp-iss-build/iss_igoal_candidate.glb`) and only
>    publishes to `public/models/iss_igoal.glb` after rig/format/budget
>    validation; the asset declares `EXT_texture_webp` and preserves the six
>    attachment frames (703 nodes). `--check-only` manifest mode validates
>    without writing.
> 8. **Legacy/Model A normalization (§4) changed (plan O1).** Legacy: truss
>    along native X (span 111.988429 m), pre-rotation quaternion XYZW
>    [−0.5, +0.5, −0.5, +0.5] (it previously flew sideways). Model A: scale
>    109/25.614240, pivot −(0.0011162, 1.4887661, −3.8792463).

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
`public/models/iss_igoal.glb` — 20.5 MB, Draco-compressed, built from a
172 MB FBX ("International Space Station (ISS) (D) (IGOAL)").

**FBX SOURCE — local disk, NOT in the repo**:
`C:\Users\Arnav\Downloads\ISSTEST\` — rebuild recipe in §1.1 below. If the
folder has moved, ask the user rather than guessing.

| File in that folder | What it is |
|:--|:--|
| `International Space Station (ISS) (D) (IGOAL).fbx` (172 MB) | **THE source of record** — the only file `build-iss-model.mjs` accepts |
| `International Space Station (ISS) (D) (IGOAL).glb` (65 MB) | Sketchfab-style export of the same art — **DECOY: single merged mesh, no part hierarchy**; the FBX pipeline exists precisely because of this |
| `ISS_stationary.glb / .gltf + .bin / .usdz` | A different "stationary" export variant — not used |
| `International Space Station (ISS) (C) (High Res)/` | Older (C) variant — not used |
| `isscomplete.3ds`, `isstextures.zip` | Legacy format + loose textures — not used |

The uncompressed conversion intermediate `.tmp-iss-build/igoal_raw.glb`
(291 MB, output of FBX2glTF before optimization) is also on disk, so the
optimization stage can be studied without re-converting.

### 1.1 Full rebuild recipe (from the FBX)

```bash
node scripts/build-iss-model.mjs "C:\Users\Arnav\Downloads\ISSTEST\International Space Station (ISS) (D) (IGOAL).fbx"
```

What it does (all steps are in `scripts/build-iss-model.mjs`):
1. FBX2glTF (`--binary --pbr-metallic-roughness`; **never add
   `--no-flip-v`** — the V-flip is required for the FBX UVs) →
   `.tmp-iss-build/igoal_raw.glb` (~1 min).
2. Fixes ~13 falsely-transparent materials to OPAQUE, repairs a BMP whose
   mimeType FBX2glTF mangles, then dedupe/prune/weld + WebP re-encode
   (≤2048 px) via sharp.
3. Selective decimation: only nodes matching `/details/i` are simplified
   (ratio 0.5) — arrays, trusses, radiators, modules stay full-res.
4. Draco (14-bit positions, 10-bit normals — raised from default 8 to avoid
   visible banding, 12-bit UVs).
5. Validation: REQUIRED_NODES (8 arrays, P1/S1_Radiator, 2 camera pan
   nodes) must all exist; prints the world-bounds report and writes
   `.tmp-iss-build/bounds-report.json`. Output overwrites
   `public/models/iss_igoal.glb` (budget gate 35 MiB; current build
   ≈ 19.6 MiB / 20.5 MB).

**After any rebuild**: re-read the fresh bounds report and update
`IGOAL_DETAILED` (`wingspanM`, `pivotOffset`) in `src/rendering/iss/ISSModel.tsx`,
then re-run the whole verification protocol in §7 (the animation resolves
its axes/hinges at mount from the live model, so nothing else is hardcoded —
but that also means a silently changed hierarchy would only show at runtime).

**Other assets** (do not confuse with the above):
- `public/models/international_space_station.glb` — "legacy" detailed model,
  selectable fallback, DELIBERATELY static (no animation).
- `public/models/International Space Station (ISS) (A).glb` — "Model A",
  37 KB always-mounted far-range schematic, single merged mesh.

**Selection**: `src/stores/settingsStore.ts` (`issModelQuality: 'high' |
'legacy'`, default `'high'`, persisted). `'high'` → `iss_igoal.glb`. On load
failure a ladder demotes high → legacy → Model A. At runtime the mounted
asset is logged: `[ISS AUDIT] { quality, url }` (console).

**Key files**:

| Path | Role |
|:--|:--|
| `src/rendering/iss/ISSModel.tsx` | LOD selection, normalization constants, GPU prep, radiator material override, `[ISS AUDIT]` log |
| `src/rendering/iss/ISSAnimations.tsx` | SARJ/TRRJ joint animation + camera oscillators (all part motion) |
| `src/rendering/iss/ISSGroup.tsx` | LVLH/TEA flight attitude + inertial position (do not touch for model work) |
| `scripts/build-iss-model.mjs` | FBX → optimized runtime GLB (needs the FBX argument) |
| `scripts/iss-model-manifest.mjs` | Forensic per-node manifest of a GLB (REPAIRED — see §6.1) |
| `scripts/iss-model-inspector.html` | Browser harness: loads the GLB standalone, logs Box3 measurements, `window.__setView` / `__cam` / `__isolate` / `__restore` hooks |
| `.tmp-iss-build/audit-igoal-fixed/` | Current manifest + tree + exported textures for the shipped GLB |

---

## 2. Verified asset facts (IGOAL, native GLB frame: meters, +Y up, truss along Z)

Whole model (decoded vertices, exact):
- Bounds min `(−36.7163, −22.1156, −54.1457)`, max `(36.7112, 8.5104, 54.1469)`
- Size **73.4275 × 30.6260 × 108.2926 m**, center **(−0.0025, −6.8026, 0.0006)**
- 697 nodes (all named), 656 meshes, 41 materials, 73 textures,
  2,665,397 triangles, 6,001,089 vertices
- Declared POSITION accessor min/max match decoded vertices exactly —
  there are NO stale accessors in this artifact.

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
  **Z**, blanket normal along **±Y**.
- NASA reference: iROSA ≈ 18.2 × 6 m → each `IROSA_Deployed_*` measures
  **21.31 × 5.43 × 6.08** (subtree includes end hardware) — correct.
- Exactly six iROSAs installed (4A, 2B, 4B, 1A, 3A, 1B) = the real 2023–2026
  configuration. **Do NOT add an iROSA to 2A or 3B.**

### 2.3 Radiators (EATCS / HRS)

- `P1_Radiator` and `S1_Radiator`: **23.17 × ~4.5 × 11.57 m** each,
  symmetric, spanning model x ∈ [−23.27, −0.1] (extending fore along −X),
  at z = ∓14.68. Present, complete, correct size (real ≈ 23.3 m).
- **CRITICAL QUIRK**: the authored TRRJ node origins sit at
  `(−6.78, 0, ∓14.68)` — **6.7 m INSIDE the 23 m radiator span**, i.e.
  mid-assembly, NOT at the attachment edge. The SARJ origins, by contrast,
  sit exactly on the beamline. Any naive rotation of the TRRJ node pivots
  the radiator on its middle → one end swings through the truss, the other
  appears to float. This bit us once (§3.4); the running code compensates
  for it (§5.3). If you re-implement the animation, you MUST compensate the
  pivot the same way or reproduce this bug.
- Materials: panel faces (prim 0) = `MLI.Generic` — flat 0.8 gray,
  metalness 0.4, **no base-color texture**, MLI normal map; frames/scissors
  (prim 1) = shared `Truss` material (atlas `Truss_Diffuse.png` contains
  dark photovoltaic bands on its left edge); small details = `ELC_Base` /
  `MLI.Generic` / `Truss`. Under directional sun the pleated panels
  self-shade to near-black — wrong look. **Applied fix**: at mount,
  `applyRadiatorMaterialCorrection()` (ISSModel.tsx) assigns a dedicated
  light-silver `MeshStandardMaterial` (#d9dee4, metal 0.45, rough 0.4) to
  every mesh under P1_Radiator/S1_Radiator. Verified visually.

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

An external audit (reusing this repo's manifest tool) produced dramatic
findings. Verdicts after proper measurement:

| External claim | Verdict |
|:--|:--|
| "Solar arrays undersized (1.8–11.4 m vs 35 m)" | **FALSE** — artifact of the getScalar bug (§6.1). All 8 wings are 35.35 m. |
| "iROSAs undersized (~7 m vs 18.2 m)" | **FALSE** — same bug; real 21.31 × 5.43–6.08. |
| "Bounds stale: real 58.51 × 45.00 × 105.62, center (−7.83, −8.09, −1.34)" | **FALSE** — same bug. Real 73.4275 × 30.6260 × 108.2926, center (−0.0025, −6.8026, 0.0006); declared accessors match decoded exactly. |
| "Normalization constants wrong; center km off" | **FALSE** — constants were already correct within 2.5 mm model-scale; now set to exact measured values. |
| "Screenshots probably show the legacy model, not IGOAL" | **FALSE** — default `'high'` loads IGOAL; verified at runtime (network + `[ISS AUDIT]` log + render). |
| "Four radiators missing" | **FALSE** — both TRRJ radiators present and symmetric (the "tiny extents" were measurement bugs). |
| "Radiator material wrong/suspicious" | **TRUE (appearance)** — fixed via dedicated silver material (§2.3). |
| "Animation bypasses native SARJ/BGA hierarchy" | **TRUE** — fixed (§5). |
| "Radiator sun-pointing is only an approximation" | **TRUE** — kept as approximation (real TRRJ does edge-to-Sun/face-to-Earth; P2 future work). |
| "ERA missing" | **FALSE** — present, merged into MLM detail meshes. |

Lesson that repeated twice in one session: measurement bugs produce
confident, coherent, WRONG numbers. Re-derive with the correct APIs (§6)
before believing any new "discrepancy", including your own.---

## 4. Runtime normalization (ISSModel.tsx)

- `RENDER_ISS_WINGSPAN_UNITS = 109` (render "km"). Scale = 109 / wingspanM.
- IGOAL spec: `wingspanM: 108.293` (largest axis = Z), `wingspanAxis: 'z'`,
  `pivotOffset: [0.0025, 6.8026, −0.0006]` = negated decoded-geometry center,
  so the geometric center lands on `ISSGroup.position` (the orbital
  position). If you rebuild the GLB, re-measure and update these — the
  build report (fixed) prints them.
- Pre-rotation `MODEL_PRE_ROTATION.high = [−π/2, 0, 0]` maps model Z (truss)
  → body +Y (orbit normal) and model Y → body −Z (zenith). Station frame:
  +X = V-bar, +Y = orbit normal, +Z = nadir; LVLH/TEA (−8° yaw) applied by
  ISSGroup on top.
- Sun direction for animation comes from
  `sunDirectionWorld(simulationClock.now().julianDate)` in world frame.

---

## 5. Part animation (ISSAnimations.tsx) — architecture and the math

Config-driven per quality. `high` = IGOAL_CONFIG; `legacy`/Model A =
deliberately empty.

- `sarjJoints`: `PORT_ALPHA_ROT`, `STBD_ALPHA_ROT` — sun-tracking, 1 rev/orbit.
- `radiatorJoints`: `PORT_TRRJ_GAMMA_ROT` (+0.7 rad offset),
  `STBD_TRRJ_GAMMA_ROT` (−0.7 rad) — sun-pointing approximation.
- BGA nodes (`*_BETA_ROT_*`) are intentionally NOT animated (parked, like
  real ops). Do not re-introduce per-wing independent rotation.
- Oscillators: JEM/ELP/SHP camera pan/tilt sine sweeps (unchanged, legacy code path).

Per joint, `resolveJoint()` computes AT MOUNT (all numeric, never hardcoded
axes — the mixed scales make analytic guesses wrong):

1. `parentWorldQuatInv` = inverse of (parent's world quaternion **relative
   to the model root**) = `(rootWorld⁻¹ · parentWorld)⁻¹`. This strips the
   live LVLH attitude and the −90°X pre-rotation, which sit ABOVE the model.
2. `axis` = model-space truss direction `(0,0,1)` mapped by
   `parentWorldQuatInv` (a direction; quaternion-only mapping is fine).
3. `normalRef` = the assembly's panel normal at authored pose: thinnest axis
   of the subtree's bounding box **measured in model space** (map the
   scene-space Box3's 8 corners back through `root.matrixWorld⁻¹` — two
   corners are lossy under the live attitude rotation), then mapped to the
   parent frame and orthogonalized against `axis`.
4. `hingeParent` = hinge point in parent-local coords: the point of the
   subtree box on the beamline —
   `clamp(0, box.min.x..max.x), clamp(0, box.min.y..max.y), box.center.z`
   in model space, then mapped model → scene → parent-local with FULL
   matrices (ancestor scales!). For the SARJs this lands on the rotation
   axis (no-op); for the TRRJs it lands on the radiator's attachment edge
   ~6.7 m from the node origin (the fix for the mid-assembly pivot).

Per frame (scratch objects, zero allocation):

- Sun → model frame: `sunLocal = sunWorld.applyQuaternion(rootWorldQuat⁻¹)`.
- Sun → joint parent frame: `sunParent = sunLocal.applyQuaternion(parentWorldQuatInv)`.
- Project onto gimbal plane: `sunProj = sunParent − axis·(sunParent·axis)`.
  **Deadband**: if `|sunProj| < 0.02` keep the previous angle (singularity).
- Signed angle from `normalRef` to `normalize(sunProj)` about `axis`:
  `atan2(cross(normalRef, sunProj)·axis, normalRef·sunProj) + angleOffset`.
- Shortest-path unwrap onto the running `applied` angle, then wrap
  `applied` into [−π, π).
- **Apply PRE-multiplied**: `node.quaternion = Δq · baseQuaternion`
  (three.js `.premultiply`). Post-multiplying (`base · Δq`) rotates about a
  node-LOCAL axis, which the TRRJs' ±90° authored bases turn into a
  perpendicular — radiators windmill through the truss. This exact bug
  shipped once (§3.4 erratum in MODEL_AUDIT.md).
- **Hinge compensation**: rotating the node pivots it on its own origin, so
  also set
  `node.position = Δq·basePosition + (hingeParent − Δq·hingeParent)`.
  This moves the rotation's fixed point to the attachment edge. Skip this
  and the radiators detach/mid-pivot again.

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
   ALL 8 corners. (Pattern in both fixed tools and `resolveJoint`.)
3. **Frames of reference**: the GLB has `SSREF_IGOAL` (−90°X, ×100) between
   the scene root and everything else, the APP adds a −90°X pre-rotation and
   the live LVLH attitude above that, and subtrees carry mixed scales.
   Directions may use quaternion-only mapping; POINTS/offsets need full
   matrices. Strip attitude+pre-rotation by working relative to the model
   root (`rootWorld⁻¹ · parentWorld`), never with raw world quaternions.
4. **Pre- vs post-multiply** (§5): post = node-local axis (wrong here);
   pre = parent-frame axis (correct). And a node's rotation always pivots
   on the node's own origin — relocate via the position compensation if the
   origin isn't the physical hinge.
5. **`weld()` output**: primitives are indexed; but never assume — the old
   build script had a latent `ReferenceError: position` on the
   non-indexed fallback path (fixed; keep the fallback correct).
6. **Simulation time**: `SimulationClock` in `REALTIME` mode pins to wall
   time and IGNORES `timeScale`. To accelerate:
   `window.__orbitalSimulation.getState().setMode('ACCELERATED');
   setTimeScale(n)`. Restore `setMode('REALTIME'); setTimeScale(1)` after.
   Dev hooks exposed in `main.tsx`: `__orbitalSimulation`, `__orbitalClock`,
   `__orbitalTelemetry`, `__orbitalControls`.
7. **Texture format**: embedded textures are WebP; the Read tool cannot
   preview them — convert via `sharp` first. One BMP flavor is hand-decoded
   in the build script (sharp lacks a BMP loader).

---

## 7. Verification protocol (do this before claiming anything)

1. **Static**: `npm run verify` = asset budget + shader ramps + tsc + 111
   unit tests + production build. All green is the baseline.
2. **Measure**: `node scripts/iss-model-manifest.mjs public/models/iss_igoal.glb .tmp-iss-build/audit-out`
   → check `summary.worldBounds` ≈ §2 numbers and `staleAccessorBoundsNodes: 0`.
   The manifest now reads vertices correctly; if your numbers differ from
   §2, suspect your own read pattern first (§6.1).
3. **Standalone render**: `npm run dev` (read the ACTUAL port from the log —
   5173/5174 are often taken; the app also hot-reloads on edit). Open
   `http://localhost:<port>/scripts/iss-model-inspector.html` — it logs
   three.js `Box3` sizes for key nodes (must match §2.2/§2.3) and has view
   buttons + `window.__isolate('P1_Radiator')` / `__restore()` for
   single-subtree inspection.
4. **In-app**: open `/`, click the `#btn-locate-iss` button (Playwright
   locator clicks time out on this app — use coordinate clicks, see
   HANDOFF "Debugging playbook"). Confirm the network fetch is
   `/models/iss_igoal.glb` (`performance.getEntriesByType('resource')`) and
   the console shows `[ISS AUDIT] { quality: 'high', url: '/models/iss_igoal.glb' }`.
5. **Animation acceptance** (accelerate time per §6.6 to ~120×):
   - Radiators: hinged at their END EDGE on the truss at P1/S1 at ALL orbit
     phases; sweep about the truss axis; never cross the modules or float.
     Check from a side view (truss broadside) and an end view.
   - Arrays: stay seated on the outboard truss (no bending/detachment),
     blanket planes track the sun (bright faces toward the sun near
     terminator crossings).
   - No NaN/console errors; attitude stays LVLH (truss ⟂ velocity).
6. **Visual ground truth for "correct ISS look"**: real ISS photos — P1/S1
   EATCS radiators are white/light-silver zigzag panel assemblies mounted at
   the inboard truss, extending perpendicular to the beam; original SAWs are
   dark bronze-gold blankets ~35 m long with the narrower iROSA overlay in
   front of six of them; 2A and 3B are bare.

---

## 8. Standing rules (violating these regressed the project before)

- Do NOT change the 1,000× render scale or the 109 km wingspan.
- Do NOT recolor the shared `Truss` material (197 primitives use it) —
  override materials only on the radiator subtrees.
- Do NOT add a 7th iROSA (3B) or one on 2A — six is the correct
  configuration.
- Do NOT re-parent array/radiator nodes onto synthetic pivots — that was
  the original "bent arrays" bug; animate the authored joint nodes.
- Do NOT dispose geometries/materials of `useGLTF`-cached scenes (drei owns
  their lifecycle); replacing a material REFERENCE on a cloned scene mesh is
  safe and is how the radiator override works.
- Do NOT animate the legacy model or Model A (deliberately static).
- Do NOT trust a measurement that disagrees with §2 until you have ruled out
  §6 (read pattern, corner count, frame of reference, pre/post-multiply).

## 9. Open items (ranked)

1. **TRRJ thermal profile** (P2): replace sun-pointing+0.7 rad with the real
   edge-to-Sun (daylight) / face-to-Earth (eclipse) behavior. The joint
   plumbing (axis, hinge, frames) already exists — only the angle law
   changes, in `ISSAnimations.tsx` (`radiatorJoints` handling).
2. **Radiator texture fidelity** (optional): current silver override is
   untextured. A faithful upgrade would re-UV the panel faces to white
   radiator texels or bake a dedicated radiator texture at build time —
   build-time UV surgery in `build-iss-model.mjs`, NOT runtime.
3. **BGAs / ERA / Canadarm2 poses** (optional): geometry exists; ERA is
   merged into MLM meshes (no node), Canadarm2 has a named joint chain under
   `MT_Location` if a pose sweep is ever wanted.
4. **Blanket box detail** (cosmetic): the two bare wings (2A, 3B) show the
   blanket-box end hardware more prominently than the iROSA-covered wings;
   correct per asset, listed only so it isn't mistaken for a bug.
