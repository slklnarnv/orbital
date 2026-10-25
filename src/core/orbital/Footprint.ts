import type { Vec3 } from '@/utils/math'

/**
 * Half-angle (radians) of the station's visibility footprint: the angular
 * radius, seen from Earth's centre, of the region from which a station at
 * `altitudeKm` is above the horizon — acos(R / (R + h)).
 */
export function footprintHalfAngleRad(earthRadiusKm: number, altitudeKm: number): number {
  return Math.acos(earthRadiusKm / (earthRadiusKm + Math.max(0, altitudeKm)))
}

/**
 * Ring of points (Earth-fixed km, on a sphere of `ringRadiusKm`) bounding the
 * region from which the station is above the horizon: a small circle of
 * half-angle acos(R / (R + h)) around the sub-satellite direction of `ecef`.
 * Writes `segments + 1` points (closed) into `out` (length >= 3·(segments+1)).
 */
export function writeFootprintRing(
  ecef: Vec3,
  earthRadiusKm: number,
  ringRadiusKm: number,
  segments: number,
  out: Float32Array,
): void {
  const norm = Math.hypot(ecef.x, ecef.y, ecef.z)
  if (!(norm > 0)) {
    out.fill(0, 0, 3 * (segments + 1))
    return
  }
  const ux = ecef.x / norm
  const uy = ecef.y / norm
  const uz = ecef.z / norm
  const lambda = footprintHalfAngleRad(earthRadiusKm, norm - earthRadiusKm)

  // e1 = normalize(cross(u, ref)), ref = Z unless u is nearly along Z (then X).
  const useZ = Math.abs(uz) < 0.9
  const rx = useZ ? 0 : 1
  const rz = useZ ? 1 : 0
  let e1x = uy * rz
  let e1y = uz * rx - ux * rz
  let e1z = -uy * rx
  const e1n = Math.hypot(e1x, e1y, e1z)
  e1x /= e1n
  e1y /= e1n
  e1z /= e1n
  // e2 = cross(u, e1)
  const e2x = uy * e1z - uz * e1y
  const e2y = uz * e1x - ux * e1z
  const e2z = ux * e1y - uy * e1x

  const cl = Math.cos(lambda)
  const sl = Math.sin(lambda)
  for (let k = 0; k <= segments; k++) {
    // The closing point reuses theta = 0 exactly so first === last bit for bit.
    const theta = k === segments ? 0 : (2 * Math.PI * k) / segments
    const ct = Math.cos(theta)
    const st = Math.sin(theta)
    const dx = ct * e1x + st * e2x
    const dy = ct * e1y + st * e2y
    const dz = ct * e1z + st * e2z
    const o = 3 * k
    out[o] = ringRadiusKm * (cl * ux + sl * dx)
    out[o + 1] = ringRadiusKm * (cl * uy + sl * dy)
    out[o + 2] = ringRadiusKm * (cl * uz + sl * dz)
  }
}
