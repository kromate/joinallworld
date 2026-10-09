import * as THREE from 'three';
import packet from './clothing-fix-packets-v1.json';

type OutfitKey = 'male-casual' | 'female-casual' | 'male-office' | 'female-office';
type BodyHideSet = Readonly<{ asset: string; bodySourceTriangleCount: number; triangleIds: readonly number[] }>;

type PacketOutfit = Readonly<{
  status: 'trimmed' | 'skipped-skirt';
  shoeSourceTriangles: number;
  removedTriangleIds: readonly number[];
  removedIdsSha256: string;
  protectedSoleTriangleIds: readonly number[];
  protectedSoleIdsSha256: string;
}>;
type BodyCoveragePacket = Readonly<{
  status: string;
  sourceIndexSha256: string;
  sourceTriangles: number;
  coveredTriangleCount: number;
  triangleIds?: readonly number[];
  triangleIdsSha256?: string;
  allowedBodyPreset?: Readonly<{ body: string; outfit: string; fabric: string; appearance: Readonly<{ height: string; build: string; ageAppearance: string }> }>;
}>;

export interface AuthoredClothingPacketLease {
  readonly sourceGeometry: THREE.BufferGeometry;
  readonly geometry: THREE.BufferGeometry;
  readonly removedTriangles: number;
  dispose(): void;
}

function fail(message: string): never { throw new Error(`Authored clothing packet: ${message}`); }
function check(value: unknown, message: string): asserts value { if (!value) fail(message); }

function entry(key: OutfitKey): PacketOutfit {
  const value = (packet.outfits as Record<string, PacketOutfit>)[key];
  check(value, `missing pinned outfit packet ${key}`);
  return value;
}

function assertBodyPreset(key: OutfitKey, input: unknown): void {
  check(input !== null && typeof input === 'object' && !Array.isArray(input), `${key} requires the saved look to validate the packet preset`);
  const look = input as Record<string, unknown>;
  const body = key.startsWith('female-') ? 'woman' : 'man';
  const outfit = key.endsWith('-office') ? 'office' : 'casual';
  check(look.body === body && look.outfit === outfit && look.fabric === 'plain', `${key} does not match packet family/outfit/fabric`);
  const appearance = look.appearance;
  check(appearance !== null && typeof appearance === 'object' && !Array.isArray(appearance), `${key} requires appearance preset metadata`);
  const shape = appearance as Record<string, unknown>;
  check(shape.height === 'average' && shape.build === 'average' && shape.ageAppearance === 'adult',
    `${key} packet was measured for average adult height/build only`);
  if (look.accessories !== undefined) check(Array.isArray(look.accessories) && look.accessories.length === 0, `${key} packet does not cover added accessories`);
  if (look.wearables !== undefined) check(Array.isArray(look.wearables) && look.wearables.length === 0, `${key} packet does not cover added wearables`);
}

async function sha256Index(index: THREE.BufferAttribute): Promise<string> {
  const view = new Uint8Array(index.array.buffer, index.array.byteOffset, index.array.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateTriangleIds(ids: readonly number[], count: number, label: string): Set<number> {
  const result = new Set<number>();
  for (const id of ids) {
    check(Number.isInteger(id) && id >= 0 && id < count, `${label} triangle ${id} is outside source topology`);
    check(!result.has(id), `${label} repeats source triangle ${id}`);
    result.add(id);
  }
  return result;
}

/**
 * Returns the fixed source-triangle hide set for presentation's ONE body-mask
 * owner. Pass this in `applyAuthoredPresentation(..., {additionalBodyHideSets})`;
 * do not acquire a second Body mask lease afterward.
 */
export function authoredBodyCoverageHideSet(key: OutfitKey, look: unknown): BodyHideSet | undefined {
  const data = packet.bodyCoverage as BodyCoveragePacket;
  if (key !== 'female-office') return undefined;
  assertBodyPreset(key, look);
  check(data.status === 'ready' && Array.isArray(data.triangleIds) && data.triangleIds.length === data.coveredTriangleCount,
    'female office coverage packet is not sealed with exact V7 source triangle IDs');
  check(data.sourceIndexSha256 === packet.sourceAssets.bodyIndexSha256 && data.sourceTriangles === packet.sourceAssets.bodySourceTriangles,
    'female office coverage packet source signature disagrees with baked asset metadata');
  check(data.triangleIdsSha256 === '3c31d783399e4a108b4b07a23403b709ff1bd28feda3a1858479b2dd6625aa4b',
    'female office Body ID set does not match reviewed V7 packet');
  return Object.freeze({
    asset: 'female-office-v7-pixel-attributed-blouse-coverage',
    bodySourceTriangleCount: data.sourceTriangles,
    triangleIds: Object.freeze([...data.triangleIds]),
  });
}

/**
 * Install a source-index packet on a private footwear instance. This copies
 * only the index; source attributes, morphs, material groups, and skeleton
 * remain shared and immutable. The hash is checked before any mutation.
 */
export async function applyAuthoredClothingPacket(
  shoes: THREE.SkinnedMesh,
  key: OutfitKey,
  look: unknown,
): Promise<AuthoredClothingPacketLease> {
  check(shoes?.isSkinnedMesh, 'footwear target must be a SkinnedMesh');
  assertBodyPreset(key, look);
  const chosen = entry(key);
  const source = shoes.geometry;
  const sourceIndex = source.getIndex();
  check(sourceIndex && sourceIndex.count % 3 === 0, 'footwear geometry must have a triangle index');
  const actualTriangles = sourceIndex.count / 3;
  check(actualTriangles === packet.sourceAssets.shoeSourceTriangles && actualTriangles === chosen.shoeSourceTriangles,
    `footwear triangle count mismatch (${actualTriangles})`);
  const actualHash = await sha256Index(sourceIndex);
  check(shoes.geometry === source, 'footwear geometry changed during source-index validation');
  check(actualHash === packet.sourceAssets.shoeIndexSha256, `footwear source index hash mismatch (${actualHash})`);

  const removed = validateTriangleIds(chosen.removedTriangleIds, actualTriangles, `${key} removed`);
  const protectedSoles = validateTriangleIds(chosen.protectedSoleTriangleIds, actualTriangles, `${key} sole`);
  const idsDigest = async (ids: readonly number[]) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(ids)));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  };
  check(await idsDigest(chosen.removedTriangleIds) === chosen.removedIdsSha256, `${key} removed-ID packet hash mismatch`);
  check(await idsDigest(chosen.protectedSoleTriangleIds) === chosen.protectedSoleIdsSha256, `${key} protected-sole packet hash mismatch`);
  for (const id of removed) check(!protectedSoles.has(id), `packet removes protected sole triangle ${id}`);
  check(chosen.status === 'trimmed' ? removed.size > 0 : removed.size === 0,
    `${key} status disagrees with its removed-triangle set`);
  if (chosen.status === 'skipped-skirt') {
    return { sourceGeometry: source, geometry: source, removedTriangles: 0, dispose() {} };
  }

  const retained: number[] = [];
  for (let triangle = 0; triangle < actualTriangles; triangle++) {
    if (removed.has(triangle)) continue;
    const base = triangle * 3;
    retained.push(sourceIndex.getX(base), sourceIndex.getX(base + 1), sourceIndex.getX(base + 2));
  }
  check(retained.length > 0 && retained.length % 3 === 0, 'packet produced an invalid retained index');
  const indexArray = sourceIndex.array instanceof Uint32Array ? new Uint32Array(retained) : new Uint16Array(retained);
  const geometry = new THREE.BufferGeometry();
  geometry.name = `${source.name} (V6 pinned clothing index ${key})`;
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.morphAttributes = Object.fromEntries(Object.entries(source.morphAttributes).map(([name, attributes]) => [name, [...attributes]]));
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setDrawRange(source.drawRange.start, Math.min(source.drawRange.count, indexArray.length));
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.userData = { ...source.userData };
  shoes.geometry = geometry;
  let disposed = false;
  return {
    sourceGeometry: source,
    geometry,
    removedTriangles: removed.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (shoes.geometry === geometry) shoes.geometry = source;
      geometry.dispose();
    },
  };
}
