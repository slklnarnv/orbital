# Session Handoff — ORBITAL UI
> Model rig/pipeline authority: docs/ISS_MODEL_CONTEXT.md (+ docs/MODEL_AUDIT.md).
> Front door with reading order + invariants: CLAUDE.md.
Handoff notes for the next session working on this repo. Read this before
touching the HUD, the geo service, or the camera system.

## Where things stand

**Project**: ORBITAL — real-time ISS orbital visualization (React 18,
TypeScript strict, Vite 6, React Three Fiber + three r170, Tailwind v4,
zustand 5, satellite.js). Git repo: `github.com/slklnarnv/orbital`; the
remote is the source of truth for history.

**Run / verify**:

```bash
npm ci
npm run dev
npm run verify     # asset budget + shader ramps + tsc + lint (0 warnings) + unit tests + build
```

All green at handoff.

## Session log — 2026-10-24/25 (improve-skill audit, waves 1-2)

Read this block first. Results: `plans/PROGRESS.md`; index: `plans/README.md`.

- **Locate sweep angle is signed** (`CameraFlightPath`), so close departures
  land on the planned standoff; duration formula in the camera facts below.
- **Eclipse countdown** = the line under the gauges (`GaugesCluster.tsx`), fed
  by `telemetryStore.sunlit` / `shadowTransitionInMs` (`ShadowForecaster`,
  `core/orbital/EclipseForecast.ts`). It bisects the 0.5 penumbra crossing
  (`isSunlit`), the edge the TRRJ law uses; ISS lighting fades with
  `sunVisibility`.
- **Ground track**: the HUD globe (`GroundTrackGlobe.tsx`) draws +/- half an
  orbit, dotted behind and solid ahead. The 3D track + footprint
  (`rendering/earth/GroundTrack.tsx`) is the "Ground track" setting, default
  off; depth is a constant clip-space bias (`groundTrackDepth.ts`), not
  `depthTest: false`; keep its colours <= 1.0 (bloom threshold).
- **Station shadows** (`rendering/iss/stationShadow.ts`): the "Shadows"
  setting, default on. The sun light (`SunLight`) stays `SUN_LIGHT_DISTANCE`
  up-sun of its target; ISSModel aims the target at the station. The map is
  cached (`autoUpdate = false`); if a shadow looks stale, check that
  `ShadowRefreshScheduler` sees the change (sun in station frame, joint
  angles) before touching bias.
- **Geo freshness** (`GeoLookupService.ts`): place 30 days; weather refreshes
  after 15 min and is hidden past 1 h; local time is null without a UTC offset,
  never another cell's clock; persisted rows must pass `isGeoSnapshot`.
- **Playwright hooks** (`npm run test:e2e`, production preview, network stubbed
  with `page.route`): `#btn-locate-iss`; `[role="status"]` ("Follow · Locked");
  `aria-label` "Pause time" / "Resume time" / "Render settings" (dialog with an
  "Orbit line style" radiogroup); `html.hud-hidden` after `H`; settings in the
  `orbital-settings` localStorage key. The loading overlay swallows pointer
  events until "Loading NN%" is gone, and the rAF loop defeats actionability
  waits: click by coordinates.
## Session log — 2026-10-23 (Locate LOD + two-tier detail)

Read this block before the older chronological list below. The 2026-10-19 PR
block follows it.

**The report:** a cold Locate on slow wifi loaded the first tier, departed,
and then showed the schematic Model A before swapping to IGOAL mid-flight with
a hitch. Cause: the full asset is 20.5 MB / 2.665M triangles and the departure
gate is bounded at 8 s; 76% of the triangles are `Details_*` greebles.

**The fix:** a derived Locate tier (`public/models/iss_igoal_locate.glb`,
5.27 MiB, 784k triangles, 703 nodes, full 12-joint rig, 512 px textures) is
loaded first for Locate/Follow; the full `iss_igoal.glb` is requested only
inside the 200/220 km Inspect band. Measured LOD decode ~0.2 s Draco + ~0.5 s
WebP vs ~3.6 s for the full asset. A high failure keeps the committed LOD; a
LOD failure demotes to legacy.

- Build: `scripts/build-iss-locate-lod.mjs` / `npm run build:iss-lod` strips
  details except the silhouette keep-list, simplifies 0.3/0.03, resizes
  textures to 512, Draco 12/8/10, validates the candidate, then publishes.
- Runtime: `DetailQuality` adds `locate`; `shouldAwaitDetail` gates on the
  first committed tier; `isClose` (200/220 km) starts the full asset. A
  prepared-URL set skips re-preparing the LOD when it becomes the committed
  model, avoiding a remount hitch.
- Caching: `__BUILD_ID__` is now the versioned `.glb`/`.webp` content hash, so
  docs/code deploys keep the model cache. A 5 s boot-idle, connection-gated
  bare fetch warms the LOD; the full asset is not prefetched.
- **2026-10-25 rebuild** (supersedes the sizes and WebP figures above): both
  tiers now ship KTX2 / Basis ETC1S textures and the authored IGOAL materials
  (`docs/ISS_MODEL_CONTEXT.md` §1.1). The LOD is derived from the high build's
  master, keeps every rig node, and with rigid batching measures 6.20 MiB
  (≈5.5 MB brotli, was 4.4), 176 draw primitives (was 432) and ~20 MiB of GPU
  texture memory (was ~97). The full asset is 27.1 MiB (≈24.2 MB brotli, was
  16.5) with 217 draw primitives (was 980) and ≤228 MiB of texture memory
  (was ~700). Image decode left the main thread
  (transcoding runs in workers), so the GPU preparation is shorter.
- Verified: `npm run verify` exit 0 (246 tests), LOD passes
  `iss-model-manifest --check-only`, high asset unchanged. **Browser-verified
  2026-10-23** (headless Chrome 156, live): Locate reached `Follow · Locked`
  and requested only the LOD (4.80 MB / 2.4 s, then a 49 ms cache hit);
  zooming to `Inspect · Locked` requested `iss_igoal.glb` once
  (17.95 MB / 7.4 s); no console errors. Remaining: a human visual pass on the
  swap/hitch and a throttled cold-Locate repeat.
- Open: KTX2/meshopt for the full asset (C.2); high-tier preload heuristics if
  the Inspect wait feels long; VRAM overlap while both tiers are resident.

## Session log — 2026-10-19 (PRs #14/#15, merged 2026-10-23)

Read this block before the older chronological list below; it is the current
state. Both PRs merged 2026-10-23, #14 first, then the stacked #15.

**PR #14 `feat/tier0-gains`** — five borrow items from the youreyesinspace
comparison in `docs/NEXT_STEPS.md`, none touching simulation truth:

- `ISSModel.prepare()` uploads textures on a 6 ms per-frame budget instead of
  yielding one frame each (73 maps, 178 ms of GL work; 73 → 30 frames).
- `__BUILD_ID__` → `?v=` on the model/texture URLs; `/models` and `/textures`
  are `immutable`. **`/draco` is NOT** — `useGLTF.setDecoderPath` builds its
  own URLs with no `?v=`, so `immutable` there would pin a stale decoder.
- `H` hides the HUD (`toggleHud` in `src/ui/shortcuts/useShortcuts.ts`,
  `.hud-hidden` on `<html>`, `visibility` so layout is untouched). Not
  persisted. Since 017 A1 every global key lives in `shortcutRegistry.ts`.
- Safe-area insets on every anchored cluster + `viewport-fit=cover`
  (without it `env()` is 0 on iOS).
- OG/Twitter metadata, `robots.txt`, `sitemap.xml`, generated `og-image.png`;
  `LICENSE`, `NOTICE.md`, `public/fonts/OFL.txt`.

**PR #15 `fix/orbit-line-dashes`** — two measured `OrbitLine` defects:

- The arc spanned the NOMINAL 92.68 min period against a 92.98 min element
  set and dropped its final partial step, leaving a **214 km gap** where the
  ring should close. Now driven by the live period
  (`OrbitalEngine.periodMinutes`) with the step rounded, not truncated:
  214 km → 11–16 km, the residual being SGP4's own non-closure.
- The dash pattern slid ~1.8 pitches every refresh because `LineMaterial`
  keys it on `instanceDistance` measured from the arc's trailing edge, which
  moves ~460 km per refresh. `dashOffset` now carries that edge's absolute
  position from the clock. **Do not modulo it by the pitch** — the pitch
  changes every frame with the camera and the remainder slides by
  `(phase/pitch)·Δpitch` (~17 km for a 0.3 km change; this was the first
  implementation and the browser check caught it).

**Merge order mattered: #15 was stacked on #14.** `fix/orbit-line-dashes` was
branched from `feat/tier0-gains`, so its diff against `main` carried all 25
files of #14 plus the orbit-line changes. They were merged in that order —
#14 first (merge commit `4d45d64`), then #15 (`b314bac`) — so each change
landed through its own PR.

## What this session changed (chronological)

0. **IGOAL model forensic audit + corrections** — read
   `docs/ISS_MODEL_CONTEXT.md` FIRST (complete briefing: verified
   measurements, animation math, tooling traps, verification protocol),
   then `docs/MODEL_AUDIT.md`. An external audit's headline
   findings (undersized solar arrays, stale bounds, mis-centered pivot) were
   all artifacts of a `getScalar(index, component)` API misuse in
   `scripts/iss-model-manifest.mjs`; the fixed tool now reproduces the build
   report exactly. Real fixes that DID come out of the audit:
   `ISSAnimations` now drives the authored SARJ/TRRJ joint nodes
   (`PORT_ALPHA_ROT`, `STBD_TRRJ_GAMMA_ROT`, …) instead of re-parenting
   arrays onto synthetic pivots (the "bent inner arrays" cause), and the
   P1/S1 radiator subtrees get a dedicated white (Z-93) coating split at build time (`splitRadiatorPanels`;
   the runtime mount override is gone) (source MLI assignment read near-black). `[ISS AUDIT]` logs the mounted
   asset; `scripts/iss-model-inspector.html` is the browser harness for
   model forensics (serve with the dev server and open directly).
1. **HUD redesign, pass 1** — replaced the original glass-panel dashboard with
   a broadcast-style edge-anchored HUD (Starship stream was the reference).
2. **HUD redesign, pass 2 — "observatory console"** — deliberate divergence
   from the SpaceX look (user request). This is the current design.
3. **Ground-point enrichment** — "Passing over: place · coords · local time ·
   weather" in the bottom-right cluster.
4. **Close-range ISS jitter fix** — frame-order bug in the camera pipeline.
5. **`docs/NEXT_STEPS.md`** — ranked roadmap for future sessions. Read it next.

### Current HUD design system (src/index.css is the source of truth)

- **Tokens**: warm instrument white `--hud-hi: #f1ede4` at 4 intensities
  (`--hud-mid/lo/line`); color is reserved for data-link status only
  (`--signal-*`). Space background `--space: #020409`.
- **Type**: Space Grotesk (display/labels/numerals, `tnum` where they tick) +
  Chivo Mono (fine ephemeris). Self-hosted in `public/fonts`, declared in
  `src/index.css` (`index.html` preloads them).
- **Voice**: sentence case everywhere (no ALL CAPS); hierarchy via weight and
  tone. Acronyms stay uppercase (TLE, JD, GMST, UTC, ISS).
- **Geometry rule**: circles are only for physically-round things (the globe).
  Instruments use reticle corner-ticks (camera button) or bare typography.
- **Frame map**: top-left = identity + link status; top-right = ephemeris line
  + camera control (rule: *controls top, data bottom*); bottom-left = speed /
  altitude bare gauges; bottom-center = UTC clock (Zulu suffix) over the orbit
  tape; bottom-right = ground cluster alone; full-width orbit tape along the
  bottom edge.
- **Status vocabulary**: declared ONCE, top-left ("Live" / "Cached" /
  "Recovery" / "Fallback" via `telemetryModeVisual`). Do not repeat it in the
  clock caption.
- **Overlays** (017 A1/P): every popover and panel goes through
  `src/ui/overlay/` — one open at a time, Escape closes, focus returns to the
  trigger; new panels use `HudPanel` and `useOverlay`, never their own
  outside-click/Escape effect. Text links are warm white with a hairline
  underline (`.hud-link`), never a link colour.
- **Contrast**: `--hud-lo` is 50% white (4.7:1 on `--space`, AA);
  `HudContrast.test.ts` fails if a token drops below 4.5:1.
- **Honest-instrument rule**: nothing renders without real data behind it —
  unknowns show "—", decoration that encodes nothing gets removed (the gauge
  tick-arcs were cut for exactly this reason).

### Key files

| Path | Role |
|:---|:---|
| `src/index.css` | Design tokens + all `.hud-*` classes + responsive frame |
| `src/App.tsx` | `HudOverlay` composition; service lifecycle (`geoLookupService.start/stop`) |
| `src/ui/layout/TopBar.tsx` | Top corner clusters |
| `src/ui/clusters/GaugesCluster.tsx` | Bottom-left gauges |
| `src/ui/clusters/MissionClockCluster.tsx` | UTC clock hero |
| `src/ui/clusters/OrbitTape.tsx` | Revolution tape (argument-of-latitude math lives here) |
| `src/ui/clusters/CameraCluster.tsx` | Locate-ISS reticle control (top-right) |
| `src/ui/clusters/GroundTrackGlobe.tsx` | Orthographic globe + passing-over lines |
| `src/ui/common/PassesPanel.tsx` | Visible-pass popover (observer search, pass list, Watch); prediction in `src/core/orbital/PassPredictor.ts` |
| `src/ui/common/HudGauge.tsx` | Bare gauge readout |
| `src/ui/common/telemetryModeVisual.ts` | Mode → label/dot/color mapping |
| `src/core/geo/GeoLookupService.ts` | Place + local time + weather service |
| `src/stores/geoStore.ts` | Geo presentation state (written by the service only) |

### Geo service facts (easy to get wrong)

- **Place names are offline** (`src/core/geo/PlaceIndex.ts`): point-in-
  polygon against Natural Earth 1:50m countries + marine polygons,
  `src/data/place-index.json`, rebuilt by `scripts/build-place-index.mjs`
  (pinned commit; never hand-edit). It ships as a hashed `/assets/` file
  fetched once on the first lookup. Land → country + continent (Russia split
  at 60° E); water → the most specific marine polygon; coastal gaps snap to
  the nearest water within 3°. NOT a geocoding API: free reverse-geocoding
  endpoints (BigDataCloud's client API) allow only the device's own location,
  and Nominatim answers "Unable to geocode" over open ocean.
- **Open-Meteo** forecast for temperature, WMO weather code, IANA timezone and
  UTC offset (local clock derives from the offset, not the tz name).
- Open-Meteo is keyless/CORS. Rate limited via `ApiRateLimiter` (~10 s
  cadence, exponential backoff); the place limiter only backs off a failed
  index load. Cache: 2° ground cells in memory + IndexedDB (`idb-keyval`,
  prefix `geo_v2_`; BigDataCloud-era `geo_cell_` rows are pruned at start),
  places 30 days, weather 15 min.
- Ticks every 5 s; first tick delayed 3 s and gated on a real telemetry fix
  (the store's 0,0 seed must not trigger a lookup).
- Every failure keeps the last good snapshot on screen.

### Camera system facts (harder to get wrong)

- `ISSGroup` advances the station pose at `useFrame` priority **−2**
  (`src/rendering/framePriority.ts`), before everything else: R3F runs equal
  priorities in subscription order, children first, so a child of `ISSGroup`
  at priority 0 (ISSModel's shadow aim, the rig) read the previous frame's
  pose. drei's CameraControls `update()` runs at **−1** — after the station
  moves but before `CameraController` retargets at priority 0. Anything
  that needs the rendered camera to match *this frame's* ISS must call
  `controls.update(0)` after moving the target (see the tracking branch of
  `CameraController` — this was the close-range jitter fix, verified 0 px over
  240 frames at 60 km; 2026-09 measurement).
- Tracking (Follow/Inspect) is **station-locked**: each frame the eye and
  `camera.up` are rotated about the station by the station's own attitude
  change (`StationFrameCarry.ts`, in the tracking branch of
  `CameraController`; reset whenever a flight runs). Before, the offset was
  fixed in inertial space, so scrubbing the orbit tape or running 300×
  swung the view around the station as its Earth-facing frame turned. The
  re-base follows `syncRenderedPoseToControls`' order: read the pose, adopt
  the up, set the pose.
- While the clock is paused, `ISSGroup` propagates at the clock's time every
  frame (`OrbitalRenderInterpolator.snapTo`) and snaps the attitude
  (`AttitudeFollower.snap`): every scrub, nudge, Set time and Watch moves the
  station in step with the Earth instead of trailing it through 10 Hz
  snapshots. Shadow-map redraws are capped at ~6.7 Hz while seeking
  (`SEEK_MIN_INTERVAL_MS`).
- `controls.moveTo(x, y, z, false)` snaps the target immediately. It is appropriate
  for tracking, but must not run during a cinematic flight. Every Locate and Reset
  View uses `CameraFlightPath`, sampled by the frame-owned transition lifecycle; a
  short Locate takes about 2 s (the `planLocate` base).
- Locate requests the fast detail tier before departure. `loadingStore.issDetail`
  covers the Locate LOD (downloading, GPU preparation, ready, failure) and the
  full high attempt separately; `ISSModel` uploads textures over separate frames,
  compiles against scene lights, and primes buffers with a zero-area scissor. The
  departure gate waits for any committed tier (`shouldAwaitDetail`), not the full
  asset; the full high model loads inside the 200/220 km `isClose` band. Keep
  preparation out of the flight and restore shared renderer state.
- Locate is ONE simple sweep (`CameraFlightPath`): the eye's direction rotates
  about a single fixed axis (uniform angular rate — a normalized lerp runs ~5×
  faster mid-path on wide sweeps, measured as an 11°/frame view spike) from the
  departure radial to the station standoff while the altitude eases down,
  clamped above the clearance sphere; the look target slides from the captured
  pivot to the station, completing its pan by ~70% progress. The view starts
  exactly where the user was looking, pans once across the globe, and ends
  centered on the station — one rotation, dynamic arrival framing (the standoff
  sits on the sweep's own approach side), no per-frame shortest-arc decisions.
  Everything else (stateful aims, fixed arrival bearings, chord tests, bulges,
  rate-capped tracking) was tried and removed — the simple sweep replaced it
  after each variant produced its own jank. Keep it simple. Flight time
  (`planLocate`) is 2000 ms + min(2000, max(0, startRadius − 20,000) × 0.025) ms +
  |sweep angle| × 350 ms (about 2 s up to roughly 5 s), multiplied by 0.35 under
  `prefers-reduced-motion` (`CameraController.tsx`).
- **The sweep is station-RELATIVE.** `planLocate` builds the route once and
  records the station position; `sampleLocate` translates that whole route by
  the station's drift since planning. Do NOT go back to flying to the planned
  arrival point — the flight lasts 2 to about 5 s, and at 300× the station covers
  ~6,500 km in that window, so the camera landed at the station's old address
  (6,460 km out instead of the ~353 km standoff), the 6,500 km clearance clamp
  then pinned the eye, and Locate visibly chased the station and never caught
  up. Do NOT instead re-derive the sweep axis/plane from the live station each
  frame: `cross(dirStart, stationDir)` flips sign as the station crosses the
  departure radial and `applyAxisAngle` mirrors the eye across the axis — a
  measured 25,343 km single-step teleport mid-sweep. Translation is exact,
  singularity-free, and leaves the 1× route bit-for-bit what it was.
- Flight horizon (`FlightHorizon`): the captured up is transported with the view
  each frame. Locate passes `worldUpBlend = 0` — the horizon is kept exactly as
  the user had it, with NO forced arrival orientation (forcing world-up rolled
  the camera through the whole tail of big sweeps, up to a half-flip on
  pole-passing routes — the "unnecessary rotation right at the end" report; a
  sphere's limb is rotationally symmetric, so the transported roll only rotates
  continents, never breaks the horizon). Reset View still passes
  `worldUpBlend = 1` for a north-up globe overview.
- Long planetary dives get extra time: `planLocate` adds
  `min(2000, max(0, startRadius − 20,000) × 0.025)` ms, so a 100,000 km
  approach takes ~4.5 s instead of compressing into a blink.
- Every takeover of the camera runs `syncRenderedPoseToControls`
  (CameraController): flight completion AND flight cancellation (drag, wheel,
  touch). Flights drive camera-controls' internal state with a world-up frame;
  without the sync, the first internal update after takeover snaps residual roll
  (measured 73° on cancellation before the fix). **The sync's order is load-bearing:
  read the pose FIRST, then adopt the rendered up.** `updateCameraUp()` re-interprets
  the stored spherical offset through the new up-space, so reading the eye after it
  re-projects the pose ~35° away — a huge kick at every completion (this shipped
  once; do not reorder). Wheel gestures never emit `controlstart`, so a separate
  canvas `wheel` listener cancels flights too.
- Locate and Reset View are always clickable, including mid-flight and while
  tracking: the store triggers overwrite the active transition, and the flight
  branch re-captures from the rendered pose (a new transition object is the
  re-capture signal). Locate while tracking re-flies to the standoff — a no-op
  only when the camera already sits at the canonical framing.
- Reset View visibility is deviation-based, not mode-based: the controller keeps a
  home pose (initial camera, replaced by each completed Reset) and writes
  `cameraStore.isHomeView` when the pose deviates (1 km position tolerance; level
  horizon judged on the camera's right vector, since world-up itself tilts with
  latitude when looking at Earth's center; plus an Earth-fits-the-viewport
  condition via `CameraStateMachine.earthFitDistanceForViewport`, so a desktop
  home pose resized to portrait re-offers Reset). Any orbit, zoom, or pan —
  including in Orbital/Planetary — shows the button; a completed Reset hides it
  again.
- Dragging cancels a pending or active camera flight. A detail-load failure allows a
  low-poly flight, with retries only on new Locate intent or a later manual approach.
- Manual navigation is constrained by `CameraNavigationConstraint` after camera
  tracking and before rendering. It protects a 6,500 km Earth-center radius, sweeps
  fast noncentral movements, and slides at contact. Free pans shift the corrected
  eye and pivot together; ISS orbit collisions preserve the tracking pivot.
  Orbit-like motion (fixed pivot, preserved offset length) is judged by sampling
  the actual arc instead of the straight chord — safe grazing orbits are not
  corrected. Earth clearance is owned entirely by this constraint: SceneRoot
  keeps `minDistance` at 5 km outside ISS-tracking modes, because clamping the
  pivot distance to 6,500 km teleported the eye during the Free→Earth handoff.
  The handoff's pivot recenter is a fixed-duration (1.2 s) easeInOutCubic glide,
  not an exponential decay — the decay moved fastest on its first frame.
- `FreeOrbitControls.rotateOrbit` snapshots and restores camera-controls'
  `_isUserControlling{Rotate,Dolly,Truck}` flags around its `setLookAt` calls:
  `setLookAt` clears them, which silently switched an outstanding wheel dolly or
  right-drag truck to programmatic damping mid-gesture.
- Timed flights bypass the manual constraint, including the final frame. Reset
  stays on the current radial bearing; close-Earth Locate follows a safe spherical
  route. Do not apply a second camera correction after a flight's sampled pose.
- Modes classify rendered distances, not queued endpoints. Planetary has a
  35,000/33,000 km entry/exit band; all manual ISS modes share 70 km model clearance
  (`ISS_MODEL_CLEARANCE_KM` in `CameraStateMachine.ts`).
- Rotation and dolly response follow pivot geometry continuously, so entering Free
  does not reset sensitivity. Right-drag/touch pan releases tracking on actual motion;
  orbit and centered pinch retain lock. The zoom meter uses the actual pivot distance.
- Reset View requests a 2.2 s Earth transition (plus up to ~0.8 s to settle roll:
  `initialRollErrorRad` × 250 ms) through the camera store. It
  eases to the 25,000 km overview (farther for portrait framing), without model/TLE
  readiness gates. Automatic zoom-out handoffs still preserve pending user motion.
- Curved Locate is one continuous gesture: the eye sweeps a great-circle route
  at monotonic radius (departure radius → the chase standoff, never a cruise
  climb), and the view makes a single eased turn onto the station's live
  bearing (`CameraFlightPath.sampleLocate`). The view aims through the surface
  at where the station will crest, so the ground fills the frame the whole way
  and the station rises into an already centered view. Do not reintroduce
  horizon-level "cruise" looking or two-stage view turns — they read as a
  zoom-out followed by a zoom-in. The arrival standoff is captured at planning
  time and then CARRIED relative to the live station (see the station-relative
  bullet above) — freezing it in inertial space is what broke Locate at 300×.
- Leaving a FREE pan on zoom-out is decided by
  `CameraStateMachine.isFreeZoomOut`: release at `max(220 km, 1.25 × the pivot
  distance when the pan began)`. The floor matches INSPECT's own exit band, so
  escaping a close inspect pan takes about the same gesture as leaving INSPECT
  (~1.5× at a 150 km orbit) instead of demanding a 3,300 km pivot distance.
  Zooming in never releases FREE.
- `controls.smoothTime` (0.25) and `minDistance` clamps were ruled out as
  jitter sources by experiment — don't chase them again.
- DEV-only hook: `window.__orbitalControls` (set in `AppCameraControls`).

## Debugging playbook learned this session

- **Playwright locator clicks time out** on this app (the rAF render loop
  defeats actionability waits). Click by coordinates instead: get the rect via
  `evaluate`, then `tab.cua.click({ x, y })`. The locate button keeps the
  stable id `#btn-locate-iss`.
- **Inline styles beat CSS media queries** (hit twice). Responsive overrides
  must either live in CSS with `!important` over inline styles, or the inline
  style must be removed and sizing moved into the stylesheet. Prefer CSS.
- **rAF-based page sampling requires a foreground tab**; background tabs
  throttle rAF to ~500 ms/frame and promise-based evaluates time out. For
  long in-page samplers, chunk them (30 frames per evaluate) into a
  `window.__*` accumulator array.
- Vite dev server + HMR: component edits hot-apply; a reload resets camera
  state (locate + zoom must be redone after `reload()`).
- **Reading a WebGL canvas outside the render frame returns black.** With
  `preserveDrawingBuffer: false` (the default, and the right setting), a
  `toDataURL` issued from a later rAF callback sees a cleared buffer —
  measured mean 0, max 0 over a 300×158 sample. Any capture must happen in
  the same frame as the draw.
- **`__orbitalScene` is DEV-only** (`import.meta.env.DEV`). Inspecting the
  scene graph works on `npm run dev` (5173), never on `vite preview` (4173);
  reach for the dev server when a check needs object internals.
- **The orbit arc refreshes at most once per 60 s of SIM time** (plus a
  250 ms wall floor). A browser check that waits ~5 s will see a stale arc —
  seek the clock (simulationStore.seek) to force a regeneration instead of
  waiting, and remember the dash offset is constant BETWEEN refreshes by
  design (the ring geometry is too).
- Vite binds IPv6-only on this machine (`[::1]:5173`). `127.0.0.1` is
  refused; use `http://localhost:5173/`.

## Deployment — Vercel + the API-proxy pattern (important)

The app is **hosted on Vercel from the owner's git repo**, and the repo ships a
serverless function, `api/tle.ts` (configured in `vercel.json` with
`maxDuration: 30`). Reason: end-user networks can be unreliable or ISP-blocked,
so external API fetches are proxied through Vercel's servers rather than made
from the browser.

The established pattern (see `CelesTrakClient.ts` + `api/tle.ts`):

1. Browser fetches **same-origin `/api/tle`** (the Vercel function).
2. The function fetches server-side from multiple upstream mirrors
   (celestrak.org → celestrak.com → wheretheiss.at), validates the data
   server-side (checksum, epoch sanity), and returns CORS-open JSON.
3. If the proxy itself is unreachable, the client falls back to **one direct
   browser fetch** of a CORS-open mirror, then to cached/packaged telemetry.

**Implication for new external-data features**: any fetcher that proves
unreliable in the field should get a matching serverless proxy
(e.g. `api/weather.ts` proxying Open-Meteo for `GeoLookupService`, which
currently fetches weather direct-from-browser — fine today because it is
CORS-open and reliable, but it has no server-side fallback path yet). Follow the `api/tle.ts` structure: multiple upstreams, server-side
validation, CORS headers, and a direct-browser fallback in the client. Also
note new `api/*.ts` functions need an entry in `vercel.json` → `functions`.

## Next steps

`docs/NEXT_STEPS.md` holds the current ranked menu of candidate work — read
it next. As of 2026-10-25 the top of that list is:

1. Re-check the live deployment after the wave 1–2 merges: `/models/*` and
   `/textures/*` answering `immutable` with `?v=<asset hash>`; `/robots.txt`,
   `/sitemap.xml`, `/og-image.png` 200. Then a human visual pass on the
   penumbra fade, the countdown, the ground track and the Bloom MSAA edges. On
   a throttled connection, Locate must depart on the detailed LOD (not the
   schematic) at Follow, with the full model appearing only below 200 km.
2. **B.3 — next visible pass** (reuse `isSunlit` and the forecaster pattern;
   needs CSP and `Permissions-Policy` changes for city search and geolocation).
3. D.6's remainder and C.4 accessibility (C.5, the changelog and
   Dependabot, landed 2026-10-26).
