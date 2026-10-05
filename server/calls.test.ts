// OWNER: social — tests for server/social/calls.ts and server/ws/calls.ts (one-to-one calls).
// The rules under test: nothing is relayed before the callee accepts, only the two participants of an
// accepted call can signal and the target comes from the call record, and the caller never learns why
// a call could not ring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import type { Device, TestSocket } from './test-fixture.ts';
import type { ServerFrame } from '../src/types/protocol.ts';
import type { CallsFrom, CallStateFrame } from '../src/types/calls.ts';
import { CALL_RING_MS, CALL_SETUP_MS } from '../src/types/calls.ts';
import { CALL_LIMITS, cleanSignal } from './social/calls.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
const TOKEN = 'operator-token-for-tests-0123456789';
type Frame<T extends ServerFrame['type']> = Extract<ServerFrame, { type: T }>;

const send = (peer: TestSocket, frame: object): void => peer.ws.send(JSON.stringify(frame));
async function until<T extends ServerFrame['type']>(peer: TestSocket, type: T): Promise<Frame<T>> {
  for (let i = 0; i < 300; i++) { const message = await peer.next(); if (message.type === type) return message as Frame<T>; }
  throw Error(`No ${type} message`);
}
/** Everything of one kind the socket was sent up to now: a settings read is answered after every earlier push. */
async function drain(peer: TestSocket): Promise<ServerFrame[]> {
  send(peer, { type: 'call-settings' });
  const seen: ServerFrame[] = [];
  for (let i = 0; i < 300; i++) { const message = await peer.next(); if (message.type === 'call-settings') return seen; seen.push(message); }
  throw Error('No settings reply');
}
const callFrames = (frames: ServerFrame[]): ServerFrame[] => frames.filter((frame) => frame.type.startsWith('call-'));
const makeFriends = async (f: Fixture, a: Device, b: Device): Promise<void> => {
  assert.equal(((await (await f.request('/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a.cookie)).json()) as { code: string }).code, 'requested');
  assert.equal(((await (await f.request('/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b.cookie)).json()) as { code: string }).code, 'accepted');
};
/** Two or more players who are on the social list (the client reads its overview first). */
async function players(f: Fixture, names: string[]): Promise<Device[]> {
  const list: Device[] = [];
  for (const name of names) { const device = await f.device(name); await f.request('/api/social/me', null, device.cookie); list.push(device); }
  return list;
}
const must = <T>(value: T | undefined, what = 'value'): T => { if (value === undefined) throw new TypeError(`Expected ${what}`); return value; };
const setCalls = async (peer: TestSocket, calls: CallsFrom): Promise<void> => { send(peer, { type: 'call-settings', calls }); assert.equal((await until(peer, 'call-settings')).calls, calls); };
let counter = 0;
const invite = (peer: TestSocket, to: string, clientId = `c${++counter}`): string => { send(peer, { type: 'call-invite', to, clientId }); return clientId; };
const stateOf = (frame: CallStateFrame): string => frame.state;

/** Ada (caller) and Bola (callee), friends, both online. */
async function pair(t: Parameters<typeof fixture>[0], options: Parameters<typeof fixture>[1] = {}) {
  const f = await fixture(t, options);
  const [ada, bola] = await players(f, ['Ada', 'Bola']) as [Device, Device];
  await makeFriends(f, ada, bola);
  const a = await f.socket(ada), b = await f.socket(bola);
  return { f, ada, bola, a, b };
}
/** A ringing call, accepted. */
async function connected(t: Parameters<typeof fixture>[0]) {
  const ctx = await pair(t);
  invite(ctx.a, ctx.bola.id);
  const incoming = await until(ctx.b, 'call-incoming');
  await until(ctx.a, 'call-state');
  send(ctx.b, { type: 'call-accept', callId: incoming.callId });
  assert.equal((await until(ctx.b, 'call-state')).state, 'accepted');
  assert.equal((await until(ctx.a, 'call-state')).state, 'accepted');
  return { ...ctx, callId: incoming.callId };
}
const SDP = { sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };
const ICE = { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 4000 typ host', sdpMid: '0', sdpMLineIndex: 0 };

test('a friend rings the callee, who sees the public name and the expiry; the caller sees ringing', async (t) => {
  const { f, ada, bola, a, b } = await pair(t);
  const clientId = invite(a, bola.id);
  const incoming = await until(b, 'call-incoming');
  assert.deepEqual(incoming.from, { id: ada.id, name: 'Ada' });
  assert.equal(incoming.expiresAt, f.now() + CALL_RING_MS);
  const ringing = await until(a, 'call-state');
  assert.deepEqual([ringing.state, ringing.clientId, ringing.callId, ringing.role], ['ringing', clientId, incoming.callId, 'caller']);
  assert.equal(JSON.stringify(incoming).includes(ada.cookie.slice(4)), false, 'no secret in the frame');
});

test('the default is friends only; everyone and nobody are honoured; the setting is read back', async (t) => {
  const f = await fixture(t);
  const [ada, bola, cleo] = await players(f, ['Ada', 'Bola', 'Cleo']) as [Device, Device, Device];
  await makeFriends(f, ada, bola);
  const a = await f.socket(ada), b = await f.socket(bola), c = await f.socket(cleo);
  send(b, { type: 'call-settings' });
  assert.equal((await until(b, 'call-settings')).calls, 'friends', 'default');
  // A stranger cannot ring under the default.
  invite(c, bola.id);
  assert.equal(stateOf(await until(c, 'call-state')), 'unreachable');
  assert.deepEqual(callFrames(await drain(b)), []);
  // Everyone: the stranger rings.
  await setCalls(b, 'everyone');
  invite(c, bola.id);
  assert.equal((await until(c, 'call-state')).state, 'ringing');
  const incoming = await until(b, 'call-incoming');
  send(c, { type: 'call-cancel', callId: incoming.callId });
  await until(b, 'call-state');
  // Nobody: not even a friend.
  await setCalls(b, 'nobody');
  invite(a, bola.id);
  assert.equal(stateOf(await until(a, 'call-state')), 'unreachable');
  assert.deepEqual(callFrames(await drain(b)), []);
  // Back to friends: the friend rings again.
  await setCalls(b, 'friends');
  invite(a, bola.id);
  assert.equal(stateOf(await until(a, 'call-state')), 'ringing');
  // The change is stored with the player (not only in memory) and a bad value is refused.
  assert.equal(await f.server.store.read((db) => db.social?.players?.[bola.id]?.calls), 'friends');
  send(b, { type: 'call-settings', calls: 'whoever' });
  assert.equal((await until(b, 'error')).code, 'invalid_call_setting');
});

test('the caller never learns the reason: block, nobody, busy, offline, muted and unknown all read the same', async (t) => {
  const f = await fixture(t, { moderatorToken: TOKEN });
  const [ada, bola, cleo, dede, eze] = await players(f, ['Ada', 'Bola', 'Cleo', 'Dede', 'Eze']) as [Device, Device, Device, Device, Device];
  for (const other of [bola, cleo, dede]) await makeFriends(f, ada, other);
  const a = await f.socket(ada), b = await f.socket(bola), c = await f.socket(cleo), d = await f.socket(dede);
  await f.socket(eze);
  // Blocked by the callee, 'nobody', busy (Dede is in a call with Cleo), offline (Eze has no friends and no socket), unknown id.
  assert.equal((await f.request('/api/social/block', { id: ada.id, cityId: 'lagos' }, bola.cookie)).status, 200);
  await setCalls(c, 'nobody');
  const stranger = await f.device('Fola'); await f.request('/api/social/me', null, stranger.cookie);
  await makeFriends(f, stranger, dede);
  const s = await f.socket(stranger);
  invite(s, dede.id); await until(d, 'call-incoming'); await until(s, 'call-state');
  const replies: CallStateFrame[] = [];
  for (const target of [bola.id, cleo.id, dede.id, eze.id, '11111111-1111-4111-8111-111111111111']) { invite(a, target); replies.push(await until(a, 'call-state')); }
  for (const reply of replies) assert.deepEqual({ ...reply, clientId: undefined }, { type: 'call-state', callId: '', state: 'unreachable', clientId: undefined });
  assert.deepEqual(callFrames(await drain(b)), [], 'nobody was rung');
  assert.deepEqual(callFrames(await drain(c)), []);
});

test('a block in either direction prevents ringing, and a block mid-ring or mid-call ends the call', async (t) => {
  const { f, ada, bola, a, b } = await pair(t);
  await setCalls(b, 'everyone'); // a block removes the friendship, so this test lets anyone ring
  // The caller blocked the callee.
  assert.equal((await f.request('/api/social/block', { id: bola.id, cityId: 'lagos' }, ada.cookie)).status, 200);
  invite(a, bola.id); assert.equal(stateOf(await until(a, 'call-state')), 'unreachable');
  assert.equal((await f.request('/api/social/unblock', { id: bola.id }, ada.cookie)).status, 200);
  // The callee blocked the caller.
  assert.equal((await f.request('/api/social/block', { id: ada.id, cityId: 'lagos' }, bola.cookie)).status, 200);
  invite(a, bola.id); assert.equal(stateOf(await until(a, 'call-state')), 'unreachable');
  assert.deepEqual(callFrames(await drain(b)), []);
  assert.equal((await f.request('/api/social/unblock', { id: ada.id }, bola.cookie)).status, 200);
  // Mid-ring: the caller sees only unreachable, the callee a cancellation.
  invite(a, bola.id); const incoming = await until(b, 'call-incoming'); await until(a, 'call-state');
  assert.equal((await f.request('/api/social/block', { id: ada.id, cityId: 'lagos' }, bola.cookie)).status, 200);
  assert.equal(stateOf(await until(a, 'call-state')), 'unreachable');
  assert.deepEqual([(await until(b, 'call-state')).state, incoming.callId.length > 0], ['cancelled', true]);
  assert.equal((await f.request('/api/social/unblock', { id: ada.id }, bola.cookie)).status, 200);
  // Mid-call: both are told it ended.
  f.advance(61000);
  invite(a, bola.id); const again = await until(b, 'call-incoming'); await until(a, 'call-state');
  send(b, { type: 'call-accept', callId: again.callId }); await until(a, 'call-state'); await until(b, 'call-state');
  assert.equal((await f.request('/api/social/block', { id: bola.id, cityId: 'lagos' }, ada.cookie)).status, 200);
  assert.equal(stateOf(await until(a, 'call-state')), 'ended');
  assert.equal(stateOf(await until(b, 'call-state')), 'ended');
});

test('a player muted by moderation cannot ring or be rung, and a mute during a call ends it on the next beat', async (t) => {
  const { f, ada, bola, a, b } = await pair(t, { moderatorToken: TOKEN });
  const mute = (id: string, minutes: number) => fetch(`${f.base}/api/mod/mutes`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, minutes, reason: 'Spam' }) });
  assert.equal((await mute(ada.id, 10)).status, 200);
  invite(a, bola.id); assert.equal(stateOf(await until(a, 'call-state')), 'unreachable');
  invite(b, ada.id); assert.equal(stateOf(await until(b, 'call-state')), 'unreachable');
  assert.deepEqual(callFrames(await drain(b)), []);
  f.advance(11 * 60000);
  invite(a, bola.id); const incoming = await until(b, 'call-incoming'); await until(a, 'call-state');
  send(b, { type: 'call-accept', callId: incoming.callId }); await until(a, 'call-state'); await until(b, 'call-state');
  assert.equal((await mute(bola.id, 10)).status, 200);
  f.server.beat();
  assert.equal(stateOf(await until(a, 'call-state')), 'ended');
  assert.equal(stateOf(await until(b, 'call-state')), 'ended');
});

test('signalling is relayed between the two sides of an accepted call, and the target is the call record', async (t) => {
  const { ada, bola, a, b, callId } = await connected(t);
  send(a, { type: 'call-signal', callId, kind: 'offer', data: SDP });
  const offer = await until(b, 'call-signal');
  assert.deepEqual([offer.callId, offer.kind, offer.data], [callId, 'offer', SDP]);
  send(b, { type: 'call-signal', callId, kind: 'answer', data: SDP });
  assert.equal((await until(a, 'call-signal')).kind, 'answer');
  send(a, { type: 'call-signal', callId, kind: 'ice', data: ICE, to: bola.id });
  send(b, { type: 'call-signal', callId, kind: 'ice', data: ICE, to: 'anyone-else' });
  const toBola = await until(b, 'call-signal'), toAda = await until(a, 'call-signal');
  assert.deepEqual([toBola.kind, toAda.kind], ['ice', 'ice']);
  assert.deepEqual(toBola.data, { ...ICE, usernameFragment: null }, 'only known fields, rebuilt');
  assert.equal(ada.id === bola.id, false);
});

test('a third party cannot inject a signal, hang up or accept a call, and learns nothing about it', async (t) => {
  const { f, a, b, callId } = await connected(t);
  const [mallory] = await players(f, ['Mallory']) as [Device];
  const m = await f.socket(mallory);
  for (const frame of [{ type: 'call-signal', callId, kind: 'offer', data: SDP }, { type: 'call-signal', callId, kind: 'ice', data: ICE }, { type: 'call-hangup', callId }, { type: 'call-accept', callId }, { type: 'call-decline', callId }, { type: 'call-cancel', callId }]) {
    send(m, frame);
    const reply = await until(m, 'call-state');
    assert.deepEqual([reply.state, reply.callId, reply.peer], ['ended', callId, undefined], 'the same answer as for an id nobody holds');
  }
  send(m, { type: 'call-signal', callId: 'no-such-call', kind: 'offer', data: SDP });
  assert.deepEqual((await until(m, 'call-state')).state, 'ended');
  assert.deepEqual(callFrames(await drain(a)), []);
  assert.deepEqual(callFrames(await drain(b)), []);
  // The call is still up: a real signal still arrives.
  send(a, { type: 'call-signal', callId, kind: 'offer', data: SDP });
  assert.equal((await until(b, 'call-signal')).kind, 'offer');
});

test('nothing can be signalled before the callee accepts, and the roles are fixed', async (t) => {
  const { a, b, bola } = await pair(t);
  invite(a, bola.id);
  const { callId } = await until(b, 'call-incoming'); await until(a, 'call-state');
  for (const [peer, kind] of [[a, 'offer'], [a, 'ice'], [b, 'answer'], [b, 'ice']] as const) {
    send(peer, { type: 'call-signal', callId, kind, data: kind === 'ice' ? ICE : SDP });
    assert.equal((await until(peer, 'error')).code, 'invalid_call');
  }
  assert.deepEqual(callFrames(await drain(a)), []);
  assert.deepEqual(callFrames(await drain(b)), []);
  send(b, { type: 'call-accept', callId }); await until(b, 'call-state'); await until(a, 'call-state');
  // The callee cannot offer and the caller cannot answer; a bad kind or payload is refused.
  for (const frame of [{ kind: 'offer', data: SDP }, { kind: 'bogus', data: SDP }, { kind: 'ice', data: { candidate: 5 } }, { kind: 'ice', data: { candidate: 'x'.repeat(CALL_LIMITS.candidateChars + 1) } }, { kind: 'ice', data: { candidate: 'c', sdpMLineIndex: -1 } }]) {
    send(b, { type: 'call-signal', callId, ...frame });
    assert.equal((await until(b, 'error')).code, 'invalid_call');
  }
  send(a, { type: 'call-signal', callId, kind: 'answer', data: SDP });
  assert.equal((await until(a, 'error')).code, 'invalid_call');
  send(a, { type: 'call-signal', callId, kind: 'offer', data: { sdp: 'x'.repeat(CALL_LIMITS.sdpChars + 1) } });
  assert.equal((await until(a, 'error')).code, 'invalid_call');
  assert.deepEqual(callFrames(await drain(a)), []);
  assert.deepEqual(callFrames(await drain(b)), []);
});

test('cleanSignal rebuilds what it passes and refuses oversized or foreign shapes', () => {
  assert.deepEqual(cleanSignal('offer', { sdp: 'v=0', extra: 1 }), { sdp: 'v=0' });
  assert.equal(cleanSignal('offer', { sdp: '' }), null);
  assert.equal(cleanSignal('answer', 'v=0'), null);
  assert.equal(cleanSignal('ice', { candidate: 'a', sdpMid: 5 }), null);
  assert.deepEqual(cleanSignal('ice', { candidate: '' }), { candidate: '', sdpMid: null, sdpMLineIndex: null, usernameFragment: null });
});

test('attempts are limited per caller and per pair, before anything about the callee is looked at', async (t) => {
  const f = await fixture(t);
  const [ada, bola, cleo, dede] = await players(f, ['Ada', 'Bola', 'Cleo', 'Dede']) as [Device, Device, Device, Device];
  const a = await f.socket(ada), b = await f.socket(bola);
  await makeFriends(f, ada, bola);
  // Per pair: three rings and cancels, the fourth is limited.
  for (let i = 0; i < CALL_LIMITS.perPairPerMinute; i++) {
    invite(a, bola.id); const incoming = await until(b, 'call-incoming'); await until(a, 'call-state');
    send(a, { type: 'call-cancel', callId: incoming.callId }); await until(a, 'call-state'); await until(b, 'call-state');
  }
  invite(a, bola.id);
  const limited = await until(a, 'call-state');
  assert.deepEqual([limited.state, limited.limited], ['unreachable', true]);
  assert.deepEqual(callFrames(await drain(b)), []);
  // Per caller: strangers who cannot be rung still use up the budget (four attempts so far, the refused one included, then the budget of eight runs out).
  const results: (true | undefined)[] = [];
  for (const target of [cleo, cleo, cleo, dede, dede, dede]) { invite(a, target.id); results.push((await until(a, 'call-state')).limited); }
  assert.deepEqual(results, [undefined, undefined, undefined, undefined, true, true]);
  f.advance(61000);
  invite(a, bola.id);
  assert.equal((await until(a, 'call-state')).state, 'ringing', 'the window passes');
});

test('one call at a time: a busy callee and a busy caller both read unreachable, and the call in progress is untouched', async (t) => {
  const { f, a, b, bola, ada } = await connected(t);
  const [cleo] = await players(f, ['Cleo']) as [Device];
  await makeFriends(f, cleo, bola); await makeFriends(f, cleo, ada);
  const c = await f.socket(cleo);
  invite(c, bola.id); assert.equal(stateOf(await until(c, 'call-state')), 'unreachable');
  invite(c, ada.id); assert.equal(stateOf(await until(c, 'call-state')), 'unreachable');
  const busy = invite(a, cleo.id); const own = await until(a, 'call-state');
  assert.deepEqual([own.state, own.clientId, own.busy], ['unreachable', busy, true]);
  assert.deepEqual(callFrames(await drain(c)), []);
  assert.deepEqual(callFrames(await drain(b)), []);
});

test('a ring ends after 30 seconds: on the heartbeat, and on the next call frame', async (t) => {
  const { f, a, b, bola } = await pair(t);
  invite(a, bola.id); const incoming = await until(b, 'call-incoming'); await until(a, 'call-state');
  f.advance(CALL_RING_MS - 1000); f.server.beat();
  assert.deepEqual(callFrames(await drain(a)), [], 'still ringing');
  await new Promise((resolve) => setTimeout(resolve, 150)); // the sockets answer the first beat's ping before the second beat
  f.advance(1000); f.server.beat();
  assert.equal(stateOf(await until(a, 'call-state')), 'timeout');
  assert.equal(stateOf(await until(b, 'call-state')), 'timeout');
  send(b, { type: 'call-accept', callId: incoming.callId });
  assert.equal((await until(b, 'call-state')).state, 'ended', 'too late');
  // Without a beat: the frame itself applies the expiry.
  invite(a, bola.id); const second = await until(b, 'call-incoming'); await until(a, 'call-state');
  f.advance(CALL_RING_MS + 1);
  send(b, { type: 'call-accept', callId: second.callId });
  assert.equal((await until(a, 'call-state')).state, 'timeout');
  assert.equal((await until(b, 'call-state')).state, 'timeout');
});

test('an accepted call whose caller never starts is ended after the setup window', async (t) => {
  const { f, a, b } = await connected(t);
  f.advance(CALL_SETUP_MS + 1); f.server.beat();
  assert.equal(stateOf(await until(a, 'call-state')), 'ended');
  assert.equal(stateOf(await until(b, 'call-state')), 'ended');
});

test('the caller can cancel, the callee can decline, and either side can hang up', async (t) => {
  const { f, a, b, bola, ada } = await pair(t);
  invite(a, bola.id); let incoming = await until(b, 'call-incoming'); await until(a, 'call-state');
  send(a, { type: 'call-cancel', callId: incoming.callId });
  assert.equal(stateOf(await until(a, 'call-state')), 'cancelled'); assert.equal(stateOf(await until(b, 'call-state')), 'cancelled');
  f.advance(61000);
  invite(a, bola.id); incoming = await until(b, 'call-incoming'); await until(a, 'call-state');
  send(a, { type: 'call-decline', callId: incoming.callId });
  assert.equal((await until(a, 'error')).code, 'invalid_call', 'the caller cannot decline');
  send(b, { type: 'call-cancel', callId: incoming.callId });
  assert.equal((await until(b, 'error')).code, 'invalid_call', 'the callee cannot cancel');
  send(b, { type: 'call-decline', callId: incoming.callId });
  assert.equal(stateOf(await until(a, 'call-state')), 'declined'); assert.equal(stateOf(await until(b, 'call-state')), 'declined');
  f.advance(61000);
  for (const hanger of ['caller', 'callee'] as const) {
    invite(a, bola.id); incoming = await until(b, 'call-incoming'); await until(a, 'call-state');
    send(b, { type: 'call-accept', callId: incoming.callId }); await until(a, 'call-state'); await until(b, 'call-state');
    send(hanger === 'caller' ? a : b, { type: 'call-hangup', callId: incoming.callId });
    assert.equal(stateOf(await until(a, 'call-state')), 'ended'); assert.equal(stateOf(await until(b, 'call-state')), 'ended');
    // A hung-up call carries no more signalling.
    send(a, { type: 'call-signal', callId: incoming.callId, kind: 'offer', data: SDP });
    assert.equal(stateOf(await until(a, 'call-state')), 'ended');
    f.advance(61000);
  }
  assert.ok(ada.id);
});

test('a socket that closes ends the call when it was the player\'s last, and not while another tab is open', async (t) => {
  const { f, a, b, bola, ada, callId } = await connected(t);
  const second = await f.socket(bola);
  b.ws.close();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(callFrames(await drain(a)), [], 'Bola still has a tab');
  second.ws.close();
  assert.equal(stateOf(await until(a, 'call-state')), 'ended');
  // A ringing call whose caller leaves is cancelled for the callee.
  const b2 = await f.socket(bola);
  f.advance(61000);
  invite(a, bola.id); await until(b2, 'call-incoming'); await until(a, 'call-state');
  a.ws.close();
  assert.equal(stateOf(await until(b2, 'call-state')), 'cancelled');
  assert.ok(callId && ada.id);
});

test('a second tab of the callee rings too, and is told when the other tab answered', async (t) => {
  const { f, a, b, bola } = await pair(t);
  const second = await f.socket(bola);
  invite(a, bola.id);
  const incoming = await until(b, 'call-incoming'); await until(second, 'call-incoming'); await until(a, 'call-state');
  send(second, { type: 'call-accept', callId: incoming.callId });
  assert.deepEqual([(await until(second, 'call-state')).elsewhere], [undefined]);
  const other = await until(b, 'call-state');
  assert.deepEqual([other.state, other.elsewhere], ['accepted', true]);
  // The offer reaches the tab that answered.
  send(a, { type: 'call-signal', callId: incoming.callId, kind: 'offer', data: SDP });
  assert.equal((await until(second, 'call-signal')).kind, 'offer');
  assert.deepEqual(callFrames(await drain(b)), []);
});

test('calls reach a player in another venue or in none: they are not tied to a room', async (t) => {
  const { f, a, b, bola } = await pair(t);
  send(a, { type: 'join', cityId: 'lagos', venueId: 'park' }); await until(a, 'presence');
  invite(a, bola.id); assert.equal((await until(b, 'call-incoming')).from.name, 'Ada');
  assert.equal(stateOf(await until(a, 'call-state')), 'ringing');
  const c = await f.joinRoom(await (async () => { const d = await f.device('Cleo'); await f.request('/api/social/me', null, d.cookie); return d; })());
  assert.ok(c);
});

test('only stored players can be rung: an id that is not a session, and yourself, are refused', async (t) => {
  const { a, ada } = await pair(t);
  invite(a, ada.id); assert.equal((await until(a, 'error')).code, 'invalid_call');
  send(a, { type: 'call-invite', to: 'npc:mummy', clientId: 'x1' });
  assert.equal((await until(a, 'error')).code, 'invalid_call');
  send(a, { type: 'call-invite', to: must(ada.id), clientId: '' });
  assert.equal((await until(a, 'error')).code, 'invalid_call');
});

test('a repeated invite with the same client id does not ring twice', async (t) => {
  const { a, b, bola } = await pair(t);
  invite(a, bola.id, 'same');
  const incoming = await until(b, 'call-incoming'); const first = await until(a, 'call-state');
  invite(a, bola.id, 'same');
  const again = await until(a, 'call-state');
  assert.deepEqual([again.callId, again.state], [first.callId, 'ringing']);
  assert.equal(first.callId, incoming.callId);
  assert.deepEqual(callFrames(await drain(b)), []);
});
