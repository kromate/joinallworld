import { cachedCityContent, loadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'port-harcourt', 'abuja', 'kano'].map(loadCityContent));
/**
 * Economy simulation: scripted players on a virtual clock, played through the real rules engine
 * (createLife / dispatch / advanceLife — nothing here sets cash, needs or skills by hand).
 *
 *   node scripts/economy-sim.ts [--days 30] [--horizon 365] [--track tech]
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
 *     student   the helper job once a day, and the whole UNILAG degree: reads in the Library until admission is possible,
 *               applies, matriculates, registers both semesters (tuition, levy, a hostel room), attends every lecture in
 *               its slot, sits the assignments and tests, takes the one paid campus job a day, and collects the
 *               scholarship if the results earn it. Every campus fee and every campus naira earned is in the `campus` column.
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
 *   After the table: player-owned shops — owners of several kinds, a trader between two cities and two colluding players
 *   (scripts/business-sim.ts).
 *
 * The assertions that encode the design intent are in src/game/economy.test.ts.
 * Everything here is deterministic: the same arguments give the same table.
 */
import { makeContext } from '../src/game/util.ts';
import { createLife, dispatch, advanceLife, viewLife } from '../src/life.ts';
import { lagosTime, lagosDayStart, isOpen, minutesUntilOpen } from '../src/game/clock.ts';
import { blockReason, spotsOf, skillLevel } from '../src/game/api.ts';
import { VENUES } from '../src/game/cities/lagos/venues.ts';

import { JOBS } from '../src/game/content/jobs.ts';
import { NPCS } from '../src/game/cities/lagos/regulars.ts';

import { LOTTERY, START_HOMES } from '../src/game/content/traits.ts';
import { HOUSES, HOUSE_ORDER } from '../src/game/content/housing.ts';
import { CARS, CAR_ORDER } from '../src/game/content/cars.ts';
import { HOUSE_TIERS, TIER_ORDER, tierCost } from '../src/game/content/world.ts';
import { EVENTS } from '../src/game/content/events.ts';
import { DAILY_MISSIONS, WEEKLY_MISSIONS } from '../src/game/content/missions.ts';
import { REFERRAL, TABLE_REWARDS } from '../src/game/content/growth.ts';
import { PROGRAMMES, LECTURE_SLOTS, semesterOf } from '../src/campus/unilag/curriculum.ts';
import { CAMPUS_JOBS } from '../src/campus/unilag/student.ts';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { ActionBody, ActionOutcome, ActivityDefinition, LedgerLine, LifeContextInit, LifeState, LifeView, Look, StartHomeId, VenueId } from '../src/types/index.ts';

type Json = Record<string, unknown>;
/** Every venue id, in content order. */
const VENUE_IDS = Object.keys(VENUES) as VenueId[];

/** Narrow away null and undefined; the script fails here, as a property read on the missing value would. */
function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new TypeError(`${what} is missing`);
  return value;
}

const CITY = 'lagos';
/** The local government a simulated new player picks at settle-in (mid-priced mainland land). */
export const SIM_LGA = 'mushin';
/** The start a new player is offered: their own starter house (see the header). */
export const OWN = 'own';
const DAY = 86400000;
/** Monday 5 January 2026, 00:00 Lagos time. */
export const SIM_START = lagosDayStart(lagosTime(Date.UTC(2026, 0, 5, 9)).day);
export const CHECKPOINTS = [1, 3, 7, 14, 30];
const LOOK: Look = { body: 'woman', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };
const TRAITS: string[] = ['smooth-talker', 'clean-pikin'];
const DREAM = 'everybodys-padi';
export const CHEAPEST_CAR = must(CARS[must(CAR_ORDER[0])]);

/** One startable paid activity: where it is and its definition. */
export interface Gig { venue: VenueId; spot: string; def: ActivityDefinition }

/** Every paid activity a player without a job can do: [{ venue, spot, def }]. */
export const GIGS: Gig[] = VENUE_IDS.flatMap((venue) => spotsOf(venue, 'lagos').flatMap((spot) => spot.activities
  .filter((def) => (def.reward ?? 0) > 0 && !def.requiresJob && !def.unavailable).map((def) => ({ venue, spot: spot.id, def }))));
const LABELS = new Map(VENUE_IDS.flatMap((venue) => spotsOf(venue, 'lagos').flatMap((spot) => spot.activities.map((def) => [def.label, def]))));
const EVENT_TITLES = new Set(Object.values(EVENTS).map((event) => event.title));
const CAMPUS_JOB_REASONS = new Set(Object.values(CAMPUS_JOBS).map((job) => `UNILAG ${job.label}`));
/** The programme the simulated student reads, and the best-paid campus job. */
export const SIM_PROGRAMME = 'computer';
const SIM_CAMPUS_JOB = must(Object.values(CAMPUS_JOBS).sort((a, b) => b.pay - a.pay)[0]);

/** Which column of the report a ledger line belongs to. */
export function categoryOf(line: LedgerLine): string {
  const reason = line.reason;
  if (reason.startsWith('Start cash')) return 'start';
  if (reason.startsWith('Rent') || reason.startsWith('Ground rent')) return 'rent';
  if (reason.startsWith('Loan')) return 'loan';
  if (reason.startsWith('Goal:') || reason.startsWith('Dream achieved') || reason.startsWith('Startup funding')) return 'goals';
  if (reason === 'Daily gem hunt prize') return 'hunt';
  if (reason.startsWith('Mission: ')) return 'missions';
  if (reason.startsWith('Table win: ')) return 'tables';
  // A faucet of its own: the server's launch bonus (server/bonus), paid to an account's character once.
  if (reason.startsWith('Launch bonus')) return 'bonus';
  if (reason.startsWith('Welcome gift') || reason.startsWith('Referral reward')) return 'referral';
  if (reason.startsWith('Sprayed at ')) return 'leisure';
  if (reason.startsWith('Fixed deposit')) return 'savings';
  if (/^(Danfo|Keke|Okada|Cab|Trek|Fuel|Bus|Micra) to /.test(reason) || /^(Bus on|Train between) /.test(reason) || / \([^()→]+ → [^()→]+\)$/.test(reason) /* any intercity fare: the label, then (from → to) */ || reason.startsWith('Campus shuttle to ')) return 'transport';
  // The UNILAG campus (src/campus/unilag/student.ts): what a student pays the university, and what the campus pays a student.
  if (reason === 'UNILAG application fee' || /^UNILAG semester \d+ tuition and levy$/.test(reason) || /^UNILAG hostel semester \d+$/.test(reason)) return 'campusFees';
  if (reason === 'UNILAG scholarship' || CAMPUS_JOB_REASONS.has(reason)) return 'campusPay';
  // Player-owned shops (src/game/systems/business.ts): what a shop costs its owner, and what it pays them.
  if (/^Shop (setup|stock|rent|upgrade|goods): /.test(reason)) return 'shopCosts';
  if (reason.startsWith('Shop takings: ') || reason.startsWith('Shop closed: ') || reason === 'Shop goods returned') return 'shopIncome';
  if (reason.startsWith('Groceries')) return 'food';
  if (reason.startsWith('Landlord and agent') || reason.startsWith('Bought') || reason.startsWith('Sold') || reason.startsWith('Boutique') || reason.startsWith('House upgrade') || reason === 'House styling' || reason.startsWith('Moving your ')) return 'purchases';
  if (EVENT_TITLES.has(reason)) return 'events';
  const def = LABELS.get(reason) ?? LABELS.get(reason.replace(/^Refund: /, '').split(': ')[0] ?? '');
  if (def?.requiresJob) return 'wages';
  if ((def?.reward ?? 0) > 0 && line.amount > 0) return 'gigs';
  if (def?.tags?.some((tag) => tag === 'food' || tag === 'drink')) return 'food';
  if (def) return line.amount > 0 ? 'gigs' : 'leisure';
  return 'other';
}

/** One simulated life. Every change goes through dispatch() or advanceLife(). */
export interface PlayerOptions { lottery: string; house: string; start?: number; /** Start as a brand-new player of this city, settled in the named local government (any city but the default). */ city?: { id: string; lga: string } }
type Ctx = LifeContextInit & { now: number; cityId: string; actionId: string };

export class Player {
  now: number;
  seq: number;
  /** Every ledger line ever written, in order. */
  lines: LedgerLine[];
  activeSeconds: number;
  /** Refusal codes and how often each came up. */
  refusals: Record<string, number>;
  state: LifeState;
  seed: number;
  lastLine: LedgerLine | undefined;
  /** Set by simulate() at the start of each day: the active seconds already spent. */
  dayStartSeconds = 0;
  /** The city the life is in: a journey changes it when the arrival is settled. */
  private home: string = CITY;
  get cityId(): string { return this.state?.estate?.city ?? this.home; }
  constructor({ lottery, house, start = SIM_START + 9 * 3600000, city }: PlayerOptions) {
    this.now = start;
    this.seq = 0;
    this.lines = [];
    this.activeSeconds = 0;
    this.refusals = {};
    // A new player as the quick start makes one: a guest in Freedom Park who plays the two opening
    // goals (a round of Ayo, a hello) and then settles in. The three opening goals are original beta rewards.
    if (city) {
      // A new player who chose this city in the creator: the full character flow, then a free home in the named local government.
      this.home = city.id;
      this.state = createLife(null, { now: this.now, cityId: city.id, isNew: true });
      this.seed = this.state.cash;
      this.must('onboarding.look', { look: LOOK });
      this.must('onboarding.traits', { traits: TRAITS });
      this.must('onboarding.dream', { dream: DREAM });
      this.must('onboarding.lottery', {});
      this.must('onboarding.home', { lga: city.lga, via: 'manual' });
      return;
    }
    this.state = createLife(null, { now: this.now, cityId: CITY, isNew: true, quickStart: true });
    this.seed = this.state.cash;
    this.must('onboarding.quick-start', { look: LOOK });
    this.run('trees', 'play-ayo');
    this.run('people', `npc-${must(Object.values(NPCS).find((npc) => npc.venue === 'park')).id}-hello`);
    this.must('onboarding.traits', { traits: TRAITS });
    this.must('onboarding.dream', { dream: DREAM });
    // The roll depends on the action id: try ids, on a copy, until this one rolls the wanted outcome.
    let rolled = false;
    for (let i = 0; i < 5000 && !rolled; i++) {
      const actionId = `lottery-${i}`;
      const copy = createLife(structuredClone(this.state), { now: this.now, cityId: CITY });
      this.dispatchOn(copy, 'onboarding.lottery', {}, { now: this.now, cityId: CITY, actionId });
      if (copy.onboarding.lottery?.id !== lottery) continue;
      this.dispatchOn(this.state, 'onboarding.lottery', {}, { now: this.now, cityId: CITY, actionId });
      rolled = this.state.onboarding.lottery?.id === lottery;
    }
    if (!rolled) throw new Error(`No action id rolled ${lottery}`);
    this.must('onboarding.home', house === OWN ? { lga: SIM_LGA, via: 'manual' } : { house });
  }
  /** dispatch() with an action type and payload that are only known as strings here. */
  dispatchOn(state: LifeState, type: string, payload: Json, ctx: Ctx): ActionOutcome {
    return dispatch(state, { type, payload, actionId: ctx.actionId } as unknown as ActionBody, ctx);
  }
  ctx(): Ctx { const actionId = `sim-${++this.seq}`; return { now: this.now, cityId: this.cityId, actionId }; }
  do(type: string, payload: Json = {}) {
    const ctx = this.ctx();
    const result = this.dispatchOn(this.state, type, payload, ctx);
    if (!result.ok) this.refusals[result.code] = (this.refusals[result.code] ?? 0) + 1;
    this.collectAll();
    return result;
  }
  /** An action only the server may run (a finished table game, a referral gift): the same dispatch, with server authority. */
  server(type: string, payload: Json = {}) {
    const ctx = { ...this.ctx(), internal: true };
    const result = this.dispatchOn(this.state, type, payload, ctx);
    if (!result.ok) this.refusals[result.code] = (this.refusals[result.code] ?? 0) + 1;
    this.collectAll();
    return result;
  }
  must(type: string, payload?: Json) { const result = this.do(type, payload); if (!result.ok) throw new Error(`${type} refused: ${result.code} ${result.reason ?? ''}`); return result; }
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
  pass(seconds: number, active = true) {
    if (seconds <= 0) return;
    this.now += seconds * 1000;
    advanceLife(this.state, seconds, { now: this.now, cityId: this.cityId });
    if (active) this.activeSeconds += seconds;
    this.collectAll();
  }
  /** Finish whatever timed action is running (the automatic commute starts by itself). */
  settle() { let guard = 0; while (this.state.activeAction && guard++ < 10) this.pass(must(this.state.activeAction).remaining); }
  awayUntil(ms: number) { if (ms > this.now) this.pass((ms - this.now) / 1000, false); }
  view() { return viewLife(this.state, { now: this.now, cityId: this.cityId }); }
  answerEvent(pocket: boolean) {
    const pending = this.state.travel.event;
    if (!pending) return;
    const event = EVENTS[pending.id];
    const choice = (pocket && event.choices.find((item) => (item.reward ?? 0) > 0 && !item.cost && !item.check)) || event.choices.at(-1);
    this.do('world.roadside', { choice: must(choice).id });
  }
  /** Travel and arrive. Falls back to the free trek when the fare cannot be paid. Returns false if the venue is closed. */
  travel(venue: string, mode = 'danfo', { pocket = false }: { pocket?: boolean } = {}) {
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
  run(spot: string, id: string, choice?: string) {
    this.settle();
    if (this.state.spot !== spot) { const moved = this.do('spot', { id: spot }); if (!moved.ok) return moved; }
    const started = this.do('activity', { id, ...(choice ? { choice } : {}) });
    if (started.ok) this.settle();
    return started;
  }
  /** Free upkeep at home: eat, wash, rest. Returns false only if home could not be reached. */
  upkeep({ hunger = 60, hygiene = 45, energy = 70, mode = 'danfo' }: { hunger?: number; hygiene?: number; energy?: number; mode?: string } = {}) {
    if (!this.travel('home', mode)) return false;
    let guard = 0;
    while (this.state.needs.hunger < hunger && guard++ < 6) {
      this.do('spot', { id: 'kitchen' });
      const cards = this.view().activities.cards.filter((card) => !card.blocked && !card.choices && card.cost === 0 && (card.effects?.hunger ?? 0) > 0);
      const best = cards.sort((a, b) => (b.effects?.hunger ?? 0) / b.duration - (a.effects?.hunger ?? 0) / a.duration)[0];
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

const dayStart = (index: number) => SIM_START + index * DAY;
const careerOf = (player: Player) => (player.state.job ? JOBS[player.state.job] : undefined);

/** The first week's tutorial goals a new player is walked through (those the strategy can meet). */
function firstSitting(player: Player, job: string | null) {
  player.run('kitchen', player.view().activities.cards.find((card) => !card.blocked && (card.effects?.hunger ?? 0) > 0)?.id ?? 'garri');
  player.run('bathroom', 'bath');
  if (job) player.must('apply-job', { id: job });
}

function workShift(player: Player) {
  const job = careerOf(player);
  if (!job) return false;
  player.settle();
  const venue = job.workplace.venue;
  if (player.state.location !== venue) {
    const hours = must(VENUES[venue], 'registered venue').hours;
    if (!isOpen(hours, player.now)) player.awayUntil(player.now + minutesUntilOpen(hours, player.now) * 60000);
    player.settle(); // the automatic commute may have started on that settlement
    if (player.state.location !== venue && !player.travel(venue)) return false;
  }
  return player.run(job.workplace.spot, job.shift.id).ok;
}

/** Every gig that can be started right now from somewhere, best pay per second first. */
function gigsNow(player: Player) {
  const ctx = makeContext({ now: player.now, cityId: CITY });
  return GIGS.filter(({ venue, def }) => isOpen(must(VENUES[venue], 'registered venue').hours, player.now) && !blockReason(player.state, def, venue, ctx))
    .sort((a, b) => (b.def.reward ?? 0) / b.def.duration - (a.def.reward ?? 0) / a.def.duration);
}

/** Do gigs until the day's active seconds (everything played today, upkeep and travel included) reach `budgetSeconds`. */
function gigSitting(player: Player, budgetSeconds: number, { pocket = false }: { pocket?: boolean } = {}) {
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

function gemHunt(player: Player) {
  const hunt = player.state.civic.hunt;
  if (!hunt || hunt.claimed) return;
  for (const gem of hunt.gems) {
    if (gem.found) continue;
    if (!isOpen(must(VENUES[gem.venue], 'registered venue').hours, player.now) || !player.travel(gem.venue)) continue;
    if (gem.kind === 'visit') { if (gem.spot && player.state.spot !== gem.spot) player.do('spot', { id: gem.spot }); player.do('civic.hunt-search'); continue; }
    const ctx = makeContext({ now: player.now, cityId: CITY });
    const free = spotsOf(gem.venue, 'lagos').flatMap((spot) => spot.activities.map((def) => ({ spot: spot.id, def })))
      .filter(({ def }) => !def.choices && !def.requiresJob && !((def.cost ?? 0) > 0) && !blockReason(player.state, def, gem.venue, ctx)).sort((a, b) => a.def.duration - b.def.duration)[0];
    if (free) player.run(free.spot, free.def.id);
  }
  if (must(player.state.civic.hunt).gems.every((gem) => gem.found)) player.do('civic.hunt-claim');
}

function keepDeposits(player: Player) {
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
function doSomewhere(player: Player, wanted: (def: ActivityDefinition) => boolean) {
  const ctx = makeContext({ now: player.now, cityId: CITY });
  const options = VENUE_IDS.filter((venue) => isOpen(must(VENUES[venue], 'registered venue').hours, player.now)).flatMap((venue) => spotsOf(venue, 'lagos').flatMap((spot) => spot.activities
    .filter((def) => !def.choices && !def.requiresJob && !((def.cost ?? 0) > 300) && wanted(def) && !blockReason(player.state, def, venue, ctx)).map((def) => ({ venue, spot: spot.id, def }))));
  const next = options.find((item) => item.venue === player.state.location) ?? options.sort((a, b) => (a.def.cost ?? 0) - (b.def.cost ?? 0) || a.def.duration - b.def.duration)[0];
  return next !== undefined && player.travel(next.venue) && player.run(next.spot, next.def.id).ok;
}

/** Work through today's and this week's missions as a determined player would, then collect every finished one. */
function missionRun(player: Player) {
  const pending = () => { const view = player.view().missions; return [...view.daily, ...view.weekly].filter((mission) => !mission.done); };
  const def = (id: string) => [...DAILY_MISSIONS, ...WEEKLY_MISSIONS].find((mission) => mission.id === id);
  let guard = 0;
  for (const mission of pending()) {
    const rule = must(def(mission.id));
    for (let left = mission.count - mission.n; left > 0 && guard++ < 40; left--) {
      if (player.state.needs.energy < 35 || player.state.needs.hunger < 30) player.upkeep({ energy: 80, hunger: 70 });
      if (rule.on === 'venue') {
        const fresh = VENUE_IDS.find((venue) => venue !== 'home' && venue !== player.state.location && isOpen(must(VENUES[venue], 'registered venue').hours, player.now) && !player.state.missions.visited.list.includes(venue));
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

/**
 * One day of a UNILAG student's campus life, through the same actions the Campus app sends. Admission needs Coding
 * (or Charisma) level 1; a semester is seven Lagos days of lectures in their slots, then the tests, then it is closed.
 */
function studentDay(player: Player) {
  const student = () => player.state.unilagStudent;
  if (student().status === 'graduated' || !PROGRAMMES[SIM_PROGRAMME]) return;
  if (!player.travel('unilag')) return;
  const at = (spot: string) => player.state.spot === spot || player.do('spot', { id: spot }).ok;
  const task = (type: string, payload?: Json) => { const started = player.do(type, payload); if (started.ok) player.settle(); return started; };
  for (let read = 0; read < 12 && skillLevel(player.state, 'coding') < 1 && skillLevel(player.state, 'charisma') < 1; read++) if (!player.run('library', 'read-library').ok) break;
  if (['none', 'dropped'].includes(student().status) && at('senate')) player.do('unilag.apply', { programme: SIM_PROGRAMME });
  if (student().status === 'admitted' && at('senate')) player.do('unilag.matriculate');
  if (student().status === 'matriculated' && !student().term && at('senate')) {
    const number = student().records.some((record) => record.semester === 1 && record.passed) ? 2 : 1;
    if (player.do('unilag.register-semester', { courses: must(semesterOf(SIM_PROGRAMME, number)).courses.map((course) => course.id) }).ok) player.do('unilag.hostel.allocate', { hall: 'mariere' });
  }
  const term = student().term, spot = PROGRAMMES[SIM_PROGRAMME].spot;
  if (term && student().status === 'studying') {
    const courses = must(semesterOf(SIM_PROGRAMME, term.semester)).courses, today = lagosTime(player.now).day;
    if (today < term.deadlineDay) {
      // Every course's lecture in its own slot (the morning ones first), then its assignment, once.
      for (const course of [...courses].sort((a, b) => LECTURE_SLOTS[a.slot].open - LECTURE_SLOTS[b.slot].open)) {
        const opens = lagosDayStart(today) + LECTURE_SLOTS[course.slot].open * 60000, closes = lagosDayStart(today) + LECTURE_SLOTS[course.slot].close * 60000;
        if (player.now < opens) player.awayUntil(opens + 60000);
        if (player.now < closes - 60000 && at(spot)) task('unilag.lecture', { course: course.id });
      }
      for (const course of courses) if (must(must(student().term).assessments[course.id]).assignment === null && at(spot)) task('unilag.assignment', { course: course.id });
    } else {
      for (const course of courses) if (must(must(student().term).assessments[course.id]).test === null && at(spot)) task('unilag.test', { course: course.id });
      player.do('unilag.close-semester');
    }
  }
  // One paid campus job a Lagos day, for a current student.
  if (student().studentId && ['matriculated', 'studying'].includes(student().status) && at(SIM_CAMPUS_JOB.spot)) task('unilag.job', { id: SIM_CAMPUS_JOB.id });
}

/** What a strategy is told about the run. */
export interface SimOptions { track: string; budget: number; mixBudget: number }
/** One way of playing a day. */
export interface Strategy {
  label: string;
  /** The first sitting, before day one. */
  first?: (player: Player, options: SimOptions) => void;
  day(player: Player, index: number, options: SimOptions): void;
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
  student: {
    label: 'student (UNILAG)',
    first: (player) => firstSitting(player, 'community-helper'),
    day(player) {
      player.upkeep({ mode: 'trek' });
      studentDay(player);
      // The helper shift is what pays the fees.
      player.upkeep({ energy: 40, hunger: 45, mode: 'trek' });
      if (player.travel('park', 'trek')) player.run('work', 'helper-shift');
      player.upkeep({ mode: 'trek' });
    },
  },
} satisfies Record<string, Strategy>;
export type StrategyId = keyof typeof STRATEGIES;

/** Every start the birth lottery allows: [{ lottery, house }] — the own starter house first, then each rented home. */
export const STARTS = Object.values(LOTTERY).flatMap((outcome) => [OWN, ...(Object.keys(START_HOMES) as StartHomeId[]).filter((house) => !outcome.locked?.[house] && outcome.startCash[house] !== undefined)]
  .map((house) => ({ lottery: outcome.id, house })));

/**
 * Play one life. Returns the report row. `days` is the reported period; the life is played on to
 * `horizon` days only to find when the next house and the cheapest car first became affordable.
 */
export interface SimulateOptions { lottery: string; house: string; strategy: StrategyId; days?: number; horizon?: number; track?: string; budget?: number; mixBudget?: number }
/** One line of the report. The fields from `final` on are set once the reported day is reached. */
export interface Row {
  lottery: string; house: string; strategy: StrategyId; label: string; track: string | null; startCash: number;
  netWorth: Record<number, number>; cash: Record<number, number>; firstPromotionDay: number | null; rentMissedWeeks: number; minCash: number;
  nextHouse: string | null; nextHouseDay: number | null; carDay: number | null; activePerDay: number;
  final?: { cash: number; netWorth: number; arrears: number; loanLeft: number; level: number; needs: Record<string, number>; job: string | null };
  flows?: Record<string, number>;
  ledgerSum?: number;
  seed?: number;
  credits?: (LedgerLine & { category: string })[];
  unknown?: string[];
  conserved?: boolean;
  refusals?: Record<string, number>;
  student?: { status: string; records: { semester: number; passed: boolean; gpa: number; scholarship: unknown }[]; jobDays: number };
  player?: Player;
}
export function simulate({ lottery, house, strategy, days = 30, horizon = days, track = 'tech', budget = 300, mixBudget = 1800 }: SimulateOptions): Row {
  const plan: Strategy = STRATEGIES[strategy];
  const options: SimOptions = { track, budget, mixBudget };
  const player = new Player({ lottery, house });
  const startCash = player.state.cash;
  // The next house: for a renter the next rented tier; for an owner the first upgrade of their own house (its price in their
  // local government, and its weekly ground rent).
  const upgradeTier = must(TIER_ORDER[1]);
  const followingHouse = HOUSE_ORDER[HOUSE_ORDER.indexOf(house as (typeof HOUSE_ORDER)[number]) + 1];
  const nextHouse = house === OWN ? { id: upgradeTier, moveIn: tierCost(CITY, SIM_LGA, upgradeTier), rent: must(HOUSE_TIERS[upgradeTier]).groundRent }
    : (followingHouse === undefined ? undefined : HOUSES[followingHouse]) ?? null;
  const row: Row = { lottery, house, strategy, label: plan.label, track: plan === STRATEGIES.career || plan === STRATEGIES.optimal || plan === STRATEGIES.social ? track : null, startCash,
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
    if (nextHouse && row.nextHouseDay === null && player.state.cash >= (nextHouse.moveIn ?? 0) + 4 * nextHouse.rent) row.nextHouseDay = day;
    if (row.carDay === null && player.state.cash >= CHEAPEST_CAR.price) row.carDay = day;
    if (day === days) {
      row.final = { cash: player.state.cash, netWorth: player.netWorth(), arrears: player.state.economy.rent.arrears, loanLeft: player.state.economy.loan?.left ?? 0,
        level: player.state.career.level, needs: { ...player.state.needs }, job: player.state.job };
      row.activePerDay = Math.round(player.activeSeconds / days);
      const flows: Record<string, number> = {};
      for (const line of player.lines) { const category = categoryOf(line); flows[category] = (flows[category] ?? 0) + line.amount; }
      row.flows = flows;
      row.ledgerSum = player.lines.reduce((sum, line) => sum + line.amount, 0);
      row.seed = player.seed;
      row.credits = player.lines.filter((line) => line.amount > 0).map((line) => ({ ...line, category: categoryOf(line) }));
      row.unknown = [...new Set(player.lines.filter((line) => categoryOf(line) === 'other').map((line) => line.reason))];
      row.conserved = player.seed + row.ledgerSum === player.state.cash;
      row.refusals = { ...player.refusals };
      row.student = { status: player.state.unilagStudent.status, records: player.state.unilagStudent.records.map((record) => ({ semester: record.semester, passed: record.passed, gpa: record.gpa, scholarship: record.scholarshipAwarded })), jobDays: player.state.unilagStudent.lifetime.campusJobDays.length };
      if (!nextHouse && row.carDay !== null) break;
    }
    if (day >= days && (row.nextHouseDay !== null || !nextHouse) && row.carDay !== null) break;
  }
  row.player = player;
  return row;
}

// ---- lives across two cities ---------------------------------------------------------------------------------------------------
/** What one life across cities reports. */
export interface CityLife {
  label: string; days: number; startCash: number; finalCash: number; ledgerSum: number; conserved: boolean; unknown: string[];
  /** Where the life was at each stage, and what it held then. */
  stages: { stage: string; city: string; cash: number }[];
  fares: { to: string; mode: string; fare: number }[];
  player: Player;
}
/** The local government a simulated Ibadan player settles in. */
export const IBADAN_LGA = 'ibadan-north';
const IBADAN_HELPER = { venue: 'mapo-hall', spot: 'work' };

/** One day in the starting city's own helper job: free upkeep at home, then a shift where the job is. */
function helperDay(player: Player, venue: string, spot: string, shift?: string) {
  player.upkeep({ energy: 40, hunger: 45, mode: 'trek' });
  if (player.travel(venue, 'trek')) player.run(spot, shift ?? must(player.view().career.shift, 'the city\'s helper shift').id);
  player.upkeep({ mode: 'trek' });
}
/** An activity of the Ibadan venue by id, wherever the venue puts it. */
function ibadanActivity(player: Player, venue: string, id: string) {
  const spot = spotsOf(venue as VenueId, 'ibadan').find((candidate) => candidate.activities.some((def) => def.id === id));
  if (!spot) throw new Error(`${venue} has no activity ${id}`);
  return player.travel(venue, 'trek') && player.run(spot.id, id).ok;
}
function cityLife(label: string, days: number, player: Player, startCash: number, stages: CityLife['stages'], fares: CityLife['fares']): CityLife {
  player.settle();
  const ledgerSum = player.lines.reduce((sum, line) => sum + line.amount, 0);
  const unknown = [...new Set(player.lines.filter((line) => categoryOf(line) === 'other').map((line) => line.reason))];
  return { label, days, startCash, finalCash: player.state.cash, ledgerSum, conserved: player.seed + ledgerSum === player.state.cash, unknown, stages, fares, player };
}

/** A new player who starts in Ibadan: settles in an Ibadan local government, plays the helper job and two of the city's own activities for `days`. */
export function simulateIbadanStart({ days = 14, lga = IBADAN_LGA }: { days?: number; lga?: string } = {}): CityLife {
  const player = new Player({ lottery: '', house: OWN, city: { id: 'ibadan', lga } });
  const stages: CityLife['stages'] = [];
  const mark = (stage: string) => stages.push({ stage, city: player.cityId, cash: player.state.cash });
  mark('settled');
  firstSitting(player, 'community-helper');
  for (let index = 0; index < days; index++) {
    player.awayUntil(dayStart(index) + 9 * 3600000);
    helperDay(player, IBADAN_HELPER.venue, IBADAN_HELPER.spot);
    if (index % 2 === 0) ibadanActivity(player, 'ui-campus', 'ibadan-ui-walk');
    else ibadanActivity(player, 'bowers-tower', 'ibadan-tower-view');
    player.settle();
  }
  mark('played');
  return cityLife('Ibadan start', days, player, player.seed, stages, []);
}

/** One Lagos life that goes to Ibadan by road, works and settles there, comes home by rail and works in Lagos again. */
export function simulateTraveller({ daysEach = 3 }: { daysEach?: number } = {}): CityLife {
  const player = new Player({ lottery: 'civil-servant', house: OWN });
  const stages: CityLife['stages'] = [];
  const fares: CityLife['fares'] = [];
  const mark = (stage: string) => stages.push({ stage, city: player.cityId, cash: player.state.cash });
  let day = 0;
  const play = (venue: string, spot: string, shift: string, count: number) => {
    for (let i = 0; i < count; i++) { player.awayUntil(dayStart(day++) + 9 * 3600000); helperDay(player, venue, spot, shift); player.settle(); }
  };
  firstSitting(player, 'community-helper');
  mark('lagos');
  play('park', 'work', 'helper-shift', daysEach);
  const travelTo = (to: string, mode: string) => {
    player.settle();
    const before = player.state.cash;
    player.must('estate.relocate', { to, mode });
    player.settle();
    fares.push({ to, mode, fare: before - player.state.cash });
    mark(`arrived in ${to}`);
  };
  player.awayUntil(dayStart(day++) + 9 * 3600000);
  travelTo('ibadan', 'road');
  // A traveller is a visitor: nothing is bought or chosen in the city it visits.
  mark('visiting Ibadan');
  for (let i = 0; i < daysEach; i++) {
    player.awayUntil(dayStart(day++) + 9 * 3600000);
    // The held job moves with the player (free, level kept): it is worked at the city's own workplace, then a city place is visited.
    if (i === 0) player.must('apply-job', { id: 'community-helper' });
    helperDay(player, IBADAN_HELPER.venue, IBADAN_HELPER.spot);
    ibadanActivity(player, 'bowers-tower', 'ibadan-tower-view');
    player.settle();
  }
  player.awayUntil(dayStart(day++) + 9 * 3600000);
  travelTo('lagos', 'rail');
  player.must('apply-job', { id: 'community-helper' });
  play('park', 'work', 'helper-shift', daysEach);
  mark('home again');
  return cityLife('Lagos, Ibadan, Lagos', day, player, player.seed, stages, fares);
}

// ---- Ogun lives ----------------------------------------------------------------------------------------------------------------
/** The local government a simulated player settles in, in each open Ogun city. */
export const OGUN_LGAS: Readonly<Record<string, string>> = Object.freeze({ abeokuta: 'abeokuta-south', ota: 'ado-odo-ota', 'ijebu-ode': 'ijebu-ode', sagamu: 'sagamu' });
/** The local government or area council a simulated player settles in, in Port Harcourt, Abuja and Kano. */
export const STATE_CITY_LGAS: Readonly<Record<string, string>> = Object.freeze({ 'port-harcourt': 'obio-akpor', abuja: 'bwari', kano: 'nassarawa' });
const CITY_LGAS: Readonly<Record<string, string>> = { ...OGUN_LGAS, ...STATE_CITY_LGAS };

/** Where a city's helper job is worked, and the first free activity at some other venue of the city. */
function ogunPlaces(cityId: string) {
  const content = must(cachedCityContent(cityId), `${cityId} content`);
  const job = must(content.workplaces.find((item) => item.careerId === 'community-helper'), `${cityId} helper workplace`).definition;
  for (const venue of content.venues) {
    if (venue.id === 'home' || venue.id === job.workplace.venue) continue;
    for (const spot of Object.values(venue.definition.spots)) {
      const activity = (spot.activities ?? []).find((item) => !item.cost && !item.hours && !item.requiresIllness && !item.requiresSkill && !item.requiresMoodlet);
      if (activity) return { work: { venue: job.workplace.venue, spot: job.workplace.spot }, play: { venue: venue.id, spot: spot.id, activity: activity.id } };
    }
  }
  throw new Error(`${cityId} has no free activity to play`);
}
function ogunDay(player: Player, places: ReturnType<typeof ogunPlaces>, play: boolean) {
  helperDay(player, places.work.venue, places.work.spot);
  if (play && player.travel(places.play.venue, 'trek')) player.run(places.play.spot, places.play.activity);
}

/** A new player who starts in one Ogun city: settles in a local government there, works the city's helper job and plays one of its places for `days`. */
export function simulateOgunStart({ city = 'abeokuta', days = 14 }: { city?: string; days?: number } = {}): CityLife {
  const places = ogunPlaces(city);
  const player = new Player({ lottery: '', house: OWN, city: { id: city, lga: must(CITY_LGAS[city], `${city} local government`) } });
  const stages: CityLife['stages'] = [];
  stages.push({ stage: 'settled', city: player.cityId, cash: player.state.cash });
  firstSitting(player, 'community-helper');
  for (let index = 0; index < days; index++) {
    player.awayUntil(dayStart(index) + 9 * 3600000);
    ogunDay(player, places, index % 2 === 0);
    player.settle();
  }
  stages.push({ stage: 'played', city: player.cityId, cash: player.state.cash });
  return cityLife(`${city} start`, days, player, player.seed, stages, []);
}

/**
 * One Lagos life that crosses to Ota by road, settles and plays there, goes on to Abeokuta by road, settles and plays there, takes the
 * Abeokuta train to Ibadan and returns to Lagos by the Abeokuta road, then works its Lagos job again: five fares, one wallet.
 */
export function simulateOgunTraveller({ daysEach = 3 }: { daysEach?: number } = {}): CityLife {
  const player = new Player({ lottery: 'civil-servant', house: OWN });
  const stages: CityLife['stages'] = [];
  const fares: CityLife['fares'] = [];
  const mark = (stage: string) => stages.push({ stage, city: player.cityId, cash: player.state.cash });
  let day = 0;
  firstSitting(player, 'community-helper');
  mark('lagos');
  const lagosDays = (count: number) => { for (let i = 0; i < count; i++) { player.awayUntil(dayStart(day++) + 9 * 3600000); helperDay(player, 'park', 'work', 'helper-shift'); player.settle(); } };
  const travelTo = (to: string, mode: string) => {
    player.awayUntil(dayStart(day++) + 9 * 3600000);
    player.settle();
    const before = player.state.cash;
    player.must('estate.relocate', { to, mode });
    player.settle();
    fares.push({ to, mode, fare: before - player.state.cash });
    mark(`arrived in ${to}`);
  };
  const live = (city: string) => {
    mark(`visiting ${city}`);
    const places = ogunPlaces(city);
    for (let i = 0; i < daysEach; i++) {
      player.awayUntil(dayStart(day++) + 9 * 3600000);
      // The held job moves with the player (free, level kept), so each day is a shift at the city's workplace and one of its places.
      if (i === 0) player.must('apply-job', { id: 'community-helper' });
      ogunDay(player, places, true);
      player.settle();
    }
  };
  lagosDays(daysEach);
  travelTo('ota', 'road'); live('ota');
  travelTo('abeokuta', 'road'); live('abeokuta');
  travelTo('ibadan', 'rail');
  travelTo('abeokuta', 'road');
  travelTo('lagos', 'road');
  player.must('apply-job', { id: 'community-helper' });
  lagosDays(daysEach);
  mark('home again');
  return cityLife('Lagos, Ota, Abeokuta, Ibadan, Lagos', day, player, player.seed, stages, fares);
}

/**
 * One Lagos life with a comfortable start that takes the night bus to Abuja, settles and works there, goes on to Kano by road, settles and works there,
 * flies back to Abuja, takes the bus to Port Harcourt, settles and works there and returns to Lagos by road: five fares across four cities, one wallet.
 */
export function simulateStatesTraveller({ daysEach = 2 }: { daysEach?: number } = {}): CityLife {
  const player = new Player({ lottery: 'ajebutter', house: OWN });
  const stages: CityLife['stages'] = [];
  const fares: CityLife['fares'] = [];
  const mark = (stage: string) => stages.push({ stage, city: player.cityId, cash: player.state.cash });
  let day = 0;
  firstSitting(player, 'community-helper');
  mark('lagos');
  const travelTo = (to: string, mode: string) => {
    player.awayUntil(dayStart(day++) + 9 * 3600000);
    player.settle();
    const before = player.state.cash;
    player.must('estate.relocate', { to, mode });
    player.settle();
    fares.push({ to, mode, fare: before - player.state.cash });
    mark(`arrived in ${to}`);
  };
  const live = (city: string) => {
    mark(`visiting ${city}`);
    const places = ogunPlaces(city);
    for (let i = 0; i < daysEach; i++) {
      player.awayUntil(dayStart(day++) + 9 * 3600000);
      if (i === 0) player.must('apply-job', { id: 'community-helper' });
      ogunDay(player, places, true);
      player.settle();
    }
  };
  travelTo('abuja', 'road'); live('abuja');
  travelTo('kano', 'road'); live('kano');
  travelTo('abuja', 'air');
  travelTo('port-harcourt', 'road'); live('port-harcourt');
  travelTo('lagos', 'road');
  player.must('apply-job', { id: 'community-helper' });
  mark('home again');
  return cityLife('Lagos, Abuja, Kano, Abuja, Port Harcourt, Lagos', day, player, player.seed, stages, fares);
}

const naira = (value: number | null | undefined) => (value === undefined || value === null ? '—' : `${value < 0 ? '−' : ''}₦${Math.abs(Math.round(value)).toLocaleString('en-NG')}`);
const short = (value: number | null | undefined) => (value === undefined || value === null ? '—' : Math.abs(value) >= 1e6 ? `${(value / 1e6).toFixed(2)}m` : Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value));

/** The whole table: every start × every strategy. */
export function runEconomy({ days = 30, horizon = 365, track = 'tech', strategies = Object.keys(STRATEGIES) as StrategyId[] }: { days?: number; horizon?: number; track?: string; strategies?: StrategyId[] } = {}): Row[] {
  const rows: Row[] = [];
  for (const start of STARTS) {
    const career = simulate({ ...start, strategy: 'career', days, horizon, track });
    for (const strategy of strategies) {
      // "Equal effort": the gig player gets exactly the active seconds a day the career player used.
      rows.push(strategy === 'career' ? career : simulate({ ...start, strategy, days, horizon: strategy === 'idle' ? days : horizon, track, budget: career.activePerDay }));
    }
  }
  return rows;
}

export function formatTable(rows: Row[]): string {
  const head = ['start', 'strategy', 'start ₦', ...CHECKPOINTS.map((day) => `d${day}`), 'wages', 'gigs', 'goals', 'hunt', 'missn', 'tables', 'refer', 'campus', 'food', 'transp', 'rent', 'loan', 'promo', 'rent ok', 'act s/d', 'next house', 'car'];
  const lines = rows.map((row): string[] => { const flows = must(row.flows); return [`${row.lottery}/${row.house}`, `${row.label}${row.track ? ` (${row.track})` : ''}`, short(row.startCash), ...CHECKPOINTS.map((day) => short(row.netWorth[day])),
    short(flows.wages ?? 0), short(flows.gigs ?? 0), short(flows.goals ?? 0), short(flows.hunt ?? 0), short(flows.missions ?? 0), short(flows.tables ?? 0), short(flows.referral ?? 0), short((flows.campusFees ?? 0) + (flows.campusPay ?? 0)), short(flows.food ?? 0), short(flows.transport ?? 0), short(flows.rent ?? 0), short(flows.loan ?? 0),
    row.firstPromotionDay ? `d${row.firstPromotionDay}` : '—', row.rentMissedWeeks ? `missed ${row.rentMissedWeeks}` : 'yes', String(row.activePerDay),
    row.nextHouse ? (row.nextHouseDay ? `${row.nextHouse} d${row.nextHouseDay}` : `${row.nextHouse} —`) : 'top', row.carDay ? `d${row.carDay}` : '—']; });
  const widths = head.map((title, column) => Math.max(title.length, ...lines.map((line) => (line[column] ?? '').length)));
  const format = (cells: string[]) => cells.map((cell, column) => (column < 2 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0))).join('  ');
  return [format(head), widths.map((width) => '-'.repeat(width)).join('  '), ...lines.map(format)].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string | number) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : fallback; };
  const days = Number(option('days', 30)), horizon = Number(option('horizon', 365)), track = String(option('track', 'tech'));
  const rows = runEconomy({ days, horizon, track });
  console.log(`Economy simulation · ${days} Lagos days from Monday 5 January 2026 · career track ${track} · milestones searched to day ${horizon}`);
  console.log('Net worth = cash + deposits − loan left − rent arrears. Flows are 30-day totals in naira; costs are negative. "act s/d" = active seconds a day.');
  console.log(formatTable(rows));
  const lives = [simulateIbadanStart(), simulateTraveller(), ...Object.keys(CITY_LGAS).map((city) => simulateOgunStart({ city })), simulateOgunTraveller(), simulateStatesTraveller()];
  console.log('Lives across cities (14 days in Ibadan, each Ogun city, Port Harcourt, Abuja and Kano; Lagos → Ibadan by road → Lagos by rail; Lagos → Ota → Abeokuta → Ibadan → Abeokuta → Lagos; Lagos → Abuja → Kano → Abuja → Port Harcourt → Lagos):');
  for (const life of lives) console.log(`  ${life.label}: cash ${naira(life.player.seed)} seed → ${naira(life.finalCash)} · ledger ${naira(life.ledgerSum)} · ${life.conserved ? 'conserved' : 'NOT CONSERVED'} · ${life.stages.map((stage) => `${stage.stage} (${stage.city}) ${naira(stage.cash)}`).join(' → ')}`);
  const bad = rows.filter((row) => !row.conserved || must(row.unknown).length);
  console.log(bad.length ? `NOT CONSERVED or unknown reasons in ${bad.length} rows: ${JSON.stringify(bad.map((row) => [row.lottery, row.house, row.strategy, row.unknown]))}` : `Conservation: cash = seed + Σ ledger in all ${rows.length} lives; every ledger reason is classified.`);
  console.log(`Next house = move-in + 4 weeks' rent: ${HOUSE_ORDER.map((id) => `${id} ${naira((must(HOUSES[id]).moveIn ?? 0) + 4 * must(HOUSES[id]).rent)}`).join(' · ')} · own house upgrade (${TIER_ORDER[1]} in ${SIM_LGA}) ${naira((tierCost(CITY, SIM_LGA, must(TIER_ORDER[1])) ?? 0) + 4 * must(HOUSE_TIERS[must(TIER_ORDER[1])]).groundRent)} · cheapest car ${naira(CHEAPEST_CAR.price)}`);
  // Player-owned shops: owners, a trader and two colluding players. That file plays this one's lives, so it is loaded once this one has finished loading (not awaited here).
  void import('./business-sim.ts').then(({ formatBusiness, runBusiness }) => {
    console.log(`Businesses (${days} days; "made" = cash change + cash box + what closing would return; docs/BUSINESS.md):`);
    console.log(formatBusiness(runBusiness({ days })));
  });
}
