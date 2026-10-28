import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { KTX2_TEXTURE_STALL_MS, guardLoadStall } from './loadStallGuard'
import { BASIS_TRANSCODER_PATH, versionTranscoderUrl } from './basisTranscoderUrl'

// ─── KTX2 / Basis textures ───────────────────────────────────────────────────
// The IGOAL assets and the deferred 8K Earth maps ship GPU-compressed KTX2
// (Basis ETC1S / UASTC) textures: ~4–8× less texture memory than decoded WebP, transcoded
// in workers instead of decoded on the main thread. The transcoder is self-hosted in public/basis/ (copied
// from three/examples/jsm/libs/basis at the renderer's version), like Draco.
// detectSupport picks the GPU format (BC / ETC / ASTC) per renderer, so the
// loader is rebuilt if the renderer ever changes.
//
// The .js glue is not a plain copy: it is patched to never evaluate strings
// (npm run patch:basis): the production CSP forbids it, and three's stock
// copy hung every KTX2 load on the live site. Each texture load
// is also stall-guarded, so a transcoder that never answers fails into the
// reliability ladder instead of suspending the detail model forever.
class StallGuardedKTX2Loader extends KTX2Loader {
  override load(
    url: string,
    onLoad: (texture: THREE.CompressedTexture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    const guarded = guardLoadStall(onLoad, onError, KTX2_TEXTURE_STALL_MS, 'KTX2 texture')
    super.load(url, guarded.onLoad, onProgress, guarded.onError)
  }
}

// The transcoder files carry a content-hash query (basisTranscoderUrl.ts) via
// the loader's own manager, so a changed transcoder reaches cached clients.
const ktx2Manager = new THREE.LoadingManager()
ktx2Manager.setURLModifier((url) => versionTranscoderUrl(url, __BASIS_ID__))

let ktx2Loader: KTX2Loader | null = null
let ktx2Renderer: THREE.WebGLRenderer | null = null

export function ktx2LoaderFor(gl: THREE.WebGLRenderer): KTX2Loader {
  if (!ktx2Loader || ktx2Renderer !== gl) {
    ktx2Loader?.dispose()
    ktx2Loader = new StallGuardedKTX2Loader(ktx2Manager)
      .setTranscoderPath(BASIS_TRANSCODER_PATH)
      .detectSupport(gl)
    ktx2Renderer = gl
  }
  return ktx2Loader
}
