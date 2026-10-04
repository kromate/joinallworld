// Recovery safety tests for two paid requests, over real HTTP against a real server:
//   - a club-radio shout-out is never charged without a request id (so a retry can never pay twice);
//   - a transfer's idempotency receipt is never thrown away to make room: when no more outcomes can
//     be remembered the request is refused before any money moves.
// State that would take a day of play to reach (an aged account, an aged friendship, earned money,
// a full receipt table) is written through the server's own store and is marked SEEDED below.
// Every check then runs through the real routes with their real limits.
//
// ADAPTED TO THIS BRANCH (from the navigation lane's test of the same name; each place is marked):
//   - WHERE RECEIPTS LIVE. There: one table, db.social.receipts, keyed "<player>|<id>". Here: each
//     player's own session record (session.once, server/routes/once.ts), so the seeding and the
//     counting below read that instead. The limits are the server's `receiptLimits` option.
//   - THE ID. There: any 8–64 character string. Here: mandatory and timed, `<unix ms>:<uuid>`; a
//     missing id is 400 client_id_required and a malformed one 400 invalid_client_id (there both
//     were 400 request_id_required).
//   - WHEN FULL. There: 200 { ok: false, code: 'receipts_full' | 'too_many_recent' }. Here: a thrown
//     503 receipts_full / 429 receipt_quota with a reason — in both, before any money moves.
//   - AFTER EXPIRY (design difference, stricter here). There: once a receipt is a day old the same id
//     is "decided afresh" — it can be charged again. Here: the id carries its own time and an id older
//     than the window is refused with 409 client_id_expired, so it can never run a second time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import { ACTION_WINDOW_MS } from './protocol.ts';

const HOUR = 3600000;

async function harness(t, options) {
  const f = await fixture(t, options);
  const store = f.server.store;
  const get = async (path, who) => { const res = await f.request(path, null, who?.cookie); return { status: res.status, ...(await res.json()) }; };
  const post = async (path, body, who) => { const res = await f.request(path, body, who?.cookie); return { status: res.status, ...(await res.json()) }; };
  const life = async (who) => (await get('/api/life?city=lagos', who)).state;
  const session = (db, who) => Object.values(db.sessions).find((record) => record.publicId === who.id);
  return { f, store, get, post, life, session };
}

test('club radio: a shout-out without a valid request id is refused before the wallet is touched; with one it is charged once', async t => {
  const { f, store, get, post, life, session } = await harness(t);
  const who = await f.device('Radio Probe');
  assert.equal((await life(who)).cash, 5000);
  // SEEDED: standing in a club (the Library), not travelling. The wallet is an ordinary new life's ₦5,000.
  await store.transact((db) => { const state = session(db, who).cities.lagos.state; state.location = 'library'; state.activeAction = null; });
  const used = async () => (await get('/api/civic/radio?city=lagos&venue=library', who)).usedToday;
  const song = { cityId: 'lagos', title: 'Synthetic Song', artist: 'Test Artist' };

  // (codes adapted: client_id_required / invalid_client_id; an untimed id such as 'radio-retry-0001' is refused too)
  for (const [label, extra, code] of [['no id', {}, 'client_id_required'], ['too short', { requestId: 'short' }, 'invalid_client_id'], ['wrong type', { requestId: 12345678 }, 'invalid_client_id'],
    ['bad characters', { requestId: 'has spaces in it' }, 'invalid_client_id'], ['not timed', { requestId: 'radio-retry-0001' }, 'invalid_client_id']]) {
    const refused = await post('/api/civic/radio/shoutout', { ...song, ...extra }, who);
    assert.deepEqual([refused.status, refused.error], [400, code], label);
    assert.equal((await life(who)).cash, 5000, `${label}: nothing was charged`);
    assert.equal(await used(), 0, `${label}: nothing was queued or counted`);
  }
  assert.equal((await get('/api/civic/radio?city=lagos&venue=library', who)).playing, null);

  f.advance(61000); // one more refusal than the original list: step past the per-minute radio limit
  const body = { ...song, requestId: f.id() };
  const first = await post('/api/civic/radio/shoutout', body, who);
  assert.deepEqual([first.status, first.ok, first.code, first.duplicate], [200, true, 'queued', undefined]);
  assert.equal((await life(who)).cash, 4500);
  const retry = await post('/api/civic/radio/shoutout', body, who);
  assert.deepEqual([retry.status, retry.ok, retry.duplicate, retry.entry.id], [200, true, true, first.entry.id]);
  assert.equal((await life(who)).cash, 4500, 'the retry is not charged');
  assert.equal(await used(), 1);
});

/** Three registered players; `a` and `c` can each give money to `b` through the real transfer route. */
async function transferSetup(t, receiptLimits) {
  const h = await harness(t, { receiptLimits });
  const { f, store, get, life, session } = h;
  const a = await f.device('Sender Probe'), b = await f.device('Recipient Probe'), c = await f.device('Other Sender');
  for (const who of [a, b, c]) { await get('/api/social/me', who); await life(who); }
  // SEEDED: accounts older than a day, friendships older than an hour, and earned money to give.
  await store.transact((db) => {
    for (const who of [a, b, c]) db.social.players[who.id].first = f.now() - 25 * HOUR;
    for (const sender of [a, c]) {
      db.social.players[sender.id].friends[b.id] = f.now() - 2 * HOUR;
      db.social.players[b.id].friends[sender.id] = f.now() - 2 * HOUR;
      const state = session(db, sender).cities.lagos.state;
      state.cash = 10000; state.social.earned = 5000;
    }
  });
  /** Wallets after anything owed to the recipient has been applied. */
  const balances = async () => { await get('/api/social/me', b); return { a: (await life(a)).cash, b: (await life(b)).cash, c: (await life(c)).cash }; };
  /** The receipt ids one player holds (adapted: session.once instead of db.social.receipts). */
  const receipts = (who) => store.read((db) => Object.keys(session(db, who).once ?? {}));
  const total = async () => (await Promise.all([a, b, c].map(receipts))).flat().length;
  /** SEEDED: `count` monetary transfer receipts in `who`'s own record, written at `at` (the id carries the same time, as a real one does). */
  const fill = (who, count, at) => store.transact((db) => {
    const record = session(db, who); record.once ||= {};
    for (let i = 0; i < count; i++) record.once[`${at}:00000000-0000-4000-8000-${String(i).padStart(12, '0')}`] = { at, kind: 'transfer', fp: 'synthetic', result: { ok: true, code: 'probe' } };
  });
  return { ...h, a, b, c, balances, receipts, total, fill };
}

test('transfers: a live receipt is never evicted; with no room left the request is refused before any money moves', async t => {
  const GLOBAL = 60;
  const { f, post, a, b, c, balances, receipts, total, fill } = await transferSetup(t, { perPlayer: 40, global: GLOBAL });
  const body = { to: b.id, amount: 500, cityId: 'lagos', clientId: f.id() };

  const first = await post('/api/social/transfers', body, a);
  assert.equal(first.ok, true, first.reason);
  const once = await balances();
  assert.deepEqual(once, { a: 9500, b: 5500, c: 10000 });
  // Duplicate and conflict, before any pressure.
  assert.equal((await post('/api/social/transfers', body, a)).duplicate, true);
  assert.equal((await post('/api/social/transfers', { ...body, amount: 600 }, a)).status, 409);
  assert.deepEqual(await balances(), once);

  // Capacity pressure: the server holds as many receipts as it may, all still live.
  await fill(b, 30, f.now()); await fill(c, GLOBAL - 31, f.now());
  assert.equal(await total(), GLOBAL);
  f.advance(61000); // the server-wide count is taken again from the stored sessions once a minute

  // A different player's real transfer arrives. It used to evict the 500 oldest receipts, live or not.
  const otherId = f.id();
  const pressure = await post('/api/social/transfers', { to: b.id, amount: 100, cityId: 'lagos', clientId: otherId }, c);
  assert.deepEqual([pressure.status, pressure.error], [503, 'receipts_full']); // adapted: thrown, not 200 { ok: false }
  assert.match(pressure.reason, /Nothing was charged/);
  assert.deepEqual(await balances(), once, 'the refused transfer debited and credited nobody');
  assert.equal(await total(), GLOBAL, 'nothing was evicted and nothing was added');
  assert.ok((await receipts(a)).includes(body.clientId), 'the earlier sender’s receipt is still there');
  assert.ok(!(await receipts(c)).includes(otherId));

  // The same client id is still answered from its receipt: no second debit, no second credit.
  const replay = await post('/api/social/transfers', body, a);
  assert.deepEqual([replay.ok, replay.code, replay.duplicate, replay.balance], [true, 'sent', true, 9500]);
  assert.equal((await post('/api/social/transfers', { ...body, amount: 600 }, a)).status, 409, 'and a different request under that id is still a conflict');
  // A new request from the first sender has no room either, and is not charged.
  const fresh = await post('/api/social/transfers', { ...body, clientId: f.id() }, a);
  assert.deepEqual([fresh.status, fresh.error], [503, 'receipts_full']);
  assert.deepEqual(await balances(), once);

  // THE LIMIT OF THE GUARANTEE. Past the receipt window receipts may be forgotten and room returns.
  f.advance(ACTION_WINDOW_MS + HOUR);
  const later = await post('/api/social/transfers', { to: b.id, amount: 100, cityId: 'lagos', clientId: f.id() }, c);
  assert.notEqual(later.error, 'receipts_full', 'expired receipts no longer hold the table');
  assert.equal(later.ok, true, later.reason);
  assert.equal((await receipts(c)).length, 1, 'every expired receipt of that player was dropped');
  // DESIGN DIFFERENCE (stricter here): the day-old id is not "decided afresh" — it is refused, and nothing moves.
  const afterExpiry = await balances();
  const stale = await post('/api/social/transfers', body, a);
  assert.deepEqual([stale.status, stale.error], [409, 'client_id_expired']);
  assert.notEqual(stale.duplicate, true);
  assert.deepEqual(await balances(), afterExpiry, 'an expired id can never be charged a second time');
});

test('transfers: one sender cannot fill the table for everyone; expired receipts are dropped before a live one would be', async t => {
  const PER_PLAYER = 40;
  const { f, post, a, b, c, balances, receipts, fill } = await transferSetup(t, { perPlayer: PER_PLAYER, global: 1000 });
  // SEEDED: `c` already holds as many live receipts as one player may.
  await fill(c, PER_PLAYER, f.now());
  const before = await balances();
  const refused = await post('/api/social/transfers', { to: b.id, amount: 100, cityId: 'lagos', clientId: f.id() }, c);
  assert.deepEqual([refused.status, refused.error], [429, 'receipt_quota']); // adapted: thrown, not 200 too_many_recent
  assert.deepEqual(await balances(), before, 'refused before the debit');
  // Another sender is not affected by that player's count.
  const firstId = f.id();
  const other = await post('/api/social/transfers', { to: b.id, amount: 500, cityId: 'lagos', clientId: firstId }, a);
  assert.equal(other.ok, true, other.reason);
  assert.deepEqual(await balances(), { a: before.a - 500, b: before.b + 500, c: before.c });

  // SEEDED: the sender's own record is filled to its limit with receipts that are already more than a day old.
  await fill(a, PER_PLAYER - 1, f.now() - ACTION_WINDOW_MS - 1);
  assert.equal((await receipts(a)).length, PER_PLAYER);
  f.advance(61000); // past the per-minute transfer limit
  const secondId = f.id();
  const next = await post('/api/social/transfers', { to: b.id, amount: 100, cityId: 'lagos', clientId: secondId }, a);
  assert.equal(next.ok, true, next.reason);
  const left = await receipts(a);
  assert.deepEqual(left.sort(), [firstId, secondId].sort(), 'live receipts survived; only expired receipts made the room');
  assert.equal((await receipts(c)).length, PER_PLAYER);
  assert.equal((await post('/api/social/transfers', { to: b.id, amount: 500, cityId: 'lagos', clientId: firstId }, a)).duplicate, true);
});
