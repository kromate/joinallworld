// The city map's camera rig: grab-and-drag, rotation about the centre, zoom about the pointer, the limits, the flick, the way back to north.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRig, DEFAULT_PITCH, PITCH_MAX, pitchFloor } from './camera.ts';

const BOUNDS = { minX: -600, maxX: 600, minZ: -400, maxZ: 400, minDistance: 3 };
function make(width = 1600, height = 1000, insets?: { left?: number; top?: number; right?: number; bottom?: number }) {
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.2, 5000);
  const rig = createRig(THREE, camera, BOUNDS);
  rig.setViewport(width, height, insets);
  rig.jump({ x: 40, z: -30, yaw: 0.7, pitch: 0.9, distance: 220 });
  return { rig, camera };
}
const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b}`);

test('dragging grabs the ground: the point under the pointer when the drag began is under it after every move', () => {
  for (const insets of [undefined, { left: 8, top: 90, right: 70, bottom: 160 }]) {
    const { rig } = make(1600, 1000, insets);
    const grab = rig.groundAt(0.3, -0.2)!;
    rig.beginDrag();
    for (const [nx, ny] of [[0.25, -0.1], [0.1, 0.1], [-0.2, 0.3], [0.05, 0.05]] as const) {
      assert.equal(rig.dragTo(grab, nx, ny), true);
      const under = rig.groundAt(nx, ny)!;
      near(under.x, grab.x, 1e-6); near(under.z, grab.z, 1e-6);
    }
    rig.endDrag();
  }
});

test('grab-and-drag holds on a wide screen too (3440 x 1300), at another turn and tilt', () => {
  const { rig } = make(3440, 1300);
  rig.jump({ yaw: -2.2, pitch: 0.5, distance: 120 });
  const grab = rig.groundAt(-0.4, 0.2)!;
  rig.beginDrag();
  rig.dragTo(grab, 0.6, -0.5);
  const under = rig.groundAt(0.6, -0.5)!;
  near(under.x, grab.x); near(under.z, grab.z);
});

test('a pointer over the sky cannot grab anything', () => {
  const { rig } = make();
  rig.jump({ pitch: 0.37, distance: 60 });
  const before = { ...rig.view };
  assert.notEqual(rig.groundAt(0, 0), null, 'the screen centre sees ground');
  assert.equal(rig.dragTo({ x: 0, z: 0 }, 0, 1.4), false, 'above the top of the screen');
  assert.deepEqual(rig.view, before);
});

test('rotating turns the view about the centre of the screen: what is looked at stays put and the yaw is free', () => {
  const { rig } = make();
  const centre = rig.groundAt(0, 0)!;
  rig.orbit(1.3, 0); rig.orbit(-0.4, 0);
  const after = rig.groundAt(0, 0)!;
  near(after.x, centre.x, 1e-6); near(after.z, centre.z, 1e-6);
  rig.orbit(40, 0);
  near(rig.view.yaw, 0.7 + 1.3 - 0.4 + 40);
  assert.equal(rig.view.x, 40);
});

test('the tilt stays within its limits so the horizon never flips', () => {
  const { rig } = make();
  rig.orbit(0, 50);
  assert.equal(rig.view.pitch, PITCH_MAX);
  rig.orbit(0, -50);
  near(rig.view.pitch, pitchFloor(rig.view.distance));
  assert.ok(rig.view.pitch > 0.3 && rig.view.pitch < Math.PI / 2);
});

test('zooming keeps the ground under the pointer where it is, and stops at the closest and the farthest', () => {
  const { rig } = make();
  const point = rig.groundAt(0.45, 0.3)!;
  rig.zoomAt(0.5, 0.45, 0.3);
  near(rig.view.distance, 110);
  const under = rig.groundAt(0.45, 0.3)!;
  near(under.x, point.x, 1e-6); near(under.z, point.z, 1e-6);
  rig.zoomAt(1e-9, 0.45, 0.3);
  const closest = rig.view.distance;
  assert.ok(closest <= 4 && closest >= 3, `closest ${closest}`);
  rig.zoomAt(1e9);
  assert.equal(rig.view.distance, rig.maxDistance);
  // zoomed() says where it would go without going there.
  rig.jump({ distance: 200 });
  const there = rig.zoomed(0.5, 0.2, 0.2), kept = { ...rig.view };
  assert.deepEqual(rig.view, kept); near(there.distance, 100);
});

test('what is looked at never leaves the land: a drag past the edge gives a little, then springs back inside', () => {
  const { rig } = make();
  rig.jump({ x: 580, z: 0, yaw: 0, pitch: 0.9, distance: 120 });
  const grab = rig.groundAt(0, 0)!;
  rig.beginDrag();
  rig.dragTo(grab, -0.9, 0);   // pulling the ground far to the left: the view goes to the right, beyond the edge
  assert.ok(rig.view.x > BOUNDS.maxX, 'the edge gave');
  assert.ok(rig.view.x < BOUNDS.maxX + 0.05 * 1200 + 1e-6, 'but not by more than the margin');
  rig.endDrag();
  assert.equal(rig.moving, true, 'it is easing back');
  for (let i = 0; i < 60; i++) rig.step(1 / 30);
  assert.equal(rig.view.x, BOUNDS.maxX);
  assert.equal(rig.moving, false);
  // Without a drag the edge is hard.
  rig.pan(500, 0);
  assert.equal(rig.view.x, BOUNDS.maxX);
});

test('a flick glides on and stops by itself; with reduced motion there is none', () => {
  const { rig } = make();
  const x = rig.view.x;
  rig.beginDrag(); rig.endDrag({ x: 300, z: 0 });
  assert.equal(rig.moving, true);
  let frames = 0;
  while (rig.step(1 / 60) && frames < 600) frames += 1;
  assert.ok(frames > 5 && frames < 120, `${frames} frames`);
  assert.ok(rig.view.x > x + 20 && rig.view.x < x + 200, `glided ${rig.view.x - x}`);
  const still = make();
  still.rig.beginDrag(); still.rig.endDrag(null);
  assert.equal(still.rig.moving, false);
  // A slow release (below the threshold) does not glide.
  const slow = make();
  slow.rig.beginDrag(); slow.rig.endDrag({ x: 1, z: 1 });
  assert.equal(slow.rig.moving, false);
  // A glide into the edge stops there.
  const edge = make();
  edge.rig.jump({ x: 590, z: 0 }); edge.rig.beginDrag(); edge.rig.endDrag({ x: 900, z: 0 });
  for (let i = 0; i < 120; i++) edge.rig.step(1 / 60);
  assert.equal(edge.rig.view.x, BOUNDS.maxX);
});

test('pressing again stops a glide', () => {
  const { rig } = make();
  rig.beginDrag(); rig.endDrag({ x: 400, z: 0 });
  rig.hold();
  assert.equal(rig.moving, false);
});

test('the compass: a turned or tipped view is skewed, and rest() is north up at the tilt it rests at', () => {
  const { rig } = make();
  assert.equal(rig.skewed(), true);
  const rest = rig.rest();
  assert.equal(rest.yaw, 0); near(rest.pitch, Math.max(DEFAULT_PITCH, pitchFloor(rig.view.distance)));
  rig.jump({ yaw: 0, pitch: rest.pitch });
  assert.equal(rig.skewed(), false);
  rig.jump({ yaw: 6.2 });   // nearly a whole turn round: that is nearly north, and the way back is the short one
  assert.ok(Math.abs(rig.rest().yaw - 2 * Math.PI) < 1e-9);
  rig.ease({ yaw: rig.rest().yaw, pitch: rig.rest().pitch }, 0.3);
  for (let i = 0; i < 40; i++) rig.step(1 / 30);
  assert.equal(rig.skewed(), false);
  rig.jump({ yaw: 0, pitch: rest.pitch + 0.3 });
  assert.equal(rig.skewed(), true, 'a tipped view shows it too');
});
