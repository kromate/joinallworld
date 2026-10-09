import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const expectedSha = process.argv[2];
if (!/^[a-f0-9]{64}$/.test(expectedSha ?? '')) throw new Error('Pass the pinned snapshot manifest SHA-256');
const root = process.cwd();
const relativeManifest = 'evidence/graphics-loop/crowd-lod-market-v7/remote-ci-reviewed-v1/snapshot-files.json';
const manifestPath = path.join(root, relativeManifest);
const manifestBytes = await readFile(manifestPath);
const actualManifestSha = createHash('sha256').update(manifestBytes).digest('hex');
if (actualManifestSha !== expectedSha) throw new Error(`Snapshot manifest mismatch: expected ${expectedSha}, got ${actualManifestSha}`);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.schema !== 'allworld-crowd-lod-market-v7-cpu-snapshot-v1' || !Array.isArray(manifest.files) || manifest.files.length < 30) {
  throw new Error('Unexpected snapshot manifest structure');
}
const seen = new Set();
for (const entry of manifest.files) {
  if (typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Malformed snapshot entry');
  const target = path.resolve(root, entry.path);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Snapshot path escapes checkout: ${entry.path}`);
  if (seen.has(entry.path)) throw new Error(`Duplicate snapshot path: ${entry.path}`);
  seen.add(entry.path);
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Snapshot entry is not a regular file: ${entry.path}`);
  const actual = createHash('sha256').update(await readFile(target)).digest('hex');
  if (actual !== entry.sha256) throw new Error(`Snapshot mismatch ${entry.path}: expected ${entry.sha256}, got ${actual}`);
}
console.log(`verified snapshot manifest ${actualManifestSha} (${manifest.files.length} files)`);
