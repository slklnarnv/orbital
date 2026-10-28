import type { Vec3 } from '@/utils/math'
import { EARTH_RADIUS_KM } from '@/utils/constants'

/**
 * How the sun looks from a point above the Earth: how much of its disc clears
 * the limb and how much of its light the atmosphere lets through on the way.
 *
 * The geometry is the rendered one (spherical Earth of EARTH_RADIUS_KM) so the
 * numbers agree with what the depth buffer cuts. The GLSL in `sun.frag` and
 * `atmosphere.frag` evaluates the same transmittance per pixel; the uniforms
 * they receive come from the constants below, so there is one source.
 */

/**
 * Optical depth, per RGB channel, of a ray grazing the surface (tangent
 * height 0): Rayleigh's vertical depth (~0.05 / 0.10 / 0.24 at 650 / 550 /
 * 450 nm) times the ~70x Chapman air mass of a tangent path, rounded up a
 * little for aerosol. It falls with tangent height on the density scale
 * height below, which reproduces what the ISS crews photograph at sunrise: a
 * deep red sun at ~10 km, orange at ~20 km, nearly white by ~35 km.
 */
export const SUN_TANGENT_TAU: Readonly<[number, number, number]> = [4.0, 8.0, 16.0]

/** Density scale height of the lower atmosphere, km. */
export const ATMOSPHERE_SCALE_HEIGHT_KM = 8.0

/**
 * Angular radius of the RENDERED photosphere (rad). The real disc is 0.267°;
 * the billboard draws it at 0.33° for presence (see `sun.frag`). Occlusion
 * must use the drawn size so the glare fades exactly as the disc is covered.
 */
export const SUN_DISC_RADIUS_RAD = 0.00575

export interface Rgb { r: number; g: number; b: number }

/**
 * Tangent height (km) of the ray from `origin` along the unit vector `dir`:
 * its closest approach to Earth's centre, minus the radius. Negative means the
 * ray hits the planet. When the closest approach lies behind the origin the
 * ray only climbs, so the origin's own altitude is returned.
 */
export function tangentHeightKm(origin: Vec3, dir: Vec3): number {
  const t = -(origin.x * dir.x + origin.y * dir.y + origin.z * dir.z)
  if (t <= 0) {
    return Math.sqrt(origin.x * origin.x + origin.y * origin.y + origin.z * origin.z) - EARTH_RADIUS_KM
  }
  const x = origin.x + dir.x * t
  const y = origin.y + dir.y * t
  const z = origin.z + dir.z * t
  return Math.sqrt(x * x + y * y + z * z) - EARTH_RADIUS_KM
}

/**
 * Transmittance of sunlight along a ray with tangent height `hKm`: 0 when the
 * ray hits the Earth, exp(-tau * exp(-h / H)) per channel otherwise.
 */
export function atmosphereTransmittance(hKm: number, out: Rgb): Rgb {
  if (hKm < 0) {
    out.r = 0
    out.g = 0
    out.b = 0
    return out
  }
  const density = Math.exp(-hKm / ATMOSPHERE_SCALE_HEIGHT_KM)
  out.r = Math.exp(-SUN_TANGENT_TAU[0] * density)
  out.g = Math.exp(-SUN_TANGENT_TAU[1] * density)
  out.b = Math.exp(-SUN_TANGENT_TAU[2] * density)
  return out
}

/** Rows sampled across the disc; the result changes by < 0.5% beyond this. */
const FLUX_ROWS = 24
const _t: Rgb = { r: 0, g: 0, b: 0 }
const _dir = { x: 0, y: 0, z: 0 }

/**
 * Light reaching `camera` from a sun disc of angular radius `discRadiusRad`
 * centred on the point `sunPoint` (the billboard, not the direction at
 * infinity: that is what the screen shows and what Earth's depth cuts), as a
 * fraction of the unobstructed sun per channel.
 *
 * The disc is integrated in rows parallel to the local limb, each weighted by
 * its chord length: a row below the limb contributes nothing, a row grazing
 * the atmosphere contributes its reddened transmittance. So the value falls
 * smoothly from 1 (sun clear of the atmosphere) to 0 (disc behind the planet)
 * and turns red on the way — the gradual occlusion fade.
 */
export function apparentSunFlux(camera: Vec3, sunPoint: Vec3, discRadiusRad: number, out: Rgb): Rgb {
  let dx = sunPoint.x - camera.x
  let dy = sunPoint.y - camera.y
  let dz = sunPoint.z - camera.z
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz)
  dx /= dl; dy /= dl; dz /= dl

  // "Down" in the image plane: toward Earth's centre, orthogonal to the view.
  const along = -(camera.x * dx + camera.y * dy + camera.z * dz)
  let nx = -camera.x - along * dx
  let ny = -camera.y - along * dy
  let nz = -camera.z - along * dz
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz)
  if (nl < 1e-9) {
    // Looking straight at (or away from) Earth's centre: the disc is either
    // entirely behind the planet or entirely clear of it.
    atmosphereTransmittance(tangentHeightKm(camera, { x: dx, y: dy, z: dz }), out)
    return out
  }
  nx /= nl; ny /= nl; nz /= nl

  let r = 0
  let g = 0
  let b = 0
  let weight = 0
  for (let i = 0; i < FLUX_ROWS; i++) {
    const v = ((i + 0.5) / FLUX_ROWS) * 2 - 1 // -1..1 across the disc
    const chord = Math.sqrt(1 - v * v)
    const off = Math.tan(v * discRadiusRad)
    _dir.x = dx + nx * off
    _dir.y = dy + ny * off
    _dir.z = dz + nz * off
    const l = Math.sqrt(_dir.x * _dir.x + _dir.y * _dir.y + _dir.z * _dir.z)
    _dir.x /= l; _dir.y /= l; _dir.z /= l
    atmosphereTransmittance(tangentHeightKm(camera, _dir), _t)
    r += _t.r * chord
    g += _t.g * chord
    b += _t.b * chord
    weight += chord
  }
  out.r = r / weight
  out.g = g / weight
  out.b = b / weight
  return out
}

/**
 * Elevation (rad) of `sunPoint` above Earth's limb as seen from `camera`:
 * positive above the limb, negative behind the planet.
 */
export function sunElevationAboveLimb(camera: Vec3, sunPoint: Vec3): number {
  const cr = Math.sqrt(camera.x * camera.x + camera.y * camera.y + camera.z * camera.z)
  if (cr <= EARTH_RADIUS_KM) return -Math.PI / 2
  const dx = sunPoint.x - camera.x
  const dy = sunPoint.y - camera.y
  const dz = sunPoint.z - camera.z
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const cosNadir = -(camera.x * dx + camera.y * dy + camera.z * dz) / (cr * dl)
  const fromNadir = Math.acos(Math.max(-1, Math.min(1, cosNadir)))
  return fromNadir - Math.asin(EARTH_RADIUS_KM / cr)
}
