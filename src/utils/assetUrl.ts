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
 * `__BUILD_ID__` is injected by `vite.config.ts` as a hash of the bytes under
 * `/models` and `/textures` (not the commit SHA). It changes only when an
 * asset actually changes, so docs/code-only deploys keep the 20.5 MB model and
 * the Locate LOD warm in client caches; one asset change re-downloads them
 * once.
 */
export function assetUrl(path: string): string {
  return `${path}?v=${__BUILD_ID__}`
}
