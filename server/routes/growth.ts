/**
 * OWNER: growth
 * Growth endpoints under /api/growth/ and the link-preview page /s/<code>. The operator's view
 * of the same data is ./growth-mod.js (under /api/mod/growth/, behind the operator token). Thin adapters: the rules live in server/growth/*.js and the pure
 * modules under src/game/ (share-model.js, digest.js, calendar.js). Everything stored is in
 * ctx.collection(db, 'growth') — see server/growth/data.ts for its shape and every cap.
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
 *   POST /api/growth/comeback       { cityId, on?, types?, pause? }   the caller's choices about e-mails on their character (docs/COMEBACK-MAIL.md)
 *   POST /api/growth/nudge          { cityId, to }             ask an away friend to come back (friends only, once a week per friend)
 *   GET  /api/growth/push/key                                  the server's VAPID public key
 *   POST /api/growth/push/subscribe { cityId, subscription, consent: true }   store a browser's push subscription (adults only)
 *   POST /api/growth/push/unsubscribe { cityId, endpoint? }    delete one or all of the caller's subscriptions
 *   GET|POST /e/confirm?t=  ·  GET|POST /e/unsub?t=            the pages a link in an e-mail opens (signed token; POST does it)
 *   POST /api/growth/tables/claim   { cityId }            apply the caller's finished table games to their life, once each

 *   POST /api/growth/oro/state      { cityId }            the daily word puzzle: today's number, the caller's guesses with their marks, stats; the answer only once finished
 *   POST /api/growth/oro/guess      { cityId, no, n, word, hard? }   one guess (see server/growth/oro.ts); finishing writes the result once
 *   POST /api/growth/client         { signals: [name] }   a browser says something about itself from a fixed list (metrics only)
 *   GET  /s/<code>                                        the link-preview page (HTML, no script; see server/growth/share.ts)
 *
 * WHAT PAYS. Nothing here credits a life except through ctx.act with a server-only action
 * (src/game/systems/growth.ts), with the record that makes a repeat harmless written in the same
 * transaction. A share pays nothing. See server/growth/referral.ts for the referral rules.
 */
import { viewLife } from '../../src/life.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { upcomingEvents } from '../../src/game/calendar.ts';
import { cityRules } from '../../src/game/cities/index.ts';
import { composeDigest } from '../../src/game/digest.ts';
import { isShareCode } from '../../src/game/share-model.ts';
import { growthOf, playerOf, sweep, LIMITS } from '../growth/data.ts';
import { createShare, findShare, sharePageHtml } from '../growth/share.ts';
import { bonusConfig, claimedOf, publicOffer } from '../bonus/service.ts';
import { referralService } from '../growth/referral.ts';
import { CLIENT_SIGNALS, count, prune, touch } from '../growth/metrics.ts';
import { outreachService } from '../growth/outreach.ts';
import { tablesService } from '../growth/tables.ts';
import { oroService } from '../growth/oro.ts';
import { mailPage } from '../growth/email/templates.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { ConsentView } from '../../src/types/growth.ts';
import type { ComebackType } from '../../src/game/comeback.ts';
import type { Db, GrowthCollection, GrowthPlayerRecord, RouteContext, RouteHandler, RouteKey, RouteRequest, SessionRecord } from '../types.ts';

/** What a growth route's `call` hands back: the JSON answer, and `material` (kept out of the answer) when the life changed. */
type GrowthAnswer = { material?: boolean } & Record<string, unknown>;
interface GrowthCall { db: Db; g: GrowthCollection; session: SessionRecord; state: LifeState; cityId: CityId; body: Record<string, unknown>; request: RouteRequest }

const SESSION_GAP_MS = 30 * 60000;
const AGES: readonly ConsentView['age'][] = ['adult', 'minor'];
/** What a comeback mail's "stop these" page calls each kind. */
const KINDS: Readonly<Record<ComebackType, string>> = { waiting: 'e-mails about your friends', nudge: 'e-mails about your friends', need: 'e-mails about your character’s needs', milestone: 'milestone e-mails', event: 'event e-mails', away: 'e-mails for when you have been away', week: 'the weekly digest', ping: 'e-mails about your friends' };

const ready = (state: LifeState | null | undefined): boolean => Boolean(state) && !(state?.onboarding?.required === true && state.onboarding.done !== true);
/** What the caller may see of their own consent. */
const consentView = (player: GrowthPlayerRecord | null | undefined): ConsentView | null => (player?.consent ? { age: player.consent.age, push: player.consent.push === true, email: player.consent.email === true, at: player.consent.at } : null);

export default function growthRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const referral = referralService(ctx);
  const outreach = outreachService(ctx);
  const tables = tablesService(ctx);
  const oro = oroService(ctx.randomId);
  const city = (value: unknown): CityId => { const known = ctx.cityIds.find((id) => id === value); if (known === undefined) throw ctx.fail(400, 'invalid_city'); return known; };
  // THE AGE ANSWER LIVES HERE AND NOWHERE ELSE (growth.players[id].consent.age). Whoever needs it asks this check: e-mail
  // and push eligibility below, and analytics (server/telemetry/routes.ts) — a player who said "under 18" gets none of them.
  (ctx.checks ??= {}).minor = (db: Db, publicId: string): boolean => typeof publicId === 'string' && ctx.collection(db, 'growth')?.players?.[publicId]?.consent?.age === 'minor';

  /** Authenticate, rate limit, find the caller's created life in the city (never creating one), and run `call`. */
  const route = (call: (args: GrowthCall) => GrowthAnswer, { durable = true }: { durable?: boolean | ((result: GrowthAnswer) => boolean) } = {}): RouteHandler => async (request) => {
    const body: Record<string, unknown> = request.method === 'POST' ? await request.json() : {};
    const result = await ctx.store.transact((db): GrowthAnswer => {
      const session = request.requireSession(db, { renew: true });
      if (!ctx.allow(`growth:http:${session.publicId}`, LIMITS.httpPerMinute)) throw ctx.fail(429, 'rate_limited');
      const cityId = city(body.cityId);
      // A life is never created here: someone who has not finished character creation is simply not ready.
      const stored = session.cities?.[cityId]?.state;
      if (!ready(stored)) return { ok: false, code: 'not_ready', reason: 'Finish creating your character first.' };
      const state = ctx.settle(session, cityId);
      if (!ready(state)) return { ok: false, code: 'not_ready', reason: 'Finish creating your character first.' };
      const g = growthOf(ctx, db);
      return call({ db, g, session, state, cityId, body, request });
    }, { durable: typeof durable === 'function' ? durable : () => durable, waitForObserved: true });
    const { material, ...answer } = result;
    return { body: answer, renew: true };
  };

  // The link-preview page. `ctx.pages` is the host's hook for a path outside /api/ (server.js); a host
  // without it (the Worker today) serves the game's own index.html for /s/<code> instead.
  ctx.pages?.set('/s/', async ({ path, origin, ip, method }) => {
    const code = path.slice(3).replace(/\/$/, '');
    if (!ctx.allow(`growth:page:${ip}`, LIMITS.sharePagePerMinute)) return { status: 429, html: sharePageHtml(null, '', origin) };
    if (!isShareCode(code)) return { status: 404, html: sharePageHtml(null, '', origin) };
    // Counting an opened link acknowledges nothing to anyone, so it does not wait for the disk.
    const share = await ctx.store.transact((db) => {
      const g = growthOf(ctx, db), found = findShare(g, code, ctx.now());
      if (!found) return null;
      // A HEAD (a crawler checking the link before it fetches it) is not an opening: only a GET is counted, once.
      if (method !== 'GET') return { facts: found.facts, by: found.by };
      found.opened = Math.min(Number.MAX_SAFE_INTEGER, (found.opened ?? 0) + 1);
      count(g, ctx.now(), found.cityId ?? 'lagos', 'share.opened');
      return { facts: found.facts, by: found.by };
    }, { durable: false }).catch(() => null);
    // While the launch offer is open the preview says so (server/bonus/service.ts).
    const offer = share ? publicOffer(bonusConfig(ctx), await ctx.store.read((db) => claimedOf(db)).catch(() => 0)) : null;
    return { status: share ? 200 : 404, html: sharePageHtml(share, code, origin, offer) };
  });

  // The pages a link in an e-mail opens. A GET only ever shows a button: mail scanners follow links, so nothing is
  // confirmed or removed until the button — or a mail program's one-click unsubscribe (RFC 8058) — POSTs.
  ctx.pages?.set('/e/', async ({ path, query, ip, method }) => {
    const value = query.get('t') ?? '', action = `${path}?t=${encodeURIComponent(value)}`;
    if (!ctx.allow(`growth:mail-page:${ip}`, 30)) return { status: 429, cache: false, html: mailPage({ title: 'Too many tries', text: 'Wait a minute and open the link again.' }) };
    if (path === '/e/confirm') {
      if (method !== 'POST') return { cache: false, html: mailPage({ title: 'Confirm your e-mail', text: 'Press the button to let Allworld e-mail you. We’ll send you a few e-mails a week at most about your character, and a note when a friend pings you to join them. Change this any time.', button: 'Yes, e-mail me', action }) };
      const done = await outreach.confirmEmail(value);
      // One answer for every kind of bad link, so a link says nothing about who has an address here.
      return { status: done.ok ? 200 : 400, cache: false, html: mailPage(done.ok ? { title: 'You are in', text: 'Your e-mail is confirmed. We’ll send you a few e-mails a week at most about your character. Change this any time in the game: Phone, Stay in touch.' } : { title: 'That link does not work', text: 'It may have expired or already been replaced. Ask for a new one in the game: Phone, Stay in touch.' }) };
    }
    if (path === '/e/unsub') {
      if (method !== 'POST') {
        const scope = await outreach.unsubscribeScope(value);
        return { cache: false, html: mailPage(scope === null || scope === 'all'
          ? { title: 'Stop Allworld e-mails?', text: 'One tap and your address is deleted. Your game is not affected.', button: 'Unsubscribe', action }
          : { title: 'Stop these e-mails?', text: `You will not get ${KINDS[scope]} any more. Everything else stays as you set it, and your game is not affected.`, button: 'Stop these', action }) };
      }
      const done = await outreach.unsubscribe(value);
      const stopped = done.scope !== undefined && done.scope !== 'all';
      return { status: done.ok ? 200 : 400, cache: false, html: mailPage(done.ok
        ? (stopped ? { title: 'Done', text: 'You will not get those e-mails any more. You can change this any time in the game: Phone, Stay in touch.' } : { title: 'You are unsubscribed', text: 'Your address has been deleted. Allworld will not e-mail you again.' })
        : { title: 'That link does not work', text: 'You can also stop e-mails in the game: Phone, Stay in touch.' }) };
    }
    return { status: 404, cache: false, html: mailPage({ title: 'Nothing here', text: 'That page does not exist.' }) };
  });

  return {
    'POST /api/growth/hello': route(({ db, g, session, state, cityId, body }) => {
      const now = ctx.now(), id = session.publicId;
      // The hourly sweep runs before this player's record is made or read: a record made now has `seen: 0` until the end of this call and would be swept as idle.
      sweep(g, now); prune(g, now);
      const player = playerOf(g, id);
      if (!player) return { ok: false, code: 'server_full', reason: 'This is not available right now. Try again later.' };
      const hoursAway = player.seen ? Math.max(0, (now - player.seen) / 3600000) : 0;
      if (!player.seen || now - player.seen >= SESSION_GAP_MS) count(g, now, cityId, 'sessions');
      const since = player.seen || null;
      player.seen = now;
      outreach.comeback.onVisit(db, g, id, now, session);
      if (body.device !== undefined) referral.noteDevice(g, player, body.device);
      touch(g, now, id, state, since);
      const material = referral.settle(g, session, state, cityId);
      const actualCity = state.estate.city;
      const view = viewLife(state, { now, cityId: actualCity });
      const events = upcomingEvents(now, 7, actualCity).slice(0, 12);
      const refs = referral.view(g, id, view.growth);
      const digest = composeDigest({ name: session.name, city: cityRules(actualCity)?.name ?? actualCity, missions: view.missions, events,
        referral: { counted: refs.counted, waiting: refs.waiting }, lines: (state.social?.notices ?? []).slice(-6).map((notice) => ({ text: notice.text, at: notice.at, group: 'sim' })) });
      const out = outreach.mine(db, g, id, session);
      return { ok: true, material, ...(material ? { state } : {}), channel: out.channel, contact: out, away: { hours: Math.round(hoursAway * 10) / 10, since }, referral: refs, consent: consentView(player), events,
        // What a weekly message would say. This build sends nothing outside the game: it is shown in the in-game inbox only.
        digest: { ...digest, delivery: 'dry-run' }, sharesLeft: Math.max(0, LIMITS.sharesPerDay - (player.shares.day === lagosTime(now).day ? player.shares.n : 0)) };
    }, { durable: (result) => result?.material === true }),

    'POST /api/growth/share': route(({ g, session, state, cityId, body }) => createShare(ctx, g, session, state, cityId, body)),

    'GET /api/growth/share/:code': async (request) => {
      if (!ctx.allow(`growth:share:${request.ip}`, 60)) throw ctx.fail(429, 'rate_limited');
      const code = request.params.code;
      if (code === undefined || !isShareCode(code)) throw ctx.fail(400, 'invalid_share_code');
      const share = await ctx.store.read((db) => { const found = findShare(growthOf(ctx, db), code, ctx.now()); return found ? { kind: found.kind, by: found.by, facts: found.facts } : null; });
      if (!share) return { body: { ok: false, code: 'unknown_link', reason: 'That link has expired or does not exist.' } };
      return { body: { ok: true, kind: share.kind, by: { id: share.by, name: share.facts.name }, facts: share.facts } };
    },

    'POST /api/growth/referral/link': route(({ g, session, state, cityId, body, request }) => referral.link(g, session, state, cityId, body, request.ip)),

    'POST /api/growth/consent': route(({ g, session, cityId, body }) => {
      const now = ctx.now(), player = playerOf(g, session.publicId);
      if (!player) return { ok: false, code: 'server_full', reason: 'This is not available right now. Try again later.' };
      const answered = AGES.find((item) => item === body.age);
      if (answered === undefined) throw ctx.fail(400, 'invalid_age');
      for (const key of ['push', 'email']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw ctx.fail(400, 'invalid_consent');
      // An age once given as under 18 is not raised by asking again on the same life.
      const age = player.consent?.age === 'minor' ? 'minor' : answered;
      // Saying the age switches nothing on. A channel goes on only by its own step (confirming an address, granting a
      // notification); `false` here switches one off and deletes what was stored for it.
      if (age === 'minor' || body.email === false) outreach.dropContact(g, session.publicId, 'removed');
      if (age === 'minor' || body.push === false) outreach.unsubscribePush(g, session.publicId, undefined);
      // Under 18 also ends analytics for this player at once: the server forgets any Accept it held (the browser is told by its own page).
      if (age === 'minor') ctx.telemetry?.consent?.(session.publicId, false);
      if (age === 'minor' && (body.push === true || body.email === true)) {
        if (player.consent?.age !== 'minor') count(g, now, cityId, 'consent.minor');
        player.consent = { age, push: false, email: false, at: now };
        return { ok: false, code: 'under_18', reason: 'Messages outside the game are only for players who are 18 or older. Everything inside the game still works.', consent: consentView(player) };
      }
      if (!player.consent || player.consent.age !== age) count(g, now, cityId, `consent.${age}`);
      player.consent = { age, push: age === 'adult' && player.consent?.push === true, email: age === 'adult' && player.consent?.email === true, at: now };
      return { ok: true, code: 'saved', consent: consentView(player) };
    }),

    // Table games: apply the caller's finished games to their life (what a win pays, what counts for missions), once each.
    'POST /api/growth/tables/claim': route(({ g, session, state, cityId }) => ({ ...tables.claim(g, session, state, cityId), ratings: tables.ratings(g, session.publicId, cityId) }), { durable: (result) => result?.material === true }),
    // Oro, the daily word: reading it writes nothing; a guess writes only when it finishes the puzzle.
    'POST /api/growth/oro/state': route(({ g, session }) => oro.state(g, g.players[session.publicId] ?? null, session.publicId, ctx.now()), { durable: false }),
    'POST /api/growth/oro/guess': route(({ g, session, cityId, body }) => {
      if (!ctx.allow(`oro:${session.publicId}`, 40)) return { ok: false, code: 'rate_limited', reason: 'You are guessing too quickly. Wait a moment.' };
      return oro.guess(g, session.publicId, ctx.now(), cityId, body, () => playerOf(g, session.publicId));
    }, { durable: (result) => result?.finished === true }),
    // E-mail: store a consented address and send its confirmation (double opt-in). See server/growth/outreach.ts.
    'POST /api/growth/email': async (request) => ({ body: await outreach.requestEmail(request, await request.json()), renew: true }),
    'POST /api/growth/comeback': route(({ db, g, session, body }) => outreach.comeback.setPrefs(db, g, session.publicId, body, session)),
    'POST /api/growth/nudge': route(({ db, g, session, body }) => outreach.comeback.nudge(db, g, session, body)),
    'POST /api/growth/email/remove': route(({ g, session }) => ({ ok: true, code: 'removed', removed: outreach.dropContact(g, session.publicId, 'removed') })),
    // Web push: the server's public key, then a subscription the browser made with it.
    'GET /api/growth/push/key': async (request) => {
      if (!ctx.allow(`growth:push-key:${request.ip}`, 30)) throw ctx.fail(429, 'rate_limited');
      return { body: { ok: true, publicKey: await outreach.publicKey() }, headers: { 'Cache-Control': 'no-store' } };
    },
    'POST /api/growth/push/subscribe': route(({ g, session, body }) => outreach.subscribe(g, session, body)),
    // A test notification to the caller's own subscribed browsers (three an hour): it shows the player what a message will look like.
    'POST /api/growth/push/test': async (request) => {
      const id = await ctx.store.read((db) => request.requireSession(db).publicId);
      if (!ctx.allow(`growth:push-test:${id}`, 3, 3600000)) return { body: { ok: false, code: 'rate_limited', reason: 'A few test notifications an hour are enough. Try again later.' } };
      const subs = await ctx.store.read((db) => outreach.pushSubsOf(growthOf(ctx, db), id).map((sub) => ({ ...sub })));
      if (!subs.length) return { body: { ok: false, code: 'no_devices', reason: 'Notifications are not switched on for this phone. Turn them on first.' } };
      const results = await outreach.deliverChatPush(id, subs, { title: 'Allworld', body: 'This is a test. Messages from your friends will look like this.', url: '/', tag: 'test', kind: 'test' }, 'test');
      return { body: { ok: true, code: 'sent', devices: results.filter((result) => result.ok).length } };
    },
    'POST /api/growth/push/unsubscribe': route(({ g, session, body }) => outreach.unsubscribePush(g, session.publicId, body.endpoint)),

    'POST /api/growth/client': async (request) => {
      const body = await request.json();
      if (!ctx.allow(`growth:client:${request.ip}`, 10)) throw ctx.fail(429, 'rate_limited');
      const named: unknown[] = Array.isArray(body.signals) ? body.signals.slice(0, 8) : [];
      const signals = [...new Set(named)].filter((name): name is string => typeof name === 'string' && CLIENT_SIGNALS.includes(name));
      // Browser capability signals have no city authority. Keep them in the legacy/global bucket;
      // never accept a client-supplied city merely to add a dimension.
      if (signals.length) await ctx.store.transact((db) => { const g = growthOf(ctx, db); for (const name of signals) count(g, ctx.now(), `client.${name}`); }, { durable: false });
      return { body: { ok: true, counted: signals.length } };
    },

  };
}
