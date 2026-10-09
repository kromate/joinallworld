import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.env.ALLWORLD_INTEGRATION_ROOT ?? process.cwd());
const entry = path.join(here, 'game-fixture.ts');
const outfile = path.resolve(process.argv[2] ?? path.join(here, 'game-fixture.bundle.js'));
await stat(path.join(repo, 'src/scene/body/provider.ts')).catch(() => {
  throw new Error(`Run the remote overlay bundle from the frozen 3af checkout after staging native files: ${repo}`);
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
    name: '3af-overlay-static-asset-urls',
    setup(build) {
      build.onResolve({ filter: /\?url$/ }, (args) => {
        const asset = path.resolve(args.resolveDir, args.path.slice(0, -4));
        const relative = path.relative(repo, asset);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Fixture asset escaped frozen repository: ${args.path}`);
        return { path: asset, namespace: 'native-game-static-url' };
      });
      build.onLoad({ filter: /.*/, namespace: 'native-game-static-url' }, (args) => {
        const relative = path.relative(repo, args.path).split(path.sep).join('/');
        return { contents: `export default ${JSON.stringify(`/${relative}`)};`, loader: 'js' };
      });
    },
  }],
});
if (result.errors.length) throw new Error(result.errors.map((error) => error.text).join('\n'));
const { size } = await stat(outfile);
console.log(JSON.stringify({ status: 'bundled', repo, entry, outfile, bytes: size, sourceScene: 'src/scene/venue-scenes.ts', sourceStandIn: 'src/scene/body/stand-in.ts' }));
