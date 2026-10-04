// Design intent of the economy, checked against scripts/economy-sim.mjs — scripted lives played
// through the real rules engine on a virtual clock. If a content change breaks one of these, the
// change is the thing to question, not the assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UNILAG_BETA_RULES as UNILAG_BETA_RULES_JS } from '../campus/unilag/curriculum.js';
import { CAMPUS_JOBS as CAMPUS_JOBS_JS } from '../campus/unilag/student.js';
import type { CampusJobDefinition, UnilagBetaRules } from '../types/campus.ts';
import * as economySim from '../../scripts/economy-sim.ts';
import { lagosTime } from './clock.ts';
import { GIG_DAILY_LIMIT } from './content/venues.ts';
import { TRACKS, HELPER_COOLDOWN_SECONDS } from './content/jobs.ts';
import { HOUSES } from './content/housing.ts';
import { HUNT } from './content/civic.ts';
import { MISSION_REWARDS } from './content/missions.ts';
import { REFERRAL, TABLE_REWARDS } from './content/growth.ts';
import type { LifeState, ActionOutcome } from '../types/life.ts';
import { RENTS, LOAN, LOAN_LATE_FEE, MAX_LOAN_FEES, MAX_ARREARS_WEEKS, LATE_FEE_PERCENT, DEPOSIT_TOTAL_CAP, DEPOSIT_TERMS } from './systems/economy.ts';

/**
 * The part of scripts/economy-sim.mjs this file uses. The script is untyped JavaScript, so its exports are described here
 * (rows are the objects `simulate` returns, filled in as the run reaches its `days`).
 */
interface SimLine { amount: number; reason: string; balance: number; at: number }
interface SimCredit extends SimLine { category: string }
interface SimPlayer {
  state: LifeState;
  now: number;
  lines: SimLine[];
  returnedAt: number;
  awayUntil(ms: number): void;
  travel(venue: string, mode: string): boolean;
  upkeep(options: { hunger: number; hygiene: number; energy: number; mode: string }): boolean;
  do(type: string, payload?: Record<string, unknown>): ActionOutcome;
  run(spot: string, id: string, choice?: string): ActionOutcome;
  settle(): void;
}
/** A value at each of CHECKPOINTS (days 1, 3, 7, 14, 30). */
interface Checkpoints { 1: number; 3: number; 7: number; 14: number; 30: number }
interface SimStart { lottery: string; house: string }
interface SimStudent { status: string; records: { semester: number; passed: boolean; gpa: number; scholarship: boolean }[]; jobDays: number }
interface SimRow extends SimStart {
  student: SimStudent;
  strategy: string;
  netWorth: Checkpoints;
  cash: Checkpoints;
  firstPromotionDay: number | null;
  rentMissedWeeks: number;
  minCash: number;
  nextHouse: string | null;
  nextHouseDay: number | null;
  carDay: number | null;
  activePerDay: number;
  final: { cash: number; netWorth: number; arrears: number; loanLeft: number; level: number; needs: Record<string, number> };
  flows: Record<string, number | undefined>;
  ledgerSum: number;
  credits: SimCredit[];
  unknown: string[];
  conserved: boolean;
  refusals: Record<string, number | undefined>;
  player: SimPlayer;
}
interface SimOptions extends SimStart { strategy: string; days: number; horizon: number; track?: string; budget?: number }
interface EconomySim {
  runEconomy(options: { days: number; horizon: number; track: string }): SimRow[];
  simulate(options: SimOptions): SimRow;
  Player: new (start: SimStart) => SimPlayer;
  STARTS: SimStart[];
  STRATEGIES: Record<string, { day(player: SimPlayer): void }>;
  GIGS: unknown[];
  CHECKPOINTS: number[];
  CHEAPEST_CAR: { label: string };
  categoryOf(line: { reason: string; amount: number }): string;
}
// Trust boundary: the script is plain JavaScript; the shapes above are what it builds.
const { runEconomy, simulate, Player, STARTS, STRATEGIES, GIGS, CHECKPOINTS, CHEAPEST_CAR, categoryOf } = economySim as unknown as EconomySim;

/** A value a test needs to be there: fails the test, with a message, instead of being read as `undefined`. */
const found = <T>(value: T | undefined, what: string): T => { assert.ok(value !== undefined, `${what} exists`); return value; };
/** The naira a row's life took in (or paid out) in one category; the row must have any at all. */
const flow = (row: SimRow, category: string): number => found(row.flows[category], `${row.lottery}/${row.house} ${row.strategy} ${category} flow`);

// Trust boundary: the campus tables are plain JavaScript; src/types/campus.ts describes them.
const UNILAG_BETA_RULES = UNILAG_BETA_RULES_JS as unknown as UnilagBetaRules;
const CAMPUS_JOBS = CAMPUS_JOBS_JS as unknown as Record<string, CampusJobDefinition>;

const DAYS = 30, HORIZON = 200;
const rows = runEconomy({ days: DAYS, horizon: HORIZON, track: 'tech' });
const of = (strategy: string) => rows.filter((row) => row.strategy === strategy);
const at = (row: SimRow) => `${row.lottery}/${row.house} ${row.strategy}`;
/** Pay of a track's first and last rung. */
const entryPay = (track: (typeof TRACKS)[number]): number => found(track.ladder[0], 'a first rung').pay;
const topPay = (track: (typeof TRACKS)[number]): number => found(track.ladder.at(-1), 'a top rung').pay;
const weeklyEntry = (track: (typeof TRACKS)[number]) => entryPay(track) * track.days.length;
const lowestTrack = found([...TRACKS].sort((a, b) => weeklyEntry(a) - weeklyEntry(b))[0], 'a track');

test('economy: the table covers every start and strategy, deterministically', () => {
  assert.equal(rows.length, STARTS.length * Object.keys(STRATEGIES).length);
  assert.deepEqual(STARTS.map((start) => `${start.lottery}/${start.house}`), ['lapo-baby/own', 'lapo-baby/mushin', 'lapo-baby/yaba', 'civil-servant/own', 'civil-servant/mushin', 'civil-servant/yaba', 'civil-servant/lekki',
    'street-smart/own', 'street-smart/mushin', 'street-smart/yaba', 'ajebutter/own', 'ajebutter/mushin', 'ajebutter/yaba', 'ajebutter/lekki']);
  for (const row of rows) assert.deepEqual(Object.keys(row.netWorth).map(Number), CHECKPOINTS, at(row));
  const again = simulate({ lottery: 'lapo-baby', house: 'yaba', strategy: 'optimal', days: DAYS, horizon: DAYS });
  const first = simulate({ lottery: 'lapo-baby', house: 'yaba', strategy: 'optimal', days: DAYS, horizon: DAYS });
  assert.deepEqual([again.netWorth, again.flows, again.ledgerSum], [first.netWorth, first.flows, first.ledgerSum], 'the same life twice gives the same numbers');
});

test('economy: no strategy creates money from nothing', () => {
  const sources = new Set(['start', 'wages', 'gigs', 'goals', 'hunt', 'savings', 'events', 'purchases', 'missions', 'tables', 'referral', 'campusPay']);
  for (const row of rows) {
    assert.equal(row.conserved, true, `${at(row)}: cash = seed + Σ ledger`);
    assert.deepEqual(row.unknown, [], `${at(row)}: every ledger reason is one the report knows`);
    assert.ok(row.minCash >= 0, `${at(row)}: cash never went below zero`);
    for (const line of row.credits) assert.ok(sources.has(line.category), `${at(row)}: unexpected credit “${line.reason}” (${line.category})`);
    assert.equal(row.credits.filter((line) => line.category === 'start').length, 1, `${at(row)}: start cash is paid once`);
    assert.ok((row.flows.goals ?? 0) <= 10000, `${at(row)}: starter goals pay at most ₦10,000 in total (₦8,000 observed + the three opening goals, ₦2,000, original beta values)`);
    // Deposits: what comes back is what went in plus capped interest — never more than a week's best rate on the cap, per week.
    const interest = row.flows.savings ?? 0;
    assert.ok(interest <= Math.ceil(DAYS / 7) * DEPOSIT_TOTAL_CAP * DEPOSIT_TERMS.d7.bps / 10000, `${at(row)}: deposit interest is bounded (${interest})`);
  }
  for (const row of of('idle')) {
    // The quick start's three opening goals (a round of Ayo, a hello, settling in) are played before any strategy begins.
    assert.deepEqual(row.credits.map((line) => line.category), ['goals', 'goals', 'start', 'goals'], `${at(row)}: an idle life is credited nothing after its start cash and the opening goals`);
    assert.equal(row.flows.goals, 2000, `${at(row)}: the opening goals pay ₦2,000`);
    assert.deepEqual([row.flows.wages ?? 0, row.flows.gigs ?? 0, row.flows.hunt ?? 0], [0, 0, 0]);
  }
});

test('economy: every repeatable source of money has a daily cap that holds in play', () => {
  for (const row of rows) {
    const perDay: Record<string, number> = {};
    for (const line of row.credits) {
      const key = `${lagosTime(line.at).day}|${line.category === 'events' ? line.reason : line.category}`;
      perDay[key] = (perDay[key] ?? 0) + 1;
    }
    for (const [key, count] of Object.entries(perDay)) {
      const kind = key.split('|')[1];
      if (kind === 'gigs') assert.ok(count <= GIG_DAILY_LIMIT, `${at(row)}: ${count} paid gigs in one day`);
      if (kind === 'hunt') assert.equal(count, 1, `${at(row)}: one gem prize a day`);
      if (kind === 'wages') assert.ok(count <= (row.strategy === 'helper' ? 86400 / HELPER_COOLDOWN_SECONDS : 1), `${at(row)}: ${count} paid shifts in one day`);
      if (kind === 'A wallet on the ground') assert.equal(count, 1, `${at(row)}: one found wallet a day`);
      if (kind === 'tables') assert.ok(count <= TABLE_REWARDS.paidWinsPerDay, `${at(row)}: ${count} paid table wins in one day`);
      if (kind === 'campusPay') assert.ok(count <= 2, `${at(row)}: ${count} campus credits in one day (one paid campus job, and the scholarship on the day a semester closes)`);
      if (kind === 'missions') assert.ok(count <= MISSION_REWARDS.daily.slots + MISSION_REWARDS.weekly.slots, `${at(row)}: ${count} missions paid in one day`);
    }
    const hunt = row.flows.hunt ?? 0;
    assert.ok(hunt <= DAYS * HUNT.prize, at(row));
  }
  assert.ok(GIGS.length >= 40, 'the gig catalogue is what the limit is spread over');
  assert.ok(of('gig-all-day').every((row) => (row.refusals.gig_limit ?? 0) === 0 && row.activePerDay < 600), 'a grinder stops when the day’s gigs are done instead of hammering the limit');
});

test('economy: a diligent career player stays solvent on every start, including the hardest, on the best and the worst-paid track', () => {
  for (const row of of('career')) {
    assert.equal(row.rentMissedWeeks, 0, `${at(row)}: rent was paid every Saturday`);
    assert.equal(row.final.arrears, 0, at(row));
    assert.ok(row.minCash > 0, at(row));
    assert.ok(row.firstPromotionDay !== null && row.firstPromotionDay <= 10, `${at(row)}: first promotion by day 10 (was day ${row.firstPromotionDay})`);
    assert.ok(row.netWorth[30] > row.netWorth[1], `${at(row)}: a month of work leaves the player better off`);
  }
  // The hardest start is the one an idle life drains fastest relative to what it began with.
  const hardest = found([...of('idle')].sort((a, b) => a.netWorth[30] - b.netWorth[30])[0], 'an idle row');
  assert.deepEqual([hardest.lottery, hardest.house], ['lapo-baby', 'mushin']);
  for (const start of [{ lottery: 'lapo-baby', house: 'mushin' }, { lottery: 'lapo-baby', house: 'yaba' }, { lottery: 'street-smart', house: 'yaba' }]) {
    const worst = simulate({ ...start, strategy: 'career', days: DAYS, horizon: DAYS, track: lowestTrack.id });
    assert.deepEqual([worst.rentMissedWeeks, worst.final.arrears, worst.minCash > 0, worst.conserved], [0, 0, true, true], `${start.lottery}/${start.house} on ${lowestTrack.id}`);
    assert.ok(worst.final.loanLeft <= LOAN.total - 4 * LOAN.weekly || start.lottery !== 'lapo-baby', 'the loan is being repaid on schedule');
  }
});

test('economy: gigs never beat a career at equal effort, and an all-day grinder stays within 1.5× of it', () => {
  for (const career of of('career')) {
    const same = (strategy: string) => found(of(strategy).find((row) => row.lottery === career.lottery && row.house === career.house), `${strategy} row`);
    const equal = same('gig'), allDay = same('gig-all-day'), helper = same('helper'), mix = same('optimal');
    const careerWages = flow(career, 'wages');
    assert.ok(equal.activePerDay <= career.activePerDay * 1.15, `${at(equal)}: “equal effort” really is (${equal.activePerDay}s vs ${career.activePerDay}s a day)`);
    assert.ok((equal.flows.gigs ?? 0) <= careerWages, `${at(equal)}: gigs ₦${equal.flows.gigs} vs wages ₦${careerWages} for the same active time`);
    assert.ok((allDay.flows.gigs ?? 0) <= 1.5 * careerWages, `${at(allDay)}: all-day gigs ₦${allDay.flows.gigs} vs wages ₦${careerWages}`);
    assert.ok(flow(helper, 'wages') <= careerWages / 3, `${at(helper)}: the starter job never rivals a career`);
    assert.ok(mix.netWorth[30] >= career.netWorth[30] && mix.netWorth[30] >= allDay.netWorth[30], `${at(mix)}: working AND gigging beats either alone`);
    assert.ok(flow(mix, 'wages') >= 0.35 * (flow(mix, 'wages') + flow(mix, 'gigs') + flow(mix, 'hunt')), `${at(mix)}: even for the best mix, wages stay a large share of income`);
  }
});

test('economy: an idle or broke player is never stuck — free food, wash, rest and work always exist, and debt is bounded', () => {
  for (const start of STARTS) {
    const player = new Player(start);
    // Idle for twenty weeks: one settlement a day, nothing else.
    for (let day = 1; day <= 140; day++) player.awayUntil(player.now + 86400000);
    const { economy, cash, needs } = player.state;
    assert.ok(Number.isSafeInteger(cash) && cash >= 0, `${start.lottery}/${start.house}: cash ${cash}`);
    const house = RENTS[found(economy.rent.house, 'a rented house') as keyof typeof RENTS];
    if (start.house === 'own') assert.deepEqual([economy.rent.house, economy.rent.arrears, player.state.estate.living, player.state.estate.ground.arrears], [null, 0, 'own', 0], 'the free starter house has no rent and no ground rent: nothing can fall into arrears');
    else assert.ok(economy.rent.arrears <= Math.round(house.rent * MAX_ARREARS_WEEKS * (1 + LATE_FEE_PERCENT / 100)), 'rent arrears are capped');
    assert.ok((economy.loan?.left ?? 0) <= LOAN.total + LOAN_LATE_FEE * MAX_LOAN_FEES, 'the loan can never grow past its total plus the capped fees');
    assert.ok(Object.values(needs).every((value) => value >= 10), 'needs never decay below the floor on their own');
    if (start.house !== 'own') assert.equal(player.state.property.house, start.house, 'nobody is evicted');
    else assert.deepEqual([player.state.estate.tier, player.state.estate.lgaConfirmed], ['starter', true], 'nobody loses their house');
    // Recovery with whatever is left, spending nothing: walk home, eat, wash, rest, then earn.
    const before = player.state.cash, spent = () => player.lines.filter((line) => line.amount < 0 && line.at > player.returnedAt).length;
    player.returnedAt = player.now - 1;
    assert.equal(player.travel('home', 'trek'), true, 'home is always reachable on foot');
    const hunger = player.state.needs.hunger, hygiene = player.state.needs.hygiene, energy = player.state.needs.energy;
    assert.equal(player.upkeep({ hunger: 90, hygiene: 90, energy: 90, mode: 'trek' }), true);
    assert.ok(player.state.needs.hunger > hunger && player.state.needs.hygiene > hygiene && player.state.needs.energy > energy, 'free food, a free wash and free rest all worked');
    assert.equal(spent(), 0, 'and cost nothing');
    assert.equal(player.do('apply-job', { id: 'community-helper' }).ok, true);
    assert.equal(player.travel('park', 'trek'), true);
    assert.equal(player.run('work', 'helper-shift').ok, true, 'a paid shift can be worked at once, at any hour');
    assert.deepEqual([player.lines.some((line) => line.reason === 'Community helper shift' && line.amount === 300), spent()], [true, 0], 'the first naira is earned without spending one');
    assert.ok(player.state.cash >= before + 300);
    // And a month of the career routine from there clears what is owed or is clearly on the way to it.
    const owed = player.state.economy.rent.arrears;
    assert.equal(player.do('career.switch', { id: 'tech' }).ok, true);
    for (let day = 0; day < 35; day++) { player.awayUntil(Math.ceil(player.now / 86400000) * 86400000 + 8 * 3600000); found(STRATEGIES.career, 'the career strategy').day(player); player.settle(); }
    assert.ok(player.state.economy.rent.arrears < Math.max(owed, 1) || owed === 0, `${start.lottery}/${start.house}: arrears fell from ${owed} to ${player.state.economy.rent.arrears}`);
    assert.ok(player.state.cash > before, 'and the player is better off than when they came back');
  }
});

test('economy: the next house and the cheapest car are reachable on a sane timescale; the fourth house is reachable by working', () => {
  for (const row of of('career')) {
    if (row.house !== 'lekki') assert.ok(row.nextHouseDay !== null && row.nextHouseDay <= 45, `${at(row)}: next house (${row.nextHouse}) affordable by day 45, was ${row.nextHouseDay}`);
    else assert.ok(row.nextHouseDay !== null && row.nextHouseDay <= HORIZON, `${at(row)}: the fourth house within ${HORIZON} days, was ${row.nextHouseDay}`);
    assert.ok(row.carDay !== null && row.carDay <= 90, `${at(row)}: the ${CHEAPEST_CAR.label} within 90 days of daily shifts, was ${row.carDay}`);
    assert.ok(row.carDay >= 20, `${at(row)}: and not handed over in the first weeks`);
  }
  for (const row of of('optimal')) assert.ok(row.carDay !== null && row.carDay >= 14 && row.carDay <= 45, `${at(row)}: best mix buys the first car in weeks, not days (${row.carDay})`);
  for (const row of of('helper')) assert.ok(row.carDay === null || row.carDay > 150, `${at(row)}: the starter job alone is not a way to a car`);
  // The top of the ladder can carry the fourth house's rent on the median track (see PAY_CURVE in content/jobs.js).
  const topWeekly = TRACKS.map((track) => topPay(track) * track.days.length).sort((a, b) => a - b);
  const medianTop = found(topWeekly[Math.floor(topWeekly.length / 2)], 'a median');
  assert.ok(medianTop >= HOUSES.ikoyi.rent, `median top-level weekly pay ₦${medianTop} vs Ikoyi rent ₦${HOUSES.ikoyi.rent}`);
});

test('economy: nothing overflows, even after a year of the best mix', () => {
  for (const row of rows) for (const value of [...Object.values(row.netWorth), ...Object.values(row.cash), row.ledgerSum, row.final.cash]) assert.ok(Number.isSafeInteger(value), `${at(row)}: ${value}`);
  const year = simulate({ lottery: 'ajebutter', house: 'lekki', strategy: 'optimal', days: 365, horizon: 365 });
  assert.equal(year.conserved, true);
  assert.ok(Number.isSafeInteger(year.final.cash) && year.final.cash < 1e9, `a year of the best mix ends at ₦${year.final.cash}`);
  assert.ok(Object.values(year.final.needs).every((value) => value >= 0 && value <= 100));
  assert.equal(year.final.level, 6, 'and reaches the top of the ladder');
  const state = year.player.state;
  assert.ok(Object.values(state.skills).every((xp) => Number.isFinite(xp) && xp >= 0 && xp <= 5500));
  assert.ok(Object.values(state.inventory).every((count) => Number.isSafeInteger(count) && count > 0));
  assert.ok(state.ledger.length <= 60 && state.ledgerDays.length <= 35, 'the history stays bounded');
  assert.equal(categoryOf({ reason: 'Tech shift', amount: 1 }), 'wages');
});

test('economy: missions, table wins and referrals stay inside their budget even with every cap reached', () => {
  const dailyMissions = MISSION_REWARDS.daily.slots * MISSION_REWARDS.daily.cash, weeklyMissions = MISSION_REWARDS.weekly.slots * MISSION_REWARDS.weekly.cash;
  const dailyTables = TABLE_REWARDS.paidWinsPerDay * TABLE_REWARDS.win;
  for (const career of of('career')) {
    const social = found(of('social').find((row) => row.lottery === career.lottery && row.house === career.house), 'a social row');
    const mix = found(of('optimal').find((row) => row.lottery === career.lottery && row.house === career.house), 'an optimal row');
    const { missions = 0, tables = 0, referral = 0 } = social.flows;
    assert.ok(missions > 0 && tables > 0 && referral > 0, `${at(social)}: the strategy really exercises all three (${missions}, ${tables}, ${referral})`);
    assert.ok(missions <= DAYS * dailyMissions + Math.ceil(DAYS / 7) * weeklyMissions, `${at(social)}: missions ₦${missions} are within three a day and three a week`);
    assert.equal(tables, DAYS * dailyTables, `${at(social)}: exactly ${TABLE_REWARDS.paidWinsPerDay} table wins a day were paid; the fifth never was`);
    assert.equal(referral, REFERRAL.welcome + REFERRAL.paidLifetime * REFERRAL.reward, `${at(social)}: one welcome gift and ${REFERRAL.paidLifetime} referral rewards for life, however many were tried`);
    assert.ok((social.refusals.referral_week_cap ?? 0) > 0 && (social.refusals.referral_lifetime_cap ?? 0) > 0 && (social.refusals.already_welcomed ?? 0) === 0, `${at(social)}: the weekly and lifetime referral caps both refused something`);
    // Per week no more than the weekly cap was paid, whatever was attempted.
    const perWeek: Record<number, number> = {};
    for (const line of social.credits) if (line.category === 'referral' && line.reason.startsWith('Referral')) perWeek[lagosTime(line.at).week] = (perWeek[lagosTime(line.at).week] ?? 0) + 1;
    assert.ok(Object.values(perWeek).every((count) => count <= REFERRAL.paidPerWeek), `${at(social)}: at most ${REFERRAL.paidPerWeek} referral rewards in a week`);
    // The budget: at the caps the new sources together stay below 60% of what the same month of work paid, and a
    // player who maxes all of them is still behind one who works, hunts gems and gigs.
    assert.ok(missions + tables + referral <= 0.6 * flow(career, 'wages'), `${at(social)}: new sources ₦${missions + tables + referral} vs wages ₦${flow(career, 'wages')}`);
    assert.ok(flow(social, 'wages') >= 0.6 * (flow(social, 'wages') + missions + tables + referral), `${at(social)}: wages stay the larger part of a social player's income`);
    assert.ok(social.netWorth[30] <= mix.netWorth[30], `${at(social)}: ₦${social.netWorth[30]} does not overtake the best mix ₦${mix.netWorth[30]}`);
    assert.equal(social.rentMissedWeeks, 0, at(social));
  }
  // The day's ceiling from the content alone: under a third of an entry-level day's pay on the median track.
  const entry = found(TRACKS.map(entryPay).sort((a, b) => a - b)[Math.floor(TRACKS.length / 2)], 'a median entry pay');
  assert.ok(dailyMissions + dailyTables <= 1350, `daily ceiling ₦${dailyMissions + dailyTables}`);
  assert.ok(entry > 0 && dailyMissions + dailyTables <= 0.5 * entry, `₦${dailyMissions + dailyTables} a day against an entry-level shift of ₦${entry}`);
});

test('economy: a UNILAG student pays every fee once, is paid for one campus job a day, graduates, and stays solvent on every start', () => {
  const fees = UNILAG_BETA_RULES.admissionFee + 2 * (UNILAG_BETA_RULES.tuition + UNILAG_BETA_RULES.levy + UNILAG_BETA_RULES.hostelFee);
  const bestJob = Math.max(...Object.values(CAMPUS_JOBS).map((job) => job.pay));
  for (const row of of('student')) {
    assert.deepEqual([row.student.status, row.student.records.filter((record) => record.passed).map((record) => record.semester)], ['graduated', [1, 2]], `${at(row)}: both semesters passed in ${DAYS} days`);
    assert.equal(row.student.records.length, 2, `${at(row)}: no semester had to be repeated`);
    // What the degree costs: one application, two registrations, two hostel rooms — each debited once.
    assert.equal(row.flows.campusFees, -fees, `${at(row)}: campus fees are ${fees}`);
    const lines = row.player.lines.filter((line) => categoryOf(line) === 'campusFees').map((line) => line.reason).sort();
    assert.deepEqual(lines, ['UNILAG application fee', 'UNILAG hostel semester 1', 'UNILAG hostel semester 2', 'UNILAG semester 1 tuition and levy', 'UNILAG semester 2 tuition and levy']);
    // What the campus pays: at most the best job once a Lagos day while a current student, and one scholarship in a lifetime.
    const pay = row.credits.filter((line) => line.category === 'campusPay');
    const scholarships = pay.filter((line) => line.reason === 'UNILAG scholarship');
    assert.ok(scholarships.length <= 1 && scholarships.every((line) => line.amount === UNILAG_BETA_RULES.scholarshipAward), `${at(row)}: one scholarship at most`);
    const jobs = pay.filter((line) => line.reason !== 'UNILAG scholarship');
    assert.equal(new Set(jobs.map((line) => lagosTime(line.at).day)).size, jobs.length, `${at(row)}: one paid campus job a Lagos day`);
    assert.ok(jobs.length === row.student.jobDays && jobs.every((line) => line.amount === bestJob), `${at(row)}: ${jobs.length} campus jobs at ₦${bestJob}`);
    assert.ok(flow(row, 'campusPay') <= jobs.length * bestJob + UNILAG_BETA_RULES.scholarshipAward);
    // The degree is not a faucet: over the whole of it the campus pays back less than a helper's wages for the same days.
    assert.ok(flow(row, 'campusPay') < flow(row, 'wages'), `${at(row)}: campus pay ${flow(row, 'campusPay')} is below wages ${flow(row, 'wages')}`);
    assert.ok(row.minCash >= 0 && row.conserved && row.unknown.length === 0, at(row));
    assert.equal(row.rentMissedWeeks, 0, `${at(row)}: a student still pays the rent`);
  }
  assert.equal(of('student').length, STARTS.length);
});
