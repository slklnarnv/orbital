// ─── Physical Constants ───────────────────────────────────────────────────────

/** Earth mean radius in kilometers (spherical approximation; WGS84 semi-major = 6378.137) */
export const EARTH_RADIUS_KM = 6371.0;

// ─── ISS Constants ────────────────────────────────────────────────────────────

/** NORAD Catalog Number for ISS */
export const ISS_NORAD_ID = 25544;

/** ISS approximate orbital period in minutes */
export const ISS_ORBITAL_PERIOD_MIN = 92.68;

// ─── Rendering Constants ──────────────────────────────────────────────────────

/** Atmosphere shell radius multiplier (relative to Earth radius) */
export const ATMOSPHERE_RADIUS_FACTOR = 1.025;

/** Cloud layer radius multiplier */
export const CLOUD_RADIUS_FACTOR = 1.003;

/** Distance (km from Earth's centre) at which the sun billboard is drawn.
 *  The lens flare aims at this point, not the true direction, so the two
 *  never separate through camera parallax. */
export const SUN_BILLBOARD_DISTANCE_KM = 270_000;

// ─── Time Constants ───────────────────────────────────────────────────────────

/** Julian date of J2000.0 epoch (Jan 1, 2000 12:00:00 TT) */
export const JULIAN_DATE_J2000 = 2451545.0;
/** Julian date of Unix epoch (Jan 1, 1970 00:00:00 UTC) */
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
