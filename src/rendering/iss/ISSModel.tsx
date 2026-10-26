// ─── ISSModel — Scaled Visual Geometry & LOD ─────────────────────────────────
//
// Represents the ISS at a visually readable render scale and centered rotation,
// utilizing Draco-compressed high-detail models and lightweight LOD fallbacks.
//
// IMPORTANT — Scale Intentionality:
//   The ISS is rendered ~1,000× larger than real-world dimensions (per DEVELOPER NOTE).
//   This is intentional for orbital-scale readability: the real ISS (109 m wingspan)
//   is sub-pixel at typical viewing distances (408 km altitude, 6,779 km from Earth center).
//   Render wingspan: ~109 km (NOT 109 m). Camera minDistance (70 km) keeps the eye
//   outside the model's measured swept envelope (~68 km half-diagonal incl. array
//   animation) — see ISS_MODEL_CLEARANCE_KM in CameraStateMachine.ts.
//   DO NOT "fix" this to real scale — the entire camera system (INSPECT minDistance,
//   LOD hysteresis bands, glint scaling, fill-light distances) is calibrated
//   to these units. Only the per-model normalization constants below change.
//
// Physical ISS dimensions (real-world, for reference only):
//   Solar array wingspan: ~109 m (0.109 km)
//   Truss / module length: ~73 m  (0.073 km)
//   Height extents: ~30 m (0.030 km)
//
// Detailed model selection ('high' = IGOAL-derived, 'legacy' = original):
//   Both ship as deferred Draco GLBs with the part hierarchy intact; the
//   per-model normalization constants below map each onto the shared
//   109 km render wingspan. Selection lives in settingsStore (gear icon,
//   top right). Reliability ladder: high fails → legacy detailed;
//   legacy fails → Model A schematic (always mounted).
//
// Level of Detail (LOD) Strategy:
//   - Near Range (< 2,800–3,200 km): selected detailed model (PBR textures).
//   - Far Range (3,000–12,000 km): Model A (7.5k Verts, flat schematic PBR colors).
//   - Deep Planetary Scale (> 12,000 km): Model A + the tracking glint, so the
//     station stays findable above Earth at global distances.
//
// Hysteresis implementation:
//   To prevent LOD flickering/thrashing near the boundary:
//   - Enter Near Range at < 2,800 km
//   - Exit Near Range at > 3,200 km
//
// Memory & Performance Guarantees:
//   - The 40 KB far-range model is preloaded for first paint.
//   - Detail is requested on Locate intent or near-range entry, never at startup.
//   - GPU preparation finishes before Locate moves the camera.

import React, {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { sunVisibility } from '@/core/orbital/SunVisibility'
import { useLoadingStore, type DetailQuality } from '@/stores/loadingStore'
import { useCameraStore } from '@/stores/cameraStore'
import { useSettingsStore, type IssModelQuality } from '@/stores/settingsStore'
import { parseRigMetadata, type RigMetadataParse } from './ISSJointKinematics'
import { ISSAnimations } from './ISSAnimations'
import { eclipseLighting } from './eclipseLighting'
import { countMissingTextures, createPreparationTarget, withPreparationTarget } from './detailPreparation'
import { KTX2_TEXTURE_STALL_MS, guardLoadStall } from './loadStallGuard'
import { BASIS_TRANSCODER_PATH, versionTranscoderUrl } from './basisTranscoderUrl'
import { sharedJointStates } from './ISSRigAnimator'
import {
  SHADOW_HALF_EXTENT,
  SUN_LIGHT_NAME,
  ShadowRefreshScheduler,
  aimSunLightAt,
  configureStationShadow,
  explodedShadowHalfExtent,
  setStationShadowExtent,
} from './stationShadow'
import { ModuleExplorerDriver, ModuleExplorerLayer } from './ModuleExplorerLayer'
import { explorerRuntime } from './explorerRuntime'
import { EXPLODE_FACTOR } from './moduleExplorer'
import {
  FALLBACK_MODEL_URL,
  HIGH_MODEL_URL,
  LEGACY_MODEL_URL,
  LOCATE_MODEL_URL,
} from './modelUrls'
import billboardVert from '../shaders/billboard.vert'
import softGlowFrag from '../shaders/softGlow.frag'

// Glint tint: light blue in daylight, deeper blue in Earth's shadow. Shared
// constants so the frame loop copies them instead of parsing a hex string.
const GLINT_COLOR_SUNLIT = new THREE.Color('#A8D8FF')
const GLINT_COLOR_SHADOW = new THREE.Color('#6FAEE0')

// ─── F-03: Use locally-hosted Draco decoder ───────────────────────────────────
// Instead of the gstatic.com CDN (blocked in offline/private-network environments),
// we ship the decoder WASM and JS files in public/draco/ and point useGLTF at them.
// This guarantees Draco-compressed models decode regardless of CDN availability.
useGLTF.setDecoderPath('/draco/')

// ─── KTX2 / Basis textures ───────────────────────────────────────────────────
// The IGOAL assets ship GPU-compressed KTX2 (ETC1S) textures: ~4–8× less
// texture memory than decoded WebP, transcoded in workers instead of decoded
// on the main thread. The transcoder is self-hosted in public/basis/ (copied
// from three/examples/jsm/libs/basis at the renderer's version), like Draco.
// detectSupport picks the GPU format (BC / ETC / ASTC) per renderer, so the
// loader is rebuilt if the renderer ever changes.
//
// The .js glue is not a plain copy: it is patched to never evaluate strings
// (npm run patch:basis): the production CSP forbids it, and three's stock
// copy hung every KTX2 load on the live site. Each texture load
// is also stall-guarded, so a transcoder that never answers fails into the
// reliability ladder instead of suspending the detail model forever.
class StallGuardedKTX2Loader extends KTX2Loader {
  override load(
    url: string,
    onLoad: (texture: THREE.CompressedTexture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    const guarded = guardLoadStall(onLoad, onError, KTX2_TEXTURE_STALL_MS, 'KTX2 texture')
    super.load(url, guarded.onLoad, onProgress, guarded.onError)
  }
}

// The transcoder files carry a content-hash query (basisTranscoderUrl.ts) via
// the loader's own manager, so a changed transcoder reaches cached clients.
const ktx2Manager = new THREE.LoadingManager()
ktx2Manager.setURLModifier((url) => versionTranscoderUrl(url, __BASIS_ID__))

let ktx2Loader: KTX2Loader | null = null
let ktx2Renderer: THREE.WebGLRenderer | null = null

function ktx2LoaderFor(gl: THREE.WebGLRenderer): KTX2Loader {
  if (!ktx2Loader || ktx2Renderer !== gl) {
    ktx2Loader?.dispose()
    ktx2Loader = new StallGuardedKTX2Loader(ktx2Manager)
      .setTranscoderPath(BASIS_TRANSCODER_PATH)
      .detectSupport(gl)
    ktx2Renderer = gl
  }
  return ktx2Loader
}

// drei's GLTFLoader is three-stdlib's, whose typings declare their own
// KTX2Loader class; three's loader is runtime-compatible (the GLTF parser only
// calls load()), so the two types are bridged here once.
type DreiGLTFLoader = Parameters<NonNullable<Parameters<typeof useGLTF>[3]>>[0]
type DreiKTX2Loader = Parameters<DreiGLTFLoader['setKTX2Loader']>[0]

// ─── Detailed model registry (per-selection normalization) ──────────────────

interface DetailedModelSpec {
  url: string
  /** Max model dimension (m) — normalized onto RENDER_ISS_WINGSPAN_UNITS. */
  wingspanM: number
  /** Model-local axis the wingspan lies on. */
  wingspanAxis: 'x' | 'y' | 'z'
  /** Center-of-geometry offset in model-local space (shift by −center). */
  pivotOffset: [number, number, number]
}

const LEGACY_DETAILED: DetailedModelSpec = {
  url: LEGACY_MODEL_URL,
  // Measured on the mounted model with full vertex transforms (plan 001 O1,
  // superseding the old 31.070 × 24.200 × 75.109 comment, which was wrong):
  // native full size 111.988429 × 68.784158 × 58.626683 m, tight-bounds
  // center ≈ (+0.0000024, +5.3411984, −3.8544638). The truss/array span is
  // the X extent (111.99 m) — NOT Z. pivotOffset is the negated center.
  wingspanM: 111.988429,
  wingspanAxis: 'x',
  pivotOffset: [-0.0000024, -5.3411984, 3.8544638],
}

const IGOAL_DETAILED: DetailedModelSpec = {
  url: HIGH_MODEL_URL,
  // Measured from the shipped GLB's decoded POSITION vertices (scripts/
  // build-iss-model.mjs report; docs/MODEL_AUDIT.md): bounds
  // 73.4275 × 30.6260 × 108.2926 m, center (−0.0025, −6.8026, 0.0006).
  // Truss along local Z (wingspan); pivotOffset is the negated center, so
  // the geometric center lands on ISSGroup.position. Declared accessor
  // min/max match the decoded vertices exactly (no stale bounds).
  wingspanM: 108.293,
  wingspanAxis: 'z',
  pivotOffset: [0.0025, 6.8026, -0.0006],
}

/**
 * Locate/Follow tier: a derived IGOAL LOD (scripts/build-iss-locate-lod.mjs).
 * Same asset frame, node hierarchy and rig extras as the high model; the
 * normalization constants are deliberately shared. ~5.3 MiB / 784k triangles
 * vs the high 20.5 MiB / 2.665M — it fits the 8 s Locate gate on ordinary
 * slow connections, while the full model loads only for Inspect.
 */
const IGOAL_LOCATE: DetailedModelSpec = {
  url: LOCATE_MODEL_URL,
  wingspanM: 108.293,
  wingspanAxis: 'z',
  pivotOffset: [0.0025, 6.8026, -0.0006],
}

const MODEL_SPECS: Record<DetailQuality, DetailedModelSpec> = {
  locate: IGOAL_LOCATE,
  high: IGOAL_DETAILED,
  legacy: LEGACY_DETAILED,
}

// ─── Per-model pre-rotation (native axes → station body axes) ────────────────
// ISSGroup applies the LVLH/TEA flight attitude in the STATION frame
// (+X = V-bar forward, +Y = −orbit normal (−ĥ, built as nadir × V-bar in
// ISSGroup), +Z = nadir). Each model was
// authored in its own native convention, so each needs a fixed pre-rotation
// onto that frame before the group attitude applies. Expressed as
// quaternions so the basis mapping is unambiguous (no Euler-order guesswork).
const HIGH_PRE_ROTATION = new THREE.Quaternion().setFromEuler(
  // High (IGOAL): native +X forward, truss along native Z, nadir −Y.
  // Rx(−90°): Z→+Y (−orbit normal), Y→−Z (zenith).
  new THREE.Euler(-Math.PI / 2, 0, 0),
)
const LEGACY_PRE_ROTATION = new THREE.Quaternion().setFromRotationMatrix(
  // Legacy (plan 001 O1, measured anatomically): forward = native +Z
  // (Harmony − Destiny), nadir = native −Y (Pirs − Poisk), starboard =
  // native −X (S truss progression). Basis: +X→−Y, +Y→−Z, +Z→+X
  // (quaternion XYZW [−0.5, +0.5, −0.5, +0.5]). The previous Rx(−90°) left
  // Legacy flying sideways (forward mapped to body +Y).
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, -1, 0), // native +X → body −Y
    new THREE.Vector3(0, 0, -1), // native +Y → body −Z
    new THREE.Vector3(1, 0, 0), // native +Z → body +X (forward)
  ),
)
const MODEL_PRE_ROTATION: Record<DetailQuality, THREE.Quaternion> = {
  locate: HIGH_PRE_ROTATION,
  high: HIGH_PRE_ROTATION,
  legacy: LEGACY_PRE_ROTATION,
}

/** Render-scale ISS wingspan in Three.js world units (km).
 * The ISS is intentionally rendered ~1,000× oversize for orbital-scale readability.
 * Real ISS wingspan: ~109 m = 0.109 km. Render wingspan: 109 km. */
const RENDER_ISS_WINGSPAN_UNITS = 109.0

// Model A normalization (plan 001 O1, measured in the GLB scene-root frame —
// i.e. INCLUDING its authored +90°X node rotation and 0.6781210899 scale):
// truss span = X extent 25.614240 m; tight-bounds center
// (+0.0011162, +1.4887661, −3.8792463). The old span divisor 37.772 and the
// old pivot offsets were measured in raw mesh coordinates but applied outside
// the retained transforms.
const NORMALIZATION_SCALE_A = RENDER_ISS_WINGSPAN_UNITS / 25.614240
const PIVOT_OFFSET_A_X = -0.0011162
const PIVOT_OFFSET_A_Y = -1.4887661
const PIVOT_OFFSET_A_Z = 3.8792463

// Model A schematic pre-rotation onto the station body frame: its truss runs
// along native X (→ body +Y, −orbit normal) and its module stack along native
// Z (→ body +X V-bar forward). Expressed as a quaternion so the basis
// mapping is unambiguous (no Euler-order guesswork).
const MODEL_A_PRE_ROTATION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0), // native +X → body +Y (truss across the flight path)
    new THREE.Vector3(0, 0, 1), // native +Y → body +Z (nadir)
    new THREE.Vector3(1, 0, 0), // native +Z → body +X (module stack, V-bar forward)
  ),
)

// Only the tiny far-range model is part of startup. The detailed model is loaded
// on Locate intent or the first transition into near range and remains cached thereafter.
useGLTF.preload(FALLBACK_MODEL_URL)

/**
 * On-screen width of the tracking glint, in CSS pixels.
 *
 * It is the ONLY tracking marker — the corner-tick reticle that used to carry
 * the far range was removed by request — so it is specified in SCREEN space
 * and projected back to world units, and it is what has to stay findable at
 * planetary range.
 */
const GLINT_SCREEN_PX = 22

/** LOD hysteresis bands to prevent boundary thrashing (km) */
const LOD_ENTER_NEAR_KM = 2800
const LOD_EXIT_NEAR_KM = 3200

/** Full-detail hysteresis: mirrors INSPECT's 200/220 km bands so a close FREE
 *  view also gets the full asset, not only the tracked INSPECT mode. */
const FULL_DETAIL_ENTER_KM = 200
const FULL_DETAIL_EXIT_KM = 220

/**
 * Wall-time budget per frame while uploading the detailed model's textures.
 * `initTexture` is a GL call, not a render — 6 ms leaves headroom inside a
 * 16.7 ms frame for the scene that is still rendering behind the preparation.
 */
const TEXTURE_UPLOAD_BUDGET_MS = 6

/**
 * URLs whose GPU preparation has completed for the current WebGL context.
 * A committed/candidate remount of the same asset shares the cached GLTF's
 * geometries and textures, so repeating `prepare()` would only re-upload and
 * hitch. Cleared when the context is restored, because the GPU resources are
 * recreated at that point.
 */
const preparedModelUrls = new Set<string>()

const _sunDirVec = new THREE.Vector3()


interface DetailModelErrorBoundaryProps {
  children: ReactNode
  onError: () => void
}

interface DetailModelErrorBoundaryState {
  failed: boolean
}

class DetailModelErrorBoundary extends Component<
  DetailModelErrorBoundaryProps,
  DetailModelErrorBoundaryState
> {
  state: DetailModelErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): DetailModelErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.warn('[ISSModel] Detailed model failed to load; keeping fallback visible.', error)
    this.props.onError()
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

// ─── Model A fallback (the always-mounted schematic) ─────────────────────────
// Loaded in its own component so its suspension/failure is caught by a LOCAL
// boundary: if Model A itself fails there is no ISS group at all, which is a
// distinct terminal state ('unavailable') — not a detail-ladder demotion
// (plan 001 R4).
interface FallbackModelErrorBoundaryProps {
  children: ReactNode
  onError: () => void
}

class FallbackModelErrorBoundary extends Component<
  FallbackModelErrorBoundaryProps,
  DetailModelErrorBoundaryState
> {
  state: DetailModelErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): DetailModelErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.warn('[ISSModel] Model A fallback failed — ISS unavailable.', error)
    this.props.onError()
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

function FallbackISSModel(): JSX.Element {
  const fallbackGltf = useGLTF(FALLBACK_MODEL_URL)
  const fallbackScene = useMemo(() => fallbackGltf.scene.clone(), [fallbackGltf.scene])
  return (
    <primitive
      object={fallbackScene}
      position={[PIVOT_OFFSET_A_X, PIVOT_OFFSET_A_Y, PIVOT_OFFSET_A_Z]} // Center pivot translation
    />
  )
}

// Model A load failures must surface even though drei's suspense does not
// propagate loader errors (a failed preload would suspend the whole scene
// tree forever with no error thrown — R4's black-canvas failure). The shared
// LoadingManager's per-item onError always fires, so the terminal
// 'unavailable' state is published from here and ISSModel stops rendering the
// fallback subtree, letting the rest of the scene resolve.
const FALLBACK_URL_PATTERN = /international space station \(iss\) \(a\)\.glb/i
THREE.DefaultLoadingManager.onError = (url: string) => {
  let decoded = url
  try { decoded = decodeURIComponent(url) } catch { /* keep raw */ }
  if (FALLBACK_URL_PATTERN.test(decoded)) {
    console.warn('[ISSModel] Model A failed to load — ISS unavailable.', url)
    useLoadingStore.getState().markISSUnavailable()
  }
}

interface DetailedISSModelProps {
  spec: DetailedModelSpec
  quality: DetailQuality
  /** Attempt identity this instance loads for; carried on every callback so
   *  an obsolete preparation can never publish another attempt's result. */
  attempt: number
  visible: boolean
  onReady: (attempt: number) => void
  onError: (attempt: number) => void
}

function DetailedISSModel({ spec, quality, attempt, visible, onReady, onError }: DetailedISSModelProps): JSX.Element {
  const { gl, camera, scene } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const pivotGroupRef = useRef<THREE.Group>(null)
  const extendLoader = useCallback(
    (loader: DreiGLTFLoader) => { loader.setKTX2Loader(ktx2LoaderFor(gl) as unknown as DreiKTX2Loader) },
    [gl],
  )
  const detailedGltf = useGLTF(spec.url, true, true, extendLoader)
  const detailedScene = useMemo(() => {
    const clone = detailedGltf.scene.clone()
    // The detail model casts and receives the station's cached self-shadow
    // (stationShadow.ts); nothing else in the scene does.
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    return clone
  }, [detailedGltf.scene])
  // Validated rig contract from the asset's scene extras (emitted by
  // build-iss-model.mjs as extras.orbitalRig). Absent = pre-rebuild asset
  // (built-in joint definitions apply); present-but-invalid = the asset does
  // not meet the contract it declares, which must not be declared ready.
  const rigMetadata = useMemo<RigMetadataParse>(
    () => parseRigMetadata(detailedScene.userData),
    [detailedScene],
  )

  useEffect(() => {
    if (rigMetadata.status === 'invalid') {
      console.error('[ISSModel] asset declares an invalid orbitalRig contract:', rigMetadata.errors)
      onError(attempt)
    }
  }, [rigMetadata, onError, attempt])

  useEffect(() => {
    let cancelled = false
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    async function prepare(): Promise<void> {
      // Forensic breadcrumb: which detailed asset actually mounted.
      console.log('[ISS AUDIT]', { quality, url: spec.url, attempt })
      // The same URL may remount when a candidate becomes the committed model
      // (e.g. the Locate LOD while the full asset loads). Its GPU resources
      // were already prepared; skipping is safe and avoids a visible hitch.
      if (preparedModelUrls.has(spec.url)) {
        await nextFrame()
        if (!cancelled) onReady(attempt)
        return
      }
      // Texture failures do not reject the GLTF (they resolve to null), so
      // check them here; the dependency promises are already cached.
      const missingTextures = countMissingTextures(await detailedGltf.parser.getDependencies('texture'))
      if (cancelled) return
      if (missingTextures > 0) {
        throw new Error(`${missingTextures} texture(s) of ${spec.url} failed to load`)
      }
      useLoadingStore.getState().setIssDetailPreparing(attempt)
      // With Bloom on, the visible frame is drawn into a HalfFloat target, not
      // the default framebuffer; prepare against the same kind of target.
      const composerActive = useSettingsStore.getState().postprocessing
      const prepTarget = composerActive ? createPreparationTarget() : null
      try {
        const textures = new Set<THREE.Texture>()
        const meshes: Array<{ mesh: THREE.Mesh; frustumCulled: boolean }> = []
        detailedScene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          meshes.push({ mesh: object, frustumCulled: object.frustumCulled })
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const material of materials) {
            for (const value of Object.values(material)) {
              if (value instanceof THREE.Texture) textures.add(value)
            }
          }
        })

        // Upload textures in time-budgeted batches while the camera stays put. A
        // resolved GLTF alone is not ready: lazy texture uploads and shader linking
        // otherwise hitch the first close-up frame. Compile against the actual
        // scene's lighting.
        //
        // The old loop yielded one frame per texture (73 textures ≈ 73 frames ≈
        // 1.2 s at 60 Hz, 2.4 s at 30 Hz) — pure yielding, since each initTexture
        // is a sub-millisecond GL call. Uploading until a frame's budget is spent
        // keeps the GPU work identical while cutting the wait by ~90%.
        let budgetEnd = performance.now() + TEXTURE_UPLOAD_BUDGET_MS
        for (const texture of textures) {
          if (cancelled) return
          gl.initTexture(texture)
          if (performance.now() >= budgetEnd) {
            await nextFrame()
            if (cancelled) return
            budgetEnd = performance.now() + TEXTURE_UPLOAD_BUDGET_MS
          }
        }
        await nextFrame()
        if (cancelled) return
        // compileAsync builds the programs synchronously in its first call (using
        // the current target), so the target is restored right after the call and
        // not held across the await — the composer renders in between.
        const compiled = withPreparationTarget(gl, prepTarget, () =>
          gl.compileAsync(detailedScene, camera, scene))
        await compiled
        await nextFrame()
        if (cancelled || !groupRef.current) return

        // A zero-area scissor uploads vertex buffers without writing any pixels.
        // The prime runs against the same kind of target the visible frame uses
        // (the default framebuffer without Bloom, a HalfFloat target with Bloom),
        // so it warms the exact shader variant that will be drawn.
        const group = groupRef.current
        const wasVisible = group.visible
        const previousScissor = gl.getScissor(new THREE.Vector4())
        const previousScissorTest = gl.getScissorTest()
        try {
          group.visible = true
          for (const { mesh } of meshes) mesh.frustumCulled = false
          gl.setScissor(0, 0, 0, 0)
          gl.setScissorTest(true)
          withPreparationTarget(gl, prepTarget, () => gl.render(scene, camera))
        } finally {
          gl.setScissor(previousScissor)
          gl.setScissorTest(previousScissorTest)
          group.visible = wasVisible
          for (const { mesh, frustumCulled } of meshes) mesh.frustumCulled = frustumCulled
        }
        await nextFrame()
        if (!cancelled) {
          preparedModelUrls.add(spec.url)
          onReady(attempt)
        }
      } finally {
        prepTarget?.dispose()
      }
    }

    void prepare().catch((error: unknown) => {
      if (cancelled) return
      console.warn('[ISSModel] Detailed model preparation failed.', error)
      onError(attempt)
    })
    return () => { cancelled = true }
  }, [detailedGltf.parser, detailedScene, gl, camera, scene, onReady, onError, attempt, quality, spec.url])

  // A restored context recreates textures/buffers; allow prepare() to run again.
  useEffect(() => {
    const canvas = gl.domElement
    const clear = (): void => { preparedModelUrls.clear() }
    canvas.addEventListener('webglcontextrestored', clear)
    return () => canvas.removeEventListener('webglcontextrestored', clear)
  }, [gl])

  const normalizationScale = RENDER_ISS_WINGSPAN_UNITS / spec.wingspanM

  return (
    <group ref={groupRef} scale={normalizationScale} quaternion={MODEL_PRE_ROTATION[quality]} visible={visible}>
      {/* Pivot root lives in raw model units — ISSAnimations resolves its
          gimbal pivots against this frame before the pre-rotation and render
          scale apply. */}
      <group ref={pivotGroupRef} position={spec.pivotOffset}>
        <primitive object={detailedScene} />
        <ISSAnimations rootRef={pivotGroupRef} quality={quality} active={visible} rigMetadata={rigMetadata} onError={() => onError(attempt)} />
        {/* Module explorer (plan 017 X1): the IGOAL tiers only; legacy has
            no module hierarchy to pick. */}
        {quality !== 'legacy' && (
          <ModuleExplorerLayer scene={detailedScene} renderScale={normalizationScale} active={visible} />
        )}
      </group>
    </group>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ISSModel = React.memo(function ISSModel(): JSX.Element {
  const groupRef = useRef<THREE.Group>(null)
  const { scene } = useThree()

  // Element Refs for direct vis/light mutation (zero garbage collection)
  const auraRef = useRef<THREE.Mesh>(null)
  const lightPrimaryRef = useRef<THREE.PointLight>(null)
  const lightSecondaryRef = useRef<THREE.PointLight>(null)
  const lightAmbientRef = useRef<THREE.HemisphereLight>(null)
  const earthshineRef = useRef<THREE.DirectionalLight>(null)

  // Tracking refs to maintain stable hysteresis states across frames
  const isNearRef = useRef(false)
  const worldPos = useRef(new THREE.Vector3())
  const [isNear, setIsNear] = useState(false)
  const isCloseRef = useRef(false)
  const [isClose, setIsClose] = useState(false)
  // Single lifecycle authority for the detail candidate (plan 001 phase E):
  // status + attempt identity + the committed (active) quality.
  const issDetail = useLoadingStore((state) => state.issDetail)
  // During a Locate flight the detail model is shown from departure, not at
  // the 2,800 km LOD boundary — the first tier has finished preparing before
  // departure, so the swap would otherwise be visible mid-flight.
  const isTransitioning = useCameraStore((state) => state.isTransitioning)

  // ─── Detailed model selection with reliability ladder ───
  // 'high' (IGOAL) is the default and is loaded in two tiers: the Locate LOD
  // for Locate/Follow, then the full asset for Inspect. Failures demote the
  // requested path to the legacy detailed model before Model A.
  const settingQuality = useSettingsStore((state) => state.issModelQuality)
  const selectionNonce = useSettingsStore((state) => state.selectionNonce)
  const [demotedQuality, setDemotedQuality] = useState<IssModelQuality | null>(null)
  const requestedQuality = demotedQuality ?? settingQuality
  /** First asset loaded for the requested quality: the fast LOD for 'high',
   *  the legacy detailed model for 'legacy'. */
  const firstTier: DetailQuality = requestedQuality === 'high' ? 'locate' : 'legacy'
  const candidateQuality = issDetail.quality
  const candidateSpec = candidateQuality ? MODEL_SPECS[candidateQuality] : null
  const showDetail = isNear || isTransitioning

  // Selection orchestration: records the requested quality on mount (without
  // loading — detail is requested on Locate intent or near-range entry, never
  // at startup), then begins a fresh candidate attempt whenever the explicit
  // selection changes or the demotion ladder moves the request. An explicit
  // re-selection (nonce) clears an active demotion; an automatic demotion
  // changes `requestedQuality` without the nonce and survives.
  const seenSelection = useRef<{ quality: IssModelQuality | null; nonce: number } | null>(null)
  useEffect(() => {
    const store = useLoadingStore.getState()
    if (seenSelection.current === null) {
      seenSelection.current = { quality: requestedQuality, nonce: selectionNonce }
      store.identifyISSDetail(firstTier)
      return
    }
    const nonceChanged = seenSelection.current.nonce !== selectionNonce
    // An explicit reselect clears the demotion in this same run, but
    // `requestedQuality` still holds the stale demoted value until the rerun;
    // use the quality the request is about to become so no spurious attempt
    // (e.g. a legacy one) starts for it.
    const effectiveQuality = nonceChanged ? settingQuality : requestedQuality
    const qualityChanged = seenSelection.current.quality !== effectiveQuality
    seenSelection.current = { quality: effectiveQuality, nonce: selectionNonce }
    if (nonceChanged) setDemotedQuality(null)
    if (!nonceChanged && !qualityChanged) return

    const detail = store.issDetail
    if (effectiveQuality === 'legacy') {
      if (detail.activeQuality !== 'legacy') store.beginISSDetailAttempt('legacy')
      return
    }
    // Requested high. If the full asset is already committed, an explicit
    // reselect has nothing better to load (the nonce only cleared a demotion).
    if (detail.activeQuality === 'high') return
    // With the fast LOD committed, an explicit/quality change asks for the
    // full model directly (this is also the retry path after a high failure).
    if (detail.activeQuality === 'locate') {
      store.beginISSDetailAttempt('high')
      return
    }
    store.beginISSDetailAttempt('locate')
  }, [requestedQuality, settingQuality, firstTier, selectionNonce])

  // Full-detail tier: only within the INSPECT band (<200 km, 220 km exit; a
  // close FREE view counts too). At Follow the LOD is visually
  // indistinguishable; loading 20.5 MB there would defeat the point of the
  // fast tier. A failed high attempt is not retried automatically — an
  // explicit reselect starts a fresh attempt.
  useEffect(() => {
    if (!isClose || requestedQuality !== 'high') return
    const detail = useLoadingStore.getState().issDetail
    if (detail.status === 'ready' && detail.activeQuality === 'locate') {
      useLoadingStore.getState().beginISSDetailAttempt('high')
    }
  }, [isClose, requestedQuality, issDetail.status, issDetail.activeQuality])

  useEffect(() => () => {
    useLoadingStore.getState().resetIssDetail()
  }, [])

  // NOTE: No manual geometry/material disposal on unmount.
  // The scenes are produced by scene.clone(), which shallow-clones
  // materials — they still reference the same underlying geometries and material instances
  // held in Drei's internal GLTF cache. Disposing them here would corrupt the cache and
  // cause future loads (e.g. hot-reload, Suspense remount) to reference freed GPU memory.
  // Drei's useGLTF manages GLTF asset lifecycle; external disposal is incorrect.

  const handleDetailReady = useCallback((attempt: number) => {
    useLoadingStore.getState().commitISSDetailReady(attempt)
  }, [])

  // Stable no-ops for the already-committed layer: inline callbacks would
  // change identity every render and re-run its preparation effect.
  const handleCommittedNoop = useCallback(() => {}, [])

  const handleDetailError = useCallback((attempt: number) => {
    const store = useLoadingStore.getState()
    const detail = store.issDetail
    // A late failure from a superseded attempt must not demote or clear the
    // current candidate.
    if (detail.attempt !== attempt) return
    const failedQuality = detail.quality
    store.failISSDetailAttempt(attempt)
    console.warn('[ISSModel] detail attempt failed', {
      attempt, status: store.issDetail.status, quality: failedQuality,
    })
    // Drei caches rejected loader promises as well as successful assets. Clear the
    // failed entry so a later selection can retry a transient error.
    if (failedQuality) {
      preparedModelUrls.delete(MODEL_SPECS[failedQuality].url)
      useGLTF.clear(MODEL_SPECS[failedQuality].url)
    }
    if (failedQuality === 'locate' && store.issDetail.activeQuality !== 'high') {
      // The fast tier is the first asset for 'high'; a failure here is the
      // whole high path failing, so demote to the proven legacy model.
      console.warn('[ISSModel] demoting high -> legacy (Locate LOD failed)')
      setDemotedQuality('legacy')
    } else if (failedQuality === 'high' && store.issDetail.activeQuality !== 'locate') {
      console.warn('[ISSModel] demoting high -> legacy')
      setDemotedQuality('legacy')
    }
    // A high failure with a committed Locate LOD keeps the LOD: it is a valid
    // detailed model, and demoting to legacy would be a visual downgrade.
  }, [])

  const handleFallbackError = useCallback(() => {
    // Model A itself failed: terminal for the session. Earth/UI stay alive,
    // Locate resolves visibly, and nothing auto-retries the ladder.
    useLoadingStore.getState().markISSUnavailable()
  }, [])

  // ─── Visibility ownership (E.4: swap-once-prepared) ───
  // committed = the last quality that reached 'ready'. It stays mounted while
  // a different candidate loads/prepares and remains the displayed model until
  // that candidate commits, so a tier swap never flashes Model A.
  const committedQuality = issDetail.activeQuality
  const committedSpec = committedQuality ? MODEL_SPECS[committedQuality] : null
  const committedMounted = committedQuality !== null
    && !(issDetail.status === 'ready' && committedQuality === candidateQuality)
    && issDetail.status !== 'unavailable'
  const committedShown = committedMounted && showDetail && issDetail.status !== 'ready'
  const modelAVisible = !showDetail || (issDetail.status !== 'ready' && !committedShown)

  // ─── Earthshine key light ───
  // Replaces the old camera-anchored omnidirectional inspection headlight:
  // when the station is in Earth's shadow, it is lit from the nadir direction
  // (sunlight reflected off Earth's dayside), which lights the whole model
  // uniformly with no camera hotspot. The target object is moved to the ISS
  // center each frame; the light itself sits out along the nadir.
  const earthshineTarget = useMemo(() => new THREE.Object3D(), [])

  // The glint's uniforms must be a stable object. three's renderer captures the
  // uniforms object when the program is acquired and keeps uploading THAT one;
  // an inline uniforms object literal is re-created on every render and R3F would
  // swap it onto the material, leaving the frame loop writing into an object
  // the GPU never reads (the fade and tint would freeze).
  const glintUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(GLINT_COLOR_SUNLIT) },
      uOpacity: { value: 0.0 },
    }),
    [],
  )
  useEffect(() => {
    scene.add(earthshineTarget)
    return () => { scene.remove(earthshineTarget) }
  }, [scene, earthshineTarget])

  const _nadirDir = useRef(new THREE.Vector3())
  const _lightLocal = useRef(new THREE.Vector3())
  const _parentQuat = useRef(new THREE.Quaternion())

  // ─── Station self-shadow (stationShadow.ts) ───
  const shadowsOn = useSettingsStore((state) => state.shadows)
  const shadowsOnRef = useRef(shadowsOn)
  shadowsOnRef.current = shadowsOn
  // The visible detail model (null when none is on screen); a change forces
  // a shadow redraw for the new geometry.
  const visibleDetailUrlRef = useRef<string | null>(null)
  visibleDetailUrlRef.current = issDetail.status === 'ready' && showDetail
    ? candidateSpec?.url ?? null
    : committedShown ? committedSpec?.url ?? null : null
  const visibleQuality = issDetail.status === 'ready' && showDetail
    ? candidateQuality
    : committedShown ? committedQuality : null
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null)
  const shadowScheduler = useMemo(() => new ShadowRefreshScheduler(), [])
  const lastShadowUrlRef = useRef<string | null>(null)
  const lastShadowEpochRef = useRef(0)
  const _stationQuat = useRef(new THREE.Quaternion())
  const _sunInStation = useRef(new THREE.Vector3())
  const jointAnglesRef = useRef<number[]>([])

  useFrame((state) => {
    if (!groupRef.current) return

    // Retrieve absolute world coordinates of the ISS model center
    groupRef.current.getWorldPosition(worldPos.current)
    const distanceKm = state.camera.position.distanceTo(worldPos.current)

    // 1. Evaluate LOD Near/Far state using hysteresis bands
    let nextIsNear = isNearRef.current
    if (nextIsNear) {
      if (distanceKm > LOD_EXIT_NEAR_KM) {
        nextIsNear = false
      }
    } else {
      if (distanceKm < LOD_ENTER_NEAR_KM) {
        nextIsNear = true
      }
    }

    if (nextIsNear !== isNearRef.current) {
      isNearRef.current = nextIsNear
      setIsNear(nextIsNear)

      // A failed Locate intentionally flies to the fallback; don't start another
      // load halfway through that flight when it crosses the near-range boundary.
      if (nextIsNear && !useCameraStore.getState().isTransitioning) {
        useLoadingStore.getState().requestISSDetail()
      }
    }

    // Full-detail band (INSPECT 200/220 km, also covers a close FREE view).
    let nextIsClose = isCloseRef.current
    if (nextIsClose) {
      if (distanceKm > FULL_DETAIL_EXIT_KM) nextIsClose = false
    } else if (distanceKm < FULL_DETAIL_ENTER_KM) {
      nextIsClose = true
    }
    if (nextIsClose !== isCloseRef.current) {
      isCloseRef.current = nextIsClose
      setIsClose(nextIsClose)
    }

    // 3. Compute the tracking glint's opacity.
    // Fades in over the approach so the close-range model is never washed out,
    // then HOLDS: the glint is the only tracking marker now, so it has to stay
    // findable at planetary range. (It used to decay to 0.15 out there, back
    // when the reticle carried the far range.)
    const glintOpacity = 0.32 * Math.min(1, Math.max(0, (distanceKm - 150.0) / 850.0))

    // 3b. Sun visibility across the ~63 km penumbra (core/orbital/SunVisibility):
    // lighting follows the continuous value, so a terminator crossing is a fade,
    // not a one-frame switch.
    const simTime = simulationClock.now()
    const sunDir = sunDirectionWorld(simTime.julianDate)
    _sunDirVec.set(sunDir.x, sunDir.y, sunDir.z).normalize()
    const shade = 1 - sunVisibility(worldPos.current, _sunDirVec)
    const lighting = eclipseLighting(shade)

    // 3a. Station self-shadow: the sun light's shadow box follows the
    // station; the cached map is redrawn only when the sun direction in the
    // station frame or a joint has moved enough to show.
    if (!sunLightRef.current) {
      const found = scene.getObjectByName(SUN_LIGHT_NAME)
      if (found instanceof THREE.DirectionalLight) sunLightRef.current = found
    }
    const sunLight = sunLightRef.current
    if (sunLight) {
      const wantShadow = shadowsOnRef.current
      if (sunLight.castShadow !== wantShadow) {
        if (wantShadow) configureStationShadow(sunLight)
        sunLight.castShadow = wantShadow
        shadowScheduler.invalidate()
      }
      const visibleUrl = visibleDetailUrlRef.current
      if (wantShadow && visibleUrl) {
        // An exploded station outgrows the ±70 km box (module explorer).
        if (setStationShadowExtent(sunLight, explorerRuntime.progress > 0
          ? explodedShadowHalfExtent(explorerRuntime.eased, EXPLODE_FACTOR)
          : SHADOW_HALF_EXTENT)) {
          shadowScheduler.invalidate()
        }
        aimSunLightAt(sunLight, worldPos.current, _sunDirVec)
        if (visibleUrl !== lastShadowUrlRef.current) {
          lastShadowUrlRef.current = visibleUrl
          shadowScheduler.invalidate()
        }
        groupRef.current.getWorldQuaternion(_stationQuat.current).invert()
        _sunInStation.current.copy(_sunDirVec).applyQuaternion(_stationQuat.current)
        const angles = jointAnglesRef.current
        angles.length = 0
        for (const joint of sharedJointStates.values()) angles.push(joint.applied)
        // The explode moves geometry like a joint does: 0.15° of "angle"
        // per ~0.08% of the explode, so the map follows the animation.
        angles.push(explorerRuntime.eased * Math.PI)
        const seeking = simulationClock.mode === 'PAUSED' && simTime.epochMs !== lastShadowEpochRef.current
        lastShadowEpochRef.current = simTime.epochMs
        if (shadowScheduler.shouldRefresh(performance.now(), _sunInStation.current, angles, seeking)) {
          sunLight.shadow.needsUpdate = true
        }
      }
    }

    // 3c. Dynamic camera-distance-based local point lights exposure scaling
    // Lights are 0.0 at far planetary ranges (3000 km) and scale smoothly to 1.0 during close zoom (100 km)
    const minLightDist = 100.0
    const maxLightDist = 3000.0
    const lightFactor = 1.0 - THREE.MathUtils.clamp((distanceKm - minLightDist) / (maxLightDist - minLightDist), 0.0, 1.0)
    const smoothMultiplier = Math.pow(lightFactor, 2.0) // Soft quadratic ease-in for simulated exposure adaptation

    // Physical Camera Exposure Adaptation
    // The exposure boost ramps with shade from 1.0x (full sun) to 2.3x (umbra),
    // so modules stay legible and the change across the penumbra is a fade.
    if (lightPrimaryRef.current) {
      lightPrimaryRef.current.intensity = 1.6 * smoothMultiplier * lighting.exposureBoost
    }
    if (lightSecondaryRef.current) {
      lightSecondaryRef.current.intensity = 0.8 * smoothMultiplier * lighting.exposureBoost
    }
    if (lightAmbientRef.current) {
      // Dynamic ambient fill: lifts shadowed module details when zoomed in close.
      // Soft fill in full sun (0.24) to keep contrast, ramping to a richer lift
      // in umbra (0.42) to simulate camera exposure adaptation.
      lightAmbientRef.current.intensity = lighting.ambient * smoothMultiplier
    }

    // 3d. Earthshine key light — physically motivated dark-side illumination.
    // Real stations in Earth's shadow are lit by sunlight reflected off the
    // planet below, so the light comes FROM the nadir and reaches the whole
    // model uniformly. Distance-adaptive (smoothMultiplier) like the fills:
    // irrelevant at planetary range where the detail model is hidden.
    const earthshine = earthshineRef.current
    if (earthshine) {
      if (shade > 0) {
        // Direction from Earth's center through the station, extended outward:
        // the light hangs below the station on the planet-facing side.
        _nadirDir.current.copy(worldPos.current).multiplyScalar(-1).normalize()
        // The light is a child of the attitude-rotated ISS group, so its
        // .position is LOCAL — convert the desired world offset by the
        // parent's inverse world quaternion or the direction drifts as the
        // station rotates.
        _lightLocal.current.copy(_nadirDir.current).multiplyScalar(400)
        if (earthshine.parent) {
          earthshine.parent.getWorldQuaternion(_parentQuat.current)
          _lightLocal.current.applyQuaternion(_parentQuat.current.invert())
        }
        earthshine.position.copy(_lightLocal.current)
        // Target lives at scene level (added via effect) — world space.
        earthshineTarget.position.copy(worldPos.current)
        earthshine.intensity = lighting.earthshine * smoothMultiplier
      } else {
        earthshine.intensity = 0.0
      }
    }

    // 4. Mutate high-frequency Three.js effects directly (bypasses React virtual DOM rendering)
    if (auraRef.current) {
      auraRef.current.visible = distanceKm > 150.0
      // Billboard toward the camera — the plane would otherwise disappear as
      // the view passes edge-on. (Its roll is invisible: the glow is radially
      // symmetric, so only the facing matters.)
      auraRef.current.lookAt(state.camera.position)

      // Screen-constant sizing: derive the world size that lands
      // GLINT_SCREEN_PX CSS pixels wide at this distance and field of view.
      const halfFovRad = (state.camera as THREE.PerspectiveCamera).getEffectiveFOV() * Math.PI / 360
      const worldPerPx = (2 * Math.tan(halfFovRad) * distanceKm) / Math.max(1, state.size.height)
      // Gentle 0.4 Hz pulse on WALL time — sim time would strobe it at
      // ~120 Hz under 300× acceleration.
      const pulse = 1.0 + 0.12 * Math.sin(state.clock.elapsedTime * 2.5)
      auraRef.current.scale.setScalar((GLINT_SCREEN_PX * worldPerPx * pulse) / 12.0)

      glintUniforms.uOpacity.value = glintOpacity
      // Daylight (light blue glint) → shadow (deeper blue) color shift, blended by shade
      glintUniforms.uColor.value.copy(GLINT_COLOR_SUNLIT).lerp(GLINT_COLOR_SHADOW, shade)
    }
  })

  return (
    <group ref={groupRef}>
      <ModuleExplorerDriver igoalVisible={visibleQuality === 'locate' || visibleQuality === 'high'} />

      {/* ─── Level of Detail 0: Selected Near-Range Detailed Model ─── */}
      {/* The requested candidate. It mounts with its own attempt identity and
          shows only once ITS preparation commits; the committed model below
          keeps rendering until that moment (swap-once-prepared, plan E.4). */}
      {(issDetail.status === 'loading' || issDetail.status === 'preparing' || issDetail.status === 'ready')
        && candidateSpec !== null && candidateQuality !== null && (
        <DetailModelErrorBoundary key={`${candidateSpec.url}:${issDetail.attempt}`} onError={() => handleDetailError(issDetail.attempt)}>
          <Suspense fallback={null}>
            <DetailedISSModel
              key={candidateSpec.url}
              spec={candidateSpec}
              quality={candidateQuality}
              attempt={issDetail.attempt}
              visible={issDetail.status === 'ready' && showDetail}
              onReady={handleDetailReady}
              onError={handleDetailError}
            />
          </Suspense>
        </DetailModelErrorBoundary>
      )}

      {/* ─── Committed detailed model ─── */}
      {/* The last committed quality stays mounted (and visible) while a
          DIFFERENT candidate loads/prepares, so a tier swap never flashes
          the far-range schematic mid-session. */}
      {committedMounted && committedSpec !== null && committedQuality !== null && (
        <Suspense fallback={null}>
          <DetailedISSModel
            key={committedSpec.url}
            spec={committedSpec}
            quality={committedQuality}
            attempt={-1}
            visible={committedShown}
            onReady={handleCommittedNoop}
            onError={handleCommittedNoop}
          />
        </Suspense>
      )}

      {/* ─── Level of Detail 1: Far-Range Schematic Model A ─── */}
      {/* Visible whenever no detailed model is on screen. Its failure is
          terminal: the loading-manager hook publishes 'unavailable' (R4) and
          the fallback subtree unmounts so Earth/UI keep rendering. */}
      {issDetail.status !== 'unavailable' && (
        <FallbackModelErrorBoundary onError={handleFallbackError}>
          <group
            scale={NORMALIZATION_SCALE_A}
            quaternion={MODEL_A_PRE_ROTATION}
            // Visible whenever no detailed model is on screen: far range, or a
            // detail candidate that has not committed yet (including failures —
            // the failed ladder falls back to this schematic).
            visible={modelAVisible}
          >
            <Suspense fallback={null}>
              <FallbackISSModel />
            </Suspense>
          </group>
        </FallbackModelErrorBoundary>
      )}

      {/* ─── Tracking glint — the station's only marker ─── */}
      {/* A radially symmetric glow: a hot white core marking the exact point
          inside a soft light-blue halo. No brackets, ring or crosshair — those
          were removed by request. Sized and pulsed by the frame loop. */}
      <mesh
        ref={auraRef}
        visible={false} // Managed dynamically by useFrame loop
      >
        <planeGeometry args={[12.0, 12.0]} />
        <shaderMaterial
          vertexShader={billboardVert}
          fragmentShader={softGlowFrag}
          uniforms={glintUniforms}
          transparent={true}
          depthWrite={false}
          depthTest={true}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* ─── Soft earthshine point fill-lights to keep structural detail readable close-up inside shadow ─── */}
      {/* Primary central earthshine fill: cooler tone, broad reach, positioned at positive truss offset */}
      <pointLight
        ref={lightPrimaryRef}
        intensity={0.0}  // Mutated dynamically in useFrame loop
        position={[0, 4.0, 48.0]} // Positioned near solar array Z-truss end
        distance={100.0} // Broad reach to prevent local light spotting
        decay={1.0}      // Soft linear falloff
        color="#eef6ff"
      />
      {/* Secondary offset fill: creates soft directionality along negative truss end */}
      <pointLight
        ref={lightSecondaryRef}
        intensity={0.0}  // Mutated dynamically in useFrame loop
        position={[0, 4.0, -48.0]} // Positioned near opposite Z-truss end
        distance={100.0} // Broad reach to prevent local light spotting
        decay={1.0}      // Soft linear falloff
        color="#e6f0ff"
      />

      {/* ─── Earthshine key light (shadowed-pass illumination from nadir) ─── */}
      <directionalLight
        ref={earthshineRef}
        intensity={0.0} // Mutated dynamically in useFrame loop
        color="#b9d2ee" // Cool planetary-reflected sunlight
        target={earthshineTarget}
      />

      {/* ─── High-fidelity ambient orbital fill, providing beautiful wrap-around readability close-up ─── */}
      <hemisphereLight
        ref={lightAmbientRef}
        intensity={0.0}       // Mutated dynamically in useFrame loop
        color="#ffffff"       // Crisp sunlight ambient reflection
        groundColor="#a2cbf0" // Luminous ice-blue atmospheric Earth bounce
      />
    </group>
  )
})
