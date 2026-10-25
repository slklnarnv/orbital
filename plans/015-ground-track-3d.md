# Plan 015: An optional 3D ground track and visibility footprint on the globe, free of z-fighting at every zoom

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat aa206a1..HEAD -- src/rendering/earth/EarthGroup.tsx src/stores/settingsStore.ts src/ui/common/SettingsGear.tsx tests/unit/stores/settingsStore.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. `src/core/orbital/GroundTrack.ts`
> (plan 014) MUST exist; if not, STOP.

## Status

- **Priority**: P3 (roadmap B.2 second cut + D.3)
- **Effort**: M
- **Risk**: MED (new scene object; depth handling)
- **Depends on**: plan 014 (`sampleGroundTrack`, `GroundTrackPoint.ecef`)
- **Category**: direction (feature)
- **Planned at**: commit `aa206a1`, 2026-10-25

## Why this matters

The roadmap's B.2 asks for the ground track and the visibility footprint on
the 3D globe. Its own note D.3 measured the trap: with `near = 1 km`,
`far = 2,000,000 km` and a 24-bit depth buffer, the smallest resolvable depth
gap is ~20.7 km from the 25,000 km home view, so a track drawn 2 km above the
surface z-fights exactly where it is most useful. The fix chosen here is a
constant clip-space depth bias of a few depth-buffer ulps in the vertex
shader: the world-space pull grows with the square of the distance
(~70 km at the home view, ~37 km at 13,600 km, ~0.05 km at Follow range), so
the track always wins against the surface it sits on, while real depth
testing still lets the globe's limb hide the far side and the station
occlude the track. (Disabling the depth test, the roadmap's option (a),
would draw the track over the ISS model at close range.)

## Current state

- `src/core/orbital/GroundTrack.ts` (plan 014): `sampleGroundTrack(engine, centerMs, { pastMs, futureMs, stepMs }): GroundTrackPoint[]`
  with `ecef: { x, y, z }` (Earth-fixed km) per point.
- Frames: TEME → three world is `(x, z, -y)` and `EarthGroup` rotates its
  children by GMST about +Y, so a child of `EarthGroup` placed at
  `(ecef.x, ecef.z, -ecef.y)` sits at that Earth-fixed point. (CLAUDE.md hard
  invariants: 1 unit = 1 km; Earth radius 6371 km.)
- `src/rendering/earth/EarthGroup.tsx` renders
  `<group ref={groupRef}>` with `<EarthSurface />`, `<CloudLayer />`,
  `<AtmosphereShell />`, rotating `rotation.y = simTime.gmst` each frame.
- Camera: `near: 1.0`, `far: 2000000` (`SceneRoot.tsx`), standard (not
  logarithmic, not reversed) depth.
- `src/rendering/iss/OrbitLine.tsx` is the pattern for a preallocated line
  buffer refreshed on a simulation-time cadence (`ORBIT_PATH_REFRESH_MS = 60_000`
  sim-ms) — read it for the refresh/seek handling style.
- Telemetry: `telemetryManager.lastState` (from `@/core/telemetry/TelemetryManager`)
  is the latest smoothed `OrbitalState` (`positionECI` = TEME km, `timestamp`
  = sim epoch ms) updated at 10 Hz; `computeGMST`, `UNIX_EPOCH_JULIAN`,
  `temeToECEF` exist (see plan 014).
- `src/stores/settingsStore.ts`: persisted zustand store with
  `sanitizePersistedSettings` (allow-list of keys/types), `partialize`, and
  setters; e.g. `lensFlare: boolean` + `setLensFlare`. Test file:
  `tests/unit/stores/settingsStore.test.ts`.
- `src/ui/common/SettingsGear.tsx` "Visuals" section has `role="switch"`
  buttons (`Bloom`, `Lens flare`) with
  `className={`hud-label hud-option${on ? ' hud-option--on' : ''}`}` and
  `aria-checked`.
- HUD palette: the glint's light blue `#A8D8FF`.
- Bloom: threshold 2.4 — keep line colours ≤ 1.0 so the track never blooms.
- Hard invariant: Bloom OFF renders exactly like the direct pipeline — a new
  scene object is fine; do not touch the composer.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| Focused tests | `npx vitest --run tests/unit/orbital/Footprint.test.ts tests/unit/rendering/GroundTrackDepth.test.ts tests/unit/stores` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `src/core/orbital/Footprint.ts` (create — pure ring geometry)
- `src/rendering/earth/groundTrackDepth.ts` (create — pure bias math + constant)
- `src/rendering/earth/GroundTrack.tsx` (create)
- `src/rendering/earth/EarthGroup.tsx` (mount it, gated by the setting)
- `src/stores/settingsStore.ts` (+ `groundTrack` setting)
- `src/ui/common/SettingsGear.tsx` (+ one switch)
- `tests/unit/orbital/Footprint.test.ts`, `tests/unit/rendering/GroundTrackDepth.test.ts` (create)
- `tests/unit/stores/settingsStore.test.ts` (extend)

**Out of scope**: `OrbitLine.tsx`, the composer, Earth shaders, camera near/far,
the HUD globe (plan 014), `docs/**`, `plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch; one commit per step; never commit red.
- Subject style: `Add an optional 3D ground track and footprint`.
- End every commit body with the `Co-Authored-By:` line YOUR harness
  specifies (naming the model that did the work), then
  `Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u`.
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: Pure geometry and depth-bias math

`src/core/orbital/Footprint.ts`:
```ts
/**
 * Ring of points (Earth-fixed km, on a sphere of `ringRadiusKm`) bounding the
 * region from which the station is above the horizon: a small circle of
 * half-angle acos(R / (R + h)) around the sub-satellite direction of `ecef`.
 * Writes `segments + 1` points (closed) into `out` (length ≥ 3·(segments+1)).
 */
export function writeFootprintRing(ecef: Vec3, earthRadiusKm: number, ringRadiusKm: number, segments: number, out: Float32Array): void
export function footprintHalfAngleRad(earthRadiusKm: number, altitudeKm: number): number
```
Basis: `u = ecef/|ecef|`; pick `e1 = normalize(cross(u, |u.z| < 0.9 ? Z : X))`,
`e2 = cross(u, e1)`; point_k = ringRadius·(cos λ·u + sin λ·(cos θk e1 + sin θk e2)).
`altitudeKm = |ecef| − earthRadiusKm`.

`src/rendering/earth/groundTrackDepth.ts`:
```ts
/** Clip-space depth bias (NDC units) applied to the ground track: ~3 ulps of a 24-bit depth buffer. */
export const GROUND_TRACK_DEPTH_BIAS_NDC = 4e-7
/** World-space pull (km) a given NDC bias buys at view depth `z` (perspective, far ≫ near). */
export function depthBiasPullKm(biasNdc: number, viewDepthKm: number, nearKm: number): number // = biasNdc * z² / (2·near)
```

Tests:
- `Footprint.test.ts`: half-angle at h = 420 km ≈ 20.3° (±0.1°); every ring
  point is at angular distance λ from `u` (±1e-6 rad) and at radius
  `ringRadiusKm` (±1e-6); first point equals last (closed); works at the
  poles (`ecef` along ±Z) without NaN.
- `GroundTrackDepth.test.ts`: with near = 1 km and the constant,
  `depthBiasPullKm` at 18,629 km is in [40, 120] km (beats the 20.7 km gap
  from D.3), at 13,629 km in [20, 80] km, and at 478 km is < 0.1 km (cannot
  lift the track over the ~400 km-high station).

**Verify**: `npx vitest --run tests/unit/orbital/Footprint.test.ts tests/unit/rendering/GroundTrackDepth.test.ts` → all pass.

### Step 2: Setting + switch

- `settingsStore.ts`: add `groundTrack: boolean` (default `false` — the
  calibrated look is unchanged unless the user opts in), `setGroundTrack`,
  include it in `partialize` and in `sanitizePersistedSettings`
  (`typeof raw.groundTrack === 'boolean'`), and in `PersistedSettings`.
- `SettingsGear.tsx`: under "Visuals", after "Lens flare", a `role="switch"`
  button "Ground track" following the exact pattern of the Bloom switch.
- Tests in `settingsStore.test.ts`: sanitizer keeps a boolean `groundTrack`
  and drops `groundTrack: 'yes'`; default is `false`.

**Verify**: `npx vitest --run tests/unit/stores` → all pass; `npm run typecheck` → exit 0.

### Step 3: The component

`src/rendering/earth/GroundTrack.tsx` (a child of `EarthGroup`, so
Earth-fixed coordinates):
- Two `THREE.Line` objects with ONE shared `THREE.ShaderMaterial`
  (`transparent: true`, `depthWrite: false`, `depthTest: true`), created in
  `useMemo` and disposed (geometries + material) in a `useEffect` cleanup:
  - track: preallocated `BufferGeometry` with `position` (Float32Array,
    256×3) and `alpha` (Float32Array, 256) attributes, `setDrawRange(0, n)`;
  - footprint: `position` (65×3) and constant `alpha` 0.35.
- Shaders inline as template strings (two short shaders; do NOT add files to
  `src/rendering/shaders/` — keeps the shader-ramp gate untouched):
  vertex:
  ```glsl
  attribute float alpha;
  uniform float uDepthBiasNdc;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Constant NDC pull toward the camera (see groundTrackDepth.ts): the
    // surface-hugging track wins against the globe at every zoom while the
    // limb and the station still occlude it.
    clip.z -= uDepthBiasNdc * clip.w;
    gl_Position = clip;
  }
  ```
  fragment: `uniform vec3 uColor; varying float vAlpha; void main() { gl_FragColor = vec4(uColor, vAlpha); }`
  with `uColor = #A8D8FF`, `uDepthBiasNdc = GROUND_TRACK_DEPTH_BIAS_NDC`.
  Note `#include <tonemapping_fragment>`/`<colorspace_fragment>` are NOT
  needed for a plain ShaderMaterial line, but if colours look wrong in the
  Bloom-off path, add both includes at the end of `main()` (that is how the
  repo's other custom shaders match the direct pipeline — check
  `src/rendering/shaders/softGlow.frag` and follow it).
- Track refresh (in `useFrame`, cheap check each frame): recompute when no
  data yet, or the TLE identity (`issEntity.currentTLE?.line1`) changed, or
  `|simNow − lastCenter| ≥ 60_000` sim-ms (covers seeks both ways). Sample
  `sampleGroundTrack(issEntity.engine, simNow, { pastMs: P/2, futureMs: P/2, stepMs: 30_000 })`,
  clamp to 256 points, write each point as
  `(ecef.x, ecef.z, -ecef.y)` scaled to radius `EARTH_RADIUS_KM + 2`, alpha
  `0.22` for past samples and `0.6` for future ones; mark attributes
  `needsUpdate`, `setDrawRange(0, n)`, recompute bounding sphere once
  (or set `frustumCulled = false` on both lines — simpler and correct here).
- Footprint (each frame, but only when `telemetryManager.lastState?.timestamp`
  changed): `ecef = temeToECEF(state.positionECI, gmst(state.timestamp))`,
  `writeFootprintRing(ecef, EARTH_RADIUS_KM, EARTH_RADIUS_KM + 2, 64, scratch)`,
  then copy into the footprint position attribute with the same
  `(x, z, -y)` mapping.
- `renderOrder = 2` on both lines (after the Earth layers).

In `EarthGroup.tsx`: read `groundTrack` from `useSettingsStore` and render
`{groundTrack && <GroundTrack />}` after `<AtmosphereShell />`.

**Verify**: `npm run typecheck` → exit 0; `npm run lint` → exit 0.

### Step 4: Gate

**Verify**: `npm run verify` → exit 0.

## Test plan

Unit: footprint geometry, depth-bias magnitudes, settings sanitizer. Browser
(reviewer): with "Ground track" on, at the 25,000 km home view, 13,600 km
and Follow range the track never flickers; the far side is hidden by the
limb; at Follow the station occludes the track behind it; toggling it off
removes both lines; Bloom on/off both look right.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -n "groundTrack" src/stores/settingsStore.ts src/ui/common/SettingsGear.tsx src/rendering/earth/EarthGroup.tsx` matches in all three
- [ ] `grep -n "uDepthBiasNdc" src/rendering/earth/GroundTrack.tsx` matches
- [ ] `git diff --stat aa206a1..HEAD` lists only in-scope files (ignore `plans/` and other plans' files)

## STOP conditions

- `GroundTrack.ts` from plan 014 is missing.
- The depth-bias magnitudes in Step 1 fall outside the asserted ranges with
  the given constant (report the computed numbers instead of retuning blind).
- Mounting under `EarthGroup` appears to require changes to Earth shaders,
  the composer or camera settings.

## Maintenance notes

- If the camera's `near`/`far` change, re-derive `GROUND_TRACK_DEPTH_BIAS_NDC`
  with `depthBiasPullKm` (the test pins the intended magnitudes).
- The roadmap's D.3 options (a)–(c) are superseded by this constant-ulp bias;
  record that in `docs/NEXT_STEPS.md` (docs pass).
- A future cut can tint the shadowed part of the track using `sunVisibility`.
