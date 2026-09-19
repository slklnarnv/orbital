import * as THREE from 'three'
import { easeInOutCubic, lerp, smoothstep } from '@/utils/math'
import { CAMERA_ZOOM_RANGES } from './CameraStateMachine'

const REF_A = new THREE.Vector3(0, 1, 0)
const REF_B = new THREE.Vector3(1, 0, 0)

/**
 * Frame-sampled Reset View and Locate flights.
 *
 * Locate is a single simple sweep: the eye's direction around Earth's center
 * interpolates from departure to the station's neighborhood while its altitude
 * eases down (never below the clearance sphere), and the look target slides
 * from whatever the camera was viewing to the station. The view therefore
 * starts exactly where the user was looking, pans once across the globe as the
 * eye sweeps, and ends centered on the station — one rotation, no fixed
 * arrival orientation, no per-frame shortest-arc decisions. Near-antipodal
 * departures bow the sweep slightly sideways so the interpolated direction
 * never passes through zero.
 */
export class CameraFlightPath {
  readonly startRadius: number
  private readonly radial: THREE.Vector3
  private readonly view: THREE.Vector3
  private readonly viewDistance: number
  private readonly viewToEarth = new THREE.Quaternion()
  private readonly viewStep = new THREE.Quaternion()
  // Locate sweep state (planLocate)
  private readonly dirStart = new THREE.Vector3()
  private readonly targetStart = new THREE.Vector3()
  private readonly sweepAxis = new THREE.Vector3()
  private sweepAngle = 0
  private radiusStart = 0
  private radiusEnd = 0

  constructor(
    readonly position: THREE.Vector3,
    readonly target: THREE.Vector3,
  ) {
    this.startRadius = position.length()
    this.radial = position.clone().normalize()
    this.view = target.clone().sub(position).normalize()
    this.viewDistance = position.distanceTo(target)
    this.viewToEarth.setFromUnitVectors(this.view, this.radial.clone().negate())
  }

  sampleReset(distance: number, progress: number, eye: THREE.Vector3, target: THREE.Vector3): void {
    const eased = easeInOutCubic(progress)
    eye.copy(this.radial).multiplyScalar(lerp(this.startRadius, distance, eased))
    this.viewStep.identity().slerp(this.viewToEarth, eased)
    // Blend viewing direction, not a point that could pass through the eye when
    // resetting from a Free view aimed away from Earth.
    target.copy(this.view).applyQuaternion(this.viewStep)
      .multiplyScalar(lerp(this.viewDistance, distance, eased)).add(eye)
  }

  /**
   * Plan a Locate sweep: the eye direction rotates about ONE fixed axis from
   * departure to the station's standoff while the altitude eases down. A
   * fixed-axis rotation has a perfectly uniform angular rate (a normalized
   * lerp would run ~5× faster mid-path on wide sweeps — measured as an 11°
   * per-frame view spike) and never degenerates, even for antipodal routes.
   * `arrivalEye` is retained for call-site stability; the arrival pose derives
   * from the station and the sweep's own approach side.
   */
  planLocate(_arrivalEye: THREE.Vector3, station: THREE.Vector3): number {
    const stationDir = station.clone().normalize()
    this.dirStart.copy(this.radial)
    this.radiusStart = this.startRadius
    this.targetStart.copy(this.target)

    // The sweep axis is perpendicular to both the departure and the station
    // directions; colinear departures (same side or antipodal) fall back to a
    // deterministic perpendicular so the rotation still has a plane.
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

    // Long dives get more time: distance past the orbital envelope adds up to
    // two seconds, so a 100,000 km approach does not compress into a blink.
    const cruiseTerm = Math.min(2000, Math.max(0, this.startRadius - 20_000) * 0.025)
    return 2000 + cruiseTerm + this.sweepAngle * 350
  }

  sampleLocate(
    _arrivalEye: THREE.Vector3,
    station: THREE.Vector3,
    progress: number,
    eye: THREE.Vector3,
    target: THREE.Vector3,
  ): void {
    const eased = easeInOutCubic(progress)
    eye.copy(this.dirStart).applyAxisAngle(this.sweepAxis, this.sweepAngle * eased)
    const radius = Math.max(
      lerp(this.radiusStart, this.radiusEnd, eased),
      CAMERA_ZOOM_RANGES.ORBITAL.minDistance + 1,
    )
    eye.multiplyScalar(radius)
    // The look target slides from the captured pivot to the station, completing
    // its pan before the eye arrives so the final phase is pure descent with
    // the view locked on the station.
    target.copy(this.targetStart).lerp(station, smoothstep(0, 0.7, eased))
  }
}
