import { registeredCityIds } from '../src/game/cities/registry.ts';
// Portable protocol rules shared by the Node server and the Cloudflare worker.
// No Node-only imports here (no node:*, ws or fs): the worker bundles this file as-is.
import { hasAction, isDeparting, occupiesVenue } from '../src/life.ts';
import { screenText } from './moderation/text.ts';
import { createCampusWalk } from '../src/campus/unilag/walk.ts';
import { ENTRANCE } from '../src/campus/unilag/layout.ts';
import type { ActionRequest, CityId, IceServerConfig, PublicSession } from '../src/types/protocol.ts';
import type { AccountDeviceRecord, ActionReceipt, ArchivedLife, Collections, CollectionName, Db, HttpError, SessionRecord } from './types.ts';
import type { PlotAddress } from '../src/types/life.ts';
import { streetRoomKey } from '../src/game/neighbourhood-space.ts';

/** A point on the ground: venue positions are x/z only. */
type Point = { x: number; z: number };
/** The parts of an action that make up its identity for idempotency. */
type FingerprintBody = Pick<ActionRequest, 'cityId' | 'type' | 'id' | 'mode' | 'payload'>;
/** What canOccupyVenue and isDeparting read of a life. */
type VenueState = Parameters<typeof occupiesVenue>[0];

export const MAX_PAYLOAD_BYTES = 2048;
export const SESSION_TTL_MS = 30 * 86400000;
export const ACTION_WINDOW_MS = 86400000;
export const MAX_VOICE_MEMBERS = 8;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const protocolError = (status: number, code: string): HttpError => Object.assign(new Error(code), { status, code });
/** What a caller gets when a store could not save: the same on every host and for every store. Carries the HTTP shape the route host answers with. */
export function storageError(cause?: unknown): HttpError {
  return Object.assign(new Error('storage_unavailable'), { status: 503, code: 'storage_unavailable',
    reason: 'The server could not save this, so nothing was changed. Try again in a moment.', cause });
}
/** A fast 53-bit text hash (not cryptographic): compact receipt fingerprints and pseudonymous address keys. */
export function hash53(text: string): string {
  let a = 0xdeadbeef ^ text.length, b = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}
/** Loopback, private-range and link-local addresses: many people can sit behind one of these. */
export function isSharedAddress(ip: unknown): boolean {
  const text = String(ip || '').toLowerCase().replace(/^::ffff:/, '');
  // The IPv6 ranges are matched as addresses (a group, then a colon): a host that keys on a digest of the address
  // (the Worker) must not have one that happens to begin with these letters read as a private network.
  return text === '' || text === 'unknown' || text === '::1' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(text) || /^(f[cd][0-9a-f]{0,2}|fe80):/.test(text);
}
/** Open sockets one network address may hold on a host by default (SOCKETS_PER_ADDRESS; server/host-context.ts capacityConfig). */
export const SOCKETS_PER_ADDRESS = 32;
/** Open sockets one session may hold (a page opens two). */
export const SOCKETS_PER_PLAYER = 8;
/**
 * The close code of a socket that was opened while every place was taken ("try again later", RFC 6455): the page says
 * the world is busy and tries again with a growing pause. Its reason is 'socket_capacity'.
 */
export const SOCKET_BUSY_CODE = 1013;
/**
 * Sessions one network address may create in an hour by default (routes/core.ts; NEW_SESSIONS_PER_ADDRESS, server/host-context.ts
 * capacityConfig). A visitor makes one — but one address is often many visitors: a campus network, or a mobile carrier
 * that puts thousands of subscribers behind one address. The default leaves room for a lecture hall arriving together
 * and still means one address needs more than a day to take every place.
 */
export const NEW_SESSIONS_PER_ADDRESS = 300;
/**
 * A nickname: 3–24 characters, no control characters, and — because every other player can see
 * it — nothing the text filter refuses, no link and no contact detail. A refused name throws
 * 400 `name_not_allowed` with a `reason` the player can be shown; nothing is silently changed.
 */
export function validateName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 3 || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name)) throw protocolError(400, 'invalid_name');
  const verdict = screenText(name, { contact: true, what: 'That name' });
  if (verdict) throw Object.assign(protocolError(400, 'name_not_allowed'), { reason: verdict.reason });
  return name;
}
export function parseActionId(id: unknown, now: number, windowMs = ACTION_WINDOW_MS): number {
  const parts: string[] = typeof id === 'string' ? id.split(':') : [];
  const at = Number(parts[0]);
  if (parts.length !== 2 || !/^\d{1,16}$/.test(parts[0] ?? '') || !Number.isSafeInteger(at) || !UUID_PATTERN.test(parts[1] ?? '')) throw protocolError(400, 'invalid_action');
  if (at < now - windowMs || at > now + 30000) throw protocolError(409, 'action_expired');
  return at;
}
const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Stable JSON: object keys sorted at every depth, so equal payloads always fingerprint equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
/**
 * Validates the envelope of POST /api/action: `{ actionId, cityId, type, id?, mode?, payload? }`.
 * `type` must be an action registered by a game system; `payload`, when present, must be a
 * plain object whose JSON is at most MAX_PAYLOAD_BYTES. Field-level validation of the payload
 * belongs to the system that owns the action type.
 */
export function validateActionPayload(body: unknown, now: number, windowMs = ACTION_WINDOW_MS): number {
  if (!body || typeof body !== 'object') throw protocolError(400, 'invalid_action');
  const fields: Record<string, unknown> = { ...body };
  if (!registeredCityIds().some(city => city === fields.cityId) || !hasAction(fields.type)) throw protocolError(400, 'invalid_action');
  if (fields.payload !== undefined) {
    let size = Infinity;
    try { if (isPlainObject(fields.payload)) size = JSON.stringify(fields.payload).length; } catch {}
    if (size > MAX_PAYLOAD_BYTES) throw protocolError(400, 'invalid_payload');
  }
  return parseActionId(fields.actionId, now, windowMs);
}
export function publicSession(session: Pick<SessionRecord, 'publicId' | 'name'>): PublicSession { return { id: session.publicId, name: session.name }; }
/** `secure`: this host is being reached over https, so an Origin naming it must be https too (the same host over plain http is another origin). */
export function isSameOrigin(origin: string | null | undefined, host: string | null | undefined, { requireOrigin = false, secure = false }: { requireOrigin?: boolean; secure?: boolean } = {}): boolean {
  if (!origin) return !requireOrigin;
  try { const url = new URL(origin); return url.host === host && (secure ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)); } catch { return false; }
}
/**
 * WHO IS IN A VENUE — one rule for both hosts and every feature.
 *   isDeparting(state)             the life's timed action is one that takes the player out of the
 *                                  venue (a trip, the automatic commute, any kind a game system
 *                                  registers with `moves: true` — src/game/registry.ts). From the
 *                                  moment it starts until it ends or is cancelled the player is not
 *                                  in any venue, although state.location still names the one they left.
 *   canOccupyVenue(state, venueId) the player is recorded at venueId and is not departing.
 * Joining a venue room, staying in one, being "at home" for guests, interacting with someone in
 * the same venue and counting as present for civic features all ask canOccupyVenue. Never compare
 * state.activeAction.kind with a kind's name: a new way of moving would be missed.
 */
export { isDeparting };
export function canOccupyVenue(state: VenueState, venueId: unknown): boolean { return occupiesVenue(state, venueId); }
/** May this life join (or stay in) the room of venueId? Same rule as canOccupyVenue; the name the worker imports. */
export function canJoinVenue(state: VenueState, venueId: unknown): boolean { return canOccupyVenue(state, venueId); }
/** Identity of a request for idempotency. Covers the payload; without one it equals the pre-payload format, so stored receipts stay valid. */
export function actionFingerprint(body: FingerprintBody): string {
  const parts = [body.cityId, body.type, body.id, body.mode];
  return body.payload === undefined ? JSON.stringify(parts) : `${JSON.stringify(parts)}${canonicalJson(body.payload)}`;
}
export function pruneReceipts(actions: Record<string, Pick<ActionReceipt, 'actionAt'>>, now: number, windowMs = ACTION_WINDOW_MS): void {
  for (const [id, receipt] of Object.entries(actions)) if (receipt.actionAt < now - windowMs) delete actions[id];
}
export function readReceipt<R extends Pick<ActionReceipt, 'fingerprint'>>(actions: Record<string, R>, body: FingerprintBody & { actionId: string }): R | undefined {
  const receipt = actions[body.actionId];
  if (receipt && receipt.fingerprint !== actionFingerprint(body)) throw protocolError(409, 'action_id_conflict');
  return receipt;
}
/**
 * What is kept of a session whose secret is dropped: its lives, and everything else a record carries that a life needs
 * to come back whole — the city its one character is in, lives put aside by a move, and whether it began in the quick
 * start. (Its exactly-once receipts are not kept: by the time a session expires they are long past their window.)
 */
export function archivedLife(session: Pick<SessionRecord, 'name' | 'cities'> & Partial<Pick<SessionRecord, 'character' | 'legacyLives' | 'legacyLifeCities' | 'onboarding'>>, publicId: string, at: number): ArchivedLife {
  return { publicId, name: session.name, cities: structuredClone(session.cities || {}), archivedAt: at,
    ...(session.character ? { character: structuredClone(session.character) } : {}), ...(session.legacyLives ? { legacyLives: structuredClone(session.legacyLives) } : {}), ...(session.legacyLifeCities ? { legacyLifeCities: structuredClone(session.legacyLifeCities) } : {}), ...(session.onboarding === true ? { onboarding: true as const } : {}) };
}


/**
 * One record of a keyed collection, read by key alone (never by listing the collection: on the Worker these are rows).
 * Keys are UUIDs or `fb:`-prefixed ids, so none can name something every object inherits; a non-record answers undefined anyway.
 */
const own = <T>(map: Record<string, T> | undefined, key: string): T | undefined => {
  const value = map && key !== '__proto__' ? map[key] : undefined;
  return value !== null && typeof value === 'object' ? value : undefined;
};
/** A device binding lives 30 days from its last use, and never longer than this from when it was made: after that the person signs in again. */
export const BINDING_MAX_AGE_MS = 90 * 86400000;
/** Is this binding still good? Its sliding expiry has not passed, and neither has its absolute lifetime. */
export const bindingLive = (device: Pick<AccountDeviceRecord, 'expiresAt' | 'createdAt'>, now: number): boolean => device.expiresAt > now && now - device.createdAt < BINDING_MAX_AGE_MS;
/**
 * WHOSE SESSION A COOKIE IS — one rule for both hosts.
 *   a guest      the cookie is the key of a session record that belongs to no account;
 *   signed in    the cookie is a device binding (`accountDevices`) of an account whose active character is the session.
 * A record that belongs to an account is never reached by naming its key: only through a binding, so signing a device
 * out (removing its binding) ends its access at once and the record's key is not a credential. Expired records and
 * bindings answer undefined. `binding: false` — the cookie arrived under a name a sibling host could have set — answers
 * for a guest's own record only. Read-only: nothing is created or renewed here.
 */
export function sessionOfCookie(db: Db, cookie: string | undefined, now: number, binding = true): { session: SessionRecord; device?: AccountDeviceRecord } | undefined {
  if (!cookie || !UUID_PATTERN.test(cookie)) return undefined;
  const direct = db.sessions[cookie];
  if (direct) return direct.account === undefined && Number.isFinite(direct.expiresAt) && direct.expiresAt > now ? { session: direct } : undefined;
  if (!binding) return undefined;
  const device = own(db.accountDevices, cookie);
  if (!device || !bindingLive(device, now)) return undefined;
  const account = own(db.accounts, device.account);
  const session = account?.sessionKey ? db.sessions[account.sessionKey] : undefined;
  if (!account || !session || session.account !== account.id || !(session.expiresAt > now)) return undefined;
  return { session, device };
}
/** A device binding's "last seen" is at most this stale when a host renews with slack. */
export const DEVICE_SEEN_SLACK_MS = 3600000;
/**
 * Renew what sessionOfCookie found: the session, and the device binding that led to it (never past the binding's absolute lifetime).
 * `slackMs` (a host where every stored change is a row written): see renewSession; the binding is then touched once
 * its "last seen" is DEVICE_SEEN_SLACK_MS old (or `slackMs`, when that is shorter), not on every request.
 */
export function renewResolved(found: { session: SessionRecord; device?: AccountDeviceRecord }, now: number, ttlMs = SESSION_TTL_MS, slackMs = 0): void {
  renewSession(found.session, now, ttlMs, slackMs);
  if (found.device && (slackMs <= 0 || now - found.device.seenAt >= Math.min(slackMs, DEVICE_SEEN_SLACK_MS))) { found.device.expiresAt = Math.min(now + ttlMs, found.device.createdAt + BINDING_MAX_AGE_MS); found.device.seenAt = now; }
}

/**
 * Push a live session's expiry out to `now + ttlMs`; false for one that has expired (it is not brought back).
 * `slackMs`: leave the record as it is unless renewing gains at least this much. The session is live either way — only
 * the stored expiry is up to `slackMs` short of a full `ttlMs`, which a slack far below the lifetime never shows.
 */
export function renewSession(session: Pick<SessionRecord, 'expiresAt'> | null | undefined, now: number, ttlMs = SESSION_TTL_MS, slackMs = 0): boolean {
  if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= now) return false;
  if (slackMs <= 0 || now + ttlMs - session.expiresAt >= slackMs) session.expiresAt = now + ttlMs;
  return true;
}


export const VOICE_RADIUS = 12;
export const POSITION_BOUNDS = Object.freeze({ min: -20, max: 20 });
export const STUN_ONLY_CONFIG = Object.freeze({ iceServers: Object.freeze([{ urls: 'stun:stun.l.google.com:19302' }]), turnConfigured: false, mode: 'stun-only' });

/**
 * The UNILAG campus is a venue the size of a district: its positions are campus coordinates, valid only on its
 * walkable ground (src/campus/unilag/walk.ts). Every other venue keeps the ±20 bounds.
 */
let campusWalk: ReturnType<typeof createCampusWalk> | undefined;
/** Where a socket that has just joined a venue room stands: the campus gate, or the origin ("not reported yet") anywhere else. */
export function initialVenuePosition(venueId: unknown): Point { return venueId === 'unilag' ? { x: ENTRANCE.x, z: ENTRANCE.z } : { x: 0, z: 0 }; }
/** A value with finite numeric x and z. */
function isFinitePoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false;
  const { x, z } = value as { x?: unknown; z?: unknown };
  return Number.isFinite(x) && Number.isFinite(z);
}
export function validatePosition(value: unknown, venueId: unknown): Point {
  if (venueId === 'unilag') {
    if (!isFinitePoint(value)) throw protocolError(400, 'invalid_position');
    campusWalk ??= createCampusWalk();
    const zone = campusWalk.zoneAt(value.x, value.z);
    if (!zone || !campusWalk.grids.get(zone.id)?.free(value.x, value.z)) throw protocolError(400, 'invalid_position');
    return { x: value.x, z: value.z };
  }
  if (!isFinitePoint(value)
    || value.x < POSITION_BOUNDS.min || value.x > POSITION_BOUNDS.max
    || value.z < POSITION_BOUNDS.min || value.z > POSITION_BOUNDS.max) throw protocolError(400, 'invalid_position');
  return { x: value.x, z: value.z };
}

export function withinVoiceDistance(a: Point | null | undefined, b: Point | null | undefined, radius = VOICE_RADIUS): boolean {
  if (!a || !b || ![a.x, a.z, b.x, b.z].every(Number.isFinite)) return false;
  return Math.hypot(a.x - b.x, a.z - b.z) < radius;
}

export function validateVoiceConfig(config: unknown, now: number): { iceServers: IceServerConfig[]; turnConfigured: true; mode: 'turn'; expiresAt: number } {
  const unavailable = () => protocolError(503, 'voice_config_unavailable');
  if (!config || typeof config !== 'object') throw unavailable();
  const { iceServers: rawServers, expiresAt } = config as { iceServers?: unknown; expiresAt?: unknown };
  if (!Array.isArray(rawServers) || rawServers.length > 8
    || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= now
    || expiresAt > now + 86400000) throw unavailable();
  let hasTurn = false;
  const iceServers = rawServers.map((server: unknown): IceServerConfig => {
    const entry: { urls?: unknown; username?: unknown; credential?: unknown } = server && typeof server === 'object' ? server : {};
    const urls: unknown = typeof entry.urls === 'string' ? [entry.urls] : entry.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 8
      || urls.some(url => typeof url !== 'string' || url.length > 512 || !/^(stun|stuns|turn|turns):[^\s]+$/.test(url))) throw unavailable();
    const list: string[] = urls;
    const turn = list.some(url => /^turns?:/.test(url));
    let auth: { username?: string; credential?: string } = {};
    if (turn) {
      if (typeof entry.username !== 'string' || !entry.username || entry.username.length > 512
        || typeof entry.credential !== 'string' || !entry.credential || entry.credential.length > 4096) throw unavailable();
      auth = { username: entry.username, credential: entry.credential };
    }
    hasTurn ||= turn;
    return { urls: typeof entry.urls === 'string' ? entry.urls : [...list], ...auth };
  });
  if (!hasTurn) throw unavailable();
  return { iceServers, turnConfigured: true, mode: 'turn', expiresAt };
}


export function venueRoomKey(cityId: string, venueId: string, publicId: string, plot: PlotAddress | null = null): string {
  if (venueId === 'neighbourhood') {
    const room = streetRoomKey(cityId, plot);
    if (!room) throw Error('invalid_room');
    return room;
  }
  return venueId === 'home' ? `${cityId}:home:${publicId}` : `${cityId}:${venueId}`;
}


/**
 * Namespaced top-level collection inside the stored document (db.accounts, db.social, ...),
 * created on first use. Call it inside store.transact(); pass the default for a non-object.
 */
export function collection<K extends CollectionName>(db: Db, name: K, initial?: Partial<Collections[K]>): Collections[K];
export function collection(db: Db, name: string, initial?: object): Record<string, unknown>;
export function collection(db: Db, name: string, initial: object = {}): object {
  // A name every object inherits ('constructor', 'toString', …) would read as "already there" on a
  // plain document and hand back a built-in instead of a collection: such names are refused, and
  // only the document's OWN property counts as an existing collection.
  if (typeof name !== 'string' || !/^[a-z][a-zA-Z0-9]{1,31}$/.test(name) || ['version', 'sessions', 'archivedLives'].includes(name) || name in Object.prototype) throw new Error(`Invalid collection name: ${name}`);
  if (!Object.hasOwn(db, name) || db[name] === undefined || db[name] === null) db[name] = initial;
  return db[name] as object;
}
