/**
 * OWNER: social
 * Ping endpoints under /api/social/ping. Thin adapters: every rule is in server/social/ping.ts (and src/game/ping.ts);
 * what leaves the game for a ping is server/growth/ping-mail.ts. The design is docs/COMEBACK-MAIL.md ("Ping").
 *
 * Every route requires the device session cookie, runs in one store transaction, is rate limited per public id with the
 * other social routes, and answers like them:
 *   { ok: true, code, … }                  done
 *   { ok: false, code, reason }            refused for a game reason (HTTP 200)
 *   HTTP 400/401/403/409/429 { error }     malformed, no session, a life still held for its look, client-id reuse, rate limited
 *
 *   GET  /api/social/ping                  the live pings waiting for the caller
 *   GET  /api/social/ping/:id              may the caller ping this player, and if not why; their own live ping to them and its link
 *   POST /api/social/ping        { to, clientId }     tell a friend "I am here". Exactly once per clientId.
 *   POST /api/social/ping/cancel { to }               take it back
 *   POST /api/social/ping/open   { token }            what a join link (/j/<token>) is, for the browser that opened it. Changes nothing.
 *   POST /api/social/ping/join   { from, clientId }   go to the friend who pinged. Exactly once per clientId.
 *
 * NOTHING ABOUT DELIVERY IS EVER ANSWERED. The e-mail and the notification a ping may cause are sent after the answer
 * (`after`), and the answer is the same with or without them.
 */
import { HTTP_PER_MINUTE } from './social.ts';
import { socialService, MATERIAL } from '../social/service.ts';
import { pingService } from '../social/ping.ts';
import { outreachService } from '../growth/outreach.ts';
import type { PingJob } from '../growth/ping-mail.ts';
import type { PingServerFrame } from '../../src/types/ping.ts';
import type { Db, RouteContext, RouteHandler, RouteKey, RouteRequest, SessionRecord } from '../types.ts';

export default function pingRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const social = socialService(ctx), ping = pingService(ctx), mailer = outreachService(ctx).pingMail;
  /** Authenticate, rate limit and run one service call in a transaction; what the social module owes beside it is delivered too. */
  async function run<R extends object>(request: RouteRequest, call: (db: Db, session: SessionRecord) => R): Promise<R> {
    const result = await ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true });
      if (!ctx.allow(`social:http:${session.publicId}`, HTTP_PER_MINUTE)) throw ctx.fail(429, 'rate_limited');
      return social.finish(db, call(db, session));
    }, { durable: (value) => request.method !== 'GET' || Reflect.get(value, MATERIAL) === true, waitForObserved: true, committed: (value) => social.committed(value) });
    return social.deliver(result) as R;
  }
  const tell = (push: readonly [string, PingServerFrame][]): void => { for (const [to, frame] of push) ctx.push(to, frame); };

  return {
    'GET /api/social/ping': async (request) => ({ body: await run(request, (db, session) => ping.list(db, session)), renew: true }),

    'GET /api/social/ping/:id': async (request) => {
      const answer = await run(request, (db, session) => ping.control(db, session, request.params.id));
      const mine = answer.control.live, id = request.publicId, to = String(request.params.id).toLowerCase();
      return { body: { ...answer, control: { ...answer.control, live: mine && id ? { ...mine, link: await ping.linkFor(id, to, mine.expiresAt) } : null } }, renew: true };
    },

    'POST /api/social/ping': async (request) => {
      const body = await request.json();
      let push: [string, PingServerFrame][] = [], job: PingJob | null = null;
      // The callback may run again on a fresh draft: what it hands out is taken from its last run.
      const answer = await run(request, (db, session) => { const done = ping.send(db, session, body); push = done.push; job = done.job; return done.result; });
      const id = request.publicId;
      if (!answer.ok || !id) return { body: answer, renew: true };
      const link = await ping.linkFor(id, answer.to.id, answer.expiresAt);
      tell(push);
      const owed = job as PingJob | null;
      return { body: { ...answer, link }, renew: true,
        // After the answer: the pinger never waits for, or learns about, anything that leaves the game.
        ...(owed ? { after: () => mailer.send({ ...(owed.mail ? { mail: { ...owed.mail, link } } : {}), ...(owed.push ? { push: { ...owed.push, link } } : {}) }) } : {}) };
    },

    'POST /api/social/ping/cancel': async (request) => {
      const body = await request.json();
      let push: [string, PingServerFrame][] = [];
      const answer = await run(request, (db, session) => { const done = ping.cancel(db, session, body); push = done.push; return done.result; });
      tell(push);
      return { body: answer, renew: true };
    },

    'POST /api/social/ping/open': async (request) => {
      const body = await request.json();
      // Counted per address before the signature is looked at: a link costs nothing to try, so trying is bounded.
      if (!ctx.allow(`ping:open:${request.ip}`, 30)) return { body: { ok: false, code: 'rate_limited', reason: 'Too many tries. Wait a minute.' } };
      const claim = await ping.readToken(body.token);
      const answer = await run(request, (db, session) => (claim ? ping.open(db, session, claim) : { ok: false as const, code: 'invalid_link' as const, reason: 'That link does not work any more.' }));
      return { body: answer, renew: true };
    },

    'POST /api/social/ping/join': async (request) => {
      const body = await request.json();
      let push: [string, PingServerFrame][] = [];
      const answer = await run(request, (db, session) => { const done = ping.join(db, session, body); push = done.push; return done.result; });
      tell(push);
      return { body: answer, renew: true };
    },
  };
}
