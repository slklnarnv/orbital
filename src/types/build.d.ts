/**
 * Build id stamped by `vite.config.ts` (`define`). Used to version the static
 * assets that are not content-hashed by Vite (/models, /textures, /draco), so
 * those routes can be served `immutable` for a year while a deploy still
 * busts the cache.
 */
declare const __BUILD_ID__: string
