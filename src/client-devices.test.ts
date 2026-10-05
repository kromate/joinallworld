import { loadCityContent as preloadCityContent } from './game/cities/registry.ts';
await preloadCityContent('lagos');
// One character on several devices, as the client model sees it (docs/DEVICES.md): the revision that orders the
// server's answers, the `life-changed` hint, and what a device does when it comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, STORAGE_KEY } from './client.ts';
import type { ChangeCause } from './client.ts';
import { createLife } from './life.ts';
import type { LifeState } from './types/life.ts';

const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

/**
 * A server that holds one life with a revision. `elsewhere()` is another device of the same character acting on it.
 * `hold(path)` keeps the next answer to that path back until the returned function is called, with the body it was made
 * with at the time of the request (which is how two answers come to cross).
 */
function household() {
  let life: LifeState = createLife({ name: 'Ada' });
  let rev = 1;
  const calls: [string, string][] = [];
  const held = new Map<string, Promise<void>>();
  /** Short waits only (the retry of a read): the poll, a second or a minute away, is not run by these tests. */
  const timers: (() => void)[] = [];
  const memory = new Map<string, string>();
  const changes: { cash: number; location: string; cause: ChangeCause | undefined }[] = [];
  const snapshot = () => ({ state: life, rev, serverTime: 5000 });
  const fetch = async (path: string, options: RequestInit = {}) => {
    const key = path.split('?')[0] ?? path;
    calls.push([options.method || 'GET', key]);
    let body: object;
    if (key === '/api/session') body = { session: { id: 'public-1', name: 'Ada' }, serverTime: 5000 };
    else if (key === '/api/action') { rev += 1; life = { ...life, cash: life.cash - 400 }; body = { ok: true, code: 'started', ...snapshot() }; }
    else { rev += 1; body = snapshot(); }
    const gate = held.get(key);
    if (gate) { held.delete(key); await gate; }
    return json(200, body);
  };
  let n = 0;
  const client = createClient({
    fetch, now: () => 1000, randomUUID: () => `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`,
    setTimeout: (run, ms) => { if (ms < 1000) timers.push(run); return 0; }, clearTimeout: () => {},
    storage: { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } },
    onChange: (state, previous, cause) => { if (state !== previous) changes.push({ cash: state.cash, location: state.location, cause }); },
  });
  return {
    client, calls, changes, memory, timers,
    life: () => life, rev: () => rev,
    /** Another device of the character travelled: the fare is paid and the place is new. Returns the frame the server sends. */
    elsewhere(location = 'library') { rev += 1; life = { ...life, cash: life.cash - 400, location }; return { rev, by: [`5000:other-device-${rev}`] }; },
    hold(path: string): () => void { let open: () => void = () => {}; held.set(path, new Promise<void>((resolve) => { open = resolve; })); return open; },
    reads: () => calls.filter(([method, path]) => method === 'GET' && path === '/api/life').length,
    lastAction: () => (calls.filter(([, path]) => path === '/api/action').length),
  };
}

test('an answer that a newer one overtook is not applied: the device never shows an older life over a newer one', async () => {
  const h = household();
  await h.client.connect();
  const releasePoll = h.hold('/api/life');
  const poll = h.client.refresh(); // asked first, answered last: it carries the life before the fare was paid
  await flush();
  const done = await h.client.command('travel', { id: 'library', mode: 'cab' });
  assert.equal(done.ok, true);
  assert.equal(h.client.state.cash, 4600);
  const held = h.client.revision;
  releasePoll();
  await poll;
  assert.equal(h.client.state.cash, 4600, 'the older answer did not bring the fare back');
  assert.equal(h.client.revision, held);
  assert.equal(JSON.parse(h.memory.get(STORAGE_KEY) ?? '{}').state.cash, 4600, 'and the copy kept on the device is the newer one');
});

test('a server that starts again from a lower number is believed: only answers that crossed are dropped, never one asked for afterwards', async () => {
  // The same character after the server's data was restored: its revision counts from a lower number, and its life is
  // what was restored. The third request is answered by that server.
  const life = createLife({ name: 'Ada' }), restored = { ...life, cash: 123 };
  let step = 0;
  const client = createClient({
    fetch: async (path: string) => {
      step += 1;
      if (path === '/api/session') return json(200, { session: { id: 'public-1', name: 'Ada' }, serverTime: 5000 });
      return json(200, { state: step < 4 ? life : restored, rev: step < 4 ? 50 + step : 2, serverTime: 5000 });
    },
    now: () => 1000, setTimeout: () => 0, clearTimeout: () => {}, storage: { getItem: () => null, setItem: () => {} },
  });
  await client.connect(); await client.refresh();
  assert.equal(client.revision, 53);
  await client.refresh();
  assert.deepEqual([client.revision, client.state.cash], [2, 123]);
});

test('the hint for this device\'s own action costs no request; the hint for another device\'s action is one read, marked as made elsewhere', async () => {
  const h = household();
  await h.client.connect();
  const reads = h.reads();
  const done = await h.client.command('travel', { id: 'library', mode: 'cab' });
  assert.equal(done.ok, true);
  // The server announces that very action to every socket of the character, this device's too.
  h.client.lifeChanged({ rev: h.client.revision, by: ['5000:11111111-1111-4111-8111-000000000001'] });
  await flush();
  assert.equal(h.reads(), reads, 'nothing is read again for what this device already holds');
  // Another device travels.
  const frame = h.elsewhere('library');
  h.client.lifeChanged(frame);
  await flush();
  assert.equal(h.reads(), reads + 1, 'one read');
  assert.deepEqual([h.client.state.location, h.client.state.cash], ['library', h.life().cash]);
  assert.equal(h.changes.at(-1)?.cause, 'elsewhere');
  assert.ok(h.client.revision >= frame.rev);
  // The same frame again (a second socket of this page, a repeat): nothing.
  h.client.lifeChanged(frame);
  await flush();
  assert.equal(h.reads(), reads + 1);
  // A settlement the server announces without naming an action is read too, and is nobody's "other device".
  const settled = h.elsewhere('library');
  h.client.lifeChanged({ rev: settled.rev });
  await flush();
  assert.equal(h.reads(), reads + 2);
  assert.equal(h.changes.at(-1)?.cause, 'own');
});

test('a burst of hints is one read; a hint that arrives while an action is on its way waits for the answer and is then not needed', async () => {
  const h = household();
  await h.client.connect();
  const reads = h.reads();
  const frames = [h.elsewhere('library'), h.elsewhere('radio'), h.elsewhere('library')];
  const release = h.hold('/api/life');
  for (const frame of frames) h.client.lifeChanged(frame);
  await flush();
  release();
  await flush();
  assert.equal(h.reads(), reads + 1, 'three hints, one read');
  assert.equal(h.client.state.cash, h.life().cash);
  // An action of this device is in flight when another device's hint arrives: the answer to the action is already newer.
  const releaseAction = h.hold('/api/action');
  const sending = h.client.command('spot', { id: 'trees' });
  await flush();
  h.client.lifeChanged({ rev: h.rev() - 1, by: ['5000:another-device'] });
  await flush();
  assert.equal(h.reads(), reads + 1, 'nothing is read while the action is on its way');
  releaseAction();
  await sending;
  await flush();
  assert.equal(h.reads(), reads + 1, 'and nothing afterwards: the answer was at least that new');
});

test('a device that comes back reads the life before it sends anything: the action waits for the read, and the stale copy is replaced', async () => {
  const h = household();
  await h.client.connect();
  const stale = h.client.state.cash;
  h.elsewhere('library'); // while this device was asleep
  const release = h.hold('/api/life');
  const waking = h.client.wake();
  const sending = h.client.command('spot', { id: 'bookcase' });
  await flush();
  assert.equal(h.lastAction(), 0, 'the action has not been sent yet');
  assert.equal(h.client.state.cash, stale);
  release();
  assert.equal(await waking, true);
  await sending;
  assert.deepEqual(h.calls.slice(-2).map(([method, path]) => `${method} ${path}`), ['GET /api/life', 'POST /api/action'], 'read first, then act');
  assert.equal(h.changes.find((change) => change.location === 'library')?.cause, 'wake');
  assert.equal(JSON.parse(h.memory.get(STORAGE_KEY) ?? '{}').state.location, 'library');
  // Two wake-ups at once (the tab came forward and the socket reopened) are one read.
  const reads = h.reads();
  await Promise.all([h.client.wake(), h.client.wake()]);
  assert.equal(h.reads(), reads + 1);
});

test('a hint the server never caught up with is asked for a few times and then let go; the poll goes on as before', async () => {
  const h = household();
  await h.client.connect();
  const reads = h.reads();
  h.client.lifeChanged({ rev: h.rev() + 500, by: ['5000:somewhere'] });
  for (let i = 0; i < 6; i++) { await flush(); for (const run of h.timers.splice(0)) run(); }
  await flush();
  assert.equal(h.reads(), reads + 3, 'three reads, no more');
  assert.equal(h.client.online, true);
});
