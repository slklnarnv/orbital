# ISS model implementation handoff

> STATUS 2026-10-08: plan 001 is COMPLETE (merged via PR #12; Phases A-F
> landed). Phase D (rigid batching) landed 2026-10-25.
> Live ledger: plans/PROGRESS.md (short) + plans/PROGRESS-history.md (archive).

Read [001 — ISS model audit and repair](001-iss-model-audit-and-repair.md) in full before implementing.

The user requested one consolidated implementation document after a read-only audit. No application source or model assets were changed. This directory contains the deliverable, not completed fixes.

**Fresh-session bootstrap**: read `plans/001-*.md`, `docs/ISS_MODEL_CONTEXT.md`, then `plans/PROGRESS.md` (exact per-file implementation ledger, updated as work lands). Do not rely on chat history.

## Execution order and status

| Plan | Priority | Status | Dependencies |
|---|---|---|---|
| [001 — Repair ISS articulation, preserve the rig, and correct model integration](001-iss-model-audit-and-repair.md) | P1 | All phases landed (Phase D rigid batching 2026-10-25) — see plans/PROGRESS.md | None; execution phases below |

Baseline: `fd5d353` plus the working-tree excerpts and asset hashes recorded in the plan, audited 2026-09-27. Do not assume the commit captures uncommitted source changes.

### Core model work

1. **Phase A — Independent asset/rig checks and safe publication.** Fix missing WebP extension registration, misleading bounds validation, incomplete rig requirements, and six pruned attachment frames.
2. **Phase B — Deterministic mechanism repair.** Correct TRRJ axis/shaft behavior, remove attitude-dependent AABB inference, constrain the radiator control law, and fix oscillator/spec association.
3. **Phase C — Panel-specific material repair and validated rebuild.** Correct actual panel surfaces; remove the blanket runtime silver override.
4. **Phase D — Animation-safe rigid batching.** Merge only inside protected rigid/module regions. Measure draw calls and decoded costs; retain future joints.

Dependencies: A establishes the contract; B/C must be verified before D optimizes the repaired rig. Geometry optimization is not the first step.

### Related integration work

5. **Phase E — Model normalization and lifecycle.** Correct Legacy's heading/span/center and Model A's span/center; repair the fallback boundary, active/pending selection handoff, reselection, and Locate availability. Keep this review separate from the High geometry patch.
6. **Phase F — Camera clearance and discontinuous pose handling.** Use corrected swept envelopes and coherent pose resets. Preserve ordinary tracking, the right-handed frame, and the common 109-unit scale.

E's loading-boundary correction can be developed independently. Final acceptance includes model switching after B/C. F's clearance values depend on the corrected assets, so do not freeze a new radius before those changes.

## Evidence covered

- Original binary FBX metadata, 702 model records and parent connections; raw and shipped GLB comparison.
- Actual Three/Draco decoded geometry and mounted asset measurements.
- Standalone and in-app visual inspection; a 5,700-second simulation run at 120×.
- Controlled High/A load failures, preparation failure, reselection, and selection during Locate.
- Actual camera/array intersection and a real half-orbit seek through the renderer.
- Primary NASA mechanism/operations references and Khronos WebP requirements.
- **Follow-up (orientation/solar, same day):** anatomical handedness/landmark verification on the mounted High model; a 56-case β/phase sweep of the actual shipped SARJ controller plus validated BGA correction; iROSA cant measured at 10.0012° (matches the published ~10° install cant); Sun/light/eclipse input consistency; negative-determinant mesh inventory; Russian-array rigging absence. Result: High is **not** upside down or mirrored and SARJ tracking is numerically correct; new optional findings S2 (BGA tilt), S3 (Russian array rigging), S4 (merge caution list), S5 (blanket underside texture) are in plan 001 sections 3–5 and the acceptance matrix.

Full numerical evidence, source references, acceptance matrix, scope boundaries, and verification limits are in plan 001. No production build, unit-suite run, or cross-device benchmark is claimed.

## Findings considered and rejected

See section 9 of plan 001 for the complete list. Important exclusions:

- High's enlarged 109-unit scale is intentional; do not reduce it.
- Eight original wings, six iROSAs, both EATCS banks, and ERA geometry are present.
- A TRRJ origin inside the longitudinal span is not inherently an incorrect shaft pivot.
- High's anatomical pre-rotation is not shown to be reversed; Legacy has its own verified mismatch.
- Cached GLTF resource sharing does not justify unconditional disposal.
- Static Legacy/A and currently parked BGAs are intentional, not missing animation bugs.

## Optional direction, not implementation prerequisites

Validated shutters/additional cameras, BGA pose control, and robotics sequences can be added incrementally. ERA/deployment needs actual rig/mesh work. KTX2 and operational flight-attitude data are separate choices. The plan preserves their useful boundaries without claiming to implement these features.

Executors should update this row only after the applicable end-to-end acceptance criteria pass. Status values: TODO, IN PROGRESS, DONE, or BLOCKED with a concrete reason.

## Improve-skill audit plans (2026-10-24, planned at `e78d38d`)

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

### Dependency notes

- Wave-1 plans touch disjoint files and can run in parallel.
- 002 refreshes the data once; 003 automates the refresh.
- The penumbra plan must follow 006 (both edit `ISSModel.tsx`).
- The countdown plan must follow 004 (both touch telemetry) and the penumbra plan.
- The Playwright plan must follow 003 (both edit `package.json` and CI).

### Findings considered and rejected (do not re-audit)

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

### Deferred (real, but larger or needing a decision)

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
