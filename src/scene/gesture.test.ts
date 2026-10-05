// The arithmetic of pointer gestures: tap or drag, which button drags what, the interface zoom, the twist, the rubber edge, the flick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlick, dragKind, glide, isDrag, isTap, localPoint, mapHint, northUp, pixelScale, rubber, tapMove, TAP_MOVE, TAP_MOVE_TOUCH, TAP_MS, twist, wrapAngle } from './gesture.ts';

test('a tap is a short, quick press; anything that travels or lingers is not', () => {
  assert.equal(isTap(0, 80), true);
  assert.equal(isTap(TAP_MOVE - 0.1, TAP_MS - 1), true);
  assert.equal(isTap(TAP_MOVE, 80), false, 'the distance limit is exclusive');
  assert.equal(isTap(1, TAP_MS), false, 'a press held for the whole limit is a long press, not a tap');
  assert.equal(isTap(8, 80, 'touch'), true, 'a finger is allowed a little more wobble than a mouse');
  assert.equal(isTap(8, 80, 'mouse'), false);
  assert.equal(tapMove('pen'), TAP_MOVE_TOUCH);
  assert.equal(isDrag(5.9), false); assert.equal(isDrag(6), true); assert.equal(isDrag(9.9, 'touch'), false); assert.equal(isDrag(10, 'touch'), true);
});

test('on the map the left button and one finger pan; the right button, or a modifier key, rotates; the middle button pans', () => {
  assert.equal(dragKind({ button: 0 }, 'map'), 'pan');
  assert.equal(dragKind({ button: 0, pointerType: 'touch' }, 'map'), 'pan');
  assert.equal(dragKind({ button: 2 }, 'map'), 'rotate');
  assert.equal(dragKind({ button: 1 }, 'map'), 'pan');
  for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const) assert.equal(dragKind({ button: 0, [modifier]: true }, 'map'), 'rotate', modifier);
  // A touch never carries a button or a modifier that means anything.
  assert.equal(dragKind({ button: 2, shiftKey: true, pointerType: 'touch' }, 'map'), 'pan');
});

test('in a scene the left button and one finger orbit; the right or middle button, or Shift, slides the view', () => {
  assert.equal(dragKind({ button: 0 }, 'scene'), 'rotate');
  assert.equal(dragKind({ button: 0, pointerType: 'touch' }, 'scene'), 'rotate');
  assert.equal(dragKind({ button: 2 }, 'scene'), 'pan');
  assert.equal(dragKind({ button: 1 }, 'scene'), 'pan');
  assert.equal(dragKind({ button: 0, shiftKey: true }, 'scene'), 'pan');
  assert.equal(dragKind({ button: 0, ctrlKey: true }, 'scene'), 'rotate');
});

test('pointer positions are measured in the element\'s own pixels, whatever the interface zoom', () => {
  // On a 3440 x 1300 screen the interface is enlarged 1.35 times (--ui-zoom). The map and the scene sit outside it and are measured by
  // the rectangle the pointer is measured in: the position inside is client minus left, as is.
  assert.deepEqual(localPoint(1720, 650, { left: 0, top: 0, scale: 1 }), { x: 1720, y: 650 });
  assert.deepEqual(localPoint(120, 80, { left: 20, top: 30, scale: 1 }), { x: 100, y: 50 });
  // A canvas inside a zoomed element reports its rectangle in screen pixels but is laid out in zoomed ones: dividing by its scale puts a
  // pointer on the pixel it is over.
  const scale = pixelScale(1350, 1000);
  assert.equal(scale, 1.35);
  const at = localPoint(675 + 10, 405, { left: 10, top: 5, scale });
  assert.ok(Math.abs(at.x - 500) < 1e-9 && Math.abs(at.y - 296.2962962962963) < 1e-9, `${at.x}, ${at.y}`);
  assert.equal(pixelScale(0, 100), 1, 'a hidden element is measured as unzoomed');
  assert.equal(pixelScale(100, 0), 1);
  assert.equal(pixelScale(Number.NaN, 100), 1);
});

test('angles: wrap into one turn, north up is the nearest whole turn, a twist is the shortest way round', () => {
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(-3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(0.4 + 2 * Math.PI) - 0.4) < 1e-9);
  assert.equal(northUp(0.3), 0);
  assert.ok(Math.abs(northUp(6) - 2 * Math.PI) < 1e-9, 'a view turned nearly all the way round turns on round, not back');
  assert.ok(Math.abs(northUp(-7) + 2 * Math.PI) < 1e-9);
  // Fingers at (-1, 0) and (1, 0) turned to (0, -1) and (0, 1): a quarter turn clockwise on a screen whose y runs down.
  const quarter = twist({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 });
  assert.ok(Math.abs(quarter - Math.PI / 2) < 1e-9, String(quarter));
  assert.ok(Math.abs(twist({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 })) < 1e-9);
  // Across the half turn the shortest way is taken: no jump of nearly a whole turn.
  const across = twist({ x: -1, y: 0.01 }, { x: 1, y: -0.01 }, { x: -1, y: -0.01 }, { x: 1, y: 0.01 });
  assert.ok(Math.abs(across) < 0.1, String(across));
});

test('past its edge a dragged view gives a little and never more than the margin', () => {
  assert.equal(rubber(5, 0, 10, 4), 5);
  assert.equal(rubber(0, 0, 10, 4), 0); assert.equal(rubber(10, 0, 10, 4), 10);
  const a = rubber(11, 0, 10, 4), b = rubber(14, 0, 10, 4), c = rubber(1000, 0, 10, 4);
  assert.ok(a > 10 && a < 11, 'a small pull gets through, but less than the pull');
  assert.ok(b > a && b < 14);
  assert.ok(c < 10 + 4 + 1e-9, 'a huge pull never passes the margin');
  assert.ok(Math.abs(rubber(-1, 0, 10, 4) + (a - 10)) < 1e-9, 'both edges give alike');
});

test('a flick is as fast as the pointer was going when it was let go, and not at all if it had stopped', () => {
  const flick = createFlick();
  assert.equal(flick.velocity(0), null);
  for (let i = 0; i <= 5; i++) flick.push(i * 10, i * -5, i * 16);
  const fast = flick.velocity(90)!;
  assert.ok(Math.abs(fast.x - 625) < 1 && Math.abs(fast.z + 312.5) < 1, `${fast.x}, ${fast.z}`);
  assert.equal(flick.velocity(80 + 120), null, 'a pointer that sat still before it was let go does not fling');
  // A slow screen reports its moves 200 ms apart: the speed is still read, from the last two.
  const slow = createFlick(); slow.push(0, 0, 0); slow.push(10, 0, 200);
  assert.ok(Math.abs(slow.velocity(205)!.x - 50) < 1e-9);
  flick.clear(); assert.equal(flick.velocity(90), null);
  assert.ok(glide(100, 0.5) < 10 && glide(100, 0.5) > 0, 'a glide dies away in about half a second');
});

test('the one-line hint names what the device can do', () => {
  assert.match(mapHint(false, false), /right-drag/); assert.match(mapHint(false, false), /scroll/);
  assert.match(mapHint(true, false), /two fingers/); assert.doesNotMatch(mapHint(true, false), /right-drag|scroll/);
  assert.doesNotMatch(mapHint(false, true), /rotate/, 'the flat map does not turn');
  for (const touch of [false, true]) for (const flat of [false, true]) assert.match(mapHint(touch, flat), /^Drag to move/);
});
