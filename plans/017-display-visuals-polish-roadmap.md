# Plan 017: Display, visuals and polish — roadmap

> Umbrella roadmap, not a single executable plan. Each item below is sized to
> become its own plan (018+) or PR. Every claim of a problem cites how it was
> measured, so an executor can re-run the check before and after.

## Status

- **Planned at**: `09101ca` + the station-locked scrub fix (PR #29), 2026-10-26
- **Scope**: the owner's list — responsive display on phones and other
  resolutions, the sun, the dashed orbit line, 8K Earth textures, close-range
  clouds, icon/loading screen/name, accessibility and keyboard shortcuts, an
  info/about panel, and (later) an exploded module explorer — merged with the
  open items in `docs/NEXT_STEPS.md`.
- **Landed**: R1–R7 (responsive display), 2026-10-26; see
  `docs/NEXT_STEPS.md` Current state for the before/after numbers.
- **Evidence**: a viewport audit in headless Edge on the owner's GPU (nine
  sizes, 360×640 to 3440×1440, overview and Follow; per-cluster boxes,
  overlaps, off-screen, font sizes below 9 px, targets below 32 px),
  screenshots of the sun, clouds at 800/300 km and the dashed orbit through
  the dev camera hooks, and a code read.

## Suggested order

| # | Item | Why first | Effort |
|---|------|-----------|--------|
| 1 | R1–R4 responsive display + R7 audit spec | Highest user impact; phones are broken in visible ways | M |
| 2 | V1 close-range clouds (quick win) | The most visible quality gap at Follow/Inspect | S |
| 3 | A1 shortcuts + help overlay, P1 info panel | Pair naturally (one overlay system) | M |
| 4 | I1 icon + manifest | Small, finishes the identity | S |
| 5 | V4 dashed orbit refactor | Code health; removes per-frame bookkeeping | M |
| 6 | V3 sun | Visual polish; needs a reference pass | M |
| 7 | I2 loading screen | First impression | M |
| 8 | V2 8K Earth (deferred, capability-gated) | Needs the A.2 perf baseline first | M |
| 9 | R5/R6 large-screen scale, render-scale override | Lower urgency | S–M |
| — | X1 exploded module explorer | Later, by request | L |

Existing roadmap items keep their place after these: C.5 (changelog,
Dependabot), A.2 (measured perf run — a benchmark harness was prototyped in
the 2026-10-25/26 sessions), deferred majors, D.7 save-frame, D.8 GIBS tiles,
B.4–B.8.

## R — Responsive display (mobile and other resolutions)

Audit result: no cluster overlaps another, nothing is off-screen and there is
no horizontal scroll at any of the nine sizes. The problems are proportion,
legibility and touch.

**R1. Short-height layout (landscape phones).** At 844×390 the desktop layout
applies at full scale: gauges, the 30 px clock and the ground cluster take
~45% of the height and the clock sits on the station. Add a
`(max-height: 500px)` layout: one compact bottom row (gauges · clock · ground
summary), a thinner tape, secondary lines hidden.
*Accept*: at 844×390 and 740×360 the HUD uses ≤ 30% of the height and no HUD
box intersects the station's screen box in Follow.

**R2. HUD-aware framing.** Tracking centres the station on the canvas, but
on portrait phones the bottom ~40% is HUD (clock, gauges, ground), so at
360×640 the station overlaps the clock. Offset the projection
(`camera.setViewOffset` or a screen-space target shift) so the tracked station
centres in the unobstructed region; recompute on resize and HUD toggle (`H`).
*Accept*: at 360×640, 390×844 and 844×390 the station's projected box does not
intersect the clock or gauges in Follow or Inspect.

**R3. Legibility floor.** Measured below 9 px: the ground cluster's coordinate
and weather lines at 7 px, the place name at 8.5 px, "Passing over" and the
tape labels at 8 px (every size). Raise to ≥ 9 px with a `clamp()` type scale;
drop a line instead of shrinking it.
*Accept*: the audit reports no text below 9 px at any size.

**R4. Touch targets.** Every size reports controls under 32 px: Pause 23×15,
the time rates 22–38×20, the gear 23×23, Passes 41×23, Set time 55×20. Under
`(pointer: coarse)` give each a ≥ 44×44 hit area with padding, not larger
glyphs (the D.6 remainder).
*Accept*: no interactive element below 44×44 on coarse pointers.

**R5. Large screens.** At 2560×1440 and 3440×1440 (DPR 1) the HUD keeps its
1080p pixel sizes, so it reads small and the corners drift apart. Scale type
and spacing with `clamp(…, vmin, …)` above ~1920 px; on ultrawide, keep the
clock centred and the clusters at a readable inset rather than at the far
edges.

**R6. Render scale.** Phones at DPR 3 render 9× the pixels of DPR 1. Cap the
DPR on coarse pointers (2) and expose a render-scale setting (D.6).

**R7. Keep it fixed.** Commit the viewport audit as a Playwright spec (the
matrix above; assert no overlaps, nothing off-screen, no text < 9 px, no
coarse-pointer target < 44 px) so the layout cannot regress silently. Also
check `100dvh` / iOS address-bar resize and orientation changes.

## V — Visual quality

**V1. Close-range clouds.** At 800 km the cloud layer shows texel blocks; at
300 km it is a staircase. One 4K equirectangular map is ~10 km per texel at
the equator, magnified across the screen at Follow/Inspect distances.
1. Quick win (S): remove the staircase — smooth the coverage threshold with
   `fwidth` and sample bicubically (or with a rotated-grid tap) when
   magnified.
2. Detail (M): fade in a procedural fBm detail term that modulates density
   by camera altitude (no new download), keeping the large-scale field
   real.
3. Source (later): a higher-resolution cloud field (KTX2, deferred load) or
   tiles (D.8).
*Accept*: no visible texel edges at 300 km in a side-by-side capture.
*Status (2026-10-26)*: 1 and 2 landed (`cloudDensity.glsl`, shared with the
surface's cloud shadows); 3 remains.

**V2. 8K Earth textures — yes, but not as plain 8K WebP.** Today: day 1.0 MB,
night 0.25 MB, specular 0.39 MB, clouds 1.97 MB (all 4K WebP) inside a
5 MiB initial budget (3.89 MiB used). Uncompressed on the GPU an 8192×4096
RGBA8 map is 128 MiB, 171 MiB with mips; four of them would exceed what
integrated GPUs and phones can hold. Plan:
- keep 4K for first paint;
- after first paint, on capable desktops only (`maxTextureSize ≥ 8192`, fine
  pointer, no `saveData`), stream an 8K day map and 8K night lights as KTX2
  (the same Basis pipeline as the ISS — transcoded to BC7/ASTC, ~43 MiB with
  mips each) and swap them in;
- specular stays 4K; clouds follow V1;
- gate it on the A.2 perf baseline, and keep it off the initial budget.
Close-range detail beyond 8K is D.8 (GIBS tiles).

**V3. The sun.** Today it renders as a small disc with a faint amber haze —
next to Earth's limb it reads like a bright star. It is deliberately kept
under the bloom threshold because UnrealBloom renders a small disc as a
rounded square (documented in `sun.frag`).
1. A dedicated round glare pass instead of bloom: a camera point-spread
   function (bright core, wide halo, faint 6-blade diffraction spikes) scaled
   by exposure, so the sun reads as blinding without the square artifact.
2. The sun near Earth's limb: a forward-scattering glow and a sunrise colour
   band in the atmosphere shader when the sun is behind or grazing the limb,
   and a gradual occlusion fade (the penumbra math already exists for the
   station's lighting).
3. Revisit the lens flare default (exists, off by default).
*Accept*: side-by-side with ISS photography at the limb, owner's sign-off.

**V4. Dashed orbit line — code, not looks.** The dashes look correct, but
`OrbitLine.tsx` (361 lines) recomputes `dashSize`/`gapSize` from camera
distance every frame and carries dash-phase bookkeeping so the pattern does
not crawl. Move the dash into the line shader, driven by the orbit's own
phase (argument of latitude) and kept screen-constant with derivatives: the
pattern is then anchored to the orbit by construction and the per-frame CPU
work and phase state go away.
*Accept*: no crawl at 1×, 300× or during a scrub; constant on-screen pitch;
pure phase math unit-tested; the file roughly halves.
*Done 2026-10-26*: see `plans/PROGRESS.md` §"017 V4".

## I — Identity

**I1. Icon and manifest.** The favicon is a cyan wireframe globe: it clashes
with the warm-white HUD (colour is reserved for link status) and does not say
"ISS". There is no apple-touch-icon and no web manifest. Make an SVG mark
(an orbit ellipse with a station glint, `--hud-hi` on space black), PNG
fallbacks, a 180 px apple-touch-icon and a manifest with a maskable 512 px
icon so the site installs cleanly.

**I2. Loading screen.** It shows "Loading N%". Show staged, honest progress
(data link · Earth · station), keep the first frame fast, and respect reduced
motion.

**I3. The name.** "Orbital" is clean but generic and hard to search. This is
the owner's call; options: keep it and lead with a descriptor in titles and
the share card ("Orbital — the ISS, live"), or pick a distinctive name before
wider sharing. No change is made without a decision.

## A — Accessibility and keyboard (C.4)

**A1. Shortcuts with a help overlay.** Today only `Space` (pause) and `H`
(HUD) exist, plus arrows on the tape and in radio groups. Add one registry and
a `?` overlay: `L` locate, `R` reset view, `1`–`4` rates, `0` live, `P`
passes, `G` settings, `Esc` closes. Shortcuts must not fire while typing in
an input.

**A2. Focus.** Popovers return focus to their trigger (Settings does); add a
skip link and make sure every control shows `:focus-visible`.

**A3. Screen readers.** A polite live region for mode and daylight changes,
and a text summary of the canvas ("Over the South Pacific, in daylight,
sunset in 26 minutes").

**A4. Contrast and motion.** Check `--hud-lo` (38% white) against the black
background and the bright limb; extend the reduced-motion handling beyond
flights (glint pulse, flare).

## P — Info / about panel (B.7, "what's real")

An "About" text control next to the wordmark opens a panel: what is measured
(position, TLE age, Sun, terminator, eclipse) versus illustrative (attitude
details, joint angles, clouds, flare, glint, the 1,000× scale), data sources
and credits (from `NOTICE.md`), the build id, and a link to the shortcut
overlay. Static content, shares the overlay system with A1.

## X — Later: exploded view and module explorer

The IGOAL hierarchy names its modules and the batching keeps geometry per
module, so per-module picking is possible. Needs:
- a module data file (name, partner agency, launch year, mass, purpose);
- raycast picking against the batched meshes, with hover highlight;
- an info card;
- an exploded view that moves modules out along vectors from the station
  centroid and back, with the joints parked;
- camera focus on a picked module.

Large; depends on the rig contract in `docs/ISS_MODEL_CONTEXT.md`. Start
after R and V1.
