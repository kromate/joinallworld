import * as THREE from 'three';
import type { AvatarBodyRegion } from '/src/game/wardrobe/catalogue.ts';
import type { WardrobeGeometry, WardrobeRestFrame } from '/src/scene/wardrobe/geometry.ts';
import { SOURCE_CORNER_SKINNING_CACHE_KEY, sourceCornerSkinningHook } from '../source-corner-skinning-adapter.ts';
import { clipSourceTriangle, type ClipCorner, type ClipPlane } from '../../shoulder-yoke-v1/clip-source-triangle.ts';

type MaskSpec = Pick<WardrobeGeometry, 'hides' | 'coverage'>;
type SourceBinding = Readonly<{ face: number; vertices: readonly [number, number, number]; barycentric: readonly [number, number, number] }>;
export type NeckComplement = Readonly<{
  geometry: THREE.BufferGeometry;
  triangles: number;
  vertices: number;
  bytes: number;
  areaSquareMetres: number;
  areaBySourceFace: Readonly<Record<string, number>>;
  maskedSourceFaces: number;
  clippedNeckFaces: number;
  sourceFaceIds: readonly number[];
  sourceBindings: readonly SourceBinding[];
  dispose(): void;
}>;

const ATTRS = ['sourceBind0', 'sourceBind1', 'sourceBind2', 'sourceBind3'] as const;
const finite = Number.isFinite;

function regionForVertex(mesh: THREE.SkinnedMesh, rest: WardrobeRestFrame, vertex: number): AvatarBodyRegion | null {
  const geometry = mesh.geometry, color = geometry.getAttribute('color'), skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
  if (!skinIndex || !skinWeight) throw new Error('Neck complement requires source skin attributes');
  if (color && color.itemSize === 4 && color.getW(vertex) > 0.5) return 'hair';
  let strongest = 0;
  for (let channel = 1; channel < 4; channel++) if (skinWeight.getComponent(vertex, channel) > skinWeight.getComponent(vertex, strongest)) strongest = channel;
  const bone = mesh.skeleton.bones[skinIndex.getComponent(vertex, strongest)]?.name ?? '';
  let region: AvatarBodyRegion | null = null;
  if (bone === 'Head') region = 'head';
  else if (bone === 'neck_01') region = 'neck';
  else if (bone.startsWith('spine_') || bone.startsWith('clavicle_')) region = 'torso';
  else if (bone.startsWith('upperarm_')) region = 'upperarms';
  else if (bone.startsWith('lowerarm_')) region = 'forearms';
  else if (bone === 'pelvis') region = 'hips';
  else if (bone.startsWith('thigh_') || bone.startsWith('calf_')) region = 'legs';
  else if (bone.startsWith('foot_') || bone.startsWith('ball_')) region = 'feet';
  const neckLimit = (rest.bones.get('neck_01')?.point.y ?? 1.5) + 0.045;
  return region === 'head' || (region === 'neck' && (rest.points[vertex]?.y ?? Infinity) > neckLimit) ? null : region;
}

function scalarAt(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number, channel: number): number {
  return attribute.getComponent(vertex, channel);
}
function localPosition(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number): THREE.Vector3 {
  return new THREE.Vector3().fromBufferAttribute(position, vertex);
}
function normalEncoding(value: number, attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number {
  if (!attribute.normalized || attribute.array instanceof Float32Array || attribute.array instanceof Float64Array) return value;
  const array = attribute.array;
  if (array instanceof Int8Array) return Math.round(THREE.MathUtils.clamp(value, -1, 1) * 127);
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
  if (array instanceof Int16Array) return Math.round(THREE.MathUtils.clamp(value, -1, 1) * 32767);
  if (array instanceof Uint16Array) return Math.round(THREE.MathUtils.clamp(value, 0, 1) * 65535);
  if (array instanceof Int32Array) return Math.round(THREE.MathUtils.clamp(value, -1, 1) * 2147483647);
  if (array instanceof Uint32Array) return Math.round(THREE.MathUtils.clamp(value, 0, 1) * 4294967295);
  throw new Error(`Unsupported normalized body attribute storage ${array.constructor.name}`);
}
function typedAttribute(source: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, values: number[]): THREE.BufferAttribute {
  if (source.isInterleavedBufferAttribute) throw new Error('Neck complement refuses interleaved source attributes');
  const Constructor = source.array.constructor as new (values: number[]) => THREE.TypedArray;
  const array = new Constructor(values);
  const output = new THREE.BufferAttribute(array, source.itemSize, source.normalized);
  output.setUsage(source.usage);
  return output;
}
function makePlanes(rest: WardrobeRestFrame, hemY: number, neckTopY: number): ClipPlane[] {
  const planes: ClipPlane[] = [
    { normal: [0, 1, 0], offset: -neckTopY, keep: 'positive' },
    { normal: [0, 1, 0], offset: -hemY, keep: 'positive' },
  ];
  for (const side of ['l', 'r'] as const) {
    const shoulder = rest.bones.get(`upperarm_${side}`)?.point, hand = rest.bones.get(`hand_${side}`)?.point;
    if (!shoulder || !hand) throw new Error(`Missing source-corner cuff anchors for ${side}`);
    const axis = hand.clone().sub(shoulder).normalize();
    const limit = hand.clone().sub(shoulder).dot(axis) + 0.012;
    planes.push({ normal: axis.toArray() as [number, number, number], offset: -limit - shoulder.dot(axis), keep: 'negative' });
  }
  return planes;
}

/**
 * Builds only masked torso/neck face complements above the exact source-chart neck plane.
 * The chart shell owns the opposite half of these same source faces. This utility does not
 * change the displayed body's mask; its result is a separate, body-material sibling draw.
 */
export function buildMaskedNeckComplement(
  displayedBody: THREE.SkinnedMesh,
  fullAppearanceSource: THREE.SkinnedMesh,
  rest: WardrobeRestFrame,
  mask: MaskSpec,
  hemY: number,
  neckTopY: number,
): NeckComplement {
  if (displayedBody === fullAppearanceSource) throw new Error('Complement source must be a private full-index body clone');
  const source = fullAppearanceSource.geometry, sourceIndex = source.index, position = source.getAttribute('position'), normal = source.getAttribute('normal'), skinIndex = source.getAttribute('skinIndex'), skinWeight = source.getAttribute('skinWeight');
  const visibleIndex = displayedBody.geometry.index, visibleCount = displayedBody.geometry.drawRange.count;
  if (!sourceIndex || !position || !normal || !skinIndex || !skinWeight || !visibleIndex || !Number.isInteger(visibleCount) || visibleCount < 0 || visibleCount % 3 !== 0 || displayedBody.geometry.drawRange.start !== 0) throw new Error('Complement requires full private source and compact active production mask');
  if (sourceIndex.count % 3 !== 0 || !finite(hemY) || !finite(neckTopY) || neckTopY <= hemY) throw new Error('Invalid full source topology or neck/hem planes');
  for (const name of Object.keys(source.attributes)) {
    const a = source.getAttribute(name)!, b = displayedBody.geometry.getAttribute(name);
    if (!b || a.itemSize !== b.itemSize || a.count !== b.count || a.normalized !== b.normalized || a.array.constructor !== b.array.constructor) throw new Error(`Source/displayed attribute layout differs for ${name}`);
  }
  const regions = Array.from({ length: position.count }, (_, vertex) => regionForVertex(fullAppearanceSource, rest, vertex));
  const covered = (vertex: number, region: AvatarBodyRegion) => {
    const ranges = mask.coverage.filter(item => item.region === region), y = rest.points[vertex]?.y ?? Infinity;
    return !ranges.length || ranges.some(range => y >= range.minY && y <= range.maxY);
  };
  const hidden = new Set<number>();
  let maskCursor = 0, actualFace = 0;
  for (let face = 0; face < sourceIndex.count / 3; face++) {
    const at = face * 3, ids = [sourceIndex.getX(at), sourceIndex.getX(at + 1), sourceIndex.getX(at + 2)] as const;
    const regs = ids.map(id => regions[id]!) as [AvatarBodyRegion | null, AvatarBodyRegion | null, AvatarBodyRegion | null];
    const shouldHide = regs.every((region, corner) => !!region && mask.hides.has(region) && covered(ids[corner]!, region));
    if (shouldHide) hidden.add(face);
    if (maskCursor < visibleCount && visibleIndex.getX(maskCursor) === ids[0] && visibleIndex.getX(maskCursor + 1) === ids[1] && visibleIndex.getX(maskCursor + 2) === ids[2]) {
      if (shouldHide) throw new Error(`Production mask retained face ${face} that the authoring rule hides`);
      maskCursor += 3;
    } else if (!shouldHide) {
      throw new Error(`Displayed mask omitted unhidden full-source face ${face}; refusing complement on replay mismatch`);
    }
    actualFace++;
  }
  if (maskCursor !== visibleCount || actualFace !== sourceIndex.count / 3) throw new Error('Displayed active mask is not an exact ordered subsequence of full source');

  const planes = makePlanes(rest, hemY, neckTopY);
  const outputValues = new Map<string, number[]>();
  for (const name of Object.keys(source.attributes)) outputValues.set(name, []);
  const boneValues: number[] = [], weightValues: number[] = [], bindValues = [[], [], [], []] as number[][];
  const outputIndices: number[] = [], sourceFaceIds: number[] = [], sourceBindings: SourceBinding[] = [];
  let clippedNeckFaces = 0, areaSquareMetres = 0;
  const areaBySourceFace: Record<string, number> = {};
  for (const face of hidden) {
    const offset = face * 3, ids = [sourceIndex.getX(offset), sourceIndex.getX(offset + 1), sourceIndex.getX(offset + 2)] as const;
    const regs = ids.map(id => regions[id]);
    // Do not repaint hair, face, arms, or lower-body areas through the new top edge.
    if (!regs.every(region => region === 'torso' || region === 'neck')) continue;
    const corners = ids.map((vertex, corner): ClipCorner => {
      const metres = localPosition(position, vertex).applyMatrix4(rest.metresFromMesh);
      const n = new THREE.Vector3().fromBufferAttribute(normal, vertex).normalize();
      const uv = source.getAttribute('uv');
      if (!uv) throw new Error('Body material complement requires source UVs');
      const influences = Array.from({ length: 4 }, (_, channel) => [skinIndex.getComponent(vertex, channel), skinWeight.getComponent(vertex, channel)] as const).filter(([, amount]) => amount > 0);
      return { position: metres.toArray() as [number, number, number], normal: n.toArray() as [number, number, number], uv: [uv.getX(vertex), uv.getY(vertex)], influences,
        barycentric: [corner === 0 ? 1 : 0, corner === 1 ? 1 : 0, corner === 2 ? 1 : 0] };
    }) as [ClipCorner, ClipCorner, ClipCorner];
    const fragments = clipSourceTriangle(face, corners, planes);
    if (!fragments.length) continue;
    clippedNeckFaces++;
    for (const fragment of fragments) {
      const pa = new THREE.Vector3(...fragment.corners[0].position), pb = new THREE.Vector3(...fragment.corners[1].position), pc = new THREE.Vector3(...fragment.corners[2].position);
      const triangleArea = pb.sub(pa).cross(pc.sub(pa)).length() * 0.5;
      if (!(finite(triangleArea) && triangleArea > 0)) throw new Error(`Neck complement has degenerate source fragment on face ${face}`);
      areaSquareMetres += triangleArea;
      areaBySourceFace[String(face)] = (areaBySourceFace[String(face)] ?? 0) + triangleArea;
      for (const corner of fragment.corners) {
        const bary = corner.barycentric, vertexIndex = sourceBindings.length;
        sourceBindings.push({ face, vertices: ids, barycentric: bary });
        for (const [name, sourceValues] of Object.entries(source.attributes)) {
          const values = outputValues.get(name)!, attribute = sourceValues as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
          if (name === 'skinIndex' || name === 'skinWeight') continue;
          const components = Array.from({ length: attribute.itemSize }, (_, component) => {
            let value = 0;
            for (let k = 0; k < 3; k++) value += bary[k]! * scalarAt(attribute, ids[k]!, component);
            return value;
          });
          if (name === 'normal') {
            if (attribute.itemSize !== 3) throw new Error('Body normal attribute must be vec3');
            const n = new THREE.Vector3(components[0]!, components[1]!, components[2]!);
            if (!(n.lengthSq() > 1e-16 && finite(n.lengthSq()))) throw new Error(`Neck source normal degenerates at face ${face}`);
            n.normalize(); components[0] = n.x; components[1] = n.y; components[2] = n.z;
          }
          if (!components.every(finite)) throw new Error(`Non-finite ${name} interpolation on source face ${face}`);
          for (const value of components) values.push(normalEncoding(value, attribute));
        }
        const influence = new Map<number, number>(), bindPoint = new Map<number, THREE.Vector3>();
        for (let k = 0; k < 3; k++) for (let channel = 0; channel < 4; channel++) {
          const amount = bary[k]! * skinWeight.getComponent(ids[k]!, channel);
          if (amount <= 0) continue;
          const bone = skinIndex.getComponent(ids[k]!, channel); influence.set(bone, (influence.get(bone) ?? 0) + amount);
          let sum = bindPoint.get(bone); if (!sum) { sum = new THREE.Vector3(); bindPoint.set(bone, sum); }
          sum.addScaledVector(localPosition(position, ids[k]!).applyMatrix4(fullAppearanceSource.bindMatrix), amount);
        }
        const entries = [...influence].filter(([, amount]) => amount > 1e-8).sort((a, b) => a[0] - b[0]);
        if (entries.length > 4) throw new Error(`Neck complement face ${face} vertex ${vertexIndex} needs ${entries.length} influences; refusing to prune source support`);
        const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
        if (!finite(total) || Math.abs(total - 1) > 1e-4) throw new Error(`Neck complement source weights do not normalize at face ${face}: ${total}`);
        for (let slot = 0; slot < 4; slot++) {
          const entry = entries[slot];
          boneValues.push(entry?.[0] ?? 0); weightValues.push(entry?.[1] ?? 0);
          const point = entry ? bindPoint.get(entry[0])!.clone().multiplyScalar(1 / entry[1]) : new THREE.Vector3();
          bindValues[slot]!.push(point.x, point.y, point.z);
        }
      }
      const start = sourceBindings.length - 3;
      outputIndices.push(start, start + 1, start + 2); sourceFaceIds.push(face);
    }
  }
  if (!outputIndices.length) throw new Error('No masked neck complement fragments were generated');
  const geometry = new THREE.BufferGeometry();
  for (const [name, sourceAttribute] of Object.entries(source.attributes)) {
    if (name === 'skinIndex') geometry.setAttribute(name, typedAttribute(sourceAttribute as THREE.BufferAttribute, boneValues));
    else if (name === 'skinWeight') geometry.setAttribute(name, typedAttribute(sourceAttribute as THREE.BufferAttribute, weightValues));
    else geometry.setAttribute(name, typedAttribute(sourceAttribute as THREE.BufferAttribute | THREE.InterleavedBufferAttribute, outputValues.get(name)!));
  }
  geometry.setIndex(outputIndices);
  for (let slot = 0; slot < 4; slot++) geometry.setAttribute(ATTRS[slot]!, new THREE.Float32BufferAttribute(bindValues[slot]!, 3));
  geometry.computeBoundingSphere();
  const bytes = Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0) + (geometry.index?.array.byteLength ?? 0);
  let disposed = false;
  return { geometry, triangles: outputIndices.length / 3, vertices: sourceBindings.length, bytes, areaSquareMetres, areaBySourceFace, maskedSourceFaces: hidden.size, clippedNeckFaces, sourceFaceIds, sourceBindings,
    dispose() { if (disposed) return; disposed = true; geometry.dispose(); } };
}

/** Clone the real body material and add the exact source-corner position skinning hook. */
export function makeNeckComplementMaterial(source: THREE.Material): THREE.Material {
  const material = source.clone(), compile = source.onBeforeCompile, key = source.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => compile.call(source, shader, renderer);
  material.customProgramCacheKey = () => `${key.call(source)}|${SOURCE_CORNER_SKINNING_CACHE_KEY}|neck-complement-v1`;
  material.onBeforeCompile = sourceCornerSkinningHook(material);
  return material;
}

/** Attach one isolated body-material draw beside the masked body; caller owns/disposes both. */
export function attachNeckComplement(displayedBody: THREE.SkinnedMesh, complement: NeckComplement): THREE.SkinnedMesh {
  if (!displayedBody.parent) throw new Error('Masked body must be attached before adding its neck complement');
  if (Array.isArray(displayedBody.material)) throw new Error('Neck complement requires the production single body material');
  const mesh = new THREE.SkinnedMesh(complement.geometry, makeNeckComplementMaterial(displayedBody.material));
  mesh.name = 'avatar-office-neck-complement';
  mesh.position.copy(displayedBody.position); mesh.quaternion.copy(displayedBody.quaternion); mesh.scale.copy(displayedBody.scale);
  mesh.matrix.copy(displayedBody.matrix); mesh.matrixAutoUpdate = displayedBody.matrixAutoUpdate;
  mesh.bindMode = displayedBody.bindMode; mesh.bind(displayedBody.skeleton, displayedBody.bindMatrix.clone());
  mesh.frustumCulled = false; mesh.renderOrder = displayedBody.renderOrder;
  displayedBody.parent.add(mesh);
  mesh.updateMatrixWorld(true);
  return mesh;
}
