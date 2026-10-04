// Keeping the avatar in sight, walking round people, stepping up where the steps are, and the
// feature-detected avatar rig: the pure parts, without a renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKit } from './kit.ts';
import { createBatch } from './build.ts';
import { createOccluders, resolve, CAMERA_GAP, PULL_FROM_ZOOM } from './camera-collision.ts';
import { createOrbit } from './camera-controls.ts';
import { createWalkGrid, createWalker, footprintRecorder, AVATAR_RADIUS, WALL_REACH } from './movement.ts';
import { SCENES, MAX_CROWD, SPOT_BEHIND, SPOT_FRONT, SPOT_SIDE, buildVenueScene } from './venue-scenes.ts';
import { pickDetail, rigOf, PLAYER_DETAIL } from './avatar-rig.ts';
import { DETAILS } from './characters.ts';
import { room, leafTree } from './props.ts';

test('the sweep finds the first box between the head and the camera, ignores what the head is inside, and resolve() pulls in or ghosts', () => {
  const occluders = createOccluders();
  // A tree crown 4 units behind the avatar, at head height and above; a low crate; a box around the avatar's own seat.
  occluders.setStatic([[3, 1.2, -1, 5, 4, 1], [1, 0, -0.4, 1.6, 0.5, 0.4], [-0.5, 0, -0.5, 0.5, 2, 0.5]]);
  assert.equal(occluders.count, 3);
  const clear = occluders.sweep(0, 1.5, 0, 0, 6, 8);
  assert.equal(clear, Infinity, 'nothing between the head and a camera in front');
  const hit = occluders.sweep(0, 1.5, 0, 8, 3, 0);
  assert.ok(Math.abs(hit - Math.hypot(2.92, 2.92 * (1.5 / 8))) < 0.05, `the crown is met ${hit.toFixed(2)} from the head (its near face, less the skin)`);
  assert.equal(occluders.sweep(0, 1.5, 0, 8, 1.5, 0.9) < 4, true);
  assert.equal(occluders.sweep(0, 1.5, 0, 8, 1.5, 3), Infinity, 'a line that passes beside the crown is clear');
  assert.equal(occluders.sweep(0, 1.5, 0, 0, 1.5, 0), Infinity, 'no length, no hit');
  // People are boxes too, re-read without allocating once the list has its size.
  occluders.setPeople([{ x: 0, z: 3, top: 2.4 }]);
  assert.ok(Math.abs(occluders.sweep(0, 1.5, 0, 0, 1.5, 6) - 2.62) < 0.05, 'somebody standing in the line is met at their near side');
  occluders.setPeople([]);
  assert.equal(occluders.sweep(0, 1.5, 0, 0, 1.5, 6), Infinity);

  // resolve(): zoomed in with room to spare → pull in to just in front of it, no ghost.
  const near = 2.6;
  assert.deepEqual(resolve(5, 8, 3, near), { cap: 5 - CAMERA_GAP, ghost: false });
  // Nothing in the way (the hit is beyond the camera): leave the camera alone.
  assert.deepEqual(resolve(9, 8, 3, near), { cap: Infinity, ghost: false });
  assert.deepEqual(resolve(Infinity, 8, 3, near), { cap: Infinity, ghost: false });
  // Too close behind the shoulder to stop in front of: the thing is ghosted instead.
  assert.deepEqual(resolve(1.4, 8, 3, near), { cap: Infinity, ghost: true });
  // The composed wide view never pulls the camera; the ghost alone keeps the avatar in sight.
  assert.deepEqual(resolve(12, 35, 1, near), { cap: Infinity, ghost: true });
  assert.ok(PULL_FROM_ZOOM > 1);
});

test('the orbit holds the camera in quickly, lets it out slowly, ignores a wobble and always comes to rest', () => {
  const orbit = createOrbit();
  orbit.setBase([15, 19.8, 25.4]); orbit.setLimits({ near: 6.2 });
  orbit.zoomBy(3); orbit.snap();
  const asked = orbit.distance;
  assert.equal(orbit.asked, asked);
  orbit.cap(asked * 0.5);
  let frames = 0;
  while (orbit.step(0.016) && frames < 500) frames += 1;
  assert.ok(frames > 3 && frames < 60, `held in over ${frames} frames, not at once and not for long`);
  assert.ok(Math.abs(orbit.distance - asked * 0.5) < 0.01); assert.equal(orbit.asked, asked, 'what the player asked for is unchanged');
  assert.equal(orbit.settled, true);
  // A hit that wobbles by a few centimetres does not move the camera.
  orbit.cap(asked * 0.505);
  assert.equal(orbit.step(0.016), false, 'no jitter');
  // Released: out again, more slowly than it came in, and then at rest.
  orbit.cap(Infinity);
  let out = 0;
  while (orbit.step(0.016) && out < 1000) out += 1;
  assert.ok(out > frames && out < 400, `let out over ${out} frames`);
  assert.equal(orbit.distance, asked); assert.equal(orbit.settled, true);
  // A cap farther than the camera is no cap.
  orbit.cap(asked * 3); assert.equal(orbit.step(0.016), false);
  // Free orbit: many turns one way, and recentre goes back the short way.
  orbit.rotate(Math.PI * 6.2, 0); orbit.snap();
  orbit.reset();
  assert.ok(Math.abs(orbit.goal.yaw - orbit.now.yaw) < Math.PI + 1e-9, 'recentre never spins the camera through whole turns');
  assert.equal(orbit.limits.azimuth, null, 'no azimuth limit: every scene may be orbited all the way round');
});

test('the recorder gives camera solids with heights, and bakes a room’s walls — with what is on them — as parts', () => {
  const recorder = footprintRecorder(createBatch(THREE));
  const b = recorder.batch;
  room(b, { w: 24, d: 20 });
  b.box(0, 3, -9.9, 4, 2, 0.1, '#fff');                       // a board on the back wall
  b.cyl(-3.4, 2.7, -9.66, 0.5, 0.02, '#c00', { rx: Math.PI / 2 }); // a ring laid flat against it
  b.box(-11.8, 2, 3, 0.1, 1.5, 2, '#fff');                    // a window on the left wall
  b.box(0, 0.7, 0, 2, 1.4, 2, '#964');                        // a counter in the middle of the room
  leafTree(b, 6, 4);
  b.box(3, 0.1, 3, 2, 0.2, 2, '#444');                        // a low platform: walked over, hides nothing
  const shapes = recorder.shapes();
  assert.deepEqual(shapes.walls, { backZ: -10, leftX: -12 });
  const built = b.build({ solid: new THREE.MeshLambertMaterial(), glow: new THREE.MeshBasicMaterial(), glass: new THREE.MeshStandardMaterial() });
  const names = built.meshes.map((mesh) => mesh.name).sort();
  assert.deepEqual(names, ['solid', 'solid@wallBack', 'solid@wallLeft']);
  assert.equal(built.meshes.find((mesh) => mesh.name === 'solid@wallBack')!.userData.part, 'wallBack');
  const triangles = (name: string) => built.meshes.find((mesh) => mesh.name === name)!.geometry.index!.count / 3;
  assert.equal(triangles('solid@wallBack'), 12 * 4 + 16 + 16, 'the back wall, its skirting and coping, the board and the ring (a 8-sided tube with caps)');
  assert.equal(triangles('solid@wallLeft'), 12 * 4, 'the left wall, its skirting and coping, and the window');
  assert.ok(shapes.solids.every((box) => box.length === 6 && box[4] > 0.9 && box[4] - box[1] > 0.4), 'solids are tall things, with their heights');
  assert.ok(shapes.solids.some((box) => box[0] === -1 && box[3] === 1 && box[4] === 1.4), 'the counter is a solid');
  assert.ok(shapes.solids.some((box) => box[1] > 1.5 && box[0] < 6 && box[3] > 6), 'the tree’s crown is a solid, up where it is');
  assert.ok(!shapes.solids.some((box) => box[2] < -9.5 || box[0] < -11.5), 'the walls and what is on them are not: a hidden wall hides nothing');
  assert.ok(!shapes.solids.some((box) => box[4] <= 0.9), 'the low platform is not');
  assert.ok(WALL_REACH > 0.4 && WALL_REACH < 1.2);
  for (const mesh of built.meshes) mesh.geometry.dispose();
});

test('walking round people: a figure in the way is passed on one side, walking at one goes nowhere, and a crowd can never trap the avatar', () => {
  const grid = createWalkGrid({ bounds: [-8, -8, 8, 8] });
  const walker = createWalker();
  walker.setGrid(grid);
  const run = (seconds: number, yaw = 0) => { let closest = Infinity; for (let i = 0; i < seconds * 60; i++) { walker.step(1 / 60, yaw); for (const other of walker.others || []) closest = Math.min(closest, Math.hypot(walker.x - other.x, walker.z - other.z)); if (!walker.moving) break; } return closest; };
  // A path straight through someone: the avatar arrives, having kept its distance.
  walker.place(-5, 0); walker.others = [{ x: 0, z: 0 }];
  let arrived = 0;
  assert.equal(walker.goTo(5, 0, { arrive: () => { arrived += 1; } }), true);
  const closest = run(10);
  assert.equal(arrived, 1); assert.ok(Math.hypot(walker.x - 5, walker.z) < 0.01, 'it gets there');
  assert.ok(closest > AVATAR_RADIUS * 2 - 0.12, `it walked round, never closer than ${closest.toFixed(2)} (two radii are ${(AVATAR_RADIUS * 2).toFixed(2)})`);
  assert.equal(walker.passing, false);
  // Without anyone in the way the same walk is a straight line.
  walker.place(-5, 0); walker.others = [];
  walker.goTo(5, 0); let wander = 0; for (let i = 0; i < 600 && walker.moving; i++) { walker.step(1 / 60); wander = Math.max(wander, Math.abs(walker.z)); }
  assert.equal(wander, 0);
  // Keys: holding "forward" into someone stops short of them (a soft block)…
  walker.place(0, 3); walker.others = [{ x: 0, z: 0 }];
  walker.input(0, 1); // forward at yaw 0 is −z
  for (let i = 0; i < 20; i++) walker.step(1 / 60, 0);
  assert.ok(walker.z > AVATAR_RADIUS * 2 - 0.2 && walker.z < 3, `stopped ${walker.z.toFixed(2)} in front of them`);
  // …and boxed in by a ring of people, the avatar is let through after a moment rather than trapped.
  walker.input(0, 0); walker.step(1 / 60, 0);
  walker.place(0, 0);
  walker.others = Array.from({ length: 10 }, (_, i) => ({ x: Math.sin(i * Math.PI / 5) * 0.75, z: Math.cos(i * Math.PI / 5) * 0.75 }));
  walker.input(1, 0);
  for (let i = 0; i < 240; i++) walker.step(1 / 60, 0);
  assert.ok(walker.x > 2, `walked out of the ring to x = ${walker.x.toFixed(2)}`);
  walker.input(0, 0); walker.step(1 / 60, 0);
  // A path whose end is right beside someone still ends where it was sent.
  walker.place(-4, -4); walker.others = [{ x: 3, z: 3.2 }];
  walker.goTo(3, 3); run(10);
  assert.ok(Math.hypot(walker.x - 3, walker.z - 3) < 0.01, 'the destination is reached even with someone standing on it');
  // Reduced motion (snap) never deflects: it simply arrives.
  walker.place(-5, 0); walker.others = [{ x: 0, z: 0 }]; walker.goTo(5, 0); walker.finishNow();
  assert.deepEqual([walker.x, walker.z], [5, 0]);
});

test('a raised place is reached by its approach: along the floor to the foot of the steps, then up — and back down the same way', () => {
  // A stage (blocked) across the back of a room, with a rail post in front of its left half.
  const grid = createWalkGrid({ bounds: [-8, -8, 8, 8], block: [[-6, -8, 6, -4], [-4, -3.9, -1, -3.2]] });
  const walker = createWalker();
  walker.setGrid(grid);
  const trail = () => { const points: Array<[number, number, boolean]> = []; for (let i = 0; i < 2000 && walker.moving; i++) { walker.step(1 / 60); points.push([walker.x, walker.z, walker.hopping]); } return points; };
  // Without an approach the hop leaves the floor wherever the path ends nearest to the spot.
  walker.place(-2.5, 6);
  walker.goTo(-2.5, -6, { exact: true });
  const direct = trail();
  assert.ok(Math.hypot(walker.x + 2.5, walker.z + 6) < 0.01);
  // With one, the path ends at the approach point and the hop starts there.
  walker.place(-2.5, 6);
  let arrived = 0;
  walker.goTo(-2.5, -6, { via: { x: 2, z: -3.2 }, arrive: () => { arrived += 1; } });
  const routed = trail();
  assert.equal(arrived, 1); assert.ok(Math.hypot(walker.x + 2.5, walker.z + 6) < 0.01, 'on the spot');
  const leftFloor = routed.find(([x, z]) => !grid.free(x, z))!;
  assert.ok(routed.some(([x, z]) => Math.hypot(x - 2, z + 3.2) < 0.15), 'the path went to the approach point');
  assert.ok(Math.hypot(leftFloor[0] - 2, leftFloor[1] + 3.2) < 1 && leftFloor[0] > -1, `stepped up beside the approach point (${leftFloor[0].toFixed(1)}, ${leftFloor[1].toFixed(1)}), not through the rail`);
  assert.ok(direct.length !== routed.length);
  // A chain of steps (a stair top, a platform) is walked in order after the approach.
  walker.place(0, 6);
  walker.goTo(0, -7, { via: { x: 7, z: -3 }, steps: [{ x: 7, z: -6 }, { x: 4, z: -6 }] });
  const chain = trail();
  const near = (px: number, pz: number) => chain.some(([x, z]) => Math.hypot(x - px, z - pz) < 0.12);
  assert.ok(near(7, -3) && near(7, -6) && near(4, -6), 'every step of the way up was taken');
  assert.ok(Math.hypot(walker.x, walker.z + 7) < 0.01);
  // Coming down: the way back is given, and the walk continues over the floor from its foot.
  walker.goTo(-6, 6, { leave: [{ x: 4, z: -6 }, { x: 7, z: -6 }, { x: 7, z: -3 }] });
  const down = trail();
  const downNear = (px: number, pz: number) => down.some(([x, z]) => Math.hypot(x - px, z - pz) < 0.3);
  assert.ok(downNear(4, -6) && downNear(7, -6) && downNear(7, -3), 'down the same steps');
  assert.ok(Math.hypot(walker.x + 6, walker.z - 6) < 0.3 && grid.free(walker.x, walker.z));
  // Hops are exact: nobody in the way deflects one (the spot is the spot).
  walker.place(2, -3.2); walker.others = [{ x: 0.5, z: -4.5 }];
  walker.goTo(-1, -6, { exact: true }); trail();
  assert.ok(Math.hypot(walker.x + 1, walker.z + 6) < 0.01);
});

test('every scene: nobody the scene places stands on a spot marker or in front of one, and every raised spot has a way up from the floor', () => {
  const kit = createKit();
  const crowd = Array.from({ length: MAX_CROWD }, (_, i) => ({ id: `p${i}`, name: `P${i}`, kind: i % 3 === 2 ? 'npc' : 'player' }));
  let raisedSpots = 0;
  for (const kind of Object.keys(SCENES)) {
    const entry = SCENES[kind]!(kit, { id: kind, label: kind, scene: { kind } });
    const [cx, , cz] = entry.camera.landscape, size = Math.hypot(cx, cz), toCamera = { x: cx / size, z: cz / size };
    // A regular standing "at" each landmark as well, the hardest case.
    const keys = Object.keys(entry.anchors);
    entry.setCrowd([...crowd.slice(0, MAX_CROWD - 3), ...keys.slice(0, 3).map((key, i) => ({ id: `npc:${i}`, name: key, kind: 'npc', spot: key }))]);
    const people = entry.walk.people();
    assert.equal(people.length, MAX_CROWD, kind);
    for (const person of people) {
      assert.ok(entry.walk.grid!.free(person.x, person.z) || entry.walk.heightAt(person.x, person.z) > 0.05, `${kind}: ${person.id} stands on the floor (${person.x.toFixed(1)}, ${person.z.toFixed(1)})`);
      for (const [key, at] of Object.entries(entry.anchors)) {
        if (entry.walk.heightAt(person.x, person.z) > 0.05) continue; // on a stage of their own
        const dx = person.x - at.x, dz = person.z - at.z, along = dx * toCamera.x + dz * toCamera.z, side = dx * toCamera.z - dz * toCamera.x;
        assert.ok(!(along > -SPOT_BEHIND && along < SPOT_FRONT && Math.abs(side) < SPOT_SIDE), `${kind}: ${person.id} at (${person.x.toFixed(1)}, ${person.z.toFixed(1)}) stands on or in front of the ${key} marker`);
      }
    }
    for (const a of people) for (const b of people) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.6, `${kind}: ${a.id} and ${b.id} do not stand in each other`);
    // Raised spots: the declared way up starts on the floor, and the avatar's height rises along it to the spot's.
    for (const spot of [...entry.walk.spots(), ...Object.entries(entry.anchors).map(([id, at]) => ({ id, ...at }))]) {
      if (!(spot.y > 0.25)) continue;
      raisedSpots += 1;
      assert.ok(spot.approach, `${kind}.${spot.id} (y ${spot.y.toFixed(2)}) declares its approach`);
      const foot = entry.walk.grid!.nearest(spot.approach.x, spot.approach.z);
      assert.ok(foot && Math.hypot(foot.x - spot.approach.x, foot.z - spot.approach.z) < 0.6, `${kind}.${spot.id}: the approach is on the floor`);
      assert.ok(entry.walk.heightAt(foot.x, foot.z) < 0.35, `${kind}.${spot.id}: and at ground level`);
      assert.ok(Math.abs(entry.walk.heightAt(spot.x, spot.z) - spot.y) < 0.2, `${kind}.${spot.id}: the deck under the spot is at the spot’s height`);
      const way = [spot.approach, ...(spot.steps || []), { x: spot.x, z: spot.z }];
      let previous = 0;
      for (let leg = 1; leg < way.length; leg++) for (let t = 0; t <= 1.0001; t += 0.1) {
        const x = way[leg - 1]!.x + (way[leg]!.x - way[leg - 1]!.x) * t, z = way[leg - 1]!.z + (way[leg]!.z - way[leg - 1]!.z) * t;
        const height = entry.walk.heightAt(x, z);
        assert.ok(height - previous < 1.3, `${kind}.${spot.id}: no jump of more than a big step on the way up (${previous.toFixed(2)} → ${height.toFixed(2)} at ${x.toFixed(1)}, ${z.toFixed(1)})`);
        previous = height;
      }
    }
    entry.dispose();
  }
  assert.ok(raisedSpots >= 8, `${raisedSpots} raised spots checked`);
  kit.dispose();
});

test('other players with a reported position are their own figures: placed there, eased to each new place in a bounded time, and freed', () => {
  const kit = createKit();
  const entry = buildVenueScene(kit, { id: 'park', label: 'Park', scene: { kind: 'park' } });
  const ada = '00000001-2222-4333-8444-555555555555', bola = '00000002-2222-4333-8444-555555555555';
  const tags = entry.setCrowd([{ id: ada, name: 'Ada', kind: 'player', x: 4, z: 6 }, { id: bola, name: 'Bola', kind: 'player' }, { id: 'npc:mama', name: 'Mama', kind: 'npc', spot: 'drinks' }]);
  assert.deepEqual(tags.map((tag) => [tag.id, tag.kind, tag.text]), [[ada, 'player', '@Ada'], [bola, 'player', '@Bola'], ['npc:mama', 'npc', 'Mama']], 'tags come in the order the crowd was given');
  assert.deepEqual([tags[0]!.position.x, tags[0]!.position.z], [4, 6], 'Ada stands exactly where she reported');
  assert.equal(entry.easing, false, 'a newly arrived figure is simply there');
  const peers = () => entry.group.children.filter((child) => child.name === 'peer');
  assert.equal(peers().length, 1, 'one figure for the one player with a position; the others share the merged batch');
  const figure = peers()[0];
  assert.deepEqual([figure!.position.x, figure!.position.z], [4, 6]);
  // She moves: the same figure eases there; her tag and her tap target go with her; nothing is rebuilt.
  const setIndex = THREE.BufferGeometry.prototype.setIndex; let built = 0;
  THREE.BufferGeometry.prototype.setIndex = function counted(...args) { built += 1; return setIndex.apply(this, args); };
  try {
    entry.setCrowd([{ id: ada, name: 'Ada', kind: 'player', x: 6, z: 6 }, { id: bola, name: 'Bola', kind: 'player' }, { id: 'npc:mama', name: 'Mama', kind: 'npc', spot: 'drinks' }]);
    assert.equal(entry.easing, true);
    assert.equal(peers()[0], figure, 'the same figure');
    let frames = 0, last = figure!.position.x;
    while (entry.stepCrowd(1 / 60) && frames < 600) { frames += 1; assert.ok(figure!.position.x >= last - 1e-9, 'it only moves towards the new place'); last = figure!.position.x; }
    assert.ok(frames > 5 && frames < 30, `eased over ${frames} frames: bounded, well under half a second`);
    assert.equal(entry.easing, false); assert.equal(entry.stepCrowd(1 / 60), false, 'and then nothing more');
    assert.deepEqual([figure!.position.x, figure!.position.z], [6, 6]);
    assert.deepEqual([entry.tags().find((tag) => tag.id === ada)!.position.x, entry.walk.people().find((person) => person.id === ada)!.x], [6, 6], 'her name tag and her tap target followed');
    assert.ok(Math.abs(figure!.rotation.y - Math.PI / 2) < 0.6, 'she turned to face the way she walked');
    assert.equal(built, 0, 'moving a player builds no geometry (the batch of the others was not touched)');
    // Reduced motion: settleCrowd() puts everyone where they are going, at once.
    entry.setCrowd([{ id: ada, name: 'Ada', kind: 'player', x: 2, z: 8 }, { id: bola, name: 'Bola', kind: 'player' }, { id: 'npc:mama', name: 'Mama', kind: 'npc', spot: 'drinks' }]);
    entry.settleCrowd();
    assert.deepEqual([figure!.position.x, figure!.position.z, entry.easing], [2, 8, false]);
    // A position off the floor is kept on it; a far jump is not animated across the venue.
    entry.setCrowd([{ id: ada, name: 'Ada', kind: 'player', x: 19, z: -19 }]);
    assert.deepEqual([figure!.position.x, figure!.position.z, entry.easing], [14.2, -12.2, false], 'kept on this scene’s floor, and a jump that far is not walked');
  } finally { THREE.BufferGeometry.prototype.setIndex = setIndex; }
  // Gone from the list: her figure is freed. A changed look rebuilds it.
  entry.setCrowd([{ id: bola, name: 'Bola', kind: 'player', x: 1, z: 9, look: { hair: 'afro' } }]);
  assert.equal(peers().length, 1); assert.notEqual(peers()[0], figure);
  const second = peers()[0];
  entry.setCrowd([{ id: bola, name: 'Bola', kind: 'player', x: 1, z: 9, look: { hair: 'bald' } }]);
  assert.notEqual(peers()[0], second, 'a new look is a new figure');
  entry.setCrowd([]);
  assert.equal(peers().length, 0);
  entry.dispose();
  assert.equal(entry.group.children.length, 0);
  kit.dispose();
});

test('the avatar rig is feature-detected: today’s characters.js flips two poses; limb parts or a stride() light up a walk cycle with no other change', () => {
  // What characters.js offers today.
  assert.equal(pickDetail(DETAILS), DETAILS.includes('medium') ? 'medium' : 'low');
  assert.equal(PLAYER_DETAIL, pickDetail(DETAILS));
  assert.equal(pickDetail(['low', 'high']), 'low', 'no medium level: the scene keeps the low one (high is the creator’s preview model)');
  assert.equal(pickDetail(['low', 'medium', 'high']), 'medium', 'a medium level is used the moment it exists');
  assert.equal(pickDetail(undefined), 'low');
  const kit = createKit();
  const entry = buildVenueScene(kit, { id: 'park', label: 'Park', scene: { kind: 'park' } });
  const built = entry.walk.avatar.children[0];
  assert.equal(rigOf(built), built!.userData.parts || typeof built!.userData.stride === 'function' ? rigOf(built) : null);
  // With characters.js's rig: one figure, posed by its parts; a step turns the legs and builds nothing.
  if (rigOf(built)) {
    const { legL, legR, armL } = built!.userData.parts;
    assert.equal(entry.walk.avatar.children.length, 1, 'one rigged figure, no second walking figure');
    assert.ok(built!.userData.triangles > 900, `medium detail (${built!.userData.triangles} triangles)`);
    const geometries = () => { let count = 0; entry.walk.avatar.traverse((node) => { if ((node as THREE.Mesh).geometry) count += 1; }); return count; };
    const before = geometries(), rest = [legL.rotation.x, legR.rotation.x, armL.rotation.x];
    entry.walk.gait(true, Math.PI / 2);
    const contact = [legL.rotation.x, legR.rotation.x, armL.rotation.x];
    assert.ok(Math.abs(contact[0] - contact[1]) > 0.4, `the legs are apart at the contact (${contact[0].toFixed(2)}, ${contact[1].toFixed(2)})`);
    entry.walk.gait(false, Math.PI * 1.5);
    assert.ok(Math.sign(legL.rotation.x - legR.rotation.x) === -Math.sign(contact[0] - contact[1]), 'half a cycle later the other leg leads');
    entry.walk.gait(true, Math.PI / 2, true);
    assert.notDeepEqual([legL.rotation.x, legR.rotation.x], [contact[0], contact[1]], 'a jog is a different stride');
    entry.walk.pose('stand');
    assert.deepEqual([legL.rotation.x, legR.rotation.x, armL.rotation.x], rest, 'at rest the limbs are back');
    assert.equal(geometries(), before, 'nothing was built');
    assert.equal(entry.walk.avatar.children.filter((child) => child.visible).length, 1);
  }
  // Without a rig the two prebuilt figures alternate.
  if (!rigOf(built)) {
    entry.walk.gait(true, 0); const walking = entry.walk.avatar.children.find((child) => child.visible);
    entry.walk.gait(false, Math.PI); const standing = entry.walk.avatar.children.find((child) => child.visible);
    assert.notEqual(walking, standing, 'two poses, one visible at a time');
  }
  entry.dispose(); kit.dispose();
  // A figure with limb parts: the legs swing in opposition around their built pose, the arms the other way, and rest() puts them back.
  const part = (x: number) => ({ rotation: { x } });
  const limbs = { userData: { parts: { legL: part(0.1), legR: part(-0.1), armL: part(0), armR: part(0) } } };
  const rig = rigOf(limbs);
  assert.ok(rig, 'parts are found');
  rig.stride(Math.PI / 2, 1);
  const { legL, legR, armL, armR } = limbs.userData.parts;
  assert.ok(legL.rotation.x > 0.5 && legR.rotation.x < -0.5 && armL.rotation.x < -0.3 && armR.rotation.x > 0.3);
  rig.stride(Math.PI * 1.5, 1);
  assert.ok(legL.rotation.x < -0.4 && legR.rotation.x > 0.4, 'the other step');
  rig.rest();
  assert.deepEqual([legL.rotation.x, legR.rotation.x, armL.rotation.x, armR.rotation.x], [0.1, -0.1, 0, 0]);
  assert.equal(rigOf(limbs), rig, 'found once, kept');
  // Other spellings of the same thing, legs only, and a stride() function all work; anything else is no rig.
  assert.ok(rigOf({ userData: { parts: { leftLeg: part(0), rightLeg: part(0) } } }));
  assert.ok(rigOf({ userData: { parts: { legs: [part(0), part(0)], arms: [part(0), part(0)] } } }));
  const calls: Array<[number, number]> = [];
  const custom = rigOf({ userData: { stride: (phase: number, amount: number) => calls.push([phase, amount]) } });
  custom!.stride(1, 1); custom!.rest();
  assert.deepEqual(calls, [[1, 1], [0, 0]], 'a stride() function is simply called');
  for (const none of [null, {}, { userData: {} }, { userData: { parts: { legL: part(0) } } }, { userData: { parts: 'x' } }]) assert.equal(rigOf(none), null);
});
