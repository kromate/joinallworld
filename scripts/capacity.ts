#!/usr/bin/env node
/**
 * Local capacity test: N simulated players, each behaving like one open page, against either host.
 *
 *   npm run capacity -- --host node   --steps 100,250,500 [--seconds 60] [--port 4040]
 *   npm run capacity -- --host worker --steps 100,250,500        (needs `npm run build` and the Worker tooling)
 *   … --profile host.cpuprofile     a CPU profile of the host during the last step, with the hottest functions printed
 *   … --env MAX_SOCKETS=20000       a setting handed to the host (repeatable)
 *
 * METHOD
 *   The host runs as its own process on a temporary data directory: `server/server.ts` for Node, the bundled Worker
 *   and its SQLite Durable Object under Miniflare for the Worker host. Players are added step by step and never
 *   removed, so the stored collections grow as they would. Each player is what one open page is:
 *     - a device session, a life in Lagos and a place in the social collection;
 *     - `--friends` friendships with players made before it;
 *     - TWO sockets, as the page opens: the game socket (joins the venue room, moves, chats) and the social socket
 *       (who-is-here, live location, messages). Both answer the Worker host's `heartbeat` frames;
 *     - the page's polls at the cadence measured from the real page: GET /api/life and GET /api/civic/pulse once a
 *       minute, GET /api/world/pulse every 30 s;
 *     - what a person adds: a game action every `--action-ms`, a step in the venue every `--move-ms`, a chat line
 *       every `--chat-ms`, the phone's overview (GET /api/social/me) every `--social-ms` and a message to a friend
 *       every other time.
 *   `--sleepers N` adds N players before the first step who played once and are not connected: what a host carries of
 *   everyone who came by in the last weeks, which is many times the number connected at once.
 *   `--venue-share` of the players stand in public venues, spread over `--venues`; the rest go home, where a room
 *   holds one player.
 *   Every player presents its own network address (X-Forwarded-For on Node, CF-Connecting-IP on the Worker), so the
 *   per-address limits treat them as separate visitors.
 *   MEASURED per step: latency (request sent → answer parsed) by kind; the delay of a socket frame (a chat line or a
 *   message sent → its echo); errors and refusals by code; the host process's memory and CPU time (`ps`), from which
 *   CPU per request (with `--profile`, also the host's JavaScript heap after each step); and, from the operator's overview, the store's counters, the rows written (Worker) and the size
 *   of every stored collection.
 *
 * WHAT IT DOES NOT SHOW
 *   One machine: the load generator shares it with the host, everything is loopback, and Miniflare is not the
 *   production runtime (no CPU limits, no billing, a local disk). Lives are minutes old. The numbers find the first
 *   thing that grows with player count and compare one build with another; they are not a promise about production.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

type HostKind = 'node' | 'worker';
interface Settings {
  host: HostKind; steps: number[]; seconds: number; port: number
  actionMs: number; moveMs: number; chatMs: number; socialMs: number
  venueShare: number; venues: string[]; friends: number; setupConcurrency: number; json: string | null
  /** Players made before the first step who then stay away: they are in every stored collection and hold no socket. */
  sleepers: number
  /** Write a CPU profile of the host during the LAST step here (a .cpuprofile file), and print where the time went. */
  profile: string | null
  env: Record<string, string>
}
interface Summary { count: number; p50: number | null; p95: number | null; p99: number | null; max: number | null }
interface ProcessUsage { rssMb: number; cpuSeconds: number }
interface Overview { sessions?: number; store?: Record<string, unknown> | null }
export interface StepResult {
  players: number; setupSeconds: number; seconds: number
  latency: Record<string, Summary>; setup: Record<string, Summary>
  requests: number; requestsPerSecond: number; framesIn: number; framesOut: number
  errors: Record<string, number>; refusals: Record<string, number>
  rssMb: number; heapMb: number | null; cpuMsPerRequest: number | null; cpuShare: number
  /** What the host sent over sockets, and how busy THIS script was: near one core, the script is the limit and the step says little about the host. */
  megabytesOutPerSecond: number; generatorCpuShare: number
  rowsWritten: number | null; rowsPerPlayerHour: number | null; rowsByTable: Record<string, number>; rowsBySource: Record<string, number>; collections: Record<string, number>; sessions: number | null
}
interface Reply { ok?: boolean; code?: string; error?: string; state?: { location?: string; activeAction?: { kind?: string; remaining?: number } | null }; session?: { id?: string } }
interface Frame { type?: string; clientId?: string; code?: string; error?: string }

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
const round = (value: number) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
function summary(samples: number[]): Summary {
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: sorted.length, p50: round(quantile(sorted, 0.5)), p95: round(quantile(sorted, 0.95)), p99: round(quantile(sorted, 0.99)), max: round(sorted.at(-1) ?? NaN) };
}
const bump = (tally: Record<string, number>, key: string, by = 1): void => { tally[key] = (tally[key] ?? 0) + by; };

/** Memory and CPU time of a process, as `ps` reports them. */
function usageOf(pid: number): ProcessUsage {
  try {
    const [rss = '0', time = '0'] = execFileSync('ps', ['-o', 'rss=,time=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
    const parts = time.split(/[:-]/).map(Number);
    const cpuSeconds = parts.reduce((total, part) => total * 60 + part, 0);
    return { rssMb: Number(rss) / 1024, cpuSeconds };
  } catch { return { rssMb: NaN, cpuSeconds: NaN }; }
}
/** The process ids whose parent is `pid`. */
function childrenOf(pid: number): { pid: number; command: string }[] {
  try {
    return execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).split('\n').map((line) => line.trim().split(/\s+/))
      .filter((fields) => Number(fields[1]) === pid).map((fields) => ({ pid: Number(fields[0]), command: fields.slice(2).join(' ') }));
  } catch { return []; }
}

interface RunningHost { base: string; pid: number; token: string; stop(): Promise<void>; profiler: Profiler | null }
/** A CPU profile of the host: started before a step, stopped after it. */
interface Profiler { start(): Promise<void>; stop(): Promise<CpuProfile | null>; /** The JavaScript heap the host holds after a collection, in MB (on the Worker host: the isolate's, which the platform limits). */ heapMb(): Promise<number | null> }
interface CpuProfile { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[]; samples?: number[]; timeDeltas?: number[] }

/** The functions a profile spent its time in: [name, self ms, self share, total ms] — idle time left out. */
export function hottest(profile: CpuProfile, most = 25): { name: string; selfMs: number; share: number; totalMs: number }[] {
  const self = new Map<number, number>();
  // A runtime that takes no sample while it waits gives the whole wait to the next sample: a gap far longer than the usual one is not work.
  const deltas = [...(profile.timeDeltas ?? [])].sort((a, b) => a - b), usual = deltas[Math.floor(deltas.length / 2)] ?? 0;
  (profile.samples ?? []).forEach((id, at) => self.set(id, (self.get(id) ?? 0) + Math.min(profile.timeDeltas?.[at] ?? 0, usual * 4)));
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const total = new Map<number, number>();
  const totalOf = (id: number): number => { const known = total.get(id); if (known !== undefined) return known; const node = byId.get(id); const sum = (self.get(id) ?? 0) + (node?.children ?? []).reduce((all, child) => all + totalOf(child), 0); total.set(id, sum); return sum; };
  const names = new Map<string, { selfMs: number; totalMs: number }>();
  let busy = 0;
  for (const node of profile.nodes) {
    const name = node.callFrame.functionName || '(anonymous)';
    if (name === '(idle)' || name === '(root)' || name === '(program)') continue;
    const label = `${name}${node.callFrame.url ? ` :${node.callFrame.lineNumber + 1}` : ' (built in)'}`;
    const entry = names.get(label) ?? { selfMs: 0, totalMs: 0 };
    entry.selfMs += (self.get(node.id) ?? 0) / 1000; entry.totalMs += totalOf(node.id) / 1000; busy += (self.get(node.id) ?? 0) / 1000;
    names.set(label, entry);
  }
  return [...names].map(([name, entry]) => ({ name, selfMs: Math.round(entry.selfMs), share: busy ? Math.round(entry.selfMs / busy * 1000) / 10 : 0, totalMs: Math.round(entry.totalMs) }))
    .sort((a, b) => b.selfMs - a.selfMs).slice(0, most);
}
/** A profiler over the inspector protocol (the Worker runtime's inspector, as Miniflare offers it). */
function inspectorProfiler(port: number): Profiler {
  let socket: WebSocket | null = null, next = 0;
  const waiting = new Map<number, (result: unknown) => void>();
  const ask = (method: string, params: object = {}): Promise<unknown> => new Promise((done) => { const id = ++next; waiting.set(id, done); socket?.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (waiting.delete(id)) done(undefined); }, 20000); });
  async function connect(): Promise<void> {
    if (socket) return;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })).json() as { webSocketDebuggerUrl?: string }[];
    const url = targets.find((target) => target.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
    if (!url) throw new Error('The host offers no inspector target');
    const opened = new WebSocket(url);
    await new Promise<void>((done, failed) => { opened.once('open', () => done()); opened.once('error', failed); });
    opened.on('message', (raw) => { const message = JSON.parse(String(raw)) as { id?: number; result?: unknown }; if (message.id !== undefined) { waiting.get(message.id)?.(message.result); waiting.delete(message.id); } });
    opened.on('close', () => { if (socket === opened) socket = null; });
    socket = opened;
  }
  return {
    async start() { await connect(); await ask('Profiler.enable'); await ask('Profiler.setSamplingInterval', { interval: 500 }); await ask('Profiler.start'); },
    async stop() {
      if (!socket) return null;
      const result = await ask('Profiler.stop') as { profile?: CpuProfile } | undefined;
      return result?.profile ?? null;
    },
    async heapMb() {
      try { await connect(); await ask('HeapProfiler.collectGarbage'); const usage = await ask('Runtime.getHeapUsage') as { usedSize?: number } | undefined; return typeof usage?.usedSize === 'number' ? Math.round(usage.usedSize / 1048576) : null; } catch { return null; }
    },
  };
}

async function startNode(port: number, dataDir: string, token: string, env: Record<string, string>, inspect: number | null): Promise<RunningHost> {
  const child: ChildProcess = spawn(process.execPath, [...(inspect ? [`--inspect=127.0.0.1:${inspect}`] : []), join(root, 'server/server.ts')], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ...env, PORT: String(port), DATA_DIR: dataDir, TRUST_PROXY: '1', MODERATOR_TOKEN: token } });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { await sleep(100); } }
  return { base, pid: child.pid ?? 0, token, profiler: inspect ? inspectorProfiler(inspect) : null, stop: async () => { child.kill('SIGTERM'); await new Promise<void>((done) => { child.once('exit', () => done()); setTimeout(done, 25000); }); } };
}

interface MiniflareHandle { ready: Promise<URL>; dispose(): Promise<void> }
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareHandle; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface EsbuildTooling { build(options: Record<string, unknown>): Promise<unknown> }

/** The Worker host as deploy/local.ts runs it, reached on the runtime's own port (no forwarding process in between). */
async function startWorker(dataDir: string, token: string, env: Record<string, string>, inspect: number | null): Promise<RunningHost> {
  const require = createRequire(resolve(process.env.JOINALLWORLD_TOOLS || join(root, 'deploy/tooling'), 'package.json'));
  let miniflare: MiniflareTooling, esbuild: EsbuildTooling;
  try { miniflare = require('miniflare') as MiniflareTooling; esbuild = require('esbuild') as EsbuildTooling; }
  catch { throw new Error('The Worker tooling (Miniflare) is not installed. Run this first: npm ci --ignore-scripts --prefix deploy/tooling'); }
  if (!existsSync(join(root, 'dist/index.html'))) throw new Error('There is no built page in dist/. Run this first: npm run build');
  const bundle = join(dataDir, 'worker.mjs');
  await esbuild.build({ entryPoints: [join(root, 'deploy/cloudflare-worker.ts')], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], logLevel: 'error' });
  const options: Record<string, unknown> = { name: 'allworld-capacity', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(dataDir, 'storage'), bindings: { BUILD_ID: 'capacity', MODERATOR_TOKEN: token, ...env },
    assets: { directory: join(root, 'dist'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } } };
  const mf = new miniflare.Miniflare({ ...miniflare.convertV4MiniflareOptions(options), resourcePersistencePath: join(dataDir, 'storage'), host: '127.0.0.1', port: 0, handleStructuredLogs: () => {}, ...(inspect ? { inspectorPort: inspect } : {}) });
  const url = await mf.ready;
  const runtime = childrenOf(process.pid).find((child) => child.command.includes('workerd'));
  return { base: `http://127.0.0.1:${url.port}`, pid: runtime?.pid ?? 0, token, profiler: inspect ? inspectorProfiler(inspect) : null, stop: () => mf.dispose() };
}

class Player {
  cookie = ''; id = ''; location = 'park'; game: WebSocket | null = null; social: WebSocket | null = null;
  readonly friends: string[] = [];
  readonly waiting = new Map<string, number>();
  readonly index: number; readonly home: boolean; readonly venue: string;
  constructor(index: number, home: boolean, venue: string) { this.index = index; this.home = home; this.venue = venue; }
  /** A public-looking address of its own, so the per-address limits count each player as one visitor. */
  get address(): string { return `44.${(this.index >> 16) & 255}.${(this.index >> 8) & 255}.${this.index & 255}`; }
}

export async function runCapacity(settings: Settings, log: (line: string) => void = console.log): Promise<StepResult[]> {
  const dataDir = await mkdtemp(join(tmpdir(), 'allworld-capacity-'));
  const token = `capacity-${randomUUID()}`;
  const inspect = settings.profile ? settings.port + 1 : null;
  const host = settings.host === 'node' ? await startNode(settings.port, dataDir, token, settings.env, inspect) : await startWorker(dataDir, token, settings.env, inspect);
  const players: Player[] = [], results: StepResult[] = [];
  let latency: Record<string, number[]> = {}, errors: Record<string, number> = {}, refusals: Record<string, number> = {};
  let requests = 0, framesIn = 0, framesOut = 0, bytesIn = 0, measuring = false;
  const note = (kind: string, ms: number): void => { (latency[kind] ??= []).push(ms); };
  const headersOf = (player: Player | null, body: boolean): Record<string, string> => ({ origin: host.base, ...(body ? { 'content-type': 'application/json' } : {}),
    ...(player ? { 'x-forwarded-for': player.address, 'cf-connecting-ip': player.address, ...(player.cookie ? { cookie: player.cookie } : {}) } : {}) });

  async function call(kind: string, player: Player, path: string, body?: object): Promise<{ response: Response; json: Reply } | null> {
    const started = performance.now();
    requests += 1;
    try {
      const response = await fetch(host.base + path, { method: body ? 'POST' : 'GET', headers: headersOf(player, Boolean(body)), ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
      const json = await response.json() as Reply;
      note(kind, performance.now() - started);
      if (response.status !== 200) bump(errors, `${kind}: ${response.status} ${json.error ?? ''}`.trim());
      else if (json.ok === false) bump(refusals, `${kind}: ${json.code ?? 'refused'}`);
      return { response, json };
    } catch (error) { bump(errors, `${kind}: ${error instanceof Error ? error.name : 'failed'}`); return null; }
  }
  const act = (player: Player, type: string, payload?: object) => call('action', player, '/api/action', { actionId: `${Date.now()}:${randomUUID()}`, cityId: 'lagos', type, ...(payload ? { payload } : {}) });
  async function overview(): Promise<Overview> {
    try { return await (await fetch(`${host.base}/api/mod/overview`, { headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': '45.0.0.1', 'x-forwarded-for': '45.0.0.1' } })).json() as Overview; } catch { return {}; }
  }

  function send(socket: WebSocket | null, frame: object): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(frame)); framesOut += 1;
    return true;
  }
  function open(player: Player, which: 'game' | 'social'): Promise<void> {
    return new Promise((done) => {
      const socket = new WebSocket(`${host.base.replace('http', 'ws')}/socket`, { headers: headersOf(player, false) });
      const finish = (): void => { done(); };
      socket.on('open', () => {
        player[which] = socket;
        if (which === 'game') send(socket, { type: 'join', cityId: 'lagos', venueId: player.location });
        else { send(socket, { type: 'people-list', cityId: 'lagos' }); send(socket, { type: 'live-watch', cityId: 'lagos' }); }
        finish();
      });
      socket.on('message', (raw) => {
        framesIn += 1;
        // A member list or a live frame is counted and not read: reading thousands of them a second would measure this script, not the host.
        const data = raw as Buffer;
        bytesIn += data.length;
        const head = data.subarray(0, 18).toString('latin1');
        if (head === '{"type":"presence"' || head.startsWith('{"type":"live-') || data.length > 8000) return;
        let frame: Frame;
        try { frame = JSON.parse(data.toString()) as Frame; } catch { return; }
        if (frame.type === 'heartbeat') { send(socket, { type: 'heartbeat-ack' }); return; }
        if ((frame.type === 'chat' || frame.type === 'dm-sent' || frame.type === 'dm-failed') && frame.clientId) {
          const sent = player.waiting.get(frame.clientId);
          if (sent !== undefined) { player.waiting.delete(frame.clientId); if (measuring) note(frame.type === 'chat' ? 'frame: chat echo' : 'frame: message sent', performance.now() - sent); }
          if (frame.type === 'dm-failed') bump(refusals, `message: ${frame.code ?? 'failed'}`);
        }
        if (frame.type === 'error') bump(frame.code === 'venue_mismatch' || frame.code === 'join_required' ? refusals : errors, `socket: ${frame.code ?? frame.error ?? 'error'}`);
      });
      socket.on('unexpected-response', (_request, response) => { bump(errors, `socket open: ${response.statusCode}`); finish(); });
      socket.on('error', () => { finish(); });
      socket.on('close', (code) => { if (player[which] === socket) { player[which] = null; if (!stopping) bump(errors, `socket closed: ${code}`); } });
    });
  }

  async function create(player: Player): Promise<void> {
    const made = await call('setup: session', player, '/api/session', { name: `Player ${player.index + 1}` });
    const cookie = made?.response.headers.get('set-cookie')?.split(';')[0];
    if (!made || !cookie || !made.json.session?.id) throw new Error(`Player ${player.index + 1} was given no session (${made?.response.status ?? 'no answer'} ${made?.json.error ?? ''})`);
    player.cookie = cookie; player.id = made.json.session.id;
    await call('setup: life', player, '/api/life?city=lagos');
    await call('setup: social overview', player, '/api/social/me');
    // A place to stand: home (a room of one), or one of the public venues. The trip takes a few seconds: arrive() follows.
    const target = player.home ? 'home' : player.venue;
    if (target !== 'park') { const started = await act(player, 'travel', { id: target, mode: 'danfo' }); travelSeconds = Math.max(travelSeconds, started?.json.state?.activeAction?.remaining ?? 0); }
    for (let back = 1; back <= settings.friends; back++) {
      const other = players[player.index - back * 3 + 1] ?? players[player.index - back];
      if (!other?.id || other === player) continue;
      const asked = await call('setup: friend request', player, '/api/social/friends/request', { to: other.id, cityId: 'lagos' });
      if (!asked?.json.ok) continue;
      const answered = await call('setup: friend answer', other, '/api/social/friends/answer', { from: player.id, accept: true, cityId: 'lagos' });
      if (answered?.json.ok) { player.friends.push(other.id); other.friends.push(player.id); }
    }
  }
  /** The trip is over: read where the life is and open the page's two sockets. */
  async function arrive(player: Player): Promise<void> {
    if (!player.cookie) return;
    const life = await call('setup: life', player, '/api/life?city=lagos');
    player.location = life?.json.state?.location ?? 'park';
    await open(player, 'game'); await open(player, 'social');
  }

  let stopping = false, until = 0, travelSeconds = 0;
  const jitter = (ms: number) => ms * (0.5 + Math.random());
  /** One recurring thing a player does, until the step ends. */
  async function every(ms: number, work: () => Promise<unknown> | void): Promise<void> {
    const rest = (wanted: number) => sleep(Math.max(0, Math.min(wanted, until - performance.now())));
    await rest(Math.random() * ms);
    while (performance.now() < until && !stopping) { await work(); await rest(jitter(ms)); }
  }
  const VENUE_STEPS: [string, object?][] = [['spot', { id: 'trees' }], ['activity', { id: 'chill' }], ['cancel'], ['civic.refresh']];
  function live(player: Player): Promise<void>[] {
    let step = player.index, turn = 0;
    return [
      every(60000, () => call('poll: life', player, '/api/life?city=lagos')),
      every(30000, () => call('poll: world pulse', player, '/api/world/pulse')),
      every(60000, () => call('poll: civic pulse', player, '/api/civic/pulse?city=lagos')),
      every(settings.actionMs, () => { const [type, payload] = (player.location === 'park' ? VENUE_STEPS[step++ % VENUE_STEPS.length] : undefined) ?? ['civic.refresh']; return act(player, type, payload); }),
      every(settings.moveMs, () => { send(player.game, { type: 'move', x: Math.round((Math.random() * 30 - 15) * 10) / 10 || 0.1, z: Math.round((Math.random() * 30 - 15) * 10) / 10 || 0.1 }); }),
      every(settings.chatMs, () => { const clientId = randomUUID(); if (send(player.game, { type: 'chat', body: `Hello from player ${player.index + 1}`, clientId })) player.waiting.set(clientId, performance.now()); }),
      every(settings.socialMs, async () => {
        await call('social overview', player, '/api/social/me');
        const friend = player.friends[turn % Math.max(1, player.friends.length)];
        if (turn++ % 2 === 0 && friend) { const clientId = randomUUID(); if (send(player.social, { type: 'dm-send', to: friend, body: `How far? ${turn}`, clientId })) player.waiting.set(clientId, performance.now()); }
      }),
    ];
  }

  try {
    log(`Capacity test · ${settings.host} host · steps ${settings.steps.join(', ')} · ${settings.seconds}s each · ${Math.round(settings.venueShare * 100)}% in ${settings.venues.length} public venues`);
    if (settings.sleepers > 0) {
      const started = performance.now();
      const sleeper = async (index: number): Promise<void> => {
        const player = new Player(1000000 + index, true, 'park');
        const made = await call('setup: session', player, '/api/session', { name: `Sleeper ${index + 1}` });
        const cookie = made?.response.headers.get('set-cookie')?.split(';')[0];
        if (!cookie) return;
        player.cookie = cookie;
        await call('setup: life', player, '/api/life?city=lagos'); await call('setup: social overview', player, '/api/social/me'); await call('setup: civic pulse', player, '/api/civic/pulse?city=lagos');
      };
      for (let at = 0; at < settings.sleepers; at += settings.setupConcurrency) await Promise.all(Array.from({ length: Math.min(settings.setupConcurrency, settings.sleepers - at) }, (_, i) => sleeper(at + i)));
      const made = summary(latency['setup: session'] ?? []), social = summary(latency['setup: social overview'] ?? []);
      log(`${settings.sleepers} players who are not connected were made in ${Math.round((performance.now() - started) / 1000)}s · new session p50/p95 ${made.p50}/${made.p95} ms · social overview ${social.p50}/${social.p95} ms`);
    }
    for (const target of settings.steps) {
      latency = {}; errors = {}; refusals = {};
      const setupStarted = performance.now();
      const fresh: Player[] = [];
      while (players.length < target) { const index = players.length; const player = new Player(index, Math.random() >= settings.venueShare, settings.venues[index % settings.venues.length] ?? 'park'); players.push(player); fresh.push(player); }
      // Players arrive a few at a time, in order, so each can befriend the ones before it.
      const failed = (error: unknown): void => { bump(errors, `setup: ${error instanceof Error ? error.message.replace(/\d+/g, 'N') : 'failed'}`); };
      travelSeconds = 0;
      for (let at = 0; at < fresh.length; at += settings.setupConcurrency) await Promise.all(fresh.slice(at, at + settings.setupConcurrency).map((player) => create(player).catch(failed)));
      await sleep(travelSeconds * 1000 + 500);
      for (let at = 0; at < fresh.length; at += settings.setupConcurrency) await Promise.all(fresh.slice(at, at + settings.setupConcurrency).map((player) => arrive(player).catch(failed)));
      const setup = Object.fromEntries(Object.entries(latency).map(([kind, samples]) => [kind, summary(samples)]));
      const setupSeconds = (performance.now() - setupStarted) / 1000;
      latency = {}; requests = 0; framesIn = 0; framesOut = 0; bytesIn = 0;
      const ownCpu = process.cpuUsage();
      const before = { usage: usageOf(host.pid), overview: await overview(), at: performance.now() };
      const profiling = target === settings.steps.at(-1) ? host.profiler : null;
      await profiling?.start().catch((error: unknown) => { log(`  (no profile: ${error instanceof Error ? error.message : 'the inspector did not answer'})`); });
      measuring = true; until = performance.now() + settings.seconds * 1000;
      await Promise.all(players.flatMap((player) => live(player)));
      measuring = false;
      const profile = await profiling?.stop().catch(() => null) ?? null;
      const heapMb = await host.profiler?.heapMb() ?? null;
      const elapsed = (performance.now() - before.at) / 1000, usage = usageOf(host.pid), after = await overview();
      const rowsOf = (view: Overview): number | null => { const rows = view.store?.['rows']; return rows && typeof rows === 'object' && typeof (rows as { total?: unknown }).total === 'number' ? (rows as { total: number }).total : null; };
      const rowsBefore = rowsOf(before.overview), rowsAfter = rowsOf(after), rowsWritten = rowsBefore !== null && rowsAfter !== null ? rowsAfter - rowsBefore : null;
      const tablesOf = (view: Overview): Record<string, number> => { const rows = view.store?.['rows']; const tables = rows && typeof rows === 'object' ? (rows as { tables?: unknown }).tables : null; return tables && typeof tables === 'object' ? tables as Record<string, number> : {}; };
      const tablesBefore = tablesOf(before.overview), rowsByTable = Object.fromEntries(Object.entries(tablesOf(after)).map(([table, rows]) => [table, rows - (tablesBefore[table] ?? 0)] as const).filter(([, rows]) => rows > 0));
      const sourcesOf = (view: Overview): Record<string, { rows: number }> => { const rows = view.store?.['rows']; const sources = rows && typeof rows === 'object' ? (rows as { sources?: unknown }).sources : null; return sources && typeof sources === 'object' ? sources as Record<string, { rows: number }> : {}; };
      const sourcesBefore = sourcesOf(before.overview), rowsBySource = Object.fromEntries(Object.entries(sourcesOf(after)).map(([source, entry]) => [source, entry.rows - (sourcesBefore[source]?.rows ?? 0)] as const).filter(([, rows]) => rows > 0));
      const sizes = after.store?.['collections'];
      const cpu = usage.cpuSeconds - before.usage.cpuSeconds, served = requests + framesOut;
      const result: StepResult = {
        players: players.length, setupSeconds: Math.round(setupSeconds), seconds: Math.round(elapsed),
        latency: Object.fromEntries(Object.entries(latency).map(([kind, samples]) => [kind, summary(samples)])), setup,
        requests, requestsPerSecond: Math.round(requests / elapsed * 10) / 10, framesIn, framesOut, errors, refusals,
        rssMb: Math.round(usage.rssMb), heapMb, cpuMsPerRequest: served ? Math.round(cpu * 1000 / served * 100) / 100 : null, cpuShare: Math.round(cpu / elapsed * 100) / 100,
        megabytesOutPerSecond: Math.round(bytesIn / elapsed / 1e5) / 10, generatorCpuShare: Math.round((process.cpuUsage(ownCpu).user + process.cpuUsage(ownCpu).system) / 1e4 / elapsed) / 100,
        rowsByTable, rowsBySource, rowsWritten, rowsPerPlayerHour: rowsWritten === null ? null : Math.round(rowsWritten / players.length * 3600 / elapsed * 10) / 10,
        collections: sizes && typeof sizes === 'object' ? sizes as Record<string, number> : {}, sessions: typeof after.sessions === 'number' ? after.sessions : null,
      };
      results.push(result);
      const show = (kind: string): string => { const s = result.latency[kind]; return s ? `${s.p50}/${s.p95}/${s.p99}` : '-'; };
      log(`\n${result.players} players · set up in ${result.setupSeconds}s · ${result.requestsPerSecond} requests/s · ${Math.round(framesOut / elapsed)} frames in/s, ${Math.round(framesIn / elapsed)} out/s (${result.megabytesOutPerSecond} MB/s) · this script ${result.generatorCpuShare} of a core · host ${result.rssMb} MB${result.heapMb === null ? '' : ` (JavaScript heap ${result.heapMb} MB)`}, ${result.cpuShare} of a core, ${result.cpuMsPerRequest} ms CPU per request or frame`);
      log(`  p50/p95/p99 ms — action ${show('action')} · life poll ${show('poll: life')} · world pulse ${show('poll: world pulse')} · civic pulse ${show('poll: civic pulse')} · social overview ${show('social overview')} · chat echo ${show('frame: chat echo')} · message ${show('frame: message sent')}`);
      log(`  set-up p50/p95 ms — session ${setup['setup: session']?.p50}/${setup['setup: session']?.p95} · social overview ${setup['setup: social overview']?.p50}/${setup['setup: social overview']?.p95} · friend answer ${setup['setup: friend answer']?.p50}/${setup['setup: friend answer']?.p95}`);
      if (result.rowsWritten !== null) log(`  rows written ${result.rowsWritten} (${result.rowsPerPlayerHour} per player-hour: ${Object.entries(rowsByTable).sort((a, b) => b[1] - a[1]).map(([table, rows]) => `${table} ${rows}`).join(', ')}) · sessions ${result.sessions}`);
      if (Object.keys(rowsBySource).length) log(`  rows by kind of work: ${Object.entries(rowsBySource).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([source, rows]) => `${source} ${rows}`).join(', ')}`);
      if (Object.keys(result.collections).length) log(`  stored collections (KB): ${Object.entries(result.collections).map(([name, bytes]) => `${name} ${Math.round(bytes / 102.4) / 10}`).join(', ')}`);
      if (Object.keys(errors).length) log(`  errors: ${Object.entries(errors).map(([code, count]) => `${code} ×${count}`).join(', ')}`);
      if (Object.keys(refusals).length) log(`  refusals: ${Object.entries(refusals).map(([code, count]) => `${code} ×${count}`).join(', ')}`);
      if (profile && settings.profile) {
        await writeFile(settings.profile, JSON.stringify(profile));
        log(`  where the host's CPU time went (self ms · share of busy time · with callees ms) — full profile in ${settings.profile}`);
        for (const line of hottest(profile)) log(`    ${String(line.selfMs).padStart(7)} ${`${line.share}%`.padStart(6)} ${String(line.totalMs).padStart(8)}  ${line.name}`);
      }
    }
    if (settings.json) await writeFile(settings.json, JSON.stringify({ settings: { ...settings, env: Object.keys(settings.env) }, results }, null, 1));
    return results;
  } finally {
    stopping = true;
    for (const player of players) { player.game?.terminate(); player.social?.terminate(); }
    await host.stop().catch(() => {});
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string): string => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
  const host = option('host', 'node');
  if (host !== 'node' && host !== 'worker') { console.error('--host is node or worker'); process.exit(1); }
  // --env NAME=value (repeatable): a setting handed to the host, such as one of the caps in docs/CAPACITY.md.
  const env: Record<string, string> = {};
  args.forEach((arg, at) => { if (arg === '--env') { const [name, ...value] = (args[at + 1] ?? '').split('='); if (name) env[name] = value.join('='); } });
  const settings: Settings = {
    host, steps: option('steps', '100,250,500').split(',').map(Number).filter((n) => Number.isSafeInteger(n) && n > 0), seconds: Number(option('seconds', '60')), port: Number(option('port', '4040')),
    actionMs: Number(option('action-ms', '30000')), moveMs: Number(option('move-ms', '10000')), chatMs: Number(option('chat-ms', '120000')), socialMs: Number(option('social-ms', '120000')),
    venueShare: Number(option('venue-share', '0.5')), venues: option('venues', 'park,library,shrine,market,beach,palms,cchub,rooftop').split(','), friends: Number(option('friends', '3')),
    setupConcurrency: Number(option('setup-concurrency', '8')), json: args.includes('--json') ? option('json', '') : null, profile: args.includes('--profile') ? option('profile', '') : null, sleepers: Number(option('sleepers', '0')), env,
  };
  await runCapacity(settings);
  process.exit(0);
}
