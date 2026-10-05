import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const wantMaps = process.env.SOURCEMAPS === '1';
const MAPS_DIR = 'dist-maps';

/** With SOURCEMAPS=1: move every .map out of the build output into dist-maps/, keeping its path under dist/ (dist/assets/x.js.map -> dist-maps/assets/x.js.map). */
function moveMaps(): Plugin {
  let outDir = '';
  return {
    name: 'allworld:move-source-maps',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    writeBundle() {
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const from = join(dir, entry.name);
          if (entry.isDirectory()) walk(from);
          else if (entry.name.endsWith('.map')) {
            const to = join(dirname(outDir), MAPS_DIR, from.slice(outDir.length + 1));
            mkdirSync(dirname(to), { recursive: true });
            renameSync(from, to);
          }
        }
      };
      walk(outDir);
    },
  };
}

export default defineConfig({
  // The page is a Vue 3 + TypeScript application: index.html → src/app/main.ts (docs/MIGRATION-VUE-TS.md).
  plugins: [vue(), ...(wantMaps ? [moveMaps()] : [])],
  // Every shipped component uses Composition API; omit the unused Options API runtime.
  define: { __VUE_OPTIONS_API__: false },
  server: {
    host: '127.0.0.1', port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001' },
      '/socket': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
  // voice-test.html is a development fixture (served by `npm run dev` only): it is not a build input.
  // Source maps are opt-in: `SOURCEMAPS=1 npm run build` writes hidden maps (no sourceMappingURL in the served files) to dist-maps/,
  // outside dist/, for `npm run sentry:sourcemaps` to upload. The default build emits none, so nothing under dist/ is a map: the release
  // package admits no .map file, and a bundle never points at a map that is not there.
  // Chunks (caching, and so that the browser fetches the pieces of the first load side by side — Vite adds a modulepreload link
  // for each static import of the entry):
  //   three   Three.js, fetched by the scene (never part of the first load);
  //   vue     the framework: changes with a Vue upgrade only;
  //   engine  the rules (src/game, src/life.ts, the campus rules): the shell builds and reads every life through them, so it is
  //           part of the first load, but it changes far less often than the shell.
  build: { minify: 'terser', terserOptions: { ecma: 2020, compress: { passes: 3 }, format: { comments: false } }, sourcemap: wantMaps ? 'hidden' : false, rollupOptions: { input: { app: 'index.html' }, output: { onlyExplicitManualChunks: true, manualChunks(id) {
    if (id === '\0vite/preload-helper.js') return 'vue'
    const cityFile = id.match(/\/src\/game\/cities\/([^/]+)\/([^/]+)\.ts$/)
    if (cityFile) {
      const [, city, file] = cityFile
      if (file === 'index' || file === 'rules' || file === 'links') return 'engine'
      if (file === 'map' || file === 'mapOverview' || file === 'geometry') return `city-${city}-map`
      if (file === 'landmarks' || file === 'rail') return `city-${city}-${file}`
      return `city-${city}-content`
    }
    if (/\/src\/game\/content\/venues-transport\.ts$|\/src\/campus\/unilag\/content\.ts$/.test(id)) return 'city-lagos-content'
    if (/node_modules\/three\//.test(id)) return 'three'
    if (/node_modules\/@?vue\/|node_modules\/vue\//.test(id)) return 'vue'
    if (/\/src\/(game\/|life\.ts$|campus\/unilag\/(student|games|shuttle|curriculum|trail|layout|walk)\.ts$|tables\/places\.ts$|scene\/walk-grid\.ts$)/.test(id)) return 'engine'
  } } } },
});
