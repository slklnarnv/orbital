precision highp float;

uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D specularMap;
uniform sampler2D cloudMap;
uniform sampler2D cloudMapB;    // a newer live map fading in (liveClouds.ts)
uniform float cloudOffsetB;
uniform float cloudBlend;
uniform vec2 cloudTexelSize;
uniform float cloudRotation;
uniform vec3 sunDirection;    // world-space unit vector toward sun
uniform float nightIntensity; // city lights brightness multiplier

// Streamed close-range albedo (surfaceDetail.glsl): level 5 (~2 km) and
// level 7 (~0.5 km) ring buffers of NASA GIBS tiles.
uniform sampler2D detailMap0;
uniform vec4 detailWindow0;
uniform vec2 detailCenter0;
uniform float detailSlots0[16];
uniform float detailOn0;
uniform sampler2D detailMap1;
uniform vec4 detailWindow1;
uniform vec2 detailCenter1;
uniform float detailSlots1[16];
uniform float detailOn1;
// The same, for the night lights (VIIRS Black Marble).
uniform sampler2D detailNightMap0;
uniform vec4 detailNightWindow0;
uniform vec2 detailNightCenter0;
uniform float detailNightSlots0[16];
uniform float detailNightOn0;
uniform sampler2D detailNightMap1;
uniform vec4 detailNightWindow1;
uniform vec2 detailNightCenter1;
uniform float detailNightSlots1[16];
uniform float detailNightOn1;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vCloudDir;

const float TWO_PI = 6.28318530718;

#include "./cloudDensity.glsl"
#include "./surfaceDetail.glsl"

// ── City lights up close ──────────────────────────────────────────────────────
// The Black Marble map is ~5 km per texel at 8K (~10 km at 4K). From Follow
// distances one texel spans 10–20 pixels, and three things made the lights
// read as glowing blocks: bilinear magnification (texel diamonds), the 4.2x
// gain putting city cores far over the bloom threshold (UnrealBloom turns a
// compact HDR source square), and no structure inside a texel. Up close, so
// the overview is untouched:
//   1. a cubic B-spline replaces bilinear once a texel spans > 1 pixel;
//   2. once a texel spans > 4 pixels, each texel splits into 4x4 cells and a
//      lit area becomes discrete points of light (a stable integer hash per
//      cell), brightness-conserving: brighter texels light more cells. The
//      point radius is set in screen pixels (~0.7 px), so points stay crisp
//      without shrinking to where they would shimmer;
//   3. a soft knee keeps every light under the bloom threshold, the way the
//      sun and the station highlights are kept (highlightKnee.ts).
const float NIGHT_CELLS = 4.0;          // light points per texel edge
const float NIGHT_POINT_PX = 0.7;       // point radius in screen pixels
const float NIGHT_POINT_FLOOR = 0.25;   // share of the light left as soft glow
const float NIGHT_POINT_GAIN_MAX = 24.0; // the knee below sets the real peak
const float NIGHT_KNEE_START = 1.6;
const float NIGHT_KNEE_CEILING = 2.2;   // < BLOOM_THRESHOLD (NightLightsBudget.test.ts)

vec3 sampleNightBicubic(sampler2D map, vec2 uv, vec2 texSize) {
  // Same B-spline as sampleCloudMapBicubic, on all three channels.
  vec2 st = uv * texSize - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / texSize;
  vec2 h1 = (i + 1.5 + w3 / g1) / texSize;
  vec3 t00 = textureLod(map, vec2(h0.x, h0.y), 0.0).rgb;
  vec3 t10 = textureLod(map, vec2(h1.x, h0.y), 0.0).rgb;
  vec3 t01 = textureLod(map, vec2(h0.x, h1.y), 0.0).rgb;
  vec3 t11 = textureLod(map, vec2(h1.x, h1.y), 0.0).rgb;
  return g0.y * (g0.x * t00 + g1.x * t10) + g1.y * (g0.x * t01 + g1.x * t11);
}

// Point-of-light factor at `st` (texel units): mean 1 over a texel, so the
// texel's total light is unchanged. Each cell holds at most one point at a
// fully random spot; the four cells nearest the pixel are summed, which
// covers every point within half a cell (the Gaussian is < 1% beyond).
float cityPoints(vec2 st, float lum, float cellPx) {
  vec2 cs = st * NIGHT_CELLS;
  float r = clamp(NIGHT_POINT_PX / cellPx, 0.08, 0.20);
  float r2 = r * r;
  // Dim texels light more, fainter points rather than a few hot ones; below
  // the Black Marble noise floor (faint blue-violet speckle) none light.
  float occupancy = clamp((sqrt(lum) - 0.12) * 1.5, 0.0, 1.0);
  float mean = max(occupancy * 3.14159265 * r2, 1e-4);
  vec2 base = floor(cs - 0.5);
  float sum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 cell = base + vec2(float(i), float(j));
      vec3 h = vec3(cloudPcg3d(uvec3(uvec2(cell), 911u))) / 4294967295.0;
      vec2 d = cs - (cell + h.xy);
      sum += step(h.z, occupancy) * exp(-dot(d, d) / r2);
    }
  }
  return min(sum / mean, NIGHT_POINT_GAIN_MAX);
}

vec3 nightKnee(vec3 c) {
  float peak = max(max(c.r, c.g), c.b);
  if (peak <= NIGHT_KNEE_START) return c;
  float span = NIGHT_KNEE_CEILING - NIGHT_KNEE_START;
  float kneed = NIGHT_KNEE_START + span * (1.0 - exp(-(peak - NIGHT_KNEE_START) / span));
  return c * (kneed / peak);
}

void main() {
  // Detail footprints first: derivatives are only defined outside branches.
  vec2 detailG0 = detailTileCoord(vUv, detailWindow0.w);
  vec2 detailG1 = detailTileCoord(vUv, detailWindow1.w);
  float detailPpt0 = detailPixelsPerTexel(detailG0, detailWindow0.z);
  float detailPpt1 = detailPixelsPerTexel(detailG1, detailWindow1.z);

  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float sunDot = dot(normal, normalize(sunDirection));

  // ── Day / Night Blending ──────────────────────────────────────────────────────
  // Wide soft twilight: the day fade and the city-light fade overlap across a
  // broad gradient so the terminator reads as dusk, not as a drawn line.
  float dayMask   = smoothstep(-0.10, 0.18, sunDot);
  // City lights fade in on the dark side starting just past the terminator.
  float nightMask = 1.0 - smoothstep(-0.14, 0.02, sunDot);

  // Restrained solar-incidence response gives the sphere material depth without
  // double-lighting the baked relief in the Blue Marble albedo.
  float solarIncidence = smoothstep(0.0, 0.90, max(sunDot, 0.0));
  float terrainLight = mix(0.58, 1.0, solarIncidence);

  // ── Low-Sun Warmth (physical sunset light) ───────────────────────────────────
  // The sunlight itself reddens at grazing incidence: Rayleigh scattering strips
  // blue as the path through the atmosphere lengthens. One smooth window drives
  // a light-color tint instead of a painted stripe — terrain, ocean glint and
  // clouds (which share this exact literal) all warm coherently.
  float lowSun = 1.0 - smoothstep(0.02, 0.35, sunDot);
  vec3 sunWarmth = mix(vec3(1.0), vec3(1.0, 0.52, 0.22), lowSun);

  // Sample the same rotating density field as the visible cloud shell, through
  // the same function (cloudDensity.glsl). The relative Y rotation maps to a
  // longitude offset; RepeatWrapping wraps it, so no fract() seam (a fract
  // jump made the derivatives pick the smallest mip along one meridian). The
  // B-spline reconstruction is itself a soft low-pass, which replaces the old
  // five-tap blur. The shadow takes two detail octaves: it sits under the
  // shell and only dims terrain by up to 18%, so finer octaves do not show.
  vec2 cloudUv = vec2(vUv.x - cloudRotation / TWO_PI, vUv.y);
  float cloudShadowDensity = cloudDensityAt(
    cloudMap, cloudUv, cloudMapB, vec2(cloudUv.x + cloudOffsetB, cloudUv.y), cloudBlend,
    1.0 / cloudTexelSize, normalize(vCloudDir), cameraPosition, 2
  );
  float cloudShadowDay = smoothstep(0.04, 0.40, sunDot);
  float cloudTransmittance = 1.0 - cloudShadowDensity * cloudShadowDay * 0.18;

  vec3 albedo = texture2D(dayMap, vUv).rgb;
  albedo = applyDetailLevel(albedo, detailMap0, detailWindow0, detailCenter0, detailSlots0, detailOn0, detailG0, detailPpt0, DETAIL_DAY_FADE0);
  albedo = applyDetailLevel(albedo, detailMap1, detailWindow1, detailCenter1, detailSlots1, detailOn1, detailG1, detailPpt1, DETAIL_DAY_FADE1);
  vec3 dayColor = albedo * terrainLight * cloudTransmittance * sunWarmth;

  // ── City Lights — Warm Amber Tint & Photographic Response ────────────────────
  // NASA Black Marble images have a raw white-dominant encoding.
  // Applying a warm amber tint matches photographic city light appearance from orbit.
  // We apply a photographic contrast curve (power 1.5) to crush background sensor noise
  // and emphasize dense urban cores as warm pinpoints.
  vec3 cityTint = vec3(1.0, 0.80, 0.48);
  // Texel footprint first: derivatives are only defined outside the branch.
  vec2 nightSize = vec2(textureSize(nightMap, 0));
  vec2 nightSt = vUv * nightSize;
  float pixelsPerTexel = 1.0 / max(max(length(dFdx(nightSt)), length(dFdy(nightSt))), 1e-6);
  float smoothW = smoothstep(1.0, 2.0, pixelsPerTexel);
  float pointsW = smoothstep(4.0, 8.0, pixelsPerTexel);
  vec3 nightColor = vec3(0.0);
  if (nightMask > 0.0) {
    vec3 rawNight = texture2D(nightMap, vUv).rgb;
    if (smoothW > 0.0) rawNight = mix(rawNight, sampleNightBicubic(nightMap, vUv, nightSize), smoothW);
    // NASA's own lights up close (the same Black Marble product, ~2 km then
    // ~0.5 km per pixel), reconstructed like the base map so their pixels
    // never show as squares.
    vec2 nightSt0;
    vec2 nightSt1;
    float nightDetail0 = detailLevelWeight(detailNightWindow0, detailNightCenter0, detailNightSlots0, detailNightOn0, detailG0, detailPpt0, DETAIL_NIGHT_FADE, 0.0, nightSt0);
    float nightDetail1 = detailLevelWeight(detailNightWindow1, detailNightCenter1, detailNightSlots1, detailNightOn1, detailG1, detailPpt1, DETAIL_NIGHT_FADE, 0.0, nightSt1);
    if (nightDetail0 > 0.0) rawNight = mix(rawNight, sampleDetailBicubic(detailNightMap0, nightSt0), nightDetail0);
    if (nightDetail1 > 0.0) rawNight = mix(rawNight, sampleDetailBicubic(detailNightMap1, nightSt1), nightDetail1);
    vec3 lights = pow(rawNight, vec3(1.5));
    // Points of light: inside the base map's texels, and inside NASA's finest
    // texels where those show, so real towns break into points the same way.
    float basePointsW = pointsW * (1.0 - nightDetail1);
    float detailPointsW = smoothstep(4.0, 8.0, detailPpt1) * nightDetail1;
    float allPointsW = basePointsW + detailPointsW;
    if (allPointsW > 0.0) {
      float lum = dot(lights, vec3(0.2126, 0.7152, 0.0722));
      float points = 0.0;
      if (basePointsW > 0.0) points += basePointsW * cityPoints(nightSt, lum, pixelsPerTexel / NIGHT_CELLS);
      if (detailPointsW > 0.0) points += detailPointsW * cityPoints(detailG1 * DETAIL_TILE_PX, lum, detailPpt1 / NIGHT_CELLS);
      points /= allPointsW;
      lights *= mix(1.0, NIGHT_POINT_FLOOR + (1.0 - NIGHT_POINT_FLOOR) * points, min(1.0, allPointsW));
    }
    nightColor = lights * nightIntensity * cityTint;
    // Up close only: from the overview the cores keep their bloom glow.
    nightColor = mix(nightColor, nightKnee(nightColor), smoothW);
  }

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
  // The glint is direct sunlight, so it warms with the same low-sun color.
  float clearSky = 1.0 - cloudShadowDensity * 0.85;
  vec3 specColor = spec * oceanMask * dayMask * clearSky * vec3(0.88, 0.92, 0.98) * 0.10 * sunWarmth;

  // Glancing-angle water sky Fresnel reflection: reflects a very subtle, dark navy sky color at the horizon
  vec3 skyGlowReflection = vec3(0.04, 0.16, 0.38) * waterFresnel * oceanMask * dayMask * 0.08;

  // ── Final Composite ───────────────────────────────────────────────────────────
  vec3 finalTerrain = dayColor * dayMask;
  vec3 finalCities  = nightColor * nightMask;
  vec3 color = finalTerrain + finalCities + specColor + skyGlowReflection;

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
