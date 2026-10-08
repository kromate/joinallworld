import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildEnvironmentManifest, powerMonthlyUrl } from './environment.ts';
import type { EnvironmentRequest } from './environment-types.ts';
import { compileClimateAttachment, validateClimateAttachmentBinding } from './climate-attachment-compile.ts';
import type { ClimateAttachmentBinding, ClimateAttachmentBuildInput } from './climate-attachment-types.ts';
import { encodeManifest, encodeTile, sha256 } from './pack.ts';
import type { Region, WorldManifest, WorldTile } from './types.ts';

const raw = new Uint8Array(await readFile(fileURLToPath(new URL('./environment-fixtures/accra-power-monthly-1991-2020.json', import.meta.url))));
const request: EnvironmentRequest = { schemaVersion: 1, id: 'accra', regionId: 'pilot:accra', name: 'Accra', longitude: -0.2, latitude: 5.55, baseline: { startYear: 1991, endYear: 2020 } };
const region: Region = { id: 'gh-accra-test-cell', parentId: 'country:natural-earth:test', name: 'Accra synthetic cell', kind: 'cell', countryCode: 'GH', timezone: 'Africa/Accra', bounds: [-0.205, 5.545, -0.195, 5.555] };
const tile: WorldTile = { schemaVersion: 1, id: 'accra-empty-test', regionId: region.id, bounds: region.bounds, anchor: { longitude: -0.2, latitude: 5.55, height: 0 }, buildings: [], roads: [] };
const encodedTile = encodeTile(tile);
const base: WorldManifest = {
  schemaVersion: 1, compilerVersion: 'synthetic-world-compiler-v1', region,
  frame: 'wgs84-enu-m-v1', verticalDatum: 'WGS84-ellipsoid', coverage: 'foundation',
  exceptions: ['climate unavailable: no monthly regional climate source was provided', 'synthetic test boundary only'],
  sources: [{ id: 'synthetic-base', url: 'file:world/pilots/test', release: 'test', license: 'test-only', attribution: 'synthetic fixture', sha256: 'a'.repeat(64), bytes: 1 }],
  tiles: [encodedTile.ref], climate: null,
};
const baseEncoded = encodeManifest(base);
const env = buildEnvironmentManifest(request, raw, powerMonthlyUrl(request));
const envBytes = new TextEncoder().encode(JSON.stringify(env));
const binding: ClimateAttachmentBinding = {
  schemaVersion: 1, id: 'accra', campaignId: 'synthetic-campaign',
  baseManifest: { sha256: baseEncoded.hash, bytes: baseEncoded.bytes.byteLength, path: `.cache/world-build/campaigns/synthetic-campaign/output/manifests/${baseEncoded.hash}.json` },
  expectedRegion: region,
  environmentManifest: { sha256: sha256(envBytes), bytes: envBytes.byteLength, path: `.cache/world-build/output/environment/manifests/${sha256(envBytes)}.json` },
  environmentRequest: request,
  rawSource: { sha256: sha256(raw), bytes: raw.byteLength, path: '.cache/world-build/environment-source-cache/synthetic-accra.json', url: powerMonthlyUrl(request) },
  expectedSample: { longitude: -0.2, latitude: 5.55 },
  association: { mode: 'explicit-city-associated-native-grid-point', sampleInsidePackBounds: true, centreOffsetDegrees: { longitude: 0, latitude: 0 }, maximumAbsoluteCentreOffsetDegrees: 0.01, disclosure: 'Synthetic explicit association; not a measured cell average.' },
};
const input: ClimateAttachmentBuildInput = { binding, baseBytes: baseEncoded.bytes, environmentBytes: envBytes, rawSourceBytes: raw, tiles: [{ relative: encodedTile.ref.path, body: encodedTile.bytes }] };

test('validates an explicit pinned binding and deterministically attaches reconstructed monthly climate', () => {
  assert.deepEqual(validateClimateAttachmentBinding(binding), binding);
  const first = compileClimateAttachment(input), second = compileClimateAttachment(input);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.provenanceHash, second.provenanceHash);
  assert.equal(first.bytes, first.assets.reduce((sum, asset) => sum + asset.body.byteLength, 0));
  assert.equal(first.assets.at(-1)?.relative, first.manifestPath);
  assert.equal(first.assets.at(-2)?.relative, first.provenancePath);
  assert.equal(first.manifest.climate?.months.length, 12);
  assert.equal(first.manifest.climate?.sourceId, first.manifest.sources.at(-1)?.id);
  assert.deepEqual(first.manifest.tiles, base.tiles);
  assert.deepEqual(first.manifest.exceptions.filter(x => x === 'synthetic test boundary only'), ['synthetic test boundary only']);
  assert.equal(first.manifest.exceptions.filter(x => x.startsWith('climate unavailable:')).length, 0);
  assert.ok(first.manifest.exceptions.some(x => x.includes('sampleInsidePackBounds=true')));
  assert.equal(first.assets[0]?.relative, encodedTile.ref.path);
  assert.deepEqual(first.assets[0]?.body, encodedTile.bytes);
  for (const asset of first.assets.slice(1)) {
    assert.equal(sha256(asset.body), asset.relative.split('/').at(-1)?.replace('.json', ''));
    assert.equal(asset.body.at(-1), 10);
  }
});

test('supports a reviewed sample outside the cell, rejects the exact offset boundary, and detaches provenance inputs', () => {
  const outsideRegion = { ...region, bounds: [-0.206, 5.545, -0.202, 5.555] as Region['bounds'] };
  const outsideTile = encodeTile({ ...tile, bounds: outsideRegion.bounds, anchor: { longitude: -0.204, latitude: 5.55, height: 0 } });
  const outsideBase = encodeManifest({ ...base, region: outsideRegion, tiles: [outsideTile.ref] });
  const outsideHash = outsideBase.hash;
  const outsideBinding: ClimateAttachmentBinding = {
    ...binding,
    environmentRequest: structuredClone(request),
    baseManifest: { ...binding.baseManifest, sha256: outsideHash, bytes: outsideBase.bytes.byteLength, path: `.cache/world-build/campaigns/synthetic-campaign/output/manifests/${outsideHash}.json` },
    expectedRegion: outsideRegion,
    association: { ...binding.association, sampleInsidePackBounds: false, centreOffsetDegrees: { longitude: 0.0040000000000000036, latitude: 0 } },
  };
  const outsideInput: ClimateAttachmentBuildInput = { ...input, binding: outsideBinding, baseBytes: outsideBase.bytes, tiles: [{ relative: outsideTile.ref.path, body: outsideTile.bytes }] };
  const compiled = compileClimateAttachment(outsideInput);
  assert.equal(compiled.manifest.exceptions.find(x => x.startsWith('Climate sample:'))?.includes('sampleInsidePackBounds=false'), true);
  outsideBinding.association.disclosure = 'mutated after compiler return';
  outsideBinding.environmentRequest.name = 'Changed after compiler return';
  assert.equal(compiled.provenance.binding.association.disclosure, 'Synthetic explicit association; not a measured cell average.');
  assert.equal(compiled.provenance.binding.environmentRequest.name, 'Accra');

  const boundaryRequest = { ...request, longitude: 0.01 };
  const boundary = {
    ...binding, environmentRequest: boundaryRequest,
    rawSource: { ...binding.rawSource, url: powerMonthlyUrl(boundaryRequest) },
    expectedSample: { longitude: 0.01, latitude: 5.55 },
    association: { ...binding.association, centreOffsetDegrees: { longitude: 0.01, latitude: 0 } },
    expectedRegion: { ...region, bounds: [-0.01, 5.545, 0.01, 5.555] as Region['bounds'] },
  };
  assert.throws(() => validateClimateAttachmentBinding(boundary), /below the reviewed centre-offset/);
});

test('rejects unsafe, Nigeria, or internally inconsistent bindings before deriving', () => {
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, extra: true }), /unknown binding field/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, rawSource: { ...binding.rawSource, path: '../outside.json' } }), /canonical relative path/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, expectedRegion: { ...region, countryCode: 'NG' } }), /Nigeria/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, expectedRegion: { ...region, parentId: 'legacy-ng' } }), /Nigeria/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, expectedRegion: { ...region, id: 'legacy-ng' } }), /Nigeria/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, expectedRegion: { ...region, kind: 'country' } }), /city or cell/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, expectedRegion: { ...region, countryCode: null } }), /requires an ISO alpha-2/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, rawSource: { ...binding.rawSource, url: 'https://example.test/source.json' } }), /exact POWER request/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, association: { ...binding.association, sampleInsidePackBounds: false } }), /containment disclosure/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, association: { ...binding.association, centreOffsetDegrees: { longitude: 0.001, latitude: 0 } } }), /centre offsets/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, association: { ...binding.association, maximumAbsoluteCentreOffsetDegrees: 0.02 } }), /association policy/);
  assert.throws(() => validateClimateAttachmentBinding({ ...binding, environmentRequest: { ...request, longitude: -0.19 } }), /exact POWER request/);
});

test('rejects byte substitution, legacy fields, climate conflicts, and incomplete tile sets', () => {
  assert.throws(() => compileClimateAttachment({ ...input, rawSourceBytes: new Uint8Array([...raw, 0]) }), /raw POWER source bytes/);
  assert.throws(() => compileClimateAttachment({ ...input, environmentBytes: new TextEncoder().encode(JSON.stringify({ ...env, unrecognized: true })) }), /environment manifest/);
  const baseWithExtra = JSON.parse(new TextDecoder().decode(input.baseBytes)) as Record<string, unknown>;
  baseWithExtra.extra = 'must not disappear';
  const badBase = new TextEncoder().encode(JSON.stringify(baseWithExtra));
  const bindingForBadBase = { ...binding, baseManifest: { ...binding.baseManifest, sha256: sha256(badBase), bytes: badBase.byteLength, path: `.cache/world-build/campaigns/synthetic-campaign/output/manifests/${sha256(badBase)}.json` } };
  assert.throws(() => compileClimateAttachment({ ...input, binding: bindingForBadBase, baseBytes: badBase }), /fields the legacy validator would discard/);
  const climateBase = encodeManifest({ ...base, climate: { sourceId: 'synthetic-base', period: 'test', months: Array.from({ length: 12 }, () => ({ temperatureC: 1, relativeHumidityPct: 1, precipitationMm: 1, windMps: 1 })) } });
  const climateBinding = { ...binding, baseManifest: { ...binding.baseManifest, sha256: climateBase.hash, bytes: climateBase.bytes.byteLength, path: `.cache/world-build/campaigns/synthetic-campaign/output/manifests/${climateBase.hash}.json` } };
  assert.throws(() => compileClimateAttachment({ ...input, binding: climateBinding, baseBytes: climateBase.bytes }), /already contains climate/);
  assert.throws(() => compileClimateAttachment({ ...input, tiles: [] }), /all original tile bodies/);
  const changedTile = new Uint8Array(encodedTile.bytes); changedTile[changedTile.length - 2] = changedTile[changedTile.length - 2]! ^ 1;
  assert.throws(() => compileClimateAttachment({ ...input, tiles: [{ relative: encodedTile.ref.path, body: changedTile }] }), /does not match its pinned reference/);
  assert.throws(() => compileClimateAttachment({ ...input, tiles: [...input.tiles, { relative: 'tiles/extra.json', body: encodedTile.bytes }] }), /all original tile bodies/);
  const roadTile = encodeTile({ ...tile, roads: [{ id: 'synthetic-road', sourceId: 'missing-source', points: [[-0.2, 5.55], [-0.199, 5.55]], class: 'residential', level: 0 }] });
  const roadBase = encodeManifest({ ...base, tiles: [roadTile.ref] });
  const roadBaseHash = roadBase.hash;
  const roadBinding = { ...binding, baseManifest: { ...binding.baseManifest, sha256: roadBaseHash, bytes: roadBase.bytes.byteLength, path: `.cache/world-build/campaigns/synthetic-campaign/output/manifests/${roadBaseHash}.json` } };
  assert.throws(() => compileClimateAttachment({ ...input, binding: roadBinding, baseBytes: roadBase.bytes, tiles: [{ relative: roadTile.ref.path, body: roadTile.bytes }] }), /refers to a source absent from the base manifest/);
});

test('rejects changed point, environment derivation, profile source collision, and offset beyond the reviewed guard', () => {
  const wrongRaw = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  (wrongRaw.geometry as { coordinates: number[] }).coordinates[0] = -0.199;
  const wrongRawBytes = new TextEncoder().encode(JSON.stringify(wrongRaw));
  const wrongRawBinding = { ...binding, rawSource: { ...binding.rawSource, sha256: sha256(wrongRawBytes), bytes: wrongRawBytes.byteLength } };
  assert.throws(() => compileClimateAttachment({ ...input, binding: wrongRawBinding, rawSourceBytes: wrongRawBytes }), /does not match the requested point/);
  const alteredEnv = { ...env, profile: { ...env.profile, months: env.profile.months.map((month, index) => index === 0 ? { ...month, temperatureC: month.temperatureC + 1 } : month) } };
  const alteredEnvBytes = new TextEncoder().encode(JSON.stringify(alteredEnv));
  const alteredHash = sha256(alteredEnvBytes);
  const alteredBinding = { ...binding, environmentManifest: { ...binding.environmentManifest, sha256: alteredHash, bytes: alteredEnvBytes.byteLength, path: `.cache/world-build/output/environment/manifests/${alteredHash}.json` } };
  assert.throws(() => compileClimateAttachment({ ...input, binding: alteredBinding, environmentBytes: alteredEnvBytes }), /does not reconstruct/);
  const collisionBase = encodeManifest({ ...base, sources: [{ ...base.sources[0]!, id: env.source.id }, ...base.sources.slice(1)] });
  const collisionBinding = { ...binding, baseManifest: { ...binding.baseManifest, sha256: collisionBase.hash, bytes: collisionBase.bytes.byteLength, path: `.cache/world-build/campaigns/synthetic-campaign/output/manifests/${collisionBase.hash}.json` } };
  assert.throws(() => compileClimateAttachment({ ...input, binding: collisionBinding, baseBytes: collisionBase.bytes }), /already contains the climate source id/);
  const farRegion = { ...region, bounds: [-0.18, 5.54, -0.17, 5.56] as Region['bounds'] };
  const farBinding = { ...binding, expectedRegion: farRegion };
  assert.throws(() => compileClimateAttachment({ ...input, binding: farBinding }), /reviewed centre-offset/);
});
