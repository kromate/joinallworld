/**
 * Node host: HTTP + WebSocket plumbing, static files and the server context.
 * Everything Node-specific lives here and in store.js. Rules shared with the Cloudflare worker
 * live in protocol.js, life-service.js and src/life.js. Endpoints live in routes/*.js and
 * socket message types in ws/*.js — see routes/index.js and ws/index.js for those contracts.
 */
import http from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createStore } from './store.js';
import { settleCity, applyLifeAction } from './life-service.js';
import { buildRoutes } from './routes/index.js';
import { buildSocketHandlers } from './ws/index.js';
import { CITY_IDS, ACTION_WINDOW_MS, UUID_PATTERN as uuid, protocolError as fail, publicSession, isSameOrigin, archivedLife, renewSession, collection, canJoinVenue } from './protocol.js';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
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
  storeMode, lazyFlushMs,
  heartbeatMs = Number(process.env.HEARTBEAT_SECONDS || 10) * 1000,
  moderatorToken = process.env.MODERATOR_TOKEN,
  trustProxy = process.env.TRUST_PROXY === '1',
  votesPerAddress = Number(process.env.VOTES_PER_ADDRESS ?? 3),
  buildId = process.env.BUILD_ID || packageVersion() } = {}) {
  const store = providedStore || await createStore(dataDir, { ...(storeMode ? { mode: storeMode } : {}), ...(lazyFlushMs !== undefined ? { lazyFlushMs } : {}) });
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs < 60000) throw new Error('Invalid session TTL');
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 1000 || heartbeatMs > 60000) throw new Error('Invalid heartbeat interval');
  if (!Number.isSafeInteger(votesPerAddress) || votesPerAddress < 0) throw new Error('Invalid VOTES_PER_ADDRESS');
  // The operator token never leaves this closure: only its digest is kept, it is compared in
  // constant time, and nothing here logs it. Unset (or too short to be a real secret) = no moderator surface.
  const moderatorDigest = typeof moderatorToken === 'string' && moderatorToken.length >= 24 ? sha256(moderatorToken) : null;
  if (typeof moderatorToken === 'string' && moderatorToken && !moderatorDigest) console.error('MODERATOR_TOKEN is shorter than 24 characters: the moderator routes stay disabled.');
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
  const limits = new Map();
  function allow(key, count = 120, windowMs = 60000) {
    const time = now();
    if (limits.size > 10000) for (const [id, entry] of limits) if (time - entry.start >= windowMs) limits.delete(id);
    const entry = limits.get(key);
    if (!entry || time - entry.start >= windowMs) {
      if (!entry && limits.size >= 10000) return false;
      limits.set(key, { start: time, count: 1 }); return true;
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
  const settle = (session, city) => settleCity(session, city, now());
  function cookieHeader(req, secret) {
    const secure = req.socket.encrypted || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https');
    return `sid=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure ? '; Secure' : ''}`;
  }
  function renewedHeaders(req) {
    const secret = cookieId(req);
    for (const ws of wss.clients) if (ws.secret === secret) { ws.expiresAt = now() + sessionTtlMs; ws.lastSessionRenewedAt = now(); }
    return { 'Set-Cookie': cookieHeader(req, secret) };
  }
  const addressOf = req => clientAddress(req, trustProxy);
  /** Header-only bearer check for the operator routes. False when the feature is disabled. */
  function isModerator(req) {
    if (!moderatorDigest) return false;
    const match = /^Bearer ([\x21-\x7e]{1,512})$/.exec(req.headers.authorization || '');
    return Boolean(match) && timingSafeEqual(sha256(match[1]), moderatorDigest);
  }
  function reply(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        // Operator routes authenticate with a bearer token in a header, which a browser never attaches
        // by itself, so they are not tied to the page's origin. Every other route keeps the origin check.
        const operator = url.pathname.startsWith('/api/mod/');
        if (!operator && !sameOrigin(req)) throw fail(403, 'origin_rejected');
        const ip = addressOf(req);
        if (!allow(`http:${ip}`, 600)) throw fail(429, 'rate_limited');
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
        const result = await route.handler(request) || {};
        const status = result.status || 200;
        const payload = status < 300 && result.body && typeof result.body === 'object' && !Array.isArray(result.body) ? { ...result.body, serverTime: now() } : result.body ?? {};
        reply(res, status, payload, { ...(result.renew ? renewedHeaders(req) : {}), ...result.headers });
        result.after?.();
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'method_not_allowed');
      const root = resolve(distDir);
      let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (path !== root && !path.startsWith(root + sep)) throw fail(403, 'invalid_path');
      try { if (!(await stat(path)).isFile()) path = resolve(root, 'index.html'); } catch { path = resolve(root, 'index.html'); }
      const bytes = await readFile(path);
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!error.status && error.code !== 'ENOENT') console.error('Request failed:', error.message);
      reply(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.status ? error.code : error.code === 'ENOENT' ? 'build_required' : 'internal_error',
        ...(error.status && typeof error.reason === 'string' ? { reason: error.reason } : {}) });
    }
  });
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
    act: (state, body) => applyLifeAction(state, body, { now: now(), cityId: body.cityId, actionId: body.actionId, internal: true }),
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
      return Boolean(state) && canJoinVenue(state, 'home');
    },
    // Checks one module provides for another. checks.homeGuest is set by the social module and
    // read by ws/rooms.js; while it is absent, nobody can join another player's Home room.
    checks: {},
    config: { sessionTtlMs, actionWindowMs, maxActiveSessions, voiceConfigProvider, buildId: String(buildId).slice(0, 40), votesPerAddress, heartbeatMs, moderation: Boolean(moderatorDigest) },
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
    },
  };
  const sockets = buildSocketHandlers(ctx, wsModules);
  const routes = buildRoutes(ctx, routeModules);
  server.on('upgrade', async (req, socket, head) => {
    try {
      if (req.url !== '/socket' || !req.headers.origin || !sameOrigin(req) || !allow(`upgrade:${addressOf(req)}`, 60)) throw Error('Rejected');
      const session = await store.transact(db => sessionFor(req, db, true));
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
        message = JSON.parse(raw.toString());
        if (!message || typeof message !== 'object') throw Error('invalid_message');
        await renewSocketSession(ws);
        const entry = typeof message.type === 'string' ? sockets.messages.get(message.type) : undefined;
        // Unknown types keep their historical replies: join_required outside a room, invalid_message inside one.
        if (!entry) throw Error(ws.room ? 'invalid_message' : 'join_required');
        if (entry.room && !ws.room) throw Error('join_required');
        await entry.handle(ws, message);
      } catch (error) { send(ws, { type: 'error', code: error.message, error: error.message, ...(typeof error.reason === 'string' ? { reason: error.reason } : {}), ...(message?.type === 'signal' && typeof message.to === 'string' && uuid.test(message.to) && message.to !== ws.secret ? { to: message.to } : {}), ...(message?.type === 'chat' && typeof message.clientId === 'string' && message.clientId.length <= 80 ? { clientId: message.clientId } : {}) }); }
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
  server.close = (callback) => closeHttp((error) => { Promise.resolve(store.close?.()).catch(() => {}).finally(() => callback?.(error)); });
  await Promise.all(ctx.startup.splice(0));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createServer();
  // Write anything not yet on disk before the process leaves.
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.store.close?.().catch(() => {}).finally(() => process.exit(0)); });
  server.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () => console.log(`JoinAllworld server listening on ${server.address().port}`));
}
