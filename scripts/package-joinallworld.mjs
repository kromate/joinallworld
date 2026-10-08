import { mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { expectedConfig, checkPackage } from './guard-joinallworld-package.mjs';
const [sourcePath, packagePath, sourceSha, publishing, toolingPath] = process.argv.slice(2);
if (!['true', 'false'].includes(publishing)) throw Error('Invalid publish mode');
const source = resolve(sourcePath), root = resolve(packagePath), publish = publishing === 'true';
mkdirSync(root);
const require = createRequire(join(resolve(toolingPath), 'package.json'));
await require('esbuild').build({ entryPoints: [join(source, 'deploy/cloudflare-worker.js')], outfile: join(root, 'worker.js'), bundle: true, minifyWhitespace: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
cpSync(join(source, 'dist'), join(root, 'assets'), { recursive: true, dereference: false });
writeFileSync(join(root, 'wrangler.json'), JSON.stringify(expectedConfig(sourceSha, publish), null, 2) + '\n');
const files = [];
function walk(path) {
  for (const name of readdirSync(path).sort()) {
    const full = join(path, name), stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else files.push({ path: relative(root, full), bytes: stat.size, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') });
  }
}
walk(root);
writeFileSync(join(root, 'manifest.json'), JSON.stringify({ sourceSha, publish, files }, null, 2) + '\n');
console.log(checkPackage(root, sourceSha, publish));
