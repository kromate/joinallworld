import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Bounds } from './types.ts';
import type { InventoryNode } from './production-types.ts';
import { createOutputStore } from './storage.ts';
import { FINE_LIMITS, type FineAdminNode, type FineIdentityEntry, type FineIdentityMigration, type FineIdentityRegistry, type FineInventory, type FineSourcePin } from './fine-types.ts';

const HEX64 = /^[a-f0-9]{64}$/;
const HEX40 = /^[a-f0-9]{40}$/;
const ISO2 = /^[A-Z]{2}$/;
const ISO3 = /^[A-Z]{3}$/;
const ADMIN_ID = /^admin:geoBoundaries:[a-f0-9]{64}$/;
const rawPrefix = 'https://raw.githubusercontent.com/wmgeolab/geoBoundaries/';
const mediaPrefix = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/';
const TOPOLOGY_LIMITATION = 'Structural coordinate checks do not establish complete polygon topology (including self-intersection or hole containment).';

function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical fine inventory cannot encode non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => {
      if (record[key] === undefined) throw new TypeError('canonical fine inventory cannot encode undefined');
      return `${JSON.stringify(key)}:${canonical(record[key])}`;
    }).join(',')}}`;
  }
  throw new TypeError('canonical fine inventory contains a non-JSON value');
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key))) throw new TypeError(`${label} has missing or unknown fields`);
}
function text(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || !value.trim()) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return value;
}
function boundedList(value: unknown, label: string, maxCount: number, maxText = 2048): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxCount) throw new TypeError(`${label} must be a bounded non-empty list`);
  const rows = value.map((entry, i) => text(entry, `${label}[${i}]`, maxText));
  if (new Set(rows).size !== rows.length) throw new TypeError(`${label} entries must be unique`);
  return rows;
}

/** Validate and return the immutable, fully pinned geoBoundaries ADM1 source contract. */
export function validateFineSourcePin(value: unknown): FineSourcePin {
  const pin = object(value, 'fine source pin');
  exactKeys(pin, ['schemaVersion', 'provider', 'source', 'input', 'countryCode', 'countryIso3', 'adminLevel', 'layerId',
    'canonicalType', 'representedYear', 'buildDate', 'expectedUnits', 'originalLicense', 'licenseEvidence',
    'metadataSha256', 'metadataBytes', 'boundaryPolicy'], 'fine source pin');
  if (pin.schemaVersion !== 1 || pin.provider !== 'geoBoundaries' || pin.adminLevel !== 'ADM1') throw new TypeError('unsupported fine source pin schema/provider/level');
  const countryCode = text(pin.countryCode, 'countryCode', 2), countryIso3 = text(pin.countryIso3, 'countryIso3', 3);
  if (!ISO2.test(countryCode) || !ISO3.test(countryIso3)) throw new TypeError('fine source country codes must be uppercase ISO codes');
  if (countryCode === 'NG' || countryIso3 === 'NGA') throw new Error('Nigeria/legacy-ng is protected from fine inventory publication');
  const source = object(pin.source, 'fine source');
  exactKeys(source, ['id', 'url', 'release', 'license', 'attribution', 'sha256', 'bytes'], 'fine source');
  text(source.id, 'source.id', 256);
  const url = text(source.url, 'source.url', 2048);
  const release = text(source.release, 'source.release', 40);
  if (!HEX40.test(release)) throw new TypeError('fine source release must be a full 40-hex commit');
  const suffix = `${release}/releaseData/gbOpen/${countryIso3}/ADM1/geoBoundaries-${countryIso3}-ADM1.geojson`;
  if (url !== `${rawPrefix}${suffix}` && url !== `${mediaPrefix}${suffix}`) throw new TypeError('fine source URL must be the exact commit-pinned geoBoundaries raw or media GitHub ADM1 asset');
  text(source.license, 'source.license', 256);
  text(source.attribution, 'source.attribution', 2048);
  if (typeof source.sha256 !== 'string' || !HEX64.test(source.sha256)) throw new TypeError('source SHA-256 pin is invalid');
  if (!Number.isSafeInteger(source.bytes) || (source.bytes as number) < 1 || (source.bytes as number) > FINE_LIMITS.sourceBytes) throw new RangeError('fine source byte pin exceeds the 8 MiB source cap');
  const input = text(pin.input, 'input', 512);
  if (input !== `.cache/world-build/fine-source-cache/${source.sha256}.geojson`) throw new TypeError('fine source input must be its exact content-addressed builder cache path');
  const layerId = text(pin.layerId, 'layerId', 256);
  if (!layerId.startsWith(`${countryIso3}-ADM1-`)) throw new TypeError('fine source layer ID does not match country/admin level');
  const canonicalType = text(pin.canonicalType, 'canonicalType', 128);
  const representedYear = text(pin.representedYear, 'representedYear', 16);
  const buildDate = text(pin.buildDate, 'buildDate', 32);
  if (!/^(?:19|20)\d{2}$/.test(representedYear)) throw new TypeError('fine source representedYear is invalid');
  if (!Number.isSafeInteger(pin.expectedUnits) || (pin.expectedUnits as number) < 1 || (pin.expectedUnits as number) > FINE_LIMITS.units) throw new RangeError('fine source expectedUnits is outside 1..32');
  text(pin.originalLicense, 'originalLicense', 512);
  const licenseEvidence = boundedList(pin.licenseEvidence, 'licenseEvidence', 16);
  if (typeof pin.metadataSha256 !== 'string' || !HEX64.test(pin.metadataSha256)) throw new TypeError('metadata SHA-256 pin is invalid');
  if (!Number.isSafeInteger(pin.metadataBytes) || (pin.metadataBytes as number) < 1 || (pin.metadataBytes as number) > 64 * 1024) throw new RangeError('metadata bytes exceed the 64 KiB cap');
  text(pin.boundaryPolicy, 'boundaryPolicy', 2048);
  return value as FineSourcePin;
}

type ParsedFeature = { key: string; name: string; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }; bounds: Bounds; positions: number };

function parseGeometry(value: unknown): ParsedFeature['geometry'] & { bounds: Bounds; positions: number } {
  const geometry = object(value, 'feature geometry');
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') throw new TypeError('fine source geometry must be Polygon or MultiPolygon');
  if (!Array.isArray(geometry.coordinates)) throw new TypeError('fine polygon coordinates must be an array');
  const polygons: unknown[] = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!polygons.length) throw new TypeError('fine geometry must contain at least one polygon');
  let positions = 0;
  const points: Array<[number, number]> = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length < 1) throw new TypeError('fine polygon must contain an exterior ring');
    for (const rawRing of polygon) {
      if (!Array.isArray(rawRing) || rawRing.length < 4) throw new TypeError('fine polygon rings require at least four positions');
      let first: unknown[] | undefined, last: unknown[] | undefined;
      const distinct = new Set<string>();
      const ringPoints: Array<[number, number]> = [];
      for (const rawPosition of rawRing) {
        if (++positions > FINE_LIMITS.featurePositions) throw new RangeError('fine feature exceeds 40,000 coordinate positions');
        if (!Array.isArray(rawPosition) || rawPosition.length < 2 || rawPosition.length > 4 || rawPosition.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new TypeError('fine WGS84 position must contain 2..4 finite numeric ordinates');
        const lon = rawPosition[0] as number, lat = rawPosition[1] as number;
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new RangeError('fine position lies outside WGS84 longitude/latitude bounds');
        const pos = rawPosition as unknown[];
        first ??= pos;
        last = pos;
        distinct.add(`${lon},${lat}`);
        points.push([lon, lat]);
        ringPoints.push([lon, lat]);
      }
      if (distinct.size < 3) throw new TypeError('fine polygon ring has fewer than three distinct positions');
      if (canonical(first) !== canonical(last)) throw new TypeError('fine polygon ring must be closed');
      let area = 0, priorLongitude = ringPoints[0]![0];
      const unwrapped: Array<[number, number]> = [[priorLongitude, ringPoints[0]![1]]];
      for (let i = 1; i < ringPoints.length; i++) {
        let longitude = ringPoints[i]![0];
        while (longitude - priorLongitude > 180) longitude -= 360;
        while (longitude - priorLongitude < -180) longitude += 360;
        unwrapped.push([longitude, ringPoints[i]![1]]);
        priorLongitude = longitude;
      }
      for (let i = 0; i < unwrapped.length - 1; i++) area += unwrapped[i]![0] * unwrapped[i + 1]![1] - unwrapped[i + 1]![0] * unwrapped[i]![1];
      if (Math.abs(area) < 1e-12) throw new TypeError('fine polygon ring has zero area');
    }
  }
  if (positions > FINE_LIMITS.featurePositions) throw new RangeError('fine feature exceeds 40,000 coordinate positions');
  let south = 90, north = -90;
  for (const [, lat] of points) { south = Math.min(south, lat); north = Math.max(north, lat); }
  let bounds: Bounds;
  if (south <= -89.999999 || north >= 89.999999) bounds = [-180, south, 180, north];
  else {
    const longitudes = [...new Set(points.map(([lon]) => lon))].sort((a, b) => a - b);
    let largestGap = -1, afterGap = 0;
    for (let i = 0; i < longitudes.length; i++) {
      const current = longitudes[i]!, next = i === longitudes.length - 1 ? longitudes[0]! + 360 : longitudes[i + 1]!;
      if (next - current > largestGap) { largestGap = next - current; afterGap = (i + 1) % longitudes.length; }
    }
    bounds = [longitudes[afterGap]!, south, longitudes[(afterGap + longitudes.length - 1) % longitudes.length]!, north];
  }
  return { type: geometry.type, coordinates: geometry.coordinates, bounds, positions };
}

function validatePreviousRegistry(value: unknown, countryId: string): FineIdentityRegistry {
  const registry = object(value, 'previous identity registry');
  if (registry.schemaVersion !== 1 || registry.provider !== 'geoBoundaries' || registry.countryId !== countryId || registry.adminLevel !== 'ADM1' || !Array.isArray(registry.entries) || registry.entries.length > 2048) {
    throw new TypeError('previous fine identity registry does not match this ADM1 country');
  }
  const ids = new Set<string>(), keys = new Set<string>();
  const entries = registry.entries.map((raw, i) => {
    const entry = object(raw, `registry.entries[${i}]`);
    exactKeys(entry, ['id', 'sourceFeatureKeys', 'names', 'status', 'replacedBy'], `registry.entries[${i}]`);
    const id = text(entry.id, 'registry entry id', 128);
    if (!ADMIN_ID.test(id) || ids.has(id)) throw new TypeError('fine identity registry IDs must be unique internal geoBoundaries IDs');
    ids.add(id);
    const sourceFeatureKeys = boundedList(entry.sourceFeatureKeys, 'registry sourceFeatureKeys', 64, 256);
    for (const key of sourceFeatureKeys) {
      if (keys.has(key)) throw new TypeError('fine identity registry source keys must be unique');
      keys.add(key);
    }
    const names = boundedList(entry.names, 'registry names', 256, 256);
    if (entry.status !== 'active' && entry.status !== 'retired') throw new TypeError('fine identity registry status is invalid');
    const replacedBy = entry.replacedBy;
    if (!Array.isArray(replacedBy) || replacedBy.length > FINE_LIMITS.units || replacedBy.some(v => typeof v !== 'string' || !ADMIN_ID.test(v)) || new Set(replacedBy).size !== replacedBy.length) throw new TypeError('fine identity registry replacements are invalid');
    if (entry.status === 'active' && replacedBy.length !== 0) throw new TypeError('active fine identities cannot have replacements');
    if (entry.status === 'retired' && replacedBy.includes(id)) throw new TypeError('retired fine identity cannot replace itself');
    return { id, sourceFeatureKeys, names, status: entry.status, replacedBy: [...replacedBy] } as FineIdentityEntry;
  });
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const entry of entries) {
    for (const replacement of entry.replacedBy) {
      if (!byId.has(replacement)) throw new TypeError(`retired fine identity ${entry.id} references an unknown retained ID: ${replacement}`);
    }
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new TypeError(`fine identity replacement chain contains a cycle at ${id}`);
    visiting.add(id);
    for (const replacement of byId.get(id)!.replacedBy) visit(replacement);
    visiting.delete(id);
    visited.add(id);
  };
  for (const entry of entries) visit(entry.id);
  return { schemaVersion: 1, provider: 'geoBoundaries', countryId, adminLevel: 'ADM1', entries };
}

function validateMigration(value: unknown): FineIdentityMigration {
  const migration = object(value, 'identity migration');
  exactKeys(migration, ['assignments', 'retirements'], 'identity migration');
  const assignments = object(migration.assignments, 'migration assignments');
  if (Object.keys(assignments).length > FINE_LIMITS.units || Object.entries(assignments).some(([key, id]) => !key.trim() || key.length > 256 || typeof id !== 'string' || !ADMIN_ID.test(id))) throw new TypeError('migration assignments must map bounded feature keys to internal IDs');
  if (!Array.isArray(migration.retirements) || migration.retirements.length > 2048) throw new TypeError('migration retirements are invalid');
  const retirements = migration.retirements.map((raw, i) => {
    const retirement = object(raw, `migration.retirements[${i}]`);
    exactKeys(retirement, ['id', 'replacedBy'], `migration.retirements[${i}]`);
    const id = text(retirement.id, 'retirement id', 128);
    if (!ADMIN_ID.test(id) || !Array.isArray(retirement.replacedBy) || retirement.replacedBy.length > FINE_LIMITS.units || retirement.replacedBy.some(v => typeof v !== 'string' || !ADMIN_ID.test(v)) || new Set(retirement.replacedBy).size !== retirement.replacedBy.length) throw new TypeError('migration retirement identity is invalid');
    return { id, replacedBy: [...retirement.replacedBy] as string[] };
  });
  if (new Set(retirements.map(row => row.id)).size !== retirements.length) throw new TypeError('migration retirement IDs must be unique');
  return { assignments: assignments as Record<string, string>, retirements };
}

function generatedId(countryId: string, featureKey: string): string {
  return `admin:geoBoundaries:${sha256(`${countryId}\0ADM1\0geoBoundaries\0${featureKey}`)}`;
}
function registryFor(features: ParsedFeature[], countryId: string, previous?: FineIdentityRegistry, migration?: FineIdentityMigration): { registry: FineIdentityRegistry; ids: Map<string, string>; aliases: Map<string, string[]> } {
  const prior = previous ? validatePreviousRegistry(previous, countryId) : undefined;
  if (migration && !prior) throw new Error('identity migration requires a previous registry');
  const plan = migration ? validateMigration(migration) : undefined;
  const priorById = new Map((prior?.entries ?? []).map(entry => [entry.id, entry]));
  const priorByKey = new Map<string, FineIdentityEntry>();
  for (const entry of prior?.entries ?? []) for (const key of entry.sourceFeatureKeys) priorByKey.set(key, entry);
  const featureKeys = new Set(features.map(feature => feature.key));
  if (priorByKey.size && !plan) {
    const hasNew = features.some(feature => !priorByKey.has(feature.key));
    const hasMissing = (prior?.entries ?? []).some(entry => entry.status === 'active' && !entry.sourceFeatureKeys.some(key => featureKeys.has(key)));
    if (hasNew || hasMissing) throw new Error('fine source identity refresh requires explicit migration assignments and retirements');
  }
  const assignments = plan?.assignments ?? {};
  for (const key of Object.keys(assignments)) if (!featureKeys.has(key) || priorByKey.has(key)) throw new Error(`migration assignment is unused or duplicates a known source key: ${key}`);
  const assignedId = new Map<string, string>();
  const owners = new Map<string, string>();
  const aliases = new Map<string, string[]>();
  const claimedPrior = new Set<string>();
  for (const feature of features) {
    const old = priorByKey.get(feature.key);
    let id: string;
    if (old) {
      if (old.status === 'retired') throw new Error(`retired fine identity cannot be resurrected: ${old.id}`);
      id = old.id;
      claimedPrior.add(id);
    } else if (!prior) {
      id = generatedId(countryId, feature.key);
    } else {
      const target = assignments[feature.key];
      if (!target) throw new Error(`new fine source key requires explicit identity migration: ${feature.key}`);
      const entry = priorById.get(target);
      if (entry?.status === 'retired') throw new Error(`retired fine identity cannot be resurrected: ${target}`);
      if (!entry && target !== generatedId(countryId, feature.key)) throw new Error(`new migration identity must be the deterministic ID for key ${feature.key}`);
      if (entry && entry.sourceFeatureKeys.some(key => featureKeys.has(key))) throw new Error(`migration would map multiple current ADM1 units to identity ${target}`);
      id = target;
      if (entry) claimedPrior.add(id);
    }
    const owner = owners.get(id);
    if (owner) throw new Error(`multiple current ADM1 source keys map to identity ${id}: ${owner} and ${feature.key}`);
    owners.set(id, feature.key);
    assignedId.set(feature.key, id);
    const priorEntry = priorById.get(id);
    aliases.set(feature.key, priorEntry ? priorEntry.names.filter(name => name !== feature.name) : []);
  }
  const unmatched = (prior?.entries ?? []).filter(entry => entry.status === 'active' && !claimedPrior.has(entry.id));
  const retirements = new Map((plan?.retirements ?? []).map(row => [row.id, row]));
  for (const id of retirements.keys()) {
    if (!priorById.has(id) || priorById.get(id)!.status !== 'active') throw new Error(`migration retirement does not name an unmatched active identity: ${id}`);
  }
  if (retirements.size !== unmatched.length || unmatched.some(entry => !retirements.has(entry.id)) || [...retirements.keys()].some(id => !unmatched.some(entry => entry.id === id))) {
    if (unmatched.length || retirements.size) throw new Error('every unmatched active identity requires exactly one explicit retirement');
  }
  const activeIds = new Set(assignedId.values());
  for (const retirement of retirements.values()) {
    if (retirement.replacedBy.some(id => !activeIds.has(id)) || retirement.replacedBy.includes(retirement.id)) throw new Error(`retirement ${retirement.id} must reference current active replacement IDs`);
  }
  const currentById = new Map<string, ParsedFeature>();
  for (const feature of features) currentById.set(assignedId.get(feature.key)!, feature);
  const entries: FineIdentityEntry[] = [];
  const consumed = new Set<string>();
  for (const old of prior?.entries ?? []) {
    if (old.status === 'retired') { entries.push({ ...old, sourceFeatureKeys: [...old.sourceFeatureKeys], names: [...old.names], replacedBy: [...old.replacedBy] }); consumed.add(old.id); continue; }
    const feature = currentById.get(old.id);
    if (feature) {
      entries.push({ ...old, sourceFeatureKeys: [...new Set([...old.sourceFeatureKeys, feature.key])], names: [...new Set([...old.names, feature.name])], status: 'active', replacedBy: [] });
    } else {
      const retirement = retirements.get(old.id)!;
      entries.push({ ...old, status: 'retired', replacedBy: [...retirement.replacedBy] });
    }
    consumed.add(old.id);
  }
  for (const feature of features) {
    const id = assignedId.get(feature.key)!;
    if (consumed.has(id)) continue;
    entries.push({ id, sourceFeatureKeys: [feature.key], names: [feature.name], status: 'active', replacedBy: [] });
    consumed.add(id);
  }
  entries.sort((a, b) => compareText(a.id, b.id));
  return { registry: { schemaVersion: 1, provider: 'geoBoundaries', countryId, adminLevel: 'ADM1', entries }, ids: assignedId, aliases };
}

function validCoarseCountry(value: InventoryNode, pin: FineSourcePin): InventoryNode {
  const country = object(value, 'coarse country');
  if (country.kind !== 'country' || country.provider !== 'world' || country.countryCode !== pin.countryCode || country.id === 'legacy-ng' || country.countryCode === 'NG') {
    throw new Error('fine inventory requires the matching existing world-provider country; legacy-ng/Nigeria is protected');
  }
  text(country.id, 'coarse country id', 256);
  if (!Array.isArray(country.sourceFeatureIds) || country.sourceFeatureIds.length < 1 || country.sourceFeatureIds.length > 512 || country.sourceFeatureIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 512) || new Set(country.sourceFeatureIds).size !== country.sourceFeatureIds.length) {
    throw new TypeError('coarse country source feature IDs must be bounded, non-empty and unique');
  }
  return value;
}

/** Build a separate, deterministic ADM1 directory without changing the coarse inventory. */
export function buildFineInventory(pinValue: FineSourcePin, rawBytes: Uint8Array, coarseCountry: InventoryNode, coarseInventoryHash: string,
  options: { previousRegistry?: FineIdentityRegistry; migration?: FineIdentityMigration } = {}): FineInventory {
  const pin = validateFineSourcePin(pinValue);
  validCoarseCountry(coarseCountry, pin);
  if (typeof coarseInventoryHash !== 'string' || !HEX64.test(coarseInventoryHash)) throw new TypeError('coarse inventory hash must be SHA-256');
  if (!(rawBytes instanceof Uint8Array) || rawBytes.byteLength < 1 || rawBytes.byteLength > FINE_LIMITS.sourceBytes) throw new RangeError('raw fine source must be 1..8 MiB');
  if (rawBytes.byteLength !== pin.source.bytes || sha256(rawBytes) !== pin.source.sha256) throw new Error('fine source bytes do not match pinned length and SHA-256');
  let document: unknown;
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBytes)) as unknown; }
  catch (error) { throw new TypeError(`fine GeoJSON is invalid UTF-8 or JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const collection = object(document, 'fine GeoJSON');
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features) || collection.features.length < 1 || collection.features.length > FINE_LIMITS.units) throw new TypeError('fine GeoJSON must be a bounded non-empty FeatureCollection');
  if (collection.crs !== undefined) {
    const crs = object(collection.crs, 'GeoJSON CRS');
    const properties = object(crs.properties, 'GeoJSON CRS properties');
    exactKeys(crs, ['type', 'properties'], 'GeoJSON CRS');
    exactKeys(properties, ['name'], 'GeoJSON CRS properties');
    if (crs.type !== 'name' || properties.name !== 'urn:ogc:def:crs:OGC:1.3:CRS84') throw new TypeError('fine GeoJSON CRS must use the exact WGS84 longitude/latitude CRS84 identifier');
  }
  if (collection.features.length !== pin.expectedUnits) throw new Error('fine source feature count differs from pinned metadata expectedUnits');
  let totalPositions = 0;
  const features: ParsedFeature[] = [];
  const keys = new Set<string>();
  collection.features.forEach((raw, index) => {
    const feature = object(raw, `fine feature ${index}`);
    if (feature.type !== 'Feature') throw new TypeError(`fine feature ${index} must be a GeoJSON Feature`);
    const properties = object(feature.properties, `fine feature ${index} properties`);
    const key = text(properties.shapeID, `fine feature ${index} shapeID`, 256);
    const name = text(properties.shapeName, `fine feature ${index} shapeName`, 256);
    if (properties.shapeGroup !== pin.countryIso3) throw new Error(`fine feature ${key} shapeGroup does not match pinned ISO3 country`);
    if (properties.shapeType !== pin.adminLevel) throw new Error(`fine feature ${key} shapeType does not match pinned ADM1 level`);
    if (keys.has(key)) throw new Error(`duplicate fine source feature key: ${key}`);
    keys.add(key);
    const geometry = parseGeometry(feature.geometry);
    totalPositions += geometry.positions;
    if (totalPositions > FINE_LIMITS.coordinatePositions) throw new RangeError('fine inventory exceeds 150,000 coordinate positions');
    features.push({ key, name, geometry: { type: geometry.type, coordinates: geometry.coordinates }, bounds: geometry.bounds, positions: geometry.positions });
  });
  features.sort((a, b) => compareText(a.key, b.key));
  const identity = registryFor(features, coarseCountry.id, options.previousRegistry, options.migration);
  const nodes: FineAdminNode[] = features.map<FineAdminNode>(feature => ({
    id: identity.ids.get(feature.key)!, parentId: coarseCountry.id, countryCode: pin.countryCode, name: feature.name,
    kind: 'admin', adminLevel: 'ADM1', adminType: pin.canonicalType, bounds: feature.bounds,
    aliases: identity.aliases.get(feature.key)!,
    sourceRef: { sourceId: pin.source.id, release: pin.source.release, layerId: pin.layerId, featureKey: feature.key },
    coverage: 'geographic-outline', exceptions: [`Boundary depiction follows source policy: ${pin.boundaryPolicy}`],
  })).sort((a, b) => compareText(a.id, b.id));
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const outlines = features.map(feature => ({ nodeId: identity.ids.get(feature.key)!, geometry: feature.geometry })).sort((a, b) => compareText(a.nodeId, b.nodeId));
  if (outlines.length !== nodes.length || new Set(outlines.map(outline => outline.nodeId)).size !== nodes.length || nodes.some(node => !nodeById.has(node.id))) throw new Error('fine source conservation check failed');
  const coverage = { expectedUnits: pin.expectedUnits, sourceUnits: features.length, acceptedUnits: nodes.length,
    rejectedUnits: features.length - nodes.length, coordinatePositions: totalPositions, exceptions: [TOPOLOGY_LIMITATION] };
  if (coverage.acceptedUnits + coverage.rejectedUnits !== coverage.sourceUnits || coverage.rejectedUnits !== 0) throw new Error('fine source count conservation failed');
  return { schemaVersion: 1, coarseInventoryHash, countryId: coarseCountry.id, source: pin, nodes, outlines,
    registry: identity.registry, coverage };
}

function validateFineInventory(value: FineInventory): FineInventory {
  if (!value || value.schemaVersion !== 1 || !HEX64.test(value.coarseInventoryHash) || !Array.isArray(value.nodes) || !Array.isArray(value.outlines) || value.nodes.length < 1 || value.nodes.length > FINE_LIMITS.units) throw new TypeError('fine inventory schema is invalid');
  const pin = validateFineSourcePin(value.source);
  if (value.countryId === 'legacy-ng' || value.countryId !== value.nodes[0]?.parentId) throw new Error('fine inventory country parent is invalid');
  const seen = new Set<string>(), outlineIds = new Set<string>(), currentFeatureKeys = new Set<string>();
  for (const node of value.nodes) {
    if (!ADMIN_ID.test(node.id) || seen.has(node.id) || node.parentId !== value.countryId || node.kind !== 'admin' || node.adminLevel !== 'ADM1' || node.countryCode !== pin.countryCode || node.adminType !== pin.canonicalType || node.coverage !== 'geographic-outline') throw new TypeError('fine inventory node is invalid');
    seen.add(node.id);
    text(node.name, 'fine node name', 256);
    if (!Array.isArray(node.aliases) || node.aliases.length > 256 || node.aliases.some(alias => typeof alias !== 'string' || !alias.trim() || alias.length > 256 || /[\u0000-\u001f\u007f]/.test(alias)) || new Set(node.aliases).size !== node.aliases.length) throw new TypeError('fine node aliases are invalid');
    if (!Array.isArray(node.exceptions) || node.exceptions.length > 32 || node.exceptions.some(exception => typeof exception !== 'string' || exception.length > 2048 || !exception.trim() || /[\u0000-\u001f\u007f]/.test(exception)) || new Set(node.exceptions).size !== node.exceptions.length) throw new TypeError('fine node exceptions are invalid');
    const ref = object(node.sourceRef, 'fine node source reference');
    if (ref.sourceId !== pin.source.id || ref.release !== pin.source.release || ref.layerId !== pin.layerId || typeof ref.featureKey !== 'string' || !ref.featureKey.trim() || ref.featureKey.length > 256 || /[\u0000-\u001f\u007f]/.test(ref.featureKey) || currentFeatureKeys.has(ref.featureKey)) throw new Error('fine node source reference does not match pin or source feature keys are duplicated');
    currentFeatureKeys.add(ref.featureKey);
  }
  let totalPositions = 0;
  const boundsByNode = new Map<string, Bounds>();
  for (const outline of value.outlines) {
    if (!outline || !seen.has(outline.nodeId) || outlineIds.has(outline.nodeId)) throw new Error('fine outline is orphaned or duplicated');
    const parsed = parseGeometry(outline.geometry);
    outlineIds.add(outline.nodeId);
    boundsByNode.set(outline.nodeId, parsed.bounds);
    if (parsed.positions > FINE_LIMITS.featurePositions) throw new RangeError('fine outline feature limit exceeded');
    totalPositions += parsed.positions;
    if (totalPositions > FINE_LIMITS.coordinatePositions) throw new RangeError('fine inventory coordinate limit exceeded');
  }
  if (outlineIds.size !== seen.size) throw new Error('fine outline conservation failed');
  if (totalPositions !== value.coverage?.coordinatePositions) throw new Error('fine coverage coordinate count differs from published outlines');
  for (const node of value.nodes) if (canonical(node.bounds) !== canonical(boundsByNode.get(node.id))) throw new Error(`fine node bounds do not match outline geometry: ${node.id}`);
  const registry = validatePreviousRegistry(value.registry, value.countryId);
  const activeIds = new Set(registry.entries.filter(entry => entry.status === 'active').map(entry => entry.id));
  if (activeIds.size !== value.nodes.length || value.nodes.some(node => !activeIds.has(node.id))) throw new Error('fine identity registry does not cover active nodes exactly');
  for (const entry of registry.entries.filter(candidate => candidate.status === 'active')) {
    const currentKeys = entry.sourceFeatureKeys.filter(key => currentFeatureKeys.has(key));
    if (currentKeys.length !== 1) throw new Error(`fine active identity must bind exactly one current source key: ${entry.id}`);
  }
  for (const node of value.nodes) {
    const entry = registry.entries.find(candidate => candidate.id === node.id)!;
    if (!entry.sourceFeatureKeys.includes(node.sourceRef.featureKey) || !entry.names.includes(node.name)) throw new Error('fine identity registry does not bind current feature key/name');
  }
  const coverage = value.coverage;
  if (!coverage || coverage.expectedUnits !== pin.expectedUnits || coverage.sourceUnits !== value.nodes.length || coverage.acceptedUnits !== value.nodes.length || coverage.rejectedUnits !== 0 || !Number.isSafeInteger(coverage.coordinatePositions) || coverage.coordinatePositions < 1 || coverage.coordinatePositions > FINE_LIMITS.coordinatePositions || !Array.isArray(coverage.exceptions) || !coverage.exceptions.includes(TOPOLOGY_LIMITATION) || coverage.exceptions.some(exception => typeof exception !== 'string' || exception.length > 2048 || !exception.trim() || /[\u0000-\u001f\u007f]/.test(exception))) throw new Error('fine coverage conservation is invalid');
  return value;
}

async function requireExistingNoSymlinkPath(target: string): Promise<void> {
  if (!path.isAbsolute(target)) throw new TypeError('allowedRoot must be absolute');
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error(`allowedRoot ancestor contains a symlink: ${cursor}`);
    if (!info.isDirectory()) throw new Error(`allowedRoot ancestor is not a directory: ${cursor}`);
  }
}

/** Publish all hash-addressed fine assets, with the success manifest written last. */
export async function publishFineInventory(value: FineInventory, outputRoot: string, allowedRoot: string): Promise<{ manifestHash: string; manifestPath: string; bytes: number; units: number }> {
  const inventory = validateFineInventory(value);
  const allowed = path.resolve(allowedRoot), output = path.resolve(outputRoot);
  const rel = path.relative(allowed, output);
  if (!path.isAbsolute(allowedRoot) || !path.isAbsolute(outputRoot) || !rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('fine inventory output must be a dedicated child of allowedRoot');
  const assets: Array<{ relative: string; bytes: Buffer }> = [];
  const add = (directory: string, value: unknown): string => {
    const bytes = Buffer.from(canonical(value));
    const hash = sha256(bytes);
    assets.push({ relative: `${directory}/${hash}.json`, bytes });
    return assets.at(-1)!.relative;
  };
  const outlineRefs = new Map<string, string>();
  for (const outline of inventory.outlines) {
    const body = Buffer.from(canonical(outline.geometry));
    if (body.length > 2 * 1024 * 1024) throw new RangeError('fine outline exceeds 2 MiB per-file cap');
    const hash = sha256(body), relative = `outlines/${hash}.json`;
    assets.push({ relative, bytes: body });
    outlineRefs.set(outline.nodeId, relative);
  }
  const nodeIndexPath = add('node-index', { schemaVersion: 1, countryId: inventory.countryId,
    nodes: inventory.nodes.map(node => ({ node, outlinePath: outlineRefs.get(node.id)! })) });
  if (assets.at(-1)!.bytes.length > 128 * 1024) throw new RangeError('fine node index exceeds 128 KiB cap');
  const registryPath = add('registries', inventory.registry);
  if (assets.at(-1)!.bytes.length > 128 * 1024) throw new RangeError('fine identity registry exceeds 128 KiB cap');
  const coveragePath = add('coverage', inventory.coverage);
  if (assets.at(-1)!.bytes.length > 128 * 1024) throw new RangeError('fine coverage report exceeds 128 KiB cap');
  const manifest = { schemaVersion: inventory.schemaVersion, coarseInventoryHash: inventory.coarseInventoryHash,
    countryId: inventory.countryId, source: inventory.source, sourceUnitCount: inventory.coverage.sourceUnits,
    nodeIndexPath, registryPath, coveragePath, exceptions: inventory.coverage.exceptions };
  const manifestBytes = Buffer.from(canonical(manifest));
  if (manifestBytes.length > 128 * 1024) throw new RangeError('fine manifest exceeds 128 KiB cap');
  const manifestHash = sha256(manifestBytes), manifestPath = `manifests/${manifestHash}.json`;
  const total = assets.reduce((sum, asset) => sum + asset.bytes.length, manifestBytes.length);
  if (total > FINE_LIMITS.publishedBytes) throw new RangeError('fine inventory publication exceeds 16 MiB cap');
  assets.push({ relative: manifestPath, bytes: manifestBytes });
  await requireExistingNoSymlinkPath(allowedRoot);
  const store = await createOutputStore(outputRoot, allowedRoot);
  let bytes = 0;
  for (const asset of assets.slice(0, -1)) { await store.writeImmutable(asset.relative, asset.bytes); bytes += asset.bytes.length; }
  const manifestFile = await store.writeImmutable(manifestPath, manifestBytes);
  bytes += manifestBytes.length;
  return { manifestHash, manifestPath: manifestFile, bytes, units: inventory.nodes.length };
}
