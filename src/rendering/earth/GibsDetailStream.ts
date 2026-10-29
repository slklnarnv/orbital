import * as THREE from 'three'
import {
  DAY_LAYER,
  DETAIL_ATLAS_PX,
  DETAIL_TILE_PX,
  DETAIL_WINDOW,
  type DetailLayer,
  type DetailLevel,
  detailTiles,
  detailTileUrl,
  detailWindow,
  uvToTile,
} from './surfaceDetail'

// ─── One GIBS level's ring buffer: fetch, decode, upload (roadmap D.8) ──────
//
// Per-globe, not a module singleton: a disposed Earth leaves no queued work.
// Tiles are fetched (CORS; GIBS sends `Access-Control-Allow-Origin: *`),
// decoded off the main thread by createImageBitmap, and copied into their
// slot with texSubImage2D, at most one tile per frame across both levels
// (UPLOADS_PER_FRAME) so an upload never costs a visible hitch. A failed
// tile retries after RETRY_MS; repeated failures pause the level for
// BACKOFF_MS (GIBS down leaves the base map, never an error).

const MAX_IN_FLIGHT = 4
const RETRY_MS = 20_000
const BACKOFF_AFTER_FAILURES = 6
const BACKOFF_MS = 60_000
/** Decoded tiles kept for when the window slides back (1 MiB each). */
const BITMAP_CACHE = 24
/** A tile fades in over ~0.4 s; the level fades with activation alike. */
const FADE_RATE = 8

// Bound until a stream first activates, so an unused level never allocates
// its 16–21 MiB atlas (at the overview none does).
const PLACEHOLDER = (() => {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
})()

export interface DetailUniforms {
  map: { value: THREE.Texture }
  /** col0, row0, cols, tileDeg */
  window: { value: THREE.Vector4 }
  /** The inset centre in continuous tile coordinates. */
  center: { value: THREE.Vector2 }
  /** Per-slot opacity, 0 while the slot holds no current tile. */
  slots: { value: number[] }
  /** The level's overall weight (0 when inactive). */
  on: { value: number }
}

interface SlotState {
  /** `col/row` of the tile in this slot, or null. */
  key: string | null
  alpha: number
}

function tileKey(col: number, row: number): string {
  return `${col}/${row}`
}

export class GibsDetailStream {
  readonly uniforms: DetailUniforms
  private readonly texture: THREE.DataTexture
  private readonly slots: SlotState[] = Array.from({ length: DETAIL_WINDOW * DETAIL_WINDOW }, () => ({ key: null, alpha: 0 }))
  private readonly inFlight = new Map<string, AbortController>()
  private readonly ready = new Map<string, ImageBitmap>()
  private readonly failedAt = new Map<string, number>()
  private failures = 0
  private pausedUntil = 0
  private active = false
  private disposed = false

  constructor(private readonly level: DetailLevel, private readonly layer: DetailLayer = DAY_LAYER) {
    // Storage only: the slots are filled by copyTextureToTexture, which
    // regenerates the mips after each tile when the layer has them (the day
    // albedo, shown minified; 16 MiB → 21 MiB). Without, the shader uses the
    // level only while each texel spans ≥ 0.7 px.
    const texture = new THREE.DataTexture(null, DETAIL_ATLAS_PX, DETAIL_ATLAS_PX, THREE.RGBAFormat, THREE.UnsignedByteType)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = layer.mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.generateMipmaps = layer.mipmaps
    texture.source.dataReady = false
    texture.needsUpdate = true
    this.texture = texture
    this.uniforms = {
      map: { value: PLACEHOLDER },
      window: { value: new THREE.Vector4(0, 0, level.cols, level.tileDeg) },
      center: { value: new THREE.Vector2() },
      slots: { value: new Array<number>(DETAIL_WINDOW * DETAIL_WINDOW).fill(0) },
      on: { value: 0 },
    }
  }

  /**
   * Once per frame. `centerUv` is the inset centre in the Earth sphere's
   * texture coordinates, or null to stand the level down. Returns how many
   * of `uploadBudget` uploads it used.
   */
  update(
    renderer: THREE.WebGLRenderer,
    centerUv: { u: number; v: number } | null,
    altitudeKm: number,
    delta: number,
    uploadBudget: number,
  ): number {
    if (this.disposed) return 0
    const now = performance.now()
    const wantActive = centerUv !== null && altitudeKm < this.level.maxAltitudeKm && now >= this.pausedUntil
    const fade = 1 - Math.exp(-FADE_RATE * delta)
    this.uniforms.on.value += ((wantActive ? 1 : 0) - this.uniforms.on.value) * fade

    if (!wantActive || !centerUv) {
      if (this.active) this.abortAll()
      this.active = false
      return 0
    }
    this.active = true
    this.uniforms.map.value = this.texture

    const center = uvToTile(centerUv.u, centerUv.v, this.level)
    const { col0, row0 } = detailWindow(center, this.level)
    this.uniforms.center.value.set(center.x, center.y)
    this.uniforms.window.value.set(col0, row0, this.level.cols, this.level.tileDeg)

    const wanted = detailTiles(center, this.level)
    const wantedKeys = new Set(wanted.map((t) => tileKey(t.col, t.row)))

    // A slot whose tile left the window is free; it fades out at once (its
    // tile is no longer addressed there, so the shader would mis-place it).
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]
      if (slot.key !== null && !wantedKeys.has(slot.key)) {
        slot.key = null
        slot.alpha = 0
      }
    }
    for (const [key, controller] of this.inFlight) {
      if (!wantedKeys.has(key)) {
        controller.abort()
        this.inFlight.delete(key)
      }
    }

    let uploads = 0
    for (const tile of wanted) {
      const key = tileKey(tile.col, tile.row)
      const slot = this.slots[tile.slot]
      if (slot.key === key) continue
      const bitmap = this.ready.get(key)
      if (bitmap) {
        if (uploads >= uploadBudget) continue
        this.upload(renderer, bitmap, tile.slot)
        slot.key = key
        slot.alpha = 0
        uploads++
        continue
      }
      if (this.inFlight.has(key) || this.inFlight.size >= MAX_IN_FLIGHT) continue
      const failed = this.failedAt.get(key)
      if (failed !== undefined && now - failed < RETRY_MS) continue
      this.fetchTile(tile.col, tile.row, key)
    }

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]
      if (slot.key !== null) slot.alpha += (1 - slot.alpha) * fade
      this.uniforms.slots.value[i] = slot.key !== null ? slot.alpha : 0
    }
    return uploads
  }

  private upload(renderer: THREE.WebGLRenderer, bitmap: ImageBitmap, slot: number): void {
    const source = new THREE.Texture(bitmap)
    const x = (slot % DETAIL_WINDOW) * DETAIL_TILE_PX
    const y = Math.floor(slot / DETAIL_WINDOW) * DETAIL_TILE_PX
    renderer.copyTextureToTexture(source, this.texture, null, new THREE.Vector2(x, y))
    source.dispose()
  }

  private fetchTile(col: number, row: number, key: string): void {
    const controller = new AbortController()
    this.inFlight.set(key, controller)
    fetch(detailTileUrl(this.level.level, row, col, this.layer), { signal: controller.signal, mode: 'cors', credentials: 'omit' })
      .then((response) => {
        if (!response.ok) throw new Error(`GIBS ${response.status}`)
        return response.blob()
      })
      .then((blob) => createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then((bitmap) => {
        if (this.disposed || bitmap.width !== DETAIL_TILE_PX || bitmap.height !== DETAIL_TILE_PX) {
          bitmap.close()
          return
        }
        this.remember(key, bitmap)
        this.failures = 0
        this.failedAt.delete(key)
      })
      .catch(() => {
        if (controller.signal.aborted || this.disposed) return
        this.failedAt.set(key, performance.now())
        if (++this.failures >= BACKOFF_AFTER_FAILURES) {
          this.failures = 0
          this.pausedUntil = performance.now() + BACKOFF_MS
        }
      })
      .finally(() => {
        if (this.inFlight.get(key) === controller) this.inFlight.delete(key)
      })
  }

  /** Least-recently-decoded eviction; Map keeps insertion order. */
  private remember(key: string, bitmap: ImageBitmap): void {
    this.ready.get(key)?.close()
    this.ready.delete(key)
    this.ready.set(key, bitmap)
    while (this.ready.size > BITMAP_CACHE) {
      const oldest = this.ready.keys().next().value as string
      this.ready.get(oldest)?.close()
      this.ready.delete(oldest)
    }
  }

  private abortAll(): void {
    for (const controller of this.inFlight.values()) controller.abort()
    this.inFlight.clear()
  }

  dispose(): void {
    this.disposed = true
    this.abortAll()
    for (const bitmap of this.ready.values()) bitmap.close()
    this.ready.clear()
    this.texture.dispose()
  }
}
