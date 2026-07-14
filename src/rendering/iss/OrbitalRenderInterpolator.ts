import * as THREE from 'three'

import type { OrbitalState } from '@/types/orbital'

const DEFAULT_SAMPLE_INTERVAL_SECONDS = 0.1
const MAX_SAMPLE_INTERVAL_SECONDS = 0.25

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
 */
export class OrbitalRenderInterpolator {
  private readonly origin = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly current = new THREE.Vector3()
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
      copyWorldPosition(snapshot.positionECI, this.target)
      this.origin.copy(this.target)
      this.lastSnapshot = snapshot
      this.lastSnapshotFrameSeconds = frameTimeSeconds
      this.transitionStartSeconds = frameTimeSeconds
      this.transitionDurationSeconds = 0
      return result.copy(this.target)
    }

    if (snapshot !== this.lastSnapshot) {
      this.sampleTransition(frameTimeSeconds, this.current)

      const observedInterval = frameTimeSeconds - this.lastSnapshotFrameSeconds
      this.origin.copy(this.current)
      copyWorldPosition(snapshot.positionECI, this.target)
      this.transitionStartSeconds = frameTimeSeconds
      this.transitionDurationSeconds = Math.min(
        observedInterval > 0 ? observedInterval : DEFAULT_SAMPLE_INTERVAL_SECONDS,
        MAX_SAMPLE_INTERVAL_SECONDS,
      )
      this.lastSnapshot = snapshot
      this.lastSnapshotFrameSeconds = frameTimeSeconds
    }

    return this.sampleTransition(frameTimeSeconds, result)
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
