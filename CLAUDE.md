# CLAUDE.md - ORBITAL front door

Agents read this file automatically. It is the only doc guaranteed to be
opened; everything else loads on demand.

## Rule 1 - run `npm run verify` before anything else

```bash
npm run verify   # asset budget -> shader ramps -> typecheck -> lint -> unit tests -> build
```

It is the release gate; never commit red. A first run also catches environment
surprises (Node 20 has no global `navigator` - guard module-scope browser
reads; this broke CI once). Requires Node 20+.

## What this is

Real-time ISS visualizer: public TLEs -> SGP4 (`satellite.js`) -> simulation
advanced at 10 Hz by a runtime fully decoupled from React and WebGL ->
interpolated into a React Three Fiber scene. React 18, TypeScript strict,
Vite 6, three r170, zustand 5, Tailwind 4. Deployed on Vercel (static +
`/api/tle` function).

## Commands

- `npm run dev` - Vite; serves `/api/tle` through the real handler
- `npm test` - Vitest watch
- `npm run refresh:tle` - refresh `src/data/fallback-tle.json` (before releases)
- `npm run preview` - production bundle locally
- `npm run verify` - the gate (see Rule 1)

## Map

- `api/tle.ts` - Vercel function; guarded (GET/HEAD only, query-refusal,
  warm memo + dedupe, stale-on-error)
- `src/core/` - simulation truth: clock, runtime, SGP4, telemetry manager,
  geo lookup. No React, no three.
- `src/interaction/` - camera state machine, flights, constraint, sensitivity
- `src/rendering/` - scene graph: `earth/`, `iss/` (model + joints),
  `post/` (bloom + flare), `shaders/` (GLSL), `scene/`
- `src/stores/` - zustand UI projection (throttled, never per-frame)
- `src/ui/` - HUD clusters; `src/index.css` is the HUD design system
- `scripts/` - GLB build pipeline (`build-iss-model.mjs`) + asset/shader gates
- `docs/` - deep docs; `plans/` - ledger + plan 001 + history

## Hard invariants (breaking any of these is a bug)

- 1 world unit = 1 km. Earth radius 6371 km (spherical); geodetic math is WGS84.
- TEME to world mapping is (x, z, -y); the Earth group rotates by GMST
  (that is the ECEF frame).
- Bloom OFF must render bit-for-bit like the direct pipeline (no composer).
- Camera frame order: drei `CameraControls` updates at `useFrame` priority -1;
  anything that moves the target calls `controls.update(0)`; every flight
  takeover runs `syncRenderedPoseToControls` (read the pose BEFORE adopting
  the rendered up - the order is load-bearing).
- Joint animation math is pure and unit-tested in `ISSJointKinematics.ts`.
  BGA targets use the LIVE SARJ parent frame (a mount-time frame was the
  reverted 2026-09-28 bug). Slew caps: 12 deg/s wall-clock.
- Never hand-edit `public/models/*.glb` - rebuild via
  `scripts/build-iss-model.mjs` (candidate -> validate -> publish; backups in
  `.tmp-iss-build/`).
- The lens flare aims at the sun billboard (`SUN_BILLBOARD_DISTANCE_KM`);
  keep flare and billboard on the same point.

## Docs (reading order)

1. `docs/NEXT_STEPS.md` - current state + ranked roadmap. Keep its top
   section fresh in the same commit as behavior changes; never ship an
   errata banner - fix the stale text instead.
2. `plans/PROGRESS.md` - short ledger (current state, open items, canon
   decisions). Full history: `plans/PROGRESS-history.md`.
3. Deep docs, on demand only:
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
