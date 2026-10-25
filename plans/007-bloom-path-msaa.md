# Plan 007: The default (Bloom) pipeline is anti-aliased like the direct pipeline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e78d38d..HEAD -- src/rendering/post/Postprocessing.tsx`
> If it changed since this plan was written, compare the "Current state"
> excerpt against the live code; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (fill-rate cost on weak GPUs; visual change)
- **Depends on**: none
- **Category**: bug (visual quality)
- **Planned at**: commit `e78d38d`, 2026-10-24

## Why this matters

The Canvas is created with `antialias: true` (`SceneRoot.tsx`), but that only
multisamples the DEFAULT framebuffer. Bloom is on by default
(`settingsStore` `postprocessing: true`), and then the scene renders into the
EffectComposer's own target, which three r170 creates as
`new WebGLRenderTarget(w*pr, h*pr, { type: HalfFloatType })` with NO samples
(`node_modules/three/examples/jsm/postprocessing/EffectComposer.js:27`). Only
OutputPass's full-screen quad reaches the multisampled backbuffer. Result: in
the default mode the ISS truss/arrays, the Earth limb and the orbit Line2 are
aliased, while Bloom-off is smooth; `clouds.frag` even notes it relies on
hardware MSAA. Passing a multisampled HalfFloat target to the composer fixes
it. three r170 is WebGL2-only, so `samples` on a render target is supported;
the HalfFloat colour-buffer requirement is the same one the composer already
has.

## Current state

`src/rendering/post/Postprocessing.tsx` (inside `Postprocessing`):
```tsx
useEffect(() => {
  const composer = new EffectComposer(gl)
  composer.addPass(new RenderPass(scene, camera))
  ...
  composer.setSize(size.width, size.height)
  composer.setPixelRatio(gl.getPixelRatio())
  ...
  return () => {
    bloom.dispose()
    flare.pass.dispose()
    outputPass.dispose()
    composer.dispose()
    ...
  }
}, [gl, scene, camera])
```
`EffectComposer(renderer, renderTarget)` accepts an optional target; when
given, it uses it as `renderTarget1`, clones it for `renderTarget2`, and
`setSize`/`setPixelRatio` resize both. `composer.dispose()` disposes both.

Hard invariant (CLAUDE.md): "Bloom OFF must render bit-for-bit like the
direct pipeline (no composer)." This plan changes only the Bloom-ON path; the
gate component `PostprocessingGate` keeps unmounting the composer when Bloom
is off.

File style: no semicolons; tuning constants live at the top of the file with
a comment ("All tuning constants live here").

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `src/rendering/post/Postprocessing.tsx`

**Out of scope**:
- `SceneRoot.tsx` (the Canvas `antialias` flag stays — Bloom-off needs it).
- `SunFlare.ts` (plan 006), bloom strength/radius/threshold.
- `docs/**`, `plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch; one commit, subject
  `Multisample the bloom composer's scene target`.
- End the commit body with these two lines verbatim:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u
  ```
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: Pass a multisampled HalfFloat target

- Add near the bloom constants:
  ```ts
  // The composer bypasses the Canvas's antialiased backbuffer, so the scene
  // target carries its own MSAA (WebGL2). Bloom off never uses this path.
  const COMPOSER_MSAA_SAMPLES = 4
  ```
- Replace `new EffectComposer(gl)` with
  ```ts
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: COMPOSER_MSAA_SAMPLES,
  })
  target.texture.name = 'EffectComposer.rt1'
  const composer = new EffectComposer(gl, target)
  ```
  (`composer.setSize(...)` / `setPixelRatio(...)` already follow, sizing
  both targets; `composer.dispose()` already frees both — do not add a
  second dispose.)
- Update the `Postprocessing` doc comment's render-contract paragraph with
  one sentence noting the scene target is multisampled.

**Verify**: `npm run typecheck` → exit 0; `grep -n "samples: COMPOSER_MSAA_SAMPLES" src/rendering/post/Postprocessing.tsx` → 1 match.

### Step 2: Gate

**Verify**: `npm run verify` → exit 0.

## Test plan

No GL in unit tests. Verification is the gate plus the reviewer's browser
check: with Bloom on, the ISS truss edge and the Earth limb are smooth
(compare a screenshot against Bloom off); no console errors; FPS at the
overview stays vsync-steady on the reviewer's machine.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `git diff --stat e78d38d..HEAD` lists only `src/rendering/post/Postprocessing.tsx`

## STOP conditions

- `EffectComposer`'s constructor in `node_modules/three/examples/jsm/postprocessing/EffectComposer.js`
  does not accept a second `renderTarget` argument.
- The change appears to require modifying `PostprocessingGate` or the Bloom-off path.

## Maintenance notes

- If a weak-GPU report shows the Bloom path fill-bound, the `DprGovernor`
  already lowers DPR; a second lever is `COMPOSER_MSAA_SAMPLES = 2`.
- The detail-prep target (plan 006) needs no change: MSAA samples are not part
  of three's shader program key.
