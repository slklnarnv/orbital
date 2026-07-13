import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MiB = 1024 * 1024

const initialAssets = [
  'public/textures/earth-day-4k.webp',
  'public/textures/earth-night-4k.webp',
  'public/textures/earth-clouds-4k.webp',
  'public/textures/earth-specular-4k.webp',
  'public/textures/starmap-4k.webp',
  'public/models/International Space Station (ISS) (A).glb',
]

const runtimeImages = initialAssets.filter((asset) => asset.endsWith('.webp'))
const deferredAssets = [
  'public/models/international_space_station.glb',
]
const INITIAL_ASSET_BUDGET = 5 * MiB
const MAX_IMAGE_BYTES = 2.5 * MiB
const MAX_DEFERRED_ASSET_BYTES = 7 * MiB
const MAX_IMAGE_WIDTH = 4096
const MAX_IMAGE_HEIGHT = 2048

function readUint24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function readWebPDimensions(buffer, asset) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`${asset} is not a valid WebP container`)
  }

  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const dataOffset = offset + 8

    if (chunkType === 'VP8X' && chunkSize >= 10) {
      return {
        width: readUint24LE(buffer, dataOffset + 4) + 1,
        height: readUint24LE(buffer, dataOffset + 7) + 1,
      }
    }

    if (chunkType === 'VP8 ' && chunkSize >= 10) {
      const signature = buffer.subarray(dataOffset + 3, dataOffset + 6)
      if (!signature.equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
        throw new Error(`${asset} has an invalid VP8 frame header`)
      }
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      }
    }

    if (chunkType === 'VP8L' && chunkSize >= 5) {
      if (buffer[dataOffset] !== 0x2f) {
        throw new Error(`${asset} has an invalid VP8L frame header`)
      }
      const b1 = buffer[dataOffset + 1]
      const b2 = buffer[dataOffset + 2]
      const b3 = buffer[dataOffset + 3]
      const b4 = buffer[dataOffset + 4]
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      }
    }

    offset = dataOffset + chunkSize + (chunkSize % 2)
  }

  throw new Error(`${asset} does not contain a supported WebP image chunk`)
}

const errors = []
let initialBytes = 0

for (const asset of initialAssets) {
  const absolutePath = path.join(root, asset)
  try {
    const assetStat = await stat(absolutePath)
    initialBytes += assetStat.size
    if (runtimeImages.includes(asset) && assetStat.size > MAX_IMAGE_BYTES) {
      errors.push(`${asset} is ${(assetStat.size / MiB).toFixed(2)} MiB; limit is 2.50 MiB`)
    }
  } catch {
    errors.push(`${asset} is missing`)
  }
}

for (const asset of deferredAssets) {
  try {
    const assetStat = await stat(path.join(root, asset))
    if (assetStat.size > MAX_DEFERRED_ASSET_BYTES) {
      errors.push(`${asset} is ${(assetStat.size / MiB).toFixed(2)} MiB; deferred limit is 7.00 MiB`)
    }
  } catch {
    errors.push(`${asset} is missing`)
  }
}

for (const asset of runtimeImages) {
  try {
    const buffer = await readFile(path.join(root, asset))
    const { width, height } = readWebPDimensions(buffer, asset)
    if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
      errors.push(`${asset} is ${width}x${height}; limit is ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`)
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
}

if (initialBytes > INITIAL_ASSET_BUDGET) {
  errors.push(`initial static assets total ${(initialBytes / MiB).toFixed(2)} MiB; budget is 5.00 MiB`)
}

const issSource = await readFile(path.join(root, 'src/rendering/iss/ISSModel.tsx'), 'utf8')
if (/useGLTF\.preload\(\s*(?:DETAILED_MODEL_URL|['"]\/models\/international_space_station\.glb['"])/.test(issSource)) {
  errors.push('the detailed ISS model must remain deferred, not preloaded at module scope')
}

if (errors.length > 0) {
  console.error('Asset budget check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`Asset budget passed: ${(initialBytes / MiB).toFixed(2)} MiB initial static assets`)
}
