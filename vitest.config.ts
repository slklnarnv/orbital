import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirrors vite.config.ts: `assetUrl` reads the build id at module scope, so
  // importing any module that builds a static URL needs it defined here too.
  define: {
    __BUILD_ID__: JSON.stringify('test'),
    __BASIS_ID__: JSON.stringify('test'),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
  },
})
