# Plan 006: The tracking glint animates, detail prep warms the shader variant the composer actually draws, the flare mask never mirrors, and two lifecycle edges are closed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e78d38d..HEAD -- src/rendering/iss/ISSModel.tsx src/rendering/post/SunFlare.ts src/rendering/scene/SceneRoot.tsx src/stores/loadingStore.ts tests/unit/rendering`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW–MED (render-loop code; no simulation change)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e78d38d`, 2026-10-24

## Why this matters

Verified by reading R3F 8.18 and three r170 internals:

1. **The glint's uniforms freeze.** `ISSModel.tsx` passes an inline
   `uniforms={{ uColor: { value: new THREE.Color(...) }, uOpacity: {...} }}`
   object, re-created on EVERY ISSModel render. R3F assigns the new object to
   `material.uniforms` (reference diff, no `needsUpdate`), but three's
   renderer keeps uploading the object it captured when the program was
   acquired (`WebGLRenderer.js:1694` `materialProperties.uniforms = parameters.uniforms`,
   read every frame at `:1963`). ISSModel re-renders routinely (`setIsNear`,
   `setIsClose`, loading-store changes, resizes), after which the frame loop
   writes `uOpacity`/`uColor` into an object the GPU never reads: the
   150–1000 km fade and the sunlit/shadow tint stop working. The Earth
   materials already do this correctly with `useMemo` (`EarthSurface`,
   `CloudLayer`, `AtmosphereShell`). The frame loop also parses a hex string
   into the colour every frame.
2. **Detail prep compiles the wrong shader variant with Bloom on (the
   default).** `prepare()` runs `gl.compileAsync(...)` and a zero-scissor
   `gl.render(scene, camera)` while the current render target is `null`
   (OutputPass leaves it null). three builds tone mapping and output colour
   space into the program cache key from the CURRENT render target (ACES +
   sRGB only when it is null), but with the composer on, RenderPass draws the
   scene into a HalfFloat target (NoToneMapping + Linear). So prep warms
   programs the composer never uses, and the first visible frame of each
   detail tier still pays shader linking — the hitch prep exists to remove.
3. **The lens-flare Earth mask mirrors when Earth is behind the camera.**
   `SunFlare.update` projects Earth's centre with `x / -z` without checking
   that it is in front of the camera; with Earth behind (looking away from
   Earth toward the sun) the mask disc lands mirrored on screen and can blank
   the whole flare even though the CPU occlusion test passed. (Flare is
   default off.)
4. **PMREM render target leaks on unmount.** `RuntimeEnvironment` keeps only
   `pmrem.fromScene(...).texture` and disposes the texture; three ignores
   `dispose()` on a render-target texture, so the target (texture, framebuffer,
   depth) leaks (today only on HMR, but also on every context-restore rebuild).
5. **`unavailable` is documented terminal but `beginISSDetailAttempt` revives
   it.** After Model A fails, a settings change starts a new detail attempt
   and flips `shouldAwaitDetail` back to true.
6. **An explicit reselect after a demotion starts a spurious legacy attempt**
   (the selection effect reads the stale demoted `requestedQuality` in the
   same run in which it clears the demotion).

## Current state

- `src/rendering/iss/ISSModel.tsx`
  - glint JSX (~line 843):
    ```tsx
    <mesh ref={auraRef} visible={false}>
      <planeGeometry args={[12.0, 12.0]} />
      <shaderMaterial
        vertexShader={billboardVert}
        fragmentShader={softGlowFrag}
        uniforms={{
          uColor: { value: new THREE.Color('#A8D8FF') }, // Light blue glint (shadow shifts deeper blue)
          uOpacity: { value: 0.0 },
        }}
        transparent={true}
        depthWrite={false}
        depthTest={true}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
    ```
  - frame loop (~line 768):
    ```ts
    const mat = auraRef.current.material as THREE.ShaderMaterial
    if (mat) {
      mat.uniforms.uOpacity.value = glintOpacity
      // Daylight (light blue glint) vs. shadow (deeper blue) color shift
      ;(mat.uniforms.uColor.value as THREE.Color).set(isShadowed ? '#6FAEE0' : '#A8D8FF')
    }
    ```
  - `DetailedISSModel` `prepare()` (~line 395-430): texture upload loop,
    `await gl.compileAsync(detailedScene, camera, scene)`, then a
    zero-scissor prime:
    ```ts
    // A zero-area scissor uploads vertex buffers without writing any pixels.
    // Unlike an offscreen target, it uses the exact on-screen shader variant.
    const group = groupRef.current
    const wasVisible = group.visible
    const previousScissor = gl.getScissor(new THREE.Vector4())
    const previousScissorTest = gl.getScissorTest()
    try {
      group.visible = true
      for (const { mesh } of meshes) mesh.frustumCulled = false
      gl.setScissor(0, 0, 0, 0)
      gl.setScissorTest(true)
      gl.render(scene, camera)
    } finally { ...restore... }
    ```
  - selection effect (~line 509-542):
    ```ts
    const nonceChanged = seenSelection.current.nonce !== selectionNonce
    const qualityChanged = seenSelection.current.quality !== requestedQuality
    seenSelection.current = { quality: requestedQuality, nonce: selectionNonce }
    if (nonceChanged) setDemotedQuality(null)
    if (!nonceChanged && !qualityChanged) return

    const detail = store.issDetail
    if (requestedQuality === 'legacy') {
      if (detail.activeQuality !== 'legacy') store.beginISSDetailAttempt('legacy')
      return
    }
    ...
    ```
    where `const requestedQuality = demotedQuality ?? settingQuality`.
- `src/rendering/post/Postprocessing.tsx` — `PostprocessingGate` mounts the
  composer when `useSettingsStore` `postprocessing` is true (default true).
  Do not modify this file (plan 007 owns it).
- `src/rendering/post/SunFlare.ts` `update()` (~line 177-186):
  ```ts
  // Earth centre, for the shader-side disc mask.
  _camSpace.copy(camera.position).multiplyScalar(-1).applyQuaternion(_invQuat)
  const earthX = (_camSpace.x / -_camSpace.z) / halfAspect
  const earthY = (_camSpace.y / -_camSpace.z) / tanHalf
  ...
  u.uEarthRadius.value = tanHalf > 0 ? Math.tan(angEarth) / tanHalf : 0
  ```
  Shader: `float earthMask = smoothstep(uEarthRadius - 0.01, uEarthRadius + 0.01, length(p - earth));`
  (a NEGATIVE radius makes the mask 1 everywhere).
- `src/rendering/scene/SceneRoot.tsx` `RuntimeEnvironment` (~line 136-154):
  `let envTexture: THREE.Texture | null`; `release()` calls
  `envTexture?.dispose()`; `build()` does
  `envTexture = pmrem.fromScene(room, 0.04).texture`.
- `src/stores/loadingStore.ts`:
  ```ts
  beginISSDetailAttempt: (quality) => {
    let attempt = 0
    set((state) => {
      attempt = state.issDetail.attempt + 1
      return { issDetail: { ...state.issDetail, status: 'loading', quality, attempt } }
    })
    return attempt
  },
  ```
- Tests: `tests/unit/rendering/ISSModelLifecycle.test.ts` drives the loading
  store directly (pattern for Step 5). There is no GL in unit tests (node
  env), so GL-touching logic must be extracted into small pure helpers that
  take a minimal fake `gl`.

Conventions: these rendering files mostly omit semicolons except `SunFlare.ts`
(which uses them — match each file's local style). Comments explain WHY;
update any comment your change makes false.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deps (worktree) | `ln -s /home/user/orbital/node_modules node_modules` | symlink (git-excluded; never stage) |
| Focused tests | `npx vitest --run tests/unit/rendering` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Gate | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `src/rendering/iss/ISSModel.tsx`
- `src/rendering/iss/detailPreparation.ts` (create — pure helper for Step 2)
- `src/rendering/post/SunFlare.ts`
- `src/rendering/scene/SceneRoot.tsx` (only `RuntimeEnvironment`)
- `src/stores/loadingStore.ts` (only `beginISSDetailAttempt`)
- `tests/unit/rendering/ISSModelLifecycle.test.ts`
- `tests/unit/rendering/DetailPreparation.test.ts` (create)
- `tests/unit/rendering/SunFlareMask.test.ts` (create)

**Out of scope** (do NOT touch):
- `src/rendering/post/Postprocessing.tsx` (plan 007 changes the composer target).
- The eclipse/shadow math in `ISSModel.tsx` (`isShadowed`) and
  `ISSAnimations.tsx` — a later plan replaces it with a penumbra model. Keep
  `isShadowed` exactly as is; only change how the colour is SET.
- The `antialias` Canvas flag, bloom constants, tone mapping.
- Camera code, `ISSAnimations.tsx`, `ISSJointKinematics.ts`.
- `docs/**`, `plans/PROGRESS.md`.

## Git workflow

- Work on your worktree's branch; one commit per step.
- Subject style: imperative sentence case, e.g.
  `Keep the glint uniforms stable across ISSModel renders`.
- End every commit body with these two lines verbatim:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JNgErmGLcFrBcMpVkE1x1u
  ```
- Stage by explicit path. Do NOT push.

## Steps

### Step 1: Stable glint uniforms and no per-frame colour parsing

In `ISSModel` (the outer component):
- `const glintUniforms = useMemo(() => ({ uColor: { value: new THREE.Color(GLINT_COLOR_SUNLIT) }, uOpacity: { value: 0.0 } }), [])`
  and pass `uniforms={glintUniforms}`.
- Module constants: `const GLINT_COLOR_SUNLIT = new THREE.Color('#A8D8FF')`,
  `const GLINT_COLOR_SHADOW = new THREE.Color('#6FAEE0')` (keep the existing
  comments about light blue vs deeper blue).
- Frame loop: `glintUniforms.uOpacity.value = glintOpacity` and
  `glintUniforms.uColor.value.copy(isShadowed ? GLINT_COLOR_SHADOW : GLINT_COLOR_SUNLIT)`
  (write through the memoised object, not `mat.uniforms`).
- Add a short comment above the `useMemo` explaining why the object must be
  stable (the renderer captures the uniforms object at program acquisition).

**Verify**: `grep -n "uniforms={{" src/rendering/iss/ISSModel.tsx` → no match;
`grep -n "\.set(isShadowed" src/rendering/iss/ISSModel.tsx` → no match;
`npm run typecheck` → exit 0.

### Step 2: Prepare against the target the composer draws into

Create `src/rendering/iss/detailPreparation.ts`:
```ts
import * as THREE from 'three'

/** Minimal renderer surface used by preparation (a fake in tests). */
export interface PreparationRenderer {
  getRenderTarget(): THREE.WebGLRenderTarget | null
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void
}

/**
 * three keys tone mapping and output colour space on the CURRENT render
 * target (ACES + sRGB only when it is null). With the bloom composer active,
 * RenderPass draws the scene into a HalfFloat target, so warming programs
 * against the default framebuffer compiles a variant the composer never
 * uses. Run `work` with an equivalent offscreen target bound, then restore.
 */
export function withPreparationTarget<T>(
  gl: PreparationRenderer,
  target: THREE.WebGLRenderTarget | null,
  work: () => T,
): T {
  if (!target) return work()
  const previous = gl.getRenderTarget()
  gl.setRenderTarget(target)
  try {
    return work()
  } finally {
    gl.setRenderTarget(previous)
  }
}

/** A 1×1 HalfFloat target matching the composer's colour format. */
export function createPreparationTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
}
```
In `prepare()`:
- `const composerActive = useSettingsStore.getState().postprocessing`
  (`useSettingsStore` is already imported in this file; if not, import from
  `@/stores/settingsStore`).
- `const prepTarget = composerActive ? createPreparationTarget() : null`;
  dispose it in a `finally` around the rest of `prepare()` (also on
  cancellation).
- Compile: `const compiled = withPreparationTarget(gl, prepTarget, () => gl.compileAsync(detailedScene, camera, scene))`
  then `await compiled`. (`compileAsync` creates the programs synchronously
  in its first call using the current target, so restoring right after the
  call is correct; do not hold the target across the `await` — the composer
  renders in between.)
- Wrap the zero-scissor `gl.render(scene, camera)` in
  `withPreparationTarget(gl, prepTarget, () => gl.render(scene, camera))`
  (inside the existing try/finally that restores scissor state).
- Rewrite the comment "Unlike an offscreen target, it uses the exact
  on-screen shader variant." to say the prime runs against the same target
  kind the visible frame uses (default framebuffer without Bloom, a HalfFloat
  target with Bloom).

Test `tests/unit/rendering/DetailPreparation.test.ts`: a fake renderer
recording `setRenderTarget` calls; assert (a) with `null` target `work` runs
and no calls are made; (b) with a target, calls are `[target, previous]` and
`work` saw the target bound; (c) when `work` throws, the previous target is
still restored and the error propagates; (d) the return value passes through.
`createPreparationTarget().texture.type === THREE.HalfFloatType` (construct
only; no GL needed).

**Verify**: `npx vitest --run tests/unit/rendering/DetailPreparation.test.ts` → 5 pass; `npm run typecheck` → exit 0.

### Step 3: Disable the shader-side Earth mask when Earth's centre is behind the camera

In `SunFlare.update`, after computing `_camSpace` for the Earth centre: if
`_camSpace.z >= 0` (centre at or behind the camera plane), set
`u.uEarthRadius.value = -1` (comment: the projection would mirror the disc;
a negative radius makes `earthMask` 1 everywhere and the CPU occlusion test
above still gates `uStrength`) and skip the `earthX/earthY` write or write
any finite value. Otherwise keep today's behaviour.

Extract the decision into an exported pure function in `SunFlare.ts`, e.g.
`export function earthMaskRadius(earthCamZ: number, angEarth: number, tanHalf: number): number`,
returning `-1` when `earthCamZ >= 0`, else `tanHalf > 0 ? Math.tan(angEarth) / tanHalf : 0`,
and use it for `u.uEarthRadius.value`. Test it in a new file
`tests/unit/rendering/SunFlareMask.test.ts`:
in front (`z = -10`) → positive radius; behind (`z = +10`) → `-1`;
`tanHalf = 0` → `0`.

**Verify**: `npx vitest --run tests/unit/rendering` → all pass.

### Step 4: Dispose the PMREM render target

In `RuntimeEnvironment`, keep `let envTarget: THREE.WebGLRenderTarget | null`
instead of the texture; `build()` → `envTarget = pmrem.fromScene(room, 0.04)`
and `scene.environment = envTarget.texture`; `release()` →
`envTarget?.dispose()`. Keep the existing context-loss comments accurate.

**Verify**: `grep -n "envTexture" src/rendering/scene/SceneRoot.tsx` → no
match; `npm run typecheck` → exit 0.

### Step 5: Lifecycle edges

- `loadingStore.beginISSDetailAttempt`: when `state.issDetail.status === 'unavailable'`,
  return the state unchanged and return the current attempt number (comment:
  `unavailable` is terminal — Model A failed, no ISS group can exist).
- `ISSModel` selection effect: compute
  `const effectiveQuality = nonceChanged ? settingQuality : requestedQuality`
  right after `nonceChanged`, store `seenSelection.current = { quality: effectiveQuality, nonce: selectionNonce }`,
  compute `qualityChanged` against `effectiveQuality`, and branch on
  `effectiveQuality` instead of `requestedQuality`. (When the demotion is
  cleared, the rerun then sees no change and does nothing.) Keep the existing
  comments, adding one line on why the effective value is used.

Tests in `ISSModelLifecycle.test.ts`: after `markISSUnavailable()`,
`beginISSDetailAttempt('locate')` leaves `status === 'unavailable'` and the
attempt unchanged, and `shouldAwaitDetail(...)` stays `false`.

**Verify**: `npx vitest --run tests/unit/rendering` → all pass.

### Step 6: Gate

**Verify**: `npm run verify` → exit 0.

## Test plan

New: `DetailPreparation.test.ts` (5 cases), `SunFlareMask.test.ts` (3 cases),
one or two cases in `ISSModelLifecycle.test.ts`. The glint and PMREM changes
have no GL-free test; they are verified by grep criteria and by the
reviewer's browser check (glint opacity changes between 1,000 km and 150 km
after a Locate; no console errors).

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `grep -n "uniforms={{" src/rendering/iss/ISSModel.tsx` returns nothing
- [ ] `grep -n "withPreparationTarget" src/rendering/iss/ISSModel.tsx` matches twice
- [ ] `grep -n "envTexture" src/rendering/scene/SceneRoot.tsx` returns nothing
- [ ] `git diff --stat e78d38d..HEAD` lists only in-scope files (including the two new test files and `detailPreparation.ts`)

## STOP conditions

- `gl.compileAsync` is not available on the renderer type, or `prepare()`
  does not look like the excerpt.
- Any change appears to require touching `Postprocessing.tsx`,
  `ISSAnimations.tsx`, or camera files.
- An existing rendering test needs its assertion changed.

## Maintenance notes

- If the composer's target format changes (e.g. MSAA samples in plan 007),
  `createPreparationTarget` still matches: samples are not part of three's
  program key; tone mapping / colour space / type are.
- A Bloom toggle AFTER a tier was prepared re-links once on first draw; that
  is acceptable (rare, user-initiated).
- The reviewer should do a browser pass: Locate, watch the glint fade as the
  camera approaches from ~1,000 km to 150 km, toggle Bloom, check the console.
