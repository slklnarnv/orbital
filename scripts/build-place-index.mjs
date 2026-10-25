import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Builds src/data/place-index.json, the offline "Passing over" lookup, from
// Natural Earth (public domain): 1:50m country polygons with their continent,
// and 1:50m marine polygons (oceans, seas, bays, straits). Replaces the
// BigDataCloud client endpoint, whose fair-use policy allows only the calling
// device's own location — never the ISS ground point.
//
//   node scripts/build-place-index.mjs              download the pinned release
//   node scripts/build-place-index.mjs --from DIR   use local copies of the files
//
// Outlines are Douglas-Peucker simplified, rounded to 0.01° and delta-encoded;
// the decoder is src/core/geo/PlaceIndex.ts.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'src/data/place-index.json')

// v5.1.2, pinned by commit so a rebuild is reproducible.
const NATURAL_EARTH_COMMIT = 'f1890d9f152c896d250a77557a5751a93d494776'
const COUNTRIES = 'ne_50m_admin_0_countries.geojson'
const MARINE = 'ne_50m_geography_marine_polys.geojson'

export const SCALE = 100                // units per degree (0.01° ≈ 1.1 km)
const SIMPLIFY_TOLERANCE_DEG = 0.02

/** Natural Earth's English names, with its two long-form outliers shortened. */
const COUNTRY_NAME_OVERRIDES = {
  "People's Republic of China": 'China',
  'Turkish Republic of Northern Cyprus': 'Northern Cyprus',
}
const OPEN_OCEAN_CONTINENT = 'Seven seas (open ocean)'

async function loadSource(name, fromDir) {
  if (fromDir) return JSON.parse(await readFile(path.join(fromDir, name), 'utf8'))
  const url = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_COMMIT}/geojson/${name}`
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  return response.json()
}

/** "SOUTHERN OCEAN" → "Southern Ocean"; mixed-case names pass through. */
export function tidyWaterName(name) {
  if (name !== name.toUpperCase()) return name
  return name.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

function perpendicularDistance([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  if (length === 0) return Math.hypot(x - x1, y - y1)
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length
}

function douglasPeucker(points, tolerance) {
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()
    let worst = 0
    let index = -1
    for (let i = start + 1; i < end; i++) {
      const distance = perpendicularDistance(points[i], points[start], points[end])
      if (distance > worst) { worst = distance; index = i }
    }
    if (index !== -1 && worst > tolerance) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }
  return points.filter((_, i) => keep[i])
}

/**
 * Closed GeoJSON ring → delta-encoded integers [x0, y0, dx1, dy1, ...] without
 * the closing point, or null when fewer than three distinct vertices survive.
 */
export function encodeRing(ring) {
  const open = ring.slice(0, -1)
  // Split the closed ring at its farthest vertex so both halves simplify with
  // fixed endpoints.
  let far = 0
  for (let i = 1; i < open.length; i++) {
    if (Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]) >
        Math.hypot(open[far][0] - open[0][0], open[far][1] - open[0][1])) far = i
  }
  const simplified = far === 0
    ? open
    : [
        ...douglasPeucker(open.slice(0, far + 1), SIMPLIFY_TOLERANCE_DEG).slice(0, -1),
        ...douglasPeucker([...open.slice(far), open[0]], SIMPLIFY_TOLERANCE_DEG).slice(0, -1),
      ]

  const quantized = []
  for (const [lon, lat] of simplified) {
    const point = [Math.round(lon * SCALE), Math.round(lat * SCALE)]
    const last = quantized[quantized.length - 1]
    if (!last || last[0] !== point[0] || last[1] !== point[1]) quantized.push(point)
  }
  while (quantized.length > 1 &&
    quantized[0][0] === quantized[quantized.length - 1][0] &&
    quantized[0][1] === quantized[quantized.length - 1][1]) quantized.pop()
  if (quantized.length < 3) return null

  const encoded = [quantized[0][0], quantized[0][1]]
  for (let i = 1; i < quantized.length; i++) {
    encoded.push(quantized[i][0] - quantized[i - 1][0], quantized[i][1] - quantized[i - 1][1])
  }
  return encoded
}

function encodePolygons(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const out = []
  for (const [outer, ...holes] of polygons) {
    const encodedOuter = encodeRing(outer)
    if (!encodedOuter) continue
    out.push([encodedOuter, ...holes.map(encodeRing).filter(Boolean)])
  }
  return out
}

export function buildPlaceIndex(countries, marine) {
  const places = []
  for (const { properties, geometry } of countries.features) {
    const polygons = encodePolygons(geometry)
    if (polygons.length === 0) continue
    const name = COUNTRY_NAME_OVERRIDES[properties.NAME_EN] ?? properties.NAME_EN
    const continent = properties.CONTINENT === OPEN_OCEAN_CONTINENT ? null : properties.CONTINENT
    places.push({ name, continent, water: false, rank: 0, polygons })
  }
  for (const { properties, geometry } of marine.features) {
    const polygons = encodePolygons(geometry)
    if (polygons.length === 0) continue
    places.push({ name: tidyWaterName(properties.name), continent: null, water: true, rank: properties.scalerank, polygons })
  }
  return {
    _comment: `Generated by scripts/build-place-index.mjs from Natural Earth ${NATURAL_EARTH_COMMIT.slice(0, 7)} (v5.1.2, public domain). Do not hand-edit.`,
    scale: SCALE,
    places,
  }
}

async function main() {
  const fromIndex = process.argv.indexOf('--from')
  const fromDir = fromIndex === -1 ? null : process.argv[fromIndex + 1]
  const [countries, marine] = await Promise.all([loadSource(COUNTRIES, fromDir), loadSource(MARINE, fromDir)])
  const index = buildPlaceIndex(countries, marine)
  // One place per line keeps diffs readable without pretty-printing the outlines.
  const body = index.places.map((place) => `    ${JSON.stringify(place)}`).join(',\n')
  const json = `{\n  "_comment": ${JSON.stringify(index._comment)},\n  "scale": ${index.scale},\n  "places": [\n${body}\n  ]\n}\n`
  await writeFile(target, json)
  const land = index.places.filter((place) => !place.water).length
  console.log(`place-index.json: ${land} countries, ${index.places.length - land} water bodies, ${(json.length / 1024).toFixed(0)} KiB`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
