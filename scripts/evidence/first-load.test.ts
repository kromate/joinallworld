import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TAPS, MAX_WAIT_MS, PROBE, firstInteractive, judgeFirstLoad, longestWait } from './first-load.ts';
import type { Sample } from './first-load.ts';

const frames = (spec: [number, boolean, boolean][]): Sample[] => spec;

test('the longest wait is the longest unbroken stretch, not the total', () => {
  const samples = frames([[0, true, false], [400, true, false], [500, false, false], [900, true, false], [1500, true, false], [1600, false, true]]);
  assert.equal(longestWait(samples), 700, 'the second stretch, from 900 until the look at 1600 that no longer showed it');
  assert.equal(longestWait([]), 0);
  assert.equal(longestWait(frames([[0, false, false], [100, false, true]])), 0);
});

test('a wait that is still showing at the last sample counts to that sample, and a cut-off ignores what came later', () => {
  assert.equal(longestWait(frames([[0, true, false], [2500, true, false]])), 2500);
  assert.equal(longestWait(frames([[0, true, false], [300, false, true], [400, true, false], [5000, true, false]]), 300), 300);
});

test('the page is interactive at the first sample that says so', () => {
  assert.equal(firstInteractive(frames([[0, true, false], [850.4, false, true], [900, false, true]])), 850);
  assert.equal(firstInteractive(frames([[0, true, false]])), null);
});

test('one tap, a short wait and a usable scene pass', () => {
  const verdict = judgeFirstLoad(frames([[0, true, false], [700, true, false], [750, false, true]]), 1);
  assert.deepEqual(verdict, { ok: true, reached: true, interactiveMs: 750, longestWaitMs: 750, taps: 1, problems: [] });
});

test('a spinner over a second, a third tap or a page that never works each fail, and say so', () => {
  const slow = judgeFirstLoad(frames([[0, true, false], [1200, true, false], [1300, false, true]]), 2);
  assert.equal(slow.ok, false);
  assert.match(slow.problems.join('\n'), /1300 ms in one stretch/);
  assert.match(judgeFirstLoad(frames([[0, false, true]]), 3).problems.join('\n'), /3 taps; the limit is 2/);
  const never = judgeFirstLoad(frames([[0, true, false], [60_000, true, false]]), 1);
  assert.equal(never.ok, false);
  assert.equal(never.reached, false);
  assert.match(never.problems.join('\n'), /never became interactive/);
});

test('the limits are the plan\'s: two taps, one second', () => {
  assert.equal(MAX_TAPS, 2);
  assert.equal(MAX_WAIT_MS, 1000);
});

test('the in-page probe is valid script and reads the pieces the game really has', () => {
  assert.doesNotThrow(() => new Function(PROBE));
  for (const piece of ['venue-scene', '.scene-wait', 'data-entry-play']) assert.ok(PROBE.includes(piece), piece);
});
