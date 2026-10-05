/**
 * OWNER: world
 * One small read for the header: who is here and how many visits there have been.
 *
 *   GET /api/world/pulse
 *        { online, visits, today, cities: { <cityId>: online in that city } }   (besides `serverTime`)
 *        `online` is distinct players online (a live socket, or one lost a moment ago), `visits` distinct player-days,
 *        `today` distinct players of this day; all are defined in server/pulse.ts. The caller is always counted, in the
 *        city their character is in. A signed-in device session is required (the call also counts the caller's visit for today).
 */
import { characterCity } from '../character.ts';
import { pulseOf } from '../pulse.ts';
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';

export default function pulseRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const service = pulseOf(ctx);
  return {
    'GET /api/world/pulse': async (request) => {
      const viewer = await ctx.store.read((db) => { const session = request.requireSession(db); return { id: session.publicId, city: characterCity(session) }; });
      const id = viewer.id;
      if (!ctx.allow(`pulse:${id}`, 20, 60000)) throw Object.assign(ctx.fail(429, 'pulse_rate_limited'), { reason: 'You are doing that too quickly. Wait a minute and try again.' });
      await service.see([id]);
      return { body: { ...service.pulse(viewer) }, headers: { 'Cache-Control': 'no-store' } };
    },
  };
}
