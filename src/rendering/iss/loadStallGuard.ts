/**
 * Upper bound for one KTX2 texture of a detail GLB to settle. The textures
 * are embedded, so by the time they load the GLB is already downloaded; what
 * remains is the ~0.6 MB transcoder fetch, the worker wasm compile and the
 * transcodes themselves — seconds, even on slow devices and connections.
 */
export const KTX2_TEXTURE_STALL_MS = 30_000

export interface GuardedCallbacks<T> {
  onLoad: (value: T) => void
  onError: (error: unknown) => void
}

/**
 * Wrap a loader's completion callbacks so a load that never settles fails
 * after `timeoutMs` instead of hanging.
 *
 * A broken KTX2 transcoder does not reject: its worker swallows the init
 * failure and never answers, so the texture promise, the GLTF parse and the
 * detail model's Suspense all stay pending forever (the stranded "High
 * fidelity" spinner on the live site). Failing after a bound turns that into
 * an ordinary load error, which DetailModelErrorBoundary routes down the
 * reliability ladder. Exactly one callback ever fires.
 */
export function guardLoadStall<T>(
  onLoad: ((value: T) => void) | undefined,
  onError: ((error: unknown) => void) | undefined,
  timeoutMs: number,
  label: string,
): GuardedCallbacks<T> {
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    onError?.(new Error(`${label} did not settle within ${timeoutMs} ms`))
  }, timeoutMs)
  return {
    onLoad: (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      onLoad?.(value)
    },
    onError: (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      onError?.(error)
    },
  }
}
