import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const expectedSha = process.argv[2] ?? '';
if (!/^[a-f0-9]{64}$/.test(expectedSha)) throw new Error('Pass the pinned v8 source-snapshot SHA-256');
const root = process.cwd();
const relativeManifest = 'evidence/graphics-loop/crowd-lod-market-v8/phase-stable-diagnostic-v2/remote-ci-reviewed-v2/snapshot-files.json';
const manifestPath = path.join(root, relativeManifest);
const manifestBytes = await readFile(manifestPath);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const actualSha = sha(manifestBytes);
if (actualSha !== expectedSha) throw new Error(`Phase-stable CPU source snapshot mismatch: expected ${expectedSha}, got ${actualSha}`);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.schema !== 'allworld-market-lod-v8-phase-stable-cpu-snapshot-v2' || !Array.isArray(manifest.files) || manifest.files.length < 30) {
  throw new Error('Unexpected or incomplete v8 CPU snapshot');
}
const seen = new Set();
for (const item of manifest.files) {
  if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes)) {
    throw new Error(`Malformed snapshot entry: ${item?.path}`);
  }
  if (item.path.startsWith('/') || item.path.split(/[\\/]/).includes('..') || seen.has(item.path)) throw new Error(`Unsafe or duplicate source path: ${item.path}`);
  seen.add(item.path);
  const target = path.resolve(root, item.path), relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Snapshot path escapes checkout: ${item.path}`);
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Snapshot entry is not a regular file: ${item.path}`);
  const data = await readFile(target);
  if (data.byteLength !== item.bytes || sha(data) !== item.sha256) throw new Error(`Snapshot source changed: ${item.path}`);
}
console.log(JSON.stringify({ status: 'verified', manifestSha256: actualSha, files: manifest.files.length }, null, 2));
