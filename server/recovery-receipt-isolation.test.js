// Recovery safety tests: money receipts and interaction receipts have separate allowances.
//   - a flood of interaction receipts neither blocks a new transfer nor removes a stored money receipt;
//   - a full money table refuses a transfer before the debit and leaves interactions working;
//   - interaction receipts are short-lived (LIMITS.interactReceiptMs) and money receipts keep 24 hours;
//   - a table written by an earlier build (one shared allowance) is read as it is after a restart.
// Everything is checked over real HTTP (and real sockets for the venue room). State that would take a
// day of play or thousands of requests to reach is written through the server's own store and is
// marked SEEDED; the routes then run with their real limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './store.js';
import { fixture } from './test-fixture.js';
import { LIMITS } from './social/service.js';

const HOUR = 3600000;

function tools(f, store) {
  const get = async (path, who) => { const res = await f.request(path, null, who?.cookie); return { status: res.status, ...(await res.json()) }; };
  const post = async (path, body, who) => { const res = await f.request(path, body, who?.cookie); return { status: res.status, ...(await res.json()) }; };
  const life = async (who) => (await get('/api/life?city=lagos', who)).state;
  const receipts = () => store.read((db) => Object.entries(db.social.receipts).map(([key, receipt]) => ({ key, kind: receipt.kind })));
  /** SEEDED: `count` receipts of `kind`, written at `at`, owned by synthetic senders unless `owner` says otherwise. */
  const seed = (kind, count, at, owner = (i) => `synthetic-${kind}-sender-${i % 50}`, tag = kind) => store.transact((db) => {
    for (let i = 0; i < count; i++) db.social.receipts[`${owner(i)}|seed-${tag}-${String(i).padStart(8, '0')}`] = { at, kind, fp: 'synthetic', result: { ok: true, code: 'probe' } };
  });
  const transfer = (who, to, clientId, amount = 500) => post('/api/social/transfers', { to: to.id, amount, cityId: 'lagos', clientId }, who);
  const interact = (who, target, clientId, action = 'hello') => post(`/api/social/players/${target.id}/interact`, { action, cityId: 'lagos', clientId }, who);
  return { get, post, life, receipts, seed, transfer, interact };
}
/** Three registered players; `a` and `c` can each give money to `b` through the real transfer route. */
async function players(f, store) {
  const { get, life } = tools(f, store);
  const a = await f.device('Sender Probe'), b = await f.device('Recipient Probe'), c = await f.device('Other Sender');
  for (const who of [a, b, c]) { await get('/api/social/me', who); await life(who); }
  // SEEDED: accounts older than a day, friendships older than an hour, and earned money to give.
  await store.transact((db) => {
    const session = (who) => Object.values(db.sessions).find((record) => record.publicId === who.id);
    for (const who of [a, b, c]) db.social.players[who.id].first = f.now() - 25 * HOUR;
    for (const sender of [a, c]) {
      db.social.players[sender.id].friends[b.id] = f.now() - 2 * HOUR;
      db.social.players[b.id].friends[sender.id] = f.now() - 2 * HOUR;
      const state = session(sender).cities.lagos.state;
      state.cash = 10000; state.social.earned = 5000;
    }
  });
  return { a, b, c, balances: balancesOf(f, store, { a, b, c }) };
}
/** Wallets, after anything owed to the recipient has been applied. Bound to one running server. */
function balancesOf(f, store, { a, b, c }) {
  const { get, life } = tools(f, store);
  return async () => { await get('/api/social/me', b); return { a: (await life(a)).cash, b: (await life(b)).cash, c: (await life(c)).cash }; };
}
const count = (list, kind) => list.filter((item) => item.kind === kind).length;

test('an interaction flood neither blocks a new transfer nor removes a money receipt; interaction receipts are short-lived', async t => {
  const f = await fixture(t), store = f.server.store;
  const { life, receipts, seed, transfer, interact } = tools(f, store);
  const { a, b, c, balances } = await players(f, store);
  await f.joinRoom(a); await f.joinRoom(b);

  // Real requests first: one interaction and one transfer, each with its receipt.
  const hello = await interact(a, b, 'interact-real-0001');
  assert.deepEqual([hello.ok, hello.code], [true, 'interacted'], hello.reason);
  assert.equal((await interact(a, b, 'interact-real-0001')).duplicate, true);
  const first = await transfer(a, b, 'money-real-0001');
  assert.equal(first.ok, true, first.reason);
  const once = await balances();
  assert.deepEqual(once, { a: 9500, b: 5500, c: 10000 });
  const closeness = (await life(a)).social.rel[b.id];

  // SEEDED flood: the interaction allowance is completely full of receipts that are still live.
  await seed('interact', LIMITS.interactReceipts - 1, f.now());
  assert.equal(count(await receipts(), 'interact'), LIMITS.interactReceipts);

  // Interactions are refused — before anything is applied …
  const flooded = await interact(a, b, 'interact-real-0002', 'gist');
  assert.deepEqual([flooded.status, flooded.ok, flooded.code], [200, false, 'receipts_full']);
  assert.deepEqual((await life(a)).social.rel[b.id], closeness, 'the refused interaction changed nothing');
  // … while money is untouched by the flood: a new, valid transfer goes through, exactly once.
  const fresh = await transfer(c, b, 'money-real-0002', 100);
  assert.deepEqual([fresh.status, fresh.ok, fresh.code], [200, true, 'sent'], fresh.reason);
  assert.deepEqual(await balances(), { a: 9500, b: 5600, c: 9900 });
  assert.equal((await transfer(c, b, 'money-real-0002', 100)).duplicate, true);
  assert.equal((await transfer(a, b, 'money-real-0001')).duplicate, true, 'the earlier money receipt is still honoured');
  assert.deepEqual(await balances(), { a: 9500, b: 5600, c: 9900 }, 'no second debit or credit');
  let stored = await receipts();
  assert.deepEqual([count(stored, 'interact'), count(stored, 'transfer')], [LIMITS.interactReceipts, 2], 'nothing was evicted, in either class');
  // One client id is one request, whatever its kind: reusing a money id for an interaction is a conflict.
  assert.equal((await interact(a, b, 'money-real-0001')).status, 409);
  assert.equal((await transfer(a, b, 'interact-real-0001')).status, 409);

  // THE LIMIT OF THE INTERACTION GUARANTEE: after LIMITS.interactReceiptMs those receipts are due.
  f.advance(LIMITS.interactReceiptMs + 1000);
  await f.joinRoom(a); await f.joinRoom(b);
  const later = await interact(a, b, 'interact-real-0003', 'gist');
  assert.notEqual(later.code, 'receipts_full', 'the flood has expired');
  assert.notEqual(later.code, 'too_many_recent');
  stored = await receipts();
  assert.ok(count(stored, 'interact') <= 1, 'every due interaction receipt was dropped');
  assert.ok(stored.some((item) => item.key === `${a.id}|money-real-0001`) && stored.some((item) => item.key === `${c.id}|money-real-0002`), 'money receipts keep their 24 hours');
  assert.equal((await transfer(a, b, 'money-real-0001')).duplicate, true);
  assert.notEqual((await interact(a, b, 'interact-real-0001')).duplicate, true, 'a ten-minute-old interaction id is decided afresh, not replayed');
});

test('a full money table refuses a transfer before the debit and leaves interactions working; per-player allowances are separate too', async t => {
  const f = await fixture(t), store = f.server.store;
  const { life, receipts, seed, transfer, interact } = tools(f, store);
  const { a, b, c, balances } = await players(f, store);
  await f.joinRoom(a); await f.joinRoom(b);
  const before = await balances();

  // SEEDED: `a` already holds as many live interaction receipts as one player may.
  await seed('interact', LIMITS.interactReceiptsPerPlayer, f.now(), () => a.id);
  const tooMany = await interact(a, b, 'interact-own-cap-0001');
  assert.deepEqual([tooMany.ok, tooMany.code], [false, 'too_many_recent']);
  assert.equal((await life(a)).social.rel?.[b.id], undefined, 'refused before anything was applied');
  // That player's money allowance is a different count: their transfer is decided on its own.
  const sent = await transfer(a, b, 'money-own-0001');
  assert.equal(sent.ok, true, sent.reason);
  assert.deepEqual(await balances(), { a: before.a - 500, b: before.b + 500, c: before.c });
  // Another player's interactions are not affected by `a`'s count.
  const other = await interact(b, a, 'interact-other-0001');
  assert.deepEqual([other.ok, other.code], [true, 'interacted'], other.reason);

  // SEEDED: the money table is full of live transfer receipts.
  await seed('transfer', LIMITS.receipts - count(await receipts(), 'transfer'), f.now());
  assert.equal(count(await receipts(), 'transfer'), LIMITS.receipts);
  const paid = await balances();
  const refused = await transfer(c, b, 'money-full-0001', 100);
  assert.deepEqual([refused.status, refused.ok, refused.code], [200, false, 'receipts_full']);
  assert.match(refused.reason, /Nothing was sent or charged/);
  assert.deepEqual(await balances(), paid, 'refused before the debit: nobody was debited or credited');
  assert.equal((await transfer(a, b, 'money-own-0001')).duplicate, true, 'a stored money receipt still answers');
  const stored = await receipts();
  assert.equal(count(stored, 'transfer'), LIMITS.receipts, 'nothing evicted, nothing added');
  assert.ok(!stored.some((item) => item.key === `${c.id}|money-full-0001`));
  // A full money table does not stop interactions.
  const still = await interact(b, a, 'interact-other-0002', 'gist');
  assert.equal(still.status, 200);
  assert.ok(!['receipts_full', 'too_many_recent'].includes(still.code), `decided by the game, not by receipt capacity (${still.code})`);
});

test('a receipt table written under the old shared allowance is read as it is after a restart: money kept, old interactions due', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-receipts-'));
  let store = await createStore(dir, { mode: 'grouped' });
  t.after(async () => { await store.close().catch(() => {}); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
  let f = await fixture(t, { store });
  let { receipts, seed, transfer, interact } = tools(f, store);
  const { a, b, c, balances } = await players(f, store);
  const first = await transfer(a, b, 'money-before-0001');
  assert.equal(first.ok, true, first.reason);
  const once = await balances();

  // SEEDED: what an earlier build could have left behind, 23 hours ago — every one of these was "live"
  // under its single 24-hour rule, and together they nearly filled its one table of 5,000.
  const old = f.now() - 23 * HOUR;
  await seed('interact', 3000, old);
  await seed('transfer', 1500, old);
  await store.transact((db) => {
    // A real-shaped money receipt of `c`, one of an unknown kind, and one money receipt that is already due.
    db.social.receipts[`${c.id}|historic-money-0001`] = { at: old, kind: 'transfer', fp: `${b.id}|300|lagos`, result: { ok: true, code: 'sent', amount: 300, to: { id: b.id, name: 'Recipient Probe' }, credited: false, balance: 9700 } };
    db.social.receipts[`${c.id}|historic-nokind-0001`] = { at: old, fp: 'synthetic', result: { ok: true, code: 'probe' } };
    db.social.receipts['synthetic-transfer-sender-0|historic-due-0001'] = { at: f.now() - 25 * HOUR, kind: 'transfer', fp: 'synthetic', result: { ok: true, code: 'probe' } };
  });
  assert.equal((await receipts()).length, 4504);

  // Restart: the server stops (which writes and closes the store) and a new one reads the same file.
  f.server.closeAllConnections();
  await new Promise((done) => f.server.close(done));
  store = await createStore(dir, { mode: 'grouped' });
  f = await fixture(t, { store });
  ({ receipts, seed, transfer, interact } = tools(f, store));
  const balancesNow = balancesOf(f, store, { a, b, c });
  assert.equal((await receipts()).length, 4504, 'the table came back as it was written');

  // Historical money receipts still answer: no second debit, and a different request under the id is a conflict.
  const replay = await transfer(c, b, 'historic-money-0001', 300);
  assert.deepEqual([replay.ok, replay.code, replay.duplicate, replay.balance], [true, 'sent', true, 9700]);
  assert.equal((await transfer(c, b, 'historic-money-0001', 301)).status, 409);
  assert.equal((await transfer(a, b, 'money-before-0001')).duplicate, true);
  // A new transfer is not held back by the 3,000 old interaction receipts (ids are per sender, so this one is free).
  const next = await transfer(a, b, 'seed-interact-00000000');
  assert.equal(next.ok, true, next.reason);
  const after = await balancesNow();
  assert.deepEqual(after, { a: once.a - 500, b: once.b + 500, c: once.c }, 'only the one new transfer moved money');

  // That transfer made room the new way: due receipts dropped, live money receipts all kept.
  const stored = await receipts();
  assert.equal(count(stored, 'interact'), 0, 'day-old interaction receipts are due under the ten-minute rule');
  assert.equal(count(stored, 'transfer'), 1500 + 1 + 2, 'every live money receipt survived; only the 25-hour-old one went');
  assert.ok(stored.some((item) => item.key === `${c.id}|historic-nokind-0001`), 'a receipt of unknown kind is kept as money');
  assert.ok(!stored.some((item) => item.key.endsWith('|historic-due-0001')));
  assert.equal((await transfer(c, b, 'historic-money-0001', 300)).duplicate, true);
  assert.equal((await interact(c, b, 'historic-money-0001')).status, 409, 'and it still guards its id against the other kind');
});
