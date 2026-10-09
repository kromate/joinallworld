import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'native-prepared-factory.ts');
const outfile = path.join(here, 'native-prepared-factory.bundle.mjs');
const result = await esbuild.build({
  entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node24',
  packages: 'external', write: true, logLevel: 'silent',
  plugins: [{
    name: 'file-url-assets',
    setup(build) {
      build.onResolve({ filter: /\?url$/ }, (args) => ({
        path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'file-url',
      }));
      build.onLoad({ filter: /.*/, namespace: 'file-url' }, (args) => ({
        contents: `export default ${JSON.stringify(pathToFileURL(args.path).href)};`, loader: 'js',
      }));
    },
  }],
});
if (result.errors.length) throw new Error(result.errors.map((error) => error.text).join('\n'));
const { size } = await (await import('node:fs/promises')).stat(outfile);
console.log(JSON.stringify({ status: 'bundled', outfile, bytes: size }));
