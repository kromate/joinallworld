/**
 * Local load test: N simulated players against an in-process server.
 *
 *   node scripts/load.ts [--players 100] [--seconds 10] [--poll-ms 1000] [--action-ms 2000]
 *
 * METHOD
 *   A fresh server is started on a temporary data directory with the real clock.
 *   Every player gets a device session, then for `--seconds`:
 *     - polls GET /api/life every `--poll-ms` (with jitter), as the browser does, and
 *     - sends one POST /api/action every `--action-ms` (with jitter), cycling through what a player
 *       does in a venue: stand at a spot, start an activity, cancel it, travel, start a free activity.
 *   Requests are real HTTP over loopback. Each player presents its own address through
 *   X-Forwarded-For (the server runs with trustProxy), so the per-address rate limit treats them as
 *   separate visitors, as it would behind a proxy.
 *   Latency is measured around each fetch (request sent → JSON parsed). The store's own counters give
 *   the number of file writes and bytes written. (There is one store; the old per-request rewrite
 *   that this script used to compare against was removed.)
 *
 * WHAT IT DOES NOT SHOW
 *   One machine, loopback, one process serving and generating the load, a few seconds, a
 *   data file of N young lives. It says nothing about a real network, a slow disk, or a data file
 *   with thousands of long-lived sessions. Report the numbers with this method beside them.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from '../server/server.ts';

/** Counters the store keeps (server/store.ts is untyped). */
interface StoreStats { writes: number; bytes: number; transactions: number }
interface LoadServer extends Server {
  store: { stats(): StoreStats; flush(): Promise<void>; close(): Promise<void> };
}
interface Person { headers: Record<string, string>; step: number }
type Kind = 'action' | 'poll';
export interface LoadSettings { players?: number; seconds?: number; pollMs?: number; actionMs?: number }
interface Summary { count: number; p50: number | null; p95: number | null; max: number | null }
export interface LoadResult {
  players: number; seconds: number; pollMs: number; actionMs: number;
  action: Summary; poll: Summary;
  writes: number; megabytesWritten: number | null; transactions: number; fileKilobytes: number; errors: number; codes: Record<string, number>;
}
/** The fields of a reply this script reads. */
interface Reply { code?: string; error?: string }

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const quantile = (sorted: number[], q: number) => (sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN) : NaN);
const round = (value: number) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);

function summary(samples: number[]): Summary {
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: sorted.length, p50: round(quantile(sorted, 0.5)), p95: round(quantile(sorted, 0.95)), max: round(sorted.at(-1) ?? NaN) };
}

/** What one simulated player sends, in order, over and over. Every step is valid from the state the previous one leaves. */
const SCRIPT = [
  { type: 'spot', payload: { id: 'trees' } },
  { type: 'activity', payload: { id: 'chill' } },
  { type: 'cancel' },
  { type: 'travel', payload: { id: 'home', mode: 'trek' } },
  { type: 'civic.refresh' },
  { type: 'travel', payload: { id: 'park', mode: 'trek' } },
];

export async function runLoad({ players = 100, seconds = 10, pollMs = 1000, actionMs = 2000 }: LoadSettings = {}): Promise<LoadResult> {
  const dataDir = await mkdtemp(join(tmpdir(), 'joinallworld-load-'));
  const server = await createServer({ dataDir, distDir: join(dataDir, 'no-dist'), trustProxy: true }) as unknown as LoadServer;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const latencies: Record<Kind, number[]> = { action: [], poll: [] }, codes: Record<string, number> = {};
  let errors = 0;
  try {
    async function call(kind: Kind | null, path: string, body: unknown, headers: Record<string, string>): Promise<{ response: Response | null; json: Reply | null }> {
      const started = performance.now();
      try {
        const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
        const json = await response.json() as Reply;
        if (kind) latencies[kind].push(performance.now() - started);
        if (response.status !== 200) errors += 1;
        return { response, json };
      } catch { errors += 1; return { response: null, json: null }; }
    }
    const people: Person[] = [];
    for (let index = 0; index < players; index++) {
      const address = `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;
      const { response } = await call(null, '/api/session', { name: `Player ${index + 1}` }, { 'X-Forwarded-For': address });
      // A failed session request stops the run (the original crashed with a TypeError on `response.headers`).
      if (!response) throw new TypeError('session request failed');
      people.push({ headers: { Cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '', 'X-Forwarded-For': address }, step: index % SCRIPT.length });
    }
    const setup = server.store.stats();
    const until = performance.now() + seconds * 1000;
    const jitter = (ms: number) => ms * (0.5 + Math.random());
    async function poller(person: Person) {
      await sleep(Math.random() * pollMs);
      while (performance.now() < until) { await call('poll', '/api/life?city=lagos', null, person.headers); await sleep(jitter(pollMs)); }
    }
    async function actor(person: Person) {
      await sleep(Math.random() * actionMs);
      while (performance.now() < until) {
        const step = SCRIPT[person.step++ % SCRIPT.length];
        const { json } = await call('action', '/api/action', { actionId: `${Date.now()}:${randomUUID()}`, cityId: 'lagos', ...step }, person.headers);
        const code = json?.code ?? json?.error ?? 'no_reply';
        codes[code] = (codes[code] ?? 0) + 1;
        await sleep(jitter(actionMs));
      }
    }
    await Promise.all(people.flatMap((person) => [poller(person), actor(person)]));
    await server.store.flush();
    const end = server.store.stats();
    const bytes = (await stat(join(dataDir, 'devices.json'))).size;
    return {
      players, seconds, pollMs, actionMs,
      action: summary(latencies.action), poll: summary(latencies.poll),
      writes: end.writes - setup.writes, megabytesWritten: round((end.bytes - setup.bytes) / 1e6), transactions: end.transactions - setup.transactions,
      fileKilobytes: Math.round(bytes / 1024), errors, codes,
    };
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await server.store.close().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: number) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : fallback; };
  const settings = { players: Number(option('players', 100)), seconds: Number(option('seconds', 10)), pollMs: Number(option('poll-ms', 1000)), actionMs: Number(option('action-ms', 2000)) };
  console.log(`Load test · ${settings.players} players · ${settings.seconds}s · a poll every ~${settings.pollMs}ms and an action every ~${settings.actionMs}ms per player · loopback, in-process`);
  console.log(['actions', 'act p50', 'act p95', 'act max', 'polls', 'poll p50', 'poll p95', 'writes', 'MB written', 'file KB', 'errors'].join(' | '));
  const r = await runLoad(settings);
  console.log([String(r.action.count).padStart(7), `${r.action.p50}ms`.padStart(7), `${r.action.p95}ms`.padStart(7), `${r.action.max}ms`.padStart(7), String(r.poll.count).padStart(5),
    `${r.poll.p50}ms`.padStart(8), `${r.poll.p95}ms`.padStart(8), String(r.writes).padStart(6), String(r.megabytesWritten).padStart(10), String(r.fileKilobytes).padStart(7), String(r.errors).padStart(6)].join(' | '));
  console.log(`result codes: ${Object.entries(r.codes).map(([code, count]) => `${code} ${count}`).join(', ')}`);
}
