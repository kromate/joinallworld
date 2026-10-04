import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '127.0.0.1', port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001' },
      '/socket': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
