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
 *   GET  /api/politics/justice/overview?city=   { city, seats, you | null, offences, rules }   officers, sentences, whether you are in jail, offences an officer may act on
 *   POST /api/politics/justice/fight    { cityId, target, requestId }    fight a player in the same place; the offence goes on record
 *   POST /api/politics/justice/enrol    { cityId, tier, player }         the officeholder makes a player an officer for their term
 *   POST /api/politics/justice/dismiss  { cityId, tier, player }         the officeholder, or the officer, ends it
 *   POST /api/politics/justice/arrest   { cityId, offence, requestId }   an officer in the same place as the offender jails them for the sentence in force
 *   Every write answers { ok, code, reason?, state?, politics } with the refreshed overview.
 */
import { cityRules } from '../../src/game/cities/index.ts';
import { AD_COLOURS, ELECTION } from '../../src/game/content/civic.ts';
import { JUSTICE, LEVERS, PARTY, QUORUM, SEATS, SEAT_TITLES, SENTENCE_LEVER, TIER_IDS, leversOf } from '../../src/game/content/politics.ts';
import { civicTitle } from '../../src/game/cities/terminology.ts';
import type { JusticeResponse, JusticeSeatView, LeverView, OffenceView, PartyView, PoliticsResponse, SeatView, TierId } from '../../src/types/politics.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { CityId, PlayerRef } from '../../src/types/protocol.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { venueLabel } from '../../src/game/content/venues.ts';
import { isDeparting } from '../../src/life.ts';
import { UUID_PATTERN, venueRoomKey } from '../protocol.ts';
import { presenceOf } from '../social/presence.ts';
import type { Db, GovScope, RouteContext, RouteHandler, RouteKey, RouteRequest } from '../types.ts';
import { governorAt, phaseAt } from '../civic/elections.ts';
import { cleanLine } from '../civic/text.ts';
import { govOfScope, justiceOf, peekGov, peekJustice, peekPolitics, peekScope, politicsOf, scopeRecord, seatsOf } from '../politics/data.ts';
import { arrestBlock, attackerWins, fightBlock, inJurisdiction, jail, jailOf, officersOf, policeIsValid, recordFight } from '../politics/justice.ts';
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

  const presence = presenceOf(ctx);
  const DAY = 86400000;
  const playerId = (value: unknown): string => { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw fail(400, 'invalid_player'); return value; };
  const scopeNameOf = (cityId: CityId, scope: string): string => seatsOf(cityId, cityName(cityId)).find((seat) => seat.id === scope)?.name ?? scope;
  /** The ballots of any seat by its scope id (a city's are in its civic record). */
  function govOfId(db: Db, scope: string): GovScope {
    if (scope.startsWith('city:')) { const gov = db.civic?.cities?.[scope.slice(5)]?.gov; return gov ? { gov } : { gov: { elections: {}, announcements: [] } }; }
    return peekGov(peekScope(peekPolitics(db), scope));
  }
  const tierOfScope = (scope: string): TierId => (scope.startsWith('city:') ? 'city' : scope.startsWith('state:') ? 'state' : 'nation');
  const sittingOf = (db: Db, scope: string): { id: string; week: number } | null => { const sitting = governorAt(govOfId(db, scope), ctx.now(), QUORUM[tierOfScope(scope)]); return sitting ? { id: sitting.id, week: sitting.week } : null; };
  const daysLived = (life: LifeState): number => Math.max(0, lagosTime(ctx.now()).day - lagosTime(life.civic.since).day);
  /** The seats' officers and the sentence in force, for the city the caller stands in. */
  function justiceOverview(db: Db, cityId: CityId, who: PlayerRef | null, life: LifeState | null): JusticeResponse {
    const now = ctx.now(), politics = peekPolitics(db), justice = peekJustice(politics);
    const seats = seatsOf(cityId, cityName(cityId)).map((seat): JusticeSeatView => {
      const sitting = sittingOf(db, seat.id), scope = peekScope(politics, seat.id);
      return { tier: seat.tier, scope: seat.id, title: titleOf(seat.tier, cityId), name: seat.name, officers: officersOf(justice, seat.id, sitting).map(([id, record]) => ({ id, name: record.name })),
        capacity: JUSTICE.officers[seat.tier], canEnrol: !!who && sitting?.id === who.id, sentence: leverValue(scope, govOfId(db, seat.id), now, SENTENCE_LEVER[seat.tier]) };
    });
    const mine = who ? justice.police[who.id] : undefined;
    const officer = mine && policeIsValid(mine, sittingOf(db, mine.scope)) ? mine : null;
    const room = who && life ? venueRoomKey(cityId, life.location, who.id) : null;
    const view = (offence: ReturnType<typeof peekJustice>['offences'][string]): OffenceView => ({ id: offence.id, kind: offence.kind, by: offence.by, against: offence.against, city: offence.city, venue: offence.venue, at: offence.at,
      here: !!room && life?.location !== 'home' && presence.isIn(offence.by.id, room) });
    const open = Object.values(justice.offences).filter((offence) => offence.status === 'open' && now - offence.at <= JUSTICE.offenceMs).sort((a, b) => b.at - a.at);
    const reach = officer ? open.filter((offence) => offence.by.id !== who?.id && !jailOf(justice, offence.by.id, now) && inJurisdiction(officer.tier, officer.scope, offence.city, seatsOf(offence.city, offence.city).map((seat) => seat.id))).slice(0, 20).map(view) : [];
    const sentence = who ? jailOf(justice, who.id, now) : null;
    return { city: cityId, seats,
      you: who ? { jail: sentence ? { until: sentence.until, minutes: sentence.minutes, by: sentence.by } : null, police: officer ? { tier: officer.tier, scope: officer.scope } : null, wanted: open.filter((offence) => offence.by.id === who.id).slice(0, 5).map(view) } : null,
      offences: reach, rules: { minDays: JUSTICE.minDays, minEnergy: JUSTICE.minEnergy, cooldownMinutes: JUSTICE.cooldownMs / 60000, offenceHours: JUSTICE.offenceMs / 3600000, arrestsPerHour: JUSTICE.arrestsPerHour } };
  }
  const justiceWrite = (db: Db, cityId: CityId, who: PlayerRef, life: LifeState, outcome: { ok: boolean; code: string; reason?: string }, after?: () => void) =>
    ({ body: { ...outcome, state: life, justice: justiceOverview(db, cityId, who, life) }, renew: true, ...(after ? { after } : {}) });
  const noJustice = (code: string, reason: string) => ({ ok: false as const, code, reason });

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

    // ---- justice ----------------------------------------------------------------------------------
    'GET /api/politics/justice/overview': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const body = await store.read((db) => {
        const session = request.session(db), who = session ? ctx.publicSession(session) : null;
        limit('read', who?.id ?? `ip:${request.ip}`, 120);
        return justiceOverview(db, cityId, who, session ? ctx.settle(session, cityId) : null);
      });
      return { body };
    },

    'POST /api/politics/justice/fight': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId), target = playerId(body.target);
      return store.transact((db) => {
        const { session, who, life } = enter(db, request, cityId);
        limit('fight', who.id, 20);
        let after: (() => void) | undefined;
        const outcome = ctx.once(db, session, { id: body.requestId, kind: 'justice.fight', fingerprint: [cityId, target] }, () => {
          const targetSession = ctx.core.sessionByPublicId(db, target);
          const stored = targetSession?.cities?.[cityId]?.state;
          if (!targetSession || !stored) return noJustice('unknown_player', 'That player is not here.');
          const politics = politicsOf(ctx, db), justice = justiceOf(politics), now = ctx.now();
          const block = fightBlock(justice, now, who.id, target) ?? ctx.checks?.muted?.(who.id) ?? null;
          if (block) return noJustice(block.code, block.reason ?? 'You cannot do that now.');
          if (ctx.checks?.blocked?.(who.id, target) === true) return noJustice('blocked', 'You cannot fight this player.');
          if (life.location === 'home' || isDeparting(life)) return noJustice('not_here', 'There is nobody to fight here. Go to a public place first.');
          const room = venueRoomKey(cityId, life.location, who.id);
          if (!presence.isIn(who.id, room) || !presence.isIn(target, room)) return noJustice('not_here', `${targetSession.name ?? 'That player'} is not here with you right now.`);
          if (life.needs.energy < JUSTICE.minEnergy) return noJustice('too_tired', 'You are too tired to fight. Rest first.');
          const victim = ctx.settle(targetSession, cityId);
          if (daysLived(life) < JUSTICE.minDays || daysLived(victim) < JUSTICE.minDays) return noJustice('too_new', 'A player who has lived here for less than a day cannot fight, or be fought.');
          const luck = ctx.randomId().replace(/-/g, ''), rolls: [number, number] = [parseInt(luck.slice(0, 6), 16) / 0x1000000, parseInt(luck.slice(6, 12), 16) / 0x1000000];
          const won = attackerWins(life.needs.energy, victim.needs.energy, rolls), id = `o${(politics.seq += 1)}`;
          const mine = ctx.act(life, { type: 'civic.justice', cityId, payload: { energy: won ? JUSTICE.winnerEnergy : JUSTICE.loserEnergy, beaten: !won } });
          if (!mine.ok) return noJustice(mine.code, mine.reason ?? 'You cannot do that now.');
          ctx.act(victim, { type: 'civic.justice', cityId, payload: { energy: won ? JUSTICE.loserEnergy : JUSTICE.winnerEnergy, beaten: won } });
          const place = venueLabel(life.location, cityId);
          ctx.act(victim, { type: 'civic.news', cityId, payload: { items: [{ id: `fight-${id}`, title: 'You were attacked', text: `${who.name} attacked you at ${place}${won ? '' : ' and lost'}.`, at: now }] } });
          recordFight(justice, now, id, who, { id: target, name: ctx.publicSession(targetSession).name }, cityId, life.location, won);
          after = () => { ctx.push(target, { type: 'social-sync' }); };
          return { ok: true as const, code: won ? 'won' : 'lost' };
        });
        return justiceWrite(db, cityId, who, life, outcome, after);
      });
    },

    'POST /api/politics/justice/enrol': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId), tier = tierParam(body.tier), player = playerId(body.player), seat = seatOf(cityId, tier);
      return store.transact((db) => {
        const { who, life } = enter(db, request, cityId);
        limit('enrol', who.id, 30);
        const sitting = sittingOf(db, seat.id), target = ctx.core.sessionByPublicId(db, player);
        if (!sitting || sitting.id !== who.id) return justiceWrite(db, cityId, who, life, noJustice('not_in_office', 'Only the sitting officeholder can enrol police.'));
        if (!target) return justiceWrite(db, cityId, who, life, noJustice('unknown_player', 'That player is not here.'));
        const justice = justiceOf(politicsOf(ctx, db)), officers = officersOf(justice, seat.id, sitting);
        if (!officers.some(([id]) => id === player) && officers.length >= JUSTICE.officers[tier]) return justiceWrite(db, cityId, who, life, noJustice('police_full', `A ${titleOf(tier, cityId)} can enrol at most ${JUSTICE.officers[tier]} officers.`));
        justice.police[player] = { scope: seat.id, tier, week: sitting.week, by: { id: who.id, name: who.name }, name: ctx.publicSession(target).name, at: ctx.now() };
        return justiceWrite(db, cityId, who, life, { ok: true, code: 'enrolled' });
      });
    },

    'POST /api/politics/justice/dismiss': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId), tier = tierParam(body.tier), player = playerId(body.player), seat = seatOf(cityId, tier);
      return store.transact((db) => {
        const { who, life } = enter(db, request, cityId);
        limit('enrol', who.id, 30);
        const justice = justiceOf(politicsOf(ctx, db)), record = justice.police[player], sitting = sittingOf(db, seat.id);
        if (!record || record.scope !== seat.id) return justiceWrite(db, cityId, who, life, noJustice('not_police', 'That player is not one of this seat’s officers.'));
        if (player !== who.id && sitting?.id !== who.id) return justiceWrite(db, cityId, who, life, noJustice('not_in_office', 'Only the sitting officeholder can dismiss an officer.'));
        delete justice.police[player];
        return justiceWrite(db, cityId, who, life, { ok: true, code: 'dismissed' });
      });
    },

    'POST /api/politics/justice/arrest': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId), offenceId = typeof body.offence === 'string' && /^o\d{1,12}$/.test(body.offence) ? body.offence : null;
      if (!offenceId) throw fail(400, 'invalid_offence');
      return store.transact((db) => {
        const { session, who, life } = enter(db, request, cityId);
        limit('arrest', who.id, 30);
        let after: (() => void) | undefined;
        const outcome = ctx.once(db, session, { id: body.requestId, kind: 'justice.arrest', fingerprint: [cityId, offenceId] }, () => {
          const politics = politicsOf(ctx, db), justice = justiceOf(politics), now = ctx.now();
          const officer = justice.police[who.id];
          if (!officer || !policeIsValid(officer, sittingOf(db, officer.scope))) return noJustice('not_police', 'Only a police officer can arrest. The officeholder enrols officers for their term.');
          const offence = justice.offences[offenceId];
          const block = arrestBlock(justice, now, who.id, offence);
          if (block || !offence) return noJustice(block?.code ?? 'no_such_offence', block?.reason ?? 'That offence is not open any more.');
          if (!inJurisdiction(officer.tier, officer.scope, offence.city, seatsOf(offence.city, offence.city).map((seat) => seat.id))) return noJustice('out_of_jurisdiction', 'That offence is outside your seat’s reach.');
          if (jailOf(justice, who.id, now)) return noJustice('jailed', 'You are in jail yourself.');
          if (life.location === 'home' || isDeparting(life)) return noJustice('not_here', 'The offender is not here. Find them first.');
          const room = venueRoomKey(cityId, life.location, who.id);
          if (!presence.isIn(who.id, room) || !presence.isIn(offence.by.id, room)) return noJustice('not_here', `${offence.by.name} is not here with you. Find them first.`);
          if (!ctx.allow(`politics:arrests:${who.id}`, JUSTICE.arrestsPerHour, 3600000)) return noJustice('arrest_limit', `An officer can make ${JUSTICE.arrestsPerHour} arrests an hour.`);
          const scope = peekScope(politics, officer.scope), minutes = leverValue(scope, govOfId(db, officer.scope), now, SENTENCE_LEVER[officer.tier]);
          const sentence = jail(justice, now, offence, who, officer.tier, minutes);
          const offender = ctx.core.sessionByPublicId(db, offence.by.id);
          if (offender?.cities?.[cityId]?.state) ctx.act(ctx.settle(offender, cityId), { type: 'civic.news', cityId, payload: { items: [{ id: `arrest-${offence.id}`, title: 'You were arrested', text: `${who.name} arrested you. You are in jail for ${sentence.minutes} minutes.`, at: now }] } });
          after = () => { ctx.push(offence.by.id, { type: 'social-sync' }); };
          return { ok: true as const, code: 'arrested' };
        });
        return justiceWrite(db, cityId, who, life, outcome, after);
      });
    },
  };
}
