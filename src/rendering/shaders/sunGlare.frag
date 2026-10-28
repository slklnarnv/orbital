precision highp float;

// ─── Sun glare: the camera's point-spread function ────────────────────────────
// The sun billboard (sun.frag) draws the disc and the blown-out core around it,
// depth-tested so the Earth and the station cut it. This pass adds what a real
// lens adds on top of everything in the frame: a wide veiling-glare halo and
// faint diffraction spikes. It is drawn in the scene (not the composer), with
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
uniform float uPixel; // NDC-height units per drawing-buffer pixel

varying vec2 vOffset;

// Halo: a Lorentzian-like core with a shallow tail. HALO_CORE is the half-width
// (~0.9°); the 0.55 slope keeps a visible veil out to ~0.5 (~11°), where real
// stray light still lifts the black of space around the sun.
const float HALO_CORE = 0.04;
const float HALO_SLOPE = 0.55;

// Six-blade aperture: three lines through the centre, 60° apart, give six
// spikes. Fixed to the screen (the aperture does not turn with the view),
// tilted off the vertical so they do not line up with the HUD.
const float SPIKE_TILT = 0.2618; // 15°
const float SPIKE_GAIN = 0.2;
const float SPIKE_FALLOFF = 0.05;

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

  // Each spike is a Gaussian line ~1.3 px wide near the sun, widening a little
  // outward, with a 1/r falloff along its length.
  float spikes = 0.0;
  for (int i = 0; i < 3; i++) {
    float a = SPIKE_TILT + float(i) * 1.0471976;
    float across = dot(vOffset, vec2(-sin(a), cos(a)));
    float w = uPixel * (1.3 + 6.0 * r);
    spikes += exp(-(across * across) / (w * w));
  }
  spikes *= SPIKE_GAIN * SPIKE_FALLOFF / (SPIKE_FALLOFF + r);

  // The halo is still ~3% of peak at the quad edge (~0.01 linear, near the
  // ACES toe); tapering over the outer half takes it to zero with no edge.
  float taper = 1.0 - smoothstep(0.5 * uRadius, uRadius, r);

  // min(): the profile never exceeds 1, so uColor alone sets the peak level
  // that the bloom budget is checked against.
  float profile = min(1.0, halo + spikes) * taper;

  // White near the sun, warming outward like the old amber haze.
  vec3 tint = mix(vec3(1.0), vec3(1.0, 0.80, 0.55), smoothstep(0.02, 0.35, r));

  // Multiplicative dither: the halo is a long, very shallow gradient and
  // bands at 8 bits; scaling the noise by the signal keeps it off pure black.
  float dither = 1.0 + (hash21(gl_FragCoord.xy) - 0.5) * 0.08;

  gl_FragColor = vec4(uColor * tint * (profile * dither), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
