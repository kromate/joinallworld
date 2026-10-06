#!/usr/bin/env node
/**
 * What a social request costs as the number of REGISTERED players grows (docs/STORAGE.md, "Measured").
 *
 *   node --experimental-strip-types scripts/store-bench.ts --host node|worker --layout legacy|entries --registered 1000,3000,10000 [--active 200] [--seconds 30]
 *
 * For each size: a store holding that many registered players is made (the synthetic legacy store of server/testing/legacySeed.ts:
 * friends, conversations, groups, pending gifts, referrals, shops, residents), the host is started on it with the layout asked
 * for, `--active` real players are made through the routes (each with friends and a conversation), and for `--seconds` each of them
 * reads the phone, opens a thread, lists the people here, polls the civic pulse and sends messages. Measured: latency by kind,
 * the host process's CPU per request and memory, the rows written (Worker) by table, and the start-up cost (the first request,
 * which on `entries` includes the move of the legacy store when the layout asks for it).
 * One host at a time, loopback, one machine: it compares layouts and sizes, it is not a promise about production.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { legacySeed } from '../server/testing/legacySeed.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2), option = (name: string, fallback: string): string => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
const host = option('host', 'node') as 'node' | 'worker', layout = option('layout', 'legacy'), sizes = option('registered', '1000').split(',').map(Number);
const active = Number(option('active', '200')), seconds = Number(option('seconds', '30')), port = Number(option('port', '4187')), profileName = option('profile', 'typical') === 'heavy' ? 'heavy' : 'typical';
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const quantile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
const round = (value: number): number => Math.round(value * 10) / 10;

function usageOf(pid: number): { rssMb: number; cpuSeconds: number } {
  try {
    const [rss = '0', time = '0'] = execFileSync('ps', ['-o', 'rss=,time=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
    return { rssMb: Number(rss) / 1024, cpuSeconds: time.split(/[:-]/).map(Number).reduce((total, part) => total * 60 + part, 0) };
  } catch { return { rssMb: NaN, cpuSeconds: NaN }; }
}
function childrenOf(pid: number): { pid: number; command: string }[] {
  try { return execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).split('\n').map((line) => line.trim().split(/\s+/)).filter((fields) => Number(fields[1]) === pid).map((fields) => ({ pid: Number(fields[0]), command: fields.slice(2).join(' ') })); } catch { return []; }
}

interface Running { base: string; pid: number; stop(): Promise<void> }
const token = `bench-${randomUUID()}`;
const CHUNK = 400000;

async function startNode(dir: string, collections: Record<string, unknown>): Promise<Running> {
  await writeFile(join(dir, 'devices.json'), JSON.stringify({ version: 1, sessions: {}, ...collections }));
  const child: ChildProcess = spawn(process.execPath, [join(root, 'server/server.ts')], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PORT: String(port), DATA_DIR: dir, TRUST_PROXY: '1', MODERATOR_TOKEN: token, STORE_LAYOUT: layout } });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { await sleep(100); } }
  return { base, pid: child.pid ?? 0, stop: async () => { child.kill('SIGTERM'); await new Promise<void>((done) => { child.once('exit', () => done()); setTimeout(done, 20000); }); } };
}

interface Storage { exec(query: string, ...bindings: (string | number | null)[]): Promise<unknown> }
interface Mini { ready: Promise<URL>; dispose(): Promise<void>; unsafeGetDurableObjectStorage(script: string, className: string, id: { name: string }): Promise<Storage> }
async function startWorker(dir: string, collections: Record<string, unknown>): Promise<Running> {
  const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || join(root, 'deploy/tooling'), 'package.json'));
  const miniflare = require('miniflare') as { Miniflare: new (options: Record<string, unknown>) => Mini; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> };
  const esbuild = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> };
  const bundle = join(dir, 'worker.mjs');
  await esbuild.build({ entryPoints: [join(root, 'deploy/cloudflare-worker.ts')], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], logLevel: 'error' });
  const script = await readFile(bundle, 'utf8');
  const make = (bindings: Record<string, string>): Mini => new miniflare.Miniflare({ ...miniflare.convertV4MiniflareOptions({ name: 'allworld-bench', script, modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(dir, 'storage'), bindings: { BUILD_ID: 'bench', MODERATOR_TOKEN: token, ...bindings }, serviceBindings: { ASSETS: () => new Response('asset') } }),
    resourcePersistencePath: join(dir, 'storage'), host: '127.0.0.1', port, unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} });
  // First start: the object makes its tables; the legacy rows are written into them; then it starts again on that storage.
  let mf = make({});
  const url = await mf.ready;
  await fetch(`http://127.0.0.1:${url.port}/api/health`).then((r) => r.arrayBuffer()).catch(() => undefined);
  await (await fetch(`http://127.0.0.1:${url.port}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${url.port}` }, body: JSON.stringify({ name: 'Warm' }) })).arrayBuffer();
  const storage = await mf.unsafeGetDurableObjectStorage('allworld-bench', 'JoinAllworldState', { name: 'joinallworld-v1' });
  for (const [name, value] of Object.entries(collections)) {
    const text = JSON.stringify(value);
    if (text.length <= CHUNK) { await storage.exec('INSERT OR REPLACE INTO collections(name,value) VALUES(?,?)', name, text); continue; }
    let parts = 0;
    for (let at = 0; at < text.length; at += CHUNK) { await storage.exec('INSERT OR REPLACE INTO collection_parts(name,part,value) VALUES(?,?,?)', name, parts, text.slice(at, at + CHUNK)); parts += 1; }
    await storage.exec('INSERT OR REPLACE INTO collections(name,value) VALUES(?,?)', name, `{"$parts":${parts}}`);
  }
  await mf.dispose();
  mf = make({ STORE_LAYOUT: layout });
  const ready = await mf.ready;
  const runtime = childrenOf(process.pid).find((child) => child.command.includes('workerd'));
  return { base: `http://127.0.0.1:${ready.port}`, pid: runtime?.pid ?? 0, stop: () => mf.dispose() };
}

interface Player { index: number; cookie: string; id: string; friends: string[]; convs: string[] }
const address = (index: number): string => `44.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;

async function bench(registered: number): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'allworld-bench-'));
  await mkdir(dir, { recursive: true });
  const seeded = legacySeed({ players: Math.max(1, registered - active), profile: profileName });
  let running: Running | null = null;
  try {
    const began = performance.now();
    running = host === 'node' ? await startNode(dir, seeded.collections as unknown as Record<string, unknown>) : await startWorker(dir, seeded.collections as unknown as Record<string, unknown>);
    const base = running.base;
    const latency: Record<string, number[]> = {}, errors: Record<string, number> = {};
    let measuring = false, requests = 0;
    const call = async (kind: string, player: Player | null, path: string, body?: object): Promise<{ status: number; json: Record<string, unknown> } | null> => {
      const started = performance.now(); requests += measuring ? 1 : 0;
      try {
        const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { origin: base, ...(body ? { 'content-type': 'application/json' } : {}), ...(player ? { 'x-forwarded-for': address(player.index), 'cf-connecting-ip': address(player.index), cookie: player.cookie } : { 'x-forwarded-for': '45.0.0.2', 'cf-connecting-ip': '45.0.0.2' }) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
        const json = await response.json() as Record<string, unknown>;
        if (measuring) (latency[kind] ??= []).push(performance.now() - started);
        if (response.status !== 200) errors[`${kind} ${response.status} ${String(json['error'] ?? '')}`] = (errors[`${kind} ${response.status} ${String(json['error'] ?? '')}`] ?? 0) + 1;
        return { status: response.status, json };
      } catch (error) { errors[`${kind} ${error instanceof Error ? error.name : 'failed'}`] = (errors[`${kind} ${error instanceof Error ? error.name : 'failed'}`] ?? 0) + 1; return null; }
    };
    const operator = async (path: string): Promise<Record<string, unknown>> => { try { return await (await fetch(base + path, { headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': '45.0.0.1', 'x-forwarded-for': '45.0.0.1' } })).json() as Record<string, unknown>; } catch { return {}; } };

    // The first request: the object starts on the store, and (layout entries) moves it.
    const first = performance.now();
    const warm: Player = { index: 90000, cookie: '', id: '', friends: [], convs: [] };
    const made = await fetch(base + '/api/session', { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-forwarded-for': address(warm.index), 'cf-connecting-ip': address(warm.index) }, body: JSON.stringify({ name: 'Warm' }) });
    warm.cookie = made.headers.get('set-cookie')?.split(';')[0] ?? '';
    const firstMs = performance.now() - first;
    const startMs = performance.now() - began;

    const players: Player[] = [];
    for (let i = 0; i < active; i++) players.push({ index: 100 + i, cookie: '', id: '', friends: [], convs: [] });
    for (let at = 0; at < players.length; at += 8) await Promise.all(players.slice(at, at + 8).map(async (player) => {
      const response = await fetch(base + '/api/session', { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-forwarded-for': address(player.index), 'cf-connecting-ip': address(player.index) }, body: JSON.stringify({ name: `Active ${player.index}` }) });
      player.cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
      player.id = ((await response.json()) as { session?: { id?: string } }).session?.id ?? '';
      await call('setup', player, '/api/life?city=lagos'); await call('setup', player, '/api/social/me');
    }));
    for (let i = 0; i < players.length; i++) for (const back of [1, 2, 3]) {
      const player = players[i] as Player, other = players[(i + back * 7) % players.length] as Player;
      if (other === player || player.friends.includes(other.id)) continue;
      const asked = await call('setup', player, '/api/social/friends/request', { to: other.id, cityId: 'lagos' });
      if (asked?.json['ok'] === true) { const answered = await call('setup', other, '/api/social/friends/answer', { from: player.id, accept: true, cityId: 'lagos' }); if (answered?.json['ok'] === true) { player.friends.push(other.id); other.friends.push(player.id); } }
    }
    for (const player of players) { const friend = player.friends[0]; if (!friend) continue; const sent = await call('setup', player, '/api/social/messages', { to: friend, body: 'first line', clientId: `${Date.now()}:${randomUUID()}` }); const conv = (sent?.json['conv'] as { id?: string } | undefined)?.id; if (conv) player.convs.push(conv); }

    const rowsOf = (view: Record<string, unknown>): { total: number; tables: Record<string, number> } => { const rows = (view['store'] as { rows?: { total?: number; tables?: Record<string, number> } } | null | undefined)?.rows; return { total: rows?.total ?? 0, tables: rows?.tables ?? {} }; };
    const before = { usage: usageOf(running.pid), overview: await operator('/api/mod/overview'), at: performance.now() };
    measuring = true;
    const until = performance.now() + seconds * 1000, jitter = (ms: number): number => ms * (0.6 + Math.random() * 0.8);
    const every = async (ms: number, work: () => Promise<unknown>): Promise<void> => { await sleep(Math.random() * ms); while (performance.now() < until) { await work(); await sleep(Math.min(jitter(ms), Math.max(0, until - performance.now()))); } };
    await Promise.all(players.flatMap((player) => [
      every(4000, () => call('overview (me)', player, '/api/social/me')),
      every(5000, () => player.convs[0] ? call('open thread', player, `/api/social/conversations/${encodeURIComponent(player.convs[0])}`) : Promise.resolve()),
      every(6000, () => player.friends[0] ? call('send message', player, '/api/social/messages', { to: player.friends[0], body: `hello ${Math.floor(Math.random() * 1e6)}`, clientId: `${Date.now()}:${randomUUID()}` }) : Promise.resolve()),
      every(5000, () => call('people list', player, '/api/social/people?city=lagos')),
      every(10000, () => call('civic pulse', player, '/api/civic/pulse?city=lagos')),
      every(7000, () => call('search', player, '/api/social/search?q=ola')),
    ]));
    measuring = false;
    const elapsed = (performance.now() - before.at) / 1000, usage = usageOf(running.pid), after = await operator('/api/mod/overview');
    const cpu = usage.cpuSeconds - before.usage.cpuSeconds, rowsBefore = rowsOf(before.overview), rowsAfter = rowsOf(after);
    const summary = (kind: string): string => { const sorted = [...(latency[kind] ?? [])].sort((a, b) => a - b); return sorted.length ? `${round(quantile(sorted, 0.5))}/${round(quantile(sorted, 0.95))}/${round(quantile(sorted, 0.99))}` : '-'; };
    const byTable = Object.entries(rowsAfter.tables).map(([table, rows]) => [table, rows - (rowsBefore.tables[table] ?? 0)] as const).filter(([, rows]) => rows > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const stats = (after['store'] as Record<string, unknown> | null) ?? {};
    console.log(JSON.stringify({ host, layout, profile: profileName, registered, active, seconds: Math.round(elapsed), startMs: Math.round(startMs), firstRequestMs: Math.round(firstMs), requests, perSecond: round(requests / elapsed),
      cpuMsPerRequest: requests ? round(cpu * 1000 / requests) : null, cpuShare: round(cpu / elapsed), rssMb: Math.round(usage.rssMb),
      'p50/p95/p99 ms': Object.fromEntries(['overview (me)', 'open thread', 'send message', 'people list', 'civic pulse', 'search'].map((kind) => [kind, summary(kind)])),
      rowsWritten: rowsAfter.total - rowsBefore.total, rowsPerMessage: round((rowsAfter.total - rowsBefore.total) / Math.max(1, latency['send message']?.length ?? 1)), rowsByTable: Object.fromEntries(byTable),
      collectionsKB: Object.fromEntries(Object.entries((stats['collections'] as Record<string, number> | undefined) ?? {}).map(([name, chars]) => [name, Math.round(chars / 1024)])), errors }));
  } finally {
    await running?.stop().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
if (!existsSync(join(root, 'server/server.ts'))) throw new Error('Run this from the repository');
for (const size of sizes) await bench(size);
