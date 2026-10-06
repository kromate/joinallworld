/**
 * OWNER: accounts
 * The launch bonus's two routes (rules and storage: server/bonus/service.ts).
 *
 *   GET  /api/world/bonus      { on, amount, places, left }   PUBLIC and tiny: no personal data. `left` is rounded down to a multiple of 10
 *                              above 100 (exact at 100 or fewer), so a live counter is not worth hammering; cached for 45 seconds.
 *   POST /api/account/bonus    { csrf, seen? } → { state, amount, n, places, held?, show }   the caller's own bonus: claims it on the first
 *                              call of an account, pays one that was held, and says whether the moment should be shown (`show`; send
 *                              `seen: true` once it was). Needs a signed-in browser and the same origin and anti-forgery token as the
 *                              other account routes. A guest gets { state: 'none' }.
 */
import { addressBucket } from '../host-context.ts';
import { UUID_PATTERN } from '../protocol.ts';
import { bonusService, claimedOf, publicOffer } from '../bonus/service.ts';
import { csrfOf } from './auth.ts';
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';

export default function bonusRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const bonus = bonusService(ctx);
  return {
    'GET /api/world/bonus': async () => {
      const claimed = await ctx.store.read((db) => claimedOf(db));
      return { body: publicOffer(bonus.config(), claimed), headers: { 'Cache-Control': 'public, max-age=45' } };
    },
    'POST /api/account/bonus': async (request) => {
      const body = await request.json();
      if (request.strictOrigin !== true) throw ctx.fail(403, 'origin_required');
      const cookie = request.cookie && UUID_PATTERN.test(request.cookie) ? request.cookie : undefined;
      const sent = typeof body.csrf === 'string' ? body.csrf : '';
      if (cookie && (await csrfOf(cookie)) !== sent) throw ctx.fail(403, 'csrf_rejected');
      if (!ctx.allow(`bonus:ask:${addressBucket(request.ip)}`, 600)) throw ctx.fail(429, 'account_rate_limited');
      const binding = request.binding && UUID_PATTERN.test(request.binding) ? request.binding : undefined;
      return { body: await bonus.run({ binding, ip: request.ip, seen: body.seen === true }) };
    },
  };
}
