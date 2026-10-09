import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySnapshot } from './verify-snapshot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../../../..');
const FIXTURE = path.resolve(HERE, '..');
const DIST = path.join(HERE, 'dist');
const expected = process.argv[2];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const before = await verifySnapshot(expected);
const htmlPath = path.join(FIXTURE, 'index.html'), entryPath = path.join(FIXTURE, 'viewer.ts');
const htmlBytes = await readFile(htmlPath), htmlSha = sha(htmlBytes), html = htmlBytes.toString('utf8');
const needle = '<script type="module" src="./viewer.ts"></script>';
if (html.split(needle).length !== 2) throw new Error('Fixture HTML must have the exact viewer.ts module tag once');
const consumed = new Map();
const result = await build({
  absWorkingDir: ROOT, entryPoints: [entryPath], bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  outdir: DIST, entryNames: 'viewer', assetNames: 'assets/[name]-[hash]', loader: { '.glb': 'file' }, write: false,
  metafile: true, sourcemap: false, minify: false,
  plugins: [{ name: 'frozen-primary-source-and-GLB-resolution', setup(esbuild) {
    esbuild.onLoad({ filter: /\.(ts|mts|js|mjs|json|glb)$/ }, async args => {
      const data = await readFile(args.path); consumed.set(path.resolve(args.path), sha(data));
      const ext = path.extname(args.path), loader = ext === '.glb' ? 'file' : ext === '.json' ? 'json' : ext === '.ts' || ext === '.mts' ? 'ts' : 'js';
      return { contents: data, loader, resolveDir: path.dirname(args.path) };
    });
    esbuild.onResolve({ filter: /^\/src\// }, args => {
      const target = path.resolve(ROOT, args.path.slice(1)), rel = path.relative(ROOT, target);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Primary import escapes checkout: ${args.path}`);
      return { path: target };
    });
    esbuild.onResolve({ filter: /\.glb\?url$/ }, args => {
      const target = path.resolve(args.resolveDir, args.path.slice(0, -'?url'.length)), rel = path.relative(ROOT, target);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`GLB URL escapes checkout: ${args.path}`);
      return { path: target };
    });
  }}],
});
const manifestPaths = new Set(before.manifest.files.map(entry => path.resolve(ROOT, entry.path)));
for (const input of Object.keys(result.metafile.inputs)) {
  const absolute = path.isAbsolute(input) ? input : path.resolve(ROOT, input);
  const rel = path.relative(ROOT, absolute);
  if (!rel.startsWith('node_modules/') && !manifestPaths.has(absolute)) throw new Error(`Bundler followed an unpinned repo source: ${rel}`);
  const consumedHash = consumed.get(absolute);
  if (consumedHash && !rel.startsWith('node_modules/')) {
    const expectedEntry = before.manifest.files.find(entry => entry.path === rel.split(path.sep).join('/'));
    if (!expectedEntry || expectedEntry.sha256 !== consumedHash) throw new Error(`Bundler consumed bytes outside the frozen source hash: ${rel}`);
  }
}
await rm(DIST, { recursive: true, force: true });
for (const output of result.outputFiles) {
  const target = path.resolve(output.path);
  if (!target.startsWith(`${DIST}${path.sep}`)) throw new Error(`Unexpected build output path ${target}`);
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, output.contents);
}
const outputHtml = Buffer.from(html.replace(needle, '<script type="module" src="./viewer.js"></script>'));
await writeFile(path.join(DIST, 'index.html'), outputHtml);
const after = await verifySnapshot(expected);
if (JSON.stringify(before.sourceHashes) !== JSON.stringify(after.sourceHashes)) throw new Error('Frozen sources drifted during static bundle');
const outputs = [];
for (const file of result.outputFiles) outputs.push({ path: path.relative(DIST, file.path).split(path.sep).join('/'), bytes: file.contents.byteLength, sha256: sha(file.contents) });
outputs.push({ path: 'index.html', bytes: outputHtml.byteLength, sha256: sha(outputHtml) });
const record = { status: 'bundled-only-no-visual-acceptance', manifestSha256: expected, sourceHashes: after.sourceHashes, htmlSourceSha256: htmlSha,
  bundle: { platform: 'browser', format: 'esm', target: 'es2022', minify: false, loader: { '.glb': 'file' } },
  runtimeInputs: Object.keys(result.metafile.inputs).map(input => path.relative(ROOT, path.resolve(ROOT, input)).split(path.sep).join('/')).sort(), outputs, metafile: result.metafile };
await writeFile(path.join(DIST, 'build-manifest.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ status: record.status, dist: DIST, outputs, manifestSha256: expected }, null, 2));
