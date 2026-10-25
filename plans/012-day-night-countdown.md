# Plan 012: The HUD tells you when the station next enters or leaves Earth's shadow

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat aa206a1..HEAD -- src/stores/telemetryStore.ts src/ui/clusters/GaugesCluster.tsx src/core/orbital/OrbitalEngine.ts src/core/orbital/CoordinateConversions.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. `src/core/orbital/SunVisibility.ts`
> MUST exist (plan 011); if it does not, STOP.

## Status

- **Priority**: P2 (roadmap B.1)
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plan 011 (`sunVisibility` / `isSunlit`), plan 004 (telemetry, DONE)
- **Category**: direction (feature)
- **Planned at**: commit `aa206a1`, 2026-10-25

## Why this matters

The station spends roughly a third of each 93-minute orbit in Earth's shadow,
and the moment it crosses the terminator is the most-asked "what's happening
now" question after "where is it". ORBITAL already propagates the orbit and
the Sun; it only needs to look ahead. A one-line instrument —
"Daylight · sunset in 12:41" / "Eclipse · sunrise in 08:03" — gives the HUD
its first predictive readout and is the building block for the visible-pass
predictor later (a pass is visible only while the station is sunlit).

## Current state

- `src/core/orbital/SunVisibility.ts` (from plan 011): `sunVisibility(positionKm: Vec3, sunDir: Vec3): number`
  (1 sun … 0 umbra, 0.5 on the shadow edge) and `isSunlit(...)` (`>= 0.5`).
  Positions and Sun must be in the SAME Earth-centred frame.
- `src/core/orbital/OrbitalEngine.ts`: `propagateAt(epochMs): Vec3 | null`
  returns the TEME position (km); `periodMinutes: number | null`.
- `src/core/orbital/CoordinateConversions.ts`: `sunDirectionTEME(julianDate): Vec3`
  (unit vector, TEME). Julian date from epoch ms:
  `epochMs / 86400000 + UNIX_EPOCH_JULIAN` (`UNIX_EPOCH_JULIAN` in
  `src/utils/constants.ts`, semicolon style).
- `src/core/entities/ISSEntity.ts` exports the singleton `issEntity` with
  `.engine` (the `OrbitalEngine`) and `.currentTLE` (`TLEData | null`).
- `src/stores/telemetryStore.ts` — zustand store + `initTelemetryStoreListeners()`
  whose `STATE_UPDATE` handler is throttled to 1 Hz:
  ```ts
  const unsubState = telemetryBus.on('STATE_UPDATE', (state: OrbitalState) => {
    const now = Date.now()
    if (now - _lastUiUpdate < 1000) return // throttle to 1 Hz for UI
    _lastUiUpdate = now
    useTelemetryStore.setState({
      tleAgeHours: state.tleAgeHours,
      ...
      inclination: state.inclination,
    })
  })
  ```
  `state.timestamp` is the simulation epoch (ms) of that state.
- `src/ui/clusters/GaugesCluster.tsx` (whole component):
  ```tsx
  export function GaugesCluster(): JSX.Element {
    const { altitude, speed } = useOrbitalState()
    return (
      <div className="hud-bottom-left hud-text">
        <HudGauge label="Speed" value={speed.toFixed(2)} unit="km/s" width={96} />
        <HudGauge label="Altitude" value={altitude.toFixed(1)} unit="km" width={96} />
      </div>
    )
  }
  ```
- HUD rules (docs/HANDOFF.md design system): sentence case; unknown values
  render "—" (honest-instrument rule); `hud-fine` is the small ephemeris text
  class (used e.g. in `GroundTrackGlobe.tsx` with `style={{ color: 'var(--hud-lo)' }}`);
  stores update at ~1 Hz, never per frame.
- `src/core/` has no React and no three; keep the forecaster pure.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| Focused tests | `npx vitest --run tests/unit/orbital/EclipseForecast.test.ts tests/unit/stores` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `src/core/orbital/EclipseForecast.ts` (create)
- `src/stores/telemetryStore.ts`
- `src/ui/clusters/GaugesCluster.tsx`
- `src/utils/formatters.ts` (add one formatter)
- `tests/unit/orbital/EclipseForecast.test.ts` (create)
- `tests/unit/utils/formatters.test.ts` (extend)

**Out of scope**: `SunVisibility.ts` (consume only), rendering code, orbit-line
tinting (a possible later cut), `src/index.css` beyond nothing — reuse
existing classes; `docs/**`, `plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch; one commit per step; never commit red.
- Subject style: `Forecast the next shadow transition in core/orbital`.
- End every commit body with the `Co-Authored-By:` line YOUR harness
  specifies (naming the model that did the work), then
  `Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u`.
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: Pure forecaster

`src/core/orbital/EclipseForecast.ts`:
```ts
import type { Vec3 } from '@/utils/math'

/** Position + Sun direction (same frame) at an epoch, or null if propagation failed. */
export type GeometryAt = (epochMs: number) => { position: Vec3; sunDir: Vec3 } | null

export interface ShadowForecast {
  /** Sunlit at `fromMs` (sun visibility >= 0.5). */
  sunlit: boolean
  /** Next epoch (ms) where sunlit flips, ±toleranceMs; null if none within the horizon. */
  transitionMs: number | null
}

/**
 * Steps forward at `stepMs` from `fromMs` until the sunlit state flips or
 * `horizonMs` elapses, then bisects the flip to `toleranceMs`. Uses the
 * penumbra midpoint (visibility 0.5), the same edge the TRRJ law uses.
 */
export function forecastShadowTransition(
  geometryAt: GeometryAt,
  fromMs: number,
  options?: { stepMs?: number; horizonMs?: number; toleranceMs?: number },
): ShadowForecast | null   // null when geometry at fromMs is unavailable
```
Defaults: `stepMs = 10_000`, `horizonMs = 2 * 93 * 60_000`,
`toleranceMs = 1_000`. Use `isSunlit` from `./SunVisibility`. If a step's
geometry is null, return `{ sunlit, transitionMs: null }`.

Also export a small stateful helper that owns invalidation:
```ts
export class ShadowForecaster {
  constructor(private readonly geometryAt: GeometryAt, private readonly options?: ...) {}
  /**
   * Returns the cached forecast, recomputing only when needed: no cache yet,
   * `key` changed (new element set), `simMs` moved backwards past the last
   * compute (a seek), `simMs` reached the cached transition, or
   * `simMs` advanced beyond half the horizon without a transition.
   */
  update(simMs: number, key: string): ShadowForecast | null
}
```

Tests `tests/unit/orbital/EclipseForecast.test.ts` with a SYNTHETIC circular
orbit (no satellite.js): radius 6771 km in the x–y plane, period 92.68 min,
Sun fixed along +x: `position(t) = r·(cos ωt, sin ωt, 0)`.
- At t = 0 (sunlit side) → `sunlit: true`, and `transitionMs` is within
  ±1.5 s of the analytic shadow entry `t_in = (π − ρE)/ω` where
  `ρE = asin(6371/6771)` (the 0.5 edge lies at angle `π − ρE` from +x).
- Starting inside the shadow (t = π/ω) → `sunlit: false`, `transitionMs` ≈
  analytic exit `(π + ρE)/ω` ± 1.5 s.
- Sun along +z (orbit plane ⟂ Sun, beta 90°) → `transitionMs: null`.
- Geometry returning null at `fromMs` → `null`.
- `ShadowForecaster`: counts calls to `geometryAt`; a second `update` 1 s later
  with the same key does not recompute (call count unchanged); a new key, a
  backwards `simMs`, and `simMs >= transitionMs` each trigger a recompute.

**Verify**: `npx vitest --run tests/unit/orbital/EclipseForecast.test.ts` → all pass.

### Step 2: Publish it through the telemetry store

In `src/stores/telemetryStore.ts`:
- Add store fields `sunlit: boolean | null` (initial `null`) and
  `shadowTransitionInMs: number | null` (initial `null`; milliseconds of
  simulation time until the next transition).
- Module-level forecaster built lazily on first use:
  ```ts
  const geometryAt: GeometryAt = (ms) => {
    const position = issEntity.engine.propagateAt(ms)
    if (!position) return null
    return { position, sunDir: sunDirectionTEME(ms / 86_400_000 + UNIX_EPOCH_JULIAN) }
  }
  ```
  (both TEME — frame-consistent). Import `issEntity` from
  `@/core/entities/ISSEntity`.
- Inside the existing 1 Hz `STATE_UPDATE` branch, after the throttle check:
  `const tle = issEntity.currentTLE`, `key = tle ? tle.line1 + tle.line2 : ''`,
  `const forecast = key ? forecaster.update(state.timestamp, key) : null`, and
  add `sunlit: forecast?.sunlit ?? null` and
  `shadowTransitionInMs: forecast?.transitionMs != null ? Math.max(0, forecast.transitionMs - state.timestamp) : null`
  to the same `setState` call.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Formatter + HUD line

- `src/utils/formatters.ts`: `export function formatCountdown(ms: number): string`
  → `"mm:ss"` for < 1 h (minutes zero-padded to 2), `"h:mm:ss"` at ≥ 1 h;
  negative or non-finite → `"—"`. Tests in `tests/unit/utils/formatters.test.ts`:
  `0 → "00:00"`, `761_000 → "12:41"`, `3_725_000 → "1:02:05"`, `-1 → "—"`, `NaN → "—"`.
- `GaugesCluster.tsx`: read `sunlit` and `shadowTransitionInMs` with a
  `useShallow` selector (same idiom as `useOrbitalState`). Under the two
  gauges add:
  ```tsx
  <span className="hud-fine" style={{ color: 'var(--hud-lo)', whiteSpace: 'nowrap' }}>
    {eclipseText}
  </span>
  ```
  where `eclipseText` is:
  - `sunlit === null` → `"—"`
  - sunlit, countdown known → `"Daylight · sunset in " + formatCountdown(ms)`
  - shadow, countdown known → `"Eclipse · sunrise in " + formatCountdown(ms)`
  - sunlit, no transition in horizon → `"Daylight · no eclipse this orbit"`
  - shadow, none → `"Eclipse"`
  If the cluster's flex layout puts the line beside the gauges instead of
  below them, wrap the two gauges in a row `div` and stack it with the new
  line in a column (`display: 'flex', flexDirection: 'column', gap: 6`) —
  inline style is acceptable here; do not edit `src/index.css`.

**Verify**: `npm run typecheck` → exit 0; `npx vitest --run tests/unit/utils` → all pass.

### Step 4: Gate

**Verify**: `npm run verify` → exit 0.

## Test plan

`EclipseForecast.test.ts` (≥ 6 cases on the synthetic orbit + forecaster
invalidation); `formatCountdown` cases. Reviewer browser check: the line
reads "Daylight · sunset in mm:ss" and counts down; at 300× it hits 00:00
as the station crosses the terminator, then flips to "Eclipse · sunrise in …".

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -n "forecastShadowTransition\|ShadowForecaster" src/core/orbital/EclipseForecast.ts` matches
- [ ] `grep -n "shadowTransitionInMs" src/stores/telemetryStore.ts src/ui/clusters/GaugesCluster.tsx` matches in both
- [ ] `git diff --stat aa206a1..HEAD` (ignoring `plans/` and plan 011's files) lists only in-scope files

## STOP conditions

- `SunVisibility.ts` is missing or its exports differ from Current state.
- The synthetic-orbit transition differs from the analytic one by > 1.5 s
  (a frame or edge mismatch — report the numbers).
- Fitting the HUD line requires CSS changes beyond inline layout on the cluster.

## Maintenance notes

- Under accelerated time the countdown is in simulation time (it drains 300×
  faster at 300×) — intended; it describes the simulated station.
- Seeks trigger one recompute (≤ ~1,100 SGP4 calls at the defaults); cheap
  at 1 Hz, never per frame.
- The visible-pass predictor (roadmap B.3) should reuse `isSunlit` and this
  forecaster's stepping/bisection pattern.
