# Plan 002: The packaged fallback TLE is fresh (epoch within 2 days of today)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e78d38d..HEAD -- src/data/fallback-tle.json scripts/refresh-fallback-tle.mjs`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (release hygiene)
- **Planned at**: commit `e78d38d`, 2026-10-24

## Why this matters

ORBITAL seeds SGP4 propagation synchronously from a packaged TLE
(`src/data/fallback-tle.json`) on a cold start when the network proxy, the
direct mirror, and the IndexedDB cache all miss. The packaged TLE is aged from
its epoch, and past 7 days it falls out of the HYBRID window, pinning the app
in RECOVERY. Today is 2026-10-24 and the packaged epoch is 2026-10-13 (11 days
old), so an offline cold start is already degraded. The repo has a refresh
script for exactly this; it just has not been run.

## Current state

- `src/data/fallback-tle.json` (whole file today):
  ```json
  {
    "_comment": "Fallback TLE for ISS (NORAD 25544). Refresh before each release with `npm run refresh:tle`. ...",
    "line1": "1 25544U 98067A   26286.82178372  .00006592  00000+0  12831-3 0  9991",
    "line2": "2 25544  51.6325  73.0089 0006710 259.3258 100.6975 15.48855783590140",
    "epoch": "2026-10-13T19:43:22Z",
    "source": "fallback"
  }
  ```
- `scripts/refresh-fallback-tle.mjs` — fetches CelesTrak (then
  wheretheiss.at), validates line length, checksums and NORAD id, and
  rewrites the JSON keeping `_comment`. `package.json` exposes it as
  `npm run refresh:tle`.
- `src/core/entities/ISSEntity.ts:31` ages the fallback from `epoch`
  (`fetchedAt: new Date(fallbackTLE.epoch).getTime()`).
- Precedent: commit `8415519` "Refresh packaged fallback TLE (epoch
  2026-10-13)" is the exact same change made previously — match its shape
  (one-file diff, subject line naming the new epoch).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink created (it is git-excluded; never stage it) |
| Refresh | `npm run refresh:tle` | prints `Fallback TLE refreshed from <host>: epoch <ISO>` and exits 0 |
| Tests | `npx vitest --run tests/unit/orbital/TLEParser.test.ts` | all pass |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope** (the only file you should modify):
- `src/data/fallback-tle.json`

**Out of scope**:
- `scripts/refresh-fallback-tle.mjs` — works; do not modify.
- Any workflow automation (a scheduled refresh is plan 003's job).
- `docs/**`, `plans/PROGRESS.md` — the reviewer records this in the docs pass.

## Git workflow

- Work on the branch your worktree was created on.
- One commit. Subject: `Refresh packaged fallback TLE (epoch YYYY-MM-DD)` using
  the new epoch date. End the body with these two lines verbatim:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u
  ```
- Stage files by explicit path (`git add src/data/fallback-tle.json`), never `git add -A`.
- Do NOT push.

## Steps

### Step 1: Run the refresh script

`npm run refresh:tle`

**Verify**: `node -e "const j=require('./src/data/fallback-tle.json');const d=(Date.now()-Date.parse(j.epoch))/864e5;console.log(j.epoch,d.toFixed(2));process.exit(d<3&&d>-1?0:1)"`
→ prints the new epoch and an age under 3 days; exit 0.

### Step 2: Confirm the file shape is unchanged

`git diff src/data/fallback-tle.json` must show only `line1`, `line2`, `epoch`
changed; `_comment` and `source: "fallback"` identical.

**Verify**: `npx vitest --run tests/unit/orbital/TLEParser.test.ts` → all pass
(this suite validates the packaged fallback).

### Step 3: Gate and commit

**Verify**: `npm run verify` → exit 0. Then commit per the Git workflow.

## Test plan

No new tests: the existing TLEParser suite already asserts the packaged
fallback validates (`tests/unit/orbital/TLEParser.test.ts:30`).

## Done criteria

- [ ] `src/data/fallback-tle.json` epoch is within 3 days of the run date
- [ ] `npm run verify` exits 0
- [ ] `git show --stat HEAD` lists exactly one file: `src/data/fallback-tle.json`

## STOP conditions

- `npm run refresh:tle` exits non-zero (all sources failed) — report the
  printed per-host errors; do not hand-edit the JSON.
- The new epoch is OLDER than `2026-10-13T19:43:22Z`.
- The script modifies any other file.

## Maintenance notes

- This refresh decays: every ~7 days the packaged TLE leaves HYBRID again.
  Plan 003 adds a scheduled workflow that opens a refresh PR twice a week.
