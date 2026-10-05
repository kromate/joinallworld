/**
 * Node host: HTTP + WebSocket plumbing, static files and the server context.
 * Everything Node-specific lives here and in store.js. Rules shared with the Cloudflare worker
 * live in protocol.js, life-service.js and src/life.ts. Endpoints live in routes/*.js and
 * socket message types in ws/*.js — see routes/index.js and ws/index.js for those contracts.
 */
import http from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat, writeFile, mkdir, chmod } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, extname, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createStore } from './store.ts';
import { createShardStore } from './world/shards.ts';
import * as worldRegistry from './world/registry.ts';
import { worldOf } from './world/service.ts';
import { envReader, outboundFetch, sessionArchiver, lifeAuthority, routeHeaders, pageFor as findPage, cleanOrigin, cleanHost, absolutePreviewImage, validOperatorToken, bearerToken } from './host-context.ts';
import { buildRoutes, ROUTE_MODULES } from './routes/index.ts';
import { executeCommand } from './routes/core.ts';
import { createOnce } from './routes/once.ts';
import { buildSocketHandlers } from './ws/index.ts';
import { createServerTelemetry, useTelemetry } from './telemetry/index.ts';
import { readTelemetryConfig } from './telemetry/config.ts';
import { appHeaders, pageHeaders, apiHeaders, inlineScriptHashes, telemetryOrigins, type RequestFacts } from './security-headers.ts';
import { siteFile } from './site-files.ts';
import { createMemoryLimiter } from './limiter.ts';
import telemetryRoutes from './telemetry/routes.ts';
import { CITY_IDS, ACTION_WINDOW_MS, UUID_PATTERN as uuid, protocolError as fail, publicSession, isSameOrigin, renewSession, collection, canOccupyVenue } from './protocol.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ActionRequest, CityId, ServerFrame, SocketErrorCode } from '../src/types/protocol.ts';
import type { Db, PageHandler, RouteContext, RouteModule, RouteRequest, RouteResult, ServerConfig, ServerEvents, SessionRecord, ShardStore, Store, WsConnection, WsHandlerModule } from './types.ts';

/** What the server hands back: the HTTP server plus the handles tests and the start-up script use. */
export type AllworldServer = http.Server & {
  wss: WebSocketServer
  /** Tests drive the heartbeat directly instead of waiting for the timer. */
  beat(): void
  store: Store
  shards: Awaited<ReturnType<typeof createShardStore>>
  world: ReturnType<typeof worldOf>
  telemetry: ServerTelemetry
  /** The one shutdown order (see below). */
  flush(): Promise<void>
}
type ServerTelemetry = ReturnType<typeof createServerTelemetry>;
/** A ws WebSocket once the host has authenticated it: the socket plus the fields of WsConnection (the host sets the first ones on upgrade, the socket modules the rest on open). */
export type Connection = WebSocket & WsConnection;
/** The options of createServer; every one has a default. */
export interface ServerOptions {
  dataDir?: string
  distDir?: string
  now?: () => number
  sessionTtlMs?: number
  actionWindowMs?: number
  maxActiveSessions?: number
  voiceConfigProvider?: ServerConfig['voiceConfigProvider']
  store?: Store
  routes?: RouteModule[]
  wsModules?: WsHandlerModule[]
  lazyFlushMs?: number
  shardIo?: NonNullable<Parameters<typeof createShardStore>[1]>['io']
  heartbeatMs?: number
  moderatorToken?: string | undefined
  trustProxy?: boolean
  votesPerAddress?: number
  voteCapMode?: string
  log?: (line: string) => void
  receiptLimits?: Parameters<typeof createOnce>[0]['limits']
  env?: Readonly<Record<string, unknown>>
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  randomId?: () => string
  publicOrigin?: string | undefined
  buildId?: string
  telemetry?: ServerTelemetry
}
/** The request as the host builds it: the portable RouteRequest plus what the host itself remembers of it. */
type HostRequest = RouteRequest & { body?: Record<string, unknown>; publicId?: string };
/** The matched route and its request, for telemetry. */
interface Matched { key: string; request: { body?: Record<string, unknown>; publicId?: string }; began: number }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
/** A field of whatever was thrown or sent; undefined when it is not an object. */
const fieldOf = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);
/** A frame the socket modules can handle: an object whose `type` is a string. */
const isFrame = (value: unknown): value is { type: string; [field: string]: unknown } => isObject(value) && typeof value.type === 'string';
/** The raw Node request a route's `raw` holds. */
const isNodeRequest = (value: unknown): value is IncomingMessage => isObject(value) && 'socket' in value && 'headers' in value;

const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const cookieId = (req: IncomingMessage): string | undefined => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4);
const sameOrigin = (req: IncomingMessage): boolean => isSameOrigin(req.headers.origin, req.headers.host);
/**
 * The address limits and caps are keyed on. Directly connected: the socket's remote address. With
 * TRUST_PROXY=1 (one trusted reverse proxy in front): the right-most X-Forwarded-For entry, which is
 * the address that proxy itself saw — entries further left are client-supplied and are ignored.
 */
function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  const direct = req.socket.remoteAddress || 'unknown';
  if (!trustProxy) return direct;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(part => part.trim()).filter(Boolean).at(-1);
  return forwarded && forwarded.length <= 64 && /^[0-9a-fA-F:.]+$/.test(forwarded) ? forwarded : direct;
}
const sha256 = (value: unknown): Buffer => createHash('sha256').update(String(value)).digest();
/** The first line of an error's message, for the log. Never throws, whatever was thrown at us. */
function firstLine(error: unknown): string {
  try { return (String(fieldOf(error, 'message') ?? error).split('\n')[0] ?? '').slice(0, 300); } catch { return 'unprintable error'; }
}
function packageVersion(): string {
  try { const version = fieldOf(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')), 'version'); return typeof version === 'string' && version ? version : '0'; } catch { return '0'; }
}
/** Whether this connection is TLS (a direct HTTPS listener) or reached through a trusted proxy that spoke HTTPS. */
const isSecure = (req: IncomingMessage, trustProxy: boolean): boolean => ('encrypted' in req.socket && Boolean(req.socket.encrypted)) || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
const errorDetail = (error: unknown): unknown => fieldOf(error, 'code') || fieldOf(error, 'message');
async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'json_required');
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (Buffer.byteLength(body) > 8192) throw fail(413, 'body_too_large');
  }
  try { const value: unknown = JSON.parse(body); if (!isObject(value) || Array.isArray(value)) throw Error(); return value; } catch { throw fail(400, 'invalid_json'); }
}

export async function createServer({ dataDir = process.env.DATA_DIR || resolve('.data'), distDir = resolve('dist'), now = Date.now, sessionTtlMs = Number(process.env.SESSION_TTL_DAYS || 30) * 86400000, actionWindowMs = ACTION_WINDOW_MS, maxActiveSessions = 10000, voiceConfigProvider, store: providedStore, routes: routeModules, wsModules,
  lazyFlushMs, shardIo,
  heartbeatMs = Number(process.env.HEARTBEAT_SECONDS || 10) * 1000,
  moderatorToken = process.env.MODERATOR_TOKEN,
  trustProxy = process.env.TRUST_PROXY === '1',
  votesPerAddress = Number(process.env.VOTES_PER_ADDRESS ?? 3),
  voteCapMode = process.env.VOTE_CAP_MODE || 'flag',
  log = (line: string) => console.error(line),
  receiptLimits, // { perPlayer, global, lightPerPlayer, lightGlobal } for ctx.once (server/routes/once.ts); the defaults are the documented numbers
  env = process.env, // where ctx.env reads the outreach settings from (a test passes its own object)
  randomId = () => randomUUID(), // ids and match seeds modules draw (a scripted run passes a counter so every deal repeats)
  fetch: outbound = globalThis.fetch, // the one way a module makes an outside request (a test passes a fake)
  publicOrigin: givenOrigin = process.env.PUBLIC_ORIGIN, // e.g. https://play.example — used for absolute links in previews
  buildId = process.env.BUILD_ID || packageVersion(),
  // Error monitoring and analytics (server/telemetry): off, and doing nothing at all, unless its environment keys are set.
  telemetry = createServerTelemetry({ env: process.env, buildId, now, log }) }: ServerOptions = {}): Promise<AllworldServer> {
  const configuredOrigin = cleanOrigin(givenOrigin);
  // The ingest hosts the browser may talk to: none unless telemetry is configured (the same reading the client's config comes from).
  const telemetryHosts = telemetryOrigins(readTelemetryConfig(env, { buildId }));
  /** What the security headers need to know of a request. */
  const factsOf = (req: IncomingMessage | undefined): RequestFacts => ({ secure: req ? isSecure(req, trustProxy) : false, host: cleanHost(req?.headers.host) });
  const store = providedStore || await createStore(dataDir, { ...(lazyFlushMs !== undefined ? { lazyFlushMs } : {}) });
  // The world registry: one append-only shard file per local government, beside the main data file.
  const shards = await createShardStore(join(dataDir, 'world'), { empty: worldRegistry.empty, reduce: worldRegistry.reduce, snapshot: worldRegistry.snapshot, loaded: worldRegistry.loaded, live: worldRegistry.live, log, ...(shardIo ? { io: shardIo } : {}) });
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs < 60000) throw new Error('Invalid session TTL');
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 1000 || heartbeatMs > 60000) throw new Error('Invalid heartbeat interval');
  if (!Number.isSafeInteger(votesPerAddress) || votesPerAddress < 0) throw new Error('Invalid VOTES_PER_ADDRESS');
  if (voteCapMode !== 'flag' && voteCapMode !== 'refuse') throw new Error('Invalid VOTE_CAP_MODE (use "flag" or "refuse")');
  // The operator token never leaves this closure: only its digest is kept, it is compared in
  // constant time, and nothing here logs it. Unset (or too short to be a real secret) = no moderator surface.
  // It must be something a Bearer header can carry: 24–512 printable ASCII characters without spaces.
  const moderatorDigest = validOperatorToken(moderatorToken) ? sha256(moderatorToken) : null;
  if (typeof moderatorToken === 'string' && moderatorToken && !moderatorDigest) console.error('MODERATOR_TOKEN must be 24 to 512 printable ASCII characters without spaces: the moderator routes stay disabled.');
  moderatorToken = undefined;
  // A lived life is never destroyed: it moves to the archive without its secret (host-context.js, shared with the Worker).
  const archiveSession = sessionArchiver({ now, randomId: () => randomUUID() });
  /** Keys of stored sessions matching `predicate`, without copying every record when the store can avoid it. */
  const sessionKeys = (db: Db, predicate: (record: SessionRecord) => boolean): string[] => (db.$store ? db.$store.scanSessions(predicate) : Object.entries(db.sessions).filter(([, record]) => predicate(record)).map(([key]) => key));
  /** The stored session with this public id, or undefined (any expiry). */
  function sessionByPublicId(db: Db, publicId: string): SessionRecord | undefined {
    if (db.$store) { const key = db.$store.sessionKeyByPublicId(publicId); return key === undefined ? undefined : db.sessions[key]; }
    return Object.values(db.sessions).find(item => item.publicId === publicId);
  }
  await store.transact(db => {
    // Rotate credentials created by versions that exposed the cookie as a public ID.
    for (const secret of sessionKeys(db, session => !session.publicId || !Number.isFinite(session.expiresAt) || session.expiresAt <= now())) { const stored = db.sessions[secret]; if (stored) archiveSession(db, secret, stored); }
  });
  const keyFiles = new Map<string, Promise<unknown>>();
  /** A secret made once by `make()` and kept beside the data file, readable by the server's user only. Never logged. */
  function keyFile<T extends object>(name: string, make: () => T | Promise<T>): Promise<T> {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) return Promise.reject(new Error('Invalid key file name'));
    if (!keyFiles.has(name)) keyFiles.set(name, (async (): Promise<T> => {
      const dir = resolve(dataDir, 'keys'), file = resolve(dir, `${name}.json`);
      // The file holds what make() wrote for this name earlier, so it is read back as the shape make() returns.
      try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { /* not made yet */ }
      const value = await make();
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(file, JSON.stringify(value), { mode: 0o600 });
      await chmod(file, 0o600);
      return value;
    })().catch((error) => { keyFiles.delete(name); throw error; }));
    return keyFiles.get(name) as Promise<T>;
  }
  // The rate limiter (server/limiter.ts): bounded per class of key, and a full table makes room instead of refusing newcomers.
  const { allow, peek } = createMemoryLimiter({ now });
  const sessionFor = (req: IncomingMessage, db: Db, renew = false): SessionRecord | undefined => {
    const id = cookieId(req);
    const session = id && uuid.test(id) ? db.sessions[id] : undefined;
    if (!session || session.expiresAt <= now()) return undefined;
    if (renew) renewSession(session, now(), sessionTtlMs);
    return session;
  };
  const receipts = createOnce({ now, windowMs: actionWindowMs, limits: receiptLimits });
  // ctx.settle, ctx.act (server authority, always under a receipt) and what POST /api/action runs: host-context.js, shared with the Worker.
  const { settle, act, playerAct } = lifeAuthority({ now, receipts });
  /** True from a failed write of the data file until the next successful one. Reads still work then; saving does not. */
  const storageFailing = () => { try { return store.stats?.().failing === true; } catch { return false; } };
  function cookieHeader(req: IncomingMessage, secret: string | undefined): string {
    const secure = isSecure(req, trustProxy);
    return `sid=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure ? '; Secure' : ''}`;
  }
  function renewedHeaders(req: IncomingMessage): Record<string, string> {
    const secret = cookieId(req);
    for (const ws of connections()) if (ws.secret === secret) { ws.expiresAt = now() + sessionTtlMs; ws.lastSessionRenewedAt = now(); }
    return { 'Set-Cookie': cookieHeader(req, secret) };
  }
  const addressOf = (req: IncomingMessage): string => clientAddress(req, trustProxy);
  /**
   * The origin written into absolute links (a link preview needs absolute URLs): PUBLIC_ORIGIN when the operator set
   * it, otherwise the request's own Host — accepted only if it is made of host characters, so nothing a client sends
   * in that header can put markup into a page.
   */
  function publicOrigin(req: IncomingMessage): string {
    if (configuredOrigin) return configuredOrigin;
    const host = cleanHost(req.headers.host);
    if (!host) return '';
    return `${isSecure(req, trustProxy) ? 'https' : 'http'}://${host}`;
  }
  /** Header-only bearer check for the operator routes. False when the feature is disabled. */
  function isModerator(req: IncomingMessage): boolean {
    if (!moderatorDigest) return false;
    const token = bearerToken(req.headers.authorization);
    return token !== null && timingSafeEqual(sha256(token), moderatorDigest);
  }
  /**
   * The ONLY place an API response is written. It answers at most once per request: the body is
   * turned into text BEFORE any header is sent, so a body that cannot be serialised becomes one
   * generic 500 instead of a half-written reply, and a second call for the same response (a
   * handler that fails after it was answered) does nothing. It never throws. Returns whether it wrote.
   */
  function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): boolean {
    if (res.headersSent || res.writableEnded || res.destroyed) return false;
    let text: string, code = Number.isInteger(status) && status >= 200 && status <= 599 ? status : 500, extra = headers;
    try { text = JSON.stringify(code === status ? body ?? {} : { error: 'internal_error' }); if (typeof text !== 'string') throw new TypeError('The response body is not JSON'); }
    catch (error) { log(`Response could not be serialised: ${firstLine(error)}`); code = 500; text = '{"error":"internal_error"}'; extra = {}; }
    try {
      try { res.writeHead(code, { ...apiHeaders(factsOf(res.req)), ...extra }); }
      catch (error) {
        // A header value Node refuses (a control character). Nothing has been sent yet: answer generically.
        log(`Response headers were refused: ${errorDetail(error)}`);
        if (res.headersSent) { res.destroy(); return false; }
        text = '{"error":"internal_error"}';
        res.writeHead(500, apiHeaders(factsOf(res.req)));
      }
      res.end(text);
      return true;
    } catch (error) { log(`Response could not be written: ${errorDetail(error)}`); try { res.destroy(); } catch {} return false; }
  }
  /**
   * The ONLY place an HTML page is written (ctx.pages: the link preview /s/<code>, the e-mail pages /e/…). The same promise
   * as reply(): at most one answer per request, and it never throws. Every page goes out with the same headers, which a
   * page cannot change: no script may run, nothing may frame it, it sets no cookie and it sends no referrer.
   */
  function replyPage(res: ServerResponse, status: number, html: string, { cache = false, head = false }: { cache?: boolean; head?: boolean } = {}): boolean {
    if (res.headersSent || res.writableEnded || res.destroyed) return false;
    try {
      res.writeHead(Number.isInteger(status) && status >= 200 && status <= 599 ? status : 200, { ...pageHeaders(factsOf(res.req)), 'Cache-Control': cache ? 'public, max-age=300' : 'no-store' });
      res.end(head ? undefined : html);
      return true;
    } catch (error) { log(`Page could not be written: ${errorDetail(error)}`); try { res.destroy(); } catch {} return false; }
  }
  /** The registered page whose prefix a path starts with: [prefix, render] or undefined. */
  const pageFor = (pathname: string) => findPage(pages, pathname);
  /** index.html with the default preview image made absolute (a link preview needs an absolute URL): see serveIndex. */
  let indexCache: { mtimeMs: number; size: number; text: string; byOrigin: Map<string, string> } | null = null;
  async function serveIndex(req: IncomingMessage, file: string): Promise<string> {
    const info = await stat(file);
    let cache = indexCache;
    if (!cache || cache.mtimeMs !== info.mtimeMs || cache.size !== info.size) cache = indexCache = { mtimeMs: info.mtimeMs, size: info.size, text: await readFile(file, 'utf8'), byOrigin: new Map() };
    const origin = publicOrigin(req);
    if (!origin) return cache.text;
    let absolute = cache.byOrigin.get(origin);
    if (absolute === undefined) {
      if (cache.byOrigin.size >= 8) cache.byOrigin.clear();
      // Only the two preview-image attributes, and only when they are the site-relative /og/ path the build ships.
      absolute = absolutePreviewImage(cache.text, origin);
      cache.byOrigin.set(origin, absolute);
    }
    return absolute;
  }
  // Nothing a request does may escape as an unhandled rejection: the last line of defence closes the connection.
  const server = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.destroy(); } catch {} }); });
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? '';
    let at: Matched | null = null; // the matched route and its request, for telemetry (a template and codes, never the URL or the body)
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        // Operator routes authenticate with a bearer token in a header, which a browser never attaches
        // by itself, so they are not tied to the page's origin. Every other route keeps the origin check.
        const operator = url.pathname.startsWith('/api/mod/');
        if (!operator && !sameOrigin(req)) throw fail(403, 'origin_rejected');
        const ip = addressOf(req);
        // A request carrying the operator's token has its own budget (routes/moderation.js), so other
        // clients behind the same address cannot use up the operator's share of the general limit.
        if (!(operator && isModerator(req)) && !allow(`http:${ip}`, 600)) throw fail(429, 'rate_limited');
        const route = routes.match(method, url.pathname);
        if (!route) throw fail(404, 'not_found');
        const request: HostRequest = {
          method, path: url.pathname, params: route.params, query: url.searchParams, ip,
          /** True only for a request carrying the operator's bearer token (never a cookie or a query value). */
          moderator: () => isModerator(req),
          json: () => jsonBody(req).then(body => (request.body = body)),
          session: (db: Db, { renew = false }: { renew?: boolean } = {}) => { const session = sessionFor(req, db, renew); if (session) request.publicId = session.publicId; return session; },
          requireSession(db: Db, options?: { renew?: boolean }) { const session = this.session(db, options); if (!session) throw fail(401, 'device_session_required'); return session; },
          // Foundation-only: the cookie secret and the raw request, used by core routes for cookies and room checks.
          secret: cookieId(req), raw: req,
        };
        // ROOM REVALIDATION, for every route and every outcome. A request may have settled or changed
        // the caller's life (or been refused, or lost its write and been undone): before it is answered,
        // every room that player's sockets are in is re-checked against the STORED lives. The player is
        // identified by their own sockets, so a request from a device with no socket costs nothing.
        let returned: RouteResult | void;
        at = { key: route.key, request, began: performance.now() };
        try { returned = await route.handler(request); }
        finally { for (const publicId of new Set(connections().filter(ws => ws.secret === request.secret && ws.room).map(ws => ws.session.id))) await ctx.core.revalidate(publicId); }
        const result: RouteResult = returned && typeof returned === 'object' ? returned : {};
        const status = result.status || 200;
        // While the data file cannot be written, every success says so: what the player sees is what
        // is stored, and nothing new is being saved.
        const payload = status < 300 && result.body && typeof result.body === 'object' && !Array.isArray(result.body)
          ? { ...result.body, serverTime: now(), ...(storageFailing() ? { storage: 'failing' } : {}) } : result.body ?? {};
        const sent = reply(res, status, payload, { ...(result.renew === true ? renewedHeaders(req) : {}), ...routeHeaders(result.headers) });
        telemetry.http({ method, route: route.key, status, ms: performance.now() - at.began, publicId: request.publicId, body: result.body, action: { type: request.body?.type, code: fieldOf(result.body, 'code') } });
        // `after` runs once the answer is out. Whatever it does, the request is already answered: a
        // failure in it is logged and goes no further.
        if (sent && typeof result.after === 'function') { try { await result.after(); } catch (error) { log(`After-response step of ${method} ${route.key} failed: ${firstLine(error)}`); } }
        return;
      }
      const paged = pageFor(url.pathname);
      if (!['GET', 'HEAD'].includes(method) && !(paged && method === 'POST')) throw fail(405, 'method_not_allowed');
      // PAGES: a module may serve one small HTML page for a path prefix outside /api/ (ctx.pages — the link-preview
      // page /s/<code> and the e-mail pages /e/…, routes/growth.js). A page is a route like any other for the host: the
      // same per-address limit, the same telemetry hooks (a path TEMPLATE, never the path), one writer that answers at
      // most once (replyPage). The page itself gets the path, the query and the public origin — never the request, its
      // headers or its cookie — and returns { status, html }; it cannot set a header.
      if (paged) {
        const [prefix, render] = paged, ip = addressOf(req);
        at = { key: `${prefix}*`, request: {}, began: performance.now() };
        if (!allow(`http:${ip}`, 600)) throw fail(429, 'rate_limited');
        // A POST to a page carries no body the page may read (the one use is an unsubscribe link: RFC 8058 posts a fixed
        // form). It is drained without being kept, and a body larger than any such form ends the connection.
        if (method === 'POST') { let seen = 0; req.on('data', (chunk) => { seen += chunk.length; if (seen > 8192) req.destroy(); }); req.resume(); }
        const page = await render({ path: url.pathname, query: url.searchParams, origin: publicOrigin(req), ip, method });
        if (page && typeof page.html === 'string') {
          const given = page.status;
          const status = typeof given === 'number' && Number.isInteger(given) && given >= 200 && given <= 599 ? given : 200;
          replyPage(res, status, page.html, { cache: page.cache !== false && method !== 'POST' && status === 200, head: method === 'HEAD' });
          telemetry.http({ method, route: at.key, status, ms: performance.now() - at.began });
          return;
        }
        // A registered prefix that renders nothing is not a page: a POST has nowhere else to go, a GET falls through to the game.
        if (method === 'POST') throw fail(405, 'method_not_allowed');
        at = null;
      }
      // The manifest and the sitemap are made by code (site-files.ts), not shipped as files: the release package admits neither extension.
      const site = siteFile(url.pathname, publicOrigin(req));
      if (site) {
        res.writeHead(200, { 'Content-Type': site.type, 'X-Content-Type-Options': 'nosniff' });
        res.end(method === 'HEAD' ? undefined : site.body);
        return;
      }
      const root = resolve(distDir);
      let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (path !== root && !path.startsWith(root + sep)) throw fail(403, 'invalid_path');
      if (extname(path) === '.map') throw fail(404, 'not_found'); // source maps are uploaded to Sentry, never served
      // A hashed build file that is gone (an old tab after a deploy) is a 404, never the app page: a dynamic import of it must fail clearly.
      const inAssets = url.pathname.startsWith('/assets/');
      let found = true;
      try { if (!(await stat(path)).isFile()) found = false; } catch { found = false; }
      if (!found) {
        if (inAssets) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(method === 'HEAD' ? undefined : 'Not found'); return; }
        path = resolve(root, 'index.html');
      }
      // The game's own page: its default link-preview image is made absolute here, from PUBLIC_ORIGIN (or this request's own
      // host when that is not set), because the crawlers of chat apps do not resolve a relative og:image.
      const isIndex = path === resolve(root, 'index.html');
      const html = isIndex ? await serveIndex(req, path) : '';
      const bytes = isIndex ? Buffer.from(html) : await readFile(path);
      if (res.headersSent || res.writableEnded) return;
      // The game's page carries the full set of security headers; its inline scripts are admitted by hash, from the page as served.
      const security = isIndex ? appHeaders({ ...factsOf(req), scriptHashes: await inlineScriptHashes(html), telemetry: telemetryHosts }) : {};
      // Hashed files under /assets/ never change: cached for a year. The page itself is revalidated every time.
      const cache = inAssets ? 'public, max-age=31536000, immutable' : path === resolve(root, 'index.html') ? 'no-cache' : 'public, max-age=3600';
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', ...security });
      res.end(method === 'HEAD' ? undefined : bytes);
    } catch (thrown) {
      // Only the first line of the message is logged: never a header, a cookie or a body.
      const error: Record<string, unknown> = isObject(thrown) ? thrown : { message: thrown };
      const errorStatus = error.status, errorCode = error.code;
      const known = typeof errorStatus === 'number' && Number.isInteger(errorStatus) && typeof errorCode === 'string';
      if (!known && errorCode !== 'ENOENT') log(`Request failed: ${firstLine(error)}`);
      telemetry.httpFailed(thrown, { method, route: at?.key, status: known ? errorStatus : errorCode === 'ENOENT' ? 404 : 500, code: known ? errorCode : undefined, body: at?.request.body, publicId: at?.request.publicId });
      reply(res, known ? errorStatus : errorCode === 'ENOENT' ? 404 : 500, { error: known ? errorCode : errorCode === 'ENOENT' ? 'build_required' : 'internal_error',
        ...(known && typeof error.reason === 'string' ? { reason: error.reason } : {}) });
    }
  }
  // A client that goes away mid-request must never take the process with it.
  server.on('clientError', (error: Error, socket: Duplex) => { try { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); else socket.destroy(); } catch {} });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  /** Every socket the server holds. Each one was given its WsConnection fields on upgrade, before it was added. */
  const connections = (): Connection[] => [...wss.clients] as Connection[];
  const PONG_GRACE_MS = Math.min(5000, Math.floor(heartbeatMs / 2));
  const unresponsive = (ws: WsConnection): boolean => ws.pingedAt > 0 && !ws.alive && now() - ws.pingedAt >= PONG_GRACE_MS;
  // A WsConnection is always the ws WebSocket the host authenticated (see WsConnection in types.ts).
  const send = (ws: WsConnection, message: ServerFrame): void => { const socket = ws as Connection; if (socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(message)); telemetry.socketOut(socket, message); } };
  /**
   * The server context handed to every route and ws module. Documented in routes/index.js.
   * `core` holds foundation internals (cookies, sockets, room checks); feature modules use the rest.
   */
  // In-process events between server modules (never sent to a client by the host itself).
  type Listener = (data: ServerEvents[keyof ServerEvents]) => void;
  const listeners = new Map<keyof ServerEvents, Listener[]>();
  const startup: Promise<unknown>[] = [];
  const closing: (() => Promise<void>)[] = [];
  /** Small HTML pages outside /api/, by path prefix: pages.set('/s/', async ({ path, query, origin, ip }) => ({ status, html })). */
  const pages = new Map<string, PageHandler>();
  const ctx: RouteContext = {
    store, shards: shards as ShardStore, now, fail, allow, peek, collection, send, publicSession, cityIds: CITY_IDS, telemetry,
    randomId,
    on(event, fn) { let list = listeners.get(event); if (!list) listeners.set(event, list = []); list.push(fn as Listener); },
    emit(event, data) { for (const fn of listeners.get(event) || []) { try { fn(data); } catch (error) { console.error(`Listener for ${event} failed:`, fieldOf(error, 'message')); } } },
    settle,
    // Server authority: ctx.act may run server-only actions (internal: true). Route modules call it with action types they
    // name themselves, never with a type taken from a request, and every call runs under a receipt (host-context.js lifeAuthority).
    act,
    // Exactly-once for a write that carries a client id — see server/routes/once.ts.
    once: receipts.once,
    onceId: receipts.onceId,
    push(publicId, message) {
      let sent = 0;
      for (const ws of connections()) if (ws.session?.id === publicId && ws.readyState === WebSocket.OPEN) { send(ws, message); sent += 1; }
      return sent;
    },
    // A socket whose last ping has gone unanswered for PONG_GRACE_MS is not counted: see the heartbeat below.
    online: (publicId) => connections().some(ws => ws.session?.id === publicId && ws.readyState === WebSocket.OPEN && !unresponsive(ws)),
    /**
     * Whether a player's stored life in a city is at Home (same rule as joining the Home room).
     * Read-only: nothing is settled, so a trip that has ended but not been settled yet reads as "not home".
     */
    atHome(db, publicId, cityId) {
      const city: CityId | undefined = CITY_IDS.find(id => id === cityId);
      if (typeof publicId !== 'string' || !city) return false;
      const found = sessionByPublicId(db, publicId);
      const session = found && found.expiresAt > now() ? found : undefined;
      const state = session?.cities?.[city]?.state;
      return Boolean(state) && canOccupyVenue(state, 'home');
    },
    // Checks one module provides for another. checks.homeGuest is set by the social module and
    // read by ws/rooms.js; while it is absent, nobody can join another player's Home room.
    checks: {},
    // One game action for the caller, exactly once, with everything it changed saved together (routes/core.js).
    command: (request: RouteRequest, body: ActionRequest, options) => executeCommand(ctx, request, body, options),
    // Small HTML pages outside /api/, by path prefix: pages.set('/s/', async ({ path, query, origin, ip }) => ({ status, html })).
    pages,
    // OUTSIDE THE GAME (server/growth/outreach.ts). Three small capabilities, so that module stays free of Node built-ins:
    //   env(name)          one of the settings below, or '' — nothing else of the environment is reachable
    //   fetch(url, init)   an outside request (the mail provider, a browser's push service)
    //   keyFile(name, make) → Promise<object>   a secret this server makes for itself (signing key, push keys), kept in
    //                      DATA_DIR/keys/<name>.json with file mode 0600 and never in the data file or a response
    env: envReader(env),
    // An outside request is HTTPS, bounded in time whatever the caller passed, and never follows a redirect (host-context.js).
    fetch: outboundFetch(outbound),
    // Work that outlives the request that started it (a message being sent, a registry sync). Node needs no help to finish it;
    // the Worker host keeps itself alive for it. A module calls ctx.waitUntil?.(promise) and never relies on the answer.
    waitUntil() {},
    keyFile,
    config: { publicOrigin: configuredOrigin, sessionTtlMs, actionWindowMs, maxActiveSessions, voiceConfigProvider, buildId: String(buildId).slice(0, 40), votesPerAddress, voteCapMode, heartbeatMs, moderation: Boolean(moderatorDigest) },
    // Work a module must finish before the server takes requests (loading an in-memory index).
    startup,
    // Work a module must finish when the server stops, BEFORE the store is closed: async functions, run in order
    // (outreach waits for a message that is being sent, so its outcome is in the data file).
    closing,
    core: {
      archiveSession,
      expiredSessionKeys: (db) => sessionKeys(db, record => record.expiresAt <= now()),
      sessionByPublicId,
      unresponsive: (ws) => unresponsive(ws),
      storeStats: () => (typeof store.stats === 'function' ? store.stats() : null),
      newIdentity: () => ({ secret: randomUUID(), publicId: randomUUID() }),
      newId: () => randomUUID(),
      cookieHeader: (request, secret) => { if (!isNodeRequest(request.raw)) throw new TypeError('The request has no raw Node request'); return cookieHeader(request.raw, secret); },
      sockets: () => connections(),
      isOpen: (ws) => ws.readyState === WebSocket.OPEN,
      sessionOf: (ws, db) => db.sessions[ws.secret],
      // What POST /api/action runs: a player's own request, with no server authority.
      playerAct,
      // The receipt steps of an action, shared by POST /api/action and ctx.act (server/routes/once.ts).
      actionOnce: receipts.action,
      storageFailing,
      log,
      // Room hooks. The socket registry (ws/index.js) replaces these four; the defaults keep the core
      // routes working when a host is built without it (a test that passes its own wsModules):
      // nobody is in a room, so there is nothing to drop, rename or confirm.
      validateMemberships: async () => {},
      refreshNames: () => {},
      roomStillValid: () => false,
      // revalidate(publicId): re-check that player's rooms against the stored lives. Defined by the socket registry
      // (ws/index.js) for whatever modules are registered; it never throws. Called for every API request below.
      revalidate: async () => {},
    },
  };
  const sockets = buildSocketHandlers(ctx, wsModules);
  const routes = buildRoutes(ctx, routeModules || [...ROUTE_MODULES, telemetryRoutes]);
  telemetry.attach(ctx);
  /** The renewed session cookie each upgrade request gets on its 101 answer. */
  const renewedCookies = new WeakMap<IncomingMessage, string>();
  server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      if (req.url !== '/socket' || !req.headers.origin || !sameOrigin(req) || !allow(`upgrade:${addressOf(req)}`, 60)) throw Error('Rejected');
      // Connecting renews the session. While the data file cannot be written the renewal is skipped
      // (it was undone) and the stored session is used as it is: presence and chat keep working.
      const session = await store.transact(db => sessionFor(req, db, true))
        .catch(error => { if (fieldOf(error, 'code') !== 'storage_unavailable') throw error; return store.read(db => sessionFor(req, db, false)); });
      if (!session) throw Error('Unauthorized');
      if (wss.clients.size >= 1024 || connections().filter(ws => ws.session.id === session.publicId).length >= 8) throw Error('Connection capacity');
      renewedCookies.set(req, cookieHeader(req, session.secret));
      wss.handleUpgrade(req, socket, head, socketOfUpgrade => {
        const ws = socketOfUpgrade as Connection;
        ws.session = publicSession(session);
        ws.secret = session.secret;
        ws.expiresAt = session.expiresAt;
        ws.lastSessionRenewedAt = now();
        ws.ip = addressOf(req);
        sockets.open(ws);
        wss.emit('connection', ws);
      });
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  wss.on('headers', (headers: string[], req: IncomingMessage) => { const renewedCookie = renewedCookies.get(req); if (renewedCookie) headers.push(`Set-Cookie: ${renewedCookie}`); });
  const socketRenewals = new Map<string, Promise<number>>();
  async function renewSocketSession(ws: Connection): Promise<void> {
    if (now() - ws.lastSessionRenewedAt < 60000) return;
    let pending = socketRenewals.get(ws.secret);
    if (!pending) {
      pending = store.transact(db => {
        const session = db.sessions[ws.secret];
        if (!session || !renewSession(session, now(), sessionTtlMs)) throw Error('device_session_required');
        return session.expiresAt;
      });
      socketRenewals.set(ws.secret, pending);
    }
    try {
      const expiration = await pending;
      for (const peer of connections()) if (peer.secret === ws.secret) {
        peer.expiresAt = expiration; peer.lastSessionRenewedAt = now();
      }
    } catch (error) {
      // The renewal could not be saved, so it did not happen: the socket keeps its current expiry
      // and the message is still handled. It is tried again with the next message.
      if (fieldOf(error, 'code') !== 'storage_unavailable') throw error;
    } finally { if (socketRenewals.get(ws.secret) === pending) socketRenewals.delete(ws.secret); }
  }
  /** A signal's `to` may be echoed in an error only when it is a public id other than the caller's own; the cookie secret is never echoed. */
  const echoable = (ws: Connection, to: unknown): to is string => typeof to === 'string' && uuid.test(to) && to !== ws.session.id && to !== ws.secret;
  wss.on('connection', (socketOfConnection: WebSocket) => {
    const ws = socketOfConnection as Connection;
    ws.alive = true; ws.pingedAt = 0; ws.seenAt = now();
    ws.on('pong', () => { ws.alive = true; ws.seenAt = Math.max(now(), ws.pingedAt); });
    ws.on('error', () => {});
    ws.on('close', () => { telemetry.socketClosed(ws); sockets.close(ws); });
    let messages = Promise.resolve();
    ws.on('message', (raw, binary) => {
      if (binary || !allow(`ws:${ws.session.id}`, 600)) {
        let parsed: unknown;
        try { parsed = JSON.parse(raw.toString()); } catch {}
        const rejected: Record<string, unknown> = isObject(parsed) ? parsed : {};
        send(ws, { type: 'error', code: 'rate_limited', error: 'rate_limited',
          ...(rejected.type === 'signal' && echoable(ws, rejected.to) ? { to: rejected.to } : {}),
          ...(rejected.type === 'chat' && typeof rejected.clientId === 'string' && rejected.clientId.length <= 80 ? { clientId: rejected.clientId } : {}) });
        ws.close(1008, 'Rate limit'); return;
      }
      ws.alive = true; ws.seenAt = Math.max(now(), ws.pingedAt); // any frame proves the connection is alive
      messages = messages.then(async () => {
      let message: unknown;
      try {
        if (ws.expiresAt <= now()) { ws.close(1008, 'Device session expired'); return; }
        if (ws.readyState !== WebSocket.OPEN) return;
        try { message = JSON.parse(raw.toString()); } catch { throw Error('invalid_message'); }
        if (!message || typeof message !== 'object') throw Error('invalid_message');
        await renewSocketSession(ws);
        const frame = isFrame(message) ? message : undefined;
        const entry = frame ? sockets.messages.get(frame.type) : undefined;
        // Unknown types keep their historical replies: join_required outside a room, invalid_message inside one.
        if (!entry || !frame) throw Error(ws.room ? 'invalid_message' : 'join_required');
        if (entry.room && !ws.room) throw Error('join_required');
        await entry.handle(ws, frame);
        telemetry.socketIn(ws, message);
      } catch (thrown) {
        // Only a machine code goes to the client. Anything else (a TypeError's text, a file path) is logged here instead.
        // A coded refusal may carry the sentence the server wrote for the player (`reason`); it is repeated as `message`,
        // the field the community panel prints. Uncoded errors never carry either.
        const text = firstLine(thrown);
        const coded = /^[a-z][a-z0-9_]{1,63}$/.test(text);
        if (!coded) log(`Socket message failed: ${text}`);
        telemetry.socketFailed(ws, message, text, coded, thrown);
        const error: Record<string, unknown> = coded ? (isObject(thrown) ? thrown : {}) : { message: 'internal_error' };
        const given: Record<string, unknown> = isObject(message) ? message : {};
        // The code is whatever machine code the module threw (it matched the shape above); an uncoded message is never sent.
        const code = typeof error.message === 'string' ? { code: error.message as SocketErrorCode, error: error.message as SocketErrorCode } : {};
        send(ws, { type: 'error', ...code as { code: SocketErrorCode; error: SocketErrorCode }, ...(typeof error.reason === 'string' ? { reason: error.reason, message: error.reason } : {}),
          ...(given.type === 'signal' && echoable(ws, given.to) ? { to: given.to } : {}), ...(given.type === 'chat' && typeof given.clientId === 'string' && given.clientId.length <= 80 ? { clientId: given.clientId } : {}) }); }
      }).catch(() => ws.close(1011, 'Server error'));
    });
  });
  /**
   * HEARTBEAT (presence freshness). Every `heartbeatMs` (default 10 s, HEARTBEAT_SECONDS) each socket
   * is pinged; one that has not answered by the next beat is terminated, so a dead connection is
   * closed within 2 × heartbeatMs. It stops COUNTING as online sooner: once a ping has gone
   * unanswered for PONG_GRACE_MS the socket is `unresponsive` and presence ignores it. A dead
   * connection therefore shows as online for at most heartbeatMs + PONG_GRACE_MS (15 s by default).
   * Each beat also raises the in-process 'heartbeat' event, which the room module uses to end
   * expired house visits on time even when neither the guest nor the host sends anything.
   */
  function beat() {
    for (const ws of connections()) {
      if (!ws.alive || ws.expiresAt <= now()) { ws.terminate(); continue; }
      ws.alive = false; ws.pingedAt = now(); ws.ping();
    }
    ctx.emit('heartbeat', { now: now() });
  }
  const heartbeat = setInterval(beat, heartbeatMs);
  heartbeat.unref();
  const world = worldOf(ctx);
  server.on('close', () => { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); });
  // close(callback) reports back only once the store has written everything, so "the server has
  // stopped" always means "the data file is complete" — for a restart, a test or a shutdown script.
  const closeHttp = server.close.bind(server);
  /**
   * THE SHUTDOWN ORDER, one for every way the server stops (close(), SIGINT, SIGTERM). Each step is attempted even if the
   * one before it failed, and none can throw:
   *   1. modules finish what they are in the middle of (ctx.closing: outreach waits for a message being sent, so that
   *      "sent" or "failed" is recorded and a restart can never send it twice)
   *   2. the world registry settles, saves its summary and closes its shard files
   *   3. the main store writes everything it holds                — from here the data on disk is complete
   *   4. telemetry sends what it queued, last, so it can still report a failure of the steps above
   */
  let flushing: Promise<void> | null = null;
  const flush = (): Promise<void> => (flushing ??= (async () => {
    const step = async (name: string, fn: () => unknown): Promise<void> => { try { await fn(); } catch (error) { log(`Shutdown: ${name} failed: ${firstLine(error)}`); } };
    clearInterval(heartbeat);
    for (const fn of closing.splice(0)) await step('a module', fn);
    await step('the world registry', async () => { await world.idle(); await world.saveMeta(); await shards.close(); });
    await step('the store', () => store.close?.());
    await step('telemetry', () => telemetry.close());
  })());
  server.close = (callback?: (error?: Error) => void) => { closeHttp((error) => { flush().finally(() => callback?.(error)); }); return server; };
  // Attached before the startup work is awaited, as before: nothing that runs during startup can find them missing.
  const running = Object.assign(server, { wss, beat, store, shards, world, telemetry, flush });
  await Promise.all(startup.splice(0));
  return running;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.STORE_MODE) console.error('STORE_MODE is no longer used: there is one store. See "Storage and limits" in the README.');
  const server = await createServer();
  const telemetry = useTelemetry(server.telemetry);
  // Stop taking requests, then write everything in the one shutdown order (server.flush) before the process leaves. A step
  // that hangs (a provider that never answers) cannot hold the process: after the deadline it exits with what is on disk.
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    const deadline = setTimeout(() => process.exit(0), 20000); deadline.unref();
    try { server.closeIdleConnections(); for (const ws of server.wss.clients) ws.terminate(); } catch { /* already closing */ }
    server.flush().finally(() => process.exit(0));
  });
  // Only with error monitoring on: a crash is reported before the process exits as it would have anyway.
  if (telemetry.enabled) for (const event of ['uncaughtException', 'unhandledRejection']) process.once(event, (error) => { console.error(error); telemetry.captureError(error, { source: event, level: 'fatal' }); telemetry.close().finally(() => process.exit(1)); });
  telemetry.started();
  server.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () => { const address = server.address(); console.log(`Allworld server listening on ${isObject(address) ? address.port : address}`); });
}
