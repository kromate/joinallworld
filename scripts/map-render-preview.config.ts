import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Standalone QA bundle; it is not imported by the game entry or normal production build. */
export default defineConfig({
  root,
  base: './',
  build: {
    outDir: path.join(root, '.cache', 'render-evidence', 'preview-build'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: path.join(root, 'scripts', 'map-render-preview.html') },
  },
});
