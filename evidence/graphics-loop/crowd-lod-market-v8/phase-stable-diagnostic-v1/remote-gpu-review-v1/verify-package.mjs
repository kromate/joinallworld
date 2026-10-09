import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const shaFile = async file => {
  const bytes = await readFile(file);
  return sha(bytes);
};
async function findNamed(dir, name, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await findNamed(target, name, found);
    else if (entry.name === name && entry.isFile()) found.push(target);
  }
  return found;
}

/** Validate an extracted CPU artifact without starting a browser or writing files. */
export async function verifyPhaseStableCpuArtifact(inputDir, pin) {
  if (!path.isAbsolute(inputDir)) throw new Error('Package artifact path must be absolute');
  const inputStat = await lstat(inputDir);
  if (!inputStat.isDirectory() || inputStat.isSymbolicLink()) throw new Error('Package artifact root must be a real directory');
  const manifests = await findNamed(inputDir, 'build-manifest.json');
  if (manifests.length !== 1) throw new Error(`Expected exactly one downloaded v8 package manifest; found ${manifests.length}`);
  const manifestPath = manifests[0], dist = path.dirname(manifestPath);
  if (await shaFile(manifestPath) !== pin.packageManifestSha256) throw new Error('Downloaded artifact manifest SHA does not match pin');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const sourceOutputSuffix = path.join('evidence', 'graphics-loop', 'crowd-lod-market-v8', 'phase-stable-diagnostic-v1', 'remote-ci-reviewed-v1', 'static-fixture-market-gpu-v8-phase-stable-v1');
  if (manifest.status !== pin.packageStatus || manifest.builderSha256 !== pin.builderSha256
    || !String(manifest.outputDir ?? '').endsWith(sourceOutputSuffix)
    || manifest.inputShaGuards?.['evidence/graphics-loop/crowd-lod-market-v8/phase-stable-diagnostic-v1/viewer-market-gpu-v8-phase-stable.ts'] !== pin.viewerSha256
    || manifest.inputShaGuards?.['evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json'] !== pin.inventorySha256) {
    throw new Error('CPU package provenance differs from the pinned source recipe or output path');
  }
  const records = new Map((manifest.outputs ?? []).map(item => [item.path, item]));
  if (!records.has('index.html') || !records.has('viewer.js') || !records.has('assets/candidate-market-day-12.json')) {
    throw new Error('Phase-stable static package is missing a required viewer or inventory file');
  }
  if (records.size !== manifest.outputs.length) throw new Error('V8 package output manifest has duplicate paths');
  for (const [relative, record] of records) {
    if (typeof relative !== 'string' || relative.startsWith('/') || relative.split(/[\\/]/).includes('..')) throw new Error(`Unsafe package output path: ${relative}`);
    const file = path.resolve(dist, relative), rel = path.relative(dist, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Package output escaped artifact directory: ${relative}`);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Package output is not a regular file: ${relative}`);
    const bytes = await readFile(file);
    if (bytes.byteLength !== record.bytes || sha(bytes) !== record.sha256) throw new Error(`Package output changed: ${relative}`);
  }
  const sourceReceiptFiles = await findNamed(inputDir, 'v8-phase-stable-v1-cpu-package.receipt.json');
  if (sourceReceiptFiles.length !== 1) throw new Error(`Expected one phase-stable v1 CPU-package receipt, found ${sourceReceiptFiles.length}`);
  const sourceReceipt = JSON.parse(await readFile(sourceReceiptFiles[0], 'utf8'));
  if (sourceReceipt.status !== 'completed' || sourceReceipt.childExitCode !== 0 || sourceReceipt.processGroupCleanupVerified !== true
    || sourceReceipt.sourceUnchanged !== true || sourceReceipt.sourceManifestSha256 !== pin.sourceManifestSha256
    || sourceReceipt.packageManifestStatusValid !== true || sourceReceipt.sourceArtifactSha256 == null) {
    throw new Error('CPU-package receipt does not prove successful bounded packaging from the pinned source manifest');
  }
  const inventory = JSON.parse(await readFile(path.join(dist, 'assets/candidate-market-day-12.json'), 'utf8'));
  for (const expected of pin.actors) {
    const actor = inventory.fixture?.crowd?.find(item => item.id === expected.id);
    if (!actor || actor.seed !== expected.seed || actor.look?.body !== expected.body || actor.look?.outfit !== expected.outfit) {
      throw new Error(`Packaged saved identity does not match pin: ${expected.id}`);
    }
  }
  return { dist, manifest, records, inventory, sourceReceipt, sourceReceiptPath: sourceReceiptFiles[0] };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const input = process.argv[2];
  if (!input) throw new Error('Pass the extracted artifact directory as the first argument');
  const pin = JSON.parse(await readFile(path.join(here, 'artifact-pin.json'), 'utf8'));
  const verified = await verifyPhaseStableCpuArtifact(path.resolve(input), pin);
  console.log(JSON.stringify({ status: 'package-verified', outputDir: verified.dist,
    manifestSha256: pin.packageManifestSha256, outputCount: verified.records.size,
    sourceReceipt: verified.sourceReceiptPath, sourceStatus: verified.sourceReceipt.status }, null, 2));
}
