# Next Steps - ORBITAL

> Front-door order: `CLAUDE.md` -> this file -> `plans/PROGRESS.md` (short
> ledger; history in `plans/PROGRESS-history.md`). Deep docs load on demand
> (see CLAUDE.md). Keep the Current state section fresh in the same commit as
> behavior changes - never ship an errata banner, fix the stale text instead.
> Landed detail lives in the ledger and its history, not here.

## Current state (2026-10-28)

- **Live**: <https://orbitaliss.vercel.app>, deployed from `main` by Vercel.
  SGP4 at 10 Hz from live TLEs (`/api/tle` races CelesTrak and
  wheretheiss.at; IndexedDB cache; packaged fallback refreshed Mon/Thu by CI).
- **Station**: NASA IGOAL in two tiers (Locate LOD 5.27 MiB at Follow, the
  full model inside the 200 km Inspect band), KTX2 textures, rigid batching,
  SARJ/BGA/TRRJ driven by the pure, tested `ISSJointKinematics.ts`; a
  highlight knee keeps its glints under the bloom threshold.
- **Earth and sky**: 4K WebP first paint, 8K KTX2 day and night maps streamed
  in on capable desktops; bicubic clouds with near-deck detail and shadows;
  atmosphere with a sunrise band; penumbra and a sunrise/sunset countdown.
  Below ~4,500 km the ground near the view centre streams in from NASA GIBS
  (~2 km, then ~0.5 km per pixel below ~1,500 km; `surfaceDetail.ts`,
  Settings > Close-up imagery). City lights up close resolve into points of
  light inside a soft glow (`earthSurface.frag`), kept under the bloom
  threshold. The limb's twilight
  colour and shadow edge follow the sunlight path (`atmosphere.frag`).
  The sun is a disc with a blown core and a soft camera halo (the six
  diffraction spikes were removed 2026-10-28: they read as artificial;
  signed off by the owner the same day). The sky is real: the 9,096 stars of
  the Yale Bright Star Catalogue at true position, magnitude and colour over
  the Milky Way panorama (now in its true J2000 orientation), and the Moon at
  its true position and phase, with Earth's shadow for lunar eclipses
  (`MoonEphemeris.ts`, `SkyLayer.tsx`, `MoonLayer.tsx`).
  Bloom and the lens flare are optional; Bloom off is the direct pipeline.
- **HUD**: responsive from phones to ultrawide; the tool row (Passes,
  Modules, Settings) top right; a first-visit guided tour (replay from About,
  whose first row now holds the tour and shortcuts); keyboard shortcuts with
  a `?` overlay; screen-reader summary and announcements; visible passes
  (offline city search, Web Worker); module explorer (pick, explode, focus);
  orbit tape scrubbing with a station-locked camera; `H` hides the HUD, the
  orbit line and the 3D ground track.
- **Gate**: `npm run verify` (704 unit tests on 2026-10-28) is the merge
  gate and the only CI job. The Playwright smoke + viewport suites
  (`npm run test:e2e`) run locally, by hand; `npm run bench` for measured perf
  (baseline `docs/bench/baseline-2026-10-26.json`). Dependencies: React 19
  (R3F 9, drei 10, camera-controls 3),
  three r170, Vite 6, Vitest 5; Dependabot weekly.

## Next (ranked)

1. **Environment and atmosphere** (owner review 2026-10-28, ranked first so
   it is not lost). Measure each against the bench and keep Bloom-off parity.
   - ~~*Night lights up close*~~: landed 2026-10-28 (B-spline map, points
     of light inside each texel, a bloom-safe knee; overview unchanged).
   - ~~*Atmosphere: twilight*~~: landed 2026-10-28 (limb colour and shadow
     edge from the sunlight path). An airglow band was tried and removed on
     the owner's review: over a dark ocean it read as a drawn line. A full
     precomputed-scattering model was weighed and not taken: ~100+
     exponentials per pixel over most of the frame does not fit the iGPU
     budget; revisit only with a measured reason.
   - *Clouds*: soft cloud shadows on the ground at low sun (needs the sun
     direction in the rotating deck frame), and same-day cloud imagery (GIBS
     has daily true colour, but it carries its own clouds). A cloud rim past the terminator was tried (#53) and removed:
     from the overview it drew a hard grey-orange stripe down the terminator.
     Any retry must be judged from the overview, not only close dusk views.
   - ~~*Surface up close*~~: landed with D.8 (GIBS imagery under the
     station). Still open: an ocean glint that follows wave roughness and
     wind; the night lights from GIBS (`VIIRS_Black_Marble`, 500 m) the same
     way, if the procedural points ever fall short.
   - ~~*Stars and the Moon*~~: landed 2026-10-28 (Yale BSC5 and the LRO WAC
     mosaic, both public domain; the exposure already dims the stars with
     the sun in view).
2. **Human visual pass** on a real GPU: the rebuilt materials at Follow and
   Inspect, day and night (MLI blankets, ELC grating, iROSA wings); the
   penumbra fade at a terminator crossing (300x), the countdown, the ground
   track (HUD globe and 3D), the Bloom MSAA edges; on a throttled
   connection, Locate departs with the detailed LOD and the full model
   appears only below 200 km. Also a real-device iOS Safari pass
   (address-bar collapse with `100dvh`, notch insets in landscape).
3. **Bench leftovers (A.2)**: the flare and 300x rows, the GPU-memory leak
   check (5 Bloom toggles, 3 model switches), and why Bloom off measures more
   GPU time than Bloom on (12.5 vs 9.2 ms at overview).
4. **HUD over the bright daylight limb** (A4 follow-up): text falls to ~1.6:1
   at worst in Follow. A stronger scrim or a faint text shadow (removed
   earlier by request) is a design call.
5. **Deferred majors**: React 19 + R3F 9 + drei 10 + camera-controls 3
   landed 2026-10-28 (one camera-controls copy, +37.6 KB gzip JS). Still
   open: three r18x, Vite 7/8, satellite.js 7. TypeScript 7 (#35, held)
   waits for typescript-eslint to accept it (install fails with ERESOLVE).
6. **Follow-ups if wanted**: module explorer per-truss-segment entries (P4–P6
   and S4–S6 are one batch each; splitting needs a batching change in
   `build-iss-model.mjs`) and masses for the elements NASA's pages omit;
   passes: an observer marker on the globe, pass magnitude; a higher-
   resolution cloud source (017 V1.3).

## Open backlog (specs kept for when they are picked up)

### Features

- **B.1 second cut**: tint the orbit line's shadowed span.
- **B.5 More stations** (owner, 2026-10-28: future work, not next). Generalise `ISSEntity` into a config-driven entity;
  `/api/tle?id=` stays refused, add `/api/tle/<name>` routes from a fixed map
  (`iss`, `css`, `hst`). Start with CSS as a second marker and orbit line, no
  detailed model.
- **B.6 Reboost detection.** On a TLE swap, compare mean motion and the
  propagated altitude at the same instant; above a threshold (≈0.3 km), emit
  a `TELEMETRY_EVENT` and show a toast "Reboost detected, +0.8 km".

### Engineering

- **C.2 full-asset decode/VRAM**: KTX2 landed for both model tiers; meshopt +
  quantization was measured and not adopted (`docs/ISS_MODEL_CONTEXT.md`
  §9.4). Revisit only with a measured reason.
- **C.4**: a high-contrast HUD class.
- **CSP**: drop `style-src 'unsafe-inline'` after a Report-Only rollout.
- **Split god components** (`ISSModel.tsx`, `CameraController.tsx`,
  `App.tsx`) after characterization tests; decouple `GeoLookupService` from
  zustand. Prettier + editorconfig between feature waves.
- **Investigate visually first**: orbit dash float32 precision after long
  accelerated sessions, Earth/sun stepping at 10 Hz under 300x, prefetch
  competing with first-paint textures on slow links.
- **Unverified in a browser**: Model A's terminal 'unavailable' path (live
  `DefaultLoadingManager.onError`); the orbit line's `alphaCurve` (past 0 ->
  0.30, future 0.60) against the closed ring is a visual call.

### Borrowed ideas still open (from the youreyesinspace comparison, 2026-10-19)

#### D.9 - Reverse-time playback - optional, has a real blocker

Their `TimeSystem` has a signed direction with mirrored rate steps, so the
clock runs backwards. Ours clamps `setTimeScale` to 0.1..1000 and only
advances. The blocker is not the clock: `ISSAnimations` integrates BGA and
TRRJ slew with `Math.max(0, epochMs - lastEpochMs)`, so a backwards epoch
yields `dtSim = 0` and those joints freeze while the station moves (SARJ is
not rate-integrated and would still follow). `OrbitLine` already handles
backwards seeks; the tape's phase glide is direction-agnostic.

First cut (if wanted): signed epoch deltas in `ISSAnimations`, `-1x` in
`TimeControls`, caps applied to `|dt|`.
Check: 10 s of reverse at 1x leaves the joint pose bit-identical to the same
epoch reached forward.
Cost: one session. Low value for a tracker; listed for completeness.

## Do not regress

## Where ORBITAL is genuinely stronger (do not regress)

| Area | ORBITAL | Theirs |
|:---|:---|:---|
| Simulation truth | `SimulationRuntime`: recursive-timeout 10 Hz loop, decoupled from React and WebGL, catches up after tab throttling, no overlapping steps **(architectural)** | `time.advance(dt)` inside the rAF callback with `dt` clamped to 0.1 s: a background tab silently loses simulated time, and the clock is welded to the renderer |
| Telemetry | Live TLE; 4-mode LIVE/HYBRID/OFFLINE/RECOVERY; server proxy with checksum + epoch validation + memo + dedupe + stale-on-error; IndexedDB cache; packaged fallback; transactional swap | The ISS is a static Keplerian element set (`spacecraft.ts`: `orbit(6789, 0.0006, 51.64, ...)`). No TLE, no live position |
| ISS fidelity | LVLH/TEA attitude, SARJ/TRRJ/BGA on the authored rig, live-parent-frame targets, slew caps, eclipse hold, 576-line pure kinematics module + tests | A glTF prop fitted to a sphere radius; no articulation, no attitude law |
| Camera | 6-mode state machine with hysteresis, station-relative flights, horizon transport, clearance constraint, deviation-based Reset **(architectural)** | Competent free/orbit camera + autopilot; no mode machine, no flight/constraint separation |
| Verification | Unit suite, Playwright smoke suite, asset budget, shader-ramp gate, lint 0 warnings, CI | No test runner, no lint, no asset gate; CI is typecheck + build + a Docker health curl |
| HUD | Bespoke design system (`index.css` tokens), honest-instrument rule, 1 Hz throttled stores | 940-line `UI` class over a static DOM skeleton; functional, not a system |
| Post | Bloom off = bit-for-bit direct pipeline (contract) | `Engine.useComposer` exists but is never set false; bloom can be disabled, the composer (RenderPass + lensing + OutputPass) always runs |
| Resilience | Per-subtree error boundaries, WebGL diagnostic screen, `webglcontextlost/restored` rebuild, DPR governor with hitch exclusion and per-session caps | No context-loss handling at all; fixed DPR cap + manual scale |
| Delivery | 5 MiB initial asset budget enforced in CI; 20.5 MB model deferred | ~254 MB of `public/` media (103 MB tours, 116 MB lessons) with no gate |

Do not import their settings merge (`{...DEFAULTS, ...JSON.parse(raw)}`) -
our sanitizer is the correct pattern. Do not import their nginx
`set_real_ip_from 0.0.0.0/0` with `real_ip_header CF-Connecting-IP`: any
direct-to-origin client can forge the logged IP; the origin secret mitigates
access, not log integrity.

## Rejected (do not re-audit)

### From the youreyesinspace comparison

- **Floating origin + 10^13 km log-depth scene.** Our float32 at ~7,000 km has
  ~0.8 m precision and the scene spans 2e6 km. No need.
- **Pointer-lock free flight (WASD/QE).** Fights drei CameraControls and the
  mode machine; our Free mode is a pan, not a flight.
- **Tours / TTS / Academy / mission planner / Lambert solver / i18n.**
  Different product. Their HYG star binary is CC BY-SA (share-alike) - do not
  copy it; our stars are the public-domain Yale BSC5.
- **`frustumCulled = false` as a default.** They disable culling almost
  everywhere; keep culling.
- **Unconditional composer.** Our bloom-off parity is a contract.
- **Exposure / FOV sliders.** Bloom threshold 2.4 and the tonemapping are
  calibrated to the sun's glare budget (`sunGlareConfig.ts`); a user
  exposure would invalidate that. Render
  scale (D.6) is the safe lever.
- **Their settings merge, nginx real-IP config, no-test CI.**

### Owner decisions (2026-10-28)

- **B.4 Share links**, **B.8 Ground observer view** and **D.7 Save-frame**:
  dropped by the owner. The specs are in git history (`docs/NEXT_STEPS.md`
  before this date) if ever wanted.
- **The name** stays ORBITAL (017 I3 closed).

### From the 2026-10-24 improve audit

- Gate LIVE/HYBRID on TLE epoch age instead of fetch time: CelesTrak sets are
  routinely 12–36 h old at download, so a fresh fetch would read "Cached".
  The README wording is wrong instead (docs pass).
- `extractTLEEpoch` lacks validation: every caller receives TLEs already
  validated by `validateTLEData`, which checks the epoch field.
- Orbit tape `aria-valuenow={0}`: React never re-applies an unchanged prop;
  the frame loop's imperative ARIA writes stand.
- Lazy-loading the postprocessing chain / rig JS (roadmap C.2 code half):
  ~15 kB gzip, already needed at boot; C.2 stays about assets.
- Draco-free Model A, 5-tap cloud-shadow filter, per-frame small allocations,
  HUD re-render cadence, OrbitTape `left` writes: negligible measured cost.
- Starmap tone-mapped on the composer path: invisible in practice.
- ISSModel frame callback one frame behind ISSGroup: ≤5° earthshine skew only at 300×.

## Licensing boundary

- **Code: MIT.** Adapting the shadow math (eight lines of standard analytic
  geometry) is fine; reimplement from the geometry and note the source in a
  comment.
- **Data: do not copy.** The HYG-derived catalogue is CC BY-SA 4.0. NASA
  imagery is public domain under the NASA media guidelines (no implied
  endorsement); the GIBS layer ids are facts. Ours: the Yale Bright Star
  Catalogue (public domain, NASA ADC / CDS V/50) and the LRO WAC Moon mosaic
  (NASA/GSFC/ASU, public domain, via NASA Moon Trek); see
  `public/textures/README.md`.
- **Brand: no borrowing.** The name and logo are trademarks of BigBrains.

**Net:** D.1, D.2 and D.8 (streamed GIBS imagery, 2026-10-28) have landed;
D.3 corrected our own B.2 spec and landed with it. D.9 is the only one left,
and optional.
