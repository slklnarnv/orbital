// build-earth-8k.mjs — the deferred 8K Earth maps (plan 017 V2).
//
// Downloads the public-domain NASA sources the 4K maps were made from
// (verified: the 4K day map is Blue Marble NG July 2004 topo-bathy, RMSE 2.6
// against it at 1024 px vs 4.3+ for other months; the 4K night map is Black
// Marble 2016, RMSE 1.9), checks their SHA-256, resizes them to 8192×4096
// (Lanczos 3) and encodes KTX2 / Basis with mipmaps.
//
// Codecs, measured on the 8K masters (PSNR; today's 4K WebP upscaled scores
// 31.6 dB day, 33.3 dB night):
// - night lights: ETC1S, the ISS model's `ktx create` arguments
//   (build-iss-model.mjs): 38.2 dB at 1.4 MiB;
// - day: UASTC + RDO + zstd, 44.6 dB at 20.6 MiB. ETC1S was 35.3 dB at
//   4.1 MiB but, magnified as the app shows it from orbit, leaves light-blue
//   4×4 block halos along every coastline; UASTC with heavy RDO (λ 4) saved
//   only 4 MiB for 39.1 dB.
// Both transcode to 1 byte per texel on desktops (BC7 / ASTC): 42.7 MiB per
// map with mips, the same as one 4K RGBA8 map.
//
// The images are flipped vertically before encoding: three uploads
// compressed textures without flipY, and the Earth sphere's UVs expect the
// flipY convention of the 4K WebP maps (north at v = 1).
//
// Needs KTX-Software ≥ 4.3 (`ktx` on PATH, or KTX_BIN). Sources are cached
// in .tmp-earth-build/ (gitignored).
//
// Usage: npm run build:earth-8k
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { ktxCreateArgs } from './build-iss-model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORK_DIR = path.join(root, '.tmp-earth-build')
const run = promisify(execFile)

export const EARTH_8K_SOURCES = [
  {
    name: 'day',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x21600x10800.jpg',
    sha256: 'd225f1f35a6448a4d1d8f6de6e48f3433e470085b70a35800e64f384f269a7b0',
    output: 'public/textures/earth-day-8k.ktx2',
    codec: 'uastc',
  },
  {
    name: 'night',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg',
    sha256: '230aac448ae68c358be433dd518888cccb3a85ccf66f7b44326441c324ad6725',
    output: 'public/textures/earth-night-8k.ktx2',
    codec: 'etc1s',
  },
]
const WIDTH = 8192
const HEIGHT = 4096

/** `ktx create` arguments: ETC1S exactly as the ISS textures; UASTC for the day map. */
export function earthKtxArgs(codec, input, output) {
  if (codec === 'etc1s') return ktxCreateArgs({ color: true, alpha: false }, input, output)
  return [
    'create',
    '--format', 'R8G8B8_SRGB',
    '--assign-oetf', 'srgb',
    '--encode', 'uastc',
    '--uastc-quality', '2',
    '--uastc-rdo',
    '--uastc-rdo-l', '1',
    '--zstd', '22',
    '--generate-mipmap',
    input,
    output,
  ]
}

async function exists(file) {
  try { await access(file); return true } catch { return false }
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

async function fetchSource(source) {
  const file = path.join(WORK_DIR, path.basename(new URL(source.url).pathname))
  if (!(await exists(file))) {
    console.log(`[earth-8k] downloading ${source.url}`)
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`)
    await writeFile(file, Buffer.from(await response.arrayBuffer()))
  }
  const digest = await sha256(file)
  if (digest !== source.sha256) throw new Error(`${file}: sha256 ${digest}, expected ${source.sha256}`)
  return file
}

async function main() {
  await mkdir(WORK_DIR, { recursive: true })
  const ktx = process.env.KTX_BIN || 'ktx'
  for (const source of EARTH_8K_SOURCES) {
    const input = await fetchSource(source)
    const png = path.join(WORK_DIR, `${source.name}-8k-flipped.png`)
    await sharp(input, { limitInputPixels: false })
      .resize(WIDTH, HEIGHT, { fit: 'fill', kernel: 'lanczos3' })
      .flip()
      .removeAlpha()
      .png({ compressionLevel: 1 })
      .toFile(png)
    const output = path.join(root, source.output)
    console.log(`[earth-8k] encoding ${source.output} (${source.codec.toUpperCase()}, mipmaps)…`)
    try {
      await run(ktx, earthKtxArgs(source.codec, png, output), { maxBuffer: 16 * 1024 * 1024 })
    } catch (error) {
      throw new Error(`ktx create failed for ${source.name} (is KTX-Software ≥4.3 installed? set KTX_BIN)`, { cause: error })
    }
    const { size } = await stat(output)
    console.log(`[earth-8k] ${source.output}: ${(size / 2 ** 20).toFixed(2)} MiB`)
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
