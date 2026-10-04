/**
 * OWNER: civic
 * Civic endpoints under /api/civic/. Shared city state is stored under ctx.collection(db, 'civic')
 * (shape: server/civic/data.js); the rules live in server/civic/*.js and src/game/systems/civic.js.
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
 *   - A life that must still finish character creation is not checked in: it is absent from the
 *     neighbours directory, the rich list and the counters until it has moved in.
 *
 * Routes (response fields besides `serverTime`)
 *   GET  /api/civic/pulse       { city, checkedIn, counters: { players, online, visits }, hunt: { found, today, claims, prize, gemsPerDay },
 *                                 gov: { phase, phaseEndsAt, governor | null }, notices: [{ id, kind, title, text, at }], radio: RadioView | null }
 *   GET  /api/civic/gov         { city, phase, phaseEndsAt, election, governor, lastResult, announcements, rules, you | null }
 *   POST /api/civic/gov/run      { cityId, slogan }      → { ok, code, reason?, state, gov }
 *   POST /api/civic/gov/vote     { cityId, candidate }   → { ok, code, reason?, state, gov }
 *   POST /api/civic/gov/announce { cityId, text }        → { ok, code, reason?, gov }
 *   GET  /api/civic/neighbours  { city, demonym, total, online, listed, hidden, districts: [{ id, label, count, online, homes: [{ id, name, online, you }] }] }
 *   GET  /api/civic/ads         { city, palette, billboards, sea }   — shape documented at adsView() in server/civic/ads.js
 *   POST /api/civic/ads/rent     { cityId, kind: 'billboard' | 'sea', slot, text, colour, icon } → { ok, code, reason?, state, ads }
 *   POST /api/civic/ads/remove   { cityId, kind, slot }  → { ok, code, reason?, ads }
 *   GET  /api/civic/hunt        { city, found, today, claims, prize, gemsPerDay, you: { found, total, claimed, canClaim } | null }
 *        (searching and claiming are the game actions 'civic.hunt-search' and 'civic.hunt-claim' on POST /api/action)
 *   GET  /api/civic/radio       ?venue=<venueId>  { city, venue, club, playing, queue, price, slotSeconds, perDay, usedToday, queueMax }
 *   POST /api/civic/radio/shoutout { cityId, title, artist, requestId? } → { ok, code, reason?, duplicate?, state, entry, radio }
 *   GET  /api/civic/richlist    { city, week, size, balances, earners, you, counters }
 *   POST /api/civic/prefs        { richList?: boolean, directory?: boolean }  (true = listed) → { ok, prefs: { richList, directory } }
 */
import { makeContext } from '../../src/game/util.js';
import { VENUES } from '../../src/game/content/venues.js';
import { DEMONYMS, ELECTION, HUNT } from '../../src/game/content/civic.js';
import { civicEligibility } from '../../src/game/systems/civic.js';
import { cityOf, emptyCivic, nextId } from '../civic/data.js';
import { cleanLine } from '../civic/text.js';
import { announce, announceBlock, declare, declareBlock, govView, notices, vote, voteBlock } from '../civic/elections.js';
import { AD_KINDS, adsView, removeAd, rent, rentBlock, validateCreative } from '../civic/ads.js';
import { addShoutout, findRequest, isClub, publicEntry, radioView, shoutBlock, validateSong, validRequestId } from '../civic/radio.js';
import { checkIn, counters, huntCounters, neighboursView, richListView } from '../civic/residents.js';

const CITY_NAMES = { lagos: 'Lagos', ibadan: 'Ibadan' };
const COUNTER_CACHE_MS = 5000;

export default function civicRoutes(ctx) {
  const { store, fail } = ctx;
  const ttl = () => ctx.config.sessionTtlMs;
  const cityName = (cityId) => CITY_NAMES[cityId] ?? cityId;

  const cityParam = (value) => { if (typeof value !== 'string' || !ctx.cityIds.includes(value)) throw fail(400, 'invalid_city'); return value; };
  const limit = (bucket, key, count, windowMs = 60000) => { if (!ctx.allow(`civic:${bucket}:${key}`, count, windowMs)) throw fail(429, 'civic_rate_limited'); };
  const civicOf = (db) => ctx.collection(db, 'civic', emptyCivic());
  const engine = (cityId, op) => makeContext({ now: ctx.now(), cityId, seed: `civic|${op}|${ctx.now()}` });
  /** Run a server-completed civic action through the rules engine, inside the caller's transaction. */
  const act = (life, cityId, type, payload = {}) => ctx.act(life, { type, cityId, payload });
  const refused = (block, extra = {}) => ({ body: { ok: false, code: block.code, reason: block.reason, ...extra }, renew: true });

  /** Signed-in entry to a write: settle the life and refresh the caller's resident entry. */
  function enter(db, request, cityId) {
    const session = request.requireSession(db, { renew: true });
    const who = ctx.publicSession(session);
    const life = ctx.settle(session, cityId);
    const civic = civicOf(db), city = cityOf(civic, cityId);
    // A life that must still be created is not a resident yet: it is in no directory, list or counter.
    const resident = !(life.onboarding?.required === true && life.onboarding.done !== true);
    if (resident) checkIn(city, ctx.now(), who, life, ttl());
    return { session, who, life, civic, city, resident };
  }
  /** Read-only view of the same things. Works on the snapshot, so nothing it settles is saved. */
  function peek(db, request, cityId) {
    const session = request.session(db);
    const civic = civicOf(db), city = cityOf(civic, cityId);
    return { session, who: session ? ctx.publicSession(session) : null, life: session ? ctx.settle(session, cityId) : null, civic, city };
  }
  const viewerKey = (request, who) => who?.id ?? `ip:${request.ip}`;

  // Presence is a scan over open sockets per resident, so the city totals are cached briefly.
  const counterCache = new Map();
  function cityCounters(city, cityId) {
    const hit = counterCache.get(cityId), now = ctx.now();
    if (hit && now >= hit.at && now - hit.at < COUNTER_CACHE_MS) return hit.value;
    const value = counters(city, now, ttl(), ctx.online);
    counterCache.set(cityId, { at: now, value });
    return value;
  }

  const rules = () => ({ beta: true, minDaysToRun: ELECTION.minDaysToRun, minDaysToVote: ELECTION.minDaysToVote, filingFee: ELECTION.filingFee, sloganMin: ELECTION.sloganMin, sloganMax: ELECTION.sloganMax,
    maxCandidates: ELECTION.maxCandidates, announcementMax: ELECTION.announcement.max, announcementsPerDay: ELECTION.announcement.perDay,
    pollingVenue: Object.hasOwn(VENUES, ELECTION.pollingVenue) ? ELECTION.pollingVenue : null });

  /** Governor state plus, for a signed-in viewer, exactly why they can or cannot run, vote and announce. */
  function govBody(city, cityId, who, life) {
    const now = ctx.now(), view = govView(city, now, who?.id ?? null);
    let you = null;
    if (who && life) {
      const eligibility = civicEligibility(life, engine(cityId, 'eligibility'));
      const unmet = (checks) => { const item = checks.find((entry) => !entry.met); return item ? { code: item.code, reason: `${item.label}. ${item.detail}` } : null; };
      const gate = (block) => (block ? { ok: false, code: block.code, reason: block.reason } : { ok: true });
      you = {
        days: eligibility.days, isGovernor: view.governor?.id === who.id, isCandidate: view.election.candidates.some((item) => item.you), votedFor: view.election.yourVote,
        run: { ...gate(declareBlock(city, now, who.id) ?? unmet(eligibility.run)), checks: eligibility.run },
        vote: { ...gate(voteBlock(city, now, who.id, view.election.candidates[0]?.id ?? '') ?? unmet(eligibility.vote)), checks: eligibility.vote },
        announce: gate(announceBlock(city, now, who.id)),
      };
      // With an empty ballot the only thing missing is a candidate; say that rather than "unknown candidate".
      if (!you.vote.ok && you.vote.code === 'unknown_candidate') you.vote.reason = 'Nobody is on the ballot yet, so there is no one to vote for.';
    }
    return { city: cityId, ...view, rules: rules(), you };
  }

  const huntBody = (city, cityId, life) => {
    const mine = life?.civic?.hunt;
    const found = mine ? mine.gems.filter((gem) => gem.found).length : 0;
    return { city: cityId, ...huntCounters(city, ctx.now()), prize: HUNT.prize, gemsPerDay: HUNT.gemsPerDay,
      you: mine ? { found, total: mine.gems.length, claimed: mine.claimed, canClaim: found === mine.gems.length && !mine.claimed } : null };
  };

  function pulseBody(city, cityId, who, life, checkedIn) {
    const now = ctx.now(), view = govView(city, now, who?.id ?? null);
    const hunt = huntCounters(city, now);
    const venue = life && life.activeAction?.kind !== 'travel' ? life.location : null;
    return { city: cityId, checkedIn, counters: cityCounters(city, cityId),
      hunt: { ...hunt, prize: HUNT.prize, gemsPerDay: HUNT.gemsPerDay },
      gov: { phase: view.phase, phaseEndsAt: view.phaseEndsAt, governor: view.governor },
      notices: notices(city, now, cityName(cityId)),
      radio: venue && isClub(venue) ? radioView(city, now, venue, who.id) : null };
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
          if (fresh.length) act(life, cityId, 'civic.news', { items: fresh.map(({ id, title, text, at }) => ({ id, title, text, at })) });
          return pulseBody(city, cityId, who, life, resident);
        });
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
        const { who, life, city } = enter(db, request, cityId);
        limit('gov-run', who.id, 12);
        const block = declareBlock(city, ctx.now(), who.id) ?? (slogan.ok ? null : slogan);
        if (block) return refused(block, { state: life, gov: govBody(city, cityId, who, life) });
        const paid = act(life, cityId, 'civic.run');
        if (!paid.ok) return refused(paid, { state: life, gov: govBody(city, cityId, who, life) });
        declare(city, ctx.now(), who, slogan.text);
        checkIn(city, ctx.now(), who, life, ttl());
        return { body: { ok: true, code: 'declared', state: life, gov: govBody(city, cityId, who, life) }, renew: true };
      });
    },
    'POST /api/civic/gov/vote': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      return store.transact(db => {
        const { who, life, city } = enter(db, request, cityId);
        limit('gov-vote', who.id, 12);
        const block = voteBlock(city, ctx.now(), who.id, body.candidate);
        if (block) return refused(block, { state: life, gov: govBody(city, cityId, who, life) });
        const allowed = act(life, cityId, 'civic.vote');
        if (!allowed.ok) return refused(allowed, { state: life, gov: govBody(city, cityId, who, life) });
        vote(city, ctx.now(), who.id, body.candidate);
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
        const block = announceBlock(city, ctx.now(), who.id) ?? (text.ok ? null : text);
        if (block) return refused(block, { gov: govBody(city, cityId, who, life) });
        announce(city, ctx.now(), who, text.text, nextId(city, 'a'));
        return { body: { ok: true, code: 'announced', gov: govBody(city, cityId, who, life) }, renew: true };
      });
    },

    // ---- neighbours -----------------------------------------------------------------------
    'GET /api/civic/neighbours': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const body = await store.read(db => {
        const session = request.requireSession(db);
        const { who, civic, city } = peek(db, request, cityId);
        limit('read', session.publicId, 120);
        return { city: cityId, demonym: DEMONYMS[cityId] ?? `${cityName(cityId)} residents`, hidden: civic.prefs[who.id]?.directory === true,
          ...neighboursView(city, ctx.now(), ttl(), ctx.online, civic.prefs, who.id) };
      });
      return { body };
    },

    // ---- billboards and sea plots ---------------------------------------------------------
    'GET /api/civic/ads': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const body = await store.read(db => { const session = request.session(db); limit('read', session?.publicId ?? `ip:${request.ip}`, 120); return { city: cityId, ...adsView(cityOf(civicOf(db), cityId), ctx.now(), session?.publicId ?? null) }; });
      return { body };
    },
    'POST /api/civic/ads/rent': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      const creative = validateCreative(body);
      return store.transact(db => {
        const { who, life, city } = enter(db, request, cityId);
        limit('ads-rent', who.id, 30);
        const ads = () => ({ city: cityId, ...adsView(city, ctx.now(), who.id) });
        const block = rentBlock(city, ctx.now(), who.id, body.kind, body.slot) ?? (creative.ok ? null : creative);
        if (block) return refused(block, { state: life, ads: ads() });
        const paid = act(life, cityId, 'civic.rent-ad', { kind: body.kind, slot: body.slot });
        if (!paid.ok) return refused(paid, { state: life, ads: ads() });
        rent(city, ctx.now(), who, body.kind, body.slot, creative.creative);
        checkIn(city, ctx.now(), who, life, ttl());
        return { body: { ok: true, code: 'rented', state: life, ads: ads() }, renew: true };
      });
    },
    'POST /api/civic/ads/remove': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      if (!AD_KINDS.includes(body.kind) || typeof body.slot !== 'string' || body.slot.length > 16) throw fail(400, 'invalid_slot');
      return store.transact(db => {
        const { who, city } = enter(db, request, cityId);
        limit('ads-remove', who.id, 12);
        const block = removeAd(city, ctx.now(), who.id, body.kind, body.slot);
        const ads = { city: cityId, ...adsView(city, ctx.now(), who.id) };
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
      const body = await store.read(db => { const session = request.session(db); limit('read', session?.publicId ?? `ip:${request.ip}`, 120); return { city: cityId, ...radioView(cityOf(civicOf(db), cityId), ctx.now(), venue, session?.publicId ?? null) }; });
      return { body };
    },
    'POST /api/civic/radio/shoutout': async (request) => {
      const body = await request.json();
      const cityId = cityParam(body.cityId);
      const song = validateSong(body), requestId = validRequestId(body.requestId);
      return store.transact(db => {
        const { who, life, city } = enter(db, request, cityId);
        limit('radio', who.id, 6);
        const now = ctx.now(), venue = life.location;
        const radio = () => ({ city: cityId, ...radioView(city, ctx.now(), venue, who.id) });
        // A retried request (same id) returns the entry it already bought instead of charging again.
        const earlier = isClub(venue) ? findRequest(city, venue, now, who.id, requestId) : null;
        if (earlier) return { body: { ok: true, code: 'queued', duplicate: true, state: life, entry: publicEntry(earlier, who.id), radio: radio() }, renew: true };
        const block = shoutBlock(city, now, who.id, venue) ?? (song.ok ? null : song);
        if (block) return refused(block, { state: life, radio: radio() });
        const paid = act(life, cityId, 'civic.shoutout');
        if (!paid.ok) return refused(paid, { state: life, radio: radio() });
        const entry = addShoutout(city, now, who, venue, song.song, nextId(city, 'r'), requestId);
        checkIn(city, now, who, life, ttl());
        return { body: { ok: true, code: 'queued', state: life, entry: publicEntry(entry, who.id), radio: radio() }, renew: true };
      });
    },

    // ---- rich list and preferences --------------------------------------------------------
    'GET /api/civic/richlist': async (request) => {
      const cityId = cityParam(request.query.get('city'));
      const signedIn = await store.read(db => request.session(db)?.publicId ?? null);
      limit('read', signedIn ?? `ip:${request.ip}`, 120);
      const build = (civic, city, who) => ({ city: cityId, ...richListView(city, ctx.now(), ttl(), civic.prefs, who?.id ?? null), counters: cityCounters(city, cityId) });
      // Opening the list checks the viewer in first, so their own row is never stale.
      if (signedIn && ctx.allow(`civic:checkin:${signedIn}`, 6)) {
        const body = await store.transact(db => { const { who, civic, city } = enter(db, request, cityId); counterCache.delete(cityId); return build(civic, city, who); });
        return { body, renew: true };
      }
      return { body: await store.read(db => { const { who, civic, city } = peek(db, request, cityId); return build(civic, city, who); }) };
    },
    'POST /api/civic/prefs': async (request) => {
      const body = await request.json();
      for (const key of ['richList', 'directory']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw fail(400, 'invalid_prefs');
      const prefs = await store.transact(db => {
        const session = request.requireSession(db, { renew: true });
        limit('prefs', session.publicId, 12);
        const civic = civicOf(db);
        if (civic.prefs === null || typeof civic.prefs !== 'object' || Array.isArray(civic.prefs)) civic.prefs = {};
        const mine = { ...civic.prefs[session.publicId] };
        // Stored as "hidden" flags so that the default (no entry) is listed.
        for (const key of ['richList', 'directory']) if (body[key] === true) delete mine[key]; else if (body[key] === false) mine[key] = true;
        if (Object.keys(mine).length) civic.prefs[session.publicId] = mine; else delete civic.prefs[session.publicId];
        return { richList: mine.richList !== true, directory: mine.directory !== true };
      });
      return { body: { ok: true, prefs }, renew: true };
    },
  };
}
