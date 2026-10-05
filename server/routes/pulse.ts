/**
 * OWNER: world
 * One small read for the header: who is here and how many visits there have been.
 *
 *   GET /api/world/pulse
 *        { online, visits, cities: { <cityId>: online in that city } }   (besides `serverTime`)
 *        `online` is distinct players with a live socket, `visits` distinct player-days; both are
 *        defined in server/pulse.ts. Answers from a cache of a few seconds. A signed-in device
 *        session is required (the call also counts the caller's visit for today).
 */
import { pulseOf } from '../pulse.ts';
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';

export default function pulseRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const service = pulseOf(ctx);
  return {
    'GET /api/world/pulse': async (request) => {
      const id = await ctx.store.read((db) => request.requireSession(db).publicId);
      if (!ctx.allow(`pulse:${id}`, 20, 60000)) throw Object.assign(ctx.fail(429, 'pulse_rate_limited'), { reason: 'You are doing that too quickly. Wait a minute and try again.' });
      await service.see([id]);
      return { body: { ...service.pulse() }, headers: { 'Cache-Control': 'no-store' } };
    },
  };
}
