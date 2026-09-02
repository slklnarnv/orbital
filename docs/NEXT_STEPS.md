# Next Steps

A ranked menu of candidate features, ordered by value-per-effort. This is a
working note, not a commitment — items graduate into the main README roadmap
when work starts.

## 1. Time controls — recommended first (Phase 3C)

Pause, real-time, and accelerated modes (10× / 60× / 300×), with keyboard
shortcuts (Space = pause, L = locate ISS).

The simulation core already supports this: `SimulationClock` implements
`setMode('ACCELERATED')` / `setTimeScale()` and is unit-tested, but nothing in
the UI exposes it. The work is mostly HUD wiring — a small control cluster near
the mission clock — plus one design decision about which clock surfaces
rescale (UTC readout should keep ticking real time while the *simulation* time
accelerates, or the readout should show simulation time explicitly).

Highest effort-to-delight ratio on this list: the orbit tape, ground-point
place names, and passing-over weather all start telling a story when an orbit
can be flown through in seconds.

## 2. Ground track + passover prediction (Phase 3C)

Two sub-features:

- **Upcoming ground track**: project the propagated ground path ahead of the
  sub-satellite point onto the ground-track globe (already orthographic —
  add the path polyline behind the station marker).
- **Passover prediction**: for a chosen observer location, compute the next
  visible pass (rise/set times, max elevation). Needs observer-location input
  and pass-math (elevation above horizon mask), which is new but
  `satellite.js`-feasible.

## 3. Solar array sun-tracking (Phase 3B, quick win)

Rotate the ISS model's array groups toward the sun direction each frame. The
sun vector is already computed for the terminator shader, and the arrays are
separate meshes in the placeholder model. Small, physically honest, visible
in close-up inspection views.

## 4. NASA glTF ISS model + per-module interaction (Phase 3A)

The big visual upgrade — and the big lift:

- The model asset will collide with `scripts/check-asset-budget.mjs`
  (current static budget: 3.81 MiB); either raise the budget or stream the
  asset.
- Per-module raycasting, hover highlight, and selection (Layer 4) plus the
  4-level LOD pipeline with alpha crossfades is a substantial rendering-
  layer project on its own.

Do this after 1–3, or scope it as its own phase.

## 5. Serverless proxy for the geo/weather lookups (deployment hardening)

The app is hosted on Vercel precisely so unreliable end-user networks don't
break external API fetches — `api/tle.ts` already does this for telemetry
(proxy-first in the client, direct-browser fallback, then cache). The
`GeoLookupService` (BigDataCloud + Open-Meteo) currently fetches
direct-from-browser only. If field reports show those calls failing on bad
networks, add `api/geo.ts` following the `api/tle.ts` structure (multiple
upstreams, server-side validation, CORS headers, `vercel.json` functions
entry) and flip `GeoLookupService` to proxy-first with the current direct
fetch as the fallback.

## Not now

More HUD polish. The console design system is stable and verified; the
marginal pixel is no longer where the value is.

---

## Debugging note (camera)

The dev build exposes the camera-controls instance as
`window.__orbitalControls` (set in `AppCameraControls`, DEV-only). Frame-order
context for anyone touching the camera: drei's CameraControls `update()` runs
at `useFrame` priority −1, i.e. *before* `ISSGroup` and `CameraController`
advance the spacecraft each frame. Any consumer that needs the camera pose to
match *this frame's* rendered ISS must call `controls.update(0)` after moving
the target — see the jitter fix in `CameraController`'s tracking branch.
