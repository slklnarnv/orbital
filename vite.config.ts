import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import glsl from 'vite-plugin-glsl'
import { computeAssetBuildId } from './scripts/asset-build-id.mjs'

/**
 * Dev parity for the Vercel function: `vite dev` serves `/api/tle` through
 * the real handler in api/tle.ts (loaded via Vite's SSR loader, so it gets
 * HMR and no config-bundling coupling). Without this, every dev session
 * exercised only the browser fallback path and logged a bogus proxy failure.
 * Not applied to `vite build`/`preview`; production uses Vercel's runtime.
 */
function devApiTle(): Plugin {
  return {
    name: 'orbital-dev-api-tle',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (url !== '/api/tle' && !url.startsWith('/api/tle?')) return next()
        try {
          const mod = await server.ssrLoadModule('/api/tle.ts')
          const method = req.method ?? 'GET'
          const handler = mod[method] ?? mod.GET
          const response: Response = await handler(
            new Request(`http://${req.headers.host ?? 'localhost'}${url}`, { method }),
          )
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * Production-header parity for `vite preview`: serves the catch-all headers
 * from vercel.json — above all the Content-Security-Policy. The preview once
 * loaded the IGOAL model fine while the live CSP (no 'unsafe-eval') hung the
 * KTX2 transcoder workers, because preview sent no CSP at all. Dev keeps no
 * CSP (Vite's HMR client needs inline/eval).
 */
function previewProductionHeaders(): Plugin {
  interface VercelHeaderRule { source: string; headers: Array<{ key: string; value: string }> }
  const config = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
    headers?: VercelHeaderRule[]
  }
  const headers = config.headers?.find((rule) => rule.source === '/(.*)')?.headers ?? []
  return {
    name: 'orbital-preview-production-headers',
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const { key, value } of headers) res.setHeader(key, value)
        next()
      })
    },
  }
}

/**
 * Build id stamped onto the non-content-hashed static assets (/models,
 * /textures). Those routes are served `immutable` for a year, so a deploy has
 * to change the URL to bust the cache: `?v=<id>`.
 *
 * The id hashes the versioned `.glb`/`.webp` BYTES, not the commit SHA and not
 * helper files under those directories: docs/code-only deploys then keep the
 * 20.5 MB high model and the Locate LOD warm in client caches, while any real
 * asset change still changes every URL. Restricting the extension also keeps
 * the id stable across checkouts with different line-ending settings (a
 * README under /textures once produced two ids for the same commit).
 * See scripts/asset-build-id.mjs.
 */
const BUILD_ID = (() => {
  try {
    return computeAssetBuildId(root)
  } catch {
    // A missing asset tree must not break a config load; fall back to the
    // deployment identity or a build timestamp.
    return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? Date.now().toString(36)
  }
})()

/**
 * Content hash of the Basis transcoder files: KTX2Loader fetches them by
 * fixed names, so the URLs carry `?v=<id>` (src/rendering/iss/
 * basisTranscoderUrl.ts) and `/basis/` can be served immutable. The .js is
 * checked out LF everywhere (.gitattributes), so the id is the same on every
 * machine.
 */
const BASIS_ID = (() => {
  try {
    return computeAssetBuildId(root, { dirs: ['public/basis'], extensions: /\.(js|wasm)$/i })
  } catch {
    return BUILD_ID
  }
})()

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BASIS_ID__: JSON.stringify(BASIS_ID),
  },
  plugins: [
    react(),
    devApiTle(),
    previewProductionHeaders(),
    tailwindcss(),
    glsl({
      include: ['**/*.vert', '**/*.frag', '**/*.glsl'],
      minify: false,
    }),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    target: 'esnext',
    // three alone is ~690 kB minified and is already isolated in its own
    // cached chunk; the default 500 kB warning fired on every build.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three'],
          'r3f-core': ['@react-three/fiber', '@react-three/drei'],
          'orbital': ['satellite.js'],
        },
      },
    },
  },
})
