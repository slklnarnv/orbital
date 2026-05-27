import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import glsl from 'vite-plugin-glsl'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    glsl({
      include: ['**/*.vert', '**/*.frag', '**/*.glsl'],
      compress: false,
    }),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    target: 'esnext',
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
