// Sun glare constants and per-frame state, kept free of shader imports so the
// lens flare and the unit tests can read them. See SunGlare.ts for the model.

/** Exposure while the sun is out of view (EnvironmentLayer's adaptation). */
export const DARK_SKY_EXPOSURE = 1.05
/** How far the exposure drops with the visible sun dead ahead. */
export const SUN_EXPOSURE_DROP = 0.30

/** Soft-knee ceiling of the sun billboard (disc + core), linear radiance. */
export const SUN_CORE_KNEE = 2.0
/** Peak linear radiance of the glare overlay (halo + spikes) at full sun. */
export const GLARE_PEAK = 0.35
/** sunGlare.frag's multiplicative dither (±4%) can lift the overlay this much. */
export const GLARE_DITHER_HEADROOM = 1.04

/**
 * The sun's strength this frame, 0..1: the luminance of its apparent flux
 * through the atmosphere times its visibility past foreground objects.
 * EnvironmentLayer writes it at useFrame priority 0; the lens flare reads it
 * in the composer's priority-1 callback, so both see the same frame.
 */
export const sunGlareState = { visibility: 1 }
