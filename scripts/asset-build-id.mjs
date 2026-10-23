// ─── asset-build-id.mjs — stable cache-busting id for versioned assets ──────
//
// The `/models` and `/textures` routes are served `immutable` for a year
// (vercel.json), so every URL carries `?v=<id>`. The id must change when the
// versioned asset bytes change and stay STABLE otherwise — across docs/code
// deploys and across checkouts with different line-ending settings.
//
// Only `.glb` and `.webp` files are hashed. The earlier version hashed every
// file under those directories, which included `public/textures/README.md`:
// git checks that out as LF on Linux/Vercel and CRLF on this Windows checkout,
// so the same commit produced two different ids. Filtering to the actual
// versioned assets removes that whole class of environment noise.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const ASSET_DIRS = ['public/models', 'public/textures']
export const ASSET_EXTENSIONS = /\.(glb|webp)$/i

export function listFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/**
 * Deterministic 12-hex-char id over the versioned asset bytes. The relative
 * path is normalized to `/` so Windows and Linux produce the same digest.
 */
export function computeAssetBuildId(root, {
  dirs = ASSET_DIRS,
  extensions = ASSET_EXTENSIONS,
} = {}) {
  const files = dirs
    .flatMap((dir) => listFiles(path.join(root, dir)))
    .filter((file) => extensions.test(file))
    .sort()

  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(path.relative(root, file).split(path.sep).join('/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 12)
}
