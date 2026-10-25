// ─── Place Index ──────────────────────────────────────────────────────────────
/**
 * Offline "Passing over" lookup: point-in-polygon against Natural Earth 1:50m
 * countries and marine polygons, built by scripts/build-place-index.mjs into
 * src/data/place-index.json.
 *
 * Over land: the country and its continent. Over water: the most specific
 * marine polygon (highest Natural Earth scalerank, so "Great Barrier Reef"
 * wins over "Coral Sea"). Natural Earth's marine polygons stop short of some
 * coasts (~0.4% of the ISS band: Bass Strait, Patagonian fjords); there the
 * nearest water body within SNAP_DEG answers. Lakes and rivers cut out of a
 * country, and slivers between simplified borders, answer with the country.
 * Null only beyond all that.
 *
 * Pure and synchronous once constructed; loading the data is the caller's job.
 */

export interface PlaceIndexData {
  scale: number
  places: Array<{
    name: string
    continent: string | null
    water: boolean
    rank: number
    /** polygon → rings (outer first, then holes) → delta-encoded [x0, y0, dx1, dy1, ...] */
    polygons: number[][][]
  }>
}

export interface Place {
  placeName: string
  continent: string | null
}

/** Coastal-gap snap radius to the nearest water body, in degrees. */
const SNAP_DEG = 3
/** Gap between neighbouring simplified borders (2.5× the build tolerance). */
const BORDER_SLIVER_DEG = 0.05

/**
 * Natural Earth gives a transcontinental country one continent. Russia is
 * filed under Europe, so Siberia and the Far East would read "Europe"; the
 * Urals (~60° E) are the conventional boundary, and its only western-
 * hemisphere land is Chukotka, which is Asia too.
 */
const CONTINENT_BY_LONGITUDE: Record<string, (lon: number) => string> = {
  Russia: (lon) => (lon >= 60 || lon < 0 ? 'Asia' : 'Europe'),
}

interface Ring {
  /** Interleaved lon, lat in degrees */
  coords: Float64Array
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface Polygon {
  outer: Ring
  holes: Ring[]
}

interface Entry {
  name: string
  continent: string | null
  water: boolean
  rank: number
  polygons: Polygon[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function decodeRing(encoded: number[], scale: number): Ring {
  const coords = new Float64Array(encoded.length)
  let x = 0
  let y = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < encoded.length; i += 2) {
    x += encoded[i]
    y += encoded[i + 1]
    const lon = x / scale
    const lat = y / scale
    coords[i] = lon
    coords[i + 1] = lat
    if (lon < minX) minX = lon
    if (lon > maxX) maxX = lon
    if (lat < minY) minY = lat
    if (lat > maxY) maxY = lat
  }
  return { coords, minX, minY, maxX, maxY }
}

function inBox(box: { minX: number; minY: number; maxX: number; maxY: number }, lon: number, lat: number, pad = 0): boolean {
  return lon >= box.minX - pad && lon <= box.maxX + pad && lat >= box.minY - pad && lat <= box.maxY + pad
}

/** Even-odd ray cast; the ring is implicitly closed. */
function inRing(ring: Ring, lon: number, lat: number): boolean {
  if (!inBox(ring, lon, lat)) return false
  const c = ring.coords
  let inside = false
  for (let i = 0, j = c.length - 2; i < c.length; j = i, i += 2) {
    const xi = c[i]
    const yi = c[i + 1]
    const xj = c[j]
    const yj = c[j + 1]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inEntry(entry: Entry, lon: number, lat: number): boolean {
  if (!inBox(entry, lon, lat)) return false
  return entry.polygons.some((polygon) =>
    inRing(polygon.outer, lon, lat) && !polygon.holes.some((hole) => inRing(hole, lon, lat)))
}

/** Squared distance from the point to the ring's edges, longitude scaled by cos(lat). */
function ringDistanceSq(ring: Ring, lon: number, lat: number, kx: number): number {
  const c = ring.coords
  let best = Infinity
  for (let i = 0, j = c.length - 2; i < c.length; j = i, i += 2) {
    const ax = (c[j] - lon) * kx
    const ay = c[j + 1] - lat
    const bx = (c[i] - lon) * kx
    const by = c[i + 1] - lat
    const dx = bx - ax
    const dy = by - ay
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq))
    const px = ax + t * dx
    const py = ay + t * dy
    const distanceSq = px * px + py * py
    if (distanceSq < best) best = distanceSq
  }
  return best
}

/** Longitude wrapped into [-180, 180). */
function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

export class PlaceIndex {
  private readonly _land: Entry[]
  private readonly _water: Entry[]

  constructor(data: PlaceIndexData) {
    const entries = data.places.map((place): Entry => {
      const polygons = place.polygons.map(([outer, ...holes]) => ({
        outer: decodeRing(outer, data.scale),
        holes: holes.map((hole) => decodeRing(hole, data.scale)),
      }))
      return {
        name: place.name,
        continent: place.continent,
        water: place.water,
        rank: place.rank,
        polygons,
        minX: Math.min(...polygons.map((polygon) => polygon.outer.minX)),
        minY: Math.min(...polygons.map((polygon) => polygon.outer.minY)),
        maxX: Math.max(...polygons.map((polygon) => polygon.outer.maxX)),
        maxY: Math.max(...polygons.map((polygon) => polygon.outer.maxY)),
      }
    })
    this._land = entries.filter((entry) => !entry.water)
    this._water = entries.filter((entry) => entry.water)
  }

  lookup(lat: number, lon: number): Place | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    const x = wrapLongitude(lon)

    const country = this._land.find((entry) => inEntry(entry, x, lat))
    if (country) return this._countryPlace(country, x)

    let water: Entry | null = null
    for (const entry of this._water) {
      if ((water === null || entry.rank > water.rank) && inEntry(entry, x, lat)) water = entry
    }
    if (water) return { placeName: water.name, continent: null }

    // A lake or river cut out of a country (the St. Lawrence in Canada) is
    // still that country; so is a sliver between two independently
    // simplified borders.
    const surrounding = this._land.find((entry) =>
      inBox(entry, x, lat) && entry.polygons.some((polygon) => inRing(polygon.outer, x, lat)))
      ?? nearestEntry(this._land, x, lat, BORDER_SLIVER_DEG)
    if (surrounding) return this._countryPlace(surrounding, x)

    const nearest = nearestEntry(this._water, x, lat, SNAP_DEG)
    return nearest ? { placeName: nearest.name, continent: null } : null
  }

  private _countryPlace(country: Entry, lon: number): Place {
    const continentAt = CONTINENT_BY_LONGITUDE[country.name]
    return { placeName: country.name, continent: continentAt ? continentAt(lon) : country.continent }
  }
}

/** Nearest entry whose outline lies within maxDeg of the point, or null. */
function nearestEntry(entries: Entry[], lon: number, lat: number, maxDeg: number): Entry | null {
  const kx = Math.cos((lat * Math.PI) / 180)
  let best: Entry | null = null
  let bestSq = maxDeg * maxDeg
  for (const entry of entries) {
    if (!inBox(entry, lon, lat, maxDeg / Math.max(kx, 0.1))) continue
    for (const polygon of entry.polygons) {
      const distanceSq = ringDistanceSq(polygon.outer, lon, lat, kx)
      if (distanceSq < bestSq) {
        bestSq = distanceSq
        best = entry
      }
    }
  }
  return best
}
