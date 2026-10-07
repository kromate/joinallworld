import { loadCityContent as preloadCityContent } from '../game/cities/registry.ts';
await preloadCityContent('lagos');
// Personal space and gaze: the pure rules (src/scene/space.ts), the head turn (avatar-rig.ts) and what a built scene does with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FIGURE_GAP, COMFORT_GAP, gapFor, tieOf, crowded, newGaze, stepGaze, watch, gazing, bearing, GAZE_RANGE, GAZE_REARM } from './space.ts';
import { lookAvatar } from './avatar-rig.ts';
import { createKit } from './kit.ts';
import { SCENES, MAX_CROWD } from './venue-scenes.ts';
import { loadAllCityScenes } from './city-scenes.ts';
import type { SceneVenue, SceneOptions } from './types.ts';
await loadAllCityScenes();

test('friends and a group stand closer than strangers, and nobody closer than a body', () => {
  assert.ok(COMFORT_GAP.friend < COMFORT_GAP.stranger && COMFORT_GAP.group < COMFORT_GAP.stranger);
  for (const tie of ['friend', 'group', 'stranger'] as const) assert.ok(gapFor(tie) >= FIGURE_GAP, tie);
  assert.equal(tieOf({ spot: 'bar' }, { spot: 'bar' }), 'group');
  assert.equal(tieOf({ friend: true }, { friend: true }), 'friend');
  assert.equal(tieOf({ friend: true }, {}), 'stranger');
  assert.equal(tieOf({ spot: null }, { spot: null }), 'stranger', 'two people with no spot are not a group');
  assert.deepEqual(crowded([{ x: 0, z: 0 }, { x: 0.5, z: 0 }, { x: 5, z: 5 }]).length, 1);
  assert.equal(crowded([{ x: 0, z: 0 }, { x: FIGURE_GAP, z: 0 }]).length, 0);
});

test('someone is noticed only when close enough', () => {
  const g = newGaze(), me = { x: 0, z: 0 }, you = { x: 0, z: 3 };
  assert.equal(gazing(g), false);
  assert.equal(watch(g, me, 0, { x: 0, z: GAZE_RANGE + 1 }), false, 'too far to notice');
  assert.equal(watch(g, me, 0, you), true, 'close and in front: worth a frame');
});

test('someone behind a person is not noticed', () => {
  const g = newGaze();
  assert.equal(watch(g, { x: 0, z: 0 }, Math.PI, { x: 0, z: 3 }), false, 'directly behind');
  assert.equal(watch(g, { x: 0, z: 0 }, 0, { x: 3, z: 0 }), true, 'off to the side is in the field');
});

test('the glance turns towards the other person, is held for about a second by a stranger and longer by a friend, then returns', () => {
  const run = (tie: 'stranger' | 'friend') => {
    const g = newGaze(), me = { x: 0, z: 0 }, you = { x: 2, z: 2 };
    let peak = 0, time = 0, held = 0;
    for (; time < 12; time += 1 / 30) {
      stepGaze(g, 1 / 30, me, 0, you, tie);
      peak = Math.max(peak, Math.abs(g.offset));
      if (g.phase === 'look') held = time;
      if (!gazing(g)) break;
    }
    return { g, peak, time, held };
  };
  const stranger = run('stranger'), friend = run('friend');
  const toward = bearing({ x: 0, z: 0 }, 0, { x: 2, z: 2 });
  assert.ok(stranger.peak > 0.2 && stranger.peak < toward, `a stranger turns part of the way (${stranger.peak.toFixed(2)} of ${toward.toFixed(2)})`);
  assert.ok(Math.abs(friend.peak - toward) < 0.02, `a friend turns all of the way (${friend.peak.toFixed(2)})`);
  assert.ok(stranger.held >= 0.8 && stranger.held < 1.3, `a stranger looks for about a second (${stranger.held.toFixed(2)})`);
  assert.ok(friend.held > stranger.held * 2, 'a friend holds it longer');
  for (const r of [stranger, friend]) { assert.equal(r.g.offset, 0); assert.equal(gazing(r.g), false); assert.ok(r.time < 12, 'it ends'); }
});

test('it happens once per approach: the person is armed again only after the other has gone away', () => {
  const g = newGaze(), me = { x: 0, z: 0 }, near = { x: 0, z: 3 };
  for (let i = 0; i < 400; i++) stepGaze(g, 1 / 30, me, 0, near, 'stranger');
  assert.equal(gazing(g), false);
  assert.equal(watch(g, me, 0, near), false, 'still standing there: no second glance');
  assert.equal(watch(g, me, 0, { x: 0, z: GAZE_REARM + 1 }), false);
  assert.equal(watch(g, me, 0, near), true, 'went away and came back: they look again');
});

test('lookAvatar turns the head and a little of the torso of a rigged figure, and says no to a plain one', () => {
  const figure = { userData: { parts: { head: { rotation: { y: 0 } }, torso: { rotation: { x: 0.1, y: 0 } } } } };
  assert.equal(lookAvatar(figure, 1), true);
  const { head, torso } = figure.userData.parts;
  assert.ok(head.rotation.y > torso.rotation.y && torso.rotation.y > 0, 'the head turns more than the torso');
  assert.equal(torso.rotation.x, 0.1, 'it leaves the lean alone');
  lookAvatar(figure, 9);
  assert.ok(head.rotation.y <= 0.95 && torso.rotation.y <= 0.5, 'a head does not turn right round');
  lookAvatar(figure, 0);
  assert.deepEqual([head.rotation.y, torso.rotation.y], [0, 0]);
  assert.equal(lookAvatar({ userData: {} }, 1), false);
  assert.equal(lookAvatar(null, 1), false);
});

const venueOf = (kind: string, scene: Partial<SceneOptions> = {}): SceneVenue => ({ id: kind, label: kind, scene: { kind, ...scene } });
const KINDS = ['park', 'buka', 'hub', 'club', 'office', 'market', 'gym', 'mall', 'beach', 'hospital', 'salon', 'rooftop', 'police', 'worship', 'radio', 'polling', 'viewing', 'shrine', 'walk', 'statehouse', 'airport', 'refinery', 'quad', 'hilltop', 'lakeside', 'library', 'mosque', 'generic'];

test('in every scene a full crowd stands on free floor with no two bodies overlapping', () => {
  const kit = createKit(), bad: string[] = [];
  for (const kind of KINDS) {
    const entry = SCENES[kind]!(kit, venueOf(kind));
    new THREE.Scene().add(entry.group);
    const crowd = Array.from({ length: MAX_CROWD }, (_, i) => (i % 3 === 2 ? { id: `n${i}`, name: `N${i}`, kind: 'npc', spot: i % 2 ? 'counter' : 'table' } : { id: `p${i}`, name: `P${i}`, kind: 'player', friend: i % 4 === 0 }));
    entry.setCrowd(crowd);
    const people = entry.walk!.people().filter((person) => person.top < 5);
    assert.equal(people.length, MAX_CROWD, kind);
    const close = crowded(people, FIGURE_GAP - 0.05);
    if (close.length) bad.push(`${kind}: ${close.map(([a, b]) => `${a.id}/${b.id} ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(2)}`).join(', ')}`);
    entry.dispose?.();
  }
  assert.deepEqual(bad, []);
});

test('a player standing still glances at someone who walks up, looks away, and the scene is idle again', () => {
  const kit = createKit(), entry = SCENES.park!(kit, venueOf('park'));
  const parent = new THREE.Scene(); parent.add(entry.group);
  const walk = entry.walk!;
  walk.drive(true);
  entry.setCrowd([{ id: 'a', name: 'A', kind: 'player', x: 0, z: 0, ry: 0 }]);
  const peer = () => entry.group.children.find((child) => child.name === 'peer')!;
  assert.equal(entry.easing, false, 'nothing is moving');
  walk.move(0, 0, 12, 0);
  assert.equal(entry.easing, false, 'far away: no frame is asked for');
  walk.move(2.5, 0, 2, Math.PI);
  assert.equal(entry.easing, true, 'someone came close: a frame is asked for');
  let seen = 0, frames = 0;
  while (entry.stepCrowd(1 / 30) && frames++ < 600) seen = Math.max(seen, Math.abs(peer().rotation.y));
  assert.ok(seen > 0.1, `the peer turned (${seen.toFixed(2)})`);
  assert.ok(frames > 5 && frames < 600, 'it ended');
  assert.equal(peer().rotation.y, 0, 'back where they were facing');
  assert.equal(entry.easing, false);
  walk.move(2.6, 0, 2.1, Math.PI);
  assert.equal(entry.easing, false, 'standing there, they do not look again');
  entry.dispose?.();
});
