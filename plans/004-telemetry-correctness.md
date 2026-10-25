# Plan 004: Telemetry recovers after an offline start, reports honest confidence, keeps accelerated time on rate, and never lets a stale or older TLE win

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e78d38d..HEAD -- src/core/telemetry src/core/orbital/TLEParser.ts src/core/clock/SimulationClock.ts src/core/api/CelesTrakClient.ts api/tle.ts tests/unit/telemetry tests/unit/clock tests/unit/api tests/unit/orbital/TLEParser.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (telemetry install ordering is subtle; tests guard it)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e78d38d`, 2026-10-24

## Why this matters

Six verified defects in the simulation-truth layer (`src/core/`, which has no
React and no three — keep it that way):

1. **Offline start never recovers eagerly.** `TelemetryManager._wasOffline`
   starts `false` and is never seeded, so a session that STARTS offline never
   sees the online→offline step; on reconnect neither `resetBackoff()` nor the
   eager refresh runs, and the next fetch waits out a backoff that grew to as
   much as 30 min while offline.
2. **Confidence 100 % before the epoch.** `tleConfidence(ageHours)` returns
   1.0 for any `ageHours < 24`, including negative ages (seeking up to a week
   into the past). SGP4 error grows in both directions; the HUD shows
   "TLE age -150.0h · confidence 100%".
3. **Accelerated time runs slow.** `SimulationClock.tick` clamps the wall
   delta to 100 ms, but the runtime schedules the next step 100 ms AFTER the
   previous step finishes, so real deltas are always ≥ 100 ms and every
   millisecond of jitter is dropped (a few % slow at 10×–300×; ≤ 10 % of the
   chosen rate in a 1 s-throttled background tab).
4. **A stale proxy answer is treated as full success.** After an upstream
   failure the proxy serves its warm memo with `X-TLE-Stale: 1` and HTTP 200;
   the client never reads the header and calls `recordSuccess()`, which sets
   the next fetch 4 h away even if upstream recovers minutes later.
5. **The cache bootstrap can overwrite a fresh live TLE.** The runtime's
   first step can start the live fetch while `_bootstrap` is still awaiting
   `tleCache.get`; if IndexedDB is slower than the edge-cached `/api/tle`, the
   older cached TLE is installed over the live one (and the next refresh is
   4 h away).
6. **The TLE-swap blend compares states at different times.** The blend
   origin is the previous tick's state, and the offset is computed on a later
   tick against the new TLE's state — so the offset contains orbital motion
   (≥ 30 sim-s ≈ 230 km at 300×). Also, `loadTLE(new)` happens before
   `await tleCache.set(...)` but `onTLEUpdate` happens after it, so ticks
   during the IndexedDB write render the new TLE unblended (a snap).
7. (defence in depth) `api/tle.ts` reads upstream bodies with
   `response.text()` and no size cap; a TLE is ~170 bytes.

## Current state

Files:
- `src/core/telemetry/TelemetryManager.ts` — owns fetch cadence, install,
  mode. Excerpts:
  - line 50: `private _wasOffline = false`
  - `start()` lines 57-104 subscribe to `NETWORK_STATUS`:
    ```ts
    if (networkMonitor.isOnline && this._wasOffline) {
      this._wasOffline = false
      if (!this._isFetching) {
        this._rateLimiter.resetBackoff()
        this._refreshTLEAsync() // fire-and-forget
      }
    } else if (!networkMonitor.isOnline) {
      this._wasOffline = true
    }
    ```
  - `_bootstrap` (~line 176):
    ```ts
    const cached = await tleCache.get(this._entity.config.noradId)
    if (!this.isActive(generation)) return

    if (cached) {
      const installed = await this._installCandidate(cached, generation, false)
      if (!this.isActive(generation)) return
      if (!installed) await tleCache.remove(this._entity.config.noradId)
    }
    ```
  - `_performRefresh` (~line 213):
    ```ts
    const tle = await fetchTLEFromCelesTrak(this._entity.config.noradId)
    if (!this.isActive(generation)) return

    if (tle && await this._installCandidate(tle, generation, true)) {
      if (!this.isActive(generation)) return
      this._rateLimiter.recordSuccess()
      networkMonitor.recordSuccess()
      this._recalculateMode()
    } else { ... }
    ```
  - `_installCandidate` (~line 240): captures `previousState = this._lastState`,
    calls `this._entity.loadTLE(tle)`, propagates at `simulationClock.now()`,
    `await tleCache.set(...)` when `persist`, then
    `this._interpolation.onTLEUpdate(previousState)`.
- `src/core/telemetry/InterpolationService.ts` — `onTLEUpdate(currentState)`
  stores `_blendOrigin`; `smooth(newState, deltaMs)` computes `_offset` lazily
  on its first call as `origin − newState` (positions, velocities,
  lat/lon/alt/speed), then decays it over `BLEND_DURATION_MS = 2000`.
- `src/core/orbital/TLEParser.ts:151-156`:
  ```ts
  export function tleConfidence(ageHours: number): number {
    if (ageHours < 24) return 1.0
    if (ageHours < 72) return 0.9
    if (ageHours < 168) return 0.7  // 7 days
    return 0.4
  }
  ```
- `src/core/clock/SimulationClock.ts:48`:
  `const clampedDelta = Math.min(wallDeltaMs, 100) // guard against tab-suspension spikes`
  (ACCELERATED: `simDelta = clampedDelta * this._timeScale`). REALTIME syncs to
  `Date.now()` directly and is unaffected.
- `src/core/runtime/SimulationRuntime.ts` — `DEFAULT_CADENCE_MS = 100`,
  recursive `setTimeout` after each step; `step()` passes the measured wall
  delta.
- `src/core/api/CelesTrakClient.ts` — `fetchTLEFromCelesTrak(noradId)`:
  proxy `/api/tle` → `validateTLEData(clampFutureFetchTime(json))` → returns
  `validated.tle` or falls back to `fetchBrowserFallback` (wheretheiss.at).
  Never reads response headers.
- `src/core/api/ApiRateLimiter.ts` — `recordSuccess()` resets to the 4 h
  normal interval; `recordFailure()` starts/continues the exponential ramp
  (5 s base for telemetry … 30 min cap); `resetBackoff()` makes the next check
  eligible.
- `api/tle.ts` — `tryFetchWithSignal` (~line 118) ends with
  `if (!response.ok) return null` / `return await response.text()`. Its
  `STALE_HEADERS` include `'X-TLE-Stale': '1'`.
- Tests to extend (patterns to copy):
  - `tests/unit/telemetry/TelemetryManagerLifecycle.test.ts` — mocks
    `@/core/api/CelesTrakClient` (`fetchTLEFromCelesTrak: mocks.fetchTLE`),
    `TLECache`, `NetworkMonitor` (`isOnline: true`), `TelemetryEventBus`
    (`on: mocks.busOn` — capture the handler from `mocks.busOn.mock.calls`).
  - `tests/unit/telemetry/InterpolationService.test.ts` — `state(overrides)` helper.
  - `tests/unit/clock/SimulationClock.test.ts` — has
    `'clamps delayed ACCELERATED updates before applying time scale'`
    expecting a 5-min delay clamped to 100 ms (`epochMs 2_000`, `deltaMs 100`).
  - `tests/unit/api/CelesTrakClient.test.ts`, `tests/unit/api/TLEHandler.test.ts`.

Conventions: no semicolons in these files; comments explain WHY with the
bug context (see the existing "Bug A fix" / "N-1 FIX" comments); keep the
"no React, no three in src/core" rule.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| Focused tests | `npx vitest --run tests/unit/telemetry tests/unit/clock tests/unit/api tests/unit/orbital` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0, 0 warnings |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `src/core/telemetry/TelemetryManager.ts`
- `src/core/telemetry/InterpolationService.ts`
- `src/core/orbital/TLEParser.ts` (only `tleConfidence`)
- `src/core/clock/SimulationClock.ts` (only the clamp)
- `src/core/api/CelesTrakClient.ts`
- `api/tle.ts` (only the body cap in `tryFetchWithSignal`)
- the matching tests under `tests/unit/telemetry/`, `tests/unit/clock/`,
  `tests/unit/api/`, `tests/unit/orbital/TLEParser.test.ts`

**Out of scope** (do NOT touch):
- `_recalculateMode`'s use of `fetchedAt` for LIVE/HYBRID. It was considered
  and REJECTED: CelesTrak element sets are routinely 12–36 h old at download,
  so epoch-based gating would show "Cached" right after a successful fetch.
  The README wording is fixed in the docs pass instead.
- `NetworkMonitor.ts`, `ApiRateLimiter.ts` (their behaviour is correct).
- `src/core/geo/**` (plan 005), anything under `src/rendering/` or `src/ui/`.
- `docs/**`, `plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch. One commit per numbered step below is
  ideal (Steps 1–6), or one commit for 1–3 and one for 4–7.
- Subject style (from `git log`): imperative sentence case, no prefix, e.g.
  `Seed the offline flag so an offline start recovers on reconnect`.
- End every commit body with these two lines verbatim:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u
  ```
- Stage by explicit path, never `git add -A`. Do NOT push.

## Steps

### Step 1: Seed `_wasOffline` from the live network state

In `TelemetryManager.start()`, after `networkMonitor.start()` and before the
`telemetryBus.on('NETWORK_STATUS', …)` subscription, add
`this._wasOffline = !networkMonitor.isOnline` with a one-line comment
(a session that starts offline never emits the online→offline step).

Test (in `TelemetryManagerLifecycle.test.ts`, new `it`): make the mocked
`networkMonitor.isOnline` start `false` (the mock object is a plain object —
mutate `isOnline` and restore it in a `finally`/`afterEach`), `start()` the
manager, flip `isOnline = true`, invoke the captured `NETWORK_STATUS` handler
(`mocks.busOn.mock.calls.find(c => c[0] === 'NETWORK_STATUS')[1]()`), and
assert `mocks.fetchTLE` was called (the eager refresh). Before the fix this
fails.

**Verify**: `npx vitest --run tests/unit/telemetry/TelemetryManagerLifecycle.test.ts` → all pass, including the new case.

### Step 2: Confidence uses the magnitude of the age

`tleConfidence`: evaluate the thresholds on `Math.abs(ageHours)` (and treat a
non-finite age as `0.4`). Keep `getTLEAgeHours` and the signed
`tleAgeHours` field unchanged (the HUD shows the sign).

Tests in `tests/unit/orbital/TLEParser.test.ts` (new `describe('tleConfidence')`):
`0 → 1`, `23.9 → 1`, `-23.9 → 1`, `-30 → 0.9`, `-100 → 0.7`, `-200 → 0.4`,
`NaN → 0.4`, `200 → 0.4`.

**Verify**: `npx vitest --run tests/unit/orbital/TLEParser.test.ts` → all pass.

### Step 3: Clamp only genuine suspension spikes

In `SimulationClock.ts`, replace the literal with a named module constant
`const MAX_TICK_DELTA_MS = 1000` and a comment: the runtime ticks every
≥100 ms, so a 100 ms clamp dropped every millisecond of scheduling jitter in
ACCELERATED mode; 1 s still absorbs tab-suspension spikes. Use it in `tick`.

Update the existing test `'clamps delayed ACCELERATED updates before applying
time scale'` to the new bound (5-min delay at 10× → `epochMs 1_000 + 10_000`,
`deltaMs 1000`, `simDeltaMs 10_000`). Add a test: at 300×, ten ticks of
`105` ms advance exactly `10 × 105 × 300` ms.

**Verify**: `npx vitest --run tests/unit/clock` → all pass.

### Step 4: Surface the proxy's stale flag and back off instead of resting 4 h

In `CelesTrakClient.ts`:
- Export `interface TLEFetchResult { tle: TLEData; stale: boolean }`.
- Export `async function fetchTLEWithStatus(noradId = ISS_NORAD_ID): Promise<TLEFetchResult | null>`
  containing the current body of `fetchTLEFromCelesTrak`; on the proxy
  success path set `stale: response.headers.get('X-TLE-Stale') === '1'`; the
  browser-fallback path returns `stale: false`.
- Keep `fetchTLEFromCelesTrak` as a thin wrapper:
  `return (await fetchTLEWithStatus(noradId))?.tle ?? null` (other callers and
  tests keep working).

In `TelemetryManager._performRefresh`, call `fetchTLEWithStatus` instead.
On a successful install: if `result.stale`, call
`this._rateLimiter.recordFailure()` (keeps the short retry ramp; comment why)
but still `networkMonitor.recordSuccess()` and `_recalculateMode()`;
otherwise `recordSuccess()` as today.

Update the lifecycle test's module mock to provide both names, e.g.
```ts
vi.mock('@/core/api/CelesTrakClient', () => ({
  fetchTLEFromCelesTrak: mocks.fetchTLE,
  fetchTLEWithStatus: async (...args: unknown[]) => {
    const tle = await mocks.fetchTLE(...args)
    return tle ? { tle, stale: mocks.stale } : null
  },
}))
```
(add `stale: false` to `mocks`, reset it in `beforeEach`). New test: with
`mocks.stale = true`, after `start()` the TLE is installed
(`TLE_REFRESHED` emitted) and the manager requests again soon — assert via
`vi.useFakeTimers()` + `manager.update(simTime)` after advancing 6 s that
`mocks.fetchTLE` was called a second time (with `stale = false` it must NOT be
called again within 6 s). Build `simTime` with
`buildSimulationTime(Date.now(), 100, 100)` from `@/core/clock/SimulationTime`.
Add a `CelesTrakClient.test.ts` case: a proxy response with header
`X-TLE-Stale: 1` yields `stale: true` from `fetchTLEWithStatus`.

**Verify**: `npx vitest --run tests/unit/telemetry tests/unit/api` → all pass.

### Step 5: The cache bootstrap never replaces a network TLE

In `_bootstrap`, after the `tleCache.get` await and the generation check, if
`this._entity.currentTLE` exists and its `source !== 'fallback'`, skip
installing `cached` (comment: a live fetch started by the runtime's first step
already won the race; the cache is older by construction). Do not remove the
cache entry in that case.

Test: entity starts with a `celestrak` TLE installed (simulating the live
install that already happened) and `cacheGet` resolves an older cached TLE →
after `start()`, `entity.loadTLE` was never called with the cached TLE.

**Verify**: `npx vitest --run tests/unit/telemetry/TelemetryManagerLifecycle.test.ts` → all pass (all pre-existing cases too).

### Step 6: Blend from the old element set at the same instant, before any await

`InterpolationService`:
- Change `onTLEUpdate(previous: OrbitalState | null, next?: OrbitalState | null)`.
  When both are given, compute `_offset` immediately from `previous − next`
  (same math as the current lazy block, including the shortest-path longitude)
  and set `_blendFactor = 0`. When only `previous` is given, keep today's lazy
  behaviour (backward compatible for existing tests).
- Add `cancel(): void` that clears origin/offset and sets `_blendFactor = 1`.

`TelemetryManager._installCandidate`:
- BEFORE `this._entity.loadTLE(tle)`, take
  `const simNow = simulationClock.now()` and
  `const previousAtNow = previousTLE ? this._entity.propagate(simNow) : null`
  (old element set at the same instant as the new one).
- After the new `propagated` is validated (and BEFORE `await tleCache.set`),
  call `this._interpolation.onTLEUpdate(previousAtNow ?? previousState, propagated)`
  — use `propagated` from `this._entity.propagate(simNow)` (same `simNow`).
- In `rollback()`, also call `this._interpolation.cancel()`.
- Remove the later `onTLEUpdate(previousState)` call.

Tests (`InterpolationService.test.ts`): with `onTLEUpdate(old, next)` where
`old` and `next` differ only in `positionECI.x` by 10 km, the first
`smooth(nextAtLaterTime, 0)` returns `nextAtLaterTime.positionECI.x + 10`
(offset frozen from the same-instant pair, not re-derived against a later
state); `cancel()` makes `smooth` pass states through untouched.

**Verify**: `npx vitest --run tests/unit/telemetry` → all pass.

### Step 7: Cap upstream bodies in the proxy

In `api/tle.ts` `tryFetchWithSignal`, before reading: if
`Number(response.headers.get('content-length')) > MAX_UPSTREAM_BYTES`
return `null`; after `const text = await response.text()`, return `null` if
`text.length > MAX_UPSTREAM_BYTES`. Define `const MAX_UPSTREAM_BYTES = 16_384`
near the other constants with a comment (a TLE pair is ~170 bytes; this only
bounds a misbehaving mirror). Add a `TLEHandler.test.ts` case where one
upstream returns an oversized body and another returns a valid TLE → 200 with
the valid TLE.

**Verify**: `npx vitest --run tests/unit/api` → all pass.

## Test plan

New cases (all listed in the steps): offline-start recovery; confidence
magnitude table; 300× rate accuracy + updated clamp test; stale flag → short
retry + client header parsing; bootstrap-does-not-overwrite; same-instant
blend + cancel; oversized upstream body. Model them on the existing tests in
the same files.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -n "_wasOffline = !networkMonitor.isOnline" src/core/telemetry/TelemetryManager.ts` matches
- [ ] `grep -n "Math.min(wallDeltaMs, 100)" src/core/clock/SimulationClock.ts` returns nothing
- [ ] `grep -n "X-TLE-Stale" src/core/api/CelesTrakClient.ts` matches
- [ ] at least 8 new `it(` cases across the touched test files
- [ ] `git diff --stat e78d38d..HEAD` lists only in-scope files

## STOP conditions

- Any excerpt in "Current state" does not match the live code.
- An existing test (other than the clamp test named in Step 3) needs its
  assertion changed to pass — report which and why.
- Step 6 requires changing `OrbitalEntity`'s interface or ISSGroup/rendering code.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If the runtime cadence changes, revisit `MAX_TICK_DELTA_MS` (it must stay
  well above the cadence).
- Two TLE swaps within 2 s restart the blend from the old element set's raw
  state, not the mid-blend displayed state; acceptable (swaps are ≥ 4 h apart
  in practice) — do not add complexity for it.
- Reviewers: check `_installCandidate` still rolls back on every failure path
  and that `onTLEUpdate` now runs before the `await`.
