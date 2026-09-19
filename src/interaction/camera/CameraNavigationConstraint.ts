import * as THREE from 'three'
import type CameraControls from 'camera-controls'
import { CAMERA_ZOOM_RANGES } from './CameraStateMachine'

const EARTH_LIMIT = CAMERA_ZOOM_RANGES.ORBITAL.minDistance
const CONTACT_EPSILON = 0.001 // One metre in the kilometre-scale scene.

/** Resolve an eye movement against Earth's clearance sphere, sliding at contact. */
export function resolveEarthCollision(
  previous: THREE.Vector3,
  desired: THREE.Vector3,
  result: THREE.Vector3,
  sweep = true,
): boolean {
  result.copy(desired)
  let collided = false
  const dx = desired.x - previous.x
  const dy = desired.y - previous.y
  const dz = desired.z - previous.z
  const distanceSq = dx * dx + dy * dy + dz * dz
  const previousRadiusSq = previous.lengthSq()

  // Sweeping catches fast pans whose endpoints are both outside the planet.
  // Earth-centred rotations use spherical paths, not chords, and skip this step.
  if (sweep && distanceSq > 0 && previousRadiusSq >= EARTH_LIMIT * EARTH_LIMIT) {
    const approach = previous.x * dx + previous.y * dy + previous.z * dz
    const discriminant = approach * approach - distanceSq * (previousRadiusSq - EARTH_LIMIT * EARTH_LIMIT)
    if (approach < 0 && discriminant > 0) {
      const contact = (-approach - Math.sqrt(discriminant)) / distanceSq
      if (contact >= 0 && contact <= 1) {
        const nx = (previous.x + dx * contact) / EARTH_LIMIT
        const ny = (previous.y + dy * contact) / EARTH_LIMIT
        const nz = (previous.z + dz * contact) / EARTH_LIMIT
        const remaining = 1 - contact
        const inward = (dx * nx + dy * ny + dz * nz) * remaining
        result.set(
          nx * (EARTH_LIMIT + CONTACT_EPSILON) + dx * remaining - nx * inward,
          ny * (EARTH_LIMIT + CONTACT_EPSILON) + dy * remaining - ny * inward,
          nz * (EARTH_LIMIT + CONTACT_EPSILON) + dz * remaining - nz * inward,
        )
        collided = true
      }
    }
  }

  if (result.lengthSq() < EARTH_LIMIT * EARTH_LIMIT) {
    if (result.lengthSq() === 0) {
      result.copy(previous)
      if (result.lengthSq() === 0) result.set(0, 0, 1)
    }
    result.setLength(EARTH_LIMIT + CONTACT_EPSILON)
    collided = true
  }
  return collided
}

/** Keeps rendered and damped camera motion consistent after an Earth collision. */
export class CameraNavigationConstraint {
  private readonly previousEye = new THREE.Vector3()
  private readonly previousTarget = new THREE.Vector3()
  private readonly eye = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly endEye = new THREE.Vector3()
  private readonly endTarget = new THREE.Vector3()
  private readonly safeEye = new THREE.Vector3()
  private readonly safeEndEye = new THREE.Vector3()
  private readonly offsetA = new THREE.Vector3()
  private readonly offsetB = new THREE.Vector3()
  private readonly arcProbe = new THREE.Vector3()
  private initialized = false

  reset(controls: CameraControls): void {
    controls.getPosition(this.previousEye, false)
    controls.getTarget(this.previousTarget, false)
    this.initialized = true
  }

  /**
   * Minimum Earth-center radius along the circular arc the eye traces when it
   * orbits a fixed pivot at constant distance. Orbit motion follows that arc,
   * not the straight chord between endpoints — sweeping the chord misclassifies
   * safe grazing orbits as collisions and injects corrections the gesture never
   * asked for.
   */
  private orbitStaysOutside(previousOffset: THREE.Vector3, offset: THREE.Vector3): boolean {
    const length = offset.length()
    this.offsetA.copy(previousOffset).normalize()
    this.offsetB.copy(offset).normalize()
    const steps = 8
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      this.arcProbe.lerpVectors(this.offsetA, this.offsetB, t)
      // Normalized lerp of two unit directions is their spherical interpolation.
      if (this.arcProbe.lengthSq() === 0) this.arcProbe.copy(this.offsetB)
      this.arcProbe.normalize().multiplyScalar(length).add(this.target)
      if (this.arcProbe.lengthSq() < EARTH_LIMIT * EARTH_LIMIT) return false
    }
    return true
  }

  update(controls: CameraControls, freeNavigation: boolean): void {
    if (!this.initialized) this.reset(controls)
    controls.getPosition(this.eye, false)
    controls.getTarget(this.target, false)
    const sweep = this.target.lengthSq() > 1 || this.previousTarget.lengthSq() > 1
    const targetMoved = this.target.distanceToSquared(this.previousTarget) > 1e-8
    const isPanning = freeNavigation && targetMoved
    this.offsetA.subVectors(this.previousEye, this.previousTarget)
    this.offsetB.subVectors(this.eye, this.target)
    // A same-length offset around an unmoved pivot is an orbit; judge it by the
    // arc it actually travels. Everything else keeps the straight-segment sweep
    // that catches fast translations.
    const offsetDrift = Math.abs(this.offsetB.length() - this.offsetA.length())
    const isOrbit = !targetMoved
      && this.offsetA.lengthSq() > 0
      && offsetDrift < 0.001 * Math.max(1, this.offsetA.length())
      && this.orbitStaysOutside(this.offsetA, this.offsetB)
    if (isOrbit) {
      this.reset(controls)
      return
    }

    if (resolveEarthCollision(this.previousEye, this.eye, this.safeEye, sweep)) {
      controls.getPosition(this.endEye)
      controls.getTarget(this.endTarget)
      resolveEarthCollision(this.safeEye, this.endEye, this.safeEndEye, sweep)
      if (isPanning) {
        // A blocked pan must move the eye and pivot together, rather than letting
        // the pivot tunnel through Earth and stretching the camera's orbit radius.
        this.target.add(this.safeEye).sub(this.eye)
        this.endTarget.add(this.safeEndEye).sub(this.endEye)
      }

      // Retain a safe pending destination after correcting the rendered pose.
      // Tracking keeps its fixed focus; a free pan keeps its eye-to-pivot offset.
      void controls.setLookAt(
        this.safeEye.x, this.safeEye.y, this.safeEye.z,
        this.target.x, this.target.y, this.target.z, false,
      )
      void controls.setLookAt(
        this.safeEndEye.x, this.safeEndEye.y, this.safeEndEye.z,
        this.endTarget.x, this.endTarget.y, this.endTarget.z, true,
      )
      controls.update(0)
    }
    this.reset(controls)
  }
}
