import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import glsl from 'vite-plugin-glsl'

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

export default defineConfig({
  plugins: [
    react(),
    devApiTle(),
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
