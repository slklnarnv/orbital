// ── Shared Cloud Density Field ─────────────────────────────────────────────────
// clouds.frag (the visible shell) and earthSurface.frag (the shadows it casts)
// both read cloud density through this chunk, so the shadows stay aligned with
// the clouds above them at every range — reconstruction and detail included.
//
// The source is one 4096×2048 equirectangular map: ~10 km per texel at the
// equator. From Follow/Inspect distances one texel spans tens of pixels, and
// plain bilinear magnification shows texel diamonds at 800 km and a staircase
// along every diagonal edge at 300 km. Two fixes, both free of new downloads:
//   1. Magnified texels are reconstructed with a cubic B-spline (C2-continuous,
//      so no texel grid survives magnification).
//   2. Close to the deck, a procedural fBm term modulates the density inside
//      each texel. It is zero-mean and multiplicative, so the large-scale field
//      (and its coverage) stays the real one.

const float CLOUD_NOISE_RADIUS_KM = 6371.0;
// Wavelength of the coarsest detail octave; each further octave halves it.
const float CLOUD_DETAIL_BASE_KM = 9.0;
const int CLOUD_DETAIL_MAX_OCTAVES = 4;
// Peak relative density swing at full detail.
const float CLOUD_DETAIL_STRENGTH = 0.75;

// Texels per screen pixel for a map of `texSize` sampled at `uv`.
float cloudTexelFootprint(vec2 uv, vec2 texSize) {
  vec2 st = uv * texSize;
  return max(length(dFdx(st)), length(dFdy(st)));
}

// Cubic B-spline in four bilinear taps (Sigg & Hadwiger, GPU Gems 2 ch. 20).
// Level 0 only: callers use it when the map is magnified, where the mip chain
// would select level 0 anyway. textureLod keeps it legal inside the
// non-uniform branch that skips it when minified.
float sampleCloudMapBicubic(sampler2D map, vec2 uv, vec2 texSize) {
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
  // Bilinear tap positions between texel pairs (i-1, i) and (i+1, i+2), at
  // texel centres (+0.5), converted back to UV.
  vec2 h0 = (i - 0.5 + w1 / g0) / texSize;
  vec2 h1 = (i + 1.5 + w3 / g1) / texSize;
  float t00 = textureLod(map, vec2(h0.x, h0.y), 0.0).r;
  float t10 = textureLod(map, vec2(h1.x, h0.y), 0.0).r;
  float t01 = textureLod(map, vec2(h0.x, h1.y), 0.0).r;
  float t11 = textureLod(map, vec2(h1.x, h1.y), 0.0).r;
  return g0.y * (g0.x * t00 + g1.x * t10) + g1.y * (g0.x * t01 + g1.x * t11);
}

// Map density with the reconstruction chosen by texel footprint: the hardware
// mipmapped/anisotropic tap when minified, the B-spline once one texel spans
// more than one pixel (blended over 1 → 2 pixels per texel, so no seam).
float sampleCloudMap(sampler2D map, vec2 uv, vec2 texSize) {
  float hardware = texture2D(map, uv).r;
  float bicubicWeight = 1.0 - smoothstep(0.5, 1.0, cloudTexelFootprint(uv, texSize));
  if (bicubicWeight <= 0.0) return hardware;
  return mix(hardware, sampleCloudMapBicubic(map, uv, texSize), bicubicWeight);
}

// Density from up to two maps (liveClouds.ts): A is the map showing (the
// composite, or the live map) and B a newer live map fading in over it at
// its own coordinates. Each is sampled only while it contributes; `blend` is
// a uniform, so the branches are uniform and the derivatives inside defined.
float sampleCloudMaps(sampler2D mapA, vec2 uvA, sampler2D mapB, vec2 uvB, float blend, vec2 texSize) {
  float a = blend < 1.0 ? sampleCloudMap(mapA, uvA, texSize) : 0.0;
  if (blend <= 0.0) return a;
  return mix(a, sampleCloudMap(mapB, uvB, texSize), blend);
}

// Integer hash (pcg3d, Jarzynski & Olano 2020): no sin() precision loss at
// the ~6,000 km lattice coordinates this domain uses.
uvec3 cloudPcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

float cloudLatticeValue(vec3 cell) {
  return float(cloudPcg3d(uvec3(ivec3(cell))).x) * (1.0 / 4294967295.0);
}

// Quintic-smoothed 3D value noise in [0, 1].
float cloudValueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = cloudLatticeValue(i);
  float n100 = cloudLatticeValue(i + vec3(1.0, 0.0, 0.0));
  float n010 = cloudLatticeValue(i + vec3(0.0, 1.0, 0.0));
  float n110 = cloudLatticeValue(i + vec3(1.0, 1.0, 0.0));
  float n001 = cloudLatticeValue(i + vec3(0.0, 0.0, 1.0));
  float n101 = cloudLatticeValue(i + vec3(1.0, 0.0, 1.0));
  float n011 = cloudLatticeValue(i + vec3(0.0, 1.0, 1.0));
  float n111 = cloudLatticeValue(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}

// Kilometres of cloud deck per screen pixel. Derivatives must be taken in
// uniform control flow, so callers evaluate this before any branch.
float cloudKmPerPixel(vec3 cloudDir) {
  vec3 p = cloudDir * CLOUD_NOISE_RADIUS_KM;
  return max(max(length(dFdx(p)), length(dFdy(p))), 1e-4);
}

// Zero-mean fBm in roughly [-1, 1]. `cloudDir` is a unit vector in the cloud
// deck's own (rotating) frame, so the detail drifts with the clouds. Octaves
// finer than ~8 px fade out (none below 3 px): finer ones read as grain and
// shimmer in motion; a faded octave lowers the contrast rather than being
// renormalised, so the far field simply converges to the map.
float cloudDetailNoise(vec3 cloudDir, float kmPerPixel, int octaves) {
  vec3 p = cloudDir * CLOUD_NOISE_RADIUS_KM;
  float wavelength = CLOUD_DETAIL_BASE_KM;
  float amplitude = 0.5;
  float sum = 0.0;
  for (int octave = 0; octave < CLOUD_DETAIL_MAX_OCTAVES; octave++) {
    if (octave >= octaves) break;
    float pixels = wavelength / kmPerPixel;
    float resolved = smoothstep(3.0, 8.0, pixels);
    if (resolved <= 0.0) break;
    // Offset each octave so lattice points never line up across octaves.
    vec3 q = p / wavelength + vec3(17.0 * float(octave), 31.0 * float(octave), 7.0 * float(octave));
    sum += (cloudValueNoise(q) * 2.0 - 1.0) * amplitude * resolved;
    wavelength *= 0.5;
    amplitude *= 0.5;
  }
  // Octave amplitudes 0.5 + 0.25 + … stay under 1; scale value-noise's soft
  // distribution back toward the full range.
  return clamp(sum * 1.6, -1.0, 1.0);
}

// Camera-altitude weight of the detail term: none from orbit-overview range,
// full at Follow/Inspect range. It depends only on the camera position, so
// from far away every fragment skips the noise together and it costs nothing.
float cloudDetailWeight(vec3 eyePosition) {
  float altitudeKm = length(eyePosition) - CLOUD_NOISE_RADIUS_KM;
  return 1.0 - smoothstep(1200.0, 3500.0, altitudeKm);
}

// Final density: the reconstructed map, modulated by the detail term. Dense
// cores (d → 1) keep their density; thin and mid density break up. The
// multiplicative form d·(1 + s·n·(1 − d)) stays inside [0, 1] for s ≤ 1, and
// since n is zero-mean the large-scale field is unchanged on average.
float cloudDensityAt(
  sampler2D mapA, vec2 uvA, sampler2D mapB, vec2 uvB, float blend,
  vec2 texSize, vec3 cloudDir, vec3 eyePosition, int octaves
) {
  float density = sampleCloudMaps(mapA, uvA, mapB, uvB, blend, texSize);
  float kmPerPixel = cloudKmPerPixel(cloudDir);
  float detail = cloudDetailWeight(eyePosition);
  if (detail > 0.0 && density > 0.0) {
    float n = cloudDetailNoise(cloudDir, kmPerPixel, octaves);
    density *= 1.0 + CLOUD_DETAIL_STRENGTH * detail * n * (1.0 - density);
  }
  return clamp(density, 0.0, 1.0);
}
