// ─── Streamed close-range imagery (NASA GIBS, roadmap D.8) ──────────────────
// The day albedo, and on the night side the city lights, near the ground the
// camera looks at, from a 4×4 ring buffer of 512 px GIBS tiles per level and
// layer (surfaceDetail.ts, GibsDetailStream.ts). Only those two inputs
// change: lighting, the terminator, cloud shadows and the ocean glint are
// untouched. Weights, all smooth:
//   - pixels per detail texel, per level and layer (the DETAIL_*_FADE ranges
//     below; above ~4,500 km no level streams, so the overview is exactly
//     the base map);
//   - radius from the inset centre DETAIL_FULL → DETAIL_EDGE tiles, inside
//     the resident window by construction (no window edge is ever drawn);
//   - each tile's own fade-in, and the level's activation fade.

const float DETAIL_TILE_PX = 512.0;
const float DETAIL_WINDOW = 4.0;
const float DETAIL_FULL = 0.9;
const float DETAIL_EDGE = 1.5;

// Where each level shows, by pixels per detail texel. The day tiles carry
// mipmaps, so they show minified (sampled at the matching mip, so they never
// shimmer) down to where they stop adding detail: level 5 (~2 km) while it is
// sharper than the 8K base map (~4.9 km), level 7 (~0.5 km) while it is
// sharper than level 5. That puts level 7 under the station in Follow. The
// night tiles carry none (minified bright points would sparkle), so they
// show only magnified.
const vec2 DETAIL_DAY_FADE0 = vec2(0.5, 0.8);
const vec2 DETAIL_DAY_FADE1 = vec2(0.3, 0.5);
const vec2 DETAIL_NIGHT_FADE = vec2(0.7, 1.3);
const float DETAIL_MAX_LOD = 2.0;

// Continuous tile coordinates of a texture coordinate: x east from the
// antimeridian, y south from the north pole (the GIBS tile grid).
vec2 detailTileCoord(vec2 uv, float tileDeg) {
  return vec2(fract(uv.x) * 360.0, (1.0 - uv.y) * 180.0) / tileDeg;
}

// Detail texels per screen pixel, inverted. x wraps at the antimeridian, so
// take its derivative from a copy shifted half a turn when that is smaller
// (otherwise one pixel column there would read as minified: a line).
float detailPixelsPerTexel(vec2 g, float cols) {
  vec2 dx = dFdx(g);
  vec2 dy = dFdy(g);
  float gShift = mod(g.x + 0.5 * cols, cols);
  float sx = dFdx(gShift);
  float sy = dFdy(gShift);
  if (abs(sx) < abs(dx.x)) dx.x = sx;
  if (abs(sy) < abs(dy.x)) dy.x = sy;
  return 1.0 / max(max(length(dx), length(dy)) * DETAIL_TILE_PX, 1e-6);
}

// The mip level that matches ppt (0 when magnified).
float detailLod(float ppt) {
  return clamp(-log2(ppt), 0.0, DETAIL_MAX_LOD);
}

// How much one level shows at g (0 when it does not), and where in its
// atlas, for sampling at mip `lod`. window: col0, row0, cols, tileDeg. g and
// ppt come from the two functions above, evaluated in uniform control flow.
float detailLevelWeight(vec4 window, vec2 center, float slots[16], float on, vec2 g, float ppt, vec2 fade, float lod, out vec2 st) {
  st = vec2(0.0);
  vec2 d = g - center;
  d.x -= window.z * floor(d.x / window.z + 0.5);
  float w = on * smoothstep(fade.x, fade.y, ppt) * (1.0 - smoothstep(DETAIL_FULL, DETAIL_EDGE, length(d)));
  if (w <= 0.0) return 0.0;

  vec2 tile = floor(g);
  float rx = mod(tile.x - window.x, window.z);
  float ry = tile.y - window.y;
  if (rx >= DETAIL_WINDOW || ry < 0.0 || ry >= DETAIL_WINDOW) return 0.0;

  vec2 slot = mod(tile, DETAIL_WINDOW);
  float alpha = slots[int(slot.y * DETAIL_WINDOW + slot.x)];
  // Half a texel (of the coarser mip sampled) in from the tile's edges:
  // filtering never reaches the neighbouring slot, which holds a tile from
  // elsewhere. Mips never mix slots: tiles are power-of-two aligned.
  float edge = 0.5 * exp2(ceil(lod)) / DETAIL_TILE_PX;
  vec2 inTile = clamp(fract(g), vec2(edge), vec2(1.0 - edge));
  st = (slot + inTile) / DETAIL_WINDOW;
  return w * alpha;
}

// B-spline reconstruction of an atlas at st (Sigg & Hadwiger, four bilinear
// taps), with every tap kept inside st's own slot: the neighbouring slot
// holds a tile from elsewhere. Magnified ~10× up close, plain bilinear shows
// NASA's 500 m night-light pixels as soft squares with jagged edges.
vec3 sampleDetailBicubic(sampler2D map, vec2 st) {
  vec2 slot = floor(st * DETAIL_WINDOW);
  vec2 p = (st * DETAIL_WINDOW - slot) * DETAIL_TILE_PX - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 lo = vec2(0.5);
  vec2 hi = vec2(DETAIL_TILE_PX - 0.5);
  vec2 h0 = (slot * DETAIL_TILE_PX + clamp(i - 0.5 + w1 / g0, lo, hi)) / (DETAIL_TILE_PX * DETAIL_WINDOW);
  vec2 h1 = (slot * DETAIL_TILE_PX + clamp(i + 1.5 + w3 / g1, lo, hi)) / (DETAIL_TILE_PX * DETAIL_WINDOW);
  vec3 t00 = textureLod(map, vec2(h0.x, h0.y), 0.0).rgb;
  vec3 t10 = textureLod(map, vec2(h1.x, h0.y), 0.0).rgb;
  vec3 t01 = textureLod(map, vec2(h0.x, h1.y), 0.0).rgb;
  vec3 t11 = textureLod(map, vec2(h1.x, h1.y), 0.0).rgb;
  return g0.y * (g0.x * t00 + g1.x * t10) + g1.y * (g0.x * t01 + g1.x * t11);
}

// The day albedo: mipmapped, sampled at the mip that matches ppt (an explicit
// lod: hardware derivatives of st jump at tile edges and would pick the
// coarsest mip there, a line).
vec3 applyDetailLevel(vec3 base, sampler2D map, vec4 window, vec2 center, float slots[16], float on, vec2 g, float ppt, vec2 fade) {
  vec2 st;
  float lod = detailLod(ppt);
  float w = detailLevelWeight(window, center, slots, on, g, ppt, fade, lod, st);
  if (w <= 0.0) return base;
  return mix(base, textureLod(map, st, lod).rgb, w);
}
