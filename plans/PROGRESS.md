# PROGRESS — current ledger

> This is the SHORT ledger: current state, verification gates, open items.
> Full landed history (2026-09-23 → 2026-10-08) is preserved verbatim in
> `plans/PROGRESS-history.md` — nothing was deleted in the split.
> Plan 001 (ISS model audit/repair) lives in `plans/001-*.md` + `plans/README.md`.
> Front door: `CLAUDE.md`. Current state + ranked roadmap: `docs/NEXT_STEPS.md`.

## Current state (2026-10-23)

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

### Locate LOD + two-tier detail (2026-10-23)

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


### Orbit line repair (2026-10-19, PR #15)

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

### Tier 0 pass (2026-10-19, PR #14)

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

### Prior state (2026-10-08, main @ `35ec297`)

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

## Verification snapshot

- `npm run verify` green end-to-end: asset budget → shader ramps → typecheck
  (tests + scripts + configs) → lint (0 warnings) → 246 unit tests → build.
- CI green on PR #12 (ubuntu, Node 20) after guarding module-scope
  `navigator` reads (Node 20 has no global `navigator` — platform trap).
- Browser (dev server, built-in Chromium): 300× joint motion ≤0.36°/frame;
  flare lands exactly on the drawn sun; no console errors; no GPU leaks
  across 5 Bloom toggles and 6 model switches (geometry/texture/material
  counts unchanged).
- Perf baseline (AMD Radeon iGPU, ANGLE/D3D11, DPR 1): overview and 300×
  vsync-steady 60 fps; **close-up High-fidelity ISS is the only measurable
  cost** (~5% of frames at 30 fps). Bloom is free on this GPU. Full table:
  history §"Open-items pass".

## Open items

- **Phase D** (animation-safe rigid batching): POSTPONED by user decision.
  Constraints and rollback asset if ever revisited: history
  §"Remaining work (not started)".
- **Playwright smoke suite**: postponed (not installed). Built-in headless
  browser covered the browser checks so far.
- **Model A terminal-'unavailable' path**: implemented + unit-tested, but the
  live firing of `DefaultLoadingManager.onError` was never confirmed in a
  real browser. Verify only if that state ever matters.
- **Faster Locate on fresh load**: C.6a (texture-upload batching), C.6b (5 s
  boot-idle LOD warm) and the 2026-10-23 Locate LOD + two-tier detail LANDED.
  Follow-ups: browser-verify the LOD→high swap and the high-tier hitch at
  Inspect; KTX2/meshopt for the full asset via C.2 (decode/VRAM, not the LOD's
  cold-network path).
- **Features/engineering roadmap**: `docs/NEXT_STEPS.md` "Roadmap" section is
  the ranked list (day/night countdown, ground track, visible passes, …).
- **youreyesinspace comparison** (2026-10-19): borrow list D.1-D.9 in
  `docs/NEXT_STEPS.md`. Landed in PR #14: D.2, D.4, D.5, and the CSS half of
  D.6. Still open: D.1, D.3, D.7, D.8, D.9. Two findings change planned work:
  D.1 (the eclipse test is binary in three places; a 63 km penumbra is the
  honest model) and D.3 (B.2's 2 km ground-track offset z-fights above
  ~500 km ground distance, so the track needs a depth-independent draw).
- **Hide-HUD (`H`) and safe-area insets**: LANDED in PR #14 (the `H` toggle
  closes the "Hide-HUD toggle" quick win; the coarse-pointer hit-area block
  and the pinned render-scale override from D.6 are still open).
- **Orbit line, remaining polish**: the ring now closes and the dash phase is
  fixed to the orbit, but two things are still unverified or open.
  (a) The `alphaCurve` fade was NOT re-tuned — the past trail still fades
  0 → 0.30 and the future arc holds 0.60; whether those read right against
  the now-closed ring is a visual call, not a measurement.
  (b) No test covers `refreshPath`'s buffer writes or the dash-offset maths —
  the geometry is covered only by the predictor test (span, closure, step,
  budget, alpha, centring). A headless test of the instance-buffer layout
  would need a GL context, so this stays a browser check.

## Canon decisions (do not re-litigate; full context in history)

- Lens flare: deleted once, re-added by user directive, reworked 2026-10-04.
  Default OFF; it is a composer pass, so it requires Bloom.
- BGA beta tilt: attempted 2026-09-28, reverted same day; re-implemented
  2026-10-04 with live-frame math and rate caps. Per-wing behaviour changes
  need a browser visual review before landing.
- Nauka hull: user accepted the dark look 2026-09-27, then requested the fix
  2026-10-04 (landed). No further hull changes without a fresh request.
- The static fallback models (Legacy detail, Model A) are deliberately static.
- High model's enlarged ~109-unit (≈1000×) scale is intentional.
- Camera system is closed unless a measured trace says otherwise
  (`docs/HANDOFF.md` camera facts).

## History map (`plans/PROGRESS-history.md`)

Time control feature (09-28) · Visual refresh: sun/terminator/orbit line (09-28)
· Locate under accelerated time (09-29) · Render settings: orbit-line style +
flare (09-29) · OrbitLine repair + glint recolor (09-29) · Pre-commit diff
review + cleanup (09-29) · Performance run OWED note (09-29) · Phase E/F +
browser fault-injection matrix (plan 001) · Verification snapshot (09-27) ·
Independent engineering pass (10-03) · Follow-up pass, deferred items (10-03) ·
gcdatlas comparison pass (10-03) · Open-items pass (10-04).
