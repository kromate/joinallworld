// The client is a read-only mirror: offline it sends nothing and grants nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, TEXT, STORAGE_KEY } from './client.js';
import { createLife } from './life.js';

function harness({ online = true } = {}) {
  const calls = [], statuses = [], changes = [];
  let life = createLife({ name: 'Ada' }), up = online, session = { id: 'public-1', name: 'Ada' };
  const memory = new Map();
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const fetch = async (path, options = {}) => {
    calls.push([options.method || 'GET', path, options.body ? JSON.parse(options.body) : undefined]);
    if (!up) throw new TypeError('fetch failed');
    if (path === '/api/session') return session ? json(200, { session, serverTime: 5000 }) : json(401, { error: 'device_session_required' });
    if (path.startsWith('/api/life')) return json(200, { state: life, serverTime: 5000 });
    if (path === '/api/action') { life = { ...life, cash: life.cash - 400, message: 'Travelling to The Library.' }; return json(200, { ok: true, code: 'started', state: life, serverTime: 5000 }); }
    return json(404, { error: 'not_found' });
  };
  const client = createClient({ fetch, now: () => 1000, randomUUID: () => '11111111-1111-4111-8111-111111111111', setTimeout: () => 0, clearTimeout: () => {},
    storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) },
    onStatus: (text, error) => statuses.push([text, error]), onChange: state => changes.push(state) });
  return { client, calls, statuses, changes, memory, setUp: value => { up = value; }, dropSession: () => { session = null; } };
}

test('offline client is read-only: no request, no local grant, state unchanged', async () => {
  const h = harness({ online: false });
  assert.equal(await h.client.connect(), false);
  assert.equal(h.client.online, false);
  const before = JSON.stringify(h.client.state); h.calls.length = 0;
  for (const [type, payload] of [['travel', { id: 'library', mode: 'cab' }], ['activity', { id: 'chill' }], ['apply-job', { id: 'community-helper' }], ['cancel', undefined]]) {
    assert.deepEqual(await h.client.command(type, payload), { ok: false, code: 'offline', reason: TEXT.offlinePaused });
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
  const [method, path, body] = h.calls.at(-1);
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
