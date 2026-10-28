# Handoff — ORBITAL internals
> Model rig/pipeline authority: docs/ISS_MODEL_CONTEXT.md (+ docs/MODEL_AUDIT.md).
> Front door with reading order + invariants: CLAUDE.md.

Reference facts for the HUD, the geo service and the camera system. Read
this before touching them. Session logs moved to `plans/PROGRESS-history.md`
(2026-10-28).

## Reference

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
  + the tool row (Passes, Modules, Settings: `.hud-tool`, a `ToolIcon` and a
  label each) + camera control (rule: *controls top, data bottom*);
  bottom-left = speed / altitude bare gauges; bottom-center = UTC clock (Zulu
  suffix) over the orbit tape; bottom-right = ground cluster alone;
  full-width orbit tape along the bottom edge.
  Left edge, vertically centred (`.hud-explorer`): the module explorer card,
  shown while open (017 X1). Modules opens it from anywhere: Locate first,
  then it opens on arrival (`moduleExplorerControl.ts`).
- **Tour** (`src/ui/tour/`): the first-visit guided tour, a modal overlay
  (`'tour'`). Each step names a control by selector; a HUD control the tour
  points at keeps its id (`#btn-passes`, `#btn-module-explorer`,
  `#btn-settings`, `#btn-about`) or `TOUR_STEPS` changes with it. A missing
  target centres the card instead of failing.
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
- **Identity and loading**: the mark is an orbit ellipse that brightens
  toward a station glint (`scripts/build-icons.mjs`, geometry mirrored in
  `src/ui/loading/bootMark.ts`; `bootMarkSync.test.ts` guards the copies in
  `index.html` and `src/index.css`). The loading screen (`.boot-*`) is
  painted first by a static copy in `index.html`, then `LoadingScreen.tsx`
  takes over. Its stage counts come from wrapping `DefaultLoadingManager`'s
  `itemStart/itemEnd/itemError` (`assetLoadTracker.ts`, first import in
  `main.tsx` so the module-scope preloads are seen); the gate is every file
  ended with both the Earth and station stages started.
- **Honest-instrument rule**: nothing renders without real data behind it —
  unknowns show "—", decoration that encodes nothing gets removed (the gauge
  tick-arcs were cut for exactly this reason).
- **Responsive frame (plan 017 R1–R6)**, breakpoints in `src/index.css`:
  - `max-width: 639px` (and touch tablets in portrait up to 899 px): one
    bottom composition — clock row, then gauges | ground row (globe beside
    its lines; the weather line is dropped on phones);
  - `max-height: 500px` (landscape phones): one top row, one bottom row
    (gauge values · time + transport · place + coordinates) and a thin tape
    whose hit area runs under the row (the row passes touches through except
    on buttons). Budget: the HUD stays ≤ 30% of the height;
  - `pointer: coarse`: every control ≥ 44×44. Grow hit areas with padding
    plus an equal negative margin, never with bigger glyphs, and widen gaps
    where two hit areas would meet. Inputs are 16 px (iOS focus zoom);
  - QHD and up: whole clusters `zoom: var(--hud-zoom)` (steps 1.15–1.9).
    Under `zoom`, absolute lengths scale (vw-based ones included) and
    percentages do not, so the ultrawide `--hud-gutter` is divided by the
    zoom;
  - type floor: nothing below 9 px (`--hud-fs-micro`, `--hud-fs-place`). A
    line that does not fit at 9 px is hidden, not shrunk.
- **HUD-aware framing (R2)**: while tracking, `HudAwareFraming` shifts the
  projection (`camera.setViewOffset`) so the station centres in the band the
  HUD leaves free. It measures cluster boxes (popovers excluded, the tape by
  its line), so a new HUD cluster joins `HUD_SELECTORS` there. Anything that
  projects to the screen by hand from fov and aspect must add the offset
  (`viewOffsetNdc` in `SunFlare.ts`).
- **Viewport audit**: `tests/e2e/viewport.spec.ts` asserts the above at nine
  sizes; run it after any HUD layout change.

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
| `src/ui/loading/LoadingScreen.tsx` | Staged loading screen; pure stage logic in `bootProgress.ts`, store in `src/stores/bootStore.ts` |
| `src/ui/common/telemetryModeVisual.ts` | Mode → label/dot/color mapping |
| `src/interaction/camera/HudAwareFraming.tsx` + `hudFraming.ts` | R2 projection shift (DOM measure + pure band math) |
| `src/rendering/scene/renderScale.ts` | DPR ceiling and the pinned render-scale override (`AdaptiveDpr` in SceneRoot) |
| `tests/e2e/viewport.spec.ts` | Viewport audit (layout, 9 px floor, 44 px targets, station framing under `E2E_DEV=1`) |
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

- **Module explorer focus (017 X1)**: while tracking, the target is the
  station centre plus `FocusTween.current` (station-local), read from the
  focused module's anchor mesh through its CURRENT local transforms
  (`pointInAncestor`; `matrixWorld` is a frame old) and the station's
  current attitude, before the tracking `update(0)`. The eye is pushed out
  to `explorerMinDistanceKm(explode, |focus|)` each frame (an orbit of that
  radius about the target encloses the grown clearance sphere) and
  `AppCameraControls` raises `minDistance` to the same floor. Mode
  decisions still use the station centre. The explode is applied at
  priority −2 so the camera reads this frame's pose.
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
  the up, set the pose. It carries the rendered AND the end pose and keeps the
  `_isUserControlling*` flags (`carryControls`, same pattern as `rotateOrbit`):
  carrying only the rendered pose reset the end pose every running frame, so
  a wheel dolly while tracking stalled after one frame of smoothing.
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
  does not reset sensitivity. Rotation and pan also scale by
  `getNearGroundScale` (2 × clearance / pivot distance, capped at 1): with the
  pivot far beyond the ground in view (Free after an overview pan, zoomed in;
  Orbital at its closest) the ground tracks the cursor ~1:1 instead of ~25:1. Right-drag/touch pan releases tracking on actual motion;
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
- Debug hook (dev and bench builds): `window.__orbitalControls` (set in `AppCameraControls`).

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
- **`__orbitalScene` and the other `__orbital*` hooks exist in dev and bench
  builds only** (`DEBUG_HOOKS`, `src/utils/debugHooks.ts`). Inspecting the
  scene graph works on `npm run dev` (5173) or a bench build
  (`vite build --mode bench`, what `npm run bench` serves), never on the
  production `vite preview` (4173).
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

