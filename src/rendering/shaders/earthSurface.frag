precision highp float;

uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D specularMap;
uniform sampler2D cloudMap;
uniform vec2 cloudTexelSize;
uniform float cloudRotation;
uniform vec3 sunDirection;    // world-space unit vector toward sun
uniform float nightIntensity; // city lights brightness multiplier

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;

const float TWO_PI = 6.28318530718;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float sunDot = dot(normal, normalize(sunDirection));

  // ── Day / Night Blending ──────────────────────────────────────────────────────
  // Soft terminator transition. The -0.08 to 0.14 range gives a realistic
  // twilight blend width without the terminator being too sharp or too wide.
  float dayMask   = smoothstep(-0.08, 0.14, sunDot);
  // City lights fade in on the dark side starting at sunDot=0.04 (just past terminator).
  float nightMask = 1.0 - smoothstep(-0.12, 0.04, sunDot);

  // Restrained solar-incidence response gives the sphere material depth without
  // double-lighting the baked relief in the Blue Marble albedo.
  float solarIncidence = smoothstep(0.0, 0.90, max(sunDot, 0.0));
  float terrainLight = mix(0.58, 1.0, solarIncidence);

  // Sample the same rotating density field as the visible cloud shell. The
  // relative Y rotation maps to a longitude offset; a five-tap filter prevents
  // hard decal-like shadows and keeps the cloud layer visually separated.
  vec2 cloudUv = vec2(fract(vUv.x - cloudRotation / TWO_PI), vUv.y);
  float cloudShadowDensity = texture2D(cloudMap, cloudUv).r * 0.40;
  cloudShadowDensity += texture2D(cloudMap, cloudUv + vec2(cloudTexelSize.x, 0.0)).r * 0.15;
  cloudShadowDensity += texture2D(cloudMap, cloudUv - vec2(cloudTexelSize.x, 0.0)).r * 0.15;
  cloudShadowDensity += texture2D(cloudMap, cloudUv + vec2(0.0, cloudTexelSize.y)).r * 0.15;
  cloudShadowDensity += texture2D(cloudMap, cloudUv - vec2(0.0, cloudTexelSize.y)).r * 0.15;
  float cloudShadowDay = smoothstep(0.04, 0.40, sunDot);
  float cloudTransmittance = 1.0 - cloudShadowDensity * cloudShadowDay * 0.18;

  vec3 dayColor = texture2D(dayMap, vUv).rgb * terrainLight * cloudTransmittance;

  // ── City Lights — Warm Amber Tint & Photographic Response ────────────────────
  // NASA Black Marble images have a raw white-dominant encoding.
  // Applying a warm amber tint matches photographic city light appearance from orbit.
  // We apply a photographic contrast curve (power 1.5) to crush background sensor noise
  // and emphasize dense urban cores as warm pinpoints.
  vec3 cityTint = vec3(1.0, 0.80, 0.48);
  vec3 rawNight = texture2D(nightMap, vUv).rgb;
  vec3 nightColor = pow(rawNight, vec3(1.5)) * nightIntensity * cityTint;

  // ── Terminator Terrain Warming ────────────────────────────────────────────────
  // A very subtle localized golden-hour warmth at the solar terminator on the lit side.
  // Physical basis: low-angle sunlight passes through thick atmosphere, Rayleigh
  // scattering removes blue, leaving red-orange terrain illumination.
  // Tight sliver: only active close to the terminator on the sun-facing side.
  float sunsetFactor = (1.0 - smoothstep(0.0, 0.12, abs(sunDot - 0.01))) * smoothstep(-0.02, 0.05, sunDot);
  vec3 twilightWarm = vec3(0.85, 0.42, 0.12) * sunsetFactor * 0.07; // Highly restrained, dusty golden warmth

  // ── Ocean Specularity & Sky Fresnel Reflection ────────────────────────────────
  // Read the grayscale specular mask (1.0 for ocean, 0.0 for land)
  float oceanMask = texture2D(specularMap, vUv).r;

  // Reflective vector for specular calculation
  vec3 reflDir = reflect(-normalize(sunDirection), normal);

  // Keep the glint compact. A broad lobe can fill the screen during close ocean
  // views and read as a white rendering fault rather than reflected sunlight.
  float spec = pow(max(dot(reflDir, viewDir), 0.0), 128.0);

  // Physical Fresnel: water is more reflective at glancing angles (refractive index 1.33)
  float dotNV = max(dot(normal, viewDir), 0.0);
  float waterFresnel = pow(1.0 - dotNV, 5.0);

  // Clouds block the reflected solar disc as well as direct terrain light. This
  // prevents a broad white glint from showing through dense weather systems.
  float clearSky = 1.0 - cloudShadowDensity * 0.85;
  vec3 specColor = spec * oceanMask * dayMask * clearSky * vec3(0.88, 0.92, 0.98) * 0.10;

  // Glancing-angle water sky Fresnel reflection: reflects a very subtle, dark navy sky color at the horizon
  vec3 skyGlowReflection = vec3(0.04, 0.16, 0.38) * waterFresnel * oceanMask * dayMask * 0.08;

  // ── Final Composite ───────────────────────────────────────────────────────────
  vec3 finalTerrain = (dayColor + twilightWarm) * dayMask;
  vec3 finalCities  = nightColor * nightMask;
  vec3 color = finalTerrain + finalCities + specColor + skyGlowReflection;

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
