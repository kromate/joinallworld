import { createHash } from 'node:crypto';
import type { InventoryNode } from './production-types.ts';
import type { SourceRecord } from './types.ts';
import { SETTLEMENT_COMPILER, SETTLEMENT_PRODUCT, SETTLEMENT_PRODUCT_LIMITS as LIMITS, type CompiledSettlementProduct, type SettlementAuditRow, type SettlementBuildInput, type SettlementCountryPoints, type SettlementCountryRef, type SettlementInspectionReport, type SettlementPointRecord, type SettlementProductManifest } from './settlement-product-types.ts';

const HEX64 = /^[a-f0-9]{64}$/;
const HEX40 = /^[a-f0-9]{40}$/;
const LIMITATIONS = [
  'selected Natural Earth populated-place references are not exhaustive settlement coverage',
  'Natural Earth country depictions are cartographic and are not an assertion of sovereignty or legal boundaries',
  'point locations do not establish buildings, navigation, official administration, weather, or playability',
  'source identity uses literal NE_ID and literal ADM0_A3 only; no name, ISO, casing, or crosswalk fallback is applied',
  'point validation checks source structure and WGS84 coordinate ranges, not geodetic accuracy or settlement validity',
] as const;

function fail(message: string): never { throw new Error(message); }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 64) throw new RangeError('settlement JSON nesting exceeds depth 64');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('settlement JSON contains a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(entry => canonical(entry, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort(compareText).map(key => {
      if (row[key] === undefined) throw new TypeError('settlement JSON contains undefined');
      return `${JSON.stringify(key)}:${canonical(row[key], depth + 1)}`;
    }).join(',')}}`;
  }
  throw new TypeError('settlement JSON contains a non-JSON value');
}
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function sha256(value: Uint8Array | string): string { return createHash('sha256').update(value).digest('hex'); }
function canonicalAsset(value: unknown): Uint8Array { return Buffer.from(`${canonical(value)}\n`); }
function text(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${label} must be bounded non-empty text`);
  return value;
}
function sourceRecord(value: unknown, raw: Uint8Array, label: string): SourceRecord {
  const source = object(value, label);
  const keys = ['id', 'url', 'release', 'license', 'attribution', 'sha256', 'bytes'];
  if (Object.keys(source).length !== keys.length || keys.some(key => !Object.hasOwn(source, key))) throw new TypeError(`${label} has missing or unknown fields`);
  text(source.id, `${label}.id`, 256); text(source.url, `${label}.url`, 2048); text(source.release, `${label}.release`, 128);
  text(source.license, `${label}.license`, 256); text(source.attribution, `${label}.attribution`, 2048);
  if (typeof source.sha256 !== 'string' || !HEX64.test(source.sha256)) throw new TypeError(`${label} SHA-256 must be lowercase 64-hex`);
  if (typeof source.bytes !== 'number' || !Number.isSafeInteger(source.bytes) || source.bytes !== raw.byteLength) throw new Error(`${label} byte count differs from raw bytes`);
  if (sha256(raw) !== source.sha256) throw new Error(`${label} SHA-256 differs from raw bytes`);
  return source as unknown as SourceRecord;
}
function parseDocument(raw: Uint8Array, label: string, maxBytes: number, maxFeatures: number): Record<string, unknown> & { features: unknown[] } {
  if (raw.byteLength > maxBytes) throw new RangeError(`${label} exceeds ${maxBytes} bytes`);
  let textValue: string;
  try { textValue = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw new TypeError(`${label} is not valid UTF-8`); }
  let parsed: unknown;
  try { parsed = JSON.parse(textValue) as unknown; } catch { throw new TypeError(`${label} is not valid JSON`); }
  const doc = object(parsed, label);
  if (doc.type !== 'FeatureCollection' || !Array.isArray(doc.features)) throw new TypeError(`${label} must be a GeoJSON FeatureCollection`);
  if (doc.features.length > maxFeatures) throw new RangeError(`${label} exceeds its feature count cap`);
  // Walk the document once to reject JSON numbers that JSON.parse accepts as Infinity.
  canonical(doc);
  return doc as Record<string, unknown> & { features: unknown[] };
}
function sourceKey(value: unknown, label: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a canonical positive safe integer`);
    return String(value);
  }
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) return value;
  throw new TypeError(`${label} must be a canonical positive safe integer number or digit string`);
}
function feature(value: unknown, label: string): { record: Record<string, unknown>; properties: Record<string, unknown>; geometry: unknown } {
  const row = object(value, label);
  if (row.type !== 'Feature') throw new TypeError(`${label} must be a GeoJSON Feature`);
  const properties = object(row.properties, `${label}.properties`);
  if (Buffer.byteLength(canonical(properties), 'utf8') > LIMITS.propertiesBytes) throw new RangeError(`${label}.properties exceeds 32 KiB`);
  return { record: row, properties, geometry: row.geometry };
}
function pointCoordinates(value: unknown): { coordinates: [number, number] | null; issue: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { coordinates: null, issue: 'geometry-not-point' };
  const geometry = value as Record<string, unknown>;
  if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return { coordinates: null, issue: 'geometry-not-point' };
  const coordinates = geometry.coordinates;
  if (coordinates.length !== 2 || coordinates.some(item => typeof item !== 'number' || !Number.isFinite(item))) return { coordinates: null, issue: 'point-requires-two-finite-ordinates' };
  const longitude = coordinates[0] as number, latitude = coordinates[1] as number;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return { coordinates: null, issue: 'point-outside-wgs84-longitude-latitude-range' };
  return { coordinates: [longitude, latitude], issue: null };
}
function sourceLabel(properties: Record<string, unknown>): { name: string; nameAscii: string; sourceClass: string; scaleRank: number } | null {
  const name = properties.NAME, nameAscii = properties.NAMEASCII, sourceClass = properties.FEATURECLA, scaleRank = properties.SCALERANK;
  for (const [value, label] of [[name, 'NAME'], [nameAscii, 'NAMEASCII'], [sourceClass, 'FEATURECLA']] as const) {
    if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > LIMITS.textBytes || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  }
  if (typeof scaleRank !== 'number' || !Number.isInteger(scaleRank) || scaleRank < 0 || scaleRank > 10) return null;
  return { name: name as string, nameAscii: nameAscii as string, sourceClass: sourceClass as string, scaleRank };
}
function stableUniqueCountryNodes(nodes: unknown[]): InventoryNode[] {
  if (nodes.length > LIMITS.countries * 2 + 32) throw new RangeError('settlement parent node list exceeds hierarchy bound');
  const ids = new Set<string>(), countries: InventoryNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = object(nodes[i], `parent.nodes[${i}]`);
    text(node.id, `parent.nodes[${i}].id`, 512); text(node.name, `parent.nodes[${i}].name`, 512);
    if (ids.has(node.id as string)) throw new Error('settlement parent node IDs must be unique');
    ids.add(node.id as string);
    if (node.kind !== 'world' && node.kind !== 'continent' && node.kind !== 'country') throw new TypeError('settlement parent contains an unsupported node kind');
    if (!Array.isArray(node.sourceFeatureIds) || node.sourceFeatureIds.length > LIMITS.sourceUnits) throw new TypeError('parent source feature references are malformed or oversized');
    if (node.kind !== 'country' && node.sourceFeatureIds.length !== 0) throw new Error('non-country parent node cannot own source feature references');
    if (node.kind === 'country') {
      if (node.provider !== 'world' && node.provider !== 'legacy-ng') throw new Error('settlement parent country has an unsupported provider');
      if (node.sourceFeatureIds.length !== 1) throw new Error(`settlement parent country ${String(node.id)} must bind exactly one raw source feature`);
      countries.push(node as unknown as InventoryNode);
    }
  }
  if (countries.length > LIMITS.countries) throw new RangeError('settlement parent exceeds 1,024 countries');
  if (new Set(countries.map(node => node.id)).size !== countries.length) throw new Error('settlement parent country IDs must be unique');
  return countries;
}
function compileParent(input: SettlementBuildInput): { source: SourceRecord; manifestHash: string; countries: InventoryNode[]; candidates: Map<string, Set<string>> } {
  const parent = object(input.parent, 'settlement parent input');
  if (!(parent.raw instanceof Uint8Array) || parent.raw.byteLength > LIMITS.parentSourceBytes) throw new RangeError('settlement parent raw bytes exceed the 16 MiB cap');
  const source = sourceRecord(parent.source, parent.raw, 'settlement parent source');
  if (typeof parent.manifestHash !== 'string' || !HEX64.test(parent.manifestHash)) throw new TypeError('settlement parent manifest hash must be lowercase 64-hex');
  if (!Array.isArray(parent.nodes)) throw new TypeError('settlement parent nodes must be an array');
  const countries = stableUniqueCountryNodes(parent.nodes);
  const nigeria = countries.filter(node => node.id === 'legacy-ng');
  if (nigeria.length !== 1 || nigeria[0]!.provider !== 'legacy-ng' || nigeria[0]!.countryCode !== 'NG' || nigeria[0]!.outline !== 'missing') throw new Error('settlement parent must preserve exactly one legacy-ng protected country node');

  const doc = parseDocument(parent.raw as Uint8Array, 'settlement parent source', LIMITS.parentSourceBytes, LIMITS.countries);
  if (doc.features.length !== countries.reduce((count, node) => count + node.sourceFeatureIds.length, 0)) throw new Error('settlement parent features and country references do not conserve');
  const keyToNode = new Map<string, InventoryNode>();
  const refs = new Set<string>();
  for (const node of countries) for (const ref of node.sourceFeatureIds) {
    if (typeof ref !== 'string' || ref.length > 1024 || refs.has(ref)) throw new Error('settlement parent source references must be unique bounded strings');
    refs.add(ref);
    const prefix = `${source.id}:NE_ID:`;
    if (!ref.startsWith(prefix)) throw new Error(`parent country ${node.id} has a source reference outside its pinned NE_ID source`);
    const key = sourceKey(ref.slice(prefix.length), 'parent source reference NE_ID');
    if (keyToNode.has(key)) throw new Error('a parent NE_ID source reference belongs to multiple countries');
    keyToNode.set(key, node);
  }

  const candidates = new Map<string, Set<string>>(), seenKeys = new Set<string>();
  let nigeriaRawFeatures = 0;
  for (let i = 0; i < doc.features.length; i++) {
    const row = feature(doc.features[i], `parent feature ${i}`), key = sourceKey(row.properties.NE_ID, `parent feature ${i} NE_ID`);
    if (seenKeys.has(key)) throw new Error(`duplicate parent NE_ID ${key}`);
    seenKeys.add(key);
    const node = keyToNode.get(key);
    if (!node) throw new Error(`parent feature NE_ID ${key} is not referenced by exactly one country node`);
    const code = row.properties.ADM0_A3;
    if (typeof code !== 'string' || !code || Buffer.byteLength(code, 'utf8') > 64 || /[\u0000-\u001f\u007f]/u.test(code)) throw new Error(`parent feature NE_ID ${key} has invalid literal ADM0_A3`);
    if (code === 'NGA') {
      nigeriaRawFeatures++;
      if (node.id !== 'legacy-ng') throw new Error('parent ADM0_A3 NGA must map solely to legacy-ng');
    } else if (node.id === 'legacy-ng' || node.provider === 'legacy-ng' || node.countryCode === 'NG') {
      throw new Error('legacy-ng may only be referenced by parent ADM0_A3 NGA');
    }
    const set = candidates.get(code) ?? new Set<string>(); set.add(node.id); candidates.set(code, set);
  }
  if (seenKeys.size !== keyToNode.size || [...keyToNode.keys()].some(key => !seenKeys.has(key))) throw new Error('parent country nodes and raw NE_ID identities do not bind exactly once');
  if (nigeriaRawFeatures !== 1) throw new Error('settlement parent must bind exactly one literal ADM0_A3 NGA feature to legacy-ng');
  return { source, manifestHash: parent.manifestHash as string, countries, candidates };
}

/** Build the deterministic source-bound selected-place report, per-country point assets, and manifest. */
export function compileSettlementProduct(inputValue: SettlementBuildInput): CompiledSettlementProduct {
  const input = object(inputValue, 'settlement build input') as unknown as SettlementBuildInput;
  if (!(input.raw instanceof Uint8Array) || input.raw.byteLength > LIMITS.sourceBytes) throw new RangeError('settlement source raw bytes exceed the 32 MiB cap');
  const source = sourceRecord(input.source, input.raw, 'settlement source');
  const parent = compileParent(input);
  const doc = parseDocument(input.raw, 'settlement source', LIMITS.sourceBytes, LIMITS.sourceUnits);
  const rows: SettlementAuditRow[] = [], countryPoints = new Map<string, SettlementPointRecord[]>();
  const assetByPath = new Map<string, { relative: string; body: Uint8Array }>();
  const countrySourceUnits = new Map<string, number>(), countryEmittedUnits = new Map<string, number>();
  const seenKeys = new Set<string>();
  let validPoints = 0, linked = 0, protectedCount = 0, unlinked = 0, ambiguous = 0, invalidRows = 0, emittedUnits = 0;

  for (let ordinal = 0; ordinal < doc.features.length; ordinal++) {
    const item = feature(doc.features[ordinal], `settlement feature ${ordinal}`);
    const key = sourceKey(item.properties.NE_ID, `settlement feature ${ordinal} NE_ID`);
    if (seenKeys.has(key)) throw new Error(`duplicate settlement NE_ID ${key}`);
    seenKeys.add(key);
    const adm0Raw = item.properties.ADM0_A3;
    const adm0Code = typeof adm0Raw === 'string' && Buffer.byteLength(adm0Raw, 'utf8') <= 64 && !/[\u0000-\u001f\u007f]/u.test(adm0Raw) ? adm0Raw : null;
    const candidates = adm0Code === null ? undefined : parent.candidates.get(adm0Code);
    let joinStatus: SettlementAuditRow['joinStatus'], countryId: string | null = null;
    const matched = candidates ? [...candidates].sort(compareText) : [];
    if (adm0Code === 'NGA' && (matched.length !== 1 || matched[0] !== 'legacy-ng')) throw new Error('source ADM0_A3 NGA must resolve solely to the protected legacy-ng country');
    if (matched.length === 1 && matched[0] === 'legacy-ng') { joinStatus = 'protected'; countryId = 'legacy-ng'; protectedCount++; }
    else if (matched.length === 1) { joinStatus = 'linked'; countryId = matched[0]!; linked++; }
    else if (matched.length > 1) { joinStatus = 'ambiguous'; ambiguous++; }
    else { joinStatus = 'unlinked'; unlinked++; }

    if (countryId !== null) countrySourceUnits.set(countryId, (countrySourceUnits.get(countryId) ?? 0) + 1);
    const point = pointCoordinates(item.geometry);
    if (point.issue === null) validPoints++;
    const label = sourceLabel(item.properties);
    const pointIssue = point.issue;
    const labelIssue = label ? null : 'required-source-label-or-scale-rank-invalid';
    if (pointIssue !== null || labelIssue !== null) invalidRows++;
    const publicKey = `NE_ID:${key}`;
    const id = `place:natural-earth:${encodeURIComponent(publicKey)}`;
    rows.push({ sourceOrdinal: ordinal, sourceKey: publicKey, id, featureSha256: sha256(canonical(item.record)), adm0Code, countryId, joinStatus, pointIssue, labelIssue, emitted: joinStatus === 'linked' && pointIssue === null && labelIssue === null });
    if (joinStatus === 'linked' && point.coordinates && label) {
      const output: SettlementPointRecord = { sourceOrdinal: ordinal, sourceKey: publicKey, id, ...label, coordinates: point.coordinates };
      const countryRows = countryPoints.get(countryId!) ?? []; countryRows.push(output); countryPoints.set(countryId!, countryRows);
      countryEmittedUnits.set(countryId!, (countryEmittedUnits.get(countryId!) ?? 0) + 1); emittedUnits++;
    }
  }

  if (rows.length !== doc.features.length || rows.length > LIMITS.sourceUnits) throw new Error('settlement source rows were not completely accounted for');
  rows.sort((a, b) => compareText(a.sourceKey, b.sourceKey));
  const countryRefs: SettlementCountryRef[] = parent.countries.map((node): SettlementCountryRef => {
    const sourceUnits = countrySourceUnits.get(node.id) ?? 0, emitted = countryEmittedUnits.get(node.id) ?? 0;
    const pointRows = countryPoints.get(node.id) ?? [];
    if (node.id === 'legacy-ng') return { countryId: node.id, status: 'protected', sourceUnits, emittedUnits: 0, points: null };
    if (emitted === 0) return { countryId: node.id, status: 'missing', sourceUnits, emittedUnits: 0, points: null };
    pointRows.sort((a, b) => compareText(a.sourceKey, b.sourceKey));
    const payload: SettlementCountryPoints = { schemaVersion: 1, product: SETTLEMENT_PRODUCT, countryId: node.id, sourceSha256: source.sha256, parentManifestHash: parent.manifestHash, sourceUnits, emittedUnits: emitted, rows: pointRows };
    const body = canonicalAsset(payload);
    if (body.byteLength > LIMITS.countryBytes) throw new RangeError(`settlement country ${node.id} point asset exceeds the 512,000-byte route ceiling`);
    const digest = sha256(body), relative = `points/${digest}.json`;
    const existing = assetByPath.get(relative);
    if (existing && Buffer.compare(Buffer.from(existing.body), Buffer.from(body)) !== 0) throw new Error('content-addressed settlement point asset collision');
    assetByPath.set(relative, { relative, body });
    return { countryId: node.id, status: 'available', sourceUnits, emittedUnits: emitted, points: { path: relative, sha256: digest, bytes: body.byteLength } };
  }).sort((a, b) => compareText(a.countryId, b.countryId));

  const countriesReport = countryRefs.map(ref => ({ countryId: ref.countryId, sourceUnits: ref.sourceUnits, emittedUnits: ref.emittedUnits }));
  const missingCountries = countryRefs.filter(ref => ref.status === 'missing').map(ref => ref.countryId).sort(compareText);
  const report: SettlementInspectionReport = {
    schemaVersion: 1, product: SETTLEMENT_PRODUCT, compiler: SETTLEMENT_COMPILER, source,
    parent: { manifestHash: parent.manifestHash, source: parent.source }, joinPolicy: 'literal-ADM0_A3-v1', keyField: 'NE_ID', countryField: 'ADM0_A3',
    sourceUnits: rows.length, validPoints, linked, protected: protectedCount, unlinked, ambiguous, invalidRows, emittedUnits,
    countries: countriesReport, missingCountries, rows, limitations: [...LIMITATIONS],
  };
  const reportBody = canonicalAsset(report);
  if (reportBody.byteLength > LIMITS.reportBytes) throw new RangeError('settlement inspection report exceeds 3 MiB');
  const reportHash = sha256(reportBody), reportPath = `reports/${reportHash}.json`;
  const manifest: SettlementProductManifest = {
    schemaVersion: 1, product: SETTLEMENT_PRODUCT, compiler: SETTLEMENT_COMPILER, source,
    parent: { manifestHash: parent.manifestHash, source: parent.source }, joinPolicy: 'literal-ADM0_A3-v1', keyField: 'NE_ID', countryField: 'ADM0_A3',
    representation: 'selected-source-point-geometry', validation: 'source-bound-structural-with-explicit-exceptions',
    sourceUnits: rows.length, validPoints, linked, protected: protectedCount, unlinked, ambiguous, invalidRows, emittedUnits,
    exceptionUnits: rows.length - emittedUnits, inspection: { path: reportPath, sha256: reportHash, bytes: reportBody.byteLength },
    countries: countryRefs, limitations: [...LIMITATIONS],
  };
  const manifestBody = canonicalAsset(manifest);
  if (manifestBody.byteLength > LIMITS.manifestBytes) throw new RangeError('settlement manifest exceeds 256 KiB');
  const manifestHash = sha256(manifestBody), manifestPath = `manifests/${manifestHash}.json`;
  const assets = [{ relative: reportPath, body: reportBody }, ...[...assetByPath.values()].sort((a, b) => compareText(a.relative, b.relative)), { relative: manifestPath, body: manifestBody }];
  const bytes = assets.reduce((sum, asset) => sum + asset.body.byteLength, 0);
  if (bytes > LIMITS.logicalBytes) throw new RangeError('settlement logical output exceeds 16 MiB');
  return { manifest, manifestHash, manifestPath, report, assets, bytes };
}
