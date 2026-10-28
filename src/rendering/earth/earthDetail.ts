// ─── Deferred 8K Earth maps: who gets them (plan 017 V2) ─────────────────────
//
// First paint always uses the 4K WebP maps. After it, capable desktops
// stream an 8K day map and 8K night lights as KTX2 (Basis UASTC and ETC1S,
// transcoded to BC7 / ASTC / BC1-3 / ETC on the GPU) and swap them in. On the GPU an 8K
// map transcoded to BC7 is 1 byte per texel, 42.7 MiB with mips: the same as
// the 4K RGBA8 map it replaces, which is released after the swap.
//
// Pure decision logic; the browser reads live in useEarthDetailUpgrade.ts.

export interface EarthDetailCapabilities {
  /** gl.MAX_TEXTURE_SIZE */
  maxTextureSize: number
  /** `(pointer: fine)`: a mouse or trackpad, i.e. a desktop, not a phone or tablet */
  finePointer: boolean
  /** navigator.connection.saveData */
  saveData: boolean
  /** Any GPU format Basis can transcode to (BPTC, ASTC, S3TC, ETC). Without
   *  one KTX2Loader falls back to uncompressed RGBA: 171 MiB per 8K map. */
  compressedFormat: boolean
}

export type EarthDetailDecision =
  | { stream: true }
  | { stream: false; reason: 'max-texture-size' | 'coarse-pointer' | 'save-data' | 'no-compressed-format' | 'disabled' }

export const EARTH_DETAIL_TEXTURE_SIZE = 8192

/** Delay after the Earth's first paint before the 8K maps start streaming. */
export const EARTH_DETAIL_START_DELAY_MS = 2500

export function decideEarthDetail(caps: EarthDetailCapabilities): EarthDetailDecision {
  if (caps.maxTextureSize < EARTH_DETAIL_TEXTURE_SIZE) return { stream: false, reason: 'max-texture-size' }
  if (!caps.finePointer) return { stream: false, reason: 'coarse-pointer' }
  if (caps.saveData) return { stream: false, reason: 'save-data' }
  if (!caps.compressedFormat) return { stream: false, reason: 'no-compressed-format' }
  return { stream: true }
}

/**
 * Dev/bench override (`window.__orbitalEarth8k`): 'on' forces the stream
 * past the capability gate, 'off' disables it, anything else defers to the
 * gate. Lets `npm run bench` measure before and after on the same machine.
 */
export function applyEarthDetailOverride(decision: EarthDetailDecision, override: unknown): EarthDetailDecision {
  if (override === 'off') return { stream: false, reason: 'disabled' }
  if (override === 'on') return { stream: true }
  return decision
}
