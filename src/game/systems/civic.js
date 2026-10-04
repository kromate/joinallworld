/**
 * OWNER: civic
 * Per-life civic state: the daily gem hunt, days lived in the city, this week's earnings, and
 * the wallet side of every civic purchase. Shared city state (elections, ads, radio queues,
 * the residents directory) lives on the server under server/civic/ and server/routes/civic.js.
 *
 * State key: `civic`
 *   seed    integer — fixes where this player's gems hide each day
 *   since   server ms this life first existed in the city (for "days lived here")
 *   gems    lifetime gems found;  claims  lifetime daily prizes claimed
 *   week    { week, earned } — naira received in the current Monday-started Lagos week
 *   work    { days, last } — how many different Lagos days this life has been PAID FOR WORK on (a
 *           completed activity with a reward: a shift or a gig), and the last such day. It only
 *           ever counts up by one per Lagos day, so it cannot be farmed in a sitting. Voting and
 *           running for Governor need ELECTION.minWorkDays of them (original beta rule): a
 *           sock-puppet session has to be played on two separate days, not merely left to age.
 *   news    [noticeId] — city news (results, phases, the Governor's announcements) already
 *           posted to this life's Updates, newest last, so each item is posted once
 *   hunt    null | { day, claimed, gems: [{ venue, spot, kind, found }] }
 *             kind 'visit'    — stand at that spot of the venue (spot null = anywhere in it)
 *             kind 'activity' — finish any activity in the venue
 *
 * Actions (all prefixed `civic.`):
 *   'civic.hunt-search'  {}   look for a gem where you stand
 *   'civic.hunt-claim'   {}   collect the daily prize once every gem is found
 *   'civic.refresh'      {}   roll today's hunt and return the current state (changes nothing else)
 *   'civic.news' { items: [{ id, title, text, at }] }   SERVER ONLY: post city news the life has
 *       not seen yet to its Updates feed ('notice.posted' { kind: 'gov', text }). Run by the
 *       pulse route with the server's own notices; news older than the life itself is skipped.
 *   'civic.run' · 'civic.vote' · 'civic.rent-ad' { kind, slot } · 'civic.shoutout'
 *       SERVER-COMPLETED: each of these is one half of a change whose other half is shared
 *       storage (a ballot, a slot, a queue). They are declared `serverOnly` (registry.js), so
 *       they succeed only when server/routes/civic.js runs them through ctx.act inside its store
 *       transaction. Sent on their own through POST /api/action they are refused with
 *       `server_only` and charge nothing, so a player can never pay without receiving what was paid for.
 *
 * Emits: 'gem.found'          { prize: 0, found, total, venue }   one gem found
 *        'hunt.claimed'       { prize }                           the daily prize was paid
 *        'candidacy.declared' { fee }
 *        'vote.cast'          {}
 *        'ad.bought'          { kind, slot, price }
 *        'radio.shoutout'     { venue, price }
 * Listens: 'activity.completed', 'wallet.changed'.
 */
import { emit, isDeparting } from '../registry.js';
import { fail, finite, isRecord, makeRng, naira, ok, safeCount } from '../util.js';
import { lagosTime } from '../clock.js';
import { canAfford, canCredit, credit, debit, spotsOf } from '../api.js';
import { VENUES, venueLabel } from '../content/venues.js';
import { BILLBOARDS, ELECTION, HUNT, RADIO, SEA_PLOTS } from '../content/civic.js';

const KINDS = ['visit', 'activity'];
const nowOf = (state, ctx) => (finite(ctx?.now) && ctx.now > 0 ? ctx.now : state.t);
/** On the way out of a venue by any means (a trip, the commute): the shared departing predicate. */
const travelling = (state) => isDeparting(state);
const startable = (def) => !def.unavailable && !def.requiresJob && !def.requiresSkill;

/** Every place a gem may hide: each spot of each venue except Home (a venue without spots counts once). */
function hidingPlaces() {
  const places = [];
  for (const venue of Object.keys(VENUES)) {
    if (venue === 'home') continue;
    const spots = spotsOf(venue);
    const hasActivity = spots.some((spot) => spot.activities.some(startable));
    if (!spots.length) places.push({ venue, spot: null, hasActivity });
    for (const spot of spots) places.push({ venue, spot: spot.id, hasActivity });
  }
  return places.length ? places : [{ venue: 'home', spot: null, hasActivity: false }];
}

/** Where a player's gems hide on a Lagos day. Deterministic for (seed, city, day); spreads over venues first. */
export function gemsFor(seed, cityId, day) {
  const rng = makeRng(`gems|${cityId}|${day}|${seed}`);
  const places = hidingPlaces();
  for (let i = places.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [places[i], places[j]] = [places[j], places[i]];
  }
  const picked = [];
  for (const place of places) if (picked.length < HUNT.gemsPerDay && !picked.some((gem) => gem.venue === place.venue)) picked.push(place);
  for (const place of places) if (picked.length < HUNT.gemsPerDay && !picked.includes(place)) picked.push(place);
  const gems = [];
  for (const place of picked) {
    // At most one "finish an activity" gem per venue, so one activity never shakes two loose.
    const activity = place.hasActivity && rng() < 0.5 && !gems.some((gem) => gem.kind === 'activity' && gem.venue === place.venue);
    gems.push(activity ? { venue: place.venue, spot: null, kind: 'activity', found: false } : { venue: place.venue, spot: place.spot, kind: 'visit', found: false });
  }
  return gems;
}

const freshHunt = (state, cityId, day) => ({ day, claimed: false, gems: gemsFor(state.civic.seed, cityId, day) });

/** Today's hunt without touching state: the saved one if it is today's, otherwise what it will be. */
function currentHunt(state, ctx) {
  const day = lagosTime(nowOf(state, ctx)).day;
  return state.civic.hunt?.day === day ? state.civic.hunt : freshHunt(state, ctx?.cityId ?? 'lagos', day);
}
function roll(state, ctx) {
  const hunt = currentHunt(state, ctx);
  state.civic.hunt = hunt;
  return hunt;
}

/**
 * Mark a gem found. Gems found in passing (arriving, finishing an activity) never replace
 * state.message, which belongs to whatever the player was doing; the HUD chip announces them.
 */
function found(state, gem, ctx, announce = false) {
  const hunt = state.civic.hunt;
  gem.found = true;
  if (state.civic.gems < Number.MAX_SAFE_INTEGER) state.civic.gems += 1;
  const count = hunt.gems.filter((item) => item.found).length;
  if (announce) {
    state.message = count === hunt.gems.length
      ? `You found a gem at ${venueLabel(gem.venue, ctx?.cityId)} — that is all ${count} for today. Claim your ${naira(HUNT.prize)} prize from the gem hunt chip.`
      : `You found a gem at ${venueLabel(gem.venue, ctx?.cityId)}: ${count} of ${hunt.gems.length} today.`;
  }
  emit(state, 'gem.found', { prize: 0, found: count, total: hunt.gems.length, venue: gem.venue }, ctx);
}

/** Find any 'visit' gem hidden exactly where the player is standing. Returns how many were found. */
function sweep(state, ctx, announce = false) {
  if (travelling(state)) return 0;
  let count = 0;
  for (const gem of state.civic.hunt?.gems ?? []) {
    if (gem.found || gem.kind !== 'visit' || gem.venue !== state.location || (gem.spot !== null && gem.spot !== state.spot)) continue;
    found(state, gem, ctx, announce);
    count += 1;
  }
  return count;
}

const daysLived = (state, ctx) => Math.max(0, lagosTime(nowOf(state, ctx)).day - lagosTime(state.civic.since).day);
const check = (id, met, label, detail, code) => ({ id, met, label, detail, code });

/**
 * What a player must satisfy to run or vote, each with its current status. The election phase,
 * the ballot and "already voted" are shared state and are checked by the server on top of these.
 */
export function civicEligibility(state, ctx) {
  const days = daysLived(state, ctx), city = ctx?.cityId ?? 'lagos';
  const polling = Object.hasOwn(VENUES, ELECTION.pollingVenue);
  const lived = (min, verb) => check('days', days >= min, `Lived here for at least ${min} Lagos day${min === 1 ? '' : 's'}`,
    days >= min ? `You have lived here ${days} day${days === 1 ? '' : 's'}.`
      : `You have lived here ${days} day${days === 1 ? '' : 's'}; you can ${verb} after ${min - days} more midnight${min - days === 1 ? '' : 's'} (Lagos time).`, 'too_new');
  const run = [
    lived(ELECTION.minDaysToRun, 'run'),
    check('fee', canAfford(state, ELECTION.filingFee), `Filing fee of ${naira(ELECTION.filingFee)} (not refunded)`,
      canAfford(state, ELECTION.filingFee) ? `You have ${naira(state.cash)}.` : `You have ${naira(state.cash)}; earn ${naira(ELECTION.filingFee - state.cash)} more.`, 'insufficient_funds'),
  ];
  // Paid work on enough different days: age alone can be waited out by an idle sock puppet.
  const need = ELECTION.minWorkDays, worked = state.civic.work.days;
  const working = check('work', worked >= need, `Been paid for work on at least ${need} different Lagos days`,
    worked >= need ? `You have been paid for work on ${worked} different days.`
      : `You have been paid for work on ${worked} day${worked === 1 ? '' : 's'}. Finish a paid shift or gig on ${need - worked} more day${need - worked === 1 ? '' : 's'}${state.civic.work.last === lagosTime(nowOf(state, ctx)).day ? ' (today is already counted — come back tomorrow)' : ''}.`, 'work_days');
  run.push(working);
  const vote = [lived(ELECTION.minDaysToVote, 'vote'), working];
  if (polling) {
    const there = state.location === ELECTION.pollingVenue && !travelling(state);
    vote.push(check('place', there, `Be at ${venueLabel(ELECTION.pollingVenue, city)}`,
      there ? 'You are at the polling unit.' : `Travel to ${venueLabel(ELECTION.pollingVenue, city)} to cast your vote.`, 'wrong_place'));
  }
  return { days, pollingVenue: polling ? ELECTION.pollingVenue : null, run, vote };
}
const firstUnmet = (state, checks) => { const unmet = checks.find((item) => !item.met); return unmet ? fail(state, unmet.code, `${unmet.label}. ${unmet.detail}`) : null; };

/** Price, period and display label of an ad slot, or null if the kind or slot does not exist. */
export function adSlot(kind, slot) {
  if (kind === 'billboard') {
    const entry = BILLBOARDS.slots.find((item) => item.id === slot);
    return entry ? { kind, slot: entry.id, price: BILLBOARDS.price, days: BILLBOARDS.days, near: entry.near, road: entry.road, label: `Billboard · ${entry.road}` } : null;
  }
  if (kind === 'sea') {
    const parts = typeof slot === 'string' ? /^sea-(\d{1,2})-(\d{1,2})$/.exec(slot) : null;
    const row = Number(parts?.[1]), col = Number(parts?.[2]);
    if (!parts || row >= SEA_PLOTS.rows || col >= SEA_PLOTS.cols || slot !== `sea-${row}-${col}`) return null;
    return { kind, slot, row, col, price: row < SEA_PLOTS.shoreRows ? SEA_PLOTS.shorePrice : SEA_PLOTS.price, days: SEA_PLOTS.days, label: `Sea plot ${row + 1}·${col + 1}` };
  }
  return null;
}

/** A server-only action definition (registry.js) whose refusal says which screen does it properly. */
const serverOnly = (run, where) => ({ serverOnly: true, run,
  refusal: `This step is completed by the server together with ${where}. Use ${where} instead; nothing was charged.` });

// ---- action handlers ---------------------------------------------------------------------

/** Look for a gem where the player stands. Fails with what is missing when nothing is found. */
export function searchForGem(state, payload, ctx) {
  const hunt = roll(state, ctx);
  if (travelling(state)) return fail(state, 'travelling', 'You are on the road. Arrive somewhere before searching for gems.');
  if (sweep(state, ctx, true)) return ok(state, 'found');
  const here = venueLabel(state.location, ctx?.cityId);
  const left = hunt.gems.filter((gem) => !gem.found);
  if (!left.length) {
    return fail(state, 'hunt_complete', hunt.claimed ? 'You found and claimed today’s gems. New gems are hidden at midnight, Lagos time.'
      : `You have found every gem today. Claim your ${naira(HUNT.prize)} prize.`);
  }
  const local = left.filter((gem) => gem.venue === state.location);
  if (local.some((gem) => gem.kind === 'activity')) return fail(state, 'activity_needed', `Something glints at ${here}, but it is stuck. Finish any activity here to shake the gem loose.`);
  if (local.length) return fail(state, 'wrong_spot', `You are close: a gem is hidden at another spot in ${here}. Move to a different spot and search again.`);
  return fail(state, 'nothing_here', `No gem at ${here} today. Still hidden: ${[...new Set(left.map((gem) => venueLabel(gem.venue, ctx?.cityId)))].join(', ')}.`);
}

/** Pay the daily prize once every gem is found. Exactly once per Lagos day. */
export function claimHuntPrize(state, payload, ctx) {
  const hunt = roll(state, ctx);
  const count = hunt.gems.filter((gem) => gem.found).length;
  if (hunt.claimed) return fail(state, 'already_claimed', 'You already claimed today’s gem prize. New gems are hidden at midnight, Lagos time.');
  if (count < hunt.gems.length) return fail(state, 'gems_missing', `Find all ${hunt.gems.length} gems first: you have ${count}. The clues are on the gem hunt chip.`);
  if (!canCredit(state, HUNT.prize)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');
  credit(state, HUNT.prize, 'Daily gem hunt prize', ctx);
  hunt.claimed = true;
  if (state.civic.claims < Number.MAX_SAFE_INTEGER) state.civic.claims += 1;
  state.message = `Gem hunt prize claimed: ${naira(HUNT.prize)}.`;
  emit(state, 'hunt.claimed', { prize: HUNT.prize }, ctx);
  return ok(state, 'claimed');
}

/** Charge the filing fee for a candidacy the server has already accepted. */
export function fileCandidacy(state, payload, ctx) {
  const blocked = firstUnmet(state, civicEligibility(state, ctx).run);
  if (blocked) return blocked;
  debit(state, ELECTION.filingFee, 'Governorship filing fee', ctx);
  state.message = `You are on the ballot. The ${naira(ELECTION.filingFee)} filing fee was paid.`;
  emit(state, 'candidacy.declared', { fee: ELECTION.filingFee }, ctx);
  return ok(state, 'declared');
}

/** Confirm this life may vote now (age, and being at the polling unit once that venue exists). */
export function castVote(state, payload, ctx) {
  const blocked = firstUnmet(state, civicEligibility(state, ctx).vote);
  if (blocked) return blocked;
  state.message = 'Your vote was counted.';
  emit(state, 'vote.cast', {}, ctx);
  return ok(state, 'voted');
}

/** Charge the rent for an ad slot the server has already found free. payload: { kind, slot }. */
export function payForAd(state, payload, ctx) {
  const slot = adSlot(payload?.kind, payload?.slot);
  if (!slot) return fail(state, 'invalid_slot', 'Choose a billboard or sea plot from the list.');
  if (!canAfford(state, slot.price)) return fail(state, 'insufficient_funds', `${slot.label} costs ${naira(slot.price)} for ${slot.days} days; you have ${naira(state.cash)}.`);
  debit(state, slot.price, `${slot.label} · ${slot.days} days`, ctx);
  state.message = `${slot.label} is yours for ${slot.days} days.`;
  emit(state, 'ad.bought', { kind: slot.kind, slot: slot.slot, price: slot.price }, ctx);
  return ok(state, 'rented');
}

/** Charge for a club-radio shout-out. The player must be standing in a club. */
export function payForShoutout(state, payload, ctx) {
  if (!RADIO.venues.includes(state.location) || travelling(state)) {
    const clubs = RADIO.venues.filter((id) => Object.hasOwn(VENUES, id)).map((id) => venueLabel(id, ctx?.cityId));
    return fail(state, 'not_in_club', `Shout-outs are bought inside a club. ${clubs.length ? `Travel to ${clubs.join(' or ')} first.` : 'No club is open in this city yet.'}`);
  }
  if (!canAfford(state, RADIO.price)) return fail(state, 'insufficient_funds', `A shout-out costs ${naira(RADIO.price)}; you have ${naira(state.cash)}.`);
  debit(state, RADIO.price, `Club radio shout-out · ${venueLabel(state.location, ctx?.cityId)}`, ctx);
  state.message = 'Your shout-out is in the club radio queue.';
  emit(state, 'radio.shoutout', { venue: state.location, price: RADIO.price }, ctx);
  return ok(state, 'queued');
}

const NEWS_LIMIT = 40;
const NEWS_ID = /^[a-z]+-[a-z0-9-]{1,40}$/;

/** Post city news this life has not been told yet. Each id is posted once; at most five a call. */
export function postNews(state, payload, ctx) {
  const items = Array.isArray(payload?.items) ? payload.items.slice(0, 12) : [];
  let posted = 0;
  for (const item of [...items].sort((a, b) => (a?.at ?? 0) - (b?.at ?? 0))) {
    if (!isRecord(item) || typeof item.id !== 'string' || !NEWS_ID.test(item.id) || typeof item.title !== 'string' || !finite(item.at)) continue;
    if (state.civic.news.includes(item.id)) continue;
    state.civic.news.push(item.id);
    // News from before this life existed is remembered as seen, not replayed.
    if (item.at < state.civic.since || posted >= 5) continue;
    emit(state, 'notice.posted', { kind: 'gov', text: `${item.title}${typeof item.text === 'string' && item.text ? `: ${item.text}` : ''}` }, ctx);
    posted += 1;
  }
  if (state.civic.news.length > NEWS_LIMIT) state.civic.news.splice(0, state.civic.news.length - NEWS_LIMIT);
  return ok(state, posted ? 'posted' : 'nothing_new');
}

function sanitizeHunt(value) {
  if (!isRecord(value) || !safeCount(value.day) || !Array.isArray(value.gems) || !value.gems.length || value.gems.length > HUNT.gemsPerDay) return null;
  const gems = [];
  for (const gem of value.gems) {
    if (!isRecord(gem) || typeof gem.venue !== 'string' || !Object.hasOwn(VENUES, gem.venue) || !KINDS.includes(gem.kind)) return null;
    if (gem.spot !== null && (gem.kind !== 'visit' || typeof gem.spot !== 'string' || !spotsOf(gem.venue).some((spot) => spot.id === gem.spot))) return null;
    gems.push({ venue: gem.venue, spot: gem.spot, kind: gem.kind, found: gem.found === true });
  }
  return { day: value.day, claimed: value.claimed === true && gems.every((gem) => gem.found), gems };
}

export default {
  id: 'civic',
  stateKeys: ['civic'],
  sanitize(input, state, ctx) {
    const saved = isRecord(input.civic) ? input.civic : {};
    const week = isRecord(saved.week) && safeCount(saved.week.week) && safeCount(saved.week.earned) ? { week: saved.week.week, earned: saved.week.earned } : { week: 0, earned: 0 };
    state.civic = {
      seed: Number.isInteger(saved.seed) && saved.seed >= 0 && saved.seed < 4294967296 ? saved.seed
        : Math.floor(makeRng(`civic-seed|${state.t}|${state.name}|${ctx?.cityId}`)() * 4294967296),
      since: finite(saved.since) && saved.since >= 0 && saved.since <= state.t ? saved.since : state.t,
      gems: safeCount(saved.gems) ? saved.gems : 0,
      claims: safeCount(saved.claims) ? saved.claims : 0,
      week,
      work: isRecord(saved.work) && safeCount(saved.work.days) && saved.work.days <= 100000 && (saved.work.last === null || safeCount(saved.work.last)) && (saved.work.days === 0) === (saved.work.last === null)
        ? { days: saved.work.days, last: saved.work.last } : { days: 0, last: null },
      news: [...new Set((Array.isArray(saved.news) ? saved.news : []).filter((id) => typeof id === 'string' && NEWS_ID.test(id)))].slice(-NEWS_LIMIT),
      hunt: sanitizeHunt(saved.hunt),
    };
  },
  actions: {
    'civic.hunt-search': searchForGem,
    'civic.hunt-claim': claimHuntPrize,
    'civic.refresh'(state, payload, ctx) { roll(state, ctx); sweep(state, ctx); return ok(state, 'refreshed'); },
    'civic.news': serverOnly(postNews, 'Phone → Governor'),
    'civic.run': serverOnly(fileCandidacy, 'Phone → Governor'),
    'civic.vote': serverOnly(castVote, 'Phone → Governor'),
    'civic.rent-ad': serverOnly(payForAd, 'Phone → Billboards'),
    'civic.shoutout': serverOnly(payForShoutout, 'Phone → Radio'),
  },
  on: {
    'activity.completed'(state, data, ctx) {
      // A paid shift or gig: count today once as a day worked.
      if (data?.def?.reward > 0) {
        const day = lagosTime(nowOf(state, ctx)).day, work = state.civic.work;
        if (work.last === null || day > work.last) { work.days = Math.min(100000, work.days + 1); work.last = day; }
      }
      for (const gem of roll(state, ctx).gems) if (!gem.found && gem.kind === 'activity' && gem.venue === state.location) found(state, gem, ctx);
    },
    'wallet.changed'(state, data, ctx) {
      const week = lagosTime(nowOf(state, ctx)).week;
      if (state.civic.week.week !== week) state.civic.week = { week, earned: 0 };
      const amount = data?.amount;
      if (!Number.isSafeInteger(amount) || amount <= 0 || String(data.reason ?? '').startsWith('Refund')) return;
      state.civic.week.earned = Math.min(Number.MAX_SAFE_INTEGER, state.civic.week.earned + amount);
    },
  },
  advance(state, dt, ctx) {
    roll(state, ctx);
    sweep(state, ctx);
  },
  view(state, ctx) {
    const hunt = currentHunt(state, ctx), city = ctx?.cityId ?? 'lagos';
    const count = hunt.gems.filter((gem) => gem.found).length;
    const week = lagosTime(nowOf(state, ctx)).week;
    return {
      hunt: {
        day: hunt.day, total: hunt.gems.length, found: count, claimed: hunt.claimed, prize: HUNT.prize,
        canClaim: count === hunt.gems.length && !hunt.claimed,
        // Clues name the venue only; the exact spot is for the player to find.
        gems: hunt.gems.map((gem) => ({ venue: gem.venue, label: venueLabel(gem.venue, city), kind: gem.kind, found: gem.found,
          clue: gem.found ? 'Found' : gem.kind === 'activity' ? 'Finish any activity here to shake it loose' : 'Hidden at one of the spots here — go and search' })),
      },
      eligibility: civicEligibility(state, ctx),
      workDays: state.civic.work.days,
      earnedThisWeek: state.civic.week.week === week ? state.civic.week.earned : 0,
      gems: state.civic.gems,
    };
  },
};
