/**
 * OWNER: foundation
 * WHAT BOTH HOSTS DO THE SAME WAY. The Node host (server/server.js) and the Cloudflare Worker host
 * (deploy/cloudflare-worker.ts) each build the server context documented in routes/index.js. The parts
 * of it that do not depend on the host — which settings a module may read, how an outside request is
 * bounded, when ctx.act may spend, which sessions are archived, which response headers a route may set —
 * are here, once, so the two hosts cannot drift apart. Portable: no Node imports.
 */
import { settleCity, applyLifeAction } from './life-service.js';
import { archivedLife } from './protocol.js';

/** The settings a module may read through ctx.env(name). Nothing else of the environment is reachable. */
export const OUTREACH_ENV = Object.freeze(['ZEPTOMAIL_AUTH', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'EMAIL_CONTACT_LINE', 'EMAIL_DAILY_CAP', 'WHATSAPP_CHANNEL_URL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_DAILY_CAP']);
/** ctx.env: one of the settings above, or '' — whatever object the host keeps its environment in. */
export const envReader = (env) => (name) => (OUTREACH_ENV.includes(name) && typeof env?.[name] === 'string' ? env[name] : '');

/** The longest an outside request (ctx.fetch) may take, whatever its caller asked for. */
export const OUTBOUND_TIMEOUT_MS = 15000;
/**
 * ctx.fetch: an outside request is HTTPS, bounded in time whatever the caller passed, and never follows a redirect (a
 * provider that answers with one is treated as failed: the request must not be led to another host).
 * `refuseRedirect`: 'error' where the runtime's fetch refuses a redirect itself (Node); 'manual' where it cannot (the
 * Workers runtime has no redirect: 'error') — the redirect is then not followed and the answer is rejected here.
 */
export function outboundFetch(outbound, { refuseRedirect = 'error' } = {}) {
  return function fetchOutside(url, init = {}) {
    let target;
    try { target = new URL(String(url)); } catch { return Promise.reject(new TypeError('Invalid outbound URL')); }
    if (target.protocol !== 'https:') return Promise.reject(new TypeError('Outbound requests must use https'));
    const limit = AbortSignal.timeout(OUTBOUND_TIMEOUT_MS);
    const { signal, redirect, ...rest } = init && typeof init === 'object' ? init : {};
    const sent = outbound(target.href, { ...rest, redirect: refuseRedirect, signal: signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, limit]) : limit });
    if (refuseRedirect === 'error') return sent;
    return Promise.resolve(sent).then((response) => {
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) throw new TypeError('Outbound redirect refused');
      return response;
    });
  };
}

/** A session with nothing in it — no city, or only lives whose quick start was never confirmed — has no life to keep. */
export const hasLife = (session) => Object.values(session.cities || {}).some(entry => entry?.state && !(entry.state.onboarding?.required === true && entry.state.onboarding.done !== true));
/**
 * archiveSession(db, secret, session): a lived life is never destroyed — it moves to the archive without its secret.
 * A session that never created a life leaves nothing behind, so abandoned sign-ups cannot grow the data.
 */
export function sessionArchiver({ now, randomId }) {
  return function archiveSession(db, secret, session) {
    if (hasLife(session)) {
      db.archivedLives ||= {};
      const publicId = session.publicId || randomId();
      db.archivedLives[publicId] = archivedLife(session, publicId, now());
    }
    delete db.sessions[secret];
  };
}

/**
 * ctx.settle and ctx.act for a host, over its receipts (server/routes/once.js createOnce).
 * EVERY ctx.act must be safe to retry, and the host checks it rather than trusting the caller:
 *   - inside ctx.once(...) (or another ctx.act) the surrounding receipt covers it;
 *   - with `stateGuard: '<why a repeat cannot apply twice>'` the caller declares that stored state
 *     checked in the same transaction makes it once-only (a ballot entry, a queue it removes from);
 *   - otherwise `actionId` must be an action id (`<ms>:<uuid>`, normally the request's) and the life
 *     must come from ctx.settle: the same receipt steps as POST /api/action run, and a repeat
 *     returns { ok, code, state, duplicate: true } without running the action again.
 * Anything else throws, so a route cannot spend without a receipt by accident.
 */
export function lifeAuthority({ now, receipts }) {
  // Which stored session a settled life belongs to, so ctx.act can find that player's receipts.
  const ownerOf = new WeakMap();
  const settle = (session, city) => { const state = settleCity(session, city, now()); ownerOf.set(state, session); return state; };
  function act(state, body) {
    const { stateGuard, ...action } = body;
    const run = () => applyLifeAction(state, action, { now: now(), cityId: action.cityId, actionId: action.actionId, internal: true });
    if (receipts.active() || (typeof stateGuard === 'string' && stateGuard.trim().length >= 12)) return run();
    const session = ownerOf.get(state);
    if (!session || action.actionId === undefined) throw new Error(`ctx.act(${action.type}) has no receipt: call it inside ctx.once, pass the request's actionId, or state its stateGuard`);
    const result = receipts.action(session, action, run);
    return result.duplicate ? { ...result, state } : result;
  }
  /** What POST /api/action runs: a player's own request, with no server authority. */
  const playerAct = (state, body) => applyLifeAction(state, body, { now: now(), cityId: body.cityId, actionId: body.actionId });
  return { settle, act, playerAct };
}

/** Response headers a route may set. Anything else a module returns is dropped. */
const ROUTE_HEADERS = new Map([['set-cookie', 'Set-Cookie'], ['cache-control', 'Cache-Control'], ['retry-after', 'Retry-After']]);
export function routeHeaders(headers) {
  const kept = {};
  if (headers && typeof headers === 'object') for (const [name, value] of Object.entries(headers)) {
    const known = ROUTE_HEADERS.get(String(name).toLowerCase());
    if (known && (typeof value === 'string' || (Array.isArray(value) && value.every(item => typeof item === 'string')))) kept[known] = value;
  }
  return kept;
}

/**
 * The headers of every HTML page a module serves (ctx.pages). A page cannot change them: no script may run, nothing may
 * frame it, it sets no cookie and it sends no referrer.
 */
export const PAGE_HEADERS = Object.freeze({ 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });
/** The registered page whose prefix a path starts with: [prefix, render] or undefined. */
export const pageFor = (pages, pathname) => [...pages].find(([prefix]) => pathname.startsWith(prefix));
/** The public origin an operator may configure (PUBLIC_ORIGIN): scheme and host only, or ''. */
export const cleanOrigin = (value) => (typeof value === 'string' && /^https?:\/\/[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(value) ? value : '');
/** A request's own Host, accepted only if it is made of host characters (nothing a client sends in that header can put markup into a page). */
export const cleanHost = (value) => (/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(String(value || '')) ? String(value) : '');
/** index.html with its default preview image made absolute: only the two preview-image attributes, and only the site-relative /og/ path the build ships. */
export const absolutePreviewImage = (html, origin) => (origin ? html.replace(/(<meta (?:property="og:image"|name="twitter:image") content=")(\/og\/[A-Za-z0-9._-]+")/g, `$1${origin}$2`) : html);
/** The operator token must be something a Bearer header can carry: 24–512 printable ASCII characters without spaces. */
export const validOperatorToken = (token) => typeof token === 'string' && /^[\x21-\x7e]{24,512}$/.test(token);
/** The token of an `Authorization: Bearer …` header, or null. */
export const bearerToken = (header) => /^Bearer ([\x21-\x7e]{1,512})$/.exec(header || '')?.[1] ?? null;
