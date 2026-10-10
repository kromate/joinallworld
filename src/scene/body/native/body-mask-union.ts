import * as THREE from 'three';

export interface BodyTriangleHideSet {
  readonly asset: string;
  readonly bodySourceTriangleCount: number;
  readonly triangleIds: readonly number[];
}

export interface BodyMaskUnionOptions {
  /** SHA-256 of the exact indexed Body geometry supplied by the caller's pinned GLB. */
  readonly expectedSourceIndexSha256: string;
  readonly expectedSourceTriangleCount: number;
  readonly hideSets: readonly BodyTriangleHideSet[];
}

export interface BodyMaskUnionMetrics {
  readonly sourceIndexSha256: string;
  readonly sourceTriangles: number;
  readonly hiddenTriangles: number;
  readonly visibleTriangles: number;
  readonly maskIndexBytes: number;
  readonly assets: readonly string[];
}

export interface BodyMaskLease {
  readonly geometry: THREE.BufferGeometry;
  readonly metrics: BodyMaskUnionMetrics;
  dispose(): void;
}

interface MaskEntry {
  readonly geometry: THREE.BufferGeometry;
  readonly source: THREE.BufferGeometry;
  references: number;
  disposed: boolean;
}

const masksBySource = new WeakMap<THREE.BufferGeometry, Map<string, MaskEntry>>();
const activeBodies = new WeakSet<THREE.SkinnedMesh>();
const sourceDisposeHooks = new WeakSet<THREE.BufferGeometry>();

function fail(message: string): never {
  throw new Error(`Authored Body mask union: ${message}`);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

async function hashIndex(index: THREE.BufferAttribute): Promise<string> {
  const view = new Uint8Array(index.array.buffer, index.array.byteOffset, index.array.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function validateHideSets(hideSets: readonly BodyTriangleHideSet[], triangleCount: number): number[] {
  check(hideSets.length > 0, 'at least one hide set is required');
  const assets = new Set<string>();
  const hidden = new Set<number>();
  for (const set of hideSets) {
    check(typeof set.asset === 'string' && set.asset.length > 0, 'hide set asset name is missing');
    check(!assets.has(set.asset), `duplicate hide-set ownership for ${set.asset}`);
    assets.add(set.asset);
    check(set.bodySourceTriangleCount === triangleCount, `${set.asset} body triangle count does not match source`);
    check(Array.isArray(set.triangleIds), `${set.asset} triangle IDs are missing`);
    const local = new Set<number>();
    for (const triangle of set.triangleIds) {
      check(Number.isInteger(triangle) && triangle >= 0 && triangle < triangleCount,
        `${set.asset} has invalid source triangle ${triangle}`);
      check(!local.has(triangle), `${set.asset} has duplicate source triangle ${triangle}`);
      local.add(triangle);
      hidden.add(triangle); // Overlap between distinct garments is a valid union.
    }
  }
  return [...hidden].sort((a, b) => a - b);
}

function maskKey(sourceHash: string, triangleCount: number, hidden: readonly number[]): string {
  return `${sourceHash}:${triangleCount}:${hidden.join(',')}`;
}

function createMaskGeometry(source: THREE.BufferGeometry, hidden: ReadonlySet<number>, key: string): THREE.BufferGeometry {
  const index = source.getIndex()!;
  const retained: number[] = [];
  for (let triangle = 0; triangle < index.count / 3; triangle++) {
    if (hidden.has(triangle)) continue;
    const offset = triangle * 3;
    retained.push(index.getX(offset), index.getX(offset + 1), index.getX(offset + 2));
  }
  const values = index.array instanceof Uint32Array ? new Uint32Array(retained) : new Uint16Array(retained);
  const geometry = new THREE.BufferGeometry();
  geometry.name = `authored-body-hide-union-${key.slice(0, 12)}`;
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.morphAttributes = { ...source.morphAttributes };
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.setIndex(new THREE.BufferAttribute(values, 1));
  geometry.setDrawRange(0, values.length);
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  return geometry;
}

/**
 * Install one exact union of garment body-triangle hides on a private actor Body mesh.
 * Original attributes/morph data remain shared and immutable; only a private index wrapper is made.
 * A Body can have only one active lease so callers cannot silently stack/re-own masks.
 */
export async function applyBodyMaskUnion(
  body: THREE.SkinnedMesh,
  options: BodyMaskUnionOptions,
): Promise<BodyMaskLease> {
  check(body?.isSkinnedMesh, 'target must be a SkinnedMesh');
  check(!activeBodies.has(body), 'Body already has an active mask owner');
  const source = body.geometry;
  const index = source.getIndex();
  check(index, 'source Body has no index');
  check(source.groups.length === 0, 'grouped source geometry is unsupported');
  check(Number.isInteger(options.expectedSourceTriangleCount) && options.expectedSourceTriangleCount > 0,
    'expected source triangle count is invalid');
  check(index.count % 3 === 0 && index.count / 3 === options.expectedSourceTriangleCount,
    'source index length does not match the pinned triangle count');
  check(options.expectedSourceIndexSha256.length === 64 && /^[0-9a-f]{64}$/.test(options.expectedSourceIndexSha256),
    'expected source index SHA-256 is invalid');
  const hiddenIds = validateHideSets(options.hideSets, options.expectedSourceTriangleCount);
  check(hiddenIds.length < options.expectedSourceTriangleCount, 'hide union removes every source triangle');

  activeBodies.add(body);
  let entry: MaskEntry | undefined;
  try {
    const sourceHash = await hashIndex(index);
    check(sourceHash === options.expectedSourceIndexSha256, `source index SHA-256 mismatch (${sourceHash})`);
    check(body.geometry === source, 'Body geometry changed while source index was being verified');

    const key = maskKey(sourceHash, options.expectedSourceTriangleCount, hiddenIds);
    let entries = masksBySource.get(source);
    if (!entries) { entries = new Map(); masksBySource.set(source, entries); }
    entry = entries.get(key);
    if (!entry || entry.disposed) {
      const hidden = new Set(hiddenIds);
      const geometry = createMaskGeometry(source, hidden, key);
      entry = { geometry, source, references: 0, disposed: false };
      entries.set(key, entry);
      if (!sourceDisposeHooks.has(source)) {
        sourceDisposeHooks.add(source);
        source.addEventListener('dispose', () => {
          const current = masksBySource.get(source);
          if (!current) return;
          for (const cached of current.values()) {
            if (!cached.disposed) { cached.disposed = true; cached.geometry.dispose(); }
          }
          current.clear();
        });
      }
    }
    entry.references++;
    body.geometry = entry.geometry;
    let disposed = false;
    return {
      geometry: entry.geometry,
      metrics: {
        sourceIndexSha256: sourceHash,
        sourceTriangles: options.expectedSourceTriangleCount,
        hiddenTriangles: hiddenIds.length,
        visibleTriangles: options.expectedSourceTriangleCount - hiddenIds.length,
        maskIndexBytes: entry.geometry.getIndex()!.array.byteLength,
        assets: options.hideSets.map((set) => set.asset),
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        activeBodies.delete(body);
        if (body.geometry === entry!.geometry) body.geometry = source;
        entry!.references = Math.max(0, entry!.references - 1);
        if (entry!.references === 0 && !entry!.disposed) {
          entry!.disposed = true;
          entry!.geometry.dispose();
          const current = masksBySource.get(source);
          if (current && current.get(key) === entry) current.delete(key);
        }
      },
    };
  } catch (error) {
    activeBodies.delete(body);
    throw error;
  }
}
