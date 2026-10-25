# Plan 009: The SGP4 wrapper, GMST, time formatters, rate limiter and orbit-tape phase math are pinned by known-answer tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e78d38d..HEAD -- src/core/orbital/OrbitalEngine.ts src/core/clock/SimulationTime.ts src/utils/formatters.ts src/utils/orbitalTime.ts src/ui/common/telemetryModeVisual.ts src/core/api/ApiRateLimiter.ts src/ui/clusters/OrbitTape.tsx`
> If any in-scope SOURCE file changed since this plan was written, compare
> the "Current state" excerpts against the live code; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (tests; one pure extraction)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `e78d38d`, 2026-10-24

## Why this matters

The feature the app exists for — TLE → SGP4 → position — has no direct test:
`OrbitalEngine` is only ever mocked or stubbed (`OrbitPredictor.test.ts`
replaces it, `TelemetryManagerLifecycle.test.ts` mocks `propagate`). GMST is
a hand-coded IAU-1982 polynomial that drives the hard invariant "the Earth
group rotates by GMST"; a coefficient slip would rotate Earth and ground track
together and still look plausible. `periodMsOf` and `formatPeriod` carry
comments about past bugs (a minutes/seconds mix-up made every scrub 6.45× too
large; a `92m 60s` carry) with no regression test. `ApiRateLimiter` backoff
governs request pressure on CelesTrak and the geo APIs and is untested.
`OrbitTape`'s argument-of-latitude quadrant logic runs inline in render and
cannot be tested in the node env. CLAUDE.md: "new behavior gets a regression
test. Pure math lives in `src/core/` so it stays testable."

## Current state

- `src/core/orbital/OrbitalEngine.ts` — `new OrbitalEngine(entityId)`,
  `loadTLE(tle): boolean` (false on `satrec.error !== 0`), `clearTLE()`,
  `hasTLE()`, `currentTLE`, `periodMinutes` (`2π / satrec.no`, null without
  TLE), `propagate(simTime): OrbitalState | null`, `propagateAt(epochMs)`.
  `propagate` returns `positionECI`/`velocityECI` (TEME, km, km/s),
  geodetic lat/lon/alt via `temeToGeodetic(posTEME, simTime.gmst)`, `speed`,
  `orbitalPeriod`, `inclination` (deg, from `satrec.inclo`), `source`
  (`fallback → 'propagated'`, `celestrak → 'live'`, else `'cached'`),
  `tleAgeHours`, `confidence`.
- `src/core/clock/SimulationTime.ts`:
  `computeGMST(julianDate)` (IAU 1982, radians in [0, 2π)) and
  `buildSimulationTime(epochMs, deltaMs, simDeltaMs)` →
  `{ epochMs, julianDate: epochMs/86400000 + 2440587.5, gmst, deltaMs, simDeltaMs }`.
- `src/utils/formatters.ts`: `formatPeriod(min)` → `"92m 41s"` with the 60 s
  carry; `formatUtcClockParts(epochMs)` → `{ time: "HH:MM:SS", date: "YYYY.DDD" }`
  (day-of-year from `Date.UTC(year, 0, 0)`); `formatLatitude`, `formatLongitude`.
- `src/utils/orbitalTime.ts`: `periodMsOf(min)` →
  `Math.max(10, min || 92.68) * 60_000`.
- `src/ui/common/telemetryModeVisual.ts`: LIVE→Live, HYBRID→Cached,
  RECOVERY→Recovery, OFFLINE→Fallback (+ dot class + colour var).
- `src/core/api/ApiRateLimiter.ts`: `shouldRequest(now)`, `recordRequest(now)`,
  `recordSuccess(now)` (→ normal interval), `recordFailure(now)` (first →
  `baseDelayMs`; then `×multiplier + jitter`, `jitter = base × random × 0.5`,
  capped at `maxDelayMs`), `resetBackoff()`; all time-taking methods accept an
  injectable `nowMs`.
- `src/ui/clusters/OrbitTape.tsx` (~line 99-129), inline during render:
  ```ts
  const sinInc = Math.sin((inclination * Math.PI) / 180)
  if (Math.abs(sinInc) > 1e-6) {
    const sinLat = Math.sin((latitude * Math.PI) / 180)
    const clamped = Math.max(-1, Math.min(1, sinLat / sinInc))
    const ascending = (Math.asin(clamped) * 180) / Math.PI // [-90, 90]

    const prevLatitude = prevLatitudeRef.current
    let u: number
    if (prevLatitude === null) {
      u = latitude >= 0 ? ascending : 180 - ascending
    } else if (latitude >= prevLatitude) {
      u = ascending >= 0 ? ascending : 360 + ascending
    } else {
      u = 180 - ascending
    }
    prevLatitudeRef.current = latitude

    const target = u / 360
    if (targetRef.current === null) {
      targetRef.current = target
    } else {
      let delta = target - targetRef.current
      delta = ((delta + 1.5) % 1) - 0.5
      targetRef.current = (targetRef.current + delta + 1) % 1
    }
  }
  ```
- Test conventions: `tests/unit/**` in node env, `import { describe, expect, it } from 'vitest'`,
  `@/` alias. Pattern files: `tests/unit/orbital/CoordinateConversions.test.ts`
  (known-answer + `it.each`), `tests/unit/clock/SimulationClock.test.ts`.
  The packaged TLE: `import fallback from '@/data/fallback-tle.json'`.
  `satellite.js` is a dependency (`import * as satellite from 'satellite.js'`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| New tests | `npx vitest --run tests/unit/orbital tests/unit/clock tests/unit/utils tests/unit/api tests/unit/ui` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `tests/unit/orbital/OrbitalEngine.test.ts` (create)
- `tests/unit/clock/SimulationTime.test.ts` (create)
- `tests/unit/utils/formatters.test.ts` (create)
- `tests/unit/api/ApiRateLimiter.test.ts` (create)
- `tests/unit/ui/orbitTapeMath.test.ts` (create)
- `src/ui/clusters/orbitTapeMath.ts` (create)
- `src/ui/clusters/OrbitTape.tsx` (replace the inline math with calls; no behaviour change)

**Out of scope**: any other source change. In particular do NOT change
`tleConfidence` or `SimulationClock` (plan 004 changes them — do not assert
on confidence for NEGATIVE ages, and do not assert the clock clamp), and do
not touch OrbitTape's ARIA, scrub or frame loop. `docs/**`, `plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch; one commit per test file is fine, plus one
  for the OrbitTape extraction.
- Subject style: `Pin GMST and SimulationTime with known-answer vectors`.
- End every commit body with these two lines verbatim:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u
  ```
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: GMST and SimulationTime

`tests/unit/clock/SimulationTime.test.ts`:
- `buildSimulationTime(0, 0, 0).julianDate === 2440587.5`.
- `computeGMST(jd)` agrees with `satellite.gstime(jd)` to `1e-6` rad at
  J2000 (`2451545.0`), at `Date.UTC(2026, 9, 24, 0, 0, 0)` and
  `Date.UTC(2026, 9, 24, 12, 34, 56)` (convert epoch ms → JD with the same
  formula), and at a 1990 date. (satellite.js uses the same IAU-1982 model;
  if any case differs by more than `1e-6`, STOP — do not loosen the tolerance
  beyond `1e-5` without reporting.)
- Result is always in `[0, 2π)`.

**Verify**: `npx vitest --run tests/unit/clock/SimulationTime.test.ts` → all pass.

### Step 2: OrbitalEngine known answers

`tests/unit/orbital/OrbitalEngine.test.ts`, using the packaged fallback TLE
(`{ line1, line2, fetchedAt: Date.parse(fallback.epoch), source: 'fallback' }`):
- `loadTLE` returns true; `hasTLE()` true; `currentTLE` is the object.
- `propagate(buildSimulationTime(t, 100, 100))` at `t = Date.parse(fallback.epoch)`
  equals `satellite.propagate(satellite.twoline2satrec(l1, l2), new Date(t))`
  position/velocity to `1e-9`; `speed` equals the velocity magnitude;
  `altitude` in `[380, 450]` km; `|latitude| <= inclination + 0.1`;
  `inclination` ≈ 51.6 (±0.2); `orbitalPeriod` equals `periodMinutes` and lies
  in `[91, 94]`; `tleAgeHours` ≈ 0 at the epoch and ≈ 24 one day later.
- `source` mapping: fallback → `'propagated'`, celestrak → `'live'`,
  cache → `'cached'` (build the same TLE with each `source`).
- A corrupted line 2 (change one digit of the mean motion field so the
  checksum is wrong is NOT enough — satellite.js ignores checksums; instead
  pass `line2 = line2.slice(0, 52) + 'XXXXXXXXXXX' + line2.slice(63)`) →
  `loadTLE` returns false OR `propagate` returns null; assert whichever
  happens is handled (no throw).
- `clearTLE()` → `propagate(...)` null, `propagateAt(t)` null, `periodMinutes` null.
- `propagateAt(t)` equals `propagate(...).positionECI` at the same `t`.

**Verify**: `npx vitest --run tests/unit/orbital/OrbitalEngine.test.ts` → all pass.

### Step 3: Formatters, period, mode vocabulary

`tests/unit/utils/formatters.test.ts`:
- `formatPeriod(92.68)` → `"92m 41s"`; `formatPeriod(92.9999)` → `"93m 00s"`;
  `formatPeriod(90)` → `"90m 00s"`.
- `formatUtcClockParts(Date.UTC(2026, 0, 1, 0, 0, 0))` → `{ time: '00:00:00', date: '2026.001' }`;
  `Date.UTC(2026, 11, 31, 23, 59, 59)` → `date: '2026.365'`;
  leap year `Date.UTC(2028, 11, 31, 12)` → `'2028.366'`;
  `Date.UTC(2028, 1, 29)` → `'2028.060'`.
- `formatLatitude(-23.45, 2)` → `'23.45° S'`; `formatLongitude(-0.1278)` → `'0.1278° W'`.
- `periodMsOf(92.68)` → `92.68 * 60000`; `periodMsOf(0)`, `periodMsOf(null)`,
  `periodMsOf(undefined)`, `periodMsOf(NaN)` → `92.68 * 60000`;
  `periodMsOf(5)` → `10 * 60000` (floor).
- `telemetryModeVisual` for all four modes: labels `Live`, `Cached`,
  `Recovery`, `Fallback`, each with a non-empty `dotClass` and a
  `var(--signal-…)` colour.

**Verify**: `npx vitest --run tests/unit/utils` → all pass.

### Step 4: ApiRateLimiter

`tests/unit/api/ApiRateLimiter.test.ts` (inject `nowMs`; stub
`Math.random` with `vi.spyOn(Math, 'random').mockReturnValue(0)` and restore
in `afterEach`):
- fresh limiter (`normalIntervalMs: 4h`) → `shouldRequest(0)` false?
  NOTE: `_lastRequestMs` starts at 0 and `_currentDelay` at the normal
  interval, so `shouldRequest(now)` is true only when `now >= normalIntervalMs`.
  Assert exactly that (and that real `Date.now()` values are eligible).
- after `recordRequest(1000)` + `recordFailure(1000)` with `baseDelayMs: 5000`
  → eligible at `6000`, not at `5999`.
- second failure → delay `10000` (random stubbed to 0); with
  `Math.random` → `1`, delay `10000 + 2500`.
- many failures cap at `maxDelayMs`.
- `recordSuccess(t)` → next eligible at `t + normalIntervalMs`.
- `resetBackoff()` → `shouldRequest(anything ≥ 0)` true; the next failure
  restarts at `baseDelayMs`.

**Verify**: `npx vitest --run tests/unit/api/ApiRateLimiter.test.ts` → all pass.

### Step 5: Extract and test the orbit-tape phase math

Create `src/ui/clusters/orbitTapeMath.ts`:
```ts
/**
 * Argument of latitude (degrees, [0, 360)) from the sub-satellite latitude,
 * the inclination, and the previous latitude sample (trend → quadrant).
 * Null when the inclination is ~0 (u is undefined from latitude alone).
 */
export function argumentOfLatitudeDeg(latitudeDeg: number, prevLatitudeDeg: number | null, inclinationDeg: number): number | null

/** Moves `current` toward `target` (both phases in [0, 1)) the short way. */
export function wrapPhaseTowards(current: number, target: number): number
```
Bodies: move the existing expressions verbatim (including the comments).
In `OrbitTape.tsx`, replace the inline block with:
```ts
const u = argumentOfLatitudeDeg(latitude, prevLatitudeRef.current, inclination)
if (u !== null) {
  prevLatitudeRef.current = latitude
  const target = u / 360
  targetRef.current = targetRef.current === null ? target : wrapPhaseTowards(targetRef.current, target)
}
```
(Behaviour identical: `prevLatitudeRef` was only updated inside the
`sinInc` branch.)

`tests/unit/ui/orbitTapeMath.test.ts`:
- inclination 51.6: lat 0 northbound (prev −1) → 0; lat 51.6 prev 51 → 90;
  lat 0 southbound (prev 1) → 180; lat −51.6 prev −51 (southbound) → 270
  (it is `180 − (−90)`); lat −30 northbound (prev −31) → `360 + asin(sin(−30°)/sin(51.6°))` in degrees.
- first sample (prev null): lat 20 → ascending branch value; lat −20 → `180 − ascending`.
- inclination 0 → null.
- `wrapPhaseTowards(0.99, 0.01)` → `0.01` (via the wrap, not backwards);
  `wrapPhaseTowards(0.01, 0.99)` → `0.99`; `wrapPhaseTowards(0.2, 0.3)` → `0.3`.
  Compare with `toBeCloseTo(…, 12)`.

**Verify**: `npx vitest --run tests/unit/ui` → all pass; `npm run typecheck` → exit 0.

### Step 6: Gate

**Verify**: `npm run verify` → exit 0.

## Test plan

Five new test files listed above; at least 30 new `it`/`it.each` rows in total.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] the five new test files exist and pass
- [ ] `grep -n "Math.asin(clamped)" src/ui/clusters/OrbitTape.tsx` returns nothing (moved)
- [ ] `git diff --stat e78d38d..HEAD` lists only in-scope files

## STOP conditions

- `computeGMST` disagrees with `satellite.gstime` by more than `1e-5` rad —
  report the values; do not "fix" either.
- `OrbitalEngine` results disagree with raw `satellite.propagate` — report.
- The OrbitTape extraction changes any existing behaviour you can observe.

## Maintenance notes

- If `satellite.js` is upgraded (5 → 7), the OrbitalEngine known-answer
  test is the guard; satellite.js 6+ returns `null` from `propagate` on
  failure instead of `false`-ish fields.
