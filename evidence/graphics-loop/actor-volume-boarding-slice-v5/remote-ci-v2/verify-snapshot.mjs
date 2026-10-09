import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const MANIFEST = path.join(HERE, 'snapshot-files.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifySnapshot(expectedSha) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha ?? '')) throw new Error('Expected exact source snapshot SHA-256');
  const raw = await readFile(MANIFEST), actual = sha(raw);
  if (actual !== expectedSha) throw new Error(`Snapshot manifest mismatch: ${actual}`);
  const manifest = JSON.parse(raw.toString('utf8'));
  if (manifest.schema !== 'allworld-actor-sampler-v5-source-snapshot-v1' || !Array.isArray(manifest.files) || manifest.files.length < 1) throw new Error('Unexpected or incomplete sampler snapshot');
  const hashes = {}, seen = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || seen.has(entry.path)) throw new Error('Malformed/duplicate snapshot entry');
    seen.add(entry.path);
    const target = path.resolve(ROOT, entry.path), relative = path.relative(ROOT, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Snapshot path escapes checkout: ${entry.path}`);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(target) !== target) throw new Error(`Snapshot input is not a canonical file: ${entry.path}`);
    const bytes = await readFile(target), got = sha(bytes);
    if (bytes.byteLength !== entry.bytes || got !== entry.sha256) throw new Error(`Snapshot source mismatch: ${entry.path}`);
    hashes[entry.path] = got;
  }
  return { manifestSha256: actual, manifest, sourceHashes: hashes };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifySnapshot(process.argv[2]), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; }
}
