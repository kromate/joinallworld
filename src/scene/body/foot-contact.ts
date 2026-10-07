import * as THREE from 'three';

export type FootSide = 'left' | 'right';
/** Sole contact in the body's parent/scene coordinates, matching home walk/floor samplers. */
export interface FootPoint { readonly side: FootSide; readonly x: number; readonly y: number; readonly z: number }
export interface FootContact extends FootPoint { readonly points?: readonly FootPoint[] }
export interface FootSolveResult { readonly corrected: number; readonly maxError: number; readonly limited: boolean }
export interface FootContactController {
  sample(): readonly FootContact[];
  /** Called after the host samples its clip and places the body. No time or frame loop is owned here. */
  solve(heightAt: (contact: FootContact) => number): FootSolveResult;
}
/** Metres in the immutable source body, before cosmetic/scene scaling. */
export const MAX_FOOT_CORRECTION = 0.12;
const PLANT_GAP = 0.024;
const SIDES = [{ side: 'left', suffix: 'l' }, { side: 'right', suffix: 'r' }] as const;

/** Two-bone contact fitting on the existing rig. It never moves the root or retargets animation. */
export function createFootContactController(root: THREE.Group, base: THREE.SkinnedMesh, clothing: THREE.SkinnedMesh): FootContactController {
  const legs = SIDES.map(({ side, suffix }) => {
    const thigh = base.skeleton.bones.find(bone => bone.name === `thigh_${suffix}`), calf = base.skeleton.bones.find(bone => bone.name === `calf_${suffix}`), foot = base.skeleton.bones.find(bone => bone.name === `foot_${suffix}`);
    if (!thigh || !calf || !foot) throw new Error(`Foot contact requires ${side} leg bones`);
    const indices = new Set(base.skeleton.bones.flatMap((bone, index) => bone.name === `foot_${suffix}` || bone.name === `ball_${suffix}` ? [index] : []));
    return { side, thigh, calf, foot, indices };
  });
  let source: THREE.SkinnedMesh = base, cachedGeometry: THREE.BufferGeometry | null = null;
  let soles: { side: FootSide; vertices: number[] }[] = [];
  const point = new THREE.Vector3(), bodyInverse = new THREE.Matrix4(), relative = new THREE.Matrix4();

  function refresh(): void {
    const garmentPosition = clothing.geometry.getAttribute('position');
    const next = clothing.visible && garmentPosition && garmentPosition.count > 0 ? clothing : base;
    if (cachedGeometry === next.geometry && source === next) return;
    source = next; cachedGeometry = next.geometry;
    const position = source.geometry.getAttribute('position'), skinIndex = source.geometry.getAttribute('skinIndex'), skinWeight = source.geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight) { soles = []; return; }
    soles = legs.map(leg => {
      const candidates: { index: number; y: number }[] = [];
      for (let index = 0; index < position.count; index++) {
        let weight = 0;
        for (let channel = 0; channel < 4; channel++) if (leg.indices.has(skinIndex.getComponent(index, channel))) weight += skinWeight.getComponent(index, channel);
        if (weight < 0.75) continue;
        point.fromBufferAttribute(position, index).applyMatrix4(source.matrix);
        candidates.push({ index, y: point.y });
      }
      const bottom = Math.min(...candidates.map(candidate => candidate.y));
      return { side: leg.side, vertices: candidates.filter(candidate => candidate.y <= bottom + 0.013).map(candidate => candidate.index) };
    });
    // A clear overlay or future item without footwear still samples the original clothed base.
    if (source !== base && soles.some(sole => sole.vertices.length === 0)) { source = base; cachedGeometry = null; refreshBase(); }
  }
  function refreshBase(): void {
    const position = base.geometry.getAttribute('position'), skinIndex = base.geometry.getAttribute('skinIndex'), skinWeight = base.geometry.getAttribute('skinWeight');
    soles = legs.map(leg => {
      const vertices: number[] = [];
      for (let index = 0; index < position.count; index++) {
        let weight = 0;
        for (let channel = 0; channel < 4; channel++) if (leg.indices.has(skinIndex.getComponent(index, channel))) weight += skinWeight.getComponent(index, channel);
        if (weight >= 0.75) vertices.push(index);
      }
      return { side: leg.side, vertices };
    });
  }
  function samplePrepared(): FootContact[] {
    const position = source.geometry.getAttribute('position'), parent = root.parent;
    return soles.flatMap(sole => {
      if (!sole.vertices.length) return [];
      let lowest = Infinity, x = 0, z = 0, count = 0;
      const points: FootPoint[] = [];
      for (const vertex of sole.vertices) {
        point.fromBufferAttribute(position, vertex); source.applyBoneTransform(vertex, point); point.applyMatrix4(source.matrixWorld);
        if (parent) parent.worldToLocal(point);
        points.push({ side: sole.side, x: point.x, y: point.y, z: point.z });
        if (point.y < lowest - 0.0005) { lowest = point.y; x = point.x; z = point.z; count = 1; }
        else if (Math.abs(point.y - lowest) <= 0.0005) { x += point.x; z += point.z; count++; }
      }
      return [{ side: sole.side, x: x / count, y: lowest, z: z / count, points }];
    });
  }
  function bonePoint(bone: THREE.Bone): THREE.Vector3 { return new THREE.Vector3().setFromMatrixPosition(relative.multiplyMatrices(bodyInverse, bone.matrixWorld)); }
  function rotationInBody(node: THREE.Object3D): THREE.Quaternion {
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    relative.multiplyMatrices(bodyInverse, node.matrixWorld).decompose(position, quaternion, scale);
    return quaternion;
  }
  function aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
    const delta = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    const wanted = rotationInBody(bone).premultiply(delta);
    const parent = bone.parent;
    if (parent) wanted.premultiply(rotationInBody(parent).invert());
    bone.quaternion.copy(wanted);
    root.updateWorldMatrix(true, true);
  }
  function fit(leg: typeof legs[number], delta: number): boolean {
    bodyInverse.copy(root.matrixWorld).invert();
    const hip = bonePoint(leg.thigh), knee = bonePoint(leg.calf), ankle = bonePoint(leg.foot), target = ankle.clone();
    target.y += delta;
    const upperLength = hip.distanceTo(knee), lowerLength = knee.distanceTo(ankle);
    if (upperLength < 0.01 || lowerLength < 0.01) return true;
    const direction = target.clone().sub(hip), requested = direction.length();
    const reach = THREE.MathUtils.clamp(requested, Math.abs(upperLength - lowerLength) + 0.002, upperLength + lowerLength - 0.0002);
    if (requested < 0.001) return true;
    direction.divideScalar(requested); target.copy(hip).addScaledVector(direction, reach);
    let pole = knee.clone().sub(hip).addScaledVector(direction, -knee.clone().sub(hip).dot(direction));
    if (pole.lengthSq() < 1e-8) pole = new THREE.Vector3(0, 0, 1).addScaledVector(direction, -direction.z);
    pole.normalize();
    const cosine = THREE.MathUtils.clamp((upperLength ** 2 + reach ** 2 - lowerLength ** 2) / (2 * upperLength * reach), -1, 1);
    const wantedKnee = hip.clone().addScaledVector(direction, upperLength * cosine).addScaledVector(pole, upperLength * Math.sqrt(Math.max(0, 1 - cosine ** 2)));
    const originalFootRotation = rotationInBody(leg.foot);
    aim(leg.thigh, knee.clone().sub(hip), wantedKnee.clone().sub(hip));
    const actualKnee = bonePoint(leg.calf), actualAnkle = bonePoint(leg.foot);
    aim(leg.calf, actualAnkle.sub(actualKnee), target.clone().sub(actualKnee));
    // Retain the clip's sampled foot orientation. Knee/ankle fitting must not twist the shoe or toe pose.
    if (leg.foot.parent) originalFootRotation.premultiply(rotationInBody(leg.foot.parent).invert());
    leg.foot.quaternion.copy(originalFootRotation);
    root.updateWorldMatrix(true, true);
    return Math.abs(reach - requested) > 0.001;
  }
  return {
    sample() { root.updateWorldMatrix(true, true); refresh(); return samplePrepared(); },
    solve(heightAt) {
      root.updateWorldMatrix(true, true); refresh();
      const contacts = samplePrepared();
      let corrected = 0, limited = false;
      const desired = new Map<FootSide, number>();
      for (const contact of contacts) {
        const height = contact.y + Math.max(...(contact.points ?? [contact]).map(p => heightAt(p) - p.y));
        if (!Number.isFinite(height)) { limited = true; continue; }
        const amount = (height - contact.y) / root.scale.y;
        // Preserve deliberately raised swing feet. Only a near-planted foot may be lowered.
        if (amount < -PLANT_GAP) continue;
        desired.set(contact.side, height);
        if (Math.abs(amount) < 0.0002) continue;
        const bounded = THREE.MathUtils.clamp(amount, -MAX_FOOT_CORRECTION, MAX_FOOT_CORRECTION);
        if (Math.abs(amount - bounded) > 0.001) limited = true;
        const leg = legs.find(candidate => candidate.side === contact.side);
        if (leg) { limited = fit(leg, bounded) || limited; corrected++; }
      }
      let maxError = 0;
      for (const contact of samplePrepared()) {
        const height = desired.get(contact.side);
        if (height !== undefined) maxError = Math.max(maxError, Math.abs(contact.y - height));
      }
      return { corrected, maxError, limited };
    },
  };
}
