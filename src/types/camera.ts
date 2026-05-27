// ─── Camera Modes ─────────────────────────────────────────────────────────────
export type CameraMode =
  | 'PLANETARY'  // Earth fills ~40% of screen, ISS is a dot on orbit path
  | 'ORBITAL'    // Camera 10,000-20,000 km from Earth center, ISS visible with T-shape
  | 'APPROACH'   // Camera 2,000-5,000 km, alt readout prominent, transitioning to follow
  | 'FOLLOW'     // Camera locked at ISS, tracking its moving position smoothly
  | 'INSPECT'    // Camera 5-50 km, full model detail visible, free orbit around ISS
  | 'FREE'       // Manual control, no automated lock or constraints

// ─── Zoom Level & Categorization ──────────────────────────────────────────────
/** Normalized zoom depth: 0 = furthest (planetary), 1 = closest (inspect) */
export type ZoomLevel = number;

/** Scaffolding for distance ranges corresponding to modes */
export interface ModeRange {
  minDistance: number; // km from Earth center (or ISS center depending on mode)
  maxDistance: number; // km
}

export interface CameraZoomRanges {
  PLANETARY: ModeRange;
  ORBITAL: ModeRange;
  APPROACH: ModeRange;
  FOLLOW: ModeRange;
  INSPECT: ModeRange;
}

// ─── Camera Transition State ──────────────────────────────────────────────────
export interface CameraTransitionState {
  fromMode: CameraMode;
  toMode: CameraMode;
  /** Diagnostic wall-clock timestamp when the transition was initiated (Date.now()) */
  startTime: number;
  durationMs: number;
  isCompleted: boolean;
}

// ─── Floating-Origin Interface Scaffolding ────────────────────────────────────
/**
 * Scaffolding hooks and interfaces for future floating-origin implementations.
 * Real implementation will shift coordinates to ISS local origin in follow/inspect modes.
 */
export interface FloatingOriginManager {
  /** Check if the camera distance warrants a floating-origin origin shift */
  shouldShift(cameraDistanceKm: number): boolean;
  /** Callback triggered when a coordinate shift is required */
  onShiftRequired(originOffset: [number, number, number]): void;
}
