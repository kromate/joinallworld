import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../');
const entry = path.join(here, 'office-torso-mask-ab.ts');
const outfile = path.join(here, 'office-torso-mask-ab.bundle.js');
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
        return { path: asset, namespace: 'office-torso-static-url' };
      });
      build.onLoad({ filter: /.*/, namespace: 'office-torso-static-url' }, (args) => {
        const relative = path.relative(repo, args.path).split(path.sep).join('/');
        return { contents: `export default ${JSON.stringify(`/${relative}`)};`, loader: 'js' };
      });
    },
  }],
});
if (result.errors.length) throw new Error(result.errors.map((error) => error.text).join('\n'));
const bytes = (await import('node:fs/promises')).stat(outfile).then((value) => value.size);
console.log(JSON.stringify({ status: 'bundled', entry, outfile, bytes: await bytes, assets: 'actual prepared factory + pinned source body/index + source hide maps' }));
