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

test('a signed-in device is required, and the answer is the documented shape', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/world/pulse')).status, 401);
  const ada = await f.device('Ada');
  const body = await pulse(f, ada);
  assert.deepEqual(Object.keys(body).sort(), ['cities', 'online', 'serverTime', 'visits']);
  assert.equal(body.online, 0);
});

test('online counts distinct players: two sockets of one player are one, a guest counts, a drop leaves', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  const a1 = await f.joinRoom(ada), a2 = await f.joinRoom(ada);
  assert.equal((await pulse(f, ada)).online, 1);
  const guest = await f.request('/api/session', { name: 'Guest', onboarding: true });
  const cookie = (guest.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const g = await f.socket({ cookie });
  const b = await f.joinRoom(bola);
  const both = await pulse(f, ada);
  assert.equal(both.online, 3, 'Ada once, the guest, Bola');
  assert.equal(both.cities['lagos'], 2, 'only the two in a room are in the city');
  await closed(a1);
  assert.equal((await pulse(f, ada)).online, 3, 'Ada still has a socket');
  await closed(a2); await closed(b);
  assert.equal((await pulse(f, bola)).online, 1, 'only the guest is left');
  await closed(g);
  assert.equal((await pulse(f, bola)).online, 0);
});

test('only live sockets are online: polling the pulse is a visit, not presence, and characters of the game never connect', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  const polled = await pulse(f, ada);
  assert.equal(polled.online, 0, 'a request without a socket is not online');
  assert.equal(polled.visits, 1);
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
