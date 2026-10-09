import type { Bone } from 'three';

/**
 * Keeps the last raw AnimationMixer pose so external procedural edits (such as
 * foot IK) can be removed before the mixer samples the clip again. Three's
 * PropertyMixer may skip a write when the newly sampled value equals its
 * cached value, even though an external solver changed the live bone.
 */
export function createAnimationPoseCheckpoint(bones: readonly Bone[]) {
  const saved = bones.map(bone => ({
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));
  let captured = false;

  return {
    restore(): void {
      if (!captured) return;
      for (let index = 0; index < bones.length; index++) {
        const bone = bones[index]!;
        const pose = saved[index]!;
        bone.position.copy(pose.position);
        bone.quaternion.copy(pose.quaternion);
        bone.scale.copy(pose.scale);
      }
    },
    capture(): void {
      for (let index = 0; index < bones.length; index++) {
        const bone = bones[index]!;
        const pose = saved[index]!;
        pose.position.copy(bone.position);
        pose.quaternion.copy(bone.quaternion);
        pose.scale.copy(bone.scale);
      }
      captured = true;
    },
  };
}
