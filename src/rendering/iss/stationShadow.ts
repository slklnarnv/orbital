import * as THREE from 'three'

/**
 * Station self-shadowing from the sun, cached so it costs almost nothing.
 *
 * The scene's one sun DirectionalLight (EnvironmentLayer, named SUN_LIGHT_NAME)
 * casts the shadow. Its position always follows its target along the sun
 * direction, so aiming the target at the station keeps the light direction
 * unchanged while the shadow camera becomes a tight box around the station
 * (±SHADOW_HALF_EXTENT km) — 2048² texels then resolve ~7 cm of hardware.
 *
 * The map is NOT redrawn every frame (shadow.autoUpdate = false). Each frame
 * only re-fits the shadow camera's matrices around the station's current
 * position (the station crosses ~7.7 km of world per second; translating the
 * light-space frame with it keeps the cached map aligned), and
 * ShadowRefreshScheduler redraws the map only when the sun's direction in the
 * station frame or a joint angle has moved enough to show.
 */

export const SUN_LIGHT_NAME = 'SunLight'

/** Light distance from its target (world units). Direction is what lights;
 *  a short distance keeps the shadow camera's depth range precise. */
export const SUN_LIGHT_DISTANCE = 2000

/** Half-size of the shadow box: the station's bounding radius (~67 km at render scale) plus margin. */
export const SHADOW_HALF_EXTENT = 70
export const SHADOW_MAP_SIZE = 2048

/** Configure the sun light's shadow for the station (idempotent). */
export function configureStationShadow(light: THREE.DirectionalLight): void {
  const shadow = light.shadow
  shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  const camera = shadow.camera
  camera.left = -SHADOW_HALF_EXTENT
  camera.right = SHADOW_HALF_EXTENT
  camera.top = SHADOW_HALF_EXTENT
  camera.bottom = -SHADOW_HALF_EXTENT
  camera.near = SUN_LIGHT_DISTANCE - SHADOW_HALF_EXTENT - 20
  camera.far = SUN_LIGHT_DISTANCE + SHADOW_HALF_EXTENT + 20
  camera.updateProjectionMatrix()
  // Tuned on the IGOAL asset under the app's lighting: no acne on the thin
  // array blankets or the curved modules, no visible peter-panning.
  shadow.bias = -0.0002
  shadow.normalBias = 0.05
  shadow.autoUpdate = false
}

/**
 * Place the sun light on `centerWorld` (direction `sunDirection`, unit) and
 * re-fit the shadow matrices there without redrawing the map.
 */
export function aimSunLightAt(
  light: THREE.DirectionalLight,
  centerWorld: THREE.Vector3,
  sunDirection: THREE.Vector3,
): void {
  light.target.position.copy(centerWorld)
  light.target.updateMatrixWorld()
  light.position.copy(centerWorld).addScaledVector(sunDirection, SUN_LIGHT_DISTANCE)
  light.updateMatrixWorld()
  light.shadow.updateMatrices(light)
}

/**
 * Decides when the cached station shadow map is redrawn: when the sun's
 * direction in the station frame or any joint angle has moved more than
 * `thresholdRad`, at most every `minIntervalMs`, and in any case every
 * `maxIntervalMs` (the camera idle sweeps and slow drifts below threshold).
 * At 1× the sun crosses the threshold every ~2 s; at 300× the minimum
 * interval caps redraws at 20 Hz.
 */
/** Redraw floor while the clock is being sought (scrub, nudges): ~6.7 Hz. */
export const SEEK_MIN_INTERVAL_MS = 150

export class ShadowRefreshScheduler {
  private readonly lastSun = new THREE.Vector3()
  private lastJoints: number[] = []
  private lastMs = -Infinity
  private primed = false

  constructor(
    private readonly thresholdRad = (0.15 * Math.PI) / 180,
    private readonly minIntervalMs = 50,
    private readonly maxIntervalMs = 2000,
  ) {}

  /** Forget the last redraw (a new model became visible): redraw next frame. */
  invalidate(): void {
    this.primed = false
  }

  /**
   * `seeking`: time is being scrubbed or sought while paused. Every seek
   * swings the sun in the station frame, so the 50 ms floor would redraw the
   * full 2.7M-triangle model at 20 Hz (Inspect scrubs fell to ~44 fps on an
   * integrated GPU); while seeking the floor is SEEK_MIN_INTERVAL_MS.
   */
  shouldRefresh(nowMs: number, sunInStation: THREE.Vector3, jointAngles: readonly number[], seeking = false): boolean {
    const elapsed = nowMs - this.lastMs
    const minIntervalMs = seeking ? Math.max(this.minIntervalMs, SEEK_MIN_INTERVAL_MS) : this.minIntervalMs
    let refresh = !this.primed || elapsed >= this.maxIntervalMs
    if (!refresh && elapsed >= minIntervalMs) {
      refresh = this.lastSun.angleTo(sunInStation) > this.thresholdRad
        || jointAngles.length !== this.lastJoints.length
        || jointAngles.some((angle, i) => Math.abs(angle - this.lastJoints[i]) > this.thresholdRad)
    }
    if (refresh) {
      this.primed = true
      this.lastMs = nowMs
      this.lastSun.copy(sunInStation)
      this.lastJoints = [...jointAngles]
    }
    return refresh
  }
}
