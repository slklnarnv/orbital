// ─── Streamed close-range imagery (NASA GIBS, roadmap D.8) ──────────────────
// The day albedo near the ground the camera looks at, from a 4×4 ring buffer
// of 512 px GIBS tiles per level (surfaceDetail.ts, GibsDetailStream.ts).
// Only the albedo changes: lighting, the terminator, cloud shadows, the ocean
// glint and the city lights are untouched. Weights, all smooth:
//   - pixels per detail texel 0.7 → 1.3 (no mips: never minified, so it never
//     shimmers, and from the overview it is exactly the base map);
//   - radius from the inset centre DETAIL_FULL → DETAIL_EDGE tiles, inside
//     the resident window by construction (no window edge is ever drawn);
//   - each tile's own fade-in, and the level's activation fade.

const float DETAIL_TILE_PX = 512.0;
const float DETAIL_WINDOW = 4.0;
const float DETAIL_FULL = 0.9;
const float DETAIL_EDGE = 1.5;

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

// window: col0, row0, cols, tileDeg. g and ppt come from the two functions
// above, evaluated in uniform control flow.
vec3 applyDetailLevel(vec3 base, sampler2D map, vec4 window, vec2 center, float slots[16], float on, vec2 g, float ppt) {
  vec2 d = g - center;
  d.x -= window.z * floor(d.x / window.z + 0.5);
  float w = on * smoothstep(0.7, 1.3, ppt) * (1.0 - smoothstep(DETAIL_FULL, DETAIL_EDGE, length(d)));
  if (w <= 0.0) return base;

  vec2 tile = floor(g);
  float rx = mod(tile.x - window.x, window.z);
  float ry = tile.y - window.y;
  if (rx >= DETAIL_WINDOW || ry < 0.0 || ry >= DETAIL_WINDOW) return base;

  vec2 slot = mod(tile, DETAIL_WINDOW);
  float alpha = slots[int(slot.y * DETAIL_WINDOW + slot.x)];
  // Half a texel in from the tile's edges: bilinear filtering never reaches
  // the neighbouring slot, which holds a tile from elsewhere.
  vec2 inTile = clamp(fract(g), vec2(0.5 / DETAIL_TILE_PX), vec2(1.0 - 0.5 / DETAIL_TILE_PX));
  vec3 detail = textureLod(map, (slot + inTile) / DETAIL_WINDOW, 0.0).rgb;
  return mix(base, detail, w * alpha);
}
