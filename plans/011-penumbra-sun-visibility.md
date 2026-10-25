# Plan 011: The station passes through a real ~63 km penumbra instead of a one-frame light switch

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat aa206a1..HEAD -- src/rendering/iss/ISSModel.tsx src/rendering/iss/ISSAnimations.tsx src/core/orbital src/utils/math.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (roadmap D.1 — "the largest fidelity gap left")
- **Effort**: M
- **Risk**: LOW–MED (lighting values change continuously; joint law unchanged)
- **Depends on**: plan 006 (DONE — glint uniforms are stable now)
- **Category**: direction (feature)
- **Planned at**: commit `aa206a1`, 2026-10-25

## Why this matters

The station's day/night state is a binary cylinder test in two places
(`ISSModel.tsx` lighting, `ISSAnimations.tsx` TRRJ law). Physically the Sun is
a disc of angular radius ~0.2666°, so the shadow edge is a penumbra: at ISS
radius (~6,779 km) it is `2 × 6,779 km × 0.00465 rad ≈ 63 km` wide, about 8 s
of flight. Today that collapses into ONE frame that switches a 2.3× key-light
exposure boost, ambient 0.24 → 0.42, the earthshine key light and the glint
tint — a visible pop at every terminator crossing (and at 300× it strobes).
The fix is one pure function in `src/core/orbital/` returning visibility in
[0, 1]; lighting consumes the continuous value; the TRRJ law keeps a boolean
at the 0.5 crossing, so joint behaviour is unchanged. The next plan (the
day/night countdown) reuses the same function.

## Current state

- `src/rendering/iss/ISSModel.tsx` (outer `ISSModel` frame loop, ~line 729-809):
  ```ts
  // 3b. Shadow detection for dynamic color-shifting halo
  const simTime = simulationClock.now()
  const sunDir = sunDirectionWorld(simTime.julianDate)
  _sunDirVec.set(sunDir.x, sunDir.y, sunDir.z).normalize()
  const p = worldPos.current.dot(_sunDirVec)
  const perpSq = worldPos.current.lengthSq() - p * p
  const isShadowed = p < 0 && perpSq < 6371.0 * 6371.0
  ...
  const shadowExposureBoost = isShadowed ? 2.3 : 1.0
  ... lightPrimaryRef.current.intensity = 1.6 * smoothMultiplier * shadowExposureBoost
  ... lightSecondaryRef.current.intensity = 0.8 * smoothMultiplier * shadowExposureBoost
  ... const baseAmbientIntensity = isShadowed ? 0.42 : 0.24
      lightAmbientRef.current.intensity = baseAmbientIntensity * smoothMultiplier
  ...
  if (earthshine) {
    if (isShadowed) {
      ... position the light along the nadir (unchanged) ...
      earthshine.intensity = 0.65 * smoothMultiplier
    } else {
      earthshine.intensity = 0.0
    }
  }
  ...
  // Daylight (light blue glint) vs. shadow (deeper blue) color shift
  glintUniforms.uColor.value.copy(isShadowed ? GLINT_COLOR_SHADOW : GLINT_COLOR_SUNLIT)
  ```
  `worldPos.current` is the station centre in world km; `_sunDirVec` is the
  unit world sun direction (`sunDirectionWorld` — the same mapping as the
  station positions, so the dot products are frame-consistent).
- `src/rendering/iss/ISSAnimations.tsx`:
  ```ts
  // Sphere-Earth shadow test, identical to the lighting/exposure consumers
  // (ISSModel) and the analytic terminator inputs — one solar ephemeris only.
  const EARTH_RADIUS_KM = 6371
  const EARTH_RADIUS_KM_SQ = EARTH_RADIUS_KM * EARTH_RADIUS_KM
  ...
  const alongSun = _worldPos.current.dot(_sunWorld.current)
  const perpSq = _worldPos.current.lengthSq() - alongSun * alongSun
  const sunlit = !(alongSun < 0 && perpSq < EARTH_RADIUS_KM_SQ)
  ```
  `sunlit` is passed to `trrjTargetAngle(..., sunlit, ...)` (do not change
  `ISSJointKinematics.ts`).
- `src/utils/math.ts` exports `type Vec3 = { x: number; y: number; z: number }`
  (THREE.Vector3 satisfies it structurally). `src/utils/constants.ts` exports
  `EARTH_RADIUS_KM = 6371.0` (semicolon style in that file).
- `src/core/` rule (CLAUDE.md): "simulation truth … No React, no three." The
  new function must take plain `Vec3`.
- Test pattern: `tests/unit/orbital/CoordinateConversions.test.ts` (known-answer
  vectors, `toBeCloseTo`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| Focused tests | `npx vitest --run tests/unit/orbital/SunVisibility.test.ts tests/unit/rendering` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `src/core/orbital/SunVisibility.ts` (create)
- `src/rendering/iss/eclipseLighting.ts` (create)
- `src/rendering/iss/ISSModel.tsx` (only the eclipse block, the four consumers listed above, and imports)
- `src/rendering/iss/ISSAnimations.tsx` (only the `sunlit` computation and the two radius constants)
- `tests/unit/orbital/SunVisibility.test.ts` (create)
- `tests/unit/rendering/EclipseLighting.test.ts` (create)

**Out of scope**: `ISSJointKinematics.ts` and its tests (joint behaviour must
not change), Earth/terminator shaders, `Postprocessing.tsx`, the glint's
opacity/size logic, `docs/**`, `plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch; one commit per step; never commit a red tree.
- Subject style: `Add a penumbra sun-visibility model to core/orbital`.
- End every commit body with the attribution lines YOUR harness specifies for
  commits (the `Co-Authored-By:` line naming the model that actually did the
  work), followed by
  `Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u`.
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: The pure visibility function

Create `src/core/orbital/SunVisibility.ts`:
```ts
import type { Vec3 } from '@/utils/math'
import { EARTH_RADIUS_KM } from '@/utils/constants'

/** Apparent solar radius at 1 AU: 695,700 km / 149,597,870.7 km (rad). */
export const SUN_ANGULAR_RADIUS_RAD = 695_700 / 149_597_870.7

/**
 * Fraction of the solar disc visible from `positionKm` (any Earth-centred
 * frame) given the unit `sunDir` in the SAME frame: 1 in full sun, 0 in umbra,
 * and the visible-segment fraction across the penumbra. Earth is a sphere of
 * EARTH_RADIUS_KM; its limb is treated as straight across the tiny solar disc
 * (Earth subtends ~65° at ISS altitude vs the Sun's 0.27°), which makes the
 * visible fraction the circular-segment area below. The 0.5 crossing is
 * exactly the old cylinder edge, so a boolean `>= 0.5` reproduces it.
 */
export function sunVisibility(positionKm: Vec3, sunDir: Vec3): number
```
Implementation:
- `r = |position|`; if `r <= EARTH_RADIUS_KM` return 0.
- `rhoE = Math.asin(EARTH_RADIUS_KM / r)`.
- `cosTheta = clamp(-(p·s)/r, -1, 1)` (angle between the direction to Earth's
  centre and the Sun); `theta = Math.acos(cosTheta)`.
- `x = (theta - rhoE) / SUN_ANGULAR_RADIUS_RAD` (signed limb distance in solar
  radii; positive = Sun centre outside Earth's disc).
- `x >= 1` → 1; `x <= -1` → 0; else
  `1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI`.
- Also export `isSunlit(positionKm, sunDir): boolean` → `sunVisibility(...) >= 0.5`.

Tests `tests/unit/orbital/SunVisibility.test.ts` (r = 6771, Sun along +x):
- station at `(-6771, 0, 0)` (behind Earth) → `0`.
- station at `(0, 6771, 0)` → `1`; station at `(6771, 0, 0)` → `1`.
- Place the station so `theta` equals `rhoE` exactly: position
  `r·(-cos(rhoE), sin(rhoE), 0)` → `0.5` (±1e-9) and `isSunlit` → true.
- `theta = rhoE ± SUN_ANGULAR_RADIUS_RAD` → `1` / `0` (±1e-9).
- Monotonic non-decreasing over 200 samples of theta across
  `[rhoE - 2ρS, rhoE + 2ρS]`.
- Penumbra width: the arc length `r × 2ρS` between the 0 and 1 edges is
  `≈ 63 km` (assert `56 < w < 70`).
- Agreement with the old cylinder test away from the edge: for 1,000
  pseudo-random positions at r ∈ [6600, 7000] (seeded LCG, no Math.random)
  with `|x| > 1.5`, `isSunlit === !(p·s < 0 && |p|² − (p·s)² < R²)`.
- `r <= R` → 0.

**Verify**: `npx vitest --run tests/unit/orbital/SunVisibility.test.ts` → all pass.

### Step 2: Continuous lighting curves

Create `src/rendering/iss/eclipseLighting.ts` (pure, no three):
```ts
/**
 * Lighting response to the station's shade (1 − sun visibility). Endpoints
 * reproduce the pre-penumbra values exactly: shade 0 = the old sunlit branch,
 * shade 1 = the old eclipse branch; values between are linear in shade.
 */
export interface EclipseLighting { exposureBoost: number; ambient: number; earthshine: number }
export function eclipseLighting(shade: number): EclipseLighting
```
`shade` clamped to [0, 1]; `exposureBoost = 1 + 1.3·shade` (1.0 → 2.3),
`ambient = 0.24 + 0.18·shade` (0.24 → 0.42), `earthshine = 0.65·shade`
(0 → 0.65). Tests: endpoints exact; midpoint; clamping of −1 and 2.

**Verify**: `npx vitest --run tests/unit/rendering/EclipseLighting.test.ts` → all pass.

### Step 3: Consume it in ISSModel

Replace the `isShadowed` block with:
```ts
// 3b. Sun visibility across the ~63 km penumbra (core/orbital/SunVisibility):
// lighting follows the continuous value, so a terminator crossing is a fade,
// not a one-frame switch.
const shade = 1 - sunVisibility(worldPos.current, _sunDirVec)
const lighting = eclipseLighting(shade)
```
- `shadowExposureBoost` → `lighting.exposureBoost` (both point lights).
- `baseAmbientIntensity` → `lighting.ambient`.
- Earthshine: `if (shade > 0) { ...unchanged positioning...; earthshine.intensity = lighting.earthshine * smoothMultiplier } else { earthshine.intensity = 0.0 }`.
- Glint: `glintUniforms.uColor.value.copy(GLINT_COLOR_SUNLIT).lerp(GLINT_COLOR_SHADOW, shade)`.
- Remove the now-unused `p`/`perpSq`/`isShadowed` locals; keep
  `_sunDirVec` (still used). Update comments that said "In shadow → 2.3×" so
  they describe the continuous response.

**Verify**: `grep -n "6371.0 \* 6371.0\|isShadowed" src/rendering/iss/ISSModel.tsx` → nothing; `npm run typecheck` → exit 0.

### Step 4: Consume it in ISSAnimations (boolean at 0.5)

Replace the three-line `sunlit` computation with
`const sunlit = isSunlit(_worldPos.current, _sunWorld.current)` and delete
`EARTH_RADIUS_KM` / `EARTH_RADIUS_KM_SQ` and their comment (replace the
comment with one line: the TRRJ law switches at the penumbra midpoint, the
same edge the old cylinder test used). Leave everything else untouched.

**Verify**: `npx vitest --run tests/unit/rendering/ISSJointKinematics.test.ts` →
all pass, unchanged; `npm run verify` → exit 0.

## Test plan

New: `SunVisibility.test.ts` (≥ 9 cases incl. the cylinder-agreement sweep),
`EclipseLighting.test.ts` (≥ 4). Existing joint tests must pass unmodified.
Reviewer browser check (not for the executor): at 60–300× through a
terminator at Follow range, the key light fades over several frames.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -rn "perpSq" src/rendering` returns nothing
- [ ] `grep -n "sunVisibility\|isSunlit" src/rendering/iss/ISSModel.tsx src/rendering/iss/ISSAnimations.tsx` matches in both files
- [ ] `git diff --stat aa206a1..HEAD` lists only in-scope files

## STOP conditions

- Any `ISSJointKinematics` test changes behaviour.
- The cylinder-agreement sweep fails for points with `|x| > 1.5` (the model
  would disagree with the old test away from the penumbra — report).
- The change seems to need edits outside the listed blocks.

## Maintenance notes

- The penumbra uses a spherical Earth and no atmospheric refraction/extinction
  (real twilight on the station is a few seconds longer and reddened); that is
  a deliberate, documented simplification.
- The day/night countdown plan bisects `sunVisibility(...) = 0.5` — keep the
  0.5 crossing on the cylinder edge if this function is ever retuned.
