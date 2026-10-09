import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createFootContactController } from './foot-contact.ts';
import { createAnimationPoseCheckpoint } from './animation-pose.ts';

function makeRig() {
  const root = new THREE.Group();
  const bones: THREE.Bone[] = [];
  const feet = new Map<'l' | 'r', THREE.Bone>();
  for (const side of ['l', 'r'] as const) {
    const thigh = new THREE.Bone(); thigh.name = `thigh_${side}`; thigh.position.set(side === 'l' ? -0.2 : 0.2, 1, 0);
    const calf = new THREE.Bone(); calf.name = `calf_${side}`; calf.position.y = -0.5; thigh.add(calf);
    const foot = new THREE.Bone(); foot.name = `foot_${side}`; foot.position.y = -0.5; calf.add(foot);
    const ball = new THREE.Bone(); ball.name = `ball_${side}`; ball.position.z = 0.08; foot.add(ball);
    root.add(thigh); bones.push(thigh, calf, foot, ball); feet.set(side, foot);
  }

  const positions: number[] = [], skinIndices: number[] = [], skinWeights: number[] = [];
  for (const side of ['l', 'r'] as const) {
    const centerX = side === 'l' ? -0.2 : 0.2;
    const footIndex = bones.findIndex(bone => bone.name === `foot_${side}`);
    for (const [dx, dz] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]] as const) {
      positions.push(centerX + dx, 0, dz);
      skinIndices.push(footIndex, 0, 0, 0); skinWeights.push(1, 0, 0, 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const material = new THREE.MeshBasicMaterial();
  const base = new THREE.SkinnedMesh(geometry, material); root.add(base);
  root.updateMatrixWorld(true); base.bind(new THREE.Skeleton(bones));
  const clothingGeometry = new THREE.BufferGeometry(), clothingMaterial = new THREE.MeshBasicMaterial();
  const clothing = new THREE.SkinnedMesh(clothingGeometry, clothingMaterial); clothing.visible = false; root.add(clothing);
  feet.get('l')!.position.y -= 0.04;
  feet.get('r')!.position.y += 0.16;
  root.updateMatrixWorld(true);
  return {
    root, bones, feet, base, clothing,
    controller: createFootContactController(root, base, clothing),
    dispose() { geometry.dispose(); material.dispose(); clothingGeometry.dispose(); clothingMaterial.dispose(); },
  };
}

function clip(name: string, targetBone: 'thigh_l' | 'calf_l', turn: number): THREE.AnimationClip {
  const a = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), turn);
  const b = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), turn + 0.22);
  return new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack(`${targetBone}.quaternion`, [0, 1], [...a.toArray(), ...b.toArray()]),
  ]);
}

const pose = (bones: readonly THREE.Bone[]) => bones.map(bone => [
  bone.position.toArray(), bone.quaternion.toArray(), bone.scale.toArray(),
]);

test('real AnimationMixer + SkinnedMesh rig restores exact cached pose before same-time resampling', () => {
  const rig = makeRig();
  const mixer = new THREE.AnimationMixer(rig.root);
  // Deliberately disjoint tracks: an action switch must let stop() restore
  // joints omitted from the next clip instead of reviving the old snapshot.
  const idle = mixer.clipAction(clip('idle', 'thigh_l', 0.1));
  const sit = mixer.clipAction(clip('sit', 'calf_l', -0.18));
  const actions = new Map([['idle', idle], ['sit', sit]]);
  const checkpoint = createAnimationPoseCheckpoint(rig.bones);
  let active: THREE.AnimationAction | null = null;
  const sample = (name: 'idle' | 'sit', time: number) => {
    const action = actions.get(name)!;
    if (action !== active) {
      checkpoint.restore();
      active?.stop();
      action.play(); active = action;
    } else checkpoint.restore();
    action.time = time;
    mixer.update(0);
    checkpoint.capture(); // raw clip result, before any later foot IK mutation
  };

  try {
    sample('idle', 0.4);
    const rootBefore = rig.root.position.toArray();
    const idlePose = pose(rig.bones);
    const before = rig.controller.sample();
    assert.ok(before.find(contact => contact.side === 'left')!.y < 0);
    assert.ok(before.find(contact => contact.side === 'right')!.y > 0.14);
    rig.controller.solve(() => 0.016);
    assert.notDeepEqual(pose(rig.bones), idlePose, 'production IK mutates the live rig after sampling');

    sample('idle', 0.4); // same clip, same exact time: mixer binding would otherwise skip its write
    assert.deepEqual(pose(rig.bones), idlePose, 'checkpoint restores the exact sampled pose before a cached no-op');
    assert.deepEqual(rig.root.position.toArray(), rootBefore);
    const resetContacts = rig.controller.sample();
    assert.ok(Math.abs(resetContacts.find(contact => contact.side === 'left')!.y - before.find(contact => contact.side === 'left')!.y) < 1e-6);

    rig.controller.solve(() => 0.016);
    sample('idle', 0.72);
    const laterIdle = pose(rig.bones);
    assert.notDeepEqual(laterIdle, idlePose, 'sampling a different active-clip time still updates animation');
    rig.controller.solve(() => 0.016);
    sample('sit', 0.4);
    const seatedTransition = pose(rig.bones);
    assert.notDeepEqual(seatedTransition, laterIdle, 'switching to a different clip still updates tracked joints');
    assert.deepEqual(rig.bones.find(bone => bone.name === 'thigh_l')!.quaternion.toArray(), new THREE.Quaternion().toArray(),
      'switching to a clip without a thigh track preserves stop() restoring that omitted joint');

    // Contact fitting is gated during seating by the host, but switching back
    // to a standing sample after that transition must not retain old IK.
    sample('idle', 0.4);
    assert.deepEqual(pose(rig.bones), idlePose, 'clip change back to a previously sampled time is stable');
    assert.deepEqual(rig.bones.find(bone => bone.name === 'calf_l')!.quaternion.toArray(), new THREE.Quaternion().toArray(),
      'switching back also resets the previous sit-only calf track');
  } finally {
    mixer.stopAllAction();
    rig.dispose();
  }
});
