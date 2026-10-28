// build-sky.mjs — the real sky: the star catalogue and the Moon's map.
//
// Stars: the Yale Bright Star Catalogue, 5th revised edition (Hoffleit &
// Warren 1991, CDS V/50; public domain, distributed by NASA's Astronomical
// Data Center). Every star to magnitude 6.5, the naked-eye sky: J2000
// position, V magnitude and B−V colour. Written to public/textures/stars.bin:
//
//   0   'STAR'                         magic
//   4   uint32  count
//   8   int16   x, y, z × count        J2000 equatorial unit vector × 32767
//   ..  int16   V × 1000 × count
//   ..  uint8   r, g, b × count        sRGB colour from B−V (white if absent)
//
// Moon: the LRO LROC WAC global mosaic (NASA/GSFC/Arizona State University,
// public domain), from NASA Moon Trek's equirectangular WMTS: the 8×4 tiles
// of level 2 (2048×1024, longitude 0 at the centre), stitched and resized to
// 512×256 WebP: the Moon never spans more than ~0.5° (~20 px) on screen.
//
// Sources are cached in .tmp-sky-build/ (gitignored) and hash-checked.
// Usage: npm run build:sky
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK_DIR = path.join(root, '.tmp-sky-build')

export const SKY_SOURCES = {
  stars: {
    // CDS is the primary archive; this is its CfA mirror (same file).
    url: 'https://vizier.cfa.harvard.edu/ftp/cats/V/50/catalog.gz',
    sha256: '3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed',
    output: 'public/textures/stars.bin',
  },
  moon: {
    tileUrl: (row, col) =>
      `https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/2/${row}/${col}.jpg`,
    rows: 4,
    cols: 8,
    tilePx: 256,
    // SHA-256 of the 32 tile bodies concatenated row by row.
    sha256: '8e0c8476beece5c1a4a7de06104d82be38d8e75c32e409f44f045cf41c1d90c1',
    output: 'public/textures/moon.webp',
  },
}

/**
 * One fixed-width BSC5 record (ReadMe V/50, 1-based columns): RA 76–83,
 * Dec 84–90 (J2000), V 103–107, B−V 110–114. Null for the 14 entries
 * kept only for numbering (novae, clusters), which carry no position.
 */
export function parseBscLine(line) {
  const raH = line.slice(75, 77).trim()
  const vText = line.slice(102, 107).trim()
  if (!raH || !vText) return null
  const ra = (Number(raH) + Number(line.slice(77, 79)) / 60 + Number(line.slice(79, 83)) / 3600) * 15
  const sign = line[83] === '-' ? -1 : 1
  const dec = sign * (Number(line.slice(84, 86)) + Number(line.slice(86, 88)) / 60 + Number(line.slice(88, 90)) / 3600)
  const bvText = line.slice(109, 114).trim()
  return {
    hr: Number(line.slice(0, 4)),
    raDeg: ra,
    decDeg: dec,
    vmag: Number(vText),
    bv: bvText ? Number(bvText) : null,
  }
}

/**
 * B−V to an sRGB colour: Ballesteros (2012) for the temperature, then a
 * Planckian-locus fit (Helland) and a 60 % mix toward white — to the eye,
 * star colours are pale tints, not saturated swatches.
 */
export function bvToRgb(bv) {
  if (bv === null || !Number.isFinite(bv)) return [255, 255, 255]
  const b = Math.min(2.0, Math.max(-0.4, bv))
  const t = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62)) / 100
  const clamp = (v) => Math.min(255, Math.max(0, v))
  const r = t <= 66 ? 255 : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592))
  const g = t <= 66
    ? clamp(99.4708025861 * Math.log(t) - 161.1195681661)
    : clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492))
  const bl = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307)
  const peak = Math.max(r, g, bl)
  const tint = 0.6
  return [r, g, bl].map((c) => Math.round(255 - tint * (255 - (255 * c) / peak)))
}

/** Pack parsed stars into the stars.bin layout above. */
export function packStars(stars) {
  const n = stars.length
  const dirOffset = 8
  const magOffset = dirOffset + n * 6
  const rgbOffset = magOffset + n * 2
  const buffer = Buffer.alloc(rgbOffset + n * 3)
  buffer.write('STAR', 0, 'ascii')
  buffer.writeUInt32LE(n, 4)
  stars.forEach((s, i) => {
    const ra = (s.raDeg * Math.PI) / 180
    const dec = (s.decDeg * Math.PI) / 180
    const v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
    v.forEach((c, k) => buffer.writeInt16LE(Math.round(c * 32767), dirOffset + i * 6 + k * 2))
    buffer.writeInt16LE(Math.round(s.vmag * 1000), magOffset + i * 2)
    bvToRgb(s.bv).forEach((c, k) => buffer.writeUInt8(c, rgbOffset + i * 3 + k))
  })
  return buffer
}

async function exists(file) {
  try { await access(file); return true } catch { return false }
}

async function download(url, file) {
  if (await exists(file)) return
  console.log(`[sky] downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  await writeFile(file, Buffer.from(await response.arrayBuffer()))
}

function checkDigest(label, buffers, expected) {
  const hash = createHash('sha256')
  for (const b of buffers) hash.update(b)
  const digest = hash.digest('hex')
  if (digest !== expected) throw new Error(`${label}: sha256 ${digest}, expected ${expected}`)
}

async function main() {
  await mkdir(WORK_DIR, { recursive: true })

  const catalog = path.join(WORK_DIR, 'catalog.gz')
  await download(SKY_SOURCES.stars.url, catalog)
  const catalogBytes = await readFile(catalog)
  checkDigest(catalog, [catalogBytes], SKY_SOURCES.stars.sha256)
  const stars = gunzipSync(catalogBytes).toString('latin1').split(/\r?\n/)
    .map(parseBscLine)
    .filter((s) => s !== null)
  const starsOut = path.join(root, SKY_SOURCES.stars.output)
  await writeFile(starsOut, packStars(stars))
  console.log(`[sky] ${SKY_SOURCES.stars.output}: ${stars.length} stars, ${(await stat(starsOut)).size} bytes`)

  const { default: sharp } = await import('sharp')
  const moon = SKY_SOURCES.moon
  const tiles = []
  for (let row = 0; row < moon.rows; row++) {
    for (let col = 0; col < moon.cols; col++) {
      const file = path.join(WORK_DIR, `moon-2-${row}-${col}.jpg`)
      await download(moon.tileUrl(row, col), file)
      tiles.push({ input: await readFile(file), left: col * moon.tilePx, top: row * moon.tilePx })
    }
  }
  checkDigest('Moon tiles', tiles.map((t) => t.input), moon.sha256)
  const mosaic = await sharp({
    create: { width: moon.cols * moon.tilePx, height: moon.rows * moon.tilePx, channels: 3, background: '#000' },
  }).composite(tiles).png().toBuffer()
  const moonOut = path.join(root, moon.output)
  await sharp(mosaic).resize(512, 256, { fit: 'fill', kernel: 'lanczos3' }).webp({ quality: 86 }).toFile(moonOut)
  console.log(`[sky] ${moon.output}: ${(await stat(moonOut)).size} bytes`)
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
