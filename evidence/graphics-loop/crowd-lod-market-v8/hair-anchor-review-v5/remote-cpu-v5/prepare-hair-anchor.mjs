// Exact-input floor-reference A/B package for the same-actor production renderer.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../../../..');
const outputDir = path.join(here, 'static-fixture-market-hair-anchor-v5');
const htmlPath = path.resolve(here, '../index.html');
const entryPath = path.resolve(here, '../viewer-hair-anchor-v5.ts');
const marketPath = path.join(projectRoot, 'evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json');
const htmlNeedle = '<script type="module" src="./viewer-hair-anchor-v5.ts"></script>';
const closurePath = path.join(here, 'production-import-closure.json');
const sourcePinsPath = path.join(here, 'source-pins.json');
const sourcePins = JSON.parse((await readFile(sourcePinsPath, 'utf8')));
if (sourcePins.schema !== 'allworld-v8-hair-anchor-v5-explicit-source-pins-v1' || !Array.isArray(sourcePins.inputs)) throw new Error('Unexpected explicit source pin manifest');
const closureBytes = await readFile(closurePath);
const closure = JSON.parse(closureBytes.toString('utf8'));
if (closure.schema !== 'allworld-v8-hair-anchor-v5-import-closure-v1'
  || closure.entry !== 'evidence/graphics-loop/crowd-lod-market-v8/hair-anchor-review-v5/viewer-hair-anchor-v5.ts') {
  throw new Error('Unexpected production import-closure pin');
}
const expected = new Map();
const expectedBytes = new Map();
function addExpected(item, source) {
  if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isInteger(item.bytes) || item.bytes < 0) throw new Error(`Malformed ${source} pin`);
  const oldSha = expected.get(item.path), oldBytes = expectedBytes.get(item.path);
  if (oldSha && oldSha !== item.sha256) throw new Error(`Conflicting explicit/import-closure SHA pins for ${item.path}: ${oldSha} vs ${item.sha256}`);
  if (oldBytes !== undefined && oldBytes !== item.bytes) throw new Error(`Conflicting explicit/import-closure byte lengths for ${item.path}`);
  expected.set(item.path, item.sha256); expectedBytes.set(item.path, item.bytes);
}
for (const item of sourcePins.inputs) {
  if (expected.has(item.path)) throw new Error(`Duplicate explicit source pin: ${item.path}`);
  addExpected(item, 'explicit source');
}
for (const item of [...closure.runtimeFiles, ...closure.typeOnlyFiles, ...closure.fixtureRuntimeFiles]) addExpected(item, 'import closure');
const consumedHashes = new Map();

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function assertWithinRoot(file) {
  const relative = path.relative(projectRoot, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Resolved path escaped project root: ${file}`);
}
async function checkedSource(relative) {
  const absolute = path.resolve(projectRoot, relative);
  assertWithinRoot(absolute);
  const digest = await sha256File(absolute);
  const actualBytes = (await stat(absolute)).size;
  const pinned = expected.get(relative);
  if (pinned && digest !== pinned) throw new Error(`Pinned input changed: ${relative}; expected ${pinned}, got ${digest}`);
  if (expectedBytes.has(relative) && actualBytes !== expectedBytes.get(relative)) throw new Error(`Pinned byte count changed: ${relative}; expected ${expectedBytes.get(relative)}, got ${actualBytes}`);
  if (!pinned) throw new Error(`No explicit/import-closure SHA guard for source ${relative}`);
  return { absolute, digest };
}

for (const relative of expected.keys()) await checkedSource(relative);
for (const item of [...closure.runtimeFiles, ...closure.typeOnlyFiles, ...closure.fixtureRuntimeFiles]) {
  if (expected.get(item.path) !== item.sha256) throw new Error(`Closure hash disagrees with source pins for ${item.path}`);
}
const builderPath = fileURLToPath(import.meta.url);
const builderShaAtStart = await sha256File(builderPath);
const htmlBytes = await readFile(htmlPath);
const htmlHash = sha256(htmlBytes);
const html = htmlBytes.toString('utf8');
if (html.split(htmlNeedle).length !== 2) throw new Error('Metric-reviewed HTML must contain its exact TypeScript entry once');

const result = await build({
  absWorkingDir: projectRoot,
  entryPoints: [entryPath], bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  outdir: outputDir, entryNames: 'viewer', assetNames: 'assets/[name]-[hash]',
  define: { __HAIR_CANDIDATE_SHA256__: JSON.stringify(expected.get('evidence/graphics-loop/crowd-lod-market-v8/hair-anchor-review-v5/geometry-hair-anchor-v5.ts')) },
  loader: { '.glb': 'file' }, write: false, metafile: true, sourcemap: false,
  plugins: [{
    name: 'strict-primary-src-glb-and-raw-source',
    setup(esbuild) {
      // Vite's ?raw imports are source strings; explicitly embed only the exact resolved file.
      esbuild.onResolve({ filter: /^\/src\/.*\?raw$/ }, (args) => {
        const sourcePath = args.path.replace(/\?raw$/, '').slice(1);
        const absolute = path.resolve(projectRoot, sourcePath);
        assertWithinRoot(absolute);
        return { path: absolute, namespace: 'exact-source-raw' };
      });
      esbuild.onLoad({ filter: /.*/, namespace: 'exact-source-raw' }, async (args) => {
        const bytes = await readFile(args.path);
        consumedHashes.set(args.path, sha256(bytes));
        return { contents: `export default ${JSON.stringify(bytes.toString('utf8'))};`, loader: 'js', resolveDir: path.dirname(args.path) };
      });
      esbuild.onLoad({ filter: /\.(ts|mts|js|mjs|json|glb)$/ }, async (args) => {
        const bytes = await readFile(args.path);
        consumedHashes.set(args.path, sha256(bytes));
        const extension = path.extname(args.path);
        const loader = extension === '.glb' ? 'file' : extension === '.json' ? 'json'
          : extension === '.ts' || extension === '.mts' ? 'ts' : 'js';
        return { contents: bytes, loader, resolveDir: path.dirname(args.path) };
      });
      esbuild.onResolve({ filter: /^\.\/geometry\.ts$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, args.path);
        if (resolved === path.join(projectRoot, 'src/scene/wardrobe/geometry.ts')) return { path: path.resolve(here, '../geometry-hair-anchor-v5.ts') };
      });
      esbuild.onResolve({ filter: /^\/src\// }, (args) => {
        const absolute = path.resolve(projectRoot, args.path.slice(1));
        assertWithinRoot(absolute);
        return { path: absolute };
      });
      esbuild.onResolve({ filter: /\.glb\?url$/ }, (args) => {
        const relativeAsset = args.path.slice(0, -'?url'.length);
        const absolute = path.resolve(args.resolveDir, relativeAsset);
        assertWithinRoot(absolute);
        return { path: absolute };
      });
    },
  }],
});

for (const item of closure.runtimeFiles) {
  const absolute = path.resolve(projectRoot, item.path);
  if (!consumedHashes.has(absolute)) throw new Error(`Esbuild did not consume runtime import-closure source ${item.path}`);
}
const candidateGeometryPath = 'evidence/graphics-loop/crowd-lod-market-v8/hair-anchor-review-v5/geometry-hair-anchor-v5.ts';
const rendererInput = result.metafile.inputs['src/scene/wardrobe/renderer.ts'];
if (!consumedHashes.has(path.resolve(projectRoot, candidateGeometryPath))
  || !Object.prototype.hasOwnProperty.call(result.metafile.inputs, candidateGeometryPath)
  || !rendererInput?.imports?.some(item => item.path === candidateGeometryPath)) {
  throw new Error('Wardrobe renderer did not resolve through the exact same candidate geometry module imported by the viewer');
}

const inventoryBytes = await readFile(marketPath);
if (sha256(inventoryBytes) !== expected.get('evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json')) {
  throw new Error('Exact frozen Market inventory changed during preparation');
}
const emittedHtml = html.replace(htmlNeedle, '<script type="module" src="./viewer.js"></script>');
const inventoryOut = 'assets/candidate-market-day-12.json';
const outputRecords = result.outputFiles.map((output) => ({
  path: path.relative(outputDir, output.path).split(path.sep).join('/'),
  bytes: output.contents.byteLength, sha256: sha256(output.contents),
}));
outputRecords.push({ path: 'index.html', bytes: Buffer.byteLength(emittedHtml), sha256: sha256(Buffer.from(emittedHtml)) });
outputRecords.push({ path: inventoryOut, bytes: inventoryBytes.byteLength, sha256: sha256(inventoryBytes) });

const bodyRoutes = {};
for (const [route, digest] of [
  ['/src/scene/body/assets/base-body-male.glb', expected.get('src/scene/body/assets/base-body-male.glb')],
  ['/src/scene/body/assets/base-body-female.glb', expected.get('src/scene/body/assets/base-body-female.glb')],
]) {
  const emitted = outputRecords.find((record) => record.path.startsWith('assets/base-body-') && record.sha256 === digest);
  if (!emitted) throw new Error(`Bundled real body asset missing for exact route ${route}`);
  bodyRoutes[route] = { file: emitted.path, sha256: emitted.sha256 };
}
const routes = {
  '/': { file: 'index.html', sha256: sha256(Buffer.from(emittedHtml)) },
  ...Object.fromEntries(outputRecords.map((record) => [`/${record.path}`, { file: record.path, sha256: record.sha256 }])),
  '/evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json': {
    file: inventoryOut, sha256: sha256(inventoryBytes),
  },
  ...bodyRoutes,
};
const inputHashes = {};
for (const [absolute, consumed] of consumedHashes) {
  assertWithinRoot(absolute);
  if (consumed !== await sha256File(absolute)) throw new Error(`Input changed while bundling: ${absolute}`);
  inputHashes[path.relative(projectRoot, absolute).split(path.sep).join('/')] = consumed;
}
for (const [relative, digest] of expected) {
  const absolute = path.resolve(projectRoot, relative);
  if (consumedHashes.has(absolute) && consumedHashes.get(absolute) !== digest) {
    throw new Error(`Bundled bytes violate pinned SHA guard: ${relative}`);
  }
  inputHashes[relative] = digest;
}
if (await sha256File(builderPath) !== builderShaAtStart) throw new Error('Static builder source changed during packaging');

// Writes are constrained to this private ignored output directory and happen only after all build/hash checks.
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
for (const output of result.outputFiles) {
  const target = path.resolve(output.path);
  if (!target.startsWith(`${outputDir}${path.sep}`)) throw new Error(`Unexpected esbuild output path: ${target}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, output.contents);
}
await writeFile(path.join(outputDir, 'index.html'), emittedHtml);
await mkdir(path.join(outputDir, 'assets'), { recursive: true });
await writeFile(path.join(outputDir, inventoryOut), inventoryBytes);
for (const record of outputRecords) {
  const file = path.resolve(outputDir, record.path);
  if (!file.startsWith(`${outputDir}${path.sep}`)) throw new Error(`Static asset escaped output folder: ${file}`);
  if (await sha256File(file) !== record.sha256) throw new Error(`Streamed output SHA mismatch: ${record.path}`);
}
const manifest = {
  status: 'hair-anchor-source-candidate-exact-compact-diagnostic-package-only-not-visual-or-runtime-acceptance',
  projectRoot, outputDir,
  entry: path.relative(projectRoot, entryPath).split(path.sep).join('/'),
  sourceHtmlSha256: htmlHash,
  inputShaGuards: Object.fromEntries(expected),
  sourcePinsSha256: await sha256File(sourcePinsPath),
  inputs: inputHashes,
  builderSha256: builderShaAtStart,
  outputs: outputRecords,
  staticServer: { denyAllUnlistedPaths: true, routes, rationale: 'Only the pinned Market inventory and the two exact real source body-GLB routes are fetched dynamically. Clip/body ?url assets are ordinary content-hashed bundle outputs.' },
  executionBudget: { recommendedGroup: 'heavy', memoryLimitMiB: 220, bundleWriteScope: path.relative(projectRoot, outputDir).split(path.sep).join('/') },
  esbuild: result.metafile,
};
await writeFile(path.join(outputDir, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: manifest.status, outputDir, inputs: Object.keys(inputHashes).length,
  outputs: outputRecords, routes: Object.keys(routes), manifest: path.join(outputDir, 'build-manifest.json') }, null, 2));
