# Next Steps
> ## ⚠ Errata (2026-09-28, plan 001 landed): parts of these notes predate the
> ISS model repair. The radiator silver material and the old TRRJ hinge/
> sun-pointing descriptions are superseded — see docs/ISS_MODEL_CONTEXT.md
> (errata block) and plans/PROGRESS.md for the current architecture
> (ISSJointKinematics.ts, build-time radiator coating, bounded TRRJ law).

A ranked menu of candidate features, ordered by value-per-effort. This is a
working note, not a commitment — items graduate into the main README roadmap
when work starts.

Merged 2026-09: the camera overhaul (pole-free orbit, Earth clearance, simple
sweep Locate, Reset View, no forced arrival horizon) is complete and merged;
none of the items below touch it except where noted.

## 0. Performance / optimization run — added 2026-09-29, NOT STARTED

User report after the visual refresh + time controls + flare work landed:
"the entire app feels a little heavy and laggy." No numbers yet — so this is
a **measure-first** pass; no speculative cuts. Suggested shape:

1. **Baseline.** Frame-time sampling (p10/p50/p90 via a rAF delta accumulator
   or `stats.js`) at the three canonical regimes — Follow ~350 km, orbital
   ~18,000 km, planetary ~40,000 km — crossed with Bloom on/off, flare
   on/off, and each ISS model quality. Record the table in
   plans/PROGRESS.md before touching anything.
2. **Known suspects from the recent work** (in rough cost order):
   - **The composer** — the biggest single addition: a full-scene render into
     a non-MSAA target + UnrealBloom's mip chain + OutputPass, every frame.
     Things to try in order of invasiveness: clamp the device pixel ratio
     (`gl.setPixelRatio(Math.min(devicePixelRatio, 2))`), give the
     composer's render target `samples` for MSAA only if aliasing demands it,
     half-resolution bloom, and verify `PostprocessingGate` fully unmounts
     when off (it does — off must stay == the old pipeline).
   - **Per-frame SGP4 in OrbitLine** — the 2026-09-29 rewrite calls
     `engine.propagateAt()` once per frame for dash sizing. One call is
     cheap; measure, and if hot, reuse the refresh-time station position
     instead.
   - **Always-on extras**: RoomEnvironment PMREM at startup, per-frame joint
     kinematics on the detailed model, the additive sun/glow quads, the
     composer resize path on window resize.
   - **Bundle** — the `three-core` chunk > 500 kB warning is LOAD time, not
     frame time; don't conflate the two when judging "heavy".
3. **Constraints.** Verified visuals must not regress (terminator, sun,
   orbit-line fade + dash pitch, glint, flare). Any asset batching inherits
   the Phase D constraints in plans/PROGRESS.md (nothing that can plausibly
   be animated may be merged; pre-phase-D asset kept as rollback).
4. **Gate.** Before/after frame-time table + a console-clean browser pass;
   update plans/PROGRESS.md with what landed and what was measured.

## 1. Quick wins bundle — do first

Small, independent, safe. One or two commits total.

- ~~**Orbit line + ISS highlight + orange terminator**~~ — **DONE (2026-09-28
  visual refresh, sun reworked 2026-09-29)**: terminator repainted as physical
  low-sun warmth (one shared light-color term in ground+clouds, painted stripes
  deleted), orbit line upgraded to a fat anti-aliased Line2 with the per-point
  fade (rewritten 2026-09-29 after a deadlock left it invisible — see
  plans/PROGRESS.md), ISS zoom-out marker now a soft glow glint (light blue,
  no reticle chrome), sun rebuilt as a 0.66° photosphere with a tight glare
  and a wide amber haze on a 0.185 rad billboard (no longer feeds bloom — see
  plans/PROGRESS.md), and HDR bloom with a single "Bloom" toggle in the render
  settings popover. A reworked lens flare (halo + three iris ghosts, no
  streak/rings) exists behind a "Lens flare" toggle — default **off**, needs
  Bloom, improvement pass owed.
  (Shader-ramp contract updated deliberately; see plans/PROGRESS.md.)
- **Branding pass** — favicon, app icon, loading screen, name review. Assets
  already exist (`public/favicon.png|ico`, title in `index.html`); this is an
  asset swap plus loading-screen styling in `App.tsx`.
- **Hide HUD option** — one toggle (fits the shortcut layer in item 2, `H`)
  plus a class that fades the HUD clusters. Cheap, demo-friendly.
- **Info/About panel** — small modal/popover: what the app shows, data sources
  (TLE/SGP4, BigDataCloud, Open-Meteo), the honest-instrument caveats from the
  README.

## 2. Time controls + keyboard shortcuts + accessibility

STATUS (2026-09-28): **DONE — landed.** Pause/play, rate presets
(1× / 10× / 60× / 300× — 1× is a free-running offset clock, distinct from
Live), Live snap-back, seek-to-UTC-time popover with ±min/±orbit nudges, and
a scrubbable orbit tape (drag, click, arrow keys). Transport row lives under
the mission clock (`src/ui/clusters/TimeControls.tsx`); the seek semantics
(all seeks detach from Live into PAUSED; REALTIME re-pins to the wall each
tick) live in `src/stores/simulationStore.ts`. The orbit tape sweeps at
simulation rate and is an ARIA slider. Under accelerated time the geo
enrichment service is gated (no lookups for transient ground cells; the
passing-over line shows live coords only). The render interpolator's
discontinuity bound was corrected (50 → 400 km — the old value came from a
10× arithmetic error and reseeded every snapshot at accelerated rates).
Shortcuts: `Space` = pause. Remaining from this item: `L` / `H` / `R`
shortcuts and the `prefers-reduced-motion` flight pass.

Original notes (superseded):

(PREVIOUSLY ITEM 1 — still the highest value-per-effort feature.)

## 3. ISS attitude + sun-tracking arrays (NASA-Eyes-level motion)

STATUS (2026-09): items 1 and 2 are DONE. LVLH/TEA attitude lives in
`ISSGroup.tsx`; SARJ sun-tracking is implemented in `ISSAnimations.tsx`
driving the IGOAL model's authored `PORT_ALPHA_ROT` / `STBD_ALPHA_ROT` nodes,
with the TRRJ radiator joints on a sun-pointing approximation. Radiator
materials were corrected to light silver (the source MLI assignment read
near-black). Full findings, measurements, and classifications:
`docs/MODEL_AUDIT.md`. Remaining from this item: a physically faithful
edge-to-Sun / face-to-Earth TRRJ thermal profile (P2), and optional poses for
Canadarm2/ERA (ERA geometry exists, merged into the Nauka detail meshes — no
dedicated node).

Original notes (pre-IGOAL; kept for the legacy-model context):

(PREVIOUSLY ITEM 3, upgraded from "quick win" to its proper scope after
checking the model.)

Today the ISS carries **no attitude at all** — nothing applies rotation, so
the model sits in the glTF author's fixed orientation relative to the world
frame. That is the "artificial" look. Real targets, in order:

1. **LVLH attitude** — the real station holds local-vertical/local-horizontal
   (nadir-pointing) attitude: body axes aligned with the orbital velocity and
   the local vertical. Derivable per frame from the propagated position and
   velocity (both already in `OrbitalState`; the TEME→world mapping is in
   `CoordinateConversions`). No new data needed.
2. **SARJ sun-tracking** — the Solar Alpha Rotary Joints rotate the array
   wings about the truss axis to track the sun; the sun vector is already
   computed each frame (`sunDirectionWorld`) for the terminator shader. Rotate
   the array wing groups so their normal faces the sun, one axis per wing as
   the real joints allow. On the placeholder model the arrays are separate
   meshes; on a detailed model the joints must be identified by node name.
3. **Other moving parts** (optional): radiator rotation, SSRMS arm pose —
   only if the model exposes them.

Note: camera tracking interpolates the ISS *position*; attitude must use the
same snapshot cadence or it will desync from the position at close range.
Verify against NASA Eyes footage for a reference feel.

**Model compatibility (verified by parsing the GLB node trees):**

- The detail model (`international_space_station.glb`, 130 meshes / 132 named
  nodes) is NASA-Eyes-grade in structure: every module named (Zarya, Zvezda,
  Destiny, Harmony, Tranquility, Kibo, Columbus, Cupola, Quest, PMAs, PMM,
  full S0–S6/P1–P6 truss, ELCs, AMS-02, DEXTRE, an 8-segment Canadarm2 chain).
  **No new model is needed for items 3 and 4.**
- **SARJ is achievable with the existing rig**: the outboard truss chains hang
  off the `S4 Truss` and `P4 Truss` nodes (S4→S5→S6 and P4→P5→P6, wings as
  their `_01/_02` children) — rotating those two nodes about the truss axis
  rotates the whole outboard array assembly, exactly the real SARJ. The
  Russian arrays even have named `panel_XX_p/s` + `hinge_XX_p/s` nodes.
  BGA fine-tilt per wing is not separable — acceptable, SARJ dominates.
- No baked animations in either model — moving parts must be code-driven
  (preferred anyway: sun- and time-driven, not canned).
- The fallback Model A is a single merged mesh (no hierarchy) — arrays stay
  static there, which is invisible at its far-range display distance.
  Graceful degradation, no action needed.
- To confirm once in-editor: model axis conventions (truss axis vs module
  stack vs nadir) for the LVLH base rotation, and that rotating S4/P4 nodes
  reads as SARJ motion (both nodes already carry rotations in the file).

## 4. NASA Eyes-style dynamic model + module explorer (Phase 3A)

The big visual upgrade — and the big lift. Subsumes the "dynamic 3D ISS model
from NASA Eyes" and "exploded view module explorer" ideas; the model swap is
the entry point, per-module interaction is the payoff, and the exploded view
is a mode of that interaction system:

- The model asset will collide with `scripts/check-asset-budget.mjs`
  (current static budget: 3.81 MiB); either raise the budget or stream the
  asset.
- Per-module raycasting, hover highlight, selection, and an info card per
  module (name, mass, launch date, function — a small curated dataset).
- Exploded view: animate modules apart along their docking axes with labels;
  a mode of the same raycast/selection system.
- Item 3 (attitude + SARJ) should land first — the moving parts make the
  module explorer worth exploring, and per-module pivots must respect the
  attitude frame.
- The 4-level LOD pipeline with alpha crossfades is a substantial rendering
  project on its own.

## 5. Ground track + passover prediction (Phase 3C)

Two sub-features, best after the model phase (more info surfaces to anchor):

- **Upcoming ground track**: project the propagated ground path ahead of the
  sub-satellite point onto the ground-track globe (already orthographic —
  add the path polyline behind the station marker).
- **Passover prediction**: for a chosen observer location, compute the next
  visible pass (rise/set times, max elevation). Needs observer-location input
  and pass-math (elevation above horizon mask), new but `satellite.js`-feasible.
  Strongly enhanced by time controls (item 2) — scrubbing to a pass is the demo.

## 6. Resolution / responsive audit

Deliberately after the HUD work settles (items 1–2), since it means a
systematic pass over the `.hud-*` responsive rules. Known pitfall from the
handoff: inline styles override media queries — two historical bugs came from
exactly that; keep sizing in the stylesheet.

## 7. Serverless proxy for the geo/weather lookups (deployment hardening)

The app is hosted on Vercel precisely so unreliable end-user networks don't
break external API fetches — `api/tle.ts` already does this for telemetry
(proxy-first in the client, direct-browser fallback, then cache). The
`GeoLookupService` (BigDataCloud + Open-Meteo) currently fetches
direct-from-browser only. If field reports show those calls failing on bad
networks, add `api/geo.ts` following the `api/tle.ts` structure (multiple
upstreams, server-side validation, CORS headers, `vercel.json` functions
entry) and flip `GeoLookupService` to proxy-first with the current direct
fetch as the fallback. Conditional — only on field reports.

## Not now

- **Dropdown list on the Locate button** — no use case; skip unless one
  appears.
- **More HUD polish.** The console design system is stable and verified; the
  marginal pixel is not where the value is. (The branding pass in item 1 is
  asset identity, not layout polish.)
- **Further camera work.** The camera system was overhauled and verified
  (see the camera-system facts in `docs/HANDOFF.md`); resist reopening it for
  feel-tuning without a measured trace first.

---

## Debugging note (camera)

The dev build exposes the camera-controls instance as
`window.__orbitalControls` (set in `AppCameraControls`, DEV-only). Frame-order
context for anyone touching the camera: drei's CameraControls `update()` runs
at `useFrame` priority −1, i.e. *before* `ISSGroup` and `CameraController`
advance the spacecraft each frame. Any consumer that needs the camera pose to
match *this frame's* rendered ISS must call `controls.update(0)` after moving
the target — see the jitter fix in `CameraController`'s tracking branch.
