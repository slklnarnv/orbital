# PROGRESS — plan 001 implementation ledger

Update this file after every landed change. A fresh session resumes from here.
Last updated: 2026-09-28 — Phases A, B, C, F and E landed and verified.
Remaining: Phase D (optional perf batching) only.

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

### Remaining work (not started, plan order)
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
