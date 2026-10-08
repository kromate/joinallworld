// The clips no CC0 pack has, authored here as keyframes on the body's 23 bones (scripts/body/build-body.ts adds them
// to clip-pack.glb). Each is built from poses of the UAL1 source (its rest pose and frames of its own clips) with
// rotation offsets on top, so the result is the same rig, the same proportions and the same CC0 licence.
//
//   door         reach and push a door (Interact), then step through into the walk (Walk_Loop), once
//   lie-down     on the mattress: crouch (Crouch_Idle_Loop), sit with the legs out, lie back, once; get-up is it backwards
//   sleep        lying on the back, slow breathing, loop
//   bathe-sit    sitting low in a tub (Sitting_Idle_Loop), legs out, washing, loop
//   bathe-stand  standing at a bucket or a shower (Idle_Loop), bent a little, washing, a hand over the head, loop
//   stairs-up    the walk with higher knees and a forward lean, loop (the walk's own length, so stride phase lines up)
//   stairs-down  the walk with deeper knees, lower hips and a backward lean, loop
//
// THE RIG (UAL1, Unreal axes under the −90° X root): in the root's frame +Z is up, the body faces −Y, its left is +X.
// Offsets are given in those axes about each bone's own joint (turn()); `pitch(d)` turns about X so that a limb
// hanging down swings forward by d degrees (one pointing up tips back, one pointing forward lifts). Lying keeps the
// head behind where the body faced: the root goes on the mattress at the bed's middle, facing its foot end
// (src/scene/body/skinned.ts lieOn). scripts/body/clip-check.ts prints where the joints land.
import type { Loaded } from './gltf-io.ts';
import { readAccessor } from './gltf-io.ts';

export interface AuthoredTrack { bone: string; path: 'rotation' | 'translation'; times: Float32Array; values: Float32Array }
export interface AuthoredClip { name: string; tracks: AuthoredTrack[] }

// ---- quaternions ([x, y, z, w]) and vectors -----------------------------------------------------------
export type Quat = [number, number, number, number];
export type Vec = [number, number, number];
const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const norm = (q: Quat): Quat => { const l = Math.hypot(...q) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const axisAngle = (axis: Vec, degrees: number): Quat => {
  const half = (degrees * Math.PI) / 360, s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
};
function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const c: Quat = d < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  d = Math.abs(d);
  if (d > 0.9995) return norm([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t, a[3] + (c[3] - a[3]) * t]);
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + c[0] * wb, a[1] * wa + c[1] * wb, a[2] * wa + c[2] * wb, a[3] * wa + c[3] * wb];
}
const rotate = (q: Quat, v: Vec): Vec => { const r = mul(mul(q, [v[0], v[1], v[2], 0]), conj(q)); return [r[0], r[1], r[2]]; };
const lerp3 = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ease = (t: number) => t * t * (3 - 2 * t);
/** Swing a hanging limb forward by `degrees` (a limb pointing up tips back). */
const pitch = (degrees: number) => axisAngle([1, 0, 0], -degrees);
/** Swing a hanging limb out to the body's left by `degrees`. */
const roll = (degrees: number) => axisAngle([0, 1, 0], -degrees);
/** Turn about the up axis, to the body's left by `degrees`. */
const yaw = (degrees: number) => axisAngle([0, 0, 1], degrees);

// ---- poses ----------------------------------------------------------------------------------------------
/** Every kept bone's local rotation, and the pelvis's local translation. */
export interface Pose { rot: Map<string, Quat>; pelvis: Vec }
export interface Rig {
  bones: readonly string[];
  parent: Map<string, string | null>;
  rest: Pose;
  offsets: Map<string, Vec>;
  /** A source clip's pose at time t (seconds, clamped); bones it does not key stay at rest. */
  at(clip: string, t: number): Pose;
  length(clip: string): number;
}

export function rigOf(doc: Loaded, bones: readonly string[]): Rig {
  const json = doc.json, byName = new Map(json.nodes.map((node, index) => [node.name ?? '', index]));
  const up = new Map<number, number>();
  json.nodes.forEach((node, index) => node.children?.forEach((child) => up.set(child, index)));
  const kept = new Set(bones), parent = new Map<string, string | null>();
  for (const bone of bones) {
    let p = up.get(byName.get(bone)!);
    while (p !== undefined && !kept.has(json.nodes[p]!.name ?? '')) p = up.get(p);
    parent.set(bone, p === undefined ? null : json.nodes[p]!.name ?? null);
  }
  const rest: Pose = { rot: new Map(), pelvis: [0, 0, 0] }, offsets = new Map<string, Vec>();
  for (const bone of bones) {
    const node = json.nodes[byName.get(bone)!]!;
    rest.rot.set(bone, (node.rotation ?? [0, 0, 0, 1]) as Quat);
    offsets.set(bone, (node.translation ?? [0, 0, 0]) as Vec);
  }
  rest.pelvis = offsets.get('pelvis')!;
  type Track = { times: Float64Array; values: Float64Array; size: number };
  const cache = new Map<string, Map<string, Track>>();
  const tracksOf = (clip: string) => {
    let found = cache.get(clip);
    if (found) return found;
    const animation = json.animations?.find((a) => a.name === clip);
    if (!animation) throw new Error(`no ${clip} in the UAL source`);
    found = new Map();
    for (const channel of animation.channels) {
      const name = json.nodes[channel.target.node]!.name ?? '', path = channel.target.path;
      if (!kept.has(name) || name === 'root' || !(path === 'rotation' || (path === 'translation' && name === 'pelvis'))) continue;
      const sampler = animation.samplers[channel.sampler]!;
      found.set(`${name}:${path}`, { times: readAccessor(doc, sampler.input), values: readAccessor(doc, sampler.output), size: path === 'rotation' ? 4 : 3 });
    }
    cache.set(clip, found);
    return found;
  };
  const sample = ({ times, values, size }: Track, t: number): number[] => {
    const last = times.length - 1, pick = (i: number) => Array.from(values.subarray(i * size, i * size + size));
    if (t <= times[0]!) return pick(0);
    if (t >= times[last]!) return pick(last);
    let i = 0;
    while (times[i + 1]! < t) i++;
    const k = (t - times[i]!) / (times[i + 1]! - times[i]!);
    return size === 4 ? slerp(pick(i) as Quat, pick(i + 1) as Quat, k) : lerp3(pick(i) as Vec, pick(i + 1) as Vec, k);
  };
  return {
    bones, parent, rest, offsets,
    length: (clip) => Math.max(0, ...[...tracksOf(clip).values()].map((track) => track.times[track.times.length - 1]!)),
    at(clip, t) {
      const found = tracksOf(clip), pose: Pose = { rot: new Map(rest.rot), pelvis: [...rest.pelvis] };
      for (const bone of bones) { const track = found.get(`${bone}:rotation`); if (track) pose.rot.set(bone, norm(sample(track, t) as Quat)); }
      const move = found.get('pelvis:translation');
      if (move) pose.pelvis = sample(move, t) as Vec;
      return pose;
    },
  };
}

const copy = (pose: Pose): Pose => ({ rot: new Map(pose.rot), pelvis: [...pose.pelvis] });
const blend = (a: Pose, b: Pose, t: number): Pose => {
  const rot = new Map<string, Quat>();
  for (const [bone, q] of a.rot) rot.set(bone, slerp(q, b.rot.get(bone) ?? q, t));
  return { rot, pelvis: lerp3(a.pelvis, b.pelvis, t) };
};

/** Each bone's rotation in the root's frame (the root itself is the frame). */
function globals(rig: Rig, pose: Pose): Map<string, Quat> {
  const out = new Map<string, Quat>();
  for (const bone of rig.bones) {
    const p = rig.parent.get(bone), local = pose.rot.get(bone)!;
    out.set(bone, bone === 'root' ? [0, 0, 0, 1] : p && p !== 'root' ? mul(out.get(p)!, local) : local);
  }
  return out;
}
/** Joint positions in the root's frame (metres; +Z up, facing −Y, left +X). */
export function joints(rig: Rig, pose: Pose): Map<string, Vec> {
  const g = globals(rig, pose), out = new Map<string, Vec>();
  for (const bone of rig.bones) {
    const p = rig.parent.get(bone);
    if (bone === 'root' || !p) { out.set(bone, [0, 0, 0]); continue; }
    const local = bone === 'pelvis' ? pose.pelvis : rig.offsets.get(bone)!;
    const base = out.get(p)!, step = p === 'root' ? local : rotate(g.get(p)!, local);
    out.set(bone, [base[0] + step[0], base[1] + step[1], base[2] + step[2]]);
  }
  return out;
}
/** Turn a bone about its own joint by `offset` (root axes). Turn parents before their children. */
function turn(rig: Rig, pose: Pose, bone: string, offset: Quat) {
  const g = globals(rig, pose), p = rig.parent.get(bone);
  const parentGlobal: Quat = p && p !== 'root' ? g.get(p)! : [0, 0, 0, 1];
  pose.rot.set(bone, norm(mul(conj(parentGlobal), mul(offset, g.get(bone)!))));
}
/** Scale how far a bone has turned from its rest rotation (k > 1: further the same way; k < 1: back toward rest). */
function deepen(rig: Rig, pose: Pose, bone: string, k: number) {
  const rest = rig.rest.rot.get(bone)!;
  pose.rot.set(bone, norm(mul(rest, slerp([0, 0, 0, 1], mul(conj(rest), pose.rot.get(bone)!), k))));
}
/** Turn a bone (the shortest way) so its child's joint lies along `dir` (root axes) from its own. */
function aim(rig: Rig, pose: Pose, bone: string, child: string, dir: Vec) {
  const at = joints(rig, pose), from = at.get(bone)!, to = at.get(child)!;
  const v: Vec = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const lv = Math.hypot(...v), ld = Math.hypot(...dir);
  const a: Vec = [v[0] / lv, v[1] / lv, v[2] / lv], b: Vec = [dir[0] / ld, dir[1] / ld, dir[2] / ld];
  const cross: Vec = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  turn(rig, pose, bone, norm([cross[0], cross[1], cross[2], 1 + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]]));
}
/** Both legs at once: thigh → knee, calf → ankle and foot → toes along these (left side; the right is mirrored). */
function legs(rig: Rig, pose: Pose, thigh: Vec, calf: Vec, foot: Vec) {
  for (const [side, s] of [['l', 1], ['r', -1]] as const) {
    aim(rig, pose, `thigh_${side}`, `calf_${side}`, [thigh[0] * s, thigh[1], thigh[2]]);
    aim(rig, pose, `calf_${side}`, `foot_${side}`, [calf[0] * s, calf[1], calf[2]]);
    aim(rig, pose, `foot_${side}`, `ball_${side}`, [foot[0] * s, foot[1], foot[2]]);
  }
}

/** Offline two-bone solve in the canonical rig. Targets use game axes (x, up, forward); no solver ships at runtime. */
function reach(rig: Rig, pose: Pose, side: 'l' | 'r', target: Vec) {
  const at = joints(rig, pose), shoulder = at.get(`upperarm_${side}`)!, elbow = at.get(`lowerarm_${side}`)!, hand = at.get(`hand_${side}`)!;
  const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const goal: Vec = [target[0], -target[2], target[1]], delta = sub(goal, shoulder), distance = Math.hypot(...delta);
  const a = Math.hypot(...sub(elbow, shoulder)), b = Math.hypot(...sub(hand, elbow)), d = Math.min(distance, a + b - 1e-5);
  const dir: Vec = delta.map((v) => v / distance) as Vec, pole: Vec = [side === 'l' ? 1 : -1, 0, -0.25];
  const projection = dot(pole, dir), perpendicular: Vec = pole.map((v, i) => v - projection * dir[i]!) as Vec;
  const norm = Math.hypot(...perpendicular), along = (a * a - b * b + d * d) / (2 * d), height = Math.sqrt(Math.max(0, a * a - along * along));
  const bend: Vec = dir.map((v, i) => v * along + perpendicular[i]! / norm * height) as Vec;
  aim(rig, pose, `upperarm_${side}`, `lowerarm_${side}`, bend);
  const reached = joints(rig, pose).get(`lowerarm_${side}`)!;
  const end: Vec = dir.map((v, i) => shoulder[i]! + v * d - reached[i]!) as Vec;
  aim(rig, pose, `lowerarm_${side}`, `hand_${side}`, end);
}

/** Wrist trajectories in body metres, also read by contact probes and the original spoon/water props. */
export function objectHands(kind: 'cook' | 'cook-low' | 'bucket' | 'eat' | 'drink' | 'shower' | 'soak', seconds: number, head: Vec = [0, 1.5, 0.15]): { left: Vec; right: Vec } {
  const phase = seconds / 2 * Math.PI * 2;
  const raise = ease(Math.max(0, Math.sin(phase)));
  if (kind === 'eat') return { left: [0.12, 1.08, 0.26], right: lerp3([0.04, 1.15, 0.18], [head[0] - 0.10, head[1] - 0.05, head[2] + 0.075], raise) };
  if (kind === 'drink') return { left: [0.23, 1.04, 0.1], right: lerp3([-0.16, 1, 0.30], [head[0], head[1] - 0.04, head[2] + 0.10], raise) };
  if (kind === 'shower') return { left: [0.1, 1.18, 0.2], right: [-0.12, 1.2 + 0.35 * raise, 0.2 - 0.12 * raise] };
  if (kind === 'soak') return { left: [0.14, 0.84, 0.1 + 0.04 * Math.sin(phase)], right: [-0.14, 0.87, 0.1 - 0.04 * Math.sin(phase)] };
  if (kind !== 'bucket') { const y = kind === 'cook-low' ? 0.79 : 1.0; return { left: [0.08, y, 0.48], right: [-0.16 + 0.05 * Math.cos(phase), y + 0.14, 0.48 + 0.05 * Math.sin(phase)] }; }
  const up = ease(Math.max(0, Math.sin(phase)));
  return { left: [0.14, 0.65, 0.24], right: [-0.08, 0.37 + 0.25 * up, 0.52 - 0.3 * up] };
}

// ---- writing tracks -------------------------------------------------------------------------------------
const FPS = 20;
/** Sample `frame(t)` at 20 Hz over [0, length]: a rotation track for every bone and the pelvis translation. */
function bake(rig: Rig, name: string, length: number, frame: (t: number) => Pose): AuthoredClip {
  const count = Math.round(length * FPS) + 1;
  const times = Float32Array.from({ length: count }, (_, i) => (i * length) / (count - 1));
  const poses = Array.from(times, (t) => frame(t));
  const tracks: AuthoredTrack[] = [];
  for (const bone of rig.bones) {
    if (bone === 'root') continue;
    const values = new Float32Array(count * 4);
    let previous: Quat | null = null;
    poses.forEach((pose, i) => {
      let q = pose.rot.get(bone)!;
      // Neighbours on the same hemisphere, so LINEAR interpolation takes the short way round.
      if (previous && q[0] * previous[0] + q[1] * previous[1] + q[2] * previous[2] + q[3] * previous[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
      values.set(q, i * 4);
      previous = q;
    });
    tracks.push({ bone, path: 'rotation', times, values });
  }
  const pelvis = new Float32Array(count * 3);
  poses.forEach((pose, i) => pelvis.set(pose.pelvis, i * 3));
  tracks.push({ bone: 'pelvis', path: 'translation', times, values: pelvis });
  return { name, tracks };
}

// ---- the clips ------------------------------------------------------------------------------------------
/** The pelvis joint's height over the mattress when lying on the back (metres; the hips are about this deep behind it). */
export const LIE_HEIGHT = 0.12;

/** Lying on the back: head toward +Y (behind where the body faced), face up, arms by the sides, knees soft. */
export function lying(rig: Rig): Pose {
  const pose = copy(rig.at('Idle_Loop', 0));
  turn(rig, pose, 'pelvis', pitch(90));
  pose.pelvis = [0, 0, LIE_HEIGHT];
  // Legs out toward −Y with the knees a touch up, toes up and falling outward.
  legs(rig, pose, [0.07, -1, 0.1], [0.02, -1, -0.1], [0.3, -0.35, 0.88]);
  for (const [side, s] of [['l', 1], ['r', -1]] as const) {
    aim(rig, pose, `upperarm_${side}`, `lowerarm_${side}`, [0.22 * s, -1, -0.12]);
    aim(rig, pose, `lowerarm_${side}`, `hand_${side}`, [0.1 * s, -1, -0.05]);
  }
  turn(rig, pose, 'Head', pitch(-10));               // head propped on the pillow, chin a little in
  return pose;
}
/** Sitting on the mattress, knees up (`bent`) or the legs out in front, on the way down to lying. */
function floorSit(rig: Rig, bent: boolean): Pose {
  const pose = copy(rig.at('Idle_Loop', 0));
  pose.pelvis = [0, bent ? 0.05 : 0, LIE_HEIGHT];
  turn(rig, pose, 'pelvis', pitch(bent ? -8 : 12));
  if (bent) legs(rig, pose, [0.12, -0.7, 0.72], [0.02, -0.25, -0.97], [0.1, -1, -0.3]);
  else legs(rig, pose, [0.08, -1, 0.05], [0.02, -1, -0.08], [0.25, -0.4, 0.88]);
  return pose;
}

export function authoredClips(doc: Loaded, bones: readonly string[], canonicalBody?: Loaded, suffix = ''): AuthoredClip[] {
  const rig = rigOf(doc, bones), clips: AuthoredClip[] = [];
  const workRig = rigOf(doc, bones);
  if (canonicalBody) for (const node of canonicalBody.json.nodes) {
    if (node.name && node.translation && workRig.offsets.has(node.name)) workRig.offsets.set(node.name, node.translation as Vec);
  }
  for (const kind of ['cook', 'cook-low', 'bucket', 'eat', 'drink', 'shower', 'soak'] as const) {
    const frame = (seconds: number) => {
      const pose = copy(workRig.at(kind === 'bucket' ? 'Crouch_Idle_Loop' : kind === 'soak' ? 'Sitting_Idle_Loop' : 'Idle_Loop', 0));
      if (kind === 'soak') for (const side of ['l', 'r'] as const) deepen(workRig, pose, `calf_${side}`, 0.2);
      turn(workRig, pose, 'spine_01', pitch(kind === 'eat' || kind === 'drink' ? -15 : kind === 'shower' ? -6 : kind === 'soak' ? -8 : kind === 'cook-low' ? -50 : suffix ? -40 : -35));
      const p = joints(workRig, pose).get('Head')!, hands = objectHands(kind, seconds, [p[0], p[2], -p[1]]);
      reach(workRig, pose, 'l', hands.left); reach(workRig, pose, 'r', hands.right);
      return pose;
    };
    const name = kind === 'bucket' || kind === 'shower' || kind === 'soak' ? `${kind}-wash` : kind, idle = rig.at('Idle_Loop', 0), use = frame(0), duration = kind === 'soak' ? 1.4 : 0.8;
    clips.push(bake(rig, name + suffix, 2, frame));
    clips.push(bake(rig, `${name}-enter${suffix}`, duration, (t) => blend(idle, use, ease(t / duration))));
    clips.push(bake(rig, `${name}-exit${suffix}`, duration, (t) => blend(use, idle, ease(t / duration))));
  }
  {
    const idle = workRig.at('Idle_Loop', 0), walk = workRig.length('Walk_Loop');
    const grip = (u: number) => {
      const opening = u < 0.22 ? 0 : u < 0.5 ? ease((u - 0.22) / 0.28) : 1;
      const angle = -Math.PI / 2 * opening, pose = copy(idle);
      turn(workRig, pose, 'spine_01', pitch(-45));
      reach(workRig, pose, 'r', [-0.34 + 0.44 * Math.cos(angle), 0.92, 0.2 + 0.16 * opening]);
      return pose;
    };
    clips.push(bake(workRig, `home-door${suffix}`, 2.4, (t) => {
      const u = t / 2.4;
      if (u < 0.22) return blend(idle, grip(0.22), ease(u / 0.22));
      if (u < 0.65) return grip(u);
      const step = copy(workRig.at('Walk_Loop', (u - 0.65) / 0.35 * walk * 0.75));
      turn(workRig, step, 'spine_01', pitch(-45));
      return blend(grip(0.65), step, ease(Math.min(1, (u - 0.65) / 0.2)));
    }));
  }

  // door: Interact's reach-and-push (its first second, at 1.25× pace), then the stride through.
  {
    const push = 0.8, through = 1.0, walk = rig.length('Walk_Loop'), pushed = rig.at('Interact', 1.0);
    clips.push(bake(rig, 'door', push + through, (t) => {
      if (t <= push) return rig.at('Interact', (t / push) * 1.0);
      const u = (t - push) / through;
      return blend(pushed, rig.at('Walk_Loop', u * walk * 0.75), ease(Math.min(u / 0.5, 1)));
    }));
  }

  // lie-down: stand, crouch, sit back with the knees up, legs out, lie back; get-up is the same, backwards.
  const flat = lying(rig);
  {
    const keys = [rig.at('Idle_Loop', 0), rig.at('Crouch_Idle_Loop', 0), floorSit(rig, true), floorSit(rig, false), flat];
    const at = [0, 0.6, 1.1, 1.6, 2.2], end = at[at.length - 1]!;
    const down = (t: number): Pose => {
      let i = 0;
      while (i < at.length - 2 && t > at[i + 1]!) i++;
      return blend(keys[i]!, keys[i + 1]!, ease(Math.min(Math.max((t - at[i]!) / (at[i + 1]! - at[i]!), 0), 1)));
    };
    clips.push(bake(rig, 'lie-down', end, down));
    clips.push(bake(rig, 'get-up', end, (t) => down(end - t)));
  }

  // sleep: lying, a slow breath through the chest and a small roll of the head, 4 s.
  {
    const length = 4;
    clips.push(bake(rig, 'sleep', length, (t) => {
      const pose = copy(flat), phase = (t / length) * 2 * Math.PI;
      turn(rig, pose, 'spine_02', pitch(1.5 * Math.sin(phase)));
      turn(rig, pose, 'spine_03', pitch(1.5 * Math.sin(phase)));
      turn(rig, pose, 'Head', roll(3 * Math.sin(phase + 1)));
      return pose;
    }));
  }

  // Washing: both forearms come up in front of the chest and rub against each other.
  const wash = (pose: Pose, phase: number) => {
    const s = Math.sin(phase);
    turn(rig, pose, 'upperarm_l', mul(roll(-12), pitch(40 + 8 * s)));
    turn(rig, pose, 'upperarm_r', mul(roll(12), pitch(40 - 8 * s)));
    turn(rig, pose, 'lowerarm_l', mul(yaw(-35), pitch(55 + 10 * s)));
    turn(rig, pose, 'lowerarm_r', mul(yaw(35), pitch(55 - 10 * s)));
  };

  // bathe-sit: Sitting_Idle_Loop with the legs out along the tub floor and a slight forward lean, washing.
  {
    const source = rig.length('Sitting_Idle_Loop'), length = 2.4;
    clips.push(bake(rig, 'bathe-sit', length, (t) => {
      const pose = copy(rig.at('Sitting_Idle_Loop', (t / length) * source));
      for (const side of ['l', 'r'] as const) deepen(rig, pose, `calf_${side}`, 0.2);
      turn(rig, pose, 'spine_01', pitch(-8));
      wash(pose, (t / length) * 4 * Math.PI);
      return pose;
    }));
  }

  // bathe-stand: Idle_Loop bent a little over the bucket, washing; mid-loop the right hand goes over the head.
  {
    const source = rig.length('Idle_Loop'), length = 3.2;
    clips.push(bake(rig, 'bathe-stand', length, (t) => {
      const u = t / length, pose = copy(rig.at('Idle_Loop', u * source));
      turn(rig, pose, 'spine_01', pitch(-10));
      wash(pose, u * 6 * Math.PI);
      const up = Math.max(0, Math.sin(u * 2 * Math.PI - Math.PI));
      if (up > 0) { turn(rig, pose, 'upperarm_r', pitch(80 * up)); turn(rig, pose, 'lowerarm_r', pitch(30 * up)); }
      return pose;
    }));
  }

  // stairs: the walk at its own length, the swing leg's hip and knee bent further.
  {
    const walk = rig.length('Walk_Loop');
    clips.push(bake(rig, 'stairs-up', walk, (t) => {
      const pose = copy(rig.at('Walk_Loop', t));
      for (const side of ['l', 'r'] as const) { deepen(rig, pose, `thigh_${side}`, 1.6); deepen(rig, pose, `calf_${side}`, 1.5); }
      turn(rig, pose, 'spine_01', pitch(-10));
      return pose;
    }));
    clips.push(bake(rig, 'stairs-down', walk, (t) => {
      const pose = copy(rig.at('Walk_Loop', t));
      for (const side of ['l', 'r'] as const) deepen(rig, pose, `calf_${side}`, 1.4);
      turn(rig, pose, 'spine_01', pitch(5));
      pose.pelvis = [pose.pelvis[0], pose.pelvis[1], pose.pelvis[2] - 0.04];
      return pose;
    }));
  }
  return clips;
}
