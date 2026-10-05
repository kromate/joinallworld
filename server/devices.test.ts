// OWNER: foundation — one character open on several devices (docs/DEVICES.md).
// An account binds three browsers to one character, each with its own cookie and its own socket. The rules under test:
// every device converges on the server's life without a reload, revisions only go up, two devices acting at once both
// get a correct answer, presence counts any device, and a call rings everywhere but is carried by exactly one socket.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.ts';
import type { Device, TestSocket } from './test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { CALL_RING_MS } from '../src/types/calls.ts';
import type { CallStateFrame } from '../src/types/calls.ts';
import type { ActionResponse, LifeResponse, ServerFrame } from '../src/types/protocol.ts';

const PROJECT = 'allworld-test-project';
const ENV = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' };
type Frame<T extends ServerFrame['type']> = Extract<ServerFrame, { type: T }>;
type Fixture = Awaited<ReturnType<typeof fixture>>;

const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
const send = (peer: TestSocket, frame: object): void => peer.ws.send(JSON.stringify(frame));
async function until<T extends ServerFrame['type']>(peer: TestSocket, type: T): Promise<Frame<T>> {
  for (let i = 0; i < 300; i++) { const message = await peer.next(); if (message.type === type) return message as Frame<T>; }
  throw Error(`No ${type} message`);
}
/** Everything the socket was sent up to now (a settings read is answered after every earlier push). */
async function drain(peer: TestSocket): Promise<ServerFrame[]> {
  send(peer, { type: 'call-settings' });
  const seen: ServerFrame[] = [];
  for (let i = 0; i < 300; i++) { const message = await peer.next(); if (message.type === 'call-settings') return seen; seen.push(message); }
  throw Error('No settings reply');
}
const ofType = (frames: ServerFrame[], prefix: string): ServerFrame[] => frames.filter((frame) => frame.type.startsWith(prefix));
const callStates = (frames: ServerFrame[]): CallStateFrame[] => frames.filter((frame): frame is CallStateFrame => frame.type === 'call-state');

/**
 * Ada's character on three signed-in browsers (three cookies, one public id) and Bola, a friend, on one. The sign-in
 * provider is the stand-in the account tests use: no test reaches a real one.
 */
async function household(t: TestContext) {
  const key = await makeKey('key-1');
  const provider = fakeProvider([key]);
  const f = await fixture(t, { env: ENV, fetch: (url, init) => provider.fetch(url, init as { body?: unknown }), log: () => {} });
  let minted = 0;
  const call = (path: string, body: unknown, cookie?: string): Promise<Response> => fetch(f.base + path, { method: body === null ? 'GET' : 'POST', headers: { Origin: f.base, ...(body === null ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === null ? {} : { body: JSON.stringify(body) }) });
  const csrf = async (cookie?: string): Promise<string | null> => (cookie ? ((await (await call('/api/account', null, cookie)).json()) as { csrf: string | null }).csrf : null);
  const token = (): Promise<string> => signToken(key, claimsFor(PROJECT, f.now(), { subject: 'UidAda', email: 'ada@example.com', n: ++minted }));
  async function signIn(cookie?: string): Promise<string> {
    const response = await call('/api/account/sign-in', { idToken: await token(), csrf: await csrf(cookie) }, cookie);
    assert.equal(response.status, 200);
    return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }
  const guest = await f.device('Ada');
  await f.request('/api/life?city=lagos', null, guest.cookie);
  const laptop = { cookie: await signIn(guest.cookie) }, phone = { cookie: await signIn() }, tablet = { cookie: await signIn() };
  const bola = await f.device('Bola');
  for (const cookie of [laptop.cookie, bola.cookie]) await f.request('/api/social/me', null, cookie);
  assert.equal(((await (await f.request('/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, laptop.cookie)).json()) as { code: string }).code, 'requested');
  assert.equal(((await (await f.request('/api/social/friends/answer', { from: guest.id, accept: true, cityId: 'lagos' }, bola.cookie)).json()) as { code: string }).code, 'accepted');
  const life = async (device: { cookie: string }): Promise<LifeResponse & { rev?: number }> => (await f.request('/api/life?city=lagos', null, device.cookie)).json() as Promise<LifeResponse & { rev?: number }>;
  const act = async (device: { cookie: string }, fields: { type: string; [field: string]: unknown }, actionId = `${f.now()}:${randomUUID()}`): Promise<ActionResponse & { rev?: number }> =>
    (await f.request('/api/action', { actionId, cityId: 'lagos', ...fields }, device.cookie)).json() as Promise<ActionResponse & { rev?: number }>;
  return { f, id: guest.id, laptop, phone, tablet, bola, life, act, call, csrf, token };
}
/** The three devices and the friend, each with an open socket. */
async function connectedHousehold(t: TestContext) {
  const home = await household(t);
  const { f } = home;
  const [a, b, c, friend] = await Promise.all([home.laptop, home.phone, home.tablet, home.bola].map((device) => f.socket(device, { life: true }))) as [TestSocket, TestSocket, TestSocket, TestSocket];
  await pause(100); // what setting the household up announced has gone out
  for (const peer of [a, b, c, friend]) await drain(peer);
  return { ...home, a, b, c, friend };
}
let counter = 0;
const invite = (peer: TestSocket, to: string): string => { const clientId = `d${++counter}`; send(peer, { type: 'call-invite', to, clientId }); return clientId; };
const SDP = { sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };
const ICE = { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 4000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
/** Bola rings Ada; every one of her devices rings. Returns the call id. */
async function ring(home: Awaited<ReturnType<typeof connectedHousehold>>): Promise<string> {
  invite(home.friend, home.id);
  const incoming = await Promise.all([home.a, home.b, home.c].map((peer) => until(peer, 'call-incoming')));
  assert.equal((await until(home.friend, 'call-state')).state, 'ringing');
  assert.equal(new Set(incoming.map((frame) => frame.callId)).size, 1, 'one call, announced to every device');
  return incoming[0]!.callId;
}
/** …and the phone answers. */
async function answered(home: Awaited<ReturnType<typeof connectedHousehold>>): Promise<string> {
  const callId = await ring(home);
  send(home.b, { type: 'call-accept', callId });
  assert.equal((await until(home.b, 'call-state')).state, 'accepted');
  assert.equal((await until(home.friend, 'call-state')).state, 'accepted');
  return callId;
}

// ---- the life ------------------------------------------------------------------------------------------------------

test('a command accepted from one device is announced to every socket of the character with a higher revision, and each device then reads the same life', async (t) => {
  const home = await connectedHousehold(t);
  const before = await home.life(home.phone);
  assert.equal(typeof before.rev, 'number', 'a life answer carries its revision');
  const actionId = `${home.f.now()}:${randomUUID()}`;
  const done = await home.act(home.laptop, { type: 'travel', id: 'library', mode: 'cab' }, actionId);
  assert.equal(done.ok, true);
  assert.ok((done.rev ?? 0) > (before.rev ?? 0), 'the action answer is newer than the earlier read');
  const frames = await Promise.all([home.a, home.b, home.c].map((peer) => until(peer, 'life-changed')));
  for (const frame of frames) {
    assert.ok(frame.rev >= (done.rev ?? Infinity), 'the frame names a revision at least as new as the action');
    assert.deepEqual(frame.by, [actionId], 'and the action that caused it, so the device that sent it does not read again');
  }
  const [phone, tablet] = await Promise.all([home.life(home.phone), home.life(home.tablet)]);
  for (const seen of [phone, tablet]) {
    assert.equal(seen.state.cash, done.state.cash);
    assert.deepEqual(seen.state.activeAction, done.state.activeAction);
    assert.ok((seen.rev ?? 0) > (done.rev ?? Infinity), 'every later read has a higher revision');
  }
  // Another player hears nothing of it.
  await pause(120);
  assert.deepEqual(ofType(await drain(home.friend), 'life-'), []);
});

test('revisions only go up, whichever device asks; a burst of commands is announced in few frames; a quiet poll announces nothing', async (t) => {
  const home = await connectedHousehold(t);
  const seen: number[] = [];
  seen.push((await home.life(home.laptop)).rev ?? -1);
  seen.push((await home.act(home.phone, { type: 'spot', id: 'trees' })).rev ?? -1);
  seen.push((await home.life(home.tablet)).rev ?? -1);
  seen.push((await home.act(home.laptop, { type: 'spot', id: 'drinks' })).rev ?? -1);
  seen.push((await home.life(home.phone)).rev ?? -1);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i]! > seen[i - 1]!, `revision ${i} is higher than the one before: ${seen.join(', ')}`);
  await pause(150);
  await drain(home.c);
  // Five accepted commands at once: the tablet is told, in fewer frames than commands, and the last frame is the newest.
  const burst = await Promise.all(['trees', 'drinks', 'trees', 'drinks', 'trees'].map((id) => home.act(home.laptop, { type: 'spot', id })));
  await pause(250);
  const told = (await drain(home.c)).filter((frame): frame is Frame<'life-changed'> => frame.type === 'life-changed');
  assert.ok(told.length >= 1 && told.length < burst.length, `a burst is coalesced (${told.length} frames for ${burst.length} commands)`);
  assert.ok(told.at(-1)!.rev >= Math.max(...burst.map((answer) => answer.rev ?? 0)));
  // A poll that changes nothing a player would see is not announced.
  await home.life(home.phone); await home.life(home.laptop);
  await pause(150);
  assert.deepEqual(ofType(await drain(home.c), 'life-'), []);
});

test('two devices acting at the same moment: each command is judged against the life after the other, nothing is spent twice, and a repeat of one action id is one action', async (t) => {
  const home = await connectedHousehold(t);
  const start = (await home.life(home.laptop)).state;
  // Two different trips at once: the second to be applied finds a trip already running and gets its ordinary refusal.
  const [one, two] = await Promise.all([home.act(home.laptop, { type: 'travel', id: 'radio', mode: 'cab' }), home.act(home.phone, { type: 'travel', id: 'library', mode: 'cab' })]);
  assert.deepEqual([one.ok, two.ok].sort(), [false, true], 'exactly one of the two trips starts');
  const refused = one.ok ? two : one, taken = one.ok ? one : two;
  assert.equal(typeof refused.code, 'string');
  assert.deepEqual(refused.state.activeAction, taken.state.activeAction, 'the refused device is answered with the life as it now is');
  assert.equal(refused.state.cash, taken.state.cash, 'one fare was paid');
  assert.ok(taken.state.cash < start.cash);
  // The same action id from two devices (a retry that raced): applied once.
  await home.act(home.laptop, { type: 'cancel' });
  const settled = (await home.life(home.laptop)).state.cash;
  const actionId = `${home.f.now()}:${randomUUID()}`;
  const [first, second] = await Promise.all([home.act(home.laptop, { type: 'travel', id: 'library', mode: 'cab' }, actionId), home.act(home.tablet, { type: 'travel', id: 'library', mode: 'cab' }, actionId)]);
  assert.deepEqual([first.ok, second.ok], [true, true]);
  assert.equal([first, second].filter((answer) => answer.duplicate === true).length, 1, 'one of the two is the repeat');
  assert.equal(first.state.cash, second.state.cash);
  assert.equal(settled - first.state.cash, Reflect.get(first.state.activeAction ?? {}, 'fare'), 'one fare, not two');
  assert.ok(settled - first.state.cash > 0);
});

test('a device that was away reads the life as it is now: its socket was closed while the others played, and its next read is newer than anything it held', async (t) => {
  const home = await connectedHousehold(t);
  const held = await home.life(home.tablet);
  home.c.ws.close(); await once(home.c.ws, 'close');
  await home.act(home.laptop, { type: 'travel', id: 'library', mode: 'cab' });
  home.f.advance(600000);
  const arrived = await home.life(home.laptop);
  assert.equal(arrived.state.location, 'library');
  // The tablet wakes: a new socket, then one read.
  const again = await home.f.socket(home.tablet);
  const now = await home.life(home.tablet);
  assert.equal(now.state.location, 'library');
  assert.equal(now.state.cash, arrived.state.cash);
  assert.ok((now.rev ?? 0) > (held.rev ?? Infinity));
  again.ws.close();
});

test('what is read on one device is read on the others: a conversation, the updates list and who may ring', async (t) => {
  const home = await connectedHousehold(t);
  const sent = await (await home.f.request('/api/social/messages', { to: home.id, body: 'Hello Ada', clientId: home.f.id() }, home.bola.cookie)).json() as { conv: { id: string } };
  for (const peer of [home.a, home.b, home.c]) assert.equal((await until(peer, 'dm')).conv.id, sent.conv.id);
  assert.equal((await home.f.request(`/api/social/conversations/${sent.conv.id}/read`, {}, home.phone.cookie)).status, 200);
  for (const peer of [home.a, home.b, home.c]) {
    const frame = await until(peer, 'social-read');
    assert.equal(frame.conv?.id, sent.conv.id);
    assert.equal(frame.conv?.unread, 0);
  }
  assert.equal((await home.f.request('/api/social/updates/read', {}, home.laptop.cookie)).status, 200);
  for (const peer of [home.a, home.b, home.c]) assert.equal((await until(peer, 'social-read')).updates, true);
  // A friend removed on the tablet: the other devices are told to read their overview again.
  assert.equal((await home.f.request('/api/social/friends/remove', { id: home.bola.id, cityId: 'lagos' }, home.tablet.cookie)).status, 200);
  for (const peer of [home.a, home.b]) await until(peer, 'social-changed');
  // The setting kept on the server with the player.
  send(home.a, { type: 'call-settings', calls: 'friends' });
  for (const peer of [home.a, home.b, home.c]) assert.equal((await until(peer, 'call-settings')).calls, 'friends');
});

// ---- presence ------------------------------------------------------------------------------------------------------

test('a player is online while any device is connected: closing one of three tells nobody, and closing the last one does', async (t) => {
  const home = await connectedHousehold(t);
  const status = async (): Promise<string | undefined> => ((await (await home.f.request('/api/social/me', null, home.bola.cookie)).json()) as { friends: { id: string; status: string }[] }).friends.find((friend) => friend.id === home.id)?.status;
  for (const peer of [home.a, home.b, home.c]) send(peer, { type: 'join', cityId: 'lagos', venueId: 'park' });
  for (const peer of [home.a, home.b, home.c]) await until(peer, 'presence');
  await drain(home.friend);
  home.a.ws.close(); await once(home.a.ws, 'close');
  home.b.ws.close(); await once(home.b.ws, 'close');
  await pause(80);
  assert.deepEqual(ofType(await drain(home.friend), 'people-presence'), [], 'two of three devices closed: nothing is announced');
  assert.equal(await status(), 'online');
  home.c.ws.close(); await once(home.c.ws, 'close');
  const gone = await until(home.friend, 'people-presence');
  assert.deepEqual([gone.id, gone.status], [home.id, 'reconnecting']);
});

// ---- calls ---------------------------------------------------------------------------------------------------------

test('an incoming call rings every device; when one answers the others are told it was answered elsewhere, and signalling reaches the answering socket only', async (t) => {
  const home = await connectedHousehold(t);
  const callId = await ring(home);
  // Nothing is relayed before a device has answered.
  send(home.friend, { type: 'call-signal', callId, kind: 'offer', data: SDP });
  assert.equal((await until(home.friend, 'error')).code, 'invalid_call');
  send(home.b, { type: 'call-accept', callId });
  const mine = await until(home.b, 'call-state');
  assert.deepEqual([mine.state, mine.elsewhere], ['accepted', undefined]);
  for (const peer of [home.a, home.c]) {
    const other = await until(peer, 'call-state');
    assert.deepEqual([other.state, other.elsewhere, other.callId, other.peer?.id], ['accepted', true, callId, home.bola.id]);
  }
  assert.equal((await until(home.friend, 'call-state')).state, 'accepted');
  send(home.friend, { type: 'call-signal', callId, kind: 'offer', data: SDP });
  assert.equal((await until(home.b, 'call-signal')).kind, 'offer');
  send(home.b, { type: 'call-signal', callId, kind: 'answer', data: SDP });
  assert.equal((await until(home.friend, 'call-signal')).kind, 'answer');
  send(home.friend, { type: 'call-signal', callId, kind: 'ice', data: ICE });
  assert.equal((await until(home.b, 'call-signal')).kind, 'ice');
  assert.deepEqual(ofType(await drain(home.a), 'call-signal'), [], 'the laptop did not answer: it is sent no signalling');
  assert.deepEqual(ofType(await drain(home.c), 'call-signal'), []);
  // A device that did not answer cannot signal into the call either.
  send(home.a, { type: 'call-signal', callId, kind: 'answer', data: SDP });
  assert.equal((await until(home.a, 'error')).code, 'call_elsewhere');
  assert.deepEqual(ofType(await drain(home.friend), 'call-signal'), []);
});

test('a device that did not answer cannot end the call: its hang-up is refused, closing or reloading it changes nothing, and only the answering device or the other player ends it', async (t) => {
  const home = await connectedHousehold(t);
  const callId = await answered(home);
  for (const peer of [home.a, home.c]) await until(peer, 'call-state');
  send(home.a, { type: 'call-hangup', callId });
  assert.equal((await until(home.a, 'error')).code, 'call_elsewhere');
  send(home.c, { type: 'call-decline', callId });
  assert.equal((await until(home.c, 'error')).code, 'call_elsewhere');
  // The laptop closes; the tablet reloads (closes and opens again): the call is still up, and the reloaded tablet is told so.
  home.a.ws.close(); await once(home.a.ws, 'close');
  home.c.ws.close(); await once(home.c.ws, 'close');
  const tablet = await home.f.socket(home.tablet);
  const passive = await until(tablet, 'call-state');
  assert.deepEqual([passive.state, passive.elsewhere, passive.callId, passive.role, passive.peer?.name], ['accepted', true, callId, 'callee', 'Bola']);
  assert.deepEqual(callStates(await drain(home.b)), [], 'the answering device heard nothing');
  assert.deepEqual(callStates(await drain(home.friend)), [], 'and neither did the caller');
  send(home.friend, { type: 'call-signal', callId, kind: 'offer', data: SDP });
  assert.equal((await until(home.b, 'call-signal')).kind, 'offer', 'the call still carries signalling');
  // The answering device hangs up: over for everyone, and the passive tablet is told.
  send(home.b, { type: 'call-hangup', callId });
  assert.equal((await until(home.b, 'call-state')).state, 'ended');
  assert.equal((await until(home.friend, 'call-state')).state, 'ended');
  assert.equal((await until(tablet, 'call-state')).state, 'ended');
});

test('a decline on any device, a cancel by the caller and a ring that runs out each stop every device', async (t) => {
  const home = await connectedHousehold(t);
  const all = [home.a, home.b, home.c];
  const first = await ring(home);
  send(home.c, { type: 'call-decline', callId: first });
  for (const peer of all) assert.equal((await until(peer, 'call-state')).state, 'declined');
  assert.equal((await until(home.friend, 'call-state')).state, 'declined');
  const second = await ring(home);
  send(home.friend, { type: 'call-cancel', callId: second });
  for (const peer of all) assert.equal((await until(peer, 'call-state')).state, 'cancelled');
  assert.equal((await until(home.friend, 'call-state')).state, 'cancelled');
  await ring(home);
  home.f.advance(CALL_RING_MS + 1); home.f.server.beat();
  for (const peer of all) assert.equal((await until(peer, 'call-state')).state, 'timeout');
  assert.equal((await until(home.friend, 'call-state')).state, 'timeout');
});

test('a device closed while it rings does not decline for the others; the answering device dropping ends the call for all and nothing rings again', async (t) => {
  const home = await connectedHousehold(t);
  const callId = await ring(home);
  home.a.ws.close(); await once(home.a.ws, 'close');
  await pause(60);
  assert.deepEqual(callStates(await drain(home.friend)), [], 'still ringing');
  send(home.b, { type: 'call-accept', callId });
  assert.equal((await until(home.b, 'call-state')).state, 'accepted');
  assert.equal((await until(home.c, 'call-state')).elsewhere, true);
  assert.equal((await until(home.friend, 'call-state')).state, 'accepted');
  // The phone, which carries the call, loses its socket while the tablet stays connected.
  home.b.ws.close(); await once(home.b.ws, 'close');
  assert.equal((await until(home.friend, 'call-state')).state, 'ended');
  assert.equal((await until(home.c, 'call-state')).state, 'ended');
  await pause(60);
  assert.deepEqual(ofType(await drain(home.c), 'call-incoming'), [], 'the other device does not start ringing');
  // The player is free again: a new call rings.
  invite(home.friend, home.id);
  assert.equal((await until(home.c, 'call-incoming')).from.id, home.bola.id);
});

test('a call placed on one device shows on the others as a call elsewhere; they cannot cancel it, a second caller meets the usual busy rule, and a device opened late is told', async (t) => {
  const home = await connectedHousehold(t);
  const clientId = invite(home.a, home.bola.id);
  const incoming = await until(home.friend, 'call-incoming');
  const ringing = await until(home.a, 'call-state');
  assert.deepEqual([ringing.state, ringing.clientId, ringing.elsewhere], ['ringing', clientId, undefined]);
  for (const peer of [home.b, home.c]) {
    const passive = await until(peer, 'call-state');
    assert.deepEqual([passive.state, passive.elsewhere, passive.role, passive.peer?.id, passive.clientId], ['ringing', true, 'caller', home.bola.id, undefined]);
  }
  send(home.b, { type: 'call-cancel', callId: incoming.callId });
  assert.equal((await until(home.b, 'error')).code, 'call_elsewhere');
  // Busy on every device: another device of the same player cannot place a second call.
  const again = invite(home.c, home.bola.id);
  const busy = await until(home.c, 'call-state');
  assert.deepEqual([busy.state, busy.clientId, busy.busy], ['unreachable', again, true]);
  send(home.friend, { type: 'call-accept', callId: incoming.callId });
  assert.equal((await until(home.friend, 'call-state')).state, 'accepted');
  assert.equal((await until(home.a, 'call-state')).state, 'accepted');
  for (const peer of [home.b, home.c]) { const passive = await until(peer, 'call-state'); assert.deepEqual([passive.state, passive.elsewhere], ['accepted', true]); }
  // The caller's own device closes: the call ends, as it does for a player with one device.
  home.a.ws.close(); await once(home.a.ws, 'close');
  assert.equal((await until(home.friend, 'call-state')).state, 'ended');
  for (const peer of [home.b, home.c]) assert.equal((await until(peer, 'call-state')).state, 'ended');
});

test('a device that opens while a call is ringing rings too', async (t) => {
  const home = await household(t);
  const b = await home.f.socket(home.phone), friend = await home.f.socket(home.bola);
  invite(friend, home.id);
  const first = await until(b, 'call-incoming');
  const late = await home.f.socket(home.tablet);
  const second = await until(late, 'call-incoming');
  assert.deepEqual([second.callId, second.from.id, second.expiresAt], [first.callId, home.bola.id, first.expiresAt]);
  send(late, { type: 'call-accept', callId: first.callId });
  assert.equal((await until(late, 'call-state')).state, 'accepted');
  assert.equal((await until(b, 'call-state')).elsewhere, true);
});

// ---- the account ---------------------------------------------------------------------------------------------------

test('signing out everywhere else closes the other devices at once with the session-changed code, and this device plays on', async (t) => {
  const home = await connectedHousehold(t);
  const closed = [home.b, home.c].map((peer) => once(peer.ws, 'close'));
  const response = await home.call('/api/account/sign-out-everywhere', { idToken: await home.token(), csrf: await home.csrf(home.laptop.cookie) }, home.laptop.cookie);
  assert.equal(response.status, 200);
  for (const [code] of await Promise.all(closed)) assert.equal(code, 4401);
  assert.equal((await home.f.request('/api/session', null, home.phone.cookie)).status, 401, 'the phone is signed out');
  assert.equal((await home.f.request('/api/session', null, home.laptop.cookie)).status, 200);
  assert.equal(home.a.ws.readyState, 1, 'the laptop keeps its socket');
});
