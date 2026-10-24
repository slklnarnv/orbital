# Plan 010: The production crash screen is user-facing, HUD strings follow sentence case, and dead constants are gone

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e78d38d..HEAD -- src/main.tsx src/ui/common/SettingsGear.tsx src/ui/clusters/MissionClockCluster.tsx src/ui/clusters/TimeControls.tsx src/ui/clusters/GroundTrackGlobe.tsx src/utils/constants.ts src/utils/math.ts src/core/clock/SimulationTime.ts src/core/orbital/CoordinateConversions.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (data minimisation) / tech-debt / docs-in-code
- **Planned at**: commit `e78d38d`, 2026-10-24

## Why this matters

1. The root `ErrorBoundary` in `src/main.tsx` renders `error.stack` in a
   `<pre>` in EVERY build ("Submit this traceback…"), so visitors see bundle
   paths and internals on a crash, and the screen looks like a dev tool. Dev
   builds should keep the stack; production should show a calm message and a
   reload button (the `console.error` stays in both).
2. CLAUDE.md: "User-facing text: sentence case, no ALL CAPS". Four HUD
   strings violate it: `RENDER SETTINGS`, `ISS · ZARYA`, `SET TIME · UTC`, and
   the weather label forced through `.toUpperCase()`.
3. `src/utils/constants.ts` exports values nothing imports, including
   `CAMERA_THRESHOLDS`, whose comments describe camera mode switches at
   distances the real state machine (`CameraStateMachine.ts`) does not use —
   an authoritative-looking file that contradicts the implementation.
   `JULIAN_DATE_J2000` is unused while its literal `2451545.0` is repeated.
   `lerpVec3` in `src/utils/math.ts` is unused.

## Current state

- `src/main.tsx` `ErrorBoundary.render()` (~line 34-66): a red diagnostic
  panel with `<h2>[Orbital] Critical Rendering Crash Detected</h2>`, a
  paragraph, `<pre>{this.state.error?.stack || this.state.error?.toString()}</pre>`
  and "Submit this traceback to diagnose the rendering baseline." The same
  file already gates other code on `import.meta.env.DEV` (DEV-only hooks
  further down — match that idiom).
- `src/ui/common/SettingsGear.tsx:108-110`:
  ```tsx
  <span className="hud-fine" style={{ color: 'var(--hud-lo)', letterSpacing: '0.18em' }}>
    RENDER SETTINGS
  </span>
  ```
- `src/ui/clusters/MissionClockCluster.tsx:40-42`:
  `<span className="hud-label" …>ISS · ZARYA</span>`
- `src/ui/clusters/TimeControls.tsx:204-206`:
  `<span className="hud-fine" style={{ color: 'var(--hud-lo)', letterSpacing: '0.18em' }}>SET TIME · UTC</span>`
- `src/ui/clusters/GroundTrackGlobe.tsx:118`:
  `if (weatherLabel !== null) wxSegments.push(weatherLabel.toUpperCase())`
  (labels are already sentence case: "Partly cloudy", "Clear", …).
- `src/index.css` has no `text-transform: uppercase` on these classes, so the
  literal text is what renders.
- `src/utils/constants.ts` — unused exports (grep-verified across
  `src api scripts tests`): `EARTH_SIDEREAL_DAY_S`, `EARTH_MU`,
  `ISS_NOMINAL_ALTITUDE_KM`, `WORLD_SCALE`, `SUN_DISTANCE_KM`,
  `CAMERA_THRESHOLDS`. Used and kept: `EARTH_RADIUS_KM`, `ISS_NORAD_ID`,
  `ISS_ORBITAL_PERIOD_MIN`, `ATMOSPHERE_RADIUS_FACTOR`, `CLOUD_RADIUS_FACTOR`,
  `SUN_BILLBOARD_DISTANCE_KM`, `JULIAN_DATE_J2000` (to be used), `UNIX_EPOCH_JULIAN`,
  `TLE_*`, `ORBIT_PATH_*` — re-verify each with grep before deleting.
  NOTE: this file uses semicolons; keep its style.
- `2451545.0` literal: `src/core/clock/SimulationTime.ts:14`
  (`const T = (julianDate - 2451545.0) / 36525.0;`) and
  `src/core/orbital/CoordinateConversions.ts:108`.
- `src/utils/math.ts:37` `lerpVec3` — unused.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| Unused check | `grep -rnw "<NAME>" src api scripts tests` | only the definition line |
| Typecheck | `npm run typecheck` | exit 0 |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**: the nine files in the drift check.

**Out of scope**: any other HUD copy, CSS, letter-spacing, layout; the
geo service (plan 005), `OrbitTape.tsx` (plan 009); `docs/**`,
`plans/PROGRESS.md`; acronyms (`ISS`, `UTC`, `TLE`, `GMST`, `JD`) stay
uppercase.

## Git workflow

- Work on your worktree's branch; one commit per numbered step.
- Subject style: `Show a user-facing crash screen in production builds`.
- End every commit body with these two lines verbatim:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u
  ```
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: Production crash screen

In `ErrorBoundary.render()`: when `import.meta.env.DEV`, keep today's panel
exactly. Otherwise render a plain full-screen panel (same background colour
family, sentence case, no stack): heading "Something went wrong",
one line "The visualizer hit an unexpected error. Reloading usually fixes it.",
and a `<button type="button" onClick={() => window.location.reload()}>Reload</button>`.
Keep `componentDidCatch`'s `console.error` unchanged (both builds).

**Verify**: `npm run build` → exit 0, then
`grep -c "Submit this traceback" dist/assets/*.js` → `0` in every file
(dead-code eliminated in production); `grep -l "Something went wrong" dist/assets/*.js` → one file.

### Step 2: Sentence-case HUD strings

`RENDER SETTINGS` → `Render settings`; `ISS · ZARYA` → `ISS · Zarya`;
`SET TIME · UTC` → `Set time · UTC`; `weatherLabel.toUpperCase()` →
`weatherLabel`. Leave styles (letter-spacing etc.) untouched.

**Verify**: `grep -rn "RENDER SETTINGS\|ZARYA\|SET TIME\|toUpperCase" src/ui` → no matches.

### Step 3: Remove dead constants and use the J2000 constant

- Delete the unused exports listed in "Current state" from
  `src/utils/constants.ts` after re-confirming each with
  `grep -rnw NAME src api scripts tests` (only the definition must match).
  Remove now-empty section headers.
- Delete `lerpVec3` from `src/utils/math.ts` after the same check.
- Replace the `2451545.0` literals in `SimulationTime.ts` and
  `CoordinateConversions.ts` with `JULIAN_DATE_J2000` imported from
  `@/utils/constants` (match each file's existing import style).

**Verify**: `npm run typecheck` → exit 0; `grep -rn "2451545" src` → only
`src/utils/constants.ts`.

### Step 4: Gate

**Verify**: `npm run verify` → exit 0.

## Test plan

No new unit tests (copy + deletion). The gate's typecheck proves nothing
imported the deleted symbols; Step 1's build grep proves the stack panel is
DEV-only.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -rn "CAMERA_THRESHOLDS\|lerpVec3" src` returns nothing
- [ ] `grep -rn "RENDER SETTINGS\|ZARYA\|SET TIME" src` returns nothing
- [ ] `git diff --stat e78d38d..HEAD` lists only in-scope files

## STOP conditions

- Any "unused" export turns out to be imported somewhere (keep it, report).
- `import.meta.env.DEV` is not already used in `src/main.tsx`.

## Maintenance notes

- If a crash-report endpoint is ever added, wire it in `componentDidCatch`,
  not in the rendered screen.
