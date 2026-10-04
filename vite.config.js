import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '127.0.0.1', port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001' },
      '/socket': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
  // Hidden source maps: written next to the bundles for `npm run sentry:sourcemaps` to upload, with no reference to
  // them in the served files. They are never served (server/server.js refuses .map; public/.assetsignore keeps them off the Worker).
  build: { sourcemap: 'hidden', rollupOptions: { input: { app: 'index.html' }, output: { manualChunks: { three: ['three'] } } } },
});
