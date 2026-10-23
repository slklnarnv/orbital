/**
 * Versioned URLs for the static assets Vite does not content-hash.
 *
 * `/models` and `/textures` are served from `/public` and therefore keep
 * their names across deploys. They are cached `immutable` for a year
 * (vercel.json), so the URL itself has to carry the build id — otherwise a
 * stale 20.5 MB model would outlive a deploy, and without `immutable` it
 * would be revalidated on an hourly basis instead.
 *
 * `/draco` is deliberately NOT in this scheme and stays revalidating:
 * `useGLTF.setDecoderPath` builds its own decoder URLs with no `?v=`, so an
 * immutable route would pin a stale decoder after an upgrade.
 *
 * `__BUILD_ID__` is injected by `vite.config.ts` (commit SHA on Vercel,
 * timestamp locally). One id per build means exactly one re-download after a
 * deploy and none in between.
 */
export function assetUrl(path: string): string {
  return `${path}?v=${__BUILD_ID__}`
}
