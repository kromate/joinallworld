import { landOf } from '../world/land.ts';
import { readPlot } from '../world/street.ts';
import { ESTATE } from '../../src/game/content/world.ts';
import type { LandBuyRequest } from '../../src/types/land.ts';
import type { RouteContext, RouteHandler } from '../types.ts';
import type { CityId } from '../../src/types/protocol.ts';

export default function landRoutes(ctx: RouteContext): Record<string, RouteHandler> {
  const land = landOf(ctx);
  const cityOf = (value: unknown): CityId => { const city = ctx.cityIds.find((id) => id === value); if (!city) throw ctx.fail(400, 'invalid_city'); return city; };
  return {
    'GET /api/world/land': async (request) => {
      const city = cityOf(request.query.get('city'));
      const owner = await ctx.store.read((db) => request.requireSession(db).publicId);
      if (!ctx.allow(`land:read:${owner}`, 60, 60000)) throw ctx.fail(429, 'land_rate_limited');
      return { body: await land.view(request, city) };
    },
    'POST /api/world/land/buy': async (request) => {
      const body = await request.json(2048), cityId = cityOf(body.cityId), anchor = readPlot(body.anchor, cityId);
      if (!anchor || typeof body.clientId !== 'string' || body.clientId.length > 128 || typeof body.plot !== 'number' || !Number.isInteger(body.plot) || body.plot < 0 || body.plot >= ESTATE.streets * ESTATE.plots || typeof body.price !== 'number' || !Number.isSafeInteger(body.price) || body.price <= 0) throw ctx.fail(400, 'invalid_land_purchase');
      const owner = await ctx.store.read((db) => request.requireSession(db).publicId);
      if (!ctx.allow(`land:buy:${owner}`, 12, 60000)) throw ctx.fail(429, 'land_rate_limited');
      const input: LandBuyRequest = { cityId, anchor, clientId: body.clientId, plot: body.plot, price: body.price };
      return { body: await land.buy(request, input), renew: true };
    },
  };
}
