import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.env.ALLWORLD_INTEGRATION_ROOT ?? process.cwd());
const sourcePath = path.join(here, 'game-fixture.ts');
const source = await readFile(sourcePath, 'utf8');
function expression(name) {
  const marker = `const ${name} = `, start = source.indexOf(marker);
  if (start < 0) throw new Error(`Exact game fixture is missing ${name}`);
  const valueStart = start + marker.length;
  let depth = 0, quote = '', escaped = false;
  for (let i = valueStart; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (char === ';' && depth === 0) return source.slice(valueStart, i).trim();
  }
  throw new Error(`Could not extract exact game fixture ${name}`);
}
const seed = expression('PLAYER_SEED'), look = expression('PLAYER_LOOK');
if (!/^['"][^'"]+['"]$/.test(seed) || !look.startsWith('Object.freeze(')) throw new Error('Unexpected saved game identity source shape');
const input = path.join(here, 'idle-pose-input.ts');
await writeFile(input, `export const GAME_PLAYER_SEED = ${seed};\nexport const GAME_PLAYER_LOOK = ${look} as Readonly<Record<string, unknown>>;\n`);
const pinned = [
  'evidence/graphics-loop/native-game-adoption-v1/game-fixture.ts',
  'evidence/graphics-loop/native-game-adoption-v1/owned-src/src/scene/body/native/native-full-runtime-v1/native-prepared-factory.ts',
  'src/scene/body/assets/clip-pack.glb',
  'evidence/graphics-loop/native-game-adoption-v1/owned-src/src/scene/body/native/authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb',
  'evidence/graphics-loop/native-game-adoption-v1/owned-src/src/scene/body/native/authored-clothing/out/male_casualsuit01.glb',
  'evidence/graphics-loop/native-game-adoption-v1/owned-src/src/scene/body/native/authored-hair/out/short02-mobile.glb',
  'evidence/graphics-loop/native-game-adoption-v1/owned-src/src/scene/body/native/authored-footwear/out/shoes01-mobile.glb',
];
const files = {};
for (const relative of pinned) {
  const bytes = await readFile(path.join(repo, relative));
  files[relative] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const manifestPath = path.join(here, 'idle-pose-diagnostic-input-manifest.json');
await writeFile(manifestPath, JSON.stringify({ schema: 'native-idle-diagnostic-inputs-v1', status: 'remote-run-required', files }, null, 2));
const outfile = path.resolve(process.argv[2] ?? path.join(here, 'idle-pose-diagnostic.bundle.js'));
const result = await esbuild.build({ absWorkingDir: repo, entryPoints: [path.join(here, 'idle-pose-diagnostic.ts')], outfile,
  bundle: true, format: 'esm', platform: 'browser', target: ['es2022'], packages: 'bundle', splitting: false,
  sourcemap: false, legalComments: 'none', logLevel: 'silent', plugins: [{
    name: '3af-idle-diagnostic-static-asset-urls',
    setup(build) {
      build.onResolve({ filter: /\?url$/ }, (args) => {
        const asset = path.resolve(args.resolveDir, args.path.slice(0, -4));
        const relative = path.relative(repo, asset);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Static asset escaped checkout: ${args.path}`);
        return { path: asset, namespace: 'idle-diagnostic-url' };
      });
      build.onLoad({ filter: /.*/, namespace: 'idle-diagnostic-url' }, (args) => {
        const relative = path.relative(repo, args.path).split(path.sep).join('/');
        return { contents: `export default ${JSON.stringify(`/${relative}`)};`, loader: 'js' };
      });
    },
  }] });
if (result.errors.length) throw new Error(result.errors.map((error) => error.text).join('\n'));
console.log(JSON.stringify({ status: 'bundled', entry: path.relative(repo, path.join(here, 'idle-pose-diagnostic.ts')),
  output: path.relative(repo, outfile), bytes: (await stat(outfile)).size, manifest: path.relative(repo, manifestPath), files }));
