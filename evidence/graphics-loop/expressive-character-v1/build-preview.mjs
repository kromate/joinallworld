import { build } from 'vite';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
const directory = 'evidence/graphics-loop/expressive-character-v1/results/preview';
await build({ configFile: false, root: process.cwd(), publicDir: false, base: './', build: { assetsInlineLimit: 1000000, outDir: directory, emptyOutDir: true, rollupOptions: { input: 'evidence/graphics-loop/expressive-character-v1/index.html' } } });
const entry = path.join(directory, 'evidence/graphics-loop/expressive-character-v1/index.html');
let html = readFileSync(entry, 'utf8');
html = html.replace(/<script\b([^>]*?)src="([^"]+)"([^>]*?)><\/script>/g, (_match, before, source, after) => {
  const code = readFileSync(path.resolve(path.dirname(entry), source), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script${before}${after}>${code}</script>`;
});
writeFileSync(path.join(directory, 'character-preview.html'), html);
const files = [];
function visit(folder) { for (const name of readdirSync(folder)) { const file = path.join(folder, name); if (statSync(file).isDirectory()) visit(file); else { const bytes = readFileSync(file); files.push({ path: path.relative(directory, file), raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length }); } } }
visit(directory);
writeFileSync('evidence/graphics-loop/expressive-character-v1/results/preview-bytes.json', JSON.stringify({ commit: process.env.GITHUB_SHA, files, note: 'Standalone comparison includes both baseline and candidate code. It is not the full-game release download or a cold player journey.' }, null, 2));
