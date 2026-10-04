/**
 * Economy simulation: scripted players on a virtual clock, played through the real rules engine
 * (createLife / dispatch / advanceLife — nothing here sets cash, needs or skills by hand).
 *
 *   node scripts/economy-sim.mjs [--days 30] [--horizon 365] [--track tech]
 *
 * WHAT IT PLAYS
 *   For every birth-lottery outcome, one life per strategy in the start the game offers a new player — `own`: the free
 *   starter house on a plot in the local government picked at settle-in, no weekly rent — and one in every rented
 *   starting home that outcome may choose (the Houses app's alternative, and what the game offered before). Every life finishes character creation with the same look, traits and dream, so the
 *   only differences are the start and the strategy.
 *     idle      never does anything. Shows what the bills alone do.
 *     helper    the starter Community helper job only: three sittings a day, free upkeep at home.
 *     career    one career track: the daily shift on work days, eats, washes and rests at home, rides
 *               a Danfo home (the trip to work is the free automatic commute).
 *     gig       no job: every paid venue activity that is open, off cooldown and within its skill,
 *               inside a daily budget of ACTIVE SECONDS (time spent in activities and on the road).
 *               `gig` gets the same budget the career player actually used; `gig-all-day` gets 16 hours.
 *     optimal   the career routine, then the daily gem hunt, then gigs up to 30 active minutes a day,
 *               pockets a found wallet, and keeps spare cash in 7-day deposits.
 *     social    the career routine plus everything the growth features pay, pushed to their caps: every
 *               mission that can be finished is finished and claimed, five table games a day are won
 *               against real players (the fifth is past the paid cap), the referral welcome gift is
 *               taken, and six friends a week are referred (one more than the weekly cap) until the
 *               lifetime cap. It is the worst case for the new faucets, not a typical player.
 *   Sessions start at 09:00 Lagos time (or when the workplace opens). Away time is settled in one
 *   step, as the server does for a player who was offline.
 *
 * WHAT IT REPORTS, per life
 *   net worth (cash + deposits − loan − rent arrears) after days 1, 3, 7, 14 and 30; income by source
 *   and costs by kind over 30 days; the day of the first promotion; whether rent was paid every
 *   Saturday; active seconds a day; and the day cash first covered the next house (its move-in cost
 *   plus four weeks of its rent) and the cheapest car (found by playing on, up to `horizon` days —
 *   never extrapolated).
 *
 * The assertions that encode the design intent are in src/game/economy.test.js.
 * Everything here is deterministic: the same arguments give the same table.
 */
import { createLife, dispatch, advanceLife, viewLife } from '../src/life.js';
import { lagosTime, lagosDayStart, isOpen, minutesUntilOpen } from '../src/game/clock.js';
import { blockReason, spotsOf, skillLevel } from '../src/game/api.js';
import { VENUES } from '../src/game/content/venues.js';
import { JOBS } from '../src/game/content/jobs.js';
import { NPCS } from '../src/game/content/npcs.js';
import { LOTTERY, START_HOMES } from '../src/game/content/traits.js';
import { HOUSES, HOUSE_ORDER } from '../src/game/content/housing.js';
import { CARS, CAR_ORDER } from '../src/game/content/cars.js';
import { HOUSE_TIERS, TIER_ORDER, tierCost } from '../src/game/content/world.js';
import { EVENTS } from '../src/game/content/events.js';
import { DAILY_MISSIONS, WEEKLY_MISSIONS } from '../src/game/content/missions.js';
import { REFERRAL, TABLE_REWARDS } from '../src/game/content/growth.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const CITY = 'lagos';
/** The local government a simulated new player picks at settle-in (mid-priced mainland land). */
export const SIM_LGA = 'mushin';
/** The start a new player is offered: their own starter house (see the header). */
export const OWN = 'own';
const DAY = 86400000;
/** Monday 5 January 2026, 00:00 Lagos time. */
export const SIM_START = lagosDayStart(lagosTime(Date.UTC(2026, 0, 5, 9)).day);
export const CHECKPOINTS = [1, 3, 7, 14, 30];
const LOOK = { body: 'woman', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };
const TRAITS = ['smooth-talker', 'clean-pikin'];
const DREAM = 'everybodys-padi';
export const CHEAPEST_CAR = CARS[CAR_ORDER[0]];

/** Every paid activity a player without a job can do: [{ venue, spot, def }]. */
export const GIGS = Object.keys(VENUES).flatMap((venue) => spotsOf(venue).flatMap((spot) => spot.activities
  .filter((def) => def.reward > 0 && !def.requiresJob && !def.unavailable).map((def) => ({ venue, spot: spot.id, def }))));
const LABELS = new Map(Object.keys(VENUES).flatMap((venue) => spotsOf(venue).flatMap((spot) => spot.activities.map((def) => [def.label, def]))));
const EVENT_TITLES = new Set(Object.values(EVENTS).map((event) => event.title));

/** Which column of the report a ledger line belongs to. */
export function categoryOf(line) {
  const reason = line.reason;
  if (reason.startsWith('Start cash')) return 'start';
  if (reason.startsWith('Rent') || reason.startsWith('Ground rent')) return 'rent';
  if (reason.startsWith('Loan')) return 'loan';
  if (reason.startsWith('Goal:') || reason.startsWith('Dream achieved') || reason.startsWith('Startup funding')) return 'goals';
  if (reason === 'Daily gem hunt prize') return 'hunt';
  if (reason.startsWith('Mission: ')) return 'missions';
  if (reason.startsWith('Table win: ')) return 'tables';
  if (reason.startsWith('Welcome gift') || reason.startsWith('Referral reward')) return 'referral';
  if (reason.startsWith('Sprayed at ')) return 'leisure';
  if (reason.startsWith('Fixed deposit')) return 'savings';
  if (/^(Danfo|Keke|Okada|Cab|Trek|Fuel) to /.test(reason)) return 'transport';
  if (reason.startsWith('Groceries')) return 'food';
  if (reason.startsWith('Landlord and agent') || reason.startsWith('Bought') || reason.startsWith('Sold') || reason.startsWith('Boutique') || reason.startsWith('House upgrade') || reason === 'House styling' || reason.startsWith('Moving your ')) return 'purchases';
  if (EVENT_TITLES.has(reason)) return 'events';
  const def = LABELS.get(reason) ?? LABELS.get(reason.replace(/^Refund: /, '').split(': ')[0]);
  if (def?.requiresJob) return 'wages';
  if (def?.reward > 0 && line.amount > 0) return 'gigs';
  if (def?.tags?.some((tag) => tag === 'food' || tag === 'drink')) return 'food';
  if (def) return line.amount > 0 ? 'gigs' : 'leisure';
  return 'other';
}

/** One simulated life. Every change goes through dispatch() or advanceLife(). */
export class Player {
  constructor({ lottery, house, start = SIM_START + 9 * 3600000 }) {
    this.now = start;
    this.seq = 0;
    this.lines = [];      // every ledger line ever written, in order
    this.activeSeconds = 0;
    this.refusals = {};
    // A new player as the quick start makes one: a guest in Freedom Park who plays the two opening
    // goals (a round of Ayo, a hello) and then settles in. The three opening goals are original beta rewards.
    this.state = createLife(null, { now: this.now, cityId: CITY, isNew: true, quickStart: true });
    this.seed = this.state.cash;
    this.must('onboarding.quick-start', { look: LOOK });
    this.run('trees', 'play-ayo');
    this.run('people', `npc-${Object.values(NPCS).find((npc) => npc.venue === 'park').id}-hello`);
    this.must('onboarding.traits', { traits: TRAITS });
    this.must('onboarding.dream', { dream: DREAM });
    // The roll depends on the action id: try ids, on a copy, until this one rolls the wanted outcome.
    let rolled = false;
    for (let i = 0; i < 5000 && !rolled; i++) {
      const actionId = `lottery-${i}`;
      const copy = createLife(structuredClone(this.state), { now: this.now, cityId: CITY });
      dispatch(copy, { type: 'onboarding.lottery', payload: {}, actionId }, { now: this.now, cityId: CITY, actionId });
      if (copy.onboarding.lottery?.id !== lottery) continue;
      dispatch(this.state, { type: 'onboarding.lottery', payload: {}, actionId }, { now: this.now, cityId: CITY, actionId });
      rolled = this.state.onboarding.lottery?.id === lottery;
    }
    if (!rolled) throw new Error(`No action id rolled ${lottery}`);
    this.must('onboarding.home', house === OWN ? { lga: SIM_LGA, via: 'manual' } : { house });
  }
  ctx() { const actionId = `sim-${++this.seq}`; return { now: this.now, cityId: CITY, actionId }; }
  do(type, payload = {}) {
    const ctx = this.ctx();
    const result = dispatch(this.state, { type, payload, actionId: ctx.actionId }, ctx);
    if (!result.ok) this.refusals[result.code] = (this.refusals[result.code] ?? 0) + 1;
    this.collectAll();
    return result;
  }
  /** An action only the server may run (a finished table game, a referral gift): the same dispatch, with server authority. */
  server(type, payload = {}) {
    const ctx = { ...this.ctx(), internal: true };
    const result = dispatch(this.state, { type, payload, actionId: ctx.actionId }, ctx);
    if (!result.ok) this.refusals[result.code] = (this.refusals[result.code] ?? 0) + 1;
    this.collectAll();
    return result;
  }
  must(type, payload) { const result = this.do(type, payload); if (!result.ok) throw new Error(`${type} refused: ${result.code} ${result.reason ?? ''}`); return result; }
  /** Pick up the ledger lines written since the last call (the engine itself keeps only the newest 60). */
  collectAll() {
    const count = this.state.ledger.length;
    const last = this.state.ledger.at(-1);
    if (!last) return;
    let fresh = 0;
    for (let i = count - 1; i >= 0 && this.state.ledger[i] !== this.lastLine; i--) fresh += 1;
    if (fresh) this.lines.push(...this.state.ledger.slice(count - fresh).map((line) => ({ ...line })));
    this.lastLine = last;
  }
  /** Let `seconds` pass in one settlement. `active` counts it as time the player spent playing. */
  pass(seconds, active = true) {
    if (seconds <= 0) return;
    this.now += seconds * 1000;
    advanceLife(this.state, seconds, { now: this.now, cityId: CITY });
    if (active) this.activeSeconds += seconds;
    this.collectAll();
  }
  /** Finish whatever timed action is running (the automatic commute starts by itself). */
  settle() { let guard = 0; while (this.state.activeAction && guard++ < 10) this.pass(this.state.activeAction.remaining); }
  awayUntil(ms) { if (ms > this.now) this.pass((ms - this.now) / 1000, false); }
  view() { return viewLife(this.state, { now: this.now, cityId: CITY }); }
  answerEvent(pocket) {
    const pending = this.state.travel.event;
    if (!pending) return;
    const event = EVENTS[pending.id];
    const choice = (pocket && event.choices.find((item) => item.reward > 0 && !item.cost && !item.check)) || event.choices.at(-1);
    this.do('world.roadside', { choice: choice.id });
  }
  /** Travel and arrive. Falls back to the free trek when the fare cannot be paid. Returns false if the venue is closed. */
  travel(venue, mode = 'danfo', { pocket = false } = {}) {
    this.settle();
    if (this.state.location === venue) return true;
    let result = this.do('travel', { id: venue, mode });
    if (!result.ok && result.code === 'insufficient_funds') result = this.do('travel', { id: venue, mode: 'trek' });
    if (!result.ok) return false;
    this.settle();
    this.answerEvent(pocket);
    return this.state.location === venue;
  }
  /** Stand at a spot and run one activity to completion. Returns the dispatch result of the start. */
  run(spot, id, choice) {
    this.settle();
    if (this.state.spot !== spot) { const moved = this.do('spot', { id: spot }); if (!moved.ok) return moved; }
    const started = this.do('activity', { id, ...(choice ? { choice } : {}) });
    if (started.ok) this.settle();
    return started;
  }
  /** Free upkeep at home: eat, wash, rest. Returns false only if home could not be reached. */
  upkeep({ hunger = 60, hygiene = 45, energy = 70, mode = 'danfo' } = {}) {
    if (!this.travel('home', mode)) return false;
    let guard = 0;
    while (this.state.needs.hunger < hunger && guard++ < 6) {
      this.do('spot', { id: 'kitchen' });
      const cards = this.view().activities.cards.filter((card) => !card.blocked && !card.choices && card.cost === 0 && (card.effects?.hunger ?? 0) > 0);
      const best = cards.sort((a, b) => b.effects.hunger / b.duration - a.effects.hunger / a.duration)[0];
      if (!best || !this.run('kitchen', best.id).ok) break;
    }
    if (this.state.needs.hygiene < hygiene) this.run('bathroom', 'bath');
    guard = 0;
    while (this.state.needs.energy < energy && guard++ < 6) if (!this.run('bedroom', 'nap').ok) break;
    return true;
  }
  netWorth() {
    const economy = this.state.economy;
    return this.state.cash + economy.deposits.reduce((sum, deposit) => sum + deposit.amount, 0) - (economy.loan?.left ?? 0) - economy.rent.arrears;
  }
}

const dayStart = (index) => SIM_START + index * DAY;
const careerOf = (player) => JOBS[player.state.job];

/** The first week's tutorial goals a new player is walked through (those the strategy can meet). */
function firstSitting(player, job) {
  player.run('kitchen', player.view().activities.cards.find((card) => !card.blocked && (card.effects?.hunger ?? 0) > 0)?.id ?? 'garri');
  player.run('bathroom', 'bath');
  if (job) player.must('apply-job', { id: job });
}

function workShift(player) {
  const job = careerOf(player);
  if (!job) return false;
  player.settle();
  const venue = job.workplace.venue;
  if (player.state.location !== venue) {
    const hours = VENUES[venue].hours;
    if (!isOpen(hours, player.now)) player.awayUntil(player.now + minutesUntilOpen(hours, player.now) * 60000);
    player.settle(); // the automatic commute may have started on that settlement
    if (player.state.location !== venue && !player.travel(venue)) return false;
  }
  return player.run(job.workplace.spot, job.shift.id).ok;
}

/** Every gig that can be started right now from somewhere, best pay per second first. */
function gigsNow(player) {
  const ctx = { now: player.now, cityId: CITY };
  return GIGS.filter(({ venue, def }) => isOpen(VENUES[venue].hours, player.now) && !blockReason(player.state, def, venue, ctx))
    .sort((a, b) => b.def.reward / b.def.duration - a.def.reward / a.def.duration);
}

/** Do gigs until the day's active seconds (everything played today, upkeep and travel included) reach `budgetSeconds`. */
function gigSitting(player, budgetSeconds, { pocket = false } = {}) {
  const limit = player.dayStartSeconds + budgetSeconds;
  let stalled = 0;
  while (player.activeSeconds < limit && stalled < 3) {
    if (player.state.needs.energy < 40 || player.state.needs.hunger < 30) { player.upkeep({ energy: 90, hunger: 70 }); continue; }
    const options = gigsNow(player);
    // Prefer what is on offer where the player already stands; otherwise go to the best one.
    const next = options.find((item) => item.venue === player.state.location) ?? options[0];
    if (!next) {
      // Everything is on cooldown or closed: wait for the next cooldown (not active time), at most ten minutes.
      const ready = Object.values(player.state.travel.cooldowns).filter((at) => at > player.now).sort((a, b) => a - b)[0];
      if (!ready || ready - player.now > 600000) break;
      player.awayUntil(ready + 1000);
      continue;
    }
    if (!player.travel(next.venue, player.state.cash >= 2000 ? 'danfo' : 'trek', { pocket })) { stalled += 1; continue; }
    if (player.run(next.spot, next.def.id).ok) stalled = 0; else stalled += 1;
  }
}

function gemHunt(player) {
  const hunt = player.state.civic.hunt;
  if (!hunt || hunt.claimed) return;
  for (const gem of hunt.gems) {
    if (gem.found) continue;
    if (!isOpen(VENUES[gem.venue].hours, player.now) || !player.travel(gem.venue)) continue;
    if (gem.kind === 'visit') { if (gem.spot && player.state.spot !== gem.spot) player.do('spot', { id: gem.spot }); player.do('civic.hunt-search'); continue; }
    const ctx = { now: player.now, cityId: CITY };
    const free = spotsOf(gem.venue).flatMap((spot) => spot.activities.map((def) => ({ spot: spot.id, def })))
      .filter(({ def }) => !def.choices && !def.requiresJob && !(def.cost > 0) && !blockReason(player.state, def, gem.venue, ctx)).sort((a, b) => a.def.duration - b.def.duration)[0];
    if (free) player.run(free.spot, free.def.id);
  }
  if (player.state.civic.hunt.gems.every((gem) => gem.found)) player.do('civic.hunt-claim');
}

function keepDeposits(player) {
  const view = player.view().economy;
  const buffer = view.weeklyBills * 2 + 10000;
  let spare = Math.min(player.state.cash - buffer, view.savings.room, 50000);
  while (spare >= 5000 && !view.savings.blocked && player.state.economy.deposits.length < 3) {
    const amount = Math.floor(Math.min(spare, 50000) / 1000) * 1000;
    if (!player.do('economy.open-deposit', { amount, term: 'd7' }).ok) break;
    spare = Math.min(player.state.cash - buffer, 100000 - player.state.economy.deposits.reduce((sum, deposit) => sum + deposit.amount, 0), 50000);
  }
}

/** The cheapest startable activity anywhere open that satisfies `wanted(def)`; goes there and runs it. */
function doSomewhere(player, wanted) {
  const ctx = { now: player.now, cityId: CITY };
  const options = Object.keys(VENUES).filter((venue) => isOpen(VENUES[venue].hours, player.now)).flatMap((venue) => spotsOf(venue).flatMap((spot) => spot.activities
    .filter((def) => !def.choices && !def.requiresJob && !(def.cost > 300) && wanted(def) && !blockReason(player.state, def, venue, ctx)).map((def) => ({ venue, spot: spot.id, def }))));
  const next = options.find((item) => item.venue === player.state.location) ?? options.sort((a, b) => (a.def.cost ?? 0) - (b.def.cost ?? 0) || a.def.duration - b.def.duration)[0];
  return Boolean(next) && player.travel(next.venue) && player.run(next.spot, next.def.id).ok;
}

/** Work through today's and this week's missions as a determined player would, then collect every finished one. */
function missionRun(player) {
  const pending = () => { const view = player.view().missions; return [...view.daily, ...view.weekly].filter((mission) => !mission.done); };
  const def = (id) => [...DAILY_MISSIONS, ...WEEKLY_MISSIONS].find((mission) => mission.id === id);
  let guard = 0;
  for (const mission of pending()) {
    const rule = def(mission.id);
    for (let left = mission.count - mission.n; left > 0 && guard++ < 40; left--) {
      if (player.state.needs.energy < 35 || player.state.needs.hunger < 30) player.upkeep({ energy: 80, hunger: 70 });
      if (rule.on === 'venue') {
        const fresh = Object.keys(VENUES).find((venue) => venue !== 'home' && venue !== player.state.location && isOpen(VENUES[venue].hours, player.now) && !player.state.missions.visited.list.includes(venue));
        if (!fresh || !player.travel(fresh)) break;
      } else if (rule.on === 'tag') { if (!doSomewhere(player, (item) => (item.tags ?? []).some((tag) => rule.tags.includes(tag)))) break; }
      else if (rule.on === 'event' && rule.event === 'npc.greeted') { if (!doSomewhere(player, (item) => item.social?.action === 'hello')) break; }
      else if (rule.on === 'event' && rule.event === 'gem.found') { gemHunt(player); break; }
      else break; // shifts, wishes, friends, tables and events come from the rest of the day
    }
  }
  const view = player.view().missions;
  for (const mission of [...view.daily, ...view.weekly]) if (mission.done && !mission.claimed) player.do('missions.claim', { id: mission.id });
}

export const STRATEGIES = {
  idle: { label: 'idle', day() {} },
  helper: {
    label: 'helper only',
    first: (player) => firstSitting(player, 'community-helper'),
    day(player, index) {
      for (const hour of [9, 13.5, 18]) {
        player.awayUntil(dayStart(index) + hour * 3600000);
        player.upkeep({ energy: 40, hunger: 45, mode: 'trek' });
        if (player.travel('park', 'trek')) player.run('work', 'helper-shift'); // ₦300 a shift does not pay for a bus: walk
      }
      player.upkeep({ mode: 'trek' });
    },
  },
  career: {
    label: 'career',
    first: (player, options) => firstSitting(player, options.track),
    day(player) {
      player.upkeep();
      if (player.view().career.today.canWork) workShift(player);
      player.upkeep({ energy: 50 });
    },
  },
  gig: {
    label: 'gigs (equal effort)',
    first: (player) => firstSitting(player, null),
    // The whole day — upkeep, travel, gigs and the trip home — fits in the career player's active seconds.
    day(player, index, options) { player.upkeep(); gigSitting(player, options.budget - 25); player.travel('home', 'trek'); },
  },
  'gig-all-day': {
    label: 'gigs (16 h a day)',
    first: (player) => firstSitting(player, null),
    day(player) { player.upkeep(); gigSitting(player, 16 * 3600); player.upkeep({ energy: 50 }); },
  },
  optimal: {
    label: 'best mix',
    first: (player, options) => firstSitting(player, options.track),
    day(player, index, options) {
      player.upkeep();
      if (player.view().career.today.canWork) workShift(player);
      gemHunt(player);
      gigSitting(player, options.mixBudget ?? 1800, { pocket: true });
      player.upkeep({ energy: 50 });
      keepDeposits(player);
    },
  },
  social: {
    label: 'social (caps)',
    first: (player, options) => firstSitting(player, options.track),
    day(player, index) {
      player.upkeep();
      if (player.view().career.today.canWork) workShift(player);
      // Five wins against real players: the fifth is beyond the paid cap. Then the referral gifts, one over each cap.
      for (let game = 0; game < TABLE_REWARDS.paidWinsPerDay + 1; game++) player.server('growth.table-result', { game: 'whot', label: 'Whot', won: true, human: true, counted: true });
      if (index === 1) player.server('growth.referral', { kind: 'welcome', name: 'Ada' });
      if (index % 7 === 2) for (let friend = 0; friend < REFERRAL.paidPerWeek + 1; friend++) player.server('growth.referral', { kind: 'reward', name: 'Tunde' });
      missionRun(player);
      player.upkeep({ energy: 50 });
    },
  },
};

/** Every start the birth lottery allows: [{ lottery, house }] — the own starter house first, then each rented home. */
export const STARTS = Object.values(LOTTERY).flatMap((outcome) => [OWN, ...Object.keys(START_HOMES).filter((house) => !outcome.locked?.[house] && outcome.startCash[house] !== undefined)]
  .map((house) => ({ lottery: outcome.id, house })));

/**
 * Play one life. Returns the report row. `days` is the reported period; the life is played on to
 * `horizon` days only to find when the next house and the cheapest car first became affordable.
 */
export function simulate({ lottery, house, strategy, days = 30, horizon = days, track = 'tech', budget = 300, mixBudget = 1800 }) {
  const plan = STRATEGIES[strategy];
  const options = { track, budget, mixBudget };
  const player = new Player({ lottery, house });
  const startCash = player.state.cash;
  // The next house: for a renter the next rented tier; for an owner the first upgrade of their own house (its price in their
  // local government, and its weekly ground rent).
  const nextHouse = house === OWN ? { id: TIER_ORDER[1], moveIn: tierCost(CITY, SIM_LGA, TIER_ORDER[1]), rent: HOUSE_TIERS[TIER_ORDER[1]].groundRent }
    : HOUSES[HOUSE_ORDER[HOUSE_ORDER.indexOf(house) + 1]] ?? null;
  const row = { lottery, house, strategy, label: plan.label, track: plan === STRATEGIES.career || plan === STRATEGIES.optimal || plan === STRATEGIES.social ? track : null, startCash,
    netWorth: {}, cash: {}, firstPromotionDay: null, rentMissedWeeks: 0, minCash: startCash, nextHouse: nextHouse?.id ?? null, nextHouseDay: null, carDay: null, activePerDay: 0 };
  plan.first?.(player, options);
  let level = player.state.career.level, missed = player.state.economy.rent.missed;
  for (let index = 0; index < horizon; index++) {
    player.awayUntil(dayStart(index) + 9 * 3600000);
    player.dayStartSeconds = player.activeSeconds;
    plan.day(player, index, options);
    player.settle();
    player.awayUntil(dayStart(index + 1) - 60000);
    const day = index + 1;
    if (row.firstPromotionDay === null && player.state.career.level > level) row.firstPromotionDay = day;
    level = Math.max(level, player.state.career.level);
    if (player.state.economy.rent.missed > missed && day <= days) row.rentMissedWeeks += player.state.economy.rent.missed - missed;
    missed = player.state.economy.rent.missed;
    if (day <= days) row.minCash = Math.min(row.minCash, ...player.lines.map((line) => line.balance));
    if (CHECKPOINTS.includes(day) && day <= days) { row.netWorth[day] = player.netWorth(); row.cash[day] = player.state.cash; }
    // "Affordable" means the move-in cost plus four weeks of the new rent, not just the fee on the day.
    if (nextHouse && row.nextHouseDay === null && player.state.cash >= nextHouse.moveIn + 4 * nextHouse.rent) row.nextHouseDay = day;
    if (row.carDay === null && player.state.cash >= CHEAPEST_CAR.price) row.carDay = day;
    if (day === days) {
      row.final = { cash: player.state.cash, netWorth: player.netWorth(), arrears: player.state.economy.rent.arrears, loanLeft: player.state.economy.loan?.left ?? 0,
        level: player.state.career.level, needs: { ...player.state.needs }, job: player.state.job };
      row.activePerDay = Math.round(player.activeSeconds / days);
      const flows = {};
      for (const line of player.lines) { const category = categoryOf(line); flows[category] = (flows[category] ?? 0) + line.amount; }
      row.flows = flows;
      row.ledgerSum = player.lines.reduce((sum, line) => sum + line.amount, 0);
      row.seed = player.seed;
      row.credits = player.lines.filter((line) => line.amount > 0).map((line) => ({ ...line, category: categoryOf(line) }));
      row.unknown = [...new Set(player.lines.filter((line) => categoryOf(line) === 'other').map((line) => line.reason))];
      row.conserved = player.seed + row.ledgerSum === player.state.cash;
      row.refusals = { ...player.refusals };
      if (!nextHouse && row.carDay !== null) break;
    }
    if (day >= days && (row.nextHouseDay !== null || !nextHouse) && row.carDay !== null) break;
  }
  row.player = player;
  return row;
}

const naira = (value) => (value === undefined || value === null ? '—' : `${value < 0 ? '−' : ''}₦${Math.abs(Math.round(value)).toLocaleString('en-NG')}`);
const short = (value) => (value === undefined || value === null ? '—' : Math.abs(value) >= 1e6 ? `${(value / 1e6).toFixed(2)}m` : Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value));

/** The whole table: every start × every strategy. */
export function runEconomy({ days = 30, horizon = 365, track = 'tech', strategies = Object.keys(STRATEGIES) } = {}) {
  const rows = [];
  for (const start of STARTS) {
    const career = simulate({ ...start, strategy: 'career', days, horizon, track });
    for (const strategy of strategies) {
      // "Equal effort": the gig player gets exactly the active seconds a day the career player used.
      rows.push(strategy === 'career' ? career : simulate({ ...start, strategy, days, horizon: strategy === 'idle' ? days : horizon, track, budget: career.activePerDay }));
    }
  }
  return rows;
}

export function formatTable(rows) {
  const head = ['start', 'strategy', 'start ₦', ...CHECKPOINTS.map((day) => `d${day}`), 'wages', 'gigs', 'goals', 'hunt', 'missn', 'tables', 'refer', 'food', 'transp', 'rent', 'loan', 'promo', 'rent ok', 'act s/d', 'next house', 'car'];
  const lines = rows.map((row) => [`${row.lottery}/${row.house}`, `${row.label}${row.track ? ` (${row.track})` : ''}`, short(row.startCash), ...CHECKPOINTS.map((day) => short(row.netWorth[day])),
    short(row.flows.wages ?? 0), short(row.flows.gigs ?? 0), short(row.flows.goals ?? 0), short(row.flows.hunt ?? 0), short(row.flows.missions ?? 0), short(row.flows.tables ?? 0), short(row.flows.referral ?? 0), short(row.flows.food ?? 0), short(row.flows.transport ?? 0), short(row.flows.rent ?? 0), short(row.flows.loan ?? 0),
    row.firstPromotionDay ? `d${row.firstPromotionDay}` : '—', row.rentMissedWeeks ? `missed ${row.rentMissedWeeks}` : 'yes', String(row.activePerDay),
    row.nextHouse ? (row.nextHouseDay ? `${row.nextHouse} d${row.nextHouseDay}` : `${row.nextHouse} —`) : 'top', row.carDay ? `d${row.carDay}` : '—']);
  const widths = head.map((title, column) => Math.max(title.length, ...lines.map((line) => line[column].length)));
  const format = (cells) => cells.map((cell, column) => (column < 2 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
  return [format(head), widths.map((width) => '-'.repeat(width)).join('  '), ...lines.map(format)].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : fallback; };
  const days = Number(option('days', 30)), horizon = Number(option('horizon', 365)), track = option('track', 'tech');
  const rows = runEconomy({ days, horizon, track });
  console.log(`Economy simulation · ${days} Lagos days from Monday 5 January 2026 · career track ${track} · milestones searched to day ${horizon}`);
  console.log('Net worth = cash + deposits − loan left − rent arrears. Flows are 30-day totals in naira; costs are negative. "act s/d" = active seconds a day.');
  console.log(formatTable(rows));
  const bad = rows.filter((row) => !row.conserved || row.unknown.length);
  console.log(bad.length ? `NOT CONSERVED or unknown reasons in ${bad.length} rows: ${JSON.stringify(bad.map((row) => [row.lottery, row.house, row.strategy, row.unknown]))}` : `Conservation: cash = seed + Σ ledger in all ${rows.length} lives; every ledger reason is classified.`);
  console.log(`Next house = move-in + 4 weeks' rent: ${HOUSE_ORDER.map((id) => `${id} ${naira(HOUSES[id].moveIn + 4 * HOUSES[id].rent)}`).join(' · ')} · own house upgrade (${TIER_ORDER[1]} in ${SIM_LGA}) ${naira(tierCost(CITY, SIM_LGA, TIER_ORDER[1]) + 4 * HOUSE_TIERS[TIER_ORDER[1]].groundRent)} · cheapest car ${naira(CHEAPEST_CAR.price)}`);
}
