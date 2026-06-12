/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        preview: resolve(import.meta.dirname, 'preview.html'),
        timelapse: resolve(import.meta.dirname, 'timelapse.html'),
        playground: resolve(import.meta.dirname, 'playground.html'),
        tree: resolve(import.meta.dirname, 'tree.html'),
        treeAr: resolve(import.meta.dirname, 'treeAr.html'),
      },
      output: {
        // Pull Three.js into its own vendor chunk so every HTML entry shares
        // it and dynamic-import fragments don't each carry a copy. Vite 8
        // bundles with Rolldown, whose `manualChunks` only takes the function
        // form; the Rollup-classic `{ three: ['three'] }` object throws
        // "manualChunks is not a function". The function is equivalent: route
        // anything under three's package into the `three` chunk.
        manualChunks: (id: string): string | undefined =>
          id.includes('/node_modules/three/') ? 'three' : undefined,
      },
    },
  },
});
