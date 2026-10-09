import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../');
const entry = path.join(here, 'clothing-body-shoe-ab-v7.ts');
const output = path.join(here, 'clothing-body-shoe-ab-v7.js');
const verifier = path.join(here, 'verify-source-pins-v7.mjs');
const pinCheck = spawnSync(process.execPath, [verifier], { encoding: 'utf8' });
if (pinCheck.status !== 0) throw new Error(`Fixture source pin preflight failed: ${pinCheck.stderr || pinCheck.stdout}`);
const factory = path.join(here, '../native-prepared-factory-v30.ts');
const factoryPin = '5b8dd195c09efdbb1946775f6e8306936c8b8bdabf65a792816f30ab1e242b8a';
const factoryBytes = await readFile(factory);
const factoryHash = createHash('sha256').update(factoryBytes).digest('hex');
if (factoryHash !== factoryPin) throw new Error(`V30 factory snapshot mismatch: ${factoryHash}`);

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
const helper = path.join(here, '../trouser-sock-trim.ts');
const patchHelper = path.join(here, 'body-coverage-patch.ts');
const helperHash = createHash('sha256').update(await readFile(helper)).digest('hex');
const helperPin = '2b24f3c2cea5298c67ac2e55d2fa10301f05e8fcb4a7eb60e4157cb9bd837ca2';
if (helperHash !== helperPin) throw new Error(`Sock trim helper snapshot mismatch: ${helperHash}`);
const patchHash = createHash('sha256').update(await readFile(patchHelper)).digest('hex');
if (patchHash !== '39fbbbda4461cb1b282c2de5e906367cccd0e1b1e6f3970b89ab20ebc79b43ca') throw new Error(`Body coverage helper snapshot mismatch: ${patchHash}`);
console.log(JSON.stringify({ status: 'bundled', output, outputBytes, factory, factorySha256: factoryHash, helper, helperSha256: helperHash, patchHelper, patchSha256: patchHash, verifier: pinCheck.stdout.trim() }, null, 2));
