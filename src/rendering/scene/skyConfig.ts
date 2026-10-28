// Sky constants (stars, Milky Way, Moon), kept free of shader imports so the
// unit tests can read them. See SkyLayer.tsx and MoonLayer.tsx.

/**
 * Star brightness (linear radiance at the sprite centre) for V magnitude m:
 * STAR_ZERO_MAG_BRIGHTNESS × 10^(−STAR_MAG_SLOPE × m), capped. A slope of
 * 0.28 instead of the physical 0.4 compresses the 8 magnitudes of the
 * catalogue into what a screen shows while the constellations still stand
 * out; the faint end (m 5–6.5, 0.02–0.05) sits with the random stars this
 * replaced, so the sky keeps its density.
 */
export const STAR_ZERO_MAG_BRIGHTNESS = 1.2
export const STAR_MAG_SLOPE = 0.28
/** Sirius would be 3.1; the cap keeps every star far under the bloom threshold. */
export const STAR_BRIGHTNESS_CAP = 1.3

/** Sprite diameter in CSS px: faint stars, and the extra for the brightest. */
export const STAR_SIZE_MIN_PX = 1.6
export const STAR_SIZE_EXTRA_PX = 3.0
/** Stars brighter than this magnitude start to grow. */
export const STAR_SIZE_GROW_MAG = 3.5
/** …reaching the full extra size this many magnitudes brighter. */
export const STAR_SIZE_GROW_RANGE = 5.0

export function starBrightness(vmag: number): number {
  return Math.min(STAR_BRIGHTNESS_CAP, STAR_ZERO_MAG_BRIGHTNESS * Math.pow(10, -STAR_MAG_SLOPE * vmag))
}

export function starSizePx(vmag: number): number {
  const grow = Math.min(1, Math.max(0, (STAR_SIZE_GROW_MAG - vmag) / STAR_SIZE_GROW_RANGE))
  return STAR_SIZE_MIN_PX + STAR_SIZE_EXTRA_PX * grow
}

/** The Milky Way panorama's weight over black (the old sphere's opacity). */
export const MILKY_WAY_OPACITY = 0.48

/** Mean lunar radius, km. */
export const MOON_RADIUS_KM = 1737.4
/**
 * Where the Moon is drawn, km from the camera: along its true direction from
 * the camera, scaled so its apparent size is exact. Nearer than the sun
 * billboard (270,000 km) so the Moon covers the sun in a solar eclipse, and
 * farther than anything the camera can reach (100,000 km).
 */
export const MOON_DRAW_DISTANCE_KM = 240_000
/** Sunlit lunar radiance for a white texel, head-on (the albedo map is ~0.1–0.35). */
export const MOON_SUN_GAIN = 2.0
/** Hard ceiling on the Moon's radiance: under the bloom threshold. */
export const MOON_RADIANCE_CAP = 2.0
/** Earthshine on the night side, as a fraction of full sunlight. */
export const MOON_EARTHSHINE = 0.012
