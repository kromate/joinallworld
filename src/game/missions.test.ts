// OWNER: growth — tests for the missions, events and growth systems and the events calendar.
// Pattern and rules: see "HOW TO TEST" at the top of src/game/registry.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife, spotsOf, VENUES } from '../life.ts';
import { makeContext } from './util.ts';
import { lagosTime, lagosDayStart } from './clock.ts';
import { dealMissions } from './systems/missions.ts';
import { DAILY_MISSIONS, WEEKLY_MISSIONS, MISSION_REWARDS, MISSION_KINDS, STAMP_CARD } from './content/missions.ts';
import { EVENTS_CALENDAR, SPRAY } from './content/calendar.ts';
import { REFERRAL, TABLE_REWARDS } from './content/growth.ts';
import { eventsAt, eventsBetween, upcomingEvents, occurrenceOn, dayOfDate, eventIcs, hasEventToday } from './calendar.ts';

const HOUR = 3600000, DAY = 86400000;
/** Monday 5 January 2026, 09:00 Lagos time. */
const NOW = Date.UTC(2026, 0, 5, 8);
const TODAY = lagosTime(NOW).day, WEEK = lagosTime(NOW).week;
let seq = 0;
const ctxAt = (now, extra = {}) => { const actionId = `m-${++seq}`; return makeContext({ now, cityId: 'lagos', seed: actionId, actionId, ...extra }); };
const entries = (...ids) => ids.map((id) => ({ id, n: 0, marks: [], claimed: false }));

/** A life with a chosen set of missions for today, standing at home with money. */
function life({ daily = [], weekly = [], ...saved } = {}) {
  const state = createLife({ cash: 50000, location: 'home', spot: 'kitchen', missions: { seed: 7, day: TODAY, week: WEEK, daily: entries(...daily), weekly: entries(...weekly) }, ...saved }, ctxAt(NOW));
  state.t = NOW;
  return { state, now: NOW };
}
const act = (game, type, payload, extra) => dispatch(game.state, { type, payload }, ctxAt(game.now, extra));
function pass(game, seconds) { game.now += seconds * 1000; advanceLife(game.state, seconds, ctxAt(game.now)); game.state.t = game.now; }
function finish(game) { let guard = 0; while (game.state.activeAction && guard++ < 10) pass(game, Math.ceil(game.state.activeAction.remaining) + 1); }
function travel(game, venue) { const result = act(game, 'travel', { id: venue, mode: 'trek' }); assert.equal(result.ok, true, `travel to ${venue}: ${result.reason}`); finish(game); if (game.state.travel?.event) act(game, 'world.roadside', { choice: 'walk-on' }); assert.equal(game.state.location, venue); }
function run(game, spot, wanted) {
  if (game.state.spot !== spot) assert.equal(act(game, 'spot', { id: spot }).ok, true);
  const def = spotsOf(game.state.location).find((item) => item.id === spot).activities.find(wanted);
  assert.ok(def, `an activity at ${game.state.location}/${spot}`);
  const started = act(game, 'activity', { id: def.id, ...(def.choices ? { choice: def.choices[0].id } : {}) });
  assert.equal(started.ok, true, `${def.id}: ${started.reason}`);
  finish(game);
  return def;
}
const view = (game) => viewLife(game.state, ctxAt(game.now));
const mission = (game, id) => [...view(game).missions.daily, ...view(game).missions.weekly].find((item) => item.id === id);
const ledger = (game, prefix) => game.state.ledger.filter((line) => line.reason.startsWith(prefix));

test('missions: a set is one mission of each kind, the same for the same life and day, and only what can be done', () => {
  const { state } = life();
  const first = dealMissions(state, 'daily', TODAY, ctxAt(NOW)), again = dealMissions(state, 'daily', TODAY, ctxAt(NOW));
  assert.deepEqual(first, again);
  assert.deepEqual(first.map((entry) => DAILY_MISSIONS.find((def) => def.id === entry.id).kind), MISSION_KINDS);
  assert.equal(dealMissions(state, 'weekly', WEEK, ctxAt(NOW)).length, MISSION_REWARDS.weekly.slots);
  // Across many days: a life without a job is never asked to finish a shift, and "show up at an event" is dealt only on a day with one.
  const ids = new Set();
  for (let day = TODAY; day < TODAY + 120; day++) {
    const at = lagosDayStart(day) + 9 * HOUR;
    for (const entry of dealMissions(state, 'daily', day, ctxAt(at))) {
      ids.add(entry.id);
      if (entry.id === 'd-event') assert.equal(hasEventToday(at), true, `day ${day} has an event`);
    }
  }
  assert.equal(ids.has('d-shift'), false);
  assert.ok(ids.size >= 8, 'the pool is really used');
  const employed = createLife({ job: 'community-helper', missions: { seed: 7 } }, ctxAt(NOW));
  const withJob = new Set();
  for (let day = TODAY; day < TODAY + 120; day++) for (const entry of dealMissions(employed, 'daily', day, ctxAt(lagosDayStart(day) + 9 * HOUR))) withJob.add(entry.id);
  assert.equal(withJob.has('d-shift'), true);
  // A brand-new life is dealt its sets by the first settlement, with nothing to do by hand.
  const fresh = createLife(null, ctxAt(NOW));
  advanceLife(fresh, 1, ctxAt(NOW + 1000));
  assert.deepEqual([fresh.missions.daily.length, fresh.missions.weekly.length, fresh.missions.day], [3, 3, TODAY]);
});

test('missions: real play completes a mission exactly once, a claim pays once, and the set bonus is granted once', () => {
  const game = life({ daily: ['d-meal', 'd-two-places', 'd-greet'], weekly: ['w-meals', 'w-places', 'w-greet'] });
  const startCash = game.state.cash, startStars = game.state.goals.stars;
  assert.equal(act(game, 'missions.claim', { id: 'd-meal' }).code, 'not_done');
  // Eat at home: one meal finishes the daily mission and adds one to the weekly ten.
  run(game, 'kitchen', (def) => (def.tags ?? []).includes('food') && !def.cost && !def.choices);
  assert.deepEqual([mission(game, 'd-meal').n, mission(game, 'd-meal').done, mission(game, 'w-meals').n], [1, true, 1]);
  run(game, 'kitchen', (def) => (def.tags ?? []).includes('food') && !def.cost && !def.choices);
  assert.deepEqual([mission(game, 'd-meal').n, mission(game, 'w-meals').n], [1, 2], 'a finished mission does not count past its target');
  // Two places: the same venue twice is one place.
  travel(game, 'park');
  travel(game, 'home'); travel(game, 'park');
  assert.equal(mission(game, 'd-two-places').n, 1, 'arriving at the park again does not count twice, and home never counts');
  // Say hello to two regulars at the park.
  for (const def of spotsOf('park').find((spot) => spot.id === 'people').activities.filter((item) => item.social?.action === 'hello').slice(0, 2)) {
    assert.equal(act(game, 'spot', { id: 'people' }).ok || game.state.spot === 'people', true);
    assert.equal(act(game, 'activity', { id: def.id }).ok, true); finish(game);
  }
  assert.deepEqual([mission(game, 'd-greet').done, mission(game, 'w-greet').n], [true, 2]);
  travel(game, 'library');
  assert.deepEqual([mission(game, 'd-two-places').done, mission(game, 'w-places').n], [true, 2]);

  // Claims: each pays once through the wallet with its own line; a second claim changes nothing.
  for (const id of ['d-meal', 'd-two-places']) assert.equal(act(game, 'missions.claim', { id }).code, 'claimed');
  assert.equal(game.state.goals.stars, startStars, 'no set bonus before the last one is claimed');
  assert.equal(act(game, 'missions.claim', { id: 'd-greet' }).code, 'claimed');
  assert.equal(game.state.goals.stars, startStars + MISSION_REWARDS.daily.setStars);
  for (const id of ['d-meal', 'd-two-places', 'd-greet']) assert.equal(act(game, 'missions.claim', { id }).code, 'already_claimed');
  assert.equal(game.state.goals.stars, startStars + MISSION_REWARDS.daily.setStars, 'the set bonus is granted once');
  assert.equal(ledger(game, 'Mission: ').length, 3);
  assert.equal(ledger(game, 'Mission: ').reduce((sum, line) => sum + line.amount, 0), 3 * MISSION_REWARDS.daily.cash);
  assert.equal(view(game).missions.dailySet.granted, true);
  assert.equal(act(game, 'missions.claim', { id: 'w-meals' }).code, 'not_done');
  for (const hostile of [undefined, null, 7, {}, 'nope', '__proto__']) assert.equal(act(game, 'missions.claim', { id: hostile }).ok, false);
  // A reload changes nothing.
  assert.deepEqual(createLife(structuredClone(game.state), ctxAt(game.now)).missions, game.state.missions);
  assert.ok(game.state.cash >= startCash + 3 * MISSION_REWARDS.daily.cash - 2000);
});

test('missions: an unclaimed mission lapses at midnight, weekly progress survives the night, and one swap a day is allowed', () => {
  const game = life({ daily: ['d-meal', 'd-two-places', 'd-greet'], weekly: ['w-meals', 'w-places', 'w-greet'] });
  run(game, 'kitchen', (def) => (def.tags ?? []).includes('food') && !def.cost && !def.choices);
  assert.equal(mission(game, 'd-meal').done, true);
  // One swap of an unfinished mission; a finished one cannot be swapped; a second swap is refused.
  assert.equal(act(game, 'missions.reroll', { id: 'd-meal' }).code, 'already_done');
  assert.equal(act(game, 'missions.reroll', { id: 'd-greet' }).code, 'rerolled');
  const swapped = view(game).missions.daily[2];
  assert.ok(swapped.id !== 'd-greet' && swapped.kind === 'social' && swapped.n === 0);
  assert.equal(act(game, 'missions.reroll', { id: 'd-two-places' }).code, 'no_rerolls');
  // Midnight: yesterday's finished-but-unclaimed mission is gone; nothing is paid for it.
  pass(game, (lagosDayStart(TODAY + 1) - game.now) / 1000 + 60);
  assert.equal(game.state.missions.day, TODAY + 1);
  const result = act(game, 'missions.claim', { id: 'd-meal' });
  assert.ok(['unknown_mission', 'not_done'].includes(result.code), 'the old mission cannot be collected after midnight');
  assert.equal(ledger(game, 'Mission: ').length, 0);
  assert.equal(mission(game, 'w-meals').n, 1, 'the weekly mission keeps its progress');
  assert.equal(view(game).missions.rerollsLeft, MISSION_REWARDS.rerollsPerDay);
  // A new week deals a new weekly set.
  pass(game, 7 * 86400);
  assert.equal(game.state.missions.week, WEEK + 1);
  assert.ok(view(game).missions.weekly.every((item) => item.n === 0));
});

test('missions: the stamp card pays once at four days, the day count only goes up, and absence costs nothing', () => {
  const game = life({ daily: ['d-meal', 'd-two-places', 'd-greet'], weekly: ['w-meals', 'w-places', 'w-greet'] });
  const stars = () => game.state.goals.stars, start = stars();
  for (let day = 0; day < STAMP_CARD.need; day++) {
    if (day) pass(game, 86400);
    run(game, 'kitchen', (def) => (def.tags ?? []).includes('food') && !def.cost && !def.choices);
    run(game, 'kitchen', (def) => (def.tags ?? []).includes('food') && !def.cost && !def.choices); // a second activity the same day adds nothing
    assert.deepEqual([view(game).missions.stamps.days, view(game).missions.activeDays], [day + 1, day + 1]);
  }
  assert.deepEqual([stars(), view(game).missions.stamps.paid], [start + STAMP_CARD.stars, true]);
  pass(game, 86400); run(game, 'kitchen', (def) => (def.tags ?? []).includes('food') && !def.cost && !def.choices);
  assert.equal(stars(), start + STAMP_CARD.stars, 'a fifth day pays nothing more');
  assert.ok(game.state.social.notices.some((notice) => notice.kind === 'mission' && notice.text.startsWith('Stamp card complete')));
  // Three weeks away: the count is where it was, the card starts again, and nothing was taken.
  const days = view(game).missions.activeDays, cash = ledger(game, 'Mission').length;
  pass(game, 21 * 86400);
  assert.deepEqual([view(game).missions.activeDays, view(game).missions.stamps.days, ledger(game, 'Mission').length], [days, 0, cash]);
  assert.ok(game.state.missions.titles.includes('settled') === (days >= 7));
});

test('missions: hostile saved input is rebuilt to a valid slice', () => {
  for (const missions of [null, 7, 'x', [], { daily: 'no', weekly: [{ id: '__proto__' }], seed: -1, active: { days: 1e99, last: null }, stamps: { week: 1, days: 99, paid: true }, titles: ['nope', 'settled', 'settled'], sets: 4, visited: { week: 1, list: ['nowhere', 'park', 'park'] } },
    { daily: [{ id: 'd-meal', n: 1e9, claimed: true, marks: ['x', 'park'] }, { id: 'd-meal' }, { id: 'w-meals' }, { id: 'd-fresh', n: 0, claimed: true }], rerolls: 99, paidDay: -4, claimed: NaN }]) {
    const state = createLife({ missions }, ctxAt(NOW));
    const book = state.missions;
    assert.ok(Number.isInteger(book.seed) && book.seed >= 0);
    assert.ok(book.daily.length <= 3 && book.daily.every((entry) => DAILY_MISSIONS.some((def) => def.id === entry.id) && entry.n <= (DAILY_MISSIONS.find((def) => def.id === entry.id).count ?? 1)));
    assert.ok(book.weekly.every((entry) => WEEKLY_MISSIONS.some((def) => def.id === entry.id)));
    assert.equal(new Set(book.daily.map((entry) => entry.id)).size, book.daily.length);
    assert.ok(book.daily.every((entry) => !entry.claimed || entry.n >= 1), 'an unfinished mission is never stored as claimed');
    assert.ok(book.stamps.days <= 7 && book.active.days <= 100000 && book.rerolls <= MISSION_REWARDS.rerollsPerDay);
    assert.ok(book.titles.every((id) => id === 'settled') && book.titles.length <= 1);
    assert.deepEqual(createLife(structuredClone(state), ctxAt(NOW)).missions, book);
  }
});

test('calendar: weekly events recur on Lagos time, also across midnight; dated events hold their days; a closed venue never hosts', () => {
  const friday = lagosDayStart(TODAY + 4); // Monday + 4
  assert.equal(lagosTime(friday).weekday, 5);
  const club = (at) => eventsAt(at).some((event) => event.id === 'club-night');
  assert.deepEqual([club(friday + 19.9 * HOUR), club(friday + 20 * HOUR), club(friday + 25.5 * HOUR), club(friday + 26 * HOUR)], [false, true, true, false], 'Friday 20:00 to Saturday 02:00');
  assert.equal(club(friday + 7 * DAY + 21 * HOUR), true, 'and again the next Friday');
  assert.equal(club(friday - DAY + 21 * HOUR), false, 'not on Thursday');
  const live = eventsAt(friday + 25 * HOUR).find((event) => event.id === 'club-night');
  assert.deepEqual([live.start, live.end, live.key], [friday + 20 * HOUR, friday + 26 * HOUR, `club-night:${TODAY + 4}`]);
  // Dated: Felabration, 12–18 October 2026, 17:00–23:00 each day.
  const first = dayOfDate('2026-10-12');
  const fela = (at) => eventsAt(at).some((event) => event.id === 'felabration-2026');
  assert.deepEqual([fela(lagosDayStart(first) + 18 * HOUR), fela(lagosDayStart(first + 6) + 22 * HOUR), fela(lagosDayStart(first + 7) + 18 * HOUR), fela(lagosDayStart(first - 1) + 18 * HOUR), fela(lagosDayStart(first) + 12 * HOUR)],
    [true, true, false, false, false]);
  assert.deepEqual([dayOfDate('2026-02-30'), dayOfDate('nope'), dayOfDate(null)], [null, null, null]);
  // The week ahead is in order and every row names a real venue.
  const week = upcomingEvents(NOW, 7);
  assert.ok(week.length >= 6 && week.every((event, index) => Object.hasOwn(VENUES, event.venue) && (index === 0 || week[index - 1].start <= event.start)));
  for (const event of EVENTS_CALENDAR) assert.ok(Object.hasOwn(VENUES, event.venue), `${event.id} is at a real venue`);
  // A venue that is closed for the whole event never hosts it; one that is open does.
  const shut = [{ id: 'late-vote', title: 'Late vote', blurb: 'x', venue: 'polling-unit', icon: 'star', when: { weekday: 1, from: 21, to: 23 } },
    { id: 'early-vote', title: 'Early vote', blurb: 'x', venue: 'polling-unit', icon: 'star', when: { weekday: 1, from: 9, to: 11 } }];
  assert.deepEqual(eventsBetween(NOW, NOW + DAY, 'lagos', shut).map((event) => event.id), ['early-vote']);
  assert.deepEqual([occurrenceOn({ id: 'x', when: {} }, TODAY), occurrenceOn(null, TODAY), eventsBetween(NaN, 5), eventsBetween(5, 5)], [null, null, [], []]);
  const ics = eventIcs(live, 'https://example.test/');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.includes('SUMMARY:Allworld: Friday club night') && ics.includes(`UID:club-night:${TODAY + 4}@allworld`) && /DTSTART:\d{8}T\d{6}Z/.test(ics));
});

test('events: being there counts once per occurrence; spraying is a capped sink that needs a party', () => {
  const saturday = lagosDayStart(TODAY + 5) + 15 * HOUR; // the owambe at Freedom Park, 14:00–19:00
  const state = createLife({ cash: 50000, location: 'park', spot: 'trees', missions: { seed: 7, day: TODAY + 5, week: WEEK, daily: entries('d-meal', 'd-two-places', 'd-event'), weekly: entries('w-meals', 'w-places', 'w-events') } }, ctxAt(saturday));
  state.t = saturday;
  const game = { state, now: saturday };
  assert.deepEqual([view(game).events.here?.id, view(game).events.here?.attended], ['owambe', false]);
  run(game, 'trees', (def) => def.id === 'chill');
  run(game, 'trees', (def) => def.id === 'chill');
  assert.deepEqual([game.state.events.count, game.state.events.attended, mission(game, 'd-event').done, mission(game, 'w-events').n], [1, [`owambe:${TODAY + 5}`], true, 1]);
  // Spraying: fixed amounts, a daily ceiling, and every naira leaves through the ledger.
  const before = game.state.cash;
  assert.equal(act(game, 'events.spray', { amount: 123 }).code, 'invalid_amount');
  for (let i = 0; i < 5; i++) assert.equal(act(game, 'events.spray', { amount: 1000 }).code, 'sprayed');
  assert.equal(act(game, 'events.spray', { amount: 200 }).code, 'spray_limit');
  assert.deepEqual([before - game.state.cash, ledger(game, 'Sprayed at ').length, view(game).events.spray.left], [SPRAY.perDay, 5, 0]);
  assert.ok(ledger(game, 'Sprayed at ').every((line) => line.amount === -1000));
  // No party, no spraying: after the event, and anywhere else.
  pass(game, 5 * 3600);
  assert.equal(act(game, 'events.spray', { amount: 200 }).code, 'no_event');
  const broke = createLife({ cash: 100, location: 'park' }, ctxAt(saturday)); broke.t = saturday;
  assert.equal(dispatch(broke, { type: 'events.spray', payload: { amount: 200 } }, ctxAt(saturday)).code, 'insufficient_funds');
  assert.deepEqual(createLife(structuredClone(game.state), ctxAt(game.now)).events, game.state.events);
  for (const events of [null, 'x', { attended: ['bad key', 'owambe:1', 'owambe:1'], spray: { day: 1, spent: 1e12 }, count: -1 }]) {
    const rebuilt = createLife({ events }, ctxAt(NOW)).events;
    assert.ok(rebuilt.attended.length <= 1 && rebuilt.spray.spent <= SPRAY.perDay && rebuilt.count === 0);
  }
});

test('growth: table results and referral gifts are server-only, pay inside their caps and never twice over them', () => {
  const game = life({ daily: ['d-meal', 'd-two-places', 'd-table'], weekly: ['w-meals', 'w-places', 'w-tables'] });
  const server = (type, payload) => act(game, type, payload, { internal: true });
  const win = { game: 'whot', label: 'Whot', won: true, human: true, counted: true };
  // A player cannot run either action: only the server can.
  for (const type of ['growth.table-result', 'growth.referral']) assert.equal(act(game, type, win).code, 'server_only');
  assert.equal(ledger(game, 'Table win').length, 0);
  // Four paid wins a day; the fifth counts as played and pays nothing.
  for (let i = 0; i < TABLE_REWARDS.paidWinsPerDay; i++) assert.equal(server('growth.table-result', win).code, 'paid');
  assert.equal(server('growth.table-result', win).code, 'counted');
  assert.deepEqual([ledger(game, 'Table win: Whot').length, ledger(game, 'Table win').reduce((sum, line) => sum + line.amount, 0)], [4, 4 * TABLE_REWARDS.win]);
  assert.deepEqual([mission(game, 'd-table').done, mission(game, 'w-tables').n], [true, 5]);
  // A loss, a win the pair cap did not count, and bot games pay nothing; only the first bot game of a day counts for missions.
  const cash = game.state.cash;
  pass(game, 86400);
  assert.equal(server('growth.table-result', { ...win, won: false }).code, 'counted');
  assert.equal(server('growth.table-result', { ...win, counted: false }).code, 'for_fun');
  assert.equal(server('growth.table-result', { ...win, human: false }).code, 'counted');
  assert.equal(server('growth.table-result', { ...win, human: false }).code, 'for_fun');
  assert.equal(game.state.cash, cash);
  assert.equal(view(game).growth.tables.paidLeft, TABLE_REWARDS.paidWinsPerDay);
  for (const hostile of [undefined, null, 'x', { game: {}, label: 9, won: 'yes', human: 1 }]) assert.equal(server('growth.table-result', hostile).ok, true, 'a malformed result is a counted-for-nothing game, never a payment');
  assert.equal(game.state.cash, cash);

  // Referral: one welcome per life; five rewards a week; twenty for life.
  assert.equal(server('growth.referral', { kind: 'welcome', name: 'Ada' }).code, 'welcomed');
  assert.equal(server('growth.referral', { kind: 'welcome', name: 'Ada' }).code, 'already_welcomed');
  assert.equal(ledger(game, 'Welcome gift').length, 1);
  let paid = 0;
  for (let week = 0; week < 6; week++) {
    for (let i = 0; i < REFERRAL.paidPerWeek + 2; i++) if (server('growth.referral', { kind: 'reward', name: 'Tunde' }).ok) paid += 1;
    pass(game, 7 * 86400);
  }
  assert.equal(paid, REFERRAL.paidLifetime);
  assert.equal(server('growth.referral', { kind: 'reward', name: 'Tunde' }).code, 'referral_lifetime_cap');
  assert.equal(server('growth.referral', { kind: 'nope' }).code, 'invalid_gift');
  assert.equal(ledger(game, 'Referral reward').length <= 60, true);
  assert.equal(game.state.growth.referrals.total, REFERRAL.paidLifetime);
  assert.deepEqual(createLife(structuredClone(game.state), ctxAt(game.now)).growth, game.state.growth);
  for (const growth of [null, 3, { tables: { paid: 99, bots: 99, day: -1 }, welcomed: 'yes', referrals: { paid: 99, total: 1e9 } }]) {
    const rebuilt = createLife({ growth }, ctxAt(NOW)).growth;
    assert.deepEqual([rebuilt.tables.paid, rebuilt.tables.bots, rebuilt.welcomed, rebuilt.referrals.paid, rebuilt.referrals.total], [0, 0, false, 0, 0]);
  }
});
