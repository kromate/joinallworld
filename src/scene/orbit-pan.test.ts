// A scene's orbit: the limits of the tilt, the turn and the zoom, sliding the view off the avatar, and when the camera goes back to following it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrbit, FOLLOW_PAUSE, PITCH_MAX, PITCH_MIN } from './camera-controls.ts';

function make() {
  const orbit = createOrbit();
  orbit.setBase([10, 9, 14], [0, 0.7, 0]);
  orbit.setLimits({ near: 5.5 });
  orbit.follow(2, 0.7, 3); orbit.snap();
  return orbit;
}
const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b}`);

test('dragging orbits freely round, the tilt stays between the ground and nearly straight down, the zoom between close and far', () => {
  const orbit = make();
  for (let i = 0; i < 400; i++) orbit.drag(-30, 0);
  assert.ok(Math.abs(orbit.goal.yaw) > 20, 'the turn is not limited');
  for (let i = 0; i < 400; i++) orbit.drag(0, 30);
  orbit.snap(); near(orbit.pitch, PITCH_MAX);
  for (let i = 0; i < 400; i++) orbit.drag(0, -30);
  orbit.snap(); near(orbit.pitch, PITCH_MIN);
  orbit.zoomBy(1e6); assert.equal(orbit.goal.zoom, orbit.limits.zoomMax);
  orbit.zoomBy(1e-9); assert.equal(orbit.goal.zoom, orbit.limits.zoomMin);
  assert.ok(orbit.limits.zoomMax > 1 && orbit.limits.zoomMin < 1);
});

test('sliding moves the pivot so the ground follows the pointer, within a limit', () => {
  const orbit = make();
  // The camera looks along (-sin a, -cos a): dragging right moves the ground right, so the pivot moves left of the camera.
  const azimuth = orbit.base.azimuth;
  orbit.panScreen(100, 0, 0.02);
  near(orbit.goal.px, -2 * Math.cos(azimuth)); near(orbit.goal.pz, 2 * Math.sin(azimuth));
  orbit.reset();
  orbit.panScreen(0, 100, 0.02);   // dragging down: the pivot moves forward, away from the camera
  const forward = { x: -Math.sin(azimuth), z: -Math.cos(azimuth) };
  assert.ok(orbit.goal.px * forward.x + orbit.goal.pz * forward.z > 0, 'the pivot moves the way the camera looks');
  orbit.reset();
  for (let i = 0; i < 100; i++) orbit.panScreen(500, -500, 0.05);
  near(Math.hypot(orbit.goal.px, orbit.goal.pz), orbit.limits.pan, 1e-9);
  orbit.panScreen(Number.NaN, 1, 1);
  assert.ok(Number.isFinite(orbit.goal.px));
});

test('after a slide the camera stays where it is while the avatar walks, then goes back to following it', () => {
  const orbit = make();
  orbit.panScreen(80, 40, 0.02);
  const pivot = () => ({ x: orbit.goal.x + orbit.goal.px, z: orbit.goal.z + orbit.goal.pz });
  const held = pivot();
  orbit.follow(5, 0.7, 7); orbit.follow(6, 0.7, 8);          // the avatar walks on
  near(pivot().x, held.x, 1e-9); near(pivot().z, held.z, 1e-9);
  assert.equal(orbit.settled, false);
  assert.ok(orbit.holding > 0 && orbit.holding <= FOLLOW_PAUSE);
  // Time passes without another slide: the hold ends and the slide is let go.
  for (let i = 0; i < FOLLOW_PAUSE * 60 + 5; i++) orbit.step(1 / 60);
  assert.equal(orbit.holding, 0);
  for (let i = 0; i < 240; i++) orbit.step(1 / 60);
  near(orbit.now.px, 0, 1e-3); near(orbit.now.pz, 0, 1e-3);
  assert.equal(orbit.settled, true);
  // And now it follows again.
  orbit.follow(9, 0.7, 9);
  near(pivot().x, 9); near(pivot().z, 9);
});

test('another slide renews the pause, and orbiting or zooming never pauses the follow', () => {
  const orbit = make();
  orbit.panScreen(10, 10, 0.02);
  for (let i = 0; i < 180; i++) orbit.step(1 / 60);
  const left = orbit.holding;
  orbit.panScreen(10, 10, 0.02);
  assert.ok(orbit.holding > left, 'a new slide starts the pause again');
  const orbit2 = make();
  orbit2.drag(40, 20); orbit2.zoomBy(1.4);
  assert.equal(orbit2.holding, 0);
  orbit2.follow(7, 0.7, 7);
  near(orbit2.goal.x, 7); assert.equal(orbit2.goal.px, 0);
});

test('reset returns to the scene\'s own view at once, the slide included', () => {
  const orbit = make();
  orbit.drag(50, 30); orbit.zoomBy(2); orbit.panScreen(60, 60, 0.02);
  orbit.reset();
  assert.equal(orbit.goal.yaw, 0); assert.equal(orbit.goal.tilt, 0); assert.equal(orbit.goal.zoom, 1);
  assert.equal(orbit.goal.px, 0); assert.equal(orbit.goal.pz, 0); assert.equal(orbit.holding, 0);
  orbit.follow(1, 0.7, 1);
  near(orbit.goal.x, 1);
});

test('the camera is put where the orbit says, looking at the slid pivot', () => {
  const orbit = make();
  orbit.panScreen(100, 0, 0.05); orbit.snap();
  const calls: { position?: number[]; look?: number[] } = {};
  orbit.apply({ position: { set: (...p: number[]) => { calls.position = p; } }, lookAt: (...p: number[]) => { calls.look = p; } });
  near(calls.look![0]!, orbit.now.x + orbit.now.px); near(calls.look![2]!, orbit.now.z + orbit.now.pz);
  near(calls.position![0]! - calls.look![0]!, Math.sin(orbit.azimuth) * Math.cos(orbit.pitch) * orbit.distance);
});
