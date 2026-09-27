# ISS IGOAL Model — Forensic Audit Report

Date: 2026-09-27 · Scope: `public/models/iss_igoal.glb`, the build pipeline
(`scripts/build-iss-model.mjs`, `scripts/iss-model-manifest.mjs`), and the
runtime (`ISSModel.tsx`, `ISSAnimations.tsx`).

> ## ⚠ ERRATA (2026-09-27, plan 001 implementation)
>
> Finding 8's mechanism explanations and the material fix below are
> superseded by plan 001 (`plans/001-iss-model-audit-and-repair.md`, M1–M4):
> (a) the TRRJ shaft is the radiator beam's OWN long axis (native X) — the
> radiators never "slew about the truss axis" by design; (b) the ~6.7 m
> mid-assembly origin is a valid pivot on that shaft — the end-edge hinge
> compensation described here was removed, not kept; (c) the big panel faces
> are inside the `Truss` primitive (primitive 0 `MLI.Generic` is the base
> beam), and the runtime light-silver override has been REPLACED by a
> build-time white `Radiator_Panel_Coating` split plus removed override;
> (d) the thermal law is now a bounded illustrative autotrack (±105°,
> 0.75°/sim-s), not ±0.7 rad sun-pointing. Full detail:
> `docs/ISS_MODEL_CONTEXT.md` errata block and `plans/PROGRESS.md`.

> Agent briefing: `docs/ISS_MODEL_CONTEXT.md` is the authoritative,
> self-contained context document for any future model audit/repair session
> (verified numbers, animation math, tooling traps, verification protocol).
> Read it first; this report is the audit trail behind it.

Method: decoded-vertex measurement of every POSITION accessor (raw
`Float32Array` reads + exact 8-corner world-matrix transforms), material and
hierarchy inspection via `@gltf-transform`, and in-browser rendering of the
shipped GLB (`scripts/iss-model-inspector.html`) with three.js's own Draco
decoder. three.js `Box3` results in the browser match the Node-side
measurements to 0.01 m on every checked node.

## Root cause behind the external audit's headline findings

`scripts/iss-model-manifest.mjs` `positionBounds()` read vertices with
`attr.getScalar(i * 3 + c)`. In `@gltf-transform/core` v4, `getScalar(index,
component = 0)` takes an **element index + component** — so this read the **X
component of every third vertex and treated it as the x/y/z triplet**. Every
"decoded geometry" number the tool reported was garbage: symmetric
cube-shaped extents, a whole-model "58.51 × 45.00 × 105.62 m" with a false
center of (−7.83, −8.09, −1.34), and "652/697 nodes with stale accessor
bounds" (the comparison itself was broken). The external audit reused this
tool, which produced the undersized-array and bad-bounds findings. The tool
is fixed in this pass; re-running it now reproduces the build report exactly.

## Findings and classifications

1. ACTIVE ASSET — **CORRECT** (external suspicion A refuted).
   `settingsStore` defaults `issModelQuality: 'high'` →
   `MODEL_SPECS.high.url = '/models/iss_igoal.glb'`; the demote-to-legacy
   ladder only fires on a load error. The GLB renders complete (verified in
   browser). Screenshots of "long, fully deployed arrays" are consistent
   with IGOAL itself — the arrays are genuinely full-size (see finding 3).

2. STALE BOUNDS / NORMALIZATION — **CORRECT** (external finding refuted).
   Declared POSITION accessor min/max match the decoded vertices exactly on
   this artifact (zero stale accessors; the "652 stale" count was the read
   bug). Decoded whole-model bounds:
   `73.4275 × 30.6260 × 108.2926 m`, center `(−0.0025, −6.8026, 0.0006)` —
   identical to the build report's `73.43 × 30.63 × 108.29`.
   The previous runtime constants (`wingspanM: 108.29`,
   `pivotOffset: [0.005, 6.805, 0]`) were therefore already correct to
   within 2.5 mm (model) ≈ 2.5 km at render scale — 2.3 % of the 54 km
   half-span, invisible at any camera framing. They are now set to the
   exactly measured values (`108.293`, `[0.0025, 6.8026, -0.0006]`), a
   sub-perceptual tightening, so future rebuilds have a bit-exact target.

3. SOLAR ARRAY GEOMETRY — **CORRECT** (external finding refuted).
   All eight original SAW subtree extents measure **35.35 m** along their
   length (NASA: ~35.1 m) × ~11.4 m width (NASA: ~11.7 m):
   `P4_Array_2A` 37.43 m (incl. deployment hardware, no iROSA), `P4_Array_4A`
   `P6_2B_Array` `P6_4B_Array` `S4_Array_1A` `S4_Array_3A` `S6_1B_Array`
   `S6_3B_Array` all 35.35 m. The two iROSA-less wings (2A, 3B) correctly
   lack `IROSA_Deployed_*` children. Verified visually: deployed blankets
   render full-length with the iROSA blanket overlaid on the original wing
   (P4 4A close-up).

4. iROSA GEOMETRY — **CORRECT** (external finding refuted).
   Six `IROSA_Deployed_*` nodes (P44A, P62B, P64B, S41A, S43A, S61B), each
   measuring **21.31 × 5.43–6.08 m** (NASA: ~18.2 × 6 m blanket; the model's
   subtree includes end hardware). Exactly six installed — matching the
   real 2023–2026 configuration. **Leave as-is; do not add 2A or 3B.**

5. BOUNDS GENERATOR ROBUSTNESS — **CONFIRMED RUNTIME ERROR (tooling), fixed**.
   The build report happened to be right, but `report()` derives bounds from
   declared accessor min/max, which is fragile after future weld/simplify/
   draco changes, and `iss-model-manifest.mjs`'s read was outright wrong.
   Both now measure decoded vertices (raw array reads). Also fixed a latent
   `ReferenceError: position` in the build decimation loop (would crash on
   any non-indexed Details primitive).

6. SOLAR-ARRAY ANIMATION BYPASSES NATIVE JOINTS — **CONFIRMED RUNTIME ERROR,
   fixed**. The GLB carries the real mechanism hierarchy:
   `PORT_ALPHA_ROT`/`STBD_ALPHA_ROT` (SARJ, each parenting Truss_P4/P5/P6 and
   Truss_S4/S5/S6, located at z = ∓17.78 m) and `PORT_BETA_ROT_2A/4A/2B/4B`,
   `STBD_BETA_ROT_1A/3A/1B/3B` (BGA per wing). The old `ISSAnimations`
   re-parented all eight array nodes onto synthetic root-level pivots on an
   averaged truss line — the probable cause of the "bent inner arrays"
   artifacts. Rewritten to rotate the authored joint nodes directly (SARJ
   tracks the sun one revolution per orbit; BGAs stay parked at their
   authored pose, matching normal on-orbit ops). Axis convention is resolved
   numerically from each node's parent world quaternion — necessary because
   the asset mixes unit scales (100, 0.0254, 63.33, …) and rotations per
   subtree.

   ERRATUM (same session, caught in visual review): the first version of the
   joint rotation had two defects that misplace the EATCS radiators —
   (a) the delta was composed POST-multiplied (node-local frame), which the
   TRRJs' ±90° authored base rotations turn into a perpendicular axis, and
   (b) the authored TRRJ node origins sit ~6.7 m INSIDE the 23 m radiator
   span (mid-assembly), not at the attachment edge, so any rotation pivots
   the radiator on its middle and one side appears to float. Fixed by
   composing the delta PRE-multiplied (parent frame, `delta ∘ base`) and
   compensating the node translation each frame so the rotation's fixed
   point is the assembly's end edge on the truss beamline
   (`pos = Δq·t + (P − Δq·P)`, with P measured from the subtree bounds).
   For the SARJs, whose origins already sit on the beamline, both
   corrections are no-ops. Verified across >10 simulated orbits at 120×
   time scale: radiators stay hinged at P1/S1 and slew about the truss axis.

7. RADIATOR GEOMETRY — **CORRECT** (external finding refuted).
   `P1_Radiator` and `S1_Radiator` are present and symmetric:
   **23.17 × 4.5 × 11.57 m** each on `PORT_TRRJ_GAMMA_ROT` /
   `STBD_TRRJ_GAMMA_ROT`. Isolated renders show the characteristic deployed
   zigzag panel configuration. (The earlier "0.0–1.2 m" radiator extents
   were the read bug plus a two-corner AABB transform error.)

8. RADIATOR MATERIAL — **CONFIRMED SOURCE APPEARANCE DEFECT, fixed at
   runtime**. The big radiator panel faces use `MLI.Generic` (flat 0.8 gray,
   metalness 0.4, no base-color texture); only the small frames/scissor
   hardware use the shared `Truss` atlas (which does contain dark
   photovoltaic regions on its left band — confirmed by exporting
   `Truss_Diffuse.png`). Under directional sun + pleat self-shading the
   panels read near-black/brown. Fix: dedicated light-silver
   `MeshStandardMaterial` applied **only** to the `P1_Radiator` /
   `S1_Radiator` subtrees at mount. The shared `Truss` material is untouched
   (197 primitives across modules/airlocks/robotics depend on it).

9. RADIATOR ANIMATION — **PROBABLE ERROR (kept as approximation)**. Real TRRJ
   ops orient edge-to-Sun in daylight and face-to-Earth in eclipse; the app
   uses sun-pointing + fixed offset. The joints now animate on the native
   `*_TRRJ_GAMMA_ROT` nodes; the thermal-control-accurate profile remains
   future work (P2).

10. ERA — **CORRECT (present, merged geometry)**. No node is named ERA, but
    an articulated multi-segment robotic arm is clearly visible mounted on
    Nauka in browser renders (`MLM_Details_Misc` carries 48 k triangles of
    merged detail). Not missing; has no dedicated animatable node.

11. TRUSS ARCHITECTURE — **CORRECT**. Z1, P1, P3–P6, S0, S1, S3–S6 (11
    segments + Z1), P5/S5 present. Leave as-is.

12. UNIT-SCALE MIXING — **PROBABLE SOURCE QUIRK, no action**. Subtree scales
    vary (0.01579–100) with compensating rotations — a CAD unit-conversion
    artifact. World matrices are consistent; harmless.

## Actions taken

- `scripts/iss-model-manifest.mjs` — correct vertex reads (`getElement`/raw
  array); stale-accessor comparison now meaningful.
- `scripts/build-iss-model.mjs` — `report()` measures decoded vertices;
  fixed latent `position` ReferenceError.
- `src/rendering/iss/ISSModel.tsx` — `[ISS AUDIT]` mount log (quality + URL);
  exact measured bounds documented in the constants comment.
- `src/rendering/iss/ISSAnimations.tsx` — rewritten around the authored
  SARJ/TRRJ joints; synthetic re-parenting machinery removed.
- Radiator subtrees get a dedicated light-silver material at mount.
- `scripts/iss-model-inspector.html` — browser harness kept for future model
  forensics (serve via dev server, open directly).

## Verification

- three.js in-browser `Box3` vs Node-side decoded bounds: match on all
  checked nodes (arrays, iROSAs, radiators, MLM, Zvezda).
- Isolated renders: P1/S1 radiators, P4 4A wing (iROSA over original), Nauka
  arm, full overview — all correct.
