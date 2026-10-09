# ISS model implementation handoff

> STATUS 2026-10-08: plan 001 is COMPLETE (merged via PR #12; Phases A-F
> landed). Only optional Phase D remains, postponed by user decision.
> Live ledger: plans/PROGRESS.md (short) + plans/PROGRESS-history.md (archive).

Read [001 — ISS model audit and repair](001-iss-model-audit-and-repair.md) in full before implementing.

The user requested one consolidated implementation document after a read-only audit. No application source or model assets were changed. This directory contains the deliverable, not completed fixes.

**Fresh-session bootstrap**: read `plans/001-*.md`, `docs/ISS_MODEL_CONTEXT.md`, then `plans/PROGRESS.md` (exact per-file implementation ledger, updated as work lands). Do not rely on chat history.

## Execution order and status

| Plan | Priority | Status | Dependencies |
|---|---|---|---|
| [001 — Repair ISS articulation, preserve the rig, and correct model integration](001-iss-model-audit-and-repair.md) | P1 | Phases A–C, F and E landed; docs errata done. Only optional Phase D (perf batching) remains — see plans/PROGRESS.md | None; execution phases below |

Baseline: `fd5d353` plus the working-tree excerpts and asset hashes recorded in the plan, audited 2026-09-27. Do not assume the commit captures uncommitted source changes.

### Core model work

1. **Phase A — Independent asset/rig checks and safe publication.** Fix missing WebP extension registration, misleading bounds validation, incomplete rig requirements, and six pruned attachment frames.
2. **Phase B — Deterministic mechanism repair.** Correct TRRJ axis/shaft behavior, remove attitude-dependent AABB inference, constrain the radiator control law, and fix oscillator/spec association.
3. **Phase C — Panel-specific material repair and validated rebuild.** Correct actual panel surfaces; remove the blanket runtime silver override.
4. **Phase D — Animation-safe rigid batching.** Merge only inside protected rigid/module regions. Measure draw calls and decoded costs; retain future joints.

Dependencies: A establishes the contract; B/C must be verified before D optimizes the repaired rig. Geometry optimization is not the first step.

### Related integration work

5. **Phase E — Model normalization and lifecycle.** Correct Legacy's heading/span/center and Model A's span/center; repair the fallback boundary, active/pending selection handoff, reselection, and Locate availability. Keep this review separate from the High geometry patch.
6. **Phase F — Camera clearance and discontinuous pose handling.** Use corrected swept envelopes and coherent pose resets. Preserve ordinary tracking, the right-handed frame, and the common 109-unit scale.

E's loading-boundary correction can be developed independently. Final acceptance includes model switching after B/C. F's clearance values depend on the corrected assets, so do not freeze a new radius before those changes.

## Evidence covered

- Original binary FBX metadata, 702 model records and parent connections; raw and shipped GLB comparison.
- Actual Three/Draco decoded geometry and mounted asset measurements.
- Standalone and in-app visual inspection; a 5,700-second simulation run at 120×.
- Controlled High/A load failures, preparation failure, reselection, and selection during Locate.
- Actual camera/array intersection and a real half-orbit seek through the renderer.
- Primary NASA mechanism/operations references and Khronos WebP requirements.
- **Follow-up (orientation/solar, same day):** anatomical handedness/landmark verification on the mounted High model; a 56-case β/phase sweep of the actual shipped SARJ controller plus validated BGA correction; iROSA cant measured at 10.0012° (matches the published ~10° install cant); Sun/light/eclipse input consistency; negative-determinant mesh inventory; Russian-array rigging absence. Result: High is **not** upside down or mirrored and SARJ tracking is numerically correct; new optional findings S2 (BGA tilt), S3 (Russian array rigging), S4 (merge caution list), S5 (blanket underside texture) are in plan 001 sections 3–5 and the acceptance matrix.

Full numerical evidence, source references, acceptance matrix, scope boundaries, and verification limits are in plan 001. No production build, unit-suite run, or cross-device benchmark is claimed.

## Findings considered and rejected

See section 9 of plan 001 for the complete list. Important exclusions:

- High's enlarged 109-unit scale is intentional; do not reduce it.
- Eight original wings, six iROSAs, both EATCS banks, and ERA geometry are present.
- A TRRJ origin inside the longitudinal span is not inherently an incorrect shaft pivot.
- High's anatomical pre-rotation is not shown to be reversed; Legacy has its own verified mismatch.
- Cached GLTF resource sharing does not justify unconditional disposal.
- Static Legacy/A and currently parked BGAs are intentional, not missing animation bugs.

## Optional direction, not implementation prerequisites

Validated shutters/additional cameras, BGA pose control, and robotics sequences can be added incrementally. ERA/deployment needs actual rig/mesh work. KTX2 and operational flight-attitude data are separate choices. The plan preserves their useful boundaries without claiming to implement these features.

Executors should update this row only after the applicable end-to-end acceptance criteria pass. Status values: TODO, IN PROGRESS, DONE, or BLOCKED with a concrete reason.
