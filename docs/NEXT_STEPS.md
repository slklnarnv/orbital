# Next Steps - ORBITAL

> Front-door order: `CLAUDE.md` -> this file -> `plans/PROGRESS.md` (short
> ledger; history in `plans/PROGRESS-history.md`). Deep docs load on demand
> (see CLAUDE.md). Keep the Current state section fresh in the same commit as
> behavior changes - never ship an errata banner, fix the stale text instead.

## Current state (2026-10-08)

- PR #12 merged: tooling + CI, guarded `/api/tle`, CSP + self-hosted fonts,
  DPR governor, ISS wing gimbals (BGA), Nauka hull fix, lens flare rework,
  joint smoothing caps. Details: `plans/PROGRESS.md`.
- In progress: nothing.
- Green: `npm run verify` (unit suite + build), CI, Vercel deployment.

## Next (ranked)

1. Check the live deployment: console free of CSP errors; `/api/tle` 200 with
   its cache header; `/api/tle?x=1` 404; Nauka, wing tilt and flare up close.
2. Faster Locate on fresh load - roadmap C.6 below (texture-upload batching +
   network warm; deep cut = KTX2/meshopt via C.2).
3. Roadmap B.1-B.3: orbital day/night countdown, ground track + footprint,
   next visible pass from a location.
4. Playwright smoke suite (needs install; postponed twice).
5. Optional realism: park/feather arrays mode (BGAs hold in eclipse), TRRJ
   thermal profile (P2).

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
   `L` / `H` / `R` shortcuts (item 2), a high-contrast HUD class.
5. **Release routine.** Scheduled CI job running `npm run refresh:tle` that
   opens a PR when the fallback changes; a short `CHANGELOG.md`.
6. **Faster Locate (fresh load).** Locating on a cold session waits for the
   full high-fidelity pipeline, and the user report is that it is slower than
   it should be. The cost chain, from code (no profiling done yet): network
   fetch of `iss_igoal.glb` (19.6 MiB; HTTP-cached 1 h afterwards) → Draco
   decode of ~2.67 M triangles in a worker → `prepare()` in `ISSModel.tsx`
   uploading **73 textures one per frame** (≈73 frames ≈ 1.2–2.4 s of pure
   yielding) → `compileAsync` → scissor prime. Locate's departure gate waits
   for all of it (deliberate: a mid-flight model pop was rejected in
   fd5d353/plan 001 R2 — do not reopen that without a measured reason).
   Minimal cuts, in order:
   a. **Batch the texture uploads** on a per-frame time budget (~6 ms/frame)
      instead of one texture per frame — removes the single biggest pure-yield
      cost, no visual risk. Touches: `ISSModel.tsx` `prepare()`.
   b. **Warm the network fetch** of the GLB after boot idle (~5 s) and on
      Locate hover/focus: a low-priority `fetch` into the HTTP cache
      (`max-age=3600` already set), connection-gated (skip on
      `saveData`/2G), silent failure, once per session. Deliberately use a
      bare fetch, NOT `useGLTF.preload`: a failed preload fires the
      `DefaultLoadingManager` error hook that maps to the terminal
      "ISS unavailable" state. Touches: new small module +
      `CameraCluster` hover/focus.
   c. Only if still slow after a+b: the deep fix is decode/upload cost —
      KTX2/Basis textures and meshopt instead of Draco+WebP (fold into C.2,
      which already covers the texture half).

Suggested order: A.1 → A.3 → B.1 + B.2 → B.3 → A.2 → C.2 (C.6a is cheap
enough to ride along with any pass).

## Older items - status folded into the roadmap

- **Perf run (old item 0).** Baseline MEASURED 2026-10-04 (history:
  "Open-items pass" in `plans/PROGRESS-history.md`): overview and 300x are
  vsync-steady 60 fps; Bloom is free; close-up High-fidelity ISS is the only
  measurable cost (~5% of frames at 30 fps). Remaining: the matrix on other
  GPUs, plus the C.6 cuts. Original suspect list + gate constraints live in
  that history entry - still the rules for any perf change.
- **Quick wins (old item 1).** Orbit line/terminator/glint/bloom: done
  (2026-09-28/29). Lens flare: reworked 2026-10-04. Still open, small:
  Branding pass (favicon/loading-screen assets exist), Hide-HUD toggle
  (`H`), Info/About panel (doubles as roadmap B.7 "What's real").
- **Time controls (old item 2).** DONE 2026-09-28. Remaining: `L` / `H` / `R`
  shortcuts -> roadmap C.4.
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