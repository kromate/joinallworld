import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  // Vue single-file components are used by the new shell only (next.html → src/app/main.ts); see docs/MIGRATION-VUE-TS.md.
  plugins: [vue()],
  server: {
    host: '127.0.0.1', port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001' },
      '/socket': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
  build: { rollupOptions: { input: { app: 'index.html', voiceTest: 'voice-test.html' }, output: { manualChunks: { three: ['three'] } } } },
});
