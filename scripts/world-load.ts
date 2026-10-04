/**
 * OWNER: world
 * Local load test of the world layer at city scale.
 *
 *   node scripts/world-load.ts [--residents 100000] [--players 200] [--seconds 8]
 *
 * METHOD
 *   A fresh in-process server on a temporary data directory, real clock, real HTTP over loopback.
 *   1. ONE local government (Ikeja) is filled with `--residents` real registry records through the
 *      same code a live allocation uses (settleIn → the shard's append-only file). 2% are hidden.
 *      1% are marked online in the presence set.
 *   2. The other 19 are given a SUMMARY only (counts and houses-per-estate) that adds up to a
 *      2,000,000-resident city, so the city endpoint answers what it would answer then. Their
 *      shard files are not written: this is one machine with a nearly full disk.
 *   3. `--players` real device sessions are created, each chooses Ikeja (a real allocation at the
 *      growing edge of a 100,000-house registry), then for `--seconds` each loops over what the map
 *      and the directory ask for: the city summary, a window of estates, one estate's houses, a
 *      directory page, the next page, a name search, who is online, and its own place.
 *   Measured: latency per route (request sent → JSON parsed), the registry's own loop-step counter
 *   per request (the bound a test asserts; taken in a second pass, one request at a time), shard reads/appends/bytes, the main store's writes, the
 *   shard file's size before and after compaction, a cold load of that shard, and process memory.
 *   Everything written is deleted at the end.
 *
 * WHAT IT DOES NOT SHOW
 *   One process serves and generates the load on one laptop over loopback, for seconds. No real
 *   network, no slow disk, no multi-day churn, and only one of the twenty shards is real. The
 *   numbers are for comparing designs and catching scans, not a capacity promise.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server/server.ts';
import { lagosTime } from '../src/game/clock.ts';
import { createShardStore } from '../server/world/shards.ts';
import * as registry from '../server/world/registry.ts';
import { ESTATE, LAGOS_LGAS, PLOTS_PER_ESTATE } from '../src/game/content/world.ts';

/** The session cookie a response set; a missing one is a failed setup, not an empty cookie. */
const cookieOf = (headers: { get(name: string): string | null }): string => {
  const cookie = headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('the session response set no cookie');
  return cookie;
};

/** What this script uses of the server's world layer, shard store and main store (server/ is still untyped JavaScript). */
interface ShardStats { loads: number; appends: number; records: number; bytes: number; open: number }
interface ResidentSeed { id: string; name: string; day: number; hidden: boolean; home: string; style: number; until: number }
interface WorldServer extends Server {
  world: {
    seedResident(city: string, lga: string, resident: ResidentSeed): Promise<unknown>;
    seedOnline(city: string, lga: string, ids: string[]): void;
    seedSummary(city: string, lga: string, summary: { residents: number; houses: number; occ: Uint8Array }): void;
    touch(city: string, lga: string): void;
    idle(): Promise<void>;
  };
  shards: { flush(): Promise<void>; size(name: string): Promise<number>; stats(): ShardStats; compact(name: string): Promise<number> };
  store: { stats(): { writes: number } };
}
type RegistryState = Parameters<typeof registry.counts>[0];
interface ColdShards { read<T>(name: string, use: (state: RegistryState) => T): Promise<T> }
/** The fields of a reply this script reads. */
interface Reply { ok?: boolean; v?: string; next?: string | null }
type Headers = Record<string, string>;

const arg = (name: string, fallback: number) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? Number(process.argv[at + 1]) : fallback; };
const RESIDENTS = arg('residents', 100000), PLAYERS = arg('players', 200), SECONDS = arg('seconds', 8), CITY_TOTAL = 2_000_000;
const FIRST = ['Ada', 'Bola', 'Chidi', 'Dami', 'Emeka', 'Funke', 'Gbenga', 'Halima', 'Ife', 'Jide', 'Kemi', 'Lanre', 'Musa', 'Ngozi', 'Ola', 'Peju', 'Rasheed', 'Sade', 'Tunde', 'Uche', 'Wale', 'Yemi', 'Zainab'];
const pct = (list: number[], p: number) => (list.length ? (list[Math.min(list.length - 1, Math.floor(list.length * p))] ?? 0) : 0);
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

const dataDir = await mkdtemp(join(tmpdir(), 'jaw-world-load-'));
try {
  const server = await createServer({ dataDir, distDir: join(dataDir, 'no-dist'), trustProxy: true, log: () => {} }) as unknown as WorldServer;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, world = server.world;
  const call = async (path: string, headers?: Headers, body?: unknown): Promise<{ res: Response; body: Reply }> => { const res = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); return { res, body: await res.json() as Reply }; };

  // 1. one real local government
  let t = performance.now();
  const online: string[] = [], today = lagosTime(Date.now()).day;   // seen today: the 45-day housekeeping sweep leaves them alone
  for (let i = 0; i < RESIDENTS; i++) {
    const id = randomUUID();
    const pending = world.seedResident('lagos', 'ikeja', { id, name: `${FIRST[i % FIRST.length]} ${FIRST[(i * 7 + 3) % FIRST.length]} ${i}`, day: today, hidden: i % 50 === 0, home: 'own', style: (i * 2654435761 >>> 0) % 2097152, until: 0 });
    if (i % 100 === 0) online.push(id);
    if (i % 2000 === 1999) await pending;   // group commit: 2,000 allocations per append
  }
  await server.shards.flush();
  world.touch('lagos', 'ikeja'); world.seedOnline('lagos', 'ikeja', online);
  const seedMs = performance.now() - t, fileBytes = await server.shards.size('lagos.ikeja');
  // 2. the rest of a two-million city, as summaries
  const others = LAGOS_LGAS.filter((lga) => lga.id !== 'ikeja'), each = Math.min(ESTATE.estates * PLOTS_PER_ESTATE, Math.floor((CITY_TOTAL - RESIDENTS) / others.length));
  for (const lga of others) { const occ = new Uint8Array(ESTATE.estates); for (let i = 0, left = each; i < ESTATE.estates && left > 0; i++) { occ[i] = Math.min(PLOTS_PER_ESTATE, left); left -= occ[i] ?? 0; } world.seedSummary('lagos', lga.id, { residents: each, houses: each, occ }); }

  // 3. real players
  const people: Headers[] = [];
  for (let i = 0; i < PLAYERS; i++) {
    const address = `10.9.${Math.floor(i / 250)}.${(i % 250) + 1}`;
    const { res } = await call('/api/session', { 'X-Forwarded-For': address }, { name: `Load ${i + 1}` });
    people.push({ Cookie: cookieOf(res.headers), 'X-Forwarded-For': address });
  }
  const lat: Record<string, number[]> = {}, steps: Record<string, number> = {}, errors: Record<string, number> = {};
  let exact = false;   // steps are only attributable to one request while requests do not overlap (the pass after the run)
  const timed = async (name: string, path: string, headers?: Headers, body?: unknown): Promise<Reply> => {
    const before = registry.metrics.steps, start = performance.now();
    const { res, body: json } = await call(path, headers, body);
    (lat[name] ||= []).push(performance.now() - start);
    if (exact) steps[name] = Math.max(steps[name] || 0, registry.metrics.steps - before);
    if (!res.ok || json.ok === false) errors[name] = (errors[name] || 0) + 1;
    return json;
  };
  const statsBefore = { shards: server.shards.stats(), store: server.store.stats() };
  t = performance.now();
  await Promise.all(people.map(async (headers, i) => {
    await timed('choose LGA (allocates a house)', '/api/action', headers, { actionId: `${Date.now()}:${randomUUID()}`, cityId: 'lagos', type: 'estate.set-lga', payload: { lga: 'ikeja', via: 'manual' } });
    await timed('me', '/api/world/me?city=lagos', headers);
    let version = '', next: string | null = null;
    while (performance.now() - t < SECONDS * 1000) {
      const city = await timed('city summary', `/api/world/city?city=lagos${version ? `&v=${version}` : ''}`, headers); version = city.v || version;
      await timed('estates window (128)', `/api/world/lga/ikeja/estates?city=lagos&from=${(i * 37) % 384}&count=128`, headers);
      await timed('houses of one estate (page)', `/api/world/lga/ikeja/estate/${(i * 13) % 500}/houses?city=lagos&page=${i % 2}`, headers);
      const page = await timed('directory page', `/api/world/lga/ikeja/people?city=lagos${next ? `&after=${next}` : ''}`, headers); next = page.next ?? null;
      await timed('name search', `/api/world/lga/ikeja/people?city=lagos&q=${(FIRST[i % FIRST.length] ?? '').slice(0, 3)}`, headers);
      await timed('online now', '/api/world/lga/ikeja/people?city=lagos&online=1', headers);
      await new Promise((done) => setTimeout(done, 400 + Math.random() * 300));
    }
  }));
  const seconds = (performance.now() - t) / 1000;
  await world.idle(); await server.shards.flush();
  // One request at a time, so the registry's step counter belongs to exactly one request.
  exact = true;
  for (let i = 0; i < 40; i++) {
    const headers = people[i % people.length];
    await timed('city summary', '/api/world/city?city=lagos', headers);
    await timed('estates window (128)', `/api/world/lga/ikeja/estates?city=lagos&from=${(i * 37) % 384}&count=128`, headers);
    await timed('houses of one estate (page)', `/api/world/lga/ikeja/estate/${(i * 13) % 500}/houses?city=lagos&page=${i % 2}`, headers);
    await timed('directory page', `/api/world/lga/ikeja/people?city=lagos&after=${i * 2500}`, headers);
    await timed('name search', `/api/world/lga/ikeja/people?city=lagos&q=${(FIRST[i % FIRST.length] ?? '').slice(0, 3)}`, headers);
    await timed('online now', '/api/world/lga/ikeja/people?city=lagos&online=1', headers);
    await timed('me', '/api/world/me?city=lagos', headers);
  }
  { // A newcomer on a quiet server: what one allocation walks.
    const { res } = await call('/api/session', { 'X-Forwarded-For': '10.99.0.1' }, { name: 'Late' });
    await timed('choose LGA (allocates a house)', '/api/action', { Cookie: cookieOf(res.headers), 'X-Forwarded-For': '10.99.0.1' }, { actionId: `${Date.now()}:${randomUUID()}`, cityId: 'lagos', type: 'estate.set-lga', payload: { lga: 'ikeja', via: 'manual' } });
    await world.idle();
  }
  const after = { shards: server.shards.stats(), store: server.store.stats() };
  const rss = process.memoryUsage().rss;
  t = performance.now();
  const compactBytes = await server.shards.compact('lagos.ikeja');
  const compactMs = performance.now() - t;
  // A cold load of the same shard, as after a restart.
  t = performance.now();
  const cold = (await createShardStore(join(dataDir, 'world'), { empty: registry.empty, reduce: registry.reduce, snapshot: registry.snapshot, loaded: registry.loaded, live: registry.live } as Parameters<typeof createShardStore>[1])) as unknown as ColdShards;
  const counts = await cold.read('lagos.ikeja', (state) => registry.counts(state));
  const coldMs = performance.now() - t;
  const cityBytes = JSON.stringify((await call('/api/world/city?city=lagos', people[0])).body).length;

  const total = Object.values(lat).reduce((sum, list) => sum + list.length, 0);
  console.log(`World load: ${RESIDENTS.toLocaleString()} residents in one local government (city summary for ${CITY_TOTAL.toLocaleString()}), ${PLAYERS} players, ${seconds.toFixed(1)} s, ${total} requests (${Math.round(total / seconds)}/s)`);
  console.log(`\n  ${'route'.padEnd(34)}${'n'.padStart(6)}${'p50 ms'.padStart(9)}${'p95 ms'.padStart(9)}${'p99 ms'.padStart(9)}${'max ms'.padStart(9)}${'steps*'.padStart(12)}${'errors'.padStart(8)}`);
  for (const [name, list] of Object.entries(lat)) { list.sort((a, b) => a - b); console.log(`  ${name.padEnd(34)}${String(list.length).padStart(6)}${pct(list, 0.5).toFixed(1).padStart(9)}${pct(list, 0.95).toFixed(1).padStart(9)}${pct(list, 0.99).toFixed(1).padStart(9)}${(list[list.length - 1] ?? NaN).toFixed(1).padStart(9)}${String(steps[name]).padStart(12)}${String(errors[name] || 0).padStart(8)}`); }
  console.log('  * the most registry loop steps one request took, measured one request at a time after the run. A scan of residents would be 100,000+.');
  console.log(`\n  seeding ${RESIDENTS.toLocaleString()} residents: ${(seedMs / 1000).toFixed(1)} s (${Math.round(RESIDENTS / (seedMs / 1000)).toLocaleString()} allocations/s)`);
  console.log(`  shard file lagos.ikeja: ${mb(fileBytes)} after seeding (${Math.round(fileBytes / RESIDENTS)} bytes per resident with a house), ${mb(compactBytes)} after compaction (${Math.round(compactMs)} ms)`);
  console.log(`  cold load of that shard (restart): ${Math.round(coldMs)} ms for ${counts.residents.toLocaleString()} residents, ${counts.houses.toLocaleString()} houses`);
  console.log(`  during the run — shard loads: ${after.shards.loads - statsBefore.shards.loads}, appends: ${after.shards.appends - statsBefore.shards.appends} (${after.shards.records - statsBefore.shards.records} records, ${((after.shards.bytes - statsBefore.shards.bytes) / 1024).toFixed(1)} KB), main-store writes: ${after.store.writes - statsBefore.store.writes}`);
  console.log(`  city summary response: ${(cityBytes / 1024).toFixed(1)} KB for 20 local governments; unchanged poll: ~0.5 KB`);
  console.log(`  process memory (server + load generator): ${mb(rss)} rss; shards open: ${after.shards.open}`);
  await new Promise((done) => { server.closeAllConnections?.(); server.close(done); });
} finally { await rm(dataDir, { recursive: true, force: true }); }
