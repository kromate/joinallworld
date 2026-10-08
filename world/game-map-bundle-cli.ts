import { createHash } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WORLD } from '../src/map3d/geo/data/world.ts';
import { readCountryDirectory } from './country-directory-reader.ts';
import { COUNTRY_DIRECTORY_LIMITS } from './country-directory-types.ts';
import { buildGameMapProduct } from './game-map-bundle.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { createOutputStore } from './storage.ts';
import type { CountryDirectoryNodeIndex, CountryOutlineIndex } from './country-directory-types.ts';
import type { SourceRecord } from './types.ts';

const WORLD_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(WORLD_DIR, '..');
const BASELINE_HASH = '8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f';
const DIRECTORY_HASH = 'b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501';
const ATLAS_SHA = '55f1c27403e3ebc639fd685b911b9e89c6c033f3e8e5202dd043ef7ae0c3b1f2';
const SOURCE_SHA = '239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255';
const SOURCE_BYTES = 13_287_234;
const enc = new TextEncoder();
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const fatalJson = (bytes: Uint8Array, label: string): unknown => {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new TypeError(`${label} is not valid UTF-8`); }
  try { return JSON.parse(text) as unknown; } catch { throw new TypeError(`${label} is not valid JSON`); }
};
function exactSource(value: unknown): SourceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('10m source pin is malformed');
  const row = value as Record<string, unknown>;
  const fields = ['id','url','release','license','attribution','sha256','bytes'];
  if (Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key))) throw new TypeError('10m source pin has unknown/missing fields');
  return row as unknown as SourceRecord;
}
async function readJson(filename: string, cap: number): Promise<{ value: unknown; bytes: Uint8Array }> {
  const bytes = await readBoundedLocalFile(filename, cap);
  return { value: fatalJson(bytes, filename), bytes };
}
async function hashAddressedAsset(root: string, relative: string, cap: number): Promise<Uint8Array> {
  if (!/^(?:nodes|outline-index|outlines)\/[a-f0-9]{64}\.json$/.test(relative)) throw new TypeError(`unsafe country directory asset path ${relative}`);
  const body = await readBoundedLocalFile(path.join(root, relative), cap);
  if (sha(body) !== path.basename(relative, '.json')) throw new Error(`country directory asset hash mismatch: ${relative}`);
  return body;
}
async function loadBundleAssets(root: string, directory: Awaited<ReturnType<typeof readCountryDirectory>>): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();
  const pending = [directory.manifest.rootNodePath];
  const seen = new Set<string>();
  let total = 0;
  const keep = (relative: string, body: Uint8Array): void => {
    if (result.has(relative)) throw new Error(`country directory repeats asset path ${relative}`);
    total += body.byteLength;
    if (total > COUNTRY_DIRECTORY_LIMITS.publishedBytes) throw new RangeError('source asset bundle set exceeds the country directory publication cap');
    result.set(relative, body);
  };
  while (pending.length) {
    if (seen.size >= 4096) throw new RangeError('country directory traversal exceeds the node cap');
    const relative = pending.pop()!;
    if (seen.has(relative)) throw new Error('country directory repeats a node index path');
    seen.add(relative);
    const bytes = await hashAddressedAsset(root, relative, COUNTRY_DIRECTORY_LIMITS.indexBytes);
    keep(relative, bytes);
    const index = fatalJson(bytes, relative) as CountryDirectoryNodeIndex;
    if (index.node.kind === 'country' && index.outlineIndexPath) {
      const outlineBytes = await hashAddressedAsset(root, index.outlineIndexPath, COUNTRY_DIRECTORY_LIMITS.indexBytes);
      keep(index.outlineIndexPath, outlineBytes);
      const outline = fatalJson(outlineBytes, index.outlineIndexPath) as CountryOutlineIndex;
      for (const part of outline.parts) {
        const body = await hashAddressedAsset(root, part.path, COUNTRY_DIRECTORY_LIMITS.partBytes);
        if (body.byteLength !== part.bytes) throw new Error(`country outline part byte count differs from index: ${part.path}`);
        keep(part.path, body);
      }
    }
    pending.push(...index.children.map(child => child.path));
  }
  return result;
}
async function writeGeneratedPins(filename: string, body: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  try {
    const info = await lstat(filename);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('generated country detail pins path is not a regular file');
    const current = await readBoundedLocalFile(filename, 16_384);
    if (sha(current) !== sha(body)) throw new Error('generated country detail pin module already exists with different content');
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temp = `${filename}.${process.pid}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temp, filename); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}
async function verifyExistingOutput(filename: string, bytes: Uint8Array, maxBytes: number): Promise<void> {
  try {
    const info = await lstat(filename);
    if (info.isSymbolicLink() || !info.isFile() || info.size !== bytes.byteLength || info.size > maxBytes) throw new Error(`existing immutable output has invalid type or length: ${filename}`);
    const existing = await readBoundedLocalFile(filename, maxBytes);
    if (sha(existing) !== sha(bytes)) throw new Error(`existing immutable output content differs: ${filename}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
async function verifyPinsCompatible(filename: string, body: Uint8Array): Promise<void> {
  try {
    const info = await lstat(filename);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('generated country detail pin path is not a regular file');
    const current = await readBoundedLocalFile(filename, 16_384);
    if (sha(current) !== sha(body)) throw new Error('generated country detail pin module already exists with different content');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
async function verifyNoSymlinkPath(filename: string): Promise<void> {
  const absolute = path.resolve(filename), root = path.parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { const info = await lstat(cursor); if (info.isSymbolicLink()) throw new Error(`symlink path refused: ${cursor}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (await realpath(REPO) !== REPO) throw new Error('repository root changed during build');
}

export async function buildGameMapBundles(publish = false): Promise<Record<string, unknown>> {
  const started = performance.now();
  const checkpoint = (): void => {
    if (performance.now() - started > 120_000) throw new Error('country detail build exceeded its 120 second duration cap');
    if (process.memoryUsage().rss > 512 * 1024 * 1024) throw new Error('country detail build exceeded its 512 MiB RSS cap');
  };
  checkpoint();
  const captures = await readJson(path.join(WORLD_DIR, 'country-capture.json'), 16_384);
  const sourceMetadata = await readJson(path.join(WORLD_DIR, 'inventory-10m-sources.json'), 32_768);
  const capture = captures.value as Record<string, unknown>;
  const metadata = sourceMetadata.value as Record<string, unknown>;
  const source = exactSource(metadata.source);
  if (capture.release !== source.release || metadata.input !== '.cache/world-build/country-source-cache/e51c4d047ed2867b34faea4e17c102ead4f3fee558a84a942619ee2cb1abdceb.geojson'
    || source.sha256 !== SOURCE_SHA || source.bytes !== SOURCE_BYTES || metadata.sourceFeatureCount !== 258
    || capture.expectedBytes !== SOURCE_BYTES || capture.expectedGitBlobSha1 !== '5ebc66e25fc1af01edaebe9375c546655e04cf1e') throw new Error('checked-in source receipts differ from the frozen production pin');
  const sourceBytes = await readBoundedLocalFile(path.join(REPO, String(metadata.input)), SOURCE_BYTES);
  checkpoint();
  if (sourceBytes.byteLength !== SOURCE_BYTES || sha(sourceBytes) !== SOURCE_SHA) throw new Error('cached Natural Earth source differs from frozen SHA/length');
  const gitBlob = createHash('sha1').update(`blob ${sourceBytes.byteLength}\0`).update(sourceBytes).digest('hex');
  if (gitBlob !== capture.expectedGitBlobSha1) throw new Error('cached Natural Earth source differs from capture Git blob identity');
  const atlasPath = path.join(REPO, 'src/map3d/geo/data/world.ts');
  const atlasBytes = await readBoundedLocalFile(atlasPath, 10_000_000);
  checkpoint();
  if (sha(atlasBytes) !== ATLAS_SHA) throw new Error('checked-in 1:50m atlas source hash changed');
  const directoryRoot = path.join(REPO, '.cache/world-build/output/country-inventory');
  const directory = await readCountryDirectory(directoryRoot, DIRECTORY_HASH);
  checkpoint();
  if (directory.manifestHash !== DIRECTORY_HASH || directory.manifest.baselineInventoryHash !== BASELINE_HASH
    || directory.manifest.source.sha256 !== SOURCE_SHA || directory.manifest.source.bytes !== SOURCE_BYTES
    || JSON.stringify(directory.manifest.source) !== JSON.stringify(source)) throw new Error('verified country directory differs from frozen source/baseline pins');
  const assetBytes = await loadBundleAssets(directoryRoot, directory);
  checkpoint();
  const atlasFeatureIds = WORLD.features.map(feature => feature.id);
  if (atlasFeatureIds.length !== 241 || atlasFeatureIds.filter(id => /^[a-z]{2}$/.test(id)).length !== 236) throw new Error('checked-in atlas feature denominator differs from its frozen 241/236 shape');
  const product = buildGameMapProduct({ source, sourceBytes, atlasBytes, atlasFeatureIds: atlasFeatureIds.filter(id => /^[a-z]{2}$/.test(id)), directory, assets: assetBytes });
  checkpoint();
  const cataloguePath = `/world-country-detail/${path.basename(product.cataloguePath)}`;
  const result = { schemaVersion: 1, status: publish ? 'verified-local-build' : 'read-only-preflight', cataloguePath, catalogueSha256: sha(product.catalogueBytes), directoryManifestHash: directory.manifestHash,
    atlasSha256: product.catalogue.atlas.sha256, sourceSha256: source.sha256, sourceBytes: source.bytes, countryRows: product.catalogue.entries.length,
    crosswalkRows: product.catalogue.crosswalk.length, bundledCountries: product.bundles.length, protectedRows: product.catalogue.entries.filter(row => row.availability === 'protected').length,
    logicalBytes: product.logicalBytes, catalogueBytes: product.catalogueBytes.byteLength, elapsedMs: Math.round(performance.now() - started), peakRssBytes: process.memoryUsage().rss,
    bundles: product.bundles.map(row => ({ countryId: row.countryId, path: row.path, sha256: row.sha256, bytes: row.bytes })) };
  if (!publish) return result;
  const publicRoot = path.join(REPO, 'public');
  const targetRoot = path.join(publicRoot, 'world-country-detail');
  await verifyNoSymlinkPath(targetRoot);
  for (const bundle of product.bundles) await verifyExistingOutput(path.join(targetRoot, path.basename(bundle.path)), bundle.body, 5_242_880);
  await verifyExistingOutput(path.join(targetRoot, path.basename(product.cataloguePath)), product.catalogueBytes, 256_000);
  const pinModule = [
    '// Generated by world/game-map-bundle-cli.ts; do not edit by hand.',
    `export const COUNTRY_DETAIL_CATALOGUE_PATH = ${JSON.stringify(cataloguePath)} as const;`,
    `export const COUNTRY_DETAIL_CATALOGUE_SHA256 = ${JSON.stringify(sha(product.catalogueBytes))} as const;`,
    `export const COUNTRY_DETAIL_ATLAS_SHA256 = ${JSON.stringify(product.catalogue.atlas.sha256)} as const;`,
    `export const COUNTRY_DETAIL_DIRECTORY_MANIFEST_SHA256 = ${JSON.stringify(product.catalogue.directory.manifestHash)} as const;`,
    `export const COUNTRY_DETAIL_SOURCE_SHA256 = ${JSON.stringify(source.sha256)} as const;`,
    `export const COUNTRY_DETAIL_SOURCE_BYTES = ${source.bytes} as const;`,
    '',
  ].join('\n');
  const pinBytes = enc.encode(pinModule);
  await verifyPinsCompatible(path.join(REPO, 'src/map3d/geo/country-detail-pins.generated.ts'), pinBytes);
  const store = await createOutputStore(targetRoot, publicRoot);
  for (const bundle of product.bundles) await store.writeImmutable(path.basename(bundle.path), bundle.body);
  await store.writeImmutable(path.basename(product.cataloguePath), product.catalogueBytes);
  await writeGeneratedPins(path.join(REPO, 'src/map3d/geo/country-detail-pins.generated.ts'), pinBytes);
  return { ...result, status: 'published-local-immutable' };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['check','build'].includes(args[0]!)) throw new Error('usage: node --experimental-strip-types world/game-map-bundle-cli.ts check|build');
  const report = await buildGameMapBundles(args[0] === 'build');
  const text = `${JSON.stringify(report)}\n`;
  process.stdout.write(text);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${String(error instanceof Error ? error.message : error).slice(0, 2048)}\n`); process.exitCode = 1; });
}
