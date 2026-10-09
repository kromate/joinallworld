// Recovery safety tests: money receipts and interaction receipts have separate allowances.
//   - a flood of interaction receipts neither blocks a new transfer nor removes a stored money receipt;
//   - a full money allowance refuses a transfer before the debit and leaves interactions working;
//   - stored receipts are read as they are after a restart, and one of an unknown kind counts as money.
// Everything is checked over real HTTP (and real sockets for the venue room). State that would take a
// day of play or thousands of requests to reach is written through the server's own store and is
// marked SEEDED; the routes then run with their real rules.
//
// ADAPTED TO THIS BRANCH (from the navigation lane's test of the same name; each place is marked):
//   - WHERE RECEIPTS LIVE. There: one table, db.social.receipts, keyed "<player>|<id>". Here: each
//     player's own session record (session.once, server/routes/once.ts). The allowances are the
//     server's `receiptLimits` option ({ perPlayer, global } for money, { lightPerPlayer, lightGlobal }
//     for interactions), set small here so that "full" is reached with a few seeded receipts.
//   - THE ID. There: any 8–64 character string. Here: mandatory and timed, `<unix ms>:<uuid>`.
//   - WHEN FULL. There: 200 { ok: false, code: 'receipts_full' | 'too_many_recent' }. Here: a thrown
//     503 receipts_full / 429 receipt_quota with a reason — in both, before anything is applied.
//   - THE SERVER-WIDE COUNT is taken again from the stored sessions once a minute, so after seeding
//     the clock is stepped 61 s (and the two players join their room again).
//   - TWO PARTS ARE SKIPPED, each with the conflict named where it stands: interaction receipts
//     that are due after ten minutes, and reading the earlier build's shared table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fixture } from './test-fixture.ts';
import { createServer } from './server.ts';
import { LIGHT_KINDS } from './routes/once.ts';
import type { Db, OnceReceipt, SessionRecord, Store } from './types.ts';
import type { LifeState } from '../src/types/life.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
/** A parsed JSON reply with its HTTP status: only the fields these tests read. */
interface Reply { status: number; ok?: boolean; code?: unknown; error?: unknown; reason?: string; duplicate?: boolean; balance?: unknown; state?: LifeState }
const reply = async (res: Response): Promise<Reply> => { const body: unknown = await res.json(); if (!isRecord(body)) throw Error('JSON object expected'); return { ...body, status: res.status }; };
interface Who { id: string; cookie: string }
type Fixture = Awaited<ReturnType<typeof fixture>>;
/** A stored receipt as the tests may seed it: one of an unknown kind has no `kind` at all. */
type SeededReceipt = Omit<OnceReceipt, 'kind'> & { kind?: string };
const receiptsOf = (record: SessionRecord): Record<string, SeededReceipt> => { record.once ||= {}; return record.once; };
const stateOf = (reply: Reply): LifeState => { if (!reply.state) throw Error('no state'); return reply.state; };

const HOUR = 3600000;
const LIMITS = { perPlayer: 50, global: 30, lightPerPlayer: 12, lightGlobal: 20 };

function tools(f: Fixture) {
  const store: Store = f.server.store;
  const get = async (path: string, who?: Who) => reply(await f.request(path, null, who?.cookie));
  const post = async (path: string, body: object, who?: Who) => reply(await f.request(path, body, who?.cookie));
  const life = async (who: Who): Promise<LifeState> => stateOf(await get('/api/life?city=lagos', who));
  const session = (db: Db, who: Who): SessionRecord => { const found = Object.values(db.sessions).find((record) => record.publicId === who.id); if (!found) throw Error('no session'); return found; };
  const lagos = (db: Db, who: Who) => { const city = session(db, who).cities.lagos; if (!city) throw Error('no lagos life'); return city; };
  const player = (db: Db, id: string) => { const record = db.social?.players[id]; if (!record) throw Error('no social player'); return record; };
  /** Every stored receipt on the server: { owner, id, kind } (adapted: session.once instead of db.social.receipts). */
  const receipts = () => store.read((db) => Object.values(db.sessions).flatMap((record) => Object.entries(record.once ?? {}).map(([id, receipt]) => ({ owner: record.publicId, id, kind: receipt.kind }))));
  /** SEEDED: `count` receipts of `kind` in `who`'s own record, written at `at` (the id carries the same time, as a real one does). */
  let seeded = 0;
  const seed = (who: Who, kind: string, count: number, at: number) => store.transact((db) => {
    const once = receiptsOf(session(db, who));
    for (let i = 0; i < count; i++) once[`${at}:00000000-0000-4000-8000-${String(seeded += 1).padStart(12, '0')}`] = { at, kind, fp: 'synthetic', result: { ok: true, code: 'probe' } };
  });
  const transfer = (who: Who, to: Who, clientId: string, amount = 500) => post('/api/social/transfers', { to: to.id, amount, cityId: 'lagos', clientId }, who);
  const interact = (who: Who, target: Who, clientId: string, action = 'hello') => post(`/api/social/players/${target.id}/interact`, { action, cityId: 'lagos', clientId }, who);
  return { store, get, post, life, session, lagos, player, receipts, seed, transfer, interact };
}
/** Three registered players; `a` and `c` can each give money to `b` through the real transfer route. */
async function players(f: Fixture) {
  const { store, get, life, lagos, player } = tools(f);
  const a = await f.device('Sender Probe'), b = await f.device('Recipient Probe'), c = await f.device('Other Sender');
  for (const who of [a, b, c]) { await get('/api/social/me', who); await life(who); }
  // SEEDED: accounts older than a day, friendships older than an hour, and earned money to give.
  await store.transact((db) => {
    for (const who of [a, b, c]) player(db, who.id).first = f.now() - 25 * HOUR;
    for (const sender of [a, c]) {
      player(db, sender.id).friends[b.id] = f.now() - 2 * HOUR;
      player(db, b.id).friends[sender.id] = f.now() - 2 * HOUR;
      const state = lagos(db, sender).state;
      state.cash = 10000; state.social.earned = 5000;
    }
  });
  /** Wallets, after anything owed to the recipient has been applied. */
  const balances = async () => { await get('/api/social/me', b); return { a: (await life(a)).cash, b: (await life(b)).cash, c: (await life(c)).cash }; };
  return { a, b, c, balances };
}
type Held = { owner: string; id: string; kind: string | undefined };
const count = (list: Held[], kind: string) => list.filter((item) => item.kind === kind).length;
const holds = (list: Held[], who: Who, id: string) => list.some((item) => item.owner === who.id && item.id === id);

test('the light class contains only the explicitly approved non-money operations', () => {
  // The published Family, message editing, trust and real-value metadata routes use the
  // same isolated allowance. Transfers, rewards and unknown kinds remain in the money class.
  assert.deepEqual([...LIGHT_KINDS], [
    'interact', 'message.update', 'family', 'trust.phone', 'trust.id.start',
    'real-value.create', 'real-value.edit', 'real-value.close', 'real-value.report', 'real-value.event',
    'real-value.contact-request', 'real-value.contact-answer', 'real-value.contact-revoke',
  ]);
});

test('an interaction flood neither blocks a new transfer nor removes a money receipt', async t => {
  const f = await fixture(t, { receiptLimits: LIMITS });
  const { life, receipts, seed, transfer, interact } = tools(f);
  const { a, b, c, balances } = await players(f);
  await f.joinRoom(a); await f.joinRoom(b);

  // Real requests first: one interaction and one transfer, each with its receipt.
  const helloId = f.id(), moneyId = f.id();
  const hello = await interact(a, b, helloId);
  assert.deepEqual([hello.ok, hello.code], [true, 'interacted'], hello.reason);
  assert.equal((await interact(a, b, helloId)).duplicate, true);
  const first = await transfer(a, b, moneyId);
  assert.equal(first.ok, true, first.reason);
  const once = await balances();
  assert.deepEqual(once, { a: 9500, b: 5500, c: 10000 });
  const closeness = (await life(a)).social.rel[b.id];

  // SEEDED flood: the server-wide interaction allowance is completely full of receipts that are still live
  // (in `c`'s record and in `b`'s, each below the per-player allowance).
  await seed(c, 'interact', LIMITS.lightPerPlayer - 1, f.now()); await seed(b, 'interact', LIMITS.lightGlobal - LIMITS.lightPerPlayer, f.now());
  assert.equal(count(await receipts(), 'interact'), LIMITS.lightGlobal);
  f.advance(61000); // (adapted) the server-wide count is taken again from the stored sessions once a minute
  await f.joinRoom(a); await f.joinRoom(b);

  // Interactions are refused — before anything is applied …
  const flooded = await interact(a, b, f.id(), 'gist');
  assert.deepEqual([flooded.status, flooded.error], [503, 'receipts_full']); // adapted: thrown, not 200 { ok: false }
  assert.deepEqual((await life(a)).social.rel[b.id], closeness, 'the refused interaction changed nothing');
  // … while money is untouched by the flood: a new, valid transfer goes through, exactly once.
  const freshId = f.id();
  const fresh = await transfer(c, b, freshId, 100);
  assert.deepEqual([fresh.status, fresh.ok, fresh.code], [200, true, 'sent'], fresh.reason);
  assert.deepEqual(await balances(), { a: 9500, b: 5600, c: 9900 });
  assert.equal((await transfer(c, b, freshId, 100)).duplicate, true);
  assert.equal((await transfer(a, b, moneyId)).duplicate, true, 'the earlier money receipt is still honoured');
  assert.deepEqual(await balances(), { a: 9500, b: 5600, c: 9900 }, 'no second debit or credit');
  const stored = await receipts();
  assert.deepEqual([count(stored, 'interact'), count(stored, 'transfer')], [LIMITS.lightGlobal, 2], 'nothing was evicted, in either class');
  // One client id is one request, whatever its kind: reusing a money id for an interaction is a conflict.
  assert.equal((await interact(a, b, moneyId)).status, 409);
  assert.equal((await transfer(a, b, helloId)).status, 409);
});

// SKIPPED — a standing design difference, not a defect. There, an interaction receipt is due after
// LIMITS.interactReceiptMs (ten minutes): the flood then drains by itself, and "a ten-minute-old
// interaction id is decided afresh, not replayed" — the same id can be applied a second time. Here
// an id carries its own time and every receipt is kept for the whole id window (24 hours); an id
// older than that is refused with 409 client_id_expired and is never run again. Dropping interaction
// receipts after ten minutes would mean either running an old id twice (what the timed id exists to
// prevent) or a second, shorter id window for one kind. Kept: ours. What that test protects — money
// is never held back by interactions — is covered by the test above and the one below; that capacity
// returns with time and never by forgetting a live receipt is covered in server/once.test.ts.
test('interaction receipts are short-lived: after ten minutes the flood has expired and an old interaction id is decided afresh', { skip: 'design conflict: receipts here live as long as their timed id can be accepted (24 h), and an expired id is refused, never decided afresh' }, () => {});

test('a full money allowance refuses a transfer before the debit and leaves interactions working; per-player allowances are separate too', async t => {
  const f = await fixture(t, { receiptLimits: LIMITS });
  const { life, receipts, seed, transfer, interact } = tools(f);
  const { a, b, c, balances } = await players(f);
  await f.joinRoom(a); await f.joinRoom(b);
  const before = await balances();

  // SEEDED: `a` already holds as many live interaction receipts as one player may.
  await seed(a, 'interact', LIMITS.lightPerPlayer, f.now());
  const tooMany = await interact(a, b, f.id());
  assert.deepEqual([tooMany.status, tooMany.error], [429, 'receipt_quota']); // adapted: thrown, not 200 { ok: false, code: 'too_many_recent' }
  assert.equal((await life(a)).social.rel?.[b.id], undefined, 'refused before anything was applied');
  // That player's money allowance is a different count: their transfer is decided on its own.
  const ownId = f.id();
  const sent = await transfer(a, b, ownId);
  assert.equal(sent.ok, true, sent.reason);
  assert.deepEqual(await balances(), { a: before.a - 500, b: before.b + 500, c: before.c });
  // Another player's interactions are not affected by `a`'s count.
  const other = await interact(b, a, f.id());
  assert.deepEqual([other.ok, other.code], [true, 'interacted'], other.reason);

  // SEEDED: the server-wide money allowance is full of live transfer receipts (in `b`'s record).
  await seed(b, 'transfer', LIMITS.global - count(await receipts(), 'transfer'), f.now());
  assert.equal(count(await receipts(), 'transfer'), LIMITS.global);
  f.advance(61000); // (adapted) the server-wide count is taken again once a minute
  await f.joinRoom(a); await f.joinRoom(b);
  const paid = await balances();
  const fullId = f.id();
  const refused = await transfer(c, b, fullId, 100);
  assert.deepEqual([refused.status, refused.error], [503, 'receipts_full']); // adapted: thrown, not 200 { ok: false }
  assert.match(String(refused.reason), /Nothing was charged/);
  assert.deepEqual(await balances(), paid, 'refused before the debit: nobody was debited or credited');
  assert.equal((await transfer(a, b, ownId)).duplicate, true, 'a stored money receipt still answers');
  const stored = await receipts();
  assert.equal(count(stored, 'transfer'), LIMITS.global, 'nothing evicted, nothing added');
  assert.ok(!holds(stored, c, fullId));
  // A full money allowance does not stop interactions.
  const still = await interact(b, a, f.id(), 'gist');
  assert.equal(still.status, 200);
  assert.ok(!['receipts_full', 'receipt_quota'].includes(String(still.error ?? still.code)), `decided by the game, not by receipt capacity (${still.code})`);
});

test('stored receipts are read as they are after a restart: money kept, an unknown kind counted as money, ids guarded across kinds', async t => {
  const f = await fixture(t, { receiptLimits: LIMITS }), time = f;
  f.advance(24 * HOUR); // the test clock starts near zero; a 23-hour-old timed id needs a day behind it
  const { store, session, receipts, seed, transfer } = tools(f);
  const { a, b, c, balances } = await players(f);
  const beforeId = f.id();
  const first = await transfer(a, b, beforeId);
  assert.equal(first.ok, true, first.reason);
  const start = await balances();

  // SEEDED: what an earlier run left behind, 23 hours ago and still live — interactions up to the whole
  // server-wide interaction allowance, money receipts, a real-shaped money receipt of `c`, and one of a
  // kind this build does not know.
  const old = f.now() - 23 * HOUR;
  const historicId = `${old}:11111111-1111-4111-8111-111111111111`, unknownId = `${old}:22222222-2222-4222-8222-222222222222`;
  await seed(b, 'interact', LIMITS.lightPerPlayer, old); await seed(c, 'interact', LIMITS.lightGlobal - LIMITS.lightPerPlayer, old);
  await seed(b, 'transfer', 10, old);
  await store.transact((db) => {
    const once = receiptsOf(session(db, c));
    once[historicId] = { at: old, kind: 'transfer', fp: JSON.stringify([b.id, 300, 'lagos']), result: { ok: true, code: 'sent', amount: 300, to: { id: b.id, name: 'Recipient Probe' }, credited: false, balance: 9700 } };
    once[unknownId] = { at: old, fp: 'synthetic', result: { ok: true, code: 'probe' } };
  });
  const written = (await receipts()).length;
  assert.equal(written, LIMITS.lightGlobal + 10 + 3);

  // Restart: the server stops (which writes and closes the store) and a new one reads the same file.
  await f.flush();
  f.server.closeAllConnections();
  await new Promise((done) => f.server.close(done));
  await f.server.store.close?.();
  const again = await createServer({ dataDir: f.dir, now: f.now, sessionTtlMs: 2592000000, receiptLimits: LIMITS });
  t.after(async () => { again.closeAllConnections(); await new Promise((done) => again.close(done)); await again.store?.close?.().catch(() => {}); });
  again.listen(0, '127.0.0.1'); await once(again, 'listening');
  const address = again.address();
  if (!address || typeof address === 'string') throw Error('The restarted server is not listening on a port');
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (path: string, body: object | null, who: Who) => reply(await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Cookie: who.cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  const send = (who: Who, clientId: string, amount = 500) => call('/api/social/transfers', { to: b.id, amount, cityId: 'lagos', clientId }, who);
  const againStore: Store = again.store;
  const stored = () => againStore.read((db) => Object.values(db.sessions).flatMap((record) => Object.entries(record.once ?? {}).map(([id, receipt]) => ({ owner: record.publicId, id, kind: receipt.kind }))));
  const wallets = async () => { await call('/api/social/me', null, b); const cash = async (who: Who) => stateOf(await call('/api/life?city=lagos', null, who)).cash; return { a: await cash(a), b: await cash(b), c: await cash(c) }; };
  assert.equal((await stored()).length, written, 'the receipts came back as they were written');

  // Historical money receipts still answer: no second debit, and a different request under the id is a conflict.
  const replay = await send(c, historicId, 300);
  assert.equal(replay.status, 200, JSON.stringify(replay));
  assert.deepEqual([replay.ok, replay.code, replay.duplicate, replay.balance], [true, 'sent', true, 9700]);
  assert.equal((await send(c, historicId, 301)).status, 409);
  assert.equal((await send(a, beforeId)).duplicate, true);
  // A new transfer is not held back by the old interaction receipts, although their allowance is full.
  const next = await send(a, `${f.now()}:33333333-3333-4333-8333-333333333333`);
  assert.equal(next.ok, true, next.reason);
  assert.deepEqual(await wallets(), { a: start.a - 500, b: start.b + 500, c: start.c }, 'only the one new transfer moved money');

  // Nothing live was dropped to make that room, in either class.
  const after = await stored();
  assert.equal(count(after, 'interact'), LIMITS.lightGlobal, 'live interaction receipts are kept (they are due with their id, after 24 hours)');
  assert.equal(count(after, 'transfer'), 10 + 1 + 2, 'every live money receipt survived');
  assert.ok(holds(after, c, unknownId), 'a receipt of unknown kind is kept');
  assert.equal((await send(c, historicId, 300)).duplicate, true);
  assert.equal((await call(`/api/social/players/${b.id}/interact`, { action: 'hello', cityId: 'lagos', clientId: historicId }, c)).status, 409, 'and it still guards its id against the other kind');

  // The receipt of unknown kind counts as MONEY: `b` holds 10 money receipts, the three senders' are 3,
  // and with the unknown one that is 14 of 30 — so 16 more fill the server-wide money allowance exactly.
  await againStore.transact((db) => {
    const once = receiptsOf(session(db, b));
    for (let i = 0; i < LIMITS.global - 14; i++) once[`${old}:44444444-4444-4444-8444-${String(i).padStart(12, '0')}`] = { at: old, kind: 'transfer', fp: 'synthetic', result: { ok: true, code: 'probe' } };
  });
  time.advance(61000); // the server-wide count is taken again once a minute
  const full = await send(a, `${f.now()}:55555555-5555-4555-8555-555555555555`, 100);
  assert.deepEqual([full.status, full.error], [503, 'receipts_full'], 'the unknown kind used one place of the money allowance');
});

// SKIPPED — a storage difference. There, the earlier build's shared table (db.social.receipts, opaque
// ids, 24 hours) is read as it is after a restart: its money receipts keep answering and its
// interaction receipts become due under the ten-minute rule. Here that table is not read at all: it is
// deleted on first use (server/social/service.ts, col()), which is safe because every id it holds is
// an untimed string, and an untimed id is refused with 400 invalid_client_id before anything runs —
// so none of those requests can be replayed, charged again or conflict with a new one. Kept: ours.
// The parts that do apply — stored receipts surviving a restart, old interactions not holding money
// back, an unknown kind counted as money, an id guarded across kinds — are the test above.
test('a receipt table written under the old shared allowance is read as it is after a restart: money kept, old interactions due', { skip: 'storage conflict: the earlier shared table is not kept here; its untimed ids are refused, so nothing in it can be replayed' }, () => {});
