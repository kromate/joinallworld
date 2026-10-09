import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../');
const manifestPath = path.join(HERE, 'source-snapshot.json');
const expectedManifest = process.argv[2] ?? '';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(manifestPath);
const actualManifest = sha(manifestBytes);
if (!/^[0-9a-f]{64}$/.test(expectedManifest) || actualManifest !== expectedManifest) {
  throw new Error(`Remote review source manifest mismatch: expected ${expectedManifest}, got ${actualManifest}`);
}
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.schema !== 'allworld-market-lod-v8-phase-stable-live-motion-source-snapshot-v3' || !Array.isArray(manifest.files) || !manifest.files.length) {
  throw new Error('Unexpected or incomplete remote source snapshot manifest');
}
const seen = new Set(), verified = [];
for (const item of manifest.files) {
  if (!item || typeof item.path !== 'string' || item.path.startsWith('/') || item.path.split(/[\\/]/).includes('..') || seen.has(item.path)) {
    throw new Error(`Invalid or duplicate source pin: ${item?.path}`);
  }
  seen.add(item.path);
  const file = path.resolve(ROOT, item.path), relative = path.relative(ROOT, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Source pin escapes repository: ${item.path}`);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Pinned source is not a regular file: ${item.path}`);
  const bytes = await readFile(file);
  const digest = sha(bytes);
  if (digest !== item.sha256 || bytes.byteLength !== item.bytes) throw new Error(`Pinned source changed: ${item.path}`);
  verified.push({ path: item.path, bytes: item.bytes, sha256: digest });
}
console.log(JSON.stringify({ status: 'verified', manifestSha256: actualManifest, files: verified }, null, 2));
