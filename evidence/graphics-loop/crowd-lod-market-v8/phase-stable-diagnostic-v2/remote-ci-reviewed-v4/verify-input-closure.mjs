import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const HERE = 'evidence/graphics-loop/crowd-lod-market-v8/phase-stable-diagnostic-v2/remote-ci-reviewed-v4';
const CLOSURE_PATH = `${HERE}/production-import-closure.json`;
const PINS_PATH = `${HERE}/source-pins.json`;
const SNAPSHOT_PATH = `${HERE}/snapshot-files.json`;
const EXPECTED_SNAPSHOT_SHA = process.argv[2] ?? '';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const safePath = relative => {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) fail(`Unsafe relative source path: ${relative}`);
  const resolved = path.resolve(ROOT, relative);
  const rel = path.relative(ROOT, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || resolved !== path.join(ROOT, relative)) fail(`Source path escaped repository: ${relative}`);
  return resolved;
};
async function sourceRecord(relative) {
  const file = safePath(relative);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`Pinned source is not a regular file: ${relative}`);
  const bytes = await readFile(file);
  return { path: relative, bytes: bytes.byteLength, sha256: sha(bytes) };
}
const snapshotBytes = await readFile(path.join(ROOT, SNAPSHOT_PATH));
const snapshotSha = sha(snapshotBytes);
if (!/^[a-f0-9]{64}$/.test(EXPECTED_SNAPSHOT_SHA) || snapshotSha !== EXPECTED_SNAPSHOT_SHA) fail(`Snapshot SHA mismatch: expected ${EXPECTED_SNAPSHOT_SHA}, got ${snapshotSha}`);
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
if (snapshot.schema !== 'allworld-floor-reference-cpu-snapshot-v2' || !Array.isArray(snapshot.files)) fail('Unexpected v2 CPU snapshot schema');
const snapshotByPath = new Map();
for (const item of snapshot.files) {
  if (!item || typeof item.path !== 'string' || snapshotByPath.has(item.path)) fail(`Duplicate or malformed snapshot entry: ${item?.path}`);
  const actual = await sourceRecord(item.path);
  if (actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) fail(`Snapshot differs from current file: ${item.path}`);
  snapshotByPath.set(item.path, item);
}
const [closure, pins] = await Promise.all([
  readFile(path.join(ROOT, CLOSURE_PATH), 'utf8').then(text => JSON.parse(text)),
  readFile(path.join(ROOT, PINS_PATH), 'utf8').then(text => JSON.parse(text)),
]);
if (closure.schema !== 'allworld-v8-floor-toggle-v2-import-closure-v1') fail('Unexpected import closure schema');
if (pins.schema !== 'allworld-v8-floor-toggle-v2-explicit-source-pins-v1' || !Array.isArray(pins.inputs)) fail('Unexpected explicit pin schema');
const pinByPath = new Map();
for (const item of pins.inputs) {
  if (!item || typeof item.path !== 'string' || pinByPath.has(item.path)) fail(`Duplicate/malformed explicit pin: ${item?.path}`);
  const snapshotItem = snapshotByPath.get(item.path);
  const actual = await sourceRecord(item.path);
  if (!snapshotItem || item.sha256 !== snapshotItem.sha256 || item.bytes !== snapshotItem.bytes
      || actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) {
    fail(`Explicit source pin != snapshot == current source: ${item.path}`);
  }
  pinByPath.set(item.path, item);
}
const closureEntries = [...(closure.runtimeFiles ?? []), ...(closure.typeOnlyFiles ?? []), ...(closure.fixtureRuntimeFiles ?? [])];
const closureByPath = new Map();
for (const item of closureEntries) {
  if (!item || typeof item.path !== 'string' || closureByPath.has(item.path)) fail(`Duplicate/malformed closure entry: ${item?.path}`);
  const snapshotItem = snapshotByPath.get(item.path);
  const explicit = pinByPath.get(item.path);
  const actual = await sourceRecord(item.path);
  if (!snapshotItem || item.sha256 !== snapshotItem.sha256 || item.bytes !== snapshotItem.bytes
      || (explicit && (explicit.sha256 !== item.sha256 || explicit.bytes !== item.bytes))
      || actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) {
    fail(`Import closure != explicit pins == snapshot == current source: ${item.path}`);
  }
  closureByPath.set(item.path, item);
}
if (closure.entry !== closure.runtimeFiles?.[0]?.path) fail('Import closure entry must be its first runtime file');
console.log(JSON.stringify({ status: 'all-closure-explicit-snapshot-current-file-hashes-match', snapshotSha256: snapshotSha,
  snapshotFiles: snapshotByPath.size, explicitPins: pinByPath.size, closureFiles: closureByPath.size }, null, 2));
