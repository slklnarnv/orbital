# Browser verification

Run these checks against a production build in a hardware-accelerated browser after
camera, shader, asset, or scene changes.

## Cold-start Locate

1. Disable the browser cache and reload. Before hovering or focusing Locate,
   confirm the detailed ISS model has not been requested.
2. Press Locate. While “Loading ISS” or “Preparing ISS” is shown, the camera must
   stay put and repeated presses must not restart the request.
3. From the initial overview, confirm “Locating ISS” starts only after preparation
   and the original two-second flight remains smooth, with no target snap,
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

## Camera navigation

1. In Earth view, compare equal horizontal drags at 35,000 km and 6,500 km
   Earth-center distance. Close rotation should remain below 10% of the far-view
   response after sensitivity settles. Scroll steps should become finer near Earth.
2. Locate the ISS, then scroll between Inspect, Follow, and Approach. Confirm that
   rotation and zoom remain smooth across labels, and that the 60 km close-up limit
   does not change when crossing a mode boundary. Orbiting must retain tracking.
3. Pan by a few pixels with the right mouse button. Tracking must release immediately
   into Free mode, without changing orbit distance or suddenly changing sensitivity.
   A centered two-finger pinch should keep tracking; a two-finger pan should release it.
4. Orbit below the station, then zoom outward toward Earth. The rendered eye must
   remain at least 6,500 km from Earth's center. Continue rotating along the boundary:
   motion should slide, not stick. Repeat with a fast Free pan through the globe;
   both the eye and pivot must stop together, preserving their separation.
5. Select Reset View from Free or ISS tracking. Confirm a 2.2-second eased return
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
   with moving simulation time. Near-station Locate should retain the shorter
   two-second path.
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
   limb, atmosphere limb, sun disc, and lens ring for gross visual regressions.
4. Record the browser, WebGL version, and renderer class with the smoke result.
