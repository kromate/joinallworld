import { registeredCityIds, loadCityContent } from '../src/game/cities/registry.ts';
/**
 * WORKER HOST: the Cloudflare Worker and its SQLite Durable Object — the production host.
 *
 * It builds the SAME server context as the Node host (server/server.ts; the contract is in
 * server/routes/index.ts and server/ws/index.ts) and hands it to the same route and socket registries,
 * so every endpoint, socket message and rule is the one implementation in server/** and src/game/**.
 * What is host-specific lives here and in the three files beside it:
 *   sqlite-store.ts    the main store: one SQLite transaction per write, durable before it is acknowledged
 *   sqlite-shards.ts   the world's per-local-government shards, as rows instead of files
 *   legacy-bridge.ts   the apex-only way back to the original Allworld character
 *   turn-provider.ts   relay credentials for the bounded voice test
 * What this file consumes from server/** is typed by server/types.ts; host-seam.ts holds the few shapes the Worker needs narrower or wider.
 *
 * WHAT THE HOST PROVIDES IN PLACE OF NODE'S
 *   sockets      hibernating WebSockets. What a socket carries (room, position, voice, look, what it watches) is its
 *                attachment; when the object wakes without its memory every connected socket is handed back to the
 *                modules (`restore`), and its room is re-checked against the stored life before its next message.
 *   heartbeat    an alarm every HEARTBEAT_MS while a socket is connected: an application `heartbeat` frame the
 *                browser answers with `heartbeat-ack` (a hibernating socket cannot be pinged), and the in-process
 *                'heartbeat' event the modules do their housekeeping on. With nobody connected the alarm still runs
 *                every IDLE_BEAT_MS, so mail and push that are due go out and the world registry is tidied.
 *   timers       a module's own timer (a table's clock) is an ordinary timer: while one is pending the object is not
 *                put to sleep (ctx.core.hibernates tells the table service to keep one going while a seat is taken).
 *   background   ctx.waitUntil(promise) and every `after` step keep the object up until the work has finished.
 *   keys         ctx.keyFile(name, make): the signing key and the push keys are rows of `host_keys` in the object's
 *                own storage, made once. Never in a response, a log or the game's collections.
 *   pages        ctx.pages (/s/<code>, /e/…): the Worker sends those paths here; the fixed page headers are the host's.
 *   outside      ctx.env(name) answers for the same allowlist; ctx.fetch is https-only, bounded to 15 s and refuses a
 *                redirect (the runtime cannot be told to fail on one, so it is not followed and the answer is rejected).
 *   operator     /api/mod/* exists only when the MODERATOR_TOKEN secret is set (24–512 printable characters); the
 *                bearer token is compared by digest, in constant time. Unset: no operator surface, as on Node.
 * The differences a client can see are listed in src/types/protocol.ts (`WORKER:`) and deploy/RECOVERY-ADAPTER.md.
 */
import { DurableObject } from 'cloudflare:workers';
import { oldCharacterLanding } from './legacy-bridge.ts';
import { siteFile } from '../server/site-files.ts';
import { createSqliteStore } from './sqlite-store.ts';
import { LIMITER_CAPS, limiterBatch, limiterClass, type LimiterClass } from '../server/limiter.ts';
import { sqliteShardBackend } from './sqlite-shards.ts';
import { relayTestAuthorized, mintCloudflareIce, TURN_DAILY_MINT_LIMIT } from './turn-provider.ts';
import { buildRoutes, ROUTE_MODULES } from '../server/routes/index.ts';
import { buildSocketHandlers } from '../server/ws/index.ts';
import { executeCommand } from '../server/routes/core.ts';
import { createOnce } from '../server/routes/once.ts';
import { createShardStoreOn } from '../server/world/shard-core.ts';
import * as worldRegistry from '../server/world/registry.ts';
import { createServerTelemetry } from '../server/telemetry/index.ts';
import { readTelemetryConfig } from '../server/telemetry/config.ts';
import { appHeaders, apiHeaders, pageHeaders, inlineScriptHashes, telemetryOrigins, factsOfUrl } from '../server/security-headers.ts';
import telemetryRoutes from '../server/telemetry/routes.ts';
import { envReader, outboundFetch, sessionArchiver, lifeAuthority, routeHeaders, pageFor, cleanOrigin, cleanHost, absolutePreviewImage, validOperatorToken, bearerToken, accountsConfig, founderEmailHash, sessionCookie, isStrictOrigin, presentedSession, mayBind } from '../server/host-context.ts';
import { SESSION_TTL_MS, ACTION_WINDOW_MS, UUID_PATTERN, protocolError, publicSession, isSameOrigin, renewSession, renewResolved, sessionOfCookie, collection, canOccupyVenue, STUN_ONLY_CONFIG, validateVoiceConfig } from '../server/protocol.ts';
import type { CityId, HeartbeatFrame, ServerFrame, SocketErrorCode } from '../src/types/protocol.ts';
import type { AccountDeviceRecord, Db, HttpError, IncomingFrame, PageHandler, RouteContext, RouteResult, RouteTable, ServerEvents, SessionRecord, ShardStore, WsDispatch } from '../server/types.ts';
import type { HostSocket, SocketInfo, SqliteStore, WorkerRequest } from './host-seam.ts';

/** How often connected sockets are asked for a sign of life, and how often the object wakes with nobody connected. */
const HEARTBEAT_MS = 10000, IDLE_BEAT_MS = 300000;
/** Path prefixes outside /api/ that a module may serve as an HTML page (ctx.pages). The Worker sends these to the object. */
const PAGE_PREFIXES = ['/s/', '/e/'];
/** A socket's attachment may hold 2,048 bytes. */
const ATTACHMENT_BYTES = 2000;
/** The limiter's tables, one per class (server/limiter.ts). */
const RATE_TABLES: Record<LimiterClass, string> = { short: 'rate_limits', long: 'rate_limits_long', protected: 'rate_limits_protected' };

/** Response headers from a plain record; a header given as a list (two Set-Cookie lines) is sent as that many headers. */
function headersOf(headers: Record<string, string | string[]>): Headers {
  const out = new Headers();
  for (const [name, value] of Object.entries(headers)) for (const line of [value].flat()) out.append(name, line);
  return out;
}
const json = (status: number, value: unknown, headers: Record<string, string | string[]> = {}): Response => new Response(JSON.stringify(value), { status, headers: headersOf({ 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }) });
/** The session cookie the request presented (host-context.ts: `__Host-sid`, or a lone legacy `sid`). */
const cookieId = (request: Request): string | undefined => presentedSession(request.headers.get('cookie')).value;
/** The session cookie (host-context.ts sessionCookie): `__Host-sid`, always Secure here. An empty value removes it. `request`: a cookie it carried under the old name is removed with it. */
const cookie = (secret: string, request?: Request): string | string[] => sessionCookie(secret, SESSION_TTL_MS / 1000, true, request ? presentedSession(request.headers.get('cookie')).hadLegacy : false);
/** Reached over https (always, when deployed): an Origin naming this host must then be https too. */
const overHttps = (url: URL): boolean => url.protocol === 'https:';
const digest = async (value: string): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
/** Compare two digests of equal length without stopping at the first difference. */
function sameDigest(a: unknown, b: unknown): boolean { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
const firstLine = (error: unknown): string => { try { return String((error as { message?: unknown } | null | undefined)?.message ?? error).split('\n')[0]?.slice(0, 300) ?? ''; } catch { return 'unprintable error'; } };
function addressBucket(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [left, right = ''] = ip.toLowerCase().split('::');
  const start = left ? left.split(':') : [], end = right ? right.split(':') : [];
  return [...start, ...Array(Math.max(0, 8 - start.length - end.length)).fill('0'), ...end].slice(0, 4).map(part => parseInt(part || '0', 16).toString(16)).join(':');
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw protocolError(415, 'json_required');
  const reader = request.body?.getReader();
  if (!reader) throw protocolError(400, 'invalid_json');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 8192) { await reader.cancel(); throw protocolError(413, 'body_too_large'); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    return body as Record<string, unknown>;
  } catch { throw protocolError(400, 'invalid_json'); }
}
/** The origin written into absolute links: PUBLIC_ORIGIN when the operator set it, otherwise the request's own host. */
function publicOrigin(env: WorkerEnv, url: URL): string {
  const configured = cleanOrigin(env.PUBLIC_ORIGIN);
  if (configured) return configured;
  const host = cleanHost(url.host);
  return host ? `${url.protocol}//${host}` : '';
}

/** JSON answers (the API, and the errors of the page routes) are for this site's own pages only, and HTTPS is remembered for a year. */
function sealJson(response: Response, url: URL): Response {
  if (response.status === 101 || !response.headers.get('content-type')?.includes('application/json')) return response;
  const sealed = new Response(response.body, response);
  sealed.headers.set('cross-origin-resource-policy', 'same-origin');
  const { 'Strict-Transport-Security': hsts } = apiHeaders(factsOfUrl(url));
  if (hsts) sealed.headers.set('strict-transport-security', hsts);
  return sealed;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return sealJson(await respond(request, env), new URL(request.url));
  },
};

async function respond(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = () => env.JOINALLWORLD.getByName('joinallworld-v1');
  if (url.pathname.startsWith('/api/') || url.pathname === '/socket') {
    // Operator routes authenticate with a bearer token in a header, which a browser never attaches by itself, so
    // they are not tied to the page's origin. Every other route keeps the origin check.
    const operator = url.pathname.startsWith('/api/mod/');
    if (!operator && !isSameOrigin(request.headers.get('origin'), url.host, { requireOrigin: url.pathname === '/socket', secure: overHttps(url) })) return json(403, { error: 'origin_rejected' });
    return state().fetch(request);
  }
  const paged = PAGE_PREFIXES.some(prefix => url.pathname.startsWith(prefix));
  if (!['GET', 'HEAD'].includes(request.method) && !(paged && request.method === 'POST')) return json(405, { error: 'method_not_allowed' });
  let assetPath;
  try { assetPath = decodeURIComponent(url.pathname); } catch { return json(400, { error: 'invalid_path' }); }
  if (assetPath.endsWith('.map')) return json(404, { error: 'not_found' });
  if (url.pathname === '/old-character.html') {
    if (url.origin !== 'https://joinallworld.com') return json(404, { error: 'not_found' });
    return oldCharacterLanding(request.method === 'HEAD');
  }
  if (paged) {
    // A page a module serves (the link preview /s/<code>, the e-mail pages /e/…). A prefix that renders nothing is
    // not a page: a GET falls through to the game, a POST has nowhere else to go.
    const page = await state().fetch(request);
    if (page.headers.get('x-allworld-page') !== 'none') return page;
    if (request.method === 'POST') return json(405, { error: 'method_not_allowed' });
  }
  // The manifest and the sitemap are made by code (server/site-files.ts), not shipped as assets: the release package admits neither extension.
  const site = siteFile(url.pathname, publicOrigin(env, url));
  if (site) return new Response(request.method === 'HEAD' ? null : site.body, { status: 200, headers: { 'content-type': site.type, 'x-content-type-options': 'nosniff' } });
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  // A hashed build file that is gone (an old tab after a deploy): the binding's single-page fallback answers index.html, which a
  // dynamic import cannot use. Under /assets/ that is a 404, never the page.
  const inAssets = assetPath.startsWith('/assets/');
  if (inAssets && (response.status === 404 || response.headers.get('content-type')?.includes('text/html'))) {
    return new Response(request.method === 'HEAD' ? null : 'Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }
  if (inAssets && response.status === 200) headers.set('cache-control', 'public, max-age=31536000, immutable'); // hashed: the name changes when the content does
  if (!headers.get('content-type')?.includes('text/html')) return new Response(response.body, { status: response.status, headers });
  headers.set('cache-control', 'no-cache');
  // The game's page carries the full set of security headers; its inline scripts are admitted by hash, from the page as
  // served. A HEAD answer has no body to hash, so the same page is read with a GET.
  const head = request.method === 'HEAD';
  const text = await (head ? await env.ASSETS.fetch(new Request(request.url, { method: 'GET' })) : response).text();
  for (const [name, value] of Object.entries(appHeaders({ ...factsOfUrl(url), scriptHashes: await inlineScriptHashes(text), telemetry: telemetryOrigins(readTelemetryConfig(env, { buildId: env.BUILD_ID })), accounts: accountsConfig(env) }))) headers.set(name, value);
  if (head || response.status !== 200) return new Response(head ? null : text, { status: response.status, headers });
  // The game's own page: its default link-preview image is made absolute, because the crawlers of chat apps do not
  // resolve a relative og:image. The length changes, so the asset's own validators no longer describe the body.
  for (const name of ['content-length', 'etag']) headers.delete(name);
  return new Response(absolutePreviewImage(text, publicOrigin(env, url)), { status: 200, headers });
}

/** Declared here, not in host-seam.ts: it names Workers runtime globals the Node test projects do not have. */
/** The bindings and variables of the Worker (wrangler.jsonc, plus secrets and the outreach/voice settings the host may read). */
export interface WorkerEnv {
  JOINALLWORLD: DurableObjectNamespace
  ASSETS: Fetcher
  BUILD_ID?: string
  PUBLIC_ORIGIN?: string
  MODERATOR_TOKEN?: string
  VOTES_PER_ADDRESS?: string
  VOTE_CAP_MODE?: string
  TURN_KEY_ID?: string
  TURN_API_TOKEN?: string
  TURN_TEST_PUBLIC_IDS?: string
  /** The sign-in provider's public client configuration (server/host-context.ts accountsConfig). Unset: accounts are off. */
  ACCOUNTS_FIREBASE_PROJECT_ID?: string
  ACCOUNTS_FIREBASE_API_KEY?: string
  ACCOUNTS_GOOGLE_CLIENT_ID?: string
  /** Replaces the built-in founder hash; empty: no founder (server/host-context.ts founderEmailHash). */
  FOUNDER_EMAIL_SHA256?: string
  [name: string]: unknown
}

type Inbound = string | ArrayBuffer;
interface ChatRecord { id: string; at: number; bodyHash?: string }
interface VoiceConfig { iceServers: unknown; turnConfigured: boolean; mode: string; expiresAt?: number }

export class JoinAllworldState extends DurableObject<WorkerEnv> {
  sql: SqlStorage;
  peers: Map<WebSocket, HostSocket>;
  inflight: Map<WebSocket, Promise<void>>;
  telemetry: ReturnType<typeof createServerTelemetry>;
  booted: boolean;
  store: SqliteStore;
  shards: ShardStore;
  rateCleanupAt: number;
  operatorDigest: Promise<string> | null;
  context: RouteContext;
  handlers: WsDispatch;
  routes: RouteTable;
  ready: Promise<void>;
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env); this.env = env; this.sql = ctx.storage.sql; this.peers = new Map(); this.inflight = new Map();
    const now = () => Date.now();
    const log = (line: unknown): void => { try { console.error(String(line).slice(0, 500)); } catch { /* a failing logger changes nothing */ } };
    const buildId = String(env.BUILD_ID || 'unreleased').slice(0, 40);
    this.telemetry = createServerTelemetry({ env, buildId });
    this.booted = false;
    // THE DURABILITY BARRIER: every acknowledged write has passed storage.sync(). While the object is starting nothing can
    // be acknowledged (no request is being answered, and the runtime holds every response until its writes are confirmed),
    // and the barrier cannot be waited for inside blockConcurrencyWhile — so start-up writes go without it.
    const barrier = () => (this.booted ? ctx.storage.sync() : Promise.resolve());
    this.store = createSqliteStore(ctx.storage, { barrier });
    // The world registry: one append-only shard per local government, as rows beside the main tables (sqlite-shards.ts).
    this.shards = createShardStoreOn(sqliteShardBackend(ctx.storage, { barrier }), { empty: worldRegistry.empty, reduce: worldRegistry.reduce, snapshot: worldRegistry.snapshot, loaded: worldRegistry.loaded, live: worldRegistry.live, log }) as ShardStore;
    this.sql.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, started_at INTEGER NOT NULL, count INTEGER NOT NULL)');
    if (!this.sql.exec('PRAGMA table_info(rate_limits)').toArray().some(column => column['name'] === 'expires_at')) this.sql.exec('ALTER TABLE rate_limits ADD COLUMN expires_at INTEGER');
    this.sql.exec('UPDATE rate_limits SET expires_at = started_at + 60000 WHERE expires_at IS NULL');
    // The limiter's rows are bounded per class (server/limiter.ts): short windows in rate_limits, long windows and the keys that
    // are never dropped (the operator's guard, account sign-in) each in a table of their own. Each is indexed by expiry.
    for (const table of Object.values(RATE_TABLES)) {
      if (table !== 'rate_limits') this.sql.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, started_at INTEGER NOT NULL, count INTEGER NOT NULL, expires_at INTEGER)`);
      this.sql.exec(`CREATE INDEX IF NOT EXISTS ${table}_expiry ON ${table}(expires_at)`);
    }
    this.sql.exec('CREATE TABLE IF NOT EXISTS turn_budget (day TEXT PRIMARY KEY, issued INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chat_receipts (sender TEXT NOT NULL, room TEXT NOT NULL, client_id TEXT NOT NULL, at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,room,client_id))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS host_keys (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.rateCleanupAt = 0;
    // The operator token never leaves this closure: only its digest is kept. Unset or too short = no operator surface.
    const operatorToken = validOperatorToken(env.MODERATOR_TOKEN) ? env.MODERATOR_TOKEN as string : null;
    this.operatorDigest = operatorToken ? digest(operatorToken) : null;
    const votesPerAddress = Number(env.VOTES_PER_ADDRESS ?? 3), capMode = env.VOTE_CAP_MODE || 'flag';
    if (!Number.isSafeInteger(votesPerAddress) || votesPerAddress < 0) throw new Error('Invalid VOTES_PER_ADDRESS');
    if (capMode !== 'flag' && capMode !== 'refuse') throw new Error('Invalid VOTE_CAP_MODE (use "flag" or "refuse")');
    const voteCapMode = capMode;

    type Listener = (data: ServerEvents[keyof ServerEvents]) => void;
    const listeners = new Map<keyof ServerEvents, Listener[]>();
    const receipts = createOnce({ now, windowMs: ACTION_WINDOW_MS });
    const { settle, act, playerAct } = lifeAuthority({ now, receipts });
    const keys = new Map<string, Promise<object>>();
    const unresponsive = (ws: HostSocket): boolean => ws.pingedAt > 0 && !ws.alive && now() - ws.pingedAt >= HEARTBEAT_MS / 2;
    const open = (): HostSocket[] => [...this.peers.values()].filter(ws => ws.readyState === 1);
    const context: RouteContext = this.context = {
      store: this.store, shards: this.shards, now, fail: protocolError, collection, publicSession, cityIds: registeredCityIds(), telemetry: this.telemetry,
      randomId: () => crypto.randomUUID(),
      allow: (key: string, count = 120, windowMs = 60000) => this.allow(key, count, windowMs),
      peek: (key: string, count = 120) => this.peek(key, count),
      send: (ws, message) => this.sendFrame(ws as HostSocket, message),
      on(event, fn) { let list = listeners.get(event); if (!list) listeners.set(event, list = []); list.push(fn as Listener); },
      emit(event, value) { for (const fn of listeners.get(event) || []) { try { fn(value); } catch (error) { log(`Listener for ${event} failed: ${firstLine(error)}`); } } },
      settle, act,
      // One game action for the caller, exactly once, with everything it changed saved together (routes/core.ts).
      command: (request, body, options) => executeCommand(context, request, body, options),
      once: receipts.once, onceId: receipts.onceId,
      push: (id, message) => { let count = 0; for (const ws of open()) if (ws.session.id === id) { context.send(ws, message); count++; } return count; },
      online: (id) => open().some(ws => ws.session.id === id && !unresponsive(ws)),
      atHome(db, id, city) {
        if (!registeredCityIds().includes(city)) return false;
        const found = context.core.sessionByPublicId(db, id), state = found && found.expiresAt > now() ? found.cities?.[city as CityId]?.state : undefined;
        return Boolean(state) && canOccupyVenue(state, 'home');
      },
      checks: {},
      pages: new Map(),
      env: envReader(env),
      // The Workers runtime cannot be told to fail on a redirect: it is not followed, and the answer is refused (host-context.js).
      fetch: outboundFetch((url: string, init?: RequestInit) => fetch(url, init), { refuseRedirect: 'manual' }),
      /** A secret this host makes for itself, once: a row of `host_keys` in the object's own storage. Never logged. */
      keyFile: <T extends object>(name: string, make: () => T | Promise<T>): Promise<T> => {
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) return Promise.reject(new Error('Invalid key file name'));
        if (!keys.has(name)) keys.set(name, (async (): Promise<T> => {
          const row = this.sql.exec('SELECT value FROM host_keys WHERE name = ?', name).toArray()[0];
          if (row) return JSON.parse(row['value'] as string) as T;
          const value = await make();
          this.sql.exec('INSERT INTO host_keys(name,value) VALUES(?,?) ON CONFLICT(name) DO NOTHING', name, JSON.stringify(value));
          await barrier();
          return JSON.parse((this.sql.exec('SELECT value FROM host_keys WHERE name = ?', name).toArray()[0] as { value: string }).value) as T;
        })().catch(error => { keys.delete(name); throw error; }));
        return keys.get(name) as Promise<T>;
      },
      // Work that outlives the request that started it: the object stays up until it has finished.
      waitUntil: (promise) => { try { ctx.waitUntil(Promise.resolve(promise).catch(() => {})); } catch { /* not in a request */ } },
      config: { accounts: accountsConfig(env), founderEmailSha256: founderEmailHash(env), publicOrigin: cleanOrigin(env.PUBLIC_ORIGIN), sessionTtlMs: SESSION_TTL_MS, actionWindowMs: ACTION_WINDOW_MS, maxActiveSessions: 10000, buildId, votesPerAddress, voteCapMode, heartbeatMs: HEARTBEAT_MS, moderation: Boolean(operatorToken) },
      startup: registeredCityIds().map(loadCityContent),
      // Nothing stops a Durable Object in an orderly way: every write is durable when it is acknowledged, and work in
      // flight is covered by waitUntil. The list exists so a module can register without asking which host it is on.
      closing: [],
      core: {
        archiveSession: sessionArchiver({ now, randomId: () => crypto.randomUUID() }),
        expiredSessionKeys: (db: Db) => db.$store!.scanSessions(s => !s.publicId || !Number.isFinite(s.expiresAt) || s.expiresAt <= now()),
        sessionByPublicId: (db: Db, id: string) => { const key = db.$store!.sessionKeyByPublicId(id); return key === undefined ? undefined : db.sessions[key]; },
        unresponsive,
        storeStats: () => this.store.stats(),
        newIdentity: () => ({ secret: crypto.randomUUID(), publicId: crypto.randomUUID() }),
        newId: () => crypto.randomUUID(),
        cookieHeader: (request, secret: string) => cookie(secret, request.raw as Request),
        clearCookieHeader: (request) => cookie('', request.raw as Request),
        closeSocket: (ws, code, reason) => { const peer = ws as HostSocket; peer.close(code, reason); this.release(peer); },
        sockets: open,
        isOpen: (ws: HostSocket) => ws.readyState === 1,
        sessionOf: (ws: HostSocket, db: Db) => db.sessions[ws.secret],
        playerAct,
        actionOnce: receipts.action,
        storageFailing: () => this.store.stats().failing === true,
        log,
        // This host forgets what is in memory when nothing is pending: a module that must not lose a seat keeps a timer going.
        hibernates: true,
        // Venue chat retry receipts survive a sleep: an id, a time and a digest of the body — never the text (ws/rooms.js).
        chatHistory: (ws: HostSocket, body: unknown) => this.chatHistory(ws, body),
        // Replaced by the socket registry (ws/index.js) for the modules that are registered.
        validateMemberships: async () => {}, refreshNames: () => {}, roomStillValid: () => false, revalidate: async () => {},
      },
    };
    this.handlers = buildSocketHandlers(context);
    this.routes = buildRoutes(context, [...ROUTE_MODULES, telemetryRoutes]);
    this.telemetry.attach(context);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      await Promise.all(context.startup.splice(0));
      for (const socket of ctx.getWebSockets()) { const info = socket.deserializeAttachment(); if (info && !info.closed) this.handlers.restore(this.wrap(socket, info)); }
      // Rotate credentials created by versions that exposed the cookie as a public ID, and archive what has expired.
      await this.store.transact(db => { for (const secret of context.core.expiredSessionKeys(db)) { const expired = db.sessions[secret]; if (expired) context.core.archiveSession(db, secret, expired); } });
      if (await ctx.storage.getAlarm() === null) await ctx.storage.setAlarm(Date.now() + (this.peers.size ? HEARTBEAT_MS : IDLE_BEAT_MS));
    }).then(() => { this.booted = true; });
  }
  /**
   * ctx.allow (server/limiter.ts). Rows are bounded per class, each class in its own table; a full table drops the rows that
   * expire soonest to make room, so whoever filled it cannot turn newcomers away or erase another class. The protected class
   * (operator and account keys) is never dropped from: when it is full of live rows a new key of it is refused.
   * The row count of a full-table check is a COUNT(*) per NEW key; it is only paid when the key is new, and is left as it is.
   */
  allow(key: string, count: number, windowMs = 60000): boolean {
    const now = Date.now(), kind = limiterClass(key, windowMs), table = RATE_TABLES[kind], cap = LIMITER_CAPS[kind];
    if (now >= this.rateCleanupAt) { for (const name of Object.values(RATE_TABLES)) this.sql.exec(`DELETE FROM ${name} WHERE expires_at <= ?`, now); this.rateCleanupAt = now + 60000; }
    const old = this.sql.exec<{ started_at: number; count: number; expires_at: number }>(`SELECT started_at,count,expires_at FROM ${table} WHERE key = ?`, key).toArray()[0];
    const size = (): number => this.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).one().count;
    if (!old && size() >= cap) {
      this.sql.exec(`DELETE FROM ${table} WHERE expires_at <= ?`, now);
      const over = size() - cap;
      if (over >= 0) {
        if (kind === 'protected') return false;
        this.sql.exec(`DELETE FROM ${table} WHERE key IN (SELECT key FROM ${table} ORDER BY expires_at LIMIT ?)`, over + limiterBatch(cap));
      }
    }
    const active = old && old.expires_at > now, next = active ? old.count + 1 : 1;
    this.sql.exec(`INSERT INTO ${table}(key,started_at,count,expires_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET started_at=excluded.started_at,count=excluded.count,expires_at=excluded.expires_at`, key, active ? old.started_at : now, next, active ? old.expires_at : now + windowMs);
    return next <= count;
  }
  /** ctx.peek: would allow(key, count) pass now? Reads the key's row in whichever table holds it; writes nothing. */
  peek(key: string, count: number): boolean {
    for (const table of Object.values(RATE_TABLES)) {
      const old = this.sql.exec<{ count: number; expires_at: number }>(`SELECT count,expires_at FROM ${table} WHERE key = ?`, key).toArray()[0];
      if (old) return old.expires_at > Date.now() ? old.count < count : true;
    }
    return true;
  }
  wrap(socket: WebSocket, info: SocketInfo): HostSocket {
    const ws: HostSocket = { ...info, voice: info.voice || { enabled: false, muted: true }, position: info.position || { x: 0, z: 0 }, lastMoves: info.lastMoves || [], look: info.look ?? null, stale: false, guestUntil: 0,
      get readyState() { return this.closed ? 3 : socket.readyState; },
      send: (data: string) => socket.send(data), close: (code = 1000, reason = '') => { ws.closed = true; try { socket.close(code, reason); } catch { /* already closed */ } }, socket };
    this.peers.set(socket, ws); return ws;
  }
  /** To one socket, if it is open: the frames the shared modules send, plus the Worker's own application heartbeat. */
  sendFrame(ws: HostSocket, message: ServerFrame | HeartbeatFrame): void {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(message)); this.telemetry.socketOut(ws, message); } catch { /* the socket went away */ }
  }
  /** Write what each socket carries into its attachment, so it survives a sleep. Too large (a long look): the look is what goes. */
  saveSockets(): void {
    for (const [socket, ws] of this.peers) {
      const { socket: ignored, send: ignoredSend, close: ignoredClose, readyState: ignoredReady, released: ignoredReleased, ...info } = ws;
      try {
        if (JSON.stringify(info).length > ATTACHMENT_BYTES) { info.look = null; info.lastMoves = []; }
        socket.serializeAttachment(info);
      } catch { try { socket.serializeAttachment({ secret: ws.secret, ...(ws.device !== undefined ? { device: ws.device } : {}), session: ws.session, expiresAt: ws.expiresAt, ip: ws.ip, room: ws.room ?? null, closed: ws.closed === true, alive: ws.alive, pingedAt: ws.pingedAt, seenAt: ws.seenAt, lastSessionRenewedAt: ws.lastSessionRenewedAt, position: ws.position, voice: ws.voice }); } catch { /* the socket is gone */ } }
    }
  }
  /** Tell the modules a socket is gone — once, however many ways its end was noticed (an expiry, an alarm, the close event). */
  release(ws: HostSocket): void { if (ws.released) return; ws.released = true; ws.closed = true; this.telemetry.socketClosed(ws); this.handlers.close(ws); }
  /** Whose session the presented cookie is — a guest's own record, or the character of the account a signed-in browser is bound to (protocol.ts sessionOfCookie). */
  session(request: WorkerRequest, db: Db, renew = false): SessionRecord | undefined {
    const found = sessionOfCookie(db, request.cookie, Date.now(), request.binding !== undefined);
    if (!found) return undefined;
    if (renew) renewResolved(found, Date.now());
    request.secret = found.session.secret;
    return found.session;
  }
  /** The stored session a socket was opened under, with its device binding — undefined once either is gone (signed out, moved, expired). */
  socketSession(db: Db, ws: HostSocket): { session: SessionRecord; device?: AccountDeviceRecord } | undefined {
    if (ws.device === undefined || ws.device === ws.secret) { const s = db.sessions[ws.secret]; return s && s.account === undefined && s.expiresAt > Date.now() ? { session: s } : undefined; }
    const found = sessionOfCookie(db, ws.device, Date.now());
    return found && found.session.secret === ws.secret ? found : undefined;
  }
  override async fetch(raw: Request): Promise<Response> {
    await this.ready;
    const url = new URL(raw.url);
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/socket') return this.page(raw, url);
    let at: { key: string; request: WorkerRequest; began: number } | undefined;
    try {
      const secret = cookieId(raw), now = Date.now();
      const ip = await digest(addressBucket(raw.headers.get('cf-connecting-ip') || 'unknown'));
      const operator = url.pathname.startsWith('/api/mod/');
      if (!operator && !isSameOrigin(raw.headers.get('origin'), url.host, { requireOrigin: url.pathname === '/socket', secure: overHttps(url) })) throw protocolError(403, 'origin_rejected');
      // True only for a request carrying the operator's bearer token (never a cookie or a query value).
      const bearer = this.operatorDigest ? bearerToken(raw.headers.get('authorization')) : null;
      const moderator = bearer !== null && sameDigest(await digest(bearer), await this.operatorDigest);
      // `secret` becomes the stored session's key once session() resolves it; `cookie` stays what the browser presented.
      const request: WorkerRequest = { method: raw.method, path: url.pathname, query: url.searchParams, ip, secret, cookie: secret, binding: mayBind(presentedSession(raw.headers.get('cookie')), true), params: {}, raw,
        strictOrigin: isStrictOrigin(raw.headers.get('origin'), url.host, raw.headers.get('sec-fetch-site'), overHttps(url)),
        moderator: () => moderator, json: () => bodyOf(raw).then(body => (request.body = body)),
        session: (db, options = {}) => { const s = this.session(request, db, options.renew); if (s) request.publicId = s.publicId; return s; },
        requireSession: (db, options = {}) => { const s = request.session(db, options); if (!s) throw protocolError(401, 'device_session_required'); return s; } };
      if (url.pathname === '/socket') return await this.upgrade(raw, request);
      // A request carrying the operator's token has its own budget (routes/moderation.js); everyone else is limited per
      // session once they have one, and per address before that.
      if (!(operator && moderator)) {
        const id = await this.store.read(db => request.session(db)?.publicId);
        if (!this.allow(id ? `http:session:${id}` : `http-ip:${ip}`, id ? 600 : 60)) throw protocolError(429, 'rate_limited');
      }
      if (url.pathname === '/api/voice-config' && raw.method === 'GET') return await this.voiceConfig(request);
      const route = this.routes.match(raw.method, url.pathname); if (!route) throw protocolError(404, 'not_found'); request.params = route.params;
      at = { key: route.key, request, began: performance.now() };
      // ROOM REVALIDATION, for every route and every outcome (as on Node): before the request is answered, every room
      // the caller's sockets are in is re-checked against the STORED lives.
      let returned: RouteResult | void;
      try { returned = await route.handler(request); }
      finally { for (const publicId of new Set([...this.peers.values()].filter(ws => ws.secret === request.secret && ws.room && ws.readyState === 1).map(ws => ws.session.id))) await this.context.core.revalidate(publicId); }
      const result: RouteResult = returned && typeof returned === 'object' ? returned : {}, status = result.status || 200;
      this.telemetry.http({ method: raw.method, route: route.key, status, ms: performance.now() - at.began, publicId: request.publicId, body: result.body, action: { type: request.body?.['type'], code: (result.body as { code?: unknown } | undefined)?.code } });
      const plain = result.body && typeof result.body === 'object' && !Array.isArray(result.body);
      const body: Record<string, unknown> = status < 300 && (plain || result.body === undefined) ? { ...(result.body as object || {}), serverTime: Date.now(), ...(this.context.core.storageFailing() ? { storage: 'failing' } : {}) } : (result.body ?? {}) as Record<string, unknown>;
      if (url.pathname === '/api/health') Object.assign(body, { transport: 'cloudflare', buildId: this.context.config.buildId });
      if (result.renew === true) for (const ws of this.peers.values()) if (ws.secret === request.secret) { ws.expiresAt = now + SESSION_TTL_MS; ws.lastSessionRenewedAt = now; }
      this.saveSockets();
      // `after` runs once the answer is on its way. Whatever it does, the request is already answered.
      const after = result.after;
      if (typeof after === 'function') this.ctx.waitUntil(Promise.resolve().then(() => after()).then(() => this.saveSockets()).catch(error => this.context.core.log(`After-response step of ${raw.method} ${route.key} failed: ${firstLine(error)}`)));
      // A guest whose session arrived under the old cookie name gets it back under the new one with this answer.
      const upgrade = request.publicId !== undefined && presentedSession(raw.headers.get('cookie')).legacy;
      return json(status, body, { ...(result.renew === true || upgrade ? { 'Set-Cookie': cookie(secret as string, raw) } : {}), ...routeHeaders(result.headers) });
    } catch (thrown) {
      const error = (thrown && typeof thrown === 'object' ? thrown : { message: thrown }) as Partial<HttpError>;
      const known = Number.isInteger(error.status) && typeof error.code === 'string';
      // Only the first line of the message is logged: never a header, a cookie or a body.
      if (!known) this.context.core.log(`Request failed: ${firstLine(error)}`);
      this.telemetry.httpFailed(thrown, { method: raw.method, route: at?.key, status: known ? error.status as number : 500, code: known ? error.code : undefined, body: at?.request.body, publicId: at?.request.publicId });
      this.saveSockets();
      return json(known ? error.status as number : 500, { error: known ? error.code : 'internal_error', ...(known && typeof error.reason === 'string' ? { reason: error.reason } : {}), ...(known && error.code === 'city_moved' && typeof Reflect.get(error, 'city') === 'string' ? { city: Reflect.get(error, 'city') } : {}) });
    } finally { this.ctx.waitUntil(this.telemetry.flush()); }
  }
  /**
   * PAGES: one small HTML page for a path prefix outside /api/ (ctx.pages — the link preview /s/<code>, the e-mail
   * pages /e/…). The same per-address limit and telemetry (a path TEMPLATE, never the path) as a route. The page gets
   * the path, the query and the public origin — never the request, its headers or its cookie — and cannot set a header.
   */
  async page(raw: Request, url: URL): Promise<Response> {
    const none = () => new Response(null, { status: 204, headers: { 'x-allworld-page': 'none' } });
    const found = pageFor(this.context.pages ?? new Map<string, PageHandler>(), url.pathname);
    if (!found || !['GET', 'HEAD', 'POST'].includes(raw.method)) return none();
    const [prefix, render] = found, began = performance.now(), key = `${prefix}*`;
    try {
      const ip = await digest(addressBucket(raw.headers.get('cf-connecting-ip') || 'unknown'));
      // Pages have a budget of their own, so a crawler reading link previews cannot use up an address's API allowance.
      if (!this.allow(`page-ip:${ip}`, 600)) throw protocolError(429, 'rate_limited');
      // A POST to a page carries no body the page may read (the one use is an unsubscribe link: RFC 8058 posts a fixed form).
      if (raw.method === 'POST') { try { await raw.body?.cancel(); } catch { /* nothing to drain */ } }
      const page = await render({ path: url.pathname, query: url.searchParams, origin: publicOrigin(this.env, url), ip, method: raw.method });
      if (!page || typeof page.html !== 'string') return none();
      const status = typeof page.status === 'number' && Number.isInteger(page.status) && page.status >= 200 && page.status <= 599 ? page.status : 200;
      this.telemetry.http({ method: raw.method, route: key, status, ms: performance.now() - began });
      return new Response(raw.method === 'HEAD' ? null : page.html, { status, headers: { ...pageHeaders(factsOfUrl(url)), 'Cache-Control': page.cache !== false && raw.method !== 'POST' && status === 200 ? 'public, max-age=300' : 'no-store' } });
    } catch (thrown) {
      const coded = (thrown ?? {}) as Partial<HttpError>;
      const known = Number.isInteger(coded.status) && typeof coded.code === 'string';
      if (!known) this.context.core.log(`Page failed: ${firstLine(thrown)}`);
      this.telemetry.httpFailed(thrown, { method: raw.method, route: key, status: known ? coded.status as number : 500, code: known ? coded.code : undefined });
      return json(known ? coded.status as number : 500, { error: known ? coded.code : 'internal_error' });
    } finally { this.ctx.waitUntil(this.telemetry.flush()); }
  }
  async voiceConfig(request: WorkerRequest): Promise<Response> {
    const session = await this.store.transact(db => {
      const s = request.requireSession(db, { renew: true });
      if (!this.liveRoom(s, db)) throw protocolError(403, 'room_membership_required');
      return publicSession(s);
    });
    if (!this.allow(`voice-config:${session.id}`, 6)) throw protocolError(429, 'voice_config_rate_limited');
    let config: VoiceConfig = STUN_ONLY_CONFIG;
    if (relayTestAuthorized(this.env, session.id)) {
      this.ctx.storage.transactionSync(() => { const day = new Date().toISOString().slice(0, 10), used = this.sql.exec<{ issued: number }>('SELECT issued FROM turn_budget WHERE day = ?', day).toArray()[0]?.issued || 0; if (used >= TURN_DAILY_MINT_LIMIT) throw protocolError(429, 'relay_test_limit'); this.sql.exec('INSERT INTO turn_budget(day,issued) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET issued=excluded.issued', day, used + 1); });
      try { config = validateVoiceConfig(await mintCloudflareIce(this.env), Date.now()); } catch { throw protocolError(503, 'voice_config_unavailable'); }
      await this.store.read(db => { const s = request.requireSession(db); if (!this.liveRoom(s, db)) throw protocolError(403, 'room_membership_required'); });
    }
    return json(200, { ...config, radius: 12, serverTime: Date.now() }, { 'Set-Cookie': cookie(request.cookie as string, request.raw) });
  }
  liveRoom(session: SessionRecord, db: Db): boolean {
    return [...this.peers.values()].some(ws => ws.session.id === session.publicId && ws.readyState === 1 && ws.room && ws.expiresAt > Date.now() && !this.context.core.unresponsive(ws) && this.context.core.roomStillValid(ws, db, session, ws.room.split(':')[0] as string, this.context.settle(session, ws.room.split(':')[0] as CityId)));
  }
  async upgrade(raw: Request, request: WorkerRequest): Promise<Response> {
    if (raw.headers.get('upgrade')?.toLowerCase() !== 'websocket' || raw.method !== 'GET') throw protocolError(403, 'websocket_required');
    if (!this.allow(`upgrade:${request.ip}`, 60)) throw protocolError(429, 'rate_limited');
    // `secret` is the stored record's key; `device` is the cookie the browser presented, the only value ever sent back to it.
    const info = await this.store.transact(db => { const s = request.requireSession(db, { renew: true }); return { secret: s.secret as string, device: request.cookie as string, session: publicSession(s), expiresAt: s.expiresAt }; });
    const peers = [...this.peers.values()].filter(ws => ws.readyState === 1);
    if (peers.length >= 1024 || peers.filter(ws => ws.secret === info.secret).length >= 8 || peers.filter(ws => ws.ip === request.ip).length >= 32) throw protocolError(503, 'socket_capacity');
    const pair = new WebSocketPair(), socket = pair[1]; this.ctx.acceptWebSocket(socket);
    const ws = this.wrap(socket, { ...info, ip: request.ip, room: null, closed: false, alive: true, pingedAt: 0, seenAt: Date.now(), lastSessionRenewedAt: Date.now() });
    this.handlers.open(ws); this.saveSockets();
    // Never postpone a beat that is already due; bring an idle one forward now that somebody is connected.
    const due = await this.ctx.storage.getAlarm();
    if (due === null || due > Date.now() + HEARTBEAT_MS) await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    return new Response(null, { status: 101, webSocket: pair[0], headers: headersOf({ 'Set-Cookie': cookie(info.device, raw) }) });
  }
  chatHistory(ws: HostSocket, body: unknown) {
    this.sql.exec('DELETE FROM chat_receipts WHERE at < ?', Date.now() - 86400000);
    const rows = this.sql.exec<{ client_id: string; value: string }>('SELECT client_id,value FROM chat_receipts WHERE sender=? AND room=? ORDER BY at,rowid', ws.session.id, ws.room).toArray();
    const records = new Map<string, ChatRecord>(rows.map(row => [row.client_id, JSON.parse(row.value) as ChatRecord]));
    return {
      has: (id: string) => records.has(id), get: (id: string) => { const r = records.get(id) as ChatRecord; if (r.bodyHash !== ws.chatBodyHash) throw Error('chat_id_conflict'); return { type: 'chat', id: r.id, at: r.at, clientId: id, from: { ...ws.session }, body }; },
      set: (id: string, chat: { id: string; at: number }) => { const value = { id: chat.id, at: chat.at, bodyHash: ws.chatBodyHash }; this.sql.exec('INSERT INTO chat_receipts(sender,room,client_id,at,value) VALUES(?,?,?,?,?)', ws.session.id, ws.room, id, chat.at, JSON.stringify(value)); records.set(id, value); },
      get size() { return records.size; }, keys: () => records.keys(),
      delete: (id: string) => { this.sql.exec('DELETE FROM chat_receipts WHERE sender=? AND room=? AND client_id=?', ws.session.id, ws.room, id); records.delete(id); },
    };
  }
  override async webSocketMessage(socket: WebSocket, raw: Inbound): Promise<void> {
    await this.ready;
    const ws = this.peers.get(socket); if (!ws || ws.readyState !== 1) return;
    if (!this.allow(`ws:${ws.session.id}`, 600)) { this.sendFrame(ws, { type: 'error', code: 'rate_limited', error: 'rate_limited' }); return; }
    const before = this.inflight.get(socket) || Promise.resolve();
    const operation = before.then(() => this.message(socket, raw)); this.inflight.set(socket, operation);
    try { await operation; } finally { if (this.inflight.get(socket) === operation) this.inflight.delete(socket); }
  }
  async message(socket: WebSocket, raw: Inbound): Promise<void> {
    const ws = this.peers.get(socket); if (!ws || ws.readyState !== 1) return;
    let message: IncomingFrame | undefined;
    try {
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 16384) throw Error('invalid_message');
      try { message = JSON.parse(raw) as IncomingFrame; } catch { throw Error('invalid_message'); }
      if (!message || typeof message !== 'object') throw Error('invalid_message');
      const authenticated = await this.store.read(db => Boolean(this.socketSession(db, ws)));
      if (!authenticated || ws.expiresAt <= Date.now()) { this.context.send(ws, { type: 'error', code: 'device_session_required', error: 'device_session_required' }); ws.close(1008, 'Device session expired'); this.release(ws); return; }
      ws.alive = true; ws.seenAt = Date.now(); // any frame proves the connection is alive
      if (message.type === 'heartbeat-ack') return;
      if (Date.now() - ws.lastSessionRenewedAt >= 60000) {
        // The renewal could not be saved, so it did not happen: the socket keeps its expiry and the message is still handled.
        const expiration = await this.store.transact(db => { const found = this.socketSession(db, ws); if (!found || !renewSession(found.session, Date.now())) throw Error('device_session_required'); renewResolved(found, Date.now()); return found.session.expiresAt; }).catch((error: unknown) => { if ((error as Partial<HttpError> | null | undefined)?.code !== 'storage_unavailable') throw error; return null; });
        if (expiration !== null) for (const peer of this.peers.values()) if (peer.secret === ws.secret) { peer.expiresAt = expiration; peer.lastSessionRenewedAt = Date.now(); }
      }
      const entry = typeof message.type === 'string' ? this.handlers.messages.get(message.type) : undefined;
      // Unknown types keep their historical replies: join_required outside a room, invalid_message inside one.
      if (!entry) throw Error(ws.room ? 'invalid_message' : 'join_required'); if (entry.room && !ws.room) throw Error('join_required');
      if (message.type === 'chat') {
        const room = ws.room; const hash = await digest(typeof message.body === 'string' ? message.body.trim() : '');
        if (ws.room !== room) throw Error('venue_mismatch');
        Object.defineProperty(ws, 'chatBodyHash', { value: hash, configurable: true });
      }
      await entry.handle(ws, message);
      this.telemetry.socketIn(ws, message);
    } catch (thrown) {
      // Only a machine code goes to the client; anything else (a TypeError's text) is logged here instead. A coded
      // refusal may carry the sentence the server wrote for the player (`reason`), repeated as `message`.
      const reason = (thrown as Partial<HttpError> | null | undefined)?.reason;
      const text = firstLine(thrown), coded = /^[a-z][a-z0-9_]{1,63}$/.test(text), code = coded ? text : 'internal_error';
      if (!coded) this.context.core.log(`Socket message failed: ${text}`);
      this.telemetry.socketFailed(ws, message, code, coded, thrown);
      this.sendFrame(ws, { type: 'error', code: code as SocketErrorCode, error: code as SocketErrorCode, ...(coded && typeof reason === 'string' ? { reason, message: reason } : {}), ...(message?.type === 'signal' && typeof message.to === 'string' && UUID_PATTERN.test(message.to) && message.to !== ws.secret ? { to: message.to } : {}), ...(message?.type === 'chat' && typeof message.clientId === 'string' && message.clientId.length <= 80 ? { clientId: message.clientId } : {}) });
    }
    finally { this.saveSockets(); this.ctx.waitUntil(this.telemetry.flush()); }
  }
  override async webSocketClose(socket: WebSocket): Promise<void> { await this.ready; const ws = this.peers.get(socket); if (ws) { this.release(ws); this.peers.delete(socket); this.saveSockets(); this.ctx.waitUntil(this.telemetry.flush()); } }
  override async webSocketError(socket: WebSocket): Promise<void> { await this.webSocketClose(socket); }
  override async alarm(): Promise<void> {
    await this.ready;
    for (const ws of [...this.peers.values()]) {
      if (ws.readyState !== 1) continue;
      if (!ws.alive || ws.expiresAt <= Date.now()) { ws.close(1008, 'Session inactive'); this.release(ws); continue; }
      ws.alive = false; ws.pingedAt = Date.now(); this.sendFrame(ws, { type: 'heartbeat' });
    }
    this.context.emit('heartbeat', { now: Date.now() }); this.saveSockets();
    this.ctx.waitUntil(this.telemetry.flush());
    await this.ctx.storage.setAlarm(Date.now() + ([...this.peers.values()].some(ws => ws.readyState === 1) ? HEARTBEAT_MS : IDLE_BEAT_MS));
  }
}
