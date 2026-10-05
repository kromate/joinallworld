import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// Exactly-once receipts (server/routes/once.ts) through the real routes: mandatory ids, conflicts,
// expiry, capacity without eviction, restart, concurrency — and the gift and group rules that
// depend on them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import { createServer } from './server.ts';
import { ONCE } from './routes/once.ts';
import { ROUTE_MODULES } from './routes/index.ts';
import { registerSystem } from '../src/game/registry.ts';
import { createLife } from '../src/life.ts';
import type { TestContext } from 'node:test';
import type { Database, SessionRecord, RouteContext, RouteModule, RouteRequest, ActBody } from './types.ts';
import type { SystemDefinition } from '../src/types/registry.ts';
import type { ActionType, LifeState } from '../src/types/index.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
interface Who { cookie: string; id: string }
type Dict = Record<string, unknown>;
/** A JSON answer with its status: the documented bodies of the routes under test, read by name (an error answer carries `error` and no other field). */
interface Answer {
  status: number; error: string; ok: boolean; code: string; reason: string; duplicate: boolean | undefined
  state: { cash: number }; radio: { usedToday: number }; entry: { id: string }; conv: { id: string }; message: unknown
  credited: boolean; creditedCity: string
}
const HOUR = 3600000, DAY = 86400000;
const answer = async (res: Response): Promise<Answer> => ({ status: res.status, ...((await res.json()) as Dict) }) as Answer;
const get = async (f: Fixture, path: string, who?: Who) => answer(await f.request(path, null, who?.cookie));
const post = async (f: Fixture, path: string, body: unknown, who?: Who) => answer(await f.request(path, body, who?.cookie));
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`expected a ${what}`); return value; };
const database = async (f: Fixture): Promise<Database> => JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')) as Database;
const life = async (f: Fixture, who: Who, city = 'lagos') => (await get(f, `/api/life?city=${city}`, who)).state;
const sessionOf = (db: Database, who: Who): SessionRecord => must(Object.values(db.sessions).find((item) => item.publicId === who.id), 'session');
/** The stored session behind a device's cookie (`sid=<secret>`). */
const storedOf = (db: Database, who: Who): SessionRecord => must(db.sessions[who.cookie.slice(4)], 'stored session');
/** A stored receipt by id (ids come from the client as plain strings). */
const receiptOf = (db: Database, who: Who, id: string) => Object.entries(storedOf(db, who).once ?? {}).find(([key]) => key === id)?.[1];
const socialOf = (db: Database) => must(db.social, 'social collection');

/** Registered players with lives; every pair (first, other) are old friends, and `first` holds earned money. */
async function friends<const N extends readonly string[]>(f: Fixture, names: N, { lives = true } = {}): Promise<{ [K in keyof N]: Who }> {
  const devices: Who[] = [];
  for (const name of names) { const device = await f.device(name); await get(f, '/api/social/me', device); if (lives) await life(f, device); devices.push(device); }
  await f.server.store.transact((db) => {
    const players = socialOf(db).players;
    for (const who of devices) must(players[who.id], 'player').first = f.now() - 25 * HOUR;
    for (const sender of devices) for (const other of devices) if (sender !== other) must(players[sender.id], 'player').friends[other.id] = f.now() - 2 * HOUR;
    for (const who of devices) { const state = sessionOf(db, who).cities.lagos?.state; if (state) { state.cash = 10000; state.social.earned = 5000; } }
  });
  return devices as { [K in keyof N]: Who };
}
/** Put a new life in a club with the standard ₦5,000 (seeded location only; the route and the rules are real). */
async function inClub(f: Fixture, name: string): Promise<Who> {
  const who = await f.device(name); await life(f, who);
  await f.server.store.transact((db) => { const state = must(sessionOf(db, who).cities.lagos, 'life').state; state.location = 'library'; state.activeAction = null; });
  return who;
}
async function restart(t: TestContext, f: Fixture) {
  f.server.closeAllConnections(); await new Promise<void>((resolve) => f.server.close(() => resolve()));
  const again = await createServer({ dataDir: f.dir, now: f.now, sessionTtlMs: 2592000000 });
  again.listen(0, '127.0.0.1'); await once(again, 'listening');
  t.after(async () => { again.closeAllConnections(); await new Promise<void>((resolve) => again.close(() => resolve())); });
  const address = again.address();
  if (!address || typeof address === 'string') throw new Error('The server is not listening on a port');
  return async (path: string, body: unknown, who: Who) => answer(await fetch(`http://127.0.0.1:${address.port}${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: who.cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
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
  assert.ok(receiptOf(await database(f), who, requestId));
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
  await f.server.store.transact((db) => { const state = must(sessionOf(db, who).cities.lagos, 'life').state; state.location = 'library'; state.activeAction = null; });
  assert.equal((await life(f, who)).cash, 4500, 'no second charge');
  // The next receipted request of this player prunes the expired receipt; the id stays unusable.
  assert.equal((await post(f, '/api/civic/radio/shoutout', { ...song, requestId: f.id() }, who)).ok, true);
  assert.equal(receiptOf(await database(f), who, requestId), undefined);
  assert.equal((await post(f, '/api/civic/radio/shoutout', { ...song, requestId }, who)).status, 409);
});

test('gifts at capacity: an unexpired receipt is never evicted; a full player or a full server is refused before any debit', async (t) => {
  const f = await fixture(t, { receiptLimits: { perPlayer: 3, global: 5 } });
  const [ada, bola, chi] = await friends(f, ['Ada', 'Bola', 'Chi']);
  const balances = async () => { for (const who of [ada, bola, chi]) await get(f, '/api/social/me', who); return [(await life(f, ada)).cash, (await life(f, bola)).cash, (await life(f, chi)).cash]; };
  const gift = { to: bola.id, amount: 500, cityId: 'lagos', clientId: f.id() };
  assert.equal((await post(f, '/api/social/transfers', gift, ada)).code, 'sent');
  assert.deepEqual(await balances(), [9500, 10500, 10000]);

  // Ada fills her own money quota with other paid things (seeded as stored receipts). Interactions would not count: they have their own allowance.
  await f.server.store.transact((db) => { const mine = must(sessionOf(db, ada).once, 'receipts'); for (let i = 0; i < 2; i++) mine[`${f.now()}:${randomUUID()}`] = { at: f.now(), kind: 'civic.shoutout', fp: 'seeded', result: { ok: true, code: 'queued' } }; });
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
  const replays: [typeof gift, Who][] = [[gift, ada], [fromChi, chi]];
  for (const [body, who] of replays) assert.equal((await post(f, '/api/social/transfers', body, who)).duplicate, true, 'every accepted receipt still answers');
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

test('a gift reaches the active character life; archived lives are preserved and never credited behind its back', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chi, dayo] = await friends(f, ['Ada', 'Bola', 'Chi', 'Dayo'], { lives: false });
  await life(f, ada); await life(f, chi);
  await f.server.store.transact((db) => {
    const adaState = must(sessionOf(db, ada).cities.lagos, 'life').state; adaState.cash = 10000; adaState.social.earned = 5000;
    const bolaSession = sessionOf(db, bola);
    bolaSession.cities.ibadan = { state: createLife({ name: 'Bola' }, { now: f.now(), cityId: 'ibadan' }), updatedAt: f.now(), salt: 'b'.repeat(32) };
    bolaSession.character = { v: 1, city: 'ibadan' };
    const chiSession = sessionOf(db, chi);
    chiSession.legacyLives = { 'ibadan:1': { state: createLife({ name: 'Chi' }, { now: f.now(), cityId: 'ibadan' }), updatedAt: f.now() - 1, salt: 'c'.repeat(32) } };
    chiSession.legacyLifeCities = { 'ibadan:1': 'ibadan' };
  });
  const send = (to: Who, amount = 500) => post(f, '/api/social/transfers', { to: to.id, amount, cityId: 'lagos', clientId: f.id() }, ada);
  const cities = async (who: Who) => Object.keys(storedOf(await database(f), who).cities ?? {});

  // Bola's one active character is in Ibadan. The money follows it; no Lagos life is made for him.
  assert.equal((await life(f, bola, 'ibadan')).cash, 5000);
  const toBola = await send(bola);
  assert.deepEqual([toBola.code, toBola.credited, toBola.creditedCity], ['sent', false, 'ibadan']);
  await get(f, '/api/social/me', bola);
  assert.equal((await life(f, bola, 'ibadan')).cash, 5500);
  assert.deepEqual(await cities(bola), ['ibadan'], 'no life appeared in the sender’s city');

  // Chi is active in Lagos and has a genuine pre-migration Ibadan life in the archive.
  f.advance(61000);
  assert.equal((await send(chi)).creditedCity, 'lagos');
  await get(f, '/api/social/me', chi);
  assert.equal((await life(f, chi, 'lagos')).cash, 5500);
  const listed = await get(f, '/api/characters', chi) as Answer & { active: string; legacy: { id: string; city: string; cash: number }[] };
  assert.deepEqual([listed.active, listed.legacy.map(({ city, cash }) => [city, cash])], ['lagos', [['ibadan', 5000]]]);
  const archived = listed.legacy[0];
  if (!archived) throw new Error('expected an archived Ibadan life');
  const switched = await post(f, '/api/characters/switch', { id: archived.id, clientId: f.id() }, chi);
  assert.deepEqual([switched.ok, switched.code, (switched as Answer & { city: string }).city], [true, undefined, 'ibadan']);
  assert.equal((await life(f, chi, 'ibadan')).cash, 5000, 'switching did not merge or credit the archived life');
  // With no active Lagos life, another Lagos gift follows Chi's active Ibadan character.
  f.advance(61000);
  assert.equal((await send(chi)).creditedCity, 'ibadan');
  await get(f, '/api/social/me', chi);
  assert.equal((await life(f, chi, 'ibadan')).cash, 5500);

  // Dayo has opened the game but has no life anywhere: refused before Ada is charged, nothing waits, nothing is created.
  f.advance(61000);
  const before = (await life(f, ada)).cash;
  const toDayo = await send(dayo);
  assert.deepEqual([toDayo.ok, toDayo.code], [false, 'recipient_no_life']);
  assert.match(toDayo.reason, /Nothing was sent/);
  assert.equal((await life(f, ada)).cash, before);
  assert.deepEqual(await cities(dayo), []);
  assert.equal(socialOf(await database(f)).pending[dayo.id], undefined);
  // The money is all still there: three gifts moved exactly 3 × ₦500.
  assert.equal(before, 8500);
});

test('a gift left waiting for a friend whose life is gone stays owed and returns to the sender: it is never dropped and never creates a life', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await friends(f, ['Ada', 'Bola']);
  assert.equal((await post(f, '/api/social/transfers', { to: bola.id, amount: 700, cityId: 'lagos', clientId: f.id() }, ada)).credited, false);
  // Bola's only life disappears before he collects (seeded: lives are otherwise never deleted while a session lasts).
  await f.server.store.transact((db) => { sessionOf(db, bola).cities = {}; });
  await get(f, '/api/social/me', bola);
  let db = await database(f);
  const owed = must(socialOf(db).pending[bola.id]?.[0], 'owed gift').payload;
  assert.equal(owed.op === 'transfer-in' ? owed.amount : undefined, 700, 'still owed');
  assert.deepEqual(Object.keys(storedOf(db, bola).cities), [], 'no life was created to receive it');
  f.advance(7 * DAY + HOUR + 1000);
  await get(f, '/api/social/me', ada); await get(f, '/api/social/me', ada);
  assert.equal((await life(f, ada)).cash, 10000, 'the unclaimed gift came back');
  db = await database(f);
  assert.equal(socialOf(db).pending[bola.id], undefined); assert.equal(socialOf(db).pending[ada.id], undefined);
});

test('a removed member cannot learn about a group by replaying an old message or the request that created it', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await friends(f, ['Ada', 'Bola']);
  const createId = f.id();
  const made = await post(f, '/api/social/groups', { name: 'Owambe crew', members: [bola.id], clientId: createId }, ada);
  assert.equal(made.code, 'created');
  const again = await post(f, '/api/social/groups', { name: 'Owambe crew', members: [bola.id], clientId: createId }, ada);
  assert.deepEqual([again.code, again.duplicate, again.conv.id], ['created', true, made.conv.id]);
  assert.equal(Object.keys(socialOf(await database(f)).convs).filter((key) => key.startsWith('g.')).length, 1, 'one group, not two');
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
  // The id, state key and action type exist only in this test, so the definition crosses the registry boundary through one cast.
  registerSystem({ id: 'once-test', stateKeys: ['onceTest'], sanitize(_input: unknown, state: LifeState & { onceTest?: object }) { state.onceTest = {}; },
    actions: { 'once-test-debit': (state: LifeState) => { state.cash -= 100; return { ok: true, code: 'debited', state }; } } } as unknown as SystemDefinition);
  /** The body of a request as ctx.act takes it (the test sends it complete; `type` is a test-only action). */
  const actBody = async (request: RouteRequest) => (await request.json()) as unknown as ActBody;
  const feature: RouteModule = (ctx: RouteContext) => ({
    // Documented pattern 1: forward the request's action id — the same receipt steps as POST /api/action.
    'POST /api/feature/spend': async (request) => { const body = await actBody(request); return { body: await ctx.store.transact((db) => ctx.act(ctx.settle(request.requireSession(db), body.cityId), body)) }; },
    // A route that forgot: no receipt, no declared state guard.
    'POST /api/feature/forgot': async (request) => ({ body: await ctx.store.transact((db) => ctx.act(ctx.settle(request.requireSession(db), 'lagos'), { type: 'once-test-debit' as ActionType, cityId: 'lagos' })) }),
    // A life that did not come from ctx.settle has no owner to hold a receipt.
    'POST /api/feature/orphan': async (request) => { const body = await actBody(request); return { body: await ctx.store.transact((db) => ctx.act(structuredClone(ctx.settle(request.requireSession(db), 'lagos')), body)) }; },
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
