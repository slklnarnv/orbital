// ─── Physical Constants ───────────────────────────────────────────────────────

/** Earth mean radius in kilometers (spherical approximation; WGS84 semi-major = 6378.137) */
export const EARTH_RADIUS_KM = 6371.0;

/** Earth's sidereal rotation period in seconds */
export const EARTH_SIDEREAL_DAY_S = 86164.0905;

/** Standard gravitational parameter μ = GM (km³/s²) */
export const EARTH_MU = 398600.4418;

// ─── ISS Constants ────────────────────────────────────────────────────────────

/** NORAD Catalog Number for ISS */
export const ISS_NORAD_ID = 25544;

/** Approximate nominal ISS altitude in km */
export const ISS_NOMINAL_ALTITUDE_KM = 408;

/** ISS approximate orbital period in minutes */
export const ISS_ORBITAL_PERIOD_MIN = 92.68;

// ─── World Scale ─────────────────────────────────────────────────────────────

/**
 * 1 Three.js world unit = 1 kilometer
 * Earth radius ≈ 6371 world units
 * ISS altitude ≈ 6779 world units from Earth center
 * All coordinates within ±8000 units → safe float32 precision
 */
export const WORLD_SCALE = 1.0; // km per world unit

// ─── Rendering Constants ──────────────────────────────────────────────────────

/** Atmosphere shell radius multiplier (relative to Earth radius) */
export const ATMOSPHERE_RADIUS_FACTOR = 1.025;

/** Cloud layer radius multiplier */
export const CLOUD_RADIUS_FACTOR = 1.003;

/** Sun's approximate distance in km (used for directional light positioning) */
export const SUN_DISTANCE_KM = 149_597_870.7;

// ─── Time Constants ───────────────────────────────────────────────────────────

/** Julian date of Unix epoch (Jan 1, 1970 00:00:00 UTC) */
export const JULIAN_DATE_J2000 = 2451545.0;
export const UNIX_EPOCH_JULIAN = 2440587.5;

// ─── TLE Refresh Policy ───────────────────────────────────────────────────────

/** Normal TLE refresh interval in milliseconds (4 hours) */
export const TLE_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** TLE age threshold for "stale" warning in milliseconds (24 hours) */
export const TLE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** TLE max usable age in milliseconds (7 days) */
export const TLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Orbit Prediction ────────────────────────────────────────────────────────

/** Orbit path time step in seconds */
export const ORBIT_PATH_STEP_S = 30;

/** Orbit prediction refresh interval in milliseconds */
export const ORBIT_PATH_REFRESH_MS = 60_000;

// ─── Camera Distance Thresholds (km) ─────────────────────────────────────────

export const CAMERA_THRESHOLDS = {
  /** Below this distance from Earth center: switch to ORBIT_VIEW */
  orbitView: 20_000,
  /** Below this distance from ISS: switch to ISS_APPROACH */
  issApproach: 5_000,
  /** Below this distance from ISS: switch to ISS_FOLLOW */
  issFollow: 500,
  /** Below this distance from ISS: switch to ISS_INSPECTION */
  issInspection: 5,
} as const;
