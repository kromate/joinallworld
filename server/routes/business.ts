/**
 * OWNER: business
 * Player-owned shops under /api/business/. The shared record and every rule are in server/business/service.ts and
 * src/game/business-model.ts; the design and the numbers are in docs/BUSINESS.md.
 *
 * Conventions (the same as /api/civic/)
 *   - GET routes take `?city=<cityId>`; POST routes take `cityId` in the JSON body: the city the caller's character is in.
 *     A shop may stand in another city; collecting, paying rent and closing work from anywhere.
 *   - Malformed requests throw (400/401/429). A well-formed request the rules refuse answers 200
 *     `{ ok: false, code, reason }` with a reason naming what is missing, and changes nothing.
 *   - Every route that charges or pays takes a MANDATORY `requestId` (`<unix ms>:<uuid>`) and goes through ctx.once:
 *     the same id again returns the first outcome with `duplicate: true`.
 *   - Everything is in-game naira through the wallet ledger. There is no real-money path.
 *
 * Routes (response fields besides `serverTime`)
 *   GET  /api/business/venue?city=&venue=   VenueShopsResponse: the stalls at a market, what a stall costs there, the caller's own shop and bag
 *   GET  /api/business/mine?city=           MyBusinessResponse
 *   POST /api/business/open        { cityId, venue, type, name, colour, icon, requestId }
 *   POST /api/business/stock       { cityId, items: { [productId]: units }, requestId }
 *   POST /api/business/price       { cityId, prices: { [productId]: naira } }
 *   POST /api/business/collect     { cityId, requestId }
 *   POST /api/business/rent        { cityId, requestId }
 *   POST /api/business/upgrade     { cityId, upgrade, requestId }
 *   POST /api/business/close       { cityId, requestId }
 *   POST /api/business/bag         { cityId, venue, product, units, requestId }
 *   POST /api/business/bag/stock   { cityId, requestId }
 *   POST /api/business/bag/return  { cityId, requestId }
 *        each → { ok, code, reason?, duplicate?, state, city, mine, bag, limits }
 *   POST /api/business/buy         { cityId, shop, product, units, expectedPrice, expectedTotal, requestId } → { ok, code, reason?, duplicate?, state, market }
 *   POST /api/business/rate        { cityId, shop, stars }                     → { ok, code, reason?, market }
 *   POST /api/business/report      { cityId, shop, reason: 'name' | 'scam' | 'other' } → { ok, code, reason? }
 */
import type { CityId } from '../../src/types/protocol.ts';
import type { Db, RouteContext, RouteHandler, RouteKey, RouteRequest, RouteResult } from '../types.ts';
import { businessService } from '../business/service.ts';

type Body = Record<string, unknown>;
type Step = (db: Db, request: RouteRequest, cityId: CityId, body: Body) => { body: object; push: [string, unknown][] };

export default function businessRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const { store, fail } = ctx;
  const shops = businessService(ctx);
  const cityParam = (value: unknown): CityId => { const found = ctx.cityIds.find((id) => id === value); if (typeof value !== 'string' || found === undefined) throw fail(400, 'invalid_city'); return found; };
  const limit = (bucket: string, key: string, count: number): void => { if (!ctx.allow(`business:${bucket}:${key}`, count)) throw fail(429, 'business_rate_limited'); };
  /** A write: one transaction, then the notes it owed are sent. */
  const write = (bucket: string, perMinute: number, step: Step): RouteHandler => async (request): Promise<RouteResult> => {
    const body = await request.json();
    const cityId = cityParam(body.cityId);
    const result = await store.transact((db) => {
      limit(bucket, request.requireSession(db).publicId, perMinute);
      return step(db, request, cityId, body);
    });
    return { body: result.body, renew: true, after: () => shops.deliver(result.push) };
  };

  return {
    'GET /api/business/venue': async (request) => {
      const cityId = cityParam(request.query.get('city')), venue = request.query.get('venue') ?? '';
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(venue)) throw fail(400, 'invalid_venue');
      return { body: await store.read((db) => { limit('read', request.session(db)?.publicId ?? `ip:${request.ip}`, 120); return shops.venue(db, request, cityId, venue); }) };
    },
    'GET /api/business/mine': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const { stale, ...body } = await store.read((db) => { limit('read', request.requireSession(db).publicId, 120); return shops.mine(db, request, cityId); });
      if (!stale) return { body };
      // Rent was taken or missed since the record was last written: write that, and tell the owner.
      const fresh = await store.transact((db) => shops.refresh(db, request, cityId));
      return { body: fresh.body, after: () => shops.deliver(fresh.push) };
    },
    'POST /api/business/open': write('open', 12, (db, request, cityId, body) => shops.open(db, request, cityId, body)),
    'POST /api/business/stock': write('stock', 30, (db, request, cityId, body) => shops.stock(db, request, cityId, body)),
    'POST /api/business/price': write('price', 30, (db, request, cityId, body) => shops.price(db, request, cityId, body)),
    'POST /api/business/collect': write('collect', 20, (db, request, cityId, body) => shops.collect(db, request, cityId, body)),
    'POST /api/business/rent': write('rent', 10, (db, request, cityId, body) => shops.rent(db, request, cityId, body)),
    'POST /api/business/upgrade': write('upgrade', 10, (db, request, cityId, body) => shops.upgrade(db, request, cityId, body)),
    'POST /api/business/close': write('close', 6, (db, request, cityId, body) => shops.close(db, request, cityId, body)),
    'POST /api/business/bag': write('bag', 20, (db, request, cityId, body) => shops.bagBuy(db, request, cityId, body)),
    'POST /api/business/bag/stock': write('bag', 20, (db, request, cityId, body) => shops.bagStock(db, request, cityId, body)),
    'POST /api/business/bag/return': write('bag', 20, (db, request, cityId, body) => shops.bagReturn(db, request, cityId, body)),
    'POST /api/business/buy': write('buy', 20, (db, request, cityId, body) => shops.buy(db, request, cityId, body)),
    'POST /api/business/rate': write('rate', 20, (db, request, cityId, body) => shops.rate(db, request, cityId, body)),
    'POST /api/business/report': write('report', 6, (db, request, cityId, body) => shops.report(db, request, cityId, body)),
  };
}
