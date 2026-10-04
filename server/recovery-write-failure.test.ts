// Recovery safety tests: what the store and the social module do when a durable write FAILS.
// The failure is real: devices.json is replaced by a directory, so the rename that finishes a write
// cannot succeed (EISDIR or a neighbour, depending on the platform), and it is put back to recover.
//   - a rejected durable transaction is in neither memory nor the file, and its listener never runs;
//   - a whole failed batch is rejected together, earlier commits survive, and order holds afterwards;
//   - a failed write that carried only lazy commits undoes nothing;
//   - over real HTTP and sockets, a failed "ask the guest to leave" ends no visit and empties no room.
// ADAPTED TO THIS BRANCH, each place marked below:
//   - there is ONE store (the legacy mode was removed), so the per-mode loops have one entry;
//   - a write that could not be made is answered 503 storage_unavailable, not 500;
//   - a read that saw an unsaved change is answered from what is stored instead of being rejected;
//   - LAZY commits (design conflict, see the two notes below): here a failed write undoes EVERYTHING that is
//     not in the file, lazy commits included, and a commit listener runs only once its change is in the file.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createStore } from './store.ts';
import type { JsonFileStore, StoreOptions } from './store.ts';
import { fixture } from './test-fixture.ts';

import type { Db, SessionRecord, Store } from './types.ts';
import type { PresenceFrame, ServerFrame } from '../src/types/protocol.ts';
import type { HouseView } from '../src/types/social.ts';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isFrame = (value: unknown): value is ServerFrame => isRecord(value) && typeof value.type === 'string';
const presenceOf = (frame: ServerFrame): PresenceFrame => { if (frame.type !== 'presence') throw Error('presence expected'); return frame; };
/** The sessions these store tests write are not real lives: they carry a wallet and a few probe fields beside the record. */
type Row = SessionRecord & { cash?: number; polled?: number; steps?: number[] };
const session = (publicId: string, extra: Partial<Row> = {}): Row => ({ secret: `s-${publicId}`, publicId, name: publicId, expiresAt: 1000, cities: {}, actions: {}, cash: 5000, ...extra });
const rows = (db: Db): Record<string, Row> => db.sessions;
const row = (db: Db, key: string): Row => { const found = rows(db)[key]; if (!found) throw Error(`no session ${key}`); return found; };
const pay = (target: Row, amount: number) => { target.cash = (target.cash ?? 0) + amount; };
/** These tests store collections of their own shape beside the real ones; this is the document seen as plain keys. */
const loose = (db: Db): Record<string, unknown> => db;
/** The one social player `pa` of the first test, as stored plain data. */
const socialPlayer = (db: Db): Record<string, unknown> => {
  const social = loose(db).social;
  const players = isRecord(social) ? social.players : undefined;
  const found = isRecord(players) ? players.pa : undefined;
  if (!isRecord(found)) throw Error('no social player pa');
  return found;
};
/** devices.json as read back from disk: only what these tests look at. */
interface Stored { sessions: Record<string, Row | undefined>; social?: { players: Record<string, { name?: unknown } | undefined> }; civic?: unknown }
const isStored = (value: unknown): value is Stored => isRecord(value) && isRecord(value.sessions);
type FileStore = JsonFileStore;
/** A parsed JSON reply with its HTTP status: only the fields these tests read. */
interface Reply { status: number; error?: unknown; code?: unknown; duplicate?: boolean; house?: HouseView }
const reply = async (res: Response): Promise<Reply> => { const body: unknown = await res.json(); if (!isRecord(body)) throw Error('JSON object expected'); return { ...body, status: res.status }; };
const houseOf = (r: Reply): HouseView => { if (!r.house) throw Error('house expected'); return r.house; };
const statsOf = (store: Store) => { const stats = store.stats?.(); if (!stats) throw Error('store has no stats'); return stats; };

/** Make every write to `dir` fail. Returns the function that makes writes work again. */
async function breakDisk(dir: string) {
  const file = join(dir, 'devices.json'), saved = join(dir, 'devices.saved.json');
  await rename(file, saved); await mkdir(file);
  let broken = true;
  return async () => { if (!broken) return; broken = false; await rm(file, { recursive: true, force: true }); await rename(saved, file); };
}
async function temp(t: TestContext, options?: StoreOptions) {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-recovery-store-'));
  const store: FileStore = await createStore(dir, { mode: 'grouped', lazyFlushMs: 60000, ...options }); // the mode is named, never taken from STORE_MODE
  const heals: (() => Promise<void>)[] = [];
  t.after(async () => { for (const heal of heals) await heal().catch(() => {}); await store.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  return { dir, store, file: async (): Promise<Stored> => { const doc: unknown = JSON.parse(await readFile(join(dir, 'devices.json'), 'utf8')); if (!isStored(doc)) throw Error('devices.json has no sessions'); return doc; }, fail: async () => { const heal = await breakDisk(dir); heals.push(heal); return heal; } };
}

for (const mode of ['grouped']) { // one store: see the header
  test(`${mode}: a durable transaction whose write fails is rejected, is not in memory, never reaches the file, and its listener never runs`, async (t) => {
    const { dir, store, file, fail } = await temp(t, { mode });
    await store.transact((db) => { db.sessions.a = session('pa'); loose(db).social = { players: { pa: { name: 'Ada' } } }; });
    const heal = await fail();
    const seen: unknown[] = [];
    const note = (value: unknown) => { seen.push(value); }; // assert.deepEqual narrows `seen` to never[] below, so pushes go through this
    const debit = (label: string) => store.transact((db) => {
      pay(row(db, 'a'), -500); db.sessions.b = session('pb'); socialPlayer(db).name = 'Changed'; loose(db).civic = { v: 1 };
      return label;
    }, { committed: note });
    await assert.rejects(debit('first attempt'));
    assert.deepEqual(seen, [], 'no listener for a transaction that was rejected');
    const inMemory = () => store.read((db) => [row(db, 'a').cash, rows(db).b, socialPlayer(db).name, 'civic' in db, Object.keys(db.sessions)]);
    assert.deepEqual(await inMemory(), [5000, undefined, 'Ada', false, ['a']], 'the rejected change is not in memory, and a read still works');
    // A retry while the disk is still broken is rejected and undone in the same way: nothing accumulates.
    await assert.rejects(debit('second attempt'));
    assert.deepEqual(seen, []);
    assert.deepEqual(await inMemory(), [5000, undefined, 'Ada', false, ['a']]);

    await heal();
    assert.equal((await file()).sessions.a?.cash, 5000, 'the file never saw the rejected debit');
    assert.equal(await store.transact((db) => { pay(row(db, 'a'), -500); return 'paid'; }, { committed: note }), 'paid');
    assert.deepEqual(seen, ['paid'], 'the retry is one ordinary commit, applied once');
    const stored = await file();
    assert.deepEqual([stored.sessions.a?.cash, stored.sessions.b, stored.social?.players.pa?.name, stored.civic], [4500, undefined, 'Ada', undefined]);

    // Restart: a new store reading the file sees exactly the acknowledged state.
    await store.close();
    const again = await createStore(dir, { mode });
    try { assert.deepEqual(await again.read((db) => [row(db, 'a').cash, rows(db).b, socialPlayer(db).name, 'civic' in db]), [4500, undefined, 'Ada', false]); }
    finally { await again.close(); }
  });
}

test('grouped: a failed batch is rejected together; commits before it survive; later commits apply in order and listeners follow them', async (t) => {
  const { dir, store, file, fail } = await temp(t);
  await store.transact((db) => { db.sessions.a = session('pa'); db.sessions.b = session('pb'); });
  // A lazy commit made before the failure: it was never promised to be on disk, and it depends on nothing that fails.
  await store.transact((db) => { row(db, 'a').name = 'lazy before'; }, { durable: false });
  const writes = statsOf(store).writes;
  const heal = await fail();
  const seen: unknown[] = [];
  const listen = { committed: (value: unknown) => { seen.push(value); } };
  const settled = await Promise.allSettled([
    store.transact((db) => { pay(row(db, 'a'), -500); return 'debit'; }, listen),
    store.transact((db) => { pay(row(db, 'b'), 500); return 'credit'; }, listen),
    // A poll that settles on top of the unwritten debit: it acknowledges nothing, so it is answered — and undone with the rest.
    store.transact((db) => { const a = row(db, 'a'); a.polled = a.cash; return 'poll'; }, { durable: false, ...listen }),
    // A replay-style request that changes nothing but would have answered from the unwritten debit.
    store.transact((db) => row(db, 'a').cash, listen),
    store.read((db) => row(db, 'a').cash),
  ]);
  // The read (last) is the difference: this store runs it again against the stored state and answers 5000;
  // the navigation lane's store rejects it. Neither hands out the unsaved 4500.
  assert.deepEqual(settled.map((result) => result.status), ['rejected', 'rejected', 'fulfilled', 'rejected', 'fulfilled']);
  const fulfilled = (result: PromiseSettledResult<unknown> | undefined) => (result?.status === 'fulfilled' ? result.value : Symbol('not fulfilled'));
  assert.equal(fulfilled(settled[2]), 'poll');
  assert.equal(fulfilled(settled[4]), 5000);
  assert.deepEqual(seen, [], 'no listener ran: none of those commits became final');
  assert.equal(statsOf(store).writes, writes, 'nothing was written');
  // DESIGN CONFLICT (lazy commits). Navigation lane: the earlier lazy commit ('lazy before') is still there.
  // This branch: memory is exactly the file after a failed write, so the unsaved lazy rename is undone too. A
  // lazy commit acknowledges nothing to anyone (store.js), which is what makes dropping it safe.
  assert.deepEqual(await store.read((db) => [row(db, 'a').cash, row(db, 'b').cash, row(db, 'a').polled, row(db, 'a').name]), [5000, 5000, undefined, 'pa'],
    'the batch is undone in memory, and so is the unsaved lazy commit');

  await heal();
  await store.flush();
  let stored = await file();
  assert.deepEqual([stored.sessions.a?.cash, stored.sessions.b?.cash, stored.sessions.a?.polled, stored.sessions.a?.name], [5000, 5000, undefined, 'pa']);

  // After recovery: concurrent durable transactions still apply one after another, in the order they were asked.
  const before = statsOf(store).writes;
  const order = await Promise.all([1, 2, 3, 4, 5].map((step) => store.transact((db) => {
    const a = row(db, 'a');
    pay(a, -100); a.steps = [...(a.steps ?? []), step];
    return a.cash;
  }, listen)));
  assert.deepEqual(order, [4900, 4800, 4700, 4600, 4500]);
  assert.deepEqual(seen, [4900, 4800, 4700, 4600, 4500], 'one listener call per commit, in commit order');
  assert.ok(statsOf(store).writes - before <= 3, 'they still share writes');
  stored = await file();
  assert.deepEqual([stored.sessions.a?.cash, stored.sessions.a?.steps], [4500, [1, 2, 3, 4, 5]]);
  await store.close();
  const again = await createStore(dir, { mode: 'grouped' });
  try { assert.deepEqual(await again.read((db) => [row(db, 'a').cash, row(db, 'a').steps, row(db, 'b').cash, row(db, 'a').name]), [4500, [1, 2, 3, 4, 5], 5000, 'pa']); }
  finally { await again.close(); }
});

test('grouped: a transaction still running when a write fails cannot commit on top of what was undone', async (t) => {
  const { store, fail } = await temp(t);
  await store.transact((db) => { db.sessions.a = session('pa'); });
  const heal = await fail();
  let release: () => void = () => {};
  const gate = new Promise<void>((done) => { release = done; });
  const debit = store.transact((db) => { pay(row(db, 'a'), -500); });
  // Starts after the debit is in memory (it reads 4500) and is still running when the debit's write fails.
  const dependent = store.transact(async (db) => { const cash = row(db, 'a').cash; await gate; db.sessions.b = session('pb', { cash }); return cash; });
  await assert.rejects(debit);
  release();
  await assert.rejects(dependent);
  assert.deepEqual(await store.read((db) => [row(db, 'a').cash, rows(db).b]), [5000, undefined]);
  await heal();
  await store.transact((db) => { db.sessions.b = session('pb', { cash: row(db, 'a').cash }); });
  assert.deepEqual(await store.read((db) => [row(db, 'a').cash, row(db, 'b').cash]), [5000, 5000]);
});

// DESIGN CONFLICT (kept visible, not run). Navigation lane: a lazy commit's listener runs at once, a failed
// flush leaves the lazy change in memory, and it is written when the disk works again. This branch: a listener
// never runs for a change that is not in the file, and a failed write undoes every unsaved change (the lazy one
// is recomputed from the stored state by the next request). See server/store.test.ts, 'a lazy transaction
// resolves before the disk…' and 'a failed write has NO effect…'.
test('grouped: a failed write that carried only lazy commits undoes nothing and is written once the disk works', { skip: 'design conflict: here a failed write undoes unsaved lazy commits too, and listeners wait for the file' }, async (t) => {
  const { store, file, fail } = await temp(t);
  await store.transact((db) => { db.sessions.a = session('pa'); });
  const heal = await fail();
  const seen: unknown[] = [];
  await store.transact((db) => { row(db, 'a').name = 'settled'; return 'lazy'; }, { durable: false, committed: (value) => { seen.push(value); } });
  assert.deepEqual(seen, ['lazy'], 'a lazy commit with nothing unwritten beneath it is final at once');
  await assert.rejects(store.flush());
  assert.equal(await store.read((db) => row(db, 'a').name), 'settled', 'nothing was promised, so nothing is undone');
  await heal();
  await store.flush();
  assert.equal((await file()).sessions.a?.name, 'settled');
});

// ---- over real HTTP and sockets: a visit is ended only by a transaction that committed --------------
async function open(f: { base: string }, device: { cookie: string }) {
  const ws = new WebSocket(f.base.replace('http', 'ws') + '/socket', { headers: { Cookie: device.cookie, Origin: f.base } });
  const messages: ServerFrame[] = [];
  ws.on('message', (data) => { const frame: unknown = JSON.parse(data.toString()); if (isFrame(frame)) messages.push(frame); });
  await once(ws, 'open');
  return { ws, messages, send: (message: object) => ws.send(JSON.stringify(message)) };
}
async function until<T>(check: () => T | Promise<T>): Promise<NonNullable<T>> {
  for (let i = 0; i < 300; i++) { const value = await check(); if (value) return value as NonNullable<T>; await sleep(5); }
  throw Error('Condition never became true');
}

for (const storeMode of ['grouped']) { // one store: see the header
  test(`${storeMode}: a failed "ask the guest to leave" ends no visit and empties no room; the retry ends it once`, async (t) => {
    const f = await fixture(t, { heartbeatMs: 60000 });
    assert.equal(statsOf(f.server.store).mode, storeMode);
    const get = async (path: string, who: { cookie: string }) => reply(await f.request(path, null, who.cookie));
    const post = async (path: string, body: object, who: { cookie: string }) => reply(await f.request(path, body, who.cookie));
    const host = await f.device('Host'), guest = await f.device('Guest');
    for (const who of [host, guest]) await get('/api/social/me', who);
    // The host goes home and opens the door; the guest knocks, is let in and joins the host's Home room.
    await f.action(host.cookie, { type: 'travel', id: 'home', mode: 'trek' });
    f.advance(20000);
    const h = await open(f, host), g = await open(f, guest);
    let heal: () => Promise<void> = async () => {};
    try {
      h.send({ type: 'join', cityId: 'lagos', venueId: 'home' });
      await until(() => h.messages.find((message) => message.type === 'presence'));
      assert.equal((await post('/api/social/house/knock', { host: host.id, cityId: 'lagos' }, guest)).code, 'knocking');
      assert.equal((await post('/api/social/house/answer', { visitor: guest.id, answer: 'accept' }, host)).code, 'accepted');
      g.send({ type: 'join', cityId: 'lagos', venueId: 'home', hostId: host.id });
      const both = (message: ServerFrame) => message.type === 'presence' && [host.id, guest.id].every((id) => message.members.some((member) => member.id === id));
      await until(() => g.messages.find(both));
      const visit = async () => houseOf(await get(`/api/social/house/${host.id}`, guest));
      assert.equal((await visit()).role, 'guest');

      await f.flush();
      heal = await breakDisk(f.dir);
      g.messages.length = 0; h.messages.length = 0;
      const failed = await post('/api/social/house/leave', { host: host.id, guest: guest.id }, host);
      assert.deepEqual([failed.status, failed.error], [503, 'storage_unavailable']); // 500 in the navigation lane
      await sleep(60);
      assert.deepEqual(g.messages.flatMap((message) => (message.type === 'error' ? [message.code] : [])), [], 'the guest was not dropped from the room');
      assert.deepEqual(g.messages.filter((message) => message.type === 'invite-house' || message.type === 'social-update'), [], 'and was told nothing');
      // The room still holds both: a move by the host reaches the guest as presence listing the two of them.
      h.send({ type: 'move', x: 2, z: 2 });
      await until(() => g.messages.find(both));

      await heal();
      const still = await visit();
      assert.deepEqual([still.role, still.guests.map((item) => item.id)], ['guest', [guest.id]], 'the stored visit was not ended by the rejected request');

      g.messages.length = 0;
      const retry = await post('/api/social/house/leave', { host: host.id, guest: guest.id }, host);
      assert.deepEqual([retry.status, retry.code, retry.duplicate], [200, 'left', undefined], 'the retry is the first real commit, not a replay');
      await until(() => g.messages.find((message) => message.type === 'error' && message.code === 'visit_ended'));
      assert.equal(g.messages.filter((message) => message.type === 'error' && message.code === 'visit_ended').length, 1, 'announced once');
      assert.equal((await visit()).role, 'none');
      h.messages.length = 0;
      h.send({ type: 'move', x: 3, z: 3 });
      const alone = presenceOf(await until(() => h.messages.find((message) => message.type === 'presence')));
      assert.deepEqual(alone.members.map((member) => member.id), [host.id]);
    } finally { await heal(); h.ws.terminate(); g.ws.terminate(); }
  });
}
