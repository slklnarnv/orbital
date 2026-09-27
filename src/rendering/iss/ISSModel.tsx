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
//   LOD hysteresis bands, beacon/aura scaling, fill-light distances) is calibrated
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
//   - Deep Planetary Scale (> 12,000 km): Model A + unlit Beacon sphere (8.0 km radius) to
//     ensure spatial tracking visibility above Earth at global distances.
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
import { simulationClock } from '@/core/clock/SimulationClock'
import { sunDirectionWorld } from '@/core/orbital/CoordinateConversions'
import { useLoadingStore } from '@/stores/loadingStore'
import { useCameraStore } from '@/stores/cameraStore'
import { useSettingsStore, type IssModelQuality } from '@/stores/settingsStore'
import { parseRigMetadata, type RigMetadataParse } from './ISSJointKinematics'
import { ISSAnimations } from './ISSAnimations'

// ─── F-03: Use locally-hosted Draco decoder ───────────────────────────────────
// Instead of the gstatic.com CDN (blocked in offline/private-network environments),
// we ship the decoder WASM and JS files in public/draco/ and point useGLTF at them.
// This guarantees Draco-compressed models decode regardless of CDN availability.
useGLTF.setDecoderPath('/draco/')

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
  url: '/models/international_space_station.glb',
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
  url: '/models/iss_igoal.glb',
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

const MODEL_SPECS: Record<IssModelQuality, DetailedModelSpec> = {
  high: IGOAL_DETAILED,
  legacy: LEGACY_DETAILED,
}

// ─── Per-model pre-rotation (native axes → station body axes) ────────────────
// ISSGroup applies the LVLH/TEA flight attitude in the STATION frame
// (+X = V-bar forward, +Y = orbit normal, +Z = nadir). Each model was
// authored in its own native convention, so each needs a fixed pre-rotation
// onto that frame before the group attitude applies. Expressed as
// quaternions so the basis mapping is unambiguous (no Euler-order guesswork).
const HIGH_PRE_ROTATION = new THREE.Quaternion().setFromEuler(
  // High (IGOAL): native +X forward, truss along native Z, nadir −Y.
  // Rx(−90°): Z→+Y (orbit normal), Y→−Z (zenith).
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
const MODEL_PRE_ROTATION: Record<IssModelQuality, THREE.Quaternion> = {
  high: HIGH_PRE_ROTATION,
  legacy: LEGACY_PRE_ROTATION,
}

const FALLBACK_MODEL_URL = '/models/International Space Station (ISS) (A).glb'

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
// along native X (→ body +Y orbit normal) and its module stack along native
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

/** Planetary tracking beacon radius (km) */
const BEACON_RADIUS_KM = 8.0

/** LOD hysteresis bands to prevent boundary thrashing (km) */
const LOD_ENTER_NEAR_KM = 2800
const LOD_EXIT_NEAR_KM = 3200

/** Planetary scale boundary for beacon visibility (km) */
const BEACON_ACTIVATE_KM = 12000

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
  quality: IssModelQuality
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
  const detailedGltf = useGLTF(spec.url)
  const detailedScene = useMemo(() => detailedGltf.scene.clone(), [detailedGltf.scene])
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
      useLoadingStore.getState().setIssDetailPreparing(attempt)
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

      // Spread uploads across frames while the camera stays put. A resolved GLTF
      // alone is not ready: lazy texture uploads and shader linking otherwise hitch
      // the first close-up frame. Compile against the actual scene's lighting.
      for (const texture of textures) {
        await nextFrame()
        if (cancelled) return
        gl.initTexture(texture)
      }
      await nextFrame()
      if (cancelled) return
      await gl.compileAsync(detailedScene, camera, scene)
      await nextFrame()
      if (cancelled || !groupRef.current) return

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
      } finally {
        gl.setScissor(previousScissor)
        gl.setScissorTest(previousScissorTest)
        group.visible = wasVisible
        for (const { mesh, frustumCulled } of meshes) mesh.frustumCulled = frustumCulled
      }
      await nextFrame()
      if (!cancelled) onReady(attempt)
    }

    void prepare().catch((error: unknown) => {
      if (cancelled) return
      console.warn('[ISSModel] Detailed model preparation failed.', error)
      onError(attempt)
    })
    return () => { cancelled = true }
  }, [detailedScene, gl, camera, scene, onReady, onError, attempt])

  const normalizationScale = RENDER_ISS_WINGSPAN_UNITS / spec.wingspanM

  return (
    <group ref={groupRef} scale={normalizationScale} quaternion={MODEL_PRE_ROTATION[quality]} visible={visible}>
      {/* Pivot root lives in raw model units — ISSAnimations resolves its
          gimbal pivots against this frame before the pre-rotation and render
          scale apply. */}
      <group ref={pivotGroupRef} position={spec.pivotOffset}>
        <primitive object={detailedScene} />
        <ISSAnimations rootRef={pivotGroupRef} quality={quality} rigMetadata={rigMetadata} onError={() => onError(attempt)} />
      </group>
    </group>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ISSModel = React.memo(function ISSModel(): JSX.Element {
  const groupRef = useRef<THREE.Group>(null)
  const { scene } = useThree()

  // Element Refs for direct vis/light mutation (zero garbage collection)
  const beaconRef = useRef<THREE.Group>(null)
  const auraRef = useRef<THREE.Mesh>(null)
  const lightPrimaryRef = useRef<THREE.PointLight>(null)
  const lightSecondaryRef = useRef<THREE.PointLight>(null)
  const lightAmbientRef = useRef<THREE.HemisphereLight>(null)
  const earthshineRef = useRef<THREE.DirectionalLight>(null)

  // Tracking refs to maintain stable hysteresis states across frames
  const isNearRef = useRef(false)
  const worldPos = useRef(new THREE.Vector3())
  const [isNear, setIsNear] = useState(false)
  // Single lifecycle authority for the detail candidate (plan 001 phase E):
  // status + attempt identity + the committed (active) quality.
  const issDetail = useLoadingStore((state) => state.issDetail)
  // During a Locate flight the detail model is shown from departure, not at
  // the 2,800 km LOD boundary — the load/GPU preparation already finished
  // before departure, so the swap would otherwise be visible mid-flight.
  const isTransitioning = useCameraStore((state) => state.isTransitioning)

  // ─── Detailed model selection with reliability ladder ───
  // 'high' (IGOAL) is the default; if it fails to load, the ladder demotes to
  // the proven legacy detailed model before falling all the way to Model A.
  const settingQuality = useSettingsStore((state) => state.issModelQuality)
  const selectionNonce = useSettingsStore((state) => state.selectionNonce)
  const [demotedQuality, setDemotedQuality] = useState<IssModelQuality | null>(null)
  const quality = demotedQuality ?? settingQuality
  const spec = MODEL_SPECS[quality]
  const showDetail = isNear || isTransitioning

  // Selection orchestration: records the requested quality on mount (without
  // loading — detail is requested on Locate intent or near-range entry, never
  // at startup), then begins a fresh candidate attempt whenever the explicit
  // selection changes or the demotion ladder moves the request. An explicit
  // re-selection (nonce) clears an active demotion; an automatic demotion
  // changes `quality` without the nonce and survives.
  const seenSelection = useRef<{ quality: IssModelQuality | null; nonce: number } | null>(null)
  useEffect(() => {
    const store = useLoadingStore.getState()
    if (seenSelection.current === null) {
      seenSelection.current = { quality, nonce: selectionNonce }
      store.identifyISSDetail(quality)
      return
    }
    const nonceChanged = seenSelection.current.nonce !== selectionNonce
    const qualityChanged = seenSelection.current.quality !== quality
    seenSelection.current = { quality, nonce: selectionNonce }
    if (nonceChanged) setDemotedQuality(null)
    if (nonceChanged || qualityChanged) store.beginISSDetailAttempt(quality)
  }, [quality, selectionNonce])

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

  const handleDetailError = useCallback((attempt: number) => {
    const store = useLoadingStore.getState()
    store.failISSDetailAttempt(attempt)
    console.warn('[ISSModel] detail attempt failed', {
      attempt, status: store.issDetail.status, quality: store.issDetail.quality,
    })
    // Drei caches rejected loader promises as well as successful assets. Clear the
    // failed entry so leaving and re-entering near range can retry a transient error.
    useGLTF.clear(MODEL_SPECS[store.issDetail.quality ?? quality].url)
    // Reliability ladder: a failed 'high' attempt demotes to the proven legacy
    // detailed model for the rest of the session (until explicitly re-selected);
    // the quality change re-enters the selection effect and starts that load.
    if (store.issDetail.quality === 'high') {
      console.warn('[ISSModel] demoting high -> legacy')
      setDemotedQuality('legacy')
    }
  }, [quality])

  const handleFallbackError = useCallback(() => {
    // Model A itself failed: terminal for the session. Earth/UI stay alive,
    // Locate resolves visibly, and nothing auto-retries the ladder.
    useLoadingStore.getState().markISSUnavailable()
  }, [])

  // ─── Visibility ownership (E.4: swap-once-prepared) ───
  // committed = the last quality that reached 'ready'. It stays mounted while
  // a different candidate loads/prepares and remains the displayed model until
  // that candidate commits, so a selection change never flashes Model A.
  const committedQuality = issDetail.activeQuality
  const committedMounted = committedQuality !== null
    && !(issDetail.status === 'ready' && committedQuality === quality)
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
  useEffect(() => {
    scene.add(earthshineTarget)
    return () => { scene.remove(earthshineTarget) }
  }, [scene, earthshineTarget])

  const _nadirDir = useRef(new THREE.Vector3())
  const _lightLocal = useRef(new THREE.Vector3())
  const _parentQuat = useRef(new THREE.Quaternion())

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

    // 2. Evaluate planetary beacon visibility
    const isBeaconVisible = !nextIsNear && distanceKm > BEACON_ACTIVATE_KM

    // 3. Compute distance-adaptive optical glint halo (Amber/Blue glow)
    // The halo represents photovoltaic solar panel glint visible at mid-range distances.
    // Restrained: invisible close-up (protects ISS model detail), subtle at range.
    let auraOpacity = 0.0
    if (distanceKm > 150.0) {
      if (distanceKm < 2000.0) {
        // Smoothly fade in from 150 km to 2000 km, peaking at 0.35
        auraOpacity = ((distanceKm - 150.0) / 1850.0) * 0.35
      } else {
        // Decays slowly to a faint, stable 0.15 at far planetary distances
        auraOpacity = 0.35 - Math.min(0.20, ((distanceKm - 2000.0) / 10000.0) * 0.20)
      }
    }

    // 3b. Shadow detection for dynamic color-shifting halo
    const simTime = simulationClock.now()
    const sunDir = sunDirectionWorld(simTime.julianDate)
    _sunDirVec.set(sunDir.x, sunDir.y, sunDir.z).normalize()
    const p = worldPos.current.dot(_sunDirVec)
    const perpSq = worldPos.current.lengthSq() - p * p
    const isShadowed = p < 0 && perpSq < 6371.0 * 6371.0

    // 3c. Dynamic camera-distance-based local point lights exposure scaling
    // Lights are 0.0 at far planetary ranges (3000 km) and scale smoothly to 1.0 during close zoom (100 km)
    const minLightDist = 100.0
    const maxLightDist = 3000.0
    const lightFactor = 1.0 - THREE.MathUtils.clamp((distanceKm - minLightDist) / (maxLightDist - minLightDist), 0.0, 1.0)
    const smoothMultiplier = Math.pow(lightFactor, 2.0) // Soft quadratic ease-in for simulated exposure adaptation

    // Physical Camera Exposure Adaptation
    // When the ISS is in shadow, we boost light exposure by 2.3x so modules remain engineered and visible.
    const shadowExposureBoost = isShadowed ? 2.3 : 1.0

    if (lightPrimaryRef.current) {
      lightPrimaryRef.current.intensity = 1.6 * smoothMultiplier * shadowExposureBoost
    }
    if (lightSecondaryRef.current) {
      lightSecondaryRef.current.intensity = 0.8 * smoothMultiplier * shadowExposureBoost
    }
    if (lightAmbientRef.current) {
      // Dynamic ambient fill: lifts shadowed module details dynamically when zoomed in close.
      // Soft fill when sunlit (0.24) to keep contrast, and a richer lift when shadowed (0.42) to simulate camera exposure adaptation.
      const baseAmbientIntensity = isShadowed ? 0.42 : 0.24
      lightAmbientRef.current.intensity = baseAmbientIntensity * smoothMultiplier
    }

    // 3d. Earthshine key light — physically motivated dark-side illumination.
    // Real stations in Earth's shadow are lit by sunlight reflected off the
    // planet below, so the light comes FROM the nadir and reaches the whole
    // model uniformly. Distance-adaptive (smoothMultiplier) like the fills:
    // irrelevant at planetary range where the detail model is hidden.
    const earthshine = earthshineRef.current
    if (earthshine) {
      if (isShadowed) {
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
        earthshine.intensity = 0.65 * smoothMultiplier
      } else {
        earthshine.intensity = 0.0
      }
    }

    // 4. Mutate high-frequency Three.js effects directly (bypasses React virtual DOM rendering)
    if (beaconRef.current) {
      beaconRef.current.visible = isBeaconVisible
      // Rotate the telemetry tracking ring to face the camera perfectly
      beaconRef.current.lookAt(state.camera.position)
      // Dynamic screen-proportional scaling so the locator remains readable at global scales
      // Calibration: Math.max(1.2, distanceKm / 6800.0) ensures clean visibility against the Earth limb.
      const dynamicScale = Math.max(1.2, distanceKm / 6800.0)
      // Add a gentle, slow scientific telemetry pulse (0.4 Hz)
      const pulse = 1.0 + 0.16 * Math.sin(simTime.epochMs * 0.0025)
      beaconRef.current.scale.setScalar(dynamicScale * pulse)
    }
    if (auraRef.current) {
      auraRef.current.visible = distanceKm > 150.0

      // Dynamic screen-proportional scaling so the halo remains readable at global scales
      const dynamicScale = Math.max(1.0, distanceKm / 800.0)
      auraRef.current.scale.setScalar(dynamicScale)

      const mat = auraRef.current.material as THREE.MeshBasicMaterial
      if (mat) {
        mat.opacity = auraOpacity
        // Dynamic daylight (warm amber glint) vs. shadow (cool blue/cyan) color shift
        mat.color.set(isShadowed ? '#80D0FF' : '#FFD580')
      }
    }
  })

  return (
    <group ref={groupRef}>
      {/* ─── Level of Detail 0: Selected Near-Range Detailed Model ─── */}
      {/* The requested candidate. It mounts with its own attempt identity and
          shows only once ITS preparation commits; the committed model below
          keeps rendering until that moment (swap-once-prepared, plan E.4). */}
      {(issDetail.status === 'loading' || issDetail.status === 'preparing' || issDetail.status === 'ready') && (
        <DetailModelErrorBoundary key={`${spec.url}:${issDetail.attempt}`} onError={() => handleDetailError(issDetail.attempt)}>
          <Suspense fallback={null}>
            <DetailedISSModel
              key={spec.url}
              spec={spec}
              quality={quality}
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
          DIFFERENT candidate loads/prepares, so a selection change never
          flashes the far-range schematic mid-session. */}
      {committedMounted && (
        <Suspense fallback={null}>
          <DetailedISSModel
            key={MODEL_SPECS[committedQuality].url}
            spec={MODEL_SPECS[committedQuality]}
            quality={committedQuality}
            attempt={-1}
            visible={committedShown}
            onReady={() => { /* already committed */ }}
            onError={() => { /* already committed; its failures are inert */ }}
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

      {/* ─── Concentric Telemetry Tracking Beacon Ring ─── */}
      <group
        ref={beaconRef}
        visible={false} // Managed dynamically by useFrame loop
      >
        {/* Outer tracking ring */}
        <mesh>
          <ringGeometry args={[BEACON_RADIUS_KM - 0.8, BEACON_RADIUS_KM, 32]} />
          <meshBasicMaterial
            color="#90e0ff" // Bright luminous aerospace blue/cyan
            transparent={true}
            opacity={0.85}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* Inner core telemetry tracking dot */}
        <mesh>
          <sphereGeometry args={[1.5, 8, 8]} />
          <meshBasicMaterial
            color="#bae6fd"
            transparent={true}
            opacity={0.85}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      {/* ─── Photographic Optical Aura / Glint Halo ─── */}
      <mesh
        ref={auraRef}
        visible={false} // Managed dynamically by useFrame loop
      >
        <sphereGeometry args={[6.0, 16, 16]} />
        <meshBasicMaterial
          color="#FFD580" // Photographic warm amber — restrained solar panel glint
          transparent={true}
          opacity={0.0}
          depthWrite={false}
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
