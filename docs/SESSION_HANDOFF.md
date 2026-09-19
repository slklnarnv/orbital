# Session Handoff — Camera, Navigation & Locate Overhaul

**Date:** 2026-09-18  
**Repository:** `orbital` (ISS Real-Time 3D Visualization)  
**Stack:** React 18, Three.js (r170), `@react-three/fiber` (v8), `@react-three/drei` (v9), `camera-controls` (v2.9.0), Zustand (v5), Vite 6, Tailwind v4.

---

## 1. Executive Summary

This session executed a major overhaul of Orbital's 3D camera system, visual performance, and navigation mechanics. The work resolved severe visual hitches during target acquisition, eliminated camera-Earth clipping, removed gimbal lock at planetary poles (enabling Google Earth-style free spherical rotation), fixed state machine traps during manual panning/zooming, and delivered a unified, cinematic flight system for both **Locate ISS** and **Reset View**.

All changes were verified with 98 automated unit tests, TypeScript typechecking, asset budget checks, shader ramp verifications, and live multi-browser interaction tests.

---

## 2. Chronological Log of User Prompts & Objectives

### Prompt 1: Initial Repository Clone
> *"clone this repository https://github.com/slklnarnv/orbital"*
- Cloned clean repository from upstream into the workspace.

### Prompt 2: Read-Only Codebase Familiarization
> *"first analyze the current codebase (do not analyze the texture models as they will burn the context/tokens), after you have familiarized with the full code, we will start our work on it, simply return "ready"."*
- Conducted an exhaustive, read-only analysis of all 96 source and configuration files (excluding large binary model/texture assets in `public/`).
- Mapped system architecture: `SimulationRuntime` (10 Hz decoupling), `SimulationClock`, `TelemetryManager` (SGP4 propagation, resilient TLE acquisition, offline fallback), `GeoLookupService`, GLSL shaders, camera state machine, and HUD design tokens.

### Prompt 3: Agent Recovery
> *"recover the stalled agents and finish their analysis"*
- Reconciled all parallel analysis workers and delivered complete architecture readiness.

### Prompt 4: Cold-Start Locate ISS Lag & Snapping
> *"when locate button is pressed, on a cold start, it jumps to the ISS model (instead of smoothly transitioning), the model is low poly version, then the simulation lags (to load the full poly model) for about 2-3 seconds. find a way to fix this."*
- **Root Causes:**
  1. `CameraController.tsx` executed `controls.moveTo(_currentISSPos.x, _currentISSPos.y, _currentISSPos.z, false)` on every frame during active transition, instantly snapping the target to the ISS and breaking `CameraControls`' spherical interpolation.
  2. The 6.5 MB high-detail Draco ISS model was only requested when camera distance dropped below 2,800 km (mid-flight), causing the camera to arrive at the low-poly schematic model.
  3. When the high-detail model finished downloading, synchronous texture uploads and shader compilation choked the WebGL render loop for 2–3 seconds.
- **Implemented Fix:**
  - Added asynchronous model pre-warming triggered on user intent (Locate button hover/focus or click).
  - Extended `loadingStore.ts` with `issDetailStatus`: `'idle' | 'loading' | 'preparing' | 'ready' | 'failed'`.
  - Added off-screen GPU compilation (`compileAsync`, `initTexture`, zero-area scissor render) in `ISSModel.tsx` distributed across animation frames.
  - Camera departure waits until model and shaders are GPU-ready before launching a smooth 2-second eased flight via `lerpLookAt`.
  - Added clear HUD telemetry status indicators (`"Loading ISS"`, `"Preparing ISS"`, `"Locating ISS"`).

### Prompt 5: Camera Clipping & Polishing Across Modes
> *"Well done, moving on, we have 4-5 different camera modes (depending on the zoom?) with different logic in them, but when testing around with different zooms and moving around, sometimes the earth clips into the camera, goes through it, basically the camera logic seems unpolished. Do not change the locate button behaviour that is perfect now."*
- **Root Causes:**
  1. `CameraControls.minDistance` was constrained relative to the current camera pivot/target, not Earth's center. When orbiting or panning in `FREE` or near the ISS, zooming in or panning moved the camera inside the Earth's 6,371 km radius.
  2. Crossing mode boundaries caused abrupt changes in rotation sensitivity and dolly speeds.
  3. Boundary hysteresis was incomplete, causing mode flickering.
- **Implemented Fix:**
  - Built `CameraNavigationConstraint.ts` enforcing a hard 6,500 km clearance sphere from Earth center.
  - Implemented continuous velocity sweeping (ray-sphere intersection) and tangential sliding: if panning or zooming pushes into Earth, the camera slides along the 6,500 km shell without stopping or penetrating.
  - Replaced stepped sensitivity with smooth distance-aware curves in `CameraSensitivity.ts` (`applyNavigationSensitivity`), dynamically scaling rotation and dolly speeds based on physical clearance.
  - Added 60 km minimum distance clamp in `INSPECT` mode to prevent clipping into the enlarged 109 km wingspan ISS model.

### Prompt 6: Button Wording Update
> *"change "earth view" to "reset""*
- Renamed the HUD return button from `"Earth view"` to `"Reset"`.

### Prompt 7: Reset View Label & Proper Framing
> *"change it to "Reset View" and when i press it, it is currently too zoomed in, so set the reset zoom to an appropriate level"*
- **Root Cause:** The reset action previously only re-pointed the target to `(0,0,0)` while keeping the current camera distance. If triggered from close range, it left the user uncomfortably close to the surface.
- **Implemented Fix:**
  - Renamed button to `"Reset View"`.
  - Implemented dynamic overview framing in `CameraCluster.tsx`: calculates required distance from vertical FOV and aspect ratio (25,000 km standard desktop, scaling up dynamically on portrait mobile/tablets) so Earth and its orbital trail fit comfortably in the viewport.

### Prompt 8: Smooth Reset Easing & Wonky Close Locate
> *"continue where u left off, also currently pressing reset snaps back too fast it needs to be a smooth transition. Pressing locate ISS button transition is nice and smooth but when i am max zoomed in somewhere else on the earth and then press locate button the transition works but its very wonky, maybe a good looking implementation could be that when i press it zooms out slightly then moves towards the iss (it already somewhat does this but slightly modified, think about the best way to solve this)."*
- **Root Causes:**
  1. "Reset View" relied on default damping rather than an orchestrated flight, feeling abrupt.
  2. Locate from close Earth views suffered from chord-through-sphere hazards and erratic orientation flips.
- **Implemented Fix:**
  - Added `triggerResetView` in `cameraStore.ts` and `sampleReset` in `CameraFlightPath.ts` providing a 2.2-second smooth cubic-eased flight back to Earth overview.
  - Introduced initial curvature routing for close Earth departures.

### Prompt 9: Natural Flight Curve, Pole Freedom & Free Mode Fix
> *"You got it mostly right, reset view works. But the locate when zoomed in somewhere else is still a bit wonky and weird especially in different viewing modes like free etc., maybe it zooms out too much, make it feel like the regular locate, like it eases and flies into the view smoothly. Do not assume constraints, you have some artistic and creative freedom. Panning using right click while inspecting and then zooming out makes the viewing mode stuck in free along with inspect logic. Pressing locate when zoomed in somewhere else first zooms out and then zooms back in to the ISS. In orbital mode, when viewing the earth, i am not able to freely rotate the earth completely and as freely as google earth (for example) there are some constraints like i cant move past the north and south pole and have to rotate instead."*
- **Problems Identified:**
  1. **Locate Zoom-Out Detour:** The previous implementation forced a high-altitude climb to 18,000 km before descending to the ISS, feeling like a staged detour ("zooms out then zooms back in") rather than an organic flight.
  2. **Free Mode Stuck on Zoom-Out:** When right-clicking to pan in Inspect mode, mode transitioned to `FREE`. But zooming back out left the mode permanently stuck in `FREE` with inspect logic active.
  3. **Polar Gimbal Clamping:** In `ORBITAL`/`PLANETARY` modes, `camera-controls` uses spherical coordinates with `minPolarAngle=0, maxPolarAngle=PI`. Dragging upward or downward hit hard stops at the North and South poles, preventing continuous tumbling over the poles like Google Earth.
- **Implemented Fixes (Unfinished quota ran out midway, low quality fixes, need to be improved):**
  1. **Continuous Natural Locate Flight (`CameraFlightPath.ts`):**
     - Replaced staged waypoint climb with `planLocate` and `sampleLocate`.
     - Direct line-of-sight test: if direct path does not intersect Earth, flies straight in over 2 seconds.
     - If Earth occludes line of sight, curves naturally along a great-circle arc at current/interpolated altitude directly toward the station without artificial zoom-out climbs.
     - Smoothly aligns camera orientation to look along the flight trajectory, acquiring the ISS from behind its orbital heading for a seamless handoff.
  2. **Automatic Escape from Free Mode (`CameraStateMachine.ts` & `CameraController.tsx`):**
     - Tracked pivot distance during `FREE` mode navigation.
     - When the user zooms out past 3,300 km or 1.08× the entry distance, the state machine automatically breaks out of `FREE` and returns to `ORBITAL` or `PLANETARY` mode, eliminating stuck inspect state.
  3. **Google Earth-Style Pole-Free Rotation (`FreeOrbitControls.ts`):**
     - Implemented quaternion-based spherical orbit rotation that transforms eye position and camera `up` vector simultaneously.
     - Completely bypasses Euler polar angle clamping (`0..PI`).
     - Users can drag smoothly across the North Pole and South Pole indefinitely from any angle without gimbal lock, sticking, or inverted controls.
     - Preserves `CameraControls` for panning, zooming/dollying, and cinematic programmatic transitions.

---

## 3. Architecture & Key Files Modified

```text
src/
├── interaction/camera/
│   ├── CameraController.tsx         # Central camera orchestrator, useFrame loops, event listeners
│   ├── CameraFlightPath.ts          # Unified flight interpolator for Locate and Reset View
│   ├── CameraNavigationConstraint.ts# Hard 6,500 km Earth clearance sphere & tangent sliding
│   ├── CameraSensitivity.ts         # Smooth, continuous distance-based rotation/dolly sensitivity
│   ├── CameraStateMachine.ts        # Mode transition logic with hysteresis & Free-mode exit
│   └── FreeOrbitControls.ts         # Pole-free trackball rotation (Google Earth feel)
├── rendering/
│   ├── iss/
│   │   └── ISSModel.tsx             # Multi-frame GPU prewarming & deferred Draco model loading
│   └── scene/
│       └── SceneRoot.tsx            # CameraControls setup, dynamic distance bounds, input mapping
├── stores/
│   ├── cameraStore.ts               # Camera mode, tracking flags, and transition triggers
│   └── loadingStore.ts              # ISS detail loading & preparation lifecycle state
├── types/
│   └── camera.ts                    # CameraMode & CameraTransitionState definitions
└── ui/clusters/
    └── CameraCluster.tsx            # Locate ISS and Reset View HUD controls
```

---

## 4. Key Invariants & Rules for Future Sessions

1. **Camera Priority & Timing:**
   - Drei's `CameraControls.update()` runs at `useFrame` priority **−1** (before standard R3F components).
   - Any manual camera target update must call `controls.update(0)` to synchronize the camera matrix within the same frame and prevent 1-frame micro-jitter.
2. **Never Use `controls.moveTo(..., false)` During Flights:**
   - `moveTo(x, y, z, false)` immediately overwrites `_target` and `_targetEnd`, instantly teleporting the camera focal point.
   - Programmatic camera flights must use `lerpLookAt` or `setLookAt` with custom path interpolation (`CameraFlightPath`).
3. **Earth Clearance Invariant:**
   - Minimum camera distance from `(0,0,0)` is **6,500 km** (`EARTH_RADIUS_KM = 6,371 km` + 129 km atmosphere/clearance buffer).
   - Any manual navigation (orbit, pan, dolly) must pass through `CameraNavigationConstraint`.
4. **ISS Model Scale Invariant:**
   - The ISS is intentionally rendered at **~109 km wingspan** (~1,000× real-world scale) so it remains legible against Earth.
   - Close-up inspection modes must clamp camera distance to **≥ 60 km** from the model center to keep the camera outside the solar arrays.
5. **Asset Budget Enforced in CI:**
   - `scripts/check-asset-budget.mjs` strictly enforces an initial static budget of ≤ 5.0 MiB.
   - The detailed ISS model (`international_space_station.glb`, 6.5 MB) must **never** be preloaded at module scope; it must remain deferred and loaded only on user intent or proximity.

---

## 5. Verification & Test Suite

The codebase passes all automated verification gates:

```bash
npm run typecheck    # 0 errors
npm test -- --run    # 17 test suites, 98 tests passing
npm run verify       # Asset budget + shader ramps + typecheck + tests + vite build
```

### New Tests Added This Session:
- `tests/unit/camera/CameraNavigationConstraint.test.ts`: Tests sphere collision, tangential sliding, fast chord penetration prevention, and orbit preservation.
- `tests/unit/camera/CameraStateMachine.test.ts`: Tests hysteresis bands, mode boundaries, and automatic `FREE` mode exit on zoom-out.
- `tests/unit/camera/CameraFlightPath.test.ts`: Tests direct line-of-sight Locate, curved orbital bypass, and Reset View easing.
- `tests/unit/camera/FreeOrbitControls.test.ts`: Tests full 360° vertical polar revolutions without gimbal lock, up-vector integrity, and dolly preservation.
- `tests/unit/camera/ResetViewLifecycle.test.ts`: Tests state restoration and cancellation behavior for Reset View.

---

## 6. Addendum — Transition Polish Pass (later on 2026-09-18)

The three Prompt-9 fixes above were reworked after re-testing; the original
implementations had the following measured problems, now resolved:

1. **Curved Locate still read as "zoom out, then zoom back in."**
   Root cause: the curved branch turned the view to horizon-level "cruise"
   (departure-view slerp over progress 0–0.3) before tipping back down to the
   station (focus slerp over 0.3–1). From a straight-down Earth view that is a
   ~90° nose-up followed by a ~47° tip-down, and it *looks* like a pullback and
   re-approach even though the radius never recedes.
   **Fix:** `sampleLocate`'s curved branch now makes one continuous eased turn
   from the captured view onto the station's *live* bearing
   (`smoothstep(0, 0.7, progress)` strength), aiming through the surface at
   where the station will crest. The ground fills the frame for the whole
   flight and the station rises into an already centered view. Verified in
   browser: view pitch stayed ≥ 13° below the local horizon for the entire
   flight and the eye radius stayed within [departure, chase standoff].
   The arrival standoff is now captured once at `planLocate` and applied
   rigidly to the live station (`arrivalOffset`), replacing the route-course
   recomputation (`routeAxis`/`course` fields were removed).

2. **FREE escape demanded a 3,300 km pivot distance.** After a right-drag pan
   in INSPECT (entry ≈ 90–220 km), zooming out needed a ~38× dolly
   (~38 wheel notches at ~8%/notch) to leave FREE — experienced as "stuck in
   free along with inspect logic."
   **Fix:** the release decision moved to
   `CameraStateMachine.isFreeZoomOut(pivotDistance, entryPivotDistance)`:
   release at `max(220 km, 1.25 × entry)`. The floor matches INSPECT's exit
   band, so escaping a close inspect pan takes roughly the same gesture as
   leaving INSPECT itself. Verified in browser: an 87 km entry released at
   ~220 km (4 wheel pulses) into ORBITAL with the pivot easing to Earth center.

3. **Pole-free rotation verified correct** (no code change): browser test
   dragged from 59.6° latitude through the north pole to 55.3° on the far side
   — longitude flipped 78° → −102°, orbit radius stayed exactly 7022 km, the
   up vector transported continuously, and no gimbal stick or inverted drag
   appeared at any point.

103 unit tests, typecheck, asset budget, shader ramps, and build all pass.
`docs/verification.md` steps 7–10 describe the new browser acceptance checks.

---

## 7. Addendum — Locate/Reset UX Pass (2026-09-19)

Follow-up pass on residual abruptness, from user reports: "flips and pans the
camera unnecessarily before finally reaching back to the ISS which is already
there in frame", "it first changes orientation and then zooms in", and "the
reset view option should always be there as soon as I make any changes from
default view".

1. **Locate while tracking flew to the standoff and back.** In
   FOLLOW/INSPECT/APPROACH the station is already centered; pressing Locate
   launched a full flight to the 354 km standoff (away from a close inspect
   view, swinging around the model). `triggerLocateISS` is now a no-op while
   `isTracking` — the smoothest possible "return to the ISS".

2. **The direct route could swing through the station.** The straight-line eye
   lerp from a departure on the far side of the standoff dips to ~106 km from
   the station (model neighbourhood). The direct route now orbits the station
   on a spherical path with the station distance interpolated explicitly, so it
   can never come closer than the standoff.

3. **Orientation led position, then the framing shifted late.** The direct
   route's view slerped to an arrival-referenced direction while the actual
   station bearing swings fastest late in the approach, so the view appeared to
   finish turning first and the station then slid within the frame. Both
   routes now share `aimTargetAtStation`: one eased turn onto the station's
   live bearing (locked by progress 0.7). Measured in browser: a 25.4°
   off-frame acquisition closed gap and distance together (25.4° → 0.5° while
   13,729 km → 2,409 km) with zero gap reopen.

4. **One-frame roll snap at flight handoff.** Flights drive camera-controls'
   internal state with a world-up frame while the rendered orientation is
   transported manually; the first tracking `update(0)` after
   `completeTransition()` wrote the internal orientation back — a visible roll
   snap after flights from rolled (polar/Free) views. The controller now syncs
   the rendered orientation into camera-controls (camera.up + `updateCameraUp()`
   + `setLookAt` + `update(0)`) before completing. Measured: 0.0002 right-vector
   jump across the handoff frame.

5. **Reset View visibility is deviation-based.** It was hidden in
   Orbital/Planetary modes entirely, so there was no way back after zooming or
   orbiting from the overview. The controller keeps a home pose (initial camera;
   replaced by each completed Reset) and writes `cameraStore.isHomeView` when
   the live pose deviates (1 km tolerance; level horizon judged on the camera's
   right vector — world-up itself tilts with latitude when looking at Earth's
   center, so it is not a roll reference). CameraCluster shows the button
   whenever `isHomeView` is false.

Store: `isHomeView` + `setHomeView` added; `triggerLocateISS` no-ops while
tracking. Tests: fly-through guard for far-side departures, tracking no-op,
home-view flag (40 camera tests; 107 total). All browser checks above verified
live; `docs/verification.md` steps 5–8 updated.

---

## 8. Addendum — Continuity & Ownership Pass (2026-09-19, second)

A follow-up review confirmed seven residual discontinuities that no amount of
easing could hide; all seven are fixed in one coordinated pass:

1. **Locate flipped ~180° from outward-facing Free views.** The per-frame aim
   re-derived the shortest rotation from the captured view to the live station
   bearing; when that bearing crossed the antipode, the shortest-arc axis
   switched sides (measured 179.6° in one frame). All angular decisions are now
   retained at plan time (`turnPlan`, rigid `arrivalOffset`); the per-frame aim
   applies the retained quaternion by progress weight only. The aim and the
   real eye-to-station bearing coincide exactly at arrival because the eye
   keeps the same rigid offset the bearing was computed from.
2. **Free→Earth handoff kicked.** Three uncoordinated changes at release
   (exponential pivot recenter moving 12 %/frame, `minDistance` jumping 5 →
   6,500 km and clamping the eye outward, sensitivity shift). Fixes: the
   recenter is a fixed-duration 1.2 s easeInOutCubic glide; `minDistance` stays
   5 km outside ISS-tracking modes (Earth clearance is owned entirely by
   `CameraNavigationConstraint`). Measured after: max pivot step 3.8 km/frame,
   zero orientation snap.
3. **Cancellation was unsynchronized and wheel didn't cancel.** Every takeover
   now runs one shared `syncRenderedPoseToControls` (roll measured 0.0007
   right-jump at cancellation; 73° before). A canvas `wheel` listener cancels
   flights because `controlstart` never fires for wheel.
4. **Flight angular motion was too aggressive** (7.4°/frame combined whip).
   Duration now scales with the visible turn (350 ms/rad) and the departure
   roll (250 ms/rad), the turn spread widened to `smoothstep(0, 0.8)`, and the
   late roll-settle cap dropped from 7.5 to 5 rad/s. Peak measured: 2.63°/frame
   view, 0.74°/frame roll.
5. **Rotating during a zoom silently changed the zoom's damping.** `setLookAt`
   clears camera-controls' `_isUserControlling{Rotate,Dolly,Truck}`;
   `rotateOrbit` snapshots and restores them.
6. **Collision correction opposed safe grazing orbits.** Orbit-like motion
   (fixed pivot, preserved offset length) is now judged by sampling the actual
   arc; only genuinely dipping arcs fall through to the chord solver.
7. **Reset's home state ignored viewport framing.** The home check gained an
   Earth-fits-the-viewport condition
   (`CameraStateMachine.earthFitDistanceForViewport`): resizing a desktop home
   pose to portrait re-offers Reset; Reset reframes to the portrait distance
   and hides again. (Note: the check uses the Earth-only fit, not the orbit
   margin — the initial 18,000 km overview fits Earth but not the full orbit
   figure.)

109 tests pass (added: antipodal-bearing aim continuity, safe-orbit
no-correction). All fixes verified live in the browser.

---

## 9. Addendum — Completion Kick & Always-Available Controls (2026-09-19, third)

User reports: "after any camera flight, it snaps very quickly and abruptly";
Locate should be clickable anytime like Reset View.

1. **Every flight ended with a ~35° / ~250 km kick.** Frame-level internals
   dumping showed the internal `_spherical` numbers identical across the
   completion frame while `_yAxisUpSpace` changed — the completion sync called
   `updateCameraUp()` (re-interpreting the stored offset through the new
   up-space) BEFORE reading the current eye, so the read pose was re-projected
   through the new space and landed rotated. The fix is ordering only: read the
   pose in the current up-space, then adopt the rendered up, then setLookAt.
   After: 0.00° view change across the completion frame. Note the earlier
   session's handoff tests missed this because their cameras were near
   world-up, where the space change is negligible.
2. **Locate/Reset are always clickable.** The store triggers no longer
   early-return during a transition, and the tracking no-op was removed:
   triggering mid-flight overwrites the transition and the flight branch
   re-captures from the rendered pose (new transition object = re-capture
   signal). Locate while tracking re-flies to the standoff — geometrically a
   no-op from the canonical framing, a small smooth move otherwise. Buttons no
   longer set `disabled` during transitions.
3. The perceived "every transition got worse" was this kick contaminating all
   flights; measured smooth across locate, reset, re-capture, and handoff after
   the fix (max view step 0.6–2.9°/frame during flights, 0° at handoffs).

110 tests pass. `docs/verification.md` updated.

---

## 10. Addendum — Dizzy Spin on Big Sweeps (2026-09-19, fourth)

User report: with the ISS at the globe's top in Planetary view, Locate "goes
round and round unnecessarily" before zooming in; dizzy in many other cases
too. Measured live: the flight's view direction traveled 86° but the image
ROLLED 194° — the horizon spun more than twice the required motion, and the
arrival frame had a diagonally tilted Earth limb.

Root cause: the flight's orientation transported the captured up with the view
and then let a rate-limited "settle" chase the world-up horizon every frame.
During a large sweep the view rotation kept regenerating roll error faster than
the error could stay settled, and the chase's full-error corrections composed
with the transport into a sustained spin.

Fix: the orientation logic moved into `FlightHorizon` (unit-tested). The up is
transported with the view (no first-frame snap, rolled departures preserved)
and blended onto the world-up horizon by progress weight
(`error × smoothstep(0, 0.6, progress)`), so the roll is monotonic, stays near
level mid-flight, and lands exactly level at arrival. Long dives also get more
time: `planLocate` adds a distance term
(`min(2000, max(0, startRadius − 20,000) × 0.025)` ms), so a 100,000 km
approach takes ~4.5 s instead of ~2.5.

112 tests pass (FlightHorizon: sweep keeps |roll| < 25° and arrives level;
180°-rolled departure settles monotonically without a first-frame snap).

---

## 11. Addendum — Far-Side Double Rotation (2026-09-19, fifth)

User: the spin fix worked, but far-side / far-away Locates still felt janky —
"the camera and world rotated like 2-3 times." The user's own theory was
correct: the Locate arrival orientation was CONSTANT (fixed velocity-aligned
standoff + fixed arrival bearing), so the camera had to roll the world around
on top of the route to reach it.

Measured on a 160°-separation far-side Locate: the view traveled 147° and the
camera's right vector 128° — the aim turned ~120° independently of the route.

Fix: the Locate aim now TRACKS the station's live bearing instead of sweeping
to a fixed arrival bearing. Per frame the retained aim turns toward
`normalize(station − eye)` by an eased, rate-capped fraction
(`min(gain, 0.035 rad / angle)` with `gain = smoothstep(0, 0.8, progress)`):
the view aims through the surface at where the station will crest, follows it
around the globe, and locks exactly onto the station by arrival — the route
sweep becomes the single world rotation, exactly the "rotate the earth while
zooming in until the ISS flies into view" behavior the user described. A
departure aiming exactly away from the station (outward-facing Free view)
escapes the antipodal singularity with a half-circle about a fixed perpendicular
retained from the captured view. FlightHorizon also freezes its corrections near
the world-up singularity and rate-caps them (2.5 rad/s), since pole-passing
routes swing the projected horizon wildly.

The aim state is per-path and requires monotonically increasing progress;
mid-flight re-capture already creates a fresh path. 114 tests pass (added:
far-side tracking regression — max view-vs-bearing gap < 60°, view travel
< 230° for a 160° route, exact arrival; pole-pass horizon boundedness).

---

## 12. Addendum — The Simple Sweep (2026-09-19, sixth)

The user's verdict on all the accumulated flight machinery: "we might be
overcomplicating things, a simple sweep cannot be that hard to create."
Correct — the whole Locate flight was rewritten as ONE motion and the
machinery deleted:

- The eye's direction rotates about a single fixed axis from the departure
  radial to the station standoff (uniform angular rate; a normalized lerp ran
  ~5× faster mid-path — an 11°/frame view spike) while the altitude eases
  down, clamped above the clearance sphere. The clearance chord test became
  unnecessary: a radial path clamped to 6,500 km cannot dip inside.
- The look target slides from the captured pivot to the station (pan complete
  by ~70% progress), so the view starts exactly where the user was looking and
  ends centered on the station. Fixed arrival bearings, stateful aim tracking,
  antipodal escape axes, and drift/offset machinery are all gone; the arrival
  standoff sits on the sweep's own approach side, so the framing is dynamic.
- FlightHorizon and the sync/handoff/home systems are unchanged.

Live far-side measurement: view travel 146° for a ~150° sweep (one rotation,
was 187°+199° with an 11°/frame spike), max view step 3.1°/frame, smooth level
arrival, locked handoff. 110 tests pass (CameraFlightPath tests rewritten
around the simple invariants: captured-view start, station-exact end, clearance
and standoff bounds, continuity, one-rotation travel).

---

## 13. Addendum — No Forced Arrival Horizon (2026-09-20)

User: the sweep works, but there's still an unnecessary roll right at the end —
"maybe because you have set some particular orientation it needs to achieve
instead of keeping it as it is." Exactly right: FlightHorizon still blended the
horizon onto world-up by arrival, so the camera rolled through the whole tail
of a big sweep (112° of roll on the far-side test, concentrated after the
pole pass).

Fix: `FlightHorizon.update` gained a `worldUpBlend` weight. Locate passes 0 —
pure transport, the horizon is kept exactly as the user had it, no forced
orientation, no end roll, and the pole-pass flip event disappears entirely
(world-up is never referenced). Reset View passes 1 — a north-up globe overview
is meaningful there and its sweep is view-direction-only. Locate flights also
drop the roll-settle duration extension (there is no roll debt to settle).

Live far-side measurement after: total roll travel 9° (was 112°), max roll
step 0.13°/frame (was 4.9°), view travel 165° ≈ one sweep, locked handoff.
111 tests pass (added: pure-transport full-revolution through both poles —
no flip, perpendicular up, exact rigid transport).
