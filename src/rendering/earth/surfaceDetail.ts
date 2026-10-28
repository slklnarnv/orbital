// ─── Streamed close-range imagery (NASA GIBS, roadmap D.8): the tile math ────
//
// Up close the ground outgrows the base map (8K: ~4.9 km per texel at the
// equator; 4K: ~9.8 km). Near the ground the camera looks at, the surface
// shader swaps its day albedo for NASA GIBS tiles of the same Blue Marble
// product (`BlueMarble_ShadedRelief_Bathymetry`, measured within 3–12 levels
// of the base map's colours), at two levels:
//
//   level 5:  9° tiles, ~2 km per pixel   (the inset ~3,000 km across)
//   level 7:  2.25° tiles, ~0.5 km per pixel (~750 km across)
//
// Each level keeps a 4×4 window of 512 px tiles around the inset's centre
// in a 2048² texture. A tile always lives in slot (col mod 4, row mod 4), so
// as the window slides only the newly uncovered tiles load (a clipmap ring
// buffer). The shader fades the inset out radially from its centre before
// the window's edge, and each tile fades in as it arrives, so no tile or
// window edge is ever drawn as a line.
//
// Pure functions; the fetching, decoding and uploading live in
// GibsDetailStream.ts.

/** One GIBS level of the `500m` EPSG:4326 tile matrix set. */
export interface DetailLevel {
  /** GIBS TileMatrix id. */
  level: number
  /** Degrees per tile edge. */
  tileDeg: number
  /** Tiles around the globe (360° / tileDeg) and pole to pole. */
  cols: number
  rows: number
  /** Stream this level while the camera is below this altitude, km. */
  maxAltitudeKm: number
}

export const DETAIL_TILE_PX = 512
/** The window is DETAIL_WINDOW × DETAIL_WINDOW tiles. */
export const DETAIL_WINDOW = 4
export const DETAIL_ATLAS_PX = DETAIL_TILE_PX * DETAIL_WINDOW

/**
 * Inset radius in tiles: full detail inside DETAIL_FULL_RADIUS, gone by
 * DETAIL_EDGE_RADIUS. The window is re-centred on the nearest tile corner,
 * so the centre is never more than half a tile from the window's middle and
 * the inset (≤ 1.5 tiles) never reaches past the 2 tiles of window.
 */
export const DETAIL_FULL_RADIUS = 0.9
export const DETAIL_EDGE_RADIUS = 1.5

// Level 5 pays off once its ~2 km texels are under ~3 screen px wide: below
// ~4,500 km of altitude at the app's 45° field of view. Level 7 (~0.5 km)
// below ~1,500 km: Follow and Inspect.
export const DETAIL_LEVELS: readonly DetailLevel[] = [
  { level: 5, tileDeg: 9, cols: 40, rows: 20, maxAltitudeKm: 4500 },
  { level: 7, tileDeg: 2.25, cols: 160, rows: 80, maxAltitudeKm: 1500 },
]

export const GIBS_LAYER = 'BlueMarble_ShadedRelief_Bathymetry'
export const GIBS_HOST = 'https://gibs.earthdata.nasa.gov'

export function detailTileUrl(level: number, row: number, col: number): string {
  return `${GIBS_HOST}/wmts/epsg4326/best/${GIBS_LAYER}/default/500m/${level}/${row}/${col}.jpeg`
}

/**
 * Continuous tile coordinates of a point given by the Earth sphere's texture
 * coordinates (u: longitude −180°→180°, v: south→north, the base maps'
 * equirectangular layout): x grows east from the antimeridian, y grows south
 * from the north pole, both in tiles.
 */
export function uvToTile(u: number, v: number, level: DetailLevel): { x: number; y: number } {
  const wrapped = u - Math.floor(u)
  return { x: (wrapped * 360) / level.tileDeg, y: ((1 - v) * 180) / level.tileDeg }
}

export interface DetailWindow {
  /** Westmost column (wrapped into [0, cols)) and northmost row. */
  col0: number
  row0: number
}

/** The 4×4 window around a centre in tile coordinates. */
export function detailWindow(center: { x: number; y: number }, level: DetailLevel): DetailWindow {
  const half = DETAIL_WINDOW / 2
  const col0 = Math.round(center.x) - half
  const row0 = Math.round(center.y) - half
  return {
    col0: ((col0 % level.cols) + level.cols) % level.cols,
    row0: Math.min(Math.max(row0, 0), level.rows - DETAIL_WINDOW),
  }
}

/** The ring-buffer slot a tile always occupies, 0..15. */
export function detailSlot(col: number, row: number): number {
  return (row % DETAIL_WINDOW) * DETAIL_WINDOW + (col % DETAIL_WINDOW)
}

export interface DetailTile {
  col: number
  row: number
  slot: number
  /** Distance from the inset centre to the tile's centre, in tiles. */
  distance: number
}

/** Shortest east–west separation in tiles across the antimeridian. */
function wrapDelta(dx: number, cols: number): number {
  return dx - cols * Math.round(dx / cols)
}

/**
 * The window's tiles that the inset can show (their nearest point within
 * DETAIL_EDGE_RADIUS of the centre), nearest first: the load order.
 */
export function detailTiles(center: { x: number; y: number }, level: DetailLevel): DetailTile[] {
  const { col0, row0 } = detailWindow(center, level)
  const tiles: DetailTile[] = []
  for (let r = 0; r < DETAIL_WINDOW; r++) {
    for (let c = 0; c < DETAIL_WINDOW; c++) {
      const col = (col0 + c) % level.cols
      const row = row0 + r
      const dx = wrapDelta(col + 0.5 - center.x, level.cols)
      const dy = row + 0.5 - center.y
      // Nearest point of the tile to the centre (0 inside it).
      const nx = Math.max(Math.abs(dx) - 0.5, 0)
      const ny = Math.max(Math.abs(dy) - 0.5, 0)
      if (Math.hypot(nx, ny) >= DETAIL_EDGE_RADIUS) continue
      tiles.push({ col, row, slot: detailSlot(col, row), distance: Math.hypot(dx, dy) })
    }
  }
  return tiles.sort((a, b) => a.distance - b.distance)
}
