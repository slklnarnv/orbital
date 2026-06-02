import { CameraMode, ModeRange } from '@/types/camera'

// ─── Canonical Mode Boundaries ────────────────────────────────────────────────
// Distances are expressed in kilometers (Three.js units)
export const CAMERA_ZOOM_RANGES: Record<CameraMode, ModeRange> = {
  PLANETARY: { minDistance: 35000, maxDistance: 100000 },
  ORBITAL:   { minDistance: 12000, maxDistance: 35000 },
  APPROACH:  { minDistance: 3000,  maxDistance: 12000 },
  FOLLOW:    { minDistance: 200,   maxDistance: 3000 },
  INSPECT:   { minDistance: 5,     maxDistance: 200 },
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
   * Normalizes a distance to a 0-1 scale progress value across the entire mission range.
   * 0 represents furthest zoom-out (planetary limits), 1 represents closest zoom-in (inspect limits).
   *
   * CAM-5 FIX: Smoothly blends between ISS-relative and Earth-relative bases in the
   * APPROACH zone near the ORBITAL boundary (10,000–13,000 km) to prevent the HUD
   * zoom-progress bar from jumping when the distance basis switches.
   */
  public static getZoomProgress(distanceToEarthKm: number, distanceToISSKm: number, currentMode: CameraMode): number {
    const minD = CAMERA_ZOOM_RANGES.INSPECT.minDistance;
    const maxD = CAMERA_ZOOM_RANGES.PLANETARY.maxDistance;

    let activeDistance = distanceToEarthKm;
    if (currentMode === 'FOLLOW' || currentMode === 'INSPECT' || currentMode === 'APPROACH') {
      activeDistance = distanceToISSKm;

      // CAM-5 FIX: In APPROACH mode near the ORBITAL boundary (10,000–13,000 km), blend
      // smoothly between ISS-relative and Earth-relative bases to prevent a visible
      // jump in the HUD bar when the denominator distance switches at zoom-out.
      if (currentMode === 'APPROACH' && distanceToISSKm > 10000) {
        const blendFactor = Math.min(1, (distanceToISSKm - 10000) / 3000)
        activeDistance = distanceToISSKm * (1 - blendFactor) + distanceToEarthKm * blendFactor
      }
    }

    // Logarithmic scale mapping for visual balance across exponential distances
    const logMin = Math.log(minD);
    const logMax = Math.log(maxD);
    const logCurrent = Math.log(Math.max(minD, Math.min(maxD, activeDistance)));

    // Invert so 1.0 is closest (zoom-in) and 0.0 is furthest (zoom-out)
    return 1.0 - (logCurrent - logMin) / (logMax - logMin);
  }
}


