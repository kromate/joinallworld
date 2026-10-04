export const CITY_IDS = Object.freeze(['lagos', 'ibadan']);
export const SESSION_TTL_MS = 30 * 86400000;
export const ACTION_WINDOW_MS = 86400000;
export const MAX_VOICE_MEMBERS = 8;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const protocolError = (status, code) => Object.assign(new Error(code), { status, code });
export function validateName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 3 || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name)) throw protocolError(400, 'invalid_name');
  return name;
}
export function parseActionId(id, now, windowMs = ACTION_WINDOW_MS) {
  const parts = typeof id === 'string' ? id.split(':') : [];
  const at = Number(parts[0]);
  if (parts.length !== 2 || !/^\d{1,16}$/.test(parts[0]) || !Number.isSafeInteger(at) || !UUID_PATTERN.test(parts[1])) throw protocolError(400, 'invalid_action');
  if (at < now - windowMs || at > now + 30000) throw protocolError(409, 'action_expired');
  return at;
}
export function validateActionPayload(body, now, windowMs = ACTION_WINDOW_MS) {
  if (!body || typeof body !== 'object' || !CITY_IDS.includes(body.cityId) || !['activity', 'cancel', 'travel', 'spot'].includes(body.type)) throw protocolError(400, 'invalid_action');
  return parseActionId(body.actionId, now, windowMs);
}
export function publicSession(session) { return { id: session.publicId, name: session.name }; }
export function isSameOrigin(origin, host, { requireOrigin = false } = {}) {
  if (!origin) return !requireOrigin;
  try { const url = new URL(origin); return url.host === host && ['http:', 'https:'].includes(url.protocol); } catch { return false; }
}
export function canJoinVenue(state, venueId) { return state.location === venueId && state.activeAction?.kind !== 'travel'; }
export function actionFingerprint(body) { return JSON.stringify([body.cityId, body.type, body.id, body.mode]); }
export function pruneReceipts(actions, now, windowMs = ACTION_WINDOW_MS) {
  for (const [id, receipt] of Object.entries(actions)) if (receipt.actionAt < now - windowMs) delete actions[id];
}
export function readReceipt(actions, body) {
  const receipt = actions[body.actionId];
  if (receipt && receipt.fingerprint !== actionFingerprint(body)) throw protocolError(409, 'action_id_conflict');
  return receipt;
}
export function archivedLife(session, publicId, at) { return { publicId, name: session.name, cities: structuredClone(session.cities || {}), archivedAt: at }; }


export function renewSession(session, now, ttlMs = SESSION_TTL_MS) {
  if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= now) return false;
  session.expiresAt = now + ttlMs;
  return true;
}


export const VOICE_RADIUS = 12;
export const POSITION_BOUNDS = Object.freeze({ min: -20, max: 20 });
export const STUN_ONLY_CONFIG = Object.freeze({ iceServers: Object.freeze([{ urls: 'stun:stun.l.google.com:19302' }]), turnConfigured: false, mode: 'stun-only' });

export function validatePosition(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.z)
    || value.x < POSITION_BOUNDS.min || value.x > POSITION_BOUNDS.max
    || value.z < POSITION_BOUNDS.min || value.z > POSITION_BOUNDS.max) throw protocolError(400, 'invalid_position');
  return { x: value.x, z: value.z };
}

export function withinVoiceDistance(a, b, radius = VOICE_RADIUS) {
  if (!a || !b || ![a.x, a.z, b.x, b.z].every(Number.isFinite)) return false;
  return Math.hypot(a.x - b.x, a.z - b.z) < radius;
}

export function validateVoiceConfig(config, now) {
  if (!config || !Array.isArray(config.iceServers) || config.iceServers.length > 8
    || !Number.isFinite(config.expiresAt) || config.expiresAt <= now
    || config.expiresAt > now + 86400000) throw protocolError(503, 'voice_config_unavailable');
  let hasTurn = false;
  const iceServers = config.iceServers.map(server => {
    const urls = typeof server?.urls === 'string' ? [server.urls] : server?.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 8
      || urls.some(url => typeof url !== 'string' || url.length > 512 || !/^(stun|stuns|turn|turns):[^\s]+$/.test(url))) throw protocolError(503, 'voice_config_unavailable');
    const turn = urls.some(url => /^turns?:/.test(url));
    if (turn && (typeof server.username !== 'string' || !server.username || server.username.length > 512
      || typeof server.credential !== 'string' || !server.credential || server.credential.length > 4096)) throw protocolError(503, 'voice_config_unavailable');
    hasTurn ||= turn;
    return { urls: typeof server.urls === 'string' ? server.urls : [...urls], ...(turn ? { username: server.username, credential: server.credential } : {}) };
  });
  if (!hasTurn) throw protocolError(503, 'voice_config_unavailable');
  return { iceServers, turnConfigured: true, mode: 'turn', expiresAt: config.expiresAt };
}


export function venueRoomKey(cityId, venueId, publicId) {
  return venueId === 'home' ? `${cityId}:home:${publicId}` : `${cityId}:${venueId}`;
}
