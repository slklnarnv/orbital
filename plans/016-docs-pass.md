# Plan 016: The docs match the code again — no errata banners, no stale numbers, and everything from plans 002–015 recorded

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git log --oneline -1` must show the commit the
> reviewer named in your dispatch message; the docs in scope may have changed
> since this plan was written ONLY through plans 003 (README/CLAUDE.md Node
> version lines). Anything else changed in `docs/`, `README.md`, `CLAUDE.md`
> or `plans/PROGRESS.md` since `e78d38d` is a STOP condition:
> `git diff --stat e78d38d..HEAD -- docs README.md CLAUDE.md plans/PROGRESS.md`
> must list only `README.md` and `CLAUDE.md`.

## Status

- **Priority**: P1 (CLAUDE.md: "Docs drift is a bug - same rule as code")
- **Effort**: M
- **Risk**: LOW (docs only)
- **Depends on**: plans 002–015 merged
- **Category**: docs
- **Planned at**: commit `15de887` (+ plan 012/013 merges), 2026-10-25

## Why this matters

`CLAUDE.md` is the only doc agents are guaranteed to read, and it sends them
to `docs/NEXT_STEPS.md`, `plans/PROGRESS.md` and the deep docs. Those docs now
(a) contradict the code in a dozen verified places, (b) carry two ERRATA
banners although the project rule is "never ship an errata banner - fix the
stale text instead", and (c) do not mention anything plans 002–015 changed.
A future session reading them would re-plan finished work and chase bugs that
no longer exist.

## Current state — verified drift (fix each at the quoted text)

1. Clearance is 70 km in code (`src/interaction/camera/CameraStateMachine.ts:14`
   `ISS_MODEL_CLEARANCE_KM = 70`; README already says 70):
   - `docs/HANDOFF.md` ~line 284: "all manual ISS modes share 60 km model clearance."
   - `docs/verification.md` ~line 68: "the 60 km close-up limit".
   - Leave `docs/HANDOFF.md` ~line 190 "(verified 0 px over 240 frames at 60 km)" —
     it is a dated measurement; append "(2026-09 measurement)".
2. `lerpLookAt` does not exist in `src/` (every Locate uses
   `CameraFlightPath.planLocate`):
   - `docs/HANDOFF.md` ~line 191-194: "Overview/local Locate retains the
     two-second `lerpLookAt` path; Reset View and close-Earth departures use
     `CameraFlightPath`…" → every Locate and Reset uses `CameraFlightPath`;
     a short Locate is ~2 s (the planLocate base).
   - `docs/verification.md` ~line 13 "the original two-second flight" and
     ~line 95-96 "Near-station Locate should retain the shorter two-second path"
     → reword to "a short (~2 s) flight".
3. Flight durations (code: `CameraFlightPath.planLocate` returns
   `2000 + min(2000, max(0, startRadius − 20000)·0.025) + |sweepAngle|·350` ms;
   ×0.35 under `prefers-reduced-motion` in `CameraController.tsx`; Reset is
   `2200 + initialRollErrorRad·250` ms):
   - `README.md` line ~71 "its duration scales with the sweep angle (350 ms/rad)
     plus up to two extra seconds…" → state the 2 s base too.
   - `docs/HANDOFF.md` ~213-215 and ~219 "the flight lasts 2–4 s" → 2–~5 s and
     the full formula once.
   - "2.2-second" Reset in `README.md` ~94, `docs/HANDOFF.md` ~288,
     `docs/verification.md` ~77 → "2.2 s (plus up to ~0.8 s to settle roll)".
4. Units: `public/models/iss_igoal.glb` is 20,529,892 bytes = 20.5 MB = 19.6 MiB.
   "20.5 MiB" in `README.md` ~71, `docs/NEXT_STEPS.md` ~26 and ~161 → "20.5 MB".
5. Test counts: stale "227 unit tests" in the `docs/NEXT_STEPS.md` comparison
   table (~209) and "111 unit tests" in `docs/ISS_MODEL_CONTEXT.md` §7.1; "246"
   elsewhere. Get the real number from `npx vitest --run` (summary line) and use
   it in DATED ledger entries only; evergreen text says "the unit suite".
6. `README.md` "npm run verify      # Assets, shaders, types, tests, and
   production build" and the Development paragraph omit lint; `docs/HANDOFF.md`
   ~19 likewise → add "lint (0 warnings)". Add `npm run test:e2e` to the
   README Development block and to `CLAUDE.md` Commands (one line each).
7. `docs/HANDOFF.md` ~22 "Known pre-existing warning: `three-core` chunk > 500 kB."
   → delete (vite.config.ts sets `chunkSizeWarningLimit: 800`).
   `docs/HANDOFF.md` ~134 fonts "Loaded in `index.html`" → "self-hosted in
   `public/fonts`, declared in `src/index.css` (`index.html` preloads them)".
8. `docs/HANDOFF.md` ~115 "light-silver coating" → "white (Z-93) coating".
9. `docs/verification.md` "Locate detail tiers" step 5 uses dev
   `?failAssets=…` on a production build → mark the step "dev server only
   (`npm run dev`); on a production build use DevTools request blocking", and
   note the needle must be the full file name (`iss_igoal.glb` vs
   `iss_igoal_locate.glb`).
10. `README.md` Data-resilience table (`LIVE`/`HYBRID`/`OFFLINE`/`RECOVERY`):
    add a "HUD label" column (Live / Cached / Fallback / Recovery — from
    `src/ui/common/telemetryModeVisual.ts`) and say LIVE/HYBRID age is measured
    from when the element set was FETCHED (the packaged fallback is aged from
    its epoch). This is deliberate (CelesTrak sets are 12–36 h old at download)
    — say so in one sentence.
11. `README.md` "Project layout" omits `src/data/`, `src/hooks/`, `src/utils/`,
    `.github/workflows/`, `tests/e2e/`; `tests/unit/` has more areas than listed.
    Regenerate from `ls src scripts tests tests/unit`. `CLAUDE.md` "Map" →
    `scripts/` line: add `refresh-fallback-tle.mjs`, `build-iss-locate-lod.mjs`.
12. `docs/NEXT_STEPS.md` B.2 "Sample ±1 orbit at 30 s steps (≈190 points)" →
    what landed: ±½ orbit (~186 points) on the HUD globe and the optional 3D
    track (plans 014/015).
13. `docs/ISS_MODEL_CONTEXT.md` personal path `C:\Users\Arnav\Downloads\ISSTEST\`
    (§1 ~76 and §1.1 ~94) → "a local copy of the IGOAL FBX (not in the repo;
    ask the owner)", keep the file NAME.
    `docs/ISS_MODEL_CONTEXT.md` ~124 Model A "37 KB" → "40 KB" (39,708 bytes).
14. `src/` is out of scope, but note in the PROGRESS ledger (not fix) that the
    `ISSModel.tsx` header comment's reliability ladder omits the `locate` tier.

## Current state — the two ERRATA banners

### `docs/ISS_MODEL_CONTEXT.md` lines ~3-49 (banner) — fold each item into the body, then delete the banner

- Erratum 1 (TRRJ shaft is native X, not Z; only SARJs rotate about the truss
  axis Z) → rewrite §2.3's "CRITICAL QUIRK" paragraph, §5 "axis = truss Z",
  §6.4 and §7.5. Code truth: `src/rendering/iss/ISSJointKinematics.ts`
  TRRJ `axisModel: [1, 0, 0]`.
- Erratum 2 (no end-edge hinge, no per-frame position compensation; the
  TRRJ origin lies ON the shaft) → rewrite §5 step 4, §5 "Hinge compensation",
  §1.1 "resolves its axes/hinges at mount", §9.1 "axis, hinge, frames".
  NOTE: the banner's claim "`resolveJoint`… no longer exist[s]" is itself
  wrong — `resolveJoint` exists (`ISSJointKinematics.ts`, called from
  `ISSAnimations.tsx`) and now reads rig metadata. Describe it correctly.
- Erratum 3 (no AABB inference; axes are rig data `extras.orbitalRig` from
  `scripts/iss-rig-manifest.mjs`, validated by `parseRigMetadata`; TRRJ
  ±105° at 0.75°/sim-s illustrative autotrack) → rewrite §5 steps 1-3, the
  "+0.7 rad / −0.7 rad offset" text, §6.2, §3 history line.
- Erratum 4 (no runtime silver override; build-time white
  `Radiator_Panel_Coating` split in `scripts/build-iss-model.mjs`) → rewrite
  §2.3 material paragraph (`applyRadiatorMaterialCorrection()`, `#d9dee4`),
  §8 standing rules that mention "how the radiator override works", §9.2,
  the key-files table row "radiator material override".
- Erratum 5 (declared vs decoded bounds: quantization deltas ≤ 4.2e-4 m are
  expected under Draco) → §2 and §3 "declared accessors match decoded exactly".
- Erratum 7 (build writes a candidate `.tmp-iss-build/iss_igoal_candidate.glb`,
  publishes after validation; 703 nodes with six attachment frames;
  `--check-only` manifest mode) → §1.1 "Output overwrites…", §2 "697 nodes".
- Erratum 8 (Legacy/Model A normalization constants) → state them in §4.
- Also stale and NOT covered by the banner: §5 "BGA nodes … are intentionally
  NOT animated" — BGAs ARE driven (`bgaTargetAngle`, 2°/sim-s, 12°/s wall cap;
  live SARJ parent frame); §9.1 "TRRJ thermal profile … replace sun-pointing+0.7
  rad" — the edge-to-Sun / face-to-Earth law is implemented
  (`trrjTargetAngle`), so §9.1 becomes "optional: faithful parked-TRRJ ops";
  §7.4 expected network/log lines → the Locate tier
  `/models/iss_igoal_locate.glb?v=…` loads first, the log is
  `{ quality, url, attempt }`.
- Keep §3 ("Audit history — what was claimed, what was true") as history:
  past tense is fine there.

### `docs/MODEL_AUDIT.md` lines ~7-20 (banner)

The banner points at "Finding 8's mechanism explanations" but (a)/(b) are in
Finding 6's ERRATUM block (~107-120), (c) is Finding 8 (~129-138) plus
"Actions taken" ~168 ("light-silver material at mount"), and (d) is Finding 9
(~139-143, "remains future work (P2)" — now implemented). Finding 6 ~100-102
"BGAs stay parked" is also stale. Rewrite those findings in place with a
one-line "Superseded by plan 001 (M1–M4): now …" lead-in each, then delete the
banner. This file is an audit report — keep each finding's original claim
visible, add the resolution.

## Current state — what landed (record it)

Merged on branch `claude/project-onboarding-ah2b00` (read `git log --oneline e78d38d..HEAD`
for SHAs; the index is `plans/README.md`):

- 002 fresh packaged TLE (epoch 2026-10-24).
- 003 vite 6.4.5 / postcss / vitest 4.1.12 / sharp 0.35.5 patched; CI on
  Node 22 (`.nvmrc`), actions pinned to SHAs, `persist-credentials: false`,
  full-tree `npm audit` step; `.github/workflows/refresh-tle.yml` opens a
  fallback-TLE PR Mon/Thu (needs the repo setting "Allow GitHub Actions to
  create and approve pull requests").
- 004 telemetry: offline-start recovery; confidence on |age|; clock clamp
  100 → 1000 ms (accelerated time on rate); `X-TLE-Stale` honoured
  (`fetchTLEWithStatus`); cache bootstrap never replaces a network TLE;
  same-instant TLE blend; 16 KiB upstream body cap in `/api/tle`.
- 005 geo: separate place/weather freshness, weather hidden after 1 h,
  no frozen local time, persisted rows validated (`isGeoSnapshot`).
- 006 rendering: stable glint uniforms (fade + tint work again);
  detail prep compiles the composer's shader variant (`detailPreparation.ts`);
  flare Earth mask disabled when Earth's centre is behind the camera;
  PMREM render target disposed; `unavailable` stays terminal; no spurious
  legacy attempt on reselect.
- 007 4× MSAA on the bloom composer target.
- 008 signed Locate sweep angle (close departures land on the planned standoff).
- 009 known-answer tests: OrbitalEngine vs satellite.js, GMST vs `gstime`,
  formatters, `periodMsOf`, mode vocabulary, `ApiRateLimiter`; orbit-tape
  math extracted to `src/ui/clusters/orbitTapeMath.ts`.
- 010 production crash screen without stack; sentence-case HUD strings;
  dead constants removed.
- 011 roadmap **D.1 landed**: `src/core/orbital/SunVisibility.ts`
  (`sunVisibility`, `isSunlit`), continuous lighting via
  `src/rendering/iss/eclipseLighting.ts`; TRRJ law switches at the 0.5 edge.
- 012 roadmap **B.1 landed**: `src/core/orbital/EclipseForecast.ts`
  (`forecastShadowTransition`, `ShadowForecaster`), store fields `sunlit` /
  `shadowTransitionInMs`, HUD line under the gauges
  ("Daylight · sunset in mm:ss" / "Eclipse · sunrise in mm:ss").
- 013 roadmap **A.3 landed**: Playwright smoke suite (`tests/e2e/`,
  `playwright.config.ts`, `npm run test:e2e`, CI `e2e` job). Read the plan
  file and `tests/e2e/smoke.spec.ts` for what it covers.
- 014/015 roadmap **B.2 landed**: `src/core/orbital/GroundTrack.ts`
  (`sampleGroundTrack`); the HUD globe draws the track (dotted past, solid
  future); optional 3D track + footprint (`src/rendering/earth/GroundTrack.tsx`,
  setting "Ground track", default off) with a constant-ulp clip-space depth bias
  (`src/rendering/earth/groundTrackDepth.ts`) — this supersedes D.3's options.
- Reviewer browser checks done (dev build, headless Chromium/SwiftShader):
  Locate reaches `Follow · Locked`; the glint fades (opacity 0.077 at the
  Follow standoff); Bloom-mode edges antialiased; countdown reads and counts
  down; mobile gauge gap 10 px; 3D track and footprint render with limb
  occlusion; no console errors except an external BigDataCloud 400.
- Still open (keep on the roadmap): B.3 next visible pass (reuse `isSunlit`
  and the forecaster pattern; needs CSP/Permissions-Policy changes for city
  search/geolocation), B.4–B.8, C.1–C.4, C.5's CHANGELOG half, D.6 coarse-pointer
  + render-scale halves, D.7 save-frame (warning: a positive-priority
  `useFrame` disables R3F auto-render — the capture must not mount while
  Bloom is off), D.8, D.9; deferred majors (React 19 + R3F 9 + drei 10, three
  r18x, Vite 7/8, satellite.js 7) and the "investigate" list in
  `plans/README.md`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (never stage) |
| Test count | `npx vitest --run 2>&1 \| grep -E "Test Files\|Tests "` | the numbers to record |
| Banner check | `grep -n "ERRATA" docs/*.md` | no output at the end |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**: `docs/NEXT_STEPS.md`, `docs/HANDOFF.md`, `docs/verification.md`,
`docs/ISS_MODEL_CONTEXT.md`, `docs/MODEL_AUDIT.md`, `README.md`, `CLAUDE.md`,
`plans/PROGRESS.md`.

**Out of scope**: every file under `src/`, `api/`, `scripts/`, `tests/`;
`plans/PROGRESS-history.md` (frozen archive — do not edit); `plans/README.md`
(reviewer); `plans/0*.md`; `NOTICE.md`; `public/**`.

## Git workflow

- Work on your worktree's branch. Commits by area: (1) drift fixes,
  (2) ISS_MODEL_CONTEXT banner fold, (3) MODEL_AUDIT banner fold,
  (4) NEXT_STEPS/PROGRESS/HANDOFF/verification/README/CLAUDE records.
- Subject style: `Docs: fold the model-context errata into the text`.
- Commit messages: NO `Co-Authored-By` trailer (the owner asked for none).
  End the body with
  `Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u`.
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: Drift fixes 1–13
Apply each item in "verified drift" at its quoted text. Re-check each claim
against the code before writing it (open the cited source file).

**Verify**: `grep -n "60 km model clearance\|lerpLookAt\|20.5 MiB\|Known pre-existing warning\|C:\\\\Users" docs/*.md README.md` → no matches.

### Step 2: Fold the ISS_MODEL_CONTEXT errata
As specified above. Keep section numbering stable so cross-references survive.

**Verify**: `grep -n "ERRATA\|applyRadiatorMaterialCorrection\|d9dee4\|intentionally NOT animated\|0.7 rad" docs/ISS_MODEL_CONTEXT.md` → no matches (history in §3 may say "was ±0.7 rad" in past tense — if so, confirm it is inside §3).

### Step 3: Fold the MODEL_AUDIT errata
**Verify**: `grep -n "ERRATA" docs/MODEL_AUDIT.md` → no matches; Findings 6, 8, 9 each carry a "Superseded by plan 001" lead-in.

### Step 4: Record what landed
- `docs/NEXT_STEPS.md`: rewrite "Current state" (date 2026-10-25) as a short
  list of what landed (from the section above) and the green gate
  (exact test count from the command table); re-rank "Next": 1. live
  re-check after deploy (headers + a human visual pass on the penumbra fade,
  countdown, ground track, Bloom MSAA); 2. B.3 next visible pass; 3. C.5
  CHANGELOG + Dependabot; 4. D.6 remainder / C.4 a11y; 5. deferred majors.
  Mark D.1, B.1, A.3, A.4 (unit tests for frame-math modules), B.2 and D.3
  as LANDED/SUPERSEDED in their roadmap entries (one line each, keep the
  original spec text below as history only where it explains a decision).
  Remove "Playwright smoke suite (needs install; postponed twice)".
- `plans/PROGRESS.md`: new top section "Improve-skill audit + waves 1–2
  (2026-10-24/25)" with a table of plans 002–015 (title, one-line result),
  the verification snapshot (test count, e2e count, browser checks), and the
  note from drift item 14. Update "Open items" (remove Playwright; add the
  investigate list pointer to `plans/README.md`).
- `docs/HANDOFF.md`: a new top "Session log — 2026-10-24/25" block (≤ 25
  lines) pointing to PROGRESS and listing the facts a camera/HUD/geo worker
  needs: signed Locate sweep, eclipse countdown in the gauges cluster, HUD
  globe track, geo freshness rules (weather hidden after 1 h, null local time
  without an offset), Playwright DOM hooks.
- `docs/verification.md`: add sections "Penumbra and countdown" (300× through
  a terminator at Follow: lights fade over several frames; countdown hits
  00:00 at the crossing) and "Ground track" (toggle on; 25,000 / 13,600 km /
  Follow: no flicker, limb hides the far side, station occludes it) and
  "Automated smoke" (`npm run test:e2e`).
- `README.md`: Highlights gain "Day/night countdown with a modelled
  penumbra" and "Ground track on the HUD globe, optional 3D track and
  visibility footprint"; Render settings paragraph mentions the "Ground
  track" switch.
- `CLAUDE.md`: Commands add `npm run test:e2e`; Map `src/core/` line may
  name the new pure modules (SunVisibility, EclipseForecast, GroundTrack)
  in ≤ 1 line. Keep CLAUDE.md under 95 lines.

**Verify**: `grep -n "postponed twice" docs/NEXT_STEPS.md` → nothing;
`wc -l CLAUDE.md` → ≤ 95; `npm run verify` → exit 0.

## Test plan

Docs only: the gate must stay green (it does not read docs, but lint/type
are unaffected); the greps above are the regression checks.

## Done criteria

- [ ] `grep -rn "ERRATA" docs/` returns nothing
- [ ] the Step 1 grep returns nothing
- [ ] `git diff --stat <dispatch SHA>..HEAD` lists only in-scope files
- [ ] `npm run verify` exits 0

## STOP conditions

- A drift item's "code truth" does not match the code when you open it — report it; do not write a guess.
- Folding an erratum requires rewriting more than ~40% of a section — fold
  what you can, list the rest in the report.
- Any change seems to require editing `src/` or `plans/PROGRESS-history.md`.

## Maintenance notes

- Docs drift is a bug: the next behaviour change must update
  `docs/NEXT_STEPS.md` "Current state" in the same commit.
