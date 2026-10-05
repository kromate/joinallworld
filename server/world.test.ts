import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// OWNER: world — the registry of local governments: plots, the directory, the shard store, and the one-character migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.ts';
import { createServer } from './server.ts';
import { createShardStore } from './world/shards.ts';
import * as registry from './world/registry.ts';
import { currentCity } from './world/service.ts';
import { createLife } from '../src/life.ts';
import { PLOTS_PER_ESTATE, packStyle } from '../src/game/content/world.ts';
import type { Device } from './test-fixture.ts';
import type { AllworldServer } from './server.ts';
import type { LifeState } from '../src/types/index.ts';
import type { CityId } from '../src/types/protocol.ts';
import type { WorldCityLga, WorldHousesResponse, WorldLgaResponse, WorldMeResponse, WorldPerson } from '../src/types/world.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
/** What every JSON answer may carry besides its documented body (an error answer has `error`). */
interface Plain { status: number; error: string; ok: boolean; code: string }
type Reply<T extends object = object> = Plain & T;
/** Union answers of src/types/world.ts, as one body: the short form has no list. */
interface CityBody { v: string; lgas: WorldCityLga[]; unchanged?: true }
interface EstatesBody { v: number; counts: number[]; unchanged?: true }
/** devices.json as read back from disk: only the parts these tests look into are typed. */
type Stored<S extends object = Record<string, unknown>> = { sessions: Record<string, S> } & Record<string, unknown>;
async function readStored<S extends object = Record<string, unknown>>(dir: string): Promise<Stored<S>> {
  const parsed: unknown = JSON.parse(await readFile(join(dir, 'devices.json'), 'utf8'));
  if (!isRecord(parsed) || !isRecord(parsed.sessions)) throw new Error('devices.json is not a database');
  return parsed as Stored<S>;
}
/** A session as devices.json keeps it after a character moved city (SessionRecord, with the lives as plain data). */
interface StoredSession { cities: Record<string, { state: LifeState }>; character: { city: string; from: string }; legacyLives: Record<string, { state: LifeState }> }
interface PeopleBody { items: WorldPerson[]; next: number | null; short?: true }
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
/** The value, or a thrown error naming it (a test that finds nothing fails on the spot). */
function defined<T>(value: T | null | undefined, what = 'value'): T { if (value === null || value === undefined) throw new TypeError(`Expected ${what} to exist`); return value; }
function portOf(server: AllworldServer): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The server is not listening on a port');
  return address.port;
}

const get = async <T extends object = object>(f: Fixture, path: string, who: Device): Promise<Reply<T>> => { const res = await f.request(path, null, who.cookie); return { status: res.status, ...((await res.json()) as Partial<Reply<T>>) } as Reply<T>; };
const life = (f: Fixture, who: Device) => get<{ state: LifeState }>(f, '/api/life?city=lagos', who).then((body) => body.state);
const me = (f: Fixture, who: Device) => get<WorldMeResponse>(f, '/api/world/me?city=lagos', who);
/** What the settle-in card does: choose (or confirm) a local government. The house comes with it. */
const choose = async (f: Fixture, who: Device, lga = 'lagos-mainland') => { const result = await f.action(who.cookie, { type: 'estate.set-lga', payload: { lga } }); assert.equal(result.ok, true, result.reason); return who; };
const shardOptions = { empty: registry.empty, reduce: registry.reduce, snapshot: registry.snapshot, loaded: registry.loaded, live: registry.live };
const names = ['Ada', 'Bola', 'Chidi', 'Dami', 'Emeka', 'Funke', 'Gbenga', 'Halima', 'Ife', 'Jide', 'Kemi', 'Lanre', 'Musa', 'Ngozi', 'Ola', 'Peju', 'Rasheed', 'Sade', 'Tunde', 'Uche', 'Wale', 'Yemi', 'Zainab'];
const fakeName = (i: number) => `${names[i % names.length]} ${names[(i * 7 + 3) % names.length]}${i}`;

// ---- written first: the migration to "one character, current city" must not touch a saved life -------------
test('migration: every session gets a character record with its current city; every saved life, archive and collection is byte-for-byte what it was', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jaw-world-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const now = 5_000_000, expiresAt = now + 86400000;
  const oldLife = (cityId: CityId, extra: { cash?: number } = {}) => { const { estate: _estate, ...state } = createLife({ name: 'Old', cash: 4321, ...extra }, { now: 1000, cityId }); return state; }; // as stored before this build
  const session = (publicId: string, cities: Record<string, unknown>) => ({ secret: randomUUID(), publicId, name: 'Old', expiresAt, cities, actions: {} });
  const sessions = [
    session(randomUUID(), { lagos: { state: oldLife('lagos'), updatedAt: 900, salt: 'a'.repeat(32) } }),
    session(randomUUID(), { lagos: { state: oldLife('lagos'), updatedAt: 900, salt: 'b'.repeat(32) }, ibadan: { state: oldLife('ibadan', { cash: 77 }), updatedAt: 2000, salt: 'c'.repeat(32) } }),
    session(randomUUID(), { ibadan: { state: oldLife('ibadan'), updatedAt: 10, salt: 'd'.repeat(32) } }),
    session(randomUUID(), {}),
  ];
  const before: Stored = { version: 1, sessions: Object.fromEntries(sessions.map((item) => [item.secret, item])), archivedLives: { gone: { publicId: 'gone', name: 'Gone', cities: { lagos: { state: oldLife('lagos'), updatedAt: 1 } }, archivedAt: 5 } },
    social: { players: {}, marker: 'kept' }, civic: { prefs: { [defined(sessions[0]).publicId]: { directory: true } }, cities: {} } };
  await writeFile(join(dir, 'devices.json'), JSON.stringify(before));
  const boot = async (): Promise<Stored> => { const server = await createServer({ dataDir: dir, now: () => now, log: () => {} }); await new Promise<void>((done) => server.close(() => done())); return readStored(dir); };
  const after = await boot();
  assert.deepEqual(Object.values(after.sessions).map((item) => item.character), [{ v: 2, city: 'lagos' }, { v: 2, city: 'ibadan' }, { v: 2, city: 'ibadan' }, { v: 2, city: 'lagos' }]);
  for (const [secret, saved] of Object.entries(before.sessions)) { const { character: _character, ...rest } = defined(after.sessions[secret]); assert.deepEqual(rest, saved, 'the session, its secret and every life are untouched'); }
  for (const key of ['archivedLives', 'social', 'civic']) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(await boot(), after, 'running it again changes nothing');
  assert.equal(currentCity({ secret: '', publicId: '', name: '', expiresAt: 0, cities: {}, actions: {} }), 'lagos');
});

test('every life gets exactly one plot: allocated in order, kept across polls, retries and a restart; concurrent newcomers never share one', async (t) => {
  const f = await fixture(t);
  const players = await Promise.all(Array.from({ length: 40 }, (_, i) => f.device(fakeName(i))));
  const lead = defined(players[0]);
  // Before they choose a local government they have no house and are on nobody's list.
  assert.deepEqual([(await me(f, lead)).plot, (await me(f, lead)).counts], [null, null]);
  assert.equal((await get<CityBody>(f, '/api/world/city?city=lagos', lead)).lgas.every((item) => item.houses === 0 && item.residents === 0), true);
  await Promise.all(players.map((who) => choose(f, who)));
  // All forty arrive at once, each asking twice in parallel.
  const answers = await Promise.all(players.flatMap((who) => [me(f, who), me(f, who)]));
  assert.equal(answers.every((answer) => answer.status === 200 && answer.lga === 'lagos-mainland' && answer.plot), true);
  const plots = players.map((who, i) => { assert.deepEqual(defined(answers[i * 2]).plot, defined(answers[i * 2 + 1]).plot); return defined(defined(answers[i * 2]).plot).plot; });
  assert.deepEqual([...plots].sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i), 'forty distinct plots, the first forty of estate 1');
  await f.server.world.idle();
  for (const who of players.slice(0, 5)) assert.deepEqual((await life(f, who)).estate.plot, (await me(f, who)).plot);
  const city = await get<CityBody>(f, '/api/world/city?city=lagos', lead);
  assert.deepEqual(city.lgas.filter((item) => item.houses).map((item) => [item.id, item.residents, item.houses]), [['lagos-mainland', 40, 40]]);
  assert.equal(Buffer.from(defined(city.lgas.find((item) => item.id === 'lagos-mainland')).occ, 'base64')[0], 40);
  assert.equal((await get<CityBody>(f, `/api/world/city?city=lagos&v=${city.v}`, lead)).unchanged, true);
  // The file holds one resident and one house per player — and no secret, no cookie, no coordinate.
  await f.server.shards.flush();
  const text = await readFile(join(f.dir, 'world', 'lagos.lagos-mainland.log'), 'utf8');
  assert.equal(text.trim().split('\n').filter((line) => line.startsWith('["h"')).length, 40);
  for (const who of players) assert.equal(text.includes(who.cookie.slice(4)), false);
});

test('a restart finds the same plots, and a torn last line of a shard file is ignored', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jaw-world-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let time = 100000;
  const start = async () => { const server = await createServer({ dataDir: dir, now: () => time, log: () => {} }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server; };
  const call = async <T extends object = object>(server: AllworldServer, path: string, cookie?: string | null, body?: unknown): Promise<{ cookie?: string } & T> => { const res = await fetch(`http://127.0.0.1:${portOf(server)}${path}`, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { cookie: res.headers.get('set-cookie')?.split(';')[0], ...((await res.json()) as T) }; };
  const stop = (server: AllworldServer) => { server.closeAllConnections(); return new Promise<void>((done) => server.close(() => done())); };
  let server = await start();
  const ada = await call(server, '/api/session', null, { name: 'Ada' }), bola = await call(server, '/api/session', null, { name: 'Bola' });
  for (const who of [ada, bola]) await call(server, '/api/action', who.cookie, { actionId: `${time}:${randomUUID()}`, cityId: 'lagos', type: 'estate.set-lga', payload: { lga: 'lagos-mainland' } });
  const first = [(await call<WorldMeResponse>(server, '/api/world/me?city=lagos', ada.cookie)).plot, (await call<WorldMeResponse>(server, '/api/world/me?city=lagos', bola.cookie)).plot];
  await stop(server);
  await appendFile(join(dir, 'world', 'lagos.lagos-mainland.log'), '["h",0,7,"half-written');   // a crash in the middle of an append
  server = await start();
  t.after(() => stop(server));
  assert.deepEqual([(await call<WorldMeResponse>(server, '/api/world/me?city=lagos', ada.cookie)).plot, (await call<WorldMeResponse>(server, '/api/world/me?city=lagos', bola.cookie)).plot], first);
  const chidi = await call(server, '/api/session', null, { name: 'Chidi' });
  await call(server, '/api/action', chidi.cookie, { actionId: `${time}:${randomUUID()}`, cityId: 'lagos', type: 'estate.set-lga', payload: { lga: 'lagos-mainland' } });
  assert.equal(defined((await call<WorldMeResponse>(server, '/api/world/me?city=lagos', chidi.cookie)).plot).plot, 2, 'the next newcomer takes the next plot');
  const city = await call<CityBody>(server, '/api/world/city?city=lagos', ada.cookie);
  assert.equal(defined(city.lgas.find((item) => item.id === 'lagos-mainland')).houses, 3);
});

test('changing local government moves the house: a plot there, the old one freed and reused, and the seven-day rule', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chidi] = [await f.device('Ada'), await f.device('Bola'), await f.device('Chidi')];
  await choose(f, ada); await me(f, ada); await choose(f, bola);
  assert.deepEqual([defined((await me(f, ada)).plot).plot, defined((await me(f, bola)).plot).plot], [0, 1]);
  f.advance(8 * 86400000);   // the first choice was free; a change needs the cooldown to have passed
  assert.equal((await f.action(ada.cookie, { type: 'estate.set-lga', payload: { lga: 'ikeja', via: 'device', lat: 6.6, lon: 3.35 } })).ok, true);
  const moved = await me(f, ada);
  assert.deepEqual([moved.lga, moved.plot], ['ikeja', { lga: 'ikeja', estate: 0, plot: 0 }]);
  await f.server.world.idle();
  const state = await life(f, ada);
  assert.deepEqual([state.estate.plot, state.estate.old, state.estate.lgaVia], [{ lga: 'ikeja', estate: 0, plot: 0 }, null, 'device']);
  assert.equal(JSON.stringify(state).includes('3.35'), false, 'coordinates sent along with the id were not kept');
  const city = await get<CityBody>(f, '/api/world/city?city=lagos', ada);
  assert.deepEqual(city.lgas.filter((item) => item.houses).map((item) => [item.id, item.residents, item.houses]), [['ikeja', 1, 1], ['lagos-mainland', 1, 1]]);
  // The freed plot is the growing edge again: the next newcomer gets it.
  await choose(f, chidi);
  assert.equal(defined((await me(f, chidi)).plot).plot, 0);
  const again = await f.action(ada.cookie, { type: 'estate.set-lga', payload: { lga: 'epe' } });
  assert.deepEqual([again.ok, again.code], [false, 'lga_cooldown']);
  assert.equal((await f.action(ada.cookie, { type: 'estate.assign', payload: { lga: 'ikeja', estate: 3, plot: 3 } })).code, 'server_only');
  assert.equal((await get<WorldLgaResponse>(f, '/api/world/lga/atlantis?city=lagos', ada)).status, 404);
  assert.equal((await f.request('/api/world/me?city=lagos')).status, 401);
});

test('a house shows its owner only if they are listed: a hidden player keeps the house, anonymous, and leaves the directory; style and upgrades reach the map', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = [await f.device('Ada Obi'), await f.device('Bola Ade')];
  await choose(f, ada); await me(f, ada); await choose(f, bola); await me(f, bola);
  const socket = await f.socket(bola);
  const houses = () => get<WorldHousesResponse>(f, '/api/world/lga/lagos-mainland/estate/0/houses?city=lagos', ada);
  let page = await houses();
  assert.deepEqual(page.houses.map((house) => [house.p, house.name, house.online, house.you ?? false]), [[0, 'Ada Obi', false, true], [1, 'Bola Ade', true, false]]);
  assert.equal((await get<WorldLgaResponse>(f, '/api/world/lga/lagos-mainland?city=lagos', ada)).online, 1);
  assert.deepEqual((await get<PeopleBody>(f, '/api/world/lga/lagos-mainland/people?city=lagos&online=1', ada)).items.map((item) => item.name), ['Bola Ade']);
  // Bola hides from the directory (the existing preference).
  assert.equal((await (await f.request('/api/civic/prefs', { directory: false }, bola.cookie)).json()).prefs.directory, false);
  await f.server.world.idle();
  page = await houses();
  assert.deepEqual(page.houses[1], { p: 1, s: 0, u: 0 }, 'occupied, no id, no name, no presence');
  assert.deepEqual((await get<PeopleBody>(f, '/api/world/lga/lagos-mainland/people?city=lagos', ada)).items.map((item) => item.name), ['Ada Obi']);
  assert.deepEqual((await get<PeopleBody>(f, '/api/world/lga/lagos-mainland/people?city=lagos&q=bo', ada)).items, []);
  assert.deepEqual((await get<PeopleBody>(f, '/api/world/lga/lagos-mainland/people?city=lagos&online=1', ada)).items, []);
  assert.equal(JSON.stringify(page).includes(bola.id), false);
  assert.deepEqual((await get<PeopleBody>(f, '/api/world/lga/lagos-mainland/people?city=lagos', bola)).items.map((item) => [item.name, item.you]), [['Ada Obi', false], ['Bola Ade', true]], 'you still see yourself');
  assert.equal((await me(f, bola)).hidden, true);
  // Style is one integer per house.
  assert.equal((await f.action(ada.cookie, { type: 'estate.style', payload: { style: { wall: 2, roof: 3 } } })).ok, true);
  await f.server.world.idle();
  assert.equal((await houses()).houses[0]?.s, packStyle({ wall: 2, roof: 3 }, 'starter'));
  assert.deepEqual((await get<PeopleBody>(f, '/api/world/lga/lagos-mainland/people?city=lagos&q=a', ada)).short, true, 'a search needs two characters');
  socket.ws.close();
});

test('bounded at scale: with 6,000 residents no request looks at more than a page, search and paging are index walks, and allocation never scans', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  const world = f.server.world, total = 6000;
  for (let i = 0; i < total; i++) await world.seedResident('lagos', 'ikeja', { id: randomUUID(), name: fakeName(i), day: 20000, hidden: i % 50 === 0, home: 'own', style: i % 4096, until: 0 });
  world.touch('lagos', 'ikeja');
  const steps = async <T>(run: () => Promise<T>) => { const before = registry.metrics.steps; const value = await run(); return { value, steps: registry.metrics.steps - before }; };
  const lga = await get<WorldLgaResponse>(f, '/api/world/lga/ikeja?city=lagos', ada);
  assert.deepEqual([lga.residents, lga.houses, lga.capacity], [total, total, 100352]);
  // Estates: counters only, at most 128 per request.
  const estates = await steps(() => get<EstatesBody>(f, '/api/world/lga/ikeja/estates?city=lagos&from=0&count=128', ada));
  assert.equal(estates.value.counts.length, 128); assert.ok(estates.steps <= 128);
  assert.deepEqual(estates.value.counts.slice(0, 32), [...Array(30).fill(PLOTS_PER_ESTATE), total - 30 * PLOTS_PER_ESTATE, 0]);
  assert.equal((await get<EstatesBody>(f, '/api/world/lga/ikeja/estates?city=lagos&count=500', ada)).status, 400);
  assert.equal((await get<EstatesBody>(f, `/api/world/lga/ikeja/estates?city=lagos&v=${estates.value.v}`, ada)).unchanged, true);
  // Houses of one estate: two pages of 98, never the estate next door.
  const page = await steps(() => get<WorldHousesResponse>(f, '/api/world/lga/ikeja/estate/3/houses?city=lagos&page=1', ada));
  assert.deepEqual([page.value.houses.length, page.value.pages, defined(page.value.houses[0]).p], [98, 2, 98]); assert.ok(page.steps <= 98 + 98);
  // The directory: 25 a page, every listed resident exactly once, in name order, and each page a bounded walk.
  const seen = [];
  let after = '', pages = 0, worst = 0;
  for (;;) {
    const result = await steps(() => get<PeopleBody>(f, `/api/world/lga/ikeja/people?city=lagos${after}`, ada));
    worst = Math.max(worst, result.steps); pages += 1;
    if (pages % 100 === 0) f.advance(61000);   // the per-player rate limit (120 pages a minute) is real
    assert.ok(result.value.items.length <= 25);
    seen.push(...result.value.items.map((item) => item.id));
    if (result.value.next === null) break;
    after = `&after=${result.value.next}`;
  }
  assert.equal(seen.length, total - total / 50); assert.equal(new Set(seen).size, seen.length);
  assert.ok(worst <= 200 + 40, `a page walked ${worst} index entries`);
  const search = await steps(() => get<PeopleBody>(f, '/api/world/lga/ikeja/people?city=lagos&q=kemi%20e', ada));
  assert.ok(search.value.items.length > 0 && search.value.items.every((item) => /^Kemi E/.test(item.name))); assert.ok(search.steps <= 200 + 40);
  // A newcomer: one allocation, a handful of steps, the next plot at the growing edge.
  const placed = await steps(async () => { await f.action(ada.cookie, { type: 'estate.set-lga', payload: { lga: 'ikeja' } }); return me(f, ada); });
  assert.deepEqual(placed.value.plot, { lga: 'ikeja', estate: 30, plot: total - 30 * PLOTS_PER_ESTATE });
  assert.ok(placed.steps <= 120, `allocating took ${placed.steps} steps`);
  // The world routes read: nothing of all this went through the main data file.
  const stats = world.stats();
  assert.equal(defined(stats.shards).loads <= 3, true);
});

test('the shard store: a failed append has no effect and the same change then applies once; compaction keeps the state; only the open shards are in memory', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jaw-shards-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let fail = false;
  const logs = [];
  const store = await createShardStore(dir, { ...shardOptions, maxOpen: 2, compactSlack: 10, log: (line) => logs.push(line), io: { appendFile: async (...args) => { if (fail) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); return appendFile(...args); } } });
  const join1 = (id: string, name: string) => store.transact('lagos.ikeja', (state) => { const placed = registry.settleIn(state, { id, name, day: 1, hidden: false, home: 'own', style: 0, until: 0 }); return { records: placed.records, result: placed.plot }; });
  assert.deepEqual(await join1('a', 'Ada'), { estate: 0, plot: 0 });
  fail = true;
  await assert.rejects(Promise.all([join1('b', 'Bola'), join1('c', 'Chidi')]), { code: 'storage_unavailable', status: 503 });
  assert.equal(logs.length, 1);
  assert.deepEqual(await store.read('lagos.ikeja', (state) => [state.residents.size, state.houseCount]), [1, 1], 'memory is what the file holds');
  fail = false;
  assert.deepEqual(await join1('b', 'Bola'), { estate: 0, plot: 1 });
  assert.deepEqual(await join1('b', 'Bola'), { estate: 0, plot: 1 }, 'again: the same plot and no new record');
  // Churn: the same resident renamed many times is one record after compaction.
  for (let i = 0; i < 40; i++) await store.transact('lagos.ikeja', (state) => ({ records: registry.settleIn(state, { id: 'a', name: `Ada ${i}`, day: 1, hidden: false, home: 'own', style: i, until: 0 }).records, result: undefined }));
  await store.flush();
  await new Promise((done) => setTimeout(done, 20)); await store.flush();
  assert.ok(store.stats().compactions >= 1);
  const lines = (await readFile(join(dir, 'lagos.ikeja.log'), 'utf8')).trim().split('\n');
  assert.ok(lines.length <= 30, `${lines.length} lines after compaction`);
  const reopened = await createShardStore(dir, shardOptions);
  assert.deepEqual(await reopened.read('lagos.ikeja', (state) => [defined(state.residents.get('a')).n, state.residents.size, state.houseCount, registry.plotOf(state, 'b')]), ['Ada 39', 2, 2, { estate: 0, plot: 1 }]);
  // Lazily opened, and at most `maxOpen` kept.
  for (const name of ['lagos.agege', 'lagos.epe', 'lagos.ojo']) await store.read(name, () => null);
  assert.ok(store.open().length <= 2); assert.ok(store.stats().evictions >= 1);
  await assert.rejects(store.read('../etc/passwd', () => null), /Invalid shard name/);
  // A file damaged in the middle is refused rather than half-read.
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'lagos.badagry.log'), '["v",1]\nnot json\n["r","x","X",1,0,"own"]\n');
  await assert.rejects(store.read('lagos.badagry', () => null), /Corrupt world shard/);
});

test('a write outage: nobody is told about a plot that is not saved, and the next poll finishes the job exactly once', async (t) => {
  let fail = false;
  const f = await fixture(t, { log: () => {}, shardIo: { appendFile: async (...args) => { if (fail) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); return appendFile(...args); } } });
  const ada = await f.device('Ada');
  fail = true;
  await choose(f, ada);   // the choice itself is saved (the main store is fine); the shard cannot take the house
  await f.server.world.idle();
  assert.equal((await me(f, ada)).plot, null);
  assert.equal((await life(f, ada)).estate.plot, null);
  fail = false;
  f.advance(1000);
  await life(f, ada); await f.server.world.idle();
  assert.deepEqual((await me(f, ada)).plot, { lga: 'lagos-mainland', estate: 0, plot: 0 });
  await f.server.shards.flush();
  assert.equal((await readFile(join(f.dir, 'world', 'lagos.lagos-mainland.log'), 'utf8')).trim().split('\n').filter((line) => line.startsWith('["h"')).length, 1);
});

test('one character: a life that arrives in another city is filed under it, a separate life already there is put aside whole, and the city left cannot be re-entered as a new life', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  await life(f, ada);
  const ibadan = createLife({ name: 'Ada' }, { now: f.now(), cityId: 'ibadan' });
  await f.server.store.transact((db) => {
    const session = defined(Object.values(db.sessions).find((item) => item.publicId === ada.id));
    session.cities.ibadan = { state: ibadan, updatedAt: f.now(), salt: 'c'.repeat(32) };
  }); // pre-migration sessions could contain a separate Ibadan life
  await f.server.world.idle();
  // Stand in for the arrival of an inter-city trip (no city is open, so no request can produce one).
  await f.server.store.transact((db) => { const lagos = defined(defined(Object.values(db.sessions)[0]).cities.lagos); lagos.state.estate.city = 'ibadan'; lagos.state.cash = 4242; });
  await f.server.world.sync(ada.id, 'lagos'); await f.server.world.idle();
  const stored = defined((await readStored<StoredSession>(f.dir)).sessions[ada.cookie.slice(4)]);
  assert.deepEqual(Object.keys(stored.cities), ['ibadan']); assert.equal(defined(stored.cities.ibadan).state.cash, 4242);
  assert.deepEqual([stored.character.city, stored.character.from], ['ibadan', 'lagos']);
  assert.deepEqual(Object.values(stored.legacyLives).map((entry) => entry.state.t), [ibadan.t], 'the old Ibadan life is kept, not overwritten');
  const gone = await get(f, '/api/life?city=lagos', ada);
  assert.deepEqual([gone.status, gone.error], [409, 'city_moved']);
  assert.equal((await get<{ state: LifeState }>(f, '/api/life?city=ibadan', ada)).state.cash, 4242);
});
