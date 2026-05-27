// ─── Math Utilities ───────────────────────────────────────────────────────────
// Pure math helpers — no Three.js imports. Safe for use in core/ layer.

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TWO_PI = Math.PI * 2;

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Smooth-step (cubic) easing */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Ease-in-out cubic */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Ease-out cubic */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Map a value from one range to another */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/** Degrees to radians */
export function degToRad(degrees: number): number {
  return degrees * DEG2RAD;
}

/** Radians to degrees */
export function radToDeg(radians: number): number {
  return radians * RAD2DEG;
}

/** Normalize angle to [0, 2π] */
export function normalizeAngle(rad: number): number {
  return ((rad % TWO_PI) + TWO_PI) % TWO_PI;
}

/** Simple 3D vector type (no Three.js dependency) */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Vector length */
export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** Linear interpolation of Vec3 */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

/** Convert Julian Date to JS Date */
export function julianToDate(jd: number): Date {
  return new Date((jd - 2440587.5) * 86400000);
}

/** Convert JS Date to Julian Date */
export function dateToJulian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}
