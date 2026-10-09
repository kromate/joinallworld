import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const expectedManifestSha = process.argv[2];
if (!/^[a-f0-9]{64}$/.test(expectedManifestSha ?? '')) throw new Error('Pass the pinned snapshot manifest SHA-256');
const root = process.cwd();
const manifestPath = path.join(root, 'evidence/graphics-loop/office-source-shell-remote-ci-v1/snapshot-files.json');
const manifestBytes = await readFile(manifestPath);
const manifestSha = createHash('sha256').update(manifestBytes).digest('hex');
if (manifestSha !== expectedManifestSha) throw new Error(`Snapshot manifest mismatch: expected ${expectedManifestSha}, got ${manifestSha}`);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.schema !== 'allworld-office-source-shell-snapshot-v1' || !Array.isArray(manifest.files) || manifest.files.length !== 16) {
  throw new Error('Unexpected snapshot manifest structure');
}
const seen = new Set();
for (const entry of manifest.files) {
  if (typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Malformed snapshot entry');
  const target = path.resolve(root, entry.path);
  if (path.relative(root, target).startsWith('..') || path.isAbsolute(path.relative(root, target))) throw new Error(`Snapshot path escapes checkout: ${entry.path}`);
  if (seen.has(entry.path)) throw new Error(`Duplicate snapshot path: ${entry.path}`);
  seen.add(entry.path);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Snapshot entry is not a regular file: ${entry.path}`);
  const actual = createHash('sha256').update(await readFile(target)).digest('hex');
  if (actual !== entry.sha256) throw new Error(`Snapshot mismatch ${entry.path}: expected ${entry.sha256}, got ${actual}`);
}
console.log(`verified snapshot manifest ${manifestSha} (${manifest.files.length} files)`);
