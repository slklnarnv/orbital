import * as THREE from 'three'

import type { OrbitalState } from '@/types/orbital'

const DEFAULT_SAMPLE_INTERVAL_SECONDS = 0.1
const MAX_SAMPLE_INTERVAL_SECONDS = 0.25
// Beyond this step between consecutive snapshots there is no meaningful
// smoothed interpolation: linearly bridging a seek-sized chord sweeps the
// station through Earth's interior (measured: a half-orbit seek dipped the
// rendered radius from 6,794 km through 2,253 km). Such jumps RESEED at the
// new truth instead. 50 km ≈ 6.5 s of orbital motion, 5× headroom over the
// 120× accelerated-time snapshot stride.
const MAX_INTERPOLABLE_STEP_KM = 50
// A step is also discontinuous when it is nonphysical for the simulated time
// between the snapshots (seek with a matching clock jump), with margin for
// propagation jitter. The physical bound adapts to any time-scale.
const PHYSICAL_STEP_FACTOR = 4
const PHYSICAL_STEP_MARGIN_KM = 5

function copyWorldPosition(
  positionECI: OrbitalState['positionECI'],
  target: THREE.Vector3,
): void {
  target.set(positionECI.x, positionECI.z, -positionECI.y)
}

/**
 * Smooths application-owned orbital snapshots for frame-rate rendering.
 *
 * SimulationRuntime intentionally publishes truth at 10 Hz. Rendering can run much
 * faster, so copying each snapshot directly produces visible 100 ms steps. This
 * interpolator consumes each immutable snapshot once and blends to it over the
 * observed sample interval without changing simulation truth or running SGP4 in the
 * render loop.
 *
 * Discontinuous snapshots — explicit clock seeks or telemetry gaps — are an
 * exception: both translation and the interpolator's own state reseed at the
 * new snapshot instead of blending a chord between distant orbits (plan 001,
 * phase F). Ordinary 10 Hz motion (including accelerated time) keeps the
 * smooth interpolation.
 */
export class OrbitalRenderInterpolator {
  private readonly origin = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly current = new THREE.Vector3()
  private readonly lastSnapshotPosition = new THREE.Vector3()
  private lastSnapshot: OrbitalState | null = null
  private lastSnapshotFrameSeconds = 0
  private transitionStartSeconds = 0
  private transitionDurationSeconds = 0

  sample(
    snapshot: OrbitalState,
    frameTimeSeconds: number,
    result: THREE.Vector3,
  ): THREE.Vector3 {
    if (!this.lastSnapshot || frameTimeSeconds < this.lastSnapshotFrameSeconds) {
      this.reseed(snapshot, frameTimeSeconds)
      return result.copy(this.target)
    }

    if (snapshot !== this.lastSnapshot) {
      this.sampleTransition(frameTimeSeconds, this.current)

      const observedInterval = frameTimeSeconds - this.lastSnapshotFrameSeconds
      copyWorldPosition(snapshot.positionECI, this.target)

      if (this.isDiscontinuous(snapshot)) {
        this.reseed(snapshot, frameTimeSeconds)
      } else {
        this.origin.copy(this.current)
        this.transitionStartSeconds = frameTimeSeconds
        this.transitionDurationSeconds = Math.min(
          observedInterval > 0 ? observedInterval : DEFAULT_SAMPLE_INTERVAL_SECONDS,
          MAX_SAMPLE_INTERVAL_SECONDS,
        )
        this.lastSnapshot = snapshot
        this.lastSnapshotFrameSeconds = frameTimeSeconds
      }
    }

    return this.sampleTransition(frameTimeSeconds, result)
  }

  /** Snap every channel of the interpolation state onto the new snapshot. */
  private reseed(snapshot: OrbitalState, frameTimeSeconds: number): void {
    copyWorldPosition(snapshot.positionECI, this.target)
    this.origin.copy(this.target)
    this.lastSnapshotPosition.copy(this.target)
    this.lastSnapshot = snapshot
    this.lastSnapshotFrameSeconds = frameTimeSeconds
    this.transitionStartSeconds = frameTimeSeconds
    this.transitionDurationSeconds = 0
  }

  /**
   * A jump is discontinuous when it exceeds any physically-plausible step for
   * the simulated time between the snapshots (seek, telemetry reset) or the
   * absolute bound beyond which even physical steps must not be linearly
   * bridged (orbital curvature would dip the chord through Earth).
   */
  private isDiscontinuous(snapshot: OrbitalState): boolean {
    const stepKm = this.lastSnapshotPosition.distanceTo(this.target)
    if (stepKm > MAX_INTERPOLABLE_STEP_KM) return true
    if (!this.lastSnapshot) return false
    const dtSeconds = (snapshot.timestamp - this.lastSnapshot.timestamp) / 1000
    if (dtSeconds <= 0 || !(snapshot.speed > 0)) return false
    const plausibleKm =
      snapshot.speed * dtSeconds * PHYSICAL_STEP_FACTOR + PHYSICAL_STEP_MARGIN_KM
    return stepKm > plausibleKm
  }

  private sampleTransition(frameTimeSeconds: number, result: THREE.Vector3): THREE.Vector3 {
    if (this.transitionDurationSeconds <= 0) return result.copy(this.target)

    const progress = THREE.MathUtils.clamp(
      (frameTimeSeconds - this.transitionStartSeconds) / this.transitionDurationSeconds,
      0,
      1,
    )
    return result.lerpVectors(this.origin, this.target, progress)
  }
}
