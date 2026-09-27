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

## 1. Quick wins bundle — do first

Small, independent, safe. One or two commits total.

- **Branding pass** — favicon, app icon, loading screen, name review. Assets
  already exist (`public/favicon.png|ico`, title in `index.html`); this is an
  asset swap plus loading-screen styling in `App.tsx`.
- **Hide HUD option** — one toggle (fits the shortcut layer in item 2, `H`)
  plus a class that fades the HUD clusters. Cheap, demo-friendly.
- **Info/About panel** — small modal/popover: what the app shows, data sources
  (TLE/SGP4, BigDataCloud, Open-Meteo), the honest-instrument caveats from the
  README.
- **Orbit line + ISS highlight + orange terminator** — orbit line is a
  color/fade tweak in `OrbitLine.tsx`; the ISS beacon/aura styling lives in
  `ISSModel.tsx`. The terminator's orange band is in the earth fragment shader
  with frozen ramp thresholds — updating it means deliberately updating the
  `ShaderRamps.test.ts` contract, not just the shader.

## 2. Time controls + keyboard shortcuts + accessibility

(PREVIOUSLY ITEM 1 — still the highest value-per-effort feature.)

Pause, real-time, and accelerated modes (10× / 60× / 300×) plus the shortcut
and accessibility layer, now bundled with the "accessibility and keyboard
shortcuts" idea:

- The simulation core already supports this: `SimulationClock` implements
  `setMode('ACCELERATED')` / `setTimeScale()` and is unit-tested; nothing in
  the UI exposes it. Work is a small control cluster near the mission clock.
- Shortcuts: `Space` = pause, `L` = locate ISS, `H` = hide HUD, `R` = reset
  view (Reset already exists; just bind it).
- Accessibility pass: focus states on all controls, ARIA labels on the new
  cluster, `prefers-reduced-motion` (damped/manual navigation only, flights
  become near-instant or disabled).
- Design decision: which clock surfaces rescale (UTC readout keeps real time
  while simulation time accelerates, or shows simulation time explicitly).

When time controls land, the orbit tape, ground-point places, and
passing-over weather all start telling a story — an orbit flown in seconds.

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
