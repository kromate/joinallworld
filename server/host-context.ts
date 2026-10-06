/**
 * OWNER: foundation
 * WHAT BOTH HOSTS DO THE SAME WAY. The Node host (server/server.ts) and the Cloudflare Worker host
 * (deploy/cloudflare-worker.ts) each build the server context documented in routes/index.js. The parts
 * of it that do not depend on the host — which settings a module may read, how an outside request is
 * bounded, when ctx.act may spend, which sessions are archived, which response headers a route may set —
 * are here, once, so the two hosts cannot drift apart. Portable: no Node imports.
 */
import { settleCity, applyLifeAction } from './life-service.ts';
import { fileCharacter } from './character.ts';
import { ROOM_GROUP_MAX, ROOM_GROUP_MIN, ROOM_GROUP_TARGET } from '../src/game/roomGroups.ts';
import { archivedLife, NEW_SESSIONS_PER_ADDRESS, SOCKETS_PER_ADDRESS, SOCKETS_PER_PLAYER } from './protocol.ts';
import { outcomeKey } from './routes/core.ts';
import type { ActionRequest, CityId, LifeChangedFrame } from '../src/types/protocol.ts';
import type { LifeState } from '../src/types/life.ts';
import { FOUNDER_EMAIL_SHA256 } from './social/founder.ts';
import type { AccountsConfig, ActBody, ActionOutcome, ContextCore, Db, PageHandler, SessionRecord } from './types.ts';

/** The settings a module may read through ctx.env(name). Nothing else of the environment is reachable. */
export const OUTREACH_ENV = Object.freeze(['ZEPTOMAIL_AUTH', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'EMAIL_CONTACT_LINE', 'EMAIL_DAILY_CAP', 'WHATSAPP_CHANNEL_URL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_DAILY_CAP', 'NOTICE_PUBLIC_KEY', 'CHAT_IMAGES', 'CHAT_IMAGES_PER_DAY', 'CHAT_IMAGES_PER_CHAT', 'CHAT_IMAGES_RETENTION_DAYS', 'CHAT_IMAGES_MAX_MB', 'CHAT_IMAGES_REPORTS', 'CHAT_PUSH', 'CHAT_PUSH_UNSEEN_MS', 'CHAT_PUSH_WINDOW_MS']);
/** ctx.env: one of the settings above, or '' — whatever object the host keeps its environment in. */
export const envReader = (env: Readonly<Record<string, unknown>> | null | undefined) => (name: string): string => {
  const value = OUTREACH_ENV.includes(name) ? env?.[name] : undefined;
  return typeof value === 'string' ? value : '';
};

/**
 * ACCOUNTS ARE OFF UNLESS CONFIGURED. The three settings are the sign-in provider's PUBLIC client configuration (they
 * are sent to every browser that opens sign-in), kept in the environment so no deployment's identifiers are in the source:
 *   ACCOUNTS_FIREBASE_PROJECT_ID   the project whose ID tokens this server accepts (audience and issuer)
 *   ACCOUNTS_FIREBASE_API_KEY      the project's web API key
 *   ACCOUNTS_GOOGLE_CLIENT_ID      optional: the OAuth web client id of the Google button; without it only e-mail sign-in is offered
 * The first two must both be present and well formed, or accounts stay off.
 */
export const ACCOUNTS_ENV = Object.freeze(['ACCOUNTS_FIREBASE_PROJECT_ID', 'ACCOUNTS_FIREBASE_API_KEY', 'ACCOUNTS_GOOGLE_CLIENT_ID']);
export function accountsConfig(env: Readonly<Record<string, unknown>> | null | undefined): AccountsConfig | null {
  const text = (name: string): string => { const value = env?.[name]; return typeof value === 'string' ? value.trim() : ''; };
  const projectId = text('ACCOUNTS_FIREBASE_PROJECT_ID'), apiKey = text('ACCOUNTS_FIREBASE_API_KEY'), client = text('ACCOUNTS_GOOGLE_CLIENT_ID');
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId) || !/^[A-Za-z0-9_-]{20,80}$/.test(apiKey)) return null;
  return { projectId, apiKey, googleClientId: /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(client) ? client : '' };
}
/**
 * THE FOUNDER (server/social/founder.ts) is known by the SHA-256 of their account's address. FOUNDER_EMAIL_SHA256
 * replaces the built-in hash: 64 hex characters name another account; an empty or malformed value means there is no
 * founder, and nobody is given a first friend. Unset: the built-in hash.
 */
export const FOUNDER_ENV = 'FOUNDER_EMAIL_SHA256';
export function founderEmailHash(env: Readonly<Record<string, unknown>> | null | undefined): string {
  const value = env?.[FOUNDER_ENV];
  if (value === undefined || value === null) return FOUNDER_EMAIL_SHA256;
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[0-9a-f]{64}$/.test(text) ? text : '';
}
/**
 * HOW MANY PLAYERS A HOST TAKES. Five numbers, the same on both hosts, each replaceable by a setting of the same name
 * (docs/CAPACITY.md says where the defaults come from and what a player sees at each):
 *   MAX_ACTIVE_SESSIONS   stored device sessions — every device that played in the last session lifetime, connected or not.
 *                         At the cap a NEW visitor is asked to wait (503 device_capacity); nobody who has a session is affected.
 *                         Its default is what the collections that grow with it can carry while each is one stored value.
 *   MAX_SOCKETS           open sockets in all (a page holds two). At the cap a new socket is closed with SOCKET_BUSY_CODE
 *                         and the page tries again; nobody connected is dropped.
 *   SOCKETS_PER_ADDRESS   open sockets one network address may hold, so one visitor cannot take every place.
 *   NEW_SESSIONS_PER_ADDRESS   new sessions one network address may make in an hour. Beyond it a new visitor from that address
 *                         is told so, and when to try again (429 with Retry-After); nobody who has a session is affected.
 *   ROOM_GROUP_TARGET, ROOM_GROUP_MAX, ROOM_GROUP_MIN   the sizes of the groups a public venue's room is split into (src/game/roomGroups.ts):
 *                         strangers are placed up to the target, friends up to the maximum plus two, a group below the minimum is merged away.
 *   SOCKETS_PER_PLAYER    not a setting: open sockets one session may hold.
 * A value that is not a whole number inside its bounds is ignored with one log line, and the default applies: a typing
 * mistake in a setting must not stop the game.
 */
export interface CapacityConfig { maxActiveSessions: number; maxSockets: number; socketsPerAddress: number; socketsPerPlayer: number; newSessionsPerAddress: number; roomGroupTarget: number; roomGroupMax: number; roomGroupMin: number }
export const CAPACITY_DEFAULTS: Readonly<CapacityConfig> = Object.freeze({ maxActiveSessions: 10000, maxSockets: 4000, socketsPerAddress: SOCKETS_PER_ADDRESS, socketsPerPlayer: SOCKETS_PER_PLAYER, newSessionsPerAddress: NEW_SESSIONS_PER_ADDRESS, roomGroupTarget: ROOM_GROUP_TARGET, roomGroupMax: ROOM_GROUP_MAX, roomGroupMin: ROOM_GROUP_MIN });
/** [setting, field, least, most]. The most a host can be told to take is what the platform itself allows (docs/CAPACITY.md). */
export const CAPACITY_ENV: readonly (readonly [string, keyof CapacityConfig, number, number])[] = Object.freeze([
  ['MAX_ACTIVE_SESSIONS', 'maxActiveSessions', 1, 5000000], ['MAX_SOCKETS', 'maxSockets', 2, 32000], ['SOCKETS_PER_ADDRESS', 'socketsPerAddress', 2, 32000],
  ['NEW_SESSIONS_PER_ADDRESS', 'newSessionsPerAddress', 1, 100000],
  ['ROOM_GROUP_TARGET', 'roomGroupTarget', 2, 64], ['ROOM_GROUP_MAX', 'roomGroupMax', 2, 64], ['ROOM_GROUP_MIN', 'roomGroupMin', 1, 32],
] as const);
export function capacityConfig(env: Readonly<Record<string, unknown>> | null | undefined, log: (line: string) => void = () => {}): CapacityConfig {
  const config: CapacityConfig = { ...CAPACITY_DEFAULTS };
  for (const [name, field, least, most] of CAPACITY_ENV) {
    const given = env?.[name];
    if (given === undefined || given === null || given === '') continue;
    const value = typeof given === 'number' ? given : typeof given === 'string' && /^\d{1,9}$/.test(given.trim()) ? Number(given.trim()) : NaN;
    if (Number.isSafeInteger(value) && value >= least && value <= most) config[field] = value;
    else log(`${name} must be a whole number from ${least} to ${most}: the default (${config[field]}) is used.`);
  }
  // A minimum nobody set follows a small target (about a third of it), so a host that only shrinks the groups gets groups that can merge.
  const minGiven = env?.['ROOM_GROUP_MIN'];
  if (minGiven === undefined || minGiven === null || minGiven === '') config.roomGroupMin = Math.min(config.roomGroupMin, Math.max(1, Math.floor(config.roomGroupTarget / 3)));
  // The three group sizes only make sense together: a minimum above the target, or a target above the maximum, is a typing mistake too.
  if (!(config.roomGroupMin <= config.roomGroupTarget && config.roomGroupTarget <= config.roomGroupMax)) {
    log(`ROOM_GROUP_MIN (${config.roomGroupMin}), ROOM_GROUP_TARGET (${config.roomGroupTarget}) and ROOM_GROUP_MAX (${config.roomGroupMax}) must rise in that order: the defaults are used.`);
    config.roomGroupMin = CAPACITY_DEFAULTS.roomGroupMin; config.roomGroupTarget = CAPACITY_DEFAULTS.roomGroupTarget; config.roomGroupMax = CAPACITY_DEFAULTS.roomGroupMax;
  }
  return config;
}

/**
 * THE SESSION COOKIE. Over HTTPS it is `__Host-sid`: a name a browser only accepts with Secure, Path=/ and NO Domain, so
 * a page on a sibling host (another subdomain of the same site) cannot set or overwrite it. Before that name it was
 * `sid`, which a sibling host CAN set for the whole site; it is still read, so nobody is signed out by the change:
 *   - `__Host-sid`, when present, is the session cookie and `sid` is ignored. Two different values under THIS name are
 *     nobody's session (a browser holds one; two means the header was made by hand);
 *   - with no `__Host-sid`, the FIRST `sid` is the cookie — exactly what the build before this one did, so a guest who
 *     has not been upgraded yet sees no new behaviour. It is honoured for a GUEST's own session record only (never as
 *     an account's device binding), and the next answer also sets it as `__Host-sid`.
 * THE OLD COOKIE IS KEPT FOR THIS RELEASE. An upgrade sets `__Host-sid` and leaves `sid` alone, so a browser holds both
 * and the build before this one — which reads only `sid` — would still know every guest if this release had to be
 * rolled back. `sid` is removed only where leaving it would be wrong: when a browser signs out. Dropping it for good
 * belongs to a later release.
 * Without HTTPS (development on plain http) a browser refuses a `__Host-` cookie, so the name stays `sid` there and is
 * honoured for everything.
 */
export const SESSION_COOKIE = '__Host-sid', LEGACY_SESSION_COOKIE = 'sid';
export interface PresentedSession {
  /** The session cookie's value, or undefined (none, or ambiguous). */
  value: string | undefined
  /** It arrived under the old name. */
  legacy: boolean
  /** The request carried a cookie under the old name at all (it is removed when the browser signs out, and not before). */
  hadLegacy: boolean
}
export function presentedSession(header: string | null | undefined): PresentedSession {
  const named = (name: string): string[] => [...new Set(String(header || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`)).map(part => part.slice(name.length + 1)))];
  const current = named(SESSION_COOKIE), old = named(LEGACY_SESSION_COOKIE);
  if (current.length) return { value: current.length === 1 ? current[0] : undefined, legacy: false, hadLegacy: old.length > 0 };
  return { value: old[0], legacy: old.length > 0, hadLegacy: old.length > 0 };
}
/** May this presented cookie name an account's device binding? Only under the name a sibling host cannot set — or where that name cannot be used at all. */
export const mayBind = (presented: PresentedSession, secure: boolean): string | undefined => (presented.value !== undefined && (!presented.legacy || !secure) ? presented.value : undefined);
const cookieLine = (name: string, secret: string, maxAgeSeconds: number, secure: boolean): string => `${name}=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${secret ? Math.floor(maxAgeSeconds) : 0}${secure ? '; Secure' : ''}`;
/**
 * The Set-Cookie value(s) that set the session cookie — or, with `secret` '', remove it. One place, so setting and
 * clearing can never differ. SETTING never touches a cookie under the old name (see above: it is kept for this release).
 * REMOVING (`hadLegacy`: the request carried one) removes that too: a signed-out browser must not fall back to whatever
 * `sid` it still holds.
 */
export function sessionCookie(secret: string, maxAgeSeconds: number, secure: boolean, hadLegacy = false): string | string[] {
  if (!secure) return cookieLine(LEGACY_SESSION_COOKIE, secret, maxAgeSeconds, false);
  const current = cookieLine(SESSION_COOKIE, secret, maxAgeSeconds, true);
  return hadLegacy && !secret ? [current, cookieLine(LEGACY_SESSION_COOKIE, '', 0, true)] : current;
}
/**
 * Whether a request may change account state: it named this host as its Origin — with https when this host is reached
 * over https — and did not say it came from another site.
 */
export const isStrictOrigin = (origin: string | null | undefined, host: string | null | undefined, fetchSite: string | null | undefined, secure = false): boolean => {
  if (!origin || (fetchSite && fetchSite !== 'same-origin')) return false;
  try { const url = new URL(origin); return url.host === host && (secure ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)); } catch { return false; }
};

/**
 * THE ADDRESS A LIMIT IS KEYED ON, on both hosts. An IPv4 address is itself (also when it arrives written as an
 * IPv4-mapped IPv6 address). An IPv6 address is its /64: a network hands one subscriber at least that much, so every
 * address inside it is the same visitor, and a limit keyed on the full address could be dodged by changing the last
 * bits. The loopback address stays as it is.
 */
export function addressBucket(ip: string): string {
  const text = ip.toLowerCase().replace(/^::ffff:(?=\d{1,3}(?:\.\d{1,3}){3}$)/, '');
  if (!text.includes(':') || text === '::1') return text;
  const [left, right = ''] = text.split('::');
  const start = left ? left.split(':') : [], end = right ? right.split(':') : [];
  return [...start, ...Array(Math.max(0, 8 - start.length - end.length)).fill('0'), ...end].slice(0, 4).map(part => parseInt(part || '0', 16).toString(16)).join(':');
}

/** The longest an outside request (ctx.fetch) may take, whatever its caller asked for. */
export const OUTBOUND_TIMEOUT_MS = 15000;
/**
 * ctx.fetch: an outside request is HTTPS, bounded in time whatever the caller passed, and never follows a redirect (a
 * provider that answers with one is treated as failed: the request must not be led to another host).
 * `refuseRedirect`: 'error' where the runtime's fetch refuses a redirect itself (Node); 'manual' where it cannot (the
 * Workers runtime has no redirect: 'error') — the redirect is then not followed and the answer is rejected here.
 */
export function outboundFetch(outbound: (url: string, init: RequestInit) => Promise<Response>, { refuseRedirect = 'error' }: { refuseRedirect?: 'error' | 'manual' } = {}) {
  return function fetchOutside(url: unknown, init: object = {}): Promise<Response> {
    let target: URL;
    try { target = new URL(String(url)); } catch { return Promise.reject(new TypeError('Invalid outbound URL')); }
    if (target.protocol !== 'https:') return Promise.reject(new TypeError('Outbound requests must use https'));
    const limit = AbortSignal.timeout(OUTBOUND_TIMEOUT_MS);
    const options: RequestInit = init && typeof init === 'object' ? init : {};
    const { signal, redirect, ...rest } = options;
    const sent = outbound(target.href, { ...rest, redirect: refuseRedirect, signal: signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, limit]) : limit });
    if (refuseRedirect === 'error') return sent;
    return Promise.resolve(sent).then((response) => {
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) throw new TypeError('Outbound redirect refused');
      return response;
    });
  };
}

/** A session with nothing in it — no city, or only lives whose quick start was never confirmed — has no life to keep. */
export const hasLife = (session: Pick<SessionRecord, 'cities'>): boolean => Object.values(session.cities || {}).some(entry => entry?.state && !(entry.state.onboarding?.required === true && entry.state.onboarding.done !== true));
/**
 * archiveSession(db, secret, session): a lived life is never destroyed — it moves to the archive without its secret.
 * A session that never created a life leaves nothing behind, so abandoned sign-ups cannot grow the data.
 */
export function sessionArchiver({ now, randomId }: { now: () => number; randomId: () => string }): ContextCore['archiveSession'] {
  return function archiveSession(db: Db, secret: string, session: SessionRecord): void {
    if (hasLife(session)) {
      db.archivedLives ||= {};
      const publicId = session.publicId || randomId();
      db.archivedLives[publicId] = archivedLife(session, publicId, now());
    }
    delete db.sessions[secret];
  };
}

/** Told, inside the transaction, that a character changed in a way a player would see; `actionId` when an accepted action did it. */
export type LifeChanged = (publicId: string, rev: number, actionId?: string) => void;
/** How long a change waits for others of the same character before its one frame goes out. */
export const LIFE_SYNC_DELAY_MS = 40;
const LIFE_SYNC_CAUSES = 8;
/**
 * ONE CHARACTER ON SEVERAL DEVICES (docs/DEVICES.md): tells every open socket of a character that its life changed.
 * note() is called from inside transactions (lifeAuthority's `changed`); the frame goes out a moment later, one per
 * character however many changes that moment held, with the highest revision and the action ids that caused them. It is a
 * hint to read again, never the state: a change whose write was then undone costs its devices one read and nothing else.
 * Nothing is kept beyond that moment, so a host that loses its memory loses at most a hint the next poll makes up for.
 */
export function lifeAnnouncer(push: (publicId: string, frame: LifeChangedFrame) => unknown, delayMs = LIFE_SYNC_DELAY_MS) {
  const pending = new Map<string, { rev: number; by: string[] }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  function flush(): void {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    const batch = [...pending];
    pending.clear();
    for (const [publicId, { rev, by }] of batch) { try { push(publicId, { type: 'life-changed', rev, ...(by.length ? { by } : {}) }); } catch { /* a socket that went away */ } }
  }
  const note: LifeChanged = (publicId, rev, actionId) => {
    const entry = pending.get(publicId) ?? { rev: 0, by: [] };
    entry.rev = Math.max(entry.rev, rev);
    if (typeof actionId === 'string' && !entry.by.includes(actionId)) { entry.by.push(actionId); if (entry.by.length > LIFE_SYNC_CAUSES) entry.by.shift(); }
    pending.set(publicId, entry);
    if (timer !== null) return;
    const handle = setTimeout(flush, delayMs);
    (handle as { unref?: () => void }).unref?.();
    timer = handle;
  };
  return { note, flush };
}

/**
 * ctx.settle and ctx.act for a host, over its receipts (server/routes/once.ts createOnce).
 * EVERY ctx.act must be safe to retry, and the host checks it rather than trusting the caller:
 *   - inside ctx.once(...) (or another ctx.act) the surrounding receipt covers it;
 *   - with `stateGuard: '<why a repeat cannot apply twice>'` the caller declares that stored state
 *     checked in the same transaction makes it once-only (a ballot entry, a queue it removes from);
 *   - otherwise `actionId` must be an action id (`<ms>:<uuid>`, normally the request's) and the life
 *     must come from ctx.settle: the same receipt steps as POST /api/action run, and a repeat
 *     returns { ok, code, state, duplicate: true } without running the action again.
 * Anything else throws, so a route cannot spend without a receipt by accident.
 */
export function lifeAuthority({ now, receipts, changed }: { now: () => number; receipts: { active(): boolean; action: ContextCore['actionOnce'] }; changed?: LifeChanged }) {
  // Which stored session a settled life belongs to, so ctx.act can find that player's receipts.
  const ownerOf = new WeakMap<LifeState, SessionRecord>();
  // What a player would see of a character: the outcome of its life in this city, and which city and lives it has.
  const seen = (session: SessionRecord, city: CityId): string => `${outcomeKey(session.cities?.[city]?.state)}${JSON.stringify([session.character, Object.keys(session.cities || {}), Object.keys(session.legacyLives ?? {})])}`;
  /** The city a life is still filed under although it now says another one, or null. */
  const cityFiling = (session: SessionRecord, state: LifeState): CityId | null => {
    for (const [city, entry] of Object.entries(session.cities ?? {})) if (entry?.state === state) return state.estate.city === city ? null : city as CityId;
    return null;
  };
  const applied = (state: LifeState, result: ActionOutcome, actionId: string | undefined): ActionOutcome => {
    const owner = ownerOf.get(state);
    // An action that ended a trip between cities (a skipped trip) left the life in another city: it is filed under that
    // city in the same transaction, exactly as a settlement files a trip that ran out (settleCity).
    if (owner && result.ok) { const from = cityFiling(owner, state); if (from) fileCharacter(owner, from, now()); }
    if (changed && owner && result.ok) changed(owner.publicId, owner.rev ?? 0, actionId);
    return result;
  };
  const settle = (session: SessionRecord, city: CityId): LifeState => {
    const before = changed ? seen(session, city) : '';
    const state = settleCity(session, city, now()); ownerOf.set(state, session);
    if (changed && before !== seen(session, city)) changed(session.publicId, session.rev ?? 0);
    return state;
  };
  function act(state: LifeState, body: ActBody): ActionOutcome {
    const { stateGuard, ...action } = body;
    const run = () => applied(state, applyLifeAction(state, action, { now: now(), cityId: action.cityId, actionId: action.actionId, internal: true }), action.actionId);
    if (receipts.active() || (typeof stateGuard === 'string' && stateGuard.trim().length >= 12)) return run();
    const session = ownerOf.get(state);
    if (!session || action.actionId === undefined) throw new Error(`ctx.act(${action.type}) has no receipt: call it inside ctx.once, pass the request's actionId, or state its stateGuard`);
    const result = receipts.action(session, action, run);
    return result.duplicate ? { ...result, state } : result;
  }
  /** What POST /api/action runs: a player's own request, with no server authority. */
  const playerAct = (state: LifeState, body: ActionRequest): ActionOutcome => applied(state, applyLifeAction(state, body, { now: now(), cityId: body.cityId, actionId: body.actionId }), body.actionId);
  return { settle, act, playerAct };
}

/** Response headers a route may set. Anything else a module returns is dropped. */
const ROUTE_HEADERS = new Map([['set-cookie', 'Set-Cookie'], ['cache-control', 'Cache-Control'], ['retry-after', 'Retry-After']]);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
export function routeHeaders(headers: unknown): Record<string, string | string[]> {
  const kept: Record<string, string | string[]> = {};
  if (headers && typeof headers === 'object') for (const [name, value] of Object.entries(headers) as [string, unknown][]) {
    const known = ROUTE_HEADERS.get(String(name).toLowerCase());
    if (known && (typeof value === 'string' || isStringArray(value))) kept[known] = value;
  }
  return kept;
}

/** The registered page whose prefix a path starts with: [prefix, render] or undefined. */
export const pageFor = (pages: Map<string, PageHandler>, pathname: string): [string, PageHandler] | undefined => [...pages].find(([prefix]) => pathname.startsWith(prefix));
/** The public origin an operator may configure (PUBLIC_ORIGIN): scheme and host only, or ''. */
export const cleanOrigin = (value: unknown): string => (typeof value === 'string' && /^https?:\/\/[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(value) ? value : '');
/** A request's own Host, accepted only if it is made of host characters (nothing a client sends in that header can put markup into a page). */
export const cleanHost = (value: unknown): string => (/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(String(value || '')) ? String(value) : '');
/** The host the static index.html is written for: its canonical, og:url, og:image and JSON-LD carry it, and a host answering for another origin swaps it. */
export const SITE_ORIGIN = 'https://joinallworld.com';
/**
 * index.html written for the origin it is served from (a link preview needs absolute URLs, and a canonical must name the
 * page's own host): the two preview-image attributes given as a site-relative /og/ path become absolute, and every
 * SITE_ORIGIN in the page (canonical, og:url, og:image, JSON-LD) becomes `origin`. `origin` is already validated (cleanOrigin / cleanHost).
 */
export const absolutePreviewImage = (html: string, origin: string): string => (origin
  ? html.replace(/(<meta (?:property="og:image"|name="twitter:image") content=")(\/og\/[A-Za-z0-9._-]+")/g, `$1${origin}$2`).replaceAll(SITE_ORIGIN, origin)
  : html);
/** The operator token must be something a Bearer header can carry: 24–512 printable ASCII characters without spaces. */
export const validOperatorToken = (token: unknown): boolean => typeof token === 'string' && /^[\x21-\x7e]{24,512}$/.test(token);
/** The token of an `Authorization: Bearer …` header, or null. */
export const bearerToken = (header: string | null | undefined): string | null => /^Bearer ([\x21-\x7e]{1,512})$/.exec(header || '')?.[1] ?? null;
