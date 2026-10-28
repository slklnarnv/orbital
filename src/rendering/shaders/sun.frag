precision highp float;
varying vec2 vUv;
varying vec3 vWorldPosition;

// ─── The Sun ──────────────────────────────────────────────────────────────────
// The disc and the blown-out core of the camera's point-spread function. The
// wide halo is the other half of the PSF, drawn by the screen-space glare
// overlay (sunGlare.frag, SunGlare.ts): unlike this billboard it is a lens
// effect and must not be cut by the depth buffer.
//
//   photosphere  ~0.66 deg across (the real disc is 0.53 deg; slightly
//                oversized for presence), seen through the atmosphere PER
//                PIXEL: each pixel's line of sight has a tangent height, and
//                the transmittance along it (SunAppearance.ts, same constants
//                as uniforms) reddens and dims the part of the disc that sinks
//                into the limb. Bright enough that the knee saturates it.
//   core         the blown-out region: ~2x the disc, white, rolling into a
//                warm shoulder by ~2 deg. Scaled by uGlare, the disc's
//                integrated flux x foreground visibility x exposure ratio, so
//                it fades and reddens as a whole while the disc sets, instead
//                of leaving a glow above the limb after the disc has gone.
//
// Everything passes through one soft knee, uKnee * (1 - exp(-x / uKnee)):
// linear for faint values, saturating smoothly at the ceiling. Inside it the
// exposure ratio (exposure / dark-sky exposure) scales the input, so as the
// camera stops down for the sun the saturated core shrinks, like a camera's.
//
// WHY THE ENTIRE SUN STAYS BELOW THE BLOOM THRESHOLD
// UnrealBloom resolves its coarsest mip at 1/16 of the frame. A compact HDR
// disc ~15 px across is barely one texel there, so the pass reconstructs it as
// a rounded SQUARE. Measured with bloom ON: an axis/diagonal sector asymmetry
// of 0.43 extending to r ~ 140 px. With bloom OFF: a clean 1.00 (round). The
// sun is kept out of that path and carries its own glow instead — exact,
// radial, and cheap. The bloom pass reads the composer's buffer BEFORE
// exposure (OutputPass applies it), so the budget is on raw radiance: the
// knee caps this billboard at uKnee (2.0) and the overlay adds at most its
// peak (0.35 x 1.04 dither), 2.37 < BLOOM_THRESHOLD (2.4) — asserted in
// tests/unit/rendering/SunGlareBudget.test.ts.
//
// THE QUAD: theta = d * PLANE_FULL_RAD reaches PLANE_FULL_RAD / 2 = 0.0925 rad
// (5.3 deg) along the UV axes and 0.131 rad (7.5 deg) toward the corners. The
// core is below 1/255 by ~4 deg and the safety taper completes at d = 0.46
// (4.9 deg), so the billboard boundary can never read as an edge.

// Billboard angular width — MUST match targetAngularSize in EnvironmentLayer.tsx.
const float PLANE_FULL_RAD = 0.185;

uniform float uDiscRad;       // rendered photospheric radius, rad
uniform vec3 uGlare;          // flux (rgb) x foreground visibility x exposure ratio
uniform float uExposureRatio;
uniform float uKnee;
uniform vec3 uTau;            // tangent optical depth at height 0, per channel
uniform float uScaleHeight;   // km
uniform float uEarthRadius;   // km

// Photosphere input level: far into the knee, so the disc is a flat white
// until the atmosphere takes most of its light away.
const float PHOTOSPHERE = 30.0;

// Core: an exponential that keeps the input >= ~5 (i.e. near the ceiling)
// out to ~0.2 deg beyond the limb (a blown-out core ~1.6x the disc), and a
// Lorentzian shoulder that carries the glow to where the overlay's halo takes
// over. (A 2x core with a 0.6 shoulder read as a big soft ball: 2026-10-28.)
const float CORE_GAIN = 14.0;
const float CORE_EFOLD = 0.0030;   // rad (~0.17 deg)
const float SHOULDER_GAIN = 0.32;
const float SHOULDER_WIDTH = 0.006; // rad (~0.34 deg)

// White noise for the dither. The usual `fract(sin(dot(gl_FragCoord, k)) * s)`
// hash is NOT usable here: at screen coordinates of ~5e4 the product exceeds
// fp32's 24-bit mantissa, so the fractional part degenerates into correlated
// bands instead of noise — the posterisation it was meant to hide. Hoskins'
// hash stays well-conditioned because the multiply happens after the fract().
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Tangent height of the ray from o along d (SunAppearance.tangentHeightKm).
float tangentHeight(vec3 o, vec3 d) {
  float t = -dot(o, d);
  vec3 closest = t > 0.0 ? o + d * t : o;
  return length(closest) - uEarthRadius;
}

// SunAppearance.atmosphereTransmittance.
vec3 transmittance(float h) {
  if (h < 0.0) return vec3(0.0);
  return exp(-uTau * exp(-h / uScaleHeight));
}

void main() {
  vec2 p = vUv - vec2(0.5);
  float d = length(p);
  float theta = d * PLANE_FULL_RAD;      // angular radius, rad
  float s = max(theta - uDiscRad, 0.0);  // angular distance beyond the limb

  // 1. Photosphere: limb darkening (brighter centre) times a short limb
  //    shoulder, so the edge rolls off instead of cutting; then the
  //    atmosphere along this pixel's own line of sight.
  float limb = 1.0 - smoothstep(uDiscRad * 0.80, uDiscRad * 1.15, theta);
  float darkening = 1.0 - 0.35 * smoothstep(0.0, uDiscRad * 0.95, theta);
  vec3 sight = transmittance(tangentHeight(cameraPosition, normalize(vWorldPosition - cameraPosition)));
  vec3 photosphere = vec3(1.00, 0.985, 0.955) * (limb * darkening * PHOTOSPHERE * uExposureRatio) * sight;

  // 2. Core: white at the limb, gold in the shoulder. Indexed on ANGLE so the
  //    hue shift lands where the eye looks, immediately around the disc.
  float core = CORE_GAIN * exp(-s / CORE_EFOLD);
  float w = s / SHOULDER_WIDTH;
  float shoulder = SHOULDER_GAIN / (1.0 + w * w);
  vec3 tint = mix(vec3(1.00, 0.985, 0.955), vec3(1.00, 0.78, 0.45), smoothstep(0.002, 0.02, s));
  vec3 glare = tint * (core + shoulder) * uGlare;

  // 3. Soft knee: the bloom-safe ceiling (see the header).
  vec3 x = photosphere + glare;
  vec3 radiance = uKnee * (vec3(1.0) - exp(-x / uKnee));

  // 4. Safety taper: starts at ~3.4 deg, where the core is down to a few LSB,
  //    and is a smooth product — it cannot draw a ring of its own.
  radiance *= 1.0 - smoothstep(0.32, 0.46, d);

  // 5. Sub-LSB dither against contouring in the shoulder.
  radiance += (hash21(gl_FragCoord.xy) - 0.5) * (1.6 / 255.0);

  // alpha = 1: the material uses AdditiveBlending, whose source factor is
  // SrcAlpha — mirroring the profile into alpha would square the falloff.
  gl_FragColor = vec4(max(radiance, vec3(0.0)), 1.0);

  // Every other surface shader in this project (earthSurface, clouds,
  // atmosphere) ends with these two includes, and the sun must too. Without
  // them the direct pipeline bypassed ACES *and* the sRGB encode: radiance was
  // written raw and clamped at 1.0, so the disc was a flat pasted-on white
  // stamp and the haze rendered as an un-encoded (murky, ~2x dark) gradient.
  // It also made the two pipelines disagree — three disables per-material tone
  // mapping only while rendering into a render target (WebGLPrograms:
  // `currentRenderTarget === null`), so the composer path tone-mapped the sun
  // in OutputPass while the direct path did not tone-map it at all.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
