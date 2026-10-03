// ─── Camera Modes ─────────────────────────────────────────────────────────────
export type CameraMode =
  | 'PLANETARY'  // Earth-focused overview; enters at 35,000 km, exits below 33,000 km
  | 'ORBITAL'    // Earth-focused navigation down to the 6,500 km clearance limit
  | 'APPROACH'   // ISS-focused navigation outside the follow range
  | 'FOLLOW'     // ISS tracking, approximately 200–3,000 km from the station
  | 'INSPECT'    // ISS tracking close-up, with 70 km model-clearance envelope
  | 'FREE'       // User-panned pivot; no auto-lock, but Earth collision protection

// ─── Mode Distance Ranges ─────────────────────────────────────────────────────
export interface ModeRange {
  minDistance: number; // km from Earth center (or ISS center depending on mode)
  maxDistance: number; // km
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
