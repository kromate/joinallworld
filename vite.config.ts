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
  // them in the served files. They are never served (server/server.js refuses .map; public/.assetsignore keeps them off the Worker).
  build: { sourcemap: 'hidden', rollupOptions: { input: { app: 'index.html' }, output: { manualChunks: { three: ['three'] } } } },
});
