/**
 * OWNER: social
 * Socket messages for live location. Thin adapters over server/social/live.ts, which holds every rule
 * (who is told what, the caps, what a host that forgets rebuilds). All types are prefixed `live-`.
 *
 * CLIENT → SERVER
 *   live-watch   { cityId }   watch the city the caller's character is in (the counts of another city are not
 *                             given: `city` is then null) and the caller's friends wherever they are
 *                             → live-snapshot { at, city: { cityId, venues: { venueId: n }, moving } | null, friends: [spot] }
 *                             Sent again by a client whenever its friends or its city changed; LIVE.watchPerMinute a minute.
 *   live-unwatch {}           stop; not answered
 * SERVER → CLIENT
 *   live-move    { at, spots?: [spot], city? }   what changed, at most four frames a second per socket
 *   live-snapshot                                 also sent unasked when the server rebuilt the subscription
 *   spot = { id, status, seenAt?, cityId?, venue?, trip?: { from, to, mode, startedAt, duration }, journey?: { to, mode, startedAt, duration } }
 * A socket need not have joined a venue room. This module must be registered after the social module: it reads the
 * presence registry that module keeps.
 */
import { LIVE, liveOf } from '../social/live.ts';
import type { RouteContext, WsHandlers } from '../types.ts';

export default function liveSocket(ctx: RouteContext): WsHandlers {
  const live = liveOf(ctx);
  return {
    open: (ws) => live.open(ws),
    close: (ws) => live.close(ws),
    restore: (ws) => live.restore(ws),
    messages: {
      'live-watch': async (ws, message) => {
        const cityId = ctx.cityIds.find((id) => id === message.cityId);
        if (cityId === undefined) throw Error('invalid_city');
        if (!ctx.allow(`live:watch:${ws.session.id}`, LIVE.watchPerMinute)) throw Error('rate_limited');
        await live.watch(ws, cityId);
      },
      'live-unwatch': (ws) => { live.unwatch(ws); },
    },
  };
}
