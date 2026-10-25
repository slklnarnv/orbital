# Orbital

Real time visualization of the International Space Station

[Live demo](https://orbitaliss.vercel.app) · [Source](https://github.com/slklnarnv/orbital)

Orbital propagates public Two-Line Element sets with SGP4 and renders the result in a kilometer-scale Three.js scene. A fixed-rate runtime advances simulation independently of WebGL; the renderer interpolates those snapshots while Earth rotates by Greenwich Mean Sidereal Time beneath the ISS's TEME-derived inertial trajectory.

## Highlights

- SGP4 propagation at 10 Hz, decoupled from React and the WebGL frame loop
- Display rate interpolation without altering simulation truth
- Simulation time controls: pause, 1×–300× acceleration, absolute UTC seeks, and a scrubbable revolution tape
- Validated TLE acquisition through a CDN-cached Vercel function, IndexedDB cache, and packaged fallback
- Custom GLSL for the day/night terminator, ocean response, clouds, atmosphere, Sun, and orbit trail
- HDR bloom compositing with an optional Earth-occluded lens flare, toggleable in render settings
- Day/night countdown with a modelled penumbra: a sunset or sunrise timer under the gauges, and ISS lighting that fades through the terminator
- Ground track on the HUD globe, plus an optional 3D track and visibility footprint
- Multi modal camera system with distance aware sensitivity and ISS tracking
- Animated ISS parts (sun-tracking arrays, radiators, cameras) on the authored joint hierarchy
- Ground context with place, local time, and weather
- LOD ISS rendering: a fast Locate/Follow tier and the full model for close inspection
- WebGL capability checks and context loss recovery

## Architecture

```text
SimulationRuntime (10 Hz)
├──> SimulationClock ──> SimulationTime
└──> TelemetryManager <── /api/tle <── TLE providers
         └──> OrbitalEngine ──> OrbitalState snapshots
                  ├──> render interpolator ──> Three.js
                  └──> Zustand (1 Hz) ──> HUD
```

The core orbital layer has no rendering dependencies. A recursive scheduler advances the clock and telemetry without overlapping callbacks, even when the browser throttles a background tab. Rendering interpolates immutable 10 Hz snapshots and mutates Three.js objects directly; UI-facing state is published at 1 Hz.

A few invariants define the scene:

- `1` world unit equals `1 km`.
- Earth is an Earth-fixed group rotated by GMST.
- ISS and orbit geometry remain at the scene root in inertial coordinates.
- TEME axes map to Three.js as `(x, z, -y)`.
- The orbit line spans half an orbit behind and ahead, sampled every 30 simulation seconds and regenerated every 60 simulation seconds.

## Data resilience

The `/api/tle` function races CelesTrak's two domains and `wheretheiss.at`, validates the first successful response, and serves it with CDN caching. If the function is unreachable, the browser makes one direct request to `wheretheiss.at` before falling back to local data. Successful responses are validated again and cached in IndexedDB.

| State | HUD label | Meaning |
| --- | --- | --- |
| `LIVE` | Live | A CelesTrak element set fetched less than 24 hours ago is available while online |
| `HYBRID` | Cached | An element set fetched less than seven days ago is available while online but does not qualify as Live (older than a day, or not from CelesTrak) |
| `OFFLINE` | Fallback | Local data is being propagated while the browser is offline |
| `RECOVERY` | Recovery | Data is missing or stale and bounded retries are in progress |

LIVE and HYBRID age is measured from when the element set was fetched, not from its epoch (the packaged fallback is aged from its epoch). This is deliberate: CelesTrak sets are routinely 12 to 36 hours old at download, so epoch age would make a fresh fetch read as Cached.

The packaged TLE seeds propagation synchronously. Cached entries expire after seven days; the packaged fallback remains available when no valid cache or network response exists. TLE replacement is transactional and blended over two seconds to avoid a visible position discontinuity.

## Ground context

The HUD pairs orbital telemetry with a station-centered ground-track globe and a one-revolution phase tape. BigDataCloud supplies land or marine-region names; Open-Meteo supplies timezone data and current weather for the local ground clock. Results are grouped into 2° cells, cached in memory and IndexedDB, and refreshed under independent rate limits with bounded backoff.

These enrichment requests run directly from the browser, so the current ground coordinates and client network address are visible to those providers. Under accelerated time the service holds new lookups — a ground point racing through cache cells would otherwise churn requests — while the coordinates stay live and enrichment resumes automatically on Live.

## Time controls

The clock can be paused, accelerated up to 300×, or returned to the wall clock with Live; Live snaps exactly to wall time rather than gliding back. A seek popover accepts an absolute UTC timestamp with one-minute, ten-minute, and one-orbit nudges, clamped to a week from the present. The revolution tape along the bottom edge doubles as a scrubber — drag for a continuous seek, click to jump, arrow keys for one-minute steps — and Space toggles pause. Seeking detaches from real time into pause; resuming Live re-pins to the wall.

## Technical notes

Orbital is a visualization, not a navigation or conjunction-analysis tool. Positions are SGP4 estimates derived from public TLEs rather than spacecraft telemetry, and accuracy degrades as an element set ages.

The Earth renderer uses a spherical `6,371 km` radius while the project computes telemetry coordinates against WGS84. The ISS model is intentionally enlarged by roughly `1,000×` so it remains legible at orbital scale. Close-range detail is two-tier: a derived ~6.2 MiB Locate LOD (`public/models/iss_igoal_locate.glb`, 787k triangles) loads on Locate hover/focus, a Locate request, or near-range entry and covers Follow; the full 27 MiB IGOAL model (2.67M triangles) loads only when the camera enters Inspect (below about 200 km). Neither is part of the initial download. Locate waits for the fast tier's decoding, GPU uploads, and shader preparation before departure, for at most 8 seconds — a stalled download departs on the committed model and the tier swap happens whenever it finishes. Every Locate flight is a single great-circle sweep onto the station with no pullback detour; its duration is a 2 s base, plus 350 ms/rad of sweep angle, plus up to two extra seconds for departures far beyond the 20,000 km overview (so roughly 2 to 5 s), and distant approaches take longer without compressing into a blink. Under `prefers-reduced-motion` the same path flies in 35% of the time. Failed full-detail loads keep the committed detailed tier; a failed first tier retains the fallback and can be retried with Locate. The visualization propagates position, not spacecraft attitude.

## ISS model

The model is the IGOAL-derived asset (`public/models/iss_igoal.glb`) with the station's real part hierarchy. Close range is two-tier: `iss_igoal_locate.glb` (derived LOD, ~6.2 MiB, 787k triangles, 512 px textures) drives Locate/Follow, and the full `iss_igoal.glb` (2.67M triangles) loads inside about 200 km. Both keep the 12-joint rig (static geometry is batched per rigid part, about 200 draw calls for the full model) and the animations, and the incoming tier continues the outgoing tier's joint angles, so the swap does not change the station's pose. Materials are the authored IGOAL PBR set (metallic-roughness maps included) and textures are GPU-compressed KTX2. The **Render Settings** switches between animated high fidelity and the static legacy fallback models. Beyond about 150 km the station is marked by a light-blue screen-space glint.

Solar arrays track the Sun and the thermal radiators run a bounded demo motion, all driven through the asset's authored joint hierarchy. The animation details live in `src/rendering/iss/ISSJointKinematics.ts`.

Rebuilding the assets requires the two NASA IGOAL sources (not in the repo; published as the `source-assets-igoal` release asset `ISSTEST.zip`) and KTX-Software ≥ 4.3 (`ktx`, or `KTX_BIN`). The FBX supplies the geometry and part hierarchy, the GLB the authored materials; the Locate LOD is then derived from the high build's master:

```bash
node scripts/build-iss-model.mjs "ISSTEST/International Space Station (ISS) (D) (IGOAL).fbx" \
                                 "ISSTEST/International Space Station (ISS) (D) (IGOAL).glb"
npm run build:iss-lod
```

## Render settings

The gear popover switches the ISS model quality, the orbit-line style (continuous or dashed with an on-screen-constant dash pitch), HDR bloom, and the "Ground track" switch (an optional 3D track and visibility footprint on the globe, off by default). Bloom composites the frame through UnrealBloom and an output pass; with it off, rendering is exactly the direct pipeline. When bloom is on, a lens-flare pass — a warm halo and faint iris ghosts, gated by Earth occlusion and the frame edge — is available and defaults to off.

## Camera controls

- Drag to orbit; scroll or pinch to zoom. Response becomes finer near Earth and in ISS close-ups.
- Right-drag or two-finger pan moves the pivot and releases tracking into Free mode. Ordinary orbiting and centered pinches keep the ISS locked. Zooming well out of a Free pan hands navigation back to Earth view — after about the same gesture that would leave Inspect (~1.5× at close range), never a huge zoom demand.
- **Reset View** appears as soon as the view leaves its home framing — any orbit, zoom, or pan, in any mode — and uses a 2.2 s eased transition (plus up to ~0.8 s to settle roll) to a 25,000 km Earth overview, moving farther out on narrow screens so the globe and orbit fit. It keeps the current viewing side, turns smoothly even from an outward-facing Free view, does not wait for ISS detail loading, and hides again once it arrives.
- **Locate ISS** always re-flies to the station, including while already tracking it or mid-flight — a new press re-captures the flight from the current pose (from the canonical tracking framing it is visually a no-op). Flights turn the view onto the station and approach at the same time — once the station is centered it stays pinned — and hand their orientation back to manual navigation without a roll snap. Under accelerated time the flight path is carried with the station's motion, so Locate still lands on it at 300×.
- Zoom labels describe the current view, with hysteresis at their boundaries. All manual ISS modes share a 70 km model-clearance limit.
- Manual navigation stays outside a 6,500 km Earth-center radius. Collisions slide along that boundary; blocked pans keep the camera and pivot together. Rotation orbits over both poles Google-Earth style, without gimbal stops. Close-Earth Locate arcs around the globe at low altitude while the view sweeps across the surface onto the station, so the ground fills the frame until the station crests into view — no pullback detour.

## Stack

- React 18, TypeScript, Vite
- Three.js, React Three Fiber, Drei
- `satellite.js` for SGP4 propagation
- Zustand for application state
- Tailwind CSS and custom GLSL
- `idb-keyval` for local persistence
- Vitest and repository-specific asset/shader checks

## Project layout

```text
api/                    Vercel TLE function
public/                 Runtime textures, ISS models, fonts, Draco decoder
docs/                   Model context/audit, handoff notes, roadmap
plans/                  Plan ledger, plans and status records
scripts/                Model/LOD build pipeline, fallback-TLE refresh, asset-budget and shader checks
.github/workflows/      CI verify (plus e2e) and the scheduled fallback-TLE refresh
src/
├── core/               Runtime, clock, propagation, telemetry, geo lookup
├── data/               Packaged fallback TLE
├── hooks/              React bindings to the runtime and HUD state
├── interaction/        Camera state machine, tracking, sensitivity
├── rendering/          Scene graph, Earth, ISS, interpolation, shaders
├── stores/             UI-facing Zustand stores
├── types/              Shared domain types
├── ui/                 Mission clock, gauges, ground track, orbit tape
└── utils/              Constants, formatters, math, asset URLs
tests/
├── unit/               api, build, camera, clock, geo, orbital, rendering, runtime,
│                       shaders, stores, telemetry, ui, utils (Vitest, node env)
└── e2e/                Playwright smoke suite
```

## Development

Requires Node.js 22 or later.

```bash
git clone https://github.com/slklnarnv/orbital.git
cd orbital
npm ci
npm run dev
```

```bash
npm run verify      # Assets, shaders, types, lint (0 warnings), unit tests, and production build
npm run test        # Vitest in watch mode
npm run test:e2e    # Playwright smoke suite against the production preview
npm run preview     # Serve the production bundle locally
```

`npm run verify` is the release gate. It enforces a 5 MiB initial visual-asset budget, validates shader ramps, runs TypeScript, ESLint (zero warnings) and the unit tests, and builds the production bundle.

Vercel deploys `api/tle.ts` as the `/api/tle` function, applies immutable caching to fingerprinted build assets, and sends baseline security headers (`nosniff`, frame denial, referrer and permissions policies) on every route. On other static hosts, the browser can use its direct `wheretheiss.at` fallback plus cached or packaged TLE data.
