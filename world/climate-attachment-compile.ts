import { buildEnvironmentManifest, powerMonthlyUrl, validateEnvironmentManifest, validateEnvironmentRequest } from './environment.ts';
import { canonicalJson, sha256 } from './pack.ts';
import { validateManifest, validateTile } from './validate.ts';
import {
  CLIMATE_ATTACHMENT_COMPILER, CLIMATE_ATTACHMENT_LIMITS, CLIMATE_ATTACHMENT_POLICY,
  CLIMATE_ATTACHMENT_PRODUCT,
  type ClimateAttachmentBinding, type ClimateAttachmentBuildInput,
  type ClimateAttachmentProvenance, type CompiledClimateAttachment,
} from './climate-attachment-types.ts';
import type { EnvironmentManifest } from './environment-types.ts';
import type { Region, TileRef, WorldManifest, WorldTile } from './types.ts';

const NO_CLIMATE = 'climate unavailable: no monthly regional climate source was provided';
const PROVENANCE_PREFIX = 'Climate attachment provenance sha256:';
const LF = '\n';
const LIMITATIONS = [
  'The climate profile is a 1991–2020 monthly normal from a single native MERRA-2 grid sample, not current weather or a spatial average of the pack region.',
  'Precipitation is a monthly accumulation derived from the NASA POWER PRECTOTCORR monthly mean rate; it is not rain intensity.',
  'The city-associated sample may be outside the pack bounds; the explicit pinned association and exact requested and returned coordinates are recorded in provenance.',
  'NASA POWER metadata does not provide a separate API product license; source attribution and the provider data-use notice are preserved.',
];

export function canonicalClimateJson(value: unknown): string { return canonicalJson(value); }
const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(`${canonicalClimateJson(value)}${LF}`);
const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
};
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`unknown ${label} field: ${key}`);
}
function equal(a: unknown, b: unknown): boolean { return canonicalClimateJson(a) === canonicalClimateJson(b); }
function parseUtf8(bytes: Uint8Array, label: string): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new TypeError(`${label} must be valid UTF-8 JSON`); }
}
function digest(bytes: Uint8Array): string { return sha256(bytes); }
function checkPin(value: unknown, label: string, maxBytes: number, withUrl = false): asserts value is ClimateAttachmentBinding['baseManifest'] {
  const pin = object(value, label);
  exactKeys(pin, withUrl ? ['sha256', 'bytes', 'path', 'url'] : ['sha256', 'bytes', 'path'], label);
  if (typeof pin.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw new TypeError(`${label}.sha256 must be lowercase SHA-256`);
  if (typeof pin.bytes !== 'number' || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || pin.bytes > maxBytes) throw new RangeError(`${label}.bytes is outside its cap`);
  if (typeof pin.path !== 'string' || pin.path.startsWith('/') || pin.path.includes('\\') || pin.path.split('/').some(x => !x || x === '.' || x === '..')) throw new TypeError(`${label}.path must be a canonical relative path`);
  if (withUrl && (typeof pin.url !== 'string' || pin.url.length > 2048)) throw new TypeError(`${label}.url is invalid`);
}
function validateRegion(value: unknown): Region {
  const region = object(value, 'expectedRegion');
  exactKeys(region, ['id', 'parentId', 'name', 'kind', 'countryCode', 'timezone', 'bounds'], 'expectedRegion');
  const dummy = validateManifest({
    schemaVersion: 1, compilerVersion: 'climate-binding-validation', region,
    frame: 'wgs84-enu-m-v1', verticalDatum: 'WGS84-ellipsoid', coverage: 'foundation',
    exceptions: [], sources: [], tiles: [], climate: null,
  });
  if (!equal(dummy.region, region)) throw new TypeError('expectedRegion is not in canonical Region form');
  return dummy.region;
}
function safeId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 80) throw new TypeError(`${label} is invalid`);
}
function expectedPath(value: string, regexp: RegExp, label: string): void {
  if (!regexp.test(value)) throw new TypeError(`${label} is outside the climate attachment input namespace`);
}

/** Strictly validate the exact association contract consumed by this pure compiler. */
export function validateClimateAttachmentBinding(value: unknown): ClimateAttachmentBinding {
  const binding = object(value, 'climate attachment binding');
  exactKeys(binding, ['schemaVersion', 'id', 'campaignId', 'baseManifest', 'expectedRegion', 'environmentManifest', 'environmentRequest', 'rawSource', 'expectedSample', 'association'], 'binding');
  if (binding.schemaVersion !== 1) throw new TypeError('unsupported climate attachment binding schema');
  safeId(binding.id, 'binding.id');
  safeId(binding.campaignId, 'binding.campaignId');
  checkPin(binding.baseManifest, 'baseManifest', CLIMATE_ATTACHMENT_LIMITS.baseManifestBytes);
  checkPin(binding.environmentManifest, 'environmentManifest', CLIMATE_ATTACHMENT_LIMITS.environmentManifestBytes);
  checkPin(binding.rawSource, 'rawSource', CLIMATE_ATTACHMENT_LIMITS.rawSourceBytes, true);
  const base = binding.baseManifest as ClimateAttachmentBinding['baseManifest'];
  const env = binding.environmentManifest as ClimateAttachmentBinding['environmentManifest'];
  const raw = binding.rawSource as ClimateAttachmentBinding['rawSource'];
  expectedPath(base.path, new RegExp(`^\\.cache/world-build/campaigns/${binding.campaignId}/output/manifests/[a-f0-9]{64}\\.json$`), 'base manifest path');
  if (!base.path.endsWith(`/${base.sha256}.json`)) throw new TypeError('base manifest path hash does not match pin');
  expectedPath(env.path, /^\.cache\/world-build\/output\/environment\/manifests\/[a-f0-9]{64}\.json$/, 'environment manifest path');
  if (!env.path.endsWith(`/${env.sha256}.json`)) throw new TypeError('environment manifest path hash does not match pin');
  expectedPath(raw.path, /^\.cache\/world-build\/environment-source-cache\/[A-Za-z0-9._-]+\.json$/, 'raw source path');
  const region = validateRegion(binding.expectedRegion);
  if (region.kind !== 'city' && region.kind !== 'cell') throw new TypeError('climate association region must be a city or cell');
  if (region.countryCode === null || !/^[A-Z]{2}$/.test(region.countryCode)) throw new TypeError('climate association region requires an ISO alpha-2 country code');
  if (region.countryCode === 'NG' || region.parentId === 'legacy-ng' || region.id === 'legacy-ng') throw new TypeError('Nigeria climate attachment is protected');
  const request = validateEnvironmentRequest(binding.environmentRequest);
  if (request.id !== binding.id) throw new TypeError('binding id must equal environment request id');
  if (typeof raw.url !== 'string' || raw.url !== powerMonthlyUrl(request)) throw new TypeError('raw source URL does not match the exact POWER request');
  const sample = object(binding.expectedSample, 'expectedSample');
  exactKeys(sample, ['longitude', 'latitude'], 'expectedSample');
  if (typeof sample.longitude !== 'number' || !Number.isFinite(sample.longitude) || typeof sample.latitude !== 'number' || !Number.isFinite(sample.latitude) || sample.longitude < -180 || sample.longitude > 180 || sample.latitude < -90 || sample.latitude > 90) throw new TypeError('expected sample point is invalid');
  const association = object(binding.association, 'association');
  exactKeys(association, ['mode', 'sampleInsidePackBounds', 'centreOffsetDegrees', 'maximumAbsoluteCentreOffsetDegrees', 'disclosure'], 'association');
  if (association.mode !== 'explicit-city-associated-native-grid-point' || typeof association.sampleInsidePackBounds !== 'boolean' || association.maximumAbsoluteCentreOffsetDegrees !== 0.01 || typeof association.disclosure !== 'string' || !association.disclosure.trim() || association.disclosure.length > 2000) throw new TypeError('association policy is invalid');
  const offset = object(association.centreOffsetDegrees, 'association.centreOffsetDegrees');
  exactKeys(offset, ['longitude', 'latitude'], 'association.centreOffsetDegrees');
  if (typeof offset.longitude !== 'number' || !Number.isFinite(offset.longitude) || typeof offset.latitude !== 'number' || !Number.isFinite(offset.latitude)) throw new TypeError('association centre offset is invalid');
  const [west, south, east, north] = region.bounds;
  const centreLon = (west + (west > east ? east + 360 : east)) / 2;
  const normalizedCentre = centreLon > 180 ? centreLon - 360 : centreLon;
  const expectedOffset = { longitude: sample.longitude - normalizedCentre, latitude: sample.latitude - (south + north) / 2 };
  if (Math.abs(expectedOffset.longitude) >= 0.01 || Math.abs(expectedOffset.latitude) >= 0.01) throw new TypeError('sample must be below the reviewed centre-offset association limit');
  if (offset.longitude !== expectedOffset.longitude || offset.latitude !== expectedOffset.latitude) throw new TypeError('association centre offsets do not match the sample and pack bounds');
  if (association.sampleInsidePackBounds !== isInside(sample.longitude, sample.latitude, region.bounds)) throw new TypeError('association containment disclosure does not match the sample and pack bounds');
  return value as ClimateAttachmentBinding;
}

function isInside(lon: number, lat: number, bounds: Region['bounds']): boolean {
  const inLongitude = bounds[0] <= bounds[2] ? lon >= bounds[0] && lon <= bounds[2] : lon >= bounds[0] || lon <= bounds[2];
  return inLongitude && lat >= bounds[1] && lat <= bounds[3];
}
function validateAssociation(binding: ClimateAttachmentBinding, env: EnvironmentManifest): void {
  const [west, south, east, north] = binding.expectedRegion.bounds;
  const centreLon = (west + (west > east ? east + 360 : east)) / 2;
  const normalizedCentre = centreLon > 180 ? centreLon - 360 : centreLon;
  const centreLat = (south + north) / 2;
  const lonOffset = binding.expectedSample.longitude - normalizedCentre;
  const latOffset = binding.expectedSample.latitude - centreLat;
  if (Math.abs(lonOffset) >= binding.association.maximumAbsoluteCentreOffsetDegrees || Math.abs(latOffset) >= binding.association.maximumAbsoluteCentreOffsetDegrees) throw new TypeError('sample is not below the reviewed centre-offset association limit');
  if (binding.association.sampleInsidePackBounds !== isInside(binding.expectedSample.longitude, binding.expectedSample.latitude, binding.expectedRegion.bounds)) throw new TypeError('association containment disclosure does not match the sample and pack bounds');
  if (binding.association.centreOffsetDegrees.longitude !== lonOffset || binding.association.centreOffsetDegrees.latitude !== latOffset) throw new TypeError('association centre offsets do not match the sample and pack bounds');
  if (env.point.longitude !== binding.expectedSample.longitude || env.point.latitude !== binding.expectedSample.latitude) throw new TypeError('environment sample differs from the pinned returned point');
  if (env.point.requestedLongitude !== binding.environmentRequest.longitude || env.point.requestedLatitude !== binding.environmentRequest.latitude) throw new TypeError('environment sample differs from exact requested coordinates');
}
function checkBytes(bytes: Uint8Array, pin: { bytes: number; sha256: string }, max: number, label: string): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > max || bytes.byteLength !== pin.bytes || digest(bytes) !== pin.sha256) throw new TypeError(`${label} bytes do not match the pinned SHA-256 and length`);
}
function sourceEqual(a: unknown, b: unknown): boolean { return equal(a, b); }
function exactManifestBytes(bytes: Uint8Array, pin: ClimateAttachmentBinding['baseManifest']): WorldManifest {
  checkBytes(bytes, pin, CLIMATE_ATTACHMENT_LIMITS.baseManifestBytes, 'base manifest');
  const parsed = parseUtf8(bytes, 'base manifest');
  const manifest = validateManifest(parsed);
  if (!equal(parsed, manifest)) throw new TypeError('base manifest contains fields the legacy validator would discard');
  return manifest;
}
function strictEnvironment(bytes: Uint8Array, pin: ClimateAttachmentBinding['environmentManifest']): EnvironmentManifest {
  checkBytes(bytes, pin, CLIMATE_ATTACHMENT_LIMITS.environmentManifestBytes, 'environment manifest');
  const parsed = parseUtf8(bytes, 'environment manifest');
  const validated = validateEnvironmentManifest(parsed);
  if (!equal(parsed, validated)) throw new TypeError('environment manifest is not in canonical validated form');
  return validated;
}
function climateLimitations(binding: ClimateAttachmentBinding, env: EnvironmentManifest): string[] {
  const containment = binding.association.sampleInsidePackBounds ? 'inside' : 'outside';
  return [
    `${binding.association.disclosure} The returned point (${env.point.longitude}, ${env.point.latitude}) is ${containment} the pack bounds; the requested point was (${env.point.requestedLongitude}, ${env.point.requestedLatitude}).`,
    LIMITATIONS[0]!, LIMITATIONS[1]!, LIMITATIONS[3]!,
  ];
}

/** Pure source-bound derivation. It does not write output or acquire data. */
export function compileClimateAttachment(input: ClimateAttachmentBuildInput): CompiledClimateAttachment {
  if (!input || typeof input !== 'object') throw new TypeError('climate attachment input is required');
  const binding = validateClimateAttachmentBinding(input.binding);
  checkBytes(input.baseBytes, binding.baseManifest, CLIMATE_ATTACHMENT_LIMITS.baseManifestBytes, 'base manifest');
  checkBytes(input.environmentBytes, binding.environmentManifest, CLIMATE_ATTACHMENT_LIMITS.environmentManifestBytes, 'environment manifest');
  checkBytes(input.rawSourceBytes, binding.rawSource, CLIMATE_ATTACHMENT_LIMITS.rawSourceBytes, 'raw POWER source');
  if (!Array.isArray(input.tiles) || input.tiles.length > CLIMATE_ATTACHMENT_LIMITS.tiles) throw new RangeError('tile input count exceeds the climate attachment cap');
  const suppliedBytes = input.tiles.reduce((sum, entry) => {
    if (!entry || !(entry.body instanceof Uint8Array)) throw new TypeError('tile input body must be Uint8Array');
    const total = sum + entry.body.byteLength;
    if (!Number.isSafeInteger(total) || total > CLIMATE_ATTACHMENT_LIMITS.logicalBytes) throw new RangeError('tile input bytes exceed climate attachment logical output cap');
    return total;
  }, 0);
  const base = exactManifestBytes(input.baseBytes, binding.baseManifest);
  if (base.climate !== null) throw new TypeError('base manifest already contains climate');
  if (!equal(base.region, binding.expectedRegion)) throw new TypeError('base manifest region does not exactly match the reviewed association');
  if (base.exceptions.filter(item => item === NO_CLIMATE).length !== 1) throw new TypeError('base manifest must contain exactly one climate-unavailable exception');
  const env = strictEnvironment(input.environmentBytes, binding.environmentManifest);
  const rawParsed = parseUtf8(input.rawSourceBytes, 'raw POWER source');
  const reconstructed = buildEnvironmentManifest(binding.environmentRequest, input.rawSourceBytes, binding.rawSource.url);
  if (!equal(reconstructed, env)) throw new TypeError('environment manifest does not reconstruct from the pinned raw POWER response');
  if (!equal(env.source, reconstructed.source)) throw new TypeError('environment source metadata is inconsistent');
  if (env.source.sha256 !== binding.rawSource.sha256 || env.source.bytes !== binding.rawSource.bytes || env.source.url !== binding.rawSource.url) throw new TypeError('environment source identity differs from the raw source pin');
  if (env.profile.months.length !== 12 || env.baseline.startYear !== 1991 || env.baseline.endYear !== 2020 || env.source.monthlyRecordCount !== 360 || env.source.spatialResolution.latitudeDegrees !== 0.5 || env.source.spatialResolution.longitudeDegrees !== 0.625 || env.source.timeStandard !== 'LST') throw new TypeError('environment profile does not satisfy the frozen monthly MERRA-2 contract');
  validateAssociation(binding, env);
  if (base.sources.some(source => source.id === env.source.id)) throw new TypeError('base manifest already contains the climate source id');
  if (base.exceptions.some(item => item.startsWith(PROVENANCE_PREFIX))) throw new TypeError('base manifest already contains climate provenance');

  if (input.tiles.length !== base.tiles.length) throw new TypeError('all original tile bodies must be supplied exactly once');
  const supplied = new Map<string, Uint8Array>();
  for (const tile of input.tiles) {
    if (!tile || typeof tile.relative !== 'string' || !(tile.body instanceof Uint8Array) || tile.body.byteLength > CLIMATE_ATTACHMENT_LIMITS.tileBytes) throw new TypeError('tile input is invalid or exceeds its cap');
    if (supplied.has(tile.relative)) throw new TypeError('duplicate tile body path');
    supplied.set(tile.relative, tile.body);
  }
  const copiedTiles: Array<{ relative: string; body: Uint8Array }> = [];
  const sourceIds = new Set(base.sources.map(source => source.id));
  for (const ref of base.tiles) {
    if (ref.bytes > CLIMATE_ATTACHMENT_LIMITS.tileBytes) throw new RangeError(`original tile ${ref.id} exceeds climate attachment tile cap`);
    if (ref.path !== `tiles/${ref.sha256}.json`) throw new TypeError(`original tile ${ref.id} is not at its exact content-addressed path`);
    const body = supplied.get(ref.path);
    if (!body || body.byteLength !== ref.bytes || digest(body) !== ref.sha256) throw new TypeError(`original tile ${ref.id} does not match its pinned reference`);
    const parsed = parseUtf8(body, `tile ${ref.id}`);
    const validated = validateTile(parsed);
    if (!equal(parsed, validated)) throw new TypeError(`tile ${ref.id} contains fields the validator would discard`);
    if (validated.id !== ref.id || validated.regionId !== base.region.id || !equal(validated.bounds, ref.bounds)) throw new TypeError(`tile ${ref.id} identity or bounds differ from its reference`);
    if (validated.buildings.some(building => !sourceIds.has(building.sourceId)) || validated.roads.some(road => !sourceIds.has(road.sourceId))) throw new TypeError(`tile ${ref.id} refers to a source absent from the base manifest`);
    copiedTiles.push({ relative: ref.path, body: new Uint8Array(body) });
    supplied.delete(ref.path);
  }
  if (supplied.size) throw new TypeError('unexpected tile bodies were supplied');
  const tileBytes = copiedTiles.reduce((sum, tile) => sum + tile.body.byteLength, 0);
  if (tileBytes !== suppliedBytes) throw new TypeError('supplied tile bytes do not exactly match the original tile set');

  const source = {
    id: env.source.id, url: env.source.url, release: env.source.release,
    license: env.source.license, attribution: env.source.attribution,
    sha256: env.source.sha256, bytes: env.source.bytes,
  };
  const manifest: WorldManifest = {
    ...base,
    sources: [...base.sources, source],
    climate: { sourceId: env.profile.sourceId, period: env.profile.period, months: env.profile.months.map(month => ({ ...month })) },
    exceptions: base.exceptions.filter(item => item !== NO_CLIMATE),
  };
  const disclosures = [
    `Climate association: explicit ${binding.environmentRequest.name} (${binding.id}) native-grid point association; this is not a measurement or spatial average of the pack cell.`,
    `Climate sample: requested (${binding.environmentRequest.longitude}, ${binding.environmentRequest.latitude}); returned (${env.point.longitude}, ${env.point.latitude}); sampleInsidePackBounds=${binding.association.sampleInsidePackBounds}; centreOffsetDegrees=(${binding.association.centreOffsetDegrees.longitude}, ${binding.association.centreOffsetDegrees.latitude}); native spacing ${env.source.spatialResolution.latitudeDegrees}° latitude × ${env.source.spatialResolution.longitudeDegrees}° longitude.`,
    `Climate baseline: 1991–2020 monthly normal, LST, not live weather; precipitation is monthly accumulation in millimetres derived from monthly mean mm/day rates, not rain intensity.`,
  ];
  manifest.exceptions.push(...disclosures);
  const provenance: ClimateAttachmentProvenance = {
    schemaVersion: 1, product: CLIMATE_ATTACHMENT_PRODUCT, compiler: CLIMATE_ATTACHMENT_COMPILER,
    policy: CLIMATE_ATTACHMENT_POLICY,
    binding: parseUtf8(new TextEncoder().encode(canonicalClimateJson(binding)), 'validated binding') as ClimateAttachmentBinding,
    environment: env,
    originalTiles: base.tiles.map(tile => ({ ...tile, bounds: [...tile.bounds] as TileRef['bounds'] })),
    limitations: climateLimitations(binding, env),
  };
  const provenanceBody = jsonBytes(provenance);
  if (provenanceBody.byteLength > CLIMATE_ATTACHMENT_LIMITS.provenanceBytes) throw new RangeError('climate provenance exceeds its byte cap');
  const provenanceHash = digest(provenanceBody);
  const provenancePath = `provenance/${provenanceHash}.json`;
  manifest.exceptions.push(`${PROVENANCE_PREFIX}${provenanceHash}`);
  const normalizedManifest = validateManifest(manifest);
  if (!equal(normalizedManifest, manifest)) throw new TypeError('derived climate manifest is not valid in the existing world schema');
  const manifestBody = jsonBytes(normalizedManifest);
  if (manifestBody.byteLength > CLIMATE_ATTACHMENT_LIMITS.manifestBytes) throw new RangeError('derived climate manifest exceeds its byte cap');
  const manifestHash = digest(manifestBody);
  const manifestPath = `manifests/${manifestHash}.json`;
  const provenanceAsset = { relative: provenancePath, body: provenanceBody };
  const manifestAsset = { relative: manifestPath, body: manifestBody };
  const assets = [...copiedTiles, provenanceAsset, manifestAsset];
  const bytes = tileBytes + provenanceBody.byteLength + manifestBody.byteLength;
  if (bytes > CLIMATE_ATTACHMENT_LIMITS.logicalBytes) throw new RangeError('climate attachment logical output exceeds its cap');
  // Keep raw parsed data live through reconstruction validation; parsing is intentionally strict/fatal UTF-8.
  void rawParsed;
  return { manifest: normalizedManifest, manifestHash, manifestPath, provenance, provenanceHash, provenancePath, assets, bytes };
}
