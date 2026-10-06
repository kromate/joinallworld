/**
 * OWNER: politics
 * Parties, decrees, salaries and the treasuries: everything about government except the ballots, which are the tier-aware
 * routes under /api/civic/gov. Design: docs/POLITICS.md. Rules: src/game/content/politics.ts. Record: server/politics/.
 *
 *   GET  /api/politics/overview?city=   { city, seats: SeatView[], parties, you | null, partyRules }   city, state and nation seats, narrowest first
 *   POST /api/politics/decree           { cityId, tier, lever, value }       the sitting officeholder sets a lever for their term
 *   POST /api/politics/salary           { cityId, tier, requestId }          the officeholder draws this term's salary from the treasury, once
 *   POST /api/politics/party/found      { cityId, name, motto, colour, requestId }   pays the fee; the founder joins
 *   POST /api/politics/party/join       { cityId, party }
 *   POST /api/politics/party/leave      { cityId }
 *   Every write answers { ok, code, reason?, state?, politics } with the refreshed overview.
 */
import { cityRules } from '../../src/game/cities/index.ts';
import { AD_COLOURS, ELECTION } from '../../src/game/content/civic.ts';
import { LEVERS, PARTY, QUORUM, SEATS, SEAT_TITLES, TIER_IDS, leversOf } from '../../src/game/content/politics.ts';
import { civicTitle } from '../../src/game/cities/terminology.ts';
import type { LeverView, PartyView, PoliticsResponse, SeatView, TierId } from '../../src/types/politics.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { CityId, PlayerRef } from '../../src/types/protocol.ts';
import type { Db, GovScope, RouteContext, RouteHandler, RouteKey, RouteRequest } from '../types.ts';
import { governorAt, phaseAt } from '../civic/elections.ts';
import { cleanLine } from '../civic/text.ts';
import { govOfScope, peekGov, peekPolitics, peekScope, politicsOf, scopeRecord, seatsOf } from '../politics/data.ts';
import type { Seat } from '../politics/data.ts';
import { decreeBlock, drawSalary, found, foundBlock, join, joinBlock, leave, leverValue, memberCount, partyOf, salaryBlock, salaryDue, setDecree } from '../politics/rules.ts';

export default function politicsRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const { store, fail } = ctx;
  const cityName = (cityId: CityId): string => cityRules(cityId)?.name ?? cityId;
  const cityParam = (value: unknown): CityId => { const found = ctx.cityIds.find((id) => id === value); if (typeof value !== 'string' || found === undefined) throw fail(400, 'invalid_city'); return found; };
  const tierParam = (value: unknown): TierId => { const tier = TIER_IDS.find((item) => item === value); if (!tier) throw fail(400, 'invalid_tier'); return tier; };
  const limit = (bucket: string, key: string, count: number): void => { if (!ctx.allow(`politics:${bucket}:${key}`, count)) throw fail(429, 'politics_rate_limited'); };
  // A city whose seat is still called Governor would share the title with the state's: here it is the City Governor.
  const titleOf = (tier: TierId, cityId: CityId): string => (tier === 'city' ? (civicTitle(cityId) === SEAT_TITLES.state ? `City ${SEAT_TITLES.state}` : civicTitle(cityId)) : SEAT_TITLES[tier]);
  const seatOf = (cityId: CityId, tier: TierId): Seat => { const seat = seatsOf(cityId, cityName(cityId)).find((item) => item.tier === tier); if (!seat) throw fail(400, 'no_such_seat'); return seat; };
  const colours = AD_COLOURS.map((item) => item.id);
  const refused = (block: { code: string; reason: string }) => ({ ok: false as const, code: block.code, reason: block.reason });

  /** The ballots a seat is decided by, as a read sees them (nothing created). */
  function govOf(db: Db, seat: Seat, cityId: CityId): GovScope {
    if (seat.tier === 'city') { const gov = db.civic?.cities?.[cityId]?.gov; return gov ? { gov } : { gov: { elections: {}, announcements: [] } }; }
    return peekGov(peekScope(peekPolitics(db), seat.id));
  }

  function overview(db: Db, cityId: CityId, who: PlayerRef | null): PoliticsResponse {
    const now = ctx.now(), politics = peekPolitics(db);
    const seats = seatsOf(cityId, cityName(cityId)).map((seat): SeatView => {
      const scope = peekScope(politics, seat.id), gov = govOf(db, seat, cityId), quorum = QUORUM[seat.tier];
      const sitting = governorAt(gov, now, quorum);
      const candidates = Object.entries(gov.gov.elections[phaseAt(now).week]?.candidates ?? {});
      const parties: Record<string, string> = {};
      for (const [id, candidate] of candidates) if (candidate.party && Object.hasOwn(politics.parties, candidate.party)) parties[id] = candidate.party;
      const held = sitting ? gov.gov.elections[String(sitting.week)]?.candidates[sitting.id]?.party ?? null : null;
      const levers = leversOf(seat.tier).map((id): LeverView => ({ id, label: LEVERS[id].label, about: LEVERS[id].about, min: LEVERS[id].min, max: LEVERS[id].max, base: LEVERS[id].base, unit: LEVERS[id].unit, value: leverValue(scope, gov, now, id) }));
      const decree = scope.decree && sitting && scope.decree.week === sitting.week && scope.decree.by.id === sitting.id ? { by: scope.decree.by, at: scope.decree.at } : null;
      return { tier: seat.tier, id: seat.id, name: seat.name, title: titleOf(seat.tier, cityId), fee: seat.tier === 'city' ? ELECTION.filingFee : SEATS[seat.tier].fee, quorum, parties,
        officeholderParty: held && Object.hasOwn(politics.parties, held) ? held : null, decree, levers, treasury: { balance: scope.treasury.balance, ledger: scope.treasury.ledger.slice(-15).reverse() },
        you: who ? { isOfficeholder: sitting?.id === who.id, salary: salaryDue(scope, gov, now, seat.tier, who.id) } : null };
    });
    const mine = who ? partyOf(politics, who.id) : null;
    const parties = Object.values(politics.parties).map((party): PartyView => ({ id: party.id, name: party.name, motto: party.motto, colour: party.colour, founder: party.founder, members: memberCount(politics, party.id), mine: party.id === mine }))
      .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name)).slice(0, 60);
    const founded = who ? Object.values(politics.parties).filter((party) => party.founder.id === who.id).length : 0;
    return { city: cityId, seats, parties, you: who ? { party: mine, canFound: founded < PARTY.perFounder } : null, partyRules: { fee: PARTY.fee, nameMin: PARTY.nameMin, nameMax: PARTY.nameMax, mottoMin: PARTY.mottoMin, mottoMax: PARTY.mottoMax, colours } };
  }

  function enter(db: Db, request: RouteRequest, cityId: CityId) {
    const session = request.requireSession(db, { renew: true });
    const who = ctx.publicSession(session);
    const life = ctx.settle(session, cityId);
    return { session, who, life };
  }
  const act = (life: LifeState, cityId: CityId, payload: { op: 'pay' | 'receive'; amount: number; label: string }, guard?: string) => ctx.act(life, { type: 'civic.treasury', cityId, payload, ...(guard ? { stateGuard: guard } : {}) });
  const write = (db: Db, cityId: CityId, who: PlayerRef, life: LifeState, outcome: { ok: boolean; code: string; reason?: string }) => ({ body: { ...outcome, state: life, politics: overview(db, cityId, who) }, renew: true });

  return {
    'GET /api/politics/overview': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const body = await store.read((db) => { const session = request.session(db); const who = session ? ctx.publicSession(session) : null; limit('read', who?.id ?? `ip:${request.ip}`, 120); return overview(db, cityId, who); });
      return { body };
    },

    'POST /api/politics/decree': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId), tier = tierParam(body.tier);
      const seat = seatOf(cityId, tier);
      return store.transact((db) => {
        const { who, life } = enter(db, request, cityId);
        limit('decree', who.id, 30);
        const politics = politicsOf(ctx, db), scope = scopeRecord(politics, seat.id);
        const gov = tier === 'city' ? govOf(db, seat, cityId) : govOfScope(scope);
        const block = decreeBlock(gov, ctx.now(), tier, who.id, body.lever, body.value);
        if (block) return write(db, cityId, who, life, refused(block));
        setDecree(scope, gov, ctx.now(), who, body.lever as keyof typeof LEVERS, body.value as number);
        return write(db, cityId, who, life, { ok: true, code: 'decreed' });
      });
    },

    'POST /api/politics/salary': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId), tier = tierParam(body.tier);
      const seat = seatOf(cityId, tier);
      return store.transact((db) => {
        const { session, who, life } = enter(db, request, cityId);
        limit('salary', who.id, 12);
        const outcome = ctx.once(db, session, { id: body.requestId, kind: 'politics.salary', fingerprint: [cityId, tier] }, () => {
          const scope = scopeRecord(politicsOf(ctx, db), seat.id);
          const gov = tier === 'city' ? govOf(db, seat, cityId) : govOfScope(scope);
          const block = salaryBlock(scope, gov, ctx.now(), tier, who.id);
          if (block) return refused(block);
          const amount = drawSalary(scope, gov, ctx.now(), tier, who);
          const paid = act(life, cityId, { op: 'receive', amount, label: `${titleOf(tier, cityId)}’s salary` });
          // The life could not take it (its balance is at the limit): the treasury is put back as it was.
          if (!paid.ok) { scope.treasury.balance += amount; delete scope.drawn; scope.treasury.ledger.pop(); return { ok: false as const, code: paid.code, reason: paid.reason }; }
          return { ok: true as const, code: 'paid' };
        });
        return write(db, cityId, who, life, outcome);
      });
    },

    'POST /api/politics/party/found': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      const name = cleanLine(body.name, { min: PARTY.nameMin, max: PARTY.nameMax, what: 'The party name' });
      const motto = cleanLine(body.motto, { min: PARTY.mottoMin, max: PARTY.mottoMax, what: 'The motto' });
      const colour = colours.find((id) => id === body.colour);
      return store.transact((db) => {
        const { session, who, life } = enter(db, request, cityId);
        limit('party', who.id, 12);
        const outcome = ctx.once(db, session, { id: body.requestId, kind: 'politics.party', fingerprint: [cityId, name.ok ? name.text : String(body.name ?? '')] }, () => {
          if (!name.ok) return refused(name);
          if (!motto.ok) return refused(motto);
          if (!colour) return refused({ code: 'invalid_colour', reason: 'Choose one of the listed colours.' });
          const politics = politicsOf(ctx, db);
          const block = foundBlock(politics, who, name.text) ?? ctx.checks?.muted?.(who.id) ?? null;
          if (block) return refused({ code: block.code, reason: block.reason ?? 'You cannot do that now.' });
          const paid = act(life, cityId, { op: 'pay', amount: PARTY.fee, label: `Founding the ${name.text}` });
          if (!paid.ok) return { ok: false as const, code: paid.code, reason: paid.reason };
          found(politics, ctx.now(), who, name.text, motto.text, colour);
          return { ok: true as const, code: 'founded' };
        });
        return write(db, cityId, who, life, outcome);
      });
    },

    'POST /api/politics/party/join': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      return store.transact((db) => {
        const { who, life } = enter(db, request, cityId);
        limit('party', who.id, 30);
        const politics = politicsOf(ctx, db);
        const block = joinBlock(politics, who.id, body.party);
        if (block) return write(db, cityId, who, life, refused(block));
        join(politics, who.id, body.party as string);
        return write(db, cityId, who, life, { ok: true, code: 'joined' });
      });
    },

    'POST /api/politics/party/leave': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      return store.transact((db) => {
        const { who, life } = enter(db, request, cityId);
        limit('party', who.id, 30);
        const left = leave(politicsOf(ctx, db), who.id);
        return write(db, cityId, who, life, left ? { ok: true, code: 'left' } : { ok: false, code: 'no_party', reason: 'You do not belong to a party.' });
      });
    },
  };
}
