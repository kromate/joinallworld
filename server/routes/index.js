/**
 * HTTP ROUTE REGISTRY — the contract for server/routes/*.js
 * ===========================================================================
 * OWNER: foundation. Feature owners edit only their own module (auth.js, social.js,
 * civic.js); every module is already imported and registered here.
 *
 * A route module default-exports a function that receives the server context once at start-up
 * and returns its handlers keyed by "METHOD /path":
 *
 *   export default function civicRoutes(ctx) {
 *     return {
 *       'GET /api/civic/announcements': async (request) => {
 *         const items = await ctx.store.read(db => ctx.collection(db, 'civic').announcements ?? []);
 *         return { body: { items } };
 *       },
 *       'POST /api/civic/plots/:id/buy': async (request) => {
 *         const { cityId } = await request.json();
 *         const state = await ctx.store.transact(db => {
 *           const session = request.requireSession(db, { renew: true });
 *           const life = ctx.settle(session, cityId);
 *           ...validate, change ctx.collection(db, 'civic'), spend via ctx.act(life, { type, payload, cityId })...
 *           return life;
 *         });
 *         return { body: { state }, renew: true };
 *       },
 *     };
 *   }
 *
 * PATHS   must start with /api/<your area>/ (auth → /api/auth/, social → /api/social/,
 *         civic → /api/civic/). A ":name" segment captures into request.params. A duplicate
 *         "METHOD /path" aborts start-up.
 *
 * REQUEST (portable — no Node req/res, so the same module can run in the Worker later)
 *   request.method, request.path, request.params, request.query (URLSearchParams)
 *   request.json()                      → Promise<object>; rejects 415/413/400 (body ≤ 8 KB)
 *   request.session(db, { renew })      → the caller's device session record, or undefined
 *   request.requireSession(db, { renew }) → the session, or throws 401 device_session_required
 *   request.ip                          → remote address, for ctx.allow keys only
 * Before your handler runs the host has already rejected cross-origin requests (403) and
 * applied the per-address rate limit (429).
 *
 * RESPONSE   return { status = 200, body, headers?, renew? }. The host JSON-encodes the body,
 *   adds `serverTime` to every success, and with `renew: true` re-issues the sliding session
 *   cookie. To fail, `throw ctx.fail(status, 'machine_code')` → `{ "error": "machine_code" }`.
 *
 * CONTEXT (ctx)
 *   ctx.store.transact(fn(db)) → Promise   serialised read-modify-write of the whole document;
 *                                          throw inside fn to abort without saving
 *   ctx.store.read(fn(db))     → Promise   read-only snapshot
 *       This two-method interface is the entire storage contract: route modules must not
 *       assume a JSON file. Anything that offers transact/read over one JSON-like document
 *       (e.g. a Durable Object) can host them.
 *   ctx.collection(db, name, initial = {})  your namespaced top-level collection (db.accounts,
 *                                          db.social, db.civic), created on first use. Never
 *                                          touch db.sessions or another owner's collection.
 *   ctx.now()                              server time in ms — never call Date.now()
 *   ctx.fail(status, code)                 build an HTTP error to throw
 *   ctx.allow(key, count = 120, windowMs = 60000) → boolean   rate limiter
 *   ctx.settle(session, cityId)            → the session's life in that city, settled to now
 *   ctx.act(state, { type, payload, cityId, actionId? }) → { ok, code, state, reason? }
 *                                          run a game action server-side (inside transact)
 *   ctx.cityIds                            valid city ids
 *   ctx.publicSession(session)             → { id, name } — the ONLY identity you may expose
 *   ctx.push(publicId, message)            → number of open sockets the message was sent to
 *   ctx.online(publicId)                   → boolean
 *   ctx.config                             { sessionTtlMs, actionWindowMs, maxActiveSessions }
 *   ctx.core                               foundation internals — not for feature modules
 *
 * RULES
 *   - Identify players by session.publicId only; session.secret is the cookie and must never
 *     be stored in your collection, logged or returned.
 *   - All game-state changes go through ctx.act (the rules engine); routes never edit a life.
 *   - May import: ../protocol.js, ../../src/life.js, ../../src/game/** (pure). Must not import
 *     server.js, store.js, node:* modules or `ws` — keep modules portable.
 *
 * HOW TO TEST   (your pre-created server/<area>.test.js)
 *   import { fixture } from './test-fixture.js';
 *   test('…', async t => {
 *     const f = await fixture(t);                 // real server on a random port, fake clock
 *     const ada = await f.device('Ada');          // { cookie, id, name }
 *     const res = await f.request('/api/civic/announcements', null, ada.cookie);   // GET
 *     const res2 = await f.request('/api/civic/x', { some: 'body' }, ada.cookie);  // POST
 *     f.advance(60000);                           // move server time
 *   });
 *   fixture(t, { routes: [myModule], wsModules: [myWs] }) replaces the registered modules.
 */
import core from './core.js';
import auth from './auth.js';
import social from './social.js';
import civic from './civic.js';

export const ROUTE_MODULES = [core, auth, social, civic];
const KEY = /^(GET|POST|PUT|PATCH|DELETE) (\/api\/[A-Za-z0-9\-_/:.]+)$/;

/** Build the lookup. Returns { match(method, pathname) → { handler, params } | null, keys }. */
export function buildRoutes(ctx, modules = ROUTE_MODULES) {
  const exact = new Map();
  const patterns = [];
  for (const module of modules) {
    for (const [key, handler] of Object.entries(module(ctx) || {})) {
      const parsed = KEY.exec(key);
      if (!parsed || typeof handler !== 'function') throw new Error(`Invalid route: ${key}`);
      if (exact.has(key) || patterns.some(route => route.key === key)) throw new Error(`Duplicate route: ${key}`);
      if (!key.includes('/:')) { exact.set(key, handler); continue; }
      patterns.push({ key, method: parsed[1], segments: parsed[2].split('/'), handler });
    }
  }
  return {
    keys: [...exact.keys(), ...patterns.map(route => route.key)],
    match(method, pathname) {
      const handler = exact.get(`${method} ${pathname}`);
      if (handler) return { handler, params: {} };
      const parts = pathname.split('/');
      for (const route of patterns) {
        if (route.method !== method || route.segments.length !== parts.length) continue;
        const params = {};
        const hit = route.segments.every((segment, i) => {
          if (!segment.startsWith(':')) return segment === parts[i];
          try { params[segment.slice(1)] = decodeURIComponent(parts[i]); } catch { return false; }
          return parts[i].length > 0;
        });
        if (hit) return { handler: route.handler, params };
      }
      return null;
    },
  };
}
