# Browser verification

Run these checks against a production build in a hardware-accelerated browser after
camera, shader, asset, or scene changes.

## Cold-start Locate

1. Disable the browser cache and reload. Before hovering or focusing Locate,
   confirm the detailed ISS model has not been requested.
2. Press Locate. While “Loading ISS” or “Preparing ISS” is shown, the camera must
   stay put and repeated presses must not restart the request.
3. From the initial overview, confirm “Locating ISS” starts only after preparation
   and a short (~2 s) flight remains smooth, with no target snap,
   low-poly arrival, or model-loading stall. Repeat from a local ISS view.
4. Repeat Locate: no new model request or preparation delay should occur.
5. While tracking the station at any zoom and orientation, press Locate again.
   It must re-fly to the station smoothly (from the canonical framing this is
   visually a no-op) — never a swing through the model or a snap. Pressing it
   mid-flight must re-capture the flight from the current pose without a jump.
6. With a throttled model request, drag the scene during preparation. After the
   model finishes loading, the cancelled flight must not start. Also drag or
   scroll during a flight: it must release into Free mode without jumping to the
   destination and without a roll snap at the release frame.
7. Block the detailed model request. Locate must still complete using the low-poly
   model, show “Low detail”, and avoid retrying at the near-range boundary. Unblock
   the request and press Locate again to confirm recovery to the detailed model.
8. Every flight completion (Locate and Reset) must be frame-continuous: no
   position step above a few km and no visible orientation change on the first
   tracking frame after the flight.

## Locate detail tiers

Run against a production build with the network throttled (or cache disabled)
after a reload. The `high` setting now loads a fast LOD first; the full model
is Inspect-only.

**Verified 2026-10-23** (headless Chrome 156, live build `aecac83bf949`,
unthrottled): Locate reached `Follow · Locked` and requested only
`iss_igoal_locate.glb` (4.80 MB transfer / 2.4 s first load, then a 49 ms cache
hit on the click); zooming to `Inspect · Locked` requested `iss_igoal.glb` once
(17.95 MB / 7.4 s); no console errors. The first-draw hitch and the throttled
cold-Locate path were not measured — run the checklist below for those.

1. Hover/focus Locate: the network panel must request
   `/models/iss_igoal_locate.glb?v=…` (~5.3 MiB), not `iss_igoal.glb`.
   The HUD reads “Loading ISS” / “Preparing ISS” until the LOD commits.
2. Press Locate. The flight must depart with the detailed LOD visible at the
   Follow standoff; the schematic Model A must not appear at close range. On a
   cold, throttled connection the 8 s bound may still expire — verify the
   prefetch (5 s after boot) makes this case rare.
3. Zoom below 200 km (Inspect). The full `iss_igoal.glb` must be requested
   only then, while the LOD stays visible; when it commits, the swap must not
   show Model A. Note any single-frame hitch from the full model's first draw.
4. Zoom back above 220 km: the full asset may remain ready; the LOD must still
   render Follow. Re-enter Inspect: no second download.
5. Fail the full asset. Dev server only (`npm run dev`, `?failAssets=iss_igoal.glb`);
   on a production build use DevTools request blocking instead. The needle must be
   the full file name: `iss_igoal.glb` blocks only the full asset, while
   `iss_igoal_locate.glb` blocks only the LOD (a bare `iss_igoal` matches both).
   The LOD must remain on screen and the HUD must not report low detail. Fail the
   LOD instead: the legacy model (or Model A) is the fallback and Locate completes.
6. With `issModelQuality: legacy`, Locate must load the legacy model and never
   request either IGOAL tier.

## Camera navigation

1. In Earth view, compare equal horizontal drags at 35,000 km and 6,500 km
   Earth-center distance. Close rotation should remain below 10% of the far-view
   response after sensitivity settles. Scroll steps should become finer near Earth.
2. Locate the ISS, then scroll between Inspect, Follow, and Approach. Confirm that
   rotation and zoom remain smooth across labels, and that the 70 km close-up limit
   does not change when crossing a mode boundary. Orbiting must retain tracking.
3. Pan by a few pixels with the right mouse button. Tracking must release immediately
   into Free mode, without changing orbit distance or suddenly changing sensitivity.
   A centered two-finger pinch should keep tracking; a two-finger pan should release it.
4. Orbit below the station, then zoom outward toward Earth. The rendered eye must
   remain at least 6,500 km from Earth's center. Continue rotating along the boundary:
   motion should slide, not stick. Repeat with a fast Free pan through the globe;
   both the eye and pivot must stop together, preserving their separation.
5. Select Reset View from Free or ISS tracking. Confirm a 2.2 s eased return (plus up to ~0.8 s to settle roll)
   to a 25,000 km Earth overview (farther in portrait), not a quick damping snap.
   Check an outward/upward-facing Free view too. The pivot must finish at Earth's
   center without a final orientation jump. Reset must not wait for ISS loading.
   Automatic zoom-out past Approach must not impose this reset distance.
6. Reset View visibility: the button must be hidden at the initial overview, appear
   after any orbit, zoom, or pan — including in Orbital and Planetary modes — and
   disappear again once a Reset completes. It must also reappear after Locate.
7. Oscillate around the 35,000 km overview threshold. Planetary should remain stable
   until zooming below 33,000 km. Free mode must never auto-lock to either object.
8. From a view where the station sits near or beyond the frame edge, press Locate.
   The view must turn onto the station and the approach must progress together —
   the station, once centered, must stay pinned (no late re-framing) — with no
   pull-back stage. From max-zoom Earth views the curved route must keep the ground
   filling the frame (the view never rises to the horizon or into space) and let
   the station crest into an already centered view. Test the opposite hemisphere,
   near a pole, and an outward-facing Free view; no surface crossings, waypoint
   pauses, horizon flips, or final tracking-handoff jumps. Repeat in portrait and
   with moving simulation time. A near-station Locate should be a short (~2 s)
   flight.
9. Drag during Reset View or the extended Locate route. The camera must release
   immediately without later resuming the cancelled flight, and without a roll
   snap at the release frame. Scrolling the wheel during a flight must cancel it
   too (wheel never emits controlstart).
10. Pan with the right button while inspecting the ISS, then zoom out. The mode must
    leave Free and return to Orbital (pivot gliding to Earth's center over ~1.2 s,
    never kicking) after roughly the same zoom-out that would leave INSPECT itself —
    about 1.5× at a 150 km inspect orbit, never a 3,300 km demand. Zooming in must
    keep Free mode. No frame during the handoff may move the pivot or swing the
    view abruptly.
11. In Orbital mode, drag across the North and South poles. Rotation must continue
    through both poles without a hard stop or inverted drag, the pivot distance must
    stay constant, and the horizon must transport without a 180° roll flip.
12. From an outward-facing Free view (looking away from Earth), press Locate. The
    view must turn smoothly one way — no near-180° flip in a single frame.
13. Reset View visibility across resizes: complete a Reset on a desktop viewport
    (button hides), resize to portrait — the button must reappear because Earth no
    longer fits — press Reset, and it must hide again at the portrait framing.

## Shader portability

1. Open the production preview before collecting console messages.
2. Confirm there are no WebGL shader compile or program-link errors.
3. Inspect the Earth day side, city lights on the night side, the terminator, cloud
   limb, atmosphere limb, sun disc, stars, Moon and lens ring for gross visual
   regressions.
4. Record the browser, WebGL version, and renderer class with the smoke result.

## Penumbra and countdown

1. Open the production preview and raise the clock to 300x (Follow the station).
   Wait for a terminator crossing (one every 30 to 60 simulated minutes).
2. Through the crossing the ISS lighting (key light, ambient, earthshine) and the
   glint tint must fade over several frames, not switch in one. The TRRJ law
   switches at the midpoint of that fade; radiators must not jump.
3. The line under the gauges reads "Daylight · sunset in mm:ss" or "Eclipse ·
   sunrise in mm:ss", counts down, and hits 00:00 at the crossing, then flips to
   the opposite phase with a fresh countdown. After a seek it recomputes at once.

## Ground track

1. HUD globe: the track is dotted behind the station and solid ahead, and it is a
   sine-like curve (the Earth turns under the orbit), not a great circle.
2. Open Render settings and switch "Ground track" on (default off). At 25,000 km,
   13,600 km and in Follow the 3D track and the footprint ring must not flicker or
   z-fight with the surface. The limb must hide the far side of the track, and the
   station model must occlude the track where it passes in front.
3. Switch it off again: the track and footprint disappear and the scene matches
   the calibrated default look.

## Pixel check

`npm run check:visual` builds the production bundle, renders it in Edge on
the real GPU at three fixed times and fails on a dark Earth disc or a page
error; open `.visual-check/*.png` afterwards. Run it before any push that
touches rendering, shaders or dependencies (CLAUDE.md, Rule 2). `vite
preview` has no `/api`, so it shows the packaged cloud composite.

## Live clouds

1. On the deployed site, `/api/clouds` answers 200 with `Content-Type:
   image/webp` and an `X-Clouds-Time` within the last two hours; a query
   string gets a 404.
2. A few seconds after load the clouds crossfade from the composite to the
   live map without a pop, and About reads "Clouds: NOAA satellite infrared
   from HH:MM UTC".
3. Scrub the orbit tape or run at 300×: the cloud deck drifts east over the
   ground; at Live it sits still. No line or seam anywhere on the deck, at
   the satellite boundaries (about 93°E and 22°E) or along coasts.

## Close-up imagery

1. Locate the station over land in daylight: within a few seconds the ground
   under it sharpens (Settings > Close-up imagery is on), with no tile edge,
   inset edge or line, also across 180° longitude.
2. Switch Close-up imagery off: the base map returns. The overview never
   requests `gibs.earthdata.nasa.gov` tiles.

## Stars and Moon

1. Look away from the Earth: the constellations are recognisable (Orion,
   the Plough), the Milky Way sits on them, and no star doubles.
2. The Moon shows the phase of the day and hides the stars behind it.

## Automated smoke

`npm run test:e2e` builds the production bundle, serves it with `vite preview`
and runs the Playwright smoke specs in `tests/e2e/` on software WebGL, with the
network stubbed. It covers a clean boot, Locate reaching "Follow · Locked",
Space pausing, `H` hiding the HUD, settings surviving a reload, and a TLE failure
degrading to Cached, Recovery or Fallback. `viewport.spec.ts` (plan 017 R7)
audits the HUD at nine sizes, 360×640 to 3440×1440, touch-emulated up to
1024×768: no cluster overlaps, nothing off-screen, no horizontal scroll, no
text below 9 px, no touch target below 44 px, the landscape-phone HUD at ≤ 30%
of the height, and the large-screen zoom. Its station-framing check (the
tracked station clear of the clock and gauges at 360×640, 390×844 and
844×390) needs the DEV scene hooks, so it skips on the preview; run it with
`E2E_DEV=1 npx playwright test viewport`, which serves the dev server on port
4174 instead. CI does not run it (removed 2026-10-28 by the owner: ~6–12
minutes of software WebGL per PR for an advisory job); run it by hand before
a change to the HUD, the overlays or the boot path. It does not replace the
visual checks above.
