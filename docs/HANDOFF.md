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
- `controls.moveTo(x, y, z, false)` moves ONLY the target, never the eye
  (the old code comment claiming lockstep is wrong).
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
