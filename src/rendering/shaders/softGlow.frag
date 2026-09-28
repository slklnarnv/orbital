precision highp float;

uniform vec3 uColor;
uniform float uOpacity;

varying vec2 vUv;

// ISS glint — the station's tracking marker, and nothing else. No brackets, no
// ring, no centre dot: those were removed by request after reading as a generic
// sci-fi crosshair rather than an instrument.
//
// Two terms do the work: a tight white-hot core that marks the exact point, and
// the soft halo around it that stays findable at planetary range. The core is
// tinted toward cool white rather than to uColor, so the point still reads as a
// point against the blue halo.
void main() {
  vec2 p = vUv - vec2(0.5);
  float d = length(p) * 2.0; // 0 at centre → 1 at the quad edge

  // Core: half-max at d ≈ 0.15, i.e. an ~7% -wide hot spot.
  float core = exp(-d * d * 30.0);
  // Halo: half-max at d ≈ 0.47 — the glint's spread.
  float halo = exp(-d * d * 3.2) * 0.45;

  // Guard the quad boundary — the falloff must reach zero before the edge.
  float edgeFade = 1.0 - smoothstep(0.78, 1.0, d);

  float luminance = core * 1.6 + halo;
  vec3 tint = mix(uColor, vec3(0.90, 0.95, 1.0), core * 0.9);

  // Opacity is folded into the colour with alpha pinned to 1: the material is
  // AdditiveBlending whose source factor is SrcAlpha, so `rgb * alpha` is what
  // gets added either way — but the two pipelines tone-map at different points
  // (OutputPass on the linear sum with the composer on, per-material with it
  // off). Carrying the scale in alpha would tone-map before it in one path and
  // after it in the other. See the same note in sun.frag.
  gl_FragColor = vec4(tint * (luminance * uOpacity * edgeFade), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
