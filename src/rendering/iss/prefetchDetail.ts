import { useLoadingStore } from '@/stores/loadingStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { LOCATE_MODEL_URL } from './modelUrls'

/**
 * Boot-idle warm for the fast Locate LOD.
 *
 * Locate is a primary feature, but the detail asset is deliberately deferred
 * until intent (hover/focus/near-range). A user who clicks Locate on a fresh
 * page therefore starts the download at click time; on a slow connection that
 * can exceed the 8 s departure gate. This warms the same URL into the HTTP
 * cache ~5 s after boot, so a later click is already warm.
 *
 * Deliberately a bare fetch, NOT useGLTF.preload: a failed preload fires the
 * DefaultLoadingManager error hook, which maps to the terminal "ISS
 * unavailable" state (plan 001 R4). Connection-gated, once per session, silent
 * on failure. The full high model is not prefetched — it loads on Inspect.
 */
const PREFETCH_DELAY_MS = 5_000

interface NetworkInformationLike {
  saveData?: boolean
  effectiveType?: string
}

function shouldPrefetch(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  if (navigator.onLine === false) return false
  // Only the high-fidelity setting has a Locate LOD to warm. Once any detail
  // tier is committed — or the first tier is already downloading/preparing —
  // the asset is already on its way or in memory.
  if (useSettingsStore.getState().issModelQuality !== 'high') return false
  const detail = useLoadingStore.getState().issDetail
  if (detail.activeQuality !== null) return false
  if (detail.status === 'loading' || detail.status === 'preparing') return false
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  if (connection?.saveData) return false
  if (connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return false
  return true
}

let prefetched = false

/** Fetch the Locate LOD into the HTTP cache once per page session. */
export async function prefetchLocateModel(): Promise<void> {
  if (prefetched || !shouldPrefetch()) return
  prefetched = true
  try {
    const response = await fetch(LOCATE_MODEL_URL, {
      cache: 'default',
      credentials: 'same-origin',
      // Chrome accepts `priority`; other engines ignore it.
      priority: 'low',
    } as RequestInit)
    if (!response.ok) return
    // Consume the body so the browser commits it to the HTTP cache. The LOD
    // is ~5 MiB; this is transient and never retained here.
    await response.arrayBuffer()
  } catch {
    // Silent: prefetch is an optimisation, never a user-visible state.
  }
}

/** Schedule the warm after boot; returns the cancel function for cleanup. */
export function scheduleLocatePrefetch(): () => void {
  if (typeof window === 'undefined') return () => {}
  const timer = window.setTimeout(() => { void prefetchLocateModel() }, PREFETCH_DELAY_MS)
  return () => window.clearTimeout(timer)
}
