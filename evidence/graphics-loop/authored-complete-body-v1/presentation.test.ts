import * as THREE from 'three';
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCharacterPresentation } from './presentation.ts';

function fixture() {
  const root = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = 'mixamorig:Hips';
  const bones = [hips];
  for (const name of ['mixamorig:LeftArm', 'mixamorig:LeftShoulder', 'mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:Head']) {
    const bone = new THREE.Bone(); bone.name = name; hips.add(bone); bones.push(bone);
  }
  root.add(hips);
  hips.updateMatrixWorld(true);

  const points: number[] = [];
  const faces = [
    { center: [0, 1.02, 0] as const, bone: 0 },
    { center: [0.11, 0.5, 0] as const, bone: 3 },
    { center: [0, 1.61, 0] as const, bone: 5 },
  ];
  for (const { center } of faces) points.push(
    center[0] - 0.02, center[1], center[2],
    center[0] + 0.02, center[1], center[2],
    center[0], center[1] + 0.02, center[2],
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const normals = new Float32Array(points.length);
  for (let vertex = 0; vertex < points.length / 3; vertex++) normals[vertex * 3 + 1] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const skinIndices = new Uint16Array(points.length / 3 * 4), skinWeights = new Float32Array(points.length / 3 * 4);
  for (let face = 0; face < faces.length; face++) for (let vertex = 0; vertex < 3; vertex++) {
    const index = face * 3 + vertex;
    skinIndices[index * 4] = faces[face]!.bone;
    skinWeights[index * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(points.length / 3 * 2), 2));
  geometry.setIndex(new THREE.Uint16BufferAttribute([0, 1, 2, 3, 4, 5, 6, 7, 8], 1));
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(points.length), 3)];
  geometry.morphTargetsRelative = true;
  const body = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  body.name = 'Body'; body.updateMorphTargets(); body.bind(new THREE.Skeleton(bones)); root.add(body);
  return { root, body, templateGeometry: geometry };
}

test('presentation replaces source faces, follows morphs, and restores shared source geometry', () => {
  const { root, body, templateGeometry } = fixture();
  const originalIndex = templateGeometry.getIndex();
  const originalObjects = new Set(root.children);
  const presentation = applyCharacterPresentation(root, { hairstyle: 'curly-bun' });
  assert.ok(presentation.metrics.shirtTriangles > 0);
  assert.ok(presentation.metrics.trouserTriangles > 0);
  assert.ok(presentation.metrics.scalpTriangles > 0);
  assert.ok(presentation.metrics.curlTriangles > 0);
  assert.ok(presentation.metrics.scalpTriangles + presentation.metrics.curlTriangles <= 7_000);
  assert.equal(presentation.metrics.drawCalls, 4);
  assert.notEqual(body.geometry, templateGeometry);
  assert.equal(templateGeometry.getIndex(), originalIndex, 'the immutable template geometry/index is not mutated');

  const shirt = root.getObjectByName('Authored shirt') as THREE.SkinnedMesh;
  const curls = root.getObjectByName('Authored curl details') as THREE.SkinnedMesh;
  assert.equal(shirt.geometry.morphAttributes.position.length, 1);
  assert.equal(curls.geometry.morphAttributes.position.length, 1);
  body.morphTargetInfluences![0] = 0.65;
  shirt.onBeforeRender({} as THREE.WebGLRenderer, {} as THREE.Scene, {} as THREE.Camera, shirt.geometry, shirt.material as THREE.Material, {} as THREE.Group);
  assert.equal(shirt.morphTargetInfluences![0], 0.65);

  const weights = curls.geometry.getAttribute('skinWeight');
  for (let vertex = 0; vertex < weights.count; vertex++) {
    const sum = weights.getX(vertex) + weights.getY(vertex) + weights.getZ(vertex) + weights.getW(vertex);
    assert.ok(Math.abs(sum - 1) < 1e-5, `curl vertex ${vertex} skin weights sum to ${sum}`);
  }
  presentation.dispose();
  assert.equal(body.geometry, templateGeometry);
  assert.deepEqual(new Set(root.children), originalObjects, 'dispose removes only presentation-owned siblings');
});
