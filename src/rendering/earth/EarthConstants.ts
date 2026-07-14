import { EARTH_RADIUS_KM, ATMOSPHERE_RADIUS_FACTOR, CLOUD_RADIUS_FACTOR } from '@/utils/constants'

// ─── Earth Dimensions (km) ───────────────────────────────────────────────────
export const EARTH_RADIUS = EARTH_RADIUS_KM // 6371.0 km (1 world unit = 1 km)
export const CLOUD_RADIUS = EARTH_RADIUS * CLOUD_RADIUS_FACTOR // ~6390.1 km
export const ATMOSPHERE_RADIUS = EARTH_RADIUS * ATMOSPHERE_RADIUS_FACTOR // ~6530.3 km

// The Earth regularly fills a high-DPI viewport. This remains inexpensive compared
// with the fragment-heavy surface shaders, while avoiding a faceted planet/cloud limb.
export const EARTH_SPHERE_SEGMENTS = 128

// ─── Texture Resource URLs (All locally served) ───────────────────────────────
//
// All assets are served from /public/textures/ to:
//   1. Eliminate CORS restrictions on cross-origin textures
//   2. Remove CDN latency from the critical rendering path
//   3. Ensure deterministic asset availability offline
//
export const EARTH_TEXTURES = {
  dayMap: '/textures/earth-day-4k.webp',
  nightMap: '/textures/earth-night-4k.webp',
  cloudMap: '/textures/earth-clouds-4k.webp',
  specularMap: '/textures/earth-specular-4k.webp',
} as const
