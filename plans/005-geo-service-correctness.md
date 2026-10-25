# Plan 005: The ground-point HUD never shows stale weather as current, never freezes local time, and survives corrupt cached cells

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e78d38d..HEAD -- src/core/geo tests/unit/geo src/stores/geoStore.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug / security (input validation)
- **Planned at**: commit `e78d38d`, 2026-10-24

## Why this matters

`GeoLookupService` fills the HUD's "Passing over" line (place · local time ·
temperature · weather). Three verified defects:

1. **Stale weather shown as current, and re-stamped as fresh.** A cell entry
   has ONE `fetchedAt`. When weather is past its 15-min TTL but the place is
   within 30 days, `_lookupCell` returns the whole snapshot and `_tick`
   applies it, so weather up to 30 days old is displayed as current while the
   refetch is rate-limited or failing. Worse, `_fetchPlace` copies the old
   weather fields and stamps `fetchedAt: Date.now()`, making old weather look
   fresh, and persists that to IndexedDB.
2. **Local time freezes on a new cell.** A place-only entry has
   `utcOffsetSeconds: null`; `_applySnapshot` then keeps the PREVIOUS cell's
   `localTime` string, and the per-tick clock refresh skips null offsets, so
   the HUD shows the previous cell's time, frozen, as the new ground point's.
3. **Persisted cells are trusted blindly.** `get<GeoSnapshot>(…)` from
   IndexedDB is accepted after one `fetchedAt` age check — no type checks —
   and `describeWeatherCode` indexes a plain object (`WEATHER_LABELS[code]`),
   so a non-numeric code can return an inherited prototype member. A corrupt
   or old-schema `geo_cell_*` row can throw inside the HUD (which sits outside
   the canvas error boundaries) for up to 30 days. Live responses ARE
   validated (`placeFromBigDataCloud`, `weatherFromOpenMeteo`); persisted data
   is not. `src/core/api/TLECache.ts` shows the house pattern: validate on
   read, delete invalid keys.

## Current state

- `src/core/geo/GeoLookupService.ts`:
  - constants: `GEO_CELL_TTL_MS = 30 days`, `WX_CELL_TTL_MS = 15 min`,
    `IDB_KEY_PREFIX = 'geo_cell_'`.
  - `export interface GeoSnapshot { placeName: string | null; continent: string | null; timezone: string | null; tzAbbreviation: string | null; utcOffsetSeconds: number | null; temperatureC: number | null; weatherCode: number | null; fetchedAt: number }`
  - `export function describeWeatherCode(code: number): string { return WEATHER_LABELS[code] ?? '—' }`
  - `_tick()` first refreshes `localTime` from `useGeoStore.getState().snapshot`
    when its `utcOffsetSeconds` is non-null, then (gated) looks up the cell and
    `_applySnapshot(cached)`.
  - `_lookupCell(cellKey)`: memory hit `<= WX_CELL_TTL_MS` → return; memory
    `<= GEO_CELL_TTL_MS` → schedule weather refetch, return `mem`; else
    `get<GeoSnapshot>(IDB_KEY_PREFIX + cellKey)` and the same split.
  - `_applySnapshot(snapshot)` sets `placeName, continent, tzAbbr,
    temperatureC, weatherLabel, localTime` — with
    `localTime: snapshot.utcOffsetSeconds !== null ? formatLocalClock(Date.now(), …) : state.localTime`.
  - `_fetchPlace` builds the entry from `existing` weather fields and
    `fetchedAt: Date.now()`; `_fetchWeather` builds it from `existing` place
    fields and `fetchedAt: Date.now()`.
  - `_pruneExpiredCells()` deletes rows whose `fetchedAt` is missing or older
    than 30 days.
- `src/stores/geoStore.ts` — `GeoStoreState` (written only by the service).
- `src/ui/clusters/GroundTrackGlobe.tsx:115-119` renders
  `localTime`, `temperatureC`, `weatherLabel` only when non-null and shows
  "—" when all are null. No UI change is needed.
- Tests: `tests/unit/geo/GeoLookupService.test.ts` — pure-function suites plus
  `describe('GeoLookupService time-control gate')` using `vi.useFakeTimers()`,
  `vi.stubGlobal('fetch', fetchMock)` answering both endpoints (open-meteo vs
  bigdatacloud by URL), `useTelemetryStore.setState(TOKYO)`,
  `vi.advanceTimersByTimeAsync(…)`. IndexedDB does not exist in the node test
  env, so `idb-keyval` calls reject and are swallowed; to test persisted rows,
  `vi.mock('idb-keyval', …)` in a NEW test file.

Conventions: no semicolons; explain WHY in comments; every failure path
degrades silently and keeps the last good snapshot.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| Focused tests | `npx vitest --run tests/unit/geo` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `src/core/geo/GeoLookupService.ts`
- `tests/unit/geo/GeoLookupService.test.ts`
- `tests/unit/geo/GeoLookupPersistence.test.ts` (create)

**Out of scope**:
- Decoupling the service from the zustand stores (a known layering wart —
  deferred, larger change).
- Switching local time to simulation time (open product question, not a bug).
- `GroundTrackGlobe.tsx` and every other UI file (plan 010 touches it).
- `docs/**`, `plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch; one commit per step.
- Subject style: imperative sentence case, e.g.
  `Track place and weather freshness separately in the geo cache`.
- End every commit body with these two lines verbatim:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u
  ```
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: Separate place and weather freshness

- Extend `GeoSnapshot` with `placeFetchedAt: number | null` and
  `weatherFetchedAt: number | null`. Keep `fetchedAt` and define it as the
  most recent of the two (it still drives `_pruneExpiredCells` and the 30-day
  TTL, so older rows keep working).
- Add a helper `function ageOf(stamp: number | null | undefined, fallback: number): number`
  or equivalent so rows written before this change (no per-field stamps) fall
  back to `fetchedAt`.
- `_fetchPlace`: set `placeFetchedAt: Date.now()`, copy `existing`
  weather fields AND `existing.weatherFetchedAt` unchanged (never advance the
  weather stamp on a place fetch); `fetchedAt = max(both)`.
- `_fetchWeather`: symmetric — set `weatherFetchedAt: Date.now()`, keep the
  existing `placeFetchedAt`.
- `_lookupCell`: decide "weather stale" from the weather age (fallback
  `fetchedAt`), "entry usable" from the place age (fallback `fetchedAt`)
  `<= GEO_CELL_TTL_MS`. Keep the existing refetch scheduling.

**Verify**: `npm run typecheck` → exit 0; `npx vitest --run tests/unit/geo` → all pass.

### Step 2: Never display expired weather, never carry another cell's clock

In `_applySnapshot`:
- Introduce `const WX_DISPLAY_MAX_MS = 60 * 60 * 1000` (comment: weather older
  than an hour is not "current"; the refetch TTL stays 15 min).
- If the snapshot's weather age exceeds `WX_DISPLAY_MAX_MS`, publish
  `temperatureC: null` and `weatherLabel: null` (keep place, timezone and
  offset — those are place-stable facts).
- `localTime`: `snapshot.utcOffsetSeconds !== null ? formatLocalClock(…) : null`
  and `tzAbbr` as today. Never fall back to `state.localTime`.

Tests (extend `GeoLookupService.test.ts`, inside the existing fake-timer
`describe` or a sibling one with the same setup):
- place succeeds, weather fails (open-meteo → `{ ok: false, status: 503 }`)
  for a NEW cell after a previous cell had local time "21:00" → the store's
  `localTime` is `null`, not the previous value.
- weather succeeds once, then always fails; advance 61 min (keeping the same
  cell) → `temperatureC` and `weatherLabel` are `null`, `placeName` still set.
- a place fetch after an old weather fetch does not make the weather
  displayable again (advance 61 min, trigger a place refetch for the cell by
  making the first place call fail as in the existing retry test) →
  `weatherLabel` stays `null`.

**Verify**: `npx vitest --run tests/unit/geo` → all pass.

### Step 3: Validate persisted cells and harden the code lookup

- `describeWeatherCode(code: number)`: return the label only when
  `Number.isInteger(code) && Object.hasOwn(WEATHER_LABELS, code)`, else `'—'`.
- Add `export function isGeoSnapshot(value: unknown): value is GeoSnapshot`:
  object; `placeName`, `continent`, `timezone`, `tzAbbreviation` each
  `null` or a string of length ≤ 120; `utcOffsetSeconds` `null` or a finite
  number with `|x| ≤ 14 * 3600`; `temperatureC` `null` or finite in
  `[-100, 100]`; `weatherCode` `null` or an integer `0..99`; `fetchedAt` a
  finite number; `placeFetchedAt`/`weatherFetchedAt` absent, `null` or finite.
- In `_lookupCell`'s IndexedDB branch, accept `stored` only if
  `isGeoSnapshot(stored)`; otherwise `void del(key).catch(() => {})`
  (import `del` from `idb-keyval`) and continue as a cache miss.

Tests:
- `GeoLookupService.test.ts`: `describeWeatherCode(2)` → `'Partly cloudy'`;
  `describeWeatherCode('toString' as unknown as number)` → `'—'`;
  `describeWeatherCode(2.5)` → `'—'`; `isGeoSnapshot` accepts a valid row
  and an old-schema row without the per-field stamps, rejects
  `placeName: {}`, `weatherCode: '2'`, `utcOffsetSeconds: 1e9`.
- New `tests/unit/geo/GeoLookupPersistence.test.ts`: `vi.mock('idb-keyval', …)`
  with an in-memory `Map` implementing `get`, `set`, `del`, `delMany`,
  `entries`; seed `geo_cell_36,140` with `{ placeName: { evil: true }, … }`;
  run the service for one tick at Tokyo (copy the fake-timer setup from the
  existing gate suite) → no throw, the bad key is deleted, and a fetch for the
  cell is issued.

**Verify**: `npx vitest --run tests/unit/geo` → all pass.

### Step 4: Gate

**Verify**: `npm run verify` → exit 0.

## Test plan

Covered in the steps: frozen-clock regression, expired-weather hiding,
no re-stamping, label lookup hardening, snapshot validator, corrupt
persisted row. Pattern: the existing fake-timer suite in
`tests/unit/geo/GeoLookupService.test.ts`.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -n ": state.localTime" src/core/geo/GeoLookupService.ts` returns nothing
- [ ] `grep -n "isGeoSnapshot" src/core/geo/GeoLookupService.ts` matches at least twice (definition + use)
- [ ] `grep -n "Object.hasOwn" src/core/geo/GeoLookupService.ts` matches
- [ ] `git diff --stat e78d38d..HEAD` lists only in-scope files

## STOP conditions

- Any existing geo test needs its assertion changed to pass.
- The fix appears to require changing `geoStore.ts` or any UI component.
- `Object.hasOwn` is rejected by the TypeScript `lib` setting — use
  `Object.prototype.hasOwnProperty.call` instead and note it; if neither
  type-checks, STOP.

## Maintenance notes

- If a geo proxy (`api/geo.ts`) is ever added, keep `isGeoSnapshot` as the
  persistence boundary — it is independent of where data came from.
- Local time uses the wall clock, not simulation time, by current design; a
  reviewer should not "fix" that here.
