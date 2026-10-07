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
 *   heartbeat    a timer in memory every HEARTBEAT_MS while a socket is connected: an application `heartbeat` frame the
 *                browser answers with `heartbeat-ack` (a hibernating socket cannot be pinged), and the in-process
 *                'heartbeat' event the modules do their housekeeping on. The alarm runs every IDLE_BEAT_MS whoever is
 *                connected: with nobody there it is the beat (mail and push that are due go out, the world registry is
 *                tidied), and it restarts the timer of an object that lost its memory with sockets open.
 *   rows         A ROW WRITTEN IS A ROW BILLED, and an index entry is a row. So nothing is written that is not a change
 *                somebody made: short rate limits are counted in memory, the alarm is set once per IDLE_BEAT_MS and
 *                never per beat or per request, a session's expiry is pushed out a day at a time, and what a poll or a
 *                check-in changes is held in memory and written later (sqlite-store.ts LAZY). write-meter.ts counts
 *                what is written, per table and per kind of work, for the operator's overview.
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
import { ADMIN_HOST_ENV, ADMIN_ROBOTS, ADMIN_SHELL, adminAddress, adminHostName, adminHostRoute, isAdminHost } from '../server/admin/host.ts';
import { withPathMeta } from '../server/path-meta.ts';
import { createSqliteStore } from './sqlite-store.ts';
import { parseLayout } from '../server/keyed.ts';
import { createSqliteImages } from './sqlite-images.ts';
import { LIMITER_CAPS, createMemoryLimiter, limiterBatch, limiterClass, type LimiterClass } from '../server/limiter.ts';
import { sqliteShardBackend } from './sqlite-shards.ts';
import { ALARM_TABLE, createWriteMeter, type WriteMeter } from './write-meter.ts';
import type { SqliteStorage, SqlStorageLike } from './cf-types.ts';
import { createCallRelay } from '../server/call-relay.ts';
import { relayTestAuthorized, mintCloudflareIce, TURN_DAILY_MINT_LIMIT } from './turn-provider.ts';
import { buildRoutes, ROUTE_MODULES } from '../server/routes/index.ts';
import { trustHeaderConfig } from '../server/trust/config.ts';
import { createCommerceGateway } from '../server/commerce/goalmatic.ts';
import { streetAssetText } from '../server/street/asset-body.ts';
import { buildSocketHandlers } from '../server/ws/index.ts';
import { executeCommand } from '../server/routes/core.ts';
import { createOnce } from '../server/routes/once.ts';
import { createShardStoreOn } from '../server/world/shard-core.ts';
import * as worldRegistry from '../server/world/registry.ts';
import { createServerTelemetry } from '../server/telemetry/index.ts';
import '../src/game/dilemma-pack.ts'; // installs the kit of work dilemmas and place actions: every life the Worker plays has them
import '../src/game/routines/pack.ts'; // installs the routines of the regulars: who is at their venue at what hour
import '../src/game/home-plan.ts';
import { readTelemetryConfig } from '../server/telemetry/config.ts';
import { appHeaders, apiHeaders, pageHeaders, inlineScriptHashes, telemetryOrigins, factsOfUrl } from '../server/security-headers.ts';
import telemetryRoutes from '../server/telemetry/routes.ts';
import { capacityConfig, type CapacityConfig, envReader, outboundFetch, sessionArchiver, lifeAuthority, lifeAnnouncer, routeHeaders, pageFor, cleanOrigin, cleanHost, absolutePreviewImage, validOperatorToken, bearerToken, accountsConfig, founderEmailHash, sessionCookie, isStrictOrigin, presentedSession, mayBind, addressBucket } from '../server/host-context.ts';
import { SESSION_TTL_MS, ACTION_WINDOW_MS, UUID_PATTERN, protocolError, publicSession, isSameOrigin, renewSession, renewResolved, sessionOfCookie, collection, canOccupyVenue, STUN_ONLY_CONFIG, validateVoiceConfig, SOCKET_BUSY_CODE } from '../server/protocol.ts';
import type { CityId, HeartbeatFrame, ServerFrame, SocketErrorCode } from '../src/types/protocol.ts';
import type { AccountDeviceRecord, Db, HttpError, ImageStore, IncomingFrame, PageHandler, RouteContext, RouteResult, RouteTable, ServerEvents, SessionRecord, ShardStore, WsDispatch } from '../server/types.ts';
import type { HostSocket, SocketInfo, SqliteStore, WorkerRequest } from './host-seam.ts';

/** How often connected sockets are asked for a sign of life (a timer in memory), and how often the alarm wakes the object whoever is connected. */
const HEARTBEAT_MS = 10000, IDLE_BEAT_MS = 300000;
/** A lazy change (a poll that only moved the clock, a check-in, a counter) is written this long after it was made, at the latest (sqlite-store.ts LAZY). */
const LAZY_FLUSH_MS = 600000;
/** A session's stored expiry is pushed out only once that gains this much: a request must not rewrite the row to add a second to thirty days. */
const RENEW_SLACK_MS = 86400000;
/** How often the limiter's stored rows and the day-old chat receipts are swept. A sweep that finds nothing writes nothing. */
const SWEEP_MS = 600000;
/** The longest a socket that only answers heartbeats goes without its stored session being looked up (message() below). */
const ACK_CHECK_MS = 60000;
/** How often expired sessions are looked for after start-up (expiredSessions below). */
const EXPIRY_SWEEP_MS = 60000;
/** Path prefixes outside /api/ that a module may serve as an HTML page (ctx.pages). The Worker sends these to the object. */
const PAGE_PREFIXES = ['/s/', '/e/'];
/** A socket's attachment may hold 2,048 bytes. */
const ATTACHMENT_BYTES = 2000;
/** The limiter's STORED classes, one table each (server/limiter.ts). The short class is kept in memory and has no table. */
const RATE_TABLES: Record<Exclude<LimiterClass, 'short'>, string> = { long: 'rate_limits_long', protected: 'rate_limits_protected' };

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
async function rawBodyOf(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw protocolError(415, 'json_required');
  const reader = request.body?.getReader();
  if (!reader) throw protocolError(400, 'invalid_json');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) { await reader.cancel(); throw protocolError(413, 'body_too_large'); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
async function bodyOf(request: Request, limit = 8192): Promise<Record<string, unknown>> {
  const bytes = await rawBodyOf(request, limit);
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

/** Which admin-address name this deployment answers for (server/admin/host.ts). */
const adminNameOf = (env: WorkerEnv): string => adminHostName(env[ADMIN_HOST_ENV], cleanOrigin(env.PUBLIC_ORIGIN));

async function respond(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = () => env.JOINALLWORLD.getByName('joinallworld-v1');
  // The admin address answers only a few paths (server/admin/host.ts); the game's own address does not serve its page.
  const adminKind = isAdminHost(url.host, adminNameOf(env)) ? adminHostRoute(request.method, url.pathname) : null;
  if (adminKind === 'notfound') return json(404, { error: 'not_found' });
  if (adminKind === 'method') return json(405, { error: 'method_not_allowed' });
  if (adminKind === 'robots') return new Response(request.method === 'HEAD' ? null : ADMIN_ROBOTS, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' } });
  if (adminKind === null && /^\/adminshell(\.html)?$/.test(url.pathname)) return json(404, { error: 'not_found' });
  if (adminKind === 'shell') return adminShell(request, env, url);
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
  if (inAssets && response.status === 200 && assetPath.endsWith('.glb')) headers.set('content-type', 'model/gltf-binary'); // the skinned body and its clips
  if (!headers.get('content-type')?.includes('text/html')) return new Response(response.body, { status: response.status, headers });
  headers.set('cache-control', 'no-cache');
  // The game's page carries the full set of security headers; its inline scripts are admitted by hash, from the page as
  // served. A HEAD answer has no body to hash, so the same page is read with a GET.
  const head = request.method === 'HEAD';
  const origin = publicOrigin(env, url);
  // A short address (/games, /abuja, …) gets its own title, description and link-preview tags; the page's scripts are untouched, so the hashes below are the same.
  const text = withPathMeta(await (head ? await env.ASSETS.fetch(new Request(request.url, { method: 'GET' })) : response).text(), url.pathname, origin);
  for (const [name, value] of Object.entries(appHeaders({ ...factsOfUrl(url), scriptHashes: await inlineScriptHashes(text), telemetry: telemetryOrigins(readTelemetryConfig(env, { buildId: env.BUILD_ID })), avatarAssets: text.includes('name="allworld-3d-assets"'), accounts: accountsConfig(env), trustProviders: trustHeaderConfig(envReader(env), accountsConfig(env)) }))) headers.set(name, value);
  if (head || response.status !== 200) return new Response(head ? null : text, { status: response.status, headers });
  // The game's own page: its default link-preview image is made absolute, because the crawlers of chat apps do not
  // resolve a relative og:image. The length changes, so the asset's own validators no longer describe the body.
  for (const name of ['content-length', 'etag']) headers.delete(name);
  return new Response(absolutePreviewImage(text, origin), { status: 200, headers });
}

/** The admin page: the build's second entry, with the admin address's own headers (no beacon, no sockets, never kept or indexed). */
async function adminShell(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  const found = await env.ASSETS.fetch(new Request(new URL(`/${ADMIN_SHELL.replace(/\.html$/, '')}`, url.origin), { method: 'GET', redirect: 'manual' }));
  const text = found.status === 200 ? await found.text() : '';
  if (found.status !== 200 || !text) return json(404, { error: 'not_found' });
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
  for (const [name, value] of Object.entries(appHeaders({ ...factsOfUrl(url), scriptHashes: await inlineScriptHashes(text), accounts: accountsConfig(env), admin: true }))) headers.set(name, value);
  return new Response(request.method === 'HEAD' ? null : text, { status: 200, headers });
}

/** Declared here, not in host-seam.ts: it names Workers runtime globals the Node test projects do not have. */
/** The bindings and variables of the Worker (wrangler.jsonc, plus secrets and the outreach/voice settings the host may read). */
export interface WorkerEnv {
  JOINALLWORLD: DurableObjectNamespace
  ASSETS: Fetcher
  BUILD_ID?: string
  PUBLIC_ORIGIN?: string
  GOALMATIC_COMMERCE_API_URL?: string
  GOALMATIC_STORE_URL?: string
  COMMERCE_CHANNEL_ID?: string
  /** The admin address's host name (server/admin/host.ts); unset: `admin.` + the public host. */
  ADMIN_HOST?: string
  MODERATOR_TOKEN?: string
  VOTES_PER_ADDRESS?: string
  VOTE_CAP_MODE?: string
  /** How many players the object takes (server/host-context.ts capacityConfig, docs/CAPACITY.md). Unset: the defaults. */
  MAX_ACTIVE_SESSIONS?: string
  MAX_SOCKETS?: string
  SOCKETS_PER_ADDRESS?: string
  NEW_SESSIONS_PER_ADDRESS?: string
  TURN_KEY_ID?: string
  TURN_API_TOKEN?: string
  TURN_TEST_PUBLIC_IDS?: string
  CALL_RELAY_PER_PLAYER_DAY?: string
  CALL_RELAY_PER_ADDRESS_HOUR?: string
  CALL_RELAY_DAILY_CEILING?: string
  /** The sign-in provider's public client configuration (server/host-context.ts accountsConfig). Unset: accounts are off. */
  ACCOUNTS_FIREBASE_PROJECT_ID?: string
  ACCOUNTS_FIREBASE_API_KEY?: string
  ACCOUNTS_GOOGLE_CLIENT_ID?: string
  /**
   * '1': the object may sleep while sockets are connected. The beat then runs on the alarm (a row written per beat) and
   * no lazy change is held in memory (every write is durable at once) — what the object did before it counted its rows.
   * Unset, the default: the beat is a timer, lazy changes are held, and the object stays in memory while anyone is connected.
   */
  SLEEP_BETWEEN_BEATS?: string
  /** How the big collections are stored: `legacy` (default), `shadow` or `entries` (docs/STORAGE.md). */
  STORE_LAYOUT?: string
  /** Replaces the built-in founder hash; empty: no founder (server/host-context.ts founderEmailHash). */
  FOUNDER_EMAIL_SHA256?: string
  [name: string]: unknown
}

type Inbound = string | ArrayBuffer;
interface ChatRecord { id: string; at: number; bodyHash?: string }
interface VoiceConfig { iceServers: unknown; turnConfigured: boolean; mode: string; expiresAt?: number }

export class JoinAllworldState extends DurableObject<WorkerEnv> {
  sql: SqlStorageLike;
  meter: WriteMeter;
  peers: Map<WebSocket, HostSocket>;
  /** The sockets nobody has released yet, by the stored session they were opened under, by player and by address: a request finds its own sockets without walking everyone's. */
  held: { all: Set<HostSocket>; bySecret: Map<string, Set<HostSocket>>; byPlayer: Map<string, Set<HostSocket>>; byAddress: Map<string, Set<HostSocket>> };
  /** Sockets whose attachment no longer says what they carry (saveSockets). */
  unsaved: Set<WebSocket>;
  /** When each socket's stored session was last looked up for a frame (in memory only: after a sleep the next frame looks again). */
  checked: WeakMap<HostSocket, number>;
  caps: CapacityConfig;
  inflight: Map<WebSocket, Promise<void>>;
  telemetry: ReturnType<typeof createServerTelemetry>;
  booted: boolean;
  store: SqliteStore;
  shards: ShardStore;
  images: ImageStore;
  sweepAt: number;
  expirySweepAt: number;
  shortLimits: ReturnType<typeof createMemoryLimiter>;
  beatTimer: ReturnType<typeof setTimeout> | null;
  sleeps: boolean;
  operatorDigest: Promise<string> | null;
  context: RouteContext;
  handlers: WsDispatch;
  routes: RouteTable;
  ready: Promise<void>;
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env); this.env = env; this.meter = createWriteMeter(ctx.storage.sql); this.sql = this.meter.sql; this.peers = new Map(); this.inflight = new Map();
    this.held = { all: new Set(), bySecret: new Map(), byPlayer: new Map(), byAddress: new Map() }; this.unsaved = new Set(); this.checked = new WeakMap();
    const now = () => Date.now();
    const log = (line: unknown): void => { try { console.error(String(line).slice(0, 500)); } catch { /* a failing logger changes nothing */ } };
    const buildId = String(env.BUILD_ID || 'unreleased').slice(0, 40);
    this.caps = capacityConfig(env, log);
    this.telemetry = createServerTelemetry({ env, buildId });
    this.booted = false;
    // THE DURABILITY BARRIER: every acknowledged write has passed storage.sync(). While the object is starting nothing can
    // be acknowledged (no request is being answered, and the runtime holds every response until its writes are confirmed),
    // and the barrier cannot be waited for inside blockConcurrencyWhile — so start-up writes go without it.
    const barrier = () => (this.booted ? ctx.storage.sync() : Promise.resolve());
    // Every table is written through the meter (write-meter.ts): the same storage, with its rows counted.
    const storage: SqliteStorage = { sql: this.sql, transactionSync: fn => ctx.storage.transactionSync(fn), sync: () => ctx.storage.sync() };
    this.sleeps = env.SLEEP_BETWEEN_BEATS === '1';
    this.store = createSqliteStore(storage, { barrier, lazyFlushMs: this.sleeps ? 0 : LAZY_FLUSH_MS, layout: parseLayout(env.STORE_LAYOUT) ?? 'legacy', log });
    this.images = createSqliteImages(storage);
    // The world registry: one append-only shard per local government, as rows beside the main tables (sqlite-shards.ts).
    this.shards = createShardStoreOn(sqliteShardBackend(storage, { barrier, beforeWrite: () => this.store.assertWritable() }), { empty: worldRegistry.empty, reduce: worldRegistry.reduce, snapshot: worldRegistry.snapshot, loaded: worldRegistry.loaded, live: worldRegistry.live, log }) as ShardStore;
    // THE LIMITER (server/limiter.ts), bounded per class. SHORT windows (a minute or less: every request, every socket frame) are
    // counted IN MEMORY: a stored row per request is a row billed per request, for a count that is worthless a minute later.
    // The object is in memory for as long as anyone is connected or asking, so the counts hold exactly when they matter; one
    // that has slept starts its short windows again. LONG windows and the keys that are never dropped (the operator's guard,
    // account sign-in) are STORED, each class in a table of its own, indexed by expiry, and outlive any restart.
    // (A database made before this keeps a `rate_limits` table of short rows: it is no longer read or written.)
    this.shortLimits = createMemoryLimiter({ now });
    for (const table of Object.values(RATE_TABLES)) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, started_at INTEGER NOT NULL, count INTEGER NOT NULL, expires_at INTEGER)`);
      this.sql.exec(`CREATE INDEX IF NOT EXISTS ${table}_expiry ON ${table}(expires_at)`);
    }
    this.sql.exec('CREATE TABLE IF NOT EXISTS turn_budget (day TEXT PRIMARY KEY, issued INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS call_relay_budget (day TEXT PRIMARY KEY, issued INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chat_receipts (sender TEXT NOT NULL, room TEXT NOT NULL, client_id TEXT NOT NULL, at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,room,client_id))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS host_keys (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.sweepAt = 0; this.expirySweepAt = 0; this.beatTimer = null;
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
    // One character on several devices: a change a player would see is announced to every socket of that character (host-context.ts lifeAnnouncer).
    const lifeSync = lifeAnnouncer((publicId, frame) => context.push(publicId, frame));
    const { settle, act, playerAct } = lifeAuthority({ now, receipts, changed: lifeSync.note });
    const keys = new Map<string, Promise<object>>();
    const unresponsive = (ws: HostSocket): boolean => ws.pingedAt > 0 && !ws.alive && now() - ws.pingedAt >= HEARTBEAT_MS / 2;
    const open = (): HostSocket[] => [...this.held.all].filter(ws => ws.readyState === 1);
    const openOf = (id: string): HostSocket[] => [...this.held.byPlayer.get(id) ?? []].filter(ws => ws.readyState === 1);
    const context: RouteContext = this.context = {
      store: this.store, images: this.images, shards: this.shards, now, fail: protocolError, collection, publicSession, cityIds: registeredCityIds(), telemetry: this.telemetry,
      randomId: () => crypto.randomUUID(),
      // Relay credentials for calls (server/call-relay.ts): the day's count lives in the object's own storage, so the ceiling holds across restarts.
      callRelay: createCallRelay({
        read: (name) => { const value = (this.env as unknown as Record<string, unknown>)[name]; return typeof value === 'string' ? value : undefined; }, now,
        budget: {
          used: (day) => this.sql.exec<{ issued: number }>('SELECT issued FROM call_relay_budget WHERE day = ?', day).toArray()[0]?.issued ?? 0,
          add: (day) => { this.sql.exec('INSERT INTO call_relay_budget(day,issued) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET issued=issued+1', day); this.sql.exec('DELETE FROM call_relay_budget WHERE day < ?', new Date(now() - 7 * 86400000).toISOString().slice(0, 10)); },
        },
      }),
      allow: (key: string, count = 120, windowMs = 60000) => this.allow(key, count, windowMs),
      peek: (key: string, count = 120) => this.peek(key, count),
      retryIn: (key: string) => this.retryIn(key),
      send: (ws, message) => this.sendFrame(ws as HostSocket, message),
      // One frame to many sockets: its text is made once, however many receive it.
      broadcast: (list, message) => { let text: string | undefined; for (const peer of list) { const ws = peer as HostSocket; if (ws.readyState !== 1) continue; try { ws.send(text ??= JSON.stringify(message)); this.telemetry.socketOut(ws, message); } catch { /* the socket went away */ } } },
      on(event, fn) { let list = listeners.get(event); if (!list) listeners.set(event, list = []); list.push(fn as Listener); },
      emit(event, value) { for (const fn of listeners.get(event) || []) { try { fn(value); } catch (error) { log(`Listener for ${event} failed: ${firstLine(error)}`); } } },
      settle, act,
      // One game action for the caller, exactly once, with everything it changed saved together (routes/core.ts).
      command: (request, body, options) => executeCommand(context, request, body, options),
      once: receipts.once, onceId: receipts.onceId,
      push: (id, message) => { let count = 0; for (const ws of openOf(id)) { context.send(ws, message); count++; } return count; },
      online: (id) => openOf(id).some(ws => !unresponsive(ws)),
      atHome(db, id, city) {
        if (!registeredCityIds().includes(city)) return false;
        const found = context.core.sessionByPublicId(db, id), state = found && found.expiresAt > now() ? found.cities?.[city as CityId]?.state : undefined;
        return Boolean(state) && canOccupyVenue(state, 'home');
      },
      checks: {},
      pages: new Map(),
      env: envReader(env),
      commerceGateway: createCommerceGateway(env, outboundFetch((url, init) => fetch(url, init), { refuseRedirect: 'manual' })),
      streetAssets: {
        async readManifest(city, version) {
          if (!/^[a-z][a-z0-9-]{0,60}$/.test(city) || (version !== undefined && !/^street-v1-[a-z0-9_-]{1,120}$/.test(version))) return null;
          const file = version ? `manifest-${version}.txt` : 'manifest.txt';
          const text = await streetAssetText(await env.ASSETS.fetch(new Request(`https://allworld-assets.invalid/assets/street/${city}/${file}`, { redirect: 'manual' })), 4 * 1024 * 1024);
          return text === null ? null : JSON.parse(text) as unknown;
        },
        async readTile(city, _version, file) {
          if (!/^[a-z][a-z0-9-]{0,60}$/.test(city) || !/^[a-z0-9_-]{1,240}\.txt$/.test(file)) return null;
          return streetAssetText(await env.ASSETS.fetch(new Request(`https://allworld-assets.invalid/assets/street/${city}/${file}`, { redirect: 'manual' })), 256 * 1024);
        },
      },
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
      config: { accounts: accountsConfig(env), founderEmailSha256: founderEmailHash(env), publicOrigin: cleanOrigin(env.PUBLIC_ORIGIN), sessionTtlMs: SESSION_TTL_MS, actionWindowMs: ACTION_WINDOW_MS, ...this.caps, buildId, votesPerAddress, voteCapMode, heartbeatMs: HEARTBEAT_MS, moderation: Boolean(operatorToken) },
      startup: registeredCityIds().map(loadCityContent),
      // Nothing stops a Durable Object in an orderly way: every write is durable when it is acknowledged, and work in
      // flight is covered by waitUntil. The list exists so a module can register without asking which host it is on.
      closing: [],
      core: {
        archiveSession: sessionArchiver({ now, randomId: () => crypto.randomUUID() }),
        expiredSessionKeys: (db: Db, always?: boolean) => this.expiredSessions(db, now(), always === true),
        sessionByPublicId: (db: Db, id: string) => { const key = db.$store!.sessionKeyByPublicId(id); return key === undefined ? undefined : db.sessions[key]; },
        unresponsive,
        storeStats: () => ({ ...this.store.stats(), rows: this.meter.snapshot(), limits: this.limits(), collections: this.sizes() }),
        newIdentity: () => ({ secret: crypto.randomUUID(), publicId: crypto.randomUUID() }),
        newId: () => crypto.randomUUID(),
        cookieHeader: (request, secret: string) => cookie(secret, request.raw as Request),
        clearCookieHeader: (request) => cookie('', request.raw as Request),
        closeSocket: (ws, code, reason) => { const peer = ws as HostSocket; peer.close(code, reason); this.release(peer); },
        sockets: open,
        socketsOf: openOf,
        isOpen: (ws: HostSocket) => ws.readyState === 1,
        sessionOf: (ws: HostSocket, db: Db) => db.sessions[ws.secret],
        playerAct,
        actionOnce: receipts.action,
        lifeChanged: lifeSync.note,
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
      if (await ctx.storage.getAlarm() === null) await this.arm(Date.now() + (this.sleeps && this.peers.size ? HEARTBEAT_MS : IDLE_BEAT_MS));
    }).then(() => { this.booted = true; this.keepBeating(); });
  }
  /**
   * ctx.allow (server/limiter.ts). A short window is counted in memory. A long or protected one is a stored row, bounded per
   * class: a full table drops the rows that expire soonest to make room, so whoever filled it cannot turn newcomers away or
   * erase another class. The protected class (operator and account keys) is never dropped from: when it is full of live rows
   * a new key of it is refused. The row count of a full-table check is a COUNT(*) per NEW key; it is only paid when the key is new.
   * WHAT A CALL WRITES: a new window is one row and its index entry; a further call inside the window updates the count
   * alone (one row); a call that is already over its limit writes nothing — so whoever is being refused cannot make the
   * object write, however often they ask.
   */
  allow(key: string, count: number, windowMs = 60000): boolean {
    const kind = limiterClass(key, windowMs);
    if (kind === 'short') return this.shortLimits.allow(key, count, windowMs);
    const now = Date.now(), table = RATE_TABLES[kind], cap = LIMITER_CAPS[kind];
    this.sweep(now);
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
    if (old && old.expires_at > now) {
      if (old.count > count) return false;
      this.sql.exec(`UPDATE ${table} SET count = ? WHERE key = ?`, old.count + 1, key);
      return old.count + 1 <= count;
    }
    this.sql.exec(`INSERT INTO ${table}(key,started_at,count,expires_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET started_at=excluded.started_at,count=excluded.count,expires_at=excluded.expires_at`, key, now, 1, now + windowMs);
    return 1 <= count;
  }
  /** ctx.peek: would allow(key, count) pass now? Looks in memory, then at the key's row in whichever table holds it; writes nothing. */
  peek(key: string, count: number): boolean {
    if (!this.shortLimits.peek(key, count)) return false;
    for (const table of Object.values(RATE_TABLES)) {
      const old = this.sql.exec<{ count: number; expires_at: number }>(`SELECT count,expires_at FROM ${table} WHERE key = ?`, key).toArray()[0];
      if (old) return old.expires_at > Date.now() ? old.count < count : true;
    }
    return true;
  }
  /** ctx.retryIn: milliseconds until the window of a limiter key ends, wherever it is counted; 0 when none is running. Writes nothing. */
  retryIn(key: string): number {
    const short = this.shortLimits.wait(key);
    if (short > 0) return short;
    for (const table of Object.values(RATE_TABLES)) {
      const row = this.sql.exec<{ expires_at: number }>(`SELECT expires_at FROM ${table} WHERE key = ?`, key).toArray()[0];
      if (row) return Math.max(0, Number(row.expires_at) - Date.now());
    }
    return 0;
  }
  /** Keys the limiter holds per class, for the operator's overview: short in memory, long and protected stored. */
  limits(): Record<LimiterClass, number> {
    const stored = (table: string): number => this.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).one().count;
    return { short: this.shortLimits.sizes().short, long: stored(RATE_TABLES.long), protected: stored(RATE_TABLES.protected) };
  }
  /** Now and then: drop the limiter's expired rows and the chat receipts older than a day. Rows that are not there cost nothing to remove. */
  sweep(now: number): void {
    if (now < this.sweepAt) return;
    this.sweepAt = now + SWEEP_MS;
    for (const table of Object.values(RATE_TABLES)) this.sql.exec(`DELETE FROM ${table} WHERE expires_at <= ?`, now);
    this.sql.exec('DELETE FROM chat_receipts WHERE at < ?', now - 86400000);
    this.shortLimits.sweep();
  }
  /**
   * The sessions to archive now, found by their stored expiry: no other record is read, at start-up or later (reading
   * every record once per start was time and memory in proportion to everyone who ever played; a row of this table
   * cannot lack a public id or an expiry, which is what that reading looked for). They are looked for at start-up, when
   * a session is about to be made (`always`: a request that is itself limited per address) and otherwise at most once
   * every EXPIRY_SWEEP_MS, however often it is asked.
   * A session that has run out is refused from that moment whether or not it has been archived yet (protocol.ts sessionOfCookie).
   */
  expiredSessions(db: Db, now: number, always = false): string[] {
    const helpers = db.$store!;
    if (!helpers.expiredSessionKeys) return helpers.scanSessions(s => !s.publicId || !Number.isFinite(s.expiresAt) || s.expiresAt <= now);
    if (this.booted && !always && now < this.expirySweepAt) return [];
    this.expirySweepAt = now + EXPIRY_SWEEP_MS;
    return helpers.expiredSessionKeys(now);
  }
  /** Set the alarm. Setting it is a write, and is counted as one. */
  async arm(at: number): Promise<void> { await this.ctx.storage.setAlarm(at); this.meter.add(ALARM_TABLE, 1); }
  /**
   * A socket as the modules hold it. WHAT IT CARRIES IS WRITTEN TO ITS ATTACHMENT ONLY WHEN IT CHANGED: assigning a field
   * marks the socket (`unsaved`), and saveSockets writes the marked ones. Writing every socket's attachment after every
   * request and frame cost time in proportion to everyone connected. So a module ASSIGNS what a socket carries
   * (`ws.position = { x, z }`) and never changes it in place (`ws.position.x = …` would not be seen until the next beat,
   * which marks every socket).
   */
  wrap(socket: WebSocket, info: SocketInfo): HostSocket {
    const fields: HostSocket = { ...info, voice: info.voice || { enabled: false, muted: true }, position: info.position || { x: 0, z: 0 }, lastMoves: info.lastMoves || [], look: info.look ?? null, stale: false, guestUntil: 0,
      get readyState() { return this.closed ? 3 : socket.readyState; },
      send: (data: string) => socket.send(data), close: (code = 1000, reason = '') => { ws.closed = true; try { socket.close(code, reason); } catch { /* already closed */ } }, socket };
    const ws = new Proxy(fields, {
      set: (target, key, value: unknown) => { if (Reflect.get(target, key) !== value) { Reflect.set(target, key, value); this.unsaved.add(socket); } return true; },
      deleteProperty: (target, key) => { if (Reflect.has(target, key)) this.unsaved.add(socket); return Reflect.deleteProperty(target, key); },
    });
    this.peers.set(socket, ws);
    if (!info.closed) {
      this.held.all.add(ws);
      for (const [index, key] of [[this.held.bySecret, ws.secret], [this.held.byPlayer, ws.session.id], [this.held.byAddress, ws.ip]] as const) { let set = index.get(key); if (!set) index.set(key, set = new Set()); set.add(ws); }
    }
    return ws;
  }
  /** Take a socket out of the indexes (it stays in `peers` until the runtime reports it closed). */
  forget(ws: HostSocket): void {
    this.held.all.delete(ws);
    for (const [index, key] of [[this.held.bySecret, ws.secret], [this.held.byPlayer, ws.session.id], [this.held.byAddress, ws.ip]] as const) { const set = index.get(key); if (set) { set.delete(ws); if (!set.size) index.delete(key); } }
  }
  /** Is any socket open? */
  anyOpen(): boolean { for (const ws of this.held.all) if (ws.readyState === 1) return true; return false; }
  /** The open sockets of one stored session. */
  socketsOfSecret(secret: string | undefined): HostSocket[] { return secret === undefined ? [] : [...this.held.bySecret.get(secret) ?? []].filter(ws => ws.readyState === 1); }
  /**
   * JSON characters stored per feature collection, for the operator's overview (reads only). The tables that hold a row per
   * session or receipt are not measured: that would read every row.
   */
  sizes(): Record<string, number> {
    const sizes: Record<string, number> = {};
    for (const row of this.sql.exec<{ name: string; size: number }>('SELECT name, LENGTH(value) AS size FROM collections').toArray()) sizes[row.name] = Number(row.size);
    for (const row of this.sql.exec<{ name: string; size: number }>('SELECT name, SUM(LENGTH(value)) AS size FROM collection_parts GROUP BY name').toArray()) sizes[row.name] = Number(row.size);
    // Collections kept per entry (docs/STORAGE.md): the rows of `entries` by collection. A root is a collection of its own, named `root:<name>`.
    for (const row of this.sql.exec<{ coll: string; size: number }>('SELECT coll, SUM(LENGTH(value)) AS size FROM entries GROUP BY coll').toArray()) sizes[`entries:${row.coll}`] = Number(row.size);
    return sizes;
  }
  /** To one socket, if it is open: the frames the shared modules send, plus the Worker's own application heartbeat. */
  sendFrame(ws: HostSocket, message: ServerFrame | HeartbeatFrame): void {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(message)); this.telemetry.socketOut(ws, message); } catch { /* the socket went away */ }
  }
  /** Write what each socket carries into its attachment, so it survives a sleep. Too large (a long look): the look is what goes. */
  saveSockets(): void {
    for (const socket of this.unsaved) {
      const ws = this.peers.get(socket);
      if (!ws) continue;
      const { socket: ignored, send: ignoredSend, close: ignoredClose, readyState: ignoredReady, released: ignoredReleased, ...info } = ws;
      try {
        if (JSON.stringify(info).length > ATTACHMENT_BYTES) { info.look = null; info.lastMoves = []; }
        socket.serializeAttachment(info);
      } catch { try { socket.serializeAttachment({ secret: ws.secret, ...(ws.device !== undefined ? { device: ws.device } : {}), session: ws.session, expiresAt: ws.expiresAt, ip: ws.ip, room: ws.room ?? null, closed: ws.closed === true, alive: ws.alive, pingedAt: ws.pingedAt, seenAt: ws.seenAt, lastSessionRenewedAt: ws.lastSessionRenewedAt, position: ws.position, voice: ws.voice, ...(ws.streetGateProof ? { streetGateProof: ws.streetGateProof } : {}) }); } catch { /* the socket is gone */ } }
    }
    this.unsaved.clear();
  }
  /** Tell the modules a socket is gone — once, however many ways its end was noticed (an expiry, an alarm, the close event). */
  release(ws: HostSocket): void { if (ws.released) return; ws.released = true; ws.closed = true; this.forget(ws); this.telemetry.socketClosed(ws); this.handlers.close(ws); }
  /** Whose session the presented cookie is — a guest's own record, or the character of the account a signed-in browser is bound to (protocol.ts sessionOfCookie). */
  session(request: WorkerRequest, db: Db, renew = false): SessionRecord | undefined {
    const found = sessionOfCookie(db, request.cookie, Date.now(), request.binding !== undefined);
    if (!found) return undefined;
    if (renew) renewResolved(found, Date.now(), SESSION_TTL_MS, RENEW_SLACK_MS);
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
    this.meter.from('http (before routing)');
    let at: { key: string; request: WorkerRequest; began: number } | undefined;
    try {
      const secret = cookieId(raw), now = Date.now();
      const address = addressBucket(raw.headers.get('cf-connecting-ip') || 'unknown');
      const ip = await digest(isAdminHost(url.host, adminNameOf(this.env)) ? adminAddress(address) : address);
      const operator = url.pathname.startsWith('/api/mod/');
      if (!operator && !isSameOrigin(raw.headers.get('origin'), url.host, { requireOrigin: url.pathname === '/socket', secure: overHttps(url) })) throw protocolError(403, 'origin_rejected');
      // True only for a request carrying the operator's bearer token (never a cookie or a query value).
      const bearer = this.operatorDigest ? bearerToken(raw.headers.get('authorization')) : null;
      const moderator = bearer !== null && sameDigest(await digest(bearer), await this.operatorDigest);
      // `secret` becomes the stored session's key once session() resolves it; `cookie` stays what the browser presented.
      const request: WorkerRequest = { method: raw.method, path: url.pathname, query: url.searchParams, ip, secret, cookie: secret, binding: mayBind(presentedSession(raw.headers.get('cookie')), true), params: {}, raw,
        strictOrigin: isStrictOrigin(raw.headers.get('origin'), url.host, raw.headers.get('sec-fetch-site'), overHttps(url)),
        moderator: () => moderator, json: (limit?: number) => bodyOf(raw, limit).then(body => (request.body = body)),
        rawBody: (limit: number) => rawBodyOf(raw, limit), header: (name: string) => raw.headers.get(name),
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
      at = { key: route.key, request, began: performance.now() }; this.meter.from(route.key);
      // ROOM REVALIDATION, for every route and every outcome (as on Node): before the request is answered, every room
      // the caller's sockets are in is re-checked against the STORED lives.
      let returned: RouteResult | void;
      try { returned = await route.handler(request); }
      finally { for (const publicId of new Set(this.socketsOfSecret(request.secret).filter(ws => ws.room).map(ws => ws.session.id))) await this.context.core.revalidate(publicId); }
      const result: RouteResult = returned && typeof returned === 'object' ? returned : {}, status = result.status || 200;
      if (result.file && status < 300) {
        // Bytes a route hands over as they are (a chat picture): private to the caller, never sniffed, shown in the page.
        this.telemetry.http({ method: raw.method, route: route.key, status, ms: performance.now() - at.began, publicId: request.publicId });
        return new Response(result.file.bytes, { status, headers: headersOf({ 'content-type': result.file.type, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline', 'cross-origin-resource-policy': 'same-origin' }) });
      }
      this.telemetry.http({ method: raw.method, route: route.key, status, ms: performance.now() - at.began, publicId: request.publicId, body: result.body, action: { type: request.body?.['type'], code: (result.body as { code?: unknown } | undefined)?.code } });
      const plain = result.body && typeof result.body === 'object' && !Array.isArray(result.body);
      const body: Record<string, unknown> = status < 300 && (plain || result.body === undefined) ? { ...(result.body as object || {}), serverTime: Date.now(), ...(this.context.core.storageFailing() ? { storage: 'failing' } : {}) } : (result.body ?? {}) as Record<string, unknown>;
      if (url.pathname === '/api/health') Object.assign(body, { transport: 'cloudflare', buildId: this.context.config.buildId });
      if (result.renew === true) for (const ws of this.held.bySecret.get(request.secret ?? '') ?? []) { ws.expiresAt = now + SESSION_TTL_MS; ws.lastSessionRenewedAt = now; }
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
      // A refusal that says when to come back says it twice: the standard header, and a field the page reads.
      const retryAfter = known && typeof error.retryAfter === 'number' && Number.isFinite(error.retryAfter) && error.retryAfter > 0 ? Math.ceil(error.retryAfter) : null;
      return json(known ? error.status as number : 500, { error: known ? error.code : 'internal_error', ...(known && typeof error.reason === 'string' ? { reason: error.reason } : {}), ...(retryAfter !== null ? { retryAfter } : {}), ...(known && error.code === 'city_moved' && typeof Reflect.get(error, 'city') === 'string' ? { city: Reflect.get(error, 'city') } : {}) },
        retryAfter !== null ? { 'Retry-After': String(retryAfter) } : {});
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
    this.meter.from(`page ${key}`);
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
    return [...this.held.byPlayer.get(session.publicId) ?? []].some(ws => ws.readyState === 1 && ws.room && ws.expiresAt > Date.now() && !this.context.core.unresponsive(ws) && this.context.core.roomStillValid(ws, db, session, ws.room.split(':')[0] as string, this.context.settle(session, ws.room.split(':')[0] as CityId)));
  }
  async upgrade(raw: Request, request: WorkerRequest): Promise<Response> {
    if (raw.headers.get('upgrade')?.toLowerCase() !== 'websocket' || raw.method !== 'GET') throw protocolError(403, 'websocket_required');
    this.meter.from('socket open');
    if (!this.allow(`upgrade:${request.ip}`, 60)) throw protocolError(429, 'rate_limited');
    // `secret` is the stored record's key; `device` is the cookie the browser presented, the only value ever sent back to it.
    const info = await this.store.transact(db => { const s = request.requireSession(db, { renew: true }); return { secret: s.secret as string, device: request.cookie as string, session: publicSession(s), expiresAt: s.expiresAt }; });
    // One session and one address hold a bounded share of the sockets: more is refused outright (503). When EVERY place is
    // taken the visitor did nothing wrong: the socket is opened and closed at once with SOCKET_BUSY_CODE, which a browser can
    // read (it cannot read the status of a refused upgrade) — the page says the world is busy and tries again. Nobody connected is dropped to make room.
    if ((this.held.bySecret.get(info.secret)?.size ?? 0) >= this.caps.socketsPerPlayer || (this.held.byAddress.get(request.ip)?.size ?? 0) >= this.caps.socketsPerAddress) throw protocolError(503, 'socket_capacity');
    if (this.held.all.size >= this.caps.maxSockets) {
      const busy = new WebSocketPair();
      busy[1].accept(); busy[1].close(SOCKET_BUSY_CODE, 'socket_capacity');
      return new Response(null, { status: 101, webSocket: busy[0] });
    }
    const pair = new WebSocketPair(), socket = pair[1]; this.ctx.acceptWebSocket(socket);
    const ws = this.wrap(socket, { ...info, ip: request.ip, room: null, closed: false, alive: true, pingedAt: 0, seenAt: Date.now(), lastSessionRenewedAt: Date.now() });
    // A new socket has no attachment yet: it is written now whatever the modules set on it.
    this.unsaved.add(socket);
    this.handlers.open(ws); this.saveSockets();
    // Somebody is connected: the beat runs (a beat that is already due is never postponed by a newer socket).
    this.keepBeating();
    if (this.sleeps) { const due = await this.ctx.storage.getAlarm(); if (due === null || due > Date.now() + HEARTBEAT_MS) await this.arm(Date.now() + HEARTBEAT_MS); }
    return new Response(null, { status: 101, webSocket: pair[0], headers: headersOf({ 'Set-Cookie': cookie(info.device, raw) }) });
  }
  chatHistory(ws: HostSocket, body: unknown) {
    this.sweep(Date.now());
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
    this.meter.from('socket (before parsing)');
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
      this.meter.from(`socket ${typeof message.type === 'string' && this.handlers.messages.has(message.type) ? message.type : message.type === 'heartbeat-ack' ? 'heartbeat-ack' : '(unknown)'}`);
      // Every frame is checked against the stored session before it is handled. The answer to a heartbeat asks for nothing and is
      // most of what an open page sends, so its check is made once in ACK_CHECK_MS rather than six times a minute: a socket whose
      // session is gone is closed by whatever removed the session, at its expiry by the beat, and at the latest by this check.
      const checkedLately = message.type === 'heartbeat-ack' && Date.now() - (this.checked.get(ws) ?? 0) < ACK_CHECK_MS;
      const authenticated = checkedLately || await this.store.read(db => Boolean(this.socketSession(db, ws)));
      if (authenticated && !checkedLately) this.checked.set(ws, Date.now());
      if (!authenticated || ws.expiresAt <= Date.now()) { this.context.send(ws, { type: 'error', code: 'device_session_required', error: 'device_session_required' }); ws.close(1008, 'Device session expired'); this.release(ws); return; }
      ws.alive = true; ws.seenAt = Date.now(); // any frame proves the connection is alive
      if (message.type === 'heartbeat-ack') return;
      if (Date.now() - ws.lastSessionRenewedAt >= 60000) {
        // The renewal could not be saved, so it did not happen: the socket keeps its expiry and the message is still handled.
        const expiration = await this.store.transact(db => { const found = this.socketSession(db, ws); if (!found || !renewSession(found.session, Date.now(), SESSION_TTL_MS, RENEW_SLACK_MS)) throw Error('device_session_required'); renewResolved(found, Date.now(), SESSION_TTL_MS, RENEW_SLACK_MS); return found.session.expiresAt; }, { durable: false }).catch((error: unknown) => { if ((error as Partial<HttpError> | null | undefined)?.code !== 'storage_unavailable') throw error; return null; });
        if (expiration !== null) for (const peer of this.held.bySecret.get(ws.secret) ?? []) { peer.expiresAt = expiration; peer.lastSessionRenewedAt = Date.now(); }
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
  override async webSocketClose(socket: WebSocket): Promise<void> { await this.ready; const ws = this.peers.get(socket); if (ws) { this.meter.from('socket close'); this.release(ws); this.peers.delete(socket); this.unsaved.delete(socket); this.saveSockets(); this.ctx.waitUntil(this.telemetry.flush()); } }
  override async webSocketError(socket: WebSocket): Promise<void> { await this.webSocketClose(socket); }
  /**
   * THE BEAT, every HEARTBEAT_MS while a socket is open: a socket that did not answer the last one is closed, the others are
   * asked for a sign of life, and the modules do their housekeeping ('heartbeat'). It is a timer in memory, not the alarm:
   * setting an alarm is a write, and six a minute for as long as anyone is connected is what the alarm used to cost. A
   * pending timer also keeps the object in memory, so what it holds there (short limits, lazy changes) stays while anyone is connected.
   */
  beat(): void {
    this.meter.from('beat');
    for (const ws of [...this.held.all]) {
      if (ws.readyState !== 1) continue;
      if (!ws.alive || ws.expiresAt <= Date.now()) { ws.close(1008, 'Session inactive'); this.release(ws); continue; }
      ws.alive = false; ws.pingedAt = Date.now(); this.sendFrame(ws, { type: 'heartbeat' });
    }
    this.context.emit('heartbeat', { now: Date.now() }); this.saveSockets();
    this.sweep(Date.now());
    try { this.ctx.waitUntil(this.telemetry.flush()); } catch { /* not in a request */ }
  }
  /** Keep the beat going while a socket is open. One timer at a time: asking again never moves a beat that is already due. */
  keepBeating(): void {
    if (this.sleeps || this.beatTimer !== null || !this.anyOpen()) return;
    this.beatTimer = setTimeout(() => {
      this.beatTimer = null;
      try { this.beat(); } catch (error) { this.context.core.log(`Beat failed: ${firstLine(error)}`); }
      this.keepBeating();
    }, HEARTBEAT_MS);
  }
  /**
   * THE ALARM, every IDLE_BEAT_MS: what brings the object back when nothing else does. With nobody connected it is the
   * beat (mail and push that are due go out, the world registry is tidied); with sockets it has woken an object that lost
   * its memory, and the beat's timer starts again. It is set once per run and never from a request.
   * (SLEEP_BETWEEN_BEATS: there is no timer; the alarm is the beat, every HEARTBEAT_MS while a socket is open.)
   */
  override async alarm(): Promise<void> {
    await this.ready;
    this.meter.from('alarm');
    try { if (this.beatTimer === null) this.beat(); }
    finally { await this.arm(Date.now() + (this.sleeps && this.anyOpen() ? HEARTBEAT_MS : IDLE_BEAT_MS)); this.keepBeating(); }
  }
}
