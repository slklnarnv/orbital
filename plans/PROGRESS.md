# PROGRESS — current ledger

> This is the SHORT ledger: current state, verification gates, open items.
> Full landed history (2026-09-23 → 2026-10-08) is preserved verbatim in
> `plans/PROGRESS-history.md` — nothing was deleted in the split.
> Plan 001 (ISS model audit/repair) lives in `plans/001-*.md` + `plans/README.md`.
> Front door: `CLAUDE.md`. Current state + ranked roadmap: `docs/NEXT_STEPS.md`.

## 017 I1 icon + manifest, I2 loading screen (2026-10-26)

- **Icon.** One parametric mark (orbit ellipse, gradient toward a glint;
  `--hud-hi` on `--space`) drawn by `scripts/build-icons.mjs`
  (`npm run build:icons`, sharp): `favicon.svg` (size-optimised, no sparkle
  rays), `favicon.ico` (16/32/48 PNG frames), `apple-touch-icon.png` (180,
  full bleed), `icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
  (mark scaled 0.82 to sit inside the 80% safe zone). `favicon.png` removed.
  `index.html`: icon links, manifest, `theme-color` #020409,
  `color-scheme: dark`. `vercel.json`: 1-day cache for icons, manifest
  served as `application/manifest+json`; CSP unchanged (same-origin).
- **Loading screen.** Stages: data link (bootstrap promise settled →
  `telemetryModeVisual` label and dot), Earth (`/textures/`, incl. the star
  map) and station (`/models/`, `/draco/`, `/basis/`, GLTF blob textures),
  counted per distinct URL from `DefaultLoadingManager` item hooks. The gate
  is assets only (the link never blocks: the bundled TLE propagates
  meanwhile). Static first-paint copy in `index.html`; the React screen
  carries the shell's animation clock over (`bootShell.ts`). Reduced motion:
  glint parked at the icon position, no fade.
- **Measured** (local production builds of `main` and this branch, headless
  Edge, 12 Mbps / 80 ms, cache off, one run each): first contentful paint
  840 → 520 ms (388 ms with reduced motion); the old build was blank at
  0.3 s, the new one shows the stages. Assets still settle in ~5–7 s on that
  link (unchanged; same files).
- **Tests.** `tests/unit/ui/bootProgress.test.ts` (classification, repeat
  starts, growing totals, failures, the gate), `bootMarkSync.test.ts`
  (index.html, CSS offset-path and the icon script share one geometry); e2e
  waits on the `progressbar` named "Loading".
- **Open.** `og-image.png` still shows the old wordmark treatment; refresh it
  with the name decision (I3).

## 017 V1 close-range clouds (2026-10-26)

- **Cause.** `clouds.frag` uses map density directly as alpha (no coverage
  threshold to smooth); the blocks and staircase were bilinear magnification
  of the 4096×2048 map (~10 km per texel) once a texel spans tens of pixels.
- **Fix.** `src/rendering/shaders/cloudDensity.glsl`, included by both
  `clouds.frag` and `earthSurface.frag`: a cubic B-spline (four bilinear
  taps, `textureLod` level 0) when magnified, blended in over 1–2 px per
  texel; a zero-mean multiplicative fBm, `d·(1 + s·n·(1 − d))`, in the
  deck's rotating frame (`vCloudDir`), faded in by camera altitude
  (3,500 → 1,200 km) and per octave by pixel footprint. The surface shadow
  uses the same function with two octaves (replaces the five-tap blur) and
  samples without `fract()`. `CloudLayer` gained the `cloudTexelSize` uniform.
- **Evidence.** Before/after at 800 km and 300 km over the day side and the
  overview (Playwright + Edge, camera placed with `__orbitalControls`): no
  texel edges at 300 km, overview pixel-identical apart from star twinkle.
  GPU timer queries per pass changed within noise (cloud ~0.7 ms at 300 km);
  provisional, the GPU was shared. Contract test: both shaders read the
  shared field (`EarthVisualContracts.test.ts`).
- **Open.** V1.3 (higher-resolution source) stays with V2 / D.8.

## C.5 changelog and Dependabot (2026-10-26)

- `CHANGELOG.md`: Keep a Changelog; no version tags, so each section is the
  date a change reached `main` (UTC+5:30). PRs add lines under "Unreleased";
  the merger renames it to the merge date. Built from git history, the merged
  PRs (#1–#30) and this ledger. Linked from `CLAUDE.md` and the README.
- `.github/dependabot.yml`: npm and GitHub Actions weekly (Monday), 7-day
  cooldown. npm minor + patch grouped into one PR. Major bumps ignored for the
  deferred migrations (react, react-dom and their types, R3F, drei, Vite,
  `@vitejs/plugin-react`, satellite.js) and `@types/node` (Node 22 floor);
  three and `@types/three` take patches only, because every rNNN is a 0.x
  minor bump. Actions are grouped; SHA pins and `persist-credentials` stay.
- Checked: the file validates against the SchemaStore `dependabot-2.0` schema.
  Not yet seen: a first Dependabot run (it starts once this is on `main`).

## Roadmap 017: display, visuals and polish (2026-10-26)

- Viewport audit (nine sizes, 360×640 to 3440×1440, overview and Follow):
  no overlaps, nothing off-screen, no horizontal scroll; but landscape phones
  get the full desktop HUD, portrait framing puts the station under the
  clock, text down to 7 px, touch targets down to 23×15 px, and the HUD does
  not scale up on QHD/ultrawide.
- Captures: clouds blocky at 800 km and stair-stepped at 300 km; the sun reads
  as a small bright star by the limb; the dashed orbit looks right (its code
  is the issue).
- Plan: `plans/017-display-visuals-polish-roadmap.md`; NEXT_STEPS' ranked list
  now follows it.

## 017 V4: dashed orbit in the shader (2026-10-26)

- **Before.** `OrbitLine` sized `dashSize`/`gapSize` every frame from the
  camera-to-station distance and kept a dash origin plus an absolute
  `dashOffset` so the pattern would not crawl (PR #15). Pitch was constant
  only at the station's depth: at Follow 250 km it ran 16 → 7 px from the
  near to the far end of the arc.
- **Now.** Each vertex carries its orbital phase (`OrbitPhase.ts`,
  revolutions of the mean motion at the vertex epoch, relative to a whole
  revolution so float32 holds it). The fragment shader
  (`shaders/orbitDash.glsl`) picks 2^n dashes per revolution from the
  phase's screen-space derivative (13 CSS px target, n ≤ 17) and crossfades
  neighbouring levels. A point on the ring keeps its phase in every arc, so
  the pattern cannot crawl and there is no state; the time phase was chosen
  over the geometric argument of latitude because the node precesses
  (~0.26 km relabel per refresh). Phase rides in LineMaterial's
  `instanceDistance` slots (USE_DASH kept for the endcap discard); style is
  the `orbitDashed` uniform.
- **Measured** (dev server, headless Edge on the AMD iGPU, frame captures):
  fixed camera on the future arc, along-track shift 0 px (correlation
  ≥ 0.987) after seeks of +61/+130/−70 s, a tape scrub, 1× and 300×
  (18 sim-minutes); pitch 13 px there and 11–13 px along the Follow 250 km
  arc; 0 programs linked over Dashed → Continuous → Dashed with Bloom on and
  off; DPR 2 pitch ~35 device px (CSS-sized).
- **Tests.** `tests/unit/orbital/OrbitPhase.test.ts`: one revolution per
  period, whole-revolution origin, [0, 2) range, and the same epoch gets the
  same float32 dash fraction (finest level) from arcs regenerated at
  1×/300×/scrub/backward-seek offsets.
- **Look.** Same colour, width, fade and 7/6 duty. What changed: the far arc
  no longer shrinks to dots, and zooming fades dashes in and out at octave
  steps instead of rescaling them.

## Orbit-tape scrub while tracking (2026-10-26)

- **Symptom.** Dragging the orbit tape in Follow or Inspect: the view swung
  around the station and the station stuttered against Earth.
- **Measured** (dev hooks: camera offset in the station's orbital frame,
  per-frame station step; production frames every 100 ms):
  - the camera offset's along-track component went +0.39 → −0.15 over a
    ~10-minute scrub — tracking kept an inertial offset while the LVLH
    frame turned; half an orbit would put the camera under the station;
  - per-frame station steps of 0–340 km while the clock moved evenly —
    10 Hz snapshots alternating blend and snap (400 km reseed bound), while
    the Earth reads the clock every frame;
  - the attitude eased after every >5° step.
- **Fix.** `StationFrameCarry` rotates the eye and `camera.up` with the
  station's attitude change while tracking (reset during flights); a paused
  clock propagates at its own time each frame (`snapTo`) and snaps the
  attitude (`AttitudeFollower.snap`); shadow redraws are capped at
  `SEEK_MIN_INTERVAL_MS` (150 ms) while seeking.
- **After.** The same half-revolution scrub keeps the limb in place with the
  ground flowing underneath; Follow scrub 60 fps; shadow redraws during an
  Inspect scrub 57 → 31 per 3.5 s. Tests: `StationFrameCarry.test.ts`
  (framing preserved across uneven steps and a half-orbit seek),
  `AttitudeFollower.snap`, `snapTo`, the seek redraw cap.

## B.3 visible passes (2026-10-26)

- **Prediction.** `src/core/orbital/PassPredictor.ts`: SGP4 every 30 s over
  48 h of simulation time; visible = ISS elevation > 10° (`ecfToLookAngles`),
  ISS sunlit (`isSunlit`, penumbra midpoint) and Sun < −6° at the observer
  (the TEME Sun direction rotated by the same GMST). Edges bisected to 1 s,
  peak by golden-section search, compass bearings at start/peak/end, flags
  for in-progress, starting from shadow and ending in shadow. ~11 ms per
  observer; runs in `passes.worker.ts` with a main-thread fallback
  (`PassService.ts`), recomputed on a new TLE or observer, a backward seek,
  or after 6 h of window slide.
- **Check.** Skyfield 1.55 (de421), same TLE and conditions at 1 s: the
  same 8 passes over London, New York, Sydney and Tokyo, edges within 4 s,
  peaks within 1° — frozen as known answers in `PassPredictor.test.ts` with
  the TLE embedded.
- **Observer.** Offline city search over Natural Earth 10m populated places
  (`scripts/build-city-index.mjs` → `src/data/city-index.json`, same pinned
  commit as the place index; lazy hashed asset), typed coordinates
  ("51.5, -0.12", "33.87S 151.21E"), or browser geolocation
  (`Permissions-Policy` `geolocation=(self)`). localStorage only, sanitized
  on read.
- **UI.** `src/ui/common/PassesPanel.tsx`: "Passes" beside the gear;
  combobox with keyboard support; up to 6 passes with local date and time,
  lead time, duration, peak, path; "Watch" seeks 30 s ahead and plays at 1×.
  Phone fixes on the way: popover fine text was hidden by a ≤900 px corner
  rule; the corner row now sits under the camera reticle.
- **Verified** in headless Edge against the production-header preview:
  search, Enter, Watch (clock moved to 30 s before the pass), coordinates,
  geolocation with a granted permission, 390 px phone layout; no CSP
  violations.

## Docs pass + live re-check (2026-10-25)

- README rewritten for a public reader: a primer on what the view shows, a
  Mermaid pipeline diagram, a controls table and four live-site screenshots
  (`docs/images/*.webp`, 28–54 KiB each, outside `public/` so they never
  ship with the app). NOTICE lists the Basis transcoder.
- Live re-check (NEXT_STEPS item 1) passed: endpoints, cache headers, a
  console free of CSP violations, IGOAL at Locate, 60 fps on the owner's
  integrated GPU. The human visual pass remains open.

## Place names: BigDataCloud → offline Natural Earth index (2026-10-25)

- **Symptom (live only).** Every BigDataCloud request logged a `connect-src`
  violation for `https://api-bdc.io/data/reverse-geocode-client?...`; the
  "Passing over" place lookup always fell back.
- **Cause.** `GeoLookupService` calls `api.bigdatacloud.net` — still the host
  BigDataCloud's docs and its own JS client use — but it now answers 307 →
  `api-bdc.io` (verified with curl). CSP checks each redirect hop, and
  `connect-src` allowed only the first host.
- **Policy.** Allowing the redirect host would have fixed the console, but
  BigDataCloud's fair-use policy allows the free client endpoint only for
  the calling device's own, current location (violations are IP-banned,
  402). The ISS ground point is not that.
- **Fix.** Place names are offline. `scripts/build-place-index.mjs` turns
  Natural Earth v5.1.2 (pinned commit, public domain) 1:50m countries and
  marine polygons into `src/data/place-index.json` (DP-simplified at 0.02°,
  0.01° delta-encoded, ~490 KiB); `src/core/geo/PlaceIndex.ts` does the
  point-in-polygon lookup (bbox prefilter; land, then the most specific
  water body; lake/river holes and border slivers → the country; coastal
  gaps → nearest water within 3°; Russia split at 60° E).
  `GeoLookupService` fetches the index once as a hashed `/assets/` file and
  takes an injectable `PlaceResolver`; its IndexedDB prefix is now
  `geo_v2_`, and BigDataCloud-era `geo_cell_` rows are pruned. Both
  BigDataCloud hosts left `connect-src`; Open-Meteo is unchanged.
- **Found on the way.** idb-keyval throws synchronously when IndexedDB does
  not exist; `_persistCell` let that turn a good answer into a failure (30 s
  backoff, HUD not updated). Guarded.
- **Tests.** `ConnectSrcCsp.test.ts`: `connect-src` must equal the external
  hosts in `src/` plus known redirect targets (it failed on the CSP before
  this change). `PlaceIndex.test.ts`: known answers, specificity, the Urals
  split, gap snapping, and a 0.5° sweep of the whole ISS band with no
  unnamed point. Geo service tests inject the resolver, and one runs the
  default resolver against the real index (only Open-Meteo is fetched).

## Follow flicker + Bloom frame rate (2026-10-25)

Measured on the live site with the owner's GPU (AMD Radeon integrated,
headless Edge on D3D11, 1280×713 CSS at DPR 1.5, Follow · Locked, daylight).

- **Flicker.** 74 of 794 frames dropped the station's mean luminance ~10%
  for one frame: the solar arrays went black. Not tied to shadow redraws.
  Cause: R3F runs equal priorities in subscription order, children first;
  `ISSModel` (child of `ISSGroup`) aimed the sun's shadow camera at the
  previous frame's station position. The cached map then sat offset by one
  frame's step, which varies 0–160 m (texel 68 m), so on uneven frames the
  thin arrays self-shadowed. Fix: `ISSGroup`'s `useFrame` at priority −2
  (`framePriority.ts`). After: 0 dark frames in 895 (same detector, uneven
  frame times from per-frame readback). Shadow redraws also fell from ~37 to
  4 per 8 s — the lagged attitude had jittered the joint angles past the
  0.15° redraw threshold. Test: `StationShadow.test.ts` (aligned at the
  current pose, >2 texels off one frame behind; priority order).
- **Frame rate.** Bloom on: 56.5 fps, 28 frames > 20 ms in 8 s; Bloom off:
  60. Timer queries: 18.5 GPU ms/frame — scene into the 4× MSAA HalfFloat
  target, a color+depth resolve, the bloom blend drawn back into that MSAA
  target, and a second resolve. `MultisampleRenderPass` renders only the
  scene multisampled (color-only resolve, `resolveDepthBuffer = false`) and
  copies once into single-sample composer targets. After: one resolve,
  16.6 GPU ms, 60.0 fps with 0 frames > 20 ms in all four Bloom/Shadows
  combinations. Test: `MultisampleRenderPass.test.ts` (contract only; no GL
  in unit tests).

## Live IGOAL outage: KTX2 transcoder vs CSP (2026-10-25)

- **Symptom (live only).** Locate waited the 8 s gate and flew to Model A;
  the "High fidelity" spinner never finished. `iss_igoal_locate.glb` and
  `/basis/*` all returned 200.
- **Cause.** Live console: four `EvalError`s ("'unsafe-eval' is not an
  allowed source"), one per KTX2Loader worker. three's Basis glue (embind,
  DYNAMIC_EXECUTION=1) generates invokers with `new Function`; blob: workers
  inherit the page CSP; the worker's init promise never resolves, so every
  texture task — and the GLTF parse, and the Suspense — stayed pending.
  `vite preview` sent no CSP, so it never reproduced locally.
- **Fix.** `scripts/patch-basis-transcoder.mjs` (`npm run patch:basis`)
  rewrites the two code-generation sites to closures (Emscripten's
  DYNAMIC_EXECUTION=0 shape); the CSP is unchanged. KTX2 texture loads are
  stall-guarded (30 s → load error). GLTFParser resolves a failed texture to
  null and still finishes the model, so detail preparation now fails any
  model with missing textures (`countMissingTextures`) → ladder → legacy,
  never a grey IGOAL. `vite preview` now serves the `vercel.json` catch-all
  headers.
- **Tests.** `BasisTranscoderCsp.test.ts` runs the glue in a V8 context with
  string code generation off: stock three fails, the shipped glue transcodes
  a real texture from the LOD bit-identically to stock, and `public/basis/`
  must equal the patched three copy. `LoadStallGuard.test.ts` covers the
  bound. Headless Edge against the CSP-enforcing preview: IGOAL at Follow,
  no spinner; with the stock glue swapped into `dist/`, the attempt fails at
  30 s and demotes to legacy.
- **Follow-up: version the transcoder.** After the deploy, a browser that had
  loaded the site in the previous hour still got the stock glue from its HTTP
  cache (`/basis/` was `max-age=3600, stale-while-revalidate=86400`, fixed
  file names). The KTX2Loader now has its own `LoadingManager` whose URL
  modifier appends `?v=<__BASIS_ID__>` (content hash of `public/basis/`,
  `vite.config.ts`) to the transcoder files only — never to the blob: texture
  URLs (`basisTranscoderUrl.ts`, tested). `/basis/` is now `immutable` like
  `/models`; `.gitattributes` pins the glue to LF so the id is identical on
  Windows and Vercel.

## Parked model items, re-opened (2026-10-25)

- **Rigid batching (plan 001 Phase D) landed.** `batchRigidMeshes` merges
  static geometry per (rigid part × module × material): 993 → 217 draw
  primitives on the full model, 438 → 176 on the LOD, 703 → 294 nodes; the
  files also shrank (full 24.2 MB, LOD 5.5 MB brotli). Joints and cameras
  turn exactly what they did (the rig simulation passes on the batched
  assets); mirrored parts keep their facing (unit test); identical-view
  renders differ only by sub-pixel edge shifts.
- **Attitude lag at 300× fixed.** The station's attitude slerped toward its
  LVLH target and trailed it by rate ÷ stiffness (~12° of pitch at 300×).
  `AttitudeFollower` now follows the target exactly and eases in only jumps
  (first capture, seek, TLE swap); the interpolator blends velocity like
  position so the target turns every frame instead of stepping at 10 Hz.
- **Hidden detail model's matrix updates**: measured 0.03 ms/frame on the
  batched assets (512 objects) — closed, no change.
- **Self-shadowing landed.** The sun light casts a 2048² PCF map fitted
  to a ±70 km box around the visible station (the light follows its target,
  aimed at the station each frame). The map is cached and redrawn only when
  the sun in the station frame or a joint moves 0.15° (≥ 50 ms, ≤ 2 s apart),
  about once every 2 s at 1×. Setting "Shadows", default on.
- **Re-reviewed, kept** (reasons in `docs/ISS_MODEL_CONTEXT.md` §9): the
  TRRJ law (daylight edge-on is the published autotrack; eclipse
  face-to-Earth is the freeze-protective pose), the radiator coating (the
  geometry already has the 8 panels per wing; real face sheets are uniform
  white), Canadarm2/ERA (no driveable ERA node; the arm's real pose is a
  per-operation park), meshopt (download would grow ≈ 9 MB).

## ISS animation audit (2026-10-25)

The rig was measured instead of eyeballed: the per-frame step moved out of
React into `ISSRigAnimator.ts`, the attitude into `stationAttitude.ts`, and
`ISSRigSimulation.test.ts` flies the published assets through real orbits.

- **Correct, now under test**: all eight wings keep their cell face (+Y,
  verified from the texture) on the sun through daylight at three seasons;
  the radiators run edge-on in daylight and face Earth in eclipse within the
  ±105° travel; model +X is forward (Node 2 ahead of Zvezda), +Z starboard
  (Columbus), Cupola nadir; every SARJ/TRRJ/BGA origin lies on its shaft.
- **Fixed**: the ELP/SHP camera pan nodes have authored origins 2.7 m / 4.5 m
  from their 0.5 m cameras, so the idle pan swung each camera ~0.3 m off its
  mount; sweeps now pivot on the part when the origin lies outside it, and
  turn about the part's own local axis (the old code wrote one Euler
  component).

## IGOAL source-material + KTX2 rebuild (2026-10-25)

With both NASA IGOAL sources available (the owner's `ISSTEST.zip`), the model
was analysed against them and rebuilt (`docs/ISS_MODEL_CONTEXT.md` §1):

- **Materials.** FBX2glTF had dropped all 38 metallic-roughness maps and put
  its Phong conversion (metallic 0.4 / roughness 0.272) on every material.
  The build now grafts the source GLB's authored materials by name (factors,
  metallic-roughness maps, the MLI and GEDI albedo the FBX lacks, normal
  strengths) and renders the genuine cutouts (ELC grating, iROSA hex panels)
  as MASK. The FBX is byte-identical to the audited source (`c3c43b9c…`).
- **Textures.** KTX2 / Basis ETC1S (`ktx create`, quality 255; on par with
  the WebP q80 they replace). Texture memory: full ~700 → ≤228 MiB, LOD ~97 →
  ~20 MiB; transcoding runs in workers. Transfer (brotli): full 16.5 → 25 MB,
  LOD 4.4 → 5.7 MB (the new metallic-roughness maps plus ETC1S overhead).
  Runtime: `KTX2Loader` on drei's `useGLTF`, transcoder in `public/basis/`.
- **LOD.** Derived from the high build's lossless master; normal and
  metallic-roughness maps at 256 px; 418 emptied leaf nodes removed (703 →
  285 nodes; every rig node kept).
- **Brightness.** Authored metalness is halved at build time
  (`SOURCE_METALLIC_SCALE`): at full value the array backs and truss went
  near-black in eclipse. Measured parity with the previous asset (mean lit
  luminance, app lighting: day 104 vs 106, eclipse 94 vs 101). Cutouts are
  single-sided (double-sided iROSA blankets z-fought into tan speckle).
- **Tried, not adopted:** an Earth-below / space-above PBR environment aimed
  at nadir — physically motivated, but daylight luminance fell to 79 and the
  array backs went black at night; `RoomEnvironment` stays.
- **Animation.** Only the visible detail model animates; joint state is
  handed to the next tier, so a swap mid-slew no longer snaps
  (`freshHandoff`). The SARJs stay uncapped by design (docs corrected).
- **Measured, not adopted:** meshopt + quantization (geometry memory 214 →
  113 MB, faster parse, but ≈ +9 MB transfer and a 50+ MB raw GLB in git).
- Tests: graft (incl. metallic scale, single-sided cutouts), KTX2 encode
  plan, published-asset material contract, `pruneEmptyLeaves`,
  `freshHandoff`.

## Improve-skill audit + waves 1–2 (2026-10-24/25)

A deep audit (six auditors, every finding re-read) produced plans 002–016;
the index with per-plan status and the rejected/deferred findings is
`plans/README.md`. Waves 1–2 (002–015) are landed.

| Plan | Title | Result |
|---|---|---|
| 002 | Fresh fallback TLE | Packaged `src/data/fallback-tle.json` has epoch 2026-10-24. |
| 003 | Toolchain, CI, Node 22 | Dev toolchain patched within its majors (vite `^6.4.5`, vitest `^4.1.12`, sharp `^0.35.5`); Node 22 via `.nvmrc`; actions pinned to SHAs, `persist-credentials: false`, full-tree `npm audit` step; `refresh-tle.yml` refreshes the fallback TLE Mon/Thu and commits it straight to `main` when `npm run verify` passes (changed 2026-10-25 from opening a PR, to avoid PR clutter). |
| 004 | Telemetry correctness | Offline-start recovery; confidence scored on \|age\|; clock clamp 100 → 1000 ms; `X-TLE-Stale` honoured (`fetchTLEWithStatus`); a cache bootstrap never replaces a network TLE; same-instant TLE blend; 16 KiB upstream body cap in `/api/tle`. |
| 005 | Geo correctness | Separate place/weather freshness, weather hidden after 1 h, local time null without a UTC offset, persisted rows validated (`isGeoSnapshot`). |
| 006 | Rendering correctness | Stable glint uniforms (fade and tint work again); detail preparation compiles the composer's shader variant (`detailPreparation.ts`); flare Earth mask off when Earth's centre is behind the camera; PMREM target disposed; `unavailable` stays terminal; no spurious legacy attempt on reselect. |
| 007 | Bloom MSAA | 4× MSAA on the bloom composer target (`COMPOSER_MSAA_SAMPLES`). |
| 008 | Signed Locate sweep | Close departures land on the planned standoff. |
| 009 | Known-answer tests | `OrbitalEngine` vs `satellite.js`, GMST vs `gstime`, formatters, `periodMsOf`, mode vocabulary, `ApiRateLimiter`; orbit-tape math extracted to `src/ui/clusters/orbitTapeMath.ts`. |
| 010 | HUD hygiene | Production crash screen without a stack; sentence-case HUD strings; dead constants removed. |
| 011 | Penumbra (roadmap D.1) | `SunVisibility.ts` (`sunVisibility`, `isSunlit`); continuous lighting via `eclipseLighting.ts`; the TRRJ law switches at the 0.5 edge. |
| 012 | Countdown (roadmap B.1) | `EclipseForecast.ts` (`forecastShadowTransition`, `ShadowForecaster`); store fields `sunlit` / `shadowTransitionInMs`; the line under the gauges reads "Daylight · sunset in mm:ss" / "Eclipse · sunrise in mm:ss". |
| 013 | Playwright smoke suite (roadmap A.3) | `tests/e2e/` (6 specs), `playwright.config.ts`, `npm run test:e2e`, CI `e2e` job. |
| 014 | Ground track on the HUD globe | `GroundTrack.ts` (`sampleGroundTrack`); dotted past, solid future. |
| 015 | Optional 3D ground track (B.2 + D.3) | `rendering/earth/GroundTrack.tsx` (setting "Ground track", default off) with a constant clip-space depth bias (`groundTrackDepth.ts`); supersedes D.3's options. |
| 016 | Docs pass | This pass: both errata banners folded into the text, drift fixed, waves 1–2 recorded. |

Verification snapshot (2026-10-25): `npm run verify` green with 397 unit
tests in 43 files; the `e2e` CI job runs the 6 smoke specs. Reviewer browser
checks (dev build, headless Chromium on SwiftShader): Locate reaches
`Follow · Locked`; the glint fades (opacity 0.077 at the Follow standoff);
Bloom-mode edges are antialiased; the countdown reads and counts down; the
mobile gauge gap is 10 px; the 3D track and footprint render with limb
occlusion; no console errors except an external BigDataCloud 400. No human
visual pass yet.

Known stale comment (`src/` was out of scope for the docs pass, so noted
rather than fixed): the `ISSModel.tsx` header comment's reliability ladder
omits the `locate` tier (the code: `high` loads `locate` first; a Locate-tier
failure demotes to `legacy`, then Model A).

## Earlier state (2026-10-23)

Both PRs are **merged**, in the required order (#14 then #15), with `verify`
and `npm audit` green on both merge commits:

| PR | Branch | Commits | Contents |
|---|---|---|---|
| [#14](https://github.com/slklnarnv/orbital/pull/14) | `feat/tier0-gains` | `f26f72a`, `c1bc242`, `013331e` | Tier 0 borrow pass (below) — merged `4d45d64` |
| [#15](https://github.com/slklnarnv/orbital/pull/15) | `fix/orbit-line-dashes` | `a75f8fe`, `4e5a335` | Orbit ring closure + dash phase (below) — merged `b314bac` |

**#15 was STACKED on #14.** It was branched from `feat/tier0-gains`, so its
diff against `main` carried all 25 files of #14 plus the orbit-line changes.
Merging in the order above landed each change through its own PR; merging
#15 alone would have landed #14's contents through the wrong one. That risk
is closed.

### Locate LOD + two-tier detail (2026-10-23)

The "slow Locate shows Model A, then swaps to IGOAL" report traced to the 8 s
departure gate: the full asset is 20.5 MB / 2.665M triangles, and 76% of those
triangles sit in `Details_*` greebles/handrails. Uniform simplification only
removed ~14% on this CAD-style mesh, so the fix is a derived Locate tier:

- **Build** (`scripts/build-iss-locate-lod.mjs`, `npm run build:iss-lod`):
  strip detail/handrail meshes except a silhouette keep-list (AMS, Bartolomeo,
  ELCs, MLM/ERA, Node3, batteries, Columbus, MBSU, Bishop), simplify kept
  geometry 0.3/0.03, resize textures to 512, Draco 12/8/10. Candidate-first
  validation (rig, WebP, finite geometry, truss span, budget), then publish.
- **Measured** `public/models/iss_igoal_locate.glb`: **5.27 MiB, 784k
  triangles, ~1.75M vertices, 240 mesh instances / 234 stored meshes, 73 WebP
  textures at 512 px, 703 nodes**. Full 703-node rig preserved (12 joints, 8
  oscillators, six attachment frames, `extras.orbitalRig`); truss span 108.294
  m vs high 108.293, so the normalization constants are shared. Decode ~0.2 s
  Draco + ~0.5 s WebP (Node measurement) versus ~3.6 s for high.
- **Runtime**: `DetailQuality` adds `locate`. `high` loads `locate` first for
  Locate/Follow; the full asset is requested only inside the 200/220 km
  `isClose` band (covers Inspect and close FREE views). The departure gate now
  waits for the first committed tier (`shouldAwaitDetail`), not the full
  asset. A high failure keeps the committed LOD; a LOD failure demotes to
  legacy. The committed LOD stays visible while high prepares.
- **Prefetch + caching**: a 5 s boot-idle, connection-gated bare `fetch` warms
  the LOD (not `useGLTF.preload`); `__BUILD_ID__` is now a hash of the
  versioned `.glb`/`.webp` bytes, so docs/code deploys no longer invalidate the
  model cache. A prepared-URL set skips re-preparing a URL on its committed
  remount.
- **Tests**: 246 total (14 lifecycle/gate, 5 LOD build/contract, 3 build-id
  determinism). `npm run verify` exit 0. The LOD passes
  `iss-model-manifest --check-only`; the high asset is unchanged.
- **Browser-verified 2026-10-23** (headless Chrome 156, live build
  `aecac83bf949`): a fresh load + Locate reached `Follow · Locked` and
  requested only `iss_igoal_locate.glb` (first fetch 4.80 MB / 2.4 s, later
  cache hit 49 ms); zooming to `Inspect · Locked` requested `iss_igoal.glb`
  once (17.95 MB / 7.4 s); no console errors. Remaining: a human visual pass on
  the swap/hitch and a throttled-network repeat; the first-draw hitch was not
  measured. KTX2/meshopt for the full asset (C.2) remains the decode/VRAM
  follow-up.


### Orbit line repair (2026-10-19, PR #15)

Two measured defects in `OrbitLine`, both on the dashed path:

- **The ring did not close — 214 km gap.** `generateOrbitPath` spanned ±½ of
  the NOMINAL `ISS_ORBITAL_PERIOD_MIN` (92.68 min) while the live element set
  runs 92.98 min, and `while (t <= end)` dropped the final partial step. First
  and last samples therefore sat 214 km apart (~11 px at the home view) at the
  station's antipode. `OrbitalEngine.periodMinutes` now exposes the live
  period from `satrec.no`; the predictor spreads exactly `steps` samples
  across it and ROUNDS the step, so a reboost or a slower vehicle cannot
  silently reopen the seam. After: 11–16 km, which is SGP4's own non-closure
  (an SGP4 orbit does not repeat bit-exactly), not a sampling shortfall.
- **The dash pattern slid every refresh.** `LineMaterial` keys the pattern on
  `instanceDistance`, measured from the arc's TRAILING edge — and that edge
  moves ~460 km per refresh because the arc is regenerated centred on the
  station. The pattern jumped ~1.8 pitches every `ORBIT_PATH_REFRESH_MS`, a
  visible shimmer. `dashOffset` now carries the trailing edge's ABSOLUTE
  position along the orbit, derived from the clock (not accumulated, so a seek
  cannot corrupt it); `vLineDistance + dashOffset` is then a fixed position on
  the ring.
  **Do not reduce that offset modulo the pitch.** The pitch changes every
  frame with the camera, and a remainder against a moving divisor shifts by
  `(phase / pitch) · Δpitch` — measured ~17 km of slide for a 0.3 km pitch
  change during a slow zoom. This was the first implementation and the
  browser check caught it.

`MAX_ORBIT_POINTS` moved into the predictor, which clamps to it, so the
fixed-size instance buffers cannot be overrun by a slower orbit.

Verification: `npm run verify` exit 0 (232 tests, lint 0 warnings, build).
Browser (dev server, dashed style): 186 segments, arc 42,719 km, ring gap
11.3 km, dash pitch 6.3 px at the home view; `dashOffset` advances across
refreshes (555.9 → 7666.5 after a 15 min seek) and holds within one.

### Tier 0 pass (2026-10-19, PR #14)

Five borrow items from the youreyesinspace comparison, no behaviour change to
the simulation:

- **C.6a — batched texture uploads.** `ISSModel.prepare()` now uploads until a
  6 ms per-frame budget is spent instead of yielding one frame per texture.
  Measured on this machine: 73 WebP textures, 178 ms of GL work (2.44 ms
  each); 73 frames → 30 frames. The GPU work is unchanged; only the yielding
  is removed. `TEXTURE_UPLOAD_BUDGET_MS` documents the budget.
- **D.2 — versioned immutable assets.** `vite.config.ts` defines
  `__BUILD_ID__` (an asset-content hash since 2026-10-23; commit SHA/timestamp
  fallback if the tree cannot be read); `assetUrl()` in
  `src/utils/assetUrl.ts` appends `?v=<id>` to the model, Earth-map and starmap
  URLs. `vercel.json` serves `/models` and `/textures` as
  `public, max-age=31536000, immutable`. `vitest.config.ts` defines the same
  constant so tests can import modules that build URLs.
  **`/draco` deliberately stays `max-age=3600`**: `useGLTF.setDecoderPath`
  builds its own URLs and never carries `?v=`, so `immutable` there would pin
  a stale decoder for a year after an upgrade. Caught in review of the
  deployed preview and fixed in `c1bc242`.
- **Hide-HUD toggle.** `H` toggles `.hud-hidden` on `<html>` via
  `src/hooks/useHudVisibility.ts`; CSS hides the scrim, frame, corners and
  camera cluster with `visibility` (layout stays intact). Not persisted — a
  reload restores the HUD. Typing contexts keep the letter.
- **D.6 (CSS half) — safe-area insets.** Every viewport-anchored cluster pads
  by `env(safe-area-inset-*)` through `max()`, so desktop spacing is the
  floor and a notched phone clears the hardware chrome. `index.html` gains
  `viewport-fit=cover` (without it `env()` reports zero on iOS).
- **D.5 — link metadata.** OG/Twitter tags in `index.html`, `robots.txt`,
  `sitemap.xml`, and a generated 1200×630 `public/og-image.png` (built from
  the project's own palette and fonts; no third-party artwork).
- **D.4 — licensing.** `LICENSE` (MIT), `NOTICE.md` (data, models, imagery,
  fonts, dependencies, trademarks) and `public/fonts/OFL.txt` for the two
  self-hosted OFL families.

Verification: `npm run verify` exit 0 (227 tests at the time, lint 0
warnings, build). Browser (production preview): assets request with `?v=`,
`/robots.txt`, `/sitemap.xml` and `/og-image.png` all 200; `og-image.png` is
1200×630;
`H` hides the HUD with the canvas still rendering; Locate reaches the flight
in ~1.4 s warm. Production baseline confirmed the old behaviour being fixed:
`https://orbitaliss.vercel.app/models/iss_igoal.glb` answered
`Cache-Control: public, max-age=3600, stale-while-revalidate=86400` with
`Content-Length: 20529892`.

Shipped as **PR #14** (`feat/tier0-gains`, commits `f26f72a` + `c1bc242` +
`013331e`). CI green: `verify` (40 s), `Vercel`, `Vercel Preview Comments`;
merge state CLEAN. **Merged 2026-10-23** as merge commit `4d45d64`, followed
immediately by the stacked #15 (`b314bac`).

### Prior state (2026-10-08, main @ `35ec297`)

Landed via PR #12 (`feat/hardening-and-gcdatlas-pass`) and the passes before it:

- **Tooling/CI**: ESLint + `verify` gate in GitHub Actions (verify + prod
  `npm audit`); test type-check via `tsconfig.test.json` (covers tests,
  scripts, both configs); dev middleware serving `/api/tle` through the real
  handler; `npm run refresh:tle`.
- **`/api/tle` guard**: query strings refused (cacheable 404), HEAD support,
  warm-instance memo + in-flight dedupe, stale-on-error (`X-TLE-Stale: 1`),
  upstream User-Agent.
- **Delivery**: CSP + baseline security headers, self-hosted fonts, fresh
  fallback TLE (epoch 2026-10-02).
- **Rendering**: DPR governor (`DprGovernor.ts` + `AdaptiveDpr`), PMREM
  rebuilt on `webglcontextrestored`, composer follows `viewport.dpr`, bloom/
  flare/output passes disposed on teardown, `RoomEnvironment` disposed,
  `EarthGroup` behind its own error boundary.
- **ISS model**: Nauka hull FIXED (baked dark `COLOR_0` vertex colours
  stripped at build time — the old "UV islands on black texels" diagnosis was
  wrong); BGA beta tilt on all 8 wings (targets computed in the LIVE SARJ
  parent frame, tracks through eclipse, 2°/sim-s + 12°/s wall-clock caps);
  asset rebuilt with a 12-joint embedded rig (backups:
  `.tmp-iss-build/iss_igoal_pre_nauka_backup.glb`,
  `iss_igoal_pre_bga_backup.glb`).
- **Lens flare**: compact halo (no full-screen veil), soft iris ghosts, aims
  at the drawn sun billboard (`SUN_BILLBOARD_DISTANCE_KM`) — parallax
  detachment fixed. Default OFF, requires Bloom.
- **Core/UI**: HUD scalars blend across TLE swaps, settings validated on
  rehydrate, geo IndexedDB pruning + hidden-tab fetch pause, roving-tabindex
  radio groups, popover Escape scoped + focus return, reduced-motion flights,
  south-pole altitude fix in `ecefToGeodetic`.
- **Bug found by new tests**: `|z|/sin(lat)` → negative altitude at the south
  pole; fixed to `z/sin(lat)` (`CoordinateConversions.test.ts`, 16 cases).

## Verification snapshot

- `npm run verify` green end-to-end: asset budget → shader ramps → typecheck
  (tests + scripts + configs) → lint (0 warnings) → unit tests (397 at
  2026-10-25) → build.
- CI green on PR #12 (ubuntu, Node 20) after guarding module-scope
  `navigator` reads (Node 20 has no global `navigator` — platform trap).
- Browser (dev server, built-in Chromium): 300× joint motion ≤0.36°/frame;
  flare lands exactly on the drawn sun; no console errors; no GPU leaks
  across 5 Bloom toggles and 6 model switches (geometry/texture/material
  counts unchanged).
- Perf baseline (AMD Radeon iGPU, ANGLE/D3D11, DPR 1): overview and 300×
  vsync-steady 60 fps; **close-up High-fidelity ISS is the only measurable
  cost** (~5% of frames at 30 fps). Bloom is free on this GPU. Full table:
  history §"Open-items pass".

## Open items

- **Phase D** (animation-safe rigid batching): LANDED 2026-10-25 —
  `batchRigidMeshes`, 993 → 217 draw primitives (full), 438 → 176 (LOD).
  Constraints and rollback asset if ever revisited: history
  §"Remaining work (not started)".
- **Investigate-first list and deferred majors**: see `plans/README.md`
  ("Deferred", "Investigate visually first") — attitude low-pass lag at 300×,
  orbit dash float32 precision in long accelerated sessions, 10 Hz Earth/sun
  stepping at 300×, hidden detail model matrix updates, prefetch vs
  first-paint on slow links; React 19 + R3F 9 + drei 10, three r18x,
  Vite 7/8, satellite.js 7.
- **Model A terminal-'unavailable' path**: implemented + unit-tested, but the
  live firing of `DefaultLoadingManager.onError` was never confirmed in a
  real browser. Verify only if that state ever matters.
- **Faster Locate on fresh load**: C.6a (texture-upload batching), C.6b (5 s
  boot-idle LOD warm) and the 2026-10-23 Locate LOD + two-tier detail LANDED.
  Follow-ups: browser-verify the LOD→high swap and the high-tier hitch at
  Inspect; KTX2/meshopt for the full asset via C.2 (decode/VRAM, not the LOD's
  cold-network path).
- **Features/engineering roadmap**: `docs/NEXT_STEPS.md` "Next (ranked)" and
  "Roadmap" sections are the ranked list. B.1 (countdown), B.2 (ground track)
  and A.3 (smoke suite) landed 2026-10-25; B.3 (next visible pass) is next.
- **youreyesinspace comparison** (2026-10-19): borrow list D.1-D.9 in
  `docs/NEXT_STEPS.md`. Landed in PR #14: D.2, D.4, D.5, and the CSS half of
  D.6. D.1 (penumbra) and D.3 (ground-track depth, solved with a constant
  clip-space bias) landed 2026-10-25 with plans 011 and 015. Still open: D.7,
  D.8, D.9.
- **Hide-HUD (`H`) and safe-area insets**: LANDED in PR #14 (the `H` toggle
  closes the "Hide-HUD toggle" quick win; the coarse-pointer hit-area block
  and the pinned render-scale override from D.6 are still open).
- **Orbit line, remaining polish**: the ring now closes and the dash is
  anchored to the orbit in the shader (017 V4), but two things are still
  unverified or open.
  (a) The `alphaCurve` fade was NOT re-tuned — the past trail still fades
  0 → 0.30 and the future arc holds 0.60; whether those read right against
  the now-closed ring is a visual call, not a measurement.
  (b) No test covers `refreshPath`'s buffer writes or the shader — the
  geometry is covered by the predictor test (span, closure, step, budget,
  alpha, centring) and the phase by `OrbitPhase.test.ts`. A headless test of the instance-buffer layout
  would need a GL context, so this stays a browser check.

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
