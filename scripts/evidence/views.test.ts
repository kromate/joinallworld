import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { timeOfDay } from '../../src/scene/lighting.ts';
import { chromeCandidates } from './cdp.ts';
import { STAGES, STALL_BASELINE, judgeGaps } from './walk.ts';
import { PROOF_CLOCKS, PROOF_MIN_DIFFERENCE, VIEWS, VIEW_NAMES, classifyErrors, defaultGpu, lagosInstant, parseClock, parseShootArgs, percentile, proveClock, summariseGaps } from './views.ts';

test('there are exactly the reference views: the three anchors and the street at night', () => {
  assert.deepEqual([...VIEW_NAMES].sort(), ['home-night', 'kano-noon', 'street-dusk', 'street-night']);
  for (const name of VIEW_NAMES) { assert.equal(VIEWS[name].name, name); assert.ok(VIEWS[name].steps.length > 0 && VIEWS[name].location && VIEWS[name].title); }
});

test('each view\'s clock gives the light the view is named for, by the game\'s own rule', () => {
  for (const name of VIEW_NAMES) {
    const spec = VIEWS[name];
    assert.equal(timeOfDay(lagosInstant('2026-10-19', spec.clock)), spec.band, name);
    assert.equal(timeOfDay(lagosInstant('2027-03-01', spec.clock)), spec.band, `${name} on another day`);
  }
});

test('Lagos time is one hour ahead of UTC', () => {
  assert.equal(new Date(lagosInstant('2026-10-19', { hour: 18, minute: 30 })).toISOString(), '2026-10-19T17:30:00.000Z');
  assert.equal(new Date(lagosInstant('2026-10-19', { hour: 0, minute: 15 })).toISOString(), '2026-10-18T23:15:00.000Z');
  assert.throws(() => lagosInstant('19 October', { hour: 1, minute: 0 }), /not a day/);
});

test('percentile and the frame summary count the way the game\'s own benchmark does', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
  const summary = summariseGaps([16.7, 16.7, 16.8, 50, 120, 16.7, 16.7, 16.7, 16.7, 16.7]);
  assert.equal(summary.frames, 10);
  assert.equal(summary.p50, 16.7);
  assert.equal(summary.max, 120);
  assert.equal(summary.over42, 2);
  assert.equal(summary.over100, 1);
  assert.deepEqual(summariseGaps([]), { frames: 0, p50: null, p95: null, max: null, over42: 0, over100: 0 });
});

test('the walk counts a stall as a frame gap over 42 ms and a slow frame as over 100 ms', () => {
  assert.deepEqual(judgeGaps([16, 17, 42, 43, 100, 101, 933]), { frames: 7, stalls: 4, slowFrames: 2, maxGapMs: 933, p95GapMs: 933 });
  assert.deepEqual(judgeGaps([]), { frames: 0, stalls: 0, slowFrames: 0, maxGapMs: null, p95GapMs: null });
  assert.deepEqual(STAGES.map((s) => s.stage), ['home', 'gate', 'street', 'market', 'back']);
  assert.equal(STAGES[0]!.target, STAGES.at(-1)!.target, 'the loop comes back to where it began');
});

test('arguments: defaults, lists, and clear refusals', () => {
  const defaults = parseShootArgs([], '2026-10-19');
  assert.deepEqual(defaults.views, ['street-dusk', 'street-night', 'kano-noon', 'home-night']);
  assert.equal(defaults.base, 'http://127.0.0.1:5211');
  assert.equal(defaults.scale, 2);
  assert.equal(defaults.dwellMs, 10_000);
  assert.equal(defaults.day, '2026-10-19');
  assert.equal(defaults.uncapped, false);
  assert.equal(defaults.sid, null);
  assert.equal(parseShootArgs(['--sid', 'abc123']).sid, 'abc123', 'a life of an earlier run can be shot again');
  assert.equal(parseShootArgs(['--uncapped']).uncapped, true);
  const asked = parseShootArgs(['--view', 'kano-noon,home-night', '--base=http://localhost:5300/', '--scale', '1', '--size', '800x600', '--dwell', '3', '--gpu', 'swiftshader'], '2026-10-19');
  assert.deepEqual(asked.views, ['kano-noon', 'home-night']);
  assert.equal(asked.base, 'http://localhost:5300');
  assert.deepEqual([asked.width, asked.height, asked.scale, asked.dwellMs, asked.gpu], [800, 600, 1, 3000, 'swiftshader']);
  assert.throws(() => parseShootArgs(['--view', 'paris-noon']), /Unknown view "paris-noon"/);
  assert.throws(() => parseShootArgs(['--size', 'big']), /WIDTHxHEIGHT/);
  assert.throws(() => parseShootArgs(['--gpu', 'cuda']), /swiftshader or metal/);
  assert.throws(() => parseShootArgs(['--dwell', '0']), /between 1 and 120/);
});

test('console errors: the known harmless one is counted apart, anything else counts', () => {
  const street = 'Failed to load resource: the server responded with a status of 409 (Conflict) (http://127.0.0.1:5211/api/street/me)';
  const other = 'Failed to load resource: the server responded with a status of 500 (Internal Server Error) (http://127.0.0.1:5211/api/life)';
  assert.deepEqual(classifyErrors([street, other, 'uncaught: TypeError']), { known: [street], unexpected: [other, 'uncaught: TypeError'] });
});

test('the GPU is asked for only where it is known to work', () => {
  assert.equal(defaultGpu('darwin', 'arm64'), 'metal');
  assert.equal(defaultGpu('linux', 'x64'), 'swiftshader');
  assert.equal(defaultGpu('darwin', 'x64'), 'swiftshader');
});

test('browser search: an explicit path first, then the tools folder, newest version first, then the Playwright cache', () => {
  const home = mkdtempSync(join(tmpdir(), 'aw-evidence-test-'));
  try {
    for (const version of ['1.0.0', '2.0.0']) mkdirSync(join(home, '.t3', 'tools', 'chrome-headless-shell', 'mac-arm64', version), { recursive: true });
    mkdirSync(join(home, 'Library', 'Caches', 'ms-playwright', 'chromium_headless_shell-1228'), { recursive: true });
    writeFileSync(join(home, 'Library', 'Caches', 'ms-playwright', 'not-a-browser'), '');
    const found = chromeCandidates(home, { AW_CHROME: '/x/chrome' });
    assert.equal(found[0], '/x/chrome');
    assert.equal(found[1], join(home, '.t3', 'tools', 'chrome-headless-shell', 'mac-arm64', '2.0.0', 'chrome-headless-shell'));
    assert.equal(found[2], join(home, '.t3', 'tools', 'chrome-headless-shell', 'mac-arm64', '1.0.0', 'chrome-headless-shell'));
    assert.ok(found.some((path) => path.includes('chromium_headless_shell-1228')));
    assert.deepEqual(chromeCandidates(join(home, 'nowhere'), {}), []);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('the clock-pin proof compares full day with night, and wants a clear difference in brightness', () => {
  assert.deepEqual(PROOF_CLOCKS.map((clock) => timeOfDay(lagosInstant('2026-10-19', clock))), ['day', 'night']);
  assert.deepEqual(parseClock('18:30'), { hour: 18, minute: 30 });
  assert.throws(() => parseClock('25:00'), /not a clock/);
  assert.throws(() => parseClock('noon'), /not a clock/);
  assert.equal(parseShootArgs(['--clock', '7:05']).clock?.hour, 7);
  assert.equal(parseShootArgs([]).clock, null);
  assert.equal(parseShootArgs(['--prove-clock']).proveClock, true);
  assert.deepEqual(proveClock(120, 60), { ok: true, difference: 60 });
  assert.equal(proveClock(100, 100 - PROOF_MIN_DIFFERENCE).ok, true);
  assert.equal(proveClock(100, 95).ok, false, 'a clock that did not reach the light');
  assert.equal(proveClock(60, 120).ok, false, 'darker by day than by night is not a pass either');
});

test('the walk\'s gate is "no worse than the baseline" of 8 stalls', () => {
  assert.equal(STALL_BASELINE, 8);
});
