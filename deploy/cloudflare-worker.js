import { DurableObject } from 'cloudflare:workers';
import { CITY_IDS, SESSION_TTL_MS, MAX_VOICE_MEMBERS, UUID_PATTERN, protocolError, validateName, validateActionPayload, publicSession, isSameOrigin, canJoinVenue, actionFingerprint, pruneReceipts, readReceipt, archivedLife, renewSession, venueRoomKey, validatePosition, withinVoiceDistance, VOICE_RADIUS, STUN_ONLY_CONFIG } from '../server/protocol.js';
import { settleCity, applyLifeAction } from '../server/life-service.js';
import { VENUES } from '../src/life.js';

const json = (status, value, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
const cookieId = request => (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('sid='))?.slice(4);
const cookie = secret => `sid=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Secure`;
const send = (socket, value) => { try { socket.send(JSON.stringify(value)); } catch {} };
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
function addressBucket(ip) {
  if (!ip.includes(':')) return ip;
  const [left, right = ''] = ip.toLowerCase().split('::');
  const start = left ? left.split(':') : [], end = right ? right.split(':') : [];
  return [...start, ...Array(Math.max(0, 8 - start.length - end.length)).fill('0'), ...end].slice(0, 4).map(part => parseInt(part || '0', 16).toString(16)).join(':');
}
async function bodyOf(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw protocolError(415, 'json_required');
  const reader = request.body?.getReader();
  if (!reader) throw protocolError(400, 'invalid_json');
  let size = 0;
  const chunks = [];
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
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    return body;
  } catch { throw protocolError(400, 'invalid_json'); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json(200, { ok: true, transport: 'cloudflare', buildId: env.BUILD_ID || 'unreleased' });
    if (url.pathname.startsWith('/api/') || url.pathname === '/socket') {
      if (!isSameOrigin(request.headers.get('origin'), url.host, { requireOrigin: url.pathname === '/socket' })) return json(403, { error: 'origin_rejected' });
      return env.JOINALLWORLD.getByName('joinallworld-v1').fetch(request);
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json(405, { error: 'method_not_allowed' });
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('x-content-type-options', 'nosniff');
    if (headers.get('content-type')?.includes('text/html')) headers.set('cache-control', 'no-cache');
    return new Response(response.body, { status: response.status, headers });
  },
};

export class JoinAllworldState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS sessions (secret TEXT PRIMARY KEY, public_id TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS archived_lives (public_id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, started_at INTEGER NOT NULL, count INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(started_at)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chat_receipts (sender TEXT NOT NULL, room TEXT NOT NULL, client_id TEXT NOT NULL, at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,room,client_id))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS action_receipts (sender TEXT NOT NULL, action_id TEXT NOT NULL, action_at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,action_id))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS action_expiry ON action_receipts(action_at)');
    this.rateCleanupAt = 0;
  }
  allow(key, count, now = Date.now()) {
    if (now >= this.rateCleanupAt) { this.sql.exec('DELETE FROM rate_limits WHERE started_at <= ?', now - 60000); this.rateCleanupAt = now + 60000; }
    const old = this.sql.exec('SELECT started_at,count FROM rate_limits WHERE key = ?', key).toArray()[0];
    if (!old && this.sql.exec('SELECT COUNT(*) AS count FROM rate_limits').one().count >= 10000) return false;
    const active = old && now - old.started_at < 60000;
    const next = active ? old.count + 1 : 1;
    this.sql.exec('INSERT INTO rate_limits(key,started_at,count) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET started_at=excluded.started_at,count=excluded.count', key, active ? old.started_at : now, next);
    return next <= count;
  }
  getSession(secret, now) {
    if (!secret || !UUID_PATTERN.test(secret)) return null;
    const row = this.sql.exec('SELECT value FROM sessions WHERE secret = ?', secret).toArray()[0];
    if (!row) return null;
    const session = JSON.parse(row.value);
    if (!renewSession(session, now)) return null;
    return session;
  }
  save(session) {
    this.sql.exec('INSERT INTO sessions(secret,public_id,expires_at,value) VALUES(?,?,?,?) ON CONFLICT(secret) DO UPDATE SET expires_at=excluded.expires_at,value=excluded.value', session.secret, session.publicId, session.expiresAt, JSON.stringify(session));
  }
  archiveExpired(now) {
    for (const row of this.sql.exec('SELECT secret,value FROM sessions WHERE expires_at <= ? LIMIT 100', now).toArray()) {
      const session = JSON.parse(row.value);
      this.sql.exec('INSERT OR REPLACE INTO archived_lives(public_id,value) VALUES(?,?)', session.publicId, JSON.stringify(archivedLife(session, session.publicId, now)));
      this.sql.exec('DELETE FROM sessions WHERE secret = ?', row.secret);
    }
  }
  transaction(secret, operation) {
    return this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      const session = this.getSession(secret, now);
      if (!session) throw protocolError(401, 'device_session_required');
      const value = operation(session, now);
      this.save(session);
      return value;
    });
  }
  sockets(room) {
    return this.ctx.getWebSockets().filter(ws => {
      const state = ws.deserializeAttachment();
      return !state.closed && (!room || state.room === room);
    });
  }
  presence(room) {
    if (!room) return;
    const peers = this.sockets(room);
    const members = new Map();
    for (const ws of peers) {
      const info = ws.deserializeAttachment();
      const old = members.get(info.session.id);
      members.set(info.session.id, { ...info.session, position: info.position || { x: 0, z: 0 }, enabled: !!(old?.enabled || info.voice.enabled), muted: old ? old.muted && info.voice.muted : info.voice.muted });
    }
    for (const ws of peers) send(ws, { type: 'presence', members: [...members.values()] });
  }
  leave(ws, closed = false) {
    const info = ws.deserializeAttachment();
    const room = info.room;
    info.room = null; info.voice = { enabled: false, muted: true }; info.closed = closed;
    ws.serializeAttachment(info);
    this.presence(room);
  }
  refreshNames(session) {
    const rooms = new Set();
    for (const ws of this.sockets()) {
      const info = ws.deserializeAttachment();
      if (info.session.id !== session.id) continue;
      info.session = session; ws.serializeAttachment(info); if (info.room) rooms.add(info.room);
    }
    for (const room of rooms) this.presence(room);
  }
  expireSockets() {
    const now = Date.now();
    for (const ws of this.sockets()) {
      const info = ws.deserializeAttachment();
      const row = this.sql.exec('SELECT expires_at FROM sessions WHERE secret = ?', info.secret).toArray()[0];
      if (!row || row.expires_at <= now) { this.leave(ws, true); ws.close(1008, 'device_session_required'); }
    }
  }
  async alarm() {
    this.expireSockets();
    this.sql.exec('DELETE FROM chat_receipts WHERE at < ?', Date.now() - 86400000);
    if (this.sockets().length) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  validateMemberships(secret, city, state) {
    for (const ws of this.sockets()) {
      const info = ws.deserializeAttachment();
      if (info.secret === secret && info.room?.startsWith(`${city}:`) && (info.room !== venueRoomKey(city, state.location, info.session.id) || state.activeAction?.kind === 'travel')) {
        this.leave(ws); send(ws, { type: 'error', code: 'venue_mismatch', error: 'venue_mismatch' });
      }
    }
  }
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const ip = await digest(addressBucket(request.headers.get('cf-connecting-ip') || 'local'));
      if (!isSameOrigin(request.headers.get('origin'), url.host, { requireOrigin: url.pathname === '/socket' })) throw protocolError(403, 'origin_rejected');
      const secret = cookieId(request);
      if (url.pathname === '/socket') {
        if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket' || !this.allow(`upgrade:${ip}`, 60)) throw protocolError(403, 'upgrade_rejected');
        const session = this.transaction(secret, session => ({ session: publicSession(session), secret, expiresAt: session.expiresAt }));
        this.expireSockets();
        const peers = this.sockets();
        if (peers.length >= 1024 || peers.filter(ws => ws.deserializeAttachment().session.id === session.session.id).length >= 8 || peers.filter(ws => ws.deserializeAttachment().ip === ip).length >= 32) throw protocolError(503, 'connection_capacity');
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment({ ...session, ip, position: { x: 0, z: 0 }, lastMoves: [], room: null, voice: { enabled: false, muted: true }, closed: false });
        if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 60000);
        return new Response(null, { status: 101, webSocket: pair[0], headers: { 'set-cookie': cookie(secret) } });
      }
      const authenticated = this.getSession(secret, Date.now());
      if (!this.allow(authenticated ? `http:session:${authenticated.publicId}` : `http:ip:${ip}`, authenticated ? 600 : 60)) throw protocolError(429, 'rate_limited');
      if (url.pathname === '/api/session' && request.method === 'POST') {
        const name = validateName((await bodyOf(request)).name);
        const result = this.ctx.storage.transactionSync(() => {
          const now = Date.now(); this.archiveExpired(now);
          let session = this.getSession(secret, now);
          if (!session) {
            const count = this.sql.exec('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?', now).one().count;
            if (count >= 10000) throw protocolError(503, 'device_capacity');
            session = { secret: crypto.randomUUID(), publicId: crypto.randomUUID(), name, expiresAt: now + SESSION_TTL_MS, cities: {} };
          }
          session.name = name; this.save(session);
          return { session: publicSession(session), secret: session.secret, serverTime: now };
        });
        this.refreshNames(result.session);
        return json(200, { session: result.session, serverTime: result.serverTime }, { 'set-cookie': cookie(result.secret) });
      }
      if (url.pathname === '/api/session' && request.method === 'GET') {
        const value = this.transaction(secret, (session, now) => ({ session: publicSession(session), serverTime: now }));
        return json(200, value, { 'set-cookie': cookie(secret) });
      }
      if (url.pathname === '/api/voice-config' && request.method === 'GET') {
        const value = this.transaction(secret, (session, now) => {
          this.expireSockets();
          if (!this.sockets().some(ws => { const attached = ws.deserializeAttachment(); return attached.secret === secret && attached.room; })) throw protocolError(409, 'join_required');
          if (!this.allow(`voice-config:${session.publicId}`, 6)) throw protocolError(429, 'rate_limited');
          return { ...STUN_ONLY_CONFIG, radius: VOICE_RADIUS, serverTime: now };
        });
        return json(200, value, { 'set-cookie': cookie(secret) });
      }
      if (url.pathname === '/api/life' && request.method === 'GET') {
        const city = url.searchParams.get('city');
        if (!CITY_IDS.includes(city)) throw protocolError(400, 'invalid_city');
        const value = this.transaction(secret, (session, now) => ({ state: settleCity(session, city, now), serverTime: now }));
        this.validateMemberships(secret, city, value.state);
        return json(200, value, { 'set-cookie': cookie(secret) });
      }
      if (url.pathname === '/api/action' && request.method === 'POST') {
        const body = await bodyOf(request);
        const value = this.transaction(secret, (session, now) => {
          const actionAt = validateActionPayload(body, now);
          this.sql.exec('DELETE FROM action_receipts WHERE sender=? AND action_at < ?', session.publicId, now - 86400000);
          const state = settleCity(session, body.cityId, now);
          const storedReceipt = this.sql.exec('SELECT value FROM action_receipts WHERE sender=? AND action_id=?', session.publicId, body.actionId).toArray()[0];
          const receipt = readReceipt(storedReceipt ? { [body.actionId]: JSON.parse(storedReceipt.value) } : {}, body);
          if (receipt) return { ok: receipt.ok, code: receipt.code, state, duplicate: true, serverTime: now };
          if (this.sql.exec('SELECT COUNT(*) AS count FROM action_receipts WHERE sender=?', session.publicId).one().count >= 10000) throw protocolError(429, 'action_history_full');
          const result = applyLifeAction(state, body);
          this.sql.exec('INSERT INTO action_receipts(sender,action_id,action_at,value) VALUES(?,?,?,?)', session.publicId, body.actionId, actionAt, JSON.stringify({ actionAt, fingerprint: actionFingerprint(body), ok: result.ok, code: result.code }));
          return { ...result, serverTime: now };
        });
        this.validateMemberships(secret, body.cityId, value.state);
        return json(200, value, { 'set-cookie': cookie(secret) });
      }
      throw protocolError(404, 'not_found');
    } catch (error) { return json(error.status || 500, { error: error.status ? error.code : 'internal_error' }); }
  }
  async webSocketMessage(ws, raw) {
    let message;
    try {
      let info = ws.deserializeAttachment();
      if (info.closed) return;
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 16384) throw protocolError(400, 'invalid_message');
      message = JSON.parse(raw);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw protocolError(400, 'invalid_message');
      if (message.type !== 'move' && !this.allow(`ws:${info.session.id}`, 600)) throw Object.assign(protocolError(429, 'rate_limited'), { disconnect: true });
      const acceptedRoom = info.room;
      const bodyHash = message.type === 'chat' && typeof message.body === 'string' ? await digest(message.body.trim()) : null;
      info = ws.deserializeAttachment();
      if (info.closed) return;
      if (message.type === 'chat' && info.room !== acceptedRoom) throw protocolError(409, 'room_changed');
      const result = this.ctx.storage.transactionSync(() => {
        const now = Date.now();
        const row = this.sql.exec('SELECT value FROM sessions WHERE secret = ?', info.secret).toArray()[0];
        const session = row && JSON.parse(row.value);
        if (!session || session.expiresAt <= now) throw protocolError(401, 'device_session_required');
        const renew = session.expiresAt < now + SESSION_TTL_MS - 60000;
        if (renew) renewSession(session, now);
        if (message.type === 'join') {
          if (!CITY_IDS.includes(message.cityId) || !Object.hasOwn(VENUES, message.venueId)) throw protocolError(400, 'invalid_room');
          if (!canJoinVenue(settleCity(session, message.cityId, now), message.venueId)) throw protocolError(409, 'venue_mismatch');
        } else if (info.room) {
          const [city, venue] = info.room.split(':');
          if (!canJoinVenue(settleCity(session, city, now), venue)) throw protocolError(409, 'venue_mismatch');
        }
        if (renew || message.type === 'join') this.save(session);
        return { session: publicSession(session), expiresAt: session.expiresAt };
      });
      Object.assign(info, result); ws.serializeAttachment(info);
      if (message.type === 'join') {
        this.leave(ws); info.room = venueRoomKey(message.cityId, message.venueId, info.session.id); info.position = { x: 0, z: 0 }; info.lastMoves = []; info.voice = { enabled: false, muted: true };
        ws.serializeAttachment(info); this.presence(info.room); return;
      }
      if (!info.room) throw protocolError(400, 'join_required');
      const peers = this.sockets(info.room);
      if (message.type === 'move') {
        const position = validatePosition(message);
        const now = Date.now();
        const lastMoves = (info.lastMoves || []).filter(at => at > now - 1000);
        if (lastMoves.length >= 5) throw protocolError(429, 'move_rate_limited');
        lastMoves.push(now);
        for (const peer of peers) {
          const attached = peer.deserializeAttachment();
          if (attached.session.id === info.session.id) { attached.position = position; attached.lastMoves = lastMoves; peer.serializeAttachment(attached); }
        }
        this.presence(info.room); return;
      }
      if (message.type === 'voice-state') {
        if (typeof message.enabled !== 'boolean' || typeof message.muted !== 'boolean') throw protocolError(400, 'invalid_voice_state');
        const enabled = new Set(peers.map(peer => peer.deserializeAttachment()).filter(peer => peer.voice.enabled).map(peer => peer.session.id));
        if (message.enabled && !enabled.has(info.session.id) && enabled.size >= MAX_VOICE_MEMBERS) throw protocolError(409, 'voice_room_full');
        info.voice = { enabled: message.enabled, muted: message.muted }; ws.serializeAttachment(info); this.presence(info.room); return;
      }
      if (message.type === 'signal') {
        if (typeof message.to !== 'string' || !message.data || typeof message.data !== 'object' || JSON.stringify(message.data).length > 12000) throw protocolError(400, 'invalid_signal');
        const targets = peers.filter(peer => peer !== ws && peer.deserializeAttachment().session.id === message.to);
        if (!targets.length) throw protocolError(400, 'peer_not_in_room');
        const nearby = targets.filter(target => withinVoiceDistance(info.position, target.deserializeAttachment().position));
        if (!nearby.length) throw protocolError(400, 'peer_out_of_range');
        for (const target of nearby) send(target, { type: 'signal', from: info.session.id, data: message.data });
        return;
      }
      if (message.type === 'chat') {
        const body = typeof message.body === 'string' ? message.body.trim() : '';
        const clientId = message.clientId;
        if (!body || body.length > 500 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body) || (clientId !== undefined && (typeof clientId !== 'string' || !clientId || clientId.length > 80))) throw protocolError(400, 'invalid_chat');
        if (!this.allow(`chat:${info.session.id}`, 30)) throw protocolError(429, 'rate_limited');
        this.sql.exec('DELETE FROM chat_receipts WHERE at < ?', Date.now() - 86400000);
        const old = clientId && this.sql.exec('SELECT value FROM chat_receipts WHERE sender=? AND room=? AND client_id=?', info.session.id, info.room, clientId).toArray()[0];
        if (old) {
          const receipt = JSON.parse(old.value);
          if (receipt.bodyHash !== bodyHash) throw protocolError(409, 'chat_id_conflict');
          send(ws, { type: 'chat', id: receipt.id, clientId, from: info.session, body, at: receipt.at }); return;
        }
        const chat = { type: 'chat', id: crypto.randomUUID(), clientId, from: info.session, body, at: Date.now() };
        if (clientId) {
          this.ctx.storage.transactionSync(() => {
            this.sql.exec('INSERT INTO chat_receipts(sender,room,client_id,at,value) VALUES(?,?,?,?,?)', info.session.id, info.room, clientId, chat.at, JSON.stringify({ id: chat.id, at: chat.at, bodyHash }));
            this.sql.exec('DELETE FROM chat_receipts WHERE sender=? AND room=? AND client_id NOT IN (SELECT client_id FROM chat_receipts WHERE sender=? AND room=? ORDER BY at DESC,rowid DESC LIMIT 100)', info.session.id, info.room, info.session.id, info.room);
          });
        }
        for (const peer of peers) send(peer, chat);
        return;
      }
      throw protocolError(400, 'invalid_message');
    } catch (error) {
      const code = error.code || 'invalid_message';
      send(ws, { type: 'error', code, error: code, ...(message?.type === 'chat' && typeof message.clientId === 'string' && message.clientId.length <= 80 ? { clientId: message.clientId } : {}) });
      if (code === 'venue_mismatch' && message?.type !== 'join') this.leave(ws);
      if (code === 'device_session_required' || error.disconnect) { this.leave(ws, true); ws.close(1008, code); }
    }
  }
  webSocketClose(ws, code, reason) { this.leave(ws, true); try { ws.close(code, reason); } catch {} }
  webSocketError(ws) { this.leave(ws, true); try { ws.close(1011, 'Connection error'); } catch {} }
}
