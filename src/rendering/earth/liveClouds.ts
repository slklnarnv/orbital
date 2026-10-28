import * as THREE from 'three'
import { create } from 'zustand'

// ─── Live clouds: NOAA's hourly infrared mosaic, crossfaded in ──────────────
//
// /api/clouds (api/clouds.ts) turns the latest GMGSI hour into a cloud map in
// the packaged composite's layout. After first paint the app fetches it,
// decodes it off the main thread (one channel, ~11 MiB on the GPU with mips,
// a quarter of the composite's), and crossfades it in over CLOUD_FADE_MS;
// every CLOUD_REFRESH_MS it checks for a newer hour and fades that in the
// same way. Until the first map arrives, and whenever the function fails,
// the composite stays, drifting as before. Live clouds sit where the
// satellites saw them at the present and drift away from there as the
// simulation leaves it (CloudMotion.liveCloudRotation): scrubbing the orbit
// tape or speeding up time shows the deck travelling over the ground.
//
// The cloud shell and the surface shadows both sample through
// cloudDensity.glsl and read the same frame state (`cloudFrame`), so the
// shadows stay under the clouds throughout a fade.

export const CLOUD_FADE_MS = 2_500
export const CLOUD_FIRST_FETCH_DELAY_MS = 3_000
export const CLOUD_REFRESH_MS = 20 * 60_000
const CLOUDS_URL = '/api/clouds'

/** What the cloud shaders sample this frame. */
export interface CloudFrame {
  /** Map A: null means the packaged composite. */
  mapA: THREE.Texture | null
  /** Rotation of map A about the pole (radians): the composite's or the live drift. */
  rotationA: number
  /** Map B, fading in over A (always live), or null. */
  mapB: THREE.Texture | null
  /** Texture-u offset that puts B (live, with its own drift) in A's frame. */
  offsetB: number
  /** 0 → A only, 1 → B only. */
  blend: number
}

interface LiveCloudsState {
  current: THREE.Texture | null
  next: THREE.Texture | null
  fadeStart: number
}

/** Pure: the frame state for `now` (performance.now ms) and each map's drift. */
export function cloudFrame(state: LiveCloudsState, now: number, compositeRotation: number, liveRotation: number): CloudFrame {
  const rotationA = state.current ? liveRotation : compositeRotation
  const t = state.next ? Math.min(1, Math.max(0, (now - state.fadeStart) / CLOUD_FADE_MS)) : 0
  return {
    mapA: state.current,
    rotationA,
    mapB: state.next,
    offsetB: (rotationA - liveRotation) / (2 * Math.PI),
    blend: t * t * (3 - 2 * t),
  }
}

function release(texture: THREE.Texture | null): void {
  if (!texture) return
  texture.dispose()
  ;(texture.image as ImageBitmap | null)?.close?.()
}

/** For the About panel: what the clouds show right now. */
export const useCloudSourceStore = create<{ liveTime: number | null }>(() => ({ liveTime: null }))

/**
 * One per globe (EarthGroup): owns the fetch loop and the live textures.
 * `frame()` is called by both cloud consumers every frame; it also promotes
 * a finished fade, so the order the two run in does not matter.
 */
export class LiveClouds {
  private readonly state: LiveCloudsState = { current: null, next: null, fadeStart: 0 }
  private currentTime = 0
  private nextTime = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private controller: AbortController | null = null
  private disposed = false

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  start(): void {
    this.schedule(CLOUD_FIRST_FETCH_DELAY_MS)
  }

  frame(now: number, compositeRotation: number, liveRotation: number): CloudFrame {
    const f = cloudFrame(this.state, now, compositeRotation, liveRotation)
    if (this.state.next && f.blend >= 1) {
      release(this.state.current)
      this.state.current = this.state.next
      this.currentTime = this.nextTime
      this.state.next = null
      useCloudSourceStore.setState({ liveTime: this.currentTime })
      return cloudFrame(this.state, now, compositeRotation, liveRotation)
    }
    return f
  }

  private schedule(delay: number): void {
    if (this.disposed) return
    this.timer = setTimeout(() => {
      void this.poll().finally(() => this.schedule(CLOUD_REFRESH_MS))
    }, delay)
  }

  private async poll(): Promise<void> {
    if (this.state.next) return // a fade is still running; check next time
    this.controller = new AbortController()
    try {
      const response = await fetch(CLOUDS_URL, { signal: this.controller.signal })
      if (!response.ok) return
      const time = Date.parse(response.headers.get('X-Clouds-Time') ?? '')
      if (!Number.isFinite(time) || time <= Math.max(this.currentTime, this.nextTime)) return
      // Decoded off the main thread and flipped to the composite's flipY layout.
      const bitmap = await createImageBitmap(await response.blob(), {
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      })
      if (this.disposed) {
        bitmap.close()
        return
      }
      const texture = new THREE.Texture(bitmap)
      // One channel: the shaders read .r, and R8 is a quarter of RGBA.
      texture.format = THREE.RedFormat
      texture.flipY = false
      texture.colorSpace = THREE.NoColorSpace
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
      texture.generateMipmaps = true
      texture.needsUpdate = true
      // Upload now, before the fade starts using it. The bitmap stays open
      // for the texture's life: after a lost WebGL context three re-uploads
      // from it (App recovers in place, without remounting the scene).
      this.renderer.initTexture(texture)
      this.state.next = texture
      this.nextTime = time
      this.state.fadeStart = performance.now()
    } catch {
      // Network or decode failure: keep what is showing; retry next interval.
    } finally {
      this.controller = null
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.controller?.abort()
    release(this.state.current)
    release(this.state.next)
    this.state.current = null
    this.state.next = null
    useCloudSourceStore.setState({ liveTime: null })
  }
}
