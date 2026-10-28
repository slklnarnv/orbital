// ─── Bloom calibration ────────────────────────────────────────────────────────
// Threshold sits well above the atmosphere limb and the ISS PBR highlights
// (a low threshold made the limb smear into cloudy circles at planetary
// zoom) while city-light cores still bloom. The sun deliberately stays under
// it (sun.frag, SunGlare.ts). All tuning constants live here.
export const BLOOM_STRENGTH = 0.26
export const BLOOM_RADIUS = 0.4
export const BLOOM_THRESHOLD = 2.4
