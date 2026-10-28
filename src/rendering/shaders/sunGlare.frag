precision highp float;

// ─── Sun glare: the camera's point-spread function ────────────────────────────
// The sun billboard (sun.frag) draws the disc and the blown-out core around it,
// depth-tested so the Earth and the station cut it. This pass adds what a real
// lens adds on top of everything in the frame: a veiling-glare halo. It is drawn in the scene (not the composer), with
// no depth test, so both pipelines get the identical glare, and it stays far
// below the bloom threshold, so UnrealBloom never sees it (see sun.frag: its
// 1/16 mip turns a compact HDR source into a rounded square).
//
// Every radius here is in NDC-height units (1 = half the frame height, ~22.5°
// at the 45° field of view); vOffset comes from sunGlare.vert.
//
// uColor carries everything that scales the glare: the sun's apparent flux
// through the atmosphere (reddened and fading at the limb), its visibility past
// the station (an occlusion query), the exposure ratio and the peak level —
// GLARE_PEAK in SunGlare.ts, budgeted against the bloom threshold in a test.

uniform vec3 uColor;
uniform float uRadius;

varying vec2 vOffset;

// Halo: a Lorentzian-like core with a moderate tail. HALO_CORE is the
// half-width (~0.6°); the 0.75 slope keeps the veil within ~5° — good optics
// in vacuum, where nothing scatters, leave the black of space dark close to
// the sun. (A 0.55 slope out to ~11° read as a grey-amber fog: 2026-10-28.)
const float HALO_CORE = 0.026;
const float HALO_SLOPE = 0.75;

// No diffraction spikes: six screen-fixed lines read as artificial (owner
// review, 2026-10-28, twice), so the glare is the halo alone.

// Hoskins' hash (see sun.frag for why the usual sin() hash is unusable here).
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float r = length(vOffset);

  float q = r / HALO_CORE;
  float halo = pow(1.0 + q * q, -HALO_SLOPE);

  // The halo is still ~3% of peak at the quad edge (~0.01 linear, near the
  // ACES toe); tapering over the outer half takes it to zero with no edge.
  float taper = 1.0 - smoothstep(0.5 * uRadius, uRadius, r);

  // min(): the profile never exceeds 1, so uColor alone sets the peak level
  // that the bloom budget is checked against.
  float profile = min(1.0, halo) * taper;

  // Neutral: in vacuum nothing reddens the glare (the atmosphere's reddening
  // at the limb is already in uColor). A trace of warmth keeps it from
  // reading clinical.
  vec3 tint = mix(vec3(1.0), vec3(1.0, 0.95, 0.88), smoothstep(0.02, 0.35, r));

  // Multiplicative dither: the halo is a long, very shallow gradient and
  // bands at 8 bits; scaling the noise by the signal keeps it off pure black.
  float dither = 1.0 + (hash21(gl_FragCoord.xy) - 0.5) * 0.08;

  gl_FragColor = vec4(uColor * tint * (profile * dither), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
