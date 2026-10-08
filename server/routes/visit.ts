/**
 * OWNER: social
 * Visiting a home, under /api/social/visit. Thin adapters: every rule is in server/social/visit.ts (numbers and words:
 * src/game/visit.ts). The house link is `/h/<token>` (server/social/visit-token.ts); opening it signs nobody in.
 *
 *   GET  /api/social/visit/door                the caller's own door: { who, out, chosen }
 *   POST /api/social/visit/door     { who?, out? }   choose who may come in (walk | knock | invited | nobody), and whether friends may visit while out
 *   POST /api/social/visit/close    { closed }       close or reopen the door: nobody new comes in; the guests inside stay
 *   POST /api/social/visit/end                       ask everyone inside to leave
 *   POST /api/social/visit/enter    { host }         Visit home: use an invitation, walk in, or knock, as the host's door says
 *   POST /api/social/visit/invite   { to: [id] }     invite friends over (each is good for 30 minutes)
 *   POST /api/social/visit/link     { hours?, max?, open? }   make a house link
 *   GET  /api/social/visit/links                     the caller's links, with how many came in through each
 *   POST /api/social/visit/link/end { id }           end a link at once
 *   POST /api/social/visit/peek     { token }        what a link is, for a browser with no session: works or not, and the host's display name
 *   POST /api/social/visit/link/enter { token }      come in through a link, as the signed-in caller
 *
 * Every route but peek needs the device session, is rate limited per public id with the other social routes and runs in one
 * store transaction. Answers are { ok: true, code, … } or { ok: false, code, reason } (HTTP 200); malformed is 400.
 * `peek` and `link/enter` are also counted per address, before the signature is looked at.
 */
import { HTTP_PER_MINUTE } from './social.ts';
import { socialService, MATERIAL } from '../social/service.ts';
import { visitService } from '../social/visit.ts';
import { VISIT } from '../../src/game/visit.ts';
import { worldOf } from '../world/service.ts';
import { readPlot } from '../world/street.ts';
import { UUID_PATTERN } from '../protocol.ts';
import type { Db, HouseLinkRecord, RouteContext, RouteHandler, RouteKey, RouteRequest, SessionRecord } from '../types.ts';

export default function visitRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const social = socialService(ctx), visit = visitService(ctx), { tokens } = visit;
  async function run<R extends object>(request: RouteRequest, call: (db: Db, session: SessionRecord) => R): Promise<R> {
    const result = await ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true });
      if (!ctx.allow(`social:http:${session.publicId}`, HTTP_PER_MINUTE)) throw ctx.fail(429, 'rate_limited');
      return social.finish(db, call(db, session));
    }, { durable: (value) => request.method !== 'GET' || Reflect.get(value, MATERIAL) === true, waitForObserved: true, committed: (value) => social.committed(value) });
    return social.deliver(result) as R;
  }
  /** A link as the host sees it: what is stored, and the path to send. */
  const shown = async (link: HouseLinkRecord) => ({ id: link.id, path: await tokens.sign(link.host, link.id, link.expires), at: link.at, expiresAt: link.expires, uses: Object.keys(link.members).length, ...(link.max !== undefined ? { max: link.max } : {}), open: link.open === true, ended: link.ended === true });
  const alone = (request: RouteRequest, key: string): void => { if (!ctx.allow(`${key}:${request.ip}`, VISIT.perAddressPerMinute)) throw ctx.fail(429, 'rate_limited'); };

  return {
    'POST /api/social/visit/plot/enter': async (request) => {
      const body = await request.json(), city = ctx.cityIds.find(id => id === body.city);
      await ctx.store.read(db => request.requireSession(db));
      if (!city) throw ctx.fail(400, 'invalid_city');
      const plot = readPlot(body.plot, city);
      if (!plot) throw ctx.fail(400, 'invalid_plot');
      if (typeof body.host !== 'string' || !UUID_PATTERN.test(body.host)) throw ctx.fail(400, 'invalid_player');
      const world = worldOf(ctx);
      if (!world.enabled) throw ctx.fail(503, 'world_unavailable');
      const owns = await world.ownsPlot(city, plot, body.host.toLowerCase());
      return { body: await run(request, (db, session) => owns ? visit.enterPlot(db, session, body) : { ok: false, code: 'door_unavailable', reason: 'That door is no longer available. Refresh the street.' }), renew: true };
    },
    'GET /api/social/visit/home': async (request) => ({ body: await run(request, (db, session) => visit.homeProjection(db, session, request.query.get('host'))), renew: true }),
    'POST /api/social/visit/capture-consent': async (request) => { const body = await request.json(); return { body: await run(request, (db, session) => visit.captureConsent(db, session, body)), renew: true }; },
    'GET /api/social/visit/door': async (request) => ({ body: await run(request, (db, session) => visit.door(db, session)), renew: true }),
    'POST /api/social/visit/door': async (request) => { const body = await request.json(); return { body: await run(request, (db, session) => visit.setDoor(db, session, body)), renew: true }; },
    'POST /api/social/visit/close': async (request) => { const body = await request.json(); return { body: await run(request, (db, session) => visit.closeDoor(db, session, body)), renew: true }; },
    'POST /api/social/visit/end': async (request) => ({ body: await run(request, (db, session) => visit.endVisit(db, session)), renew: true }),
    'POST /api/social/visit/enter': async (request) => { const body = await request.json(); return { body: await run(request, (db, session) => visit.enter(db, session, body)), renew: true }; },
    'POST /api/social/visit/invite': async (request) => { const body = await request.json(); return { body: await run(request, (db, session) => visit.invite(db, session, body)), renew: true }; },

    'POST /api/social/visit/link': async (request) => {
      const body = await request.json();
      const answer = await run(request, (db, session) => visit.linkMake(db, session, body));
      return { body: answer.ok ? { ok: true, code: answer.code, link: await shown(answer.link) } : answer, renew: true };
    },
    'GET /api/social/visit/links': async (request) => {
      const answer = await run(request, (db, session) => visit.links(db, session));
      return { body: { ok: true, code: 'ok', links: await Promise.all(answer.links.map(shown)) }, renew: true };
    },
    'POST /api/social/visit/link/end': async (request) => {
      const body = await request.json();
      const answer = await run(request, (db, session) => visit.linkEnd(db, session, body));
      return { body: answer.ok ? { ok: true, code: answer.code, link: await shown(answer.link), ...('duplicate' in answer ? { duplicate: true } : {}) } : answer, renew: true };
    },

    // No session: a person who has not played yet opens a link and is told whose home it is (the display name, nothing else).
    'POST /api/social/visit/peek': async (request) => {
      const body = await request.json();
      alone(request, 'visit:peek');
      const claim = await tokens.read(body.token, ctx.now());
      return { body: await ctx.store.read((db) => visit.peek(db, claim)) };
    },
    'POST /api/social/visit/link/enter': async (request) => {
      const body = await request.json();
      alone(request, 'visit:enter');
      const claim = await tokens.read(body.token, ctx.now());
      return { body: await run(request, (db, session) => visit.linkEnter(db, session, claim)), renew: true };
    },
  };
}
