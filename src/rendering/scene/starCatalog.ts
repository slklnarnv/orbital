// Reader for public/sky/stars.bin (scripts/build-sky.mjs): the Yale Bright
// Star Catalogue packed as J2000 unit vectors, V magnitudes and sRGB colours.

export interface StarCatalog {
  count: number
  /** J2000 equatorial unit vectors × 32767, xyz per star. */
  directions: Int16Array
  /** V magnitude per star. */
  magnitudes: Float32Array
  /** sRGB colour per star, rgb bytes. */
  colors: Uint8Array
}

export function parseStarCatalog(buffer: ArrayBuffer): StarCatalog {
  const view = new DataView(buffer)
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== 'STAR') throw new Error('stars.bin: bad magic')
  const count = view.getUint32(4, true)
  const dirOffset = 8
  const magOffset = dirOffset + count * 6
  const rgbOffset = magOffset + count * 2
  if (buffer.byteLength !== rgbOffset + count * 3) throw new Error('stars.bin: truncated')
  // Copies, not views: the int16 sections are 2-byte aligned, but copying
  // also frees the fetch buffer and pins the little-endian layout.
  const directions = new Int16Array(count * 3)
  for (let i = 0; i < count * 3; i++) directions[i] = view.getInt16(dirOffset + i * 2, true)
  const magnitudes = new Float32Array(count)
  for (let i = 0; i < count; i++) magnitudes[i] = view.getInt16(magOffset + i * 2, true) / 1000
  const colors = new Uint8Array(buffer.slice(rgbOffset, rgbOffset + count * 3))
  return { count, directions, magnitudes, colors }
}
