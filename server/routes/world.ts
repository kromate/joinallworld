import { requireCharacterCity } from '../character.ts';
/**
 * OWNER: world
 * World endpoints under /api/world/: your place in the city, the city at a glance, one local
 * government, its estates and houses, and its directory of residents. All of them READ: a player's
 * local government, house style and upgrades are ordinary game actions on POST /api/action
 * ('estate.set-lga', 'estate.style', 'estate.upgrade', 'estate.move-in', 'estate.relocate' — each
 * applied once per action id, every naira through the wallet ledger), and plots are allocated by
 * the server itself (server/world/service.ts). Nothing here takes a position: the local government
 * is worked out on the player's device and arrives as an id in those actions.
 *
 * Conventions: `?city=<cityId>` on every route; a signed-in device session is required; only
 * public ids and names are returned; every route is rate-limited per player on top of the host's
 * per-address limit; no response holds more than one page (server/world/registry.ts PAGE).
 * `v` is a version stamp: send it back as `?v=` and an unchanged answer is `{ v, unchanged: true }`.
 *
 * Routes (fields besides `serverTime`)
 *   GET /api/world/me?city=
 *        { city, character: { city }, placed, lga, plot: { lga, estate, plot } | null, hidden, counts: { residents, houses, online } | null }
 *        `placed` is false (and lga, plot, counts null) for a life that has not chosen a local government yet.
 *        Also makes sure the caller has their plot (allocating it on a first visit), so it is the
 *        one call a client makes after creation or after changing local government.
 *   GET /api/world/city?city=&v=
 *        { v, lgas: [{ id, residents, houses, online, occ }] }   occ = base64 of 512 bytes, houses per estate
 *   GET /api/world/lga/:id?city=
 *        { id, residents, houses, online, capacity, rev, yours }
 *   GET /api/world/lga/:id/estates?city=&from=&count=&v=
 *        { v, from, counts: [houses per estate] }                 at most 128 estates per request
 *   GET /api/world/lga/:id/estate/:estate/houses?city=&page=&v=
 *        { v, page, pages, houses: [{ p, s, u, id?, name?, online?, you? }] }   p = plot, s = packed style,
 *        u = ms an upgrade finishes (0 = none). A house whose owner is hidden from the directory has no id or name.
 *   GET /api/world/lga/:id/people?city=&q=&after=&online=1
 *        { items: [{ id, name, home, estate?, plot?, online, you }], next }   25 a page; `q` is a name prefix
 *        of at least two characters; `online=1` lists who is online now instead.
 */
import { ESTATE, lgaOf } from '../../src/game/content/world.ts';
import { worldOf } from '../world/service.ts';
import { hasPlace } from '../../src/game/systems/estate.ts';
import { PAGE, fold } from '../world/registry.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { RouteContext, RouteHandler, RouteKey, RouteRequest, SessionRecord } from '../types.ts';

export default function worldRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const { store, fail } = ctx;
  const world = worldOf(ctx);
  const limit = (bucket: string, key: string, count: number): void => { if (!ctx.allow(`world:${bucket}:${key}`, count, 60000)) throw Object.assign(fail(429, 'world_rate_limited'), { reason: 'You are doing that too quickly. Wait a minute and try again.' }); };
  const cityParam = (request: RouteRequest): CityId => { const value = request.query.get('city'); const known = ctx.cityIds.find((id) => id === value); if (known === undefined) throw fail(400, 'invalid_city'); return known; };
  const lgaParam = (cityId: CityId, id: string | undefined) => { const unit = lgaOf(cityId, id); if (!unit) throw fail(404, 'unknown_lga'); return unit; };
  function whole(value: string | null | undefined, max: number, fallback?: number): number;
  function whole(value: string | null | undefined, max: number, fallback: null): number | null;
  function whole(value: string | null | undefined, max: number, fallback: number | null = 0): number | null { if (value === null || value === '') return fallback; const number = Number(value); if (!Number.isInteger(number) || number < 0 || number > max) throw fail(400, 'invalid_number'); return number; }
  const ready = (): void => { if (!world.enabled) throw fail(503, 'world_unavailable'); };
  /** The caller, from a read of the main store (their session only): { id, lga, plot, city }. */
  const caller = (request: RouteRequest, cityId: CityId) => store.read((db) => {
    const session = request.requireSession(db);
    const state = session.cities?.[cityId]?.state;
    // A life that has not settled in has no local government and no house (src/game/systems/estate.ts hasPlace).
    const placed = state !== undefined && hasPlace(state);
    return { id: session.publicId, placed, lga: placed ? state.estate.lga : null, plot: placed ? state.estate.plot ?? null : null, hasLife: Boolean(state?.estate), character: { city: session.character?.city ?? cityId } };
  });
  // One character: once a life has travelled to another city, asking for the city it left must not start a second life there.
  const cityGate = requireCharacterCity;
  (ctx.checks ??= {}).cityGate = cityGate;
  const unchanged = (request: RouteRequest, v: unknown) => (request.query.get('v') === String(v) ? { body: { v, unchanged: true } } : null);

  return {
    'GET /api/world/me': async (request) => {
      ready();
      const cityId = cityParam(request);
      let who = await caller(request, cityId);
      limit('me', who.id, 30);
      // A device that asks before its first poll has no life yet: it is created (or brought up to now) exactly as a poll would.
      if (!who.hasLife) await store.transact((db) => { const session = request.requireSession(db, { renew: true }); cityGate(session, cityId); ctx.settle(session, cityId); }, { durable: false });
      await world.sync(who.id, cityId);
      who = await caller(request, cityId);
      const counts = who.lga && lgaOf(cityId, who.lga) ? await world.lga(cityId, who.lga) : null;
      return { body: { city: cityId, character: who.character, placed: who.placed, lga: who.lga, plot: who.plot, hidden: world.isHidden(who.id), counts: counts ? { residents: counts.residents, houses: counts.houses, online: counts.online } : null } };
    },
    'GET /api/world/city': async (request) => {
      ready();
      const cityId = cityParam(request), who = await caller(request, cityId);
      limit('read', who.id, 120);
      const body = await world.city(cityId);
      // Presence moves without the version changing, so the counts of who is online always travel.
      if (request.query.get('v') === body.v) return { body: { v: body.v, unchanged: true, online: Object.fromEntries(body.lgas.map((item) => [item.id, item.online])) } };
      return { body };
    },
    'GET /api/world/lga/:id': async (request) => {
      ready();
      const cityId = cityParam(request), unit = lgaParam(cityId, request.params.id), who = await caller(request, cityId);
      limit('read', who.id, 120);
      return { body: { id: unit.id, ...(await world.lga(cityId, unit.id)), yours: who.lga === unit.id } };
    },
    'GET /api/world/lga/:id/estates': async (request) => {
      ready();
      const cityId = cityParam(request), unit = lgaParam(cityId, request.params.id), who = await caller(request, cityId);
      limit('read', who.id, 120);
      const from = whole(request.query.get('from'), ESTATE.estates - 1), count = whole(request.query.get('count'), PAGE.estates, PAGE.estates);
      const body = await world.estates(cityId, unit.id, from, count);
      return unchanged(request, body.v) ?? { body };
    },
    'GET /api/world/lga/:id/estate/:estate/houses': async (request) => {
      ready();
      const cityId = cityParam(request), unit = lgaParam(cityId, request.params.id), who = await caller(request, cityId);
      limit('houses', who.id, 240);
      const estate = whole(request.params.estate, ESTATE.estates - 1), page = whole(request.query.get('page'), 9);
      const result = await world.houses(cityId, unit.id, estate, page, who.id);
      const { rev, ...rest } = result;
      // Presence is part of the answer, so an unchanged estate is still answered in full (it is one page).
      return { body: { v: rev, ...rest } };
    },
    'GET /api/world/lga/:id/people': async (request) => {
      ready();
      const cityId = cityParam(request), unit = lgaParam(cityId, request.params.id), who = await caller(request, cityId);
      limit('people', who.id, 120);
      const q = request.query.get('q') ?? '';
      if (q.length > 40) throw fail(400, 'invalid_query');
      if (q && fold(q).length < 2) return { body: { items: [], next: null, short: true } };
      const after = whole(request.query.get('after'), 10_000_000, null);
      return { body: await world.people(cityId, unit.id, { q, after, online: request.query.get('online') === '1', viewerId: who.id }) };
    },
  };
}
