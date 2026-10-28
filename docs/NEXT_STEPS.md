# Next Steps - ORBITAL

> Front-door order: `CLAUDE.md` -> this file -> `plans/PROGRESS.md` (short
> ledger; history in `plans/PROGRESS-history.md`). Deep docs load on demand
> (see CLAUDE.md). Keep the Current state section fresh in the same commit as
> behavior changes - never ship an errata banner, fix the stale text instead.

## Current state (2026-10-28)

- **HUD tools, tour, sun and glint polish (2026-10-28)**, from the owner's
  live-site review:
  - *Tool row*: Passes, Modules and Settings sit together top right, each a
    line icon and a label (`ToolIcon.tsx`, `.hud-tool`); the bare gear and
    the mid-left Modules button are gone. Modules (and the new `M` key)
    works from anywhere: away from the station it Locates and the explorer
    opens on arrival (`moduleExplorerControl.ts`, `pendingOpenAt` in
    `explorerStore`, dropped after 90 s).
  - *Tour*: an eight-step guided tour (`src/ui/tour/`), offered once on the
    first visit after the loading screen (`orbital-tour-seen` in
    localStorage, failures read as unseen), replayable from About and the
    `?` overlay. A spotlight ring dims the rest; the card goes below, above
    or beside its control (`placeCard`). Modal overlay `'tour'`. The e2e
    fixture and the bench mark it seen.
  - *Glare aim*: the glare overlay was aimed in a priority-0 frame callback,
    before Locate/Reset flights set the camera's orientation, so mid-flight
    it sat up to 945 px from the sun ("the shiny ray moves down"). It is now
    aimed in `onBeforeRender` with the drawing camera (0 px measured).
  - *Sun*: a smaller blown core (~1.6x the disc), thinner, shorter spikes
    widening with distance, a lower peak and a neutral white tint; no amber
    veil.
  - *Station glints*: a highlight knee (`highlightKnee.ts`) rolls every
    station fragment off from 1.8 toward 2.3, under the 2.4 bloom threshold,
    so a flat panel at its mirror angle can no longer bloom into a white
    square. Shared materials and the explorer's highlight copies use one
    program key (no extra compile).
  - *Hide HUD* (`H`) now also hides the orbit line and the 3D ground track
    (`hudStore.ts`); HUD-aware framing stops reserving HUD space.
  - Radiators checked, no change: in daylight the TRRJ edge-on target moves
    only a few degrees at the current beta angle, and in eclipse it holds.

- **Wheel zoom while tracking fixed (2026-10-28)**: the station-locked carry
  (2026-10-26 scrub fix) re-set camera-controls' pose with
  `setLookAt(…, false)` every frame the clock ran, which also reset the end
  pose a smoothed dolly eases toward: in Follow/Inspect each wheel tick moved
  ~1% (ten ticks 352 → 328 km; found by the A.2 bench session).
  `carryControls` now carries both poses and keeps the user-control flags,
  like `rotateOrbit`. Test: a dolly under continuous carry reaches the same
  distance as without (~102 km); the old one-pose carry stalls above 300 km.

- **017 V2 8K Earth (2026-10-26)**: first paint keeps the 4K WebP maps;
  ~2.5 s later, on capable desktops (`MAX_TEXTURE_SIZE` ≥ 8192, fine
  pointer, no Save-Data, a GPU compressed format; `earthDetail.ts`) an 8K
  day map (KTX2 / Basis **UASTC**, 20.5 MiB) and 8K night lights (ETC1S,
  1.4 MiB) stream in, are uploaded at most 1 MiB per frame
  (`progressiveUpload.ts`: one-call uploads stalled 27–45 ms per map) and
  swap together; the 4K maps' GPU copies are then released. ETC1S was
  tried for the day map (4.1 MiB) but left 4×4 block halos along every
  coastline at orbital magnification. Sources are the NASA originals the 4K
  maps came from (identified by RMSE: Blue Marble NG July 2004 topo-bathy,
  Black Marble 2016), rebuilt by `npm run build:earth-8k` with pinned
  SHA-256. The KTX2 loader moved to `src/rendering/iss/ktx2Loader.ts`
  (shared). Captures: `docs/images/earth-8k-day.webp`,
  `earth-8k-night.webp`. Bench: `npm run bench -- --earth-8k on|off`
  measures the swap itself as `earth-8k-swap`; numbers in
  `docs/bench/README.md`.
- **A.2 bench harness (2026-10-26)**: `npm run bench` builds the app in bench
  mode (production bundle plus the `window.__orbital*` hooks, now exposed via
  `src/utils/debugHooks.ts` in dev and bench builds only), serves it with
  `vite preview` and drives installed Edge headless on the real GPU through
  overview, Follow, a Follow tape scrub, Inspect (full model settled) and an
  Inspect scrub, each with Bloom on and off. It reports fps, p50/p90/p99
  frame time, frames over 20 ms, GPU ms per frame and per pass (timer
  queries around framebuffer binds and blits) and tracked GPU memory, to
  JSON. It refuses to run while another process uses the GPU (Windows GPU
  engine counters) or the CPU (other processes at ≥ 15% of all cores:
  other agents' SwiftShader browsers never show on the GPU counters), and
  keeps checking during the run. Docs: `docs/bench/README.md`. **Baseline**
  (`docs/bench/baseline-2026-10-26.json`, Radeon 780M, 1920×1080 buffer, no
  contention): 59.9 fps and p99 ≤ 17.7 ms in all ten rows; GPU 9–11 ms at
  overview/Follow with Bloom, 15–16 ms in Inspect and scrubs (p99 19–21 ms:
  little headroom up close); Bloom off measures more GPU time than Bloom on
  (12.5 vs 9.2 ms at overview), not yet explained; six 4K maps are 256 of
  330 MiB of textures. Found while building it: **wheel zoom barely works while
  tracking with the clock running** (~1% per tick, ~19% when paused) — the
  station-frame carry's per-frame `setLookAt(…, false)` cancels each
  smoothed dolly (Next, item 0).
- **017 V3 the sun (2026-10-26)**: the sun now reads as the blinding sun
  seen from orbit instead of a bright star by the limb. A camera
  point-spread function in two scene layers, so Bloom on and off draw the
  same thing and Bloom off stays the direct pipeline: the billboard
  (`sun.frag`) draws the disc and a blown-out core ~2x its size through one
  soft knee (depth-tested, cut by Earth and the station), and a
  screen-space overlay (`SunGlare.ts`, `sunGlare.frag`, no depth test)
  draws the wide halo and faint six-blade spikes over everything. Both stay
  under the bloom threshold (2.0 + 0.35 x 1.04 < 2.4, a unit test), so the
  square artifact cannot return. The glare fades with the sun's apparent
  flux (`SunAppearance.ts`: the disc integrated through the atmosphere
  along each line of sight, reddening and dimming as it sinks into the
  limb), an occlusion query when the station hides the sun, and the
  exposure ratio; the camera now stops down only for a sun it actually
  sees. The atmosphere adds a forward-scattering sunrise band at the limb
  (red low down, gold, then white) while the sun is at or behind the limb,
  and the limb thread near the sun takes the grazing sunlight's hue. The
  lens flare stays off by default: it lost its halo (the glare draws it)
  and shares the glare's gate. GPU time (timer queries, integrated AMD,
  1920x1080, GPU shared with another process so provisional): overlay
  0.37 ms with Bloom on, 0.11–0.14 ms off, only while the sun is near the
  frame; billboard 0.01–0.03 ms; probe ~0; sunrise branch +0.01–0.02 ms.
  With the sun out of view, frames are pixel-identical to before in both
  pipelines (Earth, atmosphere, stars). Captures:
  `docs/images/sun-before-after.webp`. Owner sign-off against ISS
  photography is the remaining acceptance step.
- **017 X1 module explorer landed (2026-10-26)**: in Inspect and close
  Follow (a visible IGOAL tier), a "Modules" control on the left edge opens
  the explorer. Hover tints a module light blue, a click (or the module
  list, for keyboards) selects it and opens a card: name, agency, launch
  year, mass, history and purpose for 45 elements (`src/data/issModules.ts`,
  launch dates and masses from NASA's station assembly element pages, masses
  converted from the published pounds, "—" where NASA gives none).
  "Explode" moves the 39 hub-level parts out along their centroid vectors
  (×1.6 the distance, 1.4 s, eased) while every joint parks on its authored
  angle at the 12°/s wall-clock cap; "Assemble" reverses it and the SARJs
  glide back onto their sun target. "Focus camera" moves the tracked point
  onto the module and keeps the eye outside the (exploded) clearance sphere.
  Reduced motion jumps instead of animating. The module map is derived at
  runtime from the batch names (no GLB rebuild); legacy and Model A say
  "Not available on this model". Picking tests batches in bounding-sphere
  order and stops at the first sure hit, so a hover pick touches one to
  three of the 217 batches.
- **017 R1–R7 responsive display landed (2026-10-26)**: measured with a
  viewport audit at ten sizes (360×640 to 3440×1440, overview and Follow,
  headless Edge on the owner's GPU). Before → after:
  - landscape phones: HUD 77% (844×390) and 84% (740×360) of the height →
    26% and 28%. A `max-height: 500px` layout gives one compact bottom row
    (gauge values · clock + transport · place and coordinates) and a thin
    tape;
  - Follow: the station overlapped the clock at 360×640, 390×844, 844×390
    and 740×360 → clear at every size. `HudAwareFraming` shifts the
    projection (`camera.setViewOffset`, never the pose) so the tracked
    station centres in the band the HUD leaves free. It re-measures on
    resize, rotation, `H` and every second, and eases in and out. On
    desktop the shift is also on (76 px up at 1080p, clearing the clock). The
    lens flare adds the same offset, so it stays on the sun billboard;
  - text: six styles at 7–8.5 px → none below 9 px (clamp() floor tokens;
    the phone weather line is dropped, not shrunk);
  - touch: every control was under 44 px (Pause 23×15) → none under 44×44
    on coarse pointers. Hit areas grow by padding with negative margins, so
    the glyphs and layout keep their size. Touch tablets in portrait use
    the stacked composition;
  - QHD and up: whole clusters zoom (1.15/1.3/1.6/1.9 steps); ultrawide
    pulls them in to an 18:9 frame (280 px each side at 3440×1440);
  - render scale (D.6): a settings row (Auto, 100%, 75%, 50%) pins the pixel
    ratio and pauses the governor. The DPR-2 ceiling on coarse pointers was
    already in force (R3F default) and is now explicit.
  Guarded by `tests/e2e/viewport.spec.ts` (station check under `E2E_DEV=1`).
- **017 A1–A4 and P landed (2026-10-26): shortcuts, help overlay, focus,
  screen readers, About.** One registry (`src/ui/shortcuts/shortcutRegistry.ts`)
  drives the keys and the `?` overlay: `Space` pause, `1`–`4` rates, `0`
  live, `L` locate, `R` reset view, `H` HUD, `P` passes, `G` settings, `?`
  help, `Esc` closes. Nothing fires while typing (Escape excepted), with
  Ctrl/Cmd/Alt, or — for Space — on a control Space presses; letters match
  the typed character, with the physical key only on non-Latin layouts.
  Settings, Passes, Set time, About and the help overlay share one overlay
  system (`src/ui/overlay/`): one open at a time, keyboard opens move focus
  in, closing returns it to the trigger. Also a skip link, a text summary of
  the canvas (`aria-describedby`: place, daylight, countdown in whole
  minutes), a polite live region for settled camera modes and sunrise/sunset
  (silent at accelerated rates; the camera label is no longer a live region),
  and an About panel beside the wordmark (measured vs illustrative, credits
  from `NOTICE.md`, build id, link to the shortcuts). Contrast: `--hud-lo`
  measured 3.1:1 on space black; raised from 38% to 50% white (4.7:1, pinned
  by `HudContrast.test.ts`). Over the bright limb in Follow no HUD tone holds
  AA (worst pixel 1.6:1 under the TLE line, 1.9:1 under the eclipse line) —
  a scrim/legibility call, listed below. Reduced motion now also holds the
  glint pulse still and drops the flare's sweeping ghosts (halo kept). Edge
  on the owner's GPU: the smoke specs pass (11 run; Locate reached Follow ·
  Locked separately), including six new ones (overlay, rates, typing in the
  place search, focus return, About, a focus ring on every Tab stop).
- **017 I1 icon + manifest, I2 staged loading screen (2026-10-26)**: a new
  mark (an orbit ellipse brightening toward a station glint, `--hud-hi` on
  `--space`) replaces the cyan globe: `favicon.svg`, a 16/32/48 `.ico`, a
  180 px apple-touch-icon and `manifest.webmanifest` with 192/512 and a
  maskable 512 icon, plus `theme-color`. All generated by
  `npm run build:icons` (`scripts/build-icons.mjs`); CSP unchanged (all
  same-origin). The loading screen now reads three stages: data link
  (Connecting until the telemetry bootstrap settles, then the HUD's link
  label), Earth and station ("2 of 5 files" from three's loading manager,
  then "Ready"), over an overall file bar. A static copy in `index.html`
  paints before the bundle runs: on the same throttled network (12 Mbps,
  80 ms) first contentful paint went 840 → 520 ms and the 0.8 s blank page
  is gone. Reduced motion parks the glint at its icon position. The share
  image (`og-image.png`) is unchanged and waits on the name (I3).
- **017 V1 close-range clouds landed (2026-10-26)**: the cloud shell and the
  surface's cloud shadows now read one shared field,
  `src/rendering/shaders/cloudDensity.glsl`. Magnified texels (more than one
  pixel per texel, picked with `dFdx`/`dFdy`) are reconstructed with a cubic
  B-spline in four bilinear taps, which removes the texel blocks at 800 km
  and the staircase at 300 km; below ~3,500 km camera altitude a zero-mean,
  multiplicative 3D value-noise fBm (four octaves from 9 km, each faded out
  below ~8 px so it never shimmers) breaks up thin and mid density while
  dense cores and the large-scale field stay the real map. The shadow takes
  the same function with two octaves, rotated into the deck's frame, and
  lost its `fract()` seam. Captured at 800 km, 300 km and overview over the
  day side: no texel edges at 300 km, overview unchanged. Per-pass GPU timer
  queries on the integrated GPU (shared with other sessions, so provisional):
  cloud pass 0.69 → 0.71 ms at 300 km, 0.80 → 0.75 ms at 800 km, overview
  unchanged at ~0.48 ms; surface pass unchanged (~0.65–0.70 ms).
  Still open: V1.3, a higher-resolution source (with V2 / D.8).
- **017 V4 dashed orbit in the shader (2026-10-26)**: the dash is now
  computed in the line's fragment shader (`src/rendering/shaders/orbitDash.glsl`,
  material in `src/rendering/iss/orbitLineMaterial.ts`), keyed on each
  vertex's orbital phase (`src/core/orbital/OrbitPhase.ts`: revolutions of
  the mean motion at the vertex's epoch) and sized with screen-space
  derivatives: a power-of-two number of dashes per revolution chosen per
  fragment, neighbouring levels crossfaded. The per-frame dash sizing,
  `dashOffset` and dash-origin state are gone; `OrbitLine.tsx` went from
  361 to 192 lines. Measured with frame captures (fixed camera on the
  future arc): 0 px along-track shift after seeks of +61 s, +130 s and
  −70 s, an orbit-tape scrub, 1× and 18 sim-minutes at 300×. Pitch is now
  even along the whole arc: at Follow 250 km the old dash ran 16 → 7 px
  from the near to the far end, the new one 11–13 px (8–16 px across all
  overview and Follow captures; the octave crossfade sets that band).
  Dashed/Continuous links no new program;
  Bloom on and off both render it, and the pitch holds at DPR 2.
- **C.5 changelog and Dependabot (2026-10-26)**: `CHANGELOG.md` (Keep a
  Changelog, sections named by the date a change reached `main`, since every
  merge deploys and there are no version tags; PRs add lines under
  "Unreleased") covers the history back to the first commit, with PR links.
  `.github/dependabot.yml` opens weekly npm and GitHub Actions PRs: npm minor
  and patch bumps in one group, majors one per PR, a 7-day cooldown, and the
  deferred majors ignored (React/R3F/drei, three beyond r170.x, Vite and its
  React plugin, satellite.js, and `@types/node` past the Node 22 floor).
  Actions stay pinned to SHAs; Dependabot rewrites the SHA and its version
  comment.
- **Roadmap written (2026-10-26)**: `plans/017-display-visuals-polish-roadmap.md`
  covers responsive display, clouds, 8K textures, the sun, the dashed orbit
  code, icon/loading/name, accessibility and shortcuts, the info panel and
  the exploded module explorer, with measured evidence and acceptance checks.
- **Orbit-tape scrub in Follow/Inspect fixed (2026-10-26)**: recorded on the
  production build, a half-revolution scrub swung Earth's limb from the left
  edge to the bottom of the frame and turned the station against the camera:
  tracking held a fixed inertial offset while the station's Earth-facing
  frame turned, the station trailed the clock through 10 Hz snapshots
  (per-frame steps of 0–340 km at an even scrub rate) and its attitude eased
  after every seek. Tracking is now station-locked (`StationFrameCarry.ts`);
  a paused clock propagates exactly each frame and snaps the attitude;
  shadow redraws are capped while seeking. After: the limb holds its place
  and the ground flows beneath through the same scrub. Follow scrubs ran at
  60 fps before and after; Inspect scrubs (full model) were 44.5 fps with 57
  shadow redraws per 3.5 s — the cap halves the redraws; re-run on an idle
  GPU with `npm run bench` (A.2), the Inspect scrub holds 59.9 fps (the
  44.5 was the busy GPU).
- **B.3 visible passes landed (2026-10-26)**: a "Passes" control beside the
  settings gear. The observer comes from an offline city search (Natural
  Earth 10m populated places, `src/data/city-index.json`, 7,342 places,
  ~150 KiB gzip, loaded on the first search; accent-folded via
  `normalizeQuery`), typed coordinates, or browser geolocation
  (`Permissions-Policy` now `geolocation=(self)`), and is kept in
  localStorage only. `PassPredictor.ts` scans 48 h of simulation time at
  30 s for ISS > 10°, sunlit, and Sun < −6° at the observer, bisects the
  edges to 1 s and runs in a module worker (`passes.worker.ts`; main-thread
  fallback). It matches Skyfield on 8 passes over 4 cities to 4 s and 1°
  (known-answer tests). "Watch" seeks 30 s before a pass and plays at 1×.
  Also fixed on phones: popovers no longer lose their fine text (a ≤900 px
  rule hid every `.hud-fine` in the top-right corner, including the model
  hints), and the Passes + settings row sits under the camera reticle
  instead of overlapping its mode label.
- **README rewritten (2026-10-25)**: about 40% shorter, with a primer on
  what the view shows (TLE and SGP4, GMST and the westward drift, eclipse,
  LVLH attitude, the 1,000× scale), a Mermaid pipeline diagram and four
  screenshots in `docs/images/` captured on the live site with a real GPU.
  The camera and model detail it dropped lives in `docs/HANDOFF.md` and
  `docs/ISS_MODEL_CONTEXT.md`. `NOTICE.md` now lists the Basis transcoder.
- **Follow flicker and Bloom frame rate fixed (2026-10-25)**: measured on
  the live site on the owner's integrated AMD GPU (headless Edge, D3D11,
  1280×713 at DPR 1.5). Flicker: ~9% of frames turned the solar arrays black
  for one frame — `ISSModel` (a child of `ISSGroup`) aimed the cached
  self-shadow at the previous frame's pose, and the 0–160 m per-frame step
  is over two 68 m shadow texels. `ISSGroup` now runs at `useFrame`
  priority −2 (`src/rendering/framePriority.ts`): 0 dark frames in 895,
  and shadow redraws fell from ~4.6/s to the designed one per 2 s. Frame
  rate: Bloom cost 18.5 GPU ms/frame (56.5 fps, 6% of frames at 33 ms)
  because the bloom blend wrote back into the 4× MSAA HalfFloat target and
  three resolved it twice with depth. `MultisampleRenderPass` keeps MSAA to
  the scene pass (color-only resolve); 60.0 fps, p99 17.2 ms, in all four
  Bloom/Shadows combinations. Bloom off is untouched.
- **Live IGOAL outage fixed (2026-10-25)**: after PRs #20/#21 the live site
  never showed the close-range model — Locate waited 8 s and flew to Model A,
  and "High fidelity" spun forever. Cause, from the live console: three's
  Basis transcoder glue calls `new Function`, the CSP has no `'unsafe-eval'`,
  so all four KTX2 workers threw `EvalError` at init and never answered.
  `public/basis/basis_transcoder.js` is now generated CSP-safe by
  `npm run patch:basis`; KTX2 texture loads fail after 30 s instead of
  hanging, and a model with any failed texture demotes to legacy instead of
  rendering grey; `vite preview` serves the production headers. Verified in
  headless Edge against the CSP-enforcing preview (IGOAL at Follow; the stock
  transcoder demotes to legacy). Follow-up: the transcoder URLs carry a
  content hash (`?v=<__BASIS_ID__>`) and `/basis/` is served immutable —
  browsers that had cached the stock glue (`max-age=3600` + SWR) kept running
  it after the deploy. Details:
  `docs/ISS_MODEL_CONTEXT.md` §1.
- **Place names offline (2026-10-25)**: the live console showed every
  "Passing over" lookup blocked by `connect-src` (BigDataCloud's host now
  redirects to `api-bdc.io`), and BigDataCloud's fair-use policy allows its
  free client endpoint only for the calling device's own location — never
  the ISS ground point. Place names now come from a Natural Earth 1:50m
  index looked up locally (`PlaceIndex.ts`, `src/data/place-index.json`,
  ~490 KiB / ~170 KiB gzip, fetched once as a hashed asset); BigDataCloud
  and both its hosts are gone from code and CSP. `ConnectSrcCsp.test.ts`
  keeps `connect-src` equal to the hosts `src/` fetches; `PlaceIndex.test.ts`
  requires every point of the ISS band to resolve. The geo cache also no
  longer fails a good lookup when IndexedDB is missing entirely.
- **Gate green**: `npm run verify` — asset budget, shader ramps, typecheck,
  lint (0 warnings), 490 unit tests in 56 files, production build. CI
  (`.github/workflows/verify.yml`) runs `verify`, both `npm audit` passes and
  an advisory `e2e` job (`npm run test:e2e`, 6 Playwright smoke specs against
  `vite preview`; not a required check — `verify` is the merge gate). Node 22 (`.nvmrc`).
- **Improve-skill audit, waves 1-2 landed 2026-10-24/25** (plans 002-015; the
  index is `plans/README.md`, the per-plan results are in `plans/PROGRESS.md`):
  - *Data and toolchain.* The packaged fallback TLE has epoch 2026-10-24, and
    `.github/workflows/refresh-tle.yml` refreshes it Mon/Thu and, when it
    changed and `npm run verify` passes, commits it straight to `main` (no PR;
    Vercel deploys it). The dev toolchain is patched within its majors; CI actions are
    pinned to SHAs with `persist-credentials: false`.
  - *Telemetry.* Offline starts recover on reconnect; confidence is scored on
    the magnitude of the TLE age; the clock clamp is 1000 ms per tick (it was
    100, which dropped accelerated time on slow ticks); `X-TLE-Stale` is
    honoured; a cache bootstrap never replaces a network TLE; TLE swaps blend
    from the old set at the same instant; `/api/tle` caps upstream bodies at
    16 KiB.
  - *Geo.* Place and weather freshness are tracked separately, weather is
    hidden after 1 h, the local time is null (never another cell's clock) without a UTC offset, and
    persisted rows are validated (`isGeoSnapshot`).
  - *Rendering.* Stable glint uniforms (the fade and tint work again); detail
    preparation compiles the composer's shader variant; the flare's Earth mask
    is off when Earth's centre is behind the camera; the PMREM target is
    disposed; 4x MSAA on the bloom composer target; the Locate sweep angle is
    signed, so close departures land on the planned standoff.
  - *Tests and hygiene.* Known-answer tests for `OrbitalEngine` vs raw
    `satellite.js`, GMST vs `gstime`, formatters, `periodMsOf`, the mode
    vocabulary and `ApiRateLimiter`; orbit-tape math lives in
    `src/ui/clusters/orbitTapeMath.ts`; the production crash screen shows no
    stack; HUD strings are sentence case.
- **Features landed**: **D.1** penumbra (`src/core/orbital/SunVisibility.ts`;
  lighting follows `sunVisibility` through `eclipseLighting.ts`; the TRRJ law
  switches at the 0.5 edge). **B.1** day/night countdown
  (`src/core/orbital/EclipseForecast.ts`; store fields `sunlit` and
  `shadowTransitionInMs`; the line under the gauges reads "Daylight · sunset in
  mm:ss" or "Eclipse · sunrise in mm:ss"). **A.3** Playwright smoke suite.
  **B.2** ground track (`src/core/orbital/GroundTrack.ts`; the HUD globe draws
  it dotted behind the station and solid ahead; an optional 3D track and
  visibility footprint behind the "Ground track" setting, default off, with a
  constant clip-space depth bias) — this also supersedes D.3's options.
- **Reviewer browser checks (dev build, headless Chromium on SwiftShader)**:
  Locate reaches `Follow · Locked`; the glint fades (opacity 0.077 at the
  Follow standoff); Bloom-mode edges are antialiased; the countdown reads and
  counts down; the mobile gauge gap is 10 px; the 3D track and footprint
  render with limb occlusion; the only console error then was an external
  BigDataCloud 400 (gone: place names are offline now). No human visual pass
  yet.
- **IGOAL rebuild from both sources (2026-10-25)**: the authored PBR
  materials are grafted from the source GLB (38 metallic-roughness maps, MLI
  and GEDI albedo, cutouts); every model texture is KTX2 / ETC1S (texture
  memory ~700 → ≤228 MiB full, ~97 → ~20 MiB LOD); authored metalness halved
  for brightness parity; the joint state carries across the LOD ⇄ full swap. Details:
  `plans/PROGRESS.md`, `docs/ISS_MODEL_CONTEXT.md` §1.
- **Parked model items, re-opened (2026-10-25)**: rigid batching landed
  (993 → 217 draw primitives full, 438 → 176 LOD); the station attitude
  follows its LVLH target with no lag at 300×; station self-shadowing from
  the sun ("Shadows" setting, default on; cached 2048² map redrawn only
  when the sun or a joint moves 0.15°). TRRJ law, radiator texture,
  Canadarm2/ERA and meshopt were re-reviewed and kept as they are, with
  reasons in `docs/ISS_MODEL_CONTEXT.md` §9.
- **Locate LOD + two-tier detail (2026-10-23)**: Locate/Follow load
  `iss_igoal_locate.glb` (now 6.20 MiB, 787k triangles, 176 draw primitives,
  full rig); the full 27.1 MiB `iss_igoal.glb` (217 draw primitives) loads only
  inside the 200/220 km Inspect band;
  `__BUILD_ID__` is an asset-content hash. Earlier the same week: PRs #14
  (texture-upload batching, immutable versioned assets, `H` HUD toggle,
  safe-area insets, OG metadata, LICENSE/NOTICE) and #15 (orbit-ring closure,
  clock-phased dashes). Details: `plans/PROGRESS.md`.

## Next (ranked)

The display, visuals and polish roadmap is **`plans/017-display-visuals-polish-roadmap.md`**
(2026-10-26: viewport audit at nine sizes, sun/cloud/orbit captures, code
read). Its order, merged with the older items:

1. ~~**017 R1–R7 — responsive display.**~~ Landed 2026-10-26 (see Current
   state). Follow-up only if wanted: a real-device pass on iOS Safari
   (address-bar collapse with `100dvh`, notch insets in landscape).
2. **017 V1 — close-range clouds**: V1.1 (bicubic reconstruction) and V1.2
   (altitude-faded detail) landed 2026-10-26; V1.3, a higher-resolution
   cloud source, waits for V2 / D.8.
3. **017 A1 + P** — shortcuts, help overlay and About landed 2026-10-26.
   Follow-up from A4: HUD text over the bright daylight limb (Follow) falls
   to ~1.6:1 at worst; any fix — a stronger scrim or a faint text shadow
   (removed earlier by request) — is a design call.
4. **017 I3 — the name** (owner's call). With it, refresh `og-image.png`
   (ALL CAPS wordmark, blue limb, no new mark); I1/I2 landed 2026-10-26.
5. **017 V3** — the sun landed 2026-10-26 (round glare, limb fade and
   reddening, sunrise band) and was toned down 2026-10-28 after the owner
   found it overdone; it awaits the owner's side-by-side with ISS
   photography at the limb.
6. Standing human visual pass: a human look at the rebuilt
   materials at Follow and Inspect, day and night, on a real GPU (MLI
   blankets, ELC grating, iROSA wings, night legibility). Then a human
   visual pass on the penumbra fade at a terminator crossing (300x), the
   countdown, the ground track (HUD globe and the 3D setting) and the Bloom
   MSAA edges; on a throttled connection, Locate departs with the detailed LOD
   (not the schematic) at Follow and the full model appears only below 200 km.
7. A.2 leftovers: the flare and 300× rows, the leak check, and why Bloom
   off costs more GPU time than on. 017 V2 landed 2026-10-26; beyond 8K is
   D.8 (GIBS tiles).
8. Deferred majors (React 19 + R3F 9 + drei 10, three r18x, Vite 7/8,
   satellite.js 7); D.7 save-frame, D.8 GIBS tiles, B.4–B.8. **017 X1**
   follow-ups if wanted: per-truss-segment entries (P4–P6 and S4–S6 are one
   batch each, so splitting them needs a batching change in
   `build-iss-model.mjs`), masses for the elements NASA's pages omit.
   B.3 follow-ups if wanted: an observer marker on the globe, pass
   magnitude.

## Roadmap (2026-10-04, after the gcdatlas comparison)

Each item has a minimal first cut: the smallest version that ships value and
can be extended. "Touches" lists the files expected to change.

### A. Close-out (before new features)

1. **Commit + preview deploy.** Split the uncommitted work into tooling /
   API / rendering / UI commits; deploy a Vercel preview. Check: no CSP
   violations in the console; `/api/tle` 200 with `Vercel-CDN-Cache-Control`,
   `/api/tle?x=1` 404, HEAD 200 empty.
2. **Measured perf run** (item 0 below). Matrix: Follow / orbital /
   planetary × Bloom on/off × flare on/off × model quality, plus 300×.
   Record p50/p95/p99 and `renderer.info.memory` after 5 Bloom toggles and
   3 model switches (leak check). Table goes in PROGRESS before any cut.
   **Harness LANDED 2026-10-26** (`npm run bench`, `docs/bench/README.md`):
   overview / Follow / Follow scrub / Inspect / Inspect scrub × Bloom on/off,
   fps and p50/p90/p99, GPU ms per pass, tracked GPU memory, with a GPU and
   CPU contention guard; baseline `docs/bench/baseline-2026-10-26.json`.
   Still open: the flare and 300× rows, and the leak check.
3. **Browser smoke suite (Playwright).** LANDED 2026-10-25 (plan 013):
   `tests/e2e/smoke.spec.ts` + `fixtures.ts`, `playwright.config.ts`, Chromium
   on software WebGL against `vite preview` with the network stubbed, `npm run
   test:e2e`, and an `e2e` CI job after `verify`. Six specs: boots clean;
   Locate reaches "Follow · Locked"; Space toggles pause; `H` hides the HUD;
   settings survive reload; a TLE failure degrades to Cached, Recovery or
   Fallback. A 390x844 mobile case is still open (C.3).
4. **Unit tests for untested frame-math modules.** LANDED (plans 009 and
   earlier): `CoordinateConversions` (equinox and solstice sun directions,
   ECEF round trip), `OrbitalEngine` vs raw `satellite.js`, GMST vs `gstime`,
   `SimulationTime`.

### B. Features

1. **Orbital day/night + countdown.** LANDED 2026-10-25 (plan 012), on the
   penumbra model of D.1 rather than the cylinder test originally specified:
   `forecastShadowTransition` steps forward at 10 s and bisects the flip to
   1 s, and `ShadowForecaster` recomputes only per element set, on a seek, or
   at the cached transition. The HUD line sits under the gauges. Still open:
   tint the orbit line's shadowed span (the optional second cut).
2. **Ground track + footprint.** LANDED 2026-10-25 (plans 014 and 015).
   `sampleGroundTrack` samples +/- half an orbit (about 186 points at 30 s
   steps, refreshed every 60 s) on the HUD globe (dotted past, solid future)
   and, behind the "Ground track" setting (default off), as a line at
   R + 2 km plus a 64-segment footprint ring on the 3D globe. The original
   note stands as the reason for the depth design: at `near = 1 km` and 24-bit
   depth the smallest resolvable gap is 20.7 km from the home view and 11.1 km
   from orbital altitude (14 m at close range), so a 2 km offset alone
   z-fights. What landed (see D.3) is a constant clip-space depth bias, not
   `depthTest: false`.
3. **Next visible pass.** Observer from a typed lat/lon or a city search
   (default), with optional browser geolocation (needs `Permissions-Policy`
   `geolocation=(self)`). Scan 48 h at 30 s with `satellite.ecfToLookAngles`;
   a pass is visible when elevation > 10°, the ISS is sunlit (B.1) and the sun
   is below −6° at the observer. Run in a Web Worker. Observer location kept in
   localStorage only, never sent anywhere. Panel: rise/max/set times, max
   elevation, "Jump to pass" (uses the existing seek). **Landed 2026-10-26**
   (`PassPredictor.ts`, `PassesPanel.tsx`); city search is offline.
4. **Share links.** `#t=<epochMs>&m=<mode>&q=<quality>`; parse with a
   whitelist for enums and clamp for numbers (same rule as the settings
   sanitizer). Write the hash at most once a second; apply once on load.
5. **More stations.** Generalise `ISSEntity` into a config-driven entity;
   `/api/tle?id=` stays refused, add `/api/tle/<name>` routes from a fixed map
   (`iss`, `css`, `hst`). Start with CSS as a second marker and orbit line, no
   detailed model.
6. **Reboost detection.** On a TLE swap, compare mean motion and the
   propagated altitude at the same instant; above a threshold (≈0.3 km), emit
   a `TELEMETRY_EVENT` and show a toast "Reboost detected, +0.8 km".
7. **"What's real" panel.** Static content in the planned Info/About popover:
   measured (position, TLE age, sun, terminator) vs illustrative (attitude
   details, joint angles, clouds, flare, glint). One table, no new logic.
8. **Ground observer view.** Camera mode at an observer's ECEF position
   looking up, horizon mask, ISS as a bright point. Depends on B.3 for the
   observer. Large; only after B.1–B.3.

### C. Engineering

1. **Offline / PWA.** `vite-plugin-pwa` with precache for the app shell +
   textures + the fallback model, runtime cache (network-first) for
   `/api/tle`; manifest + icons. The OFFLINE mode already exists.
2. **Bundle + textures.** `React.lazy` the postprocessing chain and the IGOAL
   pipeline; convert Earth textures to KTX2/Basis (`ktx create`; the ISS
   models already are, see `encodeTexturesKtx2`) with a WebP fallback.
   Measure first (C.2 follows A.2's numbers).
3. **Mobile.** Check pinch, two-finger slide, lifting one finger mid-gesture,
   portrait HUD; fix what breaks. Add a 390×844 case to the Playwright suite.
4. **Accessibility.** `aria-live="polite"` region announcing the place below
   (at most once per minute), a `?` shortcut-help overlay, the remaining
   `L` / `R` shortcuts (item 2; `H` shipped as the HUD toggle in PR #14),
   a high-contrast HUD class.
5. **Release routine.** Scheduled CI job running `npm run refresh:tle`:
   LANDED (`refresh-tle.yml`, Mon/Thu, verify-gated, commits directly to
   `main`). `CHANGELOG.md` and `.github/dependabot.yml`: LANDED 2026-10-26.
6. **Faster Locate (fresh load).** Locate is a primary feature. A cold session
   used to wait for the full high pipeline, and on a slow connection the 8 s
   departure gate expired, so the camera departed on Model A and swapped
   mid-flight. **LANDED 2026-10-23: the Locate LOD + two-tier detail.**
   Locate/Follow now fetches `iss_igoal_locate.glb` (5.27 MiB, 784k triangles,
   512 px textures) instead of the 20.5 MB full asset; `iss_igoal.glb` loads
   only inside the 200/220 km Inspect band, where its fine detail resolves.
   Measured LOD chain: ~0.2 s Draco + ~0.5 s WebP decode (Node; browser similar)
   + GPU preparation, versus ~3.6 s of CPU decode for the full asset. The LOD
   fits the 8 s gate at roughly 5–8 Mbps; the full asset needs ~25–50 Mbps.

   Remaining cuts:
   a. **Batch the texture uploads** on a per-frame time budget (~6 ms/frame)
      instead of one texture per frame. **LANDED 2026-10-19 (PR #14).**
      Measured: 73 WebP textures, 178 ms of GL work (2.44 ms each); 73 frames
      → 30 frames.
   b. **Warm the network fetch** after boot idle (~5 s) and on Locate
      hover/focus, into the HTTP cache, connection-gated (skip
      `saveData`/2G), silent failure, once per session; deliberately a bare
      `fetch`, NOT `useGLTF.preload` (a failed preload maps to the terminal
      "ISS unavailable" state). **LANDED 2026-10-23 for the LOD**: hover/focus
      already starts the first tier, and a 5 s boot-idle warm was added. The
      full high model is NOT prefetched — it loads at Inspect.
   c. Decode/VRAM cost. **KTX2/Basis textures LANDED 2026-10-25** for both
      model tiers. Meshopt + quantization instead of Draco was measured and not
      adopted (`docs/ISS_MODEL_CONTEXT.md` §9.4: half the geometry memory,
      but ≈ +9 MB transfer and a 50+ MB raw GLB in git).

Suggested order now: A.2 → C.2 (B.3 landed 2026-10-26; A.3, B.1 and B.2 landed 2026-10-25;
C.6a/C.6b and the Locate LOD landed 2026-10-23; C.2 remains for the
full-asset decode/VRAM path).

## Reference comparison - berkcomba/youreyesinspace (2026-10-19)

Read-only pass; no application code changed. Analysed the full `src/` tree
(~23k lines), README/NOTICE, shaders, data tables, Docker/nginx/CI and the
deploy scripts at `github.com/berkcomba/youreyesinspace` ("Your Eyes In
Space", MIT code, BigBrains product).

**Different products.** Theirs is a Space-Engine-style universe explorer:
13.8 Gpc of catalogue + procedural universe, five languages, narrated tours,
an Academy, a Lambert-solver mission planner. ORBITAL is one object done
properly: live TLE -> SGP4 -> a real ISS with articulated joints. Most of
their feature surface is not addressable from here, and several ORBITAL
"advantages" below are consequences of the narrower scope, not better
engineering. Items marked **(architectural)** would hold at any scope.

### Where ORBITAL is genuinely stronger (do not regress)

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

### Genuinely borrowable - ranked

Status roll-up (2026-10-25): **D.1, D.2, D.4, D.5 landed; D.3 superseded;
D.6 landed for the CSS half.** D.2, D.4, D.5 and D.6's CSS half shipped in
PR #14 together with C.6a; D.1 and D.3 shipped with plans 011 and 015. Still
open: D.7, D.8, D.9, plus the coarse-pointer and render-scale halves of D.6.

#### D.1 - Penumbra instead of a binary eclipse test - LANDED 2026-10-24/25 (plan 011)

**Problem (as of 2026-10-19, now fixed):** their `common.glsl` `sphereShadow`
smoothsteps over the occluder's angular radius +/- the sun's angular radius,
so a shadow edge is a gradient. Ours was binary in three places
(`ISSModel.tsx`, `ISSAnimations.tsx` and `trrjTargetAngle`'s `sunlit`
boolean). The Sun's angular radius is 0.266 deg, so the real penumbra at the
station is `2 * 6,779 km * 0.00465 rad ≈ 63 km` wide — roughly 8 s of flight —
and the binary test collapsed that into one frame that switched a 2.3x
key-light boost, ambient 0.24 -> 0.42, the earthshine key light and the glint
colour.

**Landed:** `sunVisibility(positionKm, sunDir)` in `src/core/orbital/
SunVisibility.ts` returns the visible fraction of the solar disc in [0, 1]
(circular-segment area across the penumbra); `isSunlit` is `>= 0.5`, which is
exactly the old cylinder edge. `ISSModel.tsx` feeds `1 - sunVisibility`
through `eclipseLighting()` (`src/rendering/iss/eclipseLighting.ts`; the
endpoints reproduce the old sunlit and eclipse values) and the glint tint;
`ISSAnimations.tsx` calls `isSunlit` for the TRRJ law, so joint behaviour is
unchanged. B.1's countdown bisects the same 0.5 crossing.

#### D.2 - Build-id-versioned, immutable static assets - LANDED 2026-10-19

**Problem (as of 2026-10-19, now fixed):** `vercel.json` served `/models/*`
and `/textures/*` with `max-age=3600, stale-while-revalidate=86400`, so the
20.5 MB `iss_igoal.glb` revalidated every hour per user; the 4K Earth maps
did too. Confirmed against production: `/models/iss_igoal.glb` answered
`max-age=3600` with `Content-Length: 20529892`. Their `vite.config.ts`
defines `__BUILD_ID__`, every non-content-hashed URL carries `?v=<id>`, and
nginx sends `immutable` for a year - a deploy still busts it.

First cut: `define: { __BUILD_ID__ }` in `vite.config.ts` (a content hash of
the versioned `.glb`/`.webp` files under `/models` + `/textures`, falling back
to the commit SHA/timestamp if the tree cannot be read); append
`?v=${__BUILD_ID__}` to the model URLs in `ISSModel.tsx` / `modelUrls.ts` and
the four Earth maps + starmap in `EarthConstants.ts` / `EnvironmentLayer.tsx`;
flip `/models` and `/textures` to `public, max-age=31536000, immutable`. **Do NOT flip `/draco`**:
`useGLTF.setDecoderPath('/draco/')` builds its own URLs and never carries
`?v=`, so `immutable` there would pin a stale decoder for a year after any
upgrade. It stays `max-age=3600`.

Watch: drei's `useGLTF` caches by URL, so a new id means one re-download when
the assets actually change (intended); a docs/code-only deploy keeps the id
stable. `FALLBACK_URL_PATTERN` is a substring regex and still matches with the
query string. `check-asset-budget.mjs` reads disk paths and is unaffected.

**Landed (PR #14).** `src/utils/assetUrl.ts` + `src/types/build.d.ts`; the
`/draco` exception above was caught reviewing the deployed preview and fixed
in `c1bc242`. A test importing `EarthConstants` failed until
`vitest.config.ts` mirrored the `__BUILD_ID__` define — vitest does not read
`vite.config.ts`. **2026-10-23:** the id moved from the commit SHA to the
asset-content hash, so docs/code deploys no longer invalidate the 20.5 MB
model or the Locate LOD.

Touches: `vite.config.ts`, `ISSModel.tsx`, `EarthConstants.ts`,
`EnvironmentLayer.tsx`, `vercel.json`, the global type declaration.
Check: `npm run verify`; a preview deploy shows `?v=` in the network panel
and `immutable` on the response; a reload serves from disk cache.
Cost: under an hour.

#### D.3 - Fix the ground-track depth budget before implementing B.2 - SUPERSEDED (landed with B.2, plan 015)

B.2 specifies `r = R_earth + 2 km` in the EarthGroup frame. With the current
camera (`near = 1 km`, `far = 2,000,000 km`, 24-bit depth) the smallest
resolvable depth gap is `z^2 * (far - near) / (far * near * 2^24)`, so at a
ground distance of 18,629 km (the 25,000 km home view) it is 20.7 km; at
13,629 km it is 11.1 km; at the station's ~478 km ground distance it is
14 m. A 2 km offset is therefore fine at close range but z-fights from
orbital altitude — where the track is most useful.

They set `logarithmicDepthBuffer: true` with `near = 1 m`, `far = 1e13 km`,
which removes the problem - but they need it for a 10^13 km scene; we do not.
**What landed instead:** none of options a-c below. The track's vertex shader
pulls clip-space depth toward the camera by a constant NDC amount
(`GROUND_TRACK_DEPTH_BIAS_NDC = 4e-7`, about 3 ulps of a 24-bit buffer, in
`src/rendering/earth/groundTrackDepth.ts`). The world-space pull grows with
the square of the view distance (about 70 km at the home view, 37 km at
13,600 km, 0.05 km at Follow range), so the track wins against the globe it
sits on at every zoom, while real depth testing still lets the limb hide the
far side and the station occlude the track. Option (a) would have drawn the
track over the ISS model at close range.

Options considered, cheapest first (history):

a. Draw the track in a second pass with `depthTest: false` and an analytic
   Earth-horizon discard in the fragment shader (keeps limb occlusion, no
   global change). Was recommended; replaced by the bias above.
b. Raise the offset to ~40 km and accept a floating track at close range -
   visibly wrong at INSPECT range. Not recommended.
c. Adopt `logarithmicDepthBuffer` - every custom shader needs the
   `logdepthbuf_*` chunks and the bloom-off parity contract must be
   re-verified. Only if other depth artifacts appear.

Check used for the landed version: at 25,000 / 13,600 km camera
Earth-centre distance and at Follow range the track never flickers, the far
limb is hidden behind the globe and the station occludes the track
(`docs/verification.md`, "Ground track").

#### D.4 - LICENSE, NOTICE and an on-screen imagery credit - LANDED 2026-10-19 (credit line landed with the About panel, 2026-10-26)

**Problem (as of 2026-10-19, now fixed):** the repo shipped no LICENSE file,
while `public/models/*.glb` are IGOAL/NASA derived, the textures are derived
from NASA Blue Marble / Black Marble, and both shipped fonts are OFL. Their `NOTICE.md` is the right shape: one table
per asset class with source + licence, plus a trademarks section. Also copy
the practice of an on-screen credit while streamed imagery is visible (their
`BodyImagery.credit` -> `UI.setImageryCredit`); we currently show none.

First cut: `LICENSE` (MIT, matching their choice and the README's
open-source framing), `NOTICE.md` with the provenance already recorded in
`docs/ISS_MODEL_CONTEXT.md` and `public/textures/README.md`, the OFL text
beside `public/fonts/*.woff2`, and a one-line credit in the About panel (B.7).
Check: link check on the new files; no code change.
Cost: under an hour. Legal hygiene, not a feature.

**Landed (PR #14):** `LICENSE` (MIT), `NOTICE.md` (data, models, imagery,
fonts, dependencies, trademarks), `public/fonts/OFL.txt`. The on-screen
imagery credit still rides with the About panel (B.7).

#### D.5 - Social/SEO metadata - LANDED 2026-10-19

**Problem (as of 2026-10-19, now fixed):** `index.html` had a description and
favicons but no `og:*` / `twitter:*` tags, no `robots.txt`, no `sitemap.xml`
and no share image. Theirs has the full set including `og:image` dimensions,
locale and alt text, plus both files in `public/`.

First cut: OG/Twitter block in `index.html` (title, description, a 1200x630
image - D.7 makes capturing one easy), `robots.txt`, `sitemap.xml`, absolute
URLs against the single Vercel deployment.
Check: an OG debugger previews correctly; `/robots.txt` and `/sitemap.xml`
return 200.
Cost: under an hour.

**Landed (PR #14):** OG/Twitter block in `index.html`, `robots.txt`,
`sitemap.xml`, and `public/og-image.png` at 1200x630. The image is generated
artwork, not a screenshot: canvas `toDataURL` returns a cleared buffer under
`preserveDrawingBuffer: false`, so it was composed from the project's own
palette and self-hosted fonts. The generator is a throwaway script, not
committed - regenerate from this description if the branding changes.

#### D.6 - Mobile frame: safe-area insets, coarse-pointer sizing, render scale - LANDED (CSS half 2026-10-19; hit areas and render scale 2026-10-26, plan 017 R4/R6)

**Problem (as of 2026-10-19, CSS half now fixed):** `src/index.css` had zero
`env(safe-area-inset-*)` and no `(pointer: coarse)` branch; on a notched phone
the bottom orbit tape and the top corners sat under the home indicator /
notch. Theirs uses safe-area in every fixed panel, a
coarse-pointer block for larger tap targets, and caps DPR at 1.5 on
`(pointer: coarse)`.

First cut: safe-area padding on `.hud-frame` and the four corner clusters;
`@media (pointer: coarse)` raising control hit areas to >= 44 px; a manual
render-scale override in the settings popover that PINS the `DprGovernor`
while set (do not multiply silently - that would fight the governor's own
history).
Check: 390x844 emulation, portrait and landscape; tape and corners clear the
insets; the governor does not fight the override.
Cost: one session, CSS + one settings field. Folds into C.3.

**Landed (PR #14), CSS half:** every viewport-anchored cluster pads by
`env(safe-area-inset-*)` through `max()`, so the old spacing is the floor and
desktop layout is byte-identical. `index.html` gained `viewport-fit=cover` -
without it `env()` reports zero on iOS and the whole change is inert.
**Landed 2026-10-26 (plan 017 R4/R6):** the `(pointer: coarse)` block gives
every HUD control a ≥ 44×44 hit area. "Render scale" in the settings popover
(`renderScale.ts`) pins the DPR at 100/75/50% of the ceiling and stops the
governor sampling; Auto starts a fresh governor.

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

### Small items that fold into existing work

- `F1` help overlay + one shortcut registry (their `?` modal) -> C.4 —
  landed as 017 A1 (`?` overlay, `src/ui/shortcuts/shortcutRegistry.ts`).
- Accent-folded place search (`normalizeQuery`: dotless i, NFD) -> B.3 —
  landed with the offline city search (`src/core/geo/CitySearch.ts`).
- Render scale -> D.6.

### Rejected, with reasons

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

### Licensing boundary

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

## Older items - status folded into the roadmap

- **Perf run (old item 0).** Baseline MEASURED 2026-10-04 (history:
  "Open-items pass" in `plans/PROGRESS-history.md`): overview and 300x are
  vsync-steady 60 fps; Bloom is free; close-up High-fidelity ISS is the only
  measurable cost (~5% of frames at 30 fps). Remaining: the matrix on other
  GPUs, plus the C.6 cuts. Original suspect list + gate constraints live in
  that history entry - still the rules for any perf change.
- **Quick wins (old item 1).** Orbit line/terminator/glint/bloom: done
  (2026-09-28/29). Lens flare: reworked 2026-10-04. Hide-HUD toggle (`H`):
  done 2026-10-19 (PR #14). Still open, small: Branding pass
  (icon set and loading screen landed 2026-10-26 as 017 I1/I2; the share
  image waits on the name, I3). Info/About panel: landed 2026-10-26 (017 P,
  was B.7 "What's real").
- **Time controls (old item 2).** DONE 2026-09-28. `L` / `R` and the rate
  shortcuts landed 2026-10-26 (017 A1).
- **ISS attitude (old item 3).** DONE - LVLH/TEA in `ISSGroup`, SARJ
  tracking, BGA beta tilt landed 2026-10-04, TRRJ illustrative mode.
  The TRRJ law (edge-to-Sun in daylight, face-to-Earth in eclipse) is
  implemented as an illustrative autotrack. Optional remains: a parked-TRRJ
  operations profile and Canadarm2/ERA poses (needs rig work; no dedicated
  nodes).
- **Module explorer (old item 4).** Future. The asset-budget collision is
  solved: IGOAL streams on demand; `check-asset-budget.mjs` gates only the
  initial load. Per-module raycasting/selection/exploded view remain.
- **Ground track + passover (old item 5).** = roadmap B.2 (landed) + B.3.
- **Responsive audit (old item 6).** Still open. Keep sizing in the
  stylesheet: inline styles beat media queries (historical bug twice).
- **Geo proxy (old item 7).** Conditional on field reports; follow the
  `api/tle.ts` pattern (`api/geo.ts` + `vercel.json` functions entry).