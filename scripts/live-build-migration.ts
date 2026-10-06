#!/usr/bin/env node
/**
 * Move data written by the LIVE build to the per-entry layout (docs/STORAGE.md): the live build's own routes seed a store, this
 * build starts on that store, moves it, and every collection must read back equal.
 *
 *   node --experimental-strip-types scripts/live-build-migration.ts --live <a checkout of the live build> --host node|worker [--players 60]
 *
 * Node: the live server writes `devices.json`; this build starts on the directory with STORE_LAYOUT=entries and its store export
 * is compared with the collections in the file. Worker: the live Worker runs under Miniflare on a persisted folder; this build's
 * Worker starts on the same folder in `shadow`, then `entries`, then back to `legacy`, and each time the operator's
 * fingerprints of the collections are compared with the ones the live build left.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2), option = (name: string, fallback: string): string => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
const live = realpathSync(resolve(option('live', '.'))), host = option('host', 'node'), count = Number(option('players', '60')), port = Number(option('port', '4188'));
const token = `live-${randomUUID()}`, sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
interface Player { id: string; cookie: string; ip: string; name: string }

/** The routes of the live build, as a page uses them: players, friends, messages, a group, a gift, a ping, the civic pulse. */
async function play(base: string): Promise<number> {
  let n = 0;
  const call = async (player: Player | null, path: string, body?: object): Promise<Record<string, unknown>> => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { origin: base, 'x-forwarded-for': player?.ip ?? '45.0.0.9', 'cf-connecting-ip': player?.ip ?? '45.0.0.9', ...(body ? { 'content-type': 'application/json' } : {}), ...(player ? { cookie: player.cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    n += 1;
    return { status: response.status, ...(await response.json() as object), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const players: Player[] = [];
  for (let i = 0; i < count; i++) {
    const ip = `44.0.${i >> 8}.${i & 255}`, made = await call({ id: '', cookie: '', ip, name: '' }, '/api/session', { name: `Player ${i}` });
    const player: Player = { id: (made['session'] as { id: string }).id, cookie: made['cookie'] as string, ip, name: `Player ${i}` };
    players.push(player);
    await call(player, '/api/life?city=lagos'); await call(player, '/api/social/me'); await call(player, '/api/civic/pulse?city=lagos');
  }
  const clientId = (): string => `${Date.now()}:${randomUUID()}`;
  for (let i = 1; i < players.length; i++) for (const back of [1, 2]) {
    const a = players[i] as Player, b = players[Math.max(0, i - back)] as Player;
    if (a === b) continue;
    await call(a, '/api/social/friends/request', { to: b.id, cityId: 'lagos' }); await call(b, '/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' });
  }
  for (let i = 1; i < players.length; i++) {
    const a = players[i] as Player, b = players[i - 1] as Player;
    for (let m = 0; m < 3 + (i % 9); m++) await call(m % 2 ? b : a, '/api/social/messages', { to: (m % 2 ? a : b).id, body: `line ${m} \u{1F469}‍\u{1F4BB} from ${i}`, clientId: clientId() });
  }
  const crew = await call(players[0] as Player, '/api/social/groups', { name: 'Crew', members: players.slice(1, 6).map((p) => p.id), clientId: clientId() });
  const conv = (crew['conv'] as { id?: string } | undefined)?.id;
  if (conv) for (let m = 0; m < 20; m++) await call(players[m % 6] as Player, '/api/social/messages', { conv, body: `group line ${m}`, clientId: clientId() });
  await call(players[2] as Player, '/api/social/transfers', { to: (players[1] as Player).id, amount: 500, cityId: 'lagos', clientId: clientId() });
  await call(players[3] as Player, '/api/social/ping', { to: (players[2] as Player).id, clientId: clientId() });
  await call(players[4] as Player, '/api/social/block', { id: (players[9] as Player).id, cityId: 'lagos' });
  await call(players[5] as Player, '/api/civic/prefs', { directory: true });
  return n;
}

async function nodeRun(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'allworld-live-node-'));
  const start = (repo: string, env: Record<string, string>): Promise<{ base: string; stop(): Promise<void> }> => new Promise((done, failed) => {
    const child: ChildProcess = spawn(process.execPath, [join(repo, 'server/server.ts')], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PORT: String(port), DATA_DIR: dir, TRUST_PROXY: '1', MODERATOR_TOKEN: token, ...env } });
    const base = `http://127.0.0.1:${port}`;
    child.on('exit', (code) => { console.error('server exited', code); });
    (async () => { for (let i = 0; i < 200; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return done({ base, stop: async () => { child.kill('SIGTERM'); await new Promise<void>((exit) => { child.once('exit', () => exit()); setTimeout(exit, 20000); }); } }); } catch { await sleep(100); } } failed(new Error('did not start')); })();
  });
  try {
    const old = await start(live, {});
    const requests = await play(old.base);
    await old.stop();
    const written = JSON.parse(await readFile(join(dir, 'devices.json'), 'utf8')) as Record<string, unknown>;
    const wanted = Object.fromEntries(['social', 'growth', 'civic', 'business'].filter((name) => written[name] !== undefined).map((name) => [name, written[name]]));
    console.log(`live build seeded with ${requests} requests: ${Object.entries(wanted).map(([name, value]) => `${name} ${(JSON.stringify(value).length / 1024).toFixed(0)} KB`).join(', ')}`);
    await cp(join(dir, 'devices.json'), join(dir, 'devices.live.json'));
    const next = await start(root, { STORE_LAYOUT: 'entries' });
    const status = await (await fetch(`${next.base}/api/mod/store`, { headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '45.0.0.1' } })).json() as Record<string, unknown>;
    console.log(`this build on that store: layout ${String(status['requested'])}`);
    // A new player makes the file be written again from the per-entry state; everything the live build wrote must be in it, equal.
    const made = await fetch(`${next.base}/api/session`, { method: 'POST', headers: { origin: next.base, 'content-type': 'application/json', 'x-forwarded-for': '44.9.9.9' }, body: JSON.stringify({ name: 'Newcomer' }) });
    const cookie = made.headers.get('set-cookie')?.split(';')[0] ?? '';
    assert.equal((await fetch(`${next.base}/api/social/me`, { headers: { cookie, origin: next.base, 'x-forwarded-for': '44.9.9.9' } })).status, 200);
    await next.stop();
    const after = JSON.parse(await readFile(join(dir, 'devices.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    for (const name of Object.keys(wanted)) {
      const was = wanted[name] as Record<string, unknown>;
      for (const [key, value] of Object.entries(was)) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value) && ['players', 'convs', 'houses', 'pending', 'shops', 'shares', 'comeback', 'push', 'contacts'].includes(key)) {
          for (const [id, entry] of Object.entries(value as Record<string, unknown>)) assert.deepEqual((after[name]?.[key] as Record<string, unknown>)[id], entry, `${name}.${key}.${id}`);
        }
      }
    }
    assert.ok(Object.keys((after['social'] as { players: object }).players).length > count);
    console.log('every collection read back equal');
    const again = await start(root, {});
    await again.stop();
    console.log('and the legacy layout starts on the same file');
  } finally { await rm(dir, { recursive: true, force: true }); }
}

interface Mini { ready: Promise<URL>; dispose(): Promise<void>; dispatchFetch(url: string, init?: RequestInit): Promise<Response> }
async function workerRun(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'allworld-live-worker-'));
  const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || join(root, 'deploy/tooling'), 'package.json'));
  const miniflare = require('miniflare') as { Miniflare: new (options: Record<string, unknown>) => Mini; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> };
  const esbuild = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> };
  const bundle = async (repo: string, name: string): Promise<string> => { const out = join(dir, `${name}.mjs`); await esbuild.build({ entryPoints: [join(repo, 'deploy/cloudflare-worker.ts')], outfile: out, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], logLevel: 'error' }); return readFile(out, 'utf8'); };
  const [oldScript, newScript] = [await bundle(live, 'live'), await bundle(root, 'this')];
  const open = (script: string, bindings: Record<string, string>): Mini => new miniflare.Miniflare({ ...miniflare.convertV4MiniflareOptions({ name: 'allworld-live', script, modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(dir, 'storage'),
    bindings: { BUILD_ID: 'live', MODERATOR_TOKEN: token, ...bindings }, serviceBindings: { ASSETS: () => new Response('asset') } }), resourcePersistencePath: join(dir, 'storage'), host: '127.0.0.1', port, handleStructuredLogs: () => {} });
  try {
    let mf = open(oldScript, {});
    const base = `http://127.0.0.1:${(await mf.ready).port}`;
    const requests = await play(base);
    await mf.dispose();
    console.log(`live Worker seeded with ${requests} requests`);
    const operator = async (path: string, body?: object): Promise<Record<string, unknown>> => { const r = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '45.0.0.1', 'cf-connecting-ip': '45.0.0.1', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, ...(await r.json() as object) }; };
    mf = open(newScript, {});
    await mf.ready;
    const legacy = (await operator('/api/mod/store/hashes'))['collections'] as Record<string, string | null>;
    console.log('fingerprints the live build left:', JSON.stringify(legacy));
    for (const step of ['shadow', 'entries', 'shadow', 'legacy'] as const) {
      const done = await operator('/api/mod/store/layout', { layout: step });
      assert.equal(done['status'], 200, `${step}: ${JSON.stringify(done)}`);
      const now = (await operator('/api/mod/store/hashes'))['collections'] as Record<string, string | null>;
      assert.deepEqual(now, legacy, `${step}: the collections read back equal`);
      console.log(`${step}: every collection reads back equal`);
    }
    await mf.dispose();
    mf = open(newScript, { STORE_LAYOUT: 'entries' });
    await mf.ready;
    assert.deepEqual((await operator('/api/mod/store/hashes'))['collections'], legacy);
    console.log('a fresh start in entries (moved on its first request): equal');
    await mf.dispose();
  } finally { await rm(dir, { recursive: true, force: true }); }
}
if (!live) throw new Error('--live <checkout of the live build> is required');
await (host === 'worker' ? workerRun() : nodeRun());
