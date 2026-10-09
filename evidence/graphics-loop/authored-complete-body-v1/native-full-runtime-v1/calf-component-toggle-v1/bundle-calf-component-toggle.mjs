import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../');
const entry = path.join(here, 'calf-component-toggle-v1.ts');
const output = path.join(here, 'calf-component-toggle-v1.js');
const factory = path.join(here, '../native-prepared-factory-v29.ts');
const factoryPin = 'ecf30896371cdf65317894e5f2add34eb7679f0f8b9c5f72210457159f38f5e2';
const factoryBytes = await readFile(factory);
const factoryHash = createHash('sha256').update(factoryBytes).digest('hex');
if (factoryHash !== factoryPin) throw new Error(`V29 factory snapshot mismatch: ${factoryHash}`);

const result = await esbuild.build({
  entryPoints: [entry], outfile: output, bundle: true, format: 'esm', platform: 'browser', target: ['es2022'],
  packages: 'bundle', sourcemap: false, legalComments: 'none', logLevel: 'silent',
  plugins: [{ name: 'repo-static-asset-url', setup(build) {
    build.onResolve({ filter: /\?url$/ }, (args) => {
      const asset = path.resolve(args.resolveDir, args.path.slice(0, -4));
      const relative = path.relative(repo, asset);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Asset escaped repository: ${args.path}`);
      return { path: asset, namespace: 'calf-review-asset' };
    });
    build.onLoad({ filter: /.*/, namespace: 'calf-review-asset' }, (args) => {
      const relative = path.relative(repo, args.path).split(path.sep).join('/');
      return { contents: `export default ${JSON.stringify(`/${relative}`)};`, loader: 'js' };
    });
  } }],
});
if (result.errors.length) throw new Error(result.errors.map((error) => error.text).join('\n'));
const outputBytes = (await stat(output)).size;
console.log(JSON.stringify({ status: 'bundled', output, outputBytes, factory, factorySha256: factoryHash }, null, 2));
