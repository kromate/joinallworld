// Recovery safety tests for two paid requests, over real HTTP against a real server:
//   - a club-radio shout-out is never charged without a request id (so a retry can never pay twice);
//   - a transfer's idempotency receipt is never thrown away to make room: when no more outcomes can
//     be remembered the request is refused before any money moves.
// State that would take a day of play to reach (an aged account, an aged friendship, earned money,
// a full receipt table) is written through the server's own store and is marked SEEDED below.
// Every check then runs through the real routes with their real limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.js';
import { LIMITS } from './social/service.js';

const HOUR = 3600000;

async function harness(t) {
  const f = await fixture(t);
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

  for (const [label, extra] of [['no id', {}], ['too short', { requestId: 'short' }], ['wrong type', { requestId: 12345678 }], ['bad characters', { requestId: 'has spaces in it' }]]) {
    const refused = await post('/api/civic/radio/shoutout', { ...song, ...extra }, who);
    assert.deepEqual([refused.status, refused.error], [400, 'request_id_required'], label);
    assert.equal((await life(who)).cash, 5000, `${label}: nothing was charged`);
    assert.equal(await used(), 0, `${label}: nothing was queued or counted`);
  }
  assert.equal((await get('/api/civic/radio?city=lagos&venue=library', who)).playing, null);

  const body = { ...song, requestId: 'radio-retry-0001' };
  const first = await post('/api/civic/radio/shoutout', body, who);
  assert.deepEqual([first.status, first.ok, first.code, first.duplicate], [200, true, 'queued', undefined]);
  assert.equal((await life(who)).cash, 4500);
  const retry = await post('/api/civic/radio/shoutout', body, who);
  assert.deepEqual([retry.status, retry.ok, retry.duplicate, retry.entry.id], [200, true, true, first.entry.id]);
  assert.equal((await life(who)).cash, 4500, 'the retry is not charged');
  assert.equal(await used(), 1);
});

/** Three registered players; `a` and `c` can each give money to `b` through the real transfer route. */
async function transferSetup(t) {
  const h = await harness(t);
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
  const receipts = () => store.read((db) => Object.keys(db.social.receipts));
  /** SEEDED: `count` monetary transfer receipts of synthetic senders, written at `at`. */
  const fill = (count, at, owner = (i) => `synthetic-sender-${i % 50}`) => store.transact((db) => {
    for (let i = 0; i < count; i++) db.social.receipts[`${owner(i)}|seed-${String(i).padStart(8, '0')}`] = { at, kind: 'transfer', fp: 'synthetic', result: { ok: true, code: 'probe' } };
  });
  return { ...h, a, b, c, balances, receipts, fill };
}

test('transfers: a live receipt is never evicted; with no room left the request is refused before any money moves', async t => {
  const { f, post, a, b, c, balances, receipts, fill } = await transferSetup(t);
  const body = { to: b.id, amount: 500, cityId: 'lagos', clientId: 'transfer-same-id-0001' };
  const key = `${a.id}|${body.clientId}`;

  const first = await post('/api/social/transfers', body, a);
  assert.equal(first.ok, true, first.reason);
  const once = await balances();
  assert.deepEqual(once, { a: 9500, b: 5500, c: 10000 });
  // Duplicate and conflict, before any pressure.
  assert.equal((await post('/api/social/transfers', body, a)).duplicate, true);
  assert.equal((await post('/api/social/transfers', { ...body, amount: 600 }, a)).status, 409);
  assert.deepEqual(await balances(), once);

  // Capacity pressure: the table is filled with receipts that are all still live.
  await fill(LIMITS.receipts - (await receipts()).length, f.now());
  assert.equal((await receipts()).length, LIMITS.receipts);

  // A different player's real transfer arrives. It used to evict the 500 oldest receipts, live or not.
  const pressure = await post('/api/social/transfers', { to: b.id, amount: 100, cityId: 'lagos', clientId: 'other-transfer-0001' }, c);
  assert.deepEqual([pressure.status, pressure.ok, pressure.code], [200, false, 'receipts_full']);
  assert.match(pressure.reason, /Nothing was sent or charged/);
  assert.deepEqual(await balances(), once, 'the refused transfer debited and credited nobody');
  const kept = await receipts();
  assert.equal(kept.length, LIMITS.receipts, 'nothing was evicted and nothing was added');
  assert.ok(kept.includes(key), 'the earlier sender’s receipt is still there');
  assert.ok(!kept.includes(`${c.id}|other-transfer-0001`));

  // The same client id is still answered from its receipt: no second debit, no second credit.
  const replay = await post('/api/social/transfers', body, a);
  assert.deepEqual([replay.ok, replay.code, replay.duplicate, replay.balance], [true, 'sent', true, 9500]);
  assert.equal((await post('/api/social/transfers', { ...body, amount: 600 }, a)).status, 409, 'and a different request under that id is still a conflict');
  // A new request from the first sender has no room either, and is not charged.
  const fresh = await post('/api/social/transfers', { ...body, clientId: 'transfer-new-id-0002' }, a);
  assert.deepEqual([fresh.ok, fresh.code], [false, 'receipts_full']);
  assert.deepEqual(await balances(), once);

  // THE LIMIT OF THE GUARANTEE. Past LIMITS.receiptMs receipts may be forgotten: room returns, and the
  // old client id is then an ordinary new request rather than a replay.
  f.advance(LIMITS.receiptMs + HOUR);
  const later = await post('/api/social/transfers', { to: b.id, amount: 100, cityId: 'lagos', clientId: 'other-transfer-0001' }, c);
  assert.notEqual(later.code, 'receipts_full', 'expired receipts no longer hold the table');
  const afterExpiry = await receipts();
  assert.ok(!afterExpiry.includes(key), 'the day-old receipt has been forgotten');
  assert.ok(afterExpiry.length < 10, 'every expired receipt was dropped');
  const stale = await post('/api/social/transfers', body, a);
  assert.notEqual(stale.duplicate, true, 'after expiry the same client id is decided afresh, not replayed');
});

test('transfers: one sender cannot fill the table for everyone; expired receipts are dropped before a live one would be', async t => {
  const { f, post, a, b, c, balances, receipts, fill } = await transferSetup(t);
  // SEEDED: `c` already holds as many live receipts as one player may.
  await fill(LIMITS.receiptsPerPlayer, f.now(), () => c.id);
  const before = await balances();
  const refused = await post('/api/social/transfers', { to: b.id, amount: 100, cityId: 'lagos', clientId: 'own-cap-0001' }, c);
  assert.deepEqual([refused.status, refused.ok, refused.code], [200, false, 'too_many_recent']);
  assert.deepEqual(await balances(), before, 'refused before the debit');
  // Another sender is not affected by that player's count.
  const other = await post('/api/social/transfers', { to: b.id, amount: 500, cityId: 'lagos', clientId: 'unaffected-0001' }, a);
  assert.equal(other.ok, true, other.reason);
  assert.deepEqual(await balances(), { a: before.a - 500, b: before.b + 500, c: before.c });

  // SEEDED: fill the rest of the table with receipts that are already more than a day old.
  await fill(LIMITS.receipts - (await receipts()).length, f.now() - LIMITS.receiptMs - 1, (i) => `expired-sender-${i % 50}`);
  assert.equal((await receipts()).length, LIMITS.receipts);
  f.advance(61000); // past the per-minute transfer limit, well inside the hourly housekeeping interval
  const next = await post('/api/social/transfers', { to: b.id, amount: 100, cityId: 'lagos', clientId: 'unaffected-0002' }, a);
  assert.equal(next.ok, true, next.reason);
  const left = await receipts();
  assert.ok(left.includes(`${a.id}|unaffected-0001`) && left.includes(`${a.id}|unaffected-0002`), 'live receipts survived');
  assert.equal(left.filter((key) => key.startsWith('expired-sender-')).length, 0, 'only expired receipts made the room');
  assert.equal(left.filter((key) => key.startsWith(`${c.id}|`)).length, LIMITS.receiptsPerPlayer);
  assert.equal((await post('/api/social/transfers', { to: b.id, amount: 500, cityId: 'lagos', clientId: 'unaffected-0001' }, a)).duplicate, true);
});
