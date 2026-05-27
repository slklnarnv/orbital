// ─── Orbit Prediction Line — Fragment Shader ─────────────────────────────────
//
// Renders the orbit prediction arc in ISS orbital track color (#93C5FD).
//
// Alpha attribute encoding (set by OrbitPredictor):
//   0.0 → oldest past point   (start of trailing history)
//   0.5 → current ISS position (center of ±1 half-period arc)
//   1.0 → furthest future point (leading prediction)
//
// Piecewise opacity curve:
//   Past trail  (alpha 0.0 → 0.5): linear ramp 0% → 35%
//     → Provides a visible historical trail without visual noise.
//   Future arc  (alpha 0.5 → 1.0): held constant at 65%
//     → Always readable ahead of the ISS.
//   Smooth crossover at alpha 0.45–0.55 prevents a hard visual step.
//
// IMPORTANT: This ensures the orbit line is visible AT the ISS position
// (alpha=0.5 → 35–65% opacity), preventing the "detached floating arc"
// artifact caused by the previous cubic curve (0.5³ × 0.72 = 9% opacity).

uniform vec3 orbitColor;

varying float vAlpha;

void main() {
  // Past trail: linear ramp from 0.0 (invisible) to 0.35 (dim)
  float pastAlpha   = (vAlpha / 0.5) * 0.35;

  // Future arc: constant readable opacity
  float futureAlpha = 0.65;

  // Smooth step blends the two across the ISS current position band
  float a = mix(pastAlpha, futureAlpha, smoothstep(0.45, 0.55, vAlpha));

  gl_FragColor = vec4(orbitColor, a);
}
