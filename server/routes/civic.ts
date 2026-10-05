/**
 * OWNER: civic
 * Civic endpoints under /api/civic/. Shared city state is stored under ctx.collection(db, 'civic')
 * (shape: server/civic/data.ts); the rules live in server/civic/*.js and src/game/systems/civic.ts.
 *
 * Conventions
 *   - GET routes take `?city=<cityId>`; POST routes take `cityId` in the JSON body.
 *   - Identity is the device session; only `{ id: publicId, name }` is ever stored or returned.
 *   - Malformed requests throw (400/401/429). A well-formed request the rules refuse answers
 *     200 `{ ok: false, code, reason }` with a reason naming the unmet prerequisite — the same
 *     convention as POST /api/action — and changes nothing.
 *   - Wallet changes go through the rules engine: the routes run the 'civic.run', 'civic.vote',
 *     'civic.rent-ad' and 'civic.shoutout' actions with ctx.act inside the same transaction that
 *     writes the ballot, slot or queue, so both halves commit or neither does.
 *   - Everything is paid in in-game naira through the wallet ledger. There is no real-money path.
 *   - Every route is rate-limited per player (or per address when signed out) on top of the
 *     host's per-address limit.
 *   - A player an operator has muted (ctx.checks.muted) cannot post a slogan, an announcement, an
 *     ad or a shout-out until the mute ends; the refusal says so and charges nothing.
 *   - RETRIES. Every route that charges or creates something on the player's word alone — standing
 *     for Governor, renting an ad, buying a shout-out — takes a MANDATORY `requestId` of the form
 *     `<unix ms>:<uuid>` and goes through ctx.once (server/routes/once.ts): without it 400
 *     client_id_required, the same id again returns the first outcome with `duplicate: true` and
 *     charges nothing, the same id with other contents is 409 client_id_conflict, and an id older
 *     than 24 hours is 409 client_id_expired. A vote needs no id: the ballot itself holds one vote
 *     per player and is written in the same transaction.
 *   - VOTES PER ADDRESS (ctx.config.votesPerAddress, default 3, 0 = off; ctx.config.voteCapMode).
 *     The address is kept only as a salted hash and only for the current election. Many real voters
 *     can share one public address (a mobile carrier's NAT, a school, a hostel), so by DEFAULT
 *     ('flag') a vote beyond that many from one address IS COUNTED and the operator's audit trail
 *     gets one line per address per election: a signal to look at, not a refusal. With
 *     VOTE_CAP_MODE=refuse a vote over the number from a PUBLIC address is refused with a reason
 *     (and nothing is recorded as cast); from a loopback or private-range address — the server is
 *     seeing a proxy or a LAN — it is still counted and logged. A vote is answered `voted` only
 *     when it is on the ballot and saved.
 *   - A life that must still finish character creation is not checked in: it is absent from the
 *     neighbours directory, the rich list and the counters until it has moved in.
 *
 * Routes (response fields besides `serverTime`)
 *   GET  /api/civic/pulse       { city, checkedIn, counters: { players, online, visits }, hunt: { found, today, claims, prize, gemsPerDay },
 *                                 gov: { phase, phaseEndsAt, governor | null }, notices: [{ id, kind, title, text, at }], radio: RadioView | null }
 *   GET  /api/civic/gov         { city, phase, phaseEndsAt, election, governor, lastResult, announcements, rules, you | null }
 *   POST /api/civic/gov/run      { cityId, slogan, requestId } → { ok, code, reason?, duplicate?, state, gov }
 *   POST /api/civic/gov/vote     { cityId, candidate }   → { ok, code, reason?, state, gov }
 *   POST /api/civic/gov/announce { cityId, text }        → { ok, code, reason?, gov }
 *   GET  /api/civic/neighbours  { city, demonym, total, online, listed, hidden, districts: [{ id, label, count, online, homes: [{ id, name, online, you }] }] }
 *   GET  /api/civic/ads         { city, palette, billboards, sea }   — shape documented at adsView() in server/civic/ads.ts
 *   POST /api/civic/ads/rent     { cityId, kind: 'billboard' | 'sea', slot, text, colour, icon, requestId } → { ok, code, reason?, duplicate?, state, ads }
 *   POST /api/civic/ads/remove   { cityId, kind, slot }  → { ok, code, reason?, ads }
 *   GET  /api/civic/hunt        { city, found, today, claims, prize, gemsPerDay, you: { found, total, claimed, canClaim } | null }
 *        (searching and claiming are the game actions 'civic.hunt-search' and 'civic.hunt-claim' on POST /api/action)
 *   GET  /api/civic/radio       ?venue=<venueId>  { city, venue, club, playing, queue, price, slotSeconds, perDay, usedToday, queueMax }
 *   POST /api/civic/radio/shoutout { cityId, title, artist, requestId } → { ok, code, reason?, duplicate?, state, entry, radio }
 *   GET  /api/civic/richlist    { city, week, size, balances, earners, you, counters }
 *   POST /api/civic/prefs        { richList?: boolean, directory?: boolean }  (true = listed) → { ok, prefs: { richList, directory } }
 */
import type { LifeState } from '../../src/types/life.ts';
import type { ActionType } from '../../src/types/actions.ts';
import type { CityId, PlayerRef } from '../../src/types/protocol.ts';
import type { CityCounters, EligibilityCheck, Gate, GovResponse, GovRules, GovYou, HuntResponse, PulseResponse } from '../../src/types/civic.ts';
import type { ActionOutcome, CivicCityRecord, CivicCollection, Db, RouteContext, RouteHandler, RouteKey, RouteRequest, RouteResult } from '../types.ts';
import { isGuestLife } from '../../src/game/systems/onboarding.ts';
import { makeContext } from '../../src/game/util.ts';
import { DEMONYMS, ELECTION, HUNT } from '../../src/game/content/civic.ts';
import { cityContent, cityRules } from '../../src/game/cities/index.ts';
import { civicEligibility, pollingVenueFor } from '../../src/game/systems/civic.ts';
import { cityOf, emptyCivic, nextId } from '../civic/data.ts';
import { cleanLine } from '../civic/text.ts';
import { addressVotes, announce, announceBlock, declare, declareBlock, firstCapNotice, govView, notices, vote, voteBlock } from '../civic/elections.ts';
import { canOccupyVenue, hash53, isSharedAddress } from '../protocol.ts';
import { moderationService } from '../moderation/service.ts';
import { AD_KINDS, adsView, removeAd, rent, rentBlock, validateCreative } from '../civic/ads.ts';
import { addShoutout, isClub, publicEntry, radioView, shoutBlock, validateSong } from '../civic/radio.ts';
import { checkIn, counters, huntCounters, neighboursView, richListView } from '../civic/residents.ts';

const COUNTER_CACHE_MS = 5000;

type Block = { code: string; reason?: string | undefined };

export default function civicRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const { store, fail } = ctx;
  const ttl = () => ctx.config.sessionTtlMs;
  const cityName = (cityId: CityId): string => cityRules(cityId)?.name ?? cityId;
  const districts = (cityId: CityId) => cityRules(cityId)?.districts ?? [];

  const cityParam = (value: unknown): CityId => { const found = ctx.cityIds.find((id) => id === value); if (typeof value !== 'string' || found === undefined) throw fail(400, 'invalid_city'); return found; };
  const limit = (bucket: string, key: string, count: number, windowMs = 60000): void => { if (!ctx.allow(`civic:${bucket}:${key}`, count, windowMs)) throw fail(429, 'civic_rate_limited'); };
  const civicOf = (db: Db): CivicCollection => ctx.collection(db, 'civic', emptyCivic());
  const engine = (cityId: CityId, op: string) => makeContext({ now: ctx.now(), cityId, seed: `civic|${op}|${ctx.now()}` });
  /** Run a server-completed civic action through the rules engine, inside the caller's transaction. */
  // Inside ctx.once the receipt covers the action; elsewhere `guard` says why a repeat cannot apply twice (ctx.act in server.js).
  const act = (life: LifeState, cityId: CityId, type: ActionType, payload: Record<string, unknown> = {}, guard?: string): ActionOutcome => ctx.act(life, { type, cityId, payload, ...(guard ? { stateGuard: guard } : {}) });
  const refused = (block: Block, extra: object = {}): RouteResult => ({ body: { ok: false, code: block.code, reason: block.reason, ...extra }, renew: true });
  const muted = (who: PlayerRef): Block | null => ctx.checks?.muted?.(who.id) ?? null;
  const moderation = moderationService(ctx);
  /** Pseudonymous key for an address: a hash salted with a random value stored once in the civic collection. */
  function addressKey(civic: CivicCollection, ip: string): string {
    if (typeof civic.salt !== 'string' || civic.salt.length < 16) civic.salt = `${ctx.randomId?.() ?? ''}${ctx.now()}`;
    return hash53(`${civic.salt}|${ip}`);
  }
  // Preferences of players who are no longer residents anywhere are dropped once an hour.
  function prunePrefs(civic: CivicCollection): void {
    if (ctx.now() - (typeof civic.prefsPrunedAt === 'number' && Number.isFinite(civic.prefsPrunedAt) ? civic.prefsPrunedAt : 0) < 3600000) return;
    civic.prefsPrunedAt = ctx.now();
    const known = new Set(Object.values(civic.cities).flatMap((city) => Object.keys(city?.residents ?? {})));
    for (const id of Object.keys(civic.prefs)) if (!known.has(id)) delete civic.prefs[id];
  }

  /** Signed-in entry to a write: settle the life and refresh the caller's resident entry. */
  function enter(db: Db, request: RouteRequest, cityId: CityId) {
    const session = request.requireSession(db, { renew: true });
    const who = ctx.publicSession(session);
    const life = ctx.settle(session, cityId);
    const civic = civicOf(db), city = cityOf(civic, cityId);
    // A life still held for the quick start (Play not confirmed) is not a resident yet: it is in no directory, list or counter.
    // Nor is a guest who is playing: a guest has no local government and no house, so it is in no residents directory, estate
    // or rich list until it settles in (src/game/systems/onboarding.ts THE STAGED MODEL). It still plays, travels and meets people.
    const resident = !(life.onboarding?.required === true && life.onboarding.done !== true) && !isGuestLife(life);
    if (resident) checkIn(city, ctx.now(), who, life, ttl(), districts(cityId));
    prunePrefs(civic);
    return { session, who, life, civic, city, resident };
  }
  /** Read-only view of the same things. Works on the snapshot, so nothing it settles is saved. */
  function peek(db: Db, request: RouteRequest, cityId: CityId) {
    const session = request.session(db);
    const civic = civicOf(db), city = cityOf(civic, cityId);
    return { session, who: session ? ctx.publicSession(session) : null, life: session ? ctx.settle(session, cityId) : null, civic, city };
  }
  const viewerKey = (request: RouteRequest, who: PlayerRef | null): string => who?.id ?? `ip:${request.ip}`;

  // Presence is a scan over open sockets per resident, so the city totals are cached briefly.
  const counterCache = new Map<CityId, { at: number; value: CityCounters }>();
  function cityCounters(city: CivicCityRecord, cityId: CityId): CityCounters {
    const hit = counterCache.get(cityId), now = ctx.now();
    if (hit && now >= hit.at && now - hit.at < COUNTER_CACHE_MS) return hit.value;
    const value = counters(city, now, ttl(), ctx.online);
    counterCache.set(cityId, { at: now, value });
    return value;
  }

  const rules = (cityId: CityId): GovRules => ({ beta: true, minDaysToRun: ELECTION.minDaysToRun, minDaysToVote: ELECTION.minDaysToVote, minWorkDays: ELECTION.minWorkDays, votesPerAddress: ctx.config.votesPerAddress, filingFee: ELECTION.filingFee, sloganMin: ELECTION.sloganMin, sloganMax: ELECTION.sloganMax,
    maxCandidates: ELECTION.maxCandidates, announcementMax: ELECTION.announcement.max, announcementsPerDay: ELECTION.announcement.perDay,
    pollingVenue: pollingVenueFor(cityId)?.id ?? null });

  /** Governor state plus, for a signed-in viewer, exactly why they can or cannot run, vote and announce. */
  function govBody(city: CivicCityRecord, cityId: CityId, who: PlayerRef | null, life: LifeState | null): GovResponse {
    const now = ctx.now(), view = govView(city, now, who?.id ?? null);
    let you: GovYou | null = null;
    if (who && life) {
      const eligibility = civicEligibility(life, engine(cityId, 'eligibility'));
      const unmet = (checks: EligibilityCheck[]) => { const item = checks.find((entry) => !entry.met); return item ? { code: item.code, reason: `${item.label}. ${item.detail}` } : null; };
      const gate = (block: { code: string; reason: string } | null): Gate => (block ? { ok: false, code: block.code, reason: block.reason } : { ok: true });
      const youBody: GovYou = {
        days: eligibility.days, isGovernor: view.governor?.id === who.id, isCandidate: view.election.candidates.some((item) => item.you), votedFor: view.election.yourVote,
        run: { ...gate(declareBlock(city, now, who.id) ?? unmet(eligibility.run)), checks: eligibility.run },
        vote: { ...gate(voteBlock(city, now, who.id, view.election.candidates[0]?.id ?? '') ?? unmet(eligibility.vote)), checks: eligibility.vote },
        announce: gate(announceBlock(city, now, who.id)),
      };
      // With an empty ballot the only thing missing is a candidate; say that rather than "unknown candidate".
      if (!youBody.vote.ok && youBody.vote.code === 'unknown_candidate') youBody.vote.reason = 'Nobody is on the ballot yet, so there is no one to vote for.';
      you = youBody;
    }
    return { city: cityId, ...view, rules: rules(cityId), you };
  }

  const huntBody = (city: CivicCityRecord, cityId: CityId, life: LifeState | null): HuntResponse => {
    const mine = life?.civic?.hunt;
    const found = mine ? mine.gems.filter((gem) => gem.found).length : 0;
    return { city: cityId, ...huntCounters(city, ctx.now()), prize: HUNT.prize, gemsPerDay: HUNT.gemsPerDay,
      you: mine ? { found, total: mine.gems.length, claimed: mine.claimed, canClaim: found === mine.gems.length && !mine.claimed } : null };
  };

  function pulseBody(city: CivicCityRecord, cityId: CityId, who: PlayerRef | null, life: LifeState | null, checkedIn: boolean): PulseResponse {
    const now = ctx.now(), view = govView(city, now, who?.id ?? null);
    const hunt = huntCounters(city, now);
    const venue = life && canOccupyVenue(life, life.location) ? life.location : null;
    return { city: cityId, checkedIn, counters: cityCounters(city, cityId),
      hunt: { ...hunt, prize: HUNT.prize, gemsPerDay: HUNT.gemsPerDay },
      gov: { phase: view.phase, phaseEndsAt: view.phaseEndsAt, governor: view.governor },
      notices: notices(city, now, cityName(cityId)),
      radio: venue && isClub(venue, cityContent(cityId).radioVenueIds) ? radioView(city, now, venue, who?.id ?? null, cityContent(cityId).radioVenueIds) : null };
  }

  return {
    'GET /api/civic/pulse': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const signedIn = await store.read(db => request.session(db)?.publicId ?? null);
      limit('pulse', signedIn ?? `ip:${request.ip}`, 60);
      // A signed-in pulse is the check-in that keeps the directory, the rich list and the gem
      // counter current; it is allowed a few writes a minute and is read-only beyond that.
      if (signedIn && ctx.allow(`civic:checkin:${signedIn}`, 6)) {
        const body = await store.transact(db => {
          const { who, life, city, resident } = enter(db, request, cityId);
          counterCache.delete(cityId);
          // City news the resident has not been told yet goes into their own Updates feed, once.
          const fresh = resident ? notices(city, ctx.now(), cityName(cityId)).filter((item) => !life.civic.news.includes(item.id)) : [];
          if (fresh.length) act(life, cityId, 'civic.news', { items: fresh.map(({ id, title, text, at }) => ({ id, title, text, at })) }, 'only notices whose id is not yet in life.civic.news are posted');
          return pulseBody(city, cityId, who, life, resident);
        }, { durable: false }); // a check-in acknowledges nothing: news not yet stored is simply posted again
        return { body, renew: true };
      }
      return { body: await store.read(db => { const { who, life, city } = peek(db, request, cityId); return pulseBody(city, cityId, who, life, false); }) };
    },

    // ---- governor -------------------------------------------------------------------------
    'GET /api/civic/gov': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const body = await store.read(db => { const { who, life, city } = peek(db, request, cityId); limit('read', viewerKey(request, who), 120); return govBody(city, cityId, who, life); });
      return { body };
    },
    'POST /api/civic/gov/run': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      const slogan = cleanLine(body.slogan, { min: ELECTION.sloganMin, max: ELECTION.sloganMax, what: 'Your slogan' });
      return store.transact(db => {
        const { session, who, life, city } = enter(db, request, cityId);
        limit('gov-run', who.id, 12);
        // The filing fee and the ballot entry are one receipted step: a retry with the same id pays nothing more.
        const outcome = ctx.once(db, session, { id: body.requestId, kind: 'civic.run', fingerprint: [cityId, slogan.ok ? slogan.text : String(body.slogan ?? '')] }, () => {
          const block = declareBlock(city, ctx.now(), who.id) ?? muted(who);
          if (block) return { ok: false, code: block.code, reason: block.reason };
          if (!slogan.ok) return { ok: false, code: slogan.code, reason: slogan.reason };
          const paid = act(life, cityId, 'civic.run');
          if (!paid.ok) return { ok: false, code: paid.code, reason: paid.reason };
          declare(city, ctx.now(), who, slogan.text);
          checkIn(city, ctx.now(), who, life, ttl(), districts(cityId));
          return { ok: true, code: 'declared' };
        });
        return { body: { ...outcome, state: life, gov: govBody(city, cityId, who, life) }, renew: true };
      });
    },
    'POST /api/civic/gov/vote': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      return store.transact(db => {
        const { who, life, civic, city } = enter(db, request, cityId);
        limit('gov-vote', who.id, 12);
        const block = voteBlock(city, ctx.now(), who.id, body.candidate);
        if (block) return refused(block, { state: life, gov: govBody(city, cityId, who, life) });
        // Votes per network address (see the header). It applies only to a vote that would otherwise
        // count — an ineligible voter is told what they are missing instead — and it is decided BEFORE the
        // rules engine records the vote in the life, so a refused vote leaves no trace of having been cast.
        const cap = ctx.config.votesPerAddress, key = addressKey(civic, request.ip);
        const eligible = civicEligibility(life, engine(cityId, 'vote')).vote.every((item) => item.met);
        if (eligible && cap > 0 && addressVotes(city, ctx.now(), key) >= cap) {
          const shared = isSharedAddress(request.ip);
          const refuse = ctx.config.voteCapMode === 'refuse' && !shared;
          if (firstCapNotice(city, ctx.now(), key)) {
            const week = `${cityId}:week ${govView(city, ctx.now()).election.week}`;
            if (refuse) moderation.audit(db, 'vote-cap', week, `Votes over the cap of ${cap} from one address (key ${key}) are being refused (VOTE_CAP_MODE=refuse). Many real voters can share a public address; unset VOTE_CAP_MODE to count and flag instead.`, 'server');
            else if (ctx.config.voteCapMode === 'refuse') moderation.audit(db, 'vote-cap-shared', week, `More than ${cap} votes from one private or loopback address (key ${key}). They are being counted: the server cannot tell voters apart behind a shared address. Set TRUST_PROXY=1 behind a proxy, or raise VOTES_PER_ADDRESS.`, 'server');
            else moderation.audit(db, 'vote-cap-flag', week, `More than ${cap} votes from one address (key ${key}). They are all being counted: this is a signal to look at, not a refusal — it may be one person with several sessions, or many people behind one connection (a mobile carrier, a school).`, 'server');
          }
          if (refuse) {
            return refused({ code: 'address_vote_limit', reason: `${cap} votes have already been counted from your network connection in this election, which is the most this server allows from one connection. Your vote was not counted. If you share a connection (a mobile network, a school, an office, a hostel), ask whoever runs this server to lift the limit, or vote from another connection.` },
              { state: life, gov: govBody(city, cityId, who, life) });
          }
        }
        const allowed = act(life, cityId, 'civic.vote', {}, 'voteBlock refuses a second vote and the ballot entry is written in this transaction');
        if (!allowed.ok) return refused(allowed, { state: life, gov: govBody(city, cityId, who, life) });
        if (typeof body.candidate !== 'string') return refused({ code: 'unknown_candidate', reason: 'Choose a candidate from this week’s ballot.' }, { state: life, gov: govBody(city, cityId, who, life) }); // voteBlock has already refused this
        vote(city, ctx.now(), who.id, body.candidate, key);
        return { body: { ok: true, code: 'voted', state: life, gov: govBody(city, cityId, who, life) }, renew: true };
      });
    },
    'POST /api/civic/gov/announce': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      const text = cleanLine(body.text, { min: ELECTION.announcement.min, max: ELECTION.announcement.max, what: 'An announcement' });
      return store.transact(db => {
        const { who, life, city } = enter(db, request, cityId);
        limit('gov-announce', who.id, 6);
        const block = announceBlock(city, ctx.now(), who.id) ?? muted(who) ?? (text.ok ? null : text);
        if (block) return refused(block, { gov: govBody(city, cityId, who, life) });
        if (!text.ok) return refused(text, { gov: govBody(city, cityId, who, life) });
        announce(city, ctx.now(), who, text.text, nextId(city, 'a'));
        return { body: { ok: true, code: 'announced', gov: govBody(city, cityId, who, life) }, renew: true };
      });
    },

    // ---- neighbours -----------------------------------------------------------------------
    'GET /api/civic/neighbours': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const body = await store.read(db => {
        const session = request.requireSession(db);
        const { civic, city } = peek(db, request, cityId);
        const viewer = ctx.publicSession(session);
        limit('read', session.publicId, 120);
        return { city: cityId, demonym: DEMONYMS[cityId] ?? `${cityName(cityId)} residents`, hidden: civic.prefs[viewer.id]?.directory === true,
          ...neighboursView(city, ctx.now(), ttl(), ctx.online, civic.prefs, viewer.id, districts(cityId)) };
      });
      return { body };
    },

    // ---- billboards and sea plots ---------------------------------------------------------
    'GET /api/civic/ads': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const body = await store.read(db => { const session = request.session(db); limit('read', session?.publicId ?? `ip:${request.ip}`, 120); return { city: cityId, ...adsView(cityOf(civicOf(db), cityId), ctx.now(), session?.publicId ?? null, cityContent(cityId).billboardRoads) }; });
      return { body };
    },
    'POST /api/civic/ads/rent': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      const creative = validateCreative(body);
      return store.transact(db => {
        const { session, who, life, city } = enter(db, request, cityId);
        limit('ads-rent', who.id, 30);
        const outcome = ctx.once(db, session, { id: body.requestId, kind: 'civic.rent-ad', fingerprint: [cityId, body.kind, body.slot, creative.ok ? creative.creative.text : body.text, body.colour, body.icon].map((part) => String(part ?? '')) }, () => {
          const block = rentBlock(city, ctx.now(), who.id, body.kind, body.slot, cityContent(cityId).billboardRoads) ?? muted(who);
          if (block) return { ok: false, code: block.code, reason: block.reason };
          if (!creative.ok) return { ok: false, code: creative.code, reason: creative.reason };
          const paid = act(life, cityId, 'civic.rent-ad', { kind: body.kind, slot: body.slot });
          if (!paid.ok) return { ok: false, code: paid.code, reason: paid.reason };
          rent(city, ctx.now(), who, body.kind, body.slot, creative.creative, cityContent(cityId).billboardRoads);
          checkIn(city, ctx.now(), who, life, ttl(), districts(cityId));
          return { ok: true, code: 'rented' };
        });
        return { body: { ...outcome, state: life, ads: { city: cityId, ...adsView(city, ctx.now(), who.id, cityContent(cityId).billboardRoads) } }, renew: true };
      });
    },
    'POST /api/civic/ads/remove': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      if (!AD_KINDS.some((kind) => kind === body.kind) || typeof body.slot !== 'string' || body.slot.length > 16) throw fail(400, 'invalid_slot');
      return store.transact(db => {
        const { who, city } = enter(db, request, cityId);
        limit('ads-remove', who.id, 12);
        const block = removeAd(city, ctx.now(), who.id, body.kind, body.slot);
        const ads = { city: cityId, ...adsView(city, ctx.now(), who.id, cityContent(cityId).billboardRoads) };
        return block ? refused(block, { ads }) : { body: { ok: true, code: 'removed', ads }, renew: true };
      });
    },

    // ---- daily gem hunt -------------------------------------------------------------------
    'GET /api/civic/hunt': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const body = await store.read(db => { const { who, life, city } = peek(db, request, cityId); limit('read', viewerKey(request, who), 120); return huntBody(city, cityId, life); });
      return { body };
    },

    // ---- club radio -----------------------------------------------------------------------
    'GET /api/civic/radio': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const venue = request.query.get('venue');
      if (typeof venue !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(venue)) throw fail(400, 'invalid_venue');
      const body = await store.read(db => { const session = request.session(db); limit('read', session?.publicId ?? `ip:${request.ip}`, 120); return { city: cityId, ...radioView(cityOf(civicOf(db), cityId), ctx.now(), venue, session?.publicId ?? null, cityContent(cityId).radioVenueIds) }; });
      return { body };
    },
    'POST /api/civic/radio/shoutout': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      const song = validateSong(body);
      return store.transact(db => {
        const { session, who, life, city } = enter(db, request, cityId);
        limit('radio', who.id, 6);
        const now = ctx.now(), venue = life.location;
        // A retried request (same id) returns the entry it already bought instead of charging again.
        const outcome = ctx.once(db, session, { id: body.requestId, kind: 'civic.shoutout', fingerprint: [cityId, ...(song.ok ? [song.song.title, song.song.artist] : [String(body.title ?? ''), String(body.artist ?? '')])] }, () => {
          const block = shoutBlock(city, now, who.id, venue, cityContent(cityId).radioVenueIds) ?? muted(who);
          if (block) return { ok: false, code: block.code, reason: block.reason };
          if (!song.ok) return { ok: false, code: song.code, reason: song.reason };
          const paid = act(life, cityId, 'civic.shoutout');
          if (!paid.ok) return { ok: false, code: paid.code, reason: paid.reason };
          const entry = addShoutout(city, now, who, venue, song.song, nextId(city, 'r'), typeof body.requestId === 'string' ? body.requestId : null);
          checkIn(city, now, who, life, ttl(), districts(cityId));
          return { ok: true, code: 'queued', entry: publicEntry(entry, who.id) };
        });
        return { body: { ...outcome, state: life, radio: { city: cityId, ...radioView(city, ctx.now(), venue, who.id, cityContent(cityId).radioVenueIds) } }, renew: true };
      });
    },

    // ---- rich list and preferences --------------------------------------------------------
    'GET /api/civic/richlist': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const signedIn = await store.read(db => request.session(db)?.publicId ?? null);
      limit('read', signedIn ?? `ip:${request.ip}`, 120);
      const build = (civic: CivicCollection, city: CivicCityRecord, who: PlayerRef | null) => ({ city: cityId, ...richListView(city, ctx.now(), ttl(), civic.prefs, who?.id ?? null), counters: cityCounters(city, cityId) });
      // Opening the list checks the viewer in first, so their own row is never stale.
      if (signedIn && ctx.allow(`civic:checkin:${signedIn}`, 6)) {
        const body = await store.transact(db => { const { who, civic, city } = enter(db, request, cityId); counterCache.delete(cityId); return build(civic, city, who); }, { durable: false });
        return { body, renew: true };
      }
      return { body: await store.read(db => { const { who, civic, city } = peek(db, request, cityId); return build(civic, city, who); }) };
    },
    'POST /api/civic/prefs': async (request) => {
      const body = await request.json();
      const prefKeys = ['richList', 'directory'] as const;
      for (const key of prefKeys) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw fail(400, 'invalid_prefs');
      const prefs = await store.transact(db => {
        const session = request.requireSession(db, { renew: true });
        limit('prefs', session.publicId, 12);
        const civic = civicOf(db);
        if (civic.prefs === null || typeof civic.prefs !== 'object' || Array.isArray(civic.prefs)) civic.prefs = {};
        const mine = { ...civic.prefs[session.publicId] };
        // Stored as "hidden" flags so that the default (no entry) is listed.
        for (const key of prefKeys) if (body[key] === true) delete mine[key]; else if (body[key] === false) mine[key] = true;
        if (Object.keys(mine).length) civic.prefs[session.publicId] = mine; else delete civic.prefs[session.publicId];
        return { richList: mine.richList !== true, directory: mine.directory !== true, id: session.publicId };
      // Once the preference is in the file the world registry follows it (server/world/service.ts): a hidden player's house stays on the map, anonymous.
      }, { committed: (saved) => ctx.emit('directory-pref', { id: saved.id, hidden: saved.directory !== true }) });
      return { body: { ok: true, prefs: { richList: prefs.richList, directory: prefs.directory } }, renew: true };
    },
  };
}
