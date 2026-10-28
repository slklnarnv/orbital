import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ktx2LoaderFor } from '../iss/ktx2Loader'
import { uploadCompressedProgressively } from './progressiveUpload'
import { DEBUG_HOOKS, exposeDebugHook } from '@/utils/debugHooks'
import { EARTH_8K_TEXTURES } from './EarthConstants'
import {
  EARTH_DETAIL_START_DELAY_MS,
  applyEarthDetailOverride,
  decideEarthDetail,
  type EarthDetailCapabilities,
  type EarthDetailDecision,
} from './earthDetail'

interface MapUniforms {
  dayMap: { value: THREE.Texture | null }
  nightMap: { value: THREE.Texture | null }
}

/** Lifecycle of the 8K upgrade, exposed as `window.__orbitalEarthDetail` in dev/bench builds. */
export interface EarthDetailStatus {
  status: 'waiting' | 'skipped' | 'loading' | 'uploading' | 'ready' | 'failed'
  reason?: string
  /** performance.now() marks */
  loadStartedAt?: number
  loadedAt?: number
  swappedAt?: number
  /** Wall ms each map's progressive upload spanned (a few ms per frame) */
  uploadSpanMs?: number[]
}

function readCapabilities(gl: THREE.WebGLRenderer): EarthDetailCapabilities {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  const ext = gl.extensions
  return {
    maxTextureSize: gl.capabilities.maxTextureSize,
    finePointer: typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches,
    saveData: connection?.saveData === true,
    compressedFormat: ['EXT_texture_compression_bptc', 'WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_etc', 'WEBGL_compressed_texture_etc1']
      .some((name) => ext.has(name)),
  }
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))
const whenIdle = (): Promise<void> => new Promise((resolve) => {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 3000 })
  else setTimeout(resolve, 0)
})

/**
 * Call from EarthSurface, which only renders once its 4K maps have loaded
 * (Suspense); the start delay and an idle callback put the stream after the
 * Earth's first paint. On capable desktops (earthDetail.ts), stream
 * the 8K day and night maps as KTX2 and swap them into the surface shader.
 *
 * No hitch: the files transcode in the Basis workers, each map's mip chain
 * is uploaded at most 1 MiB per frame (progressiveUpload.ts), and both swap
 * together on one frame so the day and night sides never mix resolutions.
 * The 4K maps' GPU copies are released after the swap (their images stay
 * cached, so a remount re-uploads them). Any failure keeps the 4K maps.
 */
export function useEarthDetailUpgrade(uniforms: MapUniforms): void {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    const status: EarthDetailStatus = { status: 'waiting' }
    if (DEBUG_HOOKS) exposeDebugHook('__orbitalEarthDetail', status)

    let decision: EarthDetailDecision = decideEarthDetail(readCapabilities(gl))
    if (DEBUG_HOOKS) {
      decision = applyEarthDetailOverride(decision, (window as unknown as Record<string, unknown>).__orbitalEarth8k)
    }
    if (!decision.stream) {
      status.status = 'skipped'
      status.reason = decision.reason
      return
    }

    let cancelled = false
    let loaded: THREE.Texture[] = []
    let swapped = false

    const run = async (): Promise<void> => {
      await whenIdle()
      if (cancelled) return
      status.status = 'loading'
      status.loadStartedAt = performance.now()
      const loader = ktx2LoaderFor(gl)
      const results = await Promise.all([
        loader.loadAsync(EARTH_8K_TEXTURES.dayMap),
        loader.loadAsync(EARTH_8K_TEXTURES.nightMap),
      ])
      if (cancelled) {
        for (const texture of results) texture.dispose()
        return
      }
      loaded = results
      status.loadedAt = performance.now()
      status.status = 'uploading'
      const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
      for (const texture of loaded) {
        texture.wrapS = THREE.RepeatWrapping
        // Equirectangular maps wrap at the date line, never between opposite poles.
        texture.wrapT = THREE.ClampToEdgeWrapping
        texture.magFilter = THREE.LinearFilter
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.anisotropy = anisotropy
        texture.needsUpdate = true
        const t0 = performance.now()
        await uploadCompressedProgressively(gl, texture as THREE.CompressedTexture, { isCancelled: () => cancelled })
        if (cancelled) return
        ;(status.uploadSpanMs ??= []).push(Math.round(performance.now() - t0))
      }
      await nextFrame()
      if (cancelled) return
      const [day, night] = loaded
      const previous = [uniforms.dayMap.value, uniforms.nightMap.value]
      uniforms.dayMap.value = day
      uniforms.nightMap.value = night
      swapped = true
      status.swappedAt = performance.now()
      status.status = 'ready'
      // Release the 4K maps' GPU copies once the 8K maps have drawn a frame.
      await nextFrame()
      for (const texture of previous) texture?.dispose()
    }

    const timer = setTimeout(() => {
      run().catch((error: unknown) => {
        for (const texture of loaded) texture.dispose()
        loaded = []
        status.status = 'failed'
        status.reason = error instanceof Error ? error.message : String(error)
        console.warn('[EarthSurface] 8K maps unavailable; keeping 4K:', error)
      })
    }, EARTH_DETAIL_START_DELAY_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
      for (const texture of loaded) texture.dispose()
      if (swapped) {
        uniforms.dayMap.value = null
        uniforms.nightMap.value = null
      }
    }
  }, [gl, uniforms])
}
