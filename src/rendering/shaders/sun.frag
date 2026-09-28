precision highp float;
varying vec2 vUv;

// ─── The Sun ──────────────────────────────────────────────────────────────────
// One radial function, three nested elements:
//
//   photosphere  ~0.66 deg across (the real disc is 0.53 deg; slightly
//                oversized for presence) with mild limb darkening inside and a
//                short shoulder at the limb — never a cut-out white sticker.
//   glare        the near-limb glow that keeps the disc from reading as a
//                pasted-on circle: it carries ~0.95 of radiance right at the
//                limb, so the total falls only 1.7x across the limb (2.30 ->
//                1.33) instead of cliffing into the tail.
//   haze         a wide, faint amber tail on a power law, out to ~3-4 deg. This
//                is the "vast soft presence"; it fades to nothing well inside
//                the billboard.
//
// WHY THE ENTIRE SUN STAYS BELOW THE BLOOM THRESHOLD
// UnrealBloom resolves its coarsest mip at 1/16 of the frame. A compact HDR
// disc ~15 px across is barely one texel there, so the pass reconstructs it as
// a rounded SQUARE. Measured with bloom ON: an axis/diagonal sector asymmetry
// of 0.43 extending to r ~ 140 px. With bloom OFF: a clean 1.00 (round). The
// sun is kept out of that path and carries its own glow here instead — exact,
// radial, and cheap (still one additive quad). Peak radiance below (2.37) is
// below BLOOM_THRESHOLD (2.4), and the exposure factor the scene applies while
// any part of the quad is on screen can only lower it: the quad can be visible
// only while the sun is within ~47 deg of the view axis, where the exposure
// term (EnvironmentLayer: 1.05 - 0.30 * alignment^2) is <= 0.91, i.e. <= 2.16.
//
// THE QUAD: theta = d * PLANE_FULL_RAD reaches PLANE_FULL_RAD / 2 = 0.0925 rad
// (5.3 deg) along the UV axes and 0.131 rad (7.5 deg) toward the corners. The
// haze is already below 1/255 by ~4 deg and the safety taper completes at
// d = 0.46 (4.9 deg), so the billboard boundary can never read as an edge.

// Billboard angular width — MUST match targetAngularSize in EnvironmentLayer.tsx.
const float PLANE_FULL_RAD = 0.185;

// Photospheric radius in radians (0.33 deg -> 0.66 deg across).
const float DISC_RAD = 0.00575;

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

void main() {
  vec2 p = vUv - vec2(0.5);
  float d = length(p);
  float theta = d * PLANE_FULL_RAD;      // angular radius, rad
  float s = max(theta - DISC_RAD, 0.0);  // angular distance beyond the limb

  // 1. Photosphere: limb darkening (brighter centre) times a short limb
  //    shoulder, so the edge rolls off instead of cutting.
  float limb = 1.0 - smoothstep(DISC_RAD * 0.80, DISC_RAD * 1.15, theta);
  float darkening = 1.0 - 0.35 * smoothstep(0.0, DISC_RAD * 0.95, theta);
  float photosphere = limb * darkening;

  // 2. Glare: one exponential hugging the limb, e-fold ~0.29 deg. Tight by
  //    design — the near-field must collapse fast or the sun reads as a soft
  //    luminous marble instead of a blinding point source.
  float glare = 0.95 * exp(-s / 0.0050);

  // 3. Haze: a wide, shallow power law. Real stray light falls off near
  //    theta^-2; the +1 keeps it finite at the limb and gives the knee a
  //    continuous slope. Shallow on purpose: this is the "vast soft presence"
  //    — faint (a few LSB) but still legible out to ~4 deg, where the steep
  //    near-field is already long gone.
  float haze = 0.050 / pow(1.0 + s / 0.040, 1.8);

  float luminance = photosphere * 1.30 + glare + haze;

  // 4. Colour by angular distance from the limb — white photosphere, gold just
  //    outside, saturated amber in the haze. Indexed on ANGLE rather than UV so
  //    the hue shift lands where the eye looks, immediately around the disc.
  float c = clamp(s / 0.045, 0.0, 1.0);
  vec3 sunColor = c < 0.4
    ? mix(vec3(1.00, 0.985, 0.955), vec3(1.00, 0.82, 0.50), c / 0.4)
    : mix(vec3(1.00, 0.82, 0.50), vec3(1.00, 0.58, 0.20), (c - 0.4) / 0.6);

  // 5. Safety taper: starts at ~3.4 deg, where the haze is already down to a
  //    few LSB, and is a smooth product — it cannot draw a ring of its own.
  float edgeFade = 1.0 - smoothstep(0.32, 0.46, d);

  vec3 radiance = sunColor * luminance * edgeFade;

  // 6. Sub-LSB dither. The haze is a very low, very smooth gradient and at
  //    8 bits its tail contour-quantises into concentric rings.
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
