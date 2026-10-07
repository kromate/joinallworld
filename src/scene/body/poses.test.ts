import { loadCityContent as preloadCityContent } from '../../game/cities/registry.ts';
await preloadCityContent('lagos');
// The body's poses (poses.ts) against the shipped clip pack, and the home room's activities against the poses: every
// pose and transition has a clip, sleeping lies down with the head on the pillow, a soak sits in the tub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_MANIFEST } from './manifest.ts';
import { DOOR, INTO, OUT, SEATED, STAIRS, STILL } from './poses.ts';
import type { BodyPose } from './poses.ts';
import { REST_KIND, REST_POSE, seatOf } from '../home-scene.ts';
import { FURNITURE, HOME_ACTIVITIES } from '../../game/content/furniture.ts';

const names = new Set<string>(BODY_MANIFEST.clips.names);
const POSES: BodyPose[] = ['idle', 'walk', 'jog', 'sit', 'interact', 'dance', 'lie', 'soak', 'wash'];

test('every pose has a still frame in a shipped clip', () => {
  for (const pose of POSES) {
    assert.ok(names.has(STILL[pose].clip), `${pose} → ${STILL[pose].clip}`);
    assert.ok(STILL[pose].at >= 0 && STILL[pose].at < 1, `${pose}: a share of its clip`);
  }
});

test('every transition, the door and the stairs are shipped clips', () => {
  for (const clip of [...Object.values(INTO), ...Object.values(OUT), DOOR, STAIRS.up, STAIRS.down]) assert.ok(names.has(clip!), clip);
  for (const pose of Object.keys(OUT) as BodyPose[]) assert.ok(INTO[pose], `${pose}: a way in to match the way out`);
  for (const clip of Object.values(OUT)) assert.ok(SEATED.has(clip!), `${clip} keeps the seated placement until it ends`);
});

test('the home activities pick their pose: sleep and nap lie, a soak sits in the tub, a bath washes, sitting sits', () => {
  const poseOf = (id: string) => { const kind = REST_KIND.get(id); return kind ? REST_POSE[kind] : undefined; };
  assert.equal(poseOf('home-sleep'), 'lie');
  assert.equal(poseOf('home-stay-in-bed'), 'lie');
  assert.equal(poseOf('nap'), 'lie');
  assert.equal(poseOf('home-long-soak'), 'soak');
  assert.equal(poseOf('bath'), 'wash');
  assert.equal(poseOf('home-sit-down'), 'sit');
  for (const activity of HOME_ACTIVITIES) assert.equal(REST_KIND.get(`home-${activity.id}`), activity.needs, activity.id);
  for (const pose of Object.values(REST_POSE)) assert.ok(pose && SEATED.has(pose) || pose === 'wash', `${pose} is placed on its piece`);
});

test('lying, the head (0.64 tiles behind the hips) is on the pillow and the body on the bed or mat', () => {
  const pillow: Record<string, number> = { bed: 0.38, mat: 0.36 };
  for (const def of Object.values(FURNITURE).filter((item) => item.kind === 'bed')) {
    const seat = seatOf(def.shape, def.w, def.h);
    assert.ok(Math.abs(seat.z - 0.64 - -def.h * pillow[def.shape]!) < 1e-9, `${def.id}: head on the pillow`);
    assert.ok(seat.z > -def.h / 2 && seat.z < def.h / 2, `${def.id}: hips on the piece`);
    assert.equal(seat.xs.length, def.shape === 'bed' ? def.w : 1, `${def.id}: a place per pillow`);
    for (const x of seat.xs) assert.ok(Math.abs(x) < def.w / 2, `${def.id}: across the piece`);
  }
});

test('soaking, the bather sits in the water facing the tap', () => {
  const tub = Object.values(FURNITURE).find((item) => item.shape === 'tub')!;
  const seat = seatOf('tub', tub.w, tub.h);
  assert.equal(seat.turn, -Math.PI / 2);
  for (const x of seat.xs) assert.ok(Math.abs(x) < tub.w * 0.39, 'inside the tub');
  assert.ok(seat.top < 0.52, 'below the water line');
});
