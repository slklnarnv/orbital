// Orbit-line dash mask, spliced into three's LineMaterial fragment shader by
// OrbitLine.tsx (which documents the attribute plumbing).
//
// `phase` is the station's orbital phase in revolutions (OrbitPhase.ts), so
// the pattern is anchored to the orbit by construction. Its pitch is kept
// near ORBIT_DASH_PITCH_PX on screen with derivatives: the number of dashes
// per revolution is a power of two chosen per fragment from how fast the
// phase moves across the screen, and the two neighbouring powers are
// crossfaded so a change of level never pops. Each level is a fixed
// subdivision of the orbit, so changing distance or rate fades dashes in and
// out but never slides them.

/** Target dash + gap pitch in CSS pixels (the old 7 px dash + 6 px gap). */
const float ORBIT_DASH_PITCH_PX = 13.0;
/** Dash share of one pitch. */
const float ORBIT_DASH_DUTY = 7.0 / 13.0;
/**
 * Finest level: 2^17 dashes per revolution (~0.33 km). Past it the float32
 * phase stops resolving a dash, so a camera closer than that gets longer
 * dashes rather than noise.
 */
const float ORBIT_DASH_MAX_LEVEL = 17.0;

float orbitDashAt(float phase, float level) {
  return step(fract(phase * exp2(level)), ORBIT_DASH_DUTY);
}

/**
 * 1 inside a dash, 0 in a gap, fractional while two levels crossfade.
 * `phasePerPx` is revolutions per CSS pixel along the line.
 */
float orbitDashMask(float phase, float phasePerPx) {
  float level = clamp(
    -log2(max(phasePerPx, 1e-12) * ORBIT_DASH_PITCH_PX),
    0.0,
    ORBIT_DASH_MAX_LEVEL
  );
  float coarse = floor(level);
  float fine = min(coarse + 1.0, ORBIT_DASH_MAX_LEVEL);
  return mix(
    orbitDashAt(phase, coarse),
    orbitDashAt(phase, fine),
    smoothstep(0.25, 0.75, level - coarse)
  );
}
