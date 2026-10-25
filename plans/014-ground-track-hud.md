# Plan 014: The HUD globe draws the station's ground track — where it has been and where it is going

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat aa206a1..HEAD -- src/ui/clusters/GroundTrackGlobe.tsx src/core/orbital/OrbitalEngine.ts src/core/orbital/CoordinateConversions.ts src/core/clock/SimulationTime.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (roadmap B.2, first cut)
- **Effort**: S–M
- **Risk**: LOW (SVG only; no WebGL, no depth issues)
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `aa206a1`, 2026-10-25

## Why this matters

`README.md` calls the bottom-right instrument a "station-centered ground-track
globe", but it draws only a graticule and a marker — there is no track. The
ground track (the path of the sub-satellite point) is the single most
recognisable ISS visual and answers "where will it pass next". Drawing it on
the existing orthographic SVG globe is cheap and avoids the 3D depth-buffer
problem entirely (the 3D track is plan 015, which reuses this plan's pure
sampler).

## Current state

- `src/ui/clusters/GroundTrackGlobe.tsx`: `SIZE = 78`, `C = SIZE / 2`, `R = 31`;
  `project(phiDeg, lamDeg, phi0, lam0): { x, y, visible }` (orthographic,
  `visible` when `cosC >= -0.02`); `graticulePath(samples, phi0, lam0)` builds
  an SVG `d` string, lifting the pen where points roll off the disc. The
  component reads `latitude`, `longitude` from `useOrbitalState()` (1 Hz),
  sets `phi0`, `lam0` in radians, and renders inside
  `<svg width={SIZE} height={SIZE} viewBox=…>`: the disc circle, graticule
  `<path>`s (`stroke="rgba(244,247,251,0.18)"`, width 0.6), equator paths
  (`0.3`, 0.7), then the centre marker (two circles).
- `src/core/orbital/OrbitalEngine.ts`: `propagateAt(epochMs): Vec3 | null`
  (TEME km), `periodMinutes: number | null`.
- `src/core/clock/SimulationTime.ts`: `computeGMST(julianDate)`; JD from epoch
  ms is `epochMs / 86400000 + UNIX_EPOCH_JULIAN` (`src/utils/constants.ts`).
- `src/core/orbital/CoordinateConversions.ts`: `temeToGeodetic(teme, gmst)`
  → `{ latitude, longitude, altitude }` (degrees, km; WGS84).
- `src/core/entities/ISSEntity.ts`: singleton `issEntity` with `.engine` and
  `.currentTLE`.
- `src/hooks/useSimulationClock.ts`: `useSimulationClock(throttleMs = 1000)`
  → `SimulationTime` (`epochMs`, `julianDate`, `gmst`, …), 1 Hz.
- `ISS_ORBITAL_PERIOD_MIN = 92.68` in `src/utils/constants.ts`.
- `src/core/` must stay free of React and three.
- Test pattern: `tests/unit/orbital/OrbitalEngine.test.ts` builds an engine
  from `src/data/fallback-tle.json` (`line1`, `line2`, `epoch`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| Focused tests | `npx vitest --run tests/unit/orbital/GroundTrack.test.ts` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `src/core/orbital/GroundTrack.ts` (create)
- `tests/unit/orbital/GroundTrack.test.ts` (create)
- `src/ui/clusters/GroundTrackGlobe.tsx`

**Out of scope**: any 3D rendering (plan 015), `OrbitPredictor.ts`
(different frame and buffers — do not reuse its 220-point budget),
`src/index.css`, geo/weather lines, `docs/**`, `plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch; one commit per step; never commit red.
- Subject style: `Sample the sub-satellite ground track in core/orbital`.
- End every commit body with the `Co-Authored-By:` line YOUR harness
  specifies (naming the model that did the work), then
  `Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u`.
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: Pure sampler

`src/core/orbital/GroundTrack.ts`:
```ts
import type { OrbitalEngine } from './OrbitalEngine'

export interface GroundTrackPoint {
  epochMs: number
  latitude: number   // degrees
  longitude: number  // degrees, [-180, 180]
  /** Earth-fixed position (km) of the propagated station, for 3D use. */
  ecef: { x: number; y: number; z: number }
}

/**
 * Samples the sub-satellite point from `centerMs - pastMs` to
 * `centerMs + futureMs` every `stepMs` (inclusive ends, exact step count —
 * the last sample lands on the end). Each sample uses ITS OWN GMST: the
 * Earth turns ~23° under the station per orbit, which is what makes the
 * track a sine wave rather than a great circle. Samples whose propagation
 * fails are skipped.
 */
export function sampleGroundTrack(
  engine: Pick<OrbitalEngine, 'propagateAt'>,
  centerMs: number,
  options: { pastMs: number; futureMs: number; stepMs: number },
): GroundTrackPoint[]
```
Use `computeGMST(epochMs / 86_400_000 + UNIX_EPOCH_JULIAN)`, `temeToECEF`,
and `temeToGeodetic`.

Tests `tests/unit/orbital/GroundTrack.test.ts` (real engine from the packaged TLE):
- ±½ period at 30 s → `Math.round(period/30 s) + 1` points (±1), first/last
  `epochMs` exactly at the span ends.
- every `|latitude| <= inclination + 0.2` and the max `|latitude|` over a full
  orbit is within 1° of the inclination (51.6°).
- the centre sample's lat/lon equals `temeToGeodetic(propagateAt(center), gmst(center))`.
- consecutive samples 30 s apart move < 3° in latitude (continuity).
- longitudes drift WEST over one orbit: the point one period later is
  ~22–25° west of the start (Earth rotation), wrap-aware difference.
- a stub engine whose `propagateAt` returns null for some epochs → those
  samples are skipped, no throw.

**Verify**: `npx vitest --run tests/unit/orbital/GroundTrack.test.ts` → all pass.

### Step 2: Draw the track on the HUD globe

In `GroundTrackGlobe.tsx`:
- `const simTime = useSimulationClock()` (1 Hz).
- Compute samples with `useMemo` keyed on
  `Math.floor(simTime.epochMs / 60_000)` (refresh once per simulated minute —
  under acceleration it refreshes every 1 Hz render, which is fine for ~190
  SGP4 calls) and the TLE identity
  (`issEntity.currentTLE?.line1 ?? ''`):
  `sampleGroundTrack(issEntity.engine, simTime.epochMs, { pastMs: P/2, futureMs: P/2, stepMs: 30_000 })`
  where `P = (issEntity.engine.periodMinutes ?? ISS_ORBITAL_PERIOD_MIN) * 60_000`.
  (eslint `react-hooks/exhaustive-deps` will want the exact deps: compute the
  two keys as named constants and depend on them; `simTime.epochMs` inside the
  memo is intentionally read once per key — add an eslint-disable comment for
  that ONE line with the reason, matching the existing style in
  `Postprocessing.tsx`.)
- Split samples into past (`epochMs <= simTime.epochMs`) and future.
- Build two paths with the existing projection (reuse `graticulePath` by
  mapping samples to `{ phi: latitude, lam: longitude }`).
- Render them AFTER the graticule and BEFORE the centre marker:
  past: `stroke="rgba(244,247,251,0.28)" strokeWidth={0.8} strokeDasharray="1.5 2"`;
  future: `stroke="rgba(168,216,255,0.75)" strokeWidth={0.9}` (the glint's
  light blue `#A8D8FF`), both `fill="none"` and `strokeLinecap="round"`.
- Update the component's doc comment: the globe now carries the ground track
  (past dotted, next half-orbit solid).

**Verify**: `npm run typecheck` → exit 0; `npm run lint` → exit 0.

### Step 3: Gate

**Verify**: `npm run verify` → exit 0.

## Test plan

`GroundTrack.test.ts` (≥ 6 cases). The SVG is checked by the reviewer in the
browser: a sine-like track crosses the marker, solid ahead, dotted behind,
clipped at the disc edge.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -n "sampleGroundTrack" src/ui/clusters/GroundTrackGlobe.tsx` matches
- [ ] `git diff --stat aa206a1..HEAD` lists only in-scope files (ignore `plans/` and other plans' files)

## STOP conditions

- The max-latitude test is off by more than 1° (a frame/GMST bug — report).
- Rendering the track needs CSS changes or touches the geo lines.

## Maintenance notes

- Plan 015 consumes `GroundTrackPoint.ecef` for the 3D track; keep the field.
- If the globe ever grows, raise the sampling density with it (30 s ≈ 230 km
  of ground per segment at full size).
