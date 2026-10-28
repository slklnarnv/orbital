# PROGRESS-history — verbatim archive of plans/PROGRESS.md
#
# Frozen 2026-10-08 when the ledger was split (PR: docs front door).
# Everything below is unchanged history; nothing was deleted. Section map
# (dates + what landed) is at the bottom of the short plans/PROGRESS.md.
#
# CANON DECISIONS recorded here (still binding): Phase D constraints,
# Nauka acceptance (2026-09-27) superseded by the 2026-10-04 fix,
# lens flare re-added by user (default off), camera redesign closed without
# a measured trace, High 109-unit scale intentional, Model A static by design.

# PROGRESS — plan 001 implementation ledger

Update this file after every landed change. A fresh session resumes from here.
Last updated: 2026-09-29 (later) — OrbitLine repaired after the tick-mask
rewrite left it permanently invisible (bootstrap deadlock; component
simplified back to LineMaterial's own dash), and the ISS tracking glint
recolored golden → light blue per user request. Also: the lens flare the
"fresh start" entry below claims DELETED is BACK in the tree by user decision
(`SunFlare.ts` + `lensFlare` setting, default off) — the deletion note was
wrong for the shipped state; see "Lens flare re-landed" below. Remaining:
the owed lens-flare improvement pass, the user-reported performance run
("heavy and laggy" — see "Performance / optimization run — OWED" below),
and Phase D (optional perf batching) only.
2026-09-28 (later): user-facing time control LANDED (below, "Time control feature").

## Done (landed, verified)

### Phase A — asset/rig contract (plan §5.A)

- `scripts/iss-rig-manifest.mjs` (NEW, complete):
  - Rig authority: 4 joints (`PORT_ALPHA_ROT`/`STBD_ALPHA_ROT` SARJ axis
    native Z; `PORT/STBD_TRRJ_GAMMA_ROT` TRRJ axis native **X** — per plan
    M1), panel normals native ±Y, 8 oscillator specs, 6 protected attachment
    frames (+ expected parents), `TRRJ_LIMITS` (±105° software, 0.75°/sim-s),
    `REQUIRED_NODES`, `validateDocumentRig(document)`, `runtimeSubset()`,
    `parseGlbJsonDeclarations(buffer)` (pre-decode declared bounds from the
    GLB JSON chunk — the independent comparison V1 requires).
- `scripts/build-iss-model.mjs` (REWRITTEN; CLI runs via `main()` guard —
  importing is side-effect free):
  - `EXTTextureWebP` registered in `createIO()` (P1 format fix).
  - Both `prune()` passes use `{ keepLeaves: true }` (restores the 6 frames).
  - `splitRadiatorPanels()` (Phase C build-time material split): in
    `P1_Radiator`/`S1_Radiator`, the long `Truss` primitive is split by
    world-frame face normal (`|n·Y| > 0.7` → panels, measured ~500 m²) into a
    shared `Radiator_Panel_Coating` (white Z-93-style: 0.93/0.94/0.96,
    metal 0.1, rough 0.55) + structure (keeps `Truss`). Prim 0
    (`MLI.Generic` base beam) untouched. Shared `Truss` material untouched.
  - Candidate publication: writes
    `.tmp-iss-build/iss_igoal_candidate.glb`, then `validateCandidate()`
    (fresh decode: rig contract, EXT_texture_webp declared when WebP present,
    WebP dimensions readable, finite positions, truss-span sanity, 35 MiB
    hard gate) → only then `copyFile` to `public/models/iss_igoal.glb`.
    Failure leaves the shipped asset untouched.
  - Scene `extras.orbitalRig = runtimeSubset()` emitted (schema v1).
  - Report includes decoded counts, conservative-8-corner bounds (labeled),
    hashes, TRRJ limits.
- `scripts/iss-model-manifest.mjs` (UPDATED + runtime-verified this session):
  - CLI now guarded (`runCli()` via main-check); exports `createManifestIO`,
    `positionBounds`, `checkDeclaredBounds` for the test suite. FIX applied:
    `--check-only` was previously eaten as the out-dir positional (arg
    parsing now splits flags from positionals; a junk `--check-only/`
    directory incident verified + removed).
  - `checkDeclaredBounds()` parses original JSON declarations from the GLB and
    compares per-accessor (quantization-aware). Verified live on the shipped
    asset: 978 accessors, maxDelta 4.234e-4 (matches the audit's number).
  - `--check-only` mode verified: current pre-repair asset exits 1 with the
    6 missing protected frames + missing EXT_texture_webp named precisely,
    and writes nothing.
- `tests/unit/rendering/ISSModelBuild.test.ts` (NEW, 14 passing):
  - CLI-guard smoke (imports must not touch the published asset).
  - Stale declared bounds detected (recomputed comparison cannot).
  - `prune({keepLeaves:true})` preserves empty frames + transforms; default
    prune removes them (proves the flag is the protection).
  - `validateDocumentRig` missing-node/misparented-frame reporting.
  - `splitRadiatorPanels` classification (panel/structure/MLI untouched,
    shared Truss material untouched, single shared coating).
  - WebP: registered NodeIO emits conforming EXT_texture_webp (used +
    required + extension source + readable dims); unregistered drops it.
  - `validateCandidate` rejects a rig-invalid candidate; published asset
    byte-identical.

### Phase B — kinematic core (plan §5.B)

- `src/rendering/iss/ISSJointKinematics.ts` (NEW, pure, React-free):
  - Typed mirrors of the rig manifest (`IGOAL_JOINT_DEFS` SARJ Z / TRRJ X,
    normals ±Y; `IGOAL_OSCILLATOR_SPECS`; `IGOAL_TRRJ_LIMITS`) — a vitest
    sync test asserts equality with scripts/iss-rig-manifest.mjs.
  - `resolveJoint(root, def)` → `{ok, joint} | {ok:false, nodeName, reason}`:
    parent-relative quats (`(rootWorld⁻¹·parentWorld)⁻¹`), rig-frame axis/
    reference mapped + validated BEFORE normalization (unit, |dot|≤1e-4),
    positive-determinant ancestor chain required (mirror rejection), NO
    AABB inference, NO hinge compensation (M1/M2).
  - `sarjTargetAngle` (full-rev tracking, deadband hold) and
    `trrjTargetAngle` (M3 law: daylight edge-to-Sun / eclipse face-to-nadir,
    two-sided antipodal branch choice inside ±105°, singularity hold).
  - `trrjAdvance`: slew via `advanceToward` + **stop relabeling** — when the
    tracked branch sits at the ±105° stop and the only in-limit realization
    is the antipode (same two-sided pose), relabel instantly instead of
    slewing ~180° through the panel-perpendicular; never while paused.
  - `applyJointAngle` premultiplies parent-frame deltas onto the immutable
    authored pose (node origin on shaft ⇒ no position compensation).
  - Oscillator entries `{part, base, spec}` carry their own spec (A1).
  - `parseRigMetadata(scene.userData)` → absent/valid/invalid validation of
    `extras.orbitalRig` (schema, unit orthogonal joints, oscillator shape,
    limits).
- `src/rendering/iss/ISSAnimations.tsx` (REWRITTEN, orchestration only):
  - Config from validated metadata (post-rebuild assets) or built-in mirrors;
    legacy/A remain static.
  - Unresolvable joint → console.error + detail onError (no half-rig).
  - Frame loop: oscillators always; SARJ kinematic shortest-path unwrap
    (initializes to first valid target); TRRJ slew integrated on **epoch
    deltas** (dtSim = (now − last)/1000, clamped ≥0 — repeated ticks give
    dt=0; pause integrates nothing; 120× just advances sim-time); eclipse
    from the same single solar ephemeris (sphere-Earth shadow test, R=6371).
- `src/rendering/iss/ISSModel.tsx`: `DetailedISSModel` parses scene
  `userData.orbitalRig`, passes it to ISSAnimations; **invalid declared rig
  fails the detail** before ready (B.6). Silver override still present
  (removed in C).
- `tests/unit/rendering/ISSJointKinematics.test.ts` (NEW, 29 passing):
  outer-frame invariance incl. Rx45/Rz60 + compound (M2 regression),
  parentWorld·modelToParent=rootWorld composition, premultiplied world
  composition, on-axis landmarks fixed across ±105°, rigid roll (distance to
  shaft), coaxial shaft = model X, idempotent application, mirror rejection,
  missing-joint reporting, SARJ pointing + singularity, TRRJ limits sweep,
  daylight/eclipse intent, branch continuity over 360° sweep (pose-continuous
  stop relabels), trrjAdvance flip/pause/mid-range matrix, slew units,
  oscillator ownership (missing/multi/shift), metadata validation matrix,
  manifest sync.
- Gates: `tsc --noEmit` clean; `vitest --run` 154/154.

### Verified-measurement corrections that supersede docs/ISS_MODEL_CONTEXT.md

(plan §3/§9 — CONTEXT/MODEL_AUDIT need the §10 errata pass, not yet done)
- TRRJ shaft is native **X** (radiator rolls about its own beam axis);
  SARJ shaft is native Z. The "mid-assembly origin is defective / end-edge
  hinge" explanation in CONTEXT/MODEL_AUDIT is WRONG (M1).
- Runtime AABB→model-frame normal inference is attitude-dependent (M2) —
  rig-frame data replaces it.
- `P1_Radiator` prim 0 (`MLI.Generic`) is the short base beam; the panels
  are inside prim 1 (`Truss`) (M4) — so the runtime silver override targeted
  the wrong primitives and also missed the S1 RGBA sibling.
- "Declared accessors match decoded exactly" was overstated: the old check
  compared decoded-vs-decoded. Independent JSON comparison shows
  quantization-level deltas (max 4.234e-4 m on the shipped asset).
- High orientation/SARJ tracking verified CORRECT (not upside down; iROSA
  cant 10.0012°); Legacy is sideways (O1) and Model A span/center wrong.

### Phase C — rebuild (plan §5.C) — LANDED + browser-verified

- Rebuilt from the source FBX (hash matches the audit:
  `c3c43b9c…892e43d`) through the candidate pipeline. Exit 0.
- Published asset: 703 nodes (six attachment frames restored), 656 stored
  meshes, 73 textures, `EXT_texture_webp` + `KHR_draco_mesh_compression`
  declared, 19.6 MiB. Panel split: P1 608 panel / 874 structure tris,
  S1 680 / 1000. Bounds unchanged (73.4275 × 30.626 × 108.2926 m, center
  (−0.0025, −6.8026, 0.0006)) → `IGOAL_DETAILED` constants stay valid.
- `iss-model-manifest.mjs --check-only` → exit 0: no rig errors, WebP
  declared, 0 non-finite positions, within budget; 980 accessors compared,
  maxDelta 4.234e-4 (quantization-level).
- `RADIATOR_SILVER_MATERIAL` + `applyRadiatorMaterialCorrection` + call
  site REMOVED from `ISSModel.tsx` — the asset is self-contained.

### Browser acceptance (plan §7, 2026-09-27, dev server 5188 + IAB Chrome)

- Cold start requests only Model A; Locate fetches `iss_igoal.glb`, prepares,
  flight completes to Follow · Locked. Console clean (only unrelated RUM
  warnings) across load + a full orbit at 120×.
- Loaded asset carries `extras.orbitalRig` (schemaVersion 1, 4 joints,
  8 oscillators, source iss-rig-manifest.mjs) and `parseRigMetadata`
  validated it — runtime consumed the embedded contract, no errors.
- Radiators render as white pleated panels with distinct support hardware
  with NO runtime override; clearly distinct from the dark SAW blankets;
  readable in sunlit and Earth-shadow views (earthshine + exposure boost).
- Live joint sampling at 120×: SARJ ≈ 4°/sim-min (one rev/orbit), TRRJ rolls
  28°/4 wall-s (≈0.06°/sim-s, far under the 0.75°/sim-s cap); quaternion
  chain math in-page: TRRJ roll axis ∥ beam world axis (dot 0.99), beam
  world direction stable (dot 0.998), radiator subtree rotates rigidly with
  the joint. The earlier "axis 53° off" reading was a measurement artifact
  (beam direction applied in the wrong frame, skipping P1's authored
  rotation) — not a defect. Restored REALTIME ×1 afterwards.

### Phase E.1 + R1 (plan §5.E partial) — LANDED

- `LEGACY_DETAILED`: wingspanM 111.988429, wingspanAxis 'x', pivotOffset
  −center = (−0.0000024, −5.3411984, 3.8544638) (per plan O1 measurements;
  old 75.109/Z constants deleted).
- Per-model pre-rotations are now quaternions: High keeps Rx(−90°); Legacy
  gets the O1 anatomical basis (XYZW [−0.5, +0.5, −0.5, +0.5] — fixes the
  sideways heading). Model A: scale 109/25.614240, pivot
  (−0.0011162, −1.4887661, 3.8792463), orientation unchanged.
- R1: `DetailModelErrorBoundary` keyed `${spec.url}:${detailAttempt}`;
  attempt counter bumps on error and on selection change — no boundary latch
  across asset changes or same-asset retries. NOT yet browser-exercised with
  fault injection (that belongs to the full E matrix).

## Remaining (TODO, in plan order)

### Docs cutover (plan §5 last section) — LANDED
- Dated errata blocks added to `docs/ISS_MODEL_CONTEXT.md` (8 items: TRRJ
  native-X shaft, midspan-origin claim retracted, AABB inference removed,
  prim-0 attribution + coating split, declared/decoded quantization deltas,
  corrected §7.5 acceptance, candidate pipeline + WebP + 703 nodes, O1
  normalization) and `docs/MODEL_AUDIT.md` (finding 8 superseded).
- `plans/README.md` status row updated.

### New finding (2026-09-28, user-requested): BGA beta-tilt attempted and REVERTED
- The user asked for the solar wings to tilt fully sun-facing (the missing
  BGA beta-tilt — plan's optional S2) and for Canadarm sun-tracking.
- **BGA tilt (S2) was implemented** (8 `*_BETA_ROT_*` defs added to the
  manifest + runtime, live parent-frame recompute per frame, slew-limited
  targets) and verified numerically, but **read as broken on screen** and was
  **REVERTED the same day per the user's decision**. BGAs are parked again;
  the code is in git history only. Revisit later with a slower/validated
  presentation pass (likely cause of the bad look: per-wing tilt under the
  rotating SARJ needs careful phase/limit tuning, not just correct math).
- **Canadarm sun-tracking: declined as a premise** — the real arm does not
  sun-track, and its joint axes are unvalidated in this asset (plan stop
  condition). Left parked.

### Time control feature (2026-09-28, user-requested) — LANDED + browser-verified

Plan approved in-session (AskUserQuestion decisions: full scope incl. tape
scrub; presets 1×/10×/60×/300×; Live = hard snap back to wall now — a smooth
glide is infeasible, the 50 km/tick interpolation bound caps catch-up at
~65× and a 5 h lead would glide for minutes).

- **Store** (`src/stores/simulationStore.ts`, was deliberate dead code, now
  the single UI write path): `setRate(scale)` → ACCELERATED preset,
  `togglePause()` with `{resumeMode, resumeScale}` memory,
  `seek(epochMs)` which DETACHES from REALTIME into PAUSED first (REALTIME
  re-pins the epoch to the wall each tick, so an undetached seek would be
  undone within 100 ms) and clamps to ±7 days of wall now.
- **Transport row** (`src/ui/clusters/TimeControls.tsx`, NEW — rendered
  inside MissionClockCluster below the caption): pause/play icon, presets,
  Live (always visible, active while REALTIME), seek popover (SettingsGear
  pattern; datetime-local field interpreted as UTC, `Apply`, nudges
  ±1/±10 min / ±1 orbit; orbit = current telemetry period). Space = global
  pause toggle, exempting inputs/contentEditable/modifiers. No signal
  colors — active state is `--hud-hi` + hairline underline.
- **Orbit tape** (`OrbitTape.tsx`): now an interactive ARIA slider
  (was `pointer-events:none`, `aria-hidden`). Marker sweeps at the
  SIMULATION rate (per-frame rate factor: 0 paused / timeScale accelerated /
  wall live — no 10 Hz stepping), glides toward the 1 Hz measured target,
  SNAPS when the target jumps > 0.2 turn (seek). Pointer drag = continuous
  seek (base epoch + wrapped phase delta × period); scrubbing pauses any
  running rate first and release STAYS PAUSED; click = seek to that phase;
  ArrowLeft/Right ±1 min, PageUp/Down ±10 min; aria-valuetext = UTC.
- **Geo gate** (`GeoLookupService.ts` + `GroundTrackGlobe.tsx`): while
  ACCELERATED, no new geo lookups (at 300× the ground point crosses a cache
  cell per 5 s tick — unbounded fetch churn otherwise); tick cadence kept,
  in-flight finish, resume on Live is automatic; PAUSED keeps the
  cell-change one-shot (paused seek still fills in). The passing-over line
  withholds place/time/weather while accelerated (stale place would
  misrepresent a racing ground point); coords stay live.
- **INTERPOLATOR FIX (plan-001 correction):** `MAX_INTERPOLABLE_STEP_KM`
  50 → 400 (`OrbitalRenderInterpolator.ts`). The old value was derived from
  a 10× arithmetic error (300× stride is 7.66 km/s × 300 × 0.1 s ≈ 230 km,
  not ~23 km) and reseeded EVERY snapshot at accelerated rates — 10 Hz
  stepping + camera thrash at close range. 400 km sits above the largest
  continuous stride (230 km @ 300×) and below the smallest deliberate jump
  (±1 min nudge ≈ 460 km); plan-001 seek fixtures (≥ ~9,600 km) unchanged.
- **INTERPOLATOR FIX 2 (user-reported, same day):** the discontinuity
  anchor `lastSnapshotPosition` was only ever written in `reseed()`, so the
  bound measured the distance from the last reseed — the ACCUMULATED arc —
  not the per-snapshot stride. At 300× that reseeded every 2nd snapshot
  (460 km arc > 400 km): hold-then-teleport at ~5 Hz at every zoom level,
  reported as "ISS teleports to the next calculated spot" in Follow mode.
  Fix: re-anchor on every accepted snapshot
  (`lastSnapshotPosition.copy(this.target)` in the accept branch).
  Measured in-browser (Follow · Locked, 300×, camera per-frame
  displacement): before p10/p90 = 32.9/236 (bimodal stutter, 12.5×
  spread); after p10/p90 = 31.7/43.7 around mean ≈ 40 — smooth glide with
  rare (~3%) single-frame hitches from renderer hiccups, accepted.
  Regression test `stays interpolated across SUSTAINED accelerated
  strides` fails without the anchor update by construction.
- **OrbitLine** (`OrbitLine.tsx`): backward seek no longer freezes the arc
  (signed throttle now also regenerates when `nowMs < lastRefresh`), plus a
  250 ms wall floor so 300× cannot spend every frame on ~185 SGP4
  propagations.
- **SimulationClock.ts**: comments only (stale "scale 0 = paused" and
  "ignored in PAUSED/REPLAY" docstrings corrected; no behavior change).
- Tests: `tests/unit/clock/SimulationStore.test.ts` (NEW, 8),
  `SimulationClock.test.ts` (+3 seek/pause contracts),
  `OrbitalRenderInterpolator.test.ts` (+2: 300× stride interpolates,
  ±1 min nudge snaps), `GeoLookupService.test.ts` (+2 service-level gate
  tests with fake timers + stubbed fetch). 181/181.
- Gates: `tsc` clean; `npx vitest --run` 181/181; `npm run verify` green
  (incl. production build).
- Browser matrix (dev server + IAB): Live within 35–59 ms of wall; Space /
  toggle pause; paused epoch frozen; 300× implied rate ≈278× with ZERO new
  geo fetches; place/wx withheld + coords live while accelerated; Live
  snap-back; geo refetch in Live; typed UTC seek → epoch exact to the ms;
  scrub +100 px → +400.9 s (expected ≈400 s); ArrowRight/PageDown →
  +60/−600 s; transport row visuals per design system; console clean
  throughout, app restored to Live before wrap-up.
- **Found + fixed during verification:** `periodMsOf` in OrbitTape floored
  MINUTES at 600 (copied from a SECONDS floor) making every scrub offset
  6.45× too large — caught by the quantitative browser check, fixed, and
  re-verified to ±0.5 s.
- **SCRUB FOLD FIX (user-reported, same day):** the scrub delta was wrapped
  to shortest-path ±0.5 turn, so dragging past half the tape FOLDED: the
  epoch seeked a full orbit away (~±92 min) — the ISS lands one period
  later at a near-identical position (looks accurate) while Earth's GMST
  visibly jumps. Fix: accumulate each pointermove's shortest arc instead
  of wrapping the total (`scrubAccumRef` + `base.prevPhase` in
  OrbitTape.tsx) — edge-to-edge drag = exactly one monotonic revolution.
  Verified by seek-log during a full-tape drag: 13 seeks, 0 folds,
  down→release offset +5530.6 s vs ~5531 s expected. Also hardened
  `setPointerCapture` with try/catch (capture is an optimization; synthetic
  pointers have no capturable id).
- Known/accepted (documented in code): seek/scrub during a Locate flight
  completes to the captured pose then re-captures; TLE age/confidence
  follow sim epoch (past seeks show confidence 1.0); TLE-swap blend can
  briefly reseed at 300× (4-hourly event); ACCELERATED tab-suspension
  loses wall time beyond the 100 ms tick clamp (pre-existing).

## Visual refresh — sun, terminator, orbit line, ISS highlight (2026-09-28, user-requested) — LANDED + browser-verified

Approved in-session (user choices: subtle HDR bloom with an off toggle,
physical low-sun warmth terminator, compact 2–5° sun, optional lens flare we
can delete later; the white limb arc kept, only its orange segment softened).

- **Terminator** (`earthSurface.frag`, `clouds.frag`, `atmosphere.frag`): the
  three painted sunset bands DELETED (`twilightWarm`, `sunsetGlow`, and the
  atmosphere crimson/gold mix cut 0.68 → 0.35 with rose-gold hues). Replaced
  by one physical rule — the SUNLIGHT reddens at grazing incidence:
  `lowSun = 1.0 - smoothstep(0.02, 0.35, sunDot)` +
  `sunWarmth = mix(vec3(1.0), vec3(1.0, 0.52, 0.22), lowSun)` with the
  IDENTICAL literal in ground and clouds (tints terrain diffuse, ocean glint,
  cloud diffuse + forward scatter). Day/night masks widened (day
  (−0.10, 0.18), night 1−smoothstep(−0.14, 0.02)) — gradient, not a line.
  White limb arc untouched.
- **Sun**: billboard 0.20 → 0.055 rad (~3.2°; disc ≈0.6°, corona ~2.5°),
  `sun.frag` reworked (no lens ring, no painted streaks, quad-edge fade that
  accounts for d ∈ [0, 0.707] — the first cut faded at 0.72+ and showed the
  quad as a square). Disc luminance 0.58 — deliberately UNDER the bloom
  threshold: blooming a tiny HDR-22 source smeared UnrealBloom's coarsest mip
  into a visible square; the shader corona carries the glow instead. Light
  #fff3e2 @ 1.9.
- **Orbit line** (`OrbitLine.tsx`): THREE.Line + custom shaders → Line2 +
  LineMaterial (~2 px AA stroke). Per-point alpha via injected
  `instanceAlphaStart/End` attributes (onBeforeCompile, mirroring the
  instanceColor pattern; curve evaluated CPU-side per refresh: past 0→0.30,
  future 0.60). `orbitLine.vert/.frag` deleted. Resolution synced to
  viewport; frustumCulled off.
- **ISS zoom-out highlight** (`ISSModel.tsx`): aura sphere → billboarded
  gaussian-glow shader plane (`softGlow.frag`, amber/cyan shadow logic kept);
  beacon ring+dot → SDF reticle plane (`reticle.frag`: corner brackets +
  hairline circle + center dot, HUD reticle geometry rule). Distances,
  pulse, scaling unchanged. New shared `billboard.vert`.
- **Postprocessing** (`src/rendering/post/Postprocessing.tsx` NEW +
  SceneRoot): EffectComposer + RenderPass + UnrealBloom (0.3 strength /
  0.5 radius / **1.25 threshold** — sits ABOVE the ISS PBR highlight range so
  the station never sparkles, below the sun corona + city-light cores) +
  OutputPass, rendered at useFrame priority 1 (CameraControls −1 ordering
  preserved; Locate flight verified with composer active). `PostprocessingGate`
  unmounts the whole chain when the toggle is off — OFF == the exact old
  direct pipeline (verified). `OutputPass` owns ACES/sRGB; material tonemapping
  includes untouched (EarthVisualContracts still green).
- **Sun look tuning pass (user feedback "sun looks shit / ISS too shiny"):**
  disc 0.85 (crisp, hot white through ACES) + the CORONA made the HDR element
  (`innerCorona = exp(-d*9)*1.6`) — bloom glows the wide soft corona instead
  of a tiny hard source, which is what previously smeared into squares.
  Verified cresting-the-limb shot: blazing compact star + one-sided
  anamorphic streak, no square, station matte in Follow mode.
- **Lens flare** (`src/rendering/post/SunFlare.ts` NEW): ShaderPass after
  bloom — anamorphic streak + ghosts, gated per-frame by (a) analytic
  camera→sun ray vs Earth-sphere occlusion with penumbra, (b) Earth-disc
  screen-space occlusion so the flare never draws over the planet, (c)
  frame-border fade so no element touches the screen edge. Single ephemeris
  (sunDirectionWorld). Toggled in render settings (default on; deletable).
  **Reworked same day after user review** ("laser line + dirty smudge"):
  streak now a tapered two-tier profile (thin core 0.20 + soft wings 0.05,
  both dying by ~25% of the frame), ghosts cut from three warm blobs to two
  faint cool ones (0.045/0.030), global proximity falloff, frame fade.
  **Final state (2026-09-29, "fresh start" user rework)**: lens flare pass
  DELETED entirely (`src/rendering/post/SunFlare.ts` removed; Postprocessing
  is bloom + output only; `sunFlare` setting + "Lens flare" toggle removed —
  a stale `sunFlare` key in a user's persisted localStorage is ignored
  harmlessly). Sun rewritten fresh (`sun.frag`): crisp 0.65° disc (HDR 3.2)
  + two-tier exponential glow measured from the disc edge + white→gold→amber
  radial gradient, all faded to zero inside the quad (edgeFade completes at
  d≈0.49; quad UV d only reaches 0.707). Billboard enlarged to 0.078 rad
  (~4.5°) in EnvironmentLayer. Bloom: strength 0.26 / radius 0.4 /
  **threshold 2.4** — kills the "cloudy circles" the limb's HDR (~7) used to
  smear at planetary zoom. (Superseded 2026-09-29: the sun no longer feeds
  bloom at all — see the RESOLVED entry below.)
- **RESOLVED — fresh-sun visual verification (2026-09-29).** The sun is now
  confirmed in-frame, and the verification found three real defects, all
  fixed. Method note: the harness model has no image input, so the sun was
  judged by (a) numeric pixel analysis of lossless PNG captures
  (radial profile + axis/diagonal *sector* ratio, which is what discriminates
  a round halo from a square one) and (b) a Gemini-3.8-backed subagent
  reading the images through a vision query.
  1. **The bloom "square" was real and was entirely bloom-side.** Axis/diagonal
     sector ratio with bloom ON: **0.43** (energy biased along the quad
     diagonals, i.e. square corners) out to r≈140 px. With bloom OFF: a clean
     **1.00**, glow dead by r≈44 px. UnrealBloom resolves its coarsest mip at
     1/16 of the frame and a ~15 px HDR disc is barely one texel there. Fix:
     the sun no longer feeds bloom at all — its whole halo is carried by the
     shader (exact, radial, still one additive quad), with the raw peak at
     **2.30 < BLOOM_THRESHOLD 2.4**. Threshold untouched, so the Earth limb
     and the ISS are unaffected by construction.
  2. **`sun.frag` had no `<tonemapping_fragment>` / `<colorspace_fragment>`**
     — unlike earthSurface/clouds/atmosphere, which all end with both. The
     direct pipeline therefore bypassed ACES *and* the sRGB encode: raw
     radiance clamped at 1.0, so the disc was a flat 255 stamp and the haze
     rendered ~2x dark and desaturated (the "murky brown" halo). It also made
     the two pipelines disagree — three disables per-material tone mapping
     only while rendering into a render target (`WebGLPrograms`:
     `currentRenderTarget === null`), so OutputPass tone-mapped the sun with
     the composer on and nothing tone-mapped it with the composer off.
     Peak is now **239, unclipped**, and both pipelines agree.
  3. **The dither hash did not dither.** `fract(sin(dot(gl_FragCoord, k)) * s)`
     exceeds fp32's 24-bit mantissa at gl_FragCoord ~5e4, so the fractional
     part degenerated into correlated bands — it was *adding* structure where
     it was meant to hide posterisation. Replaced with Hoskins' `hash21`
     (multiply after `fract`), amplitude 1.6/255. Reviewed as "well-dithered,
     no distinct hard concentric rings".
  Also: the disc was **1.34°** across (2.5x the real sun; the old "~0.65°
  disc" comment described the disc's *radius*). Now 0.66° diameter on a
  0.185 rad billboard (was 0.078 — the old quad axis edge sat at ~2.2°, so
  anything wider *had* to come from bloom), with a ~0.29° e-fold glare and a
  ~2.3° knee power-law haze. PLANE_FULL_RAD in sun.frag must track
  `targetAngularSize`.
  Vision verdict after the rework: "bright central point with a tight
  Gaussian-like roll-off", "no distinct perimeter", no polygons, no moiré,
  no rings, no spikes/streaks/ghost rings; 6.5/10. Its one remaining ask was
  diffraction spikes — declined, they are explicitly banned by the brief.
  Tuning: sun constants in `sun.frag`, bloom in `Postprocessing.tsx`
  (BLOOM_*), billboard angle in `EnvironmentLayer.tsx` (targetAngularSize
  **0.185**).
- **NEW FINDING (out of scope, not fixed): the ISS planetary reticle is
  ~3 px.** `beaconRef` scales as `max(1.2, distanceKm / 6800)` on a 16 km
  plane, i.e. a *constant* angular size of ~0.135°: measured **3.06 px** at
  23,631 km (`softGlow` measures 19.06 px at the same distance, and that is
  what the eye actually reads). The SDF reticle — corner brackets + hairline
  circle + centre dot — cannot be legible at 3 px; it aliases into the
  faint 4-point cross/star the vision pass reported. Pre-existing, untouched
  by the sun work, and left alone per "don't change anything else".
- **Settings**: `settingsStore` gains persisted `postprocessing`;
  SettingsGear popover gains a Visuals section (role="switch", just "Bloom").
  (The `sunFlare` field existed briefly and was removed with the flare pass.)
- **Tests**: ShaderRamps ramp table deliberately re-pinned (new low-sun
  window 0.02–0.35 in three rows, sun disc 0.15–0.19, corona edge
  0.72–0.98; lens-ring row deleted); EarthVisualContracts gains the
  low-sun consistency pins (identical window+tint literals in ground and
  clouds; painted bands must not return). 184/184.
- Gates: tsc clean; vitest 184/184; `npm run verify` green (build included).
- Browser matrix (dev server + IAB): terminator limb (warm dusk gradient, no
  stripe), night side (bloomed city lights), day side, sun framing (compact
  star, one-sided streak occluded by Earth-disc gate, no quad edge, no bloom
  square), Follow · Locked (model visuals unchanged, flight completes with
  composer active), bloom toggle off == old pipeline, console clean, app left
  in Live with defaults restored.
- Note: two "black canvas" scares during verification were the IAB tab being
  MINIMIZED (rAF suspended → reload raced a frozen renderer). HANDOFF already
  warns foreground-only for rAF work; a dev boot-error tape
  (`window.__bootErrors`, main.tsx, dev-only) was added while diagnosing and
  kept — it captures window errors, rejections, and console.error.

## Locate under accelerated time (2026-09-29, user-reported) — FIXED + browser-verified

**Report:** "at 300× speed pressing locate button the camera tries to catch up
the ISS but fails."

**Reproduced and measured** (dev server, 300×, overview → Locate, per-150 ms
sampling of eye→ISS, pivot, target→ISS and the eye's Earth-centre radius):

| t (ms) | eye→ISS | pivot | target→ISS | eye radius |
|---|---|---|---|---|
| 2225 | 30276 | 26000 | 6810 | 26000 |
| 4826 | **6476** | 6460 | 17.7 | 8943 |
| 5377 | 5652 | 5635 | 17.7 | 7137 |
| 6381 | 6415 | 6398 | 17.7 | **6500** |
| 11621 | 13047 | 13022 | 80.4 | **6500** |

**Cause.** `CameraFlightPath.planLocate` baked the arrival point — 250 km up the
station's radial plus 250 km back along the sweep tangent — from the station
position at PLANNING time, and `sampleLocate` then flew to that fixed inertial
point. The flight lasts 2–4 s; at 300× the station covers ~2,300 km per wall
second (≈6,500 km across the flight, ~55° of orbit), so the eye arrived at the
station's OLD address — 6,460 km away instead of the intended ~353 km standoff.
Tracking then locked the target onto the live station, but the eye was far
outside and drifting inward; the moment it crossed the 6,500 km
`CameraNavigationConstraint` sphere the clamp broke the rigid eye↔target
relation, the eye was pinned at exactly 6500, and the station ran away — the
camera chased and never converged.

**Fix** (`src/interaction/camera/CameraFlightPath.ts`): the plan is kept exactly
as tuned (fixed-axis uniform sweep, same duration estimate — so 1× is
bit-for-bit the same route) and is then carried **station-relative**:
`planLocate` records the station at planning time and `sampleLocate` translates
the whole route by the station's drift since then. At progress 1 the eye is
`station_planned + standoff + (station_now − station_planned)` = the standoff of
the station as it is NOW. Translation is exact and has no singularity.

Two alternatives were tried and rejected on measurement:
- **Re-deriving the sweep plane from the live station each frame** (same
  construction as the plan). This has a sign flip: `cross(dirStart, stationDir)`
  reverses when the station's direction crosses the departure radial, and
  `applyAxisAngle` then mirrors the eye across the axis — measured as a
  **25,343 km single-step teleport** mid-sweep in the new test. Also degenerate
  (cross → 0) at exactly the antipodal crossing.
- **Predicting the station's future position at planning time.** At 300× one
  flight spans ~750 sim-seconds ≈ 47° of orbit, so linear extrapolation is badly
  wrong and a real prediction needs SGP4 inside the camera path.

**Verified (browser, 300×):** flight now ends on `pivot = 353.6 km` (the exact
250 / 250 standoff); over a FULL orbit afterwards `eye→ISS` stays within
**341–369 km** and the eye's radius oscillates **6518–7082**, never reaching the
6,500 km clamp — no escape. The 1× route is unchanged (arrival 359 km, stable,
same framing).

**Tests** (`tests/unit/camera/CameraFlightPath.test.ts`, +2 → 186/186):
- `lands on the live standoff when the station travels far during the flight` —
  proven to fail without the fix: **6,618 km** off instead of 353.6 km.
- `stays smooth while the live station drifts during the sweep` — no single
  sample step may exceed 1,500 km across a 300-sample sweep.

Gates: tsc clean; `npx vitest --run` 186/186; `npm run verify` green.

## Render settings: orbit-line style + lens flare (2026-09-29, user-requested)

Two new render-settings controls, both persisted in `orbital-settings`
(zustand's shallow merge gives older stored state the new defaults).

- **Orbit line: Dashed / Continuous** (`settingsStore.orbitLineStyle`,
  default `'dashed'`), with **screen-constant tick size**.
  The dash is `LineMaterial`'s own (`dashed: true` compiled in permanently; the
  style toggle only moves the duty cycle, so switching never recompiles the
  program), which needs the cumulative arc length per endpoint — pre-allocated
  into the geometry alongside the alpha buffer, in place, not via
  `computeLineDistances()` (which allocates a fresh
  `InstancedInterleavedBuffer` and would reopen the leak described above).
  `dashSize`/`gapSize` are set **every frame** from
  `DASH_SCREEN_PX 7` / `GAP_SCREEN_PX 6` converted to world units at the
  perspective scale measured at the pivot (the station — measuring to Earth's
  centre instead would stretch the ticks ~20× in Follow mode, where the camera
  sits 70–350 km out). So zooming in subdivides the arc into more ticks while
  the on-screen pitch holds: measured **66 → 205 dashes** and a **9.9 → 10.7 px
  pitch** as the camera came from 26,000 km to 9,000 km. The arc is one full
  period, so its far half is up to 4× deeper than the station and the ticks
  compress with distance there — correct perspective, not a defect.
  Doing the sizing on the throttled refresh (4 Hz) would let the ticks stretch
  and pop during a dolly, which is why it runs every frame. Verified: the
  geometry stays a continuous polyline in both styles (`maxGap 0`), so the
  ticks can never reintroduce the broken-connection bug fixed above.
  Spacing is uniform (~30 s of orbit ≈ 230 km per segment), so the ticks are
  even. A style change clears the refresh throttle stamps so it appears on the
  next frame rather than up to 250 ms later.
- **Lens flare** (`src/rendering/post/SunFlare.ts`, default `off`). A
  composer ShaderPass after bloom and before OutputPass: a halo centred on
  the sun plus three iris ghosts mirrored through the screen centre along the
  flare axis (warm inner, two cooler and larger outside). Added in linear
  space before tone mapping, like every other material.
  Gated per frame on the CPU: sun in front of the camera (dot guard — never
  `project()` the sun from behind, the documented mirrored-garbage trap), not
  behind the Earth (soft limb, ~1.1° penumbra), and a border fade as the sun
  leaves the frame; the shader additionally blanks everything inside the
  planet's screen disc, so the flare can never paint over the Earth. A
  disabled ShaderPass is skipped outright by the composer, so off costs
  nothing.
  **Deliberately excluded, both removed after earlier review: no anamorphic
  streak and no lens rings.**
  Because it is a post pass it only exists while the compositor does; the
  settings switch disables itself and reads "Needs Bloom" rather than being
  silently inert.
  Amplitude note: the first cut (halo 0.30/0.085, ghosts 0.03/0.02/0.012) was
  reviewed as "borders on imperceptible" — the ghosts were below the starfield
  noise. Current values are ~3x that; re-reviewed as "restrained and
  photographic… reads like real internal lens reflections rather than an
  exaggerated video-game preset", with the three ghosts landing where the
  maths puts them (39% / 29% / 18% screen width on the axis).
- **Settings UI**: the model-quality rows, the new orbit-line radio pair and
  both switches now share one `.hud-option` class in `index.css` instead of
  three copies of the same inline style object.

Gates: asset budget ✓, shader ramps ✓, `npx vitest --run` 186/186,
`npm run verify` exit 0, browser pass console-clean with an empty
`__bootErrors`.

## Pre-commit diff review + cleanup (2026-09-29)

Full review of the uncommitted visual-refresh + time-control diff (31 modified
files, 6 new, ~1,450 insertions) before the first push. Review discipline:
every finding verified against the actual source, by-design behaviour separated
from defects, nothing shipped that could not be verified on the surface it
changes.

**Applied (cleanup / optimisation / consistency):**
- **`OrbitLine.tsx` — GPU buffer leak, fixed.** `LineGeometry.setPositions()`
  REPLACES its `instanceStart`/`instanceEnd` buffers, and three frees a replaced
  attribute's GL buffer only through `WebGLAttributes.remove`, which the
  renderer reaches from `onGeometryDispose` for the geometry's CURRENT
  attributes alone (`node_modules/three/src/renderers/webgl/WebGLAttributes.js`).
  The refresh path also built a fresh `InstancedInterleavedBuffer` for the alpha
  pairs every time. At the 250 ms wall floor that orphaned ~2 VBOs per refresh,
  ~4/s, forever — invisible in the frame rate, unbounded in GPU memory. Both
  buffers are now allocated ONCE at `MAX_ORBIT_POINTS` and mutated in place;
  the live span is set via `geometry.instanceCount`. Verified in-browser: the
  buffer UUIDs are identical across refreshes and a backward seek, capacity
  219, live span 185, and the arc still moves on seek.
  **This rewrite also introduced a real rendering regression — see the
  CORRECTION at the end of this section: it wrote the polyline into a
  segment-pair buffer and dashed the line. Fixed and re-verified (maxGap 0).**
- **`sun.vert` deleted** — byte-identical to `billboard.vert` apart from line
  endings. `EnvironmentLayer` now imports the shared file, and `billboard.vert`
  documents that it does NOT billboard (orientation comes from the per-frame
  `lookAt`, which is load-bearing).
- **`periodMsOf` deduplicated** into `src/utils/orbitalTime.ts`. It existed
  twice (OrbitTape + TimeControls) with a *disagreeing* fallback (92.9 vs the
  `ISS_ORBITAL_PERIOD_MIN = 92.68` already in constants). This formula's floor
  was once scaled as seconds instead of minutes, making every scrub offset
  6.45× too large — two copies is two places to reintroduce that.
- **`OrbitTape` frame loop**: ARIA is now written at most once per whole
  second. It previously formatted a `Date` and built a string 60×/s, forever,
  for a value that can only change one second per second.
- **`TimeControls` Space shortcut**: no longer hijacks Space on controls that
  Space natively activates (button/a/summary). Previously `preventDefault()`
  ran for any non-input target, so Space on a focused button paused the clock
  instead of pressing the button — which broke keyboard activation for the
  entire HUD. Verified: Space on a focused button leaves the mode untouched,
  Space on the body still pauses, Space in a field is still ignored.
- **`SettingsGear`**: `]/**` line merge (the model-options array closer had
  fused with the JSDoc opener) and the now-stale "nothing else lives here"
  docstring.
- **`SceneRoot`**: comment still advertised an "optional sun flare" that was
  deleted after review.
- **`docs/NEXT_STEPS.md`**: the "DONE" entry still claimed a "compact ~3.2° sun"
  and "HDR bloom + lens-flare with toggles" — the flare was deleted, there is
  one toggle, and the sun is a 0.66° disc on a 0.185 rad billboard.

**Applied on explicit request (the two held-back findings):**
- **Marker pipeline parity** (`reticle.frag`, `softGlow.frag`). Two changes,
  both source-proven:
  1. They were the only two custom shaders without
     `<tonemapping_fragment>`/`<colorspace_fragment>`. three disables
     per-material tone mapping only while rendering into a render target, so
     with Bloom ON they were tone-mapped by OutputPass but with Bloom OFF they
     rendered raw — clamped, un-encoded, and measurably dimmer (peak at the
     same pose: **249.6 ON vs 201.7 OFF**).
  2. Opacity is now folded into the colour with **alpha pinned to 1**. The
     material is AdditiveBlending with SrcAlpha as its source factor, so
     `rgb * alpha` is emitted either way — but the two pipelines tone-map at
     different points (OutputPass on the linear sum vs per-material before the
     scale), so leaving the scale in alpha would tone-map BEFORE it in one path
     and AFTER it in the other. With alpha = 1 the two evaluate the identical
     expression, and the composer path is mathematically unchanged.
  After: peak parity is within a few counts (**250.9 ON vs 255.0 OFF**; and
  251.8 vs 252.4 in a second pair). A residual mean difference remains and is
  NOT a defect: the reticle and aura are concentric additive layers, and
  "tone-map the sum" cannot equal "tone-map each, then add in display space".
  Separately, with Bloom ON a nearby bright object (the Earth's limb) blooms
  and lifts the whole neighbourhood — expected bloom behaviour, not marker
  drift.
- **Tracking marker → bare glint** (`ISSModel.tsx`, `softGlow.frag`;
  `reticle.frag` DELETED). History, so this isn't re-litigated: the marker was
  a hairline circle + centre dot + corner brackets in a signal cyan, which is
  why it could never be legible — `max(1.2, distanceKm / 6800)` held a constant
  *angle* of ~0.135°, i.e. **3.06 px** measured at 23,631 km, and the circle's
  0.010-wide edge relaxed over a fifth of a pixel (hence the stair-stepping).
  It was then reworked to HUD-proportioned corner ticks in instrument white at
  0.5 opacity, which the user reviewed as "sloppy and too sci-fi" — corner
  brackets read as a tactical targeting box regardless of weight. Chosen
  replacement: **no chrome at all.**
  The marker is now a single radially symmetric glint: a tight white-hot core
  (`exp(-d²·30)`, ~7% of the quad) marking the exact point, inside a soft amber
  halo (`exp(-d²·3.2)·0.45`), tinted toward white at the core so the point
  still reads as a point when `uColor` is the cool shadow tone. Sized in SCREEN
  space at `GLINT_SCREEN_PX = 22` (measured 24.6 CSS px) instead of the old
  fixed angle, with a 0.4 Hz pulse carried over from the removed beacon.
  Opacity now fades in to 0.32 and **holds** — it used to decay to 0.15 out at
  planetary range, back when the reticle carried that range; the glint is the
  only marker now, so it has to stay findable there.
  `reticle.frag`, the beacon group, `beaconRef`, `BEACON_RADIUS_KM`,
  `BEACON_SCREEN_PX` and `BEACON_ACTIVATE_KM` are all deleted
  (`sceneHasReticle` verified false in-browser).
  Verified by vision: "no reticles, brackets, bounding boxes, rings, or
  crosshairs"; distinct whitish core against a warm halo; smooth radial falloff
  with no square edge; "reads as a radial point-source bloom / lens flare
  rather than a vector UI marker".
  **Trade-off, stated deliberately:** the removed ticks were also what made the
  marker's roll visible — the beacon used to `lookAt` the camera with world up,
  so it visibly turned as the camera orbited (which the user liked). A radially
  symmetric glow is rotation-invariant, so that cue is gone. The facing
  `lookAt` is still required (an edge-on plane would vanish); only the visible
  roll is lost. If it is missed, two short opposed ticks would restore it
  without bringing the box back.

**Reviewed, confirmed correct, unchanged:**
- `GeoLookupService`'s ACCELERATED gate, `simulationStore` seek/pause
  semantics, the interpolator's 400 km bound and re-anchoring, the
  `OrbitTape` unwrapped scrub accumulator, the `SimulationClock` comment-only
  diff, `main.tsx`'s dev boot tape, and `CameraFlightPath`'s station-relative
  sweep all check out against their tests.

**CORRECTION — I introduced an orbit-line regression and then wrongly
"refuted" the finding that caught it.**
A vision pass reported the orbit line rendering as "dashed with regular gaps".
I dismissed it on two measurements: the alpha buffer is a smooth monotone ramp
(true — adjacent step 0.0033 vs two-step 0.0065, zero alternation), and
blueness sampled along the projected polyline showed no dark runs. **That
second test was invalid**: it took a MAX over a 5×5 neighbourhood per sample,
which bridges exactly the small gaps a dash pattern produces. The user
independently reported seeing the dashes, which forced a proper check.

The real cause was my own in-place buffer rewrite. `LineGeometry.setPositions()`
converts a polyline into an **interleaved segment-pair buffer** (stride 6:
`start.xyz, end.xyz`). My rewrite wrote the polyline FLAT into that buffer, so
element k received points (2k, 2k+1) — pairing every other point and dropping
every other connection. Measured: consecutive segments were separated by a
**229.8 km gap**, exactly one polyline step (a continuous polyline has gap 0).
The tail elements also read past the written span into zeros, so the back half
of the arc drew toward the origin.

Fixed by writing the pairs explicitly (element k = path[k] → path[k+1]).
Re-verified in-browser: **maxGap 0** across all consecutive segments.
The lesson worth keeping: a max-filtered sample can never prove the absence of
gaps, and the alpha metadata being smooth says nothing about the geometry
layout.

Gates after the pass: tsc clean; `npx vitest --run` 186/186; `npm run verify`
green; browser pass console-clean with an empty `__bootErrors`.

## OrbitLine repair + glint recolor (2026-09-29, user-reported) — FIXED + browser-verified

**Report:** "I used the AI to improve the OrbitLine but it just overcomplicated
and broke it, fix it properly. Also change the ISS beacon highlight color to
light blue — I don't like golden."

**Finding: the orbit line had NEVER rendered in the tick-mask rewrite.** The
in-page diagnostic read `instanceCount: 0` and all-zero buffers. Cause: the
frame loop's tick-sizing block early-returned on `totalArc <= 0` BEFORE the
throttled path-regeneration block, and `totalArc` is only produced by a
refresh — a bootstrap deadlock, so the first (and every) refresh never ran.
Note the component also contradicted this ledger: the custom tick-mask GLSL
(`uTickPeriod/uTickLen/uTickAA`, `vArc`, hysteresis re-subdivision) was not the
documented "LineMaterial's own dash" design, and its Earth-centre depth
reference was never validated (the deadlock meant nothing ever rendered).

**Rewrite** (`src/rendering/iss/OrbitLine.tsx`, 367 → 314 lines): same
feature set, deliberately boring machinery —
- Line2 + LineMaterial, 2 px screen-space stroke, `#93C5FD`, NormalBlending +
  depthTest, `frustumCulled` off (unchanged).
- Dash is **LineMaterial's own** (`dashed: true` compiled in permanently, so
  the Dashed/Continuous toggle never recompiles; continuous = one dash
  spanning the whole arc, `gapSize` 0). This deletes the injected tick mask,
  the three `uTick*` uniforms and the re-subdivision hysteresis.
- **Kept:** the per-point alpha injection (`instanceAlphaStart/End` via
  onBeforeCompile — LineMaterial has no per-vertex alpha; past trail 0 → 0.30,
  future plateau 0.60, smooth 0.45–0.55 crossover); the allocate-once/
  mutate-in-place buffers with `instanceCount` limiting the live span (the
  verified VBO-leak fix); explicit segment-pair writes (the 229.8 km-gap fix);
  the 60 s-sim + 250 ms-wall refresh throttle with backward-seek
  regeneration.
- **Frame order fixed:** the throttled refresh runs FIRST; the dash sizing
  after it early-returns on `totalArc <= 0` — nothing can gate the refresh on
  its own output again. Dash pitch is screen-constant, sized at the STATION's
  depth (`engine.propagateAt` + `temeToWorld` per frame, Earth-radius
  fallback) — 7 px dash / 6 px gap, the documented values; measuring at
  Earth's centre would stretch the ticks ~20× in Follow mode.

**Glint recolor** (`ISSModel.tsx` + `softGlow.frag`): sunlit marker
`#FFD580` (amber) → `#A8D8FF` (light blue); shadow `#80D0FF` → `#6FAEE0`
(deeper blue, so the day/night cue survives). The softGlow core tint target
changed from warm white `(1.0, 0.96, 0.90)` to cool white `(0.90, 0.95, 1.0)`
so the white-hot core doesn't go warm against the blue halo. Comments updated.

**Verified (browser, dev server 5190 + IAB):**
- Line renders: 185 live segments, **maxGap 0** across consecutive segments
  (continuous polyline in BOTH styles), alpha ramp sampled 0 → 0.432 → 0.60,
  arc end 42,497 km (one full period), dash:gap = 7:6 px ratio live.
- Dashed → Continuous via the gear popover: `dashSize` becomes the full arc
  (42,497), `gapSize` 0, arc visibly one unbroken stroke; switched back to
  Dashed and re-verified. **Default changed to `'continuous'` on the user's
  follow-up request** (`settingsStore.orbitLineStyle` initial value; a stored
  `orbital-settings` key from before still wins over the default, by design),
  and the popover radio pair reordered to Continuous first (SettingsGear
  `ORBIT_LINE_OPTIONS`).
- Sun-frame shot: compact blinding white disc + tight warm glow, no square,
  no streaks/rings — the resolved sun design is untouched by this work.
- Glint at 0.32 full opacity: live uniform `#a8d8ff`, reads as a white-blue
  point on the arc (the core is white by design; the halo is light blue).
- Console clean (`__bootErrors` empty) across the whole session; app restored:
  Live, home view (Reset completed, button hidden), default settings.

Gates: `tsc --noEmit` clean; `npx vitest --run` 186/186; `npm run verify`
exit 0.

**Lens flare re-landed (2026-09-29, user-confirmed) — LEDGER CORRECTION.** The
"fresh start" entry above says the flare pass was "DELETED entirely"; that was
true of that moment but NOT of the state that shipped — a later same-day pass
re-added it, and the user has now confirmed the re-add was deliberate ("the
lens flare was added but didn't update in progress. do not delete it,
although it must be improved later"). Current tree, verified by source read:
- `src/rendering/post/SunFlare.ts` — a composer `ShaderPass` seated after
  bloom and before OutputPass (added in linear space, tone-mapped with
  everything else; a disabled pass is skipped outright, so off costs
  nothing). Warm halo (#ffc27a; `exp(-d·6)·0.55 + exp(-d·1.6)·0.14`) plus
  three iris ghosts mirrored through the screen centre along the flare axis
  (0.45/0.85/1.30 radii; one warm, two cool #9fc4ff, widening and fainting
  outward). Deliberately excluded after earlier review: no anamorphic streak,
  no lens rings.
- Per-frame CPU gating in `update()`: behind-camera dot guard (never
  `project()` the sun from behind — the documented mirrored-garbage trap),
  Earth-disc occlusion with a ~1.1° limb penumbra, a frame-border fade, and a
  shader-side Earth-disc mask so it can never paint over the planet;
  `uStrength ≤ 0.002` early-outs to an untouched texture copy.
- Wiring: `Postprocessing.tsx` seeds the pass's enabled state from the store
  when the composer builds and toggles `pass.enabled` on setting changes (no
  rebuild); `settingsStore.lensFlare` (persisted, default **off**); the gear
  toggle is disabled while Bloom is off, since a composer pass cannot exist
  without the composer.
- Status: landed, default off. **OWED: an improvement pass** (user
  directive). Not yet browser-exercised in this session with the toggle ON —
  fold that verification into the improvement pass.

## Performance / optimization run — OWED (2026-09-29, user-reported, NOT STARTED)

**Report:** "after all today's work the entire app feels a little heavy and
laggy, so we need to do an optimization and performance run later sometime."

Today's landed stack is the suspect list: the EffectComposer (full-frame
render + UnrealBloom mip chain + OutputPass every frame), the lens-flare pass
(default off), the rebuilt sun/glow additive quads, the Line2 orbit line with
per-frame dash sizing (one SGP4 `propagateAt` per frame), and the time-control
frame work. Nothing has been measured yet — the run must be **measure-first**:
baseline frame times (p10/p50/p90) at Follow / orbital / planetary zoom,
crossed with Bloom on/off, flare on/off, and model quality, recorded here
BEFORE any change; then targeted cuts (candidate order and constraints in
`docs/NEXT_STEPS.md` item 0 — dpr clamp, composer target options, half-res
bloom, OrbitLine propagate caching). Constraints: verified visuals must not
regress; Bloom OFF must remain bit-for-bit the old pipeline; any asset
batching inherits the Phase D constraints below. Gate: a before/after
frame-time table plus a console-clean browser pass.

## Remaining work (not started, plan order)
- **Phase D** — animation-safe rigid batching: **POSTPONED by user decision
  (2026-09-28)** — "only very slight benefits in performance" weighed against
  the risk/complexity. Nothing was implemented; constraints for a future pass
  are recorded by the user: nothing that CAN plausibly be animated later may
  be merged (all major animatable hardware and anything whose motion a user
  could notice stays untouched), existing animations must not break, and the
  pre-phase-D asset is preserved as an instant rollback point at
  `.tmp-iss-build/iss_igoal_pre_phaseD_backup.glb`
  (sha256 870ef11d…5caf3da0, byte-identical to the shipped asset at wrap-up).
  Baseline draw calls (close range, Follow): ~16 visible calls at the
  measured camera pose — the expected batching win was modest at normal
  viewing distances, reinforcing the postponement.

### Phase F — clearance + discontinuous pose (plan §5.F) — LANDED + browser-verified
- `ISS_MODEL_CLEARANCE_KM = 70` (CameraStateMachine.ts): conservative swept
  envelope measured on the rebuilt asset (8-corner half-diagonal 67.6 units;
  animated sample max 67.91). Replaces the half-span-60 guess that permitted
  an eye position exactly on a P6 2B array edge. Consumers agree:
  `CAMERA_ZOOM_RANGES.INSPECT.minDistance`, SceneRoot (already derives from
  the same constant), CameraSensitivity close-range calibration,
  types/camera.ts + ISSModel.tsx comments.
- `OrbitalRenderInterpolator`: discontinuity detection — a snapshot step
  beyond 50 km (absolute) or the physically-plausible speed×Δt bound reseeds
  translation instead of blending a chord through Earth; ordinary 10 Hz
  motion (incl. 120×) stays smooth.
- `ISSGroup`: degenerate-frame guards — near-zero nadir×velocity cross
  products keep the previous attitude instead of normalizing garbage.
- Tests: 3 new interpolator fixtures (antipodal snap, quarter-orbit
  stay-on-orbit, continuous-after-seek), clearance contract test (INSPECT
  floor ≥ 67.91 measured bound), updated isFreeZoomOut literals.
- Browser-verified: dollyTo(30) clamps to 70; half-orbit seek keeps all 90
  sampled frames at 6,803 km (defect was 2,253 km), quaternion valid.

### Phase E — selection lifecycle (plan §5.E) — LANDED (R2–R4)
- `loadingStore` rewritten as the single lifecycle authority:
  `{ status, quality, attempt, activeQuality }` with attempt-guarded
  transitions (stale commit/fail/preparing ignored) and terminal
  'unavailable'. No parallel legacy status path remains.
- `ISSModel`: selection orchestration effect (identify on mount — no startup
  load; begin on selection/quality change; nonce clears demotion, automatic
  demotion survives); committed model (`activeQuality`) stays mounted and
  visible while a different candidate prepares (E.4, no Model-A flash);
  Model A moved into `FallbackISSModel` behind a local error boundary (R4).
- `CameraController` (R2): the Locate departure gate now runs ONCE at flight
  acquisition — after departure, selection changes swap models in the
  background while the captured path and horizon continue (mid-flight stall
  fixed).
- `CameraCluster` + `SettingsGear` (R3): HUD discloses the EFFECTIVE quality
  ("Low detail" while legacy is committed, "ISS unavailable" when terminal);
  the gear popover shows the effective fallback; `selectionNonce` makes
  re-selecting High (even unchanged) observable so it clears a demotion and
  retries High.
- Tests: `ISSModelLifecycle.test.ts` (9 cases: stale-attempt immunity,
  commit-adopts-own-quality, committed survives pending replacement and
  failure, nonce bump on same-value reselection, unavailable-vs-failed
  distinction, prewarm no-op during preparation).

### Browser fault-injection matrix (plan §7, dev-server fetch stub)
- `?failAssets=<substrings>` DEV hook in main.tsx (fetch → 503).
- **High 503** → demoted to Legacy, legacy committed (`ready`,
  activeQuality 'legacy'), HUD "Follow · Low detail" ✓
- **Reselect High while still failing** → nonce cleared the demotion, High
  re-attempted (attempt 3→5), re-demoted to Legacy ready (correct given the
  failure persists) ✓
- **Mid-Locate switch** → flight completed to "Follow · Low detail"; no
  "Locating ISS" stall (R2 fix verified) ✓
- **Both detailed fail** → Locate completed to Model A ("Follow · Locked",
  busy false) ✓
- **Model A fails (R4)**: terminal 'unavailable' is implemented (store action
  + unit tests + HUD branch) but its BROWSER injection exposed an upstream
  drei/fiber quirk: a failed suspense preload neither resolves nor throws, so
  the manager-level onError hook (DefaultLoadingManager.onError →
  markISSUnavailable) was added to catch it — its firing was NOT confirmed in
  the live browser before wrap-up (dev-server/browser-suspend environment
  issues; user called the scope). Left as implemented-and-unit-tested; if
  this state ever matters in practice, verify with a stable browser session.

### New finding (2026-09-27, user-reported, OUT OF plan-001 scope)
- **Nauka (MLM) hull renders dark/black.** Real Nauka is cream-white
  (photo-verified against NASA/Commons imagery). In the asset, the MLM hull
  mesh (`MLM_1`, material `MLM`) has large UV islands landing on black
  texels of `MLM_Diffuse.png` (UV-overlay verified; V-flip inversion ruled
  out as the sole cause — flipped mapping lands on solar-panel texels,
  equally wrong). Normals, winding, alpha, and the normal map are all valid.
  This is source-art/UV-placement damage inside the FBX, present in the
  standalone inspector (no app code involved), and predates the repair (the
  removed silver override never touched MLM). Fix would be the same class
  of build-time work as `splitRadiatorPanels` (re-map the hull islands to
  the tan НАУКА texels) — needs its own scoped decision; do not improvise
  runtime material overrides for it.
- **DECISION (2026-09-27, user): ACCEPT the current appearance.** The user
  is satisfied with the model as shipped and explicitly does NOT want a
  rebuild attempted for this. Do not touch the Nauka hull UVs/materials
  without a fresh, explicit user request. Notes for whoever revisits it:
  the candidate pipeline already protects the shipped asset (invalid
  candidates are rejected before publication — covered by
  ISSModelBuild.test.ts), the current shipped GLB can be byte-backed up
  before any attempt, and the defect reproduces identically from the source
  FBX on every rebuild, so leaving it unfixed is stable, not fragile.

## Verification snapshot

- `tsc --noEmit` clean. `npx vitest --run` → 154/154 (125 prior + 14 build
  contract + 29 kinematics). `node --check` passes on all three scripts.
- Check-only manifest on the CURRENT (pre-rebuild) shipped asset exits 1 as
  designed (6 frames + WebP) — flips to exit 0 after the Phase C rebuild.
- Shipped `public/models/iss_igoal.glb` is UNCHANGED so far (byte-hash guard
  covered by tests); candidate rebuild pending.

## Independent engineering pass (2026-10-03) — LANDED + browser-smoked

Audit across core, rendering, camera/UI, and tooling; every finding vetted
against source before change. Landed:
- `SimulationRuntime.run`: a throwing `step()` no longer kills the 10 Hz chain
  (logged, scheduling continues; regression test added).
- `GeoLookupService`: a cell cached with `placeName: null` after a failed place
  fetch (weather succeeded) is retried once per session instead of pinning "—"
  for the 30-day place TTL (regression test added; geo store reset per test).
- `OrbitTape`: target carried forward at the sweep rate between 1 Hz
  measurements — at 300× the marker previously lagged tens of degrees and
  snapped 72°; browser-measured ≈0.05 rev/s, no snaps. Trail visibility uses a
  rate-scaled threshold with hysteresis (82% on at 300×, was 42%). Multi-touch
  no longer hijacks a scrub. Header comment corrected: Play after a scrub from
  Live re-pins to the wall (store contract, unchanged).
- `TimeControls`: held Space no longer strobes pause (`event.repeat` guard).
- `CameraController`: listener teardown removes from the captured controls
  instance (the shared ref is already null at unmount); Locate departure gate
  bounded at 8 s so a stalled GLB fetch cannot freeze the view.
- `Postprocessing`: bloom/flare/output passes disposed on composer teardown
  (EffectComposer.dispose frees none of them — ~7 MB GPU per Bloom toggle at
  1080p); redundant bloom `setSize` removed. `RoomEnvironment` disposed.
- `SceneRoot`: `EarthGroup` wrapped in `CanvasErrorBoundary` — a texture
  failure no longer replaces the whole app with the crash screen.
- `OrbitLine`: dash sizing reads the latest 10 Hz snapshot instead of a
  per-frame SGP4 propagation + allocation (perf-run suspect from item 0).
- `ISSModel`: glint pulse on wall time (strobed at ~120 Hz under 300×); body
  frame comments corrected (+Y = −orbit normal, as built in ISSGroup).
- Dead code removed: `prewarmingComplete` path, `REPLAY` clock mode,
  `DRIFT_DETECTED`/`clear()`, `ApiRateLimiter.msUntilNext/reset`,
  `InterpolationService.reset`, `SimulationClock.dispose`, unused math helpers,
  `formatUtcClock`/`formatKilometers*`, camera type scaffolding; tautological
  ShaderRamps block deleted.
- `api/tle.ts`: already-aborted request signal propagated to upstream racers.
- Tooling: `engines.node >=20`, `chunkSizeWarningLimit: 800`, baseline
  security headers in `vercel.json`. Comment fixes (GMST units, nlerp, geo
  limiter provider, formatter example, mirror source label).

Not changed (judgment): CSP (Google Fonts + three external APIs need a tuned
policy and a live-deploy check), ESLint/CI, untested frame-math modules,
packaged fallback TLE (10 days old — refresh at release), Nauka hull (user
decision), Phase D (postponed). The measured perf run in item 0 is still owed.

Gates: `npm run verify` exit 0 (182 tests); browser smoke on dev server —
boot clean, Locate → "Follow · Locked", Space pause, 300× tape sampling,
Bloom/flare toggle round-trips with persistence intact, no console errors.

## Follow-up pass — deferred items closed (2026-10-03) — LANDED + browser-smoked

Closes the "Not changed" list above (except Nauka hull / Phase D):
- Fallback TLE refreshed (epoch 2026-10-02T11:10:18Z) and `npm run refresh:tle`
  added (`scripts/refresh-fallback-tle.mjs`: CelesTrak → wheretheiss.at,
  line shape + checksum + catalog validated before write). Run at release.
- Fonts self-hosted (`public/fonts/`, latin + latin-ext variable woff2,
  88 KiB, counted in the asset budget); Google Fonts links removed, latin
  files preloaded. CSP added to `vercel.json` (self + wheretheiss.at,
  bigdatacloud, open-meteo; `wasm-unsafe-eval` + `blob:` workers for Draco).
  CSP is NOT exercised by `vite dev` — verify on a preview deploy.
- `typecheck` now covers tests/scripts/configs (`tsconfig.test.json`,
  `@types/node` pinned). Surfaced and fixed: unused test locals, nullable
  accessors, and an invalid `compress` option in `vite.config.ts` (`minify`).
- ESLint (flat config, typescript-eslint + react-hooks) at `--max-warnings 0`,
  wired into `verify`; `.github/workflows/verify.yml` runs verify + prod audit.
- `GeoLookupService`: one per-session sweep deletes expired `geo:` cells from
  IndexedDB (TTL was read-side only; the ground track visits every cell).
- `InterpolationService`: lat/lon (wrap-safe)/altitude/speed decay with the
  ECI offset, so HUD gauges no longer jump on a TLE swap (tests added).
- `RuntimeEnvironment`: PMREM environment rebuilt on `webglcontextrestored`.
- Settings radio groups: arrow/Home/End selection with roving tabindex
  (`ui/common/radioGroup.ts`). Escape in both popovers is scoped to focus
  inside the popover (or body) and returns focus to the trigger.

Perf baseline (item 0, first measurement): dev server, headless Chromium,
AMD Radeon iGPU (ANGLE/D3D11), default view, 599 frames — p50 16.7 ms,
p95 17.1, p99 17.4, max 18.0, 0 frames > 33 ms (vsync-capped at 60 Hz). Does
not cover 300×, close-up high-fidelity ISS, or a discrete-GPU/low-end matrix.

Gates: `npm run verify` exit 0 (186 tests, lint 0 warnings); browser smoke —
only local font requests, arrow keys move + select orbit-line radio, Escape
closes settings and refocuses the gear, no page errors.

## gcdatlas comparison pass (2026-10-03) — LANDED + browser-smoked

Read eshin087/gcdatlas (API guard, render loop, settings, input, tests, docs)
and adopted only what fits this architecture:
- `api/tle.ts`: query strings refused with a cacheable 404 (the edge cache keys
  on the full URL, so `?x=n` would otherwise bypass it and hit CelesTrak); HEAD
  supported; warm-instance memo (15 min) with in-flight dedupe (the shared race
  is decoupled from any one request's abort); stale-on-error serves the last
  good TLE with `X-TLE-Stale: 1`; upstream User-Agent.
- `settingsStore`: custom `merge` keeps only known keys with valid values, so a
  legacy/hand-edited `issModelQuality` can no longer reach `MODEL_SPECS` as undefined.
- `GeoLookupService`: no fetches while `document.visibilityState === 'hidden'`.
- `DprGovernor` + `AdaptiveDpr`: frame-time EMA, 18/28 ms hysteresis band, hitch
  (≥100 ms) and hidden frames ignored, decisions ≤1/s, ≤3 downs/ups per session;
  composer follows `viewport.dpr`.
- Camera flights: `prefers-reduced-motion` shortens flights to 0.35× (path kept).
- `vite.config.ts`: dev middleware serves `/api/tle` via the real handler.

Rejected: single-file concat bundle, ASCII/cell renderer, focus-relative
light-year camera (scene spans ~10⁵ km; float32 suffices), J2 two-body
propagation (SGP4 is already correct), reload-on-context-restore (we rebuild),
feature flags, PR-per-release/handoff docs, Playwright SwiftShader suite (deferred).

Gates: `npm run verify` exit 0 (206 tests); browser smoke on dev server —
`/api/tle` GET 200 celestrak, `?x` 404, HEAD 200 empty, POST 405; p50 16.7 /
p99 16.9 ms, DPR held at device ceiling (1.25); no console errors.

## Open-items pass (2026-10-04) — LANDED + browser-verified

Branch `feat/hardening-and-gcdatlas-pass` (not merged).

- **Nauka hull fixed (user decision reversed 2026-10-04: attempt the fix).**
  CORRECTION to the 2026-09-27 finding: the cause was NOT UV islands on black
  texels (MLM samples bright texels; 0.3% dark by area). It was baked
  per-vertex colour: `MLM` is the only material with dark `COLOR_0` (5,185
  near-black vertices; every other material's COLOR_0 is pure white), and
  three.js multiplies it into albedo. `stripVertexColors` in
  build-iss-model.mjs drops COLOR_0 from all 49 primitives (visually a no-op
  elsewhere). Rebuilt + validated; backup `.tmp-iss-build/iss_igoal_pre_nauka_backup.glb`
  (sha256 870ef11d…, the previous shipped asset).
- **BGA beta-tilt re-implemented** (user: retry, animated properly).
  CORRECTION: the 2026-09-28 attempt was never committed (no git history).
  Measured on the asset: 8 BGA nodes, masts native ±X, blanket normal ±Y,
  pivots on the mast centreline. Root cause of the old "broken" look: BGAs
  hang under the rotating SARJ, so a mount-time parent frame is wrong once the
  SARJ moves. New `bga` role: target computed in the LIVE parent frame after
  the SARJ is applied (joint order), branch kept within ±90° of the SARJ-chosen
  face, held in eclipse, slewed at 2°/sim-s AND capped at 12°/s on screen.
  Rig metadata rebuilt (12 joints). Browser: all 8 wings face the sun
  (cos 1.000); 600 frames at 300× max step 0.085°/frame; multi-day seek
  catch-up max 0.35°/frame (glide, no snap). Backup
  `.tmp-iss-build/iss_igoal_pre_bga_backup.glb` (sha256 71b5ab54…).
- **Lens flare improvement pass.** The wide corona `exp(-d·1.6)·0.14` never
  reached zero: it lifted 97% of pixels (mean +25 levels) — a veil. Replaced
  with a compact-support corona (zero beyond 0.55 frame units), tighter core,
  soft-edged iris-disc ghosts that fade as the sun leaves centre. Now 8.6% of
  pixels change, mean +2.4. Default stays off.
- **Bug found by new tests:** `ecefToGeodetic` returned negative altitude at
  the south pole (`|z|/sin(lat)` → `z/sin(lat)`). New
  `CoordinateConversions.test.ts` (16 cases).
- **Phase D: still POSTPONED** (user, 2026-10-04).
- **Playwright suite: postponed** (not installed; built-in headless browser
  sufficed for this pass).

Perf baseline (dev server, AMD Radeon iGPU ANGLE/D3D11, DPR 1, 1258×702,
vsync 60 Hz), ms:

| Scene | p50 | p95 | p99 | >33 ms frames |
| --- | --- | --- | --- | --- |
| Overview | 16.7 | 17.0 | 17.2 | — |
| Follow, High fidelity | 16.7 | 33.4 | 33.6 | 21 |
| Follow, 300× | 16.7 | 17.0 | 33.6 | 9 |
| Bloom on | 16.7 | 16.9 | 17.0 | 1 |
| Bloom off | 16.7 | 16.9 | 33.4 | 9 |

Leak checks: 5 Bloom toggles and 6 model switches leave geometries 994,
textures 74, materials 56 unchanged; heap flat/down; no console errors.
Only measurable cost: close-up High-fidelity (~5% of frames at 30 fps) —
start any optimisation there. Bloom is not the "heavy" cause on this GPU.

Gates: `npm run verify` exit 0 (227 tests, lint 0 warnings, build).

# ════════════════════════════════════════════════════════════════════════════
# Archived 2026-10-28 (docs compaction, base 27241be). Verbatim; nothing edited.
# ════════════════════════════════════════════════════════════════════════════

# From plans/PROGRESS.md — ledger entries up to 2026-10-26

### 017 V2 8K Earth (2026-10-26)

- **Sources.** The 4K maps were identified against NASA candidates at
  1024×512: day = Blue Marble NG July 2004 topo-bathy (RMSE 2.6; Aug 4.3,
  Jun 16.4), night = Black Marble 2016 (RMSE 1.9; 2012 16.1). The 8K maps
  are rebuilt from the full-resolution originals (21600×10800, 13500×6750)
  by `npm run build:earth-8k` (SHA-256 pinned; Lanczos 3; flipped for
  compressed `flipY = false`). Provenance in `public/textures/README.md`
  and `NOTICE.md`.
- **Codec** (PSNR vs the 8K master; today's 4K upscaled: 31.6 day / 33.3
  night): night ETC1S 38.2 dB, 1.4 MiB; day UASTC + RDO λ 1 + zstd 44.6 dB,
  20.5 MiB. Day ETC1S (35.3 dB, 4.1 MiB) was rejected after a magnified
  comparison: light-blue 4×4 block halos along coastlines.
- **Runtime.** `earthDetail.ts` gate (MAX_TEXTURE_SIZE ≥ 8192, fine
  pointer, no Save-Data, a compressed GPU format; dev/bench override
  `window.__orbitalEarth8k`); `useEarthDetailUpgrade.ts` starts 2.5 s after
  the Earth mounts plus an idle callback, loads both through the shared
  `ktx2Loader.ts`, uploads with `progressiveUpload.ts` (three allocates via
  `source.dataReady = false`, then ≤ 1 MiB of `compressedTexSubImage2D` per
  frame), swaps both on one frame and disposes the 4K maps' GPU copies.
- **Measured** (`npm run bench -- --earth-8k off|on`, same simulation
  time): with 8K off every row matches the A.2 baseline (the gate and hook
  cost nothing before the swap). Tracked GPU memory after the swap is
  unchanged, 525.5 MiB at overview: two 8K BC7 maps (42.7 MiB each) replace
  two 4K RGBA8 maps. Swap upload: a one-call `initTexture` stalled 27–45 ms
  per map; strips sized by measured throughput stalled 64 ms once the D3D11
  staging filled; fixed 1 MiB strips: no frame over 20 ms (ETC1S build,
  idle machine). With the UASTC day map, three repeats: load 1.8–2.2 s,
  upload 1.44 s, no frame over 20 ms (max 17.3–18 ms); three alternating
  off/on pairs put overview GPU time at 9.22 vs 8.89 ms (Bloom): no measurable
  sampling cost. Every row holds 59.9 fps after the swap. Table in
  `docs/bench/README.md`.
- Asset gates: both files are deferred assets in `check:assets` (24 / 3
  MiB caps; the check also rejects any 8K reference in `EarthSurface.tsx`);
  `.ktx2` joins the cache-busting asset build id.
- Tests: `earthDetail.test.ts`, `progressiveUpload.test.ts`,
  `earth8kBuild.test.ts`, `assetBuildId` (ktx2).

### A.2 bench harness (2026-10-26)

- `npm run bench` (`scripts/bench/`): bench-mode build (`vite build --mode
  bench`: production bundle + `__orbital*` hooks via `src/utils/debugHooks.ts`;
  production strips them), `vite preview` with the production CSP, installed
  Edge headless on ANGLE/D3D11, 1280×720 at DPR 1.5, network stubbed, the
  simulation seeked to ≥ 25 min of station daylight at 1× (`--at` pins it).
- Scenarios × Bloom on/off: overview, Follow (Locate click), Follow tape
  scrub (25 ↔ 75%, 4 s period), Inspect (wheel zoom to ≤ 130 km, full model
  ready + 5 s), Inspect scrub. Per scenario: fps, p50/p90/p99/max, frames
  > 20 ms; GPU ms per frame and per pass from timer queries cut at every
  draw-framebuffer bind and blit (`page-probe.js`); tracked GPU memory from
  every texture / renderbuffer / buffer allocation; app state (mode, DPR,
  detail model, sunlit).
- Contention guard (`contention.mjs`): refuses when another process uses a
  GPU 3D/compute engine ≥ 10% or other processes take ≥ 15% of all cores;
  samples both every second during the run and flags contended scenarios
  (`--allow-busy-gpu` to measure anyway, exit 3). The CPU half exists
  because sibling agents' SwiftShader browsers (~85% of 16 cores) stalled
  frames for 200 ms while the GPU counters read idle.
- **Baseline** (`docs/bench/baseline-2026-10-26.json`; recorded once the
  guard found the machine idle, after refusing a game at ~90% GPU and
  sibling sessions' browsers earlier that day). Radeon 780M, 1920×1080
  buffer: 59.9 fps, p99 ≤ 17.7 ms in all ten rows. GPU mean (Bloom / no
  Bloom): overview 9.2 / 12.5 ms, Follow 11.4 / 16.2, Inspect 15.3 / 16.1,
  Inspect scrub 16.0 / 16.2 (p99 20–21). Tracked GPU memory 526 MiB at
  overview, 1,081 MiB in Inspect; six 4K maps are 256 MiB. Table and
  reading notes in `docs/bench/README.md`.
- Found: wheel zoom while tracking with the clock running moves ~1% per
  tick (the station-frame carry's per-frame `setLookAt(…, false)` cancels
  camera-controls' smoothed dolly); the bench pauses the clock while it
  zooms. Open in NEXT_STEPS (item 0).
- Tests: `benchStats.test.ts` (percentiles, frame and GPU summaries, the
  counter parser, CPU contention sums, process-tree walk).

### 017 V3 the sun (2026-10-26)

- **Before.** A ~15 px disc with a faint amber haze, kept under the bloom
  threshold (UnrealBloom's 1/16 mip squares a compact HDR disc); next to the
  limb it read as a bright star, and its haze stayed above the limb after
  the disc had set.
- **Glare = a camera PSF in two scene layers** (`SunGlare.ts`). The
  billboard (`sun.vert`/`sun.frag`) draws the photosphere and a blown-out
  core ~2x the disc through one soft knee `K(1 - exp(-x/K))`, K = 2.0,
  depth-tested. A screen-space quad (`sunGlare.vert`/`.frag`, clip-space,
  no depth test, renderOrder 3) draws the halo (Lorentzian, slope 0.55) and
  six-blade diffraction spikes fixed to the screen, capped by `min(1, ·)`
  at GLARE_PEAK 0.35. Budget `2.0 + 0.35 x 1.04 + dither < 2.4`
  (`SunGlareBudget.test.ts`). Scene meshes, so Bloom off has no new pass.
- **What fades it.** `SunAppearance.apparentSunFlux`: the rendered disc
  (0.33° radius, `SUN_DISC_RADIUS_RAD`) integrated in 24 rows through the
  atmosphere toward the billboard — transmittance `exp(-tau e^(-h/8 km))`,
  tau (4, 8, 16) at tangent height 0 — so it reddens and dims over ~1° of
  sun elevation, ~15 s of real time. The photosphere uses the same
  transmittance per pixel. An `ANY_SAMPLES_PASSED_CONSERVATIVE` query on a
  probe disc (inner 60% of the sun) hides the glare behind the station
  (damped at 30/s); checked with the sun behind the Lab module (glare 0)
  and just past an array edge (full, spikes over the array). The exposure
  ratio (`exposure / 1.05`) scales both layers, and the exposure now drops
  only for the visible sun (`× sunGlareState.visibility`).
- **Sunrise band** (`atmosphere.frag`, gated by `limbProximity`, 1 at or
  behind the limb, 0 from 10° above): forward scattering toward the
  billboard (HG g 0.9 + 0.6), lit by sunlight reddened along its own
  grazing path (`hSun`; zero in Earth's shadow), density e-fold 12 km; the
  limb thread near the sun takes that light's hue. Folded into
  `(atmoColor, alpha)` so the composer gets exactly `c·a + glow`. The old
  "forward scatter" rim term was a sun-behind-the-viewer term; its comments
  now say so (code unchanged).
- **Lens flare.** Default stays off (ghosts are an optional camera artefact,
  composer-only, and the glare now carries the "blinding" read). Its halo is
  gone (it doubled the glare) and it uses the glare's visibility gate
  instead of its own Earth-only penumbra.
- **Checked.** Captures, 1280×720, dev build, Edge on the integrated AMD GPU,
  Bloom on and off: open space, 3° above, grazing, 1° and 4° behind, plus a
  limb sweep from +6° to −5° (`docs/images/sun-before-after.webp`). With the
  sun behind the camera, before and after frames are pixel-identical in both
  pipelines apart from the orbit line and station marker, which also differ
  between two runs of the old code. GPU timer queries, 1920×1080 (GPU shared
  with another process, so provisional): overlay 0.37 ms Bloom on (4× MSAA
  HalfFloat), 0.11–0.14 ms off; 0.24 / 0.08 ms at 1280×720; billboard
  0.01–0.03 ms; probe ≈ 0; sunrise branch +0.01–0.02 ms. Tests:
  `SunAppearance.test.ts`, `SunGlareBudget.test.ts`.
- **Open.** Owner sign-off against ISS photography at the limb.

### 017 X1 module explorer (2026-10-26)

- **Module map.** Derived at runtime, no asset change: a batch's module is
  its `<module>.batch.<material>` prefix (from `userData.name`; GLTFLoader
  strips the dots from `name`), else its nearest catalogued ancestor
  (camera batches → Kibo, the mobile servicing system). Both IGOAL assets
  map all 176/217 batches onto the 45 catalogue entries
  (`ModuleExplorer.test.ts`). Rotating parts are their own entries (array
  wing pairs, the two radiators) apart from their truss.
- **Explode.** The 39 hub children move along (centroid − station
  centroid) × 0.6 in the hub frame; only translations of hub children are
  written, so joint frames and pivots are untouched. Exploded, the farthest
  accessor-box corner stays inside 70 × 1.6 km (tested on both assets);
  the camera floor, the eye push-out and the shadow box (quarter steps,
  four redraws per explode) grow by the same factor. Joints park at 0 under
  the 12°/s cap and rejoin with the cap plus the target's own rate, so the
  SARJs converge at 300× too (`RigFrame.parked/snap`).
- **Highlight.** Material-reference swaps on the clone to cached emissive
  copies (same program, no compile, geometry unchanged, so the cached
  shadow stays valid); the glint blue, since a white tint vanished on the
  daylit modules; others dim while one is selected.
- **Camera.** `CameraController` tracks station + `FocusTween` point (read
  from the current explode pose through local transforms, the station's
  current attitude) before its `update(0)`; the eye is pushed out to
  clearance(explode) + |focus offset| each frame. Not a flight, so no
  takeover sync is needed.
- **Captured** in headless Edge on the owner's GPU (dev build): hover,
  card, exploding, exploded, focused, assembled, "not available" at 3,250 km.

### 017 R1–R7: responsive display (2026-10-26)

- **Audit** (scratch Playwright script, headless Edge on the owner's GPU,
  ten sizes, overview + Follow, station box from the dev hooks). Before:
  landscape-phone HUD 77% / 84% of the height; the station under the clock
  in Follow at four phone sizes; six text styles at 7–8.5 px; every control
  under 44 px. After: 26% / 28%; the station clear of every cluster at all
  ten sizes; nothing below 9 px; no coarse target below 44 px; no
  overlapping hit areas; nothing off-screen; no horizontal scroll.
- **R1** `@media (max-height: 500px)`: one bottom row, thin tape (its hit
  area runs under the row; the row passes touches through except on
  buttons), camera control left of Passes + gear in one top row.
- **R2** `HudAwareFraming.tsx` + pure `hudFraming.ts`: target shift = the
  centre of the band no HUD box covers within the centred 50% column,
  clamped to ±25% of the height; eased (τ 0.12 s) while tracking or flying
  to Follow, 0 under `H`. `camera.setViewOffset` at `FRAME_PRIORITY.viewOffset`
  (−1); the pose and frame order are untouched. `SunFlare` adds
  `viewOffsetNdc`, so the flare stays on the sun billboard.
- **R3** `--hud-fs-micro` / `--hud-fs-place` clamp() tokens; **R4**
  coarse-pointer block (padding + negative margin; 16 px inputs against iOS
  focus zoom); touch tablets in portrait take the stacked composition (the
  44 px transport row did not fit between the corner instruments at 768).
- **R5** `--hud-zoom` steps and an ultrawide `--hud-gutter` (CSS `zoom` keeps
  percentages and centring, and scales lengths; checked in Edge).
- **R6** `renderScale` setting (persisted, sanitized); `AdaptiveDpr` pins and
  re-creates the governor. Checked: 50% on a DPR-3 phone → a 360 px canvas
  at 360 CSS px; Auto → 720.
- **R7** `tests/e2e/viewport.spec.ts`; `E2E_DEV=1` serves the dev server so
  the station-framing check can read the scene hooks.
- Tests: `hudFraming.test.ts`, `renderScale.test.ts`, `viewOffsetNdc`
  (matches three's projection), `renderScale` in `settingsStore.test.ts`.

### 017 A1–A4 + P: keyboard, screen readers, About (2026-10-26)

- **Shortcuts.** `src/ui/shortcuts/shortcutRegistry.ts` (pure, unit-tested)
  + `useShortcuts` (the one global keydown handler; `useHudVisibility` and
  the Space effect in `TimeControls` folded in). Keys: Space, 1–4, 0, L, R,
  H, P, G, ?, Esc. Rules: never while typing (Escape excepted), never with
  Ctrl/Cmd/Alt, Space yields to activatable controls, repeats swallowed,
  the help overlay is modal (only ? and Esc). Letters match `key`; `code`
  only when the layout typed no ASCII character (Dvorak-safe, Cyrillic
  works). `findConflicts` also guards the keys controls own (tape arrows,
  radio arrows, Enter, Tab).
- **Overlay system.** `src/ui/overlay/` — `overlay.ts` store (one open at a
  time, `switchOverlay` chains About → help and returns focus to About),
  `useOverlay` (trigger registration, keyboard-open focus-in, outside
  pointerdown closes without stealing focus), `HudPanel` (titled dialog,
  Tab trap when modal). Settings, Passes and Set time moved onto it; their
  three copies of the outside-click/Escape effect are gone.
- **Screen readers.** Skip link → `#hud-main`; canvas wrapper `role="img"`
  described by `#scene-summary` (`sceneSummary.ts`, whole minutes); polite
  `SceneAnnouncer` (camera mode after 1.2 s settle, sunlit flips, silent when
  accelerated). The camera status label lost `role="status"` (it announced
  every Locked/Free flip); the smoke spec selects `.hud-camera__status`.
- **Contrast/motion.** `--hud-lo` 0.38 → 0.5 (3.1 → 4.7:1 on `--space`;
  `HudContrast.test.ts`). Measured in Edge, worst background pixel under each
  `--hud-lo` line: overview 4.4–4.7:1 except the tape period over the orbit
  ring (2.1:1); Follow at the limb 1.6–4.7:1. `prefersReducedMotion()`
  (`src/utils/reducedMotion.ts`) now gates the glint pulse and the flare's
  ghosts as well as flights.
- **About.** `src/ui/layout/AboutPanel.tsx`, beside the wordmark: measured vs
  illustrative, credits (keep in step with `NOTICE.md`), `__BUILD_ID__`, a
  button into the shortcut overlay.
- **Verified.** Unit: `shortcutRegistry`, `overlayStore`, `sceneSummary`,
  `HudContrast`. Playwright (Edge, real GPU): smoke specs green, 6 new.

### 017 I1 icon + manifest, I2 loading screen (2026-10-26)

- **Icon.** One parametric mark (orbit ellipse, gradient toward a glint;
  `--hud-hi` on `--space`) drawn by `scripts/build-icons.mjs`
  (`npm run build:icons`, sharp): `favicon.svg` (size-optimised, no sparkle
  rays), `favicon.ico` (16/32/48 PNG frames), `apple-touch-icon.png` (180,
  full bleed), `icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
  (mark scaled 0.82 to sit inside the 80% safe zone). `favicon.png` removed.
  `index.html`: icon links, manifest, `theme-color` #020409,
  `color-scheme: dark`. `vercel.json`: 1-day cache for icons, manifest
  served as `application/manifest+json`; CSP unchanged (same-origin).
- **Loading screen.** Stages: data link (bootstrap promise settled →
  `telemetryModeVisual` label and dot), Earth (`/textures/`, incl. the star
  map) and station (`/models/`, `/draco/`, `/basis/`, GLTF blob textures),
  counted per distinct URL from `DefaultLoadingManager` item hooks. The gate
  is assets only (the link never blocks: the bundled TLE propagates
  meanwhile). Static first-paint copy in `index.html`; the React screen
  carries the shell's animation clock over (`bootShell.ts`). Reduced motion:
  glint parked at the icon position, no fade.
- **Measured** (local production builds of `main` and this branch, headless
  Edge, 12 Mbps / 80 ms, cache off, one run each): first contentful paint
  840 → 520 ms (388 ms with reduced motion); the old build was blank at
  0.3 s, the new one shows the stages. Assets still settle in ~5–7 s on that
  link (unchanged; same files).
- **Tests.** `tests/unit/ui/bootProgress.test.ts` (classification, repeat
  starts, growing totals, failures, the gate), `bootMarkSync.test.ts`
  (index.html, CSS offset-path and the icon script share one geometry); e2e
  waits on the `progressbar` named "Loading".
- **Open.** `og-image.png` still shows the old wordmark treatment; refresh it
  with the name decision (I3).

### 017 V1 close-range clouds (2026-10-26)

- **Cause.** `clouds.frag` uses map density directly as alpha (no coverage
  threshold to smooth); the blocks and staircase were bilinear magnification
  of the 4096×2048 map (~10 km per texel) once a texel spans tens of pixels.
- **Fix.** `src/rendering/shaders/cloudDensity.glsl`, included by both
  `clouds.frag` and `earthSurface.frag`: a cubic B-spline (four bilinear
  taps, `textureLod` level 0) when magnified, blended in over 1–2 px per
  texel; a zero-mean multiplicative fBm, `d·(1 + s·n·(1 − d))`, in the
  deck's rotating frame (`vCloudDir`), faded in by camera altitude
  (3,500 → 1,200 km) and per octave by pixel footprint. The surface shadow
  uses the same function with two octaves (replaces the five-tap blur) and
  samples without `fract()`. `CloudLayer` gained the `cloudTexelSize` uniform.
- **Evidence.** Before/after at 800 km and 300 km over the day side and the
  overview (Playwright + Edge, camera placed with `__orbitalControls`): no
  texel edges at 300 km, overview pixel-identical apart from star twinkle.
  GPU timer queries per pass changed within noise (cloud ~0.7 ms at 300 km);
  provisional, the GPU was shared. Contract test: both shaders read the
  shared field (`EarthVisualContracts.test.ts`).
- **Open.** V1.3 (higher-resolution source) stays with V2 / D.8.

### C.5 changelog and Dependabot (2026-10-26)

- `CHANGELOG.md`: Keep a Changelog; no version tags, so each section is the
  date a change reached `main` (UTC+5:30). PRs add lines under "Unreleased";
  the merger renames it to the merge date. Built from git history, the merged
  PRs (#1–#30) and this ledger. Linked from `CLAUDE.md` and the README.
- `.github/dependabot.yml`: npm and GitHub Actions weekly (Monday), 7-day
  cooldown. npm minor + patch grouped into one PR. Major bumps ignored for the
  deferred migrations (react, react-dom and their types, R3F, drei, Vite,
  `@vitejs/plugin-react`, satellite.js) and `@types/node` (Node 22 floor);
  three and `@types/three` take patches only, because every rNNN is a 0.x
  minor bump. Actions are grouped; SHA pins and `persist-credentials` stay.
- Checked: the file validates against the SchemaStore `dependabot-2.0` schema.
  Not yet seen: a first Dependabot run (it starts once this is on `main`).

### Roadmap 017: display, visuals and polish (2026-10-26)

- Viewport audit (nine sizes, 360×640 to 3440×1440, overview and Follow):
  no overlaps, nothing off-screen, no horizontal scroll; but landscape phones
  get the full desktop HUD, portrait framing puts the station under the
  clock, text down to 7 px, touch targets down to 23×15 px, and the HUD does
  not scale up on QHD/ultrawide.
- Captures: clouds blocky at 800 km and stair-stepped at 300 km; the sun reads
  as a small bright star by the limb; the dashed orbit looks right (its code
  is the issue).
- Plan: `plans/017-display-visuals-polish-roadmap.md`; NEXT_STEPS' ranked list
  now follows it.

### 017 V4: dashed orbit in the shader (2026-10-26)

- **Before.** `OrbitLine` sized `dashSize`/`gapSize` every frame from the
  camera-to-station distance and kept a dash origin plus an absolute
  `dashOffset` so the pattern would not crawl (PR #15). Pitch was constant
  only at the station's depth: at Follow 250 km it ran 16 → 7 px from the
  near to the far end of the arc.
- **Now.** Each vertex carries its orbital phase (`OrbitPhase.ts`,
  revolutions of the mean motion at the vertex epoch, relative to a whole
  revolution so float32 holds it). The fragment shader
  (`shaders/orbitDash.glsl`) picks 2^n dashes per revolution from the
  phase's screen-space derivative (13 CSS px target, n ≤ 17) and crossfades
  neighbouring levels. A point on the ring keeps its phase in every arc, so
  the pattern cannot crawl and there is no state; the time phase was chosen
  over the geometric argument of latitude because the node precesses
  (~0.26 km relabel per refresh). Phase rides in LineMaterial's
  `instanceDistance` slots (USE_DASH kept for the endcap discard); style is
  the `orbitDashed` uniform.
- **Measured** (dev server, headless Edge on the AMD iGPU, frame captures):
  fixed camera on the future arc, along-track shift 0 px (correlation
  ≥ 0.987) after seeks of +61/+130/−70 s, a tape scrub, 1× and 300×
  (18 sim-minutes); pitch 13 px there and 11–13 px along the Follow 250 km
  arc; 0 programs linked over Dashed → Continuous → Dashed with Bloom on and
  off; DPR 2 pitch ~35 device px (CSS-sized).
- **Tests.** `tests/unit/orbital/OrbitPhase.test.ts`: one revolution per
  period, whole-revolution origin, [0, 2) range, and the same epoch gets the
  same float32 dash fraction (finest level) from arcs regenerated at
  1×/300×/scrub/backward-seek offsets.
- **Look.** Same colour, width, fade and 7/6 duty. What changed: the far arc
  no longer shrinks to dots, and zooming fades dashes in and out at octave
  steps instead of rescaling them.

### Orbit-tape scrub while tracking (2026-10-26)

- **Symptom.** Dragging the orbit tape in Follow or Inspect: the view swung
  around the station and the station stuttered against Earth.
- **Measured** (dev hooks: camera offset in the station's orbital frame,
  per-frame station step; production frames every 100 ms):
  - the camera offset's along-track component went +0.39 → −0.15 over a
    ~10-minute scrub — tracking kept an inertial offset while the LVLH
    frame turned; half an orbit would put the camera under the station;
  - per-frame station steps of 0–340 km while the clock moved evenly —
    10 Hz snapshots alternating blend and snap (400 km reseed bound), while
    the Earth reads the clock every frame;
  - the attitude eased after every >5° step.
- **Fix.** `StationFrameCarry` rotates the eye and `camera.up` with the
  station's attitude change while tracking (reset during flights); a paused
  clock propagates at its own time each frame (`snapTo`) and snaps the
  attitude (`AttitudeFollower.snap`); shadow redraws are capped at
  `SEEK_MIN_INTERVAL_MS` (150 ms) while seeking.
- **After.** The same half-revolution scrub keeps the limb in place with the
  ground flowing underneath; Follow scrub 60 fps; shadow redraws during an
  Inspect scrub 57 → 31 per 3.5 s. Tests: `StationFrameCarry.test.ts`
  (framing preserved across uneven steps and a half-orbit seek),
  `AttitudeFollower.snap`, `snapTo`, the seek redraw cap.

### B.3 visible passes (2026-10-26)

- **Prediction.** `src/core/orbital/PassPredictor.ts`: SGP4 every 30 s over
  48 h of simulation time; visible = ISS elevation > 10° (`ecfToLookAngles`),
  ISS sunlit (`isSunlit`, penumbra midpoint) and Sun < −6° at the observer
  (the TEME Sun direction rotated by the same GMST). Edges bisected to 1 s,
  peak by golden-section search, compass bearings at start/peak/end, flags
  for in-progress, starting from shadow and ending in shadow. ~11 ms per
  observer; runs in `passes.worker.ts` with a main-thread fallback
  (`PassService.ts`), recomputed on a new TLE or observer, a backward seek,
  or after 6 h of window slide.
- **Check.** Skyfield 1.55 (de421), same TLE and conditions at 1 s: the
  same 8 passes over London, New York, Sydney and Tokyo, edges within 4 s,
  peaks within 1° — frozen as known answers in `PassPredictor.test.ts` with
  the TLE embedded.
- **Observer.** Offline city search over Natural Earth 10m populated places
  (`scripts/build-city-index.mjs` → `src/data/city-index.json`, same pinned
  commit as the place index; lazy hashed asset), typed coordinates
  ("51.5, -0.12", "33.87S 151.21E"), or browser geolocation
  (`Permissions-Policy` `geolocation=(self)`). localStorage only, sanitized
  on read.
- **UI.** `src/ui/common/PassesPanel.tsx`: "Passes" beside the gear;
  combobox with keyboard support; up to 6 passes with local date and time,
  lead time, duration, peak, path; "Watch" seeks 30 s ahead and plays at 1×.
  Phone fixes on the way: popover fine text was hidden by a ≤900 px corner
  rule; the corner row now sits under the camera reticle.
- **Verified** in headless Edge against the production-header preview:
  search, Enter, Watch (clock moved to 30 s before the pass), coordinates,
  geolocation with a granted permission, 390 px phone layout; no CSP
  violations.

### Docs pass + live re-check (2026-10-25)

- README rewritten for a public reader: a primer on what the view shows, a
  Mermaid pipeline diagram, a controls table and four live-site screenshots
  (`docs/images/*.webp`, 28–54 KiB each, outside `public/` so they never
  ship with the app). NOTICE lists the Basis transcoder.
- Live re-check (NEXT_STEPS item 1) passed: endpoints, cache headers, a
  console free of CSP violations, IGOAL at Locate, 60 fps on the owner's
  integrated GPU. The human visual pass remains open.

### Place names: BigDataCloud → offline Natural Earth index (2026-10-25)

- **Symptom (live only).** Every BigDataCloud request logged a `connect-src`
  violation for `https://api-bdc.io/data/reverse-geocode-client?...`; the
  "Passing over" place lookup always fell back.
- **Cause.** `GeoLookupService` calls `api.bigdatacloud.net` — still the host
  BigDataCloud's docs and its own JS client use — but it now answers 307 →
  `api-bdc.io` (verified with curl). CSP checks each redirect hop, and
  `connect-src` allowed only the first host.
- **Policy.** Allowing the redirect host would have fixed the console, but
  BigDataCloud's fair-use policy allows the free client endpoint only for
  the calling device's own, current location (violations are IP-banned,
  402). The ISS ground point is not that.
- **Fix.** Place names are offline. `scripts/build-place-index.mjs` turns
  Natural Earth v5.1.2 (pinned commit, public domain) 1:50m countries and
  marine polygons into `src/data/place-index.json` (DP-simplified at 0.02°,
  0.01° delta-encoded, ~490 KiB); `src/core/geo/PlaceIndex.ts` does the
  point-in-polygon lookup (bbox prefilter; land, then the most specific
  water body; lake/river holes and border slivers → the country; coastal
  gaps → nearest water within 3°; Russia split at 60° E).
  `GeoLookupService` fetches the index once as a hashed `/assets/` file and
  takes an injectable `PlaceResolver`; its IndexedDB prefix is now
  `geo_v2_`, and BigDataCloud-era `geo_cell_` rows are pruned. Both
  BigDataCloud hosts left `connect-src`; Open-Meteo is unchanged.
- **Found on the way.** idb-keyval throws synchronously when IndexedDB does
  not exist; `_persistCell` let that turn a good answer into a failure (30 s
  backoff, HUD not updated). Guarded.
- **Tests.** `ConnectSrcCsp.test.ts`: `connect-src` must equal the external
  hosts in `src/` plus known redirect targets (it failed on the CSP before
  this change). `PlaceIndex.test.ts`: known answers, specificity, the Urals
  split, gap snapping, and a 0.5° sweep of the whole ISS band with no
  unnamed point. Geo service tests inject the resolver, and one runs the
  default resolver against the real index (only Open-Meteo is fetched).

### Follow flicker + Bloom frame rate (2026-10-25)

Measured on the live site with the owner's GPU (AMD Radeon integrated,
headless Edge on D3D11, 1280×713 CSS at DPR 1.5, Follow · Locked, daylight).

- **Flicker.** 74 of 794 frames dropped the station's mean luminance ~10%
  for one frame: the solar arrays went black. Not tied to shadow redraws.
  Cause: R3F runs equal priorities in subscription order, children first;
  `ISSModel` (child of `ISSGroup`) aimed the sun's shadow camera at the
  previous frame's station position. The cached map then sat offset by one
  frame's step, which varies 0–160 m (texel 68 m), so on uneven frames the
  thin arrays self-shadowed. Fix: `ISSGroup`'s `useFrame` at priority −2
  (`framePriority.ts`). After: 0 dark frames in 895 (same detector, uneven
  frame times from per-frame readback). Shadow redraws also fell from ~37 to
  4 per 8 s — the lagged attitude had jittered the joint angles past the
  0.15° redraw threshold. Test: `StationShadow.test.ts` (aligned at the
  current pose, >2 texels off one frame behind; priority order).
- **Frame rate.** Bloom on: 56.5 fps, 28 frames > 20 ms in 8 s; Bloom off:
  60. Timer queries: 18.5 GPU ms/frame — scene into the 4× MSAA HalfFloat
  target, a color+depth resolve, the bloom blend drawn back into that MSAA
  target, and a second resolve. `MultisampleRenderPass` renders only the
  scene multisampled (color-only resolve, `resolveDepthBuffer = false`) and
  copies once into single-sample composer targets. After: one resolve,
  16.6 GPU ms, 60.0 fps with 0 frames > 20 ms in all four Bloom/Shadows
  combinations. Test: `MultisampleRenderPass.test.ts` (contract only; no GL
  in unit tests).

### Live IGOAL outage: KTX2 transcoder vs CSP (2026-10-25)

- **Symptom (live only).** Locate waited the 8 s gate and flew to Model A;
  the "High fidelity" spinner never finished. `iss_igoal_locate.glb` and
  `/basis/*` all returned 200.
- **Cause.** Live console: four `EvalError`s ("'unsafe-eval' is not an
  allowed source"), one per KTX2Loader worker. three's Basis glue (embind,
  DYNAMIC_EXECUTION=1) generates invokers with `new Function`; blob: workers
  inherit the page CSP; the worker's init promise never resolves, so every
  texture task — and the GLTF parse, and the Suspense — stayed pending.
  `vite preview` sent no CSP, so it never reproduced locally.
- **Fix.** `scripts/patch-basis-transcoder.mjs` (`npm run patch:basis`)
  rewrites the two code-generation sites to closures (Emscripten's
  DYNAMIC_EXECUTION=0 shape); the CSP is unchanged. KTX2 texture loads are
  stall-guarded (30 s → load error). GLTFParser resolves a failed texture to
  null and still finishes the model, so detail preparation now fails any
  model with missing textures (`countMissingTextures`) → ladder → legacy,
  never a grey IGOAL. `vite preview` now serves the `vercel.json` catch-all
  headers.
- **Tests.** `BasisTranscoderCsp.test.ts` runs the glue in a V8 context with
  string code generation off: stock three fails, the shipped glue transcodes
  a real texture from the LOD bit-identically to stock, and `public/basis/`
  must equal the patched three copy. `LoadStallGuard.test.ts` covers the
  bound. Headless Edge against the CSP-enforcing preview: IGOAL at Follow,
  no spinner; with the stock glue swapped into `dist/`, the attempt fails at
  30 s and demotes to legacy.
- **Follow-up: version the transcoder.** After the deploy, a browser that had
  loaded the site in the previous hour still got the stock glue from its HTTP
  cache (`/basis/` was `max-age=3600, stale-while-revalidate=86400`, fixed
  file names). The KTX2Loader now has its own `LoadingManager` whose URL
  modifier appends `?v=<__BASIS_ID__>` (content hash of `public/basis/`,
  `vite.config.ts`) to the transcoder files only — never to the blob: texture
  URLs (`basisTranscoderUrl.ts`, tested). `/basis/` is now `immutable` like
  `/models`; `.gitattributes` pins the glue to LF so the id is identical on
  Windows and Vercel.

### Parked model items, re-opened (2026-10-25)

- **Rigid batching (plan 001 Phase D) landed.** `batchRigidMeshes` merges
  static geometry per (rigid part × module × material): 993 → 217 draw
  primitives on the full model, 438 → 176 on the LOD, 703 → 294 nodes; the
  files also shrank (full 24.2 MB, LOD 5.5 MB brotli). Joints and cameras
  turn exactly what they did (the rig simulation passes on the batched
  assets); mirrored parts keep their facing (unit test); identical-view
  renders differ only by sub-pixel edge shifts.
- **Attitude lag at 300× fixed.** The station's attitude slerped toward its
  LVLH target and trailed it by rate ÷ stiffness (~12° of pitch at 300×).
  `AttitudeFollower` now follows the target exactly and eases in only jumps
  (first capture, seek, TLE swap); the interpolator blends velocity like
  position so the target turns every frame instead of stepping at 10 Hz.
- **Hidden detail model's matrix updates**: measured 0.03 ms/frame on the
  batched assets (512 objects) — closed, no change.
- **Self-shadowing landed.** The sun light casts a 2048² PCF map fitted
  to a ±70 km box around the visible station (the light follows its target,
  aimed at the station each frame). The map is cached and redrawn only when
  the sun in the station frame or a joint moves 0.15° (≥ 50 ms, ≤ 2 s apart),
  about once every 2 s at 1×. Setting "Shadows", default on.
- **Re-reviewed, kept** (reasons in `docs/ISS_MODEL_CONTEXT.md` §9): the
  TRRJ law (daylight edge-on is the published autotrack; eclipse
  face-to-Earth is the freeze-protective pose), the radiator coating (the
  geometry already has the 8 panels per wing; real face sheets are uniform
  white), Canadarm2/ERA (no driveable ERA node; the arm's real pose is a
  per-operation park), meshopt (download would grow ≈ 9 MB).

### ISS animation audit (2026-10-25)

The rig was measured instead of eyeballed: the per-frame step moved out of
React into `ISSRigAnimator.ts`, the attitude into `stationAttitude.ts`, and
`ISSRigSimulation.test.ts` flies the published assets through real orbits.

- **Correct, now under test**: all eight wings keep their cell face (+Y,
  verified from the texture) on the sun through daylight at three seasons;
  the radiators run edge-on in daylight and face Earth in eclipse within the
  ±105° travel; model +X is forward (Node 2 ahead of Zvezda), +Z starboard
  (Columbus), Cupola nadir; every SARJ/TRRJ/BGA origin lies on its shaft.
- **Fixed**: the ELP/SHP camera pan nodes have authored origins 2.7 m / 4.5 m
  from their 0.5 m cameras, so the idle pan swung each camera ~0.3 m off its
  mount; sweeps now pivot on the part when the origin lies outside it, and
  turn about the part's own local axis (the old code wrote one Euler
  component).

### IGOAL source-material + KTX2 rebuild (2026-10-25)

With both NASA IGOAL sources available (the owner's `ISSTEST.zip`), the model
was analysed against them and rebuilt (`docs/ISS_MODEL_CONTEXT.md` §1):

- **Materials.** FBX2glTF had dropped all 38 metallic-roughness maps and put
  its Phong conversion (metallic 0.4 / roughness 0.272) on every material.
  The build now grafts the source GLB's authored materials by name (factors,
  metallic-roughness maps, the MLI and GEDI albedo the FBX lacks, normal
  strengths) and renders the genuine cutouts (ELC grating, iROSA hex panels)
  as MASK. The FBX is byte-identical to the audited source (`c3c43b9c…`).
- **Textures.** KTX2 / Basis ETC1S (`ktx create`, quality 255; on par with
  the WebP q80 they replace). Texture memory: full ~700 → ≤228 MiB, LOD ~97 →
  ~20 MiB; transcoding runs in workers. Transfer (brotli): full 16.5 → 25 MB,
  LOD 4.4 → 5.7 MB (the new metallic-roughness maps plus ETC1S overhead).
  Runtime: `KTX2Loader` on drei's `useGLTF`, transcoder in `public/basis/`.
- **LOD.** Derived from the high build's lossless master; normal and
  metallic-roughness maps at 256 px; 418 emptied leaf nodes removed (703 →
  285 nodes; every rig node kept).
- **Brightness.** Authored metalness is halved at build time
  (`SOURCE_METALLIC_SCALE`): at full value the array backs and truss went
  near-black in eclipse. Measured parity with the previous asset (mean lit
  luminance, app lighting: day 104 vs 106, eclipse 94 vs 101). Cutouts are
  single-sided (double-sided iROSA blankets z-fought into tan speckle).
- **Tried, not adopted:** an Earth-below / space-above PBR environment aimed
  at nadir — physically motivated, but daylight luminance fell to 79 and the
  array backs went black at night; `RoomEnvironment` stays.
- **Animation.** Only the visible detail model animates; joint state is
  handed to the next tier, so a swap mid-slew no longer snaps
  (`freshHandoff`). The SARJs stay uncapped by design (docs corrected).
- **Measured, not adopted:** meshopt + quantization (geometry memory 214 →
  113 MB, faster parse, but ≈ +9 MB transfer and a 50+ MB raw GLB in git).
- Tests: graft (incl. metallic scale, single-sided cutouts), KTX2 encode
  plan, published-asset material contract, `pruneEmptyLeaves`,
  `freshHandoff`.

### Improve-skill audit + waves 1–2 (2026-10-24/25)

A deep audit (six auditors, every finding re-read) produced plans 002–016;
the index with per-plan status and the rejected/deferred findings is
`plans/README.md`. Waves 1–2 (002–015) are landed.

| Plan | Title | Result |
|---|---|---|
| 002 | Fresh fallback TLE | Packaged `src/data/fallback-tle.json` has epoch 2026-10-24. |
| 003 | Toolchain, CI, Node 22 | Dev toolchain patched within its majors (vite `^6.4.5`, vitest `^4.1.12`, sharp `^0.35.5`); Node 22 via `.nvmrc`; actions pinned to SHAs, `persist-credentials: false`, full-tree `npm audit` step; `refresh-tle.yml` refreshes the fallback TLE Mon/Thu and commits it straight to `main` when `npm run verify` passes (changed 2026-10-25 from opening a PR, to avoid PR clutter). |
| 004 | Telemetry correctness | Offline-start recovery; confidence scored on \|age\|; clock clamp 100 → 1000 ms; `X-TLE-Stale` honoured (`fetchTLEWithStatus`); a cache bootstrap never replaces a network TLE; same-instant TLE blend; 16 KiB upstream body cap in `/api/tle`. |
| 005 | Geo correctness | Separate place/weather freshness, weather hidden after 1 h, local time null without a UTC offset, persisted rows validated (`isGeoSnapshot`). |
| 006 | Rendering correctness | Stable glint uniforms (fade and tint work again); detail preparation compiles the composer's shader variant (`detailPreparation.ts`); flare Earth mask off when Earth's centre is behind the camera; PMREM target disposed; `unavailable` stays terminal; no spurious legacy attempt on reselect. |
| 007 | Bloom MSAA | 4× MSAA on the bloom composer target (`COMPOSER_MSAA_SAMPLES`). |
| 008 | Signed Locate sweep | Close departures land on the planned standoff. |
| 009 | Known-answer tests | `OrbitalEngine` vs `satellite.js`, GMST vs `gstime`, formatters, `periodMsOf`, mode vocabulary, `ApiRateLimiter`; orbit-tape math extracted to `src/ui/clusters/orbitTapeMath.ts`. |
| 010 | HUD hygiene | Production crash screen without a stack; sentence-case HUD strings; dead constants removed. |
| 011 | Penumbra (roadmap D.1) | `SunVisibility.ts` (`sunVisibility`, `isSunlit`); continuous lighting via `eclipseLighting.ts`; the TRRJ law switches at the 0.5 edge. |
| 012 | Countdown (roadmap B.1) | `EclipseForecast.ts` (`forecastShadowTransition`, `ShadowForecaster`); store fields `sunlit` / `shadowTransitionInMs`; the line under the gauges reads "Daylight · sunset in mm:ss" / "Eclipse · sunrise in mm:ss". |
| 013 | Playwright smoke suite (roadmap A.3) | `tests/e2e/` (6 specs), `playwright.config.ts`, `npm run test:e2e`, CI `e2e` job. |
| 014 | Ground track on the HUD globe | `GroundTrack.ts` (`sampleGroundTrack`); dotted past, solid future. |
| 015 | Optional 3D ground track (B.2 + D.3) | `rendering/earth/GroundTrack.tsx` (setting "Ground track", default off) with a constant clip-space depth bias (`groundTrackDepth.ts`); supersedes D.3's options. |
| 016 | Docs pass | This pass: both errata banners folded into the text, drift fixed, waves 1–2 recorded. |

Verification snapshot (2026-10-25): `npm run verify` green with 397 unit
tests in 43 files; the `e2e` CI job runs the 6 smoke specs. Reviewer browser
checks (dev build, headless Chromium on SwiftShader): Locate reaches
`Follow · Locked`; the glint fades (opacity 0.077 at the Follow standoff);
Bloom-mode edges are antialiased; the countdown reads and counts down; the
mobile gauge gap is 10 px; the 3D track and footprint render with limb
occlusion; no console errors except an external BigDataCloud 400. No human
visual pass yet.

Known stale comment (`src/` was out of scope for the docs pass, so noted
rather than fixed): the `ISSModel.tsx` header comment's reliability ladder
omits the `locate` tier (the code: `high` loads `locate` first; a Locate-tier
failure demotes to `legacy`, then Model A).

### Earlier state (2026-10-23)

Both PRs are **merged**, in the required order (#14 then #15), with `verify`
and `npm audit` green on both merge commits:

| PR | Branch | Commits | Contents |
|---|---|---|---|
| [#14](https://github.com/slklnarnv/orbital/pull/14) | `feat/tier0-gains` | `f26f72a`, `c1bc242`, `013331e` | Tier 0 borrow pass (below) — merged `4d45d64` |
| [#15](https://github.com/slklnarnv/orbital/pull/15) | `fix/orbit-line-dashes` | `a75f8fe`, `4e5a335` | Orbit ring closure + dash phase (below) — merged `b314bac` |

**#15 was STACKED on #14.** It was branched from `feat/tier0-gains`, so its
diff against `main` carried all 25 files of #14 plus the orbit-line changes.
Merging in the order above landed each change through its own PR; merging
#15 alone would have landed #14's contents through the wrong one. That risk
is closed.

#### Locate LOD + two-tier detail (2026-10-23)

The "slow Locate shows Model A, then swaps to IGOAL" report traced to the 8 s
departure gate: the full asset is 20.5 MB / 2.665M triangles, and 76% of those
triangles sit in `Details_*` greebles/handrails. Uniform simplification only
removed ~14% on this CAD-style mesh, so the fix is a derived Locate tier:

- **Build** (`scripts/build-iss-locate-lod.mjs`, `npm run build:iss-lod`):
  strip detail/handrail meshes except a silhouette keep-list (AMS, Bartolomeo,
  ELCs, MLM/ERA, Node3, batteries, Columbus, MBSU, Bishop), simplify kept
  geometry 0.3/0.03, resize textures to 512, Draco 12/8/10. Candidate-first
  validation (rig, WebP, finite geometry, truss span, budget), then publish.
- **Measured** `public/models/iss_igoal_locate.glb`: **5.27 MiB, 784k
  triangles, ~1.75M vertices, 240 mesh instances / 234 stored meshes, 73 WebP
  textures at 512 px, 703 nodes**. Full 703-node rig preserved (12 joints, 8
  oscillators, six attachment frames, `extras.orbitalRig`); truss span 108.294
  m vs high 108.293, so the normalization constants are shared. Decode ~0.2 s
  Draco + ~0.5 s WebP (Node measurement) versus ~3.6 s for high.
- **Runtime**: `DetailQuality` adds `locate`. `high` loads `locate` first for
  Locate/Follow; the full asset is requested only inside the 200/220 km
  `isClose` band (covers Inspect and close FREE views). The departure gate now
  waits for the first committed tier (`shouldAwaitDetail`), not the full
  asset. A high failure keeps the committed LOD; a LOD failure demotes to
  legacy. The committed LOD stays visible while high prepares.
- **Prefetch + caching**: a 5 s boot-idle, connection-gated bare `fetch` warms
  the LOD (not `useGLTF.preload`); `__BUILD_ID__` is now a hash of the
  versioned `.glb`/`.webp` bytes, so docs/code deploys no longer invalidate the
  model cache. A prepared-URL set skips re-preparing a URL on its committed
  remount.
- **Tests**: 246 total (14 lifecycle/gate, 5 LOD build/contract, 3 build-id
  determinism). `npm run verify` exit 0. The LOD passes
  `iss-model-manifest --check-only`; the high asset is unchanged.
- **Browser-verified 2026-10-23** (headless Chrome 156, live build
  `aecac83bf949`): a fresh load + Locate reached `Follow · Locked` and
  requested only `iss_igoal_locate.glb` (first fetch 4.80 MB / 2.4 s, later
  cache hit 49 ms); zooming to `Inspect · Locked` requested `iss_igoal.glb`
  once (17.95 MB / 7.4 s); no console errors. Remaining: a human visual pass on
  the swap/hitch and a throttled-network repeat; the first-draw hitch was not
  measured. KTX2/meshopt for the full asset (C.2) remains the decode/VRAM
  follow-up.


#### Orbit line repair (2026-10-19, PR #15)

Two measured defects in `OrbitLine`, both on the dashed path:

- **The ring did not close — 214 km gap.** `generateOrbitPath` spanned ±½ of
  the NOMINAL `ISS_ORBITAL_PERIOD_MIN` (92.68 min) while the live element set
  runs 92.98 min, and `while (t <= end)` dropped the final partial step. First
  and last samples therefore sat 214 km apart (~11 px at the home view) at the
  station's antipode. `OrbitalEngine.periodMinutes` now exposes the live
  period from `satrec.no`; the predictor spreads exactly `steps` samples
  across it and ROUNDS the step, so a reboost or a slower vehicle cannot
  silently reopen the seam. After: 11–16 km, which is SGP4's own non-closure
  (an SGP4 orbit does not repeat bit-exactly), not a sampling shortfall.
- **The dash pattern slid every refresh.** `LineMaterial` keys the pattern on
  `instanceDistance`, measured from the arc's TRAILING edge — and that edge
  moves ~460 km per refresh because the arc is regenerated centred on the
  station. The pattern jumped ~1.8 pitches every `ORBIT_PATH_REFRESH_MS`, a
  visible shimmer. `dashOffset` now carries the trailing edge's ABSOLUTE
  position along the orbit, derived from the clock (not accumulated, so a seek
  cannot corrupt it); `vLineDistance + dashOffset` is then a fixed position on
  the ring.
  **Do not reduce that offset modulo the pitch.** The pitch changes every
  frame with the camera, and a remainder against a moving divisor shifts by
  `(phase / pitch) · Δpitch` — measured ~17 km of slide for a 0.3 km pitch
  change during a slow zoom. This was the first implementation and the
  browser check caught it.

`MAX_ORBIT_POINTS` moved into the predictor, which clamps to it, so the
fixed-size instance buffers cannot be overrun by a slower orbit.

Verification: `npm run verify` exit 0 (232 tests, lint 0 warnings, build).
Browser (dev server, dashed style): 186 segments, arc 42,719 km, ring gap
11.3 km, dash pitch 6.3 px at the home view; `dashOffset` advances across
refreshes (555.9 → 7666.5 after a 15 min seek) and holds within one.

#### Tier 0 pass (2026-10-19, PR #14)

Five borrow items from the youreyesinspace comparison, no behaviour change to
the simulation:

- **C.6a — batched texture uploads.** `ISSModel.prepare()` now uploads until a
  6 ms per-frame budget is spent instead of yielding one frame per texture.
  Measured on this machine: 73 WebP textures, 178 ms of GL work (2.44 ms
  each); 73 frames → 30 frames. The GPU work is unchanged; only the yielding
  is removed. `TEXTURE_UPLOAD_BUDGET_MS` documents the budget.
- **D.2 — versioned immutable assets.** `vite.config.ts` defines
  `__BUILD_ID__` (an asset-content hash since 2026-10-23; commit SHA/timestamp
  fallback if the tree cannot be read); `assetUrl()` in
  `src/utils/assetUrl.ts` appends `?v=<id>` to the model, Earth-map and starmap
  URLs. `vercel.json` serves `/models` and `/textures` as
  `public, max-age=31536000, immutable`. `vitest.config.ts` defines the same
  constant so tests can import modules that build URLs.
  **`/draco` deliberately stays `max-age=3600`**: `useGLTF.setDecoderPath`
  builds its own URLs and never carries `?v=`, so `immutable` there would pin
  a stale decoder for a year after an upgrade. Caught in review of the
  deployed preview and fixed in `c1bc242`.
- **Hide-HUD toggle.** `H` toggles `.hud-hidden` on `<html>` via
  `src/hooks/useHudVisibility.ts`; CSS hides the scrim, frame, corners and
  camera cluster with `visibility` (layout stays intact). Not persisted — a
  reload restores the HUD. Typing contexts keep the letter.
- **D.6 (CSS half) — safe-area insets.** Every viewport-anchored cluster pads
  by `env(safe-area-inset-*)` through `max()`, so desktop spacing is the
  floor and a notched phone clears the hardware chrome. `index.html` gains
  `viewport-fit=cover` (without it `env()` reports zero on iOS).
- **D.5 — link metadata.** OG/Twitter tags in `index.html`, `robots.txt`,
  `sitemap.xml`, and a generated 1200×630 `public/og-image.png` (built from
  the project's own palette and fonts; no third-party artwork).
- **D.4 — licensing.** `LICENSE` (MIT), `NOTICE.md` (data, models, imagery,
  fonts, dependencies, trademarks) and `public/fonts/OFL.txt` for the two
  self-hosted OFL families.

Verification: `npm run verify` exit 0 (227 tests at the time, lint 0
warnings, build). Browser (production preview): assets request with `?v=`,
`/robots.txt`, `/sitemap.xml` and `/og-image.png` all 200; `og-image.png` is
1200×630;
`H` hides the HUD with the canvas still rendering; Locate reaches the flight
in ~1.4 s warm. Production baseline confirmed the old behaviour being fixed:
`https://orbitaliss.vercel.app/models/iss_igoal.glb` answered
`Cache-Control: public, max-age=3600, stale-while-revalidate=86400` with
`Content-Length: 20529892`.

Shipped as **PR #14** (`feat/tier0-gains`, commits `f26f72a` + `c1bc242` +
`013331e`). CI green: `verify` (40 s), `Vercel`, `Vercel Preview Comments`;
merge state CLEAN. **Merged 2026-10-23** as merge commit `4d45d64`, followed
immediately by the stacked #15 (`b314bac`).

#### Prior state (2026-10-08, main @ `35ec297`)

Landed via PR #12 (`feat/hardening-and-gcdatlas-pass`) and the passes before it:

- **Tooling/CI**: ESLint + `verify` gate in GitHub Actions (verify + prod
  `npm audit`); test type-check via `tsconfig.test.json` (covers tests,
  scripts, both configs); dev middleware serving `/api/tle` through the real
  handler; `npm run refresh:tle`.
- **`/api/tle` guard**: query strings refused (cacheable 404), HEAD support,
  warm-instance memo + in-flight dedupe, stale-on-error (`X-TLE-Stale: 1`),
  upstream User-Agent.
- **Delivery**: CSP + baseline security headers, self-hosted fonts, fresh
  fallback TLE (epoch 2026-10-02).
- **Rendering**: DPR governor (`DprGovernor.ts` + `AdaptiveDpr`), PMREM
  rebuilt on `webglcontextrestored`, composer follows `viewport.dpr`, bloom/
  flare/output passes disposed on teardown, `RoomEnvironment` disposed,
  `EarthGroup` behind its own error boundary.
- **ISS model**: Nauka hull FIXED (baked dark `COLOR_0` vertex colours
  stripped at build time — the old "UV islands on black texels" diagnosis was
  wrong); BGA beta tilt on all 8 wings (targets computed in the LIVE SARJ
  parent frame, tracks through eclipse, 2°/sim-s + 12°/s wall-clock caps);
  asset rebuilt with a 12-joint embedded rig (backups:
  `.tmp-iss-build/iss_igoal_pre_nauka_backup.glb`,
  `iss_igoal_pre_bga_backup.glb`).
- **Lens flare**: compact halo (no full-screen veil), soft iris ghosts, aims
  at the drawn sun billboard (`SUN_BILLBOARD_DISTANCE_KM`) — parallax
  detachment fixed. Default OFF, requires Bloom.
- **Core/UI**: HUD scalars blend across TLE swaps, settings validated on
  rehydrate, geo IndexedDB pruning + hidden-tab fetch pause, roving-tabindex
  radio groups, popover Escape scoped + focus return, reduced-motion flights,
  south-pole altitude fix in `ecefToGeodetic`.
- **Bug found by new tests**: `|z|/sin(lat)` → negative altitude at the south
  pole; fixed to `z/sin(lat)` (`CoordinateConversions.test.ts`, 16 cases).


# From docs/NEXT_STEPS.md — Current state as of 2026-10-28

### Current state (2026-10-28)

- **README refresh (2026-10-28)**: new hero (Follow above the limb over
  Africa), overview (terminator with Asia's lights) and a module-explorer
  exploded view; the limb shot is retired. Captured on the real GPU with
  the 8K Earth forced on, at 1600x900 x1.5. Features and controls list the
  module explorer, the tour and `M`.
- **HUD tools, tour, sun and glint polish (2026-10-28)**, from the owner's
  live-site review:
  - *Tool row*: Passes, Modules and Settings sit together top right, each a
    line icon and a label (`ToolIcon.tsx`, `.hud-tool`); the bare gear and
    the mid-left Modules button are gone. Modules (and the new `M` key)
    works from anywhere: away from the station it Locates and the explorer
    opens on arrival (`moduleExplorerControl.ts`, `pendingOpenAt` in
    `explorerStore`; Reset view cancels it, and it lapses after 5 min).
  - *Tour*: an eight-step guided tour (`src/ui/tour/`), offered once on the
    first visit after the loading screen (`orbital-tour-seen` in
    localStorage, failures read as unseen), replayable from About and the
    `?` overlay. A spotlight ring dims the rest; the card goes below, above
    or beside its control (`placeCard`). Modal overlay `'tour'`. The e2e
    fixture and the bench mark it seen.
  - *Glare aim*: the glare overlay was aimed in a priority-0 frame callback,
    before Locate/Reset flights set the camera's orientation, so mid-flight
    it sat up to 945 px from the sun ("the shiny ray moves down"). It is now
    aimed in `onBeforeRender` with the drawing camera (0 px measured).
  - *Sun*: a smaller blown core (~1.6x the disc), thinner, shorter spikes
    widening with distance, a lower peak and a neutral white tint; no amber
    veil.
  - *Station glints*: a highlight knee (`highlightKnee.ts`) rolls every
    station fragment off from 1.8 toward 2.3, under the 2.4 bloom threshold,
    so a flat panel at its mirror angle can no longer bloom into a white
    square. Shared materials and the explorer's highlight copies use one
    program key (no extra compile).
  - *Hide HUD* (`H`) now also hides the orbit line and the 3D ground track
    (`hudStore.ts`); HUD-aware framing stops reserving HUD space.
  - Radiators checked, no change: in daylight the TRRJ edge-on target moves
    only a few degrees at the current beta angle, and in eclipse it holds.

- **Wheel zoom while tracking fixed (2026-10-28)**: the station-locked carry
  (2026-10-26 scrub fix) re-set camera-controls' pose with
  `setLookAt(…, false)` every frame the clock ran, which also reset the end
  pose a smoothed dolly eases toward: in Follow/Inspect each wheel tick moved
  ~1% (ten ticks 352 → 328 km; found by the A.2 bench session).
  `carryControls` now carries both poses and keeps the user-control flags,
  like `rotateOrbit`. Test: a dolly under continuous carry reaches the same
  distance as without (~102 km); the old one-pose carry stalls above 300 km.

- **017 V2 8K Earth (2026-10-26)**: first paint keeps the 4K WebP maps;
  ~2.5 s later, on capable desktops (`MAX_TEXTURE_SIZE` ≥ 8192, fine
  pointer, no Save-Data, a GPU compressed format; `earthDetail.ts`) an 8K
  day map (KTX2 / Basis **UASTC**, 20.5 MiB) and 8K night lights (ETC1S,
  1.4 MiB) stream in, are uploaded at most 1 MiB per frame
  (`progressiveUpload.ts`: one-call uploads stalled 27–45 ms per map) and
  swap together; the 4K maps' GPU copies are then released. ETC1S was
  tried for the day map (4.1 MiB) but left 4×4 block halos along every
  coastline at orbital magnification. Sources are the NASA originals the 4K
  maps came from (identified by RMSE: Blue Marble NG July 2004 topo-bathy,
  Black Marble 2016), rebuilt by `npm run build:earth-8k` with pinned
  SHA-256. The KTX2 loader moved to `src/rendering/iss/ktx2Loader.ts`
  (shared). Captures: `docs/images/earth-8k-day.webp`,
  `earth-8k-night.webp`. Bench: `npm run bench -- --earth-8k on|off`
  measures the swap itself as `earth-8k-swap`; numbers in
  `docs/bench/README.md`.
- **A.2 bench harness (2026-10-26)**: `npm run bench` builds the app in bench
  mode (production bundle plus the `window.__orbital*` hooks, now exposed via
  `src/utils/debugHooks.ts` in dev and bench builds only), serves it with
  `vite preview` and drives installed Edge headless on the real GPU through
  overview, Follow, a Follow tape scrub, Inspect (full model settled) and an
  Inspect scrub, each with Bloom on and off. It reports fps, p50/p90/p99
  frame time, frames over 20 ms, GPU ms per frame and per pass (timer
  queries around framebuffer binds and blits) and tracked GPU memory, to
  JSON. It refuses to run while another process uses the GPU (Windows GPU
  engine counters) or the CPU (other processes at ≥ 15% of all cores:
  other agents' SwiftShader browsers never show on the GPU counters), and
  keeps checking during the run. Docs: `docs/bench/README.md`. **Baseline**
  (`docs/bench/baseline-2026-10-26.json`, Radeon 780M, 1920×1080 buffer, no
  contention): 59.9 fps and p99 ≤ 17.7 ms in all ten rows; GPU 9–11 ms at
  overview/Follow with Bloom, 15–16 ms in Inspect and scrubs (p99 19–21 ms:
  little headroom up close); Bloom off measures more GPU time than Bloom on
  (12.5 vs 9.2 ms at overview), not yet explained; six 4K maps are 256 of
  330 MiB of textures. Found while building it: **wheel zoom barely works while
  tracking with the clock running** (~1% per tick, ~19% when paused) — the
  station-frame carry's per-frame `setLookAt(…, false)` cancels each
  smoothed dolly (Next, item 0).
- **017 V3 the sun (2026-10-26)**: the sun now reads as the blinding sun
  seen from orbit instead of a bright star by the limb. A camera
  point-spread function in two scene layers, so Bloom on and off draw the
  same thing and Bloom off stays the direct pipeline: the billboard
  (`sun.frag`) draws the disc and a blown-out core ~2x its size through one
  soft knee (depth-tested, cut by Earth and the station), and a
  screen-space overlay (`SunGlare.ts`, `sunGlare.frag`, no depth test)
  draws the wide halo and faint six-blade spikes over everything. Both stay
  under the bloom threshold (2.0 + 0.35 x 1.04 < 2.4, a unit test), so the
  square artifact cannot return. The glare fades with the sun's apparent
  flux (`SunAppearance.ts`: the disc integrated through the atmosphere
  along each line of sight, reddening and dimming as it sinks into the
  limb), an occlusion query when the station hides the sun, and the
  exposure ratio; the camera now stops down only for a sun it actually
  sees. The atmosphere adds a forward-scattering sunrise band at the limb
  (red low down, gold, then white) while the sun is at or behind the limb,
  and the limb thread near the sun takes the grazing sunlight's hue. The
  lens flare stays off by default: it lost its halo (the glare draws it)
  and shares the glare's gate. GPU time (timer queries, integrated AMD,
  1920x1080, GPU shared with another process so provisional): overlay
  0.37 ms with Bloom on, 0.11–0.14 ms off, only while the sun is near the
  frame; billboard 0.01–0.03 ms; probe ~0; sunrise branch +0.01–0.02 ms.
  With the sun out of view, frames are pixel-identical to before in both
  pipelines (Earth, atmosphere, stars). Captures:
  `docs/images/sun-before-after.webp`. Owner sign-off against ISS
  photography is the remaining acceptance step.
- **017 X1 module explorer landed (2026-10-26)**: in Inspect and close
  Follow (a visible IGOAL tier), a "Modules" control on the left edge opens
  the explorer. Hover tints a module light blue, a click (or the module
  list, for keyboards) selects it and opens a card: name, agency, launch
  year, mass, history and purpose for 45 elements (`src/data/issModules.ts`,
  launch dates and masses from NASA's station assembly element pages, masses
  converted from the published pounds, "—" where NASA gives none).
  "Explode" moves the 39 hub-level parts out along their centroid vectors
  (×1.6 the distance, 1.4 s, eased) while every joint parks on its authored
  angle at the 12°/s wall-clock cap; "Assemble" reverses it and the SARJs
  glide back onto their sun target. "Focus camera" moves the tracked point
  onto the module and keeps the eye outside the (exploded) clearance sphere.
  Reduced motion jumps instead of animating. The module map is derived at
  runtime from the batch names (no GLB rebuild); legacy and Model A say
  "Not available on this model". Picking tests batches in bounding-sphere
  order and stops at the first sure hit, so a hover pick touches one to
  three of the 217 batches.
- **017 R1–R7 responsive display landed (2026-10-26)**: measured with a
  viewport audit at ten sizes (360×640 to 3440×1440, overview and Follow,
  headless Edge on the owner's GPU). Before → after:
  - landscape phones: HUD 77% (844×390) and 84% (740×360) of the height →
    26% and 28%. A `max-height: 500px` layout gives one compact bottom row
    (gauge values · clock + transport · place and coordinates) and a thin
    tape;
  - Follow: the station overlapped the clock at 360×640, 390×844, 844×390
    and 740×360 → clear at every size. `HudAwareFraming` shifts the
    projection (`camera.setViewOffset`, never the pose) so the tracked
    station centres in the band the HUD leaves free. It re-measures on
    resize, rotation, `H` and every second, and eases in and out. On
    desktop the shift is also on (76 px up at 1080p, clearing the clock). The
    lens flare adds the same offset, so it stays on the sun billboard;
  - text: six styles at 7–8.5 px → none below 9 px (clamp() floor tokens;
    the phone weather line is dropped, not shrunk);
  - touch: every control was under 44 px (Pause 23×15) → none under 44×44
    on coarse pointers. Hit areas grow by padding with negative margins, so
    the glyphs and layout keep their size. Touch tablets in portrait use
    the stacked composition;
  - QHD and up: whole clusters zoom (1.15/1.3/1.6/1.9 steps); ultrawide
    pulls them in to an 18:9 frame (280 px each side at 3440×1440);
  - render scale (D.6): a settings row (Auto, 100%, 75%, 50%) pins the pixel
    ratio and pauses the governor. The DPR-2 ceiling on coarse pointers was
    already in force (R3F default) and is now explicit.
  Guarded by `tests/e2e/viewport.spec.ts` (station check under `E2E_DEV=1`).
- **017 A1–A4 and P landed (2026-10-26): shortcuts, help overlay, focus,
  screen readers, About.** One registry (`src/ui/shortcuts/shortcutRegistry.ts`)
  drives the keys and the `?` overlay: `Space` pause, `1`–`4` rates, `0`
  live, `L` locate, `R` reset view, `H` HUD, `P` passes, `G` settings, `?`
  help, `Esc` closes. Nothing fires while typing (Escape excepted), with
  Ctrl/Cmd/Alt, or — for Space — on a control Space presses; letters match
  the typed character, with the physical key only on non-Latin layouts.
  Settings, Passes, Set time, About and the help overlay share one overlay
  system (`src/ui/overlay/`): one open at a time, keyboard opens move focus
  in, closing returns it to the trigger. Also a skip link, a text summary of
  the canvas (`aria-describedby`: place, daylight, countdown in whole
  minutes), a polite live region for settled camera modes and sunrise/sunset
  (silent at accelerated rates; the camera label is no longer a live region),
  and an About panel beside the wordmark (measured vs illustrative, credits
  from `NOTICE.md`, build id, link to the shortcuts). Contrast: `--hud-lo`
  measured 3.1:1 on space black; raised from 38% to 50% white (4.7:1, pinned
  by `HudContrast.test.ts`). Over the bright limb in Follow no HUD tone holds
  AA (worst pixel 1.6:1 under the TLE line, 1.9:1 under the eclipse line) —
  a scrim/legibility call, listed below. Reduced motion now also holds the
  glint pulse still and drops the flare's sweeping ghosts (halo kept). Edge
  on the owner's GPU: the smoke specs pass (11 run; Locate reached Follow ·
  Locked separately), including six new ones (overlay, rates, typing in the
  place search, focus return, About, a focus ring on every Tab stop).
- **017 I1 icon + manifest, I2 staged loading screen (2026-10-26)**: a new
  mark (an orbit ellipse brightening toward a station glint, `--hud-hi` on
  `--space`) replaces the cyan globe: `favicon.svg`, a 16/32/48 `.ico`, a
  180 px apple-touch-icon and `manifest.webmanifest` with 192/512 and a
  maskable 512 icon, plus `theme-color`. All generated by
  `npm run build:icons` (`scripts/build-icons.mjs`); CSP unchanged (all
  same-origin). The loading screen now reads three stages: data link
  (Connecting until the telemetry bootstrap settles, then the HUD's link
  label), Earth and station ("2 of 5 files" from three's loading manager,
  then "Ready"), over an overall file bar. A static copy in `index.html`
  paints before the bundle runs: on the same throttled network (12 Mbps,
  80 ms) first contentful paint went 840 → 520 ms and the 0.8 s blank page
  is gone. Reduced motion parks the glint at its icon position. The share
  image (`og-image.png`) is unchanged and waits on the name (I3).
- **017 V1 close-range clouds landed (2026-10-26)**: the cloud shell and the
  surface's cloud shadows now read one shared field,
  `src/rendering/shaders/cloudDensity.glsl`. Magnified texels (more than one
  pixel per texel, picked with `dFdx`/`dFdy`) are reconstructed with a cubic
  B-spline in four bilinear taps, which removes the texel blocks at 800 km
  and the staircase at 300 km; below ~3,500 km camera altitude a zero-mean,
  multiplicative 3D value-noise fBm (four octaves from 9 km, each faded out
  below ~8 px so it never shimmers) breaks up thin and mid density while
  dense cores and the large-scale field stay the real map. The shadow takes
  the same function with two octaves, rotated into the deck's frame, and
  lost its `fract()` seam. Captured at 800 km, 300 km and overview over the
  day side: no texel edges at 300 km, overview unchanged. Per-pass GPU timer
  queries on the integrated GPU (shared with other sessions, so provisional):
  cloud pass 0.69 → 0.71 ms at 300 km, 0.80 → 0.75 ms at 800 km, overview
  unchanged at ~0.48 ms; surface pass unchanged (~0.65–0.70 ms).
  Still open: V1.3, a higher-resolution source (with V2 / D.8).
- **017 V4 dashed orbit in the shader (2026-10-26)**: the dash is now
  computed in the line's fragment shader (`src/rendering/shaders/orbitDash.glsl`,
  material in `src/rendering/iss/orbitLineMaterial.ts`), keyed on each
  vertex's orbital phase (`src/core/orbital/OrbitPhase.ts`: revolutions of
  the mean motion at the vertex's epoch) and sized with screen-space
  derivatives: a power-of-two number of dashes per revolution chosen per
  fragment, neighbouring levels crossfaded. The per-frame dash sizing,
  `dashOffset` and dash-origin state are gone; `OrbitLine.tsx` went from
  361 to 192 lines. Measured with frame captures (fixed camera on the
  future arc): 0 px along-track shift after seeks of +61 s, +130 s and
  −70 s, an orbit-tape scrub, 1× and 18 sim-minutes at 300×. Pitch is now
  even along the whole arc: at Follow 250 km the old dash ran 16 → 7 px
  from the near to the far end, the new one 11–13 px (8–16 px across all
  overview and Follow captures; the octave crossfade sets that band).
  Dashed/Continuous links no new program;
  Bloom on and off both render it, and the pitch holds at DPR 2.
- **C.5 changelog and Dependabot (2026-10-26)**: `CHANGELOG.md` (Keep a
  Changelog, sections named by the date a change reached `main`, since every
  merge deploys and there are no version tags; PRs add lines under
  "Unreleased") covers the history back to the first commit, with PR links.
  `.github/dependabot.yml` opens weekly npm and GitHub Actions PRs: npm minor
  and patch bumps in one group, majors one per PR, a 7-day cooldown, and the
  deferred majors ignored (React/R3F/drei, three beyond r170.x, Vite and its
  React plugin, satellite.js, and `@types/node` past the Node 22 floor).
  Actions stay pinned to SHAs; Dependabot rewrites the SHA and its version
  comment.
- **Roadmap written (2026-10-26)**: `plans/017-display-visuals-polish-roadmap.md`
  covers responsive display, clouds, 8K textures, the sun, the dashed orbit
  code, icon/loading/name, accessibility and shortcuts, the info panel and
  the exploded module explorer, with measured evidence and acceptance checks.
- **Orbit-tape scrub in Follow/Inspect fixed (2026-10-26)**: recorded on the
  production build, a half-revolution scrub swung Earth's limb from the left
  edge to the bottom of the frame and turned the station against the camera:
  tracking held a fixed inertial offset while the station's Earth-facing
  frame turned, the station trailed the clock through 10 Hz snapshots
  (per-frame steps of 0–340 km at an even scrub rate) and its attitude eased
  after every seek. Tracking is now station-locked (`StationFrameCarry.ts`);
  a paused clock propagates exactly each frame and snaps the attitude;
  shadow redraws are capped while seeking. After: the limb holds its place
  and the ground flows beneath through the same scrub. Follow scrubs ran at
  60 fps before and after; Inspect scrubs (full model) were 44.5 fps with 57
  shadow redraws per 3.5 s — the cap halves the redraws; re-run on an idle
  GPU with `npm run bench` (A.2), the Inspect scrub holds 59.9 fps (the
  44.5 was the busy GPU).
- **B.3 visible passes landed (2026-10-26)**: a "Passes" control beside the
  settings gear. The observer comes from an offline city search (Natural
  Earth 10m populated places, `src/data/city-index.json`, 7,342 places,
  ~150 KiB gzip, loaded on the first search; accent-folded via
  `normalizeQuery`), typed coordinates, or browser geolocation
  (`Permissions-Policy` now `geolocation=(self)`), and is kept in
  localStorage only. `PassPredictor.ts` scans 48 h of simulation time at
  30 s for ISS > 10°, sunlit, and Sun < −6° at the observer, bisects the
  edges to 1 s and runs in a module worker (`passes.worker.ts`; main-thread
  fallback). It matches Skyfield on 8 passes over 4 cities to 4 s and 1°
  (known-answer tests). "Watch" seeks 30 s before a pass and plays at 1×.
  Also fixed on phones: popovers no longer lose their fine text (a ≤900 px
  rule hid every `.hud-fine` in the top-right corner, including the model
  hints), and the Passes + settings row sits under the camera reticle
  instead of overlapping its mode label.
- **README rewritten (2026-10-25)**: about 40% shorter, with a primer on
  what the view shows (TLE and SGP4, GMST and the westward drift, eclipse,
  LVLH attitude, the 1,000× scale), a Mermaid pipeline diagram and four
  screenshots in `docs/images/` captured on the live site with a real GPU.
  The camera and model detail it dropped lives in `docs/HANDOFF.md` and
  `docs/ISS_MODEL_CONTEXT.md`. `NOTICE.md` now lists the Basis transcoder.
- **Follow flicker and Bloom frame rate fixed (2026-10-25)**: measured on
  the live site on the owner's integrated AMD GPU (headless Edge, D3D11,
  1280×713 at DPR 1.5). Flicker: ~9% of frames turned the solar arrays black
  for one frame — `ISSModel` (a child of `ISSGroup`) aimed the cached
  self-shadow at the previous frame's pose, and the 0–160 m per-frame step
  is over two 68 m shadow texels. `ISSGroup` now runs at `useFrame`
  priority −2 (`src/rendering/framePriority.ts`): 0 dark frames in 895,
  and shadow redraws fell from ~4.6/s to the designed one per 2 s. Frame
  rate: Bloom cost 18.5 GPU ms/frame (56.5 fps, 6% of frames at 33 ms)
  because the bloom blend wrote back into the 4× MSAA HalfFloat target and
  three resolved it twice with depth. `MultisampleRenderPass` keeps MSAA to
  the scene pass (color-only resolve); 60.0 fps, p99 17.2 ms, in all four
  Bloom/Shadows combinations. Bloom off is untouched.
- **Live IGOAL outage fixed (2026-10-25)**: after PRs #20/#21 the live site
  never showed the close-range model — Locate waited 8 s and flew to Model A,
  and "High fidelity" spun forever. Cause, from the live console: three's
  Basis transcoder glue calls `new Function`, the CSP has no `'unsafe-eval'`,
  so all four KTX2 workers threw `EvalError` at init and never answered.
  `public/basis/basis_transcoder.js` is now generated CSP-safe by
  `npm run patch:basis`; KTX2 texture loads fail after 30 s instead of
  hanging, and a model with any failed texture demotes to legacy instead of
  rendering grey; `vite preview` serves the production headers. Verified in
  headless Edge against the CSP-enforcing preview (IGOAL at Follow; the stock
  transcoder demotes to legacy). Follow-up: the transcoder URLs carry a
  content hash (`?v=<__BASIS_ID__>`) and `/basis/` is served immutable —
  browsers that had cached the stock glue (`max-age=3600` + SWR) kept running
  it after the deploy. Details:
  `docs/ISS_MODEL_CONTEXT.md` §1.
- **Place names offline (2026-10-25)**: the live console showed every
  "Passing over" lookup blocked by `connect-src` (BigDataCloud's host now
  redirects to `api-bdc.io`), and BigDataCloud's fair-use policy allows its
  free client endpoint only for the calling device's own location — never
  the ISS ground point. Place names now come from a Natural Earth 1:50m
  index looked up locally (`PlaceIndex.ts`, `src/data/place-index.json`,
  ~490 KiB / ~170 KiB gzip, fetched once as a hashed asset); BigDataCloud
  and both its hosts are gone from code and CSP. `ConnectSrcCsp.test.ts`
  keeps `connect-src` equal to the hosts `src/` fetches; `PlaceIndex.test.ts`
  requires every point of the ISS band to resolve. The geo cache also no
  longer fails a good lookup when IndexedDB is missing entirely.
- **Gate green**: `npm run verify` — asset budget, shader ramps, typecheck,
  lint (0 warnings), 490 unit tests in 56 files, production build. CI
  (`.github/workflows/verify.yml`) runs `verify`, both `npm audit` passes and
  an advisory `e2e` job (`npm run test:e2e`, 6 Playwright smoke specs against
  `vite preview`; not a required check — `verify` is the merge gate). Node 22 (`.nvmrc`).
- **Improve-skill audit, waves 1-2 landed 2026-10-24/25** (plans 002-015; the
  index is `plans/README.md`, the per-plan results are in `plans/PROGRESS.md`):
  - *Data and toolchain.* The packaged fallback TLE has epoch 2026-10-24, and
    `.github/workflows/refresh-tle.yml` refreshes it Mon/Thu and, when it
    changed and `npm run verify` passes, commits it straight to `main` (no PR;
    Vercel deploys it). The dev toolchain is patched within its majors; CI actions are
    pinned to SHAs with `persist-credentials: false`.
  - *Telemetry.* Offline starts recover on reconnect; confidence is scored on
    the magnitude of the TLE age; the clock clamp is 1000 ms per tick (it was
    100, which dropped accelerated time on slow ticks); `X-TLE-Stale` is
    honoured; a cache bootstrap never replaces a network TLE; TLE swaps blend
    from the old set at the same instant; `/api/tle` caps upstream bodies at
    16 KiB.
  - *Geo.* Place and weather freshness are tracked separately, weather is
    hidden after 1 h, the local time is null (never another cell's clock) without a UTC offset, and
    persisted rows are validated (`isGeoSnapshot`).
  - *Rendering.* Stable glint uniforms (the fade and tint work again); detail
    preparation compiles the composer's shader variant; the flare's Earth mask
    is off when Earth's centre is behind the camera; the PMREM target is
    disposed; 4x MSAA on the bloom composer target; the Locate sweep angle is
    signed, so close departures land on the planned standoff.
  - *Tests and hygiene.* Known-answer tests for `OrbitalEngine` vs raw
    `satellite.js`, GMST vs `gstime`, formatters, `periodMsOf`, the mode
    vocabulary and `ApiRateLimiter`; orbit-tape math lives in
    `src/ui/clusters/orbitTapeMath.ts`; the production crash screen shows no
    stack; HUD strings are sentence case.
- **Features landed**: **D.1** penumbra (`src/core/orbital/SunVisibility.ts`;
  lighting follows `sunVisibility` through `eclipseLighting.ts`; the TRRJ law
  switches at the 0.5 edge). **B.1** day/night countdown
  (`src/core/orbital/EclipseForecast.ts`; store fields `sunlit` and
  `shadowTransitionInMs`; the line under the gauges reads "Daylight · sunset in
  mm:ss" or "Eclipse · sunrise in mm:ss"). **A.3** Playwright smoke suite.
  **B.2** ground track (`src/core/orbital/GroundTrack.ts`; the HUD globe draws
  it dotted behind the station and solid ahead; an optional 3D track and
  visibility footprint behind the "Ground track" setting, default off, with a
  constant clip-space depth bias) — this also supersedes D.3's options.
- **Reviewer browser checks (dev build, headless Chromium on SwiftShader)**:
  Locate reaches `Follow · Locked`; the glint fades (opacity 0.077 at the
  Follow standoff); Bloom-mode edges are antialiased; the countdown reads and
  counts down; the mobile gauge gap is 10 px; the 3D track and footprint
  render with limb occlusion; the only console error then was an external
  BigDataCloud 400 (gone: place names are offline now). No human visual pass
  yet.
- **IGOAL rebuild from both sources (2026-10-25)**: the authored PBR
  materials are grafted from the source GLB (38 metallic-roughness maps, MLI
  and GEDI albedo, cutouts); every model texture is KTX2 / ETC1S (texture
  memory ~700 → ≤228 MiB full, ~97 → ~20 MiB LOD); authored metalness halved
  for brightness parity; the joint state carries across the LOD ⇄ full swap. Details:
  `plans/PROGRESS.md`, `docs/ISS_MODEL_CONTEXT.md` §1.
- **Parked model items, re-opened (2026-10-25)**: rigid batching landed
  (993 → 217 draw primitives full, 438 → 176 LOD); the station attitude
  follows its LVLH target with no lag at 300×; station self-shadowing from
  the sun ("Shadows" setting, default on; cached 2048² map redrawn only
  when the sun or a joint moves 0.15°). TRRJ law, radiator texture,
  Canadarm2/ERA and meshopt were re-reviewed and kept as they are, with
  reasons in `docs/ISS_MODEL_CONTEXT.md` §9.
- **Locate LOD + two-tier detail (2026-10-23)**: Locate/Follow load
  `iss_igoal_locate.glb` (now 6.20 MiB, 787k triangles, 176 draw primitives,
  full rig); the full 27.1 MiB `iss_igoal.glb` (217 draw primitives) loads only
  inside the 200/220 km Inspect band;
  `__BUILD_ID__` is an asset-content hash. Earlier the same week: PRs #14
  (texture-upload batching, immutable versioned assets, `H` HUD toggle,
  safe-area insets, OG metadata, LICENSE/NOTICE) and #15 (orbit-ring closure,
  clock-phased dashes). Details: `plans/PROGRESS.md`.


# From docs/NEXT_STEPS.md — Next (ranked) as of 2026-10-28

### Next (ranked)

The display, visuals and polish roadmap is **`plans/017-display-visuals-polish-roadmap.md`**
(2026-10-26: viewport audit at nine sizes, sun/cloud/orbit captures, code
read). Its order, merged with the older items:

1. ~~**017 R1–R7 — responsive display.**~~ Landed 2026-10-26 (see Current
   state). Follow-up only if wanted: a real-device pass on iOS Safari
   (address-bar collapse with `100dvh`, notch insets in landscape).
2. **017 V1 — close-range clouds**: V1.1 (bicubic reconstruction) and V1.2
   (altitude-faded detail) landed 2026-10-26; V1.3, a higher-resolution
   cloud source, waits for V2 / D.8.
3. **017 A1 + P** — shortcuts, help overlay and About landed 2026-10-26.
   Follow-up from A4: HUD text over the bright daylight limb (Follow) falls
   to ~1.6:1 at worst; any fix — a stronger scrim or a faint text shadow
   (removed earlier by request) — is a design call.
4. **017 I3 — the name** (owner's call). With it, refresh `og-image.png`
   (ALL CAPS wordmark, blue limb, no new mark); I1/I2 landed 2026-10-26.
5. **017 V3** — the sun landed 2026-10-26 (round glare, limb fade and
   reddening, sunrise band) and was toned down 2026-10-28 after the owner
   found it overdone; it awaits the owner's side-by-side with ISS
   photography at the limb.
6. Standing human visual pass: a human look at the rebuilt
   materials at Follow and Inspect, day and night, on a real GPU (MLI
   blankets, ELC grating, iROSA wings, night legibility). Then a human
   visual pass on the penumbra fade at a terminator crossing (300x), the
   countdown, the ground track (HUD globe and the 3D setting) and the Bloom
   MSAA edges; on a throttled connection, Locate departs with the detailed LOD
   (not the schematic) at Follow and the full model appears only below 200 km.
7. A.2 leftovers: the flare and 300× rows, the leak check, and why Bloom
   off costs more GPU time than on. 017 V2 landed 2026-10-26; beyond 8K is
   D.8 (GIBS tiles).
8. Deferred majors (React 19 + R3F 9 + drei 10, three r18x, Vite 7/8,
   satellite.js 7); D.7 save-frame, D.8 GIBS tiles, B.4–B.8. **017 X1**
   follow-ups if wanted: per-truss-segment entries (P4–P6 and S4–S6 are one
   batch each, so splitting them needs a batching change in
   `build-iss-model.mjs`), masses for the elements NASA's pages omit.
   B.3 follow-ups if wanted: an observer marker on the globe, pass
   magnitude.


# From docs/NEXT_STEPS.md — Roadmap (2026-10-04)

### Roadmap (2026-10-04, after the gcdatlas comparison)

Each item has a minimal first cut: the smallest version that ships value and
can be extended. "Touches" lists the files expected to change.

#### A. Close-out (before new features)

1. **Commit + preview deploy.** Split the uncommitted work into tooling /
   API / rendering / UI commits; deploy a Vercel preview. Check: no CSP
   violations in the console; `/api/tle` 200 with `Vercel-CDN-Cache-Control`,
   `/api/tle?x=1` 404, HEAD 200 empty.
2. **Measured perf run** (item 0 below). Matrix: Follow / orbital /
   planetary × Bloom on/off × flare on/off × model quality, plus 300×.
   Record p50/p95/p99 and `renderer.info.memory` after 5 Bloom toggles and
   3 model switches (leak check). Table goes in PROGRESS before any cut.
   **Harness LANDED 2026-10-26** (`npm run bench`, `docs/bench/README.md`):
   overview / Follow / Follow scrub / Inspect / Inspect scrub × Bloom on/off,
   fps and p50/p90/p99, GPU ms per pass, tracked GPU memory, with a GPU and
   CPU contention guard; baseline `docs/bench/baseline-2026-10-26.json`.
   Still open: the flare and 300× rows, and the leak check.
3. **Browser smoke suite (Playwright).** LANDED 2026-10-25 (plan 013):
   `tests/e2e/smoke.spec.ts` + `fixtures.ts`, `playwright.config.ts`, Chromium
   on software WebGL against `vite preview` with the network stubbed, `npm run
   test:e2e`, and an `e2e` CI job after `verify`. Six specs: boots clean;
   Locate reaches "Follow · Locked"; Space toggles pause; `H` hides the HUD;
   settings survive reload; a TLE failure degrades to Cached, Recovery or
   Fallback. A 390x844 mobile case is still open (C.3).
4. **Unit tests for untested frame-math modules.** LANDED (plans 009 and
   earlier): `CoordinateConversions` (equinox and solstice sun directions,
   ECEF round trip), `OrbitalEngine` vs raw `satellite.js`, GMST vs `gstime`,
   `SimulationTime`.

#### B. Features

1. **Orbital day/night + countdown.** LANDED 2026-10-25 (plan 012), on the
   penumbra model of D.1 rather than the cylinder test originally specified:
   `forecastShadowTransition` steps forward at 10 s and bisects the flip to
   1 s, and `ShadowForecaster` recomputes only per element set, on a seek, or
   at the cached transition. The HUD line sits under the gauges. Still open:
   tint the orbit line's shadowed span (the optional second cut).
2. **Ground track + footprint.** LANDED 2026-10-25 (plans 014 and 015).
   `sampleGroundTrack` samples +/- half an orbit (about 186 points at 30 s
   steps, refreshed every 60 s) on the HUD globe (dotted past, solid future)
   and, behind the "Ground track" setting (default off), as a line at
   R + 2 km plus a 64-segment footprint ring on the 3D globe. The original
   note stands as the reason for the depth design: at `near = 1 km` and 24-bit
   depth the smallest resolvable gap is 20.7 km from the home view and 11.1 km
   from orbital altitude (14 m at close range), so a 2 km offset alone
   z-fights. What landed (see D.3) is a constant clip-space depth bias, not
   `depthTest: false`.
3. **Next visible pass.** Observer from a typed lat/lon or a city search
   (default), with optional browser geolocation (needs `Permissions-Policy`
   `geolocation=(self)`). Scan 48 h at 30 s with `satellite.ecfToLookAngles`;
   a pass is visible when elevation > 10°, the ISS is sunlit (B.1) and the sun
   is below −6° at the observer. Run in a Web Worker. Observer location kept in
   localStorage only, never sent anywhere. Panel: rise/max/set times, max
   elevation, "Jump to pass" (uses the existing seek). **Landed 2026-10-26**
   (`PassPredictor.ts`, `PassesPanel.tsx`); city search is offline.
4. **Share links.** `#t=<epochMs>&m=<mode>&q=<quality>`; parse with a
   whitelist for enums and clamp for numbers (same rule as the settings
   sanitizer). Write the hash at most once a second; apply once on load.
5. **More stations.** Generalise `ISSEntity` into a config-driven entity;
   `/api/tle?id=` stays refused, add `/api/tle/<name>` routes from a fixed map
   (`iss`, `css`, `hst`). Start with CSS as a second marker and orbit line, no
   detailed model.
6. **Reboost detection.** On a TLE swap, compare mean motion and the
   propagated altitude at the same instant; above a threshold (≈0.3 km), emit
   a `TELEMETRY_EVENT` and show a toast "Reboost detected, +0.8 km".
7. **"What's real" panel.** Static content in the planned Info/About popover:
   measured (position, TLE age, sun, terminator) vs illustrative (attitude
   details, joint angles, clouds, flare, glint). One table, no new logic.
8. **Ground observer view.** Camera mode at an observer's ECEF position
   looking up, horizon mask, ISS as a bright point. Depends on B.3 for the
   observer. Large; only after B.1–B.3.

#### C. Engineering

1. **Offline / PWA.** `vite-plugin-pwa` with precache for the app shell +
   textures + the fallback model, runtime cache (network-first) for
   `/api/tle`; manifest + icons. The OFFLINE mode already exists.
2. **Bundle + textures.** `React.lazy` the postprocessing chain and the IGOAL
   pipeline; convert Earth textures to KTX2/Basis (`ktx create`; the ISS
   models already are, see `encodeTexturesKtx2`) with a WebP fallback.
   Measure first (C.2 follows A.2's numbers).
3. **Mobile.** Check pinch, two-finger slide, lifting one finger mid-gesture,
   portrait HUD; fix what breaks. Add a 390×844 case to the Playwright suite.
4. **Accessibility.** `aria-live="polite"` region announcing the place below
   (at most once per minute), a `?` shortcut-help overlay, the remaining
   `L` / `R` shortcuts (item 2; `H` shipped as the HUD toggle in PR #14),
   a high-contrast HUD class.
5. **Release routine.** Scheduled CI job running `npm run refresh:tle`:
   LANDED (`refresh-tle.yml`, Mon/Thu, verify-gated, commits directly to
   `main`). `CHANGELOG.md` and `.github/dependabot.yml`: LANDED 2026-10-26.
6. **Faster Locate (fresh load).** Locate is a primary feature. A cold session
   used to wait for the full high pipeline, and on a slow connection the 8 s
   departure gate expired, so the camera departed on Model A and swapped
   mid-flight. **LANDED 2026-10-23: the Locate LOD + two-tier detail.**
   Locate/Follow now fetches `iss_igoal_locate.glb` (5.27 MiB, 784k triangles,
   512 px textures) instead of the 20.5 MB full asset; `iss_igoal.glb` loads
   only inside the 200/220 km Inspect band, where its fine detail resolves.
   Measured LOD chain: ~0.2 s Draco + ~0.5 s WebP decode (Node; browser similar)
   + GPU preparation, versus ~3.6 s of CPU decode for the full asset. The LOD
   fits the 8 s gate at roughly 5–8 Mbps; the full asset needs ~25–50 Mbps.

   Remaining cuts:
   a. **Batch the texture uploads** on a per-frame time budget (~6 ms/frame)
      instead of one texture per frame. **LANDED 2026-10-19 (PR #14).**
      Measured: 73 WebP textures, 178 ms of GL work (2.44 ms each); 73 frames
      → 30 frames.
   b. **Warm the network fetch** after boot idle (~5 s) and on Locate
      hover/focus, into the HTTP cache, connection-gated (skip
      `saveData`/2G), silent failure, once per session; deliberately a bare
      `fetch`, NOT `useGLTF.preload` (a failed preload maps to the terminal
      "ISS unavailable" state). **LANDED 2026-10-23 for the LOD**: hover/focus
      already starts the first tier, and a 5 s boot-idle warm was added. The
      full high model is NOT prefetched — it loads at Inspect.
   c. Decode/VRAM cost. **KTX2/Basis textures LANDED 2026-10-25** for both
      model tiers. Meshopt + quantization instead of Draco was measured and not
      adopted (`docs/ISS_MODEL_CONTEXT.md` §9.4: half the geometry memory,
      but ≈ +9 MB transfer and a 50+ MB raw GLB in git).

Suggested order now: A.2 → C.2 (B.3 landed 2026-10-26; A.3, B.1 and B.2 landed 2026-10-25;
C.6a/C.6b and the Locate LOD landed 2026-10-23; C.2 remains for the
full-asset decode/VRAM path).


# From docs/NEXT_STEPS.md — Reference comparison (2026-10-19)

### Reference comparison - berkcomba/youreyesinspace (2026-10-19)

Read-only pass; no application code changed. Analysed the full `src/` tree
(~23k lines), README/NOTICE, shaders, data tables, Docker/nginx/CI and the
deploy scripts at `github.com/berkcomba/youreyesinspace` ("Your Eyes In
Space", MIT code, BigBrains product).

**Different products.** Theirs is a Space-Engine-style universe explorer:
13.8 Gpc of catalogue + procedural universe, five languages, narrated tours,
an Academy, a Lambert-solver mission planner. ORBITAL is one object done
properly: live TLE -> SGP4 -> a real ISS with articulated joints. Most of
their feature surface is not addressable from here, and several ORBITAL
"advantages" below are consequences of the narrower scope, not better
engineering. Items marked **(architectural)** would hold at any scope.

#### Where ORBITAL is genuinely stronger (do not regress)

| Area | ORBITAL | Theirs |
|:---|:---|:---|
| Simulation truth | `SimulationRuntime`: recursive-timeout 10 Hz loop, decoupled from React and WebGL, catches up after tab throttling, no overlapping steps **(architectural)** | `time.advance(dt)` inside the rAF callback with `dt` clamped to 0.1 s: a background tab silently loses simulated time, and the clock is welded to the renderer |
| Telemetry | Live TLE; 4-mode LIVE/HYBRID/OFFLINE/RECOVERY; server proxy with checksum + epoch validation + memo + dedupe + stale-on-error; IndexedDB cache; packaged fallback; transactional swap | The ISS is a static Keplerian element set (`spacecraft.ts`: `orbit(6789, 0.0006, 51.64, ...)`). No TLE, no live position |
| ISS fidelity | LVLH/TEA attitude, SARJ/TRRJ/BGA on the authored rig, live-parent-frame targets, slew caps, eclipse hold, 576-line pure kinematics module + tests | A glTF prop fitted to a sphere radius; no articulation, no attitude law |
| Camera | 6-mode state machine with hysteresis, station-relative flights, horizon transport, clearance constraint, deviation-based Reset **(architectural)** | Competent free/orbit camera + autopilot; no mode machine, no flight/constraint separation |
| Verification | Unit suite, Playwright smoke suite, asset budget, shader-ramp gate, lint 0 warnings, CI | No test runner, no lint, no asset gate; CI is typecheck + build + a Docker health curl |
| HUD | Bespoke design system (`index.css` tokens), honest-instrument rule, 1 Hz throttled stores | 940-line `UI` class over a static DOM skeleton; functional, not a system |
| Post | Bloom off = bit-for-bit direct pipeline (contract) | `Engine.useComposer` exists but is never set false; bloom can be disabled, the composer (RenderPass + lensing + OutputPass) always runs |
| Resilience | Per-subtree error boundaries, WebGL diagnostic screen, `webglcontextlost/restored` rebuild, DPR governor with hitch exclusion and per-session caps | No context-loss handling at all; fixed DPR cap + manual scale |
| Delivery | 5 MiB initial asset budget enforced in CI; 20.5 MB model deferred | ~254 MB of `public/` media (103 MB tours, 116 MB lessons) with no gate |

Do not import their settings merge (`{...DEFAULTS, ...JSON.parse(raw)}`) -
our sanitizer is the correct pattern. Do not import their nginx
`set_real_ip_from 0.0.0.0/0` with `real_ip_header CF-Connecting-IP`: any
direct-to-origin client can forge the logged IP; the origin secret mitigates
access, not log integrity.

#### Genuinely borrowable - ranked

Status roll-up (2026-10-25): **D.1, D.2, D.4, D.5 landed; D.3 superseded;
D.6 landed for the CSS half.** D.2, D.4, D.5 and D.6's CSS half shipped in
PR #14 together with C.6a; D.1 and D.3 shipped with plans 011 and 015. Still
open: D.7, D.8, D.9, plus the coarse-pointer and render-scale halves of D.6.

##### D.1 - Penumbra instead of a binary eclipse test - LANDED 2026-10-24/25 (plan 011)

**Problem (as of 2026-10-19, now fixed):** their `common.glsl` `sphereShadow`
smoothsteps over the occluder's angular radius +/- the sun's angular radius,
so a shadow edge is a gradient. Ours was binary in three places
(`ISSModel.tsx`, `ISSAnimations.tsx` and `trrjTargetAngle`'s `sunlit`
boolean). The Sun's angular radius is 0.266 deg, so the real penumbra at the
station is `2 * 6,779 km * 0.00465 rad ≈ 63 km` wide — roughly 8 s of flight —
and the binary test collapsed that into one frame that switched a 2.3x
key-light boost, ambient 0.24 -> 0.42, the earthshine key light and the glint
colour.

**Landed:** `sunVisibility(positionKm, sunDir)` in `src/core/orbital/
SunVisibility.ts` returns the visible fraction of the solar disc in [0, 1]
(circular-segment area across the penumbra); `isSunlit` is `>= 0.5`, which is
exactly the old cylinder edge. `ISSModel.tsx` feeds `1 - sunVisibility`
through `eclipseLighting()` (`src/rendering/iss/eclipseLighting.ts`; the
endpoints reproduce the old sunlit and eclipse values) and the glint tint;
`ISSAnimations.tsx` calls `isSunlit` for the TRRJ law, so joint behaviour is
unchanged. B.1's countdown bisects the same 0.5 crossing.

##### D.2 - Build-id-versioned, immutable static assets - LANDED 2026-10-19

**Problem (as of 2026-10-19, now fixed):** `vercel.json` served `/models/*`
and `/textures/*` with `max-age=3600, stale-while-revalidate=86400`, so the
20.5 MB `iss_igoal.glb` revalidated every hour per user; the 4K Earth maps
did too. Confirmed against production: `/models/iss_igoal.glb` answered
`max-age=3600` with `Content-Length: 20529892`. Their `vite.config.ts`
defines `__BUILD_ID__`, every non-content-hashed URL carries `?v=<id>`, and
nginx sends `immutable` for a year - a deploy still busts it.

First cut: `define: { __BUILD_ID__ }` in `vite.config.ts` (a content hash of
the versioned `.glb`/`.webp` files under `/models` + `/textures`, falling back
to the commit SHA/timestamp if the tree cannot be read); append
`?v=${__BUILD_ID__}` to the model URLs in `ISSModel.tsx` / `modelUrls.ts` and
the four Earth maps + starmap in `EarthConstants.ts` / `EnvironmentLayer.tsx`;
flip `/models` and `/textures` to `public, max-age=31536000, immutable`. **Do NOT flip `/draco`**:
`useGLTF.setDecoderPath('/draco/')` builds its own URLs and never carries
`?v=`, so `immutable` there would pin a stale decoder for a year after any
upgrade. It stays `max-age=3600`.

Watch: drei's `useGLTF` caches by URL, so a new id means one re-download when
the assets actually change (intended); a docs/code-only deploy keeps the id
stable. `FALLBACK_URL_PATTERN` is a substring regex and still matches with the
query string. `check-asset-budget.mjs` reads disk paths and is unaffected.

**Landed (PR #14).** `src/utils/assetUrl.ts` + `src/types/build.d.ts`; the
`/draco` exception above was caught reviewing the deployed preview and fixed
in `c1bc242`. A test importing `EarthConstants` failed until
`vitest.config.ts` mirrored the `__BUILD_ID__` define — vitest does not read
`vite.config.ts`. **2026-10-23:** the id moved from the commit SHA to the
asset-content hash, so docs/code deploys no longer invalidate the 20.5 MB
model or the Locate LOD.

Touches: `vite.config.ts`, `ISSModel.tsx`, `EarthConstants.ts`,
`EnvironmentLayer.tsx`, `vercel.json`, the global type declaration.
Check: `npm run verify`; a preview deploy shows `?v=` in the network panel
and `immutable` on the response; a reload serves from disk cache.
Cost: under an hour.

##### D.3 - Fix the ground-track depth budget before implementing B.2 - SUPERSEDED (landed with B.2, plan 015)

B.2 specifies `r = R_earth + 2 km` in the EarthGroup frame. With the current
camera (`near = 1 km`, `far = 2,000,000 km`, 24-bit depth) the smallest
resolvable depth gap is `z^2 * (far - near) / (far * near * 2^24)`, so at a
ground distance of 18,629 km (the 25,000 km home view) it is 20.7 km; at
13,629 km it is 11.1 km; at the station's ~478 km ground distance it is
14 m. A 2 km offset is therefore fine at close range but z-fights from
orbital altitude — where the track is most useful.

They set `logarithmicDepthBuffer: true` with `near = 1 m`, `far = 1e13 km`,
which removes the problem - but they need it for a 10^13 km scene; we do not.
**What landed instead:** none of options a-c below. The track's vertex shader
pulls clip-space depth toward the camera by a constant NDC amount
(`GROUND_TRACK_DEPTH_BIAS_NDC = 4e-7`, about 3 ulps of a 24-bit buffer, in
`src/rendering/earth/groundTrackDepth.ts`). The world-space pull grows with
the square of the view distance (about 70 km at the home view, 37 km at
13,600 km, 0.05 km at Follow range), so the track wins against the globe it
sits on at every zoom, while real depth testing still lets the limb hide the
far side and the station occlude the track. Option (a) would have drawn the
track over the ISS model at close range.

Options considered, cheapest first (history):

a. Draw the track in a second pass with `depthTest: false` and an analytic
   Earth-horizon discard in the fragment shader (keeps limb occlusion, no
   global change). Was recommended; replaced by the bias above.
b. Raise the offset to ~40 km and accept a floating track at close range -
   visibly wrong at INSPECT range. Not recommended.
c. Adopt `logarithmicDepthBuffer` - every custom shader needs the
   `logdepthbuf_*` chunks and the bloom-off parity contract must be
   re-verified. Only if other depth artifacts appear.

Check used for the landed version: at 25,000 / 13,600 km camera
Earth-centre distance and at Follow range the track never flickers, the far
limb is hidden behind the globe and the station occludes the track
(`docs/verification.md`, "Ground track").

##### D.4 - LICENSE, NOTICE and an on-screen imagery credit - LANDED 2026-10-19 (credit line landed with the About panel, 2026-10-26)

**Problem (as of 2026-10-19, now fixed):** the repo shipped no LICENSE file,
while `public/models/*.glb` are IGOAL/NASA derived, the textures are derived
from NASA Blue Marble / Black Marble, and both shipped fonts are OFL. Their `NOTICE.md` is the right shape: one table
per asset class with source + licence, plus a trademarks section. Also copy
the practice of an on-screen credit while streamed imagery is visible (their
`BodyImagery.credit` -> `UI.setImageryCredit`); we currently show none.

First cut: `LICENSE` (MIT, matching their choice and the README's
open-source framing), `NOTICE.md` with the provenance already recorded in
`docs/ISS_MODEL_CONTEXT.md` and `public/textures/README.md`, the OFL text
beside `public/fonts/*.woff2`, and a one-line credit in the About panel (B.7).
Check: link check on the new files; no code change.
Cost: under an hour. Legal hygiene, not a feature.

**Landed (PR #14):** `LICENSE` (MIT), `NOTICE.md` (data, models, imagery,
fonts, dependencies, trademarks), `public/fonts/OFL.txt`. The on-screen
imagery credit still rides with the About panel (B.7).

##### D.5 - Social/SEO metadata - LANDED 2026-10-19

**Problem (as of 2026-10-19, now fixed):** `index.html` had a description and
favicons but no `og:*` / `twitter:*` tags, no `robots.txt`, no `sitemap.xml`
and no share image. Theirs has the full set including `og:image` dimensions,
locale and alt text, plus both files in `public/`.

First cut: OG/Twitter block in `index.html` (title, description, a 1200x630
image - D.7 makes capturing one easy), `robots.txt`, `sitemap.xml`, absolute
URLs against the single Vercel deployment.
Check: an OG debugger previews correctly; `/robots.txt` and `/sitemap.xml`
return 200.
Cost: under an hour.

**Landed (PR #14):** OG/Twitter block in `index.html`, `robots.txt`,
`sitemap.xml`, and `public/og-image.png` at 1200x630. The image is generated
artwork, not a screenshot: canvas `toDataURL` returns a cleared buffer under
`preserveDrawingBuffer: false`, so it was composed from the project's own
palette and self-hosted fonts. The generator is a throwaway script, not
committed - regenerate from this description if the branding changes.

##### D.6 - Mobile frame: safe-area insets, coarse-pointer sizing, render scale - LANDED (CSS half 2026-10-19; hit areas and render scale 2026-10-26, plan 017 R4/R6)

**Problem (as of 2026-10-19, CSS half now fixed):** `src/index.css` had zero
`env(safe-area-inset-*)` and no `(pointer: coarse)` branch; on a notched phone
the bottom orbit tape and the top corners sat under the home indicator /
notch. Theirs uses safe-area in every fixed panel, a
coarse-pointer block for larger tap targets, and caps DPR at 1.5 on
`(pointer: coarse)`.

First cut: safe-area padding on `.hud-frame` and the four corner clusters;
`@media (pointer: coarse)` raising control hit areas to >= 44 px; a manual
render-scale override in the settings popover that PINS the `DprGovernor`
while set (do not multiply silently - that would fight the governor's own
history).
Check: 390x844 emulation, portrait and landscape; tape and corners clear the
insets; the governor does not fight the override.
Cost: one session, CSS + one settings field. Folds into C.3.

**Landed (PR #14), CSS half:** every viewport-anchored cluster pads by
`env(safe-area-inset-*)` through `max()`, so the old spacing is the floor and
desktop layout is byte-identical. `index.html` gained `viewport-fit=cover` -
without it `env()` reports zero on iOS and the whole change is inert.
**Landed 2026-10-26 (plan 017 R4/R6):** the `(pointer: coarse)` block gives
every HUD control a ≥ 44×44 hit area. "Render scale" in the settings popover
(`renderScale.ts`) pins the DPR at 100/75/50% of the ceiling and stops the
governor sampling; Auto starts a fresh governor.

##### D.7 - Save-frame (screenshot)

No capture path exists. Their `saveScreenshot` calls
`renderer.domElement.toDataURL('image/png')` immediately after `render()` in
the same rAF callback - no `preserveDrawingBuffer: true` needed, which is the
part worth copying (the flag costs memory and bandwidth on every frame).
Ours renders in the composer's priority-1 `useFrame`; capture from a
priority-2 `useFrame` after `composer.render()` in the same frame, filename
from the simulation epoch.

Measured 2026-10-19 while building the OG card: reading the canvas from a
`requestAnimationFrame` callback that is NOT the render frame returned an
all-black image (mean 0, max 0 over a 300x158 sample) - the buffer had
already been cleared. The same-frame constraint above is load-bearing, not
a style preference.

Touches: `Postprocessing.tsx` (capture hook or a store flag), one HUD button
+ shortcut, `formatters` for the filename.
Check: captures with Bloom on and off match the screen; no
`preserveDrawingBuffer` added.
Cost: half a session.

##### D.8 - Streamed Earth imagery (NASA GIBS) for close-range detail - big

Our surface is one 4K equirect map (day 1.05 MB, night 249 KB): ~10 km per
texel at the equator. At INSPECT range the ground is visibly soft. Their
Earth streams Blue Marble NG + VIIRS Black Marble from NASA GIBS (up to
~500 m/px at their deepest level, 512 px tiles) and Moon/Mars from NASA
Trek. The borrowable design
is `TileGlobe.ts`: a quadtree refined by screen texel size
(`REFINE_PX = 1.6`), horizon + frustum cull per node, `MAX_CONCURRENT = 8`,
queued requests dropped after `STALE_REQUEST_MS = 150`, a 320-texture budget
with 4 s pruning, and the key trick - an unfinished tile renders its parent's
texture through a UV sub-rect (`mapInto`), so refinement never flashes
level 0.

Integration risks, all real:

- Our surface shader owns the terminator, the cloud shadow (`cloudDensity.glsl`), the ocean
  Fresnel and the city-light curve. Their `tile.frag` re-derives lighting and
  has none of the cloud-shadow taps; porting the tile path means porting
  those features or accepting a visible regression at the swap.
- `vercel.json` CSP `img-src` must add `https://gibs.earthdata.nasa.gov`
  (plus the credit line from D.4).
- `check-asset-budget.mjs` gates only initial assets, so streamed tiles are
  exempt by construction - state that in its comment.
- Fill rate: our scene is already fill-bound (4K maps + bloom at up to 2x
  DPR). Their 320-texture budget was measured on a different scene; measure
  ours before adopting the number.
- Their loader is a module-level singleton shared by every globe; keep ours
  per-globe so a disposed globe cannot leave queued jobs behind.

Do this only after A.2's measured baseline and C.6's cheap cuts. First cut:
Earth only, day layer only, level <= 5, behind a settings toggle default off.

##### D.9 - Reverse-time playback - optional, has a real blocker

Their `TimeSystem` has a signed direction with mirrored rate steps, so the
clock runs backwards. Ours clamps `setTimeScale` to 0.1..1000 and only
advances. The blocker is not the clock: `ISSAnimations` integrates BGA and
TRRJ slew with `Math.max(0, epochMs - lastEpochMs)`, so a backwards epoch
yields `dtSim = 0` and those joints freeze while the station moves (SARJ is
not rate-integrated and would still follow). `OrbitLine` already handles
backwards seeks; the tape's phase glide is direction-agnostic.

First cut (if wanted): signed epoch deltas in `ISSAnimations`, `-1x` in
`TimeControls`, caps applied to `|dt|`.
Check: 10 s of reverse at 1x leaves the joint pose bit-identical to the same
epoch reached forward.
Cost: one session. Low value for a tracker; listed for completeness.

#### Small items that fold into existing work

- `F1` help overlay + one shortcut registry (their `?` modal) -> C.4 —
  landed as 017 A1 (`?` overlay, `src/ui/shortcuts/shortcutRegistry.ts`).
- Accent-folded place search (`normalizeQuery`: dotless i, NFD) -> B.3 —
  landed with the offline city search (`src/core/geo/CitySearch.ts`).
- Render scale -> D.6.

#### Rejected, with reasons

- **Floating origin + 10^13 km log-depth scene.** Our float32 at ~7,000 km has
  ~0.8 m precision and the scene spans 2e6 km. No need.
- **Pointer-lock free flight (WASD/QE).** Fights drei CameraControls and the
  mode machine; our Free mode is a pan, not a flight.
- **Tours / TTS / Academy / mission planner / Lambert solver / i18n / star
  catalogue.** Different product. Their HYG binary is CC BY-SA
  (share-alike) - do not copy it.
- **`frustumCulled = false` as a default.** They disable culling almost
  everywhere; keep culling.
- **Unconditional composer.** Our bloom-off parity is a contract.
- **Exposure / FOV sliders.** Bloom threshold 2.4 and the tonemapping are
  calibrated to the sun's glare budget (`sunGlareConfig.ts`); a user
  exposure would invalidate that. Render
  scale (D.6) is the safe lever.
- **Their settings merge, nginx real-IP config, no-test CI.**

#### Licensing boundary

- **Code: MIT.** Adapting the shadow math (eight lines of standard analytic
  geometry) is fine; reimplement from the geometry and note the source in a
  comment.
- **Data: do not copy.** The HYG-derived catalogue is CC BY-SA 4.0. NASA
  imagery is public domain under the NASA media guidelines (no implied
  endorsement); the GIBS layer ids are facts.
- **Brand: no borrowing.** The name and logo are trademarks of BigBrains.

**Net:** D.1 and D.2 were the two changes with real user-visible payoff for
under a session each, and both have landed. D.3 corrected our own B.2 spec and
landed with it. D.8 is the only large borrow left worth doing, and only after
the perf baseline.


# From docs/NEXT_STEPS.md — Older items

### Older items - status folded into the roadmap

- **Perf run (old item 0).** Baseline MEASURED 2026-10-04 (history:
  "Open-items pass" in `plans/PROGRESS-history.md`): overview and 300x are
  vsync-steady 60 fps; Bloom is free; close-up High-fidelity ISS is the only
  measurable cost (~5% of frames at 30 fps). Remaining: the matrix on other
  GPUs, plus the C.6 cuts. Original suspect list + gate constraints live in
  that history entry - still the rules for any perf change.
- **Quick wins (old item 1).** Orbit line/terminator/glint/bloom: done
  (2026-09-28/29). Lens flare: reworked 2026-10-04. Hide-HUD toggle (`H`):
  done 2026-10-19 (PR #14). Still open, small: Branding pass
  (icon set and loading screen landed 2026-10-26 as 017 I1/I2; the share
  image waits on the name, I3). Info/About panel: landed 2026-10-26 (017 P,
  was B.7 "What's real").
- **Time controls (old item 2).** DONE 2026-09-28. `L` / `R` and the rate
  shortcuts landed 2026-10-26 (017 A1).
- **ISS attitude (old item 3).** DONE - LVLH/TEA in `ISSGroup`, SARJ
  tracking, BGA beta tilt landed 2026-10-04, TRRJ illustrative mode.
  The TRRJ law (edge-to-Sun in daylight, face-to-Earth in eclipse) is
  implemented as an illustrative autotrack. Optional remains: a parked-TRRJ
  operations profile and Canadarm2/ERA poses (needs rig work; no dedicated
  nodes).
- **Module explorer (old item 4).** Future. The asset-budget collision is
  solved: IGOAL streams on demand; `check-asset-budget.mjs` gates only the
  initial load. Per-module raycasting/selection/exploded view remain.
- **Ground track + passover (old item 5).** = roadmap B.2 (landed) + B.3.
- **Responsive audit (old item 6).** Still open. Keep sizing in the
  stylesheet: inline styles beat media queries (historical bug twice).
- **Geo proxy (old item 7).** Conditional on field reports; follow the
  `api/tle.ts` pattern (`api/geo.ts` + `vercel.json` functions entry).
# From docs/HANDOFF.md — session logs and status

### Where things stand

**Project**: ORBITAL — real-time ISS orbital visualization (React 18,
TypeScript strict, Vite 6, React Three Fiber + three r170, Tailwind v4,
zustand 5, satellite.js). Git repo: `github.com/slklnarnv/orbital`; the
remote is the source of truth for history.

**Run / verify**:

```bash
npm ci
npm run dev
npm run verify     # asset budget + shader ramps + tsc + lint (0 warnings) + unit tests + build
```

All green at handoff.

### Session log — 2026-10-24/25 (improve-skill audit, waves 1-2)

Read this block first. Results: `plans/PROGRESS.md`; index: `plans/README.md`.

- **Locate sweep angle is signed** (`CameraFlightPath`), so close departures
  land on the planned standoff; duration formula in the camera facts below.
- **Eclipse countdown** = the line under the gauges (`GaugesCluster.tsx`), fed
  by `telemetryStore.sunlit` / `shadowTransitionInMs` (`ShadowForecaster`,
  `core/orbital/EclipseForecast.ts`). It bisects the 0.5 penumbra crossing
  (`isSunlit`), the edge the TRRJ law uses; ISS lighting fades with
  `sunVisibility`.
- **Ground track**: the HUD globe (`GroundTrackGlobe.tsx`) draws +/- half an
  orbit, dotted behind and solid ahead. The 3D track + footprint
  (`rendering/earth/GroundTrack.tsx`) is the "Ground track" setting, default
  off; depth is a constant clip-space bias (`groundTrackDepth.ts`), not
  `depthTest: false`; keep its colours <= 1.0 (bloom threshold).
- **Station shadows** (`rendering/iss/stationShadow.ts`): the "Shadows"
  setting, default on. The sun light (`SunLight`) stays `SUN_LIGHT_DISTANCE`
  up-sun of its target; ISSModel aims the target at the station. The map is
  cached (`autoUpdate = false`); if a shadow looks stale, check that
  `ShadowRefreshScheduler` sees the change (sun in station frame, joint
  angles) before touching bias.
- **Geo freshness** (`GeoLookupService.ts`): place 30 days; weather refreshes
  after 15 min and is hidden past 1 h; local time is null without a UTC offset,
  never another cell's clock; persisted rows must pass `isGeoSnapshot`.
- **Playwright hooks** (`npm run test:e2e`, production preview, network stubbed
  with `page.route`): `#btn-locate-iss`; `[role="status"]` ("Follow · Locked");
  `aria-label` "Pause time" / "Resume time" / "Render settings" (dialog with an
  "Orbit line style" radiogroup); `html.hud-hidden` after `H`; settings in the
  `orbital-settings` localStorage key. The loading overlay swallows pointer
  events until the `progressbar` named "Loading" is gone, and the rAF loop defeats actionability
  waits: click by coordinates.
### Session log — 2026-10-23 (Locate LOD + two-tier detail)

Read this block before the older chronological list below. The 2026-10-19 PR
block follows it.

**The report:** a cold Locate on slow wifi loaded the first tier, departed,
and then showed the schematic Model A before swapping to IGOAL mid-flight with
a hitch. Cause: the full asset is 20.5 MB / 2.665M triangles and the departure
gate is bounded at 8 s; 76% of the triangles are `Details_*` greebles.

**The fix:** a derived Locate tier (`public/models/iss_igoal_locate.glb`,
5.27 MiB, 784k triangles, 703 nodes, full 12-joint rig, 512 px textures) is
loaded first for Locate/Follow; the full `iss_igoal.glb` is requested only
inside the 200/220 km Inspect band. Measured LOD decode ~0.2 s Draco + ~0.5 s
WebP vs ~3.6 s for the full asset. A high failure keeps the committed LOD; a
LOD failure demotes to legacy.

- Build: `scripts/build-iss-locate-lod.mjs` / `npm run build:iss-lod` strips
  details except the silhouette keep-list, simplifies 0.3/0.03, resizes
  textures to 512, Draco 12/8/10, validates the candidate, then publishes.
- Runtime: `DetailQuality` adds `locate`; `shouldAwaitDetail` gates on the
  first committed tier; `isClose` (200/220 km) starts the full asset. A
  prepared-URL set skips re-preparing the LOD when it becomes the committed
  model, avoiding a remount hitch.
- Caching: `__BUILD_ID__` is now the versioned `.glb`/`.webp` content hash, so
  docs/code deploys keep the model cache. A 5 s boot-idle, connection-gated
  bare fetch warms the LOD; the full asset is not prefetched.
- **2026-10-25 rebuild** (supersedes the sizes and WebP figures above): both
  tiers now ship KTX2 / Basis ETC1S textures and the authored IGOAL materials
  (`docs/ISS_MODEL_CONTEXT.md` §1.1). The LOD is derived from the high build's
  master, keeps every rig node, and with rigid batching measures 6.20 MiB
  (≈5.5 MB brotli, was 4.4), 176 draw primitives (was 432) and ~20 MiB of GPU
  texture memory (was ~97). The full asset is 27.1 MiB (≈24.2 MB brotli, was
  16.5) with 217 draw primitives (was 980) and ≤228 MiB of texture memory
  (was ~700). Image decode left the main thread
  (transcoding runs in workers), so the GPU preparation is shorter.
- Verified: `npm run verify` exit 0 (246 tests), LOD passes
  `iss-model-manifest --check-only`, high asset unchanged. **Browser-verified
  2026-10-23** (headless Chrome 156, live): Locate reached `Follow · Locked`
  and requested only the LOD (4.80 MB / 2.4 s, then a 49 ms cache hit);
  zooming to `Inspect · Locked` requested `iss_igoal.glb` once
  (17.95 MB / 7.4 s); no console errors. Remaining: a human visual pass on the
  swap/hitch and a throttled cold-Locate repeat.
- Open: KTX2/meshopt for the full asset (C.2); high-tier preload heuristics if
  the Inspect wait feels long; VRAM overlap while both tiers are resident.

### Session log — 2026-10-19 (PRs #14/#15, merged 2026-10-23)

Read this block before the older chronological list below; it is the current
state. Both PRs merged 2026-10-23, #14 first, then the stacked #15.

**PR #14 `feat/tier0-gains`** — five borrow items from the youreyesinspace
comparison in `docs/NEXT_STEPS.md`, none touching simulation truth:

- `ISSModel.prepare()` uploads textures on a 6 ms per-frame budget instead of
  yielding one frame each (73 maps, 178 ms of GL work; 73 → 30 frames).
- `__BUILD_ID__` → `?v=` on the model/texture URLs; `/models` and `/textures`
  are `immutable`. **`/draco` is NOT** — `useGLTF.setDecoderPath` builds its
  own URLs with no `?v=`, so `immutable` there would pin a stale decoder.
- `H` hides the HUD (`toggleHud` in `src/ui/shortcuts/useShortcuts.ts`,
  `.hud-hidden` on `<html>`, `visibility` so layout is untouched). Not
  persisted. Since 017 A1 every global key lives in `shortcutRegistry.ts`.
- Safe-area insets on every anchored cluster + `viewport-fit=cover`
  (without it `env()` is 0 on iOS).
- OG/Twitter metadata, `robots.txt`, `sitemap.xml`, generated `og-image.png`;
  `LICENSE`, `NOTICE.md`, `public/fonts/OFL.txt`.

**PR #15 `fix/orbit-line-dashes`** — two measured `OrbitLine` defects:

- The arc spanned the NOMINAL 92.68 min period against a 92.98 min element
  set and dropped its final partial step, leaving a **214 km gap** where the
  ring should close. Now driven by the live period
  (`OrbitalEngine.periodMinutes`) with the step rounded, not truncated:
  214 km → 11–16 km, the residual being SGP4's own non-closure.
- The dash pattern slid ~1.8 pitches every refresh because `LineMaterial`
  keyed it on `instanceDistance` measured from the arc's trailing edge, which
  moves ~460 km per refresh. #15 fixed it with an absolute `dashOffset` from
  the clock. 017 V4 (2026-10-26) replaced that: the dash is computed in the
  shader from each vertex's orbital phase (a function of its epoch, so a
  point on the ring keeps its phase in every arc) and sized with screen-space
  derivatives in power-of-two levels — no offset, origin or per-frame sizing
  (`OrbitPhase.ts`, `orbitLineMaterial.ts`, `shaders/orbitDash.glsl`).

**Merge order mattered: #15 was stacked on #14.** `fix/orbit-line-dashes` was
branched from `feat/tier0-gains`, so its diff against `main` carried all 25
files of #14 plus the orbit-line changes. They were merged in that order —
#14 first (merge commit `4d45d64`), then #15 (`b314bac`) — so each change
landed through its own PR.

### What this session changed (chronological)

0. **IGOAL model forensic audit + corrections** — read
   `docs/ISS_MODEL_CONTEXT.md` FIRST (complete briefing: verified
   measurements, animation math, tooling traps, verification protocol),
   then `docs/MODEL_AUDIT.md`. An external audit's headline
   findings (undersized solar arrays, stale bounds, mis-centered pivot) were
   all artifacts of a `getScalar(index, component)` API misuse in
   `scripts/iss-model-manifest.mjs`; the fixed tool now reproduces the build
   report exactly. Real fixes that DID come out of the audit:
   `ISSAnimations` now drives the authored SARJ/TRRJ joint nodes
   (`PORT_ALPHA_ROT`, `STBD_TRRJ_GAMMA_ROT`, …) instead of re-parenting
   arrays onto synthetic pivots (the "bent inner arrays" cause), and the
   P1/S1 radiator subtrees get a dedicated white (Z-93) coating split at build time (`splitRadiatorPanels`;
   the runtime mount override is gone) (source MLI assignment read near-black). `[ISS AUDIT]` logs the mounted
   asset; `scripts/iss-model-inspector.html` is the browser harness for
   model forensics (serve with the dev server and open directly).
1. **HUD redesign, pass 1** — replaced the original glass-panel dashboard with
   a broadcast-style edge-anchored HUD (Starship stream was the reference).
2. **HUD redesign, pass 2 — "observatory console"** — deliberate divergence
   from the SpaceX look (user request). This is the current design.
3. **Ground-point enrichment** — "Passing over: place · coords · local time ·
   weather" in the bottom-right cluster.
4. **Close-range ISS jitter fix** — frame-order bug in the camera pipeline.
5. **`docs/NEXT_STEPS.md`** — ranked roadmap for future sessions. Read it next.

### Next steps

`docs/NEXT_STEPS.md` holds the current ranked menu of candidate work — read
it next. As of 2026-10-25 the top of that list is:

1. Re-check the live deployment after the wave 1–2 merges: `/models/*` and
   `/textures/*` answering `immutable` with `?v=<asset hash>`; `/robots.txt`,
   `/sitemap.xml`, `/og-image.png` 200. Then a human visual pass on the
   penumbra fade, the countdown, the ground track and the Bloom MSAA edges. On
   a throttled connection, Locate must depart on the detailed LOD (not the
   schematic) at Follow, with the full model appearing only below 200 km.
2. **B.3 — next visible pass** (reuse `isSunlit` and the forecaster pattern;
   needs CSP and `Permissions-Policy` changes for city search and geolocation).
3. D.6's remainder and C.4 accessibility (C.5, the changelog and
   Dependabot, landed 2026-10-26).

# From plans/README.md — plans index (plans 002–016 deleted; `git show 27241be:plans/<file>`)

## ISS model implementation handoff

> STATUS 2026-10-08: plan 001 is COMPLETE (merged via PR #12; Phases A-F
> landed). Phase D (rigid batching) landed 2026-10-25.
> Live ledger: plans/PROGRESS.md (short) + plans/PROGRESS-history.md (archive).

Read [001 — ISS model audit and repair](001-iss-model-audit-and-repair.md) in full before implementing.

The user requested one consolidated implementation document after a read-only audit. No application source or model assets were changed. This directory contains the deliverable, not completed fixes.

**Fresh-session bootstrap**: read `plans/001-*.md`, `docs/ISS_MODEL_CONTEXT.md`, then `plans/PROGRESS.md` (exact per-file implementation ledger, updated as work lands). Do not rely on chat history.

### Execution order and status

| Plan | Priority | Status | Dependencies |
|---|---|---|---|
| [001 — Repair ISS articulation, preserve the rig, and correct model integration](001-iss-model-audit-and-repair.md) | P1 | All phases landed (Phase D rigid batching 2026-10-25) — see plans/PROGRESS.md | None; execution phases below |

Baseline: `fd5d353` plus the working-tree excerpts and asset hashes recorded in the plan, audited 2026-09-27. Do not assume the commit captures uncommitted source changes.

#### Core model work

1. **Phase A — Independent asset/rig checks and safe publication.** Fix missing WebP extension registration, misleading bounds validation, incomplete rig requirements, and six pruned attachment frames.
2. **Phase B — Deterministic mechanism repair.** Correct TRRJ axis/shaft behavior, remove attitude-dependent AABB inference, constrain the radiator control law, and fix oscillator/spec association.
3. **Phase C — Panel-specific material repair and validated rebuild.** Correct actual panel surfaces; remove the blanket runtime silver override.
4. **Phase D — Animation-safe rigid batching.** Merge only inside protected rigid/module regions. Measure draw calls and decoded costs; retain future joints.

Dependencies: A establishes the contract; B/C must be verified before D optimizes the repaired rig. Geometry optimization is not the first step.

#### Related integration work

5. **Phase E — Model normalization and lifecycle.** Correct Legacy's heading/span/center and Model A's span/center; repair the fallback boundary, active/pending selection handoff, reselection, and Locate availability. Keep this review separate from the High geometry patch.
6. **Phase F — Camera clearance and discontinuous pose handling.** Use corrected swept envelopes and coherent pose resets. Preserve ordinary tracking, the right-handed frame, and the common 109-unit scale.

E's loading-boundary correction can be developed independently. Final acceptance includes model switching after B/C. F's clearance values depend on the corrected assets, so do not freeze a new radius before those changes.

### Evidence covered

- Original binary FBX metadata, 702 model records and parent connections; raw and shipped GLB comparison.
- Actual Three/Draco decoded geometry and mounted asset measurements.
- Standalone and in-app visual inspection; a 5,700-second simulation run at 120×.
- Controlled High/A load failures, preparation failure, reselection, and selection during Locate.
- Actual camera/array intersection and a real half-orbit seek through the renderer.
- Primary NASA mechanism/operations references and Khronos WebP requirements.
- **Follow-up (orientation/solar, same day):** anatomical handedness/landmark verification on the mounted High model; a 56-case β/phase sweep of the actual shipped SARJ controller plus validated BGA correction; iROSA cant measured at 10.0012° (matches the published ~10° install cant); Sun/light/eclipse input consistency; negative-determinant mesh inventory; Russian-array rigging absence. Result: High is **not** upside down or mirrored and SARJ tracking is numerically correct; new optional findings S2 (BGA tilt), S3 (Russian array rigging), S4 (merge caution list), S5 (blanket underside texture) are in plan 001 sections 3–5 and the acceptance matrix.

Full numerical evidence, source references, acceptance matrix, scope boundaries, and verification limits are in plan 001. No production build, unit-suite run, or cross-device benchmark is claimed.

### Findings considered and rejected

See section 9 of plan 001 for the complete list. Important exclusions:

- High's enlarged 109-unit scale is intentional; do not reduce it.
- Eight original wings, six iROSAs, both EATCS banks, and ERA geometry are present.
- A TRRJ origin inside the longitudinal span is not inherently an incorrect shaft pivot.
- High's anatomical pre-rotation is not shown to be reversed; Legacy has its own verified mismatch.
- Cached GLTF resource sharing does not justify unconditional disposal.
- Static Legacy/A and currently parked BGAs are intentional, not missing animation bugs.

### Optional direction, not implementation prerequisites

Validated shutters/additional cameras, BGA pose control, and robotics sequences can be added incrementally. ERA/deployment needs actual rig/mesh work. KTX2 and operational flight-attitude data are separate choices. The plan preserves their useful boundaries without claiming to implement these features.

Executors should update this row only after the applicable end-to-end acceptance criteria pass. Status values: TODO, IN PROGRESS, DONE, or BLOCKED with a concrete reason.

### Improve-skill audit plans (2026-10-24, planned at `e78d38d`)

Generated by the `improve` skill (deep audit: six parallel auditors, every
finding re-read and vetted by the advisor). The user pre-selected "all
important and relevant" work, so plans were written without a selection
round. Executors: read the plan fully, honor its STOP conditions; the
reviewer maintains this table.

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [002](002-refresh-fallback-tle.md) | Fresh packaged fallback TLE | P1 | S | — | DONE |
| [003](003-toolchain-security-and-node22.md) | Patched toolchain, full CI audit, pinned actions, Node 22, scheduled TLE refresh | P1 | S | — | DONE |
| [004](004-telemetry-correctness.md) | Telemetry: offline-start recovery, confidence, clock rate, stale proxy, bootstrap race, same-instant blend | P1 | M | — | DONE |
| [005](005-geo-service-correctness.md) | Geo: separate freshness, no frozen clock, validated cache rows | P2 | S–M | — | DONE |
| [006](006-rendering-correctness.md) | Rendering: stable glint uniforms, composer-variant prep, flare mask, PMREM dispose, lifecycle edges | P1 | S–M | — | DONE |
| [007](007-bloom-path-msaa.md) | MSAA on the bloom composer target | P2 | S | — | DONE |
| [008](008-locate-sweep-signed-angle.md) | Signed Locate sweep angle | P2 | S | — | DONE |
| [009](009-core-math-tests.md) | Known-answer tests: OrbitalEngine, GMST, formatters, rate limiter, orbit-tape math | P2 | S–M | — | DONE |
| [010](010-hud-hygiene.md) | Production crash screen, sentence-case strings, dead constants | P3 | S | — | DONE |

Wave 2 (planned at `aa206a1`, after wave 1 merged):

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [011](011-penumbra-sun-visibility.md) | Penumbra sun visibility (roadmap D.1) | P1 | M | 006 | DONE |
| [012](012-day-night-countdown.md) | Day/night countdown in the HUD (B.1) | P2 | M | 011, 004 | DONE |
| [013](013-playwright-smoke-suite.md) | Playwright smoke suite + CI job (A.3) | P2 | M | 003 | DONE |
| [014](014-ground-track-hud.md) | Ground-track sampler + HUD globe track (B.2 first cut) | P2 | S–M | — | DONE |
| [015](015-ground-track-3d.md) | Optional 3D ground track + footprint with constant-ulp depth bias (B.2 + D.3) | P3 | M | 014 | DONE |

| [016](016-docs-pass.md) | Docs pass: fold errata banners, fix drift, record waves 1–2 | P1 | M | 002–015 | DONE |

Roadmap (2026-10-26, after B.3 and the scrub fix):

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [017](017-display-visuals-polish-roadmap.md) | Display, visuals and polish roadmap: responsive HUD, clouds, 8K Earth, sun, dashed orbit, identity, shortcuts + help, info panel, module explorer | P1–P3 | L (umbrella) | — | PLANNED |

The docs pass (016): fold both errata banners, fix the drift the
audit found (60→70 km clearance, `lerpLookAt`, MiB units, flight formulas,
test counts, layout, LIVE/HYBRID wording), and record everything that landed.

#### Dependency notes

- Wave-1 plans touch disjoint files and can run in parallel.
- 002 refreshes the data once; 003 automates the refresh.
- The penumbra plan must follow 006 (both edit `ISSModel.tsx`).
- The countdown plan must follow 004 (both touch telemetry) and the penumbra plan.
- The Playwright plan must follow 003 (both edit `package.json` and CI).

#### Findings considered and rejected (do not re-audit)

- Gate LIVE/HYBRID on TLE epoch age instead of fetch time: CelesTrak sets are
  routinely 12–36 h old at download, so a fresh fetch would read "Cached".
  The README wording is wrong instead (docs pass).
- `extractTLEEpoch` lacks validation: every caller receives TLEs already
  validated by `validateTLEData`, which checks the epoch field.
- Orbit tape `aria-valuenow={0}`: React never re-applies an unchanged prop;
  the frame loop's imperative ARIA writes stand.
- Lazy-loading the postprocessing chain / rig JS (roadmap C.2 code half):
  ~15 kB gzip, already needed at boot; C.2 stays about assets.
- Draco-free Model A, 5-tap cloud-shadow filter, per-frame small allocations,
  HUD re-render cadence, OrbitTape `left` writes: negligible measured cost.
- Starmap tone-mapped on the composer path: invisible in practice.
- ISSModel frame callback one frame behind ISSGroup: ≤5° earthshine skew only at 300×.

#### Deferred (real, but larger or needing a decision)

- Coupled majors: React 19 + R3F 9 + drei 10 (L), then three r18x (M),
  Vite 7/8 + plugin-react + vitest 5 (M), satellite.js 7 (S–M).
- CSP: drop `style-src 'unsafe-inline'` after a Report-Only rollout.
- Split god components (`ISSModel.tsx`, `CameraController.tsx`, `App.tsx`)
  after characterization tests; decouple `GeoLookupService` from zustand.
- Prettier + editorconfig (whole-repo reformat; do it between feature waves).
- Investigate visually first: orbit dash float32 precision after long
  accelerated sessions, Earth/sun stepping at 10 Hz under 300×, prefetch
  competing with first-paint textures on slow links. (Resolved 2026-10-25:
  the attitude lag at 300× — `AttitudeFollower` follows the LVLH target
  exactly and the interpolator blends velocity; the hidden detail model's
  matrix updates — measured 0.03 ms/frame on the batched assets.)

