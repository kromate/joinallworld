import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../');
const entry = path.join(here, 'rest-contact-review.ts');
const outfile = path.resolve(process.argv[2] ?? path.join(here, 'rest-contact-review.bundle.js'));
const result = await esbuild.build({
  entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'browser', target: ['es2022'],
  packages: 'bundle', sourcemap: false, legalComments: 'none', logLevel: 'silent',
  plugins: [{
    name: 'repository-static-asset-urls',
    setup(build) {
      build.onResolve({ filter: /\?url$/ }, (args) => {
        const asset = path.resolve(args.resolveDir, args.path.slice(0, -4));
        const relative = path.relative(repo, asset);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Viewer asset escaped repository root: ${args.path}`);
        return { path: asset, namespace: 'rest-review-static-url' };
      });
      build.onLoad({ filter: /.*/, namespace: 'rest-review-static-url' }, (args) => {
        const relative = path.relative(repo, args.path).split(path.sep).join('/');
        return { contents: `export default ${JSON.stringify(`/${relative}`)};`, loader: 'js' };
      });
    },
  }],
});
if (result.errors.length) throw new Error(result.errors.map((error) => error.text).join('\n'));
const { size } = await (await import('node:fs/promises')).stat(outfile);
console.log(JSON.stringify({ status: 'bundled', entry, outfile, bytes: size, runtime: 'browser', source: 'prepareNativeSkinnedBody' }));
