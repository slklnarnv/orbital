# Plan 001 — Repair ISS articulation, preserve the rig, and correct model integration

## Status and scope

- **Status:** Ready for implementation; no fixes in this document have been applied.
- **Audit date:** 2026-09-27.
- **Planned against:** commit `fd5d353`, plus the working-tree files read during this audit. Compare the excerpts below with the current working tree; the commit alone does not establish that those files are unchanged.
- **Primary scope:** the IGOAL model's source/conversion pipeline, geometry and attachment semantics, procedural animation, materials, and animation-safe optimization.
- **Related scope, explicitly separated:** Legacy/Model A normalization, model selection and failure handling, camera clearance, and discontinuous orbital pose updates.
- **Priority:** radiator mechanics and deterministic rig resolution first. Do not start by merging geometry or adding more moving parts.
- **Execution boundary:** this is a handoff, not an implementation. The audit changed no application source, model assets, or original art. Only this plan and its index were written. No builds, installs, formatters, or test suites were run. A dev server and disposable browser sessions were used, then stopped/closed.

Read this document completely before implementing. It contains observations, decisions, counterexamples to the previous audit, implementation steps, and acceptance criteria. Do not use `docs/ISS_MODEL_CONTEXT.md` as authority over the current asset: several of its central explanations are incorrect, although much of its inventory remains useful.

## 1. Conclusions

1. **The EATCS radiators need a mechanism correction, not another guessed attachment-edge offset.** `ISSAnimations.tsx` assigns the SARJ truss axis to the TRRJs as well. The radiator bearing/beam geometry and authored TRRJ frames instead support an axis along native model **X**, perpendicular to the main truss. Both TRRJ nodes' local **Y** axes map to native **+X**. Their origins at `x ≈ -6.775` lie along that shaft; being inside the radiator's longitudinal extent does not make them bad pivots. The current bounding-box hinge compensation is based on the wrong mechanical interpretation.
2. **Joint resolution changes with the station's attitude at mount.** An enclosing scene-space AABB cannot be transformed back into the original model-space bounds. This produces zero reference normals or normals parallel to the rotation axis. This was exercised using the actual Vite-transformed resolver and the shipped decoded geometry.
3. **TRRJs are not continuous solar-pointing rotators.** The current law gives them a full revolution with fixed ±0.7-radian solar offsets. NASA documents ±105° software limits, ±115° hardware travel, and a maximum 45°/minute rotation rate. Modern nominal operations often park them; an animated autotracking demonstration must be identified as such and remain mechanically valid.
4. **The prior radiator material explanation targets the wrong primitive.** `P1_Radiator` primitive 0 is short base-beam geometry. Primitive 1, using `Truss`, includes the long panels. The blanket runtime silver override erases hardware distinctions and misses the S1 RGBA sibling.
5. **The pipeline loses useful rig frames and writes a nonconforming WebP GLB.** Six authored empty attachment frames are pruned. `EXT_texture_webp` is not registered with either relevant `NodeIO`; it is absent from the shipped asset even though its images are WebP.
6. **Optimization must respect rigid-motion boundaries.** There are genuine batching opportunities, but “static today” must not mean “merge through a future joint.” The model has usable BGA, robotics, camera, shutter, transporter, and attachment structure. ERA needs mesh separation before articulation.
7. **Model switching currently changes heading, scale, and pivot, not just fidelity.** Legacy renders its forward axis sideways and spans about 162.52 render units. Model A spans about 73.92 units and is displaced by about 21.36 units. Both are intended to use a common 109-unit truss span.
8. **Loading failures and mid-flight selection have independently verified state-machine bugs.** A rejected High load can permanently latch the detail error boundary, and replacing a model during Locate stops an already-started flight.

Preserve the intentional enlarged ISS: **109 render units, approximately 1,000× physical scale**. Do not compensate for any finding by rescaling the entire scene, moving the orbital trajectory, changing Earth, or disabling all part animation.

## 2. Evidence, provenance, and verification limits

### 2.1 Source-to-runtime chain

Repository: `C:/tmp/orbital`.

| Stage | Artifact / code | Observed state |
|---|---|---|
| Native authoring | `ISS_External_26.05_revA.blend`, referenced by the FBX header | Not present under the supplied source directory. Original Blender constraints, construction history, and authoring decisions cannot be audited from an unavailable file. |
| Source of record | `C:/Users/Arnav/Downloads/ISSTEST/International Space Station (ISS) (D) (IGOAL).fbx` | Present. A read-only binary parser counted **702 Model objects** and inspected their parent connections and TRS properties. FBX version 7400; Creator identifies Blender stable FBX IO 5.0.1. |
| Separate flattened export | Same directory, `International Space Station (ISS) (D) (IGOAL).glb` | **64,846,620 bytes**, one node and one mesh, 114 images; generator Khronos glTF Blender I/O v5.0.21. Richer material reference, **not** an articulated replacement. One mesh still contains multiple material primitives. |
| Conversion | `scripts/build-iss-model.mjs:95-103` | `fbx2gltf`, binary, `--pbr-metallic-roughness`; default UV V flip retained. |
| Raw intermediate | `.tmp-iss-build/igoal_raw.glb` | **290,983,300 bytes**, **703 nodes**, **657 meshes**. The extra node relative to FBX Models is the conversion root. |
| Optimization | `scripts/build-iss-model.mjs:139-265` | Material transparency/BMP handling; dedup/prune/weld; WebP ≤2048 intent; `/details/i` simplification; Draco 14-bit position, 10-bit normal, 12-bit UV. No global mesh-join transform. |
| Shipped High | `public/models/iss_igoal.glb` | **20,525,292 bytes**, **697 nodes**, **656 stored meshes**, **978 stored primitives**, 41 glTF materials, 73 images. No glTF animation clips. |
| Runtime geometry | `ISSModel.tsx:231-317` | Cached GLTF scene is cloned, normalized, prepared on the GPU, and animated procedurally. Clones share geometry/material resources unless material references are replaced. |
| Orbital placement | `ISSGroup.tsx:87-132` | Interpolated TEME-derived position plus synthetic velocity/nadir attitude and fixed yaw preset. |

Content hashes recorded during the audit:

```text
source FBX SHA-256
c3c43b9c48dd12ee9e7bcfed848a1df32730a633399627a532405c23b892e43d

raw GLB SHA-256
59b42a8e04d6326207f04ef3a8bd9931adcf80639aff5b20cf9e62e0a0cd2ded

shipped IGOAL GLB SHA-256
e658e3a8aa43be28f63fd6993b8776f6e263114df9409b9940f5aef186b1bd02
```

The source FBX's TRRJ records contain the same offset translations and approximately ±90° pre-oriented local frames found in the conversion. The inspected records do **not** contain a compensating `RotationPivot` property that explains away the runtime axis problem. Do not invent a lost FBX pivot.

### 2.2 Measurements from the shipped model

The browser decoded the actual shipped GLB with Three's Draco loader. Bounds below distinguish actual transformed vertices from conservative boxes.

| Measurement | Result |
|---|---|
| High whole model, true transformed-vertex AABB | Min `(-36.711350, -22.115638, -54.145694)`; max `(36.711209, 8.510375, 54.146887)`; size **73.422558 × 30.626013 × 108.292581 m** |
| High whole model, default `Box3.setFromObject` | Size **73.427516 × 30.626014 × 108.292591 m** — reproduces the old report, but is not the tight vertex result |
| P1 radiator, actual vertices | **23.167666 × 4.517900 × 11.571813 m** |
| S1 radiator node, actual vertices | **23.167665 × 4.356799 × 11.571812 m** |
| Whole S1 TRRJ subtree | Y size **4.517903 m** when its RGBA sibling is included |
| Original wings | About **35.347–35.348 m** long and **11.397 m** wide; bare P4 2A includes end hardware and measures **37.425816 m** along X |
| Solar configuration | Eight original wings; six named iROSAs; 2A and 3B remain bare |
| High runtime mesh instances / distinct geometries | **991 / 978** |
| High instance triangle count | **2,665,397** |
| Full scene, sampled close view | **998 draw calls**, **2,763,893 triangles**, plus star points/orbit lines |
| Distinct decoded geometry ArrayBuffers reachable from High | **227,615,316 bytes**, about **217.07 MiB** |
| High texture objects and decoded pixel count | **73**, totaling **137,887,744 pixels** |
| RGBA8 plus mip-chain texture estimate | **735,401,301 bytes**, about **701.33 MiB**; estimate, not a driver VRAM measurement |

The geometry and texture estimates are separate from compressed download size. They exclude driver overhead, framebuffers, Earth assets, CPU image copies, and other cached model selections. Do not present their sum as measured hardware allocation.

The millimeter-level difference between High's old box bounds and tight bounds is **not** the cause of floating radiators and does not justify changing the intentional render scale. The current High normalization is sufficiently close for this repair; regenerate its constants only as part of a properly measured asset rebuild.

### 2.3 Live scenarios actually exercised

Server: `npm run dev -- --host 127.0.0.1 --port 5188 --strictPort`, Vite 6.4.2. Browser: HeadlessChrome 153, Windows, WebGL 2, ANGLE/AMD Radeon Graphics/D3D11. This was a real hardware-backed browser surface, not a model of React behavior.

- Cold startup: Model A requested; no High request before Locate intent. Locate then fetched `/models/iss_igoal.glb`, prepared it, and reached ready.
- Standalone inspector: whole model, P1 radiator, radiator support/bearing views, and Nauka/ERA inspected visually. Native attachment hardware was compared with NASA's radiator-beam and TRRJ drawings.
- Actual compiled `resolveJoint` exercised on decoded, authored-pose clones under several outer rotations; failure examples are in finding M2.
- Actual animation sampled through **5,700 simulation seconds at 120×**. Twelve phase samples showed finite node quaternions but TRRJ commands across essentially the full ±180° range. Example P1 commands: `-177.92°, -152.63°, -121.80°, …, 131.93°, 161.18°`; S1 reached `157.99°` and `-169.73°`. Finite numbers did not imply valid mechanics.
- High request deliberately answered with HTTP 503 in a fresh browser realm. Only A and High were requested; Legacy never requested. Status remained `loading`, Locate remained transitioning. Manually selecting Legacy did not recover it.
- Successful model replacement during an already-started Locate, with the first Legacy request held. Camera position was **identical for 20 sampled frames** while status was loading, then the flight resumed after preparation. A tiny quaternion change was recorded; a large visible horizon snap was **not** established by this view.
- One High `compileAsync` call deliberately rejected in a disposable runtime diagnostic. Legacy became ready while preferred quality remained High. Re-selecting High left Legacy active. The temporary renderer method override was restored.
- Model A request deliberately failed. After the startup overlay ceased intercepting input, an actual Locate click left `aria-busy=true`, `loading`, and HUD `Loading ISS · Free`; only A had been requested.
- Legacy heading and both fallback normalization defects measured on the mounted model, using full vertex transforms rather than inverse-transforming a world AABB.
- High camera-clearance collision: an actual `P6_2B_Array_2` triangle edge intersects the radius-60 sphere. Setting the existing INSPECT controls to that point produced `minDistance=60`, actual distance 60, and **zero eye-to-edge distance**.
- Actual half-orbit clock seek: displayed ISS radius went from **6,794.11 km** through **2,253.73 km** to **6,804.79 km**; two of 45 sampled frames were inside Earth. Quaternion length stayed valid in this particular real-orbit run.
- Separate in-memory exercise of the real `OrbitalRenderInterpolator` with deterministic quarter-orbit inputs produced a rank-one, degenerate attitude basis with determinant 0 and target quaternion length **0.7071067812**. An antipodal interpolation midpoint had radius approximately zero.

The browser state was restored to High, ready, REALTIME, scale 1 before closing. No production build, unit-suite result, mobile performance claim, or exhaustive collision certification is implied by this audit.

**2026-09-27 follow-up scenarios** (orientation/solar request, same read-only rules; server relaunched on port 5188, HeadlessChrome 153):

- Mounted High anatomy measured via named landmark deltas (forward/starboard/nadir, determinant, nadir alignment) and module-pair deltas (Columbus/JEM/Tranquility/Quest/Nauka/Poisk) — see "Verified correct".
- The actual compiled `resolveJoint` + shipped `useFrame` joint loop were extracted from the Vite-transformed module and executed on an authored-pose clone across a 7×8 β/phase grid (56 cases) with per-wing BGA correction applied afterwards; front-face incidence measured on atlas-UV-isolated photovoltaic triangles of all eight original wings and six iROSAs.
- Environment Sun light direction, eclipse shadow test, and shadow-map state sampled live at a real epoch (β ≈ −24.5°).
- Asset rig re-checked: no BGA/panel hinge nodes exist under `Zarya_FGB`/`Zvezda_SM`; eleven negative-determinant meshes enumerated; original-blanket underside UV region identified.
- Measurement caution recorded for future audits: a direction measured in one node's local frame must never be compared with a direction in another node's local frame (this produced a bogus 160° "cant drift" in one disposable script; the valid world-space measurement is 2×10⁻⁶°). Always reduce surface normals to a single stated frame before comparing.

## 3. Prioritized findings

Risk is the risk of the repair. Confidence describes the evidence, not an assertion that every possible pose was inspected.

| ID | Priority | Finding / impact | Risk | Confidence | Primary evidence |
|---|---|---|---|---|---|
| M1 | P1 | TRRJ uses the SARJ axis and a fictitious box-derived hinge; bearing orientation is not maintained | Medium | High, geometry + runtime math + primary mechanism drawings | `ISSAnimations.tsx:156-216,315-331`; raw FBX TRRJ records; NASA ATCS pp.14–16 |
| M2 | P1 | Mount attitude changes the resolved panel normal; solar/radiator motion can freeze or track an arbitrary phase | Medium | High, executed counterexamples | `ISSAnimations.tsx:174-211` |
| M3 | P1 | TRRJ solar-pointing/full-turn law violates travel limits and misrepresents thermal articulation | Medium | High, full-orbit samples + NASA limits | `ISSAnimations.tsx:73-77,291-331`; NASA ATCS p.16 |
| P1 | P1 | Missing `EXT_texture_webp` makes the shipped GLB nonconforming and disables trustworthy WebP dimension reporting | Low | High, binary JSON + installed writer source | `build-iss-model.mjs:140-147`; `iss-model-manifest.mjs:163-171` |
| P2 | P1 | Build validates after overwriting the runtime asset; current checks do not protect the complete rig | Medium | High, code | `build-iss-model.mjs:64-77,263-265,341-389` |
| V1 | P1 | Bounds audit compares decoded values with recomputed decoded values, not the file's declarations; “exact” box claims are wrong | Low | High, source + independent comparison | `iss-model-manifest.mjs:82-118,124-141`; `build-iss-model.mjs:278-335` |
| R1 | P1 | High load rejection latches the detail error boundary; fallback and Locate can remain pending indefinitely | Low | High, live fault injection | `ISSModel.tsx:207-219,390-402,559-573` |
| M4 | P2 | Radiator material override obscures actual panel/hardware boundaries and misses S1 RGBA | Medium | High, primitive measurements + visual inspection | `ISSModel.tsx:163-191`; raw/shipped radiator primitives |
| P3 | P2 | Six author-provided attachment frames are removed before future articulation can use them | Low | High, original FBX/raw/shipped name comparison | both `prune()` calls in `build-iss-model.mjs`; exact frames below |
| O1 | P2 | Legacy heading, span, and center are incorrect; Model A span and center are incorrect | Medium | High, mounted decoded geometry | `ISSModel.tsx:82-143,306-317,577-585` |
| R2 | P2 | Selecting a model during Locate stops an established flight and immediately abandons ready detail | Medium | High for stall; horizon severity conditional | `ISSModel.tsx:356-368,568-580`; `CameraController.tsx:289-360` |
| R3 | P2 | Preferred and effective quality are conflated in the UI; selecting preferred High cannot clear demotion | Low–medium | High, preparation-failure scenario | `ISSModel.tsx:348-368,395-400`; `settingsStore.ts:19-20`; `SettingsGear.tsx:85-92` |
| R4 | P2 | Failure of always-mounted A has no terminal ISS-availability path for Locate | Low–medium | High, live fault injection | `ISSModel.tsx:374-375`; `SceneRoot.tsx:22-39,181-194`; `CameraController.tsx:292` |
| C1 | P2 | Radius-60 camera rule intersects actual animated solar geometry | Medium | High, actual triangle and controls | `ISSModel.tsx:6-14`; `SceneRoot.tsx:68-72`; camera zoom-range consumers |
| O2 | P2 | Epoch discontinuities interpolate through Earth and can construct an invalid mixed-time attitude | Medium | High, live seek + deterministic class exercise | `OrbitalRenderInterpolator.ts:38-74`; `ISSGroup.tsx:108-132` |
| A1 | P2 | Oscillator entries lose their associated specification if a target is absent or matches multiple nodes | Low | High for latent logic defect; current eight targets exist | `ISSAnimations.tsx:266-269,334-341` |
| F1 | P2 | Transfer-byte budget does not constrain decoded GPU cost; rigid batching opportunities remain | Medium | High costs; speedup unmeasured | `check-asset-budget.mjs:18-25,101-111`; runtime measurements; rig catalog |
| D1 | P2 | Previous documents prescribe incorrect mechanics/material facts and overstate measurement/operational accuracy | Low | High | `ISS_MODEL_CONTEXT.md:3-8,163-184,251-290,356-393`; `MODEL_AUDIT.md:92-129` |
| S2 | P2 (optional) | BGAs are never driven: solar incidence error equals the full beta angle (up to about ±75°) on every wing | Low–medium | High for the deficit; ops-posture claim is secondary-sourced | `ISSAnimations.tsx:68-72` (SARJs only); measured beta sweep below |
| S3 | P3 (optional) | Russian segment arrays have no rig nodes in IGOAL, so Zarya/Zvezda array rotation cannot be animated without new rigging | Low | High for absence; real drives per general ISS references | tree `Zarya_FGB`/`Zvezda_SM` children: details only, no hinge/panel nodes |
| S4 | P3 (data) | Eleven meshes carry negative-determinant world transforms (authored mirrored sub-parts); merge tooling must not assume positive scale | Low | High, measured | Phase D list below |
| S5 | P3 (cosmetic) | Original SAW blanket underside maps to the dark-cell atlas region (v < 0.5), not a silver backing; reads plausibly dark | Low | High UV evidence | Front/back face UV pairs in `*_Array_*_2` |

### Verified correct — orientation and solar (2026-09-27 follow-up; no action required)

The user asked whether the station renders upside down or mirrored and whether the arrays track the Sun on all axes. Measured on the mounted High model with a corrected (authored-pose) clone driven by the actual shipped animation code:

- **High is not upside down and not mirrored.** Native landmark deltas in body coordinates: forward `Node2_Forward_CBM − Node2_Aft_CBM = (+1.0000, ~0, ~0)`; starboard `STBD_ALPHA_ROT − PORT_ALPHA_ROT = (0, +1.0000, 0)`; nadir `Cupola − Node3 = (0, 0, +1.0000)` with `nadir · (−r̂) = 0.99999954` (0.055° error). Basis determinant `+1`. Module topology matches the real station: Columbus `+0.904` Y (starboard), Kibo/JEM `−2.355` Y (port), Tranquility `−6.689` Y (port), Quest `+3.485` Y (starboard), Nauka `+14.171` Z (nadir), Poisk geometry extending native +Y (zenith) aft of Zvezda. Legacy remains sideways (planned, O1); Model A signs still need visual confirmation (planned, O1).
- **SARJ solar tracking is numerically correct.** Sweeping the actual controller across β ∈ {−75…+75°} × orbital phase {0…315°} (56 cases), original-wing front-face incidence error was ≤ 0.026° at β=0 and exactly |β| otherwise — i.e. the one-axis controller does what a one-axis controller can.
- **All fourteen active solar surfaces face sunward in every simulated case.** Front faces were isolated by atlas-UV region (photovoltaic band), not name: original wings ≈ 282 m² each with coherent front normal ≈ native +Y (zenith side); the six iROSAs measure **10.0012°** of authored cant, matching the published ~10° iROSA installation cant (NASA/Boeing coverage of the roll-out array installs). Minimum signed front-face dot over the whole sweep was +0.2549 (SARJ-only) — no surface ever presents its backside to the Sun in this simulation.
- **The eight BGA joints are real, working hinges.** Each `*_BETA_ROT_*` local +Y maps to native ±X (the wing long axis). Rotating each BGA about its local axis by the projected beta error brought original-wing incidence error from |β| to **≤ 0.001°** across all 56 cases, preserved the iROSA-to-wing cant to 2×10⁻⁶°, and left every BGA translation unchanged — a validated basis for the optional S2 feature.
- **Sun consumers are mutually consistent.** The environment directional light points along the same analytic `sunDirectionWorld` vector the arrays use (measured direction dot = 1.0); the visible Sun billboard and exposure damping are cosmetic layers; eclipse detection (sphere-Earth shadow test) matches the analytic terminator inputs. Renderer shadow maps are globally disabled (`castShadow=false` everywhere) — an accepted performance choice, so the model has no self-shadowing; do not "fix" silently.

The 10° iROSA cant is per published installation coverage; the beta/SARJ/BGA division of labor (SARJ one revolution per orbit, BGAs managing the beta angle, parked/directed postures in common ops) is consistent with primary-adjacent coverage but was not verified against a NASA operations document in this audit — treat the S2 default posture as a presentation choice, not flight truth.

### M1 — Correct the rotation axis, not the apparent end-edge position

Current load-bearing code:

```ts
// src/rendering/iss/ISSAnimations.tsx:169-172
const axis = new THREE.Vector3(0, 0, 1)
  .applyQuaternion(parentWorldQuatInv).normalize()

// :207-211
const hingeModel = new THREE.Vector3(
  THREE.MathUtils.clamp(0, modelBox.min.x, modelBox.max.x),
  THREE.MathUtils.clamp(0, modelBox.min.y, modelBox.max.y),
  modelCenter.z,
)
```

This applies native model Z to **all four** joints. Z is the main truss/SARJ axis. It is not a universal ISS mechanism axis.

Relevant authored-pose facts, in native model meters:

- SARJ origins: approximately `(0,0,-17.779986)` and `(0,0,+17.779986)`.
- TRRJ origins: approximately `(-6.775207,-0.000087,-14.681190)` and `(-6.775206,-0.000098,+14.681189)`.
- Both TRRJ node-local +Y axes transform to native model +X, within the small exported floating-point errors.
- Radiator geometry extends in native -X. Its base beam is near X ≈ -0.7 and its stationary coupler/housing is on the truss face near X ≈ 0. The fixed S1 housing candidate is `Truss_S1` primitive 0 / Three mesh `Truss_S1_1`; inspected in isolation from ±X.
- NASA's drawings show a bearing and torque box supporting the radiator beam, with the bearing axis perpendicular to that beam, not a line hinge spanning the main truss. The asset's geometry/frame mapping agrees with a native X-directed shaft.

A point can be anywhere along a rotation axis without changing the rotation. For an X-directed TRRJ shaft, moving the origin from X=-6.775 to X≈0 is unnecessary. The old “6.7 m inside the span, therefore defective pivot” explanation confuses an axis line with an end-edge hinge.

At an observed runtime phase the current P1 code transformed an authored longitudinal point `(-23,0,-14.68119)` to approximately `(22.98485,0.83457,-14.68119)`: the radiator length swept around the truss axis and reversed sides. A shaft-direction vector initially +X became approximately `(-0.99934,-0.03629,0)`, while the stationary housing did not rotate with it. This is not remedied by retaining one arbitrary box-edge point.

**Decision:** configure the actual mechanism axis per joint. Use native Z for SARJ, native X for the current TRRJs, and validate against the bearing/beam interface. Keep the original joint hierarchy and authored translations. For these correctly aligned axis lines, remove the inferred hinge compensation rather than introducing another synthetic pivot. Retain the entire TRRJ-owned assembly, including the S1 RGBA sibling, under its joint.

Pre- versus post-multiplication is a coordinate convention, not a universal rule: parent-frame deltas premultiply; node-local deltas postmultiply. Keep one explicit convention. The present parent-frame/premultiply pattern is usable once the axis is correct.

### M2 — Eliminate inverse-world-AABB rig inference

`resolveJoint` gets `Box3.setFromObject(node)`, transforms its eight corners through the inverse model-root matrix, and chooses the smallest resulting extent. Transforming all eight corners correctly encloses **that box**; it cannot undo information already lost when geometry was enclosed in world axes.

Executed counterexample: outer `Rz(60°)`, unchanged authored model:

| Joint | Reconstructed size | Result |
|---|---|---|
| PORT SARJ | `(74.11564,65.26684,28.33504)` | Chose Z, the rotation axis. Resulting normalized reference had `normal·axis = -1`, not 0. |
| STBD SARJ | `(74.22594,64.04935,28.36386)` | Same invalid parallel reference. |
| PORT TRRJ | `(26.84200,24.33089,11.57113)` | `normal·axis ≈ +1`. |
| STBD TRRJ | `(26.84899,24.32068,11.57113)` | Reference length 0. |

At outer `Rx(45°)`, both SARJ references were exactly zero in the exercised calculation. Tiny floating-point residuals can normalize into an arbitrary unit vector in other orientations; checking only finiteness or length is insufficient.

**Decision:** panel reference directions and shaft axes are rig data, not whole-subtree box guesses. Record measured authored-pose directions and their coordinate frame. If a bound is needed, accumulate vertices in the desired frame directly:

```ts
// Diagnostic/build-time shape, not a per-frame allocation pattern.
const modelFromMesh = new THREE.Matrix4()
  .multiplyMatrices(root.matrixWorld.clone().invert(), mesh.matrixWorld)
for (let i = 0; i < position.count; i += 1) {
  point.fromBufferAttribute(position, i).applyMatrix4(modelFromMesh)
  modelBounds.expandByPoint(point)
}
```

Do not replace the current operation with `setFromObject(node, true)` followed by the same inverse-world-box transform: that still re-encloses before changing frames.

Required invariants: normalized axis, normalized reference, `abs(axis·normal) < 1e-6`, unchanged resolved rig under arbitrary outer translation/rotation/uniform scale, and the same authored pose after repeated resolution. Validate the reference **before** normalization; do not normalize a near-zero vector into a fake valid direction.

### M3 — Separate radiator mechanics from its illustrative control law

Current code adds `+0.7` and `-0.7` radians to the same solar-facing target as the SARJs and wraps to `[-π,π)`. It has no TRRJ travel or slew constraint. The full-orbit run exceeded NASA's command limits on both sides.

NASA ATCS overview, page 16: software range ±105°, hardware range ±115°, variable speed 0–45°/minute. Autotracking aims approximately edge-to-Sun in daylight and face-to-Earth in eclipse. The 2026 NASA radiator paper, section II, additionally says normal operation is generally **parked**, with autotracking used primarily for contingencies and thermal needs.

**Decision:** preserve an animated visualization, but label it an illustrative autotracking mode rather than live flight telemetry or a faithful implementation of RGAC. Implement a correct, bounded rotary mechanism first. A parked pose can be a supported mode, not a workaround that hides broken mechanics.

For a simple autotracking approximation, compute the desired radiator normal in the plane perpendicular to its shaft: perpendicular to the projected Sun vector in daylight, aligned as closely as possible with projected nadir in eclipse. Account for two-sided radiator equivalence when choosing an allowed angle. Choose a continuous branch inside ±105°, with an explicit bounded flip/unwind transition when required; do not modulo-wrap through a hard stop. Cap motion at 0.75° per **simulation second**, not wall second. Hold a valid prior target at a true geometric singularity.

Use elapsed epoch since the last update for slew integration. `simulationClock.now()` returns the same tick to multiple render frames; consuming its tick delta again on every render would multiply the rate. Define initialization, pause, accelerated time, and explicit seek behavior. This is a kinematic illustration, not an ammonia-temperature simulation.

### M4 — Repair actual panel surfaces and preserve support materials

Measured P1 main primitives:

| Primitive | Original material | Geometry | Triangles |
|---|---|---|---|
| 0 | `MLI.Generic` | Base-beam region, native X approximately `[-0.93127,-0.42326]`, not the 23 m panels | 136 |
| 1 | `Truss` | Full deployed radiator length, X approximately `[-23.26823,-0.10057]`; includes panel and structural geometry | 1,482 |

S1 main primitives likewise use MLI for primitive 0 and Truss for primitive 1. Do not assume that all triangles in primitive 1 are panel faces.

Ownership is asymmetric **in the raw conversion already**:

```text
PORT_TRRJ_GAMMA_ROT
└─ P1_Radiator
   ├─ P1_Radiator_Details_Misc
   └─ P1_Radiator_Details_RGBA

STBD_TRRJ_GAMMA_ROT
├─ S1_Radiator
│  └─ S1_Radiator_Details_Misc
└─ S1_Radiator_Details_RGBA
```

`applyRadiatorMaterialCorrection()` traverses only the two `*_Radiator` nodes and assigns one untextured metalness-0.45 material to every mesh. Consequently it does not cover the S1 RGBA sibling, while flattening appearance distinctions on the selected hardware. This is a material-selection defect, not evidence that the sibling needs reparenting.

**Decision:** classify/split actual panel faces at authoring/build time and give them a dedicated white radiator coating material. NASA describes Z-93 white paint, not a uniformly metallic silver assembly. Preserve beam, coupler, grapple, label, and other support materials separately. Use geometry/UV inspection to select surfaces; do not recolor the shared Truss material or change every radiator descendant to one material. Remove the runtime blanket override after the asset carries the correction.

Upstream fidelity observation: the flattened D export has 114 images and material slots absent from the 73-image FBX2glTF result. For example, its `MLI.Generic` has a diffuse texture, metallic factor 0, roughness 0.5 and normal scale 3; the raw conversion reports Phong/non-true-PBR with roughly 0.4 metalness and 0.272 roughness. This loss predates Orbital optimization. Treat the sibling as a **reference to compare**, not a graph or UV/material mapping that can be imported blindly. A broader PBR restoration is separate from the targeted radiator repair.

### P1/P2/P3/V1 — Repair the build contract before publishing another asset

#### WebP registration

The shipped JSON contains `image/webp` images and ordinary `texture.source` entries, but only `KHR_draco_mesh_compression` in `extensionsUsed` and `extensionsRequired`.

The installed `textureCompress()` already creates `EXTTextureWebP` (`node_modules/@gltf-transform/functions/src/texture-compress.ts:218-223`). However, the writer explicitly drops extensions not registered with its I/O class (`@gltf-transform/core/src/io/writer.ts:56-71`). Both repository tools omit it from registration. Its registration also installs the WebP dimension reader (`extensions/src/ext-texture-webp/texture-webp.ts:105-108`). This explains why existing manifests have null WebP dimensions.

**Fix:** import/register `EXTTextureWebP` in the build and manifest `NodeIO` lists. Keep it required because there is no PNG/JPEG fallback. Verify emitted texture extension sources, not just MIME strings. Three currently tolerates the malformed asset; that does not make it conforming. Do not add a second manual compression path.

#### Protect the full rig

Current `REQUIRED_NODES` validates eight array nodes, two radiator nodes, and two camera pan nodes. It does not require the four driven rotary joints, all eight oscillator targets, expected ancestry, unique identities, physical directions, or the future attachment frames.

The exact six lost source/raw nodes are:

| Node | Raw parent | Purpose to preserve |
|---|---|---|
| `JEM_WRR` | `JEM_WR_ROT` | JEM wrist/end frame |
| `MBS_MGF_1` | `MBS` | Mobile-base mount frame |
| `MBS_MGF_3` | `MBS` | Mobile-base mount frame |
| `SSRMS_WRY_AttachmentPoint` | `WRR` | Canadarm2 attachment/end frame |
| `Node2_PDGF_Attach` | `Node2` | Grapple/base attachment frame |
| `USLab_PDGFMount` | `USLab` | Grapple/base attachment frame |

They exist in the original FBX and raw GLB, and account for the complete 703→697 node reduction. They have no triangles; their absence is lost semantics, not missing visible hardware. Source records are in raw GLB JSON ranges `96312-96329`, `97534-97551`, `98301-98318`, `98685-98702`, `100069-100086`, `104755-104772` when viewed as pretty-printed JSON.

The installed `prune` defaults to `keepLeaves: false`; `keepLeaves: true` is available. Use it consistently for both pruning passes, or explicitly protect these frames with a tested semantic policy. Preserving six empty nodes is preferable to reconstructing attachment points from geometry later.

#### Report what the file actually contains

`iss-model-manifest.mjs:107-118` calls `Accessor.getMin/getMax` and labels these the file's declared bounds. In installed glTF-Transform those methods scan the decoded array (`core/src/properties/accessor.ts:236-252,280-296`). The comparison therefore cannot detect a stale declaration.

Independent comparison of raw GLB JSON declarations with Three-decoded positions checked **964 unique POSITION accessors**. **960 differed** at more than `1e-8`; the largest local component difference was `0.0004234314`. This is small quantization-related disagreement, **not evidence of a gross stale-bounds defect**. It disproves “declared and decoded agree exactly” and shows why the existing comparison is not independent.

Also, transforming the eight corners of a mesh-local AABB gives a conservative bound on transformed geometry, not generally the exact vertex AABB. Correct the labels and provide both values when useful.

`report(document)` operates on the in-memory document after writing, not a newly decoded final file. The saved build report says 2,667,967 triangles / 4,898,978 vertices; the shipped decoded instance totals are 2,665,397 / 6,001,089. Do not compare these as equivalent stages or infer a corruption cause without tracing the writer/decoder and count convention.

**Fix:** parse and retain the original JSON declarations before decoding; map accessor identities explicitly. Decode the candidate output again for final geometry counts and bounds. Report unique resource counts separately from scene-instance counts, pixel dimensions, encoded bytes, decoded buffer bytes, source/output hashes, and rig contract results. Use quantization-aware tolerances in the relevant metric frame, not bit equality or one local-unit threshold across mixed scales.

#### Publish only a validated candidate

`optimize()` writes directly to `public/models/iss_igoal.glb` at line 264; required-node and format failures occur afterward. The 35 MiB check at lines 386–389 is only a warning in the build script.

Write a candidate in the work directory, decode and validate it, fail on budget/rig/format errors, then replace the runtime asset only after success. A failure must leave the previous runtime file and its metadata intact. Keep one conversion/optimization implementation, not a separate audited recipe that can drift from the production one.

### O1 — Normalize and orient every selectable asset in its own native scene frame

Current constants incorrectly assume both detailed models have Z truss span and share a pre-rotation. Measured facts:

| Asset | Native truss axis/span | Native tight-bounds center | Current runtime defect |
|---|---|---|---|
| High | Z, **108.292581** | About `(-0.0000705,-6.8026318,+0.0005962)` | Existing 108.293/box-centered normalization is close; no global orientation reversal demonstrated |
| Legacy | X, **111.988429** | About `(+0.0000024,+5.3411984,-3.8544638)` | Current truss span **162.520321**; body AABB center about `(0,-5.593691,-12.839269)` |
| Model A, including its authored node transform | X, **25.614240** | `(+0.0011162,+1.4887661,-3.8792463)` | Current truss span **73.915922**; body AABB center `(-4.857404,-0.002550,+20.802592)` |

Legacy native full size is **111.988429 × 68.784158 × 58.626683**. The old comment `31.070 × 24.200 × 75.109` must not be used as measurement evidence.

Legacy anatomical directions:

- Forward: Harmony minus Destiny = native +Z.
- Nadir: Pirs minus Poisk = native -Y.
- Starboard: S truss progresses native -X; port progresses +X.

Current `Rx(-90°)` maps Legacy forward to body **+Y**. Live measurement returned `(-2.15e-14,1,2.13e-14)`, proving sideways heading independently of the orbital attitude or camera.

Correct Legacy native→body basis columns are:

```text
native +X → body -Y
native +Y → body -Z
native +Z → body +X
quaternion XYZW = [-0.5, +0.5, -0.5, +0.5]
```

Model A's `ISS` node already has **+90° X** rotation and **0.6781210899** scale. Its current span divisor 37.772 and pivot offsets were measured in raw mesh coordinates but applied outside those retained transforms. Measure and offset in the scene-root frame instead. Retain its intended orientation unless anatomical inspection proves a sign error; a root rotation alone is not such proof.

**Fix:** use 109 divided by each asset's correctly measured truss span and the negated center in the same coordinate frame where the centering group applies. Correct Legacy's pre-rotation separately. Do not change High's valid anatomical mapping, flatten authored transforms to hide the error, or animate either fallback.

### R1–R4 — Make selection, availability, and active flight state coherent

Current critical fragments:

```tsx
// ISSModel.tsx:207-219
state = { failed: false }
static getDerivedStateFromError() { return { failed: true } }
// render returns null forever after failure

// :559-571 — only the child, not the boundary, is keyed
<DetailModelErrorBoundary onError={handleDetailError}>
  <Suspense fallback={null}>
    <DetailedISSModel key={spec.url} ... />
  </Suspense>
</DetailModelErrorBoundary>
```

The failed→loading writes in the High demotion callback do not guarantee an intermediate boundary unmount. Key/reset the **boundary at the asset/attempt boundary**, including retries of the same asset after a terminal failure.

Further changes must distinguish:

- persisted **preferred quality**;
- **effective/active ready asset**;
- **pending candidate asset and its attempt identity**;
- terminal detail failure with usable A;
- whole-ISS unavailability when A/outer mounting fails.

Do not persist automatic demotion as the user's preference. Expose successful Legacy fallback in the UI and allow an explicit High selection to clear demotion even when the stored preference is already High. Ready/error callbacks must identify the candidate attempt so late work cannot publish readiness for a different request. The final-frame stale-callback race identified during source review was not separately reproduced; design the ownership invariant rather than relying on passive-effect cleanup timing.

Retain a ready model while a replacement prepares, matching the existing “swaps in once prepared” promise. Keying one child and setting global status to loading does not provide that handoff.

In `CameraController.tsx:289-292`, readiness is checked before **every** Locate update. Apply the readiness gate to acquisition of a new flight, not to an already-captured path. Keep its elapsed path and transported horizon updating during a background replacement. Preserve cancellation, Reset independence, and `controls.update(0)` ordering.

If A fails, preserve the Earth/UI but publish terminal ISS unavailability and resolve/cancel Locate visibly. The existing detail `failed` state means “A is available”; do not reuse it blindly for “there is no ISS group.”

### C1/O2 — Keep these related renderer changes separate from the radiator patch

**Camera clearance:** the sampled animated High radius reached **67.907212** units. More importantly, an actual P6 2B triangle edge was intersected by the permitted radius-60 eye position. Body-local example:

```text
P6_2B_Array_2 edge [1143,1148]
(-30.8614381, -44.8263779, -25.2619771), radius = 60
```

A 55-unit half-span is not a bounding sphere; array corners and animation matter. Generate conservative swept clearance bounds for the corrected assets/allowed poses, and make navigation/Locate clearance consumers agree. Do not fix this by reducing model scale. Re-evaluate the envelope after correcting Legacy normalization and TRRJ motion.

**Pose discontinuities:** ordinary near-circular motion produces a valid right-handed frame. The defect is mixing newly sampled velocity with older interpolated position during a jump, and linearly interpolating large orbital displacements through Earth. Reset/reseed translation and attitude together at an explicit/discontinuous epoch change. Retain smooth normal 10 Hz interpolation. Add a cross-product validity guard, but do not substitute quaternion normalization or exception suppression for coherent pose handling.

The current body convention requires `Y = -normalize(r × v)` when X is forward and Z is nadir. Do **not** reverse that sign to satisfy an ambiguous “orbit normal” comment. With the fixed -8° yaw, final truss·velocity is about `sin(8°)=0.139173`, not zero. The old “truss perpendicular to velocity” acceptance is incompatible with the preset.

The -8° value is an illustrative constant, not an attitude telemetry stream. Wall-time attitude smoothing has a 0.625-second time constant, so accelerated motion can lag the intended orbital frame. Treat operational TEA ingestion or bounded-error high-speed attitude as a separate fidelity decision; do not replace the constant with another unverified real-flight number.

### A1 — Keep each resolved oscillator bound to its own spec

The resolver appends found parts to a flat array, but the update loop indexes `config.oscillators[i]`. A missing early target shifts the configurations applied to every subsequent part; a regex matching multiple parts has the same problem.

Store `{part, base, spec}` or the resolved axis/amplitude/period/phase together for each entry. A regression must show that a remaining camera uses its own axis and period when an earlier optional target is absent, and that multiple matches use the matching spec. This is a latent extensibility defect, not a claim that the current eight targets are missing.

## 4. Animation-safe optimization and progressive articulation

### 4.1 Rigid islands, not “everything currently static”

A rigid island contains geometry that shares one transform for every supported current or reserved articulation. Merge only compatible material/attribute buckets **within** that island. Keep semantic module ownership too: the roadmap's module selection/exploded view must not require reconstructing module identity from one station-wide mesh.

Protect these boundaries before running a join/flatten operation:

| Subsystem | Boundaries to retain | Recommendation |
|---|---|---|
| SARJ | `PORT_ALPHA_ROT`, `STBD_ALPHA_ROT` | Retain each complete outboard truss ownership tree. Static truss hardware within that tree can batch; never absorb BGA descendants. |
| BGAs | `PORT_BETA_ROT_2A/4A/2B/4B`, `STBD_BETA_ROT_1A/3A/1B/3B` | Eight separate wing islands even while parked. |
| Wings / iROSA | All eight named wings; six `IROSA_Deployed_P44A/P62B/P64B/S41A/S43A/S61B` | Batch fixed deployed hardware inside a wing only if deployment is not a supported motion. Keep iROSA identity if it is a reserved articulation boundary. No seventh/eighth iROSA. |
| EATCS | Both TRRJ roots, P1/S1 radiator geometry, S1 RGBA sibling | Fix mechanics/material classification before batching. Stationary housing and rotating beam remain separate. |
| Canadarm2 | `MT_Location/MT/MBS/MBS_MGF_4/SSRMS_Base/SSRMS_SH_LEE/SHR/SHY/SHP_PRIME/ELP_PRIME/WRP/WRY/WRR` and branches | One rigid link region per joint; preserve camera branches, alternate link geometry ownership, and restored attachment frame. |
| Dextre | `MBS_MGF_2/SPDM_LEE_Base/SPDM_PDGF_Tip/SPDM`, both `SPDM_Arm{1,2}_{SHR,SHY,SHP,ELP,WRP,WRY,WRR}`, `SPDM_BodyRoll_Joint` | Preserve link boundaries and `OTCM_Details_Claw01/Claw02`; screws/lights/static hardware can batch per link. The ELC-3 spare arm payload is a separate subtree. |
| Cupola | `Cupola_Shutter1` through `Cupola_Shutter7` | Keep seven shutters; only 1,290 triangles combined. Batch fixed shell/hardware separately. |
| JEM main arm | `JEM_SHY`, `JEM_SP_ROT`, `JEM_SHP`, `JEM_EP_ROT`, `JEM_ELP`, `JEM_WP_ROT`, `JEM_WRP`, `JEM_WY_ROT`, `JEM_WRY`, `JEM_WR_ROT`, restored `JEM_WRR` | Preserve FK chain and separate camera rotations. |
| JEM small arm | `JEM_EF_SFA_Base/SFA_SR/SFA_SP/SFA_EP/SFA_WP/SFA_WY/SFA_WR` | One link region per transform. |
| Cameras | Current JEM PM/ELP/SHP pan/tilt targets; JEM EF Aft/Forward Pan/Tilt; JEM ELP/WR camera ROT nodes; S1 and USLab VCSA pan/tilt nodes | Protect all intended camera joints, not only today's eight oscillators. `Truss_S1_Details_Misc` contains a camera descendant and is not recursively static. |
| Mobile system | `MT_Location`, `MT`, `MBS`, `CETA_A`, `CETA_B`, mount/PDGF frames | Preserve transporter/cart/base ownership; do not move nested robots by baking through it. |
| ERA / Nauka | `MLM/MLM_Details_Misc` | ERA is visibly present, but mixed into a five-material 48,027-triangle detail mesh. Requires authoring/component separation before FK. Never rotate all Nauka Misc as an ERA surrogate. |
| Modules / hatches | Existing named module roots and explicitly selected hatch/cover boundaries | Preserve module identity for future inspection/exploded views; reserve a hinge only when its geometry and axis can be validated. |

A verified small batching candidate: `P4_Array_2A` plus its fixed Handrails/Misc geometry has four primitives but two compatible material buckets, totaling 14,426 triangles. It can become two buckets while retaining the BGA/wing transform. This illustrates a safe unit of optimization, not a promise that every region reduces by half.

For a merge, transform positions with `islandWorldInverse * nodeWorld`; transform normals with the correct normal matrix; handle negative determinant/winding and tangents; preserve UVs, vertex colors, material sides/alpha modes, and index validity. BEAM/MLM include COLOR_0 in places where other primitives do not. Do not discard attributes to force buckets together.

Use one explicit protected-rig/semantic manifest: create `scripts/iss-rig-manifest.mjs` as the build-time authority for joint roles, coordinate-frame-qualified axes/references, oscillator parameters, protected roots, expected parents, and attachment frames. Both build and validation import it. Emit its validated runtime subset, with a schema version, into the GLB scene's `extras.orbitalRig`; Three's loader exposes scene extras on `gltf.scene.userData`. `DetailedISSModel` validates and passes that data to the animation component. No additional network request or runtime import from the scripts directory is necessary.

Migrate the existing `IGOAL_CONFIG` and required-node lists to this authority rather than retaining duplicate definitions. Keep runtime numerical machinery in TypeScript. Preserve authored identities: Three can sanitize display names, so validate resolution against original node identity/ancestry rather than assuming every future raw name survives unchanged. Do not introduce a generic rig framework or a separate registry per consumer.

### 4.2 Performance decisions

- Draco reduces transfer bytes, not decoded geometry size. WebP reduces transfer bytes, not RGBA GPU residency.
- Extend the existing asset report/budget path to include decoded geometry bytes, texture dimensions/pixels, primitive/instance counts, and the same frozen-view draw-call measurement. Do not treat the 35 MiB download ceiling as a GPU-memory ceiling.
- Apply safe rigid batching after the rig/material repairs. Record before/after counts and visual equivalence at identical camera/pose/lighting. A merged mesh with multiple material groups is not automatically one draw call.
- Review large rigid detail contributors separately: `AMS_Details`, `Columbus_BARTOLOMEO_Details`, `Truss_S4_Details_Misc`, `Truss_S6_Details_Misc`, `Truss_S0_Details_Misc` account for about 312,357 recorded triangles. Do not delete or further decimate an entire Details subtree merely because of its name; some contain articulated descendants or ERA.
- Do not dispose geometry/materials owned by cached GLTF primitives on ordinary quality switches. Current shared-resource ownership is intentional. A cache eviction policy would need explicit ownership, not unconditional traversal/dispose.
- KTX2/Basis is a grounded later option because the texture estimate is about 701 MiB. It requires a runtime loader/transcoder and quality/compatibility comparison. It is **not** required to fix the radiator or WebP registration bug. First correct reporting and measure the effects of material-aware resizing/reuse and batching.

### 4.3 What to animate next — optional, not prerequisites for the repair

1. **Small, visible, separable mechanisms:** validated Cupola shutter poses or additional camera joints. Cheap boundaries already exist. Use commanded/preset motion rather than endless arbitrary opening of real hardware.
2. **BGA pose control:** retain parked defaults, add validated seasonal/demo poses if desired. Do not reintroduce independent per-wing per-orbit rotation as a substitute for SARJ behavior.
3. **Canadarm2, Dextre, JEM and mobile-base sequences:** named FK structure exists, but axes, limits, endpoints, interlocks and collision-free presets must be validated first. Restoring the six attachment frames enables this work; it does not implement it.
4. **ERA / deployment:** obtain the native authoring scene or separate components with reviewed topology/material ownership. This is an art/rig task, not a runtime sine-wave addition. Do not make it block the available SARJ/TRRJ repair.

These options preserve future capability without requiring all hardware to move now.

## 5. Implementation sequence

### Phase A — Establish independent asset and rig checks

**Files:** `scripts/iss-model-manifest.mjs`, `scripts/build-iss-model.mjs`, `scripts/check-asset-budget.mjs`, and new `scripts/iss-rig-manifest.mjs`; `package.json` only if wiring the new check into the existing verify command; focused test files as described below.

1. Fix WebP I/O registration in both tools. Use the installed `EXTTextureWebP`, not a new encoder.
2. Correct declared-versus-decoded bounds reporting, conservative-versus-tight labels, and final-output decode/count conventions. Include actual image dimensions and the artifact hashes.
3. Add a check-only manifest mode: `node scripts/iss-model-manifest.mjs <asset.glb> --check-only`. It must not create an output directory. It must exit nonzero for invalid formats, nonfinite geometry, broken required rig structure, missing protected frames, invalid axis/reference definitions, or budget failures; report precise offending identities.
4. Expand the rig contract to all current driven joints/oscillators, protected future frames, expected parents, and semantic ownership. Preserve empty leaves consistently in both prune passes.
5. Refactor publication to validated candidate → final asset. Verify failure leaves the final asset's content hash unchanged. Keep the current FBX conversion options, including V flip.

**Verification:** new check-only command on a corrected candidate prints the resolved rig/format/cost summary and exits 0. A deliberately invalid in-memory/candidate fixture must fail without replacing the runtime file. Use a fixture with deliberately stale JSON declarations to prove the comparison is independent; do not compare two calls reading the same decoded accessor array.

### Phase B — Repair the kinematic core and radiator mechanism

**Files:** `src/rendering/iss/ISSAnimations.tsx`, new `src/rendering/iss/ISSJointKinematics.ts`, and `src/rendering/iss/ISSModel.tsx` for passing validated scene rig metadata. Extract only deterministic mechanism calculations into the new module so behavioral tests do not need a WebGL React tree. Keep effect/frame orchestration in the existing component and migrate its sole current caller when adding the rig-data prop.

1. Replace whole-subtree-AABB-derived axes/normals/hinges with validated rig-frame definitions. Resolve model↔parent frames independent of external attitude. Keep full matrices for points; explicitly validate scale/handedness assumptions for rotation frames.
2. Set the current SARJ model axis to Z and TRRJ model axis to X. Keep original joint nodes, base quaternions and translations. Remove the obsolete box-clamp hinge compensation and its explanatory comments for these mechanisms.
3. Preserve the parent-frame/premultiply convention, or change it consistently with clearly node-local axes; never mix them. Apply rotations from an immutable authored pose, not accumulated mutations.
4. Separate SARJ solar tracking from bounded radiator target selection/slew. Implement the mechanics and the clearly described illustrative thermal law from M3. Do not disable TRRJ animation as the delivered fix.
5. Store each oscillator's parameters together with its resolved target. Preserve the current eight camera motions while correcting missing/multiple-target behavior.
6. If the runtime consumes emitted rig metadata, remove duplicated obsolete hardcoded mappings and validate the metadata before declaring the detail ready.
7. **Optional S2 — bounded BGA tilt mode.** Add an opt-in demo mode that commands each `*_BETA_ROT_*` about its validated local long-axis with the projected beta error of its own wing's front normal (same target-projection math as the SARJs, applied per wing in that joint's parent frame). Validate first against the measured behavior: this drove original-wing incidence from |β| to ≤0.001° and preserved the 10.0012° iROSA cant across 56 β/phase cases without any translation drift. Keep the default **parked** posture (documented intent, consistent with common operations); expose the mode, label it illustrative, and never let it bypass the rig-frame validation of step 1. Do not rotate iROSAs independently of their wing.
8. S3/S5 require art or rigging work (new hinge nodes for Zarya/Zvezda arrays; underside UV/material art). Record them as deferred direction; do not improvise runtime geometry surgery for them.

**Verification:** focused joint tests cover outer-frame invariance, full mixed-scale parent transforms, axis/reference orthogonality, stationary bearing alignment, limits, flip continuity, pause/accelerated time, and missing/multiple oscillator targets. Standalone and in-app side/end views show the rotating beam remains coaxial with its fixed bearing throughout the allowed range; no sweeping the 23 m deployed length to the opposite side of the truss. A full orbit remains necessary after unit tests.

### Phase C — Correct radiator materials, then rebuild once through the repaired pipeline

**Files:** build/manifest scripts and `public/models/iss_igoal.glb`; `ISSModel.tsx` for removing the obsolete runtime material override and consuming fresh normalization metadata if needed.

1. Identify actual panel triangles in the long Truss primitives. Review their UVs and adjoining structural geometry. Use source material/geometry evidence, not primitive 0 or an entire subtree selector.
2. Split/classify panels versus support hardware and assign the dedicated radiator coating at build/authoring time. Keep shared Truss users untouched. Treat P1/S1 RGBA ownership deliberately.
3. Rebuild from the source FBX through the corrected candidate/validation path. Preserve the six attachment frames, eight wings, six iROSAs, named joints, and static body geometry.
4. Remove `RADIATOR_SILVER_MATERIAL` and `applyRadiatorMaterialCorrection` once the asset is self-contained. Do not leave a second runtime fix that masks bad exported materials.
5. Re-measure final decoded bounds. Update High constants only to measured values in the correct frame; the 109-unit target does not change.

**Verification:** raw-asset inspector and application agree on the corrected radiator materials without a runtime override. Both faces under sunlit and shadowed views remain readable, support materials remain distinct, and non-radiator Truss users retain their original appearance. Final rig/format check exits 0; the required WebP extension is present.

### Phase D — Batch rigid geometry without sacrificing future animation

**Files:** existing build/report/budget scripts, `scripts/iss-rig-manifest.mjs`, and the final IGOAL asset.

1. Partition by protected transform boundary and semantic module/link ownership.
2. Merge only compatible buckets within each partition, preserving parent-space pose and render attributes. Start with the verified P4 2A example, then apply the same bounded rule to the other eligible regions.
3. Keep all current/reserved joint transforms and restored mount frames. No global `flatten()`/`join()` or recursive Details merge without exclusions.
4. Handle negative determinants explicitly; do not assume positive scale. Measured negative-determinant meshes in the shipped High asset: `JEM_EF_Details_AftPan`, `JEM_EF_Details_AftTilt_1`, `JEM_EF_Details_AftTilt_2`, `JEM_PM_Details_CameraArms_1`, `JEM_PM_Details_CameraArms_2`, `JEM_PM_Details_Camera_Aft_Tilt_1`, `JEM_PM_Details_Camera_Aft_Tilt_2`, `JEM_PM_Details_WindowCover_Fwd`, `Truss_S1_ATA`, `Truss_S3_Details_FRGF`, `USLab_Details_TrunnionCovers`. Verify their rendered winding/normals before and after any merge; if a merged bucket mixes positive- and negative-determinant sources, split buckets instead of flipping triangles globally.
5. Report identical-pose before/after geometry and image costs and rendered draw calls. Keep triangle/shape changes distinct from batching results; do not claim a draw-call reduction from file size alone.

**Verification:** protected-frame transforms and endpoint behavior remain equivalent at representative poses; current animation tests pass; all selected merge regions are processed; draw calls are lower in the same frozen view; no new silhouette/UV/normal/material discontinuities. Do not impose an arbitrary universal FPS target from this single workstation.

### Phase E — Repair model normalization and selection lifecycle

This is related integration work, not a prerequisite for proving the High radiator mechanics. It should land before accepting the model switcher as a reliable verification tool.

**Files:** `src/rendering/iss/ISSModel.tsx`, `src/stores/settingsStore.ts`, `src/stores/loadingStore.ts`, `src/ui/common/SettingsGear.tsx`, `src/ui/clusters/CameraCluster.tsx`, `src/stores/cameraStore.ts`, `src/interaction/camera/CameraController.tsx`, and the outer availability boundary in `src/rendering/scene/SceneRoot.tsx`.

1. Re-measure Legacy and A in their native scene frames. Apply the O1 span/centering corrections and Legacy anatomical basis. Keep both models static.
2. Key/reset the detail error boundary at asset/attempt changes. Exercise loader rejection and preparation rejection separately.
3. Represent preferred, active-ready, pending-attempt and unavailable states explicitly enough to enforce ownership. Migrate all status consumers; no aliases or parallel legacy state path.
4. Keep the previous ready model visible while the candidate prepares. Commit only the current candidate's ready result. Disclose effective fallback and honor explicit reselection of preferred High.
5. Gate only new Locate acquisition on readiness; continue an established flight/horizon through selection changes. Preserve cancellation and Reset behavior.
6. Resolve whole-ISS unavailability when A fails. Do not leave the button indefinitely busy or claim a usable fallback where no ISS group exists.

**Verification:** all three models center on the same orbital pivot and have approximately 109-unit truss span; forward/nadir/starboard landmarks agree with the common body frame. Browser failure/switch matrix in section 7 passes, including no legacy-boundary latch and no mid-flight pause.

### Phase F — Fix clearance and discontinuous pose handling independently

**Files:** `src/rendering/iss/ISSGroup.tsx`, `src/rendering/iss/OrbitalRenderInterpolator.ts`, `src/interaction/camera/CameraStateMachine.ts` (`CAMERA_ZOOM_RANGES.INSPECT.minDistance`), `src/rendering/scene/SceneRoot.tsx` (the shared ISS-focused controls limit), `src/interaction/camera/CameraSensitivity.ts:100` (the matching close-range calibration), and the corresponding comment in `src/types/camera.ts`. Update the relevant existing rendering/camera tests. Keep the Earth-only limit in `CameraNavigationConstraint.ts` and Free-mode's independent pivot-distance policy unchanged unless a separately demonstrated issue requires them; this is not a request for a new general collision engine.

1. Generate/use a conservative swept model-clearance envelope for corrected asset poses. Replace the false half-span-as-radius assumption without rescaling the ISS.
2. Detect explicit/discontinuous epoch changes at the render-pose boundary. Reseed both translation and attitude coherently rather than interpolating a chord through Earth with unrelated velocity.
3. Build a valid frame from consistent pose data; guard degenerate cross products. Preserve the right-handed convention and distinguish the illustrative yaw from pre-yaw axes.
4. Preserve ordinary 10 Hz smoothing and the existing current-rendered-position camera tracking. Do not move the ISS under EarthGroup or create a second SGP4 renderer clock.

**Verification:** the measured radius-60 array intersection is no longer a permitted camera position; full pose sweeps remain outside geometry with near-plane margin. Quarter-orbit/antipodal discontinuity cases keep valid unit orientation and do not interpolate through Earth's interior. Ordinary continuous samples remain smooth.

### Documentation cutover after implementation proof

Update existing `docs/ISS_MODEL_CONTEXT.md`, `docs/MODEL_AUDIT.md`, `docs/HANDOFF.md`, `docs/NEXT_STEPS.md`, `docs/verification.md`, and the relevant README model-loading description. Keep historical errors as dated errata, not current commands to future agents.

Specifically remove/correct: universal truss-axis TRRJ motion; the “midspan origin is inherently bad” explanation; inverse-world-AABB recovery; primitive-0 panel attribution; exact declared/decoded equality; stale Legacy/A constants; “until re-selected” without an effective selection action; and the universal real -8° TEA claim. A `[ISS AUDIT]` log is emitted at preparation start, not proof of active visibility.

Preserve documented intent: enlarged scale, deferred detail loading, local Draco, six iROSAs, static fallback models, and renderer-owned interpolation without changing orbital truth.

## 6. Commands and repository conventions

Run from `C:/tmp/orbital`. Node.js 20+ and the existing npm lockfile are the project baseline. The audit used installed dependencies; it did not install or upgrade them.

| Purpose | Command | Expected outcome |
|---|---|---|
| Development / real surface | `npm run dev -- --host 127.0.0.1 --port 5188 --strictPort` | Vite serves the app and `/scripts/iss-model-inspector.html`; choose an unused port if this one is occupied |
| Source rebuild, **after candidate publication is fixed** | `node scripts/build-iss-model.mjs "C:/Users/Arnav/Downloads/ISSTEST/International Space Station (ISS) (D) (IGOAL).fbx"` | Validated candidate published; rig, dimensions, image format and budget checks pass |
| Existing full manifest | `node scripts/iss-model-manifest.mjs public/models/iss_igoal.glb .tmp-iss-build/audit-after` | Writes final decoded report/tree; use only during implementation, not as a read-only command |
| New check-only mode, implemented in Phase A | `node scripts/iss-model-manifest.mjs public/models/iss_igoal.glb --check-only` | Exit 0 with valid rig/format/budget summary and no output-file writes |
| Asset budget | `npm run check:assets` | Exit 0; retain the 5 MiB initial budget and deferred limits unless a separately justified optimization change requires review |
| Type check | `npm run typecheck` | Exit 0 |
| Focused regression gates | `npm test -- --run tests/unit/rendering tests/unit/camera` | Existing cases and the applicable new behavioral regressions listed below pass |
| Release gate | `npm run verify` | Asset/shader checks, types, existing tests, and production build succeed |

There is no configured lint command in `package.json`. Do not invent one or install a new test framework merely to claim a verification result. Batch build/type/test gates after the implementation changes are integrated; use direct numerical/browser checks to develop and inspect the changed mechanisms.

Conventions to match:

- React/TypeScript strict, existing `@/` aliases, single quotes/no semicolons in the ISS modules.
- Imperative Three mutation in `useFrame`, cached scratch objects, no per-frame geometry/bounds traversal or allocations for the controller math.
- Plain ESM `.mjs` scripts using existing glTF-Transform/Draco/meshoptimizer/sharp dependencies.
- Vitest Node environment; `tests/**/*.test.ts`. Follow `tests/unit/rendering/OrbitalRenderInterpolator.test.ts:28-85` for deterministic vector behavior, and `tests/unit/camera/ResetViewLifecycle.test.ts:5-7` for resetting Zustand stores with `getInitialState()`.
- Test behavior and geometry invariants, not source strings, forwarding mocks, node-count equality alone, or exact incidental wording. Existing shader-source tests are outside this repair. If touching the source-regex preload check in `check-asset-budget.mjs:129-132`, replace that wiring assertion with real startup-network verification rather than re-pinning source text.
- Shared GLTF resources stay shared. No blanket disposal or global Truss material mutation.

### Focused regression files

Create only behavior-bearing cases for the implemented phases; the following files are explicitly in scope:

- `tests/unit/rendering/ISSJointKinematics.test.ts` — mixed-scale authored hierarchy under arbitrary outer transforms; the Rx45°/Rz60° normal failures; immobile shaft/contact landmarks; correct axis-frame composition; TRRJ limits, branch transitions and simulation-time rate; oscillator ownership when an earlier optional target is absent or a spec matches several targets. Use small real Three geometry/hierarchies, not mocks that echo supplied transforms.
- `tests/unit/rendering/ISSModelBuild.test.ts` — independent stale JSON declarations versus decoded positions; preserved empty attachment transforms through the actual optimization functions; required WebP extension serialization; invalid candidate rejected without changing the published asset. Keep candidate files in an isolated temporary directory. Guard CLI entry points so importing validation/build helpers does not execute a conversion or write production assets.
- `tests/unit/rendering/ISSModelFrames.test.ts` — anatomical forward/nadir/starboard mappings and composition of scene centering with a nonidentity mesh node transform, including Model A's scale/rotation case. Assert transformed landmarks and spans, not that constants equal copied literals. The final real-asset browser/decoded measurements remain required alongside these small fixtures.
- `tests/unit/rendering/ISSModelLifecycle.test.ts` — obsolete preparation cannot resolve the current attempt; ready active geometry survives a pending replacement; preferred-quality reselection clears an effective demotion; unavailable versus usable-A terminal states are distinct. Use real store transitions and controlled asynchronous completions, with full store reset after each case. Do not claim these Node tests exercise React's error-boundary latch or GPU visibility; those require the browser matrix.
- Extend `tests/unit/rendering/OrbitalRenderInterpolator.test.ts` for explicit quarter-orbit/antipodal discontinuities and ordinary continuous samples after a reset. Test coherent pose handling together with the attitude calculation, rather than only a normalized final quaternion.
- Extend the existing `tests/unit/camera/CameraStateMachine.test.ts`, `CameraSensitivity.test.ts`, and `ResetViewLifecycle.test.ts` only where the clearance/readiness contracts change. Preserve unrelated Earth-clearance and manual-navigation behavior.

No browser framework installation is required by this plan. Exercise the actual error boundaries, decoded assets, preparation, switch visibility, and flight horizon in a real browser after the numerical/store tests.

## 7. Acceptance matrix

All applicable rows must pass before marking the corresponding phase complete. Unit tests alone do not certify the rendered mechanism.

### Asset / rig

- [ ] Final output declares `EXT_texture_webp` in used/required extensions and routes every WebP texture through its extension source.
- [ ] WebP dimensions are actual numbers; encoded and decoded resource costs are reported separately.
- [ ] Final decoded geometry has finite positions/normals and valid indices; declared bounds are independently read from file JSON and compared with documented quantization tolerances.
- [ ] Eight original wings and six iROSAs remain; no added overlay on 2A/3B.
- [ ] All four driven rotary roots, all current oscillator targets, and all six restored attachment frames retain required ancestry/transforms.
- [ ] A failed candidate cannot overwrite the currently shipped asset or successful metadata.
- [ ] The raw inspector shows corrected radiator materials without application overrides.

### Mechanical motion

- [ ] Resolving the same authored model under identity, translations, uniform render scale, Rx45°, Rz60°, and general compound rotations produces equivalent joint definitions in model coordinates.
- [ ] Axis/reference vectors are finite, unit, and perpendicular before motion; no zero/parallel normal is accepted.
- [ ] TRRJ shaft remains coaxial with the fixed bearing; authored attachment translations stay fixed; all rotating support geometry follows the right joint.
- [ ] Current TRRJ range is never exceeded; target branch changes do not jump through the hard stop; rate is bounded in simulation time.
- [ ] PAUSED does not integrate joint travel repeatedly; 120× changes time rate without changing mechanism geometry or multiplying tick deltas per render frame.
- [ ] One full simulated orbit plus explicit travel-limit poses is inspected broadside and end-on. Arrays remain seated, radiator interfaces remain attached, and no new truss/module intersections appear.
- [ ] Missing optional/multiple oscillator targets do not borrow another camera's axis or period.
- [ ] Legacy/A remain static; adding a future controller does not require unmerging another protected link.

### Orientation and solar (follow-up audit)

- [ ] Anatomical landmark assertions (forward CBM delta, starboard SARJ delta, Cupola−Node3 nadir, basis determinant +1, nadir·(−r̂) ≥ 1−1e-5) pass on the mounted High model at arbitrary simulation epochs.
- [ ] Front-face Sun incidence, measured on atlas-UV-isolated photovoltaic surfaces, stays within 0.05° of the achievable optimum for the enabled degrees of freedom: |β| error with SARJ only; ≤0.05° on original wings with the optional BGA mode, with the 10.0012° iROSA cant preserved within 0.001° and all signed front-face dots positive.
- [ ] No solar surface presents its back face to the Sun at any point of a full simulated orbit (minimum signed front-face dot > 0).
- [ ] If the BGA mode ships: it defaults to parked, is labeled illustrative, commands only the eight authored BGA joints, and leaves all BGA translations bit-identical to their authored values.
- [ ] The eleven negative-determinant meshes listed in Phase D render with unchanged winding after any batching change.
- [ ] The Sun light, visible Sun billboard, Earth terminator, array animation, and eclipse detection all derive from the same `sunDirectionWorld(julianDate)` epoch within each frame (no second solar ephemeris is introduced).

### Model integration / failure handling

- [ ] High, Legacy, and A use a 109-unit truss span and the same centered orbital pivot, with tolerances justified by final decoded geometry.
- [ ] High and Legacy anatomical forward, nadir, and starboard directions agree with the body frame. Model A's merged geometry is inspected for its intended signs.
- [ ] Cold start requests only A; ordinary deferred High/Legacy loads still prepare before a new Locate departs.
- [ ] High-only load rejection reaches Legacy and completes Locate.
- [ ] Both detailed assets rejected reaches A/Low detail and completes Locate without an automatic near-boundary retry during that flight.
- [ ] Preparation rejection is handled independently of a loader/render-boundary rejection.
- [ ] Manual selection recovers after a previous rejection; preferred High/effective Legacy is disclosed; reselecting High creates the intended attempt.
- [ ] Switching during downloading/preparing cannot publish obsolete ready/error results; switching after flight capture does not stop the path/horizon or flash an unprepared candidate.
- [ ] Cancel/Reset while preparing remains independent; later readiness cannot restart a cancelled Locate.
- [ ] Model A failure leaves Earth/UI available and resolves Locate as unavailable, not indefinitely busy.
- [ ] Ordinary LOD enters detail below 2,800 and leaves above 3,200 units without resetting the common ISS pose.

### Related pose / camera

- [ ] Camera clearance uses the corrected swept geometry envelope plus near-plane margin, not half the truss span.
- [ ] Explicit quarter-orbit/antipodal seek fixtures cannot yield a degenerate attitude quaternion or an Earth-crossing interpolation chord.
- [ ] Normal continuous telemetry retains smooth interpolation and camera tracking of the same rendered position.
- [ ] Final yawed-axis assertions account for the chosen preset; they do not require a truss/velocity dot product of zero with -8° yaw applied.

## 8. Hard boundaries and stop conditions

### Do not change as part of the core radiator repair

- Earth radius/shaders, TEME→world mapping, orbit propagation or TLE acquisition.
- The common 109-unit visualization scale.
- The six-iROSA configuration, correct original wing lengths, or main truss segmentation without new geometric evidence.
- Static Legacy/A articulation policy.
- The cached-GLTF ownership model through ad hoc disposal.
- Unrelated HUD design, backend/API/security behavior, dependency major versions, or general repository cleanup.

Related phases E/F deliberately touch model integration and camera/render pose. Keep them reviewable separately from the asset/mechanism fix. Robotics, operational attitude telemetry, KTX2, deployment animation, and module-explorer UI are optional direction, not hidden prerequisites or promised implemented features.

### Stop the affected phase and report concrete evidence if

- Source/artifact hashes or current code excerpts differ and the relevant geometry/frame contract has not been re-established. Do not overwrite intervening user changes.
- The source FBX is unavailable. Do not substitute the flattened GLB, Model C, stationary export, or legacy 3DS as the rig source.
- Detailed bearing/contact inspection contradicts the native X-directed TRRJ shaft mapping. Resolve that mechanical discrepancy before choosing another pivot; a box is not sufficient evidence.
- A required joint/reference is missing, ambiguous, zero, or parallel; do not silently skip it or fabricate a plausible fallback normal.
- A merge crosses a reserved motion/module boundary, loses a source attachment transform, or changes incompatible vertex/material attributes.
- The candidate only renders because of an application material override or unregistered extension tolerance.
- A change requires unverified original Blender constraints or inseparable ERA geometry. Finish the reachable SARJ/TRRJ work; do not invent that missing rig.

## 9. Considered and rejected explanations

- **“High arrays are undersized / four EATCS radiators are missing.”** Not supported. Eight wing assemblies and both three-ORU EATCS banks are present; previous undersized bounds came from bad measurement APIs. Two bank nodes are not two physical panels.
- **“The High scene scale should be real meters in a kilometer scene.”** Rejected by product intent; the enlarged scale is deliberate.
- **“High is globally upside down/backwards.”** Not demonstrated. Native forward +X, nadir -Y, starboard +Z map correctly through its pre-rotation. Legacy has a separate, proven frame mismatch. The 2026-09-27 follow-up verified this numerically on the mounted model (landmark deltas, determinant +1, nadir error 0.055°, real-station module topology).
- **“The station or arrays are mirrored.”** Rejected for the whole-scene transform: basis determinant is +1. Eleven sub-meshes carry authored negative scales (mirrored art parts); they render correctly and are handled as a merge caution, not an orientation bug.
- **“The iROSA cant angle is wrong or should be removed.”** Rejected: authored cant measures 10.0012°, matching the published ~10° iROSA installation cant. Preserve it through any BGA/SARJ changes.
- **“Transform eight world-AABB corners back and the original bounds are recovered.”** False; this is the current mount-attitude bug.
- **“A TRRJ origin inside the longitudinal span must be moved to an edge.”** False as a general mechanical claim; any point on the correct shaft axis is valid.
- **“Postmultiplication is always wrong.”** False; it is wrong only when used with an axis expressed in a different frame. Keep composition and axis coordinates consistent.
- **“Zero stale-accessor flags prove file declarations are correct.”** Rejected: the tool currently recomputes both sides of the comparison.
- **“All radiator surfaces are MLI primitive 0.”** Disproved by primitive-level geometry measurements.
- **“No ERA-named node means no ERA.”** Rejected: ERA geometry is visible at Nauka, but is not separately rigged.
- **“One flattened mesh is one cheap draw call.”** False when it has many material primitives; it also sacrifices articulation.
- **“Drei cache sharing is itself an unbounded leak.”** Not established for normal operation. Repeated GPU preparation/cache-failure eviction deserves measurement, but unconditional disposal would corrupt shared resources.
- **“The orbit-normal sign must be flipped.”** Rejected: forward X/nadir Z require negative angular momentum for body Y in this convention.
- **“A large mid-flight horizon snap was visually proven.”** Not in the exercised view. The flight stall is proven; larger roll effects remain conditional on the departure horizon.

## 10. References and limits

Primary references actually read:

1. [NASA/Boeing Active Thermal Control System overview](https://www.nasa.gov/wp-content/uploads/2021/02/473486main_iss_atcs_overview.pdf), especially pp.14–16: three eight-panel radiator ORUs per bank, radiator beam/TRRJ drawings, Z-93 coating, travel/rate limits, illustrative control goals. The drawings were also decoded and viewed during the audit.
2. [NASA, ISS Radiator Face Sheet Anomaly Investigation and Return to Function, ICES-2026-281](https://ntrs.nasa.gov/api/citations/20260002946/downloads/ICES_Paper-Radiator%20Face%20Sheet%20Draft_R11.pdf), section II: contemporary parked/autotrack practice and radiator construction.
3. [Khronos EXT_texture_webp specification](https://raw.githubusercontent.com/KhronosGroup/glTF/main/extensions/2.0/Vendor/EXT_texture_webp/README.md): required extension/source structure without PNG/JPEG fallback.
4. [FreeFlyer attitude reference frames](https://ai-solutions.com/_freeflyeruniversityguide/attitude_reference_frames.htm): explicit Earth-pointing frame signs and the distinction between velocity and local-horizontal conventions.
5. [NASA, Station Assembly Elements](https://www.nasa.gov/international-space-station/international-space-station-assembly-elements/), read during the 2026-09-27 follow-up: iROSA units "augment the eight main solar arrays" with "a 30% increase in power production"; confirms the six-roll-out-array configuration and their truss channels. The ~10° installation cant is corroborated by installation coverage (e.g. [Spaceflight Now, US EVA-75](https://spaceflightnow.com/2021/06/20/us-eva-75/)) and matches the measured 10.0012° authored cant.
6. Beta-angle/SARJ/BGA division of labor (SARJ one revolution per orbit; BGAs manage the beta angle; parked/directed postures): consistent with community technical coverage (e.g. [Space Stack Exchange, "How are the orientations of the ISS' eight independent solar arrays optimized?"](https://space.stackexchange.com/questions/23809/how-are-the-orientations-of-the-iss-eight-independent-solar-arrays-optimized)), but not verified against a NASA operations document in this audit. Treat operational-posture claims as presentation choices; the measured joint geometry and the optional BGA behavior validation do not depend on it.

Not audited: unavailable native `.blend` construction history/constraints; exhaustive contact/collision checks for every minor handrail, cable and future robotics pose; real-time hardware configuration/flight attitude telemetry; asset licensing provenance beyond the supplied export metadata; production/mobile/cross-browser performance; general backend/security/dependency posture. Those limits do not block the identified source, rig, export, normalization, and lifecycle repairs.

The prior documents contain agent-directed instructions to presume contradictory measurements wrong. Treat that as an audit trust hazard, not evidence of malicious authorship. Replace certainty-by-instruction with dated artifact hashes, independent measurements, and reproducible acceptance checks.
