# Session Handoff — ORBITAL UI

Handoff notes for the next session working on this repo. Read this before
touching the HUD, the geo service, or the camera system.

## Where things stand

**Project**: ORBITAL — real-time ISS orbital visualization (React 18,
TypeScript strict, Vite 6, React Three Fiber + three r170, Tailwind v4,
zustand 5, satellite.js). Cloned from `github.com/slklnarnv/orbital`; `.git`
was stripped during copy, so this working tree is **not** a git repo — the
original remote is the source of truth for history.

**Run / verify**:

```bash
npm install        # already done
npx vite --port 5199 --strictPort   # dev server (was running at time of handoff)
npm run verify     # asset budget (3.81 MiB) + shader ramps + tsc + 76 tests + build
```

All green at handoff. Known pre-existing warning: `three-core` chunk > 500 kB.

## What this session changed (chronological)

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
  Chivo Mono (fine ephemeris). Loaded in `index.html`.
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
| `src/ui/common/HudGauge.tsx` | Bare gauge readout |
| `src/ui/common/telemetryModeVisual.ts` | Mode → label/dot/color mapping |
| `src/core/geo/GeoLookupService.ts` | Place + local time + weather service |
| `src/stores/geoStore.ts` | Geo presentation state (written by the service only) |

### Geo service facts (easy to get wrong)

- **BigDataCloud** `reverse-geocode-client` for place naming — NOT OSM
  Nominatim; Nominatim's public reverse endpoint returns "Unable to geocode"
  over open ocean at every zoom (verified). BigDataCloud gives
  country+continent over land and the marine region in `locality` over water.
- **Open-Meteo** forecast for temperature, WMO weather code, IANA timezone and
  UTC offset (local clock derives from the offset, not the tz name).
- Both keyless/CORS. Rate limited via `ApiRateLimiter` (~10 s cadence,
  exponential backoff). Cache: 2° ground cells in memory + IndexedDB
  (`idb-keyval`, prefix `geo_cell_`), places 30 days, weather 15 min.
- Ticks every 5 s; first tick delayed 3 s and gated on a real telemetry fix
  (the store's 0,0 seed must not trigger a lookup).
- Every failure keeps the last good snapshot on screen.

### Camera system facts (harder to get wrong)

- drei's CameraControls `update()` runs at `useFrame` priority **−1** — before
  `ISSGroup`/`CameraController` advance the spacecraft each frame. Anything
  that needs the rendered camera to match *this frame's* ISS must call
  `controls.update(0)` after moving the target (see the tracking branch of
  `CameraController` — this was the close-range jitter fix, verified 0 px over
  240 frames at 60 km).
- `controls.moveTo(x, y, z, false)` snaps the target immediately. It is appropriate
  for tracking, but must not run during a cinematic flight. Overview/local Locate
  retains the two-second `lerpLookAt` path; Reset View and close-Earth departures use
  `CameraFlightPath`, sampled by the same frame-owned transition lifecycle.
- Locate requests detail before departure. `loadingStore.issDetailStatus` covers
  downloading, GPU preparation, ready, and failure; `ISSModel` uploads textures over
  separate frames, compiles against scene lights, and primes buffers with a zero-area
  scissor. Keep preparation out of the flight and restore shared renderer state.
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
  after each variant produced its own jank. Keep it simple. Flight time scales
  with the sweep angle (350 ms/rad) plus a distance term
  (min(2000, max(0, startRadius − 20,000) × 0.025) ms).
- Flight horizon (`FlightHorizon`): the captured up is transported with the view
  each frame and blended onto the world-up horizon by progress
  (`error × smoothstep(0, 0.6, progress)`). Do NOT restore a rate-limited roll
  chase: correcting the full roll error every frame while a big sweep kept
  regenerating it spun the image 194° on an 86° flight (the "round and round,
  dizzy" report). The blend starts exactly at the captured orientation (no snap,
  rolled free-orbit departures included), stays near level mid-flight, and lands
  exactly level at arrival. Corrections freeze near the world-up singularity
  (projected-length weight) and are rate-capped (2.5 rad/s), because routes
  passing over the scene's poles swing the projected horizon wildly.
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
  35,000/33,000 km entry/exit band; all manual ISS modes share 60 km model clearance.
- Rotation and dolly response follow pivot geometry continuously, so entering Free
  does not reset sensitivity. Right-drag/touch pan releases tracking on actual motion;
  orbit and centered pinch retain lock. The zoom meter uses the actual pivot distance.
- Reset View requests a 2.2-second Earth transition through the camera store. It
  eases to the 25,000 km overview (farther for portrait framing), without model/TLE
  readiness gates. Automatic zoom-out handoffs still preserve pending user motion.
- Timed flights bypass the manual constraint, including the final frame. Reset
  stays on the current radial bearing; close-Earth Locate follows a safe spherical
  route. Do not apply a second camera correction after a flight's sampled pose.
- Curved Locate is one continuous gesture: the eye sweeps a great-circle route
  at monotonic radius (departure radius → the chase standoff, never a cruise
  climb), and the view makes a single eased turn onto the station's live
  bearing (`CameraFlightPath.sampleLocate`). The view aims through the surface
  at where the station will crest, so the ground fills the frame the whole way
  and the station rises into an already centered view. Do not reintroduce
  horizon-level "cruise" looking or two-stage view turns — they read as a
  zoom-out followed by a zoom-in. The arrival standoff is captured at planning
  time and applied rigidly to the live station.
- Modes classify rendered distances, not queued endpoints. Planetary has a
  35,000/33,000 km entry/exit band; all manual ISS modes share 60 km model clearance.
- Leaving a FREE pan on zoom-out is decided by
  `CameraStateMachine.isFreeZoomOut`: release at `max(220 km, 1.25 × the pivot
  distance when the pan began)`. The floor matches INSPECT's own exit band, so
  escaping a close inspect pan takes about the same gesture as leaving INSPECT
  (~1.5× at a 150 km orbit) instead of demanding a 3,300 km pivot distance.
  Zooming in never releases FREE.
- Reset and flight orientation transports the horizon through polar views and
  settles toward world-up before handoff. This avoids the 180° roll flip of a
  fixed-up lookAt.
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
(e.g. `api/geo.ts` proxying BigDataCloud + Open-Meteo for
`GeoLookupService`, which currently fetches direct-from-browser — fine today
because both are CORS-open and reliable, but it has no server-side fallback
path yet). Follow the `api/tle.ts` structure: multiple upstreams, server-side
validation, CORS headers, and a direct-browser fallback in the client. Also
note new `api/*.ts` functions need an entry in `vercel.json` → `functions`.

## Next steps

`docs/NEXT_STEPS.md` holds the ranked menu: ① time controls (recommended
first — `SimulationClock.setMode('ACCELERATED')` / `setTimeScale()` already
exist and are tested; work is mostly HUD wiring), ② ground track + passover
prediction, ③ solar array sun-tracking, ④ NASA glTF model (beware the asset
budget gate). Deliberate non-goal: more HUD polish.
