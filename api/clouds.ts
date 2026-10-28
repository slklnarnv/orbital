import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ─── /api/clouds: today's clouds from NOAA's global infrared mosaic ─────────
//
// NOAA's GMGSI (Global Mosaic of Geostationary Satellite Imagery) stitches
// GOES-East/West, Meteosat 0° and IODC, and Himawari into one hourly
// longwave-infrared field (public domain; AWS Open Data, noaa-gmgsi-pds;
// ~35 min behind real time): 4999×3000, Mercator to ±72.7°, 0–255 counts,
// colder = higher. This function turns the latest hour into a 4096×2048
// equirectangular cloud-density map in the same layout as
// public/textures/earth-clouds-4k.webp, which the app crossfades in.
//
// Infrared sees cold, high cloud well and low, warm decks faintly, so:
//   - high cloud: counts over a threshold that rises toward the poles (cold
//     ground would otherwise read as cloud);
//   - low cloud, over the ocean only: anything a few counts colder than the
//     clear sea around it (a local 5th-percentile reference), at most 0.55;
//   - where no satellite sees the ground well (past ~60° from every
//     sub-satellite point, the poles, missing data) the static composite;
//   - the stitching seams between satellites are feathered over ±3°: a
//     straight one-column step there would read as a drawn line.
// Tuned against the owner's previews of 2026-10-28 (plans/PROGRESS.md).
//
// Self-contained like api/tle.ts: no path aliases or app modules.

const BUCKET = 'https://noaa-gmgsi-pds.s3.amazonaws.com'
const USER_AGENT = 'orbital-iss-visualizer (Vercel function; cloud map)'
const MAX_UPSTREAM_BYTES = 24 * 1024 * 1024
const LIST_TIMEOUT_MS = 8_000
const DOWNLOAD_TIMEOUT_MS = 20_000
// A new hour lands every 60 min; a warm instance re-checks the listing at
// most this often, so an edge-cache stampede costs one listing, not dozens.
const MEMO_MIN_AGE_MS = 10 * 60_000

export const CLOUD_MAP_W = 4096
export const CLOUD_MAP_H = 2048
const QW = CLOUD_MAP_W / 4
const QH = CLOUD_MAP_H / 4

export const CLOUD_PARAMS = {
  /** Counts at which high cloud starts in the tropics, and the ramp to full. */
  highOnset: 100,
  highSpan: 110,
  /** Extra onset toward the poles, where the ground itself is cold. */
  poleLift: 45,
  /** Low cloud: counts colder than the clear reference, onset and full. */
  lowOnset: 6,
  lowFull: 45,
  lowPeak: 0.55,
  /** Columns each side of a seam its step is spread over (~2.9°). */
  seamHalf: 40,
  /** Sub-satellite longitudes (deg): GOES-West, GOES-East, Meteosat, IODC, Himawari. */
  subLongitudes: [-137.2, -75.2, 0, 45.5, 140.7],
  /** Viewing angle (deg from a sub-satellite point): full trust below, none past. */
  viewFull: 60,
  viewNone: 72,
} as const

/** One GMGSI hour as read from the NetCDF file. */
export interface GmgsiGrid {
  data: Float32Array // rows × cols, row 0 northmost
  rows: number
  cols: number
  /** Latitude of each row, decreasing (Mercator spacing). */
  latRows: Float64Array
  /** Longitude of column 0 (≈ 180, the antimeridian). */
  lon0: number
}

const isMissing = (v: number) => !(v < 254.5)

// ─── Small array helpers (separable, wrap in x, clamp in y) ─────────────────

function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3))
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma))
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return k
}

export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const k = gaussianKernel(sigma)
  const r = (k.length - 1) / 2
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += k[i + r] * src[row + ((x + i + w) % w)]
      tmp[row + x] = s
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]
      out[y * w + x] = s
    }
  }
  return out
}

function minFilter(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity
      for (let i = -radius; i <= radius; i++) m = Math.min(m, src[y * w + ((x + i + w) % w)])
      tmp[y * w + x] = m
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity
      for (let i = -radius; i <= radius; i++) m = Math.min(m, tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x])
      out[y * w + x] = m
    }
  }
  return out
}

/** Bilinear ×4 upsample of a quarter-resolution field to the full map. */
export function upsample4(q: Float32Array, qw: number, qh: number): Float32Array {
  const w = qw * 4
  const h = qh * 4
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const fy = Math.min(qh - 1, Math.max(0, (y + 0.5) / 4 - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(qh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / 4 - 0.5
      const x0f = Math.floor(fx)
      const tx = fx - x0f
      const x0 = (x0f + qw) % qw
      const x1 = (x0 + 1) % qw
      const a = q[y0 * qw + x0] * (1 - tx) + q[y0 * qw + x1] * tx
      const b = q[y1 * qw + x0] * (1 - tx) + q[y1 * qw + x1] * tx
      out[y * w + x] = a * (1 - ty) + b * ty
    }
  }
  return out
}

const smoothstep01 = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

// ─── Pipeline stages ────────────────────────────────────────────────────────

/**
 * Finds the stitching seams (columns whose mean step stands far above their
 * neighbours' along a latitude band) and spreads each row's step over
 * ±seamHalf columns, in place. Returns the seam columns.
 */
export function featherSeams(grid: GmgsiGrid): number[] {
  const { data, rows, cols, latRows } = grid
  const seams: number[] = []
  for (const [lo, hi] of [[0, 40], [40, 73]] as const) {
    const sum = new Float64Array(cols - 1)
    const count = new Uint32Array(cols - 1)
    for (let r = 0; r < rows; r++) {
      const a = Math.abs(latRows[r])
      if (a < lo || a >= hi) continue
      const row = r * cols
      for (let c = 0; c < cols - 1; c++) {
        const v0 = data[row + c]
        const v1 = data[row + c + 1]
        if (isMissing(v0) || isMissing(v1)) continue
        sum[c] += Math.abs(v1 - v0)
        count[c]++
      }
    }
    const mean = Array.from(sum, (s, c) => (count[c] ? s / count[c] : NaN))
    for (let c = 0; c < cols - 1; c++) {
      if (!(mean[c] > 0)) continue
      const neighbours = mean.slice(Math.max(0, c - 12), c + 13).filter((v) => !Number.isNaN(v)).sort((x, y) => x - y)
      const local = neighbours[Math.floor(neighbours.length / 2)]
      if (mean[c] > 2 * local + 1 && !seams.some((s) => Math.abs(s - c) < 6)) seams.push(c)
    }
  }

  const half = CLOUD_PARAMS.seamHalf
  for (const c of seams) {
    const step = new Float64Array(rows)
    for (let r = 0; r < rows; r++) {
      const v0 = data[r * cols + c]
      const v1 = data[r * cols + c + 1]
      step[r] = isMissing(v0) || isMissing(v1) ? 0 : v1 - v0
    }
    // Smoothed along latitude (21 rows) so real cloud edges crossing the seam
    // are not 'corrected' row by row.
    const smooth = new Float64Array(rows)
    for (let r = 0; r < rows; r++) {
      let s = 0
      for (let i = -10; i <= 10; i++) if (r + i >= 0 && r + i < rows) s += step[r + i]
      smooth[r] = s / 21
    }
    for (let r = 0; r < rows; r++) {
      const s = 0.5 * smooth[r]
      if (s === 0) continue
      for (let j = 0; j < half; j++) {
        const ramp = 1 - j / half
        const left = r * cols + ((c - j + cols) % cols)
        const right = r * cols + ((c + 1 + j) % cols)
        if (!isMissing(data[left])) data[left] += s * ramp
        if (!isMissing(data[right])) data[right] -= s * ramp
      }
    }
  }
  return seams
}

/** Bilinear reprojection onto the equirectangular map, with a validity mask. */
export function reproject(grid: GmgsiGrid): { ir: Float32Array; valid: Uint8Array } {
  const { data, rows, cols, latRows, lon0 } = grid
  const ir = new Float32Array(CLOUD_MAP_W * CLOUD_MAP_H)
  const valid = new Uint8Array(CLOUD_MAP_W * CLOUD_MAP_H)
  const colScale = cols / 360
  for (let y = 0; y < CLOUD_MAP_H; y++) {
    const lat = 90 - ((y + 0.5) * 180) / CLOUD_MAP_H
    if (lat > latRows[0] || lat < latRows[rows - 1]) continue
    // latRows decreases: binary search for latRows[r] >= lat > latRows[r + 1].
    let lo = 0
    let hi = rows - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (latRows[mid] >= lat) lo = mid
      else hi = mid
    }
    const fr = (latRows[lo] - lat) / (latRows[lo] - latRows[hi])
    for (let x = 0; x < CLOUD_MAP_W; x++) {
      const lon = -180 + ((x + 0.5) * 360) / CLOUD_MAP_W
      const fc = ((((lon - lon0) % 360) + 360) % 360) * colScale
      const c0 = Math.floor(fc) % cols
      const c1 = (c0 + 1) % cols
      const tc = fc - Math.floor(fc)
      const a0 = data[lo * cols + c0]
      const a1 = data[lo * cols + c1]
      const b0 = data[hi * cols + c0]
      const b1 = data[hi * cols + c1]
      const i = y * CLOUD_MAP_W + x
      if (isMissing(a0) || isMissing(a1) || isMissing(b0) || isMissing(b1)) continue
      ir[i] = (a0 * (1 - tc) + a1 * tc) * (1 - fr) + (b0 * (1 - tc) + b1 * tc) * fr
      valid[i] = 1
    }
  }
  return { ir, valid }
}

/** k-th smallest of the first n values (quickselect, in place). */
function select(values: Float32Array, n: number, k: number): number {
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const pivot = values[(lo + hi) >> 1]
    let i = lo
    let j = hi
    while (i <= j) {
      while (values[i] < pivot) i++
      while (values[j] > pivot) j--
      if (i <= j) {
        const t = values[i]; values[i] = values[j]; values[j] = t
        i++; j--
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else return values[k]
  }
  return values[k]
}

/**
 * The clear-sky reference at quarter resolution: the 5th percentile of the
 * sea in an 8×8 window (~3°), i.e. the warmest clear sea nearby, smoothed.
 * Sea only: at midday hot land made the coastal sea read as colder than
 * 'clear', drawing every coastline as a grey line of false cloud. Where a
 * window holds too little sea the reference is set out of reach (no low
 * cloud), and the blur turns that into a soft fade along the coast.
 */
export function clearSkyReference(ir: Float32Array, ocean: Float32Array): Float32Array {
  const q = new Float32Array(QW * QH)
  for (let y = 0; y < QH; y++) for (let x = 0; x < QW; x++) q[y * QW + x] = ir[y * 4 * CLOUD_MAP_W + x * 4]
  const ref = new Float32Array(QW * QH)
  const window = new Float32Array(64)
  for (let y = 0; y < QH; y++) {
    for (let x = 0; x < QW; x++) {
      let n = 0
      for (let dy = -4; dy < 4; dy++) {
        const yy = Math.min(QH - 1, Math.max(0, y + dy))
        for (let dx = -4; dx < 4; dx++) {
          const j = yy * QW + ((x + dx + QW) % QW)
          if (ocean[j] >= 0.5) window[n++] = q[j]
        }
      }
      if (n < 16) {
        ref[y * QW + x] = 255
        continue
      }
      // The 5th percentile (numpy's linear interpolation).
      const pos = 0.05 * (n - 1)
      const a = select(window, n, Math.floor(pos))
      const b = select(window, n, Math.min(n - 1, Math.floor(pos) + 1))
      ref[y * QW + x] = a + (pos - Math.floor(pos)) * (b - a)
    }
  }
  return gaussianBlur(ref, QW, QH, 3)
}

/** Ocean weight at quarter resolution from the specular mask (1 = ocean), soft at coasts. */
export function oceanWeight(specularGrey: Uint8Array): Float32Array {
  const q = new Float32Array(QW * QH)
  for (let y = 0; y < QH; y++) {
    for (let x = 0; x < QW; x++) {
      let s = 0
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) s += specularGrey[(y * 4 + dy) * CLOUD_MAP_W + x * 4 + dx]
      q[y * QW + x] = s / (16 * 255)
    }
  }
  const g = gaussianBlur(q, QW, QH, 1.5)
  for (let i = 0; i < g.length; i++) g[i] = Math.min(1, Math.max(0, (g[i] - 0.5) * 2.5 + 0.5))
  return g
}

/**
 * How much the live field is trusted, at quarter resolution: inside valid
 * data (eroded ~2°, softened ~4°), within the satellites' good viewing
 * angles, and short of 70° latitude.
 */
export function liveWeight(valid: Uint8Array): Float32Array {
  const q = new Float32Array(QW * QH)
  for (let y = 0; y < QH; y++) {
    for (let x = 0; x < QW; x++) {
      let all = 1
      for (let dy = 0; dy < 4 && all; dy++) for (let dx = 0; dx < 4; dx++) if (!valid[(y * 4 + dy) * CLOUD_MAP_W + x * 4 + dx]) { all = 0; break }
      q[y * QW + x] = all
    }
  }
  const w = gaussianBlur(minFilter(q, QW, QH, 5), QW, QH, 10)
  const subs = CLOUD_PARAMS.subLongitudes.map((l) => (l * Math.PI) / 180)
  for (let y = 0; y < QH; y++) {
    const lat = 90 - ((y + 0.5) * 180) / QH
    const latR = (lat * Math.PI) / 180
    const polar = Math.min(1, Math.max(0, (70 - Math.abs(lat)) / 8))
    for (let x = 0; x < QW; x++) {
      const lonR = ((-180 + ((x + 0.5) * 360) / QW) * Math.PI) / 180
      let best = 180
      for (const s of subs) best = Math.min(best, (Math.acos(Math.min(1, Math.max(-1, Math.cos(latR) * Math.cos(lonR - s)))) * 180) / Math.PI)
      const view = Math.min(1, Math.max(0, (CLOUD_PARAMS.viewNone - best) / (CLOUD_PARAMS.viewNone - CLOUD_PARAMS.viewFull)))
      w[y * QW + x] *= view * polar
    }
  }
  return w
}

export interface CloudMapResult {
  /** 4096×2048 density, 0–255, row 0 north, column 0 at 180°W. */
  map: Uint8Array
  seams: number[]
  /** Share of the map at density > 40/255, and > 128/255. */
  coverage: { any: number; thick: number }
}

/** The whole conversion: GMGSI hour + the static composite → the cloud map. */
export function buildCloudMap(grid: GmgsiGrid, compositeGrey: Uint8Array, ocean: Float32Array): CloudMapResult {
  const seams = featherSeams(grid)
  const { ir, valid } = reproject(grid)
  const ref = upsample4(clearSkyReference(ir, ocean), QW, QH)
  const oceanFull = upsample4(ocean, QW, QH)
  const weight = upsample4(liveWeight(valid), QW, QH)
  const p = CLOUD_PARAMS
  const map = new Uint8Array(CLOUD_MAP_W * CLOUD_MAP_H)
  let any = 0
  let thick = 0
  for (let y = 0; y < CLOUD_MAP_H; y++) {
    const alat = Math.abs(90 - ((y + 0.5) * 180) / CLOUD_MAP_H)
    const lift = p.poleLift * Math.pow(Math.min(1, Math.max(0, (alat - 35) / 35)), 1.5)
    for (let x = 0; x < CLOUD_MAP_W; x++) {
      const i = y * CLOUD_MAP_W + x
      let live = 0
      if (valid[i]) {
        const high = smoothstep01((ir[i] - (p.highOnset + lift)) / p.highSpan)
        const low = p.lowPeak * smoothstep01((ir[i] - ref[i] - p.lowOnset) / (p.lowFull - p.lowOnset)) * oceanFull[i]
        live = Math.max(high, low)
      }
      const w = valid[i] ? weight[i] : 0
      const v = Math.round(Math.min(255, Math.max(0, (w * live + (1 - w) * (compositeGrey[i] / 255)) * 255)))
      map[i] = v
      if (v > 40) any++
      if (v > 128) thick++
    }
  }
  const n = map.length
  return { map, seams, coverage: { any: any / n, thick: thick / n } }
}

// ─── Upstream ───────────────────────────────────────────────────────────────

type FetchImplementation = typeof fetch

/** `GMGSI_LW/YYYY/MM/DD/` for a UTC date. */
export function dayPrefix(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `GMGSI_LW/${date.getUTCFullYear()}/${p(date.getUTCMonth() + 1)}/${p(date.getUTCDate())}/`
}

/** The newest key in a ListObjectsV2 response, and its scan start time. */
export function latestKey(listXml: string): { key: string; time: Date } | null {
  const keys = [...listXml.matchAll(/<Key>([^<]+\.nc)<\/Key>/g)].map((m) => m[1]).sort()
  const key = keys.at(-1)
  const m = key?.match(/_s(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/)
  if (!key || !m) return null
  return { key, time: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) }
}

async function fetchWithTimeout(fetchImpl: FetchImplementation, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function findLatest(fetchImpl: FetchImplementation, now: Date): Promise<{ key: string; time: Date }> {
  // Today's folder, then yesterday's (just after 00 UTC today's is empty).
  for (const day of [now, new Date(now.getTime() - 86_400_000)]) {
    const url = `${BUCKET}/?list-type=2&prefix=${encodeURIComponent(dayPrefix(day))}&max-keys=100`
    const response = await fetchWithTimeout(fetchImpl, url, LIST_TIMEOUT_MS)
    if (!response.ok) throw new Error(`GMGSI listing: HTTP ${response.status}`)
    const latest = latestKey(await response.text())
    if (latest) return latest
  }
  throw new Error('GMGSI listing: no files for today or yesterday')
}

async function download(fetchImpl: FetchImplementation, key: string): Promise<Uint8Array> {
  const response = await fetchWithTimeout(fetchImpl, `${BUCKET}/${key}`, DOWNLOAD_TIMEOUT_MS)
  if (!response.ok) throw new Error(`GMGSI download: HTTP ${response.status}`)
  if (Number(response.headers.get('content-length')) > MAX_UPSTREAM_BYTES) throw new Error('GMGSI download: too large')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > MAX_UPSTREAM_BYTES) throw new Error('GMGSI download: too large')
  return bytes
}

/** Reads a GMGSI NetCDF4 (HDF5) file. */
async function readGrid(bytes: Uint8Array): Promise<GmgsiGrid> {
  const { default: h5wasm } = await import('h5wasm/node')
  await h5wasm.ready
  // The Node build reads the host filesystem (NODERAWFS).
  const file = path.join(tmpdir(), `gmgsi-${process.pid}-${Date.now()}.nc`)
  await writeFile(file, bytes)
  try {
    const f = new h5wasm.File(file, 'r')
    try {
      const dataset = f.get('data') as { shape: number[]; value: unknown }
      const [, rows, cols] = dataset.shape
      const data = Float32Array.from(dataset.value as ArrayLike<number>)
      const lat = (f.get('lat') as { value: unknown }).value as ArrayLike<number>
      const lon = (f.get('lon') as { value: unknown }).value as ArrayLike<number>
      const latRows = new Float64Array(rows)
      for (let r = 0; r < rows; r++) latRows[r] = lat[r * cols]
      if (data.length !== rows * cols || !(latRows[0] > latRows[rows - 1])) throw new Error('GMGSI: unexpected grid')
      return { data, rows, cols, latRows, lon0: lon[0] }
    } finally {
      f.close()
    }
  } finally {
    await rm(file, { force: true })
  }
}

interface StaticInputs {
  composite: Uint8Array
  ocean: Float32Array
}
let staticInputs: Promise<StaticInputs> | null = null

/** The composite and the ocean mask ship with the function (vercel.json includeFiles). */
function loadStaticInputs(): Promise<StaticInputs> {
  staticInputs ??= (async () => {
    const { default: sharp } = await import('sharp')
    const grey = async (name: string) => {
      const file = path.join(process.cwd(), 'public', 'textures', name)
      const { data, info } = await sharp(await readFile(file)).greyscale().resize(CLOUD_MAP_W, CLOUD_MAP_H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
      if (info.channels !== 1) throw new Error(`${name}: expected one channel`)
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    }
    const [composite, specular] = await Promise.all([grey('earth-clouds-4k.webp'), grey('earth-specular-4k.webp')])
    return { composite, ocean: oceanWeight(specular) }
  })()
  staticInputs.catch(() => { staticInputs = null })
  return staticInputs
}

async function encodeWebp(map: Uint8Array): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp')
  const buffer = await sharp(Buffer.from(map.buffer, map.byteOffset, map.byteLength), {
    raw: { width: CLOUD_MAP_W, height: CLOUD_MAP_H, channels: 1 },
  }).webp({ quality: 82, effort: 4 }).toBuffer()
  return new Uint8Array(buffer)
}

// ─── Handler ────────────────────────────────────────────────────────────────

interface CloudImage {
  key: string
  time: Date
  webp: Uint8Array
}

const ALLOW = 'GET, HEAD, OPTIONS'
// Same origin only (the app fetches it), but the time header is exposed in
// case a preview or test page reads it cross-origin.
const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Expose-Headers': 'X-Clouds-Time, X-Clouds-Stale',
}
const FRESH_CACHE = {
  'Cache-Control': 'public, max-age=600',
  'Vercel-CDN-Cache-Control': 'max-age=1200, stale-while-revalidate=2400',
}
// Served from the warm memo after the upstream failed: short edge life.
const STALE_CACHE = {
  'Cache-Control': 'public, max-age=120',
  'Vercel-CDN-Cache-Control': 'max-age=300',
  'X-Clouds-Stale': '1',
}

export interface CloudsHandlerOptions {
  now?: () => number
  memoMinAgeMs?: number
  /** Injectable for tests: bytes of a GMGSI file → cloud map WebP. */
  convert?: (bytes: Uint8Array) => Promise<Uint8Array>
}

async function defaultConvert(bytes: Uint8Array): Promise<Uint8Array> {
  const [grid, inputs] = await Promise.all([readGrid(bytes), loadStaticInputs()])
  return encodeWebp(buildCloudMap(grid, inputs.composite, inputs.ocean).map)
}

/**
 * Guarded like /api/tle: GET/HEAD only; query strings refused with a
 * cacheable 404 (one edge-cache key); a warm instance reuses its last map
 * while the newest file is unchanged and shares one conversion between
 * concurrent misses; if NOAA fails, the last good map is served marked
 * stale; with none, a 502 (the app keeps the composite).
 */
export function createCloudsHandler(fetchImpl: FetchImplementation = fetch, options: CloudsHandlerOptions = {}) {
  const now = options.now ?? Date.now
  const memoMinAgeMs = options.memoMinAgeMs ?? MEMO_MIN_AGE_MS
  const convert = options.convert ?? defaultConvert
  let memo: { checkedAt: number; image: CloudImage } | null = null
  let inflight: Promise<CloudImage> | null = null

  const load = (): Promise<CloudImage> => {
    inflight ??= (async () => {
      const latest = await findLatest(fetchImpl, new Date(now()))
      if (memo && memo.image.key === latest.key) {
        memo = { checkedAt: now(), image: memo.image }
        return memo.image
      }
      const image = { ...latest, webp: await convert(await download(fetchImpl, latest.key)) }
      memo = { checkedAt: now(), image }
      return image
    })().finally(() => { inflight = null })
    return inflight
  }

  const send = (method: string, image: CloudImage, cache: Record<string, string>) =>
    new Response(method === 'HEAD' ? null : (image.webp as BodyInit), {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        ...cache,
        'Content-Type': 'image/webp',
        'X-Clouds-Time': image.time.toISOString(),
      },
    })

  return async function handler(request: Request): Promise<Response> {
    const method = request.method
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...BASE_HEADERS, Allow: ALLOW } })
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { ...BASE_HEADERS, Allow: ALLOW, 'Cache-Control': 'no-store' } })
    }
    if (new URL(request.url).search !== '') {
      return new Response('Not found', { status: 404, headers: { ...BASE_HEADERS, 'Cache-Control': 'public, max-age=3600', 'Vercel-CDN-Cache-Control': 'max-age=86400' } })
    }
    if (memo && now() - memo.checkedAt < memoMinAgeMs) return send(method, memo.image, FRESH_CACHE)
    try {
      return send(method, await load(), FRESH_CACHE)
    } catch {
      if (memo) return send(method, memo.image, STALE_CACHE)
      return new Response('Cloud source unavailable', { status: 502, headers: { ...BASE_HEADERS, 'Cache-Control': 'no-store' } })
    }
  }
}

const handler = createCloudsHandler()

/** Vercel Web-standard method exports for the standalone `/api/clouds` function. */
export const GET = handler
export const HEAD = handler
export const OPTIONS = handler
