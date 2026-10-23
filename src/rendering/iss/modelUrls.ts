import { assetUrl } from '@/utils/assetUrl'

/**
 * Runtime URLs for the deferred ISS assets, in one place so the renderer and
 * the prefetch path cannot drift. `assetUrl` appends the build id; the file
 * names themselves are stable across deploys (immutable caching, vercel.json).
 */
export const HIGH_MODEL_URL = assetUrl('/models/iss_igoal.glb')
export const LOCATE_MODEL_URL = assetUrl('/models/iss_igoal_locate.glb')
export const LEGACY_MODEL_URL = assetUrl('/models/international_space_station.glb')
export const FALLBACK_MODEL_URL = assetUrl('/models/International Space Station (ISS) (A).glb')
