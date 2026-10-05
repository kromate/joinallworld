import { loadCityContent as preloadCityContent } from './game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// The client is a read-only mirror: offline it sends nothing and grants nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient, outgoing, TEXT, STORAGE_KEY, roomJoinNeeded } from './client.ts';
import { dispatch } from './life.ts';
import { START_HOMES, TRAITS, DREAMS } from './game/content/traits.ts';
import { createLife } from './life.ts';
import type { ApiError, NameProblem } from './client.ts';
import type { ActionBody, ActionType } from './types/actions.ts';
import type { LifeState } from './types/life.ts';
import type { OwnSession } from './types/protocol.ts';

/** What the tests read of a request body the client sent. */
interface SentBody { actionId?: string; payload?: unknown }
/** [method, path, parsed request body] of one fake request. */
type Call = [string, string, SentBody | undefined]
/** A fake fetch answer: only what the client reads. */
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
/** Test states that are deliberately not full lives (an action kind this build does not know). */
const loose = (value: unknown) => value as LifeState;

function harness({ online = true } = {}) {
  const calls: Call[] = [], statuses: [string, boolean][] = [], changes: LifeState[] = [];
  let life = createLife({ name: 'Ada' }), up = online, session: OwnSession | null = { id: 'public-1', name: 'Ada' };
  const memory = new Map();
  const fetch = async (path: string, options: RequestInit = {}) => {
    calls.push([options.method || 'GET', path, options.body ? JSON.parse(options.body as string) as SentBody : undefined]);
    if (!up) throw new TypeError('fetch failed');
    if (path === '/api/session') return session ? json(200, { session, serverTime: 5000 }) : json(401, { error: 'device_session_required' });
    if (path.startsWith('/api/life')) return json(200, { state: life, serverTime: 5000 });
    if (path === '/api/action') { life = { ...life, cash: life.cash - 400, message: 'Travelling to The Library.' }; return json(200, { ok: true, code: 'started', state: life, serverTime: 5000 }); }
    return json(404, { error: 'not_found' });
  };
  const client = createClient({ fetch, now: () => 1000, randomUUID: () => '11111111-1111-4111-8111-111111111111', setTimeout: () => 0, clearTimeout: () => {},
    storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) },
    onStatus: (text, error) => statuses.push([text, error]), onChange: state => changes.push(state) });
  return { client, calls, statuses, changes, memory, setUp: (value: boolean) => { up = value; }, dropSession: () => { session = null; } };
}

test('offline client is read-only: no request, no local grant, state unchanged', async () => {
  const h = harness({ online: false });
  assert.equal(await h.client.connect(), false);
  assert.equal(h.client.online, false);
  const before = JSON.stringify(h.client.state); h.calls.length = 0;
  const attempts: [ActionType, Record<string, unknown> | undefined][] = [['travel', { id: 'library', mode: 'cab' }], ['activity', { id: 'chill' }], ['apply-job', { id: 'community-helper' }], ['cancel', undefined]];
  for (const [type, payload] of attempts) {
    assert.deepEqual(await h.client.command(type, payload), { ok: false, code: 'offline', reason: TEXT.paused[h.client.link] });
  }
  assert.equal((await h.client.switchCity('ibadan')).ok, false);
  assert.equal(h.calls.length, 0, 'nothing was sent');
  assert.equal(JSON.stringify(h.client.state), before, 'nothing was applied locally');
  assert.equal(h.client.cityId, 'lagos');
});

test('online commands carry a server-time action ID and a payload, and only server state is accepted', async () => {
  const h = harness();
  assert.equal(await h.client.connect(), true);
  assert.equal(h.client.serverTimeOffset, 4000);
  const result = await h.client.command('travel', { id: 'library', mode: 'cab' });
  assert.deepEqual(result, { ok: true, code: 'started', reason: undefined });
  const [method, path, body] = h.calls.at(-1) as Call;
  assert.deepEqual([method, path], ['POST', '/api/action']);
  assert.deepEqual(body, { actionId: '5000:11111111-1111-4111-8111-111111111111', cityId: 'lagos', type: 'travel', payload: { id: 'library', mode: 'cab' } });
  assert.equal(h.client.state.cash, 4600);
  assert.equal(JSON.parse(h.memory.get(STORAGE_KEY)).state.cash, 4600, 'cache mirrors the server state');
});

test('connection loss mid-session pauses changes with the recovery text and keeps the cached state', async () => {
  const h = harness();
  await h.client.connect();
  h.setUp(false);
  const result = await h.client.command('travel', { id: 'library', mode: 'cab' });
  assert.equal(result.ok, false); assert.equal(result.reason, TEXT.connectionLost);
  assert.deepEqual(h.statuses.at(-1), ['Connection lost. Reconnect to check your saved progress.', true]);
  assert.equal(h.client.online, false); assert.equal(h.client.state.cash, 5000);
  const sent = h.calls.length;
  assert.equal((await h.client.command('cancel')).code, 'offline'); assert.equal(h.calls.length, sent);
  h.setUp(true);
  assert.equal(await h.client.connect(), true); assert.equal(h.client.online, true);
});

test('an expired session stops the client and a tampered cache is sanitized', async () => {
  const h = harness();
  await h.client.connect(); h.dropSession();
  let expired = 0;
  const memory = new Map([[STORAGE_KEY, JSON.stringify({ identity: { name: 'Ada' }, cityId: 'atlantis', state: { cash: 1e30, location: 'vault' } })]]);
  const client = createClient({ fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: 'device_session_required' }) }), setTimeout: () => 0, clearTimeout: () => {},
    storage: { getItem: key => memory.get(key), setItem() {} }, onSessionExpired: () => { expired += 1; } });
  assert.equal(client.cityId, 'lagos'); assert.equal(client.state.cash, 5000); assert.equal(client.state.location, 'park');
  assert.equal(await client.connect(), false); assert.equal(expired, 1); assert.equal(client.online, false);
  assert.equal(TEXT.cityNote('Ibadan'), 'More places and activities are coming to Ibadan.');
});

test('room membership is restored on arrival and after a cancelled trip, and never enables voice', async () => {
  const idle = createLife({ location: 'park' });
  const travelling = createLife({ location: 'park', activeAction: { kind: 'travel', id: 'library', duration: 5, remaining: 3 } });
  const arrived = createLife({ location: 'library' });
  const chilling = createLife({ location: 'park', spot: 'trees', activeAction: { kind: 'activity', id: 'chill', duration: 11, remaining: 4 } });
  assert.equal(roomJoinNeeded(travelling, idle), true, 'trip cancelled: same place, no action');
  assert.equal(roomJoinNeeded(loose({ ...travelling, activeAction: { kind: 'commute' } }), idle), true, 'cancelled work commute rejoins without enabling voice');
  assert.equal(roomJoinNeeded(travelling, arrived), true, 'arrived somewhere new');
  assert.equal(roomJoinNeeded(idle, idle), false);
  assert.equal(roomJoinNeeded(idle, travelling), false, 'setting off does not rejoin');
  assert.equal(roomJoinNeeded(travelling, travelling), false);
  assert.equal(roomJoinNeeded(chilling, idle), false, 'finishing or cancelling an activity is not a room change');
  // The automatic commute is a departure too: the server ends the membership when it starts, so a
  // cancelled commute needs the same rejoin as a cancelled trip — and arriving at work joins there.
  const commuting = createLife({ location: 'park', job: 'tech', activeAction: { kind: 'commute', id: 'cchub', duration: 5, remaining: 3 } });
  assert.equal(commuting.activeAction?.kind, 'commute');
  assert.equal(roomJoinNeeded(commuting, idle), true, 'commute cancelled: same place, no action');
  assert.equal(roomJoinNeeded(commuting, createLife({ location: 'cchub' })), true, 'arrived at work');
  assert.equal(roomJoinNeeded(idle, commuting), false, 'the commute starting does not rejoin');
  assert.equal(roomJoinNeeded(commuting, commuting), false);
  // A timed action of a kind this build does not know is treated as a departure, never as "still here".
  assert.equal(roomJoinNeeded(loose({ location: 'park', activeAction: { kind: 'future-move' } }), idle), true);
  // The community store wires that decision to join only — never to a voice or microphone control.
  const store = await readFile('src/app/features/community/communityStore.ts', 'utf8'), app = await readFile('src/app/state/app.ts', 'utf8');
  assert.match(store, /if \(roomJoinNeeded\(previous, next\)\) instance\?\.join\(game\.cityId\.value, next\.location\)/);
  assert.doesNotMatch(store, /getUserMedia|voice-state|joinVoice|\.(mute|enableVoice)/i);
  assert.doesNotMatch(app, /getUserMedia|voice-state|joinVoice|community\.(mute|voice|enable)/i);
});

test('city sheet footnote uses the current city-specific text', async () => {
  const city = await readFile('src/app/features/travel/CityPanel.vue', 'utf8');
  assert.match(city, /More places and activities are coming to/);
  assert.doesNotMatch(city, /original starter city pack/);
  assert.equal(TEXT.cityNote('Lagos'), 'More places and activities are coming to Lagos.');
});

test('uuid() works without crypto.randomUUID, as on a plain-HTTP LAN origin', async () => {
  const { uuid } = await import('./client.ts');
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const insecure = { getRandomValues: ((bytes: Uint8Array) => globalThis.crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>)) as Crypto['getRandomValues'] };
  const ids = new Set(Array.from({ length: 50 }, () => uuid(insecure)));
  assert.equal(ids.size, 50); for (const id of ids) assert.match(id, pattern);
  assert.match(uuid(), pattern);
});

test('a nickname the server refuses comes back to the form with the server’s reason; other requests keep it on the error', async () => {
  const asked: (NameProblem | undefined)[] = [], statuses: [string, boolean][] = [];
  const reason = 'That name cannot contain a link or web address in this beta.';
  let reply = json(400, { error: 'name_not_allowed', reason });
  const fetch = async (path: string, options: RequestInit = {}) => (path === '/api/session' && options.method === 'POST' ? reply : path === '/api/session' ? json(401, { error: 'device_session_required' }) : json(404, { error: 'not_found' }));
  const client = createClient({ fetch, now: () => 1000, setTimeout: () => 0, clearTimeout: () => {}, onStatus: (text, error) => statuses.push([text, error]), onNeedName: (problem) => asked.push(problem) });
  client.identity.name = 'www.abc.com';
  assert.equal(await client.connect(true), false);
  assert.deepEqual(asked, [{ code: 'name_not_allowed', reason, name: 'www.abc.com' }]);
  assert.deepEqual(statuses.at(-1), ['Choose a different nickname to connect', true]);
  assert.equal(client.online, false);
  // A muted player renaming, and a refusal that carries no sentence: still a reason the form can show.
  reply = json(403, { error: 'muted', reason: 'A moderator has muted you until 10:00 UTC.' });
  await client.connect(true);
  assert.deepEqual([asked.at(-1)?.code, asked.at(-1)?.reason], ['muted', 'A moderator has muted you until 10:00 UTC.']);
  reply = json(400, { error: 'invalid_name' });
  await client.connect(true);
  assert.deepEqual([asked.at(-1)?.code, asked.at(-1)?.reason], ['invalid_name', 'A nickname needs 3 to 24 ordinary characters.']);
  // Anything else is a connection problem, not a question about the name.
  reply = json(503, { error: 'device_capacity' });
  await client.connect(true);
  assert.equal(asked.length, 3);
  // fetchJson rejects with the server's sentence attached, for panels that show it themselves (Profile rename).
  reply = json(400, { error: 'name_not_allowed', reason });
  await assert.rejects(client.fetchJson('/api/session', { method: 'POST', body: { name: 'x' } }), (error: ApiError) => error.status === 400 && error.code === 'name_not_allowed' && error.reason === reason);
});

test('retry keys have the timed form the server requires, stamped with server time', async () => {
  const h = harness();
  await h.client.connect();
  assert.equal(h.client.newId(), '5000:11111111-1111-4111-8111-111111111111', 'server time (5000), not the device clock (1000)');
  await h.client.command('travel', { id: 'library', mode: 'cab' });
  assert.equal(h.calls.at(-1)?.[2]?.actionId, h.client.newId(), 'the same helper stamps action IDs');
});

test('what the server says about its storage is shown as it is: failing, the 503 reason, and saving again', async () => {
  const statuses: [string, boolean][] = [], changes: LifeState[] = [];
  const life = createLife({ name: 'Ada' });
  let mode = 'ok';
  const refused = { error: 'storage_unavailable', reason: 'The server could not save this, so nothing was changed. Try again in a moment.' };
  const fetch = async (path: string) => {
    if (path === '/api/session') return json(200, { session: { id: 'public-1', name: 'Ada' }, serverTime: 5000 });
    if (path === '/api/action') return mode === 'ok' ? json(200, { ok: true, code: 'started', state: life, serverTime: 5000 }) : json(503, refused);
    return json(200, { state: life, serverTime: 5000, ...(mode === 'failing' ? { storage: 'failing' } : {}) });
  };
  const client = createClient({ fetch, now: () => 1000, setTimeout: () => 0, clearTimeout: () => {}, storage: { getItem: () => null, setItem: () => {} },
    onStatus: (text, error) => statuses.push([text, error]), onChange: (state) => changes.push(state) });
  await client.connect();
  assert.equal(client.storage, null);
  mode = 'failing';
  const result = await client.command('spot', { id: 'trees' });
  assert.deepEqual(result, { ok: false, code: 'storage_unavailable', reason: refused.reason }, 'the action is reported as not done, in the server’s words');
  assert.equal(client.online, true, 'the player is not offline: the server answered');
  assert.deepEqual(client.storage, { reason: refused.reason });
  assert.deepEqual(statuses.at(-1), [refused.reason, true]);
  await client.refresh();
  assert.deepEqual(client.storage, { reason: TEXT.notSaving }, 'a success that carries storage "failing" keeps the indicator on');
  mode = 'ok';
  await client.refresh();
  assert.equal(client.storage, null, 'and the next ordinary success clears it');
  assert.deepEqual(statuses.at(-1), ['Connected · progress saved', false]);
});

test('client.link says why the game is not playable: expired, new, offline and unreachable are different states', async () => {
  const session = { ok: true, status: 200, json: async () => ({ session: { id: 'p1', name: 'Ada' }, serverTime: 1000 }) };
  const life = { ok: true, status: 200, json: async () => ({ state: {}, serverTime: 1000 }) };
  const unknown = { ok: false, status: 401, json: async () => ({ error: 'device_session_required' }) };
  const saved = { getItem: () => JSON.stringify({ identity: { name: 'Ada' }, cityId: 'lagos', state: {} }), setItem() {} };
  const timers = { setTimeout: () => 0, clearTimeout: () => {} };

  // The owner's case: the server answers, but does not know this browser's session, and a life is cached here.
  const expired = createClient({ fetch: async () => unknown, storage: saved, ...timers });
  assert.equal(expired.link, 'connecting');
  assert.equal(await expired.connect(), false);
  assert.equal(expired.link, 'expired', 'a reachable server that has lost the session is "expired", never "offline"');

  // The same answer on a browser with no cached life is simply a new player.
  const fresh = createClient({ fetch: async () => unknown, storage: { getItem: () => null, setItem() {} }, ...timers });
  assert.equal(await fresh.connect(), false);
  assert.equal(fresh.link, 'new');

  // No answer at all: the device's own network decides between "offline" and "unreachable".
  let deviceOnline = true, serverUp = true;
  const client = createClient({ fetch: async (path) => { if (!serverUp) throw new Error('fetch failed'); return String(path).startsWith('/api/session') ? session : life; }, storage: saved, isOnline: () => deviceOnline, ...timers });
  assert.equal(await client.connect(), true); assert.equal(client.link, 'online');
  serverUp = false;
  assert.equal((await client.command('cancel')).ok, false);
  assert.equal(client.link, 'unreachable', 'the device is online, the server did not answer');
  deviceOnline = false;
  assert.equal(await client.connect(), false);
  assert.equal(client.link, 'offline', 'the device itself has no network');
  deviceOnline = true; serverUp = true;
  assert.equal(await client.connect(), true); assert.equal(client.link, 'online');

  // A session that disappears mid-game (401 on an action) is expired too.
  const dropped = createClient({ fetch: async (path, options) => (options?.method === 'POST' ? unknown : String(path).startsWith('/api/session') ? session : life), storage: saved, ...timers });
  assert.equal(await dropped.connect(), true);
  await dropped.command('cancel');
  assert.equal(dropped.link, 'expired');
});

test('settling in: the game’s own client cannot send the legacy rented-home payload — the rules still accept it from old scripts', async () => {
  // The client: whatever a panel puts in the payload, only { lga, via, stay } leave the device.
  const h = harness();
  await h.client.connect(); h.calls.length = 0;
  await h.client.command('onboarding.home', { house: 'mushin', lga: 'ikeja', via: 'manual', stay: true, extra: 1 });
  assert.deepEqual(h.calls[0]?.[2]?.payload, { lga: 'ikeja', via: 'manual', stay: true });
  h.calls.length = 0;
  await h.client.command('onboarding.home', { house: 'mushin' });
  assert.deepEqual(h.calls[0]?.[2]?.payload, {}, 'a rented home alone is sent as nothing: the server answers lga_required');
  assert.deepEqual(outgoing('onboarding.home', { house: 'yaba', via: 'device' }), { via: 'device' });
  // Every other action is sent as written.
  const travel = { id: 'library', mode: 'cab', house: 'x' };
  assert.equal(outgoing('travel', travel), travel);
  // The rules: an old script (or the Worker) that still sends { house } is served as before, and {} is refused.
  const house = Object.keys(START_HOMES)[0];
  const ready = () => {
    const life = createLife(null, { now: 1000, cityId: 'lagos', isNew: true, quickStart: true });
    const send = (type: ActionType, payload: Record<string, unknown>, id: string) => dispatch(life, { type, payload, actionId: id } as ActionBody, { now: 1000, cityId: 'lagos', actionId: id });
    send('onboarding.quick-start', { look: life.onboarding.look }, 'play');
    send('onboarding.traits', { traits: Object.keys(TRAITS).slice(0, 2) }, 'traits'); send('onboarding.dream', { dream: Object.keys(DREAMS)[0] }, 'dream');
    return { life, send };
  };
  const probe = ready();
  probe.send('onboarding.lottery', {}, 'lottery');
  assert.equal(probe.send('onboarding.home', outgoing('onboarding.home', { house }), 'home-client').code, 'lga_required', 'what the client would send for { house }');
  const legacy = probe.send('onboarding.home', { house }, 'home-legacy');
  assert.ok(legacy.code === 'life_started' || legacy.code === 'house_locked', `the legacy payload is still understood (${legacy.code})`);
});

test('a cached cityId that is not a string is ignored, and switchCity refuses a non-string id', async () => {
  const memory = new Map([[STORAGE_KEY, JSON.stringify({ identity: { name: 'Ada' }, cityId: ['lagos'] })]]);
  const client = createClient({ fetch: async () => json(404, { error: 'not_found' }), setTimeout: () => 0, clearTimeout: () => {},
    storage: { getItem: key => memory.get(key), setItem() {} } });
  assert.equal(client.cityId, 'lagos');
  const result = await client.switchCity(['lagos'] as unknown as string);
  assert.deepEqual(result, { ok: false, code: 'invalid_city' });
});

test('a JSON null response body is the unreadable-response error, not a TypeError', async () => {
  const client = createClient({ fetch: async () => json(200, null), setTimeout: () => 0, clearTimeout: () => {} });
  await assert.rejects(() => client.api('/api/anything'), (error: Error) => error.message === 'Server returned an unreadable response' && !(error instanceof TypeError));
});

test('a full world is not an unreachable server: a new start refused with 503 device_capacity is remembered as "full" until the next attempt', async () => {
  const full = { ok: false, status: 503, json: async () => ({ error: 'device_capacity', reason: 'The world is full right now. Your place is not lost: try again in a moment.' }) };
  const session = { ok: true, status: 200, json: async () => ({ session: { id: 'p1', name: 'Ada' }, serverTime: 1000 }) };
  const life = { ok: true, status: 200, json: async () => ({ state: {}, serverTime: 1000 }) };
  let places = 0;
  const statuses: string[] = [];
  const client = createClient({ fetch: async (path) => (String(path).startsWith('/api/session') ? (places > 0 ? session : full) : life), storage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, clearTimeout: () => {}, onStatus: (text) => { statuses.push(text); } });
  assert.equal(client.refusal, null);
  assert.equal(await client.connect(true), false);
  assert.equal(client.refusal, 'full');
  assert.equal(statuses.at(-1), TEXT.worldFull);
  assert.equal(client.online, false);
  // A place opened: the same start succeeds and nothing of the refusal is left.
  places = 1;
  assert.equal(await client.connect(true), true);
  assert.equal(client.refusal, null); assert.equal(client.link, 'online');
  // A server that does not answer at all is something else.
  const down = createClient({ fetch: async () => { throw new Error('fetch failed'); }, storage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, clearTimeout: () => {} });
  assert.equal(await down.connect(true), false);
  assert.equal(down.refusal, null); assert.equal(down.link, 'unreachable');
});

test('a new start refused for too many new players from one network address is remembered as "limit", with the wait the server gave', async () => {
  const limited = { ok: false, status: 429, json: async () => ({ error: 'rate_limited', retryAfter: 1380, reason: 'Too many new players have started from your network in the last hour.' }) };
  const statuses: string[] = [];
  const client = createClient({ fetch: async () => limited, storage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, clearTimeout: () => {}, onStatus: (text) => { statuses.push(text); } });
  assert.equal(await client.connect(true), false);
  assert.deepEqual([client.refusal, client.retryAfter], ['limit', 1380]);
  assert.equal(statuses.at(-1), TEXT.networkLimit);
  // A 429 on anything but a new start is the ordinary rate limit, not this.
  const returning = createClient({ fetch: async () => limited, storage: { getItem: () => JSON.stringify({ identity: { name: 'Ada' }, cityId: 'lagos', state: {} }), setItem() {} }, setTimeout: () => 0, clearTimeout: () => {} });
  assert.equal(await returning.connect(), false);
  assert.deepEqual([returning.refusal, returning.retryAfter], [null, null]);
});
