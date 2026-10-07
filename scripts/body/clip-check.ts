// node --experimental-strip-types scripts/body/clip-check.ts [--raw /tmp/aw-assets]
// Where the authored clips (scripts/body/author-clips.ts) put the joints that read a pose at a glance, at the start,
// middle and end of each clip, in metres in the game's axes: x the body's left, y up, z the way it faced.
// A sanity check for keyframes nobody can look at without a renderer: lying should have the head near y ≈ 0.2 at
// z < 0 and the toes at z > 0; washing should have both hands in front (z > 0) at chest height.
import { join, resolve } from 'node:path';
import { authoredClips, joints, rigOf } from './author-clips.ts';
import type { Pose, Quat, Vec } from './author-clips.ts';
import { KEPT_BONES } from './build-body.ts';
import { loadGltf } from './gltf-io.ts';

const args = process.argv.slice(2), at = args.indexOf('--raw');
const raw = resolve(at >= 0 && args[at + 1] ? args[at + 1]! : '/tmp/aw-assets');
const doc = loadGltf(join(raw, 'ual', 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb'));
const rig = rigOf(doc, KEPT_BONES);
const SHOW = ['pelvis', 'Head', 'hand_l', 'hand_r', 'calf_l', 'ball_l', 'ball_r'];
// Root frame (+Z up, facing −Y, left +X) → game (y up, facing +z).
const game = (v: Vec) => [v[0], v[2], -v[1]].map((n) => n.toFixed(2).padStart(5)).join(' ');

for (const clip of authoredClips(doc, KEPT_BONES)) {
  const end = clip.tracks[0]!.times[clip.tracks[0]!.times.length - 1]!;
  for (const t of [0, end / 2, end * 0.75, end]) {
    const pose: Pose = { rot: new Map(rig.rest.rot), pelvis: [...rig.rest.pelvis] };
    for (const track of clip.tracks) {
      const k = Math.max(track.times.findIndex((time) => time >= t - 1e-6), 0);
      if (track.path === 'rotation') pose.rot.set(track.bone, Array.from(track.values.subarray(k * 4, k * 4 + 4)) as Quat);
      else pose.pelvis = Array.from(track.values.subarray(k * 3, k * 3 + 3)) as Vec;
    }
    const where = joints(rig, pose);
    console.log(`${clip.name.padEnd(12)} t=${t.toFixed(2)}  ${SHOW.map((bone) => `${bone} ${game(where.get(bone)!)}`).join(' | ')}`);
  }
}
