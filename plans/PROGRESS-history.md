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
