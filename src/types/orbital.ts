// ─── Simulation Time ─────────────────────────────────────────────────────────
/**
 * The canonical time value used by all simulation systems.
 * Never read Date.now() directly — always use SimulationClock.now().
 */
export interface SimulationTime {
  /** Milliseconds since Unix epoch (float64 — JS number gives full precision) */
  epochMs: number;
  /** Julian date for orbital mechanics libraries */
  julianDate: number;
  /** Greenwich Mean Sidereal Time in radians — used for ECI→ECEF conversion and Earth rotation */
  gmst: number;
  /** Wall-clock frame delta in milliseconds */
  deltaMs: number;
  /** Simulation-adjusted delta = deltaMs * timeScale */
  simDeltaMs: number;
}

// ─── TLE Data ────────────────────────────────────────────────────────────────
export interface TLEData {
  line1: string;
  line2: string;
  /** When the TLE was fetched from a remote source */
  fetchedAt: number; // epochMs
  /** Source identifier */
  source: 'celestrak' | 'cached' | 'fallback';
}

// ─── Orbital State ───────────────────────────────────────────────────────────
/**
 * Fully-derived orbital state for a single entity at a given simulation time.
 * Pure data — no Three.js imports. Produced by OrbitalEngine.
 */
export interface OrbitalState {
  entityId: string;
  timestamp: number; // epochMs

  // ── ECI position/velocity (km, km/s) ──────────────────────────────────────
  /** TEME/ECI position in kilometers */
  positionECI: { x: number; y: number; z: number };
  /** TEME/ECI velocity in km/s */
  velocityECI: { x: number; y: number; z: number };

  // ── Geodetic (WGS84) ──────────────────────────────────────────────────────
  latitude: number;   // degrees, -90 to +90
  longitude: number;  // degrees, -180 to +180
  altitude: number;   // km above WGS84 ellipsoid

  // ── Derived telemetry ─────────────────────────────────────────────────────
  speed: number;          // km/s
  orbitalPeriod: number;  // minutes
  inclination: number;    // degrees

  // ── Data quality ─────────────────────────────────────────────────────────
  source: 'live' | 'cached' | 'propagated';
  /** Hours since TLE epoch — accuracy degrades with age */
  tleAgeHours: number;
  /** 0–1 confidence score based on TLE age */
  confidence: number;
}

// ─── Telemetry Mode ──────────────────────────────────────────────────────────
export type TelemetryMode = 'LIVE' | 'HYBRID' | 'OFFLINE' | 'RECOVERY';

// ─── Network Status ──────────────────────────────────────────────────────────
export interface NetworkStatus {
  online: boolean;
  lastSuccessfulFetch: number | null; // epochMs
  consecutiveFailures: number;
}

// ─── Orbital Entity ──────────────────────────────────────────────────────────
export interface OrbitalEntityConfig {
  id: string;
  name: string;
  noradId: number;
  /** Display color for orbit line (hex) */
  orbitColor: string;
}
