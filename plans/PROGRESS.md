# PROGRESS — current ledger

> This is the SHORT ledger: current state, verification gates, open items.
> Full landed history (2026-09-23 → 2026-10-08) is preserved verbatim in
> `plans/PROGRESS-history.md` — nothing was deleted in the split.
> Plans kept: 001 (ISS model audit/repair) and 017 (display roadmap), whose
> IDs code comments cite. Finished plans 002–016 were removed 2026-10-28;
> read them with `git show 27241be:plans/<file>`.
> Front door: `CLAUDE.md`. Current state + ranked roadmap: `docs/NEXT_STEPS.md`.

## Docs compaction, sun spikes removed, About actions (2026-10-28)

- **Sun**: the six diffraction spikes are gone from `sunGlare.frag` (owner:
  "artificial and sloppy" after the earlier toning-down); the glare is the
  halo alone, `uPixel` and `apply()`'s buffer-height argument went with them.
  `SunGlareBudget.test.ts` now also fails if `SPIKE_` constants return.
- **About**: the tour and keyboard-shortcut buttons moved from the footer to
  the first row, so they are visible without scrolling.
- **README**: new hero (Follow, backlit by sunrise over the limb above the
  North Atlantic), plain captions, no developer Documentation section.
- **Docs**: finished plans 002–016 and `plans/README.md` deleted (read them
  with `git show 27241be:plans/<file>`); their open specs, rejected findings
  and deferred work moved into `docs/NEXT_STEPS.md`. Plans 001 and 017 stay:
  code comments cite their IDs (001's M1/O1/phase E, 017's R2/V2/X1). Landed detail from
  NEXT_STEPS, this ledger (entries up to 2026-10-26) and HANDOFF's session
  logs moved verbatim to `plans/PROGRESS-history.md`. Two stale images
  removed (`017-viewport-before-after.webp`, unreferenced;
  `sun-before-after.webp`, showed the old spikes).
- **Next**: the environment and atmosphere work (owner item 9) is
  NEXT_STEPS item 1.

## README refresh (2026-10-28)

- Images re-shot after the sun and tool-row changes: `hero-follow.webp`,
  `earth-overview.webp`, new `modules-exploded.webp` (follow-limb removed).
  Headless Edge on the Radeon 780M (D3D11), dev server hooks to seek time
  and steer the camera, `__orbitalEarth8k = 'on'`. Found while shooting:
  close-range night lights render as soft blocks (5 km texels at ~1000x
  scale), recorded in the environment notes.

## HUD tools, tour, sun and glint polish (2026-10-28)

From the owner's review of the live site (ten items; the Dependabot PRs,
README and environment items are tracked separately).

- **Glare moved during Locate/Reset.** `SunGlare.apply()` projected the sun
  at frame priority 0, but flights set `camera.quaternion` later in the same
  priority, so the overlay was aimed with the pre-flight orientation (up to
  945 px off mid-flight). Now the overlay's `onBeforeRender` projects with the
  drawing camera (`projectGlareCenter`); measured 0 px in tracking and in
  flight. Test: `SunGlareAim.test.ts`.
- **White square on the station.** Not reproduced in sweeps at the owner's
  epoch, but the cause is general: with the sun light at 1.9, roughness ~0.3
  at its mirror angle reflects ~9 linear, far over the 2.4 bloom threshold,
  and a flat panel flashes as a whole. `highlightKnee.ts` patches every
  station material (`onBeforeCompile`, one `customProgramCacheKey`, a WeakSet
  because `clone()` copies userData but not the hook) to roll the peak off
  from 1.8 to 2.3. Test: `HighlightKnee.test.ts`.
- **Sun overdone.** `sun.frag` core gain 14, e-fold 0.0030, shoulder 0.32 /
  0.006 (core ~1.6x the disc); `sunGlare.frag` halo core 0.026, slope 0.75,
  spike gain 0.22 and falloff 0.045 with widening spikes, white-to-faint-warm
  tint; `GLARE_PEAK` 0.28. `SunGlareBudget.test.ts` still holds.
- **Hidden tools.** Tool row with icons and labels; Modules always works
  (Locate, then open on arrival; Reset view cancels, 5 min lapse: CI's
  software-WebGL Locate took 2.5 min, past a first 90 s window); `M` shortcut. Tests:
  `moduleExplorerControl.test.ts`, shortcut table.
- **Tour.** `src/ui/tour/` (pure `tourSteps.ts`: steps, spotlight, card
  placement, seen flag; `TourOverlay.tsx`). First visit only; About and `?`
  replay it. The card starts at opacity 0 until measured (visibility hidden
  refused the keyboard focus); the spotlight moves without a transition
  (a 260 ms one lagged a step behind under load). Tests: `tourSteps.test.ts`,
  two e2e specs.
- **Hide HUD hides the orbit line** and the 3D ground track (`hudStore`).
- **Radiators**: checked against the TRRJ law, behaving as designed (a few
  degrees of daylight motion at this beta; hold in eclipse; ≤ 12 deg/s).

## Wheel zoom while tracking (2026-10-28)

- **Symptom** (A.2 bench session): with the clock running in Follow/Inspect,
  each wheel tick dollied ~1% (ten ticks 352 → 328 km; paused, six ticks
  went 354 → 102 km).
- **Cause**: the station-locked carry's `setLookAt(…, false)` ran every
  frame and reset camera-controls' end pose to the rendered pose, so a
  smoothed dolly kept one frame of progress; it also cleared the
  `_isUserControlling*` flags.
- **Fix**: `carryControls` (`StationFrameCarry.ts`) rotates the rendered and
  the end pose and restores the flags (`preserveUserControlFlags`, now
  exported from `FreeOrbitControls.ts`). Tests drive real camera-controls in
  node: carried dolly = uncarried (~102 km); the old carry stalls (> 300 km);
  flags survive.

## Verification snapshot

- `npm run verify` green end-to-end: asset budget → shader ramps → typecheck
  (tests + scripts + configs) → lint (0 warnings) → unit tests (668 at
  2026-10-28) → build. CI also runs the Playwright smoke and viewport suites.
- Node 22+ (module-scope `navigator` reads stay guarded: Node 20 had no
  global `navigator` and broke CI once).
- Perf: `npm run bench` (real GPU, contention guard); baseline
  `docs/bench/baseline-2026-10-26.json`: 59.9 fps, p99 ≤ 17.7 ms in all ten
  rows on the Radeon 780M.

## Open items

The ranked list and the open backlog are in `docs/NEXT_STEPS.md` ("Next
(ranked)" and "Open backlog"). Nothing open lives only here.

## Canon decisions (do not re-litigate; full context in history)

- Lens flare: deleted once, re-added by user directive, reworked 2026-10-04.
  Default OFF; it is a composer pass, so it requires Bloom.
- BGA beta tilt: attempted 2026-09-28, reverted same day; re-implemented
  2026-10-04 with live-frame math and rate caps. Per-wing behaviour changes
  need a browser visual review before landing.
- Nauka hull: user accepted the dark look 2026-09-27, then requested the fix
  2026-10-04 (landed). No further hull changes without a fresh request.
- The static fallback models (Legacy detail, Model A) are deliberately static.
- High model's enlarged ~109-unit (≈1000×) scale is intentional.
- Camera system is closed unless a measured trace says otherwise
  (`docs/HANDOFF.md` camera facts).

## History map (`plans/PROGRESS-history.md`)

Time control feature (09-28) · Visual refresh: sun/terminator/orbit line (09-28)
· Locate under accelerated time (09-29) · Render settings: orbit-line style +
flare (09-29) · OrbitLine repair + glint recolor (09-29) · Pre-commit diff
review + cleanup (09-29) · Performance run OWED note (09-29) · Phase E/F +
browser fault-injection matrix (plan 001) · Verification snapshot (09-27) ·
Independent engineering pass (10-03) · Follow-up pass, deferred items (10-03) ·
gcdatlas comparison pass (10-03) · Open-items pass (10-04).
· **Archived 2026-10-28** (docs compaction): ledger entries 2026-10-08 →
2026-10-26, NEXT_STEPS' landed detail and old roadmap, HANDOFF's session
logs, and the plans index; finished plans 002–016 via `git show 27241be:plans/…`.
