import { geographicGridOwner } from './country-grid.ts';
import { canonicalJson, sha256 } from './pack.ts';
import type { Position } from './types.ts';

/** Source accounting only: these are not persistent game entity IDs. */
export const FEATURE_IDENTITY_VERSION = 'overture-complete-feature-owner-v1';
export const FEATURE_IDENTITY_LIMITS = Object.freeze({
  idCharacters: 256, depth: 32, nodes: 500_000, positions: 200_000, bodyBytes: 20_000_000,
});
export type FeatureSourceLayer = 'buildings' | 'transportation';
export interface FeatureIdentityBinding {
  provider: 'overture';
  release: string;
  /** Receipt source layers; transportation features bind the roads receipt. */
  layers: readonly ('buildings' | 'roads')[];
}
export interface SourceFeatureTuple {
  provider: 'overture'; release: string; sourceLayer: FeatureSourceLayer; sourceFeatureId: string;
}
export type FeatureIdentityExceptionCode =
  | 'unsupported-id-representation' | 'invalid-source-id' | 'unsupported-source-layer'
  | 'unsupported-json-tree' | 'feature-resource-limit' | 'invalid-source-feature'
  | 'unsupported-geometry' | 'invalid-geometry';
export type FeatureIdentityResult = {
  status: 'admitted'; identityVersion: typeof FEATURE_IDENTITY_VERSION;
  tuple: SourceFeatureTuple; featureKeyHash: string; bodyHash: string; bodyBytes: number;
  ownerAnchor: Position; ownerCellId: string; positions: number;
} | { status: 'exception'; code: FeatureIdentityExceptionCode; message: string };

class SourceException extends Error {
  readonly code: FeatureIdentityExceptionCode;
  constructor(code: FeatureIdentityExceptionCode, message: string) { super(message); this.code = code; }
}
function reject(code: FeatureIdentityExceptionCode, message: string): never { throw new SourceException(code, message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('invalid-source-feature', 'Feature and properties must be JSON objects.');
  return value as Record<string, unknown>;
}
function checkBinding(binding: FeatureIdentityBinding): void {
  if (!binding || binding.provider !== 'overture' || typeof binding.release !== 'string'
    || !/^\d{4}-\d{2}-\d{2}\.\d{1,3}$/.test(binding.release)
    || !Array.isArray(binding.layers) || !binding.layers.length || binding.layers.length > 2
    || binding.layers.some(layer => layer !== 'buildings' && layer !== 'roads')
    || new Set(binding.layers).size !== binding.layers.length) {
    throw new TypeError('Identity binding must carry an explicit Overture release and unique receipt layers.');
  }
}

/** Check before pack canonicalization: never hash a tree with silently lost fields. */
function checkJsonTree(root: unknown): number {
  let nodes = 0, encodedBytes = 0;
  const ancestors = new Set<object>();
  function charge(bytes: number): void {
    encodedBytes += bytes;
    if (encodedBytes > FEATURE_IDENTITY_LIMITS.bodyBytes) reject('feature-resource-limit', 'Canonical complete feature exceeds the byte limit.');
  }
  function string(value: string): void {
    charge(2); // Quotes; count escapes without allocating JSON.stringify(value).
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) charge(2);
      else if (code < 32) charge(6);
      else if (code < 128) charge(1);
      else if (code < 2048) charge(2);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { charge(4); i++; }
        else charge(6); // Well-formed JSON escapes lone UTF16 surrogates.
      } else if (code >= 0xdc00 && code <= 0xdfff) charge(6);
      else charge(3);
    }
  }
  function visit(value: unknown, depth: number): void {
    if (++nodes > FEATURE_IDENTITY_LIMITS.nodes || depth > FEATURE_IDENTITY_LIMITS.depth) {
      reject('feature-resource-limit', 'Feature JSON exceeds node or depth limits.');
    }
    if (typeof value === 'string') {
      string(value); return;
    }
    if (value === null) { charge(4); return; }
    if (typeof value === 'boolean') { charge(value ? 4 : 5); return; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) reject('unsupported-json-tree', 'Feature JSON contains a nonfinite number.');
      charge(JSON.stringify(value).length); return;
    }
    if (typeof value !== 'object') reject('unsupported-json-tree', 'Feature contains a non-JSON value.');
    if (ancestors.has(value)) reject('unsupported-json-tree', 'Feature JSON contains a cycle.');
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      reject('unsupported-json-tree', 'Feature must contain plain JSON objects and arrays.');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) reject('unsupported-json-tree', 'Feature contains symbol properties.');
    if (array && value.length > FEATURE_IDENTITY_LIMITS.nodes) reject('feature-resource-limit', 'Feature array exceeds the node limit.');
    if (array && keys.length !== value.length + 1) {
      reject('unsupported-json-tree', 'Feature JSON arrays must be dense and have no extra properties.');
    }
    const count = array ? value.length : keys.length;
    charge(2 + Math.max(0, count - 1)); // Brackets/braces and commas.
    ancestors.add(value);
    for (const key of keys as string[]) {
      if (array && key === 'length') continue;
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) {
        reject('unsupported-json-tree', 'Feature JSON arrays cannot have extra properties.');
      }
      if (key === '__proto__') reject('unsupported-json-tree', 'Feature contains a key unsafe for the existing canonicalizer.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) reject('unsupported-json-tree', 'Feature contains hidden or accessor properties.');
      if (!array) { string(key); charge(1); } // Key quotes/escapes and colon.
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  }
  visit(root, 0);
  return encodedBytes;
}

function ownerOf(geometryValue: unknown, layer: FeatureSourceLayer): { anchor: Position; cellId: string; positions: number } {
  const geometry = object(geometryValue);
  const type = geometry.type;
  if (layer === 'buildings' ? type !== 'Polygon' && type !== 'MultiPolygon' : type !== 'LineString' && type !== 'MultiLineString') {
    reject('unsupported-geometry', 'Geometry is outside the admitted source layer projection.');
  }
  let anchor: Position | undefined, positions = 0;
  function vertex(raw: unknown): Position {
    if (!Array.isArray(raw) || raw.length < 2 || raw.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
      reject('invalid-geometry', 'Positions need at least two finite coordinate components.');
    }
    const lon = raw[0] as number, lat = raw[1] as number;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) reject('invalid-geometry', 'Position is outside WGS84.');
    if (++positions > FEATURE_IDENTITY_LIMITS.positions) reject('feature-resource-limit', 'Feature exceeds the position limit.');
    // Normalize only this derived candidate; full-body hashing preserves source coordinates.
    const candidate: Position = [lon === 180 || Math.abs(lat) === 90 ? -180 : lon, lat];
    if (!anchor || candidate[0] < anchor[0] || candidate[0] === anchor[0] && candidate[1] < anchor[1]) anchor = candidate;
    return [lon, lat];
  }
  function sequence(raw: unknown, ring: boolean): void {
    if (!Array.isArray(raw) || raw.length < (ring ? 4 : 2)) reject('invalid-geometry', 'Coordinate sequence is too short.');
    const distinct = new Set<string>();
    let first: Position | undefined, last: Position | undefined;
    for (const item of raw) { const point = vertex(item); first ??= point; last = point; distinct.add(`${point[0]},${point[1]}`); }
    if (distinct.size < (ring ? 3 : 2)) reject('invalid-geometry', 'Coordinate sequence lacks distinct source vertices.');
    if (ring && (first![0] !== last![0] || first![1] !== last![1])) reject('invalid-geometry', 'Source ring is not closed.');
    if (ring) {
      const start = raw[0] as number[], end = raw[raw.length - 1] as number[];
      if (start.length !== end.length || start.some((component, index) => component !== end[index])) {
        reject('invalid-geometry', 'Source ring endpoint components are not identical.');
      }
    }
  }
  function members(raw: unknown, visit: (item: unknown) => void): void {
    if (!Array.isArray(raw) || !raw.length) reject('invalid-geometry', 'Geometry requires nonempty members.');
    raw.forEach(visit);
  }
  function polygon(raw: unknown): void { members(raw, ring => sequence(ring, true)); }
  if (type === 'Polygon') polygon(geometry.coordinates);
  else if (type === 'MultiPolygon') members(geometry.coordinates, polygon);
  else if (type === 'LineString') sequence(geometry.coordinates, false);
  else members(geometry.coordinates, line => sequence(line, false));
  if (!anchor) reject('invalid-geometry', 'Geometry has no source vertices.');
  return { anchor, cellId: geographicGridOwner(anchor, 1).id, positions };
}

/** Caller must separately verify pinned request/receipt/extract bytes before using this pure result. */
export function identifySourceFeature(featureValue: unknown, binding: FeatureIdentityBinding): FeatureIdentityResult {
  checkBinding(binding);
  try {
    const expectedBodyBytes = checkJsonTree(featureValue);
    const feature = object(featureValue);
    if (feature.type !== 'Feature') reject('invalid-source-feature', 'Expected a complete GeoJSON Feature.');
    if (typeof feature.id !== 'string') reject('unsupported-id-representation', 'Source ID must be a string; numeric IDs are not coerced.');
    if (!feature.id.length || feature.id.length > FEATURE_IDENTITY_LIMITS.idCharacters || /[\s\p{White_Space}\u0000-\u001f\u007f]/u.test(feature.id)) {
      reject('invalid-source-id', 'Source ID must be nonempty, bounded and whitespace-free.');
    }
    const properties = object(feature.properties), layer = properties.sourceLayer;
    if (layer !== 'buildings' && layer !== 'transportation') reject('unsupported-source-layer', 'Feature has no supported literal source layer.');
    const receiptLayer = layer === 'transportation' ? 'roads' : 'buildings';
    if (!binding.layers.includes(receiptLayer)) throw new TypeError('Feature source layer is absent from the verified receipt binding.');
    if (layer === 'buildings' ? properties.building !== true : typeof properties.highway !== 'string' || !properties.highway) {
      reject('invalid-source-feature', 'Feature tags disagree with its source layer.');
    }
    const owner = ownerOf(feature.geometry, layer);
    const body = canonicalJson(feature), bodyBytes = Buffer.byteLength(body);
    if (bodyBytes !== expectedBodyBytes) throw new Error('Complete feature canonical byte accounting disagrees with the encoder.');
    if (bodyBytes > FEATURE_IDENTITY_LIMITS.bodyBytes) reject('feature-resource-limit', 'Canonical complete feature exceeds the byte limit.');
    const tuple: SourceFeatureTuple = { provider: 'overture', release: binding.release, sourceLayer: layer, sourceFeatureId: feature.id };
    return {
      status: 'admitted', identityVersion: FEATURE_IDENTITY_VERSION, tuple,
      featureKeyHash: sha256(canonicalJson(tuple)), bodyHash: sha256(body), bodyBytes,
      ownerAnchor: owner.anchor, ownerCellId: owner.cellId, positions: owner.positions,
    };
  } catch (error) {
    if (!(error instanceof SourceException)) throw error;
    return { status: 'exception', code: error.code, message: error.message };
  }
}
