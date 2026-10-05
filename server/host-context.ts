/**
 * OWNER: foundation
 * WHAT BOTH HOSTS DO THE SAME WAY. The Node host (server/server.ts) and the Cloudflare Worker host
 * (deploy/cloudflare-worker.ts) each build the server context documented in routes/index.js. The parts
 * of it that do not depend on the host — which settings a module may read, how an outside request is
 * bounded, when ctx.act may spend, which sessions are archived, which response headers a route may set —
 * are here, once, so the two hosts cannot drift apart. Portable: no Node imports.
 */
import { settleCity, applyLifeAction } from './life-service.ts';
import { archivedLife } from './protocol.ts';
import type { ActionRequest, CityId } from '../src/types/protocol.ts';
import type { LifeState } from '../src/types/life.ts';
import type { AccountsConfig, ActBody, ActionOutcome, ContextCore, Db, PageHandler, SessionRecord } from './types.ts';

/** The settings a module may read through ctx.env(name). Nothing else of the environment is reachable. */
export const OUTREACH_ENV = Object.freeze(['ZEPTOMAIL_AUTH', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'EMAIL_CONTACT_LINE', 'EMAIL_DAILY_CAP', 'WHATSAPP_CHANNEL_URL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_DAILY_CAP']);
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
export function lifeAuthority({ now, receipts }: { now: () => number; receipts: { active(): boolean; action: ContextCore['actionOnce'] } }) {
  // Which stored session a settled life belongs to, so ctx.act can find that player's receipts.
  const ownerOf = new WeakMap<LifeState, SessionRecord>();
  const settle = (session: SessionRecord, city: CityId): LifeState => { const state = settleCity(session, city, now()); ownerOf.set(state, session); return state; };
  function act(state: LifeState, body: ActBody): ActionOutcome {
    const { stateGuard, ...action } = body;
    const run = () => applyLifeAction(state, action, { now: now(), cityId: action.cityId, actionId: action.actionId, internal: true });
    if (receipts.active() || (typeof stateGuard === 'string' && stateGuard.trim().length >= 12)) return run();
    const session = ownerOf.get(state);
    if (!session || action.actionId === undefined) throw new Error(`ctx.act(${action.type}) has no receipt: call it inside ctx.once, pass the request's actionId, or state its stateGuard`);
    const result = receipts.action(session, action, run);
    return result.duplicate ? { ...result, state } : result;
  }
  /** What POST /api/action runs: a player's own request, with no server authority. */
  const playerAct = (state: LifeState, body: ActionRequest): ActionOutcome => applyLifeAction(state, body, { now: now(), cityId: body.cityId, actionId: body.actionId });
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
