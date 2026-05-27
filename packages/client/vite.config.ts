/// <reference types="vitest" />
import { defineConfig, type PluginOption } from 'vite';
import { resolve } from 'node:path';

// mkcert installs a system-level CA and issues a dev cert so the dev server
// speaks HTTPS — required by WebXR when the page is loaded from anything
// other than localhost (e.g. a Quest 3 hitting the Mac's LAN IP). Gated on
// VITE_ENABLE_MKCERT=1 so vitest runs and CI builds don't try to install a
// CA into the keychain (which requires sudo and is destructive in CI).
//
// The import is dynamic, not top-level: vite-plugin-mkcert transitively
// loads undici@8 at module init, which requires Node 22+. CI uses Node 20.
// A static import would load undici unconditionally and crash builds even
// when the plugin isn't activated. The dynamic import only runs when the
// env flag is set, on a developer machine with a newer Node.
//
// To enable for headset-on-LAN dev: VITE_ENABLE_MKCERT=1 pnpm dev:client
const useMkcert = process.env.VITE_ENABLE_MKCERT === '1';

export default defineConfig(async () => {
  const plugins: PluginOption[] = [];
  if (useMkcert) {
    const { default: mkcert } = await import('vite-plugin-mkcert');
    plugins.push(mkcert());
  }
  return {
    plugins,
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
          quest: resolve(import.meta.dirname, 'quest.html'),
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
  };
});
