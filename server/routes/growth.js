/**
 * OWNER: growth
 * Growth endpoints under /api/growth/ and the link-preview page /s/<code>. The operator's view
 * of the same data is ./growth-mod.js (under /api/mod/growth/, behind the operator token). Thin adapters: the rules live in server/growth/*.js and the pure
 * modules under src/game/ (share-model.js, digest.js, calendar.js). Everything stored is in
 * ctx.collection(db, 'growth') — see server/growth/data.js for its shape and every cap.
 *
 * Every /api/growth/ route is rate limited per public id (or per address without a session) on
 * top of the host's per-address limit, runs in one store transaction, and answers
 *   { ok: true, … }                       done
 *   { ok: false, code, reason }           refused for a game reason (HTTP 200, like /api/action)
 *   HTTP 400/401/429 { error: code }      malformed, no session, rate limited
 *
 *   POST /api/growth/hello          { cityId, device? }   the caller is here: what happened while away, referral
 *                                                         state (and what is due is paid), consent, the
 *                                                         digest preview, this week's events. Counted for metrics.
 *   POST /api/growth/share          { cityId, kind, event? }   make (or find again) a share link of the caller's own facts
 *   GET  /api/growth/share/:code                          what a link is about (no session needed): kind, the sharer's public id and name
 *   POST /api/growth/referral/link  { cityId, code, device }   attach the caller's new life to the owner of a share link
 *   POST /api/growth/consent        { age, push?: false, email?: false }   the age question; `false` switches a channel off and deletes what it stored
 *   POST /api/growth/email          { email, consent: true }   store a consented address and send its confirmation (adults only)
 *   POST /api/growth/email/remove   { cityId }                 delete the caller's address
 *   GET  /api/growth/push/key                                  the server's VAPID public key
 *   POST /api/growth/push/subscribe { cityId, subscription, consent: true }   store a browser's push subscription (adults only)
 *   POST /api/growth/push/unsubscribe { cityId, endpoint? }    delete one or all of the caller's subscriptions
 *   GET|POST /e/confirm?t=  ·  GET|POST /e/unsub?t=            the pages a link in an e-mail opens (signed token; POST does it)
 *   POST /api/growth/tables/claim   { cityId }            apply the caller's finished table games to their life, once each
 *   POST /api/growth/client         { signals: [name] }   a browser says something about itself from a fixed list (metrics only)
 *   GET  /s/<code>                                        the link-preview page (HTML, no script; see server/growth/share.js)
 *
 * WHAT PAYS. Nothing here credits a life except through ctx.act with a server-only action
 * (src/game/systems/growth.js), with the record that makes a repeat harmless written in the same
 * transaction. A share pays nothing. See server/growth/referral.js for the referral rules.
 */
import { viewLife } from '../../src/life.js';
import { lagosTime } from '../../src/game/clock.js';
import { upcomingEvents } from '../../src/game/calendar.js';
import { composeDigest } from '../../src/game/digest.js';
import { isShareCode } from '../../src/game/share-model.js';
import { growthOf, playerOf, sweep, LIMITS } from '../growth/data.js';
import { createShare, findShare, sharePageHtml } from '../growth/share.js';
import { referralService } from '../growth/referral.js';
import { CLIENT_SIGNALS, count, prune, touch } from '../growth/metrics.js';
import { outreachService } from '../growth/outreach.js';
import { tablesService } from '../growth/tables.js';
import { mailPage } from '../growth/email/templates.js';

const SESSION_GAP_MS = 30 * 60000;
const CITY_NAMES = { lagos: 'Lagos', ibadan: 'Ibadan' };
const AGES = ['adult', 'minor'];

const ready = (state) => Boolean(state) && !(state.onboarding?.required === true && state.onboarding.done !== true);
/** What the caller may see of their own consent. */
const consentView = (player) => (player?.consent ? { age: player.consent.age, push: player.consent.push === true, email: player.consent.email === true, at: player.consent.at } : null);

export default function growthRoutes(ctx) {
  const referral = referralService(ctx);
  const outreach = outreachService(ctx);
  const tables = tablesService(ctx);
  const city = (value) => { if (!ctx.cityIds.includes(value)) throw ctx.fail(400, 'invalid_city'); return value; };
  // THE AGE ANSWER LIVES HERE AND NOWHERE ELSE (growth.players[id].consent.age). Whoever needs it asks this check: e-mail
  // and push eligibility below, and analytics (server/telemetry/routes.js) — a player who said "under 18" gets none of them.
  (ctx.checks ??= {}).minor = (db, publicId) => typeof publicId === 'string' && ctx.collection(db, 'growth')?.players?.[publicId]?.consent?.age === 'minor';

  /** Authenticate, rate limit, find the caller's created life in the city (never creating one), and run `call`. */
  const route = (call, { durable = true } = {}) => async (request) => {
    const body = request.method === 'POST' ? await request.json() : {};
    const result = await ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true });
      if (!ctx.allow(`growth:http:${session.publicId}`, LIMITS.httpPerMinute)) throw ctx.fail(429, 'rate_limited');
      const cityId = city(body.cityId);
      // A life is never created here: someone who has not finished character creation is simply not ready.
      const stored = session.cities?.[cityId]?.state;
      if (!ready(stored)) return { ok: false, code: 'not_ready', reason: 'Finish creating your Sim first.' };
      const state = ctx.settle(session, cityId);
      if (!ready(state)) return { ok: false, code: 'not_ready', reason: 'Finish creating your Sim first.' };
      const g = growthOf(ctx, db);
      return call({ db, g, session, state, cityId, body, request });
    }, { durable: typeof durable === 'function' ? durable : () => durable, waitForObserved: true });
    const { material, ...answer } = result;
    return { body: answer, renew: true };
  };

  // The link-preview page. `ctx.pages` is the host's hook for a path outside /api/ (server.js); a host
  // without it (the Worker today) serves the game's own index.html for /s/<code> instead.
  ctx.pages?.set('/s/', async ({ path, origin, ip }) => {
    const code = path.slice(3).replace(/\/$/, '');
    if (!ctx.allow(`growth:page:${ip}`, LIMITS.sharePagePerMinute)) return { status: 429, html: sharePageHtml(null, '', origin) };
    if (!isShareCode(code)) return { status: 404, html: sharePageHtml(null, '', origin) };
    // Counting an opened link acknowledges nothing to anyone, so it does not wait for the disk.
    const share = await ctx.store.transact((db) => {
      const g = growthOf(ctx, db), found = findShare(g, code, ctx.now());
      if (!found) return null;
      found.opened = Math.min(Number.MAX_SAFE_INTEGER, (found.opened ?? 0) + 1);
      count(g, ctx.now(), 'share.opened');
      return { facts: found.facts, by: found.by };
    }, { durable: false }).catch(() => null);
    return { status: share ? 200 : 404, html: sharePageHtml(share, code, origin) };
  });

  // The pages a link in an e-mail opens. A GET only ever shows a button: mail scanners follow links, so nothing is
  // confirmed or removed until the button — or a mail program's one-click unsubscribe (RFC 8058) — POSTs.
  ctx.pages?.set('/e/', async ({ path, query, ip, method }) => {
    const value = query.get('t') ?? '', action = `${path}?t=${encodeURIComponent(value)}`;
    if (!ctx.allow(`growth:mail-page:${ip}`, 30)) return { status: 429, cache: false, html: mailPage({ title: 'Too many tries', text: 'Wait a minute and open the link again.' }) };
    if (path === '/e/confirm') {
      if (method !== 'POST') return { cache: false, html: mailPage({ title: 'Confirm your e-mail', text: 'Press the button to let Allworld e-mail you: at most one message a day and three a week.', button: 'Yes, e-mail me', action }) };
      const done = await outreach.confirmEmail(value);
      // One answer for every kind of bad link, so a link says nothing about who has an address here.
      return { status: done.ok ? 200 : 400, cache: false, html: mailPage(done.ok ? { title: 'You are in', text: 'Your e-mail is confirmed. You can switch it off any time in the game: Phone, Stay in touch.' } : { title: 'That link does not work', text: 'It may have expired or already been replaced. Ask for a new one in the game: Phone, Stay in touch.' }) };
    }
    if (path === '/e/unsub') {
      if (method !== 'POST') return { cache: false, html: mailPage({ title: 'Stop Allworld e-mails?', text: 'One tap and your address is deleted. Your game is not affected.', button: 'Unsubscribe', action }) };
      const done = await outreach.unsubscribe(value);
      return { status: done.ok ? 200 : 400, cache: false, html: mailPage(done.ok ? { title: 'You are unsubscribed', text: 'Your address has been deleted. Allworld will not e-mail you again.' } : { title: 'That link does not work', text: 'You can also stop e-mails in the game: Phone, Stay in touch.' }) };
    }
    return { status: 404, cache: false, html: mailPage({ title: 'Nothing here', text: 'That page does not exist.' }) };
  });

  return {
    'POST /api/growth/hello': route(({ g, session, state, cityId, body }) => {
      const now = ctx.now(), id = session.publicId;
      const player = playerOf(g, id);
      if (!player) return { ok: false, code: 'server_full', reason: 'This is not available right now. Try again later.' };
      sweep(g, now); prune(g, now);
      const hoursAway = player.seen ? Math.max(0, (now - player.seen) / 3600000) : 0;
      if (!player.seen || now - player.seen >= SESSION_GAP_MS) count(g, now, 'sessions');
      const since = player.seen || null;
      player.seen = now;
      if (body.device !== undefined) referral.noteDevice(g, player, body.device);
      touch(g, now, id, state);
      const material = referral.settle(g, session, state, cityId);
      const view = viewLife(state, { now, cityId });
      const events = upcomingEvents(now, 7, cityId).slice(0, 12);
      const refs = referral.view(g, id, view.growth);
      const digest = composeDigest({ name: session.name, city: CITY_NAMES[cityId] ?? cityId, missions: view.missions, events,
        referral: { counted: refs.counted, waiting: refs.waiting }, lines: (state.social?.notices ?? []).slice(-6).map((notice) => ({ text: notice.text, at: notice.at, group: 'sim' })) });
      const out = outreach.mine(g, id);
      return { ok: true, material, ...(material ? { state } : {}), channel: out.channel, contact: out, away: { hours: Math.round(hoursAway * 10) / 10, since }, referral: refs, consent: consentView(player), events,
        // What a weekly message would say. This build sends nothing outside the game: it is shown in the in-game inbox only.
        digest: { ...digest, delivery: 'dry-run' }, sharesLeft: Math.max(0, LIMITS.sharesPerDay - (player.shares.day === lagosTime(now).day ? player.shares.n : 0)) };
    }, { durable: (result) => result?.material === true }),

    'POST /api/growth/share': route(({ g, session, state, cityId, body }) => createShare(ctx, g, session, state, cityId, body)),

    'GET /api/growth/share/:code': async (request) => {
      if (!ctx.allow(`growth:share:${request.ip}`, 60)) throw ctx.fail(429, 'rate_limited');
      if (!isShareCode(request.params.code)) throw ctx.fail(400, 'invalid_share_code');
      const share = await ctx.store.read((db) => { const found = findShare(growthOf(ctx, db), request.params.code, ctx.now()); return found ? { kind: found.kind, by: found.by, facts: found.facts } : null; });
      if (!share) return { body: { ok: false, code: 'unknown_link', reason: 'That link has expired or does not exist.' } };
      return { body: { ok: true, kind: share.kind, by: { id: share.by, name: share.facts.name }, facts: share.facts } };
    },

    'POST /api/growth/referral/link': route(({ g, session, state, body, request }) => referral.link(g, session, state, body, request.ip)),

    'POST /api/growth/consent': route(({ g, session, body }) => {
      const now = ctx.now(), player = playerOf(g, session.publicId);
      if (!player) return { ok: false, code: 'server_full', reason: 'This is not available right now. Try again later.' };
      if (!AGES.includes(body.age)) throw ctx.fail(400, 'invalid_age');
      for (const key of ['push', 'email']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw ctx.fail(400, 'invalid_consent');
      // An age once given as under 18 is not raised by asking again on the same life.
      const age = player.consent?.age === 'minor' ? 'minor' : body.age;
      // Saying the age switches nothing on. A channel goes on only by its own step (confirming an address, granting a
      // notification); `false` here switches one off and deletes what was stored for it.
      if (age === 'minor' || body.email === false) outreach.dropContact(g, session.publicId, 'removed');
      if (age === 'minor' || body.push === false) outreach.unsubscribePush(g, session.publicId);
      // Under 18 also ends analytics for this player at once: the server forgets any Accept it held (the browser is told by its own page).
      if (age === 'minor') ctx.telemetry?.consent?.(session.publicId, false);
      if (age === 'minor' && (body.push === true || body.email === true)) {
        if (player.consent?.age !== 'minor') count(g, now, 'consent.minor');
        player.consent = { age, push: false, email: false, at: now };
        return { ok: false, code: 'under_18', reason: 'Messages outside the game are only for players who are 18 or older. Everything inside the game still works.', consent: consentView(player) };
      }
      if (!player.consent || player.consent.age !== age) count(g, now, `consent.${age}`);
      player.consent = { age, push: age === 'adult' && player.consent?.push === true, email: age === 'adult' && player.consent?.email === true, at: now };
      return { ok: true, code: 'saved', consent: consentView(player) };
    }),

    // Table games: apply the caller's finished games to their life (what a win pays, what counts for missions), once each.
    'POST /api/growth/tables/claim': route(({ g, session, state, cityId }) => ({ ...tables.claim(g, session, state, cityId), ratings: tables.ratings(g, session.publicId) }), { durable: (result) => result?.material === true }),
    // E-mail: store a consented address and send its confirmation (double opt-in). See server/growth/outreach.js.
    'POST /api/growth/email': async (request) => ({ body: await outreach.requestEmail(request, await request.json()), renew: true }),
    'POST /api/growth/email/remove': route(({ g, session }) => ({ ok: true, code: 'removed', removed: outreach.dropContact(g, session.publicId, 'removed') })),
    // Web push: the server's public key, then a subscription the browser made with it.
    'GET /api/growth/push/key': async (request) => {
      if (!ctx.allow(`growth:push-key:${request.ip}`, 30)) throw ctx.fail(429, 'rate_limited');
      return { body: { ok: true, publicKey: await outreach.publicKey() }, headers: { 'Cache-Control': 'no-store' } };
    },
    'POST /api/growth/push/subscribe': route(({ g, session, body }) => outreach.subscribe(g, session, body)),
    'POST /api/growth/push/unsubscribe': route(({ g, session, body }) => outreach.unsubscribePush(g, session.publicId, body.endpoint)),

    'POST /api/growth/client': async (request) => {
      const body = await request.json();
      if (!ctx.allow(`growth:client:${request.ip}`, 10)) throw ctx.fail(429, 'rate_limited');
      const signals = [...new Set(Array.isArray(body.signals) ? body.signals.slice(0, 8) : [])].filter((name) => CLIENT_SIGNALS.includes(name));
      if (signals.length) await ctx.store.transact((db) => { const g = growthOf(ctx, db); for (const name of signals) count(g, ctx.now(), `client.${name}`); }, { durable: false });
      return { body: { ok: true, counted: signals.length } };
    },

  };
}
