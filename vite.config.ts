import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  // The page is a Vue 3 + TypeScript application: index.html → src/app/main.ts (docs/MIGRATION-VUE-TS.md).
  plugins: [vue()],
  server: {
    host: '127.0.0.1', port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001' },
      '/socket': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
  // voice-test.html is a development fixture (served by `npm run dev` only): it is not a build input.
  // Hidden source maps: written next to the bundles for `npm run sentry:sourcemaps` to upload, with no reference to
  // them in the served files. They are never served (server/server.ts refuses .map; public/.assetsignore keeps them off the Worker).
  // Chunks (caching, and so that the browser fetches the pieces of the first load side by side — Vite adds a modulepreload link
  // for each static import of the entry):
  //   three   Three.js, fetched by the scene (never part of the first load);
  //   vue     the framework: changes with a Vue upgrade only;
  //   engine  the rules (src/game, src/life.ts, the campus rules): the shell builds and reads every life through them, so it is
  //           part of the first load, but it changes far less often than the shell.
  build: { sourcemap: 'hidden', rollupOptions: { input: { app: 'index.html' }, output: { manualChunks(id) {
    if (/node_modules\/three\//.test(id)) return 'three'
    if (/node_modules\/@?vue\/|node_modules\/vue\//.test(id)) return 'vue'
    if (/\/src\/(game\/|life\.ts$|campus\/unilag\/(student|games|shuttle|curriculum|content|layout|walk)\.ts$|tables\/places\.ts$|scene\/(movement|build)\.ts$)/.test(id)) return 'engine'
  } } } },
});
