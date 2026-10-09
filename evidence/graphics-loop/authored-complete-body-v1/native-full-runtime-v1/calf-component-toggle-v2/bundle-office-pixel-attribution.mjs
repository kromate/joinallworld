import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../');
const entry = path.join(here, 'office-pixel-attribution-v1.ts');
const output = path.join(here, 'office-pixel-attribution-v1.bundle.js');
const factory = path.join(here, '../native-prepared-factory-v29.ts');
const body = path.join(here, '../../authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb');
const pins = {
  factory: 'ecf30896371cdf65317894e5f2add34eb7679f0f8b9c5f72210457159f38f5e2',
  body: 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552',
};
for (const [label, file, expected] of [['factory', factory, pins.factory], ['body', body, pins.body]]) {
  const actual = createHash('sha256').update(await readFile(file)).digest('hex');
  if (actual !== expected) throw new Error(`${label} input SHA mismatch: ${actual}`);
}
await esbuild.build({
  entryPoints: [entry], outfile: output, bundle: true, format: 'esm', platform: 'browser', target: ['es2022'],
  packages: 'bundle', sourcemap: false, legalComments: 'none', logLevel: 'silent',
  plugins: [{ name: 'repo-static-asset-url', setup(build) {
    build.onResolve({ filter: /\?url$/ }, (args) => {
      const asset = path.resolve(args.resolveDir, args.path.slice(0, -4));
      const relative = path.relative(repo, asset);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Asset escaped repository: ${args.path}`);
      return { path: asset, namespace: 'pixel-attribution-asset' };
    });
    build.onLoad({ filter: /.*/, namespace: 'pixel-attribution-asset' }, (args) => {
      const relative = path.relative(repo, args.path).split(path.sep).join('/');
      return { contents: `export default ${JSON.stringify(`/${relative}`)};`, loader: 'js' };
    });
  } }],
});
console.log(JSON.stringify({ status: 'bundled', output, outputBytes: (await stat(output)).size, pins }, null, 2));
