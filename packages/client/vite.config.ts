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
      },
      output: {
        // Pull Three.js into its own vendor chunk so all three HTML entries
        // share it, and so dynamic-import fragments don't each carry a copy.
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
