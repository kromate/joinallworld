// Exact-input static package for a same-actor source/compact production-renderer A/B.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
const outputDir = path.join(here, 'static-fixture-market-gpu-v6');
const htmlPath = path.join(here, 'market-gpu.html');
const entryPath = path.join(here, 'viewer-market-gpu.ts');
const marketPath = path.join(projectRoot, 'evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json');
const htmlNeedle = '<script type="module" src="./viewer-market-gpu.ts"></script>';
const expected = new Map([
  ['evidence/graphics-loop/crowd-lod-market-v6/market-gpu.html', '4aedc9aa2c0ca6d6c7d000868ea118d0196691b2e7f04f8cffa286c1c406d672'],
  ['evidence/graphics-loop/crowd-lod-market-v6/viewer-market-gpu.ts', '3ae08f903e6797b2eaf8abf411c93c338a423ce352ff8207e4efe9459608232d'],
  ['evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json', 'b80d198dd2d0327258df6dee5fc3e180af887207fd77b88c1ccae63d4988ea4b'],
  ['src/scene/body/assets/base-body-male.glb', 'b0078206da9f7de0bf346be8133522cf514009f03f262f716613dd196d180686'],
  ['src/scene/body/assets/base-body-female.glb', '977ca5e73ba7b19af2627dab1ba0f0ef3e3d8548bf7b4d54f45faf22cd56001c'],
  ['src/scene/body/assets/clip-pack.glb', '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47'],
  ['src/scene/body/skinned.ts', '4fa64261e15a7e104f527ad4782aff2bb80c53d559dc7a448d95d797d92c6bdb'],
  ['src/scene/body/poses.ts', '7f328e67ec33d1c94516d76746635e45d8f90a01416176534fa0448d4e797d5e'],
  ['src/scene/kit.ts', 'c1d88627e7c4c7a9418c28f3e716215465e6c9fced1c4b85c5e44a4c751b064a'],
  ['src/scene/wardrobe/geometry.ts', '1b2dbfc4dd9557b6216eceb01ddd5f9bcf4119e48788a220589444902d5458ec'],
  ['src/scene/wardrobe/renderer.ts', '4b053592fdc8efdad0e9cd5071cb853594c2db53829cd74116bf578f439f82da'],
  ['src/scene/avatar-look.ts', 'cf65f259386708d80be763e0a068e1e767433a73978fd30a2fbf7b2bbd80c257'],
  ['src/game/wardrobe/rules.ts', '1f8bcbd76da268032f0f33dccf8318d218086679cb4aaf384581ec1f7854780d'],
]);
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
  const pinned = expected.get(relative);
  if (pinned && digest !== pinned) throw new Error(`Pinned input changed: ${relative}; expected ${pinned}, got ${digest}`);
  if (!pinned) throw new Error(`No explicit SHA guard for source ${relative}`);
  return { absolute, digest };
}

for (const relative of expected.keys()) await checkedSource(relative);
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
  status: 'static-packaging-only-not-visual-or-runtime-acceptance',
  projectRoot, outputDir,
  entry: path.relative(projectRoot, entryPath).split(path.sep).join('/'),
  sourceHtmlSha256: htmlHash,
  inputShaGuards: Object.fromEntries(expected),
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
