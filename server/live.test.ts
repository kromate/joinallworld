// OWNER: social — live location (server/social/live.ts, server/ws/live.ts): who is told where a player is, what a
// frame carries, what is never told, and that states in between are dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import type { Device, TestSocket } from './test-fixture.ts';
import { LIVE } from './social/live.ts';
import { friendsIn } from './social/founder.ts';
import type { ServerFrame } from '../src/types/protocol.ts';
import type { LiveMoveFrame, LiveSnapshotFrame, LiveSpot } from '../src/types/live.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
const pause = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const post = async (f: Fixture, path: string, body: unknown, who: Device): Promise<{ ok?: boolean; code?: string }> => (await f.request(path, body, who.cookie)).json() as Promise<{ ok?: boolean; code?: string }>;
/** A player who exists for the social features: a life in Lagos, and the overview read once. */
async function player(f: Fixture, name: string): Promise<Device> {
  const who = await f.device(name);
  await f.request('/api/life?city=lagos', null, who.cookie);
  assert.equal((await f.request('/api/social/me', null, who.cookie)).status, 200);
  return who;
}
async function befriend(f: Fixture, a: Device, b: Device): Promise<void> {
  assert.equal((await post(f, '/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a)).code, 'requested');
  assert.equal((await post(f, '/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b)).code, 'accepted');
}
/** A socket whose every frame is kept, with the live frames read out of it. */
async function watcher(f: Fixture, who: Device) {
  const peer: TestSocket = await f.socket(who);
  const frames: (ServerFrame & { got: number })[] = [];
  peer.ws.on('message', (data) => { frames.push({ ...(JSON.parse(data.toString()) as ServerFrame), got: Date.now() }); });
  const live = (): (LiveMoveFrame | LiveSnapshotFrame)[] => frames.filter((frame): frame is (LiveMoveFrame | LiveSnapshotFrame) & { got: number } => frame.type === 'live-move' || frame.type === 'live-snapshot');
  /** The latest spot this socket was told for a player. */
  const spot = (id: string): LiveSpot | undefined => live().flatMap((frame) => (frame.type === 'live-snapshot' ? frame.friends : frame.spots ?? [])).filter((item) => item.id === id).at(-1);
  const city = () => live().map((frame) => frame.city).filter(Boolean).at(-1) ?? null;
  async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
    for (let i = 0; i < 150; i++) { const value = read(); if (value) return value; await pause(); }
    throw new Error(`Never happened: ${what}`);
  }
  const watch = async (cityId = 'lagos'): Promise<LiveSnapshotFrame> => {
    const before = live().filter((frame) => frame.type === 'live-snapshot').length;
    peer.ws.send(JSON.stringify({ type: 'live-watch', cityId }));
    return until(() => { const list = live().filter((frame): frame is LiveSnapshotFrame => frame.type === 'live-snapshot'); return list.length > before ? list.at(-1) : null; }, 'a snapshot');
  };
  return { peer, frames, live, spot, city, until, watch, errors: () => frames.filter((frame) => frame.type === 'error') };
}
/** Long enough for anything that was going to be sent to have been. */
const quiet = (): Promise<void> => pause(LIVE.tickMs * 3);

test('a watcher gets a snapshot, then one frame when a friend connects, starts a trip, arrives and leaves', async (t) => {
  const f = await fixture(t);
  const ada = await player(f, 'Ada'), bola = await player(f, 'Bola');
  await befriend(f, ada, bola);
  const a = await watcher(f, ada);
  const first = await a.watch();
  assert.equal(first.at, f.now(), 'the frame carries the server clock');
  assert.deepEqual(first.friends.map((spot) => [spot.id, spot.status]), [[bola.id, 'offline']], 'a friend with no connection is offline, with no place');
  await a.until(() => a.city()?.venues.park === 1, 'Ada herself, counted at the park she stands in');

  // Bola connects: Ada is told where he is, from his stored life.
  const b = await f.socket(bola);
  assert.deepEqual(await a.until(() => (a.spot(bola.id)?.status === 'online' ? a.spot(bola.id) : null), 'Bola online'), { id: bola.id, status: 'online', cityId: 'lagos', venue: 'park' });
  await a.until(() => a.city()?.venues.park === 2, 'two players at the park');

  // A trip: one frame with where from, where to, how, when it began and how long it takes.
  f.advance(5000);
  const started = await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' });
  assert.equal(started.ok, true);
  const duration = started.state.activeAction?.duration ?? 0;
  const trip = await a.until(() => a.spot(bola.id)?.trip, 'the trip');
  assert.deepEqual(trip, { from: 'park', to: 'library', mode: 'trek', startedAt: f.now(), duration });
  assert.equal(a.spot(bola.id)?.venue, undefined, 'on a trip he is in no venue');
  await a.until(() => a.city()?.moving === 1 && a.city()?.venues.park === 1, 'the city counts him as moving');

  // Polls while the trip runs change nothing a watcher needs: no frame.
  const sent = a.live().length;
  for (let i = 0; i < 4; i++) { f.advance(1000); await f.request('/api/life?city=lagos', null, bola.cookie); }
  await quiet();
  assert.equal(a.live().length, sent, 'a running trip costs no further frames');

  // Arrival: the venue, and the count of that venue.
  f.advance(duration * 1000);
  await f.request('/api/life?city=lagos', null, bola.cookie);
  await a.until(() => a.spot(bola.id)?.venue === 'library', 'the arrival');
  assert.equal(a.spot(bola.id)?.trip, undefined);
  await a.until(() => a.city()?.venues.library === 1 && a.city()?.moving === 0, 'one player at the library');

  // His last connection closes: told at once, with the time, and no place.
  f.advance(1000);
  b.ws.close();
  const gone = await a.until(() => (a.spot(bola.id)?.status === 'reconnecting' ? a.spot(bola.id) : null), 'Bola gone');
  assert.deepEqual(gone, { id: bola.id, status: 'reconnecting', seenAt: f.now() });
  await a.until(() => a.city()?.venues.library === undefined, 'nobody at the library');
  assert.deepEqual(a.errors(), []);
});

test('rapid changes are coalesced: the latest spot only, and never more than four frames a second', async (t) => {
  const f = await fixture(t);
  const ada = await player(f, 'Ada'), bola = await player(f, 'Bola');
  await befriend(f, ada, bola);
  const a = await watcher(f, ada);
  await f.socket(bola);
  await a.watch();
  await a.until(() => a.spot(bola.id)?.status === 'online', 'Bola online');
  await quiet();
  const before = a.live().length, from = Date.now();
  // Start, cancel, start, cancel … twelve changes inside one tick or two.
  for (let i = 0; i < 6; i++) {
    assert.equal((await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
    assert.equal((await f.action(bola.cookie, { type: 'cancel' })).ok, true);
  }
  assert.equal((await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
  await a.until(() => a.spot(bola.id)?.trip?.to === 'library', 'the last trip');
  await quiet();
  const after = a.frames.filter((frame) => frame.type === 'live-move').slice(before);
  const seconds = Math.max(1, (Date.now() - from) / 1000);
  assert.ok(after.length <= Math.ceil(seconds * (1000 / LIVE.tickMs)) + 1, `${after.length} frames in ${seconds.toFixed(2)} s`);
  assert.ok(after.length < 13, 'thirteen changes did not make thirteen frames');
  for (let i = 1; i < after.length; i++) assert.ok(after[i]!.got - after[i - 1]!.got >= LIVE.tickMs - 60, 'frames are a tick apart');
  assert.equal(a.spot(bola.id)?.trip?.to, 'library', 'what stands is the latest state');
});

test('only friends by request are told: not a stranger, not a blocked friend, and never across an automatic friendship with the founder', async (t) => {
  const f = await fixture(t);
  const ada = await player(f, 'Ada'), bola = await player(f, 'Bola'), cy = await player(f, 'Cyril'), zed = await player(f, 'Zed');
  await befriend(f, ada, bola);
  // An automatic friendship with the founder, as the service stores one: on the player's side only, with the marker.
  await f.server.store.transact((db) => {
    const players = db.social!.players;
    players[bola.id]!.friends[zed.id] = f.now(); players[bola.id]!.founder = { id: zed.id, at: f.now() };
    players[ada.id]!.friends[zed.id] = f.now(); players[ada.id]!.founder = { id: zed.id, at: f.now() };
    assert.ok(friendsIn(players, zed.id, bola.id) && friendsIn(players, bola.id, zed.id), 'they are friends, automatically');
  });
  const a = await watcher(f, ada), c = await watcher(f, cy), z = await watcher(f, zed), b = await watcher(f, bola);
  const [adaSees, cySees, zedSees, bolaSees] = [await a.watch(), await c.watch(), await z.watch(), await b.watch()];
  assert.deepEqual(adaSees.friends.map((spot) => spot.id), [bola.id], 'Ada follows Bola, not the founder');
  assert.deepEqual(cySees.friends, [], 'a stranger follows nobody');
  assert.deepEqual(zedSees.friends, [], 'the founder follows none of the automatic friends');
  assert.deepEqual(bolaSees.friends.map((spot) => spot.id), [ada.id], 'and none of them follows the founder');

  assert.equal((await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
  await a.until(() => a.spot(bola.id)?.trip, 'Ada sees the trip');
  assert.equal((await f.action(zed.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
  await quiet();
  const named = (w: typeof a): string[] => [...new Set(w.live().flatMap((frame) => (frame.type === 'live-snapshot' ? frame.friends : frame.spots ?? [])).map((spot) => spot.id))];
  assert.deepEqual(named(c), [], 'the stranger was told about nobody');
  assert.deepEqual(named(z), [], 'the founder was told about nobody');
  assert.deepEqual(named(b), [ada.id], 'Bola was not told where the founder went');
  assert.deepEqual(named(a), [bola.id]);
  // Everyone in the city room has the same counts, without names.
  await c.until(() => c.city()?.moving === 2, 'two players moving');
  assert.deepEqual(Object.keys(c.live().at(-1) ?? {}).sort().filter((key) => key !== 'spots' && key !== 'got'), ['at', 'city', 'type'], 'a city frame for a stranger is counts only');

  // A block: the two stop existing for each other, at once, in the list and in the counts.
  const blocks = a.live().filter((frame) => frame.type === 'live-snapshot').length;
  assert.equal((await post(f, '/api/social/block', { id: bola.id, cityId: 'lagos' }, ada)).ok, true);
  const fresh = await a.until(() => { const list = a.live().filter((frame): frame is LiveSnapshotFrame => frame.type === 'live-snapshot'); return list.length > blocks ? list.at(-1) : null; }, 'a fresh snapshot after the block');
  assert.deepEqual(fresh.friends, []);
  assert.equal(fresh.city?.moving, 1, 'the blocked player is not in the counts Ada is given');
  const told = a.live().length;
  assert.equal((await f.action(bola.cookie, { type: 'cancel' })).ok, true);
  await c.until(() => c.city()?.moving === 1, 'the stranger sees the count change');
  await quiet();
  assert.ok(a.live().slice(told).every((frame) => !(frame.type === 'live-move' && frame.spots)), 'nothing more about Bola reaches Ada');
  assert.equal(a.city()?.moving, 1, 'and Ada still counts only the other traveller');
});

test('a friendship that ended is not followed, even before the watcher subscribes again', async (t) => {
  const f = await fixture(t);
  const ada = await player(f, 'Ada'), bola = await player(f, 'Bola');
  await befriend(f, ada, bola);
  const a = await watcher(f, ada);
  await f.socket(bola);
  await a.watch();
  await a.until(() => a.spot(bola.id)?.status === 'online', 'Bola online');
  assert.equal((await post(f, '/api/social/friends/remove', { id: ada.id, cityId: 'lagos' }, bola)).ok, true);
  const told = a.live().length;
  assert.equal((await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
  await a.until(() => a.city()?.moving === 1, 'the count');
  await quiet();
  assert.ok(a.live().slice(told).every((frame) => !(frame.type === 'live-move' && frame.spots)), 'the trip of a former friend is not sent');
});

test('a life held for the quick start watches nothing and is counted nowhere; a second connection resyncs with a snapshot', async (t) => {
  const f = await fixture(t);
  const ada = await player(f, 'Ada'), bola = await player(f, 'Bola');
  await befriend(f, ada, bola);
  const guest = await (async (): Promise<Device> => { const res = await f.request('/api/session', { name: 'Guest', onboarding: true }); return { cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '', ...((await res.json()) as { session: { id: string; name: string } }).session } as Device; })();
  await f.request('/api/life?city=lagos', null, guest.cookie);
  const g = await watcher(f, guest);
  g.peer.ws.send(JSON.stringify({ type: 'live-watch', cityId: 'lagos' }));
  await g.until(() => g.errors().length, 'a refusal');
  assert.deepEqual(g.errors().map((frame) => (frame.type === 'error' ? frame.code : '')), ['onboarding_required']);

  await f.socket(bola);
  assert.equal((await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
  // A watcher that connects late — or again — is given the whole picture first.
  const a = await watcher(f, ada);
  const late = await a.watch();
  assert.equal(late.friends.find((spot) => spot.id === bola.id)?.trip?.to, 'library');
  await a.until(() => a.city()?.venues.park === 1 && a.city()?.moving === 1, 'Ada at the park, Bola moving');
  assert.deepEqual(a.city(), { cityId: 'lagos', venues: { park: 1 }, moving: 1 }, 'the guest is in no count');
  a.peer.ws.close();
  const again = await watcher(f, ada);
  assert.equal((await again.watch()).friends.find((spot) => spot.id === bola.id)?.trip?.to, 'library', 'a reconnect is a new snapshot');
  // Another city's counts are not handed out, and a made-up city is refused.
  assert.equal((await again.watch('ibadan')).city, null);
  again.peer.ws.send(JSON.stringify({ type: 'live-watch', cityId: 'atlantis' }));
  await again.until(() => again.errors().length, 'a refusal');
  assert.deepEqual(again.errors().map((frame) => (frame.type === 'error' ? frame.code : '')), ['invalid_city']);
  // Unwatch: nothing more arrives.
  again.peer.ws.send(JSON.stringify({ type: 'live-unwatch' }));
  await pause(60);
  const told = again.live().length;
  assert.equal((await f.action(bola.cookie, { type: 'cancel' })).ok, true);
  await quiet();
  assert.equal(again.live().length, told);
});

test('watching is rate-limited like other socket messages', async (t) => {
  const f = await fixture(t);
  const ada = await player(f, 'Ada');
  const a = await watcher(f, ada);
  for (let i = 0; i < LIVE.watchPerMinute + 2; i++) a.peer.ws.send(JSON.stringify({ type: 'live-watch', cityId: 'lagos' }));
  await a.until(() => a.errors().length >= 2, 'refusals');
  assert.equal(a.live().filter((frame) => frame.type === 'live-snapshot').length, LIVE.watchPerMinute);
  assert.deepEqual([...new Set(a.errors().map((frame) => (frame.type === 'error' ? frame.code : '')))], ['rate_limited']);
});

test('a journey to another city: friends see the journey, then the new city; the traveller is moved to that city\'s room', async (t) => {
  const f = await fixture(t);
  const ada = await player(f, 'Ada'), bola = await player(f, 'Bola'), cy = await player(f, 'Cyril');
  await befriend(f, ada, bola);
  const a = await watcher(f, ada), b = await watcher(f, bola), c = await watcher(f, cy);
  await a.watch(); await b.watch(); await c.watch();
  await a.until(() => a.spot(bola.id)?.venue === 'park', 'Bola at the park');
  await c.until(() => c.city()?.venues.park === 3, 'three at the park');

  f.advance(2000);
  const left = await f.action(bola.cookie, { type: 'estate.relocate', payload: { to: 'ibadan', mode: 'road' } });
  assert.equal(left.code, 'departed');
  const journey = await a.until(() => a.spot(bola.id)?.journey, 'the journey');
  assert.deepEqual(journey, { to: 'ibadan', mode: 'road', startedAt: f.now(), duration: left.state.activeAction?.duration });
  assert.deepEqual([a.spot(bola.id)?.cityId, a.spot(bola.id)?.venue, a.spot(bola.id)?.trip], ['lagos', undefined, undefined], 'still of the city being left, in no venue');
  await c.until(() => c.city()?.venues.park === 2 && c.city()?.moving === 0, 'a journey out is not a trip inside the city');

  f.advance((left.state.activeAction?.duration ?? 0) * 1000 + 1000);
  const landed = (await (await f.request('/api/life?city=lagos', null, bola.cookie)).json()) as { state: { location: string; estate: { city: string } } };
  assert.equal(landed.state.estate.city, 'ibadan');
  const there = await a.until(() => (a.spot(bola.id)?.cityId === 'ibadan' ? a.spot(bola.id) : null), 'Bola in Ibadan');
  assert.deepEqual(there, { id: bola.id, status: 'online', cityId: 'ibadan', venue: landed.state.location });
  // The traveller's own socket now watches Ibadan, without asking: a snapshot of that city, and Lagos's counts no longer reach it.
  const moved = await b.until(() => b.live().filter((frame): frame is LiveSnapshotFrame => frame.type === 'live-snapshot').find((frame) => frame.city?.cityId === 'ibadan'), 'a snapshot of Ibadan');
  assert.deepEqual(moved.friends.map((spot) => [spot.id, spot.cityId]), [[ada.id, 'lagos']], 'a friend in another city is still followed');
  await b.until(() => b.city()?.cityId === 'ibadan' && b.city()?.venues[landed.state.location] === 1, 'counted in Ibadan');
  const told = b.live().length;
  assert.equal((await f.action(cy.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
  await a.until(() => a.city()?.moving === 1, 'Lagos sees the trip');
  await quiet();
  assert.deepEqual(b.live().slice(told).filter((frame) => frame.city && frame.city.cityId !== 'ibadan'), [], 'no Lagos counts for someone in Ibadan');
});
