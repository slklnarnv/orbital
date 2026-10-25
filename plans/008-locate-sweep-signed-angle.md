# Plan 008: Locate from close range arrives at the planned standoff, not its mirror image

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e78d38d..HEAD -- src/interaction/camera/CameraFlightPath.ts tests/unit/camera/CameraFlightPath.test.ts`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (camera code is "closed unless a measured trace says
  otherwise" — Step 1 produces that trace as a failing test FIRST)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e78d38d`, 2026-10-24

## Why this matters

`CameraFlightPath.planLocate` rotates the eye about a fixed axis
`sweepAxis = normalize(cross(dirStart, stationDir))` by `+sweepAngle`, where
`sweepAngle = dirStart.angleTo(dirEnd)` is UNSIGNED. The arrival standoff
`dirEnd` sits ~2° from the station ON THE DEPARTURE SIDE
(250 km up the radial + 250 km back along `approach = cross(stationDir, sweepAxis)`,
which points toward the departure). Rotating by `+angle` always moves toward
and past the station. When the departure is angularly CLOSER to the station
than the standoff is (θ < δ ≈ atan(250 / (r + 250)) ≈ 2°, i.e. a camera within
~240 km laterally — practically every Inspect/close Free departure), the
correct rotation is backward; the code rotates forward instead, crosses over
the station and lands on the far side of it instead of the planned standoff. The same happens
in the colinear fallback (camera exactly over the station). HANDOFF documents
the intended behaviour: "the standoff sits on the sweep's own approach side".
A signed angle about `sweepAxis` fixes it with no change to any other route
(for θ > δ the signed angle equals today's unsigned one).

## Current state

`src/interaction/camera/CameraFlightPath.ts`, `planLocate` (~line 86-113):
```ts
planLocate(_arrivalEye: THREE.Vector3, station: THREE.Vector3): number {
  const stationDir = station.clone().normalize()
  this.dirStart.copy(this.radial)
  this.radiusStart = this.startRadius
  this.targetStart.copy(this.target)
  this.stationPlanned.copy(station)

  this.sweepAxis.crossVectors(this.dirStart, stationDir)
  if (this.sweepAxis.lengthSq() < 1e-8) {
    this.sweepAxis.crossVectors(this.dirStart, Math.abs(this.dirStart.y) < 0.9 ? REF_A : REF_B)
  }
  this.sweepAxis.normalize()

  // Arrive offset from the station, on the side the rotation approaches from:
  // 250 km up its radial and 250 km back along the incoming tangent.
  const approach = new THREE.Vector3().crossVectors(stationDir, this.sweepAxis).normalize()
  const dirEnd = station.clone().addScaledVector(stationDir, 250).addScaledVector(approach, 250)
  this.radiusEnd = dirEnd.length()
  this.sweepAngle = this.dirStart.angleTo(dirEnd.clone().normalize())

  const cruiseTerm = Math.min(2000, Math.max(0, this.startRadius - 20_000) * 0.025)
  return 2000 + cruiseTerm + this.sweepAngle * 350
}
```
`sampleLocate` (~line 115):
`eye.copy(this.dirStart).applyAxisAngle(this.sweepAxis, this.sweepAngle * eased)`,
then radius lerp (clamped above `CAMERA_ZOOM_RANGES.ORBITAL.minDistance + 1`),
then `eye.add(stationDrift)`.

Tests: `tests/unit/camera/CameraFlightPath.test.ts` (`describe('simple Locate sweep')`,
e.g. `'starts at the captured view and ends centered on the station'` builds
`new CameraFlightPath(eyePos, targetPos)`, calls
`path.planLocate(arrival, station)` and `path.sampleLocate(arrival, station, p, eye, target)`).
Use `Vector3` from `three` as the file already does.

Settled camera decisions you must preserve (docs/HANDOFF.md): one fixed-axis
sweep with uniform angular rate; station-relative translation; duration =
`2000 + cruiseTerm + |sweep angle| × 350` ms.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| Focused tests | `npx vitest --run tests/unit/camera` | all pass (after Step 2) |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `src/interaction/camera/CameraFlightPath.ts` (only `planLocate`)
- `tests/unit/camera/CameraFlightPath.test.ts`

**Out of scope**: `CameraController.tsx`, `FlightHorizon`, the Reset path,
timing constants, the 250 km standoff geometry, `docs/**`, `plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch. Commit 1: the failing test (allowed to be
  red only inside this commit's message context — run it, record the failure
  in the commit body); commit 2: the fix. Or one commit containing both,
  with the pre-fix failure quoted in the body.
- Subject style: `Sign the Locate sweep angle so close departures land on the planned standoff`.
- End every commit body with these two lines verbatim:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u
  ```
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: Write the characterization test (expected to FAIL now)

In `describe('simple Locate sweep')`, add
`it('arrives on the departure-side standoff when departing inside it', …)`:
- `const station = new Vector3(0, 0, 6771)`; `stationDir = station.clone().normalize()`.
- Departure: eye 150 km from the station, displaced 0.5° from the station's
  radial about the x axis: `const eyeStart = new Vector3(0, 0, 6921).applyAxisAngle(new Vector3(1, 0, 0), 0.5 * Math.PI / 180)`;
  target = `station.clone()`.
- `path = new CameraFlightPath(eyeStart, station.clone())`;
  `path.planLocate(new Vector3(), station)`.
- Compute the expected standoff exactly as `planLocate` defines it:
  `axis = normalize(cross(normalize(eyeStart), stationDir))`,
  `approach = normalize(cross(stationDir, axis))`,
  `expected = station + 250·stationDir + 250·approach`.
- `path.sampleLocate(new Vector3(), station, 1, eye, target)`;
  `expect(eye.distanceTo(expected)).toBeLessThan(1)`.
- Also assert the eye at progress 1 is on the SAME side of the station as
  the departure: `(eye − station)·approach > 0`.
Add a second case for the colinear fallback: eye exactly on the station
radial (`new Vector3(0, 0, 6921)`), same expectations computed with the
fallback axis (`cross(dirStart, REF)` where `REF = (0,1,0)` since
`|dirStart.y| < 0.9`).

**Verify**: `npx vitest --run tests/unit/camera/CameraFlightPath.test.ts`
→ the two NEW cases FAIL (the eye lands on the far side of the station,
hundreds of km from `expected`), all existing cases pass. Record the
reported distance.

### Step 2: Use a signed sweep angle

In `planLocate`, replace the unsigned angle with a signed one about
`sweepAxis`:
```ts
const dirEndN = dirEnd.clone().normalize()
const cross = new THREE.Vector3().crossVectors(this.dirStart, dirEndN)
// Signed about the sweep axis: a departure already inside the standoff
// (closer to the station than the 2° standoff offset) must rotate BACK
// toward the approach side; an unsigned angle swung it over the station to
// the standoff's mirror image.
this.sweepAngle = Math.atan2(cross.dot(this.sweepAxis), this.dirStart.dot(dirEndN))
```
and the duration term uses the magnitude:
`return 2000 + cruiseTerm + Math.abs(this.sweepAngle) * 350`.
`sampleLocate` needs no change (`applyAxisAngle` accepts negative angles).

**Verify**: `npx vitest --run tests/unit/camera` → ALL pass, including the
two new cases and every pre-existing case unchanged.

### Step 3: Gate

**Verify**: `npm run verify` → exit 0.

## Test plan

Two new cases (inside-standoff departure; colinear departure). Every existing
Locate test must pass unmodified — they cover θ > δ routes, where the signed
angle equals the old unsigned one.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -n "angleTo(dirEnd" src/interaction/camera/CameraFlightPath.ts` returns nothing
- [ ] `grep -n "Math.abs(this.sweepAngle)" src/interaction/camera/CameraFlightPath.ts` matches
- [ ] 2 new test cases exist and pass; no existing case was edited
- [ ] `git diff --stat e78d38d..HEAD` lists only the two in-scope files

## STOP conditions

- Step 1's new tests PASS before the fix (the bug premise is false) — STOP and report the numbers.
- Any pre-existing test fails after Step 2.
- The fix appears to need changes outside `planLocate`.

## Maintenance notes

- Reviewer browser check: Inspect the station from directly above at
  ~150 km, press Locate — the camera should glide back to the usual
  "behind and above" Follow framing without swinging over the model.
- If the standoff geometry (250/250 km) ever changes, the new tests compute
  the expected point from the same formula, so they stay valid.
