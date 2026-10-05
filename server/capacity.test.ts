// How many players a host takes, and what happens at each cap (docs/CAPACITY.md): the settings, the place a new
// visitor waits for, and the socket that is told to come back later while nobody connected is dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { fixture, type Device } from './test-fixture.ts';
import { CAPACITY_DEFAULTS, capacityConfig } from './host-context.ts';
import { SOCKET_BUSY_CODE, SOCKETS_PER_ADDRESS, SOCKETS_PER_PLAYER } from './protocol.ts';

test('the caps are settings: a whole number inside its bounds replaces the default, anything else is ignored and said once', () => {
  assert.deepEqual(capacityConfig({}), CAPACITY_DEFAULTS);
  assert.deepEqual(capacityConfig(null), CAPACITY_DEFAULTS);
  assert.equal(CAPACITY_DEFAULTS.socketsPerAddress, SOCKETS_PER_ADDRESS);
  assert.equal(CAPACITY_DEFAULTS.socketsPerPlayer, SOCKETS_PER_PLAYER);
  assert.deepEqual(capacityConfig({ MAX_ACTIVE_SESSIONS: '25000', MAX_SOCKETS: ' 8000 ', SOCKETS_PER_ADDRESS: 64, NEW_SESSIONS_PER_ADDRESS: '1000' }), { ...CAPACITY_DEFAULTS, maxActiveSessions: 25000, maxSockets: 8000, socketsPerAddress: 64, newSessionsPerAddress: 1000 });
  const lines: string[] = [];
  const config = capacityConfig({ MAX_ACTIVE_SESSIONS: 'lots', MAX_SOCKETS: '0', SOCKETS_PER_ADDRESS: '1e9', SOCKETS_PER_PLAYER: '500' }, (line) => { lines.push(line); });
  assert.deepEqual(config, CAPACITY_DEFAULTS, 'a typing mistake leaves the default in place, and a number that is not a setting is not read');
  assert.equal(lines.length, 3);
  assert.match(lines[0] ?? '', /^MAX_ACTIVE_SESSIONS must be a whole number from 1 to \d+: the default \(\d+\) is used\.$/);
  assert.equal(capacityConfig({ MAX_SOCKETS: '32000' }).maxSockets, 32000, 'the most a host can be told is what the platform allows');
  assert.equal(capacityConfig({ MAX_SOCKETS: '32001' }).maxSockets, CAPACITY_DEFAULTS.maxSockets);
  assert.equal(capacityConfig({ MAX_SOCKETS: '' }).maxSockets, CAPACITY_DEFAULTS.maxSockets, 'an empty setting is no setting');
});

test('a full world asks a NEW visitor to wait, with a sentence; everyone who has a session plays on, and a place that ran out is given away', async t => {
  const f = await fixture(t, { maxActiveSessions: 2 });
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  const refused = await f.request('/api/session', { name: 'Chidi' });
  assert.equal(refused.status, 503);
  assert.equal(refused.headers.get('retry-after'), '30');
  assert.deepEqual(await refused.json(), { error: 'device_capacity', reason: 'The world is full right now. Your place is not lost: try again in a moment.', retryAfter: 30 });
  // The players who are in are not affected: they poll, act and rename as before.
  assert.equal((await f.request('/api/life?city=lagos', undefined, ada.cookie)).status, 200);
  assert.equal((await f.action(bola.cookie, { type: 'spot', payload: { id: 'trees' } })).ok, true);
  assert.equal((await f.request('/api/session', { name: 'Ada Again' }, ada.cookie)).status, 200);
  // Bola stays away for a session lifetime while Ada keeps playing: the place is counted as free the moment it is asked for.
  f.advance(2592000000 - 60000);
  assert.equal((await f.request('/api/session', undefined, ada.cookie)).status, 200);
  f.advance(120000);
  const admitted = await f.request('/api/session', { name: 'Chidi' });
  assert.equal(admitted.status, 200, 'the visitor who waited is let in');
  assert.equal((await f.request('/api/session', { name: 'Dami' })).status, 503, 'and the world is full again');
});

test('every socket taken: a new one is opened and closed with "try again later", nobody connected is dropped, and a place freed is a place given', async t => {
  const f = await fixture(t, { maxSockets: 2 });
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  const first = await f.socket(ada), second = await f.socket(bola);
  const open = async (device: Device): Promise<{ opened: boolean; code: number; reason: string }> => {
    const ws = new WebSocket(`${f.base.replace('http', 'ws')}/socket`, { headers: { Cookie: device.cookie, Origin: f.base } });
    t.after(() => ws.terminate());
    let opened = false;
    ws.on('open', () => { opened = true; }); ws.on('error', () => {});
    const [code, reason] = await Promise.race([once(ws, 'close') as Promise<[number, Buffer]>, new Promise<[number, Buffer]>((resolve) => setTimeout(() => resolve([0, Buffer.from('still open')]), 300))]);
    return { opened, code, reason: String(reason) };
  };
  assert.deepEqual(await open(ada), { opened: true, code: SOCKET_BUSY_CODE, reason: 'socket_capacity' }, 'the page can read why: a browser cannot read the status of a refused upgrade');
  assert.equal(f.server.wss.clients.size, 2, 'the socket that was turned away is not among the server\'s sockets');
  // The two who are connected still are, and still work.
  first.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  assert.equal((await first.next()).type, 'presence');
  assert.equal(second.ws.readyState, WebSocket.OPEN);
  // One leaves: the next socket is taken.
  second.ws.close(); await once(second.ws, 'close');
  for (let i = 0; i < 50 && f.server.wss.clients.size > 1; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(await open(bola), { opened: true, code: 0, reason: 'still open' });
});

test('a message for one player goes to that player\'s sockets, however many others are connected, and stops when they close', async t => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  for (const who of [ada, bola]) await f.request('/api/life?city=lagos', undefined, who.cookie);
  const one = await f.socket(ada), two = await f.socket(ada), other = await f.socket(bola);
  const core = f.server as unknown as { wss: { clients: Set<{ session: { id: string } }> } };
  assert.equal([...core.wss.clients].filter((ws) => ws.session.id === ada.id).length, 2);
  // A rename reaches both of Ada's sockets (the registry finds them by player) and none of Bola's.
  one.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await one.next();
  other.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await other.next(); await one.next();
  assert.equal((await f.request('/api/session', { name: 'Ada Renamed' }, ada.cookie)).status, 200);
  /** The next member list this socket is sent that satisfies `wanted` (a few may come first). */
  const until = async (socket: typeof one, wanted: (names: string[]) => boolean): Promise<string[]> => {
    for (let i = 0; i < 6; i++) { const frame = await socket.next(); if (frame.type === 'presence') { const names = frame.members.map((member) => member.name); if (wanted(names)) return names; } }
    throw new Error('the member list never said so');
  };
  assert.deepEqual((await until(one, (names) => names.includes('Ada Renamed'))).sort(), ['Ada Renamed', 'Bola']);
  assert.deepEqual((await until(other, (names) => names.includes('Ada Renamed'))).sort(), ['Ada Renamed', 'Bola']);
  two.ws.close(); await once(two.ws, 'close');
  one.ws.close(); await once(one.ws, 'close');
  assert.deepEqual(await until(other, (names) => names.length === 1), ['Bola'], 'the room is told she left');
  for (let i = 0; i < 50 && core.wss.clients.size > 1; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  // Her sockets are no longer held: a rename now has nobody to tell, and is answered all the same.
  assert.equal((await f.request('/api/session', { name: 'Ada Away' }, ada.cookie)).status, 200);
  assert.equal(core.wss.clients.size, 1);
});

test('players who connect together are announced to their friends with at most one read of the store each, and as they are now', async t => {
  const f = await fixture(t);
  const watcher = await f.device('Watcher'), friends: Device[] = [];
  await f.request('/api/life?city=lagos', undefined, watcher.cookie); await f.request('/api/social/me', undefined, watcher.cookie);
  for (let i = 0; i < 8; i++) {
    const friend = await f.device(`Friend ${i}`);
    await f.request('/api/life?city=lagos', undefined, friend.cookie); await f.request('/api/social/me', undefined, friend.cookie);
    assert.equal(((await (await f.request('/api/social/friends/request', { to: watcher.id, cityId: 'lagos' }, friend.cookie)).json()) as { ok: boolean }).ok, true);
    assert.equal(((await (await f.request('/api/social/friends/answer', { from: friend.id, accept: true, cityId: 'lagos' }, watcher.cookie)).json()) as { ok: boolean }).ok, true);
    friends.push(friend);
  }
  const seen = new Map<string, string[]>();
  const watching = await f.socket(watcher);
  watching.ws.on('message', (data) => { const frame = JSON.parse(String(data)) as { type: string; id?: string; status?: string }; if (frame.type === 'people-presence' && frame.id && frame.status) seen.set(frame.id, [...(seen.get(frame.id) ?? []), frame.status]); });
  const sockets = await Promise.all(friends.map((friend) => f.socket(friend)));
  for (let i = 0; i < 100 && seen.size < friends.length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual([...seen].sort(), friends.map((friend): [string, string[]] => [friend.id, ['online']]).sort(), 'every friend who connected is announced, once');
  // The watcher's own devices: a second socket of someone already online announces nothing.
  seen.clear();
  await f.socket(friends[0] as Device);
  sockets[1]?.ws.close(); await once(sockets[1]?.ws as WebSocket, 'close');
  for (let i = 0; i < 100 && seen.size < 1; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual([...seen], [[(friends[1] as Device).id, ['reconnecting']]]);
});

test('too many new players from one network address: the next one is told why and when to come back, and players who are in are not affected', async t => {
  const f = await fixture(t, { trustProxy: true, env: { NEW_SESSIONS_PER_ADDRESS: '3' } });
  const from = { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.77' };
  const start = (name: string, headers: Record<string, string> = from) => fetch(`${f.base}/api/session`, { method: 'POST', headers, body: JSON.stringify({ name }) });
  const cookies: string[] = [];
  for (const name of ['Ada', 'Bola', 'Chidi']) { const made = await start(name); assert.equal(made.status, 200); cookies.push((made.headers.get('set-cookie') ?? '').split(';')[0] ?? ''); }
  f.advance(20 * 60000);
  const refused = await start('Dami');
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get('retry-after'), '2400', 'forty minutes of the hour are left');
  const body = await refused.json() as { error: string; reason: string; retryAfter: number };
  assert.deepEqual([body.error, body.retryAfter], ['rate_limited', 2400]);
  assert.match(body.reason, /^Too many new players have started from your network in the last hour \(a shared Wi-Fi or mobile network counts as one\)\. Nothing is lost: try again in about 40 minutes\.$/);
  // Someone already in, from the same address, plays on and may rename; another address is not affected.
  assert.equal((await fetch(`${f.base}/api/session`, { method: 'POST', headers: { ...from, Cookie: cookies[0] ?? '' }, body: JSON.stringify({ name: 'Ada Again' }) })).status, 200);
  assert.equal((await start('Efe', { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.78' })).status, 200);
  // When the hour is over the visitor who waited is let in.
  f.advance(41 * 60000);
  assert.equal((await start('Dami')).status, 200);
});
