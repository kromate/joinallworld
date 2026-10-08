import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import type { SourceRecord } from './types.ts';

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const sourceId = (release: string) => `natural-earth-test-${release}`;
function source(bytes: Uint8Array, release: string): SourceRecord {
  return { id: sourceId(release), url: `https://example.invalid/${release}.geojson`, release, license: 'Public-domain', attribution: 'Synthetic test fixture; not geographic evidence', sha256: sha(bytes), bytes: bytes.byteLength };
}
function square(x: number, y: number, size = 1): number[][] { return [[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]; }
function rawData(opts: { changedName?: boolean; extraPolygon?: boolean; huge?: boolean; omitGhana?: boolean } = {}): Buffer {
  const ring = opts.huge ? Array.from({ length: 70_000 }, (_, i) => [i % 2 ? 10 : 11, i === 69_999 ? 20 : 10 + (i % 2)]) : square(-3, 5);
  if (opts.huge) ring.push(ring[0]!);
  const features: unknown[] = [];
  if (!opts.omitGhana) features.push({ type: 'Feature', properties: { NE_ID: 1, ADMIN: opts.changedName ? 'Ghana renamed' : 'Ghana', CONTINENT: 'Africa', ISO_A2_EH: 'GH' }, geometry: { type: opts.extraPolygon ? 'MultiPolygon' : 'Polygon', coordinates: opts.extraPolygon ? [[square(-3, 5), [[-2.8,5.2],[-2.7,5.2],[-2.7,5.3],[-2.8,5.3],[-2.8,5.2]]], [square(1, 1)]] : [ring] } });
  features.push({ type: 'Feature', properties: { NE_ID: 159, ADMIN: 'Nigeria', CONTINENT: 'Africa', ISO_A2_EH: 'NG' }, geometry: { type: 'Polygon', coordinates: [square(3, 4)] } });
  return Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }));
}
function compile(candidate = rawData({ extraPolygon: true }), baseline = rawData({ extraPolygon: true })) {
  const candidateSource = source(candidate, 'a'.repeat(40));
  const baselineSource = source(baseline, 'b'.repeat(40));
  return compileCountryDirectory(candidateSource, candidate, baselineSource, baseline, sha('baseline inventory fixture'));
}
async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'country-directory-')));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function canonicalParse(bytes: Uint8Array): unknown { return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown; }

test('compiles deterministically and retains complete source-order polygon geometry, holes, and protected Nigeria', () => {
  const raw = rawData({ extraPolygon: true });
  const first = compile(raw), second = compile(raw);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.bytes, second.bytes);
  assert.deepEqual(first.assets.map(asset => [asset.relative, sha(asset.body)]), second.assets.map(asset => [asset.relative, sha(asset.body)]));
  assert.equal(first.manifest.sourceUnitCount, 2);
  assert.equal(first.manifest.identityPath.startsWith('identity/'), true);
  const nigeria = first.inventory.nodes.find(node => node.id === 'legacy-ng')!;
  assert.equal(nigeria.outline, 'missing');
  assert.equal(first.assets.some(asset => Buffer.from(asset.body).includes(Buffer.from('legacy-ng')) && asset.relative.startsWith('outlines/')), false);
  const indexAsset = first.assets.find(asset => asset.relative.startsWith('outline-index/'))!;
  const index = canonicalParse(indexAsset.body) as { geometryType: string; polygonCount: number; parts: Array<{ path: string; polygonOffset: number; polygonCount: number }> };
  assert.equal(index.geometryType, 'MultiPolygon'); assert.equal(index.polygonCount, 2);
  assert.deepEqual(index.parts.map(part => [part.polygonOffset, part.polygonCount]), [[0, 2]]);
  const part = canonicalParse(first.assets.find(asset => asset.relative === index.parts[0]!.path)!.body) as { coordinates: unknown[] };
  assert.deepEqual(part.coordinates, (JSON.parse(raw.toString()).features[0].geometry.coordinates));
});

test('requires exact pinned raw bytes and rejects missing baseline identities', () => {
  const raw = rawData(), baseline = rawData();
  const candidateSource = source(raw, 'a'.repeat(40)), baselineSource = source(baseline, 'b'.repeat(40));
  const changed = rawData({ changedName: true });
  assert.throws(() => compileCountryDirectory(candidateSource, changed, baselineSource, baseline, sha('baseline')), /exact SHA-256 pin/);
  const missing = rawData({ omitGhana: true });
  assert.throws(() => compileCountryDirectory(source(missing, 'c'.repeat(40)), missing, baselineSource, baseline, sha('baseline')), /missing baseline country identities/);
});

test('rejects one oversized whole polygon without simplifying or clipping', () => {
  const raw = rawData({ huge: true });
  assert.throws(() => compile(raw), /single whole polygon.*part byte cap/);
});

test('splits a multipolygon greedily at the part byte cap while preserving source order and holes', () => {
  const polygons = Array.from({ length: 3 }, (_, polygonIndex) => {
    const ring = Array.from({ length: 24_999 }, (_, index) => [-3 + (index % 2) * 0.00001 + polygonIndex * 0.01, 5 + (index % 3) * 0.00001]);
    ring.push(ring[0]!);
    const hole = [[-2.99,5.01],[-2.98,5.01],[-2.98,5.02],[-2.99,5.02],[-2.99,5.01]];
    return [ring, hole];
  });
  const candidate = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { NE_ID: 1, ADMIN: 'Synthetic Ghana', CONTINENT: 'Africa', ISO_A2_EH: 'GH' }, geometry: { type: 'MultiPolygon', coordinates: polygons } },
    { type: 'Feature', properties: { NE_ID: 159, ADMIN: 'Nigeria', CONTINENT: 'Africa', ISO_A2_EH: 'NG' }, geometry: { type: 'Polygon', coordinates: [square(3,4)] } },
  ] }));
  const compiled = compile(candidate, candidate);
  const indexAsset = compiled.assets.find(asset => asset.relative.startsWith('outline-index/'))!;
  const index = canonicalParse(indexAsset.body) as { polygonCount: number; parts: Array<{ path: string; polygonOffset: number; polygonCount: number; bytes: number }> };
  assert.equal(index.polygonCount, 3);
  assert.ok(index.parts.length >= 2);
  let nextOffset = 0;
  for (const part of index.parts) { assert.equal(part.polygonOffset, nextOffset); nextOffset += part.polygonCount; }
  assert.equal(nextOffset, 3);
  assert.ok(index.parts.every(part => part.bytes <= 512_000));
  const reconstructed = index.parts.flatMap(part => (canonicalParse(compiled.assets.find(asset => asset.relative === part.path)!.body) as { coordinates: unknown[] }).coordinates);
  assert.deepEqual(reconstructed, polygons);
});

test('preflights the complete publication byte budget during pure compilation', async () => withRoot(async root => {
  const features: unknown[] = [];
  for (let country = 0; country < 12; country++) {
    const base = -100 + country * 2;
    const polygons = Array.from({ length: 5 }, (_, polygon) => {
      const x = base + polygon * 0.1;
      const ring = Array.from({ length: 19_999 }, (_, index) => [x + (index % 2 ? 0.01 : 0), 5 + (index % 2 ? 0.01 : 0)]);
      ring.push(ring[0]!);
      return [ring];
    });
    const code = country === 0 ? 'GH' : `A${String.fromCharCode(65 + country)}`;
    features.push({ type: 'Feature', properties: { NE_ID: country + 1, ADMIN: `Synthetic ${country}`, CONTINENT: 'Africa', ISO_A2_EH: code }, geometry: { type: 'MultiPolygon', coordinates: polygons } });
  }
  features.push({ type: 'Feature', properties: { NE_ID: 159, ADMIN: 'Nigeria', CONTINENT: 'Africa', ISO_A2_EH: 'NG' }, geometry: { type: 'Polygon', coordinates: [square(3, 4)] } });
  const raw = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }));
  assert.throws(() => compile(raw, raw), /publication exceeds total byte cap/);
  await assert.rejects(lstat(path.join(root, 'not-created')), { code: 'ENOENT' });
}));

test('publisher revalidates compiled assets and publishes manifest last under a separate namespace', async () => withRoot(async root => {
  const compiled = compile();
  const out = path.join(root, 'output', 'country-inventory');
  const result = await publishCountryDirectory(compiled, out, path.join(root, 'output'));
  assert.equal(result.manifestHash, compiled.manifestHash);
  assert.equal(await readFile(result.manifestPath, 'utf8'), Buffer.from(compiled.assets.find(asset => asset.relative === compiled.manifestPath)!.body).toString('utf8'));
  assert.equal((await readdir(out)).includes('manifests'), true);
  const tampered = compile();
  tampered.inventory.outlines[0]!.geometry.coordinates = [[square(-3, 5.1)]];
  await assert.rejects(publishCountryDirectory(tampered, path.join(root, 'other', 'country-inventory'), path.join(root, 'other')), /not admitted unchanged/);
  await assert.rejects(lstat(path.join(root, 'other')),{ code: 'ENOENT' });
}));

test('fails closed on a corrupted existing hash-addressed asset without replacing it', async () => withRoot(async root => {
  const compiled = compile();
  const out = path.join(root, 'output', 'country-inventory');
  await publishCountryDirectory(compiled, out, path.join(root, 'output'));
  const targetAsset = compiled.assets.find(asset => asset.relative.startsWith('outlines/'))!;
  const target = path.join(out, targetAsset.relative);
  await writeFile(target, 'corruption');
  await assert.rejects(publishCountryDirectory(compiled, out, path.join(root, 'output')), /corrupt|byte limit/);
  assert.equal(await readFile(target, 'utf8'), 'corruption');
}));

test('rejects an output symlink ancestor before writing', async () => withRoot(async root => {
  const compiled = compile();
  const allowed = path.join(root, 'allowed');
  const outside = path.join(root, 'outside');
  const { mkdir, symlink } = await import('node:fs/promises');
  await mkdir(outside); await symlink(outside, allowed);
  await assert.rejects(publishCountryDirectory(compiled, path.join(allowed, 'country-inventory'), allowed), /symlink/);
  assert.deepEqual(await readdir(outside), []);
}));
