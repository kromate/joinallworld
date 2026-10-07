import { loadCityContent as preloadCityContent } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// OWNER: career — tests for this owner's systems and content.
// Pattern and rules: see "HOW TO TEST" at the top of src/game/registry.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLife, dispatch, advanceLife, viewLife } from '../life.ts';
import { VENUES } from './cities/lagos/venues.ts';

import { systems, registerSystem, emit, actionTypes } from './registry.ts';
import { makeContext, isRecord } from './util.ts';
import { lagosTime } from './clock.ts';
import { credit, xpForLevel } from './api.ts';
import { JOBS, TRACKS, SHIFT_SECONDS, START_PERFORMANCE, HELPER_COOLDOWN_SECONDS } from './content/jobs.ts';
import { scheduleText, daysText, COMMUTE_SECONDS } from './systems/career.ts';
import { RENTS, LOAN, billingWeek, dueAt, DEPOSIT_TOTAL_CAP, MAX_CATCHUP_WEEKS, LOAN_LATE_FEE } from './systems/economy.ts';
import { headsUpLine, missedRentLine } from './conditions/billing-words.ts';
import { fixture } from '../../server/test-fixture.ts';
import type { EngineEvent, EngineEventMap } from '../types/registry.ts';
import type { ActionBody, ActionType } from '../types/actions.ts';
import type { JobId, LifeContext, LifeState, SystemId } from '../types/life.ts';
import type { JobDefinition, TrackJobDefinition } from '../types/content.ts';

const MONDAY_9AM = Date.UTC(2026, 0, 5, 8); // 09:00 in Lagos
const DAY = 86400;
const ctx = makeContext({ now: MONDAY_9AM, cityId: 'lagos', seed: 'career-test' });

// A probe system records the events other owners will listen for, and can scale performance.
const seen: [string, unknown][] = [];
const probe = { performance: 1 };
registerSystem({
  id: 'career-probe' as unknown as SystemId, // a test-only system id outside the shipped SystemId union
  stateKeys: [], sanitize() {}, advance() {},
  on: Object.fromEntries(['job.applied', 'job.quit', 'shift.completed', 'promotion', 'rent.due', 'rent.paid', 'rent.missed', 'loan.paid', 'loan.missed', 'deposit.closed', 'notice.posted']
    .map((name: string) => [name, (_state: LifeState, data: unknown) => seen.push([name, data])])),
  modifiers: { 'career.performance': (value: number) => value * probe.performance },
});
const events = (name: string) => seen.filter(([event]) => event === name).map(([, data]) => { assert.ok(isRecord(data), 'event data is an object'); return data; });

/** What every test sees of a result: dispatch's union, with the optional failure reason readable on both arms. */
type Outcome = { ok: boolean; code: string; state: LifeState; reason?: string };
/** Send one action. The type and payload are loose on purpose: several tests send malformed ones to see them refused. */
const send = (state: LifeState, type: string, payload: Record<string, unknown>, context: LifeContext): Outcome => dispatch(state, { type, payload } as ActionBody, context);
/** The kind of timed action a life is running, read through a function so earlier assertions do not narrow it. */
const activeKind = (state: LifeState) => state.activeAction?.kind;
/** Emit an event with deliberately partial or off-contract data (listeners must tolerate it, and these tests prove they do). */
const emitLoose = <E extends EngineEvent>(state: LifeState, event: E, data: object, context: LifeContext) => emit(state, event, data as unknown as EngineEventMap[E], context);
/** Narrow a value a test has just made sure exists. */
function need<T>(value: T | null | undefined, label = 'value'): T {
  assert.ok(value !== null && value !== undefined, `${label} exists`);
  return value;
}
/** The track behind a job id, narrowed from the JOBS union. */
function trackOf(id: JobId): TrackJobDefinition {
  const job = JOBS[id];
  assert.ok(job.track === true, `${id} is a track`);
  return job;
}
/** The job a life holds. */
function heldJob(state: LifeState): JobDefinition {
  assert.ok(state.job !== null, 'a job is held');
  return JOBS[state.job];
}

const COMMANDS: Record<string, string> = { 'quit-job': 'career.quit', 'set-auto-go': 'career.auto', 'pay-loan': 'economy.pay-loan', 'pay-rent': 'economy.pay-rent', 'open-deposit': 'economy.open-deposit', 'close-deposit': 'economy.close-deposit' };

/** A life with its own clock. `step` settles real seconds; `act` sends one action at the current time. */
function life(saved: Record<string, unknown> = {}, start = MONDAY_9AM) {
  let now = start;
  const at = (seed = 'step') => makeContext({ now, cityId: 'lagos', seed });
  const state = createLife({ t: start, ...saved }, at('create'));
  return {
    state,
    get now() { return now; },
    at,
    step(seconds: number) { now += seconds * 1000; return advanceLife(state, seconds, at()); },
    act(type: string, payload: Record<string, unknown> = {}) { return send(state, type, payload, at('act')); },
    command(name: string, payload: Record<string, unknown> = {}) { return send(state, COMMANDS[name] ?? '', payload, at('act')); },
    view() { return viewLife(state, at('view')); },
    rest() { state.needs.energy = 90; state.needs.hunger = 90; },
    /** Work one complete shift of the current job from wherever the player is standing. */
    shift() {
      const job = heldJob(state);
      state.location = job.workplace.venue; state.spot = job.workplace.spot; state.activeAction = null;
      this.rest();
      const started = this.act('activity', { id: job.shift.id });
      if (started.ok) this.step(job.shift.duration);
      return started;
    },
  };
}
const ledgerSum = (state: LifeState) => state.ledger.reduce((sum, entry) => sum + entry.amount, 0);

test('career systems are registered and survive hostile saves', () => {
  for (const id of ['career', 'economy']) {
    const system = systems().find(item => item.id === id);
    assert.ok(system, id);
    for (const junk of ['text', 7, [], { nested: { deep: true } }]) {
      const state = createLife({ [id]: junk }, ctx);
      for (const key of system.stateKeys) assert.notEqual(Reflect.get(state, key), junk, `${id}.${key} must be rebuilt, not copied`);
    }
  }
  const state = createLife(null, ctx);
  assert.equal(advanceLife(state, 60, { ...ctx, now: ctx.now + 60000 }).ok, true);
  assert.equal(typeof viewLife(state, ctx), 'object');
  assert.equal(typeof dispatch, 'function');
});

test('catalogue: fourteen tracks with the fixed ids, workplaces, entry roles and entry pay', () => {
  const expected: Record<string, [string, string, number]> = {
    tech: ['cchub', 'Intern', 3600], banking: ['office', 'Marketer', 4200], music: ['shrine', 'Backup Singer', 2700],
    trading: ['market', 'Shop Assistant', 3000], nursing: ['hospital', 'Student Nurse', 3300], hair: ['salon', 'Salon Assistant', 2700],
    chef: ['amala-shitta', 'Dishwasher', 2700], dj: ['quilox', 'Hype Man', 3000], fitness: ['i-fitness', 'Gym Assistant', 2700],
    creator: ['rooftop', 'Aspiring Creator', 2400], teaching: ['park', 'Lesson Teacher', 3000], event: ['canopy-walk', 'Canopy Crew', 2700],
    football: ['viewing-centre', 'Viewing Centre Attendant', 2400], retail: ['palms', 'Sales Rep', 2700],
  };
  assert.deepEqual(TRACKS.map((job) => job.id).sort(), Object.keys(expected).sort());
  const skills = Object.keys(createLife(null, ctx).skills);
  for (const job of TRACKS) {
    const [venue, role, pay] = need(expected[job.id], job.id);
    assert.deepEqual(job.workplace, { venue, spot: 'work' }, job.id);
    assert.equal(job.ladder[0]?.role, role); assert.equal(job.ladder[0]?.pay, pay); assert.equal(job.shift.reward, pay);
    assert.equal(job.ladder.length, 6);
    for (let i = 1; i < job.ladder.length; i++) {
      const rung = need(job.ladder[i]), below = need(job.ladder[i - 1]);
      assert.ok(rung.pay > below.pay, `${job.id} pay rises`);
      assert.ok(rung.skillLevel >= below.skillLevel && rung.skillLevel >= 1);
    }
    assert.ok(skills.includes(job.skill), `${job.id} skill`);
    assert.ok(job.days.length >= 4 && job.days.length <= 6 && new Set(job.days).size === job.days.length);
    assert.ok(job.shift.duration >= 30 && job.shift.duration <= 45);
    assert.equal(job.shift.beta, true, 'the shift design is original and marked beta');
  }
  for (const id of ['tech', 'banking', 'music'] as const) assert.equal(trackOf(id).days.length, 5);
  const tech = trackOf('tech');
  assert.deepEqual(tech.days, [1, 2, 3, 4, 5]);
  assert.deepEqual([tech.ladder[1]?.role, tech.ladder[1]?.skillLevel, tech.skill, tech.ladder.at(-1)?.role], ['Junior Dev', 1, 'coding', 'CTO']);
  assert.equal(JOBS['community-helper'].workplace.venue, 'park');
  assert.equal(new Set(Object.values(JOBS).map((job) => job.shift.id)).size, Object.keys(JOBS).length);
});

test('one schedule sentence per job is shown everywhere and never names clock hours', () => {
  assert.equal(daysText([1, 2, 3, 4, 5]), 'Mon–Fri'); assert.equal(daysText([3, 4, 5, 6, 0]), 'Wed–Sun'); assert.equal(daysText([1, 3, 5, 6]), 'Mon, Wed, Fri, Sat');
  const listed = Object.fromEntries(life().view().career.jobs.map((job) => [job.id, job]));
  assert.equal(Object.keys(listed).length, 15);
  for (const job of Object.values(JOBS)) {
    assert.equal(need(listed[job.id]).schedule, scheduleText(job));
    assert.doesNotMatch(need(listed[job.id]).schedule, /\d\s?(AM|PM)|\d:\d\d/, 'no clock hours: shifts are any time');
    if (job.track) assert.match(need(listed[job.id]).schedule, new RegExp(`${job.days.length} days a week`));
    if (!Object.hasOwn(VENUES, job.workplace.venue)) continue;
    const player = life();
    assert.equal(player.act('apply-job', { id: job.id }).ok, true, job.id);
    const view = player.view().career;
    assert.equal(view.schedule, need(listed[job.id]).schedule, `${job.id}: Career tab and Jobs card agree`);
    assert.deepEqual(view.chips.filter((chip) => chip.work).map((chip) => chip.name).length, job.track ? job.days.length : 7);
  }
});

test('a track whose workplace is not in this build is listed but cannot be held', () => {
  const missing = TRACKS.filter((job) => !Object.hasOwn(VENUES, job.workplace.venue));
  const player = life();
  for (const job of missing) {
    const result = player.act('apply-job', { id: job.id });
    assert.equal(result.code, 'workplace_unavailable'); assert.match(result.reason ?? '', new RegExp(job.workplaceName));
    assert.equal(player.state.job, null);
    const row = need(player.view().career.jobs.find((item) => item.id === job.id));
    assert.match(need(row.blocked), /not open in this build/);
    assert.deepEqual([row.venue, row.openNow], [null, false], 'no venue id and never open while the workplace is not built');
    assert.equal(createLife({ job: job.id, career: { level: 6, performance: 100 } }, ctx).job, null, 'a save cannot hold a job with no workplace');
  }
  for (const job of TRACKS.filter((item) => !missing.includes(item))) {
    const row = need(player.view().career.jobs.find((item) => item.id === job.id));
    assert.equal(row.blocked, null);
    // The Jobs card reads the workplace by id and its open state from the career view, the same answer the map gives.
    assert.equal(row.venue, job.workplace.venue);
    assert.equal(row.openNow, need(player.view().travel.destinations.find((place) => place.id === job.workplace.venue)).open, job.id);
    assert.ok(player.view().activities.spots.length >= 0);
  }
  assert.equal(need(player.view().career.jobs.find((item) => item.id === 'teaching')).blocked, null, 'Teaching works at the park on every branch');
});

test('apply hires at once; a shift pays once on completion, costs needs, trains the skill and raises performance', () => {
  const player = life();
  const before = player.view().career;
  assert.equal(before.employed, false); assert.match(before.step.text, /tap Apply/); assert.doesNotMatch(before.step.text, /Phone →/, 'the step is shown inside Jobs too, so it names no route'); assert.equal(before.nextShift, null);
  const applied = player.act('apply-job', { id: 'teaching' });
  assert.equal(applied.code, 'applied'); assert.equal(player.state.job, 'teaching');
  assert.match(player.state.message, /Hired as Lesson Teacher .*₦3,000 per shift.*first shift today/);
  assert.deepEqual(events('job.applied').at(-1), { job: 'teaching', maxLevel: 6 });
  let view = player.view().career;
  assert.deepEqual([view.level, view.role, view.pay, view.performance, view.auto], [1, 'Lesson Teacher', 3000, START_PERFORMANCE, true]);
  assert.equal(view.today.code, 'available'); assert.equal(view.nextShift, 'Next shift: now');
  assert.equal(view.step.kind, 'go'); assert.match(view.step.text, /Open the Community desk spot.*40 seconds.*₦3,000/);
  assert.match(need(view.next).text, /Next: Class Teacher \(₦4,500 per shift\) — reach 100% performance with Charisma level 1/);

  player.act('spot', { id: 'work' });
  const card = need(player.view().activities.cards.find((item) => item.id === 'teaching-shift'));
  assert.equal(card.reward, 3000); assert.equal(card.blocked, null); assert.equal(card.duration, SHIFT_SECONDS);
  player.state.needs.energy = 29;
  const tired = player.act('activity', { id: 'teaching-shift' });
  assert.equal(tired.code, 'needs_required'); assert.match(tired.reason ?? '', /Energy 30\+ \(you have 29\)/);
  assert.equal(player.view().career.step.kind, 'home');
  player.state.needs.energy = 50; player.state.needs.hunger = 50;
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'started');
  assert.equal(player.view().career.today.code, 'working');
  player.step(SHIFT_SECONDS - 1);
  assert.equal(player.state.cash, 5000, 'nothing is paid before completion');
  player.step(1);
  assert.equal(player.state.cash, 8000); assert.equal(player.state.activeAction, null);
  assert.deepEqual([player.state.needs.energy, player.state.needs.hunger], [30, 38]);
  assert.equal(player.state.skills.charisma, 25); assert.equal(player.state.career.performance, 60);
  assert.equal(player.state.completedShifts, 1); assert.equal(player.state.career.shifts, 1);
  assert.deepEqual(need(player.state.ledger.at(-1)).reason, 'Teaching shift'); assert.equal(need(player.state.ledger.at(-1)).amount, 3000);
  assert.deepEqual(events('shift.completed').at(-1), { job: 'teaching', activity: 'teaching-shift', pay: 3000, level: 1, maxLevel: 6 });
  assert.match(player.state.message, /earned ₦3,000\. Performance 60%\. Next shift: tomorrow \(Tuesday\)/);

  // Same Lagos day: no second paid shift, however long we wait or however often we reload.
  player.rest();
  const again = player.act('activity', { id: 'teaching-shift' });
  assert.equal(again.code, 'shift_done'); assert.match(again.reason ?? '', /one per day.*Next shift: tomorrow \(Tuesday\)/);
  const reloaded = createLife(JSON.parse(JSON.stringify(player.state)), player.at());
  assert.equal(dispatch(reloaded, { type: 'activity', payload: { id: 'teaching-shift' } }, player.at()).code, 'shift_done');
  player.step(3600); assert.equal(player.state.cash, 8000);
  view = player.view().career;
  assert.equal(view.today.code, 'shift_done'); assert.equal(view.nextShift, 'Next shift: tomorrow (Tuesday)'); assert.equal(view.step.kind, 'wait');
  assert.match(need(need(player.view().activities.cards.find((item) => item.id === 'teaching-shift')).blocked).reason ?? '', /Next shift: tomorrow/);

  // Tuesday: the next shift is available again.
  player.step(DAY - 3600 - SHIFT_SECONDS); player.rest();
  assert.equal(lagosTime(player.now).weekday, 2);
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'started');
  player.step(SHIFT_SECONDS);
  assert.equal(player.state.cash, 11000); assert.equal(player.state.career.performance, 70);
});

test('cancelling a shift earns nothing, costs nothing and does not use up the day', () => {
  const player = life({ job: 'teaching', spot: 'work', career: { performance: 50 } });
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'started');
  player.step(SHIFT_SECONDS - 1);
  assert.equal(player.act('cancel').code, 'cancelled');
  player.step(120);
  assert.deepEqual([player.state.cash, player.state.completedShifts, player.state.career.performance, player.state.skills.charisma], [5000, 0, 50, 0]);
  assert.equal(player.state.needs.energy, 50); assert.equal(player.state.career.lastShiftDay, null); assert.equal(player.state.career.shiftStartDay, null);
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'started');
  player.step(SHIFT_SECONDS);
  assert.equal(player.state.cash, 8000);
});

test('day off is explained; the first ever shift may be worked on a day off, later ones may not', () => {
  const sunday = MONDAY_9AM - DAY * 1000;
  const fresh = life({}, sunday);
  fresh.act('apply-job', { id: 'teaching' });
  assert.match(fresh.state.message, /first shift today/);
  let view = fresh.view().career;
  assert.equal(view.today.code, 'orientation'); assert.match(view.today.text, /Sunday is normally a day off.*first ever shift/);
  assert.equal(fresh.shift().code, 'started');
  assert.equal(fresh.state.cash, 8000); assert.equal(fresh.state.career.oriented, true);
  // Monday is a normal work day; the following Sunday is a real day off.
  fresh.step(DAY); assert.equal(fresh.shift().code, 'started'); assert.equal(fresh.state.cash, 11000);
  fresh.step(DAY * 6);
  assert.equal(lagosTime(fresh.now).weekday, 0);
  fresh.state.location = 'park'; fresh.state.spot = 'work'; fresh.rest();
  const off = fresh.act('activity', { id: 'teaching-shift' });
  assert.equal(off.code, 'day_off'); assert.equal(off.reason, 'Day off today (Sunday). Next shift: tomorrow (Monday).');
  view = fresh.view().career;
  assert.equal(view.today.text, off.reason); assert.equal(view.nextShift, 'Next shift: tomorrow (Monday)');
  assert.deepEqual(view.chips.map((chip) => chip.letter).join(''), 'SMTWTFS');
  assert.deepEqual(view.chips.filter((chip) => chip.work).map((chip) => chip.name), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  assert.equal(need(view.chips.find((chip) => chip.today)).name, 'Sunday');
  assert.equal(fresh.state.cash, 11000);
});

test('a shift counts for the day it started, so running past midnight keeps the next day', () => {
  const lateMonday = Date.UTC(2026, 0, 5, 22, 59, 45); // 23:59:45 Lagos
  const player = life({ job: 'teaching', spot: 'work', career: { performance: 50, oriented: true } }, lateMonday);
  const monday = lagosTime(lateMonday).day;
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'started');
  player.step(SHIFT_SECONDS);
  assert.equal(lagosTime(player.now).day, monday + 1);
  assert.equal(player.state.career.lastShiftDay, monday);
  player.rest();
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'started', 'Tuesday still has its shift');
  player.step(SHIFT_SECONDS);
  assert.equal(player.state.cash, 11000);
  player.rest();
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'shift_done');
});

test('promotion needs 100% performance and the track skill; pay follows the level worked', () => {
  const player = life({ job: 'teaching', career: { performance: 50, oriented: true } });
  seen.length = 0;
  for (let day = 0; day < 4; day++) { assert.equal(player.shift().code, 'started'); player.step(DAY - SHIFT_SECONDS); }
  assert.deepEqual([player.state.career.level, player.state.career.performance, player.state.skills.charisma], [1, 90, 100]);
  assert.equal(player.shift().code, 'started'); // fifth shift: 100% and Charisma 1
  assert.deepEqual([player.state.career.level, player.state.career.performance], [2, START_PERFORMANCE]);
  assert.deepEqual(events('promotion'), [{ job: 'teaching', level: 2, role: 'Class Teacher', maxLevel: 6, top: false }]);
  assert.equal(need(events('shift.completed').at(-1)).pay, 3000, 'the promoting shift was worked and paid at level 1');
  assert.match(player.state.message, /Promoted to Class Teacher! Teaching shifts now pay ₦4,500/);
  assert.ok(player.state.moodlets.some((moodlet) => moodlet.id === 'promoted'));
  assert.equal(player.view().career.pay, 4500); assert.equal(player.view().career.weeklyPay, 22500);

  // Level 3 needs Charisma 2 (300 XP). Performance fills first, so the promotion waits for the skill.
  player.step(DAY * 3); // skip the weekend
  const cashBefore = player.state.cash;
  probe.performance = 5;
  assert.equal(player.shift().code, 'started');
  probe.performance = 1;
  assert.equal(player.state.cash, cashBefore + 4500);
  assert.deepEqual([player.state.career.level, player.state.career.performance, player.state.skills.charisma], [2, 100, 150]);
  assert.match(player.state.message, /Promotion to Subject Lead is waiting on Charisma level 2/);
  const waiting = need(player.view().career.next);
  assert.deepEqual([waiting.performanceMet, waiting.skillMet, waiting.have, waiting.skillLevel], [true, false, 1, 2]);
  // Reaching the skill some other way promotes immediately, without another shift.
  player.state.skills.charisma = xpForLevel(2) - 25;
  player.step(DAY); assert.equal(player.shift().code, 'started');
  assert.equal(player.state.career.level, 3);
  assert.deepEqual(events('promotion').at(-1), { job: 'teaching', level: 3, role: 'Subject Lead', maxLevel: 6, top: false });

  // The top of the ladder has no next promotion and performance stays capped.
  const top = life({ job: 'teaching', career: { level: 6, performance: 100, oriented: true }, skills: { charisma: xpForLevel(10) } });
  assert.equal(top.shift().code, 'started');
  assert.deepEqual([top.state.career.level, top.state.career.performance, top.state.cash], [6, 100, 5000 + need(trackOf('teaching').ladder[5]).pay]);
  assert.equal(top.view().career.next, null); assert.equal(top.view().career.topOfLadder, true);
});

test('switching needs confirmation and restarts the ladder; quitting clears it; neither unlocks a second shift', () => {
  const player = life({ job: 'teaching', career: { level: 3, performance: 80, oriented: true } });
  assert.equal(player.shift().code, 'started');
  const cash = player.state.cash;
  const refused = player.act('apply-job', { id: 'community-helper' });
  assert.equal(refused.code, 'confirm_switch'); assert.match(refused.reason ?? '', /starter job, which has no ladder, and lose your Teaching level and performance/);
  assert.equal(player.state.job, 'teaching'); assert.equal(player.state.career.level, 3);
  assert.match(need(need(player.view().career.jobs.find((job) => job.id === 'community-helper')).switchWarning), /leave Teaching \(level 3, 90% performance\)/);
  assert.equal(player.act('apply-job', { id: 'community-helper', confirm: true }).code, 'confirm_switch', 'apply-job never switches, whatever its payload says');
  assert.equal(player.act('career.switch', { id: 'community-helper' }).code, 'switched');
  assert.deepEqual([player.state.job, player.state.career.level, player.state.career.performance], ['community-helper', 1, 0]);
  assert.equal(player.act('career.switch', { id: 'teaching' }).code, 'switched');
  assert.deepEqual([player.state.career.level, player.state.career.performance], [1, START_PERFORMANCE], 'coming back starts over');
  player.state.activeAction = null; player.state.location = 'park'; player.state.spot = 'work'; player.rest();
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'shift_done', 'still one paid career shift per day');
  assert.equal(player.state.cash, cash);

  assert.equal(player.command('quit-job').code, 'quit');
  assert.deepEqual([player.state.job, player.state.career.level, player.state.career.performance], [null, 1, 0]);
  assert.equal(need(events('job.quit').at(-1)).job, 'teaching');
  assert.equal(player.command('quit-job').code, 'no_job');
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'job_required');
  const working = life({ job: 'teaching', spot: 'work', career: { performance: 50 } });
  working.act('activity', { id: 'teaching-shift' });
  assert.equal(working.command('quit-job').code, 'busy');
  // apply-job accepts nothing but an application: the old tunnelled commands are plain invalid applications.
  for (const payload of [{ do: 'quit-job' }, { do: 'pay-loan', mode: 'all' }, { do: 7 }, { do: '__proto__' }, {}]) {
    const result = send(player.state, 'apply-job', payload, player.at());
    assert.equal(result.code, 'invalid_job'); assert.ok(result.reason); assert.equal(player.state.job, null);
  }
  assert.equal(player.act('career.switch', { id: 'teaching' }).code, 'no_job');
  assert.equal(player.act('career.switch', { id: 'nope' }).code, 'invalid_job');
  assert.equal(player.command('set-auto-go', { on: 'yes' }).code, 'invalid_setting');
});

test('Go automatically starts one free, cancellable commute per day and only when a shift is workable', () => {
  const player = life({ location: 'home' });
  player.rest();
  assert.equal(player.act('apply-job', { id: 'teaching' }).code, 'applied');
  assert.deepEqual(player.state.activeAction, { kind: 'commute', id: 'park', duration: COMMUTE_SECONDS, remaining: COMMUTE_SECONDS });
  assert.match(player.state.message, /Go automatically: heading to Freedom Park/);
  const resumed = createLife(JSON.parse(JSON.stringify(player.state)), player.at());
  assert.deepEqual(resumed.activeAction, player.state.activeAction, 'a commute survives a reload');
  player.step(COMMUTE_SECONDS);
  assert.equal(player.state.location, 'park'); assert.equal(player.state.activeAction, null); assert.equal(player.state.cash, 5000);
  assert.equal(player.state.spot, 'work', 'the commute arrives at the work spot');
  assert.match(player.state.message, /at the Community desk spot\. Start your Teaching shift/);
  // Leaving again the same day does not drag the player back.
  player.state.location = 'home'; player.state.spot = 'kitchen';
  player.step(600);
  assert.equal(player.state.activeAction, null); assert.equal(player.state.location, 'home');
  // Next work day: commute again, and cancelling it sticks for the day.
  player.step(DAY); player.rest(); player.step(1);
  assert.equal(activeKind(player.state), 'commute');
  assert.equal(player.act('cancel').code, 'cancelled');
  player.step(600);
  assert.equal(player.state.activeAction, null); assert.equal(player.state.location, 'home');

  const off = life({ location: 'home', job: 'teaching', career: { performance: 50, auto: false } });
  off.rest(); off.step(60);
  assert.equal(off.state.activeAction, null, 'off means off');
  assert.equal(off.command('set-auto-go', { on: true }).code, 'auto_set');
  off.state.needs.energy = 12; off.step(60);
  assert.equal(off.state.activeAction, null, 'never sent to work without the needs to work');
  off.rest(); off.act('spot', { id: 'bedroom' }); off.act('activity', { id: 'nap' }); off.step(1);
  assert.equal(activeKind(off.state), 'activity', 'never interrupts another action');
  const hostile = createLife({ location: 'home', activeAction: { kind: 'commute', id: 'park', duration: COMMUTE_SECONDS, remaining: 1 } }, ctx);
  assert.equal(hostile.activeAction, null, 'no commute without a job');
  const helper = life({ location: 'home', job: 'community-helper' });
  helper.rest(); helper.step(60);
  assert.equal(helper.state.activeAction, null, 'the starter job never commutes on its own');
});

test('the starter Community helper job still works for old saves, one shift per four hours', () => {
  const player = life({ job: 'community-helper', completedShifts: 7, spot: 'work' });
  assert.equal(player.state.job, 'community-helper');
  assert.equal(player.act('activity', { id: 'helper-shift' }).code, 'started'); player.step(20); player.rest();
  const soon = player.act('activity', { id: 'helper-shift' });
  assert.equal(soon.code, 'cooldown'); assert.match(soon.reason ?? '', /Again in \d h/); assert.equal(player.state.cash, 5300);
  player.step(HELPER_COOLDOWN_SECONDS); player.rest();
  assert.equal(player.act('activity', { id: 'helper-shift' }).code, 'started'); player.step(20); player.rest();
  // Played round the clock the starter job still earns less in a day than one shift of the lowest-paid track.
  assert.ok(Math.floor(DAY / HELPER_COOLDOWN_SECONDS) * need(need(JOBS['community-helper']).shift.reward) < Math.min(...TRACKS.map((job) => need(job.ladder[0]).pay)));
  assert.deepEqual([player.state.cash, player.state.completedShifts], [5600, 9]);
  assert.deepEqual(events('shift.completed').at(-1), { job: 'community-helper', activity: 'helper-shift', pay: 300, level: 1 });
  const view = player.view().career;
  assert.deepEqual([view.isTrack, view.level, view.next, view.schedule, need(view.job).id], [false, null, null, 'One shift every 4 hours, any day', 'community-helper']);
});

test('career sanitize rebuilds every field from hostile input', () => {
  const state = createLife({ job: 'teaching', completedShifts: -4, career: { level: 99, performance: 1e9, shifts: -1, auto: 'no', lastShiftDay: 1.5, shiftStartDay: 'x', autoDay: {}, oriented: 'yes', extra: 1 } }, ctx);
  assert.deepEqual(state.career, { city: 'lagos', level: 1, performance: 100, shifts: 0, auto: true, lastShiftDay: null, shiftStartDay: null, autoDay: null, transferDay: null, oriented: false });
  assert.equal(state.completedShifts, 0);
  assert.deepEqual(createLife({ job: 'president', career: { level: 4, performance: 70 } }, ctx).career.level, 1);
  const valid = createLife({ job: 'teaching', career: { level: 4, performance: 70.5, shifts: 12, auto: false, lastShiftDay: 20458, shiftStartDay: null, autoDay: 20458, oriented: true } }, ctx);
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(valid)), ctx), valid, 'a valid save round-trips unchanged');
});

test('career and money commands are registered action types with an area prefix', () => {
  for (const type of ['apply-job', 'career.switch', 'career.quit', 'career.auto', 'career.dilemma', 'economy.pay-loan', 'economy.pay-rent', 'economy.open-deposit', 'economy.close-deposit']) assert.ok(actionTypes().includes(type), type);
  assert.equal(actionTypes().filter((type) => type.startsWith('career.') || type.startsWith('economy.')).length, 8);
});

test('the starter job cannot be stacked on a career job to beat the one-shift-a-day rule', () => {
  const player = life({ job: 'community-helper', spot: 'work' });
  assert.equal(player.shift().code, 'started'); assert.equal(player.state.cash, 5300);
  // Taking a career job replaces the starter job: its unlimited shift is no longer available.
  assert.equal(player.act('apply-job', { id: 'teaching' }).code, 'confirm_switch');
  assert.equal(player.act('career.switch', { id: 'teaching' }).code, 'switched');
  assert.equal(player.state.job, 'teaching');
  player.state.activeAction = null; player.state.location = 'park'; player.state.spot = 'work'; player.rest();
  const helper = player.act('activity', { id: 'helper-shift' });
  assert.equal(helper.code, 'job_required'); assert.match(helper.reason ?? '', /Community helper job/);
  assert.match(need(need(player.view().activities.cards.find((card) => card.id === 'helper-shift')).blocked).reason ?? '', /Community helper job/);
  assert.equal(player.shift().code, 'started'); assert.equal(player.state.cash, 8300);
  player.rest();
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'shift_done');
  assert.equal(player.act('activity', { id: 'helper-shift' }).code, 'job_required');
  // Going back to the starter job costs the whole career (level and performance), and returning
  // to the career the same day still finds today's paid shift used.
  player.state.career.level = 3;
  assert.equal(player.act('career.switch', { id: 'community-helper' }).code, 'switched');
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'job_required');
  assert.equal(player.act('career.switch', { id: 'teaching' }).code, 'switched');
  assert.deepEqual([player.state.career.level, player.state.career.performance], [1, START_PERFORMANCE]);
  player.state.activeAction = null; player.state.location = 'park'; player.state.spot = 'work'; player.rest();
  assert.equal(player.act('activity', { id: 'teaching-shift' }).code, 'shift_done');
  assert.equal(player.state.cash, 8300);
  // A save cannot hold both: there is a single job slot, and a career shift in progress needs that job.
  const forged = createLife({ job: 'community-helper', location: 'park', spot: 'work', activeAction: { kind: 'activity', id: 'teaching-shift', duration: SHIFT_SECONDS, remaining: 1 } }, ctx);
  assert.equal(forged.activeAction, null);
});

test('the exact onboarding payload — lottery "lapo-baby", house id string — creates the loan and the rent schedule', () => {
  const player = life({ cash: 96000 });
  assert.deepEqual([player.state.economy.loan, need(player.state.economy.rent).house, player.state.economy.billedWeek], [null, null, null]);
  emitLoose(player.state, 'life.started', { body: { skin: 2 }, traits: ['neat', 'funny'], dream: 'mogul', lottery: 'lapo-baby', house: 'yaba' }, player.at('start'));
  assert.deepEqual(player.state.economy, { billedWeek: billingWeek(MONDAY_9AM), started: true, rent: { house: 'yaba', arrears: 0, missed: 0 }, loan: { left: 72000, prepaid: 0, fees: 0 }, deposits: [], seq: 0, reminded: null, headsUp: null });
  assert.equal(player.state.cash, 96000); assert.equal(player.state.ledger.length, 0);
  const view = player.view().economy;
  assert.deepEqual([need(view.rent).amount, need(view.rent).nextDueLabel, need(view.loan).left, need(view.loan).weekly, view.weeklyBills], [6000, 'Sat 10 Jan', 72000, 12000, 18000]);
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(player.state)), player.at()).economy, player.state.economy, 'the schedule survives a reload');
  player.step(DAY * 7);
  assert.deepEqual(player.state.ledger.map((entry) => entry.amount), [-6000, -12000]);
  for (const house of ['mushin', 'lekki'] as const) {
    const other = life({ cash: 96000 });
    emitLoose(other.state, 'life.started', { body: {}, traits: [], dream: 'x', lottery: 'lapo-baby', house }, other.at('start'));
    assert.equal(need(other.view().economy.rent).amount, RENTS[house].rent); assert.equal(need(other.state.economy.loan).left, 72000);
  }
});

// ---- economy ----------------------------------------------------------------------------

/** A life that has finished onboarding in `house` with the loan outcome, as the character owner will emit it. */
function onboarded(house = 'yaba', lottery: string | { id: string; loan: boolean } = 'lapo-baby', saved = { cash: 96000 }, start = MONDAY_9AM) {
  const player = life(saved, start);
  emitLoose(player.state, 'life.started', { body: {}, traits: [], dream: 'x', lottery, house }, player.at('start'));
  return player;
}
const secondsUntil = (player: { now: number }, ms: number) => Math.ceil((ms - player.now) / 1000);

test('billing weeks start on Saturday 00:00 Nigerian time and rents follow the rent table', () => {
  assert.deepEqual(Object.fromEntries(Object.values(RENTS).map((house) => [house.id, house.rent])), { mushin: 2400, yaba: 6000, lekki: 17000, ikoyi: 250000, banana: 1500000 });
  assert.deepEqual(LOAN, { principal: 60000, total: 72000, weekly: 12000 });
  const saturday = Date.UTC(2026, 0, 9, 23); // Sat 10 Jan 00:00 Lagos
  assert.equal(lagosTime(saturday).weekday, 6);
  assert.equal(billingWeek(saturday), billingWeek(saturday - 1) + 1);
  assert.equal(billingWeek(saturday + 7 * DAY * 1000 - 1), billingWeek(saturday));
  assert.equal(dueAt(billingWeek(saturday)), saturday);
});

test('a life with no house and no loan is never billed', () => {
  const player = life();
  player.step(DAY * 30);
  assert.equal(player.state.cash, 5000); assert.equal(player.state.ledger.length, 0);
  const view = player.view().economy;
  assert.deepEqual([view.rent, view.loan, view.weeklyBills], [null, null, 0]);
  assert.equal(player.command('pay-loan', { mode: 'week' }).code, 'no_loan');
  assert.equal(player.command('pay-rent').code, 'nothing_due');
});

test('onboarding sets up rent and the loan once; Saturday collects both through the ledger exactly once', () => {
  seen.length = 0;
  const player = onboarded();
  assert.equal(player.state.cash, 96000, 'the loan principal is part of the starting cash; nothing is credited here');
  let view = player.view().economy;
  assert.deepEqual([need(view.rent).house, need(view.rent).amount, need(view.rent).arrears, need(view.rent).nextDueLabel], ['yaba', 6000, 0, 'Sat 10 Jan']);
  assert.deepEqual([need(view.loan).left, need(view.loan).total, need(view.loan).weekly, need(view.loan).principal, need(view.loan).weeksLeft, need(view.loan).progress], [72000, 72000, 12000, 60000, 6, 0]);
  assert.equal(view.weeklyBills, 18000); assert.match(need(view.loan).nextCollection, /₦12,000 is collected automatically on Sat 10 Jan/);
  // A second 'life.started' must not hand out or reset anything.
  need(player.state.economy.loan).left = 1000;
  emitLoose(player.state, 'life.started', { lottery: 'lapo-baby', house: 'yaba' }, player.at());
  assert.equal(need(player.state.economy.loan).left, 1000);
  need(player.state.economy.loan).left = 72000;

  player.step(secondsUntil(player, view.nextDue) - 1);
  assert.equal(player.state.cash, 96000, 'nothing is taken before Saturday');
  player.step(1);
  assert.equal(player.state.cash, 78000);
  assert.deepEqual(player.state.ledger.map((entry) => [entry.amount, entry.reason]), [[-6000, 'Rent: Yaba self-contain (due Sat 10 Jan)'], [-12000, 'Loan repayment (due Sat 10 Jan)']]);
  assert.deepEqual(events('rent.due'), [{ amount: 6000, house: 'yaba' }]);
  assert.deepEqual(events('rent.paid'), [{ amount: 6000, house: 'yaba', arrears: 0 }]);
  assert.deepEqual(events('loan.paid'), [{ amount: 12000, left: 60000 }]);
  // Settling again, reloading, or settling in tiny steps never bills the same Saturday twice.
  for (let i = 0; i < 50; i++) player.step(60);
  const reloaded = createLife(JSON.parse(JSON.stringify(player.state)), player.at());
  advanceLife(reloaded, 3600, makeContext({ now: player.now + 3600000, cityId: 'lagos', seed: 'r' }));
  assert.equal(player.state.cash, 78000); assert.equal(reloaded.cash, 78000);
  view = player.view().economy;
  assert.equal(need(view.rent).nextDueLabel, 'Sat 17 Jan'); assert.equal(need(view.loan).left, 60000);
  assert.equal(player.state.cash - 96000, ledgerSum(player.state), 'every naira is in the ledger');
});

test('offline catch-up is bounded, and a house move changes the rent from the next Saturday', () => {
  const player = onboarded('mushin', 'lapo-baby', { cash: 500000 });
  player.step(DAY * 7 * 30); // thirty weeks away
  const rentLines = player.state.ledger.filter((entry) => entry.reason.startsWith('Rent:'));
  const loanLines = player.state.ledger.filter((entry) => entry.reason.startsWith('Loan repayment'));
  assert.equal(rentLines.length, MAX_CATCHUP_WEEKS); assert.equal(loanLines.length, MAX_CATCHUP_WEEKS);
  assert.equal(player.state.cash, 500000 - MAX_CATCHUP_WEEKS * (2400 + 12000));
  assert.equal(need(player.state.economy.loan).left, 72000 - MAX_CATCHUP_WEEKS * 12000);
  assert.equal(player.state.economy.billedWeek, billingWeek(player.now));
  emitLoose(player.state, 'house.moved', { id: 'lekki' }, player.at());
  assert.equal(need(player.view().economy.rent).amount, 17000);
  const cash = player.state.cash;
  player.step(DAY * 7);
  assert.equal(player.state.cash, cash - 17000 - 12000);
  emitLoose(player.state, 'house.moved', { id: 'castle' }, player.at());
  assert.equal(need(player.state.economy.rent).house, 'lekki', 'an unknown house is ignored');
  // The loan finishes: the last collection takes only what is left, then nothing more.
  player.step(DAY * 7 * 4);
  assert.equal(need(player.state.economy.loan).left, 0);
  assert.equal(need(player.view().economy.loan).cleared, true);
  assert.equal(player.state.ledger.filter((entry) => entry.reason.startsWith('Loan')).length <= 60, true);
  assert.equal(player.view().economy.weeklyBills, 17000);
});

const notices = (kind: string) => events('notice.posted').filter((data) => data.kind === kind).map((data) => String(data.text));

test('bills are announced on Thursday and again on Friday, each once however the time is stepped', () => {
  seen.length = 0;
  const player = onboarded('yaba', 'lapo-baby', { cash: 4000 });
  player.step(DAY * 3 + 3600); // Thursday 10:00 Lagos, in small steps
  for (let i = 0; i < 6; i++) player.step(600);
  const thursday = notices('rent-due');
  assert.equal(thursday.length, 1);
  assert.match(need(thursday[0]), /^Heads up: rent ₦6,000 and loan ₦12,000 due Saturday, in two days\. You have ₦4,000, ₦14,000 short\. Work a shift or two before then\.$/);
  assert.equal(need(player.state.economy.headsUp), billingWeek(player.now) + 1);
  assert.equal(player.state.economy.reminded, null, 'the Friday reminder has not been used up');
  player.step(DAY);
  player.step(600);
  const both = notices('rent-due');
  assert.equal(both.length, 2);
  assert.match(need(both[1]), /^Due tomorrow \(Saturday\): rent ₦6,000 and loan ₦12,000\./);
  assert.equal(player.state.economy.reminded, billingWeek(player.now) + 1);
  const covered = onboarded('yaba', 'none', { cash: 96000 });
  seen.length = 0;
  covered.step(DAY * 3 + 3600);
  assert.match(need(notices('rent-due')[0]), /^Heads up: rent ₦6,000 due Saturday, in two days\. You have ₦96,000\.$/);
});

test('a missed Saturday gets louder each time in a row, nobody is evicted, and the arrears warning follows', () => {
  seen.length = 0;
  const debtor = onboarded('yaba', 'none', { cash: 0 });
  const weeks: string[] = [];
  for (let week = 0; week < 3; week++) {
    debtor.step(secondsUntil(debtor, week === 0 ? debtor.view().economy.nextDue : debtor.view().economy.nextDue));
    weeks.push(need(notices('rent-missed')[week]));
  }
  assert.match(need(weeks[0]), /^Rent missed: ₦6,000 was due Sat 10 Jan\. You owe ₦6,000; pay it in Phone → Bank before next Saturday to avoid a late fee\.$/);
  assert.match(need(weeks[1]), /^Rent missed again: .* second week running\. You owe ₦12,600 with a ₦600 late fee\. Your landlord is asking after you/);
  assert.match(need(weeks[2]), /^Rent missed, third week running: .* but you keep your room in this beta/);
  const rent = need(debtor.view().economy.rent);
  assert.match(need(rent.warning), /^3 Saturdays missed in a row\. You owe ₦/);
  assert.match(need(rent.warning), /You keep your home in this beta\./);
  assert.equal(rent.house, 'yaba', 'no eviction: the house is still the rent house');
  assert.equal(debtor.state.economy.rent.house, 'yaba');
});

test('every bill notice fits the Updates feed, even for the dearest house and the longest run of missed Saturdays', () => {
  for (let missed = 1; missed <= 12; missed++) assert.ok(missedRentLine(missed, 1500000, 'Sat 14 Feb', 4725000, 150000).length <= 160, `missed ${missed}`);
  assert.ok(headsUpLine(['rent ₦1,500,000', 'loan ₦12,000'], 1512000, 1234567).length <= 160);
});

test('the week is summed up on the Saturday bill, from the money that moved, and nothing about pay changes', () => {
  seen.length = 0;
  const player = onboarded('yaba', 'none', { cash: 20000 });
  player.step(DAY * 2); // Wednesday
  assert.ok(credit(player.state, 5000, 'Tech shift', player.at('pay')));
  assert.equal(player.state.cash, 25000, 'money is in the balance at once; there is no wage day to wait for');
  player.step(secondsUntil(player, player.view().economy.nextDue) + 60);
  const sums = notices('rent').filter((text) => text.startsWith('Week ending'));
  assert.equal(sums.length, 1);
  assert.match(need(sums[0]), /^Week ending Fri 9 Jan: ₦5,000 came in and ₦0 went out\.$/);
  assert.equal(player.state.cash, 25000 - 6000, 'only the rent left the balance');
  assert.equal(createLife({ economy: { billedWeek: 1, rent: { house: 'yaba' } } }, ctx).economy.headsUp, null, 'an older save has no heads-up yet');
});

test('rent the player cannot afford is missed in full, shown as arrears, and never taken silently or in part', () => {
  seen.length = 0;
  const player = onboarded('yaba', 'none', { cash: 5999 });
  assert.equal(player.state.economy.loan, null, 'no loan for other lottery outcomes');
  assert.match(need(need(player.view().economy.rent).warning), /does not cover the ₦6,000 rent due Sat 10 Jan/);
  player.step(secondsUntil(player, player.view().economy.nextDue));
  assert.equal(player.state.cash, 5999); assert.equal(player.state.ledger.length, 0);
  assert.deepEqual(player.state.economy.rent, { house: 'yaba', arrears: 6000, missed: 1 });
  assert.deepEqual(events('rent.missed'), [{ amount: 6000, house: 'yaba', arrears: 6000, missed: 1 }]);
  assert.match(player.state.message, /Rent missed: ₦6,000 .* You now owe ₦6,000/);
  assert.ok(player.state.moodlets.some((moodlet) => moodlet.id === 'rent-arrears' && moodlet.value < 0));
  let rent = need(player.view().economy.rent);
  assert.match(need(rent.warning), /You owe ₦6,000 in missed rent\. Pay it before Sat 17 Jan or a ₦600 late fee is added/);
  assert.equal(rent.canPayArrears, false); assert.match(need(rent.payBlocked), /You have ₦5,999; this needs ₦6,000/);
  const broke = player.command('pay-rent');
  assert.equal(broke.code, 'insufficient_funds'); assert.match(broke.reason ?? '', /Earn ₦1 more/);
  assert.equal(player.command('open-deposit', { amount: 1000, term: 'd1' }).code, 'rent_arrears');

  // Still unpaid next Saturday: one late fee, the new week's rent is missed too.
  player.step(DAY * 7);
  assert.deepEqual(player.state.economy.rent, { house: 'yaba', arrears: 12600, missed: 2 });
  assert.equal(player.state.cash, 5999);
  // Paying now clears it and removes the feeling.
  player.state.cash = 20000;
  assert.equal(player.command('pay-rent').code, 'rent_paid');
  assert.equal(player.state.cash, 7400);
  assert.deepEqual(need(player.state.ledger.at(-1)).reason, 'Rent arrears: Yaba self-contain');
  assert.deepEqual(player.state.economy.rent, { house: 'yaba', arrears: 0, missed: 0 });
  assert.equal(player.state.moodlets.some((moodlet) => moodlet.id === 'rent-arrears'), false);
  assert.equal(player.command('pay-rent').code, 'nothing_due', 'arrears cannot be paid twice');
  assert.equal(need(player.view().economy.rent).warning, null);

  // Arrears are collected automatically on a Saturday once the balance covers them, and are capped.
  const debtor = onboarded('yaba', 'none', { cash: 0 });
  debtor.step(DAY * 7 * 3);
  assert.equal(need(debtor.state.economy.rent).arrears, 6000 * 3 + 600 * 2);
  debtor.state.cash = 100000;
  debtor.step(DAY * 7);
  assert.equal(debtor.state.cash, 100000 - 19200 - 6000);
  assert.equal(need(debtor.state.economy.rent).arrears, 0);
  const longGone = onboarded('yaba', 'none', { cash: 0 });
  longGone.step(DAY * 7 * 40); longGone.step(DAY * 7 * 40);
  assert.equal(need(longGone.state.economy.rent).arrears, 26400, 'capped at four weeks of rent plus fees');
  assert.equal(longGone.state.cash, 0);
});

test('loan: pay one instalment early or pay it all off; nothing can be paid or skipped twice', () => {
  seen.length = 0;
  const player = onboarded('yaba', { id: 'lapo-baby', loan: true }, { cash: 96000 });
  let loan = need(player.view().economy.loan);
  assert.deepEqual([loan.weekBlocked, loan.allBlocked], [null, null]);
  assert.equal(player.command('pay-loan', { mode: 'half' }).code, 'invalid_payment');
  assert.equal(player.command('pay-loan', { mode: 'week' }).code, 'loan_paid');
  assert.equal(player.state.cash, 84000); assert.equal(need(player.state.economy.loan).left, 60000);
  assert.equal(need(player.state.ledger.at(-1)).reason, 'Loan repayment (paid early)');
  assert.deepEqual(events('loan.paid').at(-1), { amount: 12000, left: 60000 });
  assert.match(need(player.view().economy.loan).nextCollection, /already covered by your early payment/);
  // The early payment covers exactly one Saturday; the one after is collected as normal.
  player.step(DAY * 7);
  assert.equal(player.state.cash, 78000); assert.equal(need(player.state.economy.loan).left, 60000);
  player.step(DAY * 7);
  assert.equal(player.state.cash, 60000); assert.equal(need(player.state.economy.loan).left, 48000);

  player.state.cash = 47999;
  loan = need(player.view().economy.loan);
  assert.match(need(loan.allBlocked), /You have ₦47,999; this needs ₦48,000/); assert.equal(loan.weekBlocked, null);
  const short = player.command('pay-loan', { mode: 'all' });
  assert.equal(short.code, 'insufficient_funds'); assert.match(short.reason ?? '', /Earn ₦1 more/);
  assert.equal(player.state.cash, 47999);
  player.state.cash = 50000;
  assert.equal(player.command('pay-loan', { mode: 'all' }).code, 'loan_cleared');
  assert.equal(player.state.cash, 2000); assert.equal(need(player.state.ledger.at(-1)).reason, 'Loan paid off in full');
  assert.equal(player.command('pay-loan', { mode: 'all' }).code, 'no_loan');
  assert.equal(player.command('pay-loan', { mode: 'week' }).code, 'no_loan');
  loan = need(player.view().economy.loan);
  assert.deepEqual([loan.cleared, loan.left, loan.progress, loan.weekBlocked], [true, 0, 1, 'The loan is paid off.']);
  player.state.cash = 50000; player.step(DAY * 7);
  assert.equal(player.state.cash, 44000, 'only rent is collected after the loan is cleared');

  // A missed instalment stays owed and adds a small capped fee; rent is still paid first.
  const late = onboarded('mushin', 'lapo', { cash: 3000 });
  late.step(DAY * 7);
  assert.equal(late.state.cash, 600); assert.equal(need(late.state.economy.loan).left, 72000 + LOAN_LATE_FEE);
  assert.deepEqual(events('loan.missed').at(-1), { amount: 12000, left: 72500 });
  late.step(DAY * 7 * 20);
  assert.equal(need(late.state.economy.loan).left, 72000 + LOAN_LATE_FEE * 4, 'fees are capped');
});

test('fixed deposits: bounded, paid out once on server time, principal only when closed early', () => {
  seen.length = 0;
  const player = life({ cash: 200000 });
  const savings = player.view().economy.savings;
  assert.equal(savings.beta, true); assert.deepEqual(savings.terms.map((term) => [term.id, term.days, term.percent]), [['d1', 1, 0.5], ['d3', 3, 2], ['d7', 7, 5]]);
  const badDeposits: [Record<string, unknown>, string][] = [[{ amount: 999, term: 'd1' }, 'invalid_amount'], [{ amount: 50001, term: 'd1' }, 'invalid_amount'], [{ amount: 1000.5, term: 'd1' }, 'invalid_amount'],
    [{ amount: '5000', term: 'd1' }, 'invalid_amount'], [{ amount: -5000, term: 'd1' }, 'invalid_amount'], [{ amount: 5000, term: 'd9' }, 'invalid_term'], [{ amount: 5000, term: '__proto__' }, 'invalid_term']];
  for (const [payload, code] of badDeposits) {
    const result = player.command('open-deposit', payload);
    assert.equal(result.code, code); assert.ok(result.reason); assert.equal(player.state.cash, 200000);
  }
  assert.equal(player.command('open-deposit', { amount: 50000, term: 'd7' }).code, 'deposit_opened');
  assert.equal(player.state.cash, 150000); assert.equal(need(player.state.ledger.at(-1)).reason, 'Fixed deposit opened (7 days)');
  assert.equal(player.command('open-deposit', { amount: 50000, term: 'd1' }).code, 'deposit_opened');
  const over = player.command('open-deposit', { amount: 1000, term: 'd1' });
  assert.equal(over.code, 'deposit_cap'); assert.match(over.reason ?? '', /₦100,000/);
  assert.equal(player.view().economy.savings.locked, DEPOSIT_TOTAL_CAP); assert.ok(player.view().economy.savings.blocked);
  assert.equal(player.state.cash, 100000);

  // One day later the 1-day deposit pays out by itself, once.
  player.step(DAY - 1); assert.equal(player.state.cash, 100000);
  player.step(1); assert.equal(player.state.cash, 150250);
  assert.equal(need(player.state.ledger.at(-1)).reason, 'Fixed deposit matured: ₦50,000 + ₦250 interest');
  player.step(DAY); assert.equal(player.state.cash, 150250);
  assert.deepEqual(events('deposit.closed'), [{ id: 'fd-2', amount: 50000, interest: 250 }]);
  assert.equal(player.command('close-deposit', { id: 'fd-2' }).code, 'no_deposit', 'a paid deposit cannot be claimed again');
  // Closing the 7-day deposit early returns the principal only, once.
  assert.equal(player.command('close-deposit', { id: 'fd-1' }).code, 'deposit_closed');
  assert.equal(player.state.cash, 200250); assert.equal(need(player.state.ledger.at(-1)).reason, 'Fixed deposit closed early (no interest)');
  assert.equal(player.command('close-deposit', { id: 'fd-1' }).code, 'no_deposit');
  assert.equal(player.state.cash, 200250);
  // Three open deposits at most; a full term pays the stated interest even after a long absence.
  for (let i = 0; i < 3; i++) assert.equal(player.command('open-deposit', { amount: 10000, term: 'd7' }).code, 'deposit_opened');
  assert.equal(player.command('open-deposit', { amount: 1000, term: 'd1' }).code, 'deposit_limit');
  player.step(DAY * 400);
  assert.equal(player.state.cash, 200250 + 3 * 500); assert.equal(player.state.economy.deposits.length, 0);
  assert.equal(player.state.cash - 200000, ledgerSum(player.state));
  const poor = life({ cash: 500 });
  assert.equal(poor.command('open-deposit', { amount: 1000, term: 'd1' }).code, 'insufficient_funds');
});

test('economy sanitize rebuilds every field from hostile input and cannot be used to mint money', () => {
  const hostile = createLife({ t: MONDAY_9AM, economy: {
    billedWeek: 9e9, started: 'yes', seq: -1,
    rent: { house: 'castle', arrears: 1e12, missed: -3 },
    loan: { left: -5, prepaid: 99, fees: 2 },
    deposits: [{ id: 'fd-1', amount: 1e12, term: 'd1', openedAt: 0 }, { id: 'fd-2', amount: 50000, term: 'd7', openedAt: MONDAY_9AM + 9e9 }, { id: 'fd-3', amount: 5000, term: 'zz', openedAt: 0 },
      'x', null, { id: 'FD 4', amount: 5000, term: 'd1', openedAt: 0 }, { id: 'fd-5', amount: 60000, term: 'd1', openedAt: 0 }],
  } }, ctx);
  assert.deepEqual(hostile.economy, { billedWeek: billingWeek(MONDAY_9AM), started: false, rent: { house: null, arrears: 0, missed: 0 }, loan: null, deposits: [], seq: 0, reminded: null, headsUp: null });
  const many = createLife({ t: MONDAY_9AM, economy: { rent: { house: 'yaba', arrears: 1e12, missed: 2 }, loan: { left: 80000, prepaid: 99, fees: 0 },
    deposits: Array.from({ length: 9 }, (_, i) => ({ id: `fd-${i}`, amount: 50000, term: 'd1', openedAt: 5 })).concat([{ id: 'fd-0', amount: 1000, term: 'd1', openedAt: 5 }]) } }, ctx);
  assert.equal(many.economy.deposits.length, 2, 'the total cap also binds saved deposits, and ids stay unique');
  assert.equal(many.economy.rent.arrears, 26400); assert.equal(many.economy.loan, null, 'a loan balance above the possible maximum is rejected');
  const good = createLife({ t: MONDAY_9AM, economy: { billedWeek: billingWeek(MONDAY_9AM), started: true, seq: 3, rent: { house: 'lekki', arrears: 17000, missed: 1 }, loan: { left: 24500, prepaid: 1, fees: 1 },
    deposits: [{ id: 'fd-3', amount: 5000, term: 'd3', openedAt: MONDAY_9AM - 1000 }] } }, ctx);
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(good)), ctx).economy, good.economy, 'a valid save round-trips unchanged');
  assert.equal(need(good.economy.loan).left, 24500);
});

// ---- through the real server ------------------------------------------------------------

test('server: apply, shift, deposit and replayed requests settle exactly once on server time', async (t) => {
  const f = await fixture(t); const device = await f.device('Ada');
  const read = async () => (await (await f.request('/api/life?city=lagos', null, device.cookie)).json()).state;
  const apply = { actionId: `100000:${randomUUID()}`, type: 'apply-job', payload: { id: 'teaching' } };
  const hired = await f.action(device.cookie, apply);
  assert.equal(hired.ok, true); assert.equal(hired.code, 'applied'); assert.equal(hired.state.job, 'teaching'); assert.equal(hired.state.career.performance, 50);
  assert.equal((await f.action(device.cookie, apply)).duplicate, true);
  await f.action(device.cookie, { type: 'spot', id: 'work' });
  const shift = { actionId: `100000:${randomUUID()}`, type: 'activity', id: 'teaching-shift' };
  assert.equal((await f.action(device.cookie, shift)).code, 'started');
  f.advance(20000); assert.equal((await read()).cash, 5000);
  f.advance(21000);
  const done = await read();
  assert.deepEqual([done.cash, done.completedShifts, done.career.performance, done.activeAction], [8000, 1, 60, null]);
  const replay = await f.action(device.cookie, shift);
  assert.equal(replay.duplicate, true); assert.equal(replay.state.cash, 8000);
  const second = await f.action(device.cookie, { type: 'activity', id: 'teaching-shift' });
  assert.equal(second.ok, false); assert.equal(second.code, 'shift_done'); assert.match(second.reason ?? '', /Next shift/);

  const deposit = { actionId: `${141000}:${randomUUID()}`, type: 'economy.open-deposit', payload: { amount: 5000, term: 'd1' } };
  assert.equal((await f.action(device.cookie, deposit)).code, 'deposit_opened');
  const again = await f.action(device.cookie, deposit);
  assert.equal(again.duplicate, true); assert.equal(again.state.cash, 3000); assert.equal(again.state.economy.deposits.length, 1);
  const refused = await f.action(device.cookie, { type: 'economy.pay-loan', payload: { mode: 'all' } });
  assert.equal(refused.ok, false); assert.equal(refused.code, 'no_loan'); assert.ok(refused.reason);
  f.advance(86400000);
  const matured = await read();
  assert.equal(matured.cash, 8025); assert.equal(matured.economy.deposits.length, 0);
  assert.equal((await read()).cash, 8025);
  assert.equal(matured.ledger.at(-1).reason, 'Fixed deposit matured: ₦5,000 + ₦25 interest');
});
