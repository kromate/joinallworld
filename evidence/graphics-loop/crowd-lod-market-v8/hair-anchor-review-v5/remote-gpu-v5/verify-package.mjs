import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const shaFile = async file => sha(await readFile(file));
async function findNamed(dir, name, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await findNamed(target, name, found);
    else if (entry.name === name && entry.isFile()) found.push(target);
  }
  return found;
}

/** Validate the exact isolated hair-anchor CPU artifact; this does not render or accept it. */
export async function verifyHairAnchorCpuArtifact(inputDir, pin) {
  if (pin.schema !== 'allworld-market-lod-v8-hair-anchor-live-pin-v5'
    || pin.artifactName !== `market-hair-anchor-cpu-package-v5-${pin.packageRunId}`) {
    throw new Error('CPU package pin schema/name does not match its run ID');
  }
  if (!path.isAbsolute(inputDir)) throw new Error('Package artifact path must be absolute');
  const inputStat = await lstat(inputDir);
  if (!inputStat.isDirectory() || inputStat.isSymbolicLink()) throw new Error('Package artifact root must be a real directory');
  const manifests = await findNamed(inputDir, 'build-manifest.json');
  if (manifests.length !== 1) throw new Error(`Expected exactly one downloaded hair package manifest; found ${manifests.length}`);
  const manifestPath = manifests[0], dist = path.dirname(manifestPath);
  const manifestBytes = await readFile(manifestPath);
  if (sha(manifestBytes) !== pin.packageManifestSha256) throw new Error('Downloaded artifact manifest SHA does not match pin');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const sourceOutputSuffix = path.join('evidence', 'graphics-loop', 'crowd-lod-market-v8', 'hair-anchor-review-v5', 'remote-cpu-v5', 'static-fixture-market-hair-anchor-v5');
  const viewerPath = 'evidence/graphics-loop/crowd-lod-market-v8/hair-anchor-review-v5/viewer-hair-anchor-v5.ts';
  const candidatePath = 'evidence/graphics-loop/crowd-lod-market-v8/hair-anchor-review-v5/geometry-hair-anchor-v5.ts';
  const inventoryPath = 'evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json';
  if (manifest.status !== pin.packageStatus || manifest.builderSha256 !== pin.builderSha256
    || !String(manifest.outputDir ?? '').endsWith(sourceOutputSuffix)
    || manifest.inputShaGuards?.[viewerPath] !== pin.viewerSha256
    || manifest.inputShaGuards?.[candidatePath] !== pin.candidateGeometrySha256
    || manifest.inputShaGuards?.[inventoryPath] !== pin.inventorySha256) {
    throw new Error('CPU package provenance differs from the pinned hair-anchor source recipe or output path');
  }
  const records = new Map((manifest.outputs ?? []).map(item => [item.path, item]));
  if (!records.has('index.html') || !records.has('viewer.js') || !records.has('assets/candidate-market-day-12.json')) {
    throw new Error('Hair-anchor package is missing viewer or saved Market inventory');
  }
  if (records.size !== manifest.outputs.length) throw new Error('Hair-anchor package output manifest has duplicate paths');
  for (const [relative, record] of records) {
    if (typeof relative !== 'string' || relative.startsWith('/') || relative.split(/[\\/]/).includes('..')) throw new Error(`Unsafe package output path: ${relative}`);
    const file = path.resolve(dist, relative), rel = path.relative(dist, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Package output escaped artifact directory: ${relative}`);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Package output is not a regular file: ${relative}`);
    const bytes = await readFile(file);
    if (bytes.byteLength !== record.bytes || sha(bytes) !== record.sha256) throw new Error(`Package output changed: ${relative}`);
  }
  const artifactFiles = [];
  for (const relative of [...records.keys(), 'build-manifest.json'].sort()) {
    const file = path.resolve(dist, relative), stat = await lstat(file), bytes = await readFile(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`CPU artifact record is not a regular file: ${relative}`);
    artifactFiles.push({ path: relative, bytes: bytes.byteLength, sha256: sha(bytes) });
  }
  const artifactCanonical = Buffer.from(JSON.stringify(artifactFiles.map(({ path: filePath, bytes, sha256 }) => ({ bytes, path: filePath, sha256 }))));
  const sourceReceiptFiles = await findNamed(inputDir, 'v8-hair-anchor-v5-cpu-package.receipt.json');
  if (sourceReceiptFiles.length !== 1) throw new Error(`Expected one exact hair-anchor CPU-package receipt, found ${sourceReceiptFiles.length}`);
  const sourceReceipt = JSON.parse(await readFile(sourceReceiptFiles[0], 'utf8'));
  const receiptPath = path.relative(inputDir, sourceReceiptFiles[0]).split(path.sep).join('/');
  const cpuSnapshotPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../remote-cpu-v5/snapshot-files.json');
  const cpuSnapshotBytes = await readFile(cpuSnapshotPath);
  const cpuSnapshot = JSON.parse(cpuSnapshotBytes.toString('utf8'));
  const expectedSourceHashes = Object.fromEntries((cpuSnapshot.files ?? []).map(item => [item.path, item.sha256]));
  const sameHashMap = value => value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Object.keys(expectedSourceHashes).sort())
    && Object.entries(expectedSourceHashes).every(([key, digest]) => value[key] === digest);
  const sameArtifactFiles = Array.isArray(sourceReceipt.sourceArtifactFiles)
    && JSON.stringify(sourceReceipt.sourceArtifactFiles) === JSON.stringify(artifactFiles);
  if (sourceReceipt.status !== 'completed' || sourceReceipt.childExitCode !== 0 || sourceReceipt.processGroupCleanupVerified !== true
    || sourceReceipt.sourceUnchanged !== true || sourceReceipt.sourceManifestSha256 !== pin.sourceManifestSha256
    || sha(cpuSnapshotBytes) !== pin.sourceManifestSha256 || !sameHashMap(sourceReceipt.sourceHashesBefore)
    || !sameHashMap(sourceReceipt.sourceHashesAfter) || receiptPath !== 'remote-results/v8-hair-anchor-v5-cpu-package.receipt.json'
    || !Number.isSafeInteger(sourceReceipt.peakGroupRssBytes) || sourceReceipt.peakGroupRssBytes < 0
    || sourceReceipt.peakGroupRssBytes > 220 * 1024 * 1024 || sourceReceipt.rssLimitBytes !== 220 * 1024 * 1024
    || sourceReceipt.timeoutSeconds !== 25 || sourceReceipt.nodeHeapMiB !== 96
    || !Number.isInteger(sourceReceipt.monitorSamples) || sourceReceipt.monitorSamples < 1
    || sourceReceipt.packageManifestStatusValid !== true || sourceReceipt.sourceArtifactSha256 !== sha(artifactCanonical)
    || !sameArtifactFiles) {
    throw new Error('CPU-package receipt does not prove successful bounded packaging from the pinned source manifest');
  }
  const inventory = JSON.parse(await readFile(path.join(dist, 'assets/candidate-market-day-12.json'), 'utf8'));
  for (const expected of pin.actors) {
    const actor = inventory.fixture?.crowd?.find(item => item.id === expected.id);
    if (!actor || actor.seed !== expected.seed || actor.look?.body !== expected.body || actor.look?.outfit !== expected.outfit
      || actor.look?.hair !== expected.hair) throw new Error(`Saved identity/look does not match pin: ${expected.id}`);
  }
  return { dist, manifest, records, inventory, sourceReceipt, sourceReceiptPath: sourceReceiptFiles[0],
    receiptIntegrity: { resourceLimits: { peakGroupRssBytes: sourceReceipt.peakGroupRssBytes,
      rssLimitBytes: sourceReceipt.rssLimitBytes, timeoutSeconds: sourceReceipt.timeoutSeconds,
      nodeHeapMiB: sourceReceipt.nodeHeapMiB, monitorSamples: sourceReceipt.monitorSamples },
      sourceHashMapEntries: Object.keys(expectedSourceHashes).length, artifactFiles: artifactFiles.length,
      artifactSha256: sha(artifactCanonical) } };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const input = process.argv[2];
  if (!input) throw new Error('Pass the extracted artifact directory as the first argument');
  const pinPath = path.resolve(process.env.HAIR_REVIEW_PIN_PATH ?? path.join(here, 'artifact-pin.json'));
  const pin = JSON.parse(await readFile(pinPath, 'utf8'));
  const verified = await verifyHairAnchorCpuArtifact(path.resolve(input), pin);
  console.log(JSON.stringify({ status: 'hair-anchor-package-verified', outputDir: verified.dist,
    manifestSha256: pin.packageManifestSha256, outputCount: verified.records.size,
    sourceReceipt: verified.sourceReceiptPath, sourceStatus: verified.sourceReceipt.status }, null, 2));
}
