// ── Sunlight through the atmosphere ───────────────────────────────────────────
// Shared by atmosphere.frag (limb colour, shadow edge, sunrise band) and
// clouds.frag (cloud tops lit past the terminator), so both use one model:
// SunAppearance.ts on the CPU. The including shader declares the uniforms
// `atmTau` (SUN_TANGENT_TAU) and `atmScaleHeight` and the constant EARTH_R.

// SunAppearance.atmosphereTransmittance.
vec3 transmittance(float h) {
  if (h < 0.0) return vec3(0.0);
  return exp(-atmTau * exp(-h / atmScaleHeight));
}

// Sunlight reaching the air along the view ray. For a ray that misses Earth
// the air is its tangent point; for one that hits, the ground point. `h` is
// that point's height. Returns the height of the sunlight's own grazing path
// above the surface: large and positive on the day side, falling through 0
// at the shadow edge. Continuous across the terminator (both branches give
// `h` where the point's sun dot product is 0).
float sunPathHeight(vec3 point, float h, vec3 sunDir) {
  float along = dot(point, sunDir);
  return along >= 0.0 ? h + along : length(point - along * sunDir) - EARTH_R;
}
