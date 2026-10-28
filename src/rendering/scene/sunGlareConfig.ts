import * as THREE from 'three'

// Sun glare constants and per-frame state, kept free of shader imports so the
// lens flare and the unit tests can read them. See SunGlare.ts for the model.

/** Exposure while the sun is out of view (EnvironmentLayer's adaptation). */
export const DARK_SKY_EXPOSURE = 1.05
/** How far the exposure drops with the visible sun dead ahead. */
export const SUN_EXPOSURE_DROP = 0.30

/** Soft-knee ceiling of the sun billboard (disc + core), linear radiance. */
export const SUN_CORE_KNEE = 2.0
/** Peak linear radiance of the glare overlay (the halo) at full sun. */
export const GLARE_PEAK = 0.28
/** sunGlare.frag's multiplicative dither (±4%) can lift the overlay this much. */
export const GLARE_DITHER_HEADROOM = 1.04

/**
 * The sun's strength this frame, 0..1: the luminance of its apparent flux
 * through the atmosphere times its visibility past foreground objects.
 * EnvironmentLayer writes it at useFrame priority 0; the lens flare reads it
 * in the composer's priority-1 callback, so both see the same frame.
 */
export const sunGlareState = { visibility: 1 }

const _glareView = new THREE.Vector3()

/**
 * The sun's NDC position through `camera`, written to `out`, or false when it
 * is behind the camera. SunGlare calls it from the overlay's onBeforeRender,
 * i.e. with the camera that is drawing the frame: Locate and Reset flights
 * set the camera's orientation after the priority-0 frame callbacks, and an
 * overlay aimed there landed up to ~945 px from the sun mid-flight.
 */
export function projectGlareCenter(sunPoint: THREE.Vector3, camera: THREE.Camera, out: THREE.Vector2): boolean {
  _glareView.copy(sunPoint).applyMatrix4(camera.matrixWorldInverse)
  if (_glareView.z >= 0) return false
  _glareView.applyMatrix4(camera.projectionMatrix)
  out.set(_glareView.x, _glareView.y)
  return true
}
