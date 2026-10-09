import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { captureWardrobeRestFrame, buildWardrobeGeometry } from './geometry.ts';

await MeshoptDecoder.ready;
const ASSETS = new URL('../body/assets/', import.meta.url);
const OFFICE_TRIANGLE_CAP = 744;
const look = (body: 'man' | 'woman', outfit = 'office') => ({
  body, hair: 'lowcut', hairColor: '#29211c', outfit, outfitColor: '#356b95',
  bottomsColor: '#c3944a', skin: '#845236', fabric: 'plain',
});

async function loadAsset(name: string, stripImages = false): Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>> {
  const bytes = new Uint8Array(await readFile(new URL(name, ASSETS)));
  if (!stripImages) return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '/');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12, json: Record<string, any> | undefined, binary: Uint8Array | undefined;
  while (offset < bytes.length) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    const chunk = bytes.slice(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as Record<string, any>;
    else if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  assert.ok(json && binary, `${name}: GLB JSON and binary chunks`);
  // The diagnostic only needs geometry and skinning; omit texture payloads so GLTFLoader
  // can parse these shipped assets in Node without a browser image decoder.
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (encoded.length + 3) & ~3, binaryLength = (binary.length + 3) & ~3;
  const glb = new Uint8Array(28 + jsonLength + binaryLength), output = new DataView(glb.buffer);
  output.setUint32(0, 0x46546c67, true); output.setUint32(4, 2, true); output.setUint32(8, glb.length, true);
  output.setUint32(12, jsonLength, true); output.setUint32(16, 0x4e4f534a, true);
  glb.fill(0x20, 20, 20 + jsonLength); glb.set(encoded, 20);
  output.setUint32(20 + jsonLength, binaryLength, true); output.setUint32(24 + jsonLength, 0x004e4942, true);
  glb.set(binary, 28 + jsonLength);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer, '/');
}

const closeColour = (attribute: THREE.BufferAttribute, index: number, colour: THREE.Color, tolerance = 0.003) =>
  Math.abs(attribute.getX(index) - colour.r) < tolerance
  && Math.abs(attribute.getY(index) - colour.g) < tolerance
  && Math.abs(attribute.getZ(index) - colour.b) < tolerance;

for (const body of ['male', 'female'] as const) {
  test(`office geometry stays welded and tucked on shipped ${body} idle/walk/dance poses`, async () => {
    const baseAsset = await loadAsset(`base-body-${body}.glb`, true);
    const clipsAsset = await loadAsset('clip-pack.glb');
    let base: THREE.SkinnedMesh | undefined;
    baseAsset.scene.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh && !base) base = node as THREE.SkinnedMesh; });
    assert.ok(base, `${body}: shipped skinned body`);
    const rest = captureWardrobeRestFrame(base);
    const built = buildWardrobeGeometry(rest, { look: look(body === 'male' ? 'man' : 'woman'), ids: [] });
    assert.ok(built.triangles <= OFFICE_TRIANGLE_CAP, `${body}: ${built.triangles} <= ${OFFICE_TRIANGLE_CAP}`);

    const geometry = built.geometry, position = geometry.getAttribute('position'), colours = geometry.getAttribute('color');
    const skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
    const indices = geometry.index?.array;
    assert.ok(indices && colours && skinIndex && skinWeight, 'indexed, coloured, skinned geometry');
    const boneNames = base.skeleton.bones.map(bone => bone.name);
    const restPoint = (vertex: number) => new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(rest.metresFromMesh);
    for (let i = 0; i < position.count; i++) {
      let total = 0;
      for (let j = 0; j < 4; j++) total += skinWeight.getComponent(i, j);
      assert.ok(Math.abs(total - 1) < 1e-4, `${body}: normalized skin weights at vertex ${i}`);
    }

    const edgeFaces = new Map<string, { direction: number; a: number; b: number; face: number[] }[]>();
    for (let t = 0; t < indices.length; t += 3) {
      const face = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
      for (let corner = 0; corner < 3; corner++) {
        const a = face[corner]!, b = face[(corner + 1) % 3]!, key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const edges = edgeFaces.get(key) ?? [];
        edges.push({ direction: a < b ? 1 : -1, a, b, face }); edgeFaces.set(key, edges);
      }
    }
    assert.equal([...edgeFaces.values()].filter(faces => faces.length > 2).length, 0, `${body}: no nonmanifold edges`);
    const hip = rest.bones.get('pelvis')!.point, chest = rest.bones.get('spine_03')!.point;
    const neck = rest.bones.get('neck_01')!.point;
    const shoulders = (['l', 'r'] as const).map(side => {
      const point = rest.bones.get(`upperarm_${side}`)!.point;
      const axis = rest.bones.get(`lowerarm_${side}`)!.point.clone().sub(point).normalize();
      return { point, axis };
    });
    const shoulderEdges = [...edgeFaces.values()].filter(faces => {
      if (faces.length !== 2) return false;
      const p = restPoint(faces[0]!.a), q = restPoint(faces[0]!.b);
      const mid = p.add(q).multiplyScalar(0.5);
      if (mid.y < chest.y + 0.03 || mid.y > neck.y) return false;
      return shoulders.some(({ point, axis }) => {
        if (mid.distanceTo(point) > 0.13) return false;
        const side = faces.map(face => {
          const centre = face.face.map(restPoint).reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / 3);
          return centre.sub(mid).dot(axis);
        });
        return side[0]! * side[1]! < 0;
      });
    });
    assert.ok(shoulderEdges.length >= 12, `${body}: both shoulder seams have shared edges`);
    assert.ok(shoulderEdges.every(faces => faces[0]!.direction !== faces[1]!.direction), `${body}: shoulder seam winding is opposite across each shared edge`);

    const shoulderVertices = new Set(shoulderEdges.flatMap(faces => faces.flatMap(edge => [edge.a, edge.b])));
    let clavicleSum = 0, upperArmSum = 0;
    for (const vertex of shoulderVertices) for (let j = 0; j < 4; j++) {
      const weight = skinWeight.getComponent(vertex, j), bone = boneNames[skinIndex.getComponent(vertex, j)!];
      if (bone?.startsWith('clavicle_')) clavicleSum += weight;
      if (bone?.startsWith('upperarm_')) upperArmSum += weight;
    }
    assert.ok(clavicleSum / shoulderVertices.size > 0.05, `${body}: shoulder seam carries clavicle influence`);
    assert.ok(upperArmSum / shoulderVertices.size > 0.1, `${body}: shoulder seam carries upper-arm influence`);

    const outfitColour = new THREE.Color('#356b95'), pantsColour = new THREE.Color('#c3944a');
    const shirtHem = hip.y - 0.085, zoneTop = hip.y + 0.12;
    const shirtFaces: number[][] = [], pantsFaces: number[][] = [];
    const roofVertices = Array.from({ length: position.count }, (_, vertex) => vertex).filter(vertex => {
      const point = restPoint(vertex);
      return closeColour(colours, vertex, outfitColour) && point.y > neck.y + 0.005
        && point.y < neck.y + 0.02 && Math.abs(point.x) < 0.12;
    });
    assert.ok(roofVertices.length >= 8, `${body}: sample shirt roof vertices above the armhole`);
    const roofLocalInfluence = roofVertices.map(vertex => {
      let total = 0;
      for (let j = 0; j < 4; j++) {
        const name = boneNames[skinIndex.getComponent(vertex, j)!];
        if (name?.startsWith('clavicle_') || name?.startsWith('upperarm_') || name?.startsWith('neck_')) total += skinWeight.getComponent(vertex, j);
      }
      return total;
    });
    assert.ok(Math.max(...roofLocalInfluence) > 0.1, `${body}: roof continues the local neck/shoulder skin field`);
    for (let t = 0; t < indices.length; t += 3) {
      const face = [indices[t]!, indices[t + 1]!, indices[t + 2]!], points = face.map(restPoint);
      const centre = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / 3);
      if (points.every(point => point.y >= shirtHem - 0.02 && point.y <= zoneTop + 0.02) && Math.abs(centre.x) < 0.34) {
        if (face.every(vertex => closeColour(colours, vertex, outfitColour))) shirtFaces.push(face);
        if (face.every(vertex => closeColour(colours, vertex, pantsColour)) && Math.abs(centre.x) > 0.025) pantsFaces.push(face);
      }
    }
    assert.ok(shirtFaces.length > 10 && pantsFaces.length > 10, `${body}: sampled torso shell and trouser faces`);

    for (const clipName of ['idle', 'walk', 'dance'] as const) {
      const clip = clipsAsset.animations.find(candidate => candidate.name.toLowerCase() === clipName);
      assert.ok(clip, `shipped ${clipName} clip`);
      const mixer = new THREE.AnimationMixer(baseAsset.scene), action = mixer.clipAction(clip);
      action.play(); action.time = clip.duration * (clipName === 'idle' ? 0.62 : clipName === 'walk' ? 0.37 : 0.5); mixer.update(0);
      baseAsset.scene.updateMatrixWorld(true); base.skeleton.update();
      const posedOverlay = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
      posedOverlay.bind(base.skeleton, base.bindMatrix); posedOverlay.matrix.copy(base.matrix);
      posedOverlay.matrixWorld.copy(base.matrixWorld); posedOverlay.updateMatrixWorld(true);
      const posed = (vertex: number) => posedOverlay.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(position, vertex));
      const shoulderMotion = Math.max(...[...shoulderVertices].map(vertex => posed(vertex).distanceTo(restPoint(vertex))));
      assert.ok(shoulderMotion > 0.04, `${body}/${clipName}: seam follows the animated skeleton`);
      if (body === 'female' && clipName === 'dance') {
        const roofMotion = Math.max(...roofVertices.map(vertex => posed(vertex).distanceTo(restPoint(vertex))));
        assert.ok(roofMotion > 0.04, `${body}/${clipName}: shirt roof follows the raised shoulder pose`);
      }
      const posedShirtFaces = shirtFaces.map(face => {
        const points = face.map(posed), normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize();
        return { points, triangle: new THREE.Triangle(...points), normal };
      });
      let tested = 0, mostOutside = -Infinity;
      for (const face of pantsFaces) {
        const points = face.map(posed), sample = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / 3);
        let nearestDistance = Infinity, signedDistance = -Infinity;
        for (const shirtFace of posedShirtFaces) {
          const nearest = shirtFace.triangle.closestPointToPoint(sample, new THREE.Vector3()), distance = sample.distanceTo(nearest);
          if (distance < nearestDistance) { nearestDistance = distance; signedDistance = sample.clone().sub(nearest).dot(shirtFace.normal); }
        }
        // Only compare nearby projected surfaces; more distant faces belong to the other side of the torso.
        if (nearestDistance > 0.04) continue;
        tested++; mostOutside = Math.max(mostOutside, signedDistance);
      }
      assert.ok(tested > 10, `${body}/${clipName}: enough nearby trouser-face samples`);
      assert.ok(mostOutside <= 0.001, `${body}/${clipName}: waistband stays inside shirt (signed margin ${mostOutside.toFixed(4)} m)`);
      mixer.stopAllAction(); posedOverlay.geometry.dispose(); posedOverlay.material.dispose();
    }
  });
}

for (const sample of [
  { asset: 'female', body: 'woman', outfit: 'owambe' },
  { asset: 'male', body: 'man', outfit: 'agbada' },
] as const) {
  test(`${sample.outfit} generates valid clothing on shipped ${sample.body} dance pose`, async () => {
    const bodyAsset = await loadAsset(`base-body-${sample.asset}.glb`, true);
    const clips = await loadAsset('clip-pack.glb');
    let base: THREE.SkinnedMesh | undefined;
    bodyAsset.scene.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh && !base) base = node as THREE.SkinnedMesh; });
    assert.ok(base, `${sample.body}: shipped skinned body`);
    const rest = captureWardrobeRestFrame(base);
    const built = buildWardrobeGeometry(rest, { look: look(sample.body, sample.outfit), ids: [] });
    assert.ok(built.triangles > 100 && built.triangles <= 4000, `${sample.outfit}: generated within item triangle budget`);
    const { geometry } = built, position = geometry.getAttribute('position'), index = geometry.index?.array;
    const colours = geometry.getAttribute('color');
    assert.ok(index && colours, 'indexed, coloured garment geometry');
    assert.ok(built.itemTriangles[`outfit:${sample.outfit}`]! > 0, `${sample.outfit}: outfit geometry is present`);
    assert.ok([...index].every(vertex => vertex < position.count), `${sample.outfit}: all face indices address generated vertices`);
    for (let vertex = 0; vertex < position.count; vertex++) {
      let total = 0;
      for (let channel = 0; channel < 4; channel++) total += geometry.getAttribute('skinWeight').getComponent(vertex, channel);
      assert.ok(Math.abs(total - 1) < 1e-4, `${sample.outfit}: normalized skin weight at vertex ${vertex}`);
    }
    const dance = clips.animations.find(clip => clip.name.toLowerCase() === 'dance');
    assert.ok(dance, 'shipped dance clip');
    const mixer = new THREE.AnimationMixer(bodyAsset.scene), action = mixer.clipAction(dance);
    action.play(); action.time = dance.duration * 0.5; mixer.update(0); bodyAsset.scene.updateMatrixWorld(true); base.skeleton.update();
    const overlay = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    overlay.bind(base.skeleton, base.bindMatrix); overlay.matrix.copy(base.matrix); overlay.matrixWorld.copy(base.matrixWorld); overlay.updateMatrixWorld(true);
    const posedVertices = Array.from({ length: position.count }, (_, vertex) => overlay.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(position, vertex)));
    assert.ok(posedVertices.every(p => Number.isFinite(p.x + p.y + p.z)), `${sample.outfit}: all clothing deforms finitely in the shipped dance pose`);
    overlay.geometry.dispose(); overlay.material.dispose(); mixer.stopAllAction();
  });
}

for (const sample of [
  { asset: 'male', body: 'man' },
  { asset: 'female', body: 'woman' },
] as const) {
  test(`Agbada embroidery is same-surface and outfit-scoped on shipped ${sample.body}`, async () => {
    const bodyAsset = await loadAsset(`base-body-${sample.asset}.glb`, true);
    let base: THREE.SkinnedMesh | undefined;
    bodyAsset.scene.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh && !base) base = node as THREE.SkinnedMesh; });
    assert.ok(base, `${sample.body}: shipped skinned body`);
    const rest = captureWardrobeRestFrame(base);
    const agbada = buildWardrobeGeometry(rest, { look: look(sample.body, 'agbada'), ids: [] });
    const geometry = agbada.geometry, position = geometry.getAttribute('position');
    const pattern = geometry.getAttribute('wardrobeCloth');
    assert.ok(pattern && pattern.count === position.count, 'generated clothing exposes its existing fabric mask');
    assert.equal(agbada.itemTriangles['outfit:agbada'], 448, 'Agbada outfit geometry is 24 triangles smaller after removing detached bars');
    const gold = new THREE.Color('#d5aa45'), colours = geometry.getAttribute('color');
    let taggedFrontVertices = 0, detachedGoldVertices = 0;
    for (let vertex = 0; vertex < position.count; vertex++) {
      if (pattern.getX(vertex) > 1.5) {
        taggedFrontVertices++;
        const restPosition = new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(rest.metresFromMesh);
        assert.ok(restPosition.z > 0.025, `${sample.body}: patterned vertices stay on the front surface`);
      }
      if (closeColour(colours, vertex, gold)) detachedGoldVertices++;
    }
    assert.ok(taggedFrontVertices > 0, `${sample.body}: Agbada front carries the shader decoration tag`);
    assert.equal(detachedGoldVertices, 0, `${sample.body}: embroidery adds no detached gold geometry`);

    for (const outfit of ['casual', 'kaftan'] as const) {
      const other = buildWardrobeGeometry(rest, { look: look(sample.body, outfit), ids: [] });
      const otherPattern = other.geometry.getAttribute('wardrobeCloth');
      assert.ok(otherPattern, `${sample.body}/${outfit}: fabric mask exists`);
      assert.equal(Array.from({ length: otherPattern.count }, (_, vertex) => otherPattern.getX(vertex)).some(value => value > 1.5), false,
        `${sample.body}/${outfit}: Agbada-only shader decoration does not leak to another outfit`);
    }
    geometry.dispose();
  });
}
