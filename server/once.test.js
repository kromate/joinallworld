// Exactly-once receipts (server/routes/once.js) through the real routes: mandatory ids, conflicts,
// expiry, capacity without eviction, restart, concurrency — and the gift and group rules that
// depend on them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.js';
import { createServer } from './server.js';
import { ONCE } from './routes/once.js';
import { ROUTE_MODULES } from './routes/index.js';
import { registerSystem } from '../src/game/registry.js';

const HOUR = 3600000, DAY = 86400000;
const get = async (f, path, who) => { const res = await f.request(path, null, who?.cookie); return { status: res.status, ...(await res.json()) }; };
const post = async (f, path, body, who) => { const res = await f.request(path, body, who?.cookie); return { status: res.status, ...(await res.json()) }; };
const database = async (f) => JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8'));
const life = async (f, who, city = 'lagos') => (await get(f, `/api/life?city=${city}`, who)).state;
const sessionOf = (db, who) => Object.values(db.sessions).find((item) => item.publicId === who.id);

/** Registered players with lives; every pair (first, other) are old friends, and `first` holds earned money. */
async function friends(f, names, { lives = true } = {}) {
  const devices = [];
  for (const name of names) { const device = await f.device(name); await get(f, '/api/social/me', device); if (lives) await life(f, device); devices.push(device); }
  await f.server.store.transact((db) => {
    for (const who of devices) db.social.players[who.id].first = f.now() - 25 * HOUR;
    for (const sender of devices) for (const other of devices) if (sender !== other) db.social.players[sender.id].friends[other.id] = f.now() - 2 * HOUR;
    for (const who of devices) { const state = sessionOf(db, who).cities.lagos?.state; if (state) { state.cash = 10000; state.social.earned = 5000; } }
  });
  return devices;
}
/** Put a new life in a club with the standard ₦5,000 (seeded location only; the route and the rules are real). */
async function inClub(f, name) {
  const who = await f.device(name); await life(f, who);
  await f.server.store.transact((db) => { const state = sessionOf(db, who).cities.lagos.state; state.location = 'library'; state.activeAction = null; });
  return who;
}
async function restart(t, f) {
  f.server.closeAllConnections(); await new Promise((resolve) => f.server.close(resolve));
  const again = await createServer({ dataDir: f.dir, now: f.now, sessionTtlMs: 2592000000 });
  again.listen(0, '127.0.0.1'); await once(again, 'listening');
  t.after(async () => { again.closeAllConnections(); await new Promise((resolve) => again.close(resolve)); });
  return async (path, body, who) => { const res = await fetch(`http://127.0.0.1:${again.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: who.cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, ...(await res.json()) }; };
}

test('a shout-out needs a request id: without one nothing is charged; with one a retry, a changed body, an expired id and a restart all charge once', async (t) => {
  const f = await fixture(t);
  f.advance(3 * DAY); // so that "a day ago" is a time the clock has actually seen
  const who = await inClub(f, 'Radio Ada');
  const song = { cityId: 'lagos', title: 'Water', artist: 'Tyla' };
  // No id, or not an id: refused before anything is charged, however often it is sent.
  for (const requestId of [undefined, '', null]) {
    const refused = await post(f, '/api/civic/radio/shoutout', { ...song, requestId }, who);
    assert.deepEqual([refused.status, refused.error], [400, 'client_id_required']);
  }
  f.advance(61000); // the route's own limit is six a minute
  for (const requestId of ['radio-retry-0001', randomUUID(), `x:${randomUUID()}`, `${f.now()}:not-a-uuid`, 7, {}]) assert.deepEqual([(await post(f, '/api/civic/radio/shoutout', { ...song, requestId }, who)).error], ['invalid_client_id'], String(requestId));
  // An id from the far past or the future is refused as expired — never run.
  f.advance(61000);
  for (const at of [f.now() - DAY - 1, f.now() + ONCE.futureMs + 1]) assert.deepEqual([(await post(f, '/api/civic/radio/shoutout', { ...song, requestId: `${at}:${randomUUID()}` }, who)).error], ['client_id_expired']);
  assert.equal((await life(f, who)).cash, 5000);
  f.advance(61000);

  const requestId = f.id();
  const first = await post(f, '/api/civic/radio/shoutout', { ...song, requestId }, who);
  assert.deepEqual([first.ok, first.code, first.duplicate, first.state.cash, first.radio.usedToday], [true, 'queued', undefined, 4500, 1]);
  const retry = await post(f, '/api/civic/radio/shoutout', { ...song, requestId }, who);
  assert.deepEqual([retry.ok, retry.code, retry.duplicate, retry.state.cash, retry.radio.usedToday, retry.entry.id], [true, 'queued', true, 4500, 1, first.entry.id]);
  // The same id for something else is a conflict, not a second purchase.
  const changed = await post(f, '/api/civic/radio/shoutout', { ...song, title: 'Another song', requestId }, who);
  assert.deepEqual([changed.status, changed.error], [409, 'client_id_conflict']);
  assert.equal((await post(f, '/api/civic/ads/rent', { cityId: 'lagos', kind: 'sea', slot: 'sea-1-1', text: 'Hi', colour: 'green', icon: 'star', requestId }, who)).status, 409, 'nor can it pay for a different kind of thing');
  assert.equal((await life(f, who)).cash, 4500);
  // Receipts are per player: another player may use the same id.
  const other = await inClub(f, 'Radio Bola');
  assert.equal((await post(f, '/api/civic/radio/shoutout', { ...song, requestId }, other)).duplicate, undefined);

  // After a restart the receipt is still there.
  const call = await restart(t, f);
  const afterRestart = await call('/api/civic/radio/shoutout', { ...song, requestId }, who);
  assert.deepEqual([afterRestart.duplicate, afterRestart.state.cash], [true, 4500]);
  assert.ok((await database(f)).sessions[who.cookie.slice(4)].once[requestId]);
});

test('an expired id is refused, not run again; its receipt may then be dropped', async (t) => {
  const f = await fixture(t);
  const who = await inClub(f, 'Radio Ada');
  const song = { cityId: 'lagos', title: 'Water', artist: 'Tyla' }, requestId = f.id();
  assert.equal((await post(f, '/api/civic/radio/shoutout', { ...song, requestId }, who)).state.cash, 4500);
  f.advance(DAY - 1000);
  assert.equal((await post(f, '/api/civic/radio/shoutout', { ...song, requestId }, who)).duplicate, true, 'still inside the window: a repeat');
  f.advance(2000);
  const late = await post(f, '/api/civic/radio/shoutout', { ...song, requestId }, who);
  assert.deepEqual([late.status, late.error], [409, 'client_id_expired']);
  assert.match(late.reason, /Nothing was done/);
  await f.server.store.transact((db) => { const state = sessionOf(db, who).cities.lagos.state; state.location = 'library'; state.activeAction = null; });
  assert.equal((await life(f, who)).cash, 4500, 'no second charge');
  // The next receipted request of this player prunes the expired receipt; the id stays unusable.
  assert.equal((await post(f, '/api/civic/radio/shoutout', { ...song, requestId: f.id() }, who)).ok, true);
  assert.equal((await database(f)).sessions[who.cookie.slice(4)].once[requestId], undefined);
  assert.equal((await post(f, '/api/civic/radio/shoutout', { ...song, requestId }, who)).status, 409);
});

test('gifts at capacity: an unexpired receipt is never evicted; a full player or a full server is refused before any debit', async (t) => {
  const f = await fixture(t, { receiptLimits: { perPlayer: 3, global: 5 } });
  const [ada, bola, chi] = await friends(f, ['Ada', 'Bola', 'Chi']);
  const balances = async () => { for (const who of [ada, bola, chi]) await get(f, '/api/social/me', who); return [(await life(f, ada)).cash, (await life(f, bola)).cash, (await life(f, chi)).cash]; };
  const gift = { to: bola.id, amount: 500, cityId: 'lagos', clientId: f.id() };
  assert.equal((await post(f, '/api/social/transfers', gift, ada)).code, 'sent');
  assert.deepEqual(await balances(), [9500, 10500, 10000]);

  // Ada fills her own quota with other receipted things (interactions that happened: seeded as stored receipts).
  await f.server.store.transact((db) => { const mine = sessionOf(db, ada).once; for (let i = 0; i < 2; i++) mine[`${f.now()}:${randomUUID()}`] = { at: f.now(), kind: 'interact', fp: 'seeded', result: { ok: true, code: 'interacted' } }; });
  const refused = await post(f, '/api/social/transfers', { ...gift, clientId: f.id(), amount: 100 }, ada);
  assert.deepEqual([refused.status, refused.error], [429, 'receipt_quota']);
  assert.match(refused.reason, /Nothing was charged/);
  assert.deepEqual(await balances(), [9500, 10500, 10000], 'refused before the debit');
  // One player's full quota does not touch another player: Chi can still give, and Ada's own receipt is intact.
  f.advance(61000);
  const fromChi = { to: bola.id, amount: 100, cityId: 'lagos', clientId: f.id() };
  assert.equal((await post(f, '/api/social/transfers', fromChi, chi)).code, 'sent');
  const replay = await post(f, '/api/social/transfers', gift, ada);
  assert.deepEqual([replay.ok, replay.code, replay.duplicate], [true, 'sent', true]);
  assert.deepEqual(await balances(), [9500, 10600, 9900], 'the original gift was not sent twice');

  // The server-wide count (4 of 5) is taken from the stored sessions. One more fills it; the next is refused for everyone.
  f.advance(61000);
  assert.equal((await post(f, '/api/social/transfers', { ...fromChi, clientId: f.id() }, chi)).code, 'sent');
  f.advance(61000);
  const full = await post(f, '/api/social/transfers', { ...fromChi, clientId: f.id() }, chi);
  assert.deepEqual([full.status, full.error], [503, 'receipts_full']);
  assert.match(full.reason, /Nothing was charged\. Try again later/);
  assert.deepEqual(await balances(), [9500, 10700, 9800]);
  for (const [body, who] of [[gift, ada], [fromChi, chi]]) assert.equal((await post(f, '/api/social/transfers', body, who)).duplicate, true, 'every accepted receipt still answers');
  assert.deepEqual(await balances(), [9500, 10700, 9800]);

  // Capacity comes back with time, never by forgetting: a day later the old ids are expired and refused.
  f.advance(DAY + 1000);
  const late = await post(f, '/api/social/transfers', gift, ada);
  assert.deepEqual([late.status, late.error], [409, 'client_id_expired']);
  const next = await post(f, '/api/social/transfers', { ...gift, clientId: f.id() }, ada);
  assert.equal(next.code, 'sent', next.reason);
  assert.deepEqual(await balances(), [9000, 11200, 9800]);
});

test('two copies of one gift sent at the same moment move the money once, and the receipt survives a restart', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await friends(f, ['Ada', 'Bola']);
  const gift = { to: bola.id, amount: 500, cityId: 'lagos', clientId: f.id() };
  const answers = await Promise.all(Array.from({ length: 4 }, () => post(f, '/api/social/transfers', gift, ada)));
  assert.deepEqual(answers.map((answer) => answer.code), ['sent', 'sent', 'sent', 'sent']);
  assert.equal(answers.filter((answer) => answer.duplicate).length, 3);
  assert.equal((await post(f, '/api/social/transfers', { ...gift, amount: 600 }, ada)).status, 409);
  assert.equal((await post(f, '/api/social/transfers', { ...gift, clientId: undefined }, ada)).error, 'client_id_required');
  assert.equal((await post(f, '/api/social/transfers', { ...gift, clientId: 'c-transfer-same-id-0001' }, ada)).error, 'invalid_client_id');
  const call = await restart(t, f);
  assert.equal((await call('/api/social/transfers', gift, ada)).duplicate, true);
  await call('/api/social/me', null, bola);
  assert.deepEqual([(await call('/api/life?city=lagos', null, ada)).state.cash, (await call('/api/life?city=lagos', null, bola)).state.cash], [9500, 10500]);
});

test('which life a gift lands in: the gift’s city if the friend lives there, else the life they played last; never a life that does not exist', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chi, dayo] = await friends(f, ['Ada', 'Bola', 'Chi', 'Dayo'], { lives: false });
  await life(f, ada);
  await f.server.store.transact((db) => { const state = sessionOf(db, ada).cities.lagos.state; state.cash = 10000; state.social.earned = 5000; });
  const send = (to, amount = 500) => post(f, '/api/social/transfers', { to: to.id, amount, cityId: 'lagos', clientId: f.id() }, ada);
  const cities = async (who) => Object.keys((await database(f)).sessions[who.cookie.slice(4)].cities ?? {});

  // Bola plays only in Ibadan. The money goes to that life; no Lagos life is made for him.
  assert.equal((await life(f, bola, 'ibadan')).cash, 5000);
  const toBola = await send(bola);
  assert.deepEqual([toBola.code, toBola.credited, toBola.creditedCity], ['sent', false, 'ibadan']);
  await get(f, '/api/social/me', bola);
  assert.equal((await life(f, bola, 'ibadan')).cash, 5500);
  assert.deepEqual(await cities(bola), ['ibadan'], 'no life appeared in the sender’s city');

  // Chi has a life in both cities: the gift’s own city wins, whichever she played last.
  await life(f, chi, 'lagos'); f.advance(1000); await life(f, chi, 'ibadan');
  f.advance(61000);
  assert.equal((await send(chi)).creditedCity, 'lagos');
  await get(f, '/api/social/me', chi);
  assert.deepEqual([(await life(f, chi, 'lagos')).cash, (await life(f, chi, 'ibadan')).cash], [5500, 5000]);

  // Dayo has opened the game but has no life anywhere: refused before Ada is charged, nothing waits, nothing is created.
  f.advance(61000);
  const before = (await life(f, ada)).cash;
  const toDayo = await send(dayo);
  assert.deepEqual([toDayo.ok, toDayo.code], [false, 'recipient_no_life']);
  assert.match(toDayo.reason, /Nothing was sent/);
  assert.equal((await life(f, ada)).cash, before);
  assert.deepEqual(await cities(dayo), []);
  assert.equal((await database(f)).social.pending?.[dayo.id], undefined);
  // The money is all still there: 10,000 + Bola's and Chi's lives, moved by exactly 2 × 500.
  assert.equal(before, 9000);
});

test('a gift left waiting for a friend whose life is gone stays owed and returns to the sender: it is never dropped and never creates a life', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await friends(f, ['Ada', 'Bola']);
  assert.equal((await post(f, '/api/social/transfers', { to: bola.id, amount: 700, cityId: 'lagos', clientId: f.id() }, ada)).credited, false);
  // Bola's only life disappears before he collects (seeded: lives are otherwise never deleted while a session lasts).
  await f.server.store.transact((db) => { sessionOf(db, bola).cities = {}; });
  await get(f, '/api/social/me', bola);
  let db = await database(f);
  assert.equal(db.social.pending[bola.id][0].payload.amount, 700, 'still owed');
  assert.deepEqual(Object.keys(db.sessions[bola.cookie.slice(4)].cities), [], 'no life was created to receive it');
  f.advance(7 * DAY + HOUR + 1000);
  await get(f, '/api/social/me', ada); await get(f, '/api/social/me', ada);
  assert.equal((await life(f, ada)).cash, 10000, 'the unclaimed gift came back');
  db = await database(f);
  assert.equal(db.social.pending[bola.id], undefined); assert.equal(db.social.pending[ada.id], undefined);
});

test('a removed member cannot learn about a group by replaying an old message or the request that created it', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await friends(f, ['Ada', 'Bola']);
  const createId = f.id();
  const made = await post(f, '/api/social/groups', { name: 'Owambe crew', members: [bola.id], clientId: createId }, ada);
  assert.equal(made.code, 'created');
  const again = await post(f, '/api/social/groups', { name: 'Owambe crew', members: [bola.id], clientId: createId }, ada);
  assert.deepEqual([again.code, again.duplicate, again.conv.id], ['created', true, made.conv.id]);
  assert.equal(Object.keys((await database(f)).social.convs).filter((key) => key.startsWith('g.')).length, 1, 'one group, not two');
  assert.equal((await post(f, '/api/social/groups', { name: 'Another name', members: [bola.id], clientId: createId }, ada)).status, 409);
  assert.equal((await post(f, '/api/social/groups', { name: 'No id', members: [bola.id] }, ada)).error, 'client_id_required');

  const messageId = f.id();
  assert.equal((await post(f, '/api/social/messages', { conv: made.conv.id, body: 'I am in', clientId: messageId }, bola)).code, 'sent');
  assert.equal((await post(f, '/api/social/messages', { conv: made.conv.id, body: 'I am in', clientId: messageId }, bola)).duplicate, true);
  // Ada removes Bola, then the group goes on without him.
  assert.equal((await post(f, `/api/social/groups/${made.conv.id}`, { op: 'remove', id: bola.id }, ada)).code, 'updated');
  assert.equal((await post(f, `/api/social/groups/${made.conv.id}`, { op: 'rename', name: 'Secret plans' }, ada)).code, 'updated');
  const replay = await post(f, '/api/social/messages', { conv: made.conv.id, body: 'I am in', clientId: messageId }, bola);
  assert.deepEqual([replay.ok, replay.code, replay.conv, replay.message], [false, 'not_a_member', undefined, undefined]);
  assert.ok(!JSON.stringify(replay).includes('Secret plans'));
  // The creator leaves: replaying her own creation request shows her nothing either.
  assert.equal((await post(f, `/api/social/groups/${made.conv.id}`, { op: 'leave' }, ada)).code, 'left');
  const stale = await post(f, '/api/social/groups', { name: 'Owambe crew', members: [bola.id], clientId: createId }, ada);
  assert.deepEqual([stale.ok, stale.code, stale.conv], [false, 'not_a_member', undefined]);
});

test('ctx.act cannot spend without a receipt: a route that forwards the action id is charged once; one that has none is refused', async (t) => {
  registerSystem({ id: 'once-test', stateKeys: ['onceTest'], sanitize(input, state) { state.onceTest = {}; },
    actions: { 'once-test-debit': (state) => { state.cash -= 100; return { ok: true, code: 'debited', state }; } } });
  const feature = (ctx) => ({
    // Documented pattern 1: forward the request's action id — the same receipt steps as POST /api/action.
    'POST /api/feature/spend': async (request) => { const body = await request.json(); return { body: await ctx.store.transact((db) => ctx.act(ctx.settle(request.requireSession(db), body.cityId), body)) }; },
    // A route that forgot: no receipt, no declared state guard.
    'POST /api/feature/forgot': async (request) => ({ body: await ctx.store.transact((db) => ctx.act(ctx.settle(request.requireSession(db), 'lagos'), { type: 'once-test-debit', cityId: 'lagos' })) }),
    // A life that did not come from ctx.settle has no owner to hold a receipt.
    'POST /api/feature/orphan': async (request) => { const body = await request.json(); return { body: await ctx.store.transact((db) => ctx.act(structuredClone(ctx.settle(request.requireSession(db), 'lagos')), body)) }; },
  });
  const f = await fixture(t, { routes: [...ROUTE_MODULES, feature], log: () => {} });
  f.advance(3 * DAY);
  const who = await f.device('Ada');
  const body = { actionId: f.id(), cityId: 'lagos', type: 'once-test-debit' };
  const first = await post(f, '/api/feature/spend', body, who), replay = await post(f, '/api/feature/spend', body, who);
  assert.deepEqual([first.code, first.state.cash, first.duplicate], ['debited', 4900, undefined]);
  assert.deepEqual([replay.code, replay.state.cash, replay.duplicate], ['debited', 4900, true]);
  assert.equal((await post(f, '/api/feature/spend', { ...body, type: 'cancel' }, who)).status, 409, 'the id is bound to what it paid for');
  assert.equal((await post(f, '/api/feature/spend', { ...body, actionId: `${f.now() - DAY - 1}:${randomUUID()}` }, who)).error, 'action_expired');
  // The public action route and ctx.act share one receipt book: the id cannot be spent again there either.
  const direct = await post(f, '/api/action', body, who);
  assert.deepEqual([direct.duplicate, direct.state.cash], [true, 4900]);
  for (const path of ['/api/feature/forgot', '/api/feature/orphan']) assert.deepEqual(await post(f, path, body, who), { status: 500, error: 'internal_error' }, path);
  assert.equal((await life(f, who)).cash, 4900);
});
