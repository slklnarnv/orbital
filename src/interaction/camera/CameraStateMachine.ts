import type { PerspectiveCamera } from 'three'
import { CameraMode, ModeRange } from '@/types/camera'
import { EARTH_RADIUS_KM } from '@/utils/constants'

// ─── Canonical Mode Boundaries ────────────────────────────────────────────────
// Distances are expressed in kilometers (Three.js units)
export const CAMERA_ZOOM_RANGES: Record<CameraMode, ModeRange> = {
  PLANETARY: { minDistance: 35000, maxDistance: 100000 },
  ORBITAL:   { minDistance: 6500,  maxDistance: 35000 },
  APPROACH:  { minDistance: 3000,  maxDistance: 12000 },
  FOLLOW:    { minDistance: 200,   maxDistance: 3000 },
  INSPECT:   { minDistance: 60,    maxDistance: 200 },
  FREE:      { minDistance: 5,     maxDistance: 100000 }
};

// ─── CAM-3: Hysteresis Bands ──────────────────────────────────────────────────
// Separate entry/exit thresholds prevent mode chatter near boundaries.
// Rule: enter a mode when distance drops below the ENTER threshold; exit only
// when it rises above the EXIT threshold (EXIT > ENTER for each boundary).
const INSPECT_ENTER_KM  = 200    // Enter INSPECT below 200 km
const INSPECT_EXIT_KM   = 220    // Exit INSPECT above 220 km
const FOLLOW_ENTER_KM   = 3000   // Enter FOLLOW below 3,000 km
const FOLLOW_EXIT_KM    = 3300   // Exit FOLLOW above 3,300 km
const APPROACH_ENTER_KM = 12000  // Enter APPROACH below 12,000 km
const APPROACH_EXIT_KM  = 13000  // Exit APPROACH above 13,000 km
const PLANETARY_EXIT_KM = 33000

// ─── FREE Zoom-Out Release ────────────────────────────────────────────────────
// A detached pan is manual navigation, but zooming well out of it must hand the
// camera back to Earth navigation instead of trapping it in Free. The floor
// matches INSPECT's own exit band, so escaping a close inspect pan takes about
// the same gesture as leaving INSPECT would (~1.5× at a 150 km orbit). The
// entry ratio keeps wide orbital/overview pans from releasing on a single
// damped scroll step.
const FREE_ZOOM_OUT_FLOOR_KM = INSPECT_EXIT_KM
const FREE_ZOOM_OUT_RATIO = 1.25

export class CameraStateMachine {
  /**
   * Evaluates the active mode based on camera distance measurements.
   * Uses Earth-relative distances for planetary scale, and ISS-relative distances
   * for local/inspection scales.
   *
   * CAM-3: Uses hysteresis entry/exit bands per boundary to prevent mode chatter
   * near transition thresholds from jitter in camera-controls distance measurements.
   *
   * @param distanceToEarthKm Distance from camera to Earth center (0,0,0)
   * @param distanceToISSKm Distance from camera to ISS world position
   * @param currentMode The current active camera mode
   */
  public static determineModeFromDistance(
    distanceToEarthKm: number,
    distanceToISSKm: number,
    currentMode: CameraMode,
    freeZoomOut = false,
  ): CameraMode {
    // A pan stays manual locally, but zooming back out leaves the detached
    // inspection pivot instead of trapping navigation in Free forever.
    if (currentMode === 'FREE') {
      if (!freeZoomOut) return 'FREE'
      return distanceToEarthKm >= CAMERA_ZOOM_RANGES.PLANETARY.minDistance ? 'PLANETARY' : 'ORBITAL'
    }

    // If camera is focused on Earth center
    if (currentMode === 'PLANETARY' || currentMode === 'ORBITAL') {
      const threshold = currentMode === 'PLANETARY' ? PLANETARY_EXIT_KM : CAMERA_ZOOM_RANGES.PLANETARY.minDistance
      if (distanceToEarthKm >= threshold) {
        return 'PLANETARY';
      }
      // Remain in ORBITAL even when zoomed close to Earth, avoiding auto-locking onto moving ISS
      return 'ORBITAL';
    }

    // If focused on ISS or in approach/follow/inspect states
    // CAM-3: Each boundary uses a separate enter/exit threshold pair (hysteresis).
    if (currentMode === 'APPROACH' || currentMode === 'FOLLOW' || currentMode === 'INSPECT') {
      const inspectExit   = currentMode === 'INSPECT'   ? INSPECT_EXIT_KM   : INSPECT_ENTER_KM
      const followExit    = currentMode === 'FOLLOW'    ? FOLLOW_EXIT_KM    : FOLLOW_ENTER_KM
      const approachExit  = currentMode === 'APPROACH'  ? APPROACH_EXIT_KM  : APPROACH_ENTER_KM

      if (distanceToISSKm < inspectExit) {
        return 'INSPECT';
      }
      if (distanceToISSKm < followExit) {
        return 'FOLLOW';
      }
      if (distanceToISSKm < approachExit) {
        return 'APPROACH';
      }

      // If we zoomed out past approach limits, drop back to Earth-relative orbital mode
      return 'ORBITAL';
    }

    return currentMode;
  }

  /**
   * Decides whether an outward zoom in FREE has become a deliberate escape from
   * the detached pivot, based on the pivot distance when the pan began.
   *
   * The floor releases close inspect pans (entry ≈ 60–220 km) after a short
   * zoom-out instead of demanding a 3,300 km pivot distance; the ratio keeps
   * pans that began at orbital or overview scale from releasing on damped
   * scroll noise.
   */
  public static isFreeZoomOut(pivotDistanceKm: number, entryPivotDistanceKm: number): boolean {
    return pivotDistanceKm >= Math.max(FREE_ZOOM_OUT_FLOOR_KM, entryPivotDistanceKm * FREE_ZOOM_OUT_RATIO)
  }

  /** Zoom depth follows the actual pivot distance, including a freely panned pivot. */
  public static getZoomProgress(distanceToTargetKm: number): number {
    const minD = CAMERA_ZOOM_RANGES.FREE.minDistance
    const maxD = CAMERA_ZOOM_RANGES.PLANETARY.maxDistance
    const distance = Math.max(minD, Math.min(maxD, distanceToTargetKm))
    return 1 - Math.log(distance / minD) / Math.log(maxD / minD)
  }

  /**
   * Overview distance that fits Earth and its orbit in the current viewport,
   * including narrow portrait viewports. Used by the Reset View action.
   */
  public static overviewDistanceForViewport(camera: PerspectiveCamera, maxDistance: number): number {
    return Math.min(maxDistance, Math.max(
      25_000,
      CameraStateMachine.earthFitDistanceForViewport(camera) * 1.15,
    ))
  }

  /**
   * Distance at which Earth itself just fits the viewport with a small margin.
   * Used by the home-view check: the initial 18,000 km overview does not carry
   * the full orbit margin but still fits comfortably, while a desktop home
   * pose resized to portrait does not.
   */
  public static earthFitDistanceForViewport(camera: PerspectiveCamera): number {
    const halfVerticalFov = camera.getEffectiveFOV() * Math.PI / 360
    const halfVisibleFov = Math.atan(Math.tan(halfVerticalFov) * Math.min(camera.aspect, 1))
    return EARTH_RADIUS_KM * 1.05 / Math.sin(halfVisibleFov)
  }
}


