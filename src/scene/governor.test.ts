// The frame governor (./governor.ts): steps the render scale down on a slow p90, probes back up, doubles the wait after a missed
// probe, ignores a lone stall, gives up on a scale that does not help, and can be fixed with ?scale=.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOVERNOR_LOOK, GOVERNOR_SKIP, LONE_MS, SETTLE_SECONDS, PAUSE_MS, PROBE_FRAMES, PROBE_FRAMES_MAX, SCALE_MIN, SLOW_MS,
  activeVerdict, createGovernor, scaleFromSearch, setActiveGovernor,
} from './governor.ts';

const FIRST = GOVERNOR_SKIP + GOVERNOR_LOOK;
/** Feed `n` equal gaps; returns every scale change in order. */
function feed(g: ReturnType<typeof createGovernor>, ms: number, n: number): number[] {
  const changes: number[] = [];
  for (let i = 0; i < n; i += 1) { const next = g.frame(ms); if (next !== null) changes.push(next); }
  return changes;
}

test('steady 60 fps never moves the scale', () => {
  const g = createGovernor({ settleSeconds: 0 });
  assert.deepEqual(feed(g, 16.7, 2000), []);
  assert.equal(g.scale, 1);
  assert.equal(g.verdict.slow, false);
  assert.ok(g.verdict.fullSeconds > 30, 'it counts the time at full scale');
  assert.ok(Math.abs(g.p90! - 16.7) < 1e-6);
});

test('nothing is judged before 45 frames (and the first frames after a start are skipped)', () => {
  const g = createGovernor({ settleSeconds: 0 });
  assert.deepEqual(feed(g, 40, FIRST - 1), []);
  assert.equal(g.p90, null);
  assert.deepEqual(feed(g, 40, 1), [0.9], 'the 45th counted frame is the first look');
});

test('a p90 over 21 ms steps down by 0.1 and the old frames are forgotten; the floor is 0.6', () => {
  const g = createGovernor({ settleSeconds: 0 });
  // 30 ms frames that get faster with every step (a device limited by pixels): each step is judged on its own frames.
  const changes: number[] = [];
  for (const gap of [30, 26, 23]) {
    for (let i = 0; i < FIRST; i += 1) { const next = g.frame(gap); if (next !== null) { changes.push(next); break; } }
  }
  assert.deepEqual(changes, [0.9, 0.8, 0.7]);
  assert.deepEqual(feed(g, 20.5, 40), [], '20.5 ms is under the line, and 40 frames are too few for a probe');
  assert.equal(g.scale, 0.7);
  // The floor: never under SCALE_MIN, even with pixels that keep helping.
  const deep = createGovernor({ settleSeconds: 0 });
  let gap = 60;
  const seen: number[] = [];
  for (let step = 0; step < 4; step += 1) { for (let i = 0; i < 200; i += 1) { const next = deep.frame(gap); if (next !== null) { seen.push(next); break; } } gap *= 0.85; }
  assert.deepEqual(seen, [0.9, 0.8, 0.7, 0.6]);
  assert.deepEqual(feed(deep, 30, 500), [], 'still slow at the floor: it goes no lower');
  assert.equal(deep.scale, SCALE_MIN);
});

test('a lone gap over 150 ms is ignored; two in a row are a slow spell; over a second is not a frame', () => {
  const g = createGovernor({ settleSeconds: 0 });
  const lone = (): void => { for (let i = 0; i < 400; i += 1) g.frame(i % 40 === 20 ? LONE_MS + 80 : 16.7); };
  lone();
  assert.equal(g.scale, 1);
  assert.ok(g.p90! < SLOW_MS);
  const two = createGovernor({ settleSeconds: 0 });
  for (let i = 0; i < 400; i += 1) two.frame(i % 10 < 3 ? 300 : 16.7);
  // Three long frames in ten are the device (the first of each run is ignored, the other two count). Pixels do not help against a
  // stall, so the step down is undone and the street is told to draw less.
  assert.equal(two.verdict.slow, true);
  assert.equal(two.verdict.pressed, true);
  assert.equal(two.scale, 1);
  const idle = createGovernor({ settleSeconds: 0 });
  for (let i = 0; i < 300; i += 1) idle.frame(i % 5 === 0 ? PAUSE_MS + 1 : 16.7);
  assert.equal(idle.scale, 1);
  assert.equal(idle.frame(NaN), null); assert.equal(idle.frame(-3), null); assert.equal(idle.frame(0), null);
});

test('after clean frames it probes back up; a probe that misses is undone and the next wait doubles', () => {
  const g = createGovernor({ settleSeconds: 0 });
  assert.deepEqual(feed(g, 30, FIRST), [0.9]);
  // A device that is fine at 0.9 and slow at 1.0.
  assert.deepEqual(feed(g, 16, PROBE_FRAMES + GOVERNOR_SKIP - 1), [], 'not before the run is long enough');
  assert.deepEqual(feed(g, 16, 1), [1], 'the probe up');
  // The probe misses.
  assert.deepEqual(feed(g, 30, FIRST), [0.9], 'back down');
  // 45 clean frames are not enough any more: the wait is 90.
  assert.deepEqual(feed(g, 16, PROBE_FRAMES + GOVERNOR_SKIP + 20), [], 'twice the wait');
  assert.deepEqual(feed(g, 16, 25), [1], 'the second probe, after 90');
  // It misses again: 180.
  assert.deepEqual(feed(g, 30, FIRST), [0.9]);
  assert.deepEqual(feed(g, 16, 2 * PROBE_FRAMES + GOVERNOR_SKIP + 20), []);
  assert.deepEqual(feed(g, 16, 80), [1]);
});

test('the wait never passes its ceiling, and a probe that holds shortens it again', () => {
  const g = createGovernor({ settleSeconds: 0 });
  feed(g, 30, FIRST);
  let wait = PROBE_FRAMES;
  for (let miss = 0; miss < 8; miss += 1) {
    assert.deepEqual(feed(g, 16, wait + GOVERNOR_SKIP + 1), [1], `probe ${miss}`);
    assert.deepEqual(feed(g, 30, FIRST), [0.9]);
    wait = Math.min(PROBE_FRAMES_MAX, wait * 2);
  }
  assert.equal(wait, PROBE_FRAMES_MAX);
  // This time the probe holds: 1.0 stays clean.
  feed(g, 16, wait + GOVERNOR_SKIP + 1);
  assert.equal(g.scale, 1);
  feed(g, 16, 200);
  assert.equal(g.scale, 1);
  // Slow again later: down, and the next probe waits half as long as the ceiling.
  while (g.scale === 1) g.frame(30);
  assert.equal(g.scale, 0.9);
  assert.deepEqual(feed(g, 16, PROBE_FRAMES_MAX / 2 + GOVERNOR_SKIP - 1), []);
  assert.deepEqual(feed(g, 16, 1), [1]);
});

test('a step down that buys nothing is undone, the verdict says pressed, and it is not tried again until a reset', () => {
  const g = createGovernor({ settleSeconds: 0 });
  // 30 ms whatever the scale: limited by script.
  assert.deepEqual(feed(g, 30, FIRST), [0.9]);
  assert.equal(g.verdict.pressed, false);
  assert.deepEqual(feed(g, 30, FIRST), [1], 'no better: back to full');
  assert.equal(g.verdict.pressed, true);
  assert.equal(g.verdict.slow, true);
  const seq = g.verdict.seq;
  assert.deepEqual(feed(g, 30, 500), [], 'it stays at 1 and keeps saying so');
  assert.equal(g.scale, 1);
  assert.ok(g.verdict.seq > seq && g.verdict.pressed);
  g.reset();
  assert.equal(g.verdict.pressed, false);
  assert.deepEqual(feed(g, 30, FIRST), [0.9], 'a rebuilt scene may be different: it tries again');
});

test('at the floor and still slow the verdict is pressed, with a fresh run of frames between looks', () => {
  const g = createGovernor({ settleSeconds: 0 });
  let gap = 80;
  for (let step = 0; step < 4; step += 1) { while (g.frame(gap) === null) { /* feed until it moves */ } gap *= 0.8; }
  assert.equal(g.scale, SCALE_MIN);
  assert.equal(g.verdict.pressed, false);
  while (g.frame(gap) === null && !g.verdict.pressed) { /* until the look at the floor */ }
  assert.equal(g.verdict.pressed, true);
  const seq = g.verdict.seq;
  feed(g, gap, FIRST - 1);
  assert.equal(g.verdict.seq, seq, 'the next look needs fresh frames');
  feed(g, gap, 1);
  assert.equal(g.verdict.seq, seq + 1);
});

test('reset forgets the frames but keeps the scale', () => {
  const g = createGovernor({ settleSeconds: 0 });
  feed(g, 30, FIRST);
  assert.equal(g.scale, 0.9);
  g.reset();
  assert.equal(g.p90, g.p90);
  assert.deepEqual(feed(g, 16, GOVERNOR_SKIP + 10), []);
  assert.equal(g.scale, 0.9);
});

test('?scale= fixes the scale and the governor never moves it', () => {
  assert.equal(scaleFromSearch('?scale=0.8'), 0.8);
  assert.equal(scaleFromSearch('?a=1&scale=0.5'), 0.5);
  assert.equal(scaleFromSearch('?scale=3'), 1);
  assert.equal(scaleFromSearch('?scale=0.01'), 0.25);
  for (const bad of ['', '?scale=', '?scale=abc', '?scale=0', '?scale=-1', '?x=1']) assert.equal(scaleFromSearch(bad), null, bad);
  const g = createGovernor({ locked: 0.75 });
  assert.equal(g.locked, true);
  assert.equal(g.scale, 0.75);
  assert.deepEqual(feed(g, 60, 1000), []);
  assert.equal(g.scale, 0.75);
  assert.equal(g.verdict.fullSeconds, 0);
  assert.equal(createGovernor({ settleSeconds: 0 }).locked, false);
});

test('the active governor is what the street reads', () => {
  assert.equal(activeVerdict(), null);
  const g = createGovernor({ settleSeconds: 0 });
  setActiveGovernor(g);
  try {
    assert.equal(activeVerdict()!.scale, 1);
    feed(g, 30, FIRST);
    assert.equal(activeVerdict()!.scale, 0.9);
  } finally { setActiveGovernor(null); }
  assert.equal(activeVerdict(), null);
});

test('a new scene\'s first two seconds are not judged, at the start and after a reset', () => {
  const g = createGovernor();
  // 30 ms frames: 2 s is about 67 of them, then the usual 3 + 45.
  const settled = Math.ceil(SETTLE_SECONDS / 0.03) + 1;
  assert.deepEqual(feed(g, 30, GOVERNOR_SKIP + settled + GOVERNOR_LOOK - 2), [], 'busy while the scene starts');
  assert.deepEqual(feed(g, 30, 2), [0.9]);
  g.reset();
  assert.deepEqual(feed(g, 16, 100), [], 'not even a probe while the scene settles');
  assert.deepEqual(feed(g, 16, 100), [1]);
  const s = createGovernor();
  feed(s, 16, 300);
  s.reset();
  assert.deepEqual(feed(s, 30, GOVERNOR_SKIP + settled + GOVERNOR_LOOK - 2), []);
  assert.deepEqual(feed(s, 30, 2), [0.9]);
});
