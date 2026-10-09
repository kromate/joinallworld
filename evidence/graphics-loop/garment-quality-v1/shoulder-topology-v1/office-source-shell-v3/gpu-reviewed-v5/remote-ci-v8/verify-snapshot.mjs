import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../../..');
const MANIFEST = path.join(HERE, 'snapshot-files.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifySnapshot(expectedManifestSha) {
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha ?? '')) throw new Error('Expected exact snapshot manifest SHA-256');
  const raw = await readFile(MANIFEST), actualManifestSha = sha(raw);
  if (actualManifestSha !== expectedManifestSha) throw new Error(`Snapshot manifest mismatch: ${actualManifestSha}`);
  const manifest = JSON.parse(raw.toString('utf8'));
  if (manifest.schema !== 'allworld-office-source-corner-chart-gpu-normal-provenance-v8' || !Array.isArray(manifest.files) || manifest.files.length !== 36) throw new Error('Unexpected or incomplete immutable source manifest');
  const seen = new Set(), hashes = {};
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || seen.has(entry.path)) throw new Error('Malformed or duplicate source manifest entry');
    seen.add(entry.path);
    const target = path.resolve(ROOT, entry.path), relative = path.relative(ROOT, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Snapshot path escapes root: ${entry.path}`);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(target) !== target) throw new Error(`Snapshot entry is not a canonical regular file: ${entry.path}`);
    const got = sha(await readFile(target));
    hashes[entry.path] = got;
    if (got !== entry.sha256) throw new Error(`Frozen input changed: ${entry.path} (${got})`);
  }
  return { manifestSha256: actualManifestSha, sourceHashes: hashes, manifest };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifySnapshot(process.argv[2]), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; }
}
