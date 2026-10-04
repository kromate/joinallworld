/**
 * OWNER: social
 * Social endpoints under /api/social/. Thin adapters: every rule lives in
 * server/social/service.ts (shared with the socket messages in server/ws/social.ts) and stores
 * only in ctx.collection(db, 'social').
 *
 * Every route requires the device session cookie, runs in one store transaction, is rate
 * limited per public id on top of the host's per-address limit, and answers
 *   (interact, groups and transfers need `clientId` in the form `<unix ms>:<uuid>` and are applied
 *   exactly once per id — ctx.once, server/routes/once.ts; a message's `clientId` is any retry key)
 *   { ok: true, code, … }                       done
 *   { ok: false, code, reason }                 refused for a game reason (HTTP 200, like /api/action)
 *   HTTP 400/401/409/429 { error: code }        malformed, no session, client-id reuse, rate limited
 *
 *   GET  /api/social/me                               overview: friends + presence, requests, updates, conversations, house
 *   POST /api/social/updates/read        {}
 *   GET  /api/social/people?city=                     who shares my venue room right now
 *   GET  /api/social/search?q=                        find a player by name or public id
 *   GET  /api/social/players/:id                      one player's public card
 *   POST /api/social/players/:id/interact { action, cityId, clientId }
 *   POST /api/social/friends/request     { to, cityId }
 *   POST /api/social/friends/answer      { from, accept, cityId }
 *   POST /api/social/friends/remove      { id, cityId }
 *   POST /api/social/block               { id, cityId }
 *   POST /api/social/unblock             { id }
 *   POST /api/social/reports             { id, reason, text? }
 *   GET  /api/social/conversations
 *   GET  /api/social/conversations/:id?after=<seq>
 *   POST /api/social/conversations/:id/read { seq? }
 *   POST /api/social/messages            { to | conv, body, clientId }
 *   POST /api/social/groups              { name, members: [id], clientId }
 *   POST /api/social/groups/:id          { op: 'rename' | 'add' | 'remove' | 'leave', name?, id? }
 *   GET  /api/social/house/:host                      a house's guest list, as seen by me
 *   POST /api/social/join                { host, cityId }   the invite landing: who you are joining and how (service.join)
 *   POST /api/social/house/knock         { host, cityId }
 *   POST /api/social/house/answer        { visitor, answer: 'accept' | 'decline' }
 *   POST /api/social/house/leave         { host, guest? }
 *   POST /api/social/bae/ask             { id, cityId }
 *   POST /api/social/bae/answer          { from, accept, cityId }
 *   POST /api/social/bae/end             { cityId }
 *   POST /api/social/transfers           { to, amount, cityId, clientId }
 * The friends list is part of GET /api/social/me.
 */
import type { Db, RouteContext, RouteHandler, RouteKey, RouteRequest, SessionRecord } from '../types.ts';
import { socialService, MATERIAL } from '../social/service.ts';

type Service = ReturnType<typeof socialService>;
type Outcome = object;
type Call = (db: Db, session: SessionRecord, body: Record<string, unknown>, request: RouteRequest) => Outcome;

export const HTTP_PER_MINUTE = 240;

export default function socialRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const service = socialService(ctx);
  /** Wrap a service call: parse the body, authenticate, rate limit, transact, then push. */
  const route = (call: Call): RouteHandler => async (request) => {
    const body = request.method === 'POST' ? await request.json() : {};
    // Every POST is durable before it is answered. A GET that only registered the caller need not
    // wait for the disk; one that applied something owed to their life (a gift, a friendship) does.
    // The caller's rooms are re-checked by the route host after every request (core.revalidate, server.js).
    const result = await ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true });
      if (!ctx.allow(`social:http:${session.publicId}`, HTTP_PER_MINUTE)) throw ctx.fail(429, 'rate_limited');
      return service.finish(db, call(db, session, body, request));
    }, { durable: (value) => request.method !== 'GET' || typeof value === 'object' && value !== null && Reflect.get(value, MATERIAL) === true, waitForObserved: true, committed: (value) => service.committed(value) });
    return { body: service.deliver(result), renew: true };
  };
  const after = (request: RouteRequest): number => { const value = Number(request.query.get('after')); return Number.isSafeInteger(value) ? value : 0; };
  return {
    'GET /api/social/me': route((db, session) => service.me(db, session)),
    'POST /api/social/updates/read': route((db, session) => service.readUpdates(db, session)),
    'GET /api/social/people': route((db, session, body, request) => service.people(db, session, request.query.get('city'))),
    'GET /api/social/search': route((db, session, body, request) => service.search(db, session, request.query.get('q'))),
    'GET /api/social/players/:id': route((db, session, body, request) => service.profile(db, session, request.params.id)),
    'POST /api/social/players/:id/interact': route((db, session, body, request) => service.interact(db, session, { ...body, id: request.params.id })),
    'POST /api/social/friends/request': route((db, session, body) => service.friendRequest(db, session, body)),
    'POST /api/social/friends/answer': route((db, session, body) => service.friendAnswer(db, session, body)),
    'POST /api/social/friends/remove': route((db, session, body) => service.friendRemove(db, session, body)),
    'POST /api/social/block': route((db, session, body) => service.block(db, session, body)),
    'POST /api/social/unblock': route((db, session, body) => service.unblock(db, session, body)),
    'POST /api/social/reports': route((db, session, body) => service.report(db, session, body)),
    'GET /api/social/conversations': route((db, session) => service.conversations(db, session)),
    'GET /api/social/conversations/:id': route((db, session, body, request) => service.history(db, session, request.params.id, after(request))),
    'POST /api/social/conversations/:id/read': route((db, session, body, request) => service.read(db, session, { ...body, conv: request.params.id })),
    'POST /api/social/messages': route((db, session, body) => service.send(db, session, body)),
    'POST /api/social/groups': route((db, session, body) => service.groupCreate(db, session, body)),
    'POST /api/social/groups/:id': route((db, session, body, request) => service.groupUpdate(db, session, { ...body, conv: request.params.id })),
    'GET /api/social/house/:host': route((db, session, body, request) => service.house(db, session, request.params.host)),
    'POST /api/social/join': route((db, session, body) => service.join(db, session, body)),
    'POST /api/social/house/knock': route((db, session, body) => service.knock(db, session, body)),
    'POST /api/social/house/answer': route((db, session, body) => service.knockAnswer(db, session, body)),
    'POST /api/social/house/leave': route((db, session, body) => service.houseLeave(db, session, body)),
    'POST /api/social/bae/ask': route((db, session, body) => service.baeAsk(db, session, body)),
    'POST /api/social/bae/answer': route((db, session, body) => service.baeAnswer(db, session, body)),
    'POST /api/social/bae/end': route((db, session, body) => service.baeEnd(db, session, body)),
    'POST /api/social/transfers': route((db, session, body) => service.transfer(db, session, body)),
  };
}
