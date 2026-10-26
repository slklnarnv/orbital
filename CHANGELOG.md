# Changelog

Notable user-facing changes to ORBITAL, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

ORBITAL has no version tags: every merge to `main` deploys to
<https://orbitaliss.vercel.app>, so each release is named by the date it
reached `main` (project local time, UTC+5:30). A PR adds its lines under
**Unreleased**; whoever merges a batch renames that heading to the merge date
(or folds it into an existing section for that day). One line per change,
linked to its PR; detail lives in `plans/PROGRESS.md` and the PR itself.

## [Unreleased]

### Added

- Keyboard shortcuts with a `?` overlay: `Space`, `1`–`4`, `0`, `L`, `R`,
  `H`, `P`, `G` and `Esc`, never while typing in a field
  ([#40](https://github.com/slklnarnv/orbital/pull/40)).
- An About panel beside the wordmark: what is measured and what is
  illustrative, data sources and credits, and the build id
  ([#40](https://github.com/slklnarnv/orbital/pull/40)).
- Screen-reader support: a skip link, a text summary of the view, and spoken
  camera-mode and sunrise/sunset changes; panels return focus to the control
  that opened them ([#40](https://github.com/slklnarnv/orbital/pull/40)).
- This changelog, and weekly Dependabot updates for npm and GitHub Actions
  (minor and patch grouped; the planned React, three, Vite and satellite.js
  majors held back).
- The site can be installed as an app, with its own icon and a dark title
  bar ([#39](https://github.com/slklnarnv/orbital/pull/39)).

### Changed

- A new site icon, an orbit with the station's glint, replaces the cyan
  wireframe globe ([#39](https://github.com/slklnarnv/orbital/pull/39)).
- The loading screen appears straight away and shows what it is waiting for
  (the data link, Earth and the station, file by file) instead of a single
  percentage; with reduced motion the glint stays still
  ([#39](https://github.com/slklnarnv/orbital/pull/39)).
- Clouds stay smooth up close: no more texel blocks at 800 km or staircase
  edges at 300 km, with fine cloud detail fading in near the deck and
  matching cloud shadows ([#37](https://github.com/slklnarnv/orbital/pull/37)).
- The dashed orbit line keeps an even dash spacing along the whole arc
  (the far end no longer shrinks to dots) and stays fixed to the orbit at
  any time rate or while scrubbing
  ([#38](https://github.com/slklnarnv/orbital/pull/38)).

### Changed

- The quietest HUD text is brighter (4.7:1 contrast on black, up from 3.1:1),
  and reduced motion now also stills the station glint and the lens flare's
  ghosts ([#40](https://github.com/slklnarnv/orbital/pull/40)).

## 2026-10-26

### Added

- Visible passes: a "Passes" control predicts when the ISS next crosses your
  night sky over 48 h, from an offline city search, typed coordinates or
  browser geolocation; "Watch" seeks to the pass
  ([#28](https://github.com/slklnarnv/orbital/pull/28)).

### Fixed

- Scrubbing the orbit tape in Follow or Inspect no longer swings the view
  around the station or makes it stutter against Earth
  ([#29](https://github.com/slklnarnv/orbital/pull/29)).
- On phones, popovers keep their fine print and the Passes and settings row
  no longer overlaps the camera mode label
  ([#28](https://github.com/slklnarnv/orbital/pull/28)).

## 2026-10-25

### Added

- Penumbra: sunset and sunrise fade instead of switching in one frame, and a
  countdown under the gauges shows the next one
  ([#18](https://github.com/slklnarnv/orbital/pull/18)).
- Ground track on the HUD globe, plus an optional 3D ground track and
  visibility footprint ("Ground track" setting)
  ([#18](https://github.com/slklnarnv/orbital/pull/18)).
- Station self-shadowing from the sun ("Shadows" setting, on by default)
  ([#21](https://github.com/slklnarnv/orbital/pull/21)).
- A crash screen in production builds instead of a blank page
  ([#18](https://github.com/slklnarnv/orbital/pull/18)).

### Changed

- The IGOAL model is rebuilt from both NASA sources with its authored
  materials (MLI blankets, grating and array cutouts) and KTX2 textures, at
  a third of the texture memory
  ([#20](https://github.com/slklnarnv/orbital/pull/20)).
- The station follows its Earth-facing attitude without lag, and its rigid
  geometry is batched (993 → 217 draw primitives on the full model)
  ([#21](https://github.com/slklnarnv/orbital/pull/21)).
- "Passing over" place names come from an offline Natural Earth index, so the
  ground point no longer depends on BigDataCloud
  ([#24](https://github.com/slklnarnv/orbital/pull/24)).
- The packaged fallback TLE refreshes twice a week straight to `main`
  ([#19](https://github.com/slklnarnv/orbital/pull/19)).
- README rewritten with a primer on what the view shows and screenshots
  ([#26](https://github.com/slklnarnv/orbital/pull/26),
  [#27](https://github.com/slklnarnv/orbital/pull/27)).

### Fixed

- The close-range model never appeared on the live site: the KTX2
  transcoder broke under the CSP. It now loads, and stale cached copies are
  replaced ([#22](https://github.com/slklnarnv/orbital/pull/22),
  [#23](https://github.com/slklnarnv/orbital/pull/23)).
- Solar arrays flickered black in Follow, and Bloom cost the frame rate
  (56 → 60 fps) ([#25](https://github.com/slklnarnv/orbital/pull/25)).
- From the codebase audit: an offline start recovers on reconnect;
  accelerated time no longer runs slow; TLE swaps no longer jump the station;
  old weather is hidden instead of shown as fresh; the tracking glint and
  day/night tint work again; Bloom edges are antialiased; close Locate
  departures land on the planned side
  ([#18](https://github.com/slklnarnv/orbital/pull/18)).

## 2026-10-23

### Added

- A Locate level of detail (5 MiB instead of 20.5 MB), so Locate departs with
  the detailed station on slow connections; the full model loads only below
  200 km ([#16](https://github.com/slklnarnv/orbital/pull/16)).
- `H` hides the HUD; safe-area insets on notched phones; link previews
  (Open Graph image); MIT licence and third-party notices
  ([#14](https://github.com/slklnarnv/orbital/pull/14)).

### Changed

- Faster Locate on first load (batched texture uploads), and versioned,
  immutable model and texture caching
  ([#14](https://github.com/slklnarnv/orbital/pull/14),
  [#17](https://github.com/slklnarnv/orbital/pull/17)).

### Fixed

- The orbit ring no longer shows a gap, and its dashes no longer slide
  ([#15](https://github.com/slklnarnv/orbital/pull/15)).

## 2026-10-09

### Added

- Solar wing gimbals (BGA) tilt all eight wings toward the sun, through
  eclipse, with an on-screen slew cap so 300× catch-ups glide
  ([#12](https://github.com/slklnarnv/orbital/pull/12)).

### Changed

- Lens flare reworked into a compact halo aimed at the drawn sun
  ([#12](https://github.com/slklnarnv/orbital/pull/12)).
- Guarded `/api/tle` (stale-on-error, cache-friendly), a Content Security
  Policy and self-hosted fonts
  ([#12](https://github.com/slklnarnv/orbital/pull/12)).

### Fixed

- The Nauka module rendered dark; altitude went negative at the south pole
  ([#12](https://github.com/slklnarnv/orbital/pull/12)).

## 2026-09-03 – 2026-09-29

Committed directly to `main`, before the PR workflow.

### Added

- Time controls: pause, 1×–300×, UTC seeks and a scrubbable revolution tape.
- HDR Bloom and an optional lens flare; continuous or dashed orbit line.
- The observatory-console HUD with the "Passing over" cluster: place, local
  time and weather below the station.
- NASA's IGOAL ISS model with an animated rig (SARJ, TRRJ, cameras).

### Changed

- Camera overhaul: Locate flights with level arrival, Reset view, Earth
  clearance and pole-free orbiting.
- A physical low-sun terminator and a true-size sun.

## 2026-07-13 – 2026-07-14

### Changed

- The simulation runs in a runtime decoupled from React and rendering, with
  smooth ISS motion and tracking
  ([#3](https://github.com/slklnarnv/orbital/pull/3),
  [#6](https://github.com/slklnarnv/orbital/pull/6),
  [#9](https://github.com/slklnarnv/orbital/pull/9)).
- Lower startup asset and GPU cost; better Earth depth and stability
  ([#2](https://github.com/slklnarnv/orbital/pull/2),
  [#10](https://github.com/slklnarnv/orbital/pull/10)).
- A responsive, more accessible HUD on mobile
  ([#7](https://github.com/slklnarnv/orbital/pull/7),
  [#8](https://github.com/slklnarnv/orbital/pull/8)).

### Fixed

- Earth drag speed adapts to zoom
  ([#1](https://github.com/slklnarnv/orbital/pull/1)); TLE updates are atomic
  and the Vercel TLE proxy works again
  ([#4](https://github.com/slklnarnv/orbital/pull/4),
  [#11](https://github.com/slklnarnv/orbital/pull/11)); shader ramps render on
  every GPU ([#5](https://github.com/slklnarnv/orbital/pull/5)).

## 2026-05-27 – 2026-06-18

### Added

- First version: SGP4 propagation from public TLEs, a shader-driven Earth
  with day/night, clouds and atmosphere, the ISS and its orbit, offline
  fallback data and a serverless TLE proxy.
