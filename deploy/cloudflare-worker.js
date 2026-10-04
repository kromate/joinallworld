import { DurableObject } from 'cloudflare:workers';
import { createSqliteStore } from './sqlite-store.js';
import { relayTestAuthorized, mintCloudflareIce, TURN_DAILY_MINT_LIMIT } from './turn-provider.js';
import { buildRoutes } from '../server/routes/index.js';
import { executeCommand } from '../server/routes/core.js';
import { buildSocketHandlers } from '../server/ws/index.js';
import { settleCity, applyLifeAction } from '../server/life-service.js';
import { CITY_IDS, SESSION_TTL_MS, ACTION_WINDOW_MS, UUID_PATTERN, protocolError, publicSession, isSameOrigin, archivedLife, renewSession, collection, canJoinVenue, STUN_ONLY_CONFIG, validateVoiceConfig } from '../server/protocol.js';
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
    super(ctx, env); this.env = env; this.sql = ctx.storage.sql; this.peers = new Map(); this.inflight = new Map();
    this.store = createSqliteStore(ctx.storage);
    this.sql.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, started_at INTEGER NOT NULL, count INTEGER NOT NULL)');
    if (!this.sql.exec('PRAGMA table_info(rate_limits)').toArray().some(column => column.name === 'expires_at')) this.sql.exec('ALTER TABLE rate_limits ADD COLUMN expires_at INTEGER');
    this.sql.exec('UPDATE rate_limits SET expires_at = started_at + 60000 WHERE expires_at IS NULL');
    this.sql.exec('CREATE TABLE IF NOT EXISTS turn_budget (day TEXT PRIMARY KEY, issued INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chat_receipts (sender TEXT NOT NULL, room TEXT NOT NULL, client_id TEXT NOT NULL, at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,room,client_id))');
    this.rateCleanupAt = 0;
    const listeners = new Map(), now = () => Date.now();
    const context = this.context = {
      store: this.store, now, fail: protocolError, collection, randomId: () => crypto.randomUUID(), cityIds: CITY_IDS, publicSession,
      allow: (key, count = 120, windowMs = 60000) => this.allow(key, count, windowMs),
      send: (ws, message) => { if (ws.readyState === 1) { try { ws.send(JSON.stringify(message)); } catch {} } },
      on(event, fn) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(fn); },
      emit(event, value) { for (const fn of listeners.get(event) || []) { try { fn(value); } catch {} } },
      settle: (session, city) => settleCity(session, city, now()),
      act: (state, body) => applyLifeAction(state, body, { now: now(), cityId: body.cityId, actionId: body.actionId, internal: true }),
      push: (id, message) => { let count = 0; for (const ws of this.peers.values()) if (ws.session.id === id && ws.readyState === 1) { context.send(ws, message); count++; } return count; },
      online: id => [...this.peers.values()].some(ws => ws.session.id === id && ws.readyState === 1 && !context.core.unresponsive(ws)),
      atHome(db, id, city) { const s = context.core.sessionByPublicId(db, id); return !!s && s.expiresAt > now() && CITY_IDS.includes(city) && canJoinVenue(s.cities?.[city]?.state, 'home'); },
      checks: {}, startup: [],
      config: { sessionTtlMs: SESSION_TTL_MS, actionWindowMs: ACTION_WINDOW_MS, maxActiveSessions: 10000, buildId: env.BUILD_ID || 'unreleased', votesPerAddress: 3, heartbeatMs: 10000, moderation: false },
      core: {
        chatHistory: (ws, body) => this.chatHistory(ws, body),
        validateMemberships: async () => {}, refreshNames: () => {}, roomStillValid: () => false,
        archiveSession(db, secret, session) { if (Object.values(session.cities || {}).some(entry => entry?.state && !(entry.state.onboarding?.required === true && !entry.state.onboarding.done))) db.archivedLives[session.publicId] = archivedLife(session, session.publicId, now()); delete db.sessions[secret]; },
        expiredSessionKeys: db => db.$store.scanSessions(s => !s.publicId || !Number.isFinite(s.expiresAt) || s.expiresAt <= now()),
        sessionByPublicId: (db, id) => { const key = db.$store.sessionKeyByPublicId(id); return key === undefined ? undefined : db.sessions[key]; },
        unresponsive: ws => ws.pingedAt > 0 && !ws.alive && now() - ws.pingedAt >= 5000,
        storeStats: () => this.store.stats(), newIdentity: () => ({secret: crypto.randomUUID(), publicId: crypto.randomUUID()}), newId: () => crypto.randomUUID(),
        cookieHeader: (_, secret) => cookie(secret), sockets: () => [...this.peers.values()].filter(ws => ws.readyState === 1), isOpen: ws => ws.readyState === 1,
        sessionOf: (ws, db) => db.sessions[ws.secret],
        playerAct: (state, body) => applyLifeAction(state, body, { now: now(), cityId: body.cityId, actionId: body.actionId }),
      },
    };
    context.command = (request, body, options) => executeCommand(context, request, body, options);
    this.handlers = buildSocketHandlers(context);
    this.routes = buildRoutes(context);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      await Promise.all(context.startup.splice(0));
      for (const socket of ctx.getWebSockets()) { const info = socket.deserializeAttachment(); if (info && !info.closed) { const ws = this.wrap(socket, info); this.handlers.restore(ws); } }
      await this.store.transact(db => { for (const secret of context.core.expiredSessionKeys(db)) context.core.archiveSession(db, secret, db.sessions[secret]); });
    });
  }
  allow(key, count, windowMs = 60000) {
    const now = Date.now();
    if (now >= this.rateCleanupAt) { this.sql.exec('DELETE FROM rate_limits WHERE expires_at <= ?', now); this.rateCleanupAt = now + 60000; }
    const old = this.sql.exec('SELECT started_at,count,expires_at FROM rate_limits WHERE key = ?', key).toArray()[0];
    if (!old && this.sql.exec('SELECT COUNT(*) AS count FROM rate_limits').one().count >= 10000) {
      this.sql.exec('DELETE FROM rate_limits WHERE expires_at <= ?', now);
      if (this.sql.exec('SELECT COUNT(*) AS count FROM rate_limits').one().count >= 10000) return false;
    }
    const active = old && old.expires_at > now, next = active ? old.count + 1 : 1;
    this.sql.exec('INSERT INTO rate_limits(key,started_at,count,expires_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET started_at=excluded.started_at,count=excluded.count,expires_at=excluded.expires_at', key, active ? old.started_at : now, next, active ? old.expires_at : now + windowMs);
    return next <= count;
  }
  wrap(socket, info) {
    const ws = { ...info, voice: info.voice || { enabled: false, muted: true }, position: info.position || {x:0,z:0}, lastMoves: info.lastMoves || [],
      get readyState() { return this.closed ? 3 : socket.readyState; },
      send: data => socket.send(data), close: (code = 1000, reason = '') => { ws.closed = true; socket.close(code, reason); }, socket };
    this.peers.set(socket, ws); return ws;
  }
  saveSockets() {
    for (const [socket, ws] of this.peers) { const { socket: ignored, send: ignoredSend, close: ignoredClose, readyState: ignoredReady, ...info } = ws; socket.serializeAttachment(info); }
  }
  session(request, db, renew = false) {
    const s = request.secret && UUID_PATTERN.test(request.secret) ? db.sessions[request.secret] : undefined;
    if (!s || !Number.isFinite(s.expiresAt) || s.expiresAt <= Date.now()) return undefined;
    if (renew) renewSession(s, Date.now()); return s;
  }
  async fetch(raw) {
    await this.ready;
    try {
      const url = new URL(raw.url), secret = cookieId(raw), now = Date.now();
      const ip = await digest(addressBucket(raw.headers.get('cf-connecting-ip') || 'unknown'));
      if (!isSameOrigin(raw.headers.get('origin'), url.host, { requireOrigin: url.pathname === '/socket' })) throw protocolError(403, 'origin_rejected');
      const request = { method: raw.method, path: url.pathname, query: url.searchParams, ip, secret, params: {}, raw,
        moderator: () => false, json: () => bodyOf(raw), session: (db, options = {}) => this.session(request, db, options.renew),
        requireSession: (db, options = {}) => { const s = this.session(request, db, options.renew); if (!s) throw protocolError(401, 'device_session_required'); return s; } };
      if (url.pathname === '/socket') return await this.upgrade(raw, request);
      const id = await this.store.read(db => request.session(db)?.publicId);
      if (!this.allow(id ? `http:session:${id}` : `http-ip:${ip}`, id ? 600 : 60)) throw protocolError(429, 'rate_limited');
      if (url.pathname === '/api/voice-config' && raw.method === 'GET') return await this.voiceConfig(request);
      const route = this.routes.match(raw.method, url.pathname); if (!route) throw protocolError(404, 'not_found'); request.params = route.params;
      const result = await route.handler(request) || {}, status = result.status || 200;
      const body = status < 300 ? { ...(result.body || {}), serverTime: Date.now() } : result.body || {};
      if (url.pathname === '/api/health') Object.assign(body, { transport: 'cloudflare', buildId: this.env.BUILD_ID || 'unreleased' });
      if (result.renew) for (const ws of this.peers.values()) if (ws.secret === secret) { ws.expiresAt = now + SESSION_TTL_MS; ws.lastSessionRenewedAt = now; }
      this.saveSockets();
      if (result.after) this.ctx.waitUntil(Promise.resolve().then(result.after).then(() => this.saveSockets()).catch(() => {}));
      return json(status, body, { ...(result.renew ? { 'Set-Cookie': cookie(secret) } : {}), ...result.headers });
    } catch (error) { this.saveSockets(); return json(error.status || 500, { error: error.status ? error.code : 'internal_error', ...(error.status && typeof error.reason === 'string' ? {reason:error.reason} : {}) }); }
  }
  async voiceConfig(request) {
    const session = await this.store.transact(db => {
      const s = request.requireSession(db, {renew:true});
      if (!this.liveRoom(s, db)) throw protocolError(403, 'room_membership_required');
      return publicSession(s);
    });
    if (!this.allow(`voice-config:${session.id}`, 6)) throw protocolError(429, 'voice_config_rate_limited');
    let config = STUN_ONLY_CONFIG;
    if (relayTestAuthorized(this.env, session.id)) {
      this.ctx.storage.transactionSync(() => { const day = new Date().toISOString().slice(0,10), used = this.sql.exec('SELECT issued FROM turn_budget WHERE day = ?', day).toArray()[0]?.issued || 0; if (used >= TURN_DAILY_MINT_LIMIT) throw protocolError(429, 'relay_test_limit'); this.sql.exec('INSERT INTO turn_budget(day,issued) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET issued=excluded.issued', day, used + 1); });
      try { config = validateVoiceConfig(await mintCloudflareIce(this.env), Date.now()); } catch { throw protocolError(503, 'voice_config_unavailable'); }
      await this.store.read(db => { const s = request.requireSession(db); if (!this.liveRoom(s, db)) throw protocolError(403, 'room_membership_required'); });
    }
    return json(200, {...config, radius:12, serverTime:Date.now()}, {'Set-Cookie':cookie(request.secret)});
  }
  liveRoom(session, db) {
    return [...this.peers.values()].some(ws => ws.session.id === session.publicId && ws.readyState === 1 && ws.room && ws.expiresAt > Date.now() && !this.context.core.unresponsive(ws) && this.context.core.roomStillValid(ws, db, session, ws.room.split(':')[0], this.context.settle(session, ws.room.split(':')[0])));
  }
  async upgrade(raw, request) {
    if (raw.headers.get('upgrade')?.toLowerCase() !== 'websocket' || raw.method !== 'GET') throw protocolError(403, 'websocket_required');
    if (!this.allow(`upgrade:${request.ip}`, 60)) throw protocolError(429, 'rate_limited');
    const info = await this.store.transact(db => { const s = request.requireSession(db, {renew:true}); return { secret:s.secret, session:publicSession(s), expiresAt:s.expiresAt }; });
    const peers = [...this.peers.values()].filter(ws => ws.readyState === 1);
    if (peers.length >= 1024 || peers.filter(ws => ws.secret === info.secret).length >= 8 || peers.filter(ws => ws.ip === request.ip).length >= 32) throw protocolError(503, 'socket_capacity');
    const pair = new WebSocketPair(), socket = pair[1]; this.ctx.acceptWebSocket(socket);
    const ws = this.wrap(socket, {...info,ip:request.ip,room:null,closed:false,alive:true,pingedAt:0,seenAt:Date.now(),lastSessionRenewedAt:Date.now()});
    this.handlers.open(ws); this.saveSockets(); if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now()+10000);
    return new Response(null, {status:101,webSocket:pair[0],headers:{'Set-Cookie':cookie(info.secret)}});
  }
  chatHistory(ws, body) {
    this.sql.exec('DELETE FROM chat_receipts WHERE at < ?', Date.now()-86400000);
    const rows = this.sql.exec('SELECT client_id,value FROM chat_receipts WHERE sender=? AND room=? ORDER BY at,rowid',ws.session.id,ws.room).toArray();
    const records = new Map(rows.map(row=>[row.client_id,JSON.parse(row.value)]));
    return {
      has:id=>records.has(id), get:id=>{const r=records.get(id);if(r.bodyHash!==ws.chatBodyHash)throw Error('chat_id_conflict');return {type:'chat',id:r.id,at:r.at,clientId:id,from:{...ws.session},body};},
      set:(id,chat)=>{const value={id:chat.id,at:chat.at,bodyHash:ws.chatBodyHash};this.sql.exec('INSERT INTO chat_receipts(sender,room,client_id,at,value) VALUES(?,?,?,?,?)',ws.session.id,ws.room,id,chat.at,JSON.stringify(value));records.set(id,value);},
      get size(){return records.size;}, keys:()=>records.keys(),
      delete:id=>{this.sql.exec('DELETE FROM chat_receipts WHERE sender=? AND room=? AND client_id=?',ws.session.id,ws.room,id);records.delete(id);},
    };
  }
  async webSocketMessage(socket, raw) {
    await this.ready;
    const ws = this.peers.get(socket); if (!ws || ws.readyState !== 1) return;
    if (!this.allow(`ws:${ws.session.id}`, 600)) { this.context.send(ws,{type:'error',code:'rate_limited',error:'rate_limited'}); return; }
    const before = this.inflight.get(socket) || Promise.resolve();
    const operation = before.then(() => this.message(socket, raw)); this.inflight.set(socket, operation);
    try { await operation; } finally { if (this.inflight.get(socket) === operation) this.inflight.delete(socket); }
  }
  async message(socket, raw) {
    const ws = this.peers.get(socket); if (!ws || ws.readyState !== 1) return;
    let message;
    try {
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 16384) throw Error('invalid_message');
      message = JSON.parse(raw); if (!message || typeof message !== 'object') throw Error('invalid_message');
      const authenticated = await this.store.read(db => { const s=db.sessions[ws.secret]; if (s && s.expiresAt>Date.now()) { if (message.type !== 'join') this.context.core.validateRestoredMembership(ws,db,s); return true; } return false; });
      if (!authenticated || ws.expiresAt <= Date.now()) { this.context.send(ws,{type:'error',code:'device_session_required',error:'device_session_required'}); ws.close(1008,'Device session expired'); this.handlers.close(ws); return; }
      ws.alive = true; ws.seenAt = Date.now();
      if (message.type === 'heartbeat-ack') return;
      if (Date.now()-ws.lastSessionRenewedAt >= 60000) {
        const expiration = await this.store.transact(db => { const s = db.sessions[ws.secret]; if (!renewSession(s,Date.now())) throw Error('device_session_required'); return s.expiresAt; });
        for (const peer of this.peers.values()) if (peer.secret === ws.secret) {peer.expiresAt=expiration;peer.lastSessionRenewedAt=Date.now();}
      }
      const entry = this.handlers.messages.get(message.type); if (!entry) throw Error(ws.room?'invalid_message':'join_required'); if (entry.room && !ws.room) throw Error('join_required');
      if (message.type === 'chat') {
        const room = ws.room; const hash = await digest(typeof message.body === 'string' ? message.body.trim() : '');
        if (ws.room !== room) throw Error('venue_mismatch');
        Object.defineProperty(ws, 'chatBodyHash', {value:hash,configurable:true});
      }
      await entry.handle(ws, message);
    } catch (error) { const code = /^[a-z][a-z0-9_]{1,63}$/.test(error.message) ? error.message : 'internal_error'; this.context.send(ws, {type:'error',code,error:code,...(typeof error.reason==='string'?{reason:error.reason}:{}),...(message?.type==='signal'&&typeof message.to==='string'&&UUID_PATTERN.test(message.to)&&message.to!==ws.secret?{to:message.to}:{}),...(message?.type==='chat'&&typeof message.clientId==='string'&&message.clientId.length<=80?{clientId:message.clientId}:{})}); }
    finally { this.saveSockets(); }
  }
  async webSocketClose(socket) { await this.ready; const ws=this.peers.get(socket);if(ws){ws.closed=true;this.handlers.close(ws);this.peers.delete(socket);this.saveSockets();} }
  async webSocketError(socket) { await this.webSocketClose(socket); }
  async alarm() {
    await this.ready;
    for (const ws of this.peers.values()) {
      if (ws.readyState !== 1) continue;
      if (!ws.alive || ws.expiresAt <= Date.now()) {ws.close(1008,'Session inactive');this.handlers.close(ws);continue;}
      ws.alive=false;ws.pingedAt=Date.now();this.context.send(ws,{type:'heartbeat'});
    }
    this.context.emit('heartbeat',{now:Date.now()});this.saveSockets();
    if ([...this.peers.values()].some(ws=>ws.readyState===1)) await this.ctx.storage.setAlarm(Date.now()+10000);
  }
}
