// ─── Camera Modes ─────────────────────────────────────────────────────────────
export type CameraMode =
  | 'PLANETARY'  // Earth-focused overview; enters at 35,000 km, exits below 33,000 km
  | 'ORBITAL'    // Earth-focused navigation down to the 6,500 km clearance limit
  | 'APPROACH'   // ISS-focused navigation outside the follow range
  | 'FOLLOW'     // ISS tracking, approximately 200–3,000 km from the station
  | 'INSPECT'    // ISS tracking close-up, with 60 km model clearance
  | 'FREE'       // User-panned pivot; no auto-lock, but Earth collision protection

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
export type CameraTransitionState = {
  fromMode: CameraMode;
  /** Diagnostic wall-clock timestamp when the transition was initiated (Date.now()) */
  startTime: number;
  durationMs: number;
  isCompleted: boolean;
} & (
  | { toMode: 'FOLLOW' }
  | { toMode: 'ORBITAL'; overviewDistanceKm: number }
)

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
