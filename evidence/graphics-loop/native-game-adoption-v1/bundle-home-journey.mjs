import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.env.ALLWORLD_INTEGRATION_ROOT ?? process.cwd());
const entry = path.join(here, 'home-journey.ts');
const outfile = path.resolve(process.argv[2] ?? path.join(here, 'home-journey.bundle.js'));
await stat(path.join(repo, 'src/scene/home-scene.ts')).catch(() => {
  throw new Error(`Run the home journey bundle from the frozen 3af checkout after staging the source overlay: ${repo}`);
});

const result = await esbuild.build({
  absWorkingDir: repo,
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  packages: 'bundle',
  splitting: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'silent',
  plugins: [{
    name: '3af-home-static-asset-urls',
    setup(build) {
      build.onResolve({ filter: /\?url$/ }, (args) => {
        const asset = path.resolve(args.resolveDir, args.path.slice(0, -4));
        const relative = path.relative(repo, asset);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Fixture asset escaped frozen repository: ${args.path}`);
        return { path: asset, namespace: 'native-home-static-url' };
      });
      build.onLoad({ filter: /.*/, namespace: 'native-home-static-url' }, (args) => {
        const relative = path.relative(repo, args.path).split(path.sep).join('/');
        return { contents: `export default ${JSON.stringify(`/${relative}`)};`, loader: 'js' };
      });
    },
  }],
});
if (result.errors.length) throw new Error(result.errors.map((error) => error.text).join('\n'));
const { size } = await stat(outfile);
console.log(JSON.stringify({ status: 'bundled', repo, entry, outfile, bytes: size,
  sourceScene: 'src/scene/home-scene.ts', provider: 'src/scene/body/provider.ts', sourceSupport: 'src/scene/body/native-scene-support.ts' }));
