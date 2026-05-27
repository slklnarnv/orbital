import { EARTH_RADIUS_KM, ATMOSPHERE_RADIUS_FACTOR, CLOUD_RADIUS_FACTOR } from '@/utils/constants'

// ─── Earth Dimensions (km) ───────────────────────────────────────────────────
export const EARTH_RADIUS = EARTH_RADIUS_KM // 6371.0 km (1 world unit = 1 km)
export const CLOUD_RADIUS = EARTH_RADIUS * CLOUD_RADIUS_FACTOR // ~6390.1 km
export const ATMOSPHERE_RADIUS = EARTH_RADIUS * ATMOSPHERE_RADIUS_FACTOR // ~6530.3 km

// ─── Texture Resource URLs (All locally served) ───────────────────────────────
//
// All assets are served from /public/textures/ to:
//   1. Eliminate CORS restrictions on cross-origin textures
//   2. Remove CDN latency from the critical rendering path
//   3. Ensure deterministic asset availability offline
//
// Dataset provenance:
//   dayMap:   Three.js r128 earth_atmos_2048.jpg — NASA Blue Marble 2K (512 KB JPEG)
//             Higher encoding quality than NASA direct land_shallow_topo (238 KB)
//   nightMap: Three.js r128 earth_lights_2048.png — NASA Black Marble 2K (718 KB PNG)
//             Lossless PNG encoding preserves city light gradients without JPEG banding
//   cloudMap: NASA Earth Observatory record 57747 cloud_combined_2048.jpg (829 KB JPEG)
//             Continuous 2048×1024 grayscale cloud density field
//
export const EARTH_TEXTURES = {
  // NASA Blue Marble 8K Day Map (WebP) — locally served (no CDN latency, no CORS restriction)
  dayMap: '/textures/bluemarblewebp.webp',
  // NASA Black Marble 8K City Lights Map (WebP) — lossless WebP, locally served
  nightMap: '/textures/BlackMarblewebp.webp',
  // NASA Blue Marble 8K Cloud Density Map — locally served
  cloudMap: '/textures/8k_earth_clouds.jpg',
  // NASA Blue Marble 8K Ocean Specular Mask — locally served
  specularMap: '/textures/8k_earth_specular_map.png',
} as const
