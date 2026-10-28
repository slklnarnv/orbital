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
  City lights up close resolve into points of light inside a soft glow
  (`earthSurface.frag`), kept under the bloom threshold. The limb's twilight
  colour and shadow edge follow the sunlight path (`atmosphere.frag`).
  The sun is a disc with a blown core and a soft camera halo (the six
  diffraction spikes were removed 2026-10-28: they read as artificial).
  Bloom and the lens flare are optional; Bloom off is the direct pipeline.
- **HUD**: responsive from phones to ultrawide; the tool row (Passes,
  Modules, Settings) top right; a first-visit guided tour (replay from About,
  whose first row now holds the tour and shortcuts); keyboard shortcuts with
  a `?` overlay; screen-reader summary and announcements; visible passes
  (offline city search, Web Worker); module explorer (pick, explode, focus);
  orbit tape scrubbing with a station-locked camera; `H` hides the HUD, the
  orbit line and the 3D ground track.
- **Gate**: `npm run verify` (677 unit tests on 2026-10-28) is the merge
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
   - *Clouds*: soft cloud shadows on the ground at low sun, and a bright cloud
     rim near the terminator where tops catch light after the ground goes
     dark. Same-day cloud imagery (NASA GIBS, D.8) instead of the composite.
   - *Surface up close*: detail under the station at Follow/Inspect (it softens
     in close shots), and an ocean glint that follows wave roughness and wind.
   - *Stars*: a real catalogue at true magnitude and colour plus the Milky
     Way, dimmed by exposure in daylight and with the sun in view; then the
     Moon at its real position and phase. (HYG is CC BY-SA: see Licensing.)
2. **The sun, owner sign-off.** Toned down twice on 2026-10-28 (smaller core,
   neutral tint, no amber veil, then no spikes). Awaits the owner's look and
   a side-by-side with ISS photography at the limb.
3. **017 I3 — the name** (owner's call). With it, refresh `og-image.png`
   (ALL CAPS wordmark, blue limb, no new mark).
4. **Human visual pass** on a real GPU: the rebuilt materials at Follow and
   Inspect, day and night (MLI blankets, ELC grating, iROSA wings); the
   penumbra fade at a terminator crossing (300x), the countdown, the ground
   track (HUD globe and 3D), the Bloom MSAA edges; on a throttled
   connection, Locate departs with the detailed LOD and the full model
   appears only below 200 km. Also a real-device iOS Safari pass
   (address-bar collapse with `100dvh`, notch insets in landscape).
5. **Bench leftovers (A.2)**: the flare and 300x rows, the GPU-memory leak
   check (5 Bloom toggles, 3 model switches), and why Bloom off measures more
   GPU time than Bloom on (12.5 vs 9.2 ms at overview).
6. **HUD over the bright daylight limb** (A4 follow-up): text falls to ~1.6:1
   at worst in Follow. A stronger scrim or a faint text shadow (removed
   earlier by request) is a design call.
7. **Deferred majors**: React 19 + R3F 9 + drei 10 + camera-controls 3
   landed 2026-10-28 (one camera-controls copy, +37.6 KB gzip JS). Still
   open: three r18x, Vite 7/8, satellite.js 7. TypeScript 7 (#35, held)
   waits for typescript-eslint to accept it (install fails with ERESOLVE).
8. **Follow-ups if wanted**: module explorer per-truss-segment entries (P4–P6
   and S4–S6 are one batch each; splitting needs a batching change in
   `build-iss-model.mjs`) and masses for the elements NASA's pages omit;
   passes: an observer marker on the globe, pass magnitude; a higher-
   resolution cloud source (017 V1.3, with D.8).

## Open backlog (specs kept for when they are picked up)

### Features

- **B.1 second cut**: tint the orbit line's shadowed span.
- **B.4 Share links.** `#t=<epochMs>&m=<mode>&q=<quality>`; parse with a
  whitelist for enums and clamp for numbers (same rule as the settings
  sanitizer). Write the hash at most once a second; apply once on load.
- **B.5 More stations.** Generalise `ISSEntity` into a config-driven entity;
  `/api/tle?id=` stays refused, add `/api/tle/<name>` routes from a fixed map
  (`iss`, `css`, `hst`). Start with CSS as a second marker and orbit line, no
  detailed model.
- **B.6 Reboost detection.** On a TLE swap, compare mean motion and the
  propagated altitude at the same instant; above a threshold (≈0.3 km), emit
  a `TELEMETRY_EVENT` and show a toast "Reboost detected, +0.8 km".
- **B.8 Ground observer view.** Camera mode at an observer's ECEF position
  looking up, horizon mask, ISS as a bright point. Depends on B.3 for the
  observer. Large; only after B.1–B.3.

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

#### D.7 - Save-frame (screenshot)

No capture path exists. Their `saveScreenshot` calls
`renderer.domElement.toDataURL('image/png')` immediately after `render()` in
the same rAF callback - no `preserveDrawingBuffer: true` needed, which is the
part worth copying (the flag costs memory and bandwidth on every frame).
Ours renders in the composer's priority-1 `useFrame`; capture from a
priority-2 `useFrame` after `composer.render()` in the same frame, filename
from the simulation epoch.

Measured 2026-10-19 while building the OG card: reading the canvas from a
`requestAnimationFrame` callback that is NOT the render frame returned an
all-black image (mean 0, max 0 over a 300x158 sample) - the buffer had
already been cleared. The same-frame constraint above is load-bearing, not
a style preference.

Touches: `Postprocessing.tsx` (capture hook or a store flag), one HUD button
+ shortcut, `formatters` for the filename.
Check: captures with Bloom on and off match the screen; no
`preserveDrawingBuffer` added.
Cost: half a session.

#### D.8 - Streamed Earth imagery (NASA GIBS) for close-range detail - big

Our surface is one 4K equirect map (day 1.05 MB, night 249 KB): ~10 km per
texel at the equator. At INSPECT range the ground is visibly soft. Their
Earth streams Blue Marble NG + VIIRS Black Marble from NASA GIBS (up to
~500 m/px at their deepest level, 512 px tiles) and Moon/Mars from NASA
Trek. The borrowable design
is `TileGlobe.ts`: a quadtree refined by screen texel size
(`REFINE_PX = 1.6`), horizon + frustum cull per node, `MAX_CONCURRENT = 8`,
queued requests dropped after `STALE_REQUEST_MS = 150`, a 320-texture budget
with 4 s pruning, and the key trick - an unfinished tile renders its parent's
texture through a UV sub-rect (`mapInto`), so refinement never flashes
level 0.

Integration risks, all real:

- Our surface shader owns the terminator, the cloud shadow (`cloudDensity.glsl`), the ocean
  Fresnel and the city-light curve. Their `tile.frag` re-derives lighting and
  has none of the cloud-shadow taps; porting the tile path means porting
  those features or accepting a visible regression at the swap.
- `vercel.json` CSP `img-src` must add `https://gibs.earthdata.nasa.gov`
  (plus the credit line from D.4).
- `check-asset-budget.mjs` gates only initial assets, so streamed tiles are
  exempt by construction - state that in its comment.
- Fill rate: our scene is already fill-bound (4K maps + bloom at up to 2x
  DPR). Their 320-texture budget was measured on a different scene; measure
  ours before adopting the number.
- Their loader is a module-level singleton shared by every globe; keep ours
  per-globe so a disposed globe cannot leave queued jobs behind.

Do this only after A.2's measured baseline and C.6's cheap cuts. First cut:
Earth only, day layer only, level <= 5, behind a settings toggle default off.

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
- **Tours / TTS / Academy / mission planner / Lambert solver / i18n / star
  catalogue.** Different product. Their HYG binary is CC BY-SA
  (share-alike) - do not copy it.
- **`frustumCulled = false` as a default.** They disable culling almost
  everywhere; keep culling.
- **Unconditional composer.** Our bloom-off parity is a contract.
- **Exposure / FOV sliders.** Bloom threshold 2.4 and the tonemapping are
  calibrated to the sun's glare budget (`sunGlareConfig.ts`); a user
  exposure would invalidate that. Render
  scale (D.6) is the safe lever.
- **Their settings merge, nginx real-IP config, no-test CI.**

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
  endorsement); the GIBS layer ids are facts.
- **Brand: no borrowing.** The name and logo are trademarks of BigBrains.

**Net:** D.1 and D.2 were the two changes with real user-visible payoff for
under a session each, and both have landed. D.3 corrected our own B.2 spec and
landed with it. D.8 is the only large borrow left worth doing, and only after
the perf baseline.
