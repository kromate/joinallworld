// Foundation tests for the server extension points: route registry, socket registry,
// namespaced collections and payload-aware idempotency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.js';
import { buildRoutes, ROUTE_MODULES } from './routes/index.js';
import { buildSocketHandlers, WS_MODULES } from './ws/index.js';
import { actionFingerprint, canonicalJson, collection, validateActionPayload, MAX_PAYLOAD_BYTES } from './protocol.js';
import { actionTypes } from '../src/life.js';
import { serverOnlyReason, registerSystem } from '../src/game/registry.js';

/** A feature-style route module written only against the documented contract. */
function guestbookRoutes(ctx) {
  return {
    'GET /api/guestbook/entries': async () => ({ body: { entries: await ctx.store.read(db => ctx.collection(db, 'guestbook', { entries: [] }).entries) } }),
    'POST /api/guestbook/entries/:city': async (request) => {
      const { text, requestId } = await request.json();
      if (typeof text !== 'string' || !text.trim() || text.length > 80) throw ctx.fail(400, 'invalid_entry');
      if (!ctx.cityIds.includes(request.params.city)) throw ctx.fail(400, 'invalid_city');
      const result = await ctx.store.transact(db => {
        const session = request.requireSession(db, { renew: true });
        const life = ctx.settle(session, request.params.city);
        // The fare and the entry are one receipted step: the same requestId again returns this result and charges nothing.
        return ctx.once(db, session, { id: requestId, kind: 'guestbook.sign', fingerprint: [request.params.city, text] }, () => {
          const paid = ctx.act(life, { type: 'travel', payload: { id: 'library', mode: 'cab' }, cityId: request.params.city });
          if (!paid.ok) throw ctx.fail(409, paid.code);
          const book = ctx.collection(db, 'guestbook', { entries: [] });
          book.entries.push({ by: ctx.publicSession(session), text: text.trim(), at: ctx.now() });
          return { count: book.entries.length, cash: life.cash, sent: ctx.push(session.publicId, { type: 'guestbook-signed', count: book.entries.length }) };
        });
      });
      return { status: 201, body: result, renew: true };
    },
    'GET /api/guestbook/online/:id': async (request) => ({ body: { online: ctx.online(request.params.id) } }),
  };
}
function guestbookSocket(ctx) {
  const seen = [];
  return {
    messages: {
      'guestbook-ping': async (ws, message) => { if (message.fail) throw Error('guestbook_refused'); ctx.send(ws, { type: 'guestbook-pong', from: ws.session, room: ws.room ?? null }); },
      'guestbook-wave': { room: true, handle: (ws) => ctx.send(ws, { type: 'guestbook-waved' }) },
      'guestbook-log': (ws) => ctx.send(ws, { type: 'guestbook-log', seen }),
    },
    open(ws) { seen.push(`open:${ws.session.name}`); },
    close(ws) { seen.push(`close:${ws.session.name}`); },
  };
}
const withGuestbook = { routes: [...ROUTE_MODULES, guestbookRoutes], wsModules: [...WS_MODULES, guestbookSocket] };
const database = async f => JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8'));

test('route registry: a module gets storage, sessions, settlement, actions and push through the context', async t => {
  const f = await fixture(t, withGuestbook); const a = await f.device('Ada'); const x = await f.socket(a);
  const empty = await f.request('/api/guestbook/entries'); assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { entries: [], serverTime: 100000 }, 'serverTime is added to every success');
  assert.equal((await database(f)).guestbook, undefined, 'a read never creates the collection on disk');
  assert.equal((await f.request('/api/guestbook/entries/lagos', { text: 'Hi' })).status, 401);
  assert.deepEqual(await (await f.request('/api/guestbook/entries/lagos', { text: '' }, a.cookie)).json(), { error: 'invalid_entry' });
  assert.equal((await f.request('/api/guestbook/entries/atlantis', { text: 'Hi' }, a.cookie)).status, 400);
  const signed = await f.request('/api/guestbook/entries/lagos', { text: ' Hello Lagos ', requestId: f.id() }, a.cookie);
  assert.equal(signed.status, 201); assert.match(signed.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/, 'renew re-issues the session cookie');
  assert.deepEqual(await signed.json(), { count: 1, cash: 4600, sent: 1, serverTime: 100000 });
  assert.deepEqual(await x.next(), { type: 'guestbook-signed', count: 1 });
  // A throw inside transact saves nothing: the second signing fails (already travelling) and leaves the book alone.
  assert.deepEqual(await (await f.request('/api/guestbook/entries/lagos', { text: 'Again', requestId: f.id() }, a.cookie)).json(), { error: 'busy' });
  const db = await database(f);
  assert.deepEqual(db.guestbook.entries, [{ by: { id: a.id, name: 'Ada' }, text: 'Hello Lagos', at: 100000 }]);
  assert.ok(!JSON.stringify(db.guestbook).includes(a.cookie.slice(4)), 'the collection never holds a session secret');
  assert.equal(db.sessions[a.cookie.slice(4)].cities.lagos.state.cash, 4600);
  assert.equal((await (await f.request(`/api/guestbook/online/${a.id}`)).json()).online, true);
  assert.equal((await (await f.request(`/api/guestbook/online/${randomUUID()}`)).json()).online, false);
  // Host guards still run before any module: origin check and unknown paths.
  const hostile = await fetch(f.base + '/api/guestbook/entries', { headers: { Origin: 'https://evil.example' } }); assert.equal(hostile.status, 403);
  assert.equal((await f.request('/api/guestbook/missing')).status, 404);
  assert.equal((await f.request('/api/guestbook/entries/lagos/extra', { text: 'x' }, a.cookie)).status, 404);
});

test('route registry rejects duplicate and malformed routes at start-up and lists the core routes', () => {
  const ctx = { core: {}, config: {}, store: {}, cityIds: [] };
  const keys = buildRoutes(ctx).keys;
  const CORE = ['GET /api/life', 'GET /api/session', 'GET /api/voice-config', 'POST /api/action', 'POST /api/session'];
  for (const key of CORE) assert.ok(keys.includes(key), `core route ${key} is registered`);
  // Every module registers only under its own namespace; the core module is exactly the core set.
  const NAMESPACES = ['', '/api/auth/', '/api/social/', '/api/civic/', '/api/support/', '/api/mod/'];
  assert.equal(ROUTE_MODULES.length, NAMESPACES.length);
  ROUTE_MODULES.forEach((module, index) => {
    const own = Object.keys(module(ctx) || {});
    if (index === 0) assert.deepEqual(own.sort(), CORE);
    else for (const key of own) assert.ok(key.split(' ')[1].startsWith(NAMESPACES[index]), `${key} is outside ${NAMESPACES[index]}`);
  });
  assert.equal(keys.length, new Set(keys).size);
  assert.ok(keys.some((key) => key.startsWith('GET /api/social/')) && keys.some((key) => key.startsWith('GET /api/civic/')), 'feature modules register against any host context, with no shim');
  assert.throws(() => buildRoutes(ctx, [() => ({ 'GET /api/x': () => {} }), () => ({ 'GET /api/x': () => {} })]), /Duplicate route/);
  assert.throws(() => buildRoutes(ctx, [() => ({ 'GET /api/x/:id': () => {} }), () => ({ 'GET /api/x/:id': () => {} })]), /Duplicate route/);
  for (const key of ['GET /other/x', 'FETCH /api/x', 'GET /api/x y', '/api/x']) assert.throws(() => buildRoutes(ctx, [() => ({ [key]: () => {} })]), /Invalid route/, key);
  assert.throws(() => buildRoutes(ctx, [() => ({ 'GET /api/x': 'not a function' })]), /Invalid route/);
  const routes = buildRoutes(ctx, [() => ({ 'GET /api/a/:one/b/:two': () => 'hit', 'GET /api/a/list': () => 'exact' })]);
  assert.deepEqual(routes.match('GET', '/api/a/x%20y/b/2').params, { one: 'x y', two: '2' });
  assert.equal(routes.match('GET', '/api/a/list').handler(), 'exact');
  assert.equal(routes.match('POST', '/api/a/1/b/2'), null); assert.equal(routes.match('GET', '/api/a//b/2'), null); assert.equal(routes.match('GET', '/api/a/%E0%A4%A/b/2'), null);
});

test('authentication stubs are inert: registered, no endpoint, device sessions unchanged', async t => {
  const f = await fixture(t);
  for (const [path, body] of [['/api/auth/signup', { username: 'ada', password: 'secret12' }], ['/api/auth/login', { username: 'ada', password: 'secret12' }], ['/api/auth/logout', {}], ['/api/auth/session', null]]) {
    const response = await f.request(path, body); assert.equal(response.status, 404, path); assert.equal(response.headers.get('set-cookie'), null);
  }
  const auth = await import('./auth.js'); assert.equal(auth.ACCOUNTS_ENABLED, false);
  const a = await f.device('Ada'); assert.match(a.cookie, /^sid=[0-9a-f-]{36}$/); assert.notEqual(a.id, a.cookie.slice(4));
  assert.deepEqual(Object.keys((await database(f)).sessions[a.cookie.slice(4)]).sort(), ['actions', 'cities', 'expiresAt', 'name', 'publicId', 'secret']);
});

test('socket registry: room-free and room-only handlers, error replies, open/close hooks, core behaviour intact', async t => {
  const f = await fixture(t, withGuestbook); const a = await f.device('Ada'); const x = await f.socket(a);
  x.ws.send(JSON.stringify({ type: 'guestbook-ping' }));
  const pong = await x.next(); assert.deepEqual(pong, { type: 'guestbook-pong', from: { id: a.id, name: 'Ada' }, room: null });
  assert.ok(!JSON.stringify(pong).includes(a.cookie.slice(4)));
  x.ws.send(JSON.stringify({ type: 'guestbook-ping', fail: true })); assert.deepEqual(await x.next(), { type: 'error', code: 'guestbook_refused', error: 'guestbook_refused' });
  x.ws.send(JSON.stringify({ type: 'guestbook-wave' })); assert.equal((await x.next()).code, 'join_required');
  x.ws.send(JSON.stringify({ type: 'never-registered' })); assert.equal((await x.next()).code, 'join_required', 'unknown type outside a room keeps its historical reply');
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); assert.equal((await x.next()).type, 'presence');
  x.ws.send(JSON.stringify({ type: 'guestbook-wave' })); assert.equal((await x.next()).type, 'guestbook-waved');
  x.ws.send(JSON.stringify({ type: 'never-registered' })); assert.equal((await x.next()).code, 'invalid_message');
  x.ws.send(JSON.stringify({ type: 'constructor' })); assert.equal((await x.next()).code, 'invalid_message');
  const b = await f.device('Bola'); const y = await f.socket(b); y.ws.close(); await new Promise(resolve => y.ws.once('close', resolve)); await new Promise(resolve => setTimeout(resolve, 20));
  x.ws.send(JSON.stringify({ type: 'guestbook-log' })); assert.deepEqual((await x.next()).seen, ['open:Ada', 'open:Bola', 'close:Bola']);
});

test('socket registry rejects duplicate or malformed message types and lists the core types', () => {
  const ctx = { core: {}, config: {}, store: {}, cityIds: [] };
  const CORE = ['chat', 'join', 'move', 'signal', 'voice-state'];
  const types = [...buildSocketHandlers(ctx).messages.keys()];
  for (const type of CORE) assert.ok(types.includes(type), `core message type ${type} is registered`);
  // The rooms module owns exactly the core types; every other type carries its owner's prefix.
  assert.deepEqual(Object.keys(WS_MODULES[0](ctx).messages).sort(), CORE);
  for (const type of types.filter((item) => !CORE.includes(item))) assert.match(type, /^(dm|group|friend|invite|people)-/, `${type} is not prefixed with its area`);
  assert.throws(() => buildSocketHandlers(ctx, [...WS_MODULES, () => ({ messages: { chat: () => {} } })]), /Duplicate socket message type/);
  assert.throws(() => buildSocketHandlers(ctx, [() => ({ messages: { 'Bad Type': () => {} } })]), /Invalid socket message handler/);
  assert.throws(() => buildSocketHandlers(ctx, [() => ({ messages: { ping: { room: true } } })]), /Invalid socket message handler/);
});

test('everyone joins a room outside voice and muted; mute state is per identity and resets on rejoin', async t => {
  const f = await fixture(t); const a = await f.device('Ada'); const b = await f.device('Bola');
  const x = await f.socket(a);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  assert.deepEqual((await x.next()).members, [{ id: a.id, name: 'Ada', position: { x: 0, z: 0 }, enabled: false, muted: true }]);
  const y = await f.socket(b); y.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next();
  assert.deepEqual((await y.next()).members.map(member => [member.name, member.enabled, member.muted]), [['Ada', false, true], ['Bola', false, true]]);
  x.ws.send(JSON.stringify({ type: 'voice-state', enabled: true, muted: true }));
  assert.deepEqual((await y.next()).members.find(member => member.id === a.id), { id: a.id, name: 'Ada', position: { x: 0, z: 0 }, enabled: true, muted: true }); await x.next();
  x.ws.send(JSON.stringify({ type: 'voice-state', enabled: true, muted: false }));
  assert.equal((await y.next()).members.find(member => member.id === a.id).muted, false); await x.next();
  x.ws.send(JSON.stringify({ type: 'voice-state', enabled: 'yes', muted: false })); assert.equal((await x.next()).code, 'invalid_voice_state');
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  // Leaving and rejoining broadcasts twice to Bola; the final presence shows Ada muted and out of voice again.
  await y.next(); const rejoined = (await y.next()).members.find(member => member.id === a.id);
  assert.equal(rejoined.enabled, false); assert.equal(rejoined.muted, true);
});

test('idempotent replay covers the payload: same request replays, a changed payload conflicts', async t => {
  const f = await fixture(t); const a = await f.device('Ada');
  const actionId = `100000:${randomUUID()}`;
  const body = { actionId, type: 'travel', payload: { id: 'library', mode: 'cab' } };
  const [first, second] = await Promise.all([f.action(a.cookie, body), f.action(a.cookie, body)]);
  assert.equal(first.ok, true); assert.equal(first.state.cash, 4600); assert.equal(second.duplicate, true); assert.equal(second.state.cash, 4600);
  const reordered = await f.action(a.cookie, { actionId, type: 'travel', payload: { mode: 'cab', id: 'library' } });
  assert.equal(reordered.duplicate, true, 'key order does not change the fingerprint'); assert.equal(reordered.state.cash, 4600);
  for (const changed of [{ payload: { id: 'library', mode: 'keke' } }, { payload: { id: 'home', mode: 'cab' } }, { payload: { id: 'library', mode: 'cab', extra: 1 } }, { payload: undefined, id: 'library', mode: 'cab' }]) {
    const conflict = await f.request('/api/action', { actionId, cityId: 'lagos', type: 'travel', ...changed }, a.cookie);
    assert.equal(conflict.status, 409, JSON.stringify(changed)); assert.equal((await conflict.json()).error, 'action_id_conflict');
  }
  f.advance(6000);
  const replay = await f.action(a.cookie, body);
  assert.equal(replay.duplicate, true); assert.equal(replay.code, 'started'); assert.equal(replay.state.location, 'library'); assert.equal(replay.state.cash, 4600, 'a replay after completion still charges nothing');
  const receipt = (await database(f)).sessions[a.cookie.slice(4)].actions[actionId];
  assert.deepEqual(Object.keys(receipt).sort(), ['actionAt', 'code', 'fingerprint', 'ok', 'type']);
  // A failed action is recorded too, so its replay cannot succeed later.
  const failedId = `${106000}:${randomUUID()}`;
  const failed = await f.action(a.cookie, { actionId: failedId, type: 'activity', payload: { id: 'chill' } });
  assert.equal(failed.ok, false); assert.equal(failed.code, 'unavailable'); assert.ok(failed.reason);
  const again = await f.action(a.cookie, { actionId: failedId, type: 'activity', payload: { id: 'chill' } }); assert.equal(again.duplicate, true); assert.equal(again.ok, false);
});

test('action envelope: types come from the registry and payloads are size-limited plain objects', async t => {
  const f = await fixture(t); const a = await f.device('Ada');
  const send = fields => f.request('/api/action', { actionId: `100000:${randomUUID()}`, cityId: 'lagos', ...fields }, a.cookie);
  for (const type of ['bogus', 'constructor', '__proto__', '', null, 5]) assert.equal((await send({ type })).status, 400, String(type));
  for (const payload of ['text', 5, null, ['a'], true]) { const res = await send({ type: 'spot', payload }); assert.equal(res.status, 400); assert.equal((await res.json()).error, 'invalid_payload'); }
  assert.equal((await send({ type: 'spot', payload: { id: 'x'.repeat(MAX_PAYLOAD_BYTES) } })).status, 400);
  const hostile = await (await send({ type: 'travel', payload: { id: { toString: 'library' }, mode: ['cab'] } })).json();
  assert.equal(hostile.ok, false); assert.equal(hostile.code, 'invalid_travel'); assert.equal(hostile.state.cash, 5000);
  const proto = await (await send({ type: 'spot', payload: JSON.parse('{"id":"__proto__"}') })).json(); assert.equal(proto.code, 'invalid_spot');
  assert.equal((await (await send({ type: 'spot', payload: { id: 'trees' } })).json()).code, 'selected');
  for (const type of ['activity', 'apply-job', 'cancel', 'spot', 'travel']) assert.ok(actionTypes().includes(type), type);
  assert.throws(() => validateActionPayload({ cityId: 'lagos', type: 'spot', actionId: `100000:${randomUUID()}`, payload: { self: 1n } }, 100000), { code: 'invalid_payload' });
});

test('server-only actions: the public /api/action can never run one; a route module reaches them through ctx.act', async t => {
  assert.throws(() => registerSystem({ id: 'bad-server-only', stateKeys: [], sanitize() {}, actions: { 'bad.thing': { serverOnly: true } } }), /needs a handler function/);
  assert.throws(() => registerSystem({ id: 'bad-plain', stateKeys: [], sanitize() {}, actions: { 'bad.other': { run() {} } } }), /needs a handler function/);
  const serverOnly = actionTypes().filter((type) => serverOnlyReason(type));
  assert.deepEqual(serverOnly.sort(), ['civic.news', 'civic.rent-ad', 'civic.run', 'civic.shoutout', 'civic.vote', 'social.server']);
  /** A route written against the contract: it names the type itself and runs it with server authority. */
  const grantRoutes = (ctx) => ({
    'POST /api/grant/gift': async (request) => ({ body: await ctx.store.transact(db => {
      const life = ctx.settle(request.requireSession(db), 'lagos');
      const result = ctx.act(life, { type: 'social.server', cityId: 'lagos', payload: { op: 'transfer-in', from: '11111111-2222-4333-8444-555555555555', name: 'Server', amount: 250 },
        stateGuard: 'test fixture: the route is called once' });
      return { ok: result.ok, code: result.code, cash: life.cash };
    }) }),
  });
  const f = await fixture(t, { routes: [...ROUTE_MODULES, grantRoutes] }); const a = await f.device('Ada');
  const payloads = [{}, { op: 'transfer-in', from: '11111111-2222-4333-8444-555555555555', name: 'x', amount: 5000 }, { kind: 'sea', slot: 'sea-5-5' },
    { internal: true, serverOnly: false, grant: true, op: 'transfer-in', from: '11111111-2222-4333-8444-555555555555', amount: 5000 }];
  for (const type of serverOnly) for (const payload of payloads) {
    // Every envelope field a client controls is tried, including ones named like the server's flag.
    const response = await f.request('/api/action', { actionId: `100000:${randomUUID()}`, cityId: 'lagos', type, payload, internal: true, ctx: { internal: true } }, a.cookie);
    const result = await response.json();
    assert.deepEqual([response.status, result.ok, result.code, result.state.cash], [200, false, 'server_only', 5000], type);
    assert.ok(result.reason, 'the refusal says where to go instead');
  }
  const stored = (await database(f)).sessions[a.cookie.slice(4)];
  assert.equal(stored.cities.lagos.state.cash, 5000); assert.equal(stored.cities.lagos.state.ledger.length, 0);
  // A replayed receipt of a refused server-only action stays refused.
  const actionId = `100000:${randomUUID()}`;
  for (let i = 0; i < 2; i++) assert.equal((await f.action(a.cookie, { actionId, type: 'civic.vote', payload: {} })).code, 'server_only');
  assert.deepEqual(await (await f.request('/api/grant/gift', {}, a.cookie)).json(), { ok: true, code: 'received', cash: 5250, serverTime: 100000 });
});

test('fingerprints without a payload keep the pre-payload format, so stored receipts stay valid', () => {
  assert.equal(actionFingerprint({ cityId: 'lagos', type: 'travel', id: 'library', mode: 'cab' }), JSON.stringify(['lagos', 'travel', 'library', 'cab']));
  assert.equal(actionFingerprint({ cityId: 'lagos', type: 'cancel' }), '["lagos","cancel",null,null]');
  const a = actionFingerprint({ cityId: 'lagos', type: 'x', payload: { b: [1, { d: 1, c: 2 }], a: 'é' } });
  assert.equal(a, actionFingerprint({ cityId: 'lagos', type: 'x', payload: { a: 'é', b: [1, { c: 2, d: 1 }] } }));
  assert.notEqual(a, actionFingerprint({ cityId: 'lagos', type: 'x', payload: { a: 'é', b: [{ c: 2, d: 1 }, 1] } }));
  assert.notEqual(actionFingerprint({ cityId: 'lagos', type: 'x', payload: {} }), actionFingerprint({ cityId: 'lagos', type: 'x' }));
  assert.equal(canonicalJson({ b: undefined, a: [undefined, null] }), '{"a":[null,null],"b":null}');
});

test('collections are namespaced, created lazily and cannot shadow core data', () => {
  const db = { version: 1, sessions: {} };
  const social = collection(db, 'social'); social.friends = 1;
  assert.equal(collection(db, 'social'), social); assert.deepEqual(collection(db, 'civic', { plots: [] }), { plots: [] }); assert.deepEqual(db.civic, { plots: [] });
  for (const name of ['sessions', 'version', 'archivedLives', '__proto__', 'Bad', 'a', '', null, 'has space']) assert.throws(() => collection(db, name), /Invalid collection name/, String(name));
  // Names every object inherits are not collections: they would read as "already there" and return a built-in.
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'toLocaleString', 'propertyIsEnumerable']) assert.throws(() => collection(db, name), /Invalid collection name/, name);
  // Only the document's own property counts as an existing collection.
  const inherited = Object.create({ guestbook: { planted: true } });
  assert.deepEqual(collection(inherited, 'guestbook', { entries: [] }), { entries: [] });
  assert.equal(Object.hasOwn(inherited, 'guestbook'), true);
});

test('an old-format saved life survives the refactor: state, timers, per-city entries and receipts', async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const { once } = await import('node:events');
  const { createServer } = await import('./server.js');
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-migrate-')); const secret = randomUUID(), publicId = randomUUID();
  const needs = { hunger: 24, energy: 74, fun: 61, social: 87, hygiene: 31, bladder: 42 };
  const lagos = { cash: 4321, name: 'Ada', homeOwned: true, job: 'community-helper', completedShifts: 7, needs, location: 'park', spot: 'work', activeAction: { kind: 'activity', id: 'helper-shift', duration: 20, remaining: 12 }, message: 'Community helper shift' };
  const ibadan = { cash: 900, name: 'Ada', homeOwned: false, job: null, completedShifts: 0, needs: { hunger: 50, energy: 50, fun: 50, social: 50, hygiene: 50, bladder: 50 }, location: 'library', spot: null, activeAction: { kind: 'travel', id: 'home', duration: 5, remaining: 4 }, message: 'Travelling to Home.' };
  const oldId = `99000:${randomUUID()}`;
  const receipt = { actionAt: 99000, fingerprint: JSON.stringify(['lagos', 'activity', 'helper-shift', null]), ok: true, code: 'started' };
  await writeFile(join(dir, 'devices.json'), JSON.stringify({ version: 1, sessions: { [secret]: { secret, publicId, name: 'Ada', expiresAt: 2592100000, cities: { lagos: { state: lagos, updatedAt: 100000 }, ibadan: { state: ibadan, updatedAt: 100000 } }, actions: { [oldId]: receipt } } } }));
  let time = 100000;
  const server = await createServer({ dataDir: dir, now: () => time }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`, headers = { Cookie: `sid=${secret}`, 'Content-Type': 'application/json' };
  const life = async city => (await (await fetch(`${base}/api/life?city=${city}`, { headers })).json()).state;
  const loaded = await life('lagos');
  for (const key of ['cash', 'name', 'homeOwned', 'job', 'completedShifts', 'needs', 'location', 'spot', 'activeAction', 'message']) assert.deepEqual(loaded[key], lagos[key], `lagos.${key}`);
  assert.equal(loaded.v, 1); assert.equal(loaded.t, 100000);
  const other = await life('ibadan');
  for (const key of ['cash', 'name', 'homeOwned', 'job', 'completedShifts', 'needs', 'location', 'activeAction']) assert.deepEqual(other[key], ibadan[key], `ibadan.${key}`);
  assert.equal(other.spot, 'bookcase', 'a save from before the Library had spots stands at its first spot');
  // The stored receipt still replays as a duplicate (same fingerprint format) and a different body still conflicts.
  const replay = await fetch(`${base}/api/action`, { method: 'POST', headers, body: JSON.stringify({ actionId: oldId, cityId: 'lagos', type: 'activity', id: 'helper-shift' }) });
  const replayed = await replay.json(); assert.equal(replayed.duplicate, true); assert.equal(replayed.code, 'started'); assert.equal(replayed.state.cash, 4321);
  assert.equal((await fetch(`${base}/api/action`, { method: 'POST', headers, body: JSON.stringify({ actionId: oldId, cityId: 'lagos', type: 'activity', id: 'chill' }) })).status, 409);
  time += 12000;
  const done = await life('lagos'); assert.equal(done.cash, 4621); assert.equal(done.completedShifts, 8); assert.equal(done.activeAction, null); assert.equal(done.needs.energy, 64); assert.equal(done.needs.hunger, 19);
  const arrived = await life('ibadan'); assert.equal(arrived.location, 'home'); assert.equal(arrived.spot, 'kitchen'); assert.equal(arrived.cash, 900); assert.equal(arrived.message, 'Arrived at Home.');
  const stored = JSON.parse(await readFile(join(dir, 'devices.json'), 'utf8')).sessions[secret];
  assert.deepEqual(stored.actions[oldId], receipt); assert.equal(stored.publicId, publicId); assert.deepEqual(Object.keys(stored.cities).sort(), ['ibadan', 'lagos']);
});

test('modules shared with the Cloudflare worker stay portable: no Node-only imports', async () => {
  const { readdir } = await import('node:fs/promises');
  const walk = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))).flat();
  const shared = ['server/protocol.js', 'server/life-service.js', 'server/auth.js', 'src/life.js', ...(await walk('server/routes')), ...(await walk('server/ws')),
    ...(await walk('src/game')).filter(file => file.endsWith('.js') && !file.endsWith('.test.js'))];
  assert.ok(shared.length > 40);
  for (const file of shared) {
    const code = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /from\s+['"](node:|ws['"]|fs['"]|path['"]|crypto['"]|http['"])|require\(|\bprocess\.|Date\.now\(|Math\.random\(/, file);
  }
});
