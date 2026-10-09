import * as THREE from 'three';
import type { SkinnedBody } from '/src/scene/body/skinned.ts';
import { captureWardrobeRestFrame } from '/src/scene/wardrobe/geometry.ts';
import { buildExpandedOfficeShell } from '../../office-source-shell-v2/office-expanded-shell.ts';
import { buildOfficeSourceCornerChart } from '../source-corner-chart.ts';
import { sourceCornerSkinningHook, SOURCE_CORNER_SKINNING_CACHE_KEY } from '../source-corner-skinning-adapter.ts';

type ShellRecord = { mesh: THREE.SkinnedMesh; kind: 'source' | 'chart'; geometry: THREE.BufferGeometry; material: THREE.Material };
export type FixtureAugmentation = Readonly<{
  shellTriangles: number;
  shellVertices: number;
  shellBytes: number;
  shellAttributeCount: number;
  retainedWardrobeTriangles: number;
  removedSyntheticTopTriangles: number;
  drawCallsForWardrobe: number;
  shellSourceFaceCount: number;
  sharedTopologyFingerprint: string;
  shaderAdapterKey: string | null;
  dispose(): void;
}>;

function baseMesh(body: SkinnedBody): THREE.SkinnedMesh {
  const mesh = body.object.getObjectByName(`body-${body.key}`) as THREE.SkinnedMesh | null;
  if (!mesh?.isSkinnedMesh) throw new Error(`Missing actual skinned source body ${body.key}`);
  return mesh;
}
function wardrobeMesh(body: SkinnedBody): THREE.SkinnedMesh {
  const mesh = body.object.getObjectByName('avatar-wardrobe') as THREE.SkinnedMesh | null;
  if (!mesh?.isSkinnedMesh || !mesh.geometry.index || mesh.geometry.groups.length !== 0) throw new Error('Expected the production one-material indexed wardrobe overlay');
  return mesh;
}
function attributeBytes(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Uint8Array {
  const array = attribute.array;
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}
function assertSameAttribute(a: THREE.BufferAttribute, b: THREE.BufferAttribute, name: string): void {
  if (a.itemSize !== b.itemSize || a.count !== b.count || a.normalized !== b.normalized || a.array.constructor !== b.array.constructor) throw new Error(`${name} layout differs between zero-ease and exact chart`);
  const x = attributeBytes(a), y = attributeBytes(b);
  if (x.length !== y.length || x.some((value, index) => value !== y[index])) throw new Error(`${name} bytes differ between zero-ease and exact chart`);
}
function filterSyntheticTop(body: SkinnedBody, wardrobe: THREE.SkinnedMesh, rest: ReturnType<typeof captureWardrobeRestFrame>, hemY: number): { kept: number; removed: number } {
  const geometry = wardrobe.geometry, position = geometry.getAttribute('position'), index = geometry.index;
  if (!position || !index) throw new Error('Production overlay is not indexed');
  if (geometry.drawRange.start !== 0 || !(geometry.drawRange.count === Infinity || geometry.drawRange.count >= index.count)) throw new Error('Unexpected overlay draw range; refusing a partial-index split');
  const itemRanges: { key: string; start: number; end: number }[] = [];
  let cursor = 0;
  for (const [key, triangles] of Object.entries(body.wardrobe.itemTriangles)) {
    if (!Number.isInteger(triangles) || triangles < 0) throw new Error(`Invalid production item triangle count for ${key}`);
    itemRanges.push({ key, start: cursor, end: cursor + triangles }); cursor += triangles;
  }
  if (cursor !== index.count / 3) throw new Error(`Wardrobe item ranges ${cursor} do not match active source indices ${index.count / 3}`);
  const officeRange = itemRanges.filter(range => range.key === 'outfit:office');
  if (officeRange.length !== 1 || officeRange[0]!.end <= officeRange[0]!.start) throw new Error('Cannot identify exactly one office outfit item range');
  const office = officeRange[0]!;
  const kept: number[] = [];
  let removed = 0;
  for (let triangle = 0; triangle < index.count / 3; triangle++) {
    const i = triangle * 3;
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const y = ids.map(id => new THREE.Vector3().fromBufferAttribute(position, id).applyMatrix4(rest.metresFromMesh).y);
    // The production office builder emits trousers first at/below this hem and its synthetic shirt above; item ranges outside `outfit:office` remain byte-for-byte indexed (hair/shoes/accessories are never y-filtered).
    // Keep only triangles wholly on the lower side; exact-boundary faces remain with the trouser section.
    if (triangle < office.start || triangle >= office.end || Math.max(...y) <= hemY + 0.00025) kept.push(...ids);
    else removed++;
  }
  if (!removed || kept.length === 0) throw new Error(`Office synthetic-top split was not identifiable (kept=${kept.length / 3}, removed=${removed})`);
  const IndexArray = position.count <= 65535 ? Uint16Array : Uint32Array;
  const filteredIndex = new THREE.BufferAttribute(new IndexArray(kept), 1);
  geometry.setIndex(filteredIndex);
  filteredIndex.needsUpdate = true;
  return { kept: kept.length / 3, removed };
}
function cloneFabricMaterial(source: THREE.Material, chart: boolean): THREE.Material {
  if (Array.isArray(source)) throw new Error('Wardrobe must use one fabric material');
  const material = source.clone();
  // THREE.Material.copy intentionally does not copy custom callbacks. Reuse the exact production
  // fabric callback (including its uWardrobeFabric closure) on the isolated clone before adding
  // the position-only chart adapter, and preserve its production cache key on the source variant.
  const fabricCompile = source.onBeforeCompile, fabricKey = source.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => fabricCompile.call(source, shader, renderer);
  material.customProgramCacheKey = () => fabricKey.call(source);
  if (chart) {
    material.onBeforeCompile = sourceCornerSkinningHook(material);
    material.customProgramCacheKey = () => SOURCE_CORNER_SKINNING_CACHE_KEY;
  }
  return material;
}
function sharedFingerprint(geometry: THREE.BufferGeometry): string {
  let h = 2166136261 >>> 0;
  const update = (data: Uint8Array) => { for (const byte of data) { h ^= byte; h = Math.imul(h, 16777619) >>> 0; } };
  for (const name of ['position', 'normal', 'color', 'wardrobeUv', 'wardrobeCloth', 'skinIndex', 'skinWeight']) { const attr = geometry.getAttribute(name) as THREE.BufferAttribute; update(new TextEncoder().encode(name)); update(attributeBytes(attr)); }
  if (geometry.index) update(attributeBytes(geometry.index as THREE.BufferAttribute));
  return h.toString(16).padStart(8, '0');
}
function sameZeroEaseChart(a: THREE.BufferGeometry, b: THREE.BufferGeometry): void {
  const shared = ['position', 'normal', 'color', 'wardrobeUv', 'wardrobeCloth', 'skinIndex', 'skinWeight'];
  for (const name of shared) {
    const aa = a.getAttribute(name), bb = b.getAttribute(name);
    if (!aa || !bb) throw new Error(`Missing chart attribute ${name}`);
    assertSameAttribute(aa as THREE.BufferAttribute, bb as THREE.BufferAttribute, name);
  }
  if (!a.index || !b.index || a.index.count !== b.index.count) throw new Error('Source-face index counts differ');
  const ia = attributeBytes(a.index as THREE.BufferAttribute), ib = attributeBytes(b.index as THREE.BufferAttribute);
  if (ia.length !== ib.length || ia.some((value, i) => value !== ib[i])) throw new Error('Source-face index bytes differ');
}

/**
 * Applies the controlled GPU comparison after the actual production wardrobe has built and masked its body.
 * Both variants retain the exact production body mask, lower outfit, material/color inputs, skeleton and source mesh.
 * Only the generated shirt above the office hem is replaced by the v2 zero-ease chart; the right-side variant
 * adds the exact source-corner position adapter. The test intentionally adds one chart draw to the one retained
 * production wardrobe draw and reports its triangles/bytes separately.
 */
export function applyOfficeSourceChart(body: SkinnedBody, kind: 'source' | 'chart'): FixtureAugmentation {
  if (body.wardrobeError) throw new Error(body.wardrobeError);
  const base = baseMesh(body), wardrobe = wardrobeMesh(body), rest = captureWardrobeRestFrame(base);
  const hip = rest.bones.get('pelvis')?.point, neck = rest.bones.get('neck_01')?.point;
  if (!hip || !neck) throw new Error('Actual rig lacks pelvis/neck rest anchors');
  const hemY = hip.y - 0.085, options = { hemY, neckTopY: neck.y - 0.018 };
  const ordinary = buildExpandedOfficeShell(base, rest, { ...options, radialEase: 0 });
  const exact = buildOfficeSourceCornerChart(base, rest, options);
  sameZeroEaseChart(ordinary.geometry, exact.geometry);
  const shellGeometry = kind === 'source' ? ordinary.geometry : exact.geometry;
  const split = filterSyntheticTop(body, wardrobe, rest, hemY);
  const shellMaterial = cloneFabricMaterial(wardrobe.material as THREE.Material, kind === 'chart');
  const shellMesh = new THREE.SkinnedMesh(shellGeometry, shellMaterial);
  shellMesh.name = `office-source-shell-${kind}`;
  shellMesh.bindMode = base.bindMode;
  shellMesh.bind(base.skeleton, base.bindMatrix);
  shellMesh.frustumCulled = false;
  shellMesh.renderOrder = wardrobe.renderOrder;
  wardrobe.add(shellMesh);
  shellMesh.updateMatrixWorld(true);
  const expectedAttributes = kind === 'chart' ? 11 : 7;
  if (Object.keys(shellGeometry.attributes).length !== expectedAttributes) throw new Error(`Unexpected ${kind} shell attribute count ${Object.keys(shellGeometry.attributes).length}`);
  const sourceBinding = kind === 'chart' ? exact.sourceFaceIds.length : ordinary.triangles;
  const shellBytes = Object.values(shellGeometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0)
    + (shellGeometry.index?.array.byteLength ?? 0);
  let disposed = false;
  return {
    shellTriangles: shellGeometry.index!.count / 3,
    shellVertices: shellGeometry.getAttribute('position').count,
    shellBytes,
    shellAttributeCount: Object.keys(shellGeometry.attributes).length,
    retainedWardrobeTriangles: split.kept,
    removedSyntheticTopTriangles: split.removed,
    drawCallsForWardrobe: 2,
    shellSourceFaceCount: sourceBinding,
    sharedTopologyFingerprint: sharedFingerprint(shellGeometry),
    shaderAdapterKey: kind === 'chart' ? SOURCE_CORNER_SKINNING_CACHE_KEY : null,
    dispose() {
      if (disposed) return;
      disposed = true;
      shellMesh.removeFromParent(); shellGeometry.dispose(); shellMaterial.dispose();
      if (kind === 'source') exact.geometry.dispose(); else ordinary.geometry.dispose();
    },
  };
}
