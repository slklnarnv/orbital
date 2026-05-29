import { CameraMode, ModeRange } from '@/types/camera'

// ─── Canonical Mode Boundaries ────────────────────────────────────────────────
// Distances are expressed in kilometers (Three.js units)
export const CAMERA_ZOOM_RANGES: Record<CameraMode, ModeRange> = {
  PLANETARY: { minDistance: 35000, maxDistance: 100000 },
  ORBITAL: { minDistance: 12000, maxDistance: 35000 },
  APPROACH: { minDistance: 3000, maxDistance: 12000 },
  FOLLOW: { minDistance: 200, maxDistance: 3000 },
  INSPECT: { minDistance: 5, maxDistance: 200 },
  FREE: { minDistance: 5, maxDistance: 100000 }
};

/**
 * Finite State Machine validation matrix for transitions.
 * True indicates the transition is allowed programmatically or interactively.
 */
const VALID_TRANSITIONS: Record<CameraMode, Record<CameraMode, boolean>> = {
  PLANETARY: {
    PLANETARY: true,
    ORBITAL: true,
    APPROACH: true,
    FOLLOW: true,
    INSPECT: false, // Cannot inspect straight from planetary without intermediate steps
    FREE: true
  },
  ORBITAL: {
    PLANETARY: true,
    ORBITAL: true,
    APPROACH: true,
    FOLLOW: true,
    INSPECT: false,
    FREE: true
  },
  APPROACH: {
    PLANETARY: true,
    ORBITAL: true,
    APPROACH: true,
    FOLLOW: true,
    INSPECT: true,
    FREE: true
  },
  FOLLOW: {
    PLANETARY: true,
    ORBITAL: true,
    APPROACH: true,
    FOLLOW: true,
    INSPECT: true,
    FREE: true
  },
  INSPECT: {
    PLANETARY: false, // Must go out through follow/approach first
    ORBITAL: true,
    APPROACH: true,
    FOLLOW: true,
    INSPECT: true,
    FREE: true
  },
  FREE: {
    PLANETARY: true,
    ORBITAL: true,
    APPROACH: true,
    FOLLOW: true,
    INSPECT: true,
    FREE: true
  }
};

export class CameraStateMachine {
  /**
   * Validate whether a transition between two camera modes is allowed.
   */
  public static isValidTransition(from: CameraMode, to: CameraMode): boolean {
    return VALID_TRANSITIONS[from]?.[to] ?? false;
  }

  /**
   * Evaluates the active mode based on camera distance measurements.
   * Uses Earth-relative distances for planetary scale, and ISS-relative distances
   * for local/inspection scales.
   *
   * @param distanceToEarthKm Distance from camera to Earth center (0,0,0)
   * @param distanceToISSKm Distance from camera to ISS world position
   * @param currentMode The current active camera mode
   */
  public static determineModeFromDistance(
    distanceToEarthKm: number,
    distanceToISSKm: number,
    currentMode: CameraMode
  ): CameraMode {
    // If the user has manually engaged FREE mode, do not auto-transition
    if (currentMode === 'FREE') return 'FREE';

    // If camera is focused on Earth center
    if (currentMode === 'PLANETARY' || currentMode === 'ORBITAL') {
      if (distanceToEarthKm >= CAMERA_ZOOM_RANGES.PLANETARY.minDistance) {
        return 'PLANETARY';
      }
      // Remain in ORBITAL even when zoomed close to Earth, avoiding auto-locking onto moving ISS
      return 'ORBITAL';
    }

    // If focused on ISS or in approach/follow states
    if (currentMode === 'APPROACH' || currentMode === 'FOLLOW' || currentMode === 'INSPECT') {
      if (distanceToISSKm < CAMERA_ZOOM_RANGES.INSPECT.maxDistance) {
        return 'INSPECT';
      }
      if (distanceToISSKm < CAMERA_ZOOM_RANGES.FOLLOW.maxDistance) {
        return 'FOLLOW';
      }
      if (distanceToISSKm < CAMERA_ZOOM_RANGES.APPROACH.maxDistance) {
        return 'APPROACH';
      }

      // If we zoomed out past approach limits, drop back to Earth-relative orbital mode
      return 'ORBITAL';
    }

    return currentMode;
  }

  /**
   * Normalizes a distance to a 0-1 scale progress value across the entire mission range.
   * 0 represents furthest zoom-out (planetary limits), 1 represents closest zoom-in (inspect limits).
   */
  public static getZoomProgress(distanceToEarthKm: number, distanceToISSKm: number, currentMode: CameraMode): number {
    const minD = CAMERA_ZOOM_RANGES.INSPECT.minDistance;
    const maxD = CAMERA_ZOOM_RANGES.PLANETARY.maxDistance;

    let activeDistance = distanceToEarthKm;
    if (currentMode === 'FOLLOW' || currentMode === 'INSPECT' || currentMode === 'APPROACH') {
      activeDistance = distanceToISSKm;
    }

    // Logarithmic scale mapping for visual balance across exponential distances
    const logMin = Math.log(minD);
    const logMax = Math.log(maxD);
    const logCurrent = Math.log(Math.max(minD, Math.min(maxD, activeDistance)));

    // Invert so 1.0 is closest (zoom-in) and 0.0 is furthest (zoom-out)
    return 1.0 - (logCurrent - logMin) / (logMax - logMin);
  }
}
