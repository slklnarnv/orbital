precision highp float;

uniform sampler2D cloudMap;
uniform vec3 sunDirection;
uniform float opacity;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
  // ── Cloud Density Sampling ───────────────────────────────────────────────────
  // Read raw grayscale cloud density from the 2K density map.
  // The texture is configured as NoColorSpace in CloudLayer.tsx — the GPU delivers
  // linear float values, not gamma-corrected sRGB. This preserves the full
  // continuous tonal range (0.0–1.0) of the density field without crushing midtones.
  float cloudDensity = texture2D(cloudMap, vUv).r;

  // Early discard of fully transparent pixels is NOT used here — it would
  // break hardware MSAA antialiasing along cloud edges. Alpha blending handles
  // the full density gradient continuously.

  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);

  // ── Sunlight Intensity & Terminator ──────────────────────────────────────────
  float sunDot = dot(normal, normalize(sunDirection));

  // Smooth day/night transition — wider band prevents harsh binary flip
  float dayMask = smoothstep(-0.12, 0.12, sunDot);

  // ── Rayleigh Sunset Warming (Terminator Glow) ─────────────────────────────────
  // Restrained twilight golden-orange sliver at terminator boundary
  float sunsetMask = smoothstep(0.15, 0.0, abs(sunDot - 0.02));
  vec3 sunsetGlow = vec3(0.92, 0.44, 0.10) * sunsetMask * 0.35;

  // ── Dayside vs. Nightside Cloud Shading ───────────────────────────────────────
  // Soft diffuse lighting — clouds are lit by sun angle like any diffuse surface.
  // The clamp prevents negative light values (no light from behind the planet).
  float diffuse = clamp(sunDot, 0.0, 1.0);
  float ambient = 0.04; // Tiny earthshine ambient fill on the dark side
  float lightTerm = clamp(diffuse + ambient, 0.0, 1.0);

  // Volumetric Mie forward-scattering (gorgeous silver lining glint when looking towards the Sun)
  float dotVS = dot(viewDir, normalize(sunDirection));
  float forwardScatter = pow(max(dotVS, 0.0), 3.0) * 0.27 * dayMask; // Boosted silver lining for cinematic volumetric pop

  // Dayside clouds: boosted photographic albedo, shaded by solar angle with dynamic silver lining
  vec3 dayColor = (vec3(1.08, 1.09, 1.12) * lightTerm) + (vec3(1.00, 1.00, 1.00) * forwardScatter) + sunsetGlow;

  // Nightside clouds: deep dark silhouette to block city lights beneath
  vec3 nightColor = vec3(0.01, 0.01, 0.02);

  vec3 cloudColor = mix(nightColor, dayColor, dayMask);

  // ── Horizon Fresnel Edge Softness ─────────────────────────────────────────────
  // Attenuate alpha at glancing view angles to prevent the hard spherical shell edge
  // from becoming visible as a disc boundary. This is a view-space effect,
  // not a lighting effect — it softens the spherical geometry edge only.
  float viewDot = dot(normal, viewDir);
  float edgeFade = smoothstep(0.0, 0.22, viewDot);

  // ── Alpha Composition ─────────────────────────────────────────────────────────
  // Nightside clouds block 25% of background city lights, acting as soft dark silhouetted shadows.
  // Dayside clouds are modulated by the opacity uniform (0.32 default = subtle).
  float visibilityFactor = mix(0.25, 1.0, dayMask);
  float alpha = cloudDensity * opacity * visibilityFactor * edgeFade;

  // Clamp alpha to [0, 1] — prevents NaN propagation from degenerate edge cases
  alpha = clamp(alpha, 0.0, 1.0);

  gl_FragColor = vec4(cloudColor, alpha);
}
