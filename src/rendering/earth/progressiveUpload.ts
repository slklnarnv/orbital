import * as THREE from 'three'

// ─── Progressive compressed-texture upload (plan 017 V2) ─────────────────────
//
// An 8K Basis map transcodes to ~43 MiB of BC7 with mips. Handed to three in
// one piece, `initTexture` blocked the main thread for 27–45 ms on the
// owner's Radeon 780M: one visible hitch per map. Strips sized by measured
// throughput were no better (a 64 ms stall, see below). Instead, three
// allocates the texture's storage without data (`source.dataReady = false` makes
// WebGLTextures skip the uploads but still run texStorage2D and set the
// sampler state), and the levels are then streamed in block-row strips of
// at most 1 MiB per frame, through three's state cache so its texture
// bindings stay true. Measured: every call ≤ 0.9 ms, no frame over 20 ms,
// ~0.7 s per 8K map.

/** One compressedTexSubImage2D call. */
export interface UploadStrip {
  level: number
  y: number
  height: number
  byteOffset: number
  byteLength: number
}

/**
 * The strip of a compressed level (4×4 blocks) that starts at block row
 * `startBlockRow` and spans at most `maxBlockRows`. Strips start on a block
 * boundary and the last one ends on the level's edge, as WebGL requires for
 * compressed sub-image updates. Pure.
 */
export function nextStrip(level: number, height: number, byteLength: number, startBlockRow: number, maxBlockRows: number): UploadStrip {
  const totalBlockRows = Math.max(1, Math.ceil(height / 4))
  const rowBytes = byteLength / totalBlockRows
  if (!Number.isInteger(rowBytes)) throw new Error(`level ${level}: ${byteLength} bytes do not split into ${totalBlockRows} block rows`)
  const rows = Math.max(1, Math.min(Math.floor(maxBlockRows), totalBlockRows - startBlockRow))
  const y = startBlockRow * 4
  return { level, y, height: Math.min(rows * 4, height - y), byteOffset: startBlockRow * rowBytes, byteLength: rows * rowBytes }
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

export interface ProgressiveUploadOptions {
  /** Bytes handed to the driver per frame. */
  bytesPerFrame?: number
  /** Main-thread time cap per frame (ms). */
  budgetMs?: number
  /** Bail out between strips (component unmounted). */
  isCancelled?: () => boolean
}

/**
 * Upload a CompressedTexture's mip chain over several frames. Resolves once
 * every level is on the GPU; the texture can then be bound like any other
 * (three will not re-upload it unless `needsUpdate` is set again).
 */
export async function uploadCompressedProgressively(
  renderer: THREE.WebGLRenderer,
  texture: THREE.CompressedTexture,
  { bytesPerFrame = 1024 * 1024, budgetMs = 3, isCancelled = () => false }: ProgressiveUploadOptions = {},
): Promise<void> {
  const mipmaps = texture.mipmaps as Array<{ data: ArrayBufferView; width: number; height: number }>
  const gl = renderer.getContext() as WebGL2RenderingContext
  const glFormat = new THREE.WebGLUtils(gl, renderer.extensions).convert(texture.format, texture.colorSpace)
  if (!mipmaps?.length || typeof glFormat !== 'number') {
    renderer.initTexture(texture)
    return
  }

  // Allocate storage and sampler state through three, without data.
  texture.source.dataReady = false
  renderer.initTexture(texture)
  texture.source.dataReady = true
  const webglTexture = (renderer.properties.get(texture) as { __webglTexture?: WebGLTexture }).__webglTexture
  if (!webglTexture) throw new Error('texture storage was not allocated')

  // A fixed byte budget, not a measured rate: the D3D11 driver takes the
  // first few MiB instantly into staging, then stalls 50–65 ms on one call
  // once staging is full, so throughput measured early wildly overestimates.
  const queue = mipmaps.map((mip, level) => ({ mip, level, row: 0 }))
  while (queue.length > 0) {
    await nextFrame()
    if (isCancelled()) return
    const frameStart = performance.now()
    renderer.state.bindTexture(gl.TEXTURE_2D, webglTexture)
    let sent = 0
    while (queue.length > 0 && sent < bytesPerFrame && performance.now() - frameStart < budgetMs) {
      const entry = queue[0]
      const { mip, level } = entry
      const rowBytes = mip.data.byteLength / Math.max(1, Math.ceil(mip.height / 4))
      const strip = nextStrip(level, mip.height, mip.data.byteLength, entry.row, (bytesPerFrame - sent) / rowBytes)
      const data = new Uint8Array(mip.data.buffer, mip.data.byteOffset + strip.byteOffset, strip.byteLength)
      gl.compressedTexSubImage2D(gl.TEXTURE_2D, level, 0, strip.y, mip.width, strip.height, glFormat, data)
      sent += strip.byteLength
      entry.row += strip.byteLength / rowBytes
      if (entry.row * 4 >= mip.height) queue.shift()
    }
    renderer.state.unbindTexture()
  }
}
