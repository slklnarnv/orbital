/**
 * Build id stamped by `vite.config.ts` (`define`): a content hash of the
 * versioned `.glb`/`.webp` assets Vite does not hash itself (/models,
 * /textures). It versions those URLs so the routes can be served `immutable`
 * for a year while a real asset change still busts the cache.
 */
declare const __BUILD_ID__: string

/**
 * Content hash of the self-hosted Basis transcoder (public/basis/*.js|wasm),
 * stamped by `vite.config.ts`; versions the transcoder URLs.
 */
declare const __BASIS_ID__: string
