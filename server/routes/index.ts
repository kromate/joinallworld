/**
 * HTTP ROUTE REGISTRY — the contract for server/routes/*.js
 * ===========================================================================
 * OWNER: foundation. Feature owners edit only their own module (auth.ts, social.js,
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
 *           ...validate; then, exactly once per request id (see ctx.once below):
 *           return ctx.once(db, session, { id: requestId, kind: 'civic.plot', fingerprint: [cityId, plot] }, () => {
 *             ...change ctx.collection(db, 'civic'), spend via ctx.act(life, { type, payload, cityId })...
 *             return { ok: true, code: 'bought' };
 *           });
 *         });
 *         return { body: { state }, renew: true };
 *       },
 *     };
 *   }
 *
 * PATHS   must start with /api/<your area>/ (accounts → /api/account, social → /api/social/,
 *         civic → /api/civic/, support → /api/support/, companion → /api/companion/, moderation → /api/mod/, world → /api/world/, growth → /api/growth/ and,
 *         for its operator view, /api/mod/growth/; business → /api/business/ and /api/mod/business/). A ":name" segment captures into request.params. A duplicate
 *         "METHOD /path" aborts start-up.
 *
 * REQUEST (portable — no Node req/res, so the same module can run in the Worker later)
 *   request.method, request.path, request.params, request.query (URLSearchParams)
 *   request.json()                      → Promise<object>; rejects 415/413/400 (body ≤ 8 KB)
 *   request.session(db, { renew })      → the caller's device session record, or undefined
 *   request.requireSession(db, { renew }) → the session, or throws 401 device_session_required
 *   request.ip                          → the client address (see clientAddress in server.js: the socket's
 *                                         address, or with TRUST_PROXY=1 the right-most X-Forwarded-For
 *                                         entry). For ctx.allow keys and the vote cap only; never store it.
 *   request.moderator()                 → true only when the request carries the operator's bearer token.
 *                                         Used by routes/moderation.js; nothing else should need it.
 * Before your handler runs the host has already rejected cross-origin requests (403) — for every
 * path except /api/mod/, which authenticates with that bearer header instead — and applied the
 * per-address rate limit (429).
 *
 * RESPONSE   return { status = 200, body, headers?, renew?, after? }. The host JSON-encodes the body
 *   BEFORE it sends anything, adds `serverTime` to every success (and `storage: 'failing'` while
 *   the data file cannot be written), and with `renew: true` re-issues the sliding session
 *   cookie. To fail, `throw ctx.fail(status, 'machine_code')` → `{ "error": "machine_code" }`.
 *   An error that carries a string `reason` is answered `{ "error": code, "reason": sentence }`.
 *   A request is answered exactly once. A body that cannot be serialised, an invalid status or
 *   header, or anything else thrown becomes one generic 500 and a log line; it cannot take the
 *   server down. `headers` may only set Set-Cookie, Cache-Control and Retry-After. `after()` runs
 *   once the answer is out; if it throws, that is logged and nothing else happens.
 *
 * CONTEXT (ctx)
 *   ctx.store.transact(fn(db), { durable, committed, waitForObserved }?) → Promise
 *                                          serialised read-modify-write of the whole document;
 *                                          throw inside fn to abort without saving. By default it
 *                                          resolves only once the change is on disk. If the write
 *                                          fails it REJECTS with { status: 503, code: 'storage_unavailable' }
 *                                          and the change is undone: a rejected transaction changed
 *                                          nothing, so let that error reach the host. Update anything
 *                                          you keep in memory (an index) in `committed(result)`, which
 *                                          runs only once the change is in the file. Values a
 *                                          transaction returns may be stored objects and are frozen:
 *                                          copy before you change one. Pass
 *                                          { durable: false } — or a function of the result — ONLY for
 *                                          a request that acknowledges nothing a player could see as an
 *                                          outcome (see server/store.ts); such a change is written within
 *                                          a second instead. Another transaction may run between your
 *                                          commit and your `await` resuming: never keep per-request data
 *                                          in module-level variables across it.
 *   ctx.store.read(fn(db))     → Promise   read-only snapshot (changes made to it are discarded)
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
 *   ctx.act(state, { type, payload, cityId, actionId?, stateGuard? }) → { ok, code, state, reason? }
 *                                          run a game action server-side (inside transact). It runs
 *                                          with server authority: actions declared `serverOnly` in
 *                                          a game system succeed here and nowhere else. Name the
 *                                          `type` yourself — never forward one from a request.
 *                                          IT MUST BE RETRY-SAFE, and the host refuses it otherwise:
 *                                          call it inside ctx.once(…); or pass the request's `actionId`
 *                                          (`<ms>:<uuid>`) with a life from ctx.settle, which runs the
 *                                          same receipt steps as POST /api/action and answers a repeat
 *                                          with { ok, code, state, duplicate: true }; or pass
 *                                          `stateGuard: '<what stored state makes a repeat harmless>'`
 *                                          when your own collection, written in the same transaction,
 *                                          is the record (a ballot entry, a queue you remove from).
 *   ctx.command(request, { type, payload, cityId, actionId }, { internal?, scope?, afterAction? }?) → Promise<outcome>
 *                                          ONE game action for the caller, as a whole request: session
 *                                          check, settlement, action, receipt — in a single saved
 *                                          transaction. Call it directly from the handler, NEVER inside
 *                                          transact. A repeat of the action id returns the first outcome
 *                                          with duplicate: true; other contents, authority or scope → 409.
 *                                          For a server-only action name the type in server code and pass
 *                                          { internal: true } yourself. { scope: 'my.route', afterAction }
 *                                          runs afterAction({ db, session, result }) once, after a
 *                                          successful action and before the receipt: the counterparty or
 *                                          queue write that must be saved with the charge (throw → the
 *                                          charge, the receipt and everything else are discarded). It is
 *                                          synchronous and sends nothing. Never forward these options
 *                                          from request JSON. (routes/core.js executeCommand)
 *                                            return { body: await ctx.command(request,
 *                                              { actionId: body.actionId, cityId: body.cityId,
 *                                                type: 'my.fixed.action', payload: { amount: body.amount } },
 *                                              { internal: true }), renew: true };
 *   ctx.once(db, session, { id, kind, fingerprint }, run) → run()'s result, or the first result + duplicate: true
 *                                          exactly-once for any write that charges or creates something
 *                                          (inside transact). `id` is the client's `<ms>:<uuid>` request
 *                                          id and is mandatory: 400 without it, 409 for the same id with
 *                                          another kind or fingerprint, 409 once it is older than 24 h.
 *                                          run() must return a small JSON object; return { ok: false, … }
 *                                          for a refusal that changed nothing (no receipt is kept).
 *                                          Rules, quotas and what is not promised: server/routes/once.ts.
 *   ctx.onceId(id)                         → the id's time, or throws the same 400/409 (to refuse early)
 *   ctx.cityIds                            valid city ids
 *   ctx.publicSession(session)             → { id, name } — the ONLY identity you may expose
 *   ctx.push(publicId, message)            → number of open sockets the message was sent to
 *   ctx.online(publicId)                   → boolean
 *   ctx.atHome(db, publicId, cityId)       → boolean: that player's stored life is at Home (read-only)
 *   ctx.checks                             checks one module provides for another. The social module
 *                                          sets ctx.checks.homeGuest(db, guestId, hostId, cityId) →
 *                                          boolean; ws/rooms.js asks it before admitting a guest to a
 *                                          host's Home room and refuses everyone while it is absent.
 *                                          It also sets ctx.checks.blocked(a, b) → boolean (either has
 *                                          blocked the other; in memory). The moderation module sets
 *                                          ctx.checks.muted(publicId) → null | { code: 'muted', reason, until }.
 *                                          Ask both before delivering or storing player text.
 *   ctx.pages                              Map of path prefix → async ({ path, query, origin, ip }) => ({ status, html }): one small
 *                                          HTML page outside /api/ (the link-preview page /s/<code>). No script may run on it and it
 *                                          sets no cookie; `origin` is PUBLIC_ORIGIN or the request's own host. Absent on a host
 *                                          that does not serve pages (use ctx.pages?.set).
 *   ctx.env(name) / ctx.fetch / ctx.keyFile(name, make)   for the one module that reaches outside the game (server/growth/
 *                                          outreach.js): a fixed list of settings, an outside request, and a secret this server makes
 *                                          for itself and keeps in DATA_DIR/keys with mode 0600 (Node) or in the Durable Object's own storage (Worker). A page may also be POSTed to (`method`).
 *                                          ctx.env answers only for the names on its allowlist (host-context.js OUTREACH_ENV) and '' for everything
 *                                          else; ctx.fetch refuses anything but https, never follows a redirect and is cut off after 15 s whatever
 *                                          the caller asked. The host writes every page itself, with fixed headers: a page returns { status, html, cache? }.
 *   ctx.startup                            array of promises the host awaits before it takes requests
 *                                          (a module loading an in-memory index pushes its load here)
 *   ctx.closing                            array of async functions the host runs, in order, when it stops — before the world
 *                                          registry and the store are closed (a module that may be in the middle of sending
 *                                          something outside the game waits for it here). Absent on a host without it (use ctx.closing?.push).
 *   ctx.waitUntil?.(promise)               work that outlives the request that started it (a message being sent, a registry sync):
 *                                          a host that could stop between requests (the Worker) keeps itself up for it; Node does nothing.
 *   ctx.shards                             the world's shard store (server/world/shard-core.ts): one append-only log per local
 *                                          government — a file on Node (world/shards.js), SQLite rows on the Worker (deploy/sqlite-shards.ts) —
 *                                          used only through the world service (server/world/service.ts)
 *   ctx.randomId()                         a random UUID (for salts and ids; not a clock, not a secret store)
 *   ctx.on(event, fn) / ctx.emit(event, data)   in-process events between server modules. The
 *                                          foundation raises 'room-changed' { room, cityId, venueId,
 *                                          members: [publicId] } when a venue room's membership or
 *                                          a member's name changes. Nothing is sent to clients by it.
 *                                          The social module raises 'visit-ended' { hostId, guestId }
 *                                          when a house visit ends; ws/rooms.js then drops that guest
 *                                          from the host's Home room at once, and 'blocks-changed' { a, b }
 *                                          when a block or unblock was committed. The host raises
 *                                          'heartbeat' { now } on every beat; ws/rooms.js raises
 *                                          'guest-expired' { hostId, guestId, cityId } when a beat ends a visit.
 *   ctx.config                             { sessionTtlMs, actionWindowMs, maxActiveSessions, buildId,
 *                                            votesPerAddress, voteCapMode, heartbeatMs, moderation: boolean }
 *                                          (the operator token itself is not in the context)
 *   ctx.core                               foundation internals — not for feature modules
 *
 * RULES
 *   - Identify players by session.publicId only; session.secret is the cookie and must never
 *     be stored in your collection, logged or returned.
 *   - All game-state changes go through ctx.act (the rules engine); routes never edit a life.
 *   - Rooms: the host re-checks the caller's rooms against the stored lives after EVERY API request
 *     (ctx.core.revalidate(publicId), server.js), so a route needs no call of its own.
 *   - May import: ../protocol.js, ../../src/life.js, ../../src/game/** (pure). Must not import
 *     server.js, store.js, node:* modules or `ws` — keep modules portable.
 *
 * HOW TO TEST   (your pre-created server/<area>.test.js)
 *   import { fixture } from './test-fixture.ts';
 *   test('…', async t => {
 *     const f = await fixture(t);                 // real server on a random port, fake clock
 *     const ada = await f.device('Ada');          // { cookie, id, name }
 *     const res = await f.request('/api/civic/announcements', null, ada.cookie);   // GET
 *     const res2 = await f.request('/api/civic/x', { some: 'body' }, ada.cookie);  // POST
 *     f.advance(60000);                           // move server time
 *   });
 *   fixture(t, { routes: [myModule], wsModules: [myWs] }) replaces the registered modules.
 */
import type { RouteContext, RouteHandler, RouteModule, RouteTable } from '../types.ts';
import { banSentence } from '../admin/sanctions.ts';
import core from './core.ts';
import auth from './auth.ts';
import social from './social.ts';
import civic from './civic.ts';
import support from './support.ts';
import moderation from './moderation.ts';
import world from './world.ts';
import growth from './growth.ts';
import growthMod from './growth-mod.ts';
import campus from './campus.ts';
import pulse from './pulse.ts';
import ping from './ping.ts';
import visit from './visit.ts';
import business from './business.ts';
import businessMod from './business-mod.ts';
import notice from './notice.ts';
import residence from './residence.ts';
import companion from './companion.ts';
import admin from './admin.ts';
import bonus from './bonus.ts';
import storageMod from './storage-mod.ts';

export const ROUTE_MODULES: RouteModule[] = [core, auth, social, civic, support, moderation, world, growth, growthMod, campus, pulse, ping, visit, business, businessMod, notice, residence, companion, admin, bonus, storageMod];
const KEY = /^(GET|POST|PUT|PATCH|DELETE) (\/api\/[A-Za-z0-9\-_/:.]+)$/;

/**
 * A BANNED PLAYER (server/admin/sanctions.ts) is refused by EVERY route, from one place: the first time a request resolves a session that is
 * banned, it is answered 403 `account_banned` with a plain sentence. Only a path under /api/account/ (signing out) and the admin's own
 * paths are left alone. The check is a lookup in memory, so it costs a request nothing.
 */
function refusingBanned(ctx: RouteContext, path: string, handler: RouteHandler): RouteHandler {
  if (path.startsWith('/api/account') || path.startsWith('/api/admin/')) return handler;
  return (request) => {
    const resolve = request.session;
    request.session = (db, options) => {
      const found = resolve(db, options);
      const verdict = found ? ctx.checks?.banned?.(found.publicId, found.account) : null;
      if (verdict) throw Object.assign(ctx.fail(403, 'account_banned'), { reason: banSentence(verdict) });
      return found;
    };
    return handler(request);
  };
}

interface PatternRoute { key: string; method: string; segments: string[]; handler: RouteHandler }

/** Build the lookup. Returns { match(method, pathname) → { handler, params } | null, keys }. */
export function buildRoutes(ctx: RouteContext, modules: RouteModule[] = ROUTE_MODULES): RouteTable {
  const exact = new Map<string, RouteHandler>();
  const patterns: PatternRoute[] = [];
  for (const module of modules) {
    for (const [key, handler] of Object.entries(module(ctx) || {})) {
      const parsed = KEY.exec(key);
      if (!parsed || typeof handler !== 'function') throw new Error(`Invalid route: ${key}`);
      if (exact.has(key) || patterns.some(route => route.key === key)) throw new Error(`Duplicate route: ${key}`);
      const guarded = refusingBanned(ctx, parsed[2] ?? '', handler);
      if (!key.includes('/:')) { exact.set(key, guarded); continue; }
      patterns.push({ key, method: parsed[1] ?? '', segments: (parsed[2] ?? '').split('/'), handler: guarded });
    }
  }
  return {
    keys: [...exact.keys(), ...patterns.map(route => route.key)],
    match(method, pathname) {
      const handler = exact.get(`${method} ${pathname}`);
      if (handler) return { handler, params: {}, key: pathname };
      const parts = pathname.split('/');
      for (const route of patterns) {
        if (route.method !== method || route.segments.length !== parts.length) continue;
        const params: Record<string, string> = {};
        const hit = route.segments.every((segment, i) => {
          const part = parts[i] ?? '';
          if (!segment.startsWith(':')) return segment === part;
          try { params[segment.slice(1)] = decodeURIComponent(part); } catch { return false; }
          return part.length > 0;
        });
        if (hit) return { handler: route.handler, params, key: route.key.split(' ')[1] ?? '' };
      }
      return null;
    },
  };
}
