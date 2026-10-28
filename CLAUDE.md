# CLAUDE.md - ORBITAL front door

Agents read this file automatically. It is the only doc guaranteed to be
opened; everything else loads on demand.

## Rule 1 - run `npm run verify` before anything else

```bash
npm run verify   # asset budget -> shader ramps -> typecheck -> lint -> unit tests -> build
```

It is the release gate; never commit red. A first run also catches environment
surprises (guard module-scope browser reads such as `navigator`; Node 20
lacked a global `navigator` and this broke CI once). Requires Node 22+.

## Rule 2 - look at it before pushing

```bash
npm run check:visual   # production build -> vite preview -> Edge on the real GPU -> screenshots
```

Unit tests and Playwright check the DOM, never pixels: a dependency upgrade
once shipped a black Earth with every check green (2026-10-28). Before any
push that touches rendering, shaders or dependencies, run it, and open
`.visual-check/*.png`. It fails on a dark Earth disc or a page error.
Windows + installed Edge.

## What this is

Real-time ISS visualizer: public TLEs -> SGP4 (`satellite.js`) -> simulation
advanced at 10 Hz by a runtime fully decoupled from React and WebGL ->
interpolated into a React Three Fiber scene. React 19 (R3F 9, drei 10), TypeScript strict,
Vite 6, three r170, zustand 5, Tailwind 4. Deployed on Vercel (static +
`/api/tle` function).

## Commands

- `npm run dev` - Vite; serves `/api/tle` through the real handler
- `npm test` - Vitest watch
- `npm run test:e2e` - Playwright smoke + viewport suites (production preview); local only, not in CI
- `npm run refresh:tle` - refresh `src/data/fallback-tle.json` (CI does this
  Mon/Thu and commits to `main`; run it by hand only if CI is off)
- `npm run preview` - production bundle locally
- `npm run bench` - measured perf run: headless Edge on the real GPU,
  fps / frame-time percentiles / GPU ms per pass / tracked GPU memory per
  scenario, refuses to run while another process uses the GPU or CPU
  (`docs/bench/README.md`; Windows + installed Edge)
- `npm run check:visual` - the pixel check (see Rule 2)
- `npm run verify` - the gate (see Rule 1)

## Map

- `api/tle.ts` - Vercel function; guarded (GET/HEAD only, query-refusal,
  warm memo + dedupe, stale-on-error)
- `src/core/` - simulation truth: clock, runtime, SGP4, telemetry manager,
  geo lookup, sun visibility / eclipse forecast / ground track. No React, no three.
- `src/interaction/` - camera state machine, flights, constraint, sensitivity
- `src/rendering/` - scene graph: `earth/`, `iss/` (model + joints),
  `post/` (bloom + flare), `shaders/` (GLSL), `scene/`
- `src/stores/` - zustand UI projection (throttled, never per-frame)
- `src/ui/` - HUD clusters; `src/index.css` is the HUD design system
- `scripts/` - GLB build pipeline (`build-iss-model.mjs`, `build-iss-locate-lod.mjs`),
  `refresh-fallback-tle.mjs`, `build-place-index.mjs` (offline place names,
  `npm run build:places`), asset/shader gates
- `docs/` - deep docs; `plans/` - ledger + history, plan 001 (ISS model
  repair; model code cites its IDs) and plan 017 (display roadmap; its
  R/V/I/A/X IDs are cited in code)

## Hard invariants (breaking any of these is a bug)

- 1 world unit = 1 km. Earth radius 6371 km (spherical); geodetic math is WGS84.
- TEME to world mapping is (x, z, -y); the Earth group rotates by GMST
  (that is the ECEF frame).
- Bloom OFF must render bit-for-bit like the direct pipeline (no composer).
- Frame order (`src/rendering/framePriority.ts`): `ISSGroup` advances the
  station pose at `useFrame` priority -2, before every consumer (a child at
  equal priority subscribes first and reads last frame's pose - the
  2026-10-25 shadow flicker); drei `CameraControls` updates at -1;
  anything that moves the target calls `controls.update(0)`; every flight
  takeover runs `syncRenderedPoseToControls` (read the pose BEFORE adopting
  the rendered up - the order is load-bearing).
- Joint animation math is pure and unit-tested in `ISSJointKinematics.ts`.
  BGA targets use the LIVE SARJ parent frame (a mount-time frame was the
  reverted 2026-09-28 bug). Slew caps: 12 deg/s wall-clock.
- Never hand-edit `public/models/*.glb` - rebuild via
  `scripts/build-iss-model.mjs` (candidate -> validate -> publish; backups in
  `.tmp-iss-build/`).
- The lens flare, the sun glare overlay and the atmosphere's sunrise band
  aim at the sun billboard (`SUN_BILLBOARD_DISTANCE_KM`); keep them on the
  same point, and the glare is aimed in `onBeforeRender` (flights set the
  camera after the frame callbacks). The sun (billboard + glare) and every
  station material (`highlightKnee.ts`) stay under the bloom threshold
  (`SunGlareBudget.test.ts`, `HighlightKnee.test.ts`): UnrealBloom turns a
  compact HDR source square.

## Docs (reading order)

1. `docs/NEXT_STEPS.md` - current state + ranked roadmap. Keep its top
   section fresh in the same commit as behavior changes; never ship an
   errata banner - fix the stale text instead.
2. `plans/PROGRESS.md` - short ledger (recent changes, verification, canon
   decisions). Full history: `plans/PROGRESS-history.md` (landed detail,
   old roadmaps and session logs, archived verbatim).
3. `CHANGELOG.md` - user-facing changes by release date. A PR with a
   user-facing change adds one line under "Unreleased".
4. Deep docs, on demand only:
   - `docs/HANDOFF.md` - camera facts, geo service facts, HUD design system,
     debugging playbook. Read when touching camera/geo/HUD.
   - `docs/ISS_MODEL_CONTEXT.md` + `docs/MODEL_AUDIT.md` - GLB pipeline, rig
     contract, model forensics. Read when touching the model pipeline.
   - `docs/verification.md` - release verification notes.

## Conventions

- TypeScript strict; ESLint (`--max-warnings 0`) and CI gate every PR.
- Tests live in `tests/unit/**` (node env, no DOM); new behavior gets a
  regression test. Pure math lives in `src/core/` so it stays testable.
- User-facing text: sentence case, no ALL CAPS, "—" marks unknown values.
- Docs drift is a bug - same rule as code.
