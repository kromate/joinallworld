import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createStore } from './store.js';
import { VENUES } from '../src/life.js';
import { settleCity, applyLifeAction } from './life-service.js';

import { CITY_IDS, ACTION_WINDOW_MS, MAX_VOICE_MEMBERS, UUID_PATTERN as uuid, protocolError as fail, validateName, validateActionPayload, publicSession, isSameOrigin, canJoinVenue, actionFingerprint, pruneReceipts, readReceipt, archivedLife, renewSession } from './protocol.js';

const cities = new Set(CITY_IDS);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const cookieId = (req) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4);
const sameOrigin = req => isSameOrigin(req.headers.origin, req.headers.host);
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'json_required');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw fail(413, 'body_too_large');
  }
  try { const value = JSON.parse(body); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { throw fail(400, 'invalid_json'); }
}

export async function createServer({ dataDir = process.env.DATA_DIR || resolve('.data'), distDir = resolve('dist'), now = Date.now, sessionTtlMs = Number(process.env.SESSION_TTL_DAYS || 30) * 86400000, actionWindowMs = ACTION_WINDOW_MS, maxActiveSessions = 10000 } = {}) {
  const store = await createStore(dataDir);
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs < 60000) throw new Error('Invalid session TTL');
  function archiveSession(db, secret, session) {
    db.archivedLives ||= {};
    const publicId = session.publicId || randomUUID();
    db.archivedLives[publicId] = archivedLife(session, publicId, now());
    delete db.sessions[secret];
  }
  await store.transact(db => {
    for (const [secret, session] of Object.entries(db.sessions)) {
      // Rotate credentials created by versions that exposed the cookie as a public ID.
      if (!session.publicId || !Number.isFinite(session.expiresAt) || session.expiresAt <= now()) archiveSession(db, secret, session);
    }
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
    for (const ws of wss.clients) if (ws.secret === secret) ws.expiresAt = now() + sessionTtlMs;
    return { 'Set-Cookie': cookieHeader(req, secret) };
  }
  function reply(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (!sameOrigin(req)) throw fail(403, 'origin_rejected');
        if (!allow(`http:${req.socket.remoteAddress}`, 600)) throw fail(429, 'rate_limited');
        if (url.pathname === '/api/session' && req.method === 'POST') {
          const body = await jsonBody(req);
          const name = validateName(body.name);
          const session = await store.transact(db => {
            for (const [secret, record] of Object.entries(db.sessions)) if (record.expiresAt <= now()) archiveSession(db, secret, record);
            let current = sessionFor(req, db);
            if (!current) {
              if (Object.keys(db.sessions).length >= maxActiveSessions) throw fail(503, 'device_capacity');
              const id = randomUUID();
              current = db.sessions[id] = { secret: id, publicId: randomUUID(), name, expiresAt: now() + sessionTtlMs, cities: {}, actions: {} };
            }
            current.name = name;
            current.expiresAt = now() + sessionTtlMs;
            return { secret: current.secret, session: publicSession(current) };
          });
          reply(res, 200, { session: session.session, serverTime: now() }, { 'Set-Cookie': cookieHeader(req, session.secret) });
          refreshNames(session.session); return;
        }
        if (url.pathname === '/api/session' && req.method === 'GET') {
          const session = await store.transact(db => sessionFor(req, db, true));
          if (!session) throw fail(401, 'device_session_required');
          return reply(res, 200, { session: publicSession(session), serverTime: now() }, renewedHeaders(req));
        }
        if (url.pathname === '/api/life' && req.method === 'GET') {
          const city = url.searchParams.get('city');
          if (!cities.has(city)) throw fail(400, 'invalid_city');
          const state = await store.transact(db => {
            const session = sessionFor(req, db, true);
            if (!session) throw fail(401, 'device_session_required');
            return settle(session, city);
          });
          await validateMemberships(cookieId(req), city, state);
          return reply(res, 200, { state, serverTime: now() }, renewedHeaders(req));
        }
        if (url.pathname === '/api/action' && req.method === 'POST') {
          const body = await jsonBody(req);
          const actionAt = validateActionPayload(body, now(), actionWindowMs);
          const outcome = await store.transact(db => {
            const session = sessionFor(req, db, true);
            if (!session) throw fail(401, 'device_session_required');
            validateActionPayload(body, now(), actionWindowMs);
            pruneReceipts(session.actions, now(), actionWindowMs);
            const state = settle(session, body.cityId);
            const fingerprint = actionFingerprint(body);
            const old = readReceipt(session.actions, body);
            if (old) {
              return { ok: old.ok, code: old.code, state, duplicate: true };
            }
            if (Object.keys(session.actions).length >= 10000) throw fail(429, 'action_history_full');
            const result = applyLifeAction(state, body);
            session.actions[body.actionId] = { actionAt, fingerprint, ok: result.ok, code: result.code };
            return result;
          });
          await validateMemberships(cookieId(req), body.cityId, outcome.state);
          return reply(res, 200, { ...outcome, serverTime: now() }, renewedHeaders(req));
        }
        throw fail(404, 'not_found');
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
      reply(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.status ? error.code : error.code === 'ENOENT' ? 'build_required' : 'internal_error' });
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  const rooms = new Map();
  const chatHistory = new Map();
  const send = (ws, message) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
  function presence(room) {
    const members = new Map();
    for (const ws of rooms.get(room) || []) {
      const old = members.get(ws.session.id);
      members.set(ws.session.id, { ...ws.session, enabled: (old?.enabled || ws.voice.enabled), muted: old ? old.muted && ws.voice.muted : ws.voice.muted });
    }
    for (const ws of rooms.get(room) || []) send(ws, { type: 'presence', members: [...members.values()] });
  }
  function leave(ws) {
    if (!ws.room) return;
    const room = ws.room;
    rooms.get(room)?.delete(ws);
    if (!rooms.get(room)?.size) rooms.delete(room);
    ws.room = null;
    presence(room);
  }
  function validateMemberships(secret, city, state) {
    for (const ws of wss.clients) if (ws.secret === secret && ws.room?.startsWith(`${city}:`)
      && (ws.room !== `${city}:${state.location}` || state.activeAction?.kind === 'travel')) {
      leave(ws); ws.voice = { enabled: false, muted: true };
      send(ws, { type: 'error', code: 'venue_mismatch', error: 'venue_mismatch' });
    }
  }
  function refreshNames(session) {
    const changed = new Set();
    for (const ws of wss.clients) if (ws.session.id === session.id) { ws.session.name = session.name; ws.expiresAt = now() + sessionTtlMs; if (ws.room) changed.add(ws.room); }
    for (const room of changed) presence(room);
  }
  server.on('upgrade', async (req, socket, head) => {
    try {
      if (req.url !== '/socket' || !req.headers.origin || !sameOrigin(req) || !allow(`upgrade:${req.socket.remoteAddress}`, 60)) throw Error('Rejected');
      const session = await store.transact(db => sessionFor(req, db, true));
      if (!session) throw Error('Unauthorized');
      if (wss.clients.size >= 1024 || [...wss.clients].filter(ws => ws.session.id === session.publicId).length >= 8) throw Error('Connection capacity');
      req.renewedCookie = cookieHeader(req, session.secret);
      wss.handleUpgrade(req, socket, head, ws => {
        ws.session = publicSession(session);
        ws.secret = session.secret;
        ws.expiresAt = session.expiresAt;
        ws.voice = { enabled: false, muted: true };
        wss.emit('connection', ws);
      });
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  wss.on('headers', (headers, req) => { if (req.renewedCookie) headers.push(`Set-Cookie: ${req.renewedCookie}`); });
  wss.on('connection', ws => {
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => leave(ws));
    let messages = Promise.resolve();
    ws.on('message', (raw, binary) => {
      if (binary || !allow(`ws:${ws.session.id}`, 240)) {
        let rejected;
        try { rejected = JSON.parse(raw.toString()); } catch {}
        send(ws, { type: 'error', code: 'rate_limited', error: 'rate_limited',
          ...(rejected?.type === 'chat' && typeof rejected.clientId === 'string' && rejected.clientId.length <= 80 ? { clientId: rejected.clientId } : {}) });
        ws.close(1008, 'Rate limit'); return;
      }
      messages = messages.then(async () => {
      let message;
      try {
        if (ws.expiresAt <= now()) { ws.close(1008, 'Device session expired'); return; }
        if (ws.readyState !== WebSocket.OPEN) return;
        message = JSON.parse(raw.toString());
        if (!message || typeof message !== 'object') throw Error('invalid_message');
        const expiration = await store.transact(db => {
          const session = db.sessions[ws.secret];
          if (!renewSession(session, now(), sessionTtlMs)) throw Error('device_session_required');
          return session.expiresAt;
        });
        for (const peer of wss.clients) if (peer.secret === ws.secret) peer.expiresAt = expiration;
        if (message.type === 'join') {
          if (!cities.has(message.cityId) || !Object.hasOwn(VENUES, message.venueId)) throw Error('invalid_room');
          const allowed = await store.transact(db => {
            const session = db.sessions[ws.secret];
            if (!session || session.expiresAt <= now()) throw Error('device_session_required');
            const state = settle(session, message.cityId);
            return canJoinVenue(state, message.venueId);
          });
          if (!allowed) throw Error('venue_mismatch');
          if (ws.readyState !== WebSocket.OPEN) return;
          const room = `${message.cityId}:${message.venueId}`;
          leave(ws); ws.voice = { enabled: false, muted: true }; ws.room = room;
          if (!rooms.has(room)) rooms.set(room, new Set());
          rooms.get(room).add(ws); presence(room); return;
        }
        if (!ws.room) throw Error('join_required');
        if (message.type === 'voice-state') {
          if (typeof message.enabled !== 'boolean' || typeof message.muted !== 'boolean') throw Error('invalid_voice_state');
          const enabled = new Set([...rooms.get(ws.room)].filter(peer => peer.voice.enabled).map(peer => peer.session.id));
          if (message.enabled && !enabled.has(ws.session.id) && enabled.size >= MAX_VOICE_MEMBERS) throw Error('voice_room_full');
          ws.voice = { enabled: message.enabled, muted: message.muted }; presence(ws.room); return;
        }
        if (message.type === 'signal') {
          if (typeof message.to !== 'string' || !message.data || typeof message.data !== 'object' || JSON.stringify(message.data).length > 12000) throw Error('invalid_signal');
          const peers = [...rooms.get(ws.room)].filter(peer => peer.session.id === message.to && peer !== ws);
          if (!peers.length) throw Error('peer_not_in_room');
          for (const peer of peers) send(peer, { type: 'signal', from: ws.session.id, data: message.data }); return;
        }
        if (message.type === 'chat') {
          const body = typeof message.body === 'string' ? message.body.trim() : '';
          const clientId = message.clientId;
          if (!body || body.length > 500 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body) || (clientId !== undefined && (typeof clientId !== 'string' || clientId.length > 80 || !clientId))) throw Error('invalid_chat');
          if (!allow(`chat:${ws.session.id}`, 30)) throw Error('rate_limited');
          const key = `${ws.session.id}:${ws.room}`;
          const history = chatHistory.get(key) || new Map();
          if (clientId && history.has(clientId)) { send(ws, history.get(clientId)); return; }
          const chat = { type: 'chat', id: randomUUID(), clientId, from: { ...ws.session }, body, at: now() };
          if (clientId) { history.set(clientId, chat); if (history.size > 100) history.delete(history.keys().next().value); chatHistory.set(key, history); }
          for (const peer of rooms.get(ws.room)) send(peer, chat); return;
        }
        throw Error('invalid_message');
      } catch (error) { send(ws, { type: 'error', code: error.message, error: error.message, ...(message?.type === 'chat' && typeof message.clientId === 'string' && message.clientId.length <= 80 ? { clientId: message.clientId } : {}) }); }
      }).catch(() => ws.close(1011, 'Server error'));
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive || ws.expiresAt <= now()) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  server.wss = wss;
  server.on('close', () => { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createServer();
  server.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () => console.log(`JoinAllworld server listening on ${server.address().port}`));
}
