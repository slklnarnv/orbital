# Next Steps - ORBITAL

> Front-door order: `CLAUDE.md` -> this file -> `plans/PROGRESS.md` (short
> ledger; history in `plans/PROGRESS-history.md`). Deep docs load on demand
> (see CLAUDE.md). Keep the Current state section fresh in the same commit as
> behavior changes - never ship an errata banner, fix the stale text instead.

## Current state (2026-10-25)

- **Gate green**: `npm run verify` — asset budget, shader ramps, typecheck,
  lint (0 warnings), 425 unit tests in 46 files, production build. CI
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
  render with limb occlusion; no console errors except an external BigDataCloud
  400. No human visual pass yet.
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

1. Re-check the live deployment after the wave 1-2 merges: console free of CSP
   errors; `/api/tle` 200 with its cache header; `/api/tle?x=1` 404;
   `/models/*` and `/textures/*` answering `immutable` with `?v=<asset hash>`;
   `/robots.txt`, `/sitemap.xml`, `/og-image.png` and
   `/basis/basis_transcoder.wasm` all 200. A human look at the rebuilt
   materials at Follow and Inspect, day and night, on a real GPU (MLI
   blankets, ELC grating, iROSA wings, night legibility). Then a human
   visual pass on the penumbra fade at a terminator crossing (300x), the
   countdown, the ground track (HUD globe and the 3D setting) and the Bloom
   MSAA edges; on a throttled connection, Locate departs with the detailed LOD
   (not the schematic) at Follow and the full model appears only below 200 km.
2. **B.3 next visible pass.** Reuse `isSunlit` and the forecaster pattern. It
   needs CSP and `Permissions-Policy` changes for city search and browser
   geolocation.
3. **C.5**: a short `CHANGELOG.md` and Dependabot (the scheduled fallback-TLE
   refresh is done).
4. **D.6 remainder** (coarse-pointer hit areas, render-scale override) and
   **C.4** accessibility.
5. Deferred majors: React 19 + R3F 9 + drei 10, then three r18x, Vite 7/8, and
   satellite.js 7. The "investigate visually first" list is in
   `plans/README.md`.
6. Remaining roadmap and borrow items: A.2 measured perf run, B.4-B.8,
   C.1-C.3, **D.7** save-frame (a positive-priority `useFrame` disables R3F
   auto-render, so the capture must not mount while Bloom is off), D.8 (GIBS
   tiles, only after A.2's baseline), D.9. Optional realism: a park/feather
   arrays mode and a parked-TRRJ operations profile.

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
   elevation, "Jump to pass" (uses the existing seek).
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
   `main`). Still open: a short `CHANGELOG.md`.
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

Suggested order now: B.3 → A.2 → C.2 (A.3, B.1 and B.2 landed 2026-10-25;
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

#### D.4 - LICENSE, NOTICE and an on-screen imagery credit - LANDED 2026-10-19 (credit line pending B.7)

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

#### D.6 - Mobile frame: safe-area insets, coarse-pointer sizing, render scale - LANDED 2026-10-19 (CSS half; render-scale override still open)

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
Still open: the `(pointer: coarse)` hit-area block and the pinned render-scale
override.

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

- Our surface shader owns the terminator, the 5-tap cloud shadow, the ocean
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

- `F1` help overlay + one shortcut registry (their `?` modal) -> C.4.
- Accent-folded place search (`normalizeQuery`: dotless i, NFD) -> B.3, only
  if city search lands.
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
  calibrated to the sun core; a user exposure would invalidate that. Render
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
  (favicon/loading-screen assets exist), Info/About panel (doubles as
  roadmap B.7 "What's real").
- **Time controls (old item 2).** DONE 2026-09-28. Remaining: `L` / `R`
  shortcuts -> roadmap C.4 (`H` is now the HUD toggle).
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