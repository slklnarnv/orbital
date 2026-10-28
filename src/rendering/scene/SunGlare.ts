import * as THREE from 'three'
import {
  ATMOSPHERE_SCALE_HEIGHT_KM,
  SUN_DISC_RADIUS_RAD,
  SUN_TANGENT_TAU,
  apparentSunFlux,
  type Rgb,
} from '@/core/orbital/SunAppearance'
import { EARTH_RADIUS_KM } from '@/utils/constants'
import { DARK_SKY_EXPOSURE, GLARE_PEAK, SUN_CORE_KNEE, sunGlareState } from './sunGlareConfig'
import glareVert from '../shaders/sunGlare.vert'
import glareFrag from '../shaders/sunGlare.frag'

/**
 * SunGlare — what makes the sun read as blinding: a camera point-spread
 * function in two layers, plus the bookkeeping that fades it.
 *
 *   core     drawn by the sun billboard itself (sun.frag): disc plus a
 *            blown-out core ~2x its size, depth-tested, so Earth and the
 *            station cut it per pixel. A soft knee caps it at SUN_CORE_KNEE.
 *   overlay  a screen-space quad (sunGlare.frag): wide halo and faint
 *            six-blade diffraction spikes, NOT depth-tested — veiling glare
 *            lies over everything in the frame, Earth's limb included.
 *
 * Both layers are scene meshes, so Bloom on and Bloom off draw the same glare
 * (Bloom off stays the direct pipeline: no composer, no extra pass), and both
 * stay below BLOOM_THRESHOLD so UnrealBloom never squares them (see sun.frag).
 *
 * What scales them, per frame:
 *   - the sun's apparent flux (SunAppearance.apparentSunFlux): the visible,
 *     atmosphere-filtered part of the disc. It falls to 0 and reddens as the
 *     disc sinks behind the limb, so the glare fades gradually instead of
 *     popping when the depth test removes the disc;
 *   - foreground visibility: an occlusion query on a probe disc at the sun
 *     (the station's arrays can hide the sun; the overlay has no depth test
 *     and would otherwise shine through them), damped so it fades over ~1/30 s;
 *   - the exposure term (EnvironmentLayer): the ratio to the dark-sky
 *     exposure, so as the camera stops down for the sun the blown-out core
 *     shrinks the way an auto-exposed camera's does.
 */

/** Overlay quad half-size, NDC-height units (~18° at the 45° field of view). */
const GLARE_RADIUS_NDC = 0.8
/** Occlusion probe radius, as a fraction of the rendered disc radius. */
const PROBE_RADIUS_FRACTION = 0.6
/** Damping rate (1/s) of the probe's on/off answer. */
const PROBE_RESPONSE = 30
/** Below this the overlay is not drawn at all. */
const MIN_GLARE = 1e-4

const _view = new THREE.Vector3()

/**
 * Asynchronous ANY_SAMPLES_PASSED query around one draw of the probe mesh.
 * Results arrive a frame or two later; the last known answer is kept while a
 * query is in flight or while the probe is culled (sun off-screen).
 */
class OcclusionProbe {
  readonly mesh: THREE.Mesh
  visible = true
  private gl: WebGL2RenderingContext | null = null
  private query: WebGLQuery | null = null
  private open = false

  constructor() {
    const material = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      depthTest: true,
      // Transparent pass: drawn after every opaque depth writer.
      transparent: true,
    })
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 16), material)
    this.mesh.name = 'SunOcclusionProbe'
    this.mesh.renderOrder = 2
    this.mesh.onBeforeRender = (renderer) => {
      if (this.query) return
      const gl = renderer.getContext() as WebGL2RenderingContext
      const query = gl.createQuery()
      if (!query) return
      this.gl = gl
      gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, query)
      this.query = query
      this.open = true
    }
    this.mesh.onAfterRender = () => {
      if (!this.open || !this.gl) return
      this.gl.endQuery(this.gl.ANY_SAMPLES_PASSED_CONSERVATIVE)
      this.open = false
    }
  }

  poll(): void {
    const gl = this.gl
    const query = this.query
    if (!gl || !query || this.open) return
    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return
    this.visible = Boolean(gl.getQueryParameter(query, gl.QUERY_RESULT))
    gl.deleteQuery(query)
    this.query = null
  }

  dispose(): void {
    if (this.gl && this.query) this.gl.deleteQuery(this.query)
    this.query = null
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

export class SunGlare {
  /** Uniforms of the sun billboard's material (sun.vert / sun.frag). */
  readonly billboardUniforms = {
    uDiscRad: { value: SUN_DISC_RADIUS_RAD },
    uGlare: { value: new THREE.Vector3(1, 1, 1) },
    uExposureRatio: { value: 1 },
    uKnee: { value: SUN_CORE_KNEE },
    uTau: { value: new THREE.Vector3(...SUN_TANGENT_TAU) },
    uScaleHeight: { value: ATMOSPHERE_SCALE_HEIGHT_KM },
    uEarthRadius: { value: EARTH_RADIUS_KM },
  }

  readonly overlay: THREE.Mesh
  private readonly overlayUniforms = {
    uSunNdc: { value: new THREE.Vector2() },
    uAspect: { value: 1 },
    uRadius: { value: GLARE_RADIUS_NDC },
    uPixel: { value: 2 / 720 },
    uColor: { value: new THREE.Vector3() },
  }

  private readonly probe = new OcclusionProbe()
  private readonly flux: Rgb = { r: 1, g: 1, b: 1 }
  private foreground = 1

  constructor() {
    const material = new THREE.ShaderMaterial({
      name: 'SunGlare',
      uniforms: this.overlayUniforms,
      vertexShader: glareVert,
      fragmentShader: glareFrag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
    this.overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    this.overlay.name = 'SunGlare'
    // Positioned in clip space by its vertex shader; never frustum-cull it.
    this.overlay.frustumCulled = false
    // After the sun billboard (2): the last thing in the transparent pass.
    this.overlay.renderOrder = 3
    this.overlay.visible = false
  }

  get probeMesh(): THREE.Mesh {
    return this.probe.mesh
  }

  /**
   * How much sun reaches the camera this frame (0..1). Call before choosing
   * the exposure: the exposure adapts only to a sun that is actually seen.
   */
  measure(camera: THREE.Camera, sunPoint: THREE.Vector3, delta: number): number {
    apparentSunFlux(camera.position, sunPoint, SUN_DISC_RADIUS_RAD, this.flux)
    this.probe.poll()
    this.foreground = THREE.MathUtils.damp(this.foreground, this.probe.visible ? 1 : 0, PROBE_RESPONSE, delta)
    const f = this.flux
    const visibility = (0.2126 * f.r + 0.7152 * f.g + 0.0722 * f.b) * this.foreground
    sunGlareState.visibility = visibility
    return visibility
  }

  /** Aim and scale both layers and the probe for the frame about to render. */
  apply(camera: THREE.PerspectiveCamera, sunPoint: THREE.Vector3, exposure: number, bufferHeight: number): void {
    const exposureRatio = Math.min(1, exposure / DARK_SKY_EXPOSURE)
    const s = this.foreground * exposureRatio
    const f = this.flux
    const b = this.billboardUniforms
    b.uGlare.value.set(f.r * s, f.g * s, f.b * s)
    b.uExposureRatio.value = exposureRatio

    camera.updateMatrixWorld()
    _view.copy(sunPoint).applyMatrix4(camera.matrixWorldInverse)
    const inFront = _view.z < 0

    // Probe: the inner part of the rendered disc, facing the camera.
    const probe = this.probe.mesh
    probe.visible = inFront
    if (inFront) {
      probe.position.copy(sunPoint)
      probe.lookAt(camera.position)
      probe.scale.setScalar(camera.position.distanceTo(sunPoint) * Math.tan(SUN_DISC_RADIUS_RAD * PROBE_RADIUS_FRACTION))
    }

    const o = this.overlayUniforms
    const peak = GLARE_PEAK * s
    let show = inFront && peak * Math.max(f.r, f.g, f.b) > MIN_GLARE
    if (show) {
      _view.applyMatrix4(camera.projectionMatrix)
      const extentX = GLARE_RADIUS_NDC / camera.aspect
      show = Math.abs(_view.x) - extentX < 1 && Math.abs(_view.y) - GLARE_RADIUS_NDC < 1
      o.uSunNdc.value.set(_view.x, _view.y)
      o.uAspect.value = camera.aspect
      o.uPixel.value = 2 / Math.max(1, bufferHeight)
      o.uColor.value.set(f.r * peak, f.g * peak, f.b * peak)
    }
    this.overlay.visible = show
  }

  dispose(): void {
    this.probe.dispose()
    this.overlay.geometry.dispose()
    ;(this.overlay.material as THREE.Material).dispose()
  }
}
