/**
 * Build id stamped by `vite.config.ts` (`define`): a content hash of the
 * static assets Vite does not hash itself (/models, /textures). It versions
 * those URLs so the routes can be served `immutable` for a year while a real
 * asset change still busts the cache.
 */
declare const __BUILD_ID__: string
