// Leaving a venue ends room membership and voice state — however the player leaves (a trip, the
// automatic commute) and whichever request starts it. Room authority follows the life the store
// holds: with the real store a departure whose write failed did not happen (nobody is revoked); with
// a store that keeps such a change in memory (switchableStore below) the departure is revoked anyway. Two real sockets throughout. "Voice" here is the server's protocol flag only: no
// microphone, no WebRTC, no audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.js';
import { ROUTE_MODULES } from './routes/index.js';
import { canOccupyVenue, canJoinVenue, isDeparting } from './protocol.js';
import { createLife, dispatch } from '../src/life.js';
import { roomJoinNeeded } from '../src/client.js';

const MONDAY_10AM = Date.UTC(2026, 0, 5, 9); // Lagos is UTC+1: the workplace (open 08:00–22:00) is open
const MONDAY_7AM = Date.UTC(2026, 0, 5, 6);  // ...and here it is still closed
const say = (peer, message) => peer.ws.send(JSON.stringify(message));
/** A real socket whose every frame is kept, so a test can wait for one without losing the others. */
async function connect(f, device) {
  const { ws } = await f.socket(device);
  const peer = { ws, id: device.id, cookie: device.cookie, log: [] };
  ws.removeAllListeners('message');
  ws.on('message', (data) => peer.log.push(JSON.parse(data.toString())));
  return peer;
}
/** The first frame matching `test` among those received since `from` (default: all), waiting up to two seconds for it. */
async function until(peer, test, what = 'message', from = 0) {
  for (let i = 0; i < 400; i++) {
    const found = peer.log.slice(from).find(test);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error(`No ${what}`);
}
const isError = (code) => (message) => message.type === 'error' && message.code === code;
/** Ask for a fresh, authoritative roster: the peer changes its own voice state and reads the presence that follows. */
async function roster(peer, token) {
  const from = peer.log.length;
  say(peer, { type: 'voice-state', enabled: false, muted: token });
  return (await until(peer, (message) => message.type === 'presence' && message.members.some((member) => member.id === peer.id && member.muted === token), 'roster', from)).members;
}
/** Send a signalling marker from `from` to `to` and report whether it arrived or was refused (and with which codes). */
async function signal(from, to, label) {
  const sent = from.log.length, heard = to.log.length;
  say(from, { type: 'signal', to: to.id, data: { probe: label } });
  const arrived = (message) => message.type === 'signal' && message.data?.probe === label;
  for (let i = 0; i < 400; i++) {
    if (to.log.slice(heard).some(arrived)) return { delivered: true, code: null };
    const refusal = from.log.slice(sent).filter((message) => message.type === 'error').at(-1);
    if (refusal?.code === 'join_required' || (refusal && i > 20)) return { delivered: false, code: refusal.code };
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error(`Signal ${label} neither arrived nor was refused`);
}
/** Two players; A will be the one who leaves. */
async function park(t, options) {
  const f = await fixture(t, options);
  const A = await f.device('Commuter'), B = await f.device('Peer');
  /** An action stamped with the server's own clock (the fixture's helper assumes its default clock). */
  const clock = options?.now ?? f.now;
  const act = async (who, fields, actionId = `${clock()}:${randomUUID()}`) => { const response = await f.request('/api/action', { actionId, cityId: 'lagos', ...fields }, who.cookie); return { status: response.status, ...(await response.json()) }; };
  return { f, A, B, act };
}
/** Both in the park room, A with the voice flag on. */
async function joinBoth(f, A, B) {
  const a = await connect(f, A), b = await connect(f, B);
  say(a, { type: 'join', cityId: 'lagos', venueId: 'park' }); await until(a, (m) => m.type === 'presence');
  say(b, { type: 'join', cityId: 'lagos', venueId: 'park' }); await until(b, (m) => m.type === 'presence' && m.members.length === 2);
  say(a, { type: 'voice-state', enabled: true, muted: false });
  await until(b, (m) => m.type === 'presence' && m.members.some((member) => member.id === A.id && member.enabled), 'voice flag');
  return { a, b };
}
/** After a frame matching `test` arrives, the next frame of the same kind (used for "the error that answers THIS message"). */
async function answer(peer, send, test = (message) => message.type === 'error' || message.type === 'presence') {
  const from = peer.log.length;
  send();
  return until(peer, test, 'answer', from);
}

/** Everything that must hold once A has started to leave, and again after A cancels. `mark` is A's log length before the departure. */
async function assertRevokedThenRestored({ f, act }, a, b, A, mark) {
  assert.equal((await until(a, isError('venue_mismatch'), 'revocation', mark)).code, 'venue_mismatch', 'the departing player is told at once');
  assert.deepEqual((await roster(b, true)).map((member) => member.id), [b.id], 'the old room no longer lists them — so no voice flag either');
  assert.deepEqual(await signal(a, b, 'while-departing'), { delivered: false, code: 'join_required' }, 'nothing is forwarded for them');
  assert.equal((await answer(a, () => say(a, { type: 'chat', clientId: 'c1', body: 'still here?' }))).code, 'join_required');
  assert.equal(b.log.some((message) => message.type === 'chat'), false);
  assert.equal((await answer(a, () => say(a, { type: 'join', cityId: 'lagos', venueId: 'park' }))).code, 'venue_mismatch', 'the room they are leaving cannot be rejoined');
  assert.equal((await f.request('/api/voice-config', null, A.cookie)).status, 403, 'and no voice configuration is handed out');
  // Cancel: the player never left. Membership comes back by an explicit join — with voice off and muted.
  const cancelled = await act(A, { type: 'cancel' });
  assert.deepEqual([cancelled.ok, cancelled.code, cancelled.state.location, cancelled.state.activeAction], [true, 'cancelled', 'park', null]);
  const back = await answer(a, () => say(a, { type: 'join', cityId: 'lagos', venueId: 'park' }));
  assert.equal(back.type, 'presence', 'the join is accepted again');
  const self = back.members.find((member) => member.id === A.id);
  assert.deepEqual([self.enabled, self.muted], [false, true], 'restored with voice OFF and muted');
  const seen = (await roster(b, false)).find((member) => member.id === A.id);
  assert.deepEqual([seen.enabled, seen.muted], [false, true], 'the peer sees them back, not in voice');
  assert.deepEqual(await signal(a, b, 'after-cancel'), { delivered: true, code: null }, 'the room works again');
}

test('one shared rule: a departing life occupies no venue, whatever kind of departure it is', () => {
  const at = { now: MONDAY_10AM, cityId: 'lagos' };
  const idle = createLife({ location: 'park' }, at);
  const trip = createLife({ location: 'park' }, at); dispatch(trip, { type: 'travel', payload: { id: 'library', mode: 'trek' } }, at);
  const commute = createLife({ location: 'park' }, at); dispatch(commute, { type: 'apply-job', payload: { id: 'tech' } }, at);
  assert.equal(commute.activeAction.kind, 'commute');
  assert.deepEqual([idle, trip, commute].map((state) => [isDeparting(state), canOccupyVenue(state, 'park'), canJoinVenue(state, 'park')]), [[false, true, true], [true, false, false], [true, false, false]]);
  assert.equal(canOccupyVenue(idle, 'library'), false);
  assert.equal(canOccupyVenue(null, 'park'), false);
  // The client's recovery uses the same rule: a cancelled commute, like a cancelled trip, needs a rejoin (room only).
  assert.equal(roomJoinNeeded(commute, idle), true);
  assert.equal(roomJoinNeeded(trip, idle), true);
  assert.equal(roomJoinNeeded(idle, commute), false, 'setting off never rejoins');
});

test('applying for a job that starts the commute ends room membership and voice at once; cancelling restores membership with voice off', async (t) => {
  const clock = MONDAY_10AM;
  const world = await park(t, { now: () => clock });
  const { f, A, B, act } = world;
  const { a, b } = await joinBoth(f, A, B);
  const mark = a.log.length;
  const hired = await act(A, { type: 'apply-job', payload: { id: 'tech' } });
  assert.deepEqual([hired.ok, hired.state.activeAction?.kind, hired.state.location], [true, 'commute', 'park'], 'the commute started and the location has not changed yet');
  await assertRevokedThenRestored(world, a, b, A, mark);
});

test('a commute started by a plain GET settlement ends room membership and voice the same way', async (t) => {
  let clock = MONDAY_7AM;
  const world = await park(t, { now: () => clock });
  const { f, A, B, act } = world;
  const hired = await act(A, { type: 'apply-job', payload: { id: 'tech' } });
  assert.deepEqual([hired.ok, hired.state.activeAction], [true, null], 'hired while the workplace is closed: no commute yet');
  const { a, b } = await joinBoth(f, A, B);
  const mark = a.log.length;
  clock = MONDAY_10AM; // the workplace opens; the player does nothing
  const polled = await (await f.request('/api/life?city=lagos', null, A.cookie)).json();
  assert.deepEqual([polled.state.activeAction?.kind, polled.state.location], ['commute', 'park'], 'the poll itself started the commute');
  await assertRevokedThenRestored(world, a, b, A, mark);
});

test('a trip still revokes, and arriving does not restore the old room', async (t) => {
  const { f, A, B, act } = await park(t);
  const { a, b } = await joinBoth(f, A, B);
  const mark = a.log.length;
  const started = await act(A, { type: 'travel', id: 'library', mode: 'trek' });
  assert.equal(started.state.activeAction.kind, 'travel');
  assert.equal((await until(a, isError('venue_mismatch'), 'revocation', mark)).code, 'venue_mismatch');
  assert.deepEqual((await roster(b, true)).map((member) => member.id), [B.id]);
  f.advance(started.state.activeAction.duration * 1000 + 1000);
  assert.equal((await (await f.request('/api/life?city=lagos', null, A.cookie)).json()).state.location, 'library');
  assert.equal((await answer(a, () => say(a, { type: 'join', cityId: 'lagos', venueId: 'park' }))).code, 'venue_mismatch');
  const arrived = await answer(a, () => say(a, { type: 'join', cityId: 'lagos', venueId: 'library' }));
  assert.deepEqual(arrived.members.map((member) => [member.id, member.enabled, member.muted]), [[A.id, false, true]]);
});

/**
 * A store with the same two-method contract as the real one, kept in memory, with switches a test
 * can throw: writes that fail AFTER the change is committed in memory (the hazard), reads that
 * cannot run at all, and reads that wait. It stands in for "whatever the storage does".
 */
function switchableStore() {
  let db = { version: 1, sessions: {} };
  let queue = Promise.resolve();
  const control = { failWrites: false, failReads: false, holdReads: null };
  const enqueue = (work) => { const run = queue.then(work); queue = run.catch(() => {}); return run; };
  return {
    control,
    transact(operation, { durable = true, committed } = {}) {
      return enqueue(async () => {
        const next = structuredClone(db);
        const value = await operation(next); // a throw discards `next`
        db = next;
        try { committed?.(value); } catch { /* listener errors are not the store's */ }
        return value;
      }).then((value) => {
        // Only a transaction that waits for the disk can fail on it (a lazy one resolves at once).
        const waits = typeof durable === 'function' ? durable(value) !== false : durable !== false;
        if (waits && control.failWrites) throw Object.assign(Error('disk full'), { code: 'ENOSPC' });
        return value;
      });
    },
    read(operation) {
      if (control.failReads) return Promise.reject(Object.assign(Error('store unavailable'), { code: 'EIO' }));
      return enqueue(async () => { if (control.holdReads) await control.holdReads; return operation(structuredClone(db)); });
    },
    flush: () => queue, close: () => queue,
    stats: () => ({ mode: 'test' }),
  };
}

test('a departure committed in memory still revokes when its write fails, and nothing is forwarded for the departing life', async (t) => {
  const store = switchableStore();
  const { f, A, B, act } = await park(t, { store, heartbeatMs: 60000 });
  const { a, b } = await joinBoth(f, A, B);
  assert.deepEqual(await signal(a, b, 'before'), { delivered: true, code: null }, 'control: signalling works');
  store.control.failWrites = true;
  const actionId = `${f.now()}:${randomUUID()}`;
  const mark = a.log.length;
  const failed = await act(A, { type: 'travel', id: 'library', mode: 'trek' }, actionId);
  assert.equal(failed.status, 500, 'the request is not acknowledged');
  // The life the server now holds is travelling — so the room must already know.
  assert.equal((await until(a, isError('venue_mismatch'), 'revocation after the failed write', mark)).code, 'venue_mismatch');
  assert.deepEqual((await roster(b, true)).map((member) => member.id), [B.id], 'the peer’s roster no longer lists the departed player or their voice flag');
  assert.deepEqual(await signal(a, b, 'during-failure'), { delivered: false, code: 'join_required' });
  assert.equal((await answer(a, () => say(a, { type: 'join', cityId: 'lagos', venueId: 'park' }))).code, 'venue_mismatch', 'and the old room cannot be rejoined');
  // The disk comes back and the client retries the same action ID: applied once, membership stays revoked.
  store.control.failWrites = false;
  const retry = await act(A, { type: 'travel', id: 'library', mode: 'trek' }, actionId);
  assert.deepEqual([retry.status, retry.ok, retry.duplicate, retry.state.activeAction.kind], [200, true, true, 'travel']);
  assert.deepEqual((await roster(b, false)).map((member) => member.id), [B.id]);
});

test('a room message from a socket whose life has just departed waits for the re-check and is never forwarded', async (t) => {
  const store = switchableStore();
  const { f, A, B, act } = await park(t, { store, heartbeatMs: 60000 });
  const { a, b } = await joinBoth(f, A, B);
  // The write fails, so the route's own validation never runs; and reads are held back, so the
  // re-check that follows the departure cannot finish yet (the request itself waits for that re-check
  // before it is answered). The socket is therefore still listed in the room when it sends — the one
  // moment a remembered membership could be trusted.
  let release; store.control.holdReads = new Promise((resolve) => { release = resolve; });
  store.control.failWrites = true;
  const mark = a.log.length, heard = b.log.length;
  const request = act(A, { type: 'travel', id: 'library', mode: 'trek' });
  await new Promise((resolve) => setTimeout(resolve, 80)); // the departure is in the store's memory; its write has failed
  say(a, { type: 'signal', to: B.id, data: { probe: 'in-the-gap' } });
  say(a, { type: 'chat', clientId: 'gap', body: 'in the gap' });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(a.log.slice(mark).filter((m) => m.type === 'error'), [], 'held: nothing has been answered yet');
  assert.equal(b.log.slice(heard).some((m) => m.type === 'signal' || m.type === 'chat'), false, 'and nothing was forwarded on the strength of the old membership');
  store.control.holdReads = null; release();
  assert.equal((await request).status, 500, 'the request is answered only after its rooms were re-checked');
  await until(a, () => a.log.slice(mark).filter((item) => item.type === 'error').length >= 3, 'three answers', mark);
  assert.deepEqual(a.log.slice(mark).filter((m) => m.type === 'error').map((m) => m.code), ['venue_mismatch', 'join_required', 'join_required']);
  store.control.failWrites = false;
  // B saw the departure and never the two messages.
  assert.deepEqual((await roster(b, true)).map((member) => member.id), [B.id]);
  await answer(b, () => say(b, { type: 'chat', clientId: 'barrier', body: 'barrier' }), (m) => m.type === 'chat' && m.clientId === 'barrier');
  assert.equal(b.log.slice(heard).some((m) => m.type === 'signal' || (m.type === 'chat' && m.clientId === 'gap')), false);
});

test('revalidate(publicId) re-checks sockets against the stored life, and drops them when the store cannot be read', async (t) => {
  const store = switchableStore();
  let captured;
  const { f, A, B } = await park(t, { store, heartbeatMs: 60000, routes: [...ROUTE_MODULES, (ctx) => { captured = ctx; return {}; }] });
  const { a, b } = await joinBoth(f, A, B);
  assert.equal(typeof captured.core.revalidate, 'function');
  // Nothing changed: revalidating keeps everybody, voice flag included.
  await captured.core.revalidate(A.id);
  await captured.core.revalidate('not-a-player');
  await captured.core.revalidate(undefined);
  assert.equal((await roster(b, true)).find((member) => member.id === A.id).enabled, true);
  // The stored life is changed behind the room module's back (no settlement announces it): only revalidate can notice.
  await store.transact((db) => { const session = Object.values(db.sessions).find((item) => item.publicId === A.id); session.cities.lagos.state.location = 'library'; });
  assert.deepEqual(await signal(a, b, 'unnoticed'), { delivered: true, code: null }, 'control: nothing has re-checked yet');
  let mark = a.log.length;
  await captured.core.revalidate(A.id);
  assert.equal((await until(a, isError('venue_mismatch'), 'revocation', mark)).code, 'venue_mismatch');
  assert.deepEqual((await roster(b, false)).map((member) => member.id), [B.id]);
  // Unknown is "not allowed": if the store cannot be read, the sockets asked about are dropped.
  store.control.failReads = true;
  mark = b.log.length;
  await captured.core.revalidate(B.id);
  assert.equal((await until(b, isError('venue_mismatch'), 'fail-closed drop', mark)).code, 'venue_mismatch');
  store.control.failReads = false;
  const back = await answer(b, () => say(b, { type: 'join', cityId: 'lagos', venueId: 'park' }));
  assert.deepEqual(back.members.map((member) => member.id), [B.id], 'and can come back once it can');
});

test('with the real store and a failing disk, room authority always agrees with the life the server holds', async (t) => {
  const { f, A, B, act } = await park(t, { heartbeatMs: 60000 });
  const { a, b } = await joinBoth(f, A, B);
  const disk = join(f.dir, 'devices.json'), backup = join(f.dir, 'devices.saved.json');
  let blocked = false;
  const restore = async () => { if (blocked) { await rm(disk, { recursive: true, force: true }); await rename(backup, disk); blocked = false; } };
  t.after(restore);
  await f.flush();
  await rename(disk, backup); await mkdir(disk); blocked = true; // every write now fails (EISDIR on rename)
  const actionId = `${f.now()}:${randomUUID()}`;
  const failed = await act(A, { type: 'travel', id: 'library', mode: 'trek' }, actionId);
  assert.equal(failed.status, 503, 'the store reports a write it could not make as storage_unavailable');
  // What does the server hold for A now? (Looked at inside the store's own read; whether that read
  // then rejects because of the disk does not matter here.)
  let held;
  await f.server.store.read((db) => { held = structuredClone(Object.values(db.sessions).find((session) => session.publicId === A.id).cities.lagos.state); }).catch(() => {});
  const members = (await roster(b, true)).map((member) => member.id);
  const forwarded = await signal(a, b, 'after-failed-write');
  assert.equal(isDeparting(held), false, 'this store takes a change back when its write fails');
  if (isDeparting(held)) {
    // The departure is in memory although the request failed: membership, voice flag and forwarding are gone.
    assert.equal(a.log.some(isError('venue_mismatch')), true);
    assert.deepEqual(members, [B.id]);
    assert.deepEqual(forwarded, { delivered: false, code: 'join_required' });
  } else {
    // The store took the change back: the player never left, was not revoked, and is still a member.
    assert.equal(a.log.some(isError('venue_mismatch')), false);
    assert.deepEqual(members.sort(), [A.id, B.id].sort());
    assert.deepEqual(forwarded, { delivered: true, code: null });
  }
  await restore();
  const retry = await act(A, { type: 'travel', id: 'library', mode: 'trek' }, actionId);
  assert.deepEqual([retry.status, retry.duplicate, retry.state.activeAction.kind], [200, undefined, 'travel'], 'applied now, once: there was no receipt to repeat');
  assert.deepEqual((await roster(b, false)).map((member) => member.id), [B.id], 'once the travel stands, A is out of the room either way');
  assert.deepEqual(await signal(a, b, 'after-retry'), { delivered: false, code: 'join_required' });
});
