// Builds the site icon set from one parametric mark: an orbit ellipse that
// brightens toward a station glint, warm HUD white (--hud-hi) on space black
// (--space). Run `npm run build:icons`; outputs are committed.
//
//   public/favicon.svg              small mark (no sparkle rays), rounded tile
//   public/favicon.ico              16/32/48 PNG-in-ICO of the small mark
//   public/apple-touch-icon.png     180 px, full-bleed (iOS applies its own mask)
//   public/icons/icon-192.png       manifest "any", rounded tile
//   public/icons/icon-512.png       manifest "any", rounded tile
//   public/icons/icon-maskable-512.png  manifest "maskable", full bleed, mark
//                                   inside the 80% safe zone
//
// The loading screen (src/ui/loading/BootMark.tsx) draws the same geometry;
// keep MARK in sync with it.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HUD_HI = '#f1ede4'
const SPACE = '#020409'

/** Mark geometry in a 64-unit box. The glint sits on the near side of the orbit. */
const MARK = { cx: 30, cy: 33, rx: 23, ry: 9.5, tiltDeg: -24, glintDeg: 35 }

function glintPoint({ cx, cy, rx, ry, tiltDeg, glintDeg }) {
  const tilt = (tiltDeg * Math.PI) / 180
  const t = (glintDeg * Math.PI) / 180
  const ex = rx * Math.cos(t)
  const ey = ry * Math.sin(t)
  return [cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)]
}

const f = (n) => Number(n.toFixed(2))

/**
 * @param {object} o
 * @param {'tile' | 'bleed'} o.background  rounded tile or full-bleed square
 * @param {boolean} o.small  size-optimised: thicker orbit, bigger core, no rays
 * @param {number} [o.scale]  mark scale about the centre (maskable safe zone)
 */
function markSvg({ background, small, scale = 1 }) {
  const { cx, cy, rx, ry, tiltDeg } = MARK
  const [gx, gy] = glintPoint(MARK)
  const stroke = small ? 4.5 : 3
  const core = small ? 5.5 : 3.2
  const rays = 10
  const waist = 1.2
  const bg = background === 'tile'
    ? `<rect width="64" height="64" rx="14" fill="${SPACE}"/>`
    : `<rect width="64" height="64" fill="${SPACE}"/>`
  const sparkle = small
    ? ''
    : `<path d="M${f(gx)} ${f(gy - rays)}L${f(gx + waist)} ${f(gy - waist)}L${f(gx + rays)} ${f(gy)}L${f(gx + waist)} ${f(gy + waist)}L${f(gx)} ${f(gy + rays)}L${f(gx - waist)} ${f(gy + waist)}L${f(gx - rays)} ${f(gy)}L${f(gx - waist)} ${f(gy - waist)}Z" fill="${HUD_HI}"/>`
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<defs>',
    `<linearGradient id="orbit" gradientUnits="userSpaceOnUse" x1="${cx - rx}" y1="${cy}" x2="${cx + rx}" y2="${cy}" gradientTransform="rotate(${tiltDeg} ${cx} ${cy})">`,
    `<stop offset="0" stop-color="${HUD_HI}" stop-opacity="${small ? 0.45 : 0.22}"/>`,
    `<stop offset="1" stop-color="${HUD_HI}" stop-opacity="${small ? 0.85 : 0.8}"/>`,
    '</linearGradient>',
    `<radialGradient id="halo"><stop offset="0" stop-color="${HUD_HI}" stop-opacity="${small ? 0.26 : 0.36}"/><stop offset="1" stop-color="${HUD_HI}" stop-opacity="0"/></radialGradient>`,
    '</defs>',
    bg,
    scale === 1 ? '<g>' : `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">`,
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${tiltDeg} ${cx} ${cy})" fill="none" stroke="url(#orbit)" stroke-width="${stroke}"/>`,
    `<circle cx="${f(gx)}" cy="${f(gy)}" r="${f(core * 3)}" fill="url(#halo)"/>`,
    sparkle,
    `<circle cx="${f(gx)}" cy="${f(gy)}" r="${core}" fill="${HUD_HI}"/>`,
    '</g>',
    '</svg>',
    '',
  ].join('')
}

async function png(svg, size) {
  // Rasterise at 4x and downsample: librsvg's own antialiasing at 16 px is soft.
  return sharp(Buffer.from(svg), { density: (72 * size * 4) / 64 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** ICO container holding PNG frames (supported by every browser since IE Vista era). */
function ico(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  const entries = []
  let offset = 6 + 16 * frames.length
  for (const { size, data } of frames) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.data)])
}

async function main() {
  const smallTile = markSvg({ background: 'tile', small: true })
  const largeTile = markSvg({ background: 'tile', small: false })
  const largeBleed = markSvg({ background: 'bleed', small: false })
  // Maskable: the visible zone is a centred circle of 80% diameter; the mark's
  // farthest point (the sparkle tip) must stay inside it.
  const maskable = markSvg({ background: 'bleed', small: false, scale: 0.82 })

  await mkdir(path.join(root, 'public/icons'), { recursive: true })
  const outputs = [
    ['public/favicon.svg', Buffer.from(smallTile)],
    ['public/favicon.ico', ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(smallTile, size) }))))],
    ['public/apple-touch-icon.png', await png(largeBleed, 180)],
    ['public/icons/icon-192.png', await png(largeTile, 192)],
    ['public/icons/icon-512.png', await png(largeTile, 512)],
    ['public/icons/icon-maskable-512.png', await png(maskable, 512)],
  ]
  for (const [file, data] of outputs) {
    await writeFile(path.join(root, file), data)
    console.log(`${file}  ${data.length} B`)
  }
}

await main()
