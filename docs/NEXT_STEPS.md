# Next Steps - ORBITAL

> Front-door order: `CLAUDE.md` -> this file -> `plans/PROGRESS.md` (short
> ledger; history in `plans/PROGRESS-history.md`). Deep docs load on demand
> (see CLAUDE.md). Keep the Current state section fresh in the same commit as
> behavior changes - never ship an errata banner, fix the stale text instead.

## Current state (2026-10-23)

- **PRs #14 and #15 merged 2026-10-23**, in that order (#15 was stacked on
  #14). Merge commits `4d45d64` and `b314bac`; `verify` and `npm audit` are
  green on both. The live deployment still needs the post-merge check below.
- **#14 `feat/tier0-gains`** (`f26f72a`, `c1bc242`, `013331e`): batched
  texture uploads (C.6a), build-id-versioned immutable asset URLs (D.2),
  Hide-HUD toggle on `H`, safe-area insets + `viewport-fit=cover` (D.6 CSS
  half), OG/Twitter metadata + `robots.txt` + `sitemap.xml` + a generated
  `og-image.png` (D.5), and `LICENSE` + `NOTICE.md` + the fonts' OFL (D.4).
- **#15 `fix/orbit-line-dashes`** (`a75f8fe`, `4e5a335`): the orbit ring now
  spans the live period (the 214 km seam is down to the 11–16 km SGP4
  residual) and the dash pattern is phased from the clock instead of the
  moving arc edge; 5 new predictor tests.
- **Locate LOD + two-tier detail landed 2026-10-23** (`feat/locate-lod`):
  `public/models/iss_igoal_locate.glb` is derived from the high asset by
  `scripts/build-iss-locate-lod.mjs` — 5.27 MiB, 784k triangles, 703 nodes and
  the full 12-joint rig, 512 px textures. Locate/Follow loads this tier; the
  full 20.5 MiB `iss_igoal.glb` loads only inside the 200/220 km Inspect band.
  A 5 s boot-idle prefetch warms the LOD (connection-gated), and `__BUILD_ID__`
  is now an asset-content hash instead of the commit SHA, so docs/code deploys
  no longer invalidate the model cache. Full-high failure keeps the LOD;
  LOD failure demotes to legacy.
- Measured on the C.6a change: `iss_igoal.glb` carries 73 WebP textures;
  uploading them costs 178 ms of GL work on this machine (2.44 ms each).
  The old loop yielded one frame per texture (73 frames ≈ 1.2 s at 60 Hz);
  the budgeted loop finishes in 30 frames (≈0.5 s).
- Found in review of the deployed preview and fixed in `c1bc242`: `/draco`
  had been switched to `immutable` although `useGLTF.setDecoderPath` builds
  its own URLs with no `?v=`. It stays `max-age=3600`; only `/models` and
  `/textures` are immutable, and both are versioned.
- Green on merged main: `npm run verify` (243 unit tests + build) and CI on
  the merge commits.
- Prior: PR #12 (tooling + CI, guarded `/api/tle`, CSP + self-hosted fonts,
  DPR governor, ISS wing gimbals, Nauka hull fix, lens flare rework). Details:
  `plans/PROGRESS.md`.
- Docs-only 2026-10-19: read `berkcomba/youreyesinspace` and added the
  comparison + borrow list (D.1-D.9) below.

## Next (ranked)

1. Re-check the live deployment after the #14/#15 and Locate-LOD merges:
   console free of CSP errors; `/api/tle` 200 with its cache header;
   `/api/tle?x=1` 404; Nauka, wing tilt and flare up close; `/models/*` and
   `/textures/*` answering `immutable` with `?v=<asset hash>`;
   `/robots.txt`, `/sitemap.xml` and `/og-image.png` all 200; `H` hides the
   HUD; safe-area insets on a notched phone; the orbit ring closes at the
   station's antipode and the dashes hold across refreshes; on a throttled
   connection, Locate departs with the detailed LOD (not the schematic) at
   Follow and the full model appears only below 200 km.
2. **D.1 - penumbra eclipse** (comparison section below). The largest
   fidelity gap left, and it pays for B.1's countdown at the same time.
3. Roadmap B.1-B.3: orbital day/night countdown, ground track + footprint,
   next visible pass from a location. B.2 must adopt D.3's depth-independent
   draw first.
4. Playwright smoke suite (needs install; postponed twice).
5. Optional realism: park/feather arrays mode (BGAs hold in eclipse), TRRJ
   thermal profile (P2).
6. Remaining borrow items: C.6b (network warm on Locate intent) and D.7
   (save-frame). D.8 (GIBS tiles) only after A.2's measured baseline.

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
3. **Browser smoke suite (Playwright).** `tests/e2e/smoke.spec.ts`, Chromium
   only, `page.clock` fixed, `vite preview` as the web server. Cases: boots
   with no console errors; camera position finite after 5 s; Locate reaches
   "Follow · Locked"; Space pauses; settings survive reload; `?failAssets`
   style TLE failure ends in OFFLINE/RECOVERY. `npm run test:e2e`, wired into
   CI after `verify`.
4. **Unit tests for untested frame-math modules** (CoordinateConversions,
   OrbitalEngine edge cases): known-answer vectors (GMST at J2000, sun
   direction at an equinox, ECI→geodetic round trip).

### B. Features

1. **Orbital day/night + countdown.** Pure function
   `eclipseState(posEciKm, sunDir)` using the cylindrical shadow model
   (in shadow when `dot(r, s) < 0` and `|r − (r·s)s| < R⊕`). Countdown: step
   the propagator forward at 10 s, then bisect the transition to 1 s; recompute
   once per transition, not per frame. HUD line "Daylight · sunset in 12:41".
   Touches: new `core/orbital/Eclipse.ts`, telemetry store, one HUD cluster.
   Optional second cut: tint the orbit line's shadowed span.
2. **Ground track + footprint.** Sample ±1 orbit at 30 s steps (≈190 points)
   on each TLE swap and every 60 s; draw as a Line2 on the globe surface
   (r = R⊕ + 2 km, in the EarthGroup/ECEF frame). Footprint: circle of
   half-angle `acos(R⊕/(R⊕+h))` around the sub-satellite point, 64 segments.
   **Depth: do NOT rely on the 2 km offset alone** — at `near = 1 km` and
   24-bit depth the smallest resolvable gap is 20.7 km from the home view and
   11.1 km from orbital altitude (14 m only at close range), so the track
   z-fights where it matters most. Render with `depthTest: false` plus an
   analytic Earth-horizon discard (comparison D.3 option a).
   Touches: new `rendering/earth/GroundTrack.tsx`, settings toggle.
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
   pipeline; convert Earth textures to KTX2/Basis (`toktx`) with a WebP
   fallback. Measure first (C.2 follows A.2's numbers).
3. **Mobile.** Check pinch, two-finger slide, lifting one finger mid-gesture,
   portrait HUD; fix what breaks. Add a 390×844 case to the Playwright suite.
4. **Accessibility.** `aria-live="polite"` region announcing the place below
   (at most once per minute), a `?` shortcut-help overlay, the remaining
   `L` / `R` shortcuts (item 2; `H` shipped as the HUD toggle in PR #14),
   a high-contrast HUD class.
5. **Release routine.** Scheduled CI job running `npm run refresh:tle` that
   opens a PR when the fallback changes; a short `CHANGELOG.md`.
6. **Faster Locate (fresh load).** Locate is a primary feature. A cold session
   used to wait for the full high pipeline, and on a slow connection the 8 s
   departure gate expired, so the camera departed on Model A and swapped
   mid-flight. **LANDED 2026-10-23: the Locate LOD + two-tier detail.**
   Locate/Follow now fetches `iss_igoal_locate.glb` (5.27 MiB, 784k triangles,
   512 px textures) instead of the 20.5 MiB full asset; `iss_igoal.glb` loads
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
   c. Only if the full Inspect load still feels slow: decode/VRAM cost —
      KTX2/Basis textures and meshopt instead of Draco+WebP (fold into C.2).
      This does not reduce the LOD's cold-network path.

Suggested order: A.1 → A.3 → B.1 + B.2 → B.3 → A.2 → C.2 (C.6a/C.6b and the
Locate LOD landed 2026-10-23; C.2 remains for the full-asset decode/VRAM path).

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
| Verification | 227 unit tests, asset budget, shader-ramp gate, lint 0 warnings, CI | No test runner, no lint, no asset gate; CI is typecheck + build + a Docker health curl |
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

Status roll-up (2026-10-19): **D.2, D.4, D.5 landed; D.6 landed for the CSS
half.** All five shipped in PR #14 together with C.6a. Still open: D.1, D.3,
D.7, D.8, D.9, plus the coarse-pointer and render-scale halves of D.6.

#### D.1 - Penumbra instead of a binary eclipse test

Their `common.glsl` `sphereShadow` smoothsteps over the occluder's angular
radius +/- the sun's angular radius (`sunAng = R_sun / |sunPos - P|`), so a
shadow edge is a gradient, not a step. Ours is binary in three places:
`ISSModel.tsx` (`isShadowed = p < 0 && perpSq < R^2`), `ISSAnimations.tsx`
(the same expression, passed to the TRRJ law as `sunlit`), and
`ISSJointKinematics.trrjTargetAngle` takes `sunlit: boolean`. The Sun's
angular radius is 0.266 deg, so the real penumbra at the station is
`2 * 6,779 km * 0.00465 rad ≈ 63 km` wide — roughly 8 s of flight. Our test
collapses that into one frame, and that frame switches a 2.3x key-light
boost, ambient 0.24 -> 0.42, the earthshine key light and the glint colour.
Visible pop; the same boolean also flips the TRRJ target law.

First cut: one pure function in `src/core/orbital/` -
`sunVisibility(positionKm, sunDir): number` in [0,1] with a ~63 km penumbra
band at ISS altitude. Feed the continuous value to the three light
intensities and the glint tint; keep the boolean at a 0.5 threshold for the
TRRJ law so joint behaviour is unchanged. Reuse it for B.1's countdown
(bisect the 0.5 crossing instead of a second shadow model).

Touches: new `core/orbital/SunVisibility.ts` + test, `ISSModel.tsx`,
`ISSAnimations.tsx`, the `ISSJointKinematics` call site.
Check: unit vectors at umbra / penumbra / full sun; browser pass through the
terminator at 300x shows no single-frame exposure step; joint tests unchanged.
Cost: ~1 session. No shader work, no dependency.

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

#### D.3 - Fix the ground-track depth budget before implementing B.2

B.2 specifies `r = R_earth + 2 km` in the EarthGroup frame. With the current
camera (`near = 1 km`, `far = 2,000,000 km`, 24-bit depth) the smallest
resolvable depth gap is `z^2 * (far - near) / (far * near * 2^24)`, so at a
ground distance of 18,629 km (the 25,000 km home view) it is 20.7 km; at
13,629 km it is 11.1 km; at the station's ~478 km ground distance it is
14 m. A 2 km offset is therefore fine at close range but z-fights from
orbital altitude — where the track is most useful.

They set `logarithmicDepthBuffer: true` with `near = 1 m`, `far = 1e13 km`,
which removes the problem - but they need it for a 10^13 km scene; we do not.
Options, cheapest first:

a. Draw the track in a second pass with `depthTest: false` and an analytic
   Earth-horizon discard in the fragment shader (keeps limb occlusion, no
   global change). Recommended.
b. Raise the offset to ~40 km and accept a floating track at close range -
   visibly wrong at INSPECT range. Not recommended.
c. Adopt `logarithmicDepthBuffer` - every custom shader needs the
   `logdepthbuf_*` chunks and the bloom-off parity contract must be
   re-verified. Only if other depth artifacts appear.

Touches (a): new `rendering/earth/GroundTrack.tsx` with `depthTest: false`,
`renderOrder` after EarthGroup, horizon-discard uniform.
Check: at 25,000 / 13,629 / 6,849 km camera Earth-centre distance the track
never flickers; the far limb is hidden behind the globe.
Cost: folded into B.2, not extra.

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

**Net:** D.1 and D.2 are the two changes with real user-visible payoff for
under a session each. D.3 is a correction to our own B.2 spec and must land
before that feature starts. D.8 is the only large borrow worth doing, and only
after the perf baseline.

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
  Optional remains: a faithful TRRJ thermal profile (P2) and Canadarm2/ERA
  poses (needs rig work; no dedicated nodes).
- **Module explorer (old item 4).** Future. The asset-budget collision is
  solved: IGOAL streams on demand; `check-asset-budget.mjs` gates only the
  initial load. Per-module raycasting/selection/exploded view remain.
- **Ground track + passover (old item 5).** = roadmap B.2 + B.3.
- **Responsive audit (old item 6).** Still open. Keep sizing in the
  stylesheet: inline styles beat media queries (historical bug twice).
- **Geo proxy (old item 7).** Conditional on field reports; follow the
  `api/tle.ts` pattern (`api/geo.ts` + `vercel.json` functions entry).