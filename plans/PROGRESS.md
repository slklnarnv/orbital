# PROGRESS — current ledger

> This is the SHORT ledger: current state, verification gates, open items.
> Full landed history (2026-09-23 → 2026-10-08) is preserved verbatim in
> `plans/PROGRESS-history.md` — nothing was deleted in the split.
> Plan 001 (ISS model audit/repair) lives in `plans/001-*.md` + `plans/README.md`.
> Front door: `CLAUDE.md`. Current state + ranked roadmap: `docs/NEXT_STEPS.md`.

## Current state (2026-10-08, main @ `35ec297`)

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
  (tests + scripts + configs) → lint (0 warnings) → 227 unit tests → build.
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
- **Faster Locate on fresh load**: planned, not started — `docs/NEXT_STEPS.md`
  roadmap C.6 (texture-upload batching + network warm; deep cut = C.2).
- **Features/engineering roadmap**: `docs/NEXT_STEPS.md` "Roadmap" section is
  the ranked list (day/night countdown, ground track, visible passes, …).

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
