/**
 * Runtime diagnostics hooks (`window.__orbital*`) exist in dev builds and in
 * the bench build (`vite build --mode bench`, used by `npm run bench`), never
 * in production: `import.meta.env.MODE` is a build-time constant, so the
 * production bundle folds every guarded block away.
 */
export const DEBUG_HOOKS: boolean = import.meta.env.DEV || import.meta.env.MODE === 'bench'

export function exposeDebugHook(name: string, value: unknown): void {
  ;(window as unknown as Record<string, unknown>)[name] = value
}
