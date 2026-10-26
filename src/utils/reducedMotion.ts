/**
 * `prefers-reduced-motion: reduce`, read live: the MediaQueryList's
 * `matches` follows an OS toggle at once, so per-frame callers (the glint
 * pulse, the flare) and per-flight callers (camera flights) need no
 * listener. Built lazily and guarded, so importing this module never touches
 * `window` (unit tests run in node).
 */
let query: MediaQueryList | null | undefined

export function prefersReducedMotion(): boolean {
  if (query === undefined) {
    query = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
  }
  return query?.matches ?? false
}
