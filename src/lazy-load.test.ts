import test from 'node:test';
import assert from 'node:assert/strict';
import { createLazyLoader, RETRY_DELAYS_MS, MAX_RETRY_DELAY_MS } from './lazy-load.ts';

/** Timers the test fires by hand. */
function clock() {
  const timers = [];
  return { timers, setTimeout: (fn, ms) => { const timer = { fn, ms, live: true }; timers.push(timer); return timer; }, clearTimeout: (timer) => { if (timer) timer.live = false; },
    async fire() { const timer = timers.filter((item) => item.live).at(-1); timer.live = false; timer.fn(); await settle(); } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a chunk that fails to load is retried with doubling delays, a bounded number of times, and says what is true at each step', async () => {
  const c = clock(), states = [];
  let calls = 0;
  const piece = createLazyLoader(() => { calls += 1; return Promise.reject(new Error('Failed to fetch dynamically imported module\nat somewhere')); }, { onState: (state) => states.push(state), setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  assert.equal(piece.state.status, 'idle');
  assert.equal(await piece.load(), null, 'not loaded: the caller gets null, not an exception');
  assert.deepEqual([piece.state.status, piece.state.attempt, piece.state.retryInMs, piece.state.error], ['retrying', 1, 1000, 'Failed to fetch dynamically imported module']);
  const waits = [1000];
  for (let i = 0; i < 4; i++) { await c.fire(); waits.push(piece.state.retryInMs); }
  assert.deepEqual(waits, [...RETRY_DELAYS_MS], 'bounded exponential backoff: 1, 2, 4, 8, 16 seconds');
  await c.fire();
  assert.deepEqual([piece.state.status, piece.state.attempt, piece.state.attempts, calls], ['failed', 6, 6, 6]);
  assert.equal(c.timers.filter((timer) => timer.live).length, 0, 'it has stopped: nothing is scheduled');
  await settle();
  assert.equal(calls, 6, 'and nothing more is requested by itself');
  assert.deepEqual(states.map((state) => state.status).filter((status, index, all) => status !== all[index - 1]).slice(0, 4), ['loading', 'retrying', 'loading', 'retrying']);
  assert.ok(RETRY_DELAYS_MS.every((ms) => ms <= MAX_RETRY_DELAY_MS));
});

test('a manual retry tries at once, joins an attempt in flight, and a success is kept', async () => {
  const c = clock();
  let calls = 0, fail = true, release;
  const piece = createLazyLoader(() => { calls += 1; if (fail) return Promise.reject(new Error('offline')); return new Promise((resolve) => { release = () => resolve({ createCommunity: true }); }); }, { setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  await piece.load();
  assert.equal(piece.state.status, 'retrying');
  fail = false;
  const one = piece.load(), two = piece.load(); // the player taps Retry twice while the timer is still waiting
  await settle();
  assert.equal(calls, 2, 'one new attempt, started immediately, not two');
  assert.equal(piece.state.status, 'loading');
  assert.equal(c.timers.filter((timer) => timer.live).length, 0, 'the waiting timer was cancelled');
  release();
  assert.deepEqual([await one, await two], [{ createCommunity: true }, { createCommunity: true }]);
  assert.equal(piece.state.status, 'ready');
  assert.deepEqual(await piece.load(), { createCommunity: true });
  assert.equal(calls, 2, 'a loaded piece is never fetched again');
});

test('after every automatic retry is used, an explicit retry starts a new bounded round; stop() ends retries', async () => {
  const c = clock();
  let calls = 0;
  const piece = createLazyLoader(() => { calls += 1; return Promise.reject(new Error('no')); }, { delays: [10, 20], setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  await piece.load(); await c.fire(); await c.fire();
  assert.deepEqual([piece.state.status, calls], ['failed', 3]);
  await piece.load();
  assert.deepEqual([piece.state.status, piece.state.attempt, piece.state.retryInMs, calls], ['retrying', 1, 10, 4]);
  piece.stop();
  assert.equal(c.timers.filter((timer) => timer.live).length, 0);
  // A listener that throws cannot break loading.
  const loud = createLazyLoader(() => Promise.resolve(7), { onState() { throw new Error('listener'); } });
  assert.equal(await loud.load(), 7);
});
