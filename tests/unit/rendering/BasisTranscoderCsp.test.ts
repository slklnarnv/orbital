// ─── BasisTranscoderCsp.test.ts — the KTX2 transcoder under the live CSP ─────
//
// Regression for the stranded close-range model (IGOAL never loaded on the
// live site): three's Basis transcoder glue builds embind invokers with
// `new Function`, which `script-src 'self' 'wasm-unsafe-eval'` forbids. Its
// KTX2 workers inherit that CSP, threw EvalError at init and never answered,
// so every KTX2 texture load hung. A V8 context with string code generation
// disabled reproduces that policy exactly, without a browser.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  PUBLIC_BASIS_DIR,
  THREE_BASIS_DIR,
  patchBasisTranscoder,
} from '../../../scripts/patch-basis-transcoder.mjs'

const ROOT = path.resolve(__dirname, '../../..')
const read = (file: string): Buffer => readFileSync(path.join(ROOT, file))

/** BASIS transcoder target: uncompressed RGBA8. */
const TRANSCODER_FORMAT_RGBA32 = 13

/** Smallest KTX2 image embedded in the shipped Locate LOD. */
function shippedKtx2Texture(): Uint8Array {
  const glb = read('public/models/iss_igoal_locate.glb')
  const jsonLength = glb.readUInt32LE(12)
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as {
    images: Array<{ bufferView: number; mimeType?: string }>
    bufferViews: Array<{ byteOffset?: number; byteLength: number }>
  }
  const binStart = 20 + jsonLength + 8
  const view = json.images
    .filter((image) => image.mimeType === 'image/ktx2')
    .map((image) => json.bufferViews[image.bufferView])
    .sort((a, b) => a.byteLength - b.byteLength)[0]
  const start = binStart + (view.byteOffset ?? 0)
  return new Uint8Array(glb.subarray(start, start + view.byteLength))
}

interface TranscodeResult {
  width: number
  height: number
  pixels: Uint8Array
}

/**
 * Initialize the transcoder exactly as KTX2Loader's worker does (wasmBinary +
 * onRuntimeInitialized, then initializeBasis) and transcode one image.
 */
async function transcodeIn(glue: string, allowStringEval: boolean): Promise<TranscodeResult> {
  const context = vm.createContext(
    { wasmBinary: new Uint8Array(read(`${PUBLIC_BASIS_DIR}/basis_transcoder.wasm`)) },
    { codeGeneration: { strings: allowStringEval, wasm: true } },
  )
  vm.runInContext(`${glue}\n;globalThis.BASIS = BASIS`, context)
  const basis = await vm.runInContext(`new Promise((resolve, reject) => {
    const module = { wasmBinary, onRuntimeInitialized: () => resolve(module) }
    BASIS(module).catch(reject)
  }).then((module) => { module.initializeBasis(); return module })`, context)

  const file = new basis.KTX2File(shippedKtx2Texture())
  try {
    expect(file.isValid()).toBeTruthy()
    expect(file.startTranscoding()).toBeTruthy()
    const size = file.getImageTranscodedSizeInBytes(0, 0, 0, TRANSCODER_FORMAT_RGBA32)
    const pixels = new Uint8Array(size)
    expect(file.transcodeImage(pixels, 0, 0, 0, TRANSCODER_FORMAT_RGBA32, 0, -1, -1)).toBeTruthy()
    return { width: file.getWidth(), height: file.getHeight(), pixels }
  } finally {
    file.close()
    file.delete()
  }
}

const stockGlue = read(`${THREE_BASIS_DIR}/basis_transcoder.js`).toString('utf8')
const shippedGlue = read(`${PUBLIC_BASIS_DIR}/basis_transcoder.js`).toString('utf8')

describe('Basis transcoder under the production CSP (no string eval)', () => {
  it('three\'s stock glue fails to initialize — the live-site hang', async () => {
    await expect(transcodeIn(stockGlue, false)).rejects.toThrow(/code generation from strings/i)
  })

  it('the shipped glue transcodes a real KTX2 texture', async () => {
    const result = await transcodeIn(shippedGlue, false)
    expect(result.width).toBeGreaterThan(0)
    expect(result.pixels.length).toBe(result.width * result.height * 4)
    expect(result.pixels.some((value) => value !== 0)).toBe(true)
  })

  it('the patch is output-identical to the stock transcoder', async () => {
    const stock = await transcodeIn(stockGlue, true)
    const shipped = await transcodeIn(shippedGlue, false)
    expect(Buffer.from(shipped.pixels).equals(Buffer.from(stock.pixels))).toBe(true)
  })
})

describe('public/basis stays in sync with three', () => {
  it('the shipped glue is exactly the patched copy of three\'s transcoder', () => {
    expect(shippedGlue.replace(/\r\n/g, '\n')).toBe(patchBasisTranscoder(stockGlue))
  })

  it('the shipped wasm is three\'s', () => {
    expect(read(`${PUBLIC_BASIS_DIR}/basis_transcoder.wasm`)
      .equals(read(`${THREE_BASIS_DIR}/basis_transcoder.wasm`))).toBe(true)
  })

  it('refuses glue whose code-generation sites changed shape', () => {
    expect(() => patchBasisTranscoder('var BASIS = 1')).toThrow(/craftInvokerFunction/)
  })
})
