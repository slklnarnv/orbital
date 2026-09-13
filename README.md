# Orbital

Real time visualization of the International Space Station

[Live demo](https://orbitaliss.vercel.app) · [Source](https://github.com/slklnarnv/orbital)

Orbital propagates public Two-Line Element sets with SGP4 and renders the result in a kilometer-scale Three.js scene. A fixed-rate runtime advances simulation independently of WebGL; the renderer interpolates those snapshots while Earth rotates by Greenwich Mean Sidereal Time beneath the ISS's TEME-derived inertial trajectory.

## Highlights

- SGP4 propagation at 10 Hz, decoupled from React and the WebGL frame loop
- Display rate interpolation without altering simulation truth
- Validated TLE acquisition through a CDN-cached Vercel function, IndexedDB cache, and packaged fallback
- Custom GLSL for the day/night terminator, ocean response, clouds, atmosphere, Sun, and orbit trail
- Multi modal camera system with distance aware sensitivity and ISS tracking
- Ground context with place, local time, and weather
- LOD ISS rendering to improve load time performance
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

| State | Meaning |
| --- | --- |
| `LIVE` | An element set less than 24 hours old is available while online |
| `HYBRID` | An element set between one and seven days old is available while online |
| `OFFLINE` | Local data is being propagated while the browser is offline |
| `RECOVERY` | Data is missing or stale and bounded retries are in progress |

The packaged TLE seeds propagation synchronously. Cached entries expire after seven days; the packaged fallback remains available when no valid cache or network response exists. TLE replacement is transactional and blended over two seconds to avoid a visible position discontinuity.

## Ground context

The HUD pairs orbital telemetry with a station-centered ground-track globe and a one-revolution phase tape. BigDataCloud supplies land or marine-region names; Open-Meteo supplies timezone data and current weather for the local ground clock. Results are grouped into 2° cells, cached in memory and IndexedDB, and refreshed under independent rate limits with bounded backoff.

These enrichment requests run directly from the browser, so the current ground coordinates and client network address are visible to those providers.

## Technical notes

Orbital is a visualization, not a navigation or conjunction-analysis tool. Positions are SGP4 estimates derived from public TLEs rather than spacecraft telemetry, and accuracy degrades as an element set ages.

The Earth renderer uses a spherical `6,371 km` radius while the project computes telemetry coordinates against WGS84. The ISS model is intentionally enlarged by roughly `1,000×` so it remains legible at orbital scale. Its detailed model is loaded only at close range; the visualization propagates position, not spacecraft attitude.

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
public/                 Runtime textures, ISS models, Draco decoder
docs/                   Handoff and browser verification notes
scripts/                Asset-budget and shader-contract checks
src/
├── core/               Runtime, clock, propagation, telemetry, geo lookup
├── interaction/        Camera state machine, tracking, sensitivity
├── rendering/          Scene graph, Earth, ISS, interpolation, shaders
├── stores/             UI-facing Zustand stores
├── ui/                 Mission clock, gauges, ground track, orbit tape
└── types/               Shared domain types
tests/unit/              Core, API, camera, rendering, and shader tests
```

## Development

Requires Node.js 20 or later.

```bash
git clone https://github.com/slklnarnv/orbital.git
cd orbital
npm ci
npm run dev
```

```bash
npm run verify      # Assets, shaders, types, tests, and production build
npm run test        # Vitest in watch mode
npm run preview     # Serve the production bundle locally
```

`npm run verify` is the release gate. It enforces a 5 MiB initial visual-asset budget, validates shader ramps, runs TypeScript and unit tests, and builds the production bundle.

Vercel deploys `api/tle.ts` as the `/api/tle` function and applies immutable caching to fingerprinted build assets. On other static hosts, the browser can use its direct `wheretheiss.at` fallback plus cached or packaged TLE data.
