// OWNER: world — the pulse (server/pulse.ts): people online and total visits, over real sockets and a real store.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { fixture } from './test-fixture.ts';
import { createServer } from './server.ts';
import { createLife } from '../src/life.ts';
import type { Device } from './test-fixture.ts';

type Pulse = { online: number; visits: number; cities: Record<string, number> };
const DAY = 86400000;
const pulse = async (f: Awaited<ReturnType<typeof fixture>>, who: Device): Promise<Pulse> => {
  f.advance(4000); // the answer is cached for a few seconds
  const res = await f.request('/api/world/pulse', undefined, who.cookie);
  assert.equal(res.status, 200);
  return await res.json() as Pulse;
};
const beat = async (f: Awaited<ReturnType<typeof fixture>>): Promise<void> => { f.server.beat(); await new Promise((resolve) => setTimeout(resolve, 60)); };
const closed = (socket: { ws: { once(event: 'close', fn: () => void): void; close(): void } }): Promise<void> => new Promise((resolve) => { socket.ws.once('close', resolve); socket.ws.close(); });

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));
/** The pulse as a player sees it, without moving the clock. */
const look = async (f: Awaited<ReturnType<typeof fixture>>, who: Device): Promise<Pulse & { today: number }> => {
  const res = await f.request('/api/world/pulse', undefined, who.cookie);
  assert.equal(res.status, 200);
  return await res.json() as Pulse & { today: number };
};
const GRACE = 20000;

test('a signed-in device is required, and the answer is the documented shape', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/world/pulse')).status, 401);
  const ada = await f.device('Ada');
  const body = await pulse(f, ada);
  assert.deepEqual(Object.keys(body).sort(), ['cities', 'online', 'serverTime', 'today', 'visits']);
});

test('the viewer is always counted, in the world and in their own city: nobody is shown 0', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  const nothing = await look(f, ada);
  assert.deepEqual([nothing.online, nothing.cities['lagos']], [1, 0], 'a request is a sign of life: the caller is online themselves (a device with no life yet is in no city)');
  assert.equal((await f.request('/api/world/me?city=lagos', undefined, ada.cookie)).status, 200);
  const alone = await look(f, ada);
  assert.deepEqual([alone.online, alone.cities['lagos']], [1, 1], 'with a life, the caller is in the city their character is in');
  assert.ok(alone.today >= alone.online, 'the players of today are never fewer than the players online');
  const peer = await f.joinRoom(ada); await settle();
  const joined = await look(f, ada);
  assert.deepEqual([joined.online, joined.cities['lagos']], [1, 1], 'a socket of the same player is not a second player');
  void peer;
});

test('online counts distinct players: two sockets of one player are one, a guest counts, a drop leaves after the grace', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  const a1 = await f.joinRoom(ada), a2 = await f.joinRoom(ada);
  assert.equal((await pulse(f, ada)).online, 1);
  const guest = await f.request('/api/session', { name: 'Guest', onboarding: true });
  const cookie = (guest.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const g = await f.socket({ cookie });
  const b = await f.joinRoom(bola);
  const both = await look(f, ada);
  assert.equal(both.online, 3, 'Ada once, the guest, Bola');
  assert.equal(both.cities['lagos'], 2, 'the guest has no room and no life yet: in the world, in no city');
  await closed(a1); await settle();
  assert.equal((await look(f, ada)).online, 3, 'Ada still has a socket');
  await closed(a2); await closed(b); await settle();
  assert.equal((await look(f, ada)).online, 3, 'Ada and Bola left a moment ago: they are inside the grace, not gone');
  f.advance(GRACE + 1000);
  const later = await look(f, bola);
  assert.equal(later.online, 2, 'the guest is left, and Bola is counted as the one asking');
  await closed(g); await settle(); f.advance(GRACE + 1000);
  assert.equal((await look(f, bola)).online, 1, 'only the caller is left');
});

test('a page reload inside the grace window changes no count, for the others or for the player', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola'), cleo = await f.device('Cleo');
  await f.joinRoom(ada); const first = await f.joinRoom(bola); await f.joinRoom(cleo); await settle();
  const before = await look(f, ada);
  assert.deepEqual([before.online, before.cities['lagos']], [3, 3]);
  await closed(first); await settle();
  f.advance(1500);
  const during = await look(f, ada);
  assert.deepEqual([during.online, during.cities['lagos']], [3, 3], 'Bola is mid-reload: still counted, still in Lagos');
  const reloaded = await f.socket(bola); await settle();
  const seenByBola = await look(f, bola);
  assert.deepEqual([seenByBola.online, seenByBola.cities['lagos']], [3, 3], 'the new socket has not joined a room yet: the page itself is not counted twice and is not lost');
  reloaded.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await reloaded.next(); await settle();
  assert.deepEqual([(await look(f, cleo)).online, (await look(f, cleo)).cities['lagos']], [3, 3]);
  f.advance(GRACE * 2);
  assert.equal((await look(f, ada)).online, 3, 'the old socket is long gone and nothing changed');
});

test('a visitor is counted in the city they are in, a player is counted once, and the world is never below a city', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  await f.joinRoom(ada); await f.joinRoom(bola);
  // Bola lives in Lagos but is standing in Ibadan (the registry holds both cities).
  for (const ws of f.server.wss.clients as Set<{ room?: string; session?: { id: string } }>) if (ws.session?.id === bola.id) ws.room = 'ibadan:park';
  const seen = await look(f, ada);
  assert.deepEqual([seen.cities['lagos'], seen.cities['ibadan'], seen.online], [1, 1, 2]);
  for (const city of Object.keys(seen.cities)) assert.ok(seen.online >= (seen.cities[city] ?? 0), `world >= ${city}`);
  const alone = await look(f, bola);
  assert.deepEqual([alone.cities['lagos'], alone.cities['ibadan']], [1, 1], 'the answer to Bola counts Bola where Bola stands, not at home');
});

test('a block changes nobody’s count: a count that left someone out for one viewer would tell that viewer who they blocked', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola'), cleo = await f.device('Cleo');
  await f.joinRoom(ada); await f.joinRoom(bola); await f.joinRoom(cleo); await settle();
  const before = await look(f, ada);
  const blocked = await f.request('/api/social/block', { id: bola.id, cityId: 'lagos' }, ada.cookie);
  assert.equal(blocked.status, 200);
  const after = await look(f, ada), other = await look(f, cleo);
  assert.deepEqual([after.online, after.cities['lagos']], [before.online, before.cities['lagos']]);
  assert.deepEqual([other.online, other.cities['lagos']], [3, 3]);
});

test('the pulse frame: asked for once, sent at once with the viewer counted, then on every change, at most every two seconds, and never to a socket that did not ask', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola'), cleo = await f.device('Cleo');
  const quiet = await f.joinRoom(cleo);
  const a = await f.joinRoom(ada); await settle();
  const frames = async (peer: { next(): Promise<{ type: string }> }, ms = 150): Promise<any[]> => { const got: any[] = []; for (;;) { const frame = await Promise.race([peer.next(), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]); if (!frame) return got; if (frame.type === 'pulse') got.push(frame); } };
  a.ws.send(JSON.stringify({ type: 'pulse-watch' }));
  const first = await frames(a);
  assert.equal(first.length, 1);
  assert.deepEqual([first[0].online, first[0].cities.lagos], [2, 2], 'Ada and Cleo, Ada in her own city count from the first frame');
  assert.equal(typeof first[0].visits, 'number');
  // Arrivals are told within the push interval, once however many came.
  const rows = await f.server.store.read((db) => JSON.stringify(db['pulse'] ?? null));
  f.advance(2100);
  const b = await f.joinRoom(bola), c2 = await f.socket(bola); await settle();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const pushed = await frames(a, 400);
  assert.equal(pushed.length, 1, 'one coalesced frame for two arrivals');
  assert.deepEqual([pushed[0].online, pushed[0].cities.lagos], [3, 3]);
  assert.deepEqual(await frames(quiet, 100), [], 'a socket that did not ask is not sent counts');
  assert.equal(await f.server.store.read((db) => JSON.stringify(db['pulse'] ?? null)), rows, 'a push writes nothing');
  void b; void c2;
  // Nothing changed: nothing is sent.
  f.advance(3000); f.server.beat(); await settle();
  assert.deepEqual(await frames(a, 200), []);
});

test('visits count one per player per day, not twice', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  // The first count seeds from the sessions stored so far (Ada and Bola), each counted once, today.
  assert.equal((await pulse(f, ada)).visits, 2);
  await f.joinRoom(ada); await beat(f);
  assert.equal((await pulse(f, ada)).visits, 2, 'the socket is the same player-day');
  await beat(f); await pulse(f, ada); await beat(f);
  assert.equal((await pulse(f, ada)).visits, 2, 'seen again the same day adds nothing');
  await f.joinRoom(bola); await beat(f);
  assert.equal((await pulse(f, ada)).visits, 2);
  const cleo = await f.device('Cleo'); await f.joinRoom(cleo); await beat(f);
  assert.equal((await pulse(f, ada)).visits, 3, 'a new player adds one');
  f.advance(DAY);
  await beat(f);
  assert.equal((await pulse(f, ada)).visits, 6, 'all three are connected on the next day');
  assert.equal((await pulse(f, bola)).visits, 6, 'and still once each');
});

test('a player who only polls is counted once a day too', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  await pulse(f, ada); await pulse(f, ada);
  assert.equal((await pulse(f, ada)).visits, 1);
});

/** Stop this server and start another over the same data directory, as a restart does. */
async function restart(f: Awaited<ReturnType<typeof fixture>>) {
  await f.flush();
  f.server.closeAllConnections();
  await new Promise<void>((resolve) => f.server.close(() => resolve()));
  await f.server.store.close?.();
  const next = await createServer({ dataDir: f.dir, now: () => f.now(), sessionTtlMs: 2592000000 });
  next.listen(0, '127.0.0.1'); await once(next, 'listening');
  const address = next.address();
  assert.ok(address && typeof address !== 'string');
  return { next, get: async (cookie: string) => await (await fetch(`http://127.0.0.1:${address.port}/api/world/pulse`, { headers: { Cookie: cookie } })).json() as Pulse, stop: async () => { next.closeAllConnections(); await new Promise<void>((resolve) => next.close(() => resolve())); await next.store.close?.(); } };
}

test('visits survive a restart over the same data, and the same day is not counted again', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  await pulse(f, ada); await pulse(f, bola);
  const again = await restart(f);
  assert.equal((await again.get(ada.cookie)).visits, 2);
  f.advance(DAY);
  assert.equal((await again.get(ada.cookie)).visits, 3, 'a new day counts Ada once more');
  await again.stop();
});

test('the first start seeds from the stored sessions (and archived lives), and marks them counted today', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'); await f.device('Bola'); await f.device('Cleo');
  await f.server.store.transact((db) => { delete db['pulse']; });
  const again = await restart(f);
  assert.equal(await again.next.store.read((db) => Object.hasOwn(db, 'pulse')), false, 'nothing is written before the first count');
  assert.equal((await again.get(ada.cookie)).visits, 3, 'seeded with the three stored sessions, the caller included once');
  assert.equal((await again.get(ada.cookie)).visits, 3, 'a stored session is not counted again on the day it was seeded');
  await again.stop();
});

test('the header pill, the Neighbours directory and the hunt chip read one number per city, in two cities', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola'), chidi = await f.device('Chidi');
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola), c = await f.joinRoom(chidi);
  // Put Chidi's room in Ibadan (the registry holds both cities); the count follows the room's city.
  for (const ws of f.server.wss.clients as Set<{ room?: string; session?: { id: string } }>) if (ws.session?.id === chidi.id) ws.room = 'ibadan:park';
  await f.server.store.transact((db) => { const session = db.sessions[chidi.cookie.slice(4)]; assert.ok(session); session.character = { ...session.character, v: 2, city: 'ibadan' } as typeof session.character; session.cities.ibadan = { state: createLife({ estate: { city: 'ibadan' } }, { now: f.now(), cityId: 'ibadan' }), updatedAt: f.now(), salt: 'ibadan-salt-12345' }; delete session.cities.lagos; });
  const read = async (path: string, who: Device) => { const res = await f.request(path, undefined, who.cookie); assert.equal(res.status, 200, `${path} ${JSON.stringify(await res.clone().json())}`); return await res.json() as Record<string, any>; };
  for (const [city, expected, viewer] of [['lagos', 2, ada], ['ibadan', 1, chidi]] as const) {
    f.advance(4000);
    const pill = await read('/api/world/pulse', ada);
    const hunt = await read(`/api/civic/pulse?city=${city}`, viewer);
    const neighbours = await read(`/api/civic/neighbours?city=${city}`, viewer);
    assert.equal(pill.cities[city], expected, `pill, ${city}`);
    assert.equal(hunt.counters.online, expected, `hunt chip, ${city}`);
    assert.equal(neighbours.online, expected, `directory, ${city}`);
    assert.equal(pill.online, 3, 'the world count is every connected player');
  }
  void a; void b; void c;
});

test('the gem hunt chip, Neighbours and the rich list say what the pill says in the same request sequence, with and without a socket yet', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  assert.equal((await f.request('/api/world/me?city=lagos', undefined, ada.cookie)).status, 200);
  const read = async (path: string, who: Device) => { const res = await f.request(path, undefined, who.cookie); assert.equal(res.status, 200, path); return await res.json() as Record<string, any>; };
  const together = async (who: Device) => {
    const pill = await read('/api/world/pulse', who), hunt = await read('/api/civic/pulse?city=lagos', who);
    const neighbours = await read('/api/civic/neighbours?city=lagos', who), rich = await read('/api/civic/richlist?city=lagos', who);
    return [pill.cities.lagos, hunt.counters.online, neighbours.online, rich.counters.online];
  };
  // The page has only just loaded: no socket is open yet, and every surface already counts the one reading.
  assert.deepEqual(await together(ada), [1, 1, 1, 1]);
  await f.joinRoom(ada); await f.joinRoom(bola); await settle();
  assert.deepEqual(await together(ada), [2, 2, 2, 2], 'the chip is not held at an old number by the counter cache');
  f.advance(1000);
  assert.deepEqual(await together(ada), [2, 2, 2, 2]);
});
