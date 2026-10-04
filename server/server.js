/**
 * Node host: HTTP + WebSocket plumbing, static files and the server context.
 * Everything Node-specific lives here and in store.js. Rules shared with the Cloudflare worker
 * live in protocol.js, life-service.js and src/life.js. Endpoints live in routes/*.js and
 * socket message types in ws/*.js — see routes/index.js and ws/index.js for those contracts.
 */
import http from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat, writeFile, mkdir, chmod } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createStore } from './store.js';
import { settleCity, applyLifeAction } from './life-service.js';
import { buildRoutes } from './routes/index.js';
import { executeCommand } from './routes/core.js';
import { createOnce } from './routes/once.js';
import { buildSocketHandlers } from './ws/index.js';
import { CITY_IDS, ACTION_WINDOW_MS, UUID_PATTERN as uuid, protocolError as fail, publicSession, isSameOrigin, archivedLife, renewSession, collection, canOccupyVenue } from './protocol.js';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const cookieId = (req) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4);
const sameOrigin = req => isSameOrigin(req.headers.origin, req.headers.host);
/**
 * The address limits and caps are keyed on. Directly connected: the socket's remote address. With
 * TRUST_PROXY=1 (one trusted reverse proxy in front): the right-most X-Forwarded-For entry, which is
 * the address that proxy itself saw — entries further left are client-supplied and are ignored.
 */
function clientAddress(req, trustProxy) {
  const direct = req.socket.remoteAddress || 'unknown';
  if (!trustProxy) return direct;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(part => part.trim()).filter(Boolean).at(-1);
  return forwarded && forwarded.length <= 64 && /^[0-9a-fA-F:.]+$/.test(forwarded) ? forwarded : direct;
}
const sha256 = value => createHash('sha256').update(String(value)).digest();
/** The first line of an error's message, for the log. Never throws, whatever was thrown at us. */
function firstLine(error) {
  try { return String(error?.message ?? error).split('\n')[0].slice(0, 300); } catch { return 'unprintable error'; }
}
function packageVersion() {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0'; } catch { return '0'; }
}
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'json_required');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw fail(413, 'body_too_large');
  }
  try { const value = JSON.parse(body); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { throw fail(400, 'invalid_json'); }
}

export async function createServer({ dataDir = process.env.DATA_DIR || resolve('.data'), distDir = resolve('dist'), now = Date.now, sessionTtlMs = Number(process.env.SESSION_TTL_DAYS || 30) * 86400000, actionWindowMs = ACTION_WINDOW_MS, maxActiveSessions = 10000, voiceConfigProvider, store: providedStore, routes: routeModules, wsModules,
  lazyFlushMs,
  heartbeatMs = Number(process.env.HEARTBEAT_SECONDS || 10) * 1000,
  moderatorToken = process.env.MODERATOR_TOKEN,
  trustProxy = process.env.TRUST_PROXY === '1',
  votesPerAddress = Number(process.env.VOTES_PER_ADDRESS ?? 3),
  voteCapMode = process.env.VOTE_CAP_MODE || 'flag',
  log = (line) => console.error(line),
  receiptLimits, // { perPlayer, global, lightPerPlayer, lightGlobal } for ctx.once (server/routes/once.js); the defaults are the documented numbers
  env = process.env, // where ctx.env reads the outreach settings from (a test passes its own object)
  fetch: outbound = globalThis.fetch, // the one way a module makes an outside request (a test passes a fake)
  publicOrigin: givenOrigin = process.env.PUBLIC_ORIGIN, // e.g. https://play.example — used for absolute links in previews
  buildId = process.env.BUILD_ID || packageVersion() } = {}) {
  const configuredOrigin = typeof givenOrigin === 'string' && /^https?:\/\/[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(givenOrigin) ? givenOrigin : '';
  const store = providedStore || await createStore(dataDir, { ...(lazyFlushMs !== undefined ? { lazyFlushMs } : {}) });
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs < 60000) throw new Error('Invalid session TTL');
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 1000 || heartbeatMs > 60000) throw new Error('Invalid heartbeat interval');
  if (!Number.isSafeInteger(votesPerAddress) || votesPerAddress < 0) throw new Error('Invalid VOTES_PER_ADDRESS');
  if (!['flag', 'refuse'].includes(voteCapMode)) throw new Error('Invalid VOTE_CAP_MODE (use "flag" or "refuse")');
  // The operator token never leaves this closure: only its digest is kept, it is compared in
  // constant time, and nothing here logs it. Unset (or too short to be a real secret) = no moderator surface.
  // It must be something a Bearer header can carry: 24–512 printable ASCII characters without spaces.
  const moderatorDigest = typeof moderatorToken === 'string' && /^[\x21-\x7e]{24,512}$/.test(moderatorToken) ? sha256(moderatorToken) : null;
  if (typeof moderatorToken === 'string' && moderatorToken && !moderatorDigest) console.error('MODERATOR_TOKEN must be 24 to 512 printable ASCII characters without spaces: the moderator routes stay disabled.');
  moderatorToken = undefined;
  /** A session with nothing in it — no city, or only lives still waiting for character creation — has no life to keep. */
  const hasLife = (session) => Object.values(session.cities || {}).some(entry => entry?.state && !(entry.state.onboarding?.required === true && entry.state.onboarding.done !== true));
  function archiveSession(db, secret, session) {
    // A lived life is never destroyed: it moves to the archive without its secret. A session that
    // never created a life leaves nothing behind, so abandoned sign-ups cannot grow the data file.
    if (hasLife(session)) {
      db.archivedLives ||= {};
      const publicId = session.publicId || randomUUID();
      db.archivedLives[publicId] = archivedLife(session, publicId, now());
    }
    delete db.sessions[secret];
  }
  /** Keys of stored sessions matching `predicate`, without copying every record when the store can avoid it. */
  const sessionKeys = (db, predicate) => (db.$store ? db.$store.scanSessions(predicate) : Object.entries(db.sessions).filter(([, record]) => predicate(record)).map(([key]) => key));
  /** The stored session with this public id, or undefined (any expiry). */
  function sessionByPublicId(db, publicId) {
    if (db.$store) { const key = db.$store.sessionKeyByPublicId(publicId); return key === undefined ? undefined : db.sessions[key]; }
    return Object.values(db.sessions).find(item => item.publicId === publicId);
  }
  await store.transact(db => {
    // Rotate credentials created by versions that exposed the cookie as a public ID.
    for (const secret of sessionKeys(db, session => !session.publicId || !Number.isFinite(session.expiresAt) || session.expiresAt <= now())) archiveSession(db, secret, db.sessions[secret]);
  });
  const OUTREACH_ENV = ['ZEPTOMAIL_AUTH', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'EMAIL_CONTACT_LINE', 'EMAIL_DAILY_CAP', 'WHATSAPP_CHANNEL_URL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_DAILY_CAP'];
  const keyFiles = new Map();
  /** A secret made once by `make()` and kept beside the data file, readable by the server's user only. Never logged. */
  function keyFile(name, make) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) return Promise.reject(new Error('Invalid key file name'));
    if (!keyFiles.has(name)) keyFiles.set(name, (async () => {
      const dir = resolve(dataDir, 'keys'), file = resolve(dir, `${name}.json`);
      try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* not made yet */ }
      const value = await make();
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(file, JSON.stringify(value), { mode: 0o600 });
      await chmod(file, 0o600);
      return value;
    })().catch((error) => { keyFiles.delete(name); throw error; }));
    return keyFiles.get(name);
  }
  const limits = new Map();
  /**
   * In-memory rate limiter: at most `count` calls per `windowMs` for one key. Each entry remembers its
   * own window, so making room never forgets a long window early (the 10-minute failed-token window
   * must not be cut short by a burst of one-minute keys). With 10,000 live keys a new key is refused,
   * except the operator's own budget (`mod:`), which a flood of other keys must not be able to lock out.
   */
  function allow(key, count = 120, windowMs = 60000) {
    const time = now();
    if (limits.size > 10000) for (const [id, entry] of limits) if (time - entry.start >= entry.windowMs || time < entry.start) limits.delete(id);
    const entry = limits.get(key);
    if (!entry || time - entry.start >= entry.windowMs || time < entry.start) {
      if (!entry && limits.size >= 10000 && !String(key).startsWith('mod:')) return false;
      limits.set(key, { start: time, count: 1, windowMs }); return true;
    }
    return ++entry.count <= count;
  }
  const sessionFor = (req, db, renew = false) => {
    const id = cookieId(req);
    const session = id && uuid.test(id) ? db.sessions[id] : undefined;
    if (!session || session.expiresAt <= now()) return undefined;
    if (renew) renewSession(session, now(), sessionTtlMs);
    return session;
  };
  // Which stored session a settled life belongs to, so ctx.act can find that player's receipts.
  const ownerOf = new WeakMap();
  const settle = (session, city) => { const state = settleCity(session, city, now()); ownerOf.set(state, session); return state; };
  const receipts = createOnce({ now, windowMs: actionWindowMs, limits: receiptLimits });
  /** True from a failed write of the data file until the next successful one. Reads still work then; saving does not. */
  const storageFailing = () => { try { return store.stats?.().failing === true; } catch { return false; } };
  function cookieHeader(req, secret) {
    const secure = req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
    return `sid=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure ? '; Secure' : ''}`;
  }
  function renewedHeaders(req) {
    const secret = cookieId(req);
    for (const ws of wss.clients) if (ws.secret === secret) { ws.expiresAt = now() + sessionTtlMs; ws.lastSessionRenewedAt = now(); }
    return { 'Set-Cookie': cookieHeader(req, secret) };
  }
  const addressOf = req => clientAddress(req, trustProxy);
  /**
   * The origin written into absolute links (a link preview needs absolute URLs): PUBLIC_ORIGIN when the operator set
   * it, otherwise the request's own Host — accepted only if it is made of host characters, so nothing a client sends
   * in that header can put markup into a page.
   */
  function publicOrigin(req) {
    if (configuredOrigin) return configuredOrigin;
    const host = String(req.headers.host || '');
    if (!/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(host)) return '';
    return `${req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https') ? 'https' : 'http'}://${host}`;
  }
  /** Header-only bearer check for the operator routes. False when the feature is disabled. */
  function isModerator(req) {
    if (!moderatorDigest) return false;
    const match = /^Bearer ([\x21-\x7e]{1,512})$/.exec(req.headers.authorization || '');
    return Boolean(match) && timingSafeEqual(sha256(match[1]), moderatorDigest);
  }
  /** Response headers a route may set. Anything else a module returns is dropped. */
  const ROUTE_HEADERS = new Map([['set-cookie', 'Set-Cookie'], ['cache-control', 'Cache-Control'], ['retry-after', 'Retry-After']]);
  function routeHeaders(headers) {
    const kept = {};
    if (headers && typeof headers === 'object') for (const [name, value] of Object.entries(headers)) {
      const known = ROUTE_HEADERS.get(String(name).toLowerCase());
      if (known && (typeof value === 'string' || (Array.isArray(value) && value.every(item => typeof item === 'string')))) kept[known] = value;
    }
    return kept;
  }
  /**
   * The ONLY place an API response is written. It answers at most once per request: the body is
   * turned into text BEFORE any header is sent, so a body that cannot be serialised becomes one
   * generic 500 instead of a half-written reply, and a second call for the same response (a
   * handler that fails after it was answered) does nothing. It never throws. Returns whether it wrote.
   */
  function reply(res, status, body, headers = {}) {
    if (res.headersSent || res.writableEnded || res.destroyed) return false;
    let text, code = Number.isInteger(status) && status >= 200 && status <= 599 ? status : 500, extra = headers;
    try { text = JSON.stringify(code === status ? body ?? {} : { error: 'internal_error' }); if (typeof text !== 'string') throw new TypeError('The response body is not JSON'); }
    catch (error) { log(`Response could not be serialised: ${firstLine(error)}`); code = 500; text = '{"error":"internal_error"}'; extra = {}; }
    try {
      try { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }); }
      catch (error) {
        // A header value Node refuses (a control character). Nothing has been sent yet: answer generically.
        log(`Response headers were refused: ${error?.code || error?.message}`);
        if (res.headersSent) { res.destroy(); return false; }
        text = '{"error":"internal_error"}';
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      }
      res.end(text);
      return true;
    } catch (error) { log(`Response could not be written: ${error?.code || error?.message}`); try { res.destroy(); } catch {} return false; }
  }
  // Nothing a request does may escape as an unhandled rejection: the last line of defence closes the connection.
  const server = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.destroy(); } catch {} }); });
  async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        // Operator routes authenticate with a bearer token in a header, which a browser never attaches
        // by itself, so they are not tied to the page's origin. Every other route keeps the origin check.
        const operator = url.pathname.startsWith('/api/mod/');
        if (!operator && !sameOrigin(req)) throw fail(403, 'origin_rejected');
        const ip = addressOf(req);
        // A request carrying the operator's token has its own budget (routes/moderation.js), so other
        // clients behind the same address cannot use up the operator's share of the general limit.
        if (!(operator && isModerator(req)) && !allow(`http:${ip}`, 600)) throw fail(429, 'rate_limited');
        const route = routes.match(req.method, url.pathname);
        if (!route) throw fail(404, 'not_found');
        const request = {
          method: req.method, path: url.pathname, params: route.params, query: url.searchParams, ip,
          /** True only for a request carrying the operator's bearer token (never a cookie or a query value). */
          moderator: () => isModerator(req),
          json: () => jsonBody(req),
          session: (db, { renew = false } = {}) => sessionFor(req, db, renew),
          requireSession(db, options) { const session = this.session(db, options); if (!session) throw fail(401, 'device_session_required'); return session; },
          // Foundation-only: the cookie secret and the raw request, used by core routes for cookies and room checks.
          secret: cookieId(req), raw: req,
        };
        // ROOM REVALIDATION, for every route and every outcome. A request may have settled or changed
        // the caller's life (or been refused, or lost its write and been undone): before it is answered,
        // every room that player's sockets are in is re-checked against the STORED lives. The player is
        // identified by their own sockets, so a request from a device with no socket costs nothing.
        let returned;
        try { returned = await route.handler(request); }
        finally { for (const publicId of new Set([...wss.clients].filter(ws => ws.secret === request.secret && ws.room).map(ws => ws.session.id))) await ctx.core.revalidate(publicId); }
        const result = returned && typeof returned === 'object' ? returned : {};
        const status = result.status || 200;
        // While the data file cannot be written, every success says so: what the player sees is what
        // is stored, and nothing new is being saved.
        const payload = status < 300 && result.body && typeof result.body === 'object' && !Array.isArray(result.body)
          ? { ...result.body, serverTime: now(), ...(storageFailing() ? { storage: 'failing' } : {}) } : result.body ?? {};
        const sent = reply(res, status, payload, { ...(result.renew === true ? renewedHeaders(req) : {}), ...routeHeaders(result.headers) });
        // `after` runs once the answer is out. Whatever it does, the request is already answered: a
        // failure in it is logged and goes no further.
        if (sent && typeof result.after === 'function') { try { await result.after(); } catch (error) { log(`After-response step of ${req.method} ${route.key} failed: ${firstLine(error)}`); } }
        return;
      }
      const paged = [...ctx.pages.keys()].some(prefix => url.pathname.startsWith(prefix));
      if (!['GET', 'HEAD'].includes(req.method) && !(paged && req.method === 'POST')) throw fail(405, 'method_not_allowed');
      // PAGES: a module may serve one small HTML page for a path prefix outside /api/ (ctx.pages — the link-preview
      // page /s/<code>, routes/growth.js). The page gets the path, the query and the public origin, never the request;
      // it may not set cookies, and it is sent with a policy that allows no script at all.
      for (const [prefix, render] of ctx.pages) {
        if (!url.pathname.startsWith(prefix)) continue;
        if (!allow(`http:${addressOf(req)}`, 600)) throw fail(429, 'rate_limited');
        // A POST to a page carries no body the page may read (the one use is an unsubscribe link: RFC 8058 posts a fixed form).
        if (req.method === 'POST') req.resume();
        const page = await render({ path: url.pathname, query: url.searchParams, origin: publicOrigin(req), ip: addressOf(req), method: req.method });
        if (!page || typeof page.html !== 'string') { if (req.method === 'POST') throw fail(405, 'method_not_allowed'); break; }
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(Number.isInteger(page.status) && page.status >= 200 && page.status <= 599 ? page.status : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': page.cache === false || req.method === 'POST' ? 'no-store' : 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'" });
        res.end(req.method === 'HEAD' ? undefined : page.html);
        return;
      }
      const root = resolve(distDir);
      let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (path !== root && !path.startsWith(root + sep)) throw fail(403, 'invalid_path');
      try { if (!(await stat(path)).isFile()) path = resolve(root, 'index.html'); } catch { path = resolve(root, 'index.html'); }
      const bytes = await readFile(path);
      if (res.headersSent || res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (thrown) {
      // Only the first line of the message is logged: never a header, a cookie or a body.
      const error = thrown && typeof thrown === 'object' ? thrown : { message: thrown };
      const known = Number.isInteger(error.status) && typeof error.code === 'string';
      if (!known && error.code !== 'ENOENT') log(`Request failed: ${firstLine(error)}`);
      reply(res, known ? error.status : error.code === 'ENOENT' ? 404 : 500, { error: known ? error.code : error.code === 'ENOENT' ? 'build_required' : 'internal_error',
        ...(known && typeof error.reason === 'string' ? { reason: error.reason } : {}) });
    }
  }
  // A client that goes away mid-request must never take the process with it.
  server.on('clientError', (error, socket) => { try { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); else socket.destroy(); } catch {} });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  const PONG_GRACE_MS = Math.min(5000, Math.floor(heartbeatMs / 2));
  const unresponsive = ws => ws.pingedAt > 0 && !ws.alive && now() - ws.pingedAt >= PONG_GRACE_MS;
  const send = (ws, message) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
  /**
   * The server context handed to every route and ws module. Documented in routes/index.js.
   * `core` holds foundation internals (cookies, sockets, room checks); feature modules use the rest.
   */
  // In-process events between server modules (never sent to a client by the host itself).
  const listeners = new Map();
  const ctx = {
    store, now, fail, allow, collection, send, publicSession, cityIds: CITY_IDS,
    randomId: () => randomUUID(),
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(fn); },
    emit(event, data) { for (const fn of listeners.get(event) || []) { try { fn(data); } catch (error) { console.error(`Listener for ${event} failed:`, error.message); } } },
    settle,
    // Server authority: ctx.act may run server-only actions (internal: true). Route modules call it
    // with action types they name themselves, never with a type taken from a request.
    // EVERY ctx.act must be safe to retry, and the host checks it rather than trusting the caller:
    //   - inside ctx.once(...) (or another ctx.act) the surrounding receipt covers it;
    //   - with `stateGuard: '<why a repeat cannot apply twice>'` the caller declares that stored state
    //     checked in the same transaction makes it once-only (a ballot entry, a queue it removes from);
    //   - otherwise `actionId` must be an action id (`<ms>:<uuid>`, normally the request's) and the life
    //     must come from ctx.settle: the same receipt steps as POST /api/action run, and a repeat
    //     returns { ok, code, state, duplicate: true } without running the action again.
    // Anything else throws, so a route cannot spend without a receipt by accident.
    act(state, body) {
      const { stateGuard, ...action } = body;
      const run = () => applyLifeAction(state, action, { now: now(), cityId: action.cityId, actionId: action.actionId, internal: true });
      if (receipts.active() || (typeof stateGuard === 'string' && stateGuard.trim().length >= 12)) return run();
      const session = ownerOf.get(state);
      if (!session || action.actionId === undefined) throw new Error(`ctx.act(${action.type}) has no receipt: call it inside ctx.once, pass the request's actionId, or state its stateGuard`);
      const result = receipts.action(session, action, run);
      return result.duplicate ? { ...result, state } : result;
    },
    // Exactly-once for a write that carries a client id — see server/routes/once.js.
    once: receipts.once,
    onceId: receipts.onceId,
    push(publicId, message) {
      let sent = 0;
      for (const ws of wss.clients) if (ws.session?.id === publicId && ws.readyState === WebSocket.OPEN) { send(ws, message); sent += 1; }
      return sent;
    },
    // A socket whose last ping has gone unanswered for PONG_GRACE_MS is not counted: see the heartbeat below.
    online: (publicId) => [...wss.clients].some(ws => ws.session?.id === publicId && ws.readyState === WebSocket.OPEN && !unresponsive(ws)),
    /**
     * Whether a player's stored life in a city is at Home (same rule as joining the Home room).
     * Read-only: nothing is settled, so a trip that has ended but not been settled yet reads as "not home".
     */
    atHome(db, publicId, cityId) {
      if (typeof publicId !== 'string' || !CITY_IDS.includes(cityId)) return false;
      const found = sessionByPublicId(db, publicId);
      const session = found && found.expiresAt > now() ? found : undefined;
      const state = session?.cities?.[cityId]?.state;
      return Boolean(state) && canOccupyVenue(state, 'home');
    },
    // Checks one module provides for another. checks.homeGuest is set by the social module and
    // read by ws/rooms.js; while it is absent, nobody can join another player's Home room.
    checks: {},
    // Small HTML pages outside /api/, by path prefix: pages.set('/s/', async ({ path, query, origin, ip }) => ({ status, html })).
    pages: new Map(),
    // OUTSIDE THE GAME (server/growth/outreach.js). Three small capabilities, so that module stays free of Node built-ins:
    //   env(name)          one of the settings below, or '' — nothing else of the environment is reachable
    //   fetch(url, init)   an outside request (the mail provider, a browser's push service)
    //   keyFile(name, make) → Promise<object>   a secret this server makes for itself (signing key, push keys), kept in
    //                      DATA_DIR/keys/<name>.json with file mode 0600 and never in the data file or a response
    env: (name) => (OUTREACH_ENV.includes(name) && typeof env?.[name] === 'string' ? env[name] : ''),
    fetch: (...args) => outbound(...args),
    keyFile,
    config: { publicOrigin: configuredOrigin, sessionTtlMs, actionWindowMs, maxActiveSessions, voiceConfigProvider, buildId: String(buildId).slice(0, 40), votesPerAddress, voteCapMode, heartbeatMs, moderation: Boolean(moderatorDigest) },
    // Work a module must finish before the server takes requests (loading an in-memory index).
    startup: [],
    core: {
      archiveSession,
      expiredSessionKeys: (db) => sessionKeys(db, record => record.expiresAt <= now()),
      sessionByPublicId,
      unresponsive: (ws) => unresponsive(ws),
      storeStats: () => (typeof store.stats === 'function' ? store.stats() : null),
      newIdentity: () => ({ secret: randomUUID(), publicId: randomUUID() }),
      newId: () => randomUUID(),
      cookieHeader: (request, secret) => cookieHeader(request.raw, secret),
      sockets: () => [...wss.clients],
      isOpen: (ws) => ws.readyState === WebSocket.OPEN,
      sessionOf: (ws, db) => db.sessions[ws.secret],
      // What POST /api/action runs: a player's own request, with no server authority.
      playerAct: (state, body) => applyLifeAction(state, body, { now: now(), cityId: body.cityId, actionId: body.actionId }),
      // The receipt steps of an action, shared by POST /api/action and ctx.act (server/routes/once.js).
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
  // One game action for the caller, exactly once, with everything it changed saved together (routes/core.js).
  ctx.command = (request, body, options) => executeCommand(ctx, request, body, options);
  const sockets = buildSocketHandlers(ctx, wsModules);
  const routes = buildRoutes(ctx, routeModules);
  server.on('upgrade', async (req, socket, head) => {
    try {
      if (req.url !== '/socket' || !req.headers.origin || !sameOrigin(req) || !allow(`upgrade:${addressOf(req)}`, 60)) throw Error('Rejected');
      // Connecting renews the session. While the data file cannot be written the renewal is skipped
      // (it was undone) and the stored session is used as it is: presence and chat keep working.
      const session = await store.transact(db => sessionFor(req, db, true))
        .catch(error => { if (error?.code !== 'storage_unavailable') throw error; return store.read(db => sessionFor(req, db, false)); });
      if (!session) throw Error('Unauthorized');
      if (wss.clients.size >= 1024 || [...wss.clients].filter(ws => ws.session.id === session.publicId).length >= 8) throw Error('Connection capacity');
      req.renewedCookie = cookieHeader(req, session.secret);
      wss.handleUpgrade(req, socket, head, ws => {
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
  wss.on('headers', (headers, req) => { if (req.renewedCookie) headers.push(`Set-Cookie: ${req.renewedCookie}`); });
  const socketRenewals = new Map();
  async function renewSocketSession(ws) {
    if (now() - ws.lastSessionRenewedAt < 60000) return;
    let pending = socketRenewals.get(ws.secret);
    if (!pending) {
      pending = store.transact(db => {
        const session = db.sessions[ws.secret];
        if (!renewSession(session, now(), sessionTtlMs)) throw Error('device_session_required');
        return session.expiresAt;
      });
      socketRenewals.set(ws.secret, pending);
    }
    try {
      const expiration = await pending;
      for (const peer of wss.clients) if (peer.secret === ws.secret) {
        peer.expiresAt = expiration; peer.lastSessionRenewedAt = now();
      }
    } catch (error) {
      // The renewal could not be saved, so it did not happen: the socket keeps its current expiry
      // and the message is still handled. It is tried again with the next message.
      if (error?.code !== 'storage_unavailable') throw error;
    } finally { if (socketRenewals.get(ws.secret) === pending) socketRenewals.delete(ws.secret); }
  }
  wss.on('connection', ws => {
    ws.alive = true; ws.pingedAt = 0; ws.seenAt = now();
    ws.on('pong', () => { ws.alive = true; ws.seenAt = Math.max(now(), ws.pingedAt); });
    ws.on('error', () => {});
    ws.on('close', () => sockets.close(ws));
    let messages = Promise.resolve();
    ws.on('message', (raw, binary) => {
      if (binary || !allow(`ws:${ws.session.id}`, 600)) {
        let rejected;
        try { rejected = JSON.parse(raw.toString()); } catch {}
        send(ws, { type: 'error', code: 'rate_limited', error: 'rate_limited',
          ...(rejected?.type === 'signal' && typeof rejected.to === 'string' && uuid.test(rejected.to) && rejected.to !== ws.secret ? { to: rejected.to } : {}),
          ...(rejected?.type === 'chat' && typeof rejected.clientId === 'string' && rejected.clientId.length <= 80 ? { clientId: rejected.clientId } : {}) });
        ws.close(1008, 'Rate limit'); return;
      }
      ws.alive = true; ws.seenAt = Math.max(now(), ws.pingedAt); // any frame proves the connection is alive
      messages = messages.then(async () => {
      let message;
      try {
        if (ws.expiresAt <= now()) { ws.close(1008, 'Device session expired'); return; }
        if (ws.readyState !== WebSocket.OPEN) return;
        try { message = JSON.parse(raw.toString()); } catch { throw Error('invalid_message'); }
        if (!message || typeof message !== 'object') throw Error('invalid_message');
        await renewSocketSession(ws);
        const entry = typeof message.type === 'string' ? sockets.messages.get(message.type) : undefined;
        // Unknown types keep their historical replies: join_required outside a room, invalid_message inside one.
        if (!entry) throw Error(ws.room ? 'invalid_message' : 'join_required');
        if (entry.room && !ws.room) throw Error('join_required');
        await entry.handle(ws, message);
      } catch (thrown) {
        // Only a machine code goes to the client. Anything else (a TypeError's text, a file path) is logged here instead.
        // A coded refusal may carry the sentence the server wrote for the player (`reason`); it is repeated as `message`,
        // the field the community panel prints. Uncoded errors never carry either.
        const text = firstLine(thrown);
        const coded = /^[a-z][a-z0-9_]{1,63}$/.test(text);
        if (!coded) log(`Socket message failed: ${text}`);
        const error = coded ? thrown : { message: 'internal_error' };
        send(ws, { type: 'error', code: error.message, error: error.message, ...(typeof error.reason === 'string' ? { reason: error.reason, message: error.reason } : {}), ...(message?.type === 'signal' && typeof message.to === 'string' && uuid.test(message.to) && message.to !== ws.secret ? { to: message.to } : {}), ...(message?.type === 'chat' && typeof message.clientId === 'string' && message.clientId.length <= 80 ? { clientId: message.clientId } : {}) }); }
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
    for (const ws of wss.clients) {
      if (!ws.alive || ws.expiresAt <= now()) { ws.terminate(); continue; }
      ws.alive = false; ws.pingedAt = now(); ws.ping();
    }
    ctx.emit('heartbeat', { now: now() });
  }
  const heartbeat = setInterval(beat, heartbeatMs);
  heartbeat.unref();
  server.wss = wss;
  server.beat = beat; // tests drive the heartbeat directly instead of waiting for the timer
  server.store = store;
  server.on('close', () => { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); });
  // close(callback) reports back only once the store has written everything, so "the server has
  // stopped" always means "the data file is complete" — for a restart, a test or a shutdown script.
  const closeHttp = server.close.bind(server);
  server.close = (callback) => { closeHttp((error) => { Promise.resolve(store.close?.()).catch(() => {}).finally(() => callback?.(error)); }); return server; };
  await Promise.all(ctx.startup.splice(0));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.STORE_MODE) console.error('STORE_MODE is no longer used: there is one store. See "Storage and limits" in the README.');
  const server = await createServer();
  // Write anything not yet on disk before the process leaves.
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.store.close?.().catch(() => {}).finally(() => process.exit(0)); });
  server.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () => console.log(`Allworld server listening on ${server.address().port}`));
}
