// Street life's adaptive caps (./adaptive.ts): they follow the frame governor's verdict. A "pressed" look (the render scale cannot help)
// shrinks the counts, never under a floor; quiet at full scale for 5 s brings them back a step at a time, with a growing wait when
// growing was too much. The verdicts here are written by hand and, in the last tests, produced by a real governor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPT_BACKOFF_SECONDS, ADAPT_FLOOR, ADAPT_GROW_MAX_SECONDS, ADAPT_GROW_SECONDS, createAdaptiveCaps, growCaps, perfFlag, readoutText, shrinkCaps } from './adaptive.ts';
import { GOVERNOR_LOOK, GOVERNOR_SKIP, createGovernor, setActiveGovernor, type GovernorVerdict } from '../governor.ts';

/** A verdict source the test writes by hand. */
function source() {
  const v = { scale: 1, slow: false, pressed: false, fullSeconds: 0, seq: 0, clock: 0, p90: 16 as number | null };
  return { v, read: (): GovernorVerdict => ({ ...v }), look(change: Partial<typeof v> = {}) { Object.assign(v, change, { seq: v.seq + 1 }); } };
}

test('without a governor nothing is judged: the counts stay as planned', () => {
  const caps = createAdaptiveCaps({ crowd: 240, vehicles: 8 }, () => null);
  for (let i = 0; i < 500; i++) assert.equal(caps.frame(0.05), null);
  assert.deepEqual(caps.caps, { crowd: 240, vehicles: 8 });
  assert.equal(caps.average, null);
});

test('a pressed look shrinks once; the same look again does nothing; a quiet look does nothing', () => {
  const s = source();
  const caps = createAdaptiveCaps({ crowd: 240, vehicles: 8 }, s.read);
  assert.equal(caps.frame(), null, 'a verdict nobody changed');
  s.look({ slow: false });
  assert.equal(caps.frame(), null);
  s.look({ slow: true, pressed: true, p90: 30 });
  assert.deepEqual(caps.frame(), { crowd: 168, vehicles: 5 });
  assert.equal(caps.frame(), null, 'the same look is acted on once');
  assert.equal(caps.average, 30);
  s.look({ slow: true, pressed: true });
  assert.deepEqual(caps.frame(), { crowd: 117, vehicles: 3 });
  assert.equal(caps.shrinks, 2);
});

test('a slow look that is not pressed (the render scale is still working on it) leaves the counts alone', () => {
  const s = source();
  const caps = createAdaptiveCaps({ crowd: 100, vehicles: 4 }, s.read);
  for (let i = 0; i < 20; i++) { s.look({ slow: true, pressed: false, scale: 0.8 }); assert.equal(caps.frame(), null); }
  assert.deepEqual(caps.caps, { crowd: 100, vehicles: 4 });
});

test('never under the floor (at least one of anything there was), never up from a shrink, nothing from nothing', () => {
  const start = { crowd: 240, vehicles: 8 };
  let caps = start;
  for (let i = 0; i < 30; i++) { const next = shrinkCaps(caps, start); assert.ok(next.crowd <= caps.crowd && next.vehicles <= caps.vehicles); caps = next; }
  assert.deepEqual(caps, { crowd: Math.ceil(240 * ADAPT_FLOOR), vehicles: Math.ceil(8 * ADAPT_FLOOR) });
  assert.deepEqual(shrinkCaps({ crowd: 0, vehicles: 1 }, { crowd: 0, vehicles: 1 }), { crowd: 0, vehicles: 1 });
  const s = source();
  const adaptive = createAdaptiveCaps({ crowd: 4, vehicles: 0 }, s.read);
  for (let i = 0; i < 20; i++) { s.look({ slow: true, pressed: true }); adaptive.frame(); }
  assert.deepEqual(adaptive.caps, { crowd: 1, vehicles: 0 });
});

test('growCaps: a step at a time, at least one, never over the start', () => {
  const start = { crowd: 240, vehicles: 8 };
  let caps = { crowd: 60, vehicles: 2 };
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) { caps = growCaps(caps, start); seen.push(caps.crowd); }
  assert.deepEqual(caps, start);
  assert.ok(seen.every((n, i) => i === 0 || n >= seen[i - 1]!));
  assert.deepEqual(growCaps({ crowd: 1, vehicles: 0 }, { crowd: 4, vehicles: 0 }), { crowd: 2, vehicles: 0 });
  assert.deepEqual(growCaps(start, start), start);
});

test('counts come back after 5 s at full scale, a step at a time, and stop at the start', () => {
  const s = source();
  const caps = createAdaptiveCaps({ crowd: 240, vehicles: 8 }, s.read);
  s.look({ slow: true, pressed: true, clock: 9 });
  caps.frame();
  s.look({ slow: true, pressed: true, clock: 10 });
  caps.frame();
  const shrunk = caps.caps.crowd;
  assert.ok(shrunk < 240);
  s.look({ slow: false, pressed: false, fullSeconds: ADAPT_GROW_SECONDS - 0.1, clock: 14 });
  assert.equal(caps.frame(), null, 'not yet 5 s at full scale');
  s.look({ fullSeconds: 0, scale: 0.9, clock: 20 });
  assert.equal(caps.frame(), null, 'never while the render scale is down');
  s.look({ fullSeconds: ADAPT_GROW_SECONDS, scale: 1, clock: 25 });
  const grown = caps.frame();
  assert.ok(grown && grown.crowd > shrunk && grown.crowd < 240);
  assert.equal(caps.grows, 1);
  // The next step waits the same 5 s from the last change.
  s.look({ fullSeconds: ADAPT_GROW_SECONDS + 2, clock: 27 });
  assert.equal(caps.frame(), null);
  let clock = 25;
  for (let i = 0; i < 30; i++) { clock += ADAPT_GROW_SECONDS; s.look({ fullSeconds: 100, clock }); caps.frame(); }
  assert.deepEqual(caps.caps, { crowd: 240, vehicles: 8 });
  s.look({ fullSeconds: 100, clock: clock + 10 });
  assert.equal(caps.frame(), null, 'at the start there is nothing to grow');
});

test('growing was too much: a shrink soon after doubles the wait for the next growth, up to a ceiling; a late shrink does not', () => {
  const s = source();
  const caps = createAdaptiveCaps({ crowd: 240, vehicles: 8 }, s.read);
  let clock = 0;
  const shrinkNow = (): void => { clock += 1; s.look({ slow: true, pressed: true, fullSeconds: 0, clock }); caps.frame(); };
  const growAfter = (seconds: number): boolean => { clock += seconds; s.look({ slow: false, pressed: false, fullSeconds: 1000, clock }); return caps.frame() !== null; };
  shrinkNow();
  assert.equal(growAfter(ADAPT_GROW_SECONDS), true, 'first growth after 5 s');
  shrinkNow(); // within 10 s of that growth
  assert.equal(growAfter(ADAPT_GROW_SECONDS), false, 'now 10 s are needed');
  assert.equal(growAfter(ADAPT_GROW_SECONDS), true, '10 s from the shrink');
  shrinkNow();
  assert.equal(growAfter(2 * ADAPT_GROW_SECONDS), false, 'then 20');
  assert.equal(growAfter(2 * ADAPT_GROW_SECONDS), true);
  for (let i = 0; i < 8; i++) { shrinkNow(); growAfter(ADAPT_GROW_MAX_SECONDS); growAfter(1); }
  shrinkNow();
  assert.equal(growAfter(ADAPT_GROW_MAX_SECONDS - 1), false, 'the ceiling is 80 s');
  assert.equal(growAfter(1), true);
  // A shrink long after a growth is just weather: the wait stays where it was.
  clock += ADAPT_BACKOFF_SECONDS * 10;
  shrinkNow();
  assert.equal(growAfter(ADAPT_GROW_MAX_SECONDS - 1), false);
  assert.equal(growAfter(1), true);
});

test('with a real governor: a script-limited device shrinks the counts; a pixel-limited one keeps them', () => {
  // Script-limited: 30 ms whatever the scale. The governor tries 0.9, finds no gain, undoes it and says pressed.
  const stuck = createGovernor();
  setActiveGovernor(stuck);
  try {
    const caps = createAdaptiveCaps({ crowd: 200, vehicles: 8 });
    let changed = 0;
    for (let i = 0; i < 300; i++) { stuck.frame(30); if (caps.frame()) changed += 1; }
    assert.ok(changed >= 1 && caps.caps.crowd < 200, `${changed} shrinks, ${caps.caps.crowd} people`);
    assert.equal(stuck.scale, 1);
    // The device recovers (the scene got lighter): the counts come back after 5 s at full scale.
    for (let i = 0; i < 2000; i++) { stuck.frame(16); caps.frame(); }
    assert.equal(caps.caps.crowd, 200);
    assert.ok(caps.grows >= 1);
  } finally { setActiveGovernor(null); }
  // Pixel-limited: each step down helps (the gap follows the scale).
  const fill = createGovernor();
  setActiveGovernor(fill);
  try {
    const caps = createAdaptiveCaps({ crowd: 200, vehicles: 8 });
    for (let i = 0; i < 600; i++) { fill.frame(40 * fill.scale * fill.scale * fill.scale); caps.frame(); }
    assert.ok(fill.scale < 1 && fill.scale >= 0.6);
    assert.equal(caps.shrinks, 0, `the pixels were enough: scale ${fill.scale}`);
    assert.deepEqual(caps.caps, { crowd: 200, vehicles: 8 });
  } finally { setActiveGovernor(null); }
  void GOVERNOR_LOOK; void GOVERNOR_SKIP;
});

test('the readout: ?streetperf=1 only, and its line', () => {
  assert.equal(perfFlag('?streetperf=1'), true);
  assert.equal(perfFlag('?a=b&streetperf=on'), true);
  assert.equal(perfFlag('?streetperf=0'), false);
  assert.equal(perfFlag(''), false);
  assert.equal(readoutText({ average: 18.26, people: 240, vehicles: 8, shrinks: 0, triangles: 960, scale: 0.9 }), 'street 18.3 ms p90 · scale 0.9 · 240 people · 8 vehicles · 960 tris');
  assert.match(readoutText({ average: null, people: 1, vehicles: 0, shrinks: 2, triangles: 2, grows: 1, scale: 1 }), /… ms p90.*shrunk ×2 · grown ×1/);
  assert.equal(readoutText({ average: 10, people: 1, vehicles: 0, shrinks: 0, triangles: 2 }), 'street 10.0 ms p90 · 1 people · 0 vehicles · 2 tris');
});
