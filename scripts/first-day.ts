#!/usr/bin/env node
import { loadCityContent } from '../src/game/cities/registry.ts';
await loadCityContent('lagos');
/**
 * The scripted first day: one new life played end to end against the real server.
 *
 *   npm run first-day
 *
 * Starts the server in-process on an ephemeral port with a temporary data directory and a
 * clock this script controls, then drives one device session over HTTP exactly as the browser
 * client does (POST /api/session, GET /api/life, POST /api/action). Every step asserts the
 * exact wallet and need values and prints one transcript line. The day opens the way a new player
 * meets it: the quick start (a look, straight into Freedom Park as a guest), a first activity, a
 * hello, and only then settling in — after which the home goals follow as they always did. Nothing here reaches into the
 * rules engine to change state: the engine is imported only to read derived display data
 * (mood word, goal chip, prices) from the state the server returned, to check after every step
 * that reloading the returned state changes nothing, and to rehearse the birth lottery.
 *
 * THE RANDOM OUTCOMES IN THIS SCRIPT. On a real server nobody can choose a roll: every random
 * outcome is keyed with a secret salt the server creates for each life and never sends out, so
 * trying action IDs against a copy of the rules (what this script used to do for the birth
 * lottery) no longer says anything about what the server will roll. The run still needs the
 * outcomes it documents (LAPO Baby at birth, the puddle on the trek home), so it uses the
 * test-only hook in server/life-service.ts: this process — which IS the server here — fixes the
 * salt its one life is given (FIRST_DAY_SALT). No request can do that. If content changes and
 * those outcomes stop coming up, `node scripts/first-day.ts --find-salt` prints a salt that works.
 *
 * Plain Node, no dependencies. `runFirstDay({ log })` is also run by server/first-day.test.ts.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from '../server/server.ts';
import { useSaltSourceForTests } from '../server/life-service.ts';
import { createLife, viewLife } from '../src/life.ts';
import { weatherAt } from '../src/game/systems/health.ts';
import { findFreeSpot } from '../src/game/home-layout.ts';
import { FURNITURE } from '../src/game/content/furniture.ts';
import { HOUSE_TIERS } from '../src/game/content/world.ts';
import { EVENTS } from '../src/game/content/events.ts';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { LifeState, NeedId } from '../src/types/index.ts';
import type { ActionResponse, LifeResponse } from '../src/types/protocol.ts';

/** What this script uses of the server (server/server.ts is still untyped JavaScript). */
interface FirstDayServer extends Server { store: { close(): Promise<void> } }
type Json = Record<string, unknown>;
interface Http<T> { status: number; headers: Headers; json: T }
interface SentBody { actionId: string; cityId: string; type: string; payload?: Json }
/** The fields of GET /api/world/me this script reads. */
interface WorldMe { placed: boolean; lga: string; plot?: { lga: string } }
/** The error body the action route answers with on a refusal. */
interface ErrorBody { error?: string }
export interface FirstDayOptions { log?: (line: string) => void; salt?: string }
export interface FirstDayResult { steps: number; cash: number }

/** Narrow away null and undefined; the script fails here, as a property read on the missing value would. */
function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new TypeError(`${what} is missing`);
  return value;
}

const CITY = 'lagos';
/** The local government this player picks when he settles in: his free starter house stands on a plot there. */
const LGA = 'lagos-mainland';
const NEEDS: NeedId[] = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'];
const naira = (value: number) => `₦${value.toLocaleString('en-NG')}`;
const needsOf = (state: LifeState) => NEEDS.map((need) => state.needs[need]);
/** The goal chip, which carries a step and a target only while the goal chain is running. */
function goalChip(view: ReturnType<typeof viewLife>) {
  const chip = view.goals.chip;
  if (chip.kind !== 'goal') throw new TypeError(`the goal chip is a ${chip.kind} chip, not a goal`);
  return chip;
}
const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };

/** Monday 5 January 2026, 10:00 in Lagos, moved forward to the first 20-minute block that is dry and stays dry. */
function dryMondayMorning(): number {
  let start = Date.UTC(2026, 0, 5, 9);
  while ([0, 1, 2].some((block) => weatherAt(start + block * 20 * 60000, CITY).raining)) start += 20 * 60000;
  return start;
}

/** The salt this run's life is created with (see the header). Found with --find-salt. */
export const FIRST_DAY_SALT = 'first-day-salt-0036';

export async function runFirstDay({ log = console.log, salt = FIRST_DAY_SALT }: FirstDayOptions = {}): Promise<FirstDayResult> {
  const dataDir = await mkdtemp(join(tmpdir(), 'joinallworld-first-day-'));
  let time = dryMondayMorning();
  let server: FirstDayServer | undefined, base = '', cookie: string | undefined, ids = 0, step = 0;
  const serverOptions = { dataDir, now: () => time, distDir: join(dataDir, 'no-dist') };

  async function boot() {
    const booted = await createServer(serverOptions) as unknown as FirstDayServer;
    server = booted;
    booted.listen(0, '127.0.0.1');
    await once(booted, 'listening');
    base = `http://127.0.0.1:${(booted.address() as AddressInfo).port}`;
  }
  // A graceful stop writes anything not yet on disk (the server does the same on SIGTERM).
  async function halt() { const running = server; if (!running) return; running.closeAllConnections(); await new Promise<void>((done) => running.close(() => done())); await running.store.close(); }
  async function http<T = Json>(path: string, body?: unknown): Promise<Http<T>> {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
    return { status: response.status, headers: response.headers, json: await response.json() as T };
  }
  /** A fresh, valid action ID: "<server ms>:<uuid>". The uuid counts up so the run is reproducible. */
  const nextId = () => `${time}:00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
  async function send(body: SentBody): Promise<ActionResponse> {
    const { status, json } = await http<ActionResponse>('/api/action', body);
    assert.equal(status, 200, `${body.type}: HTTP ${status} ${JSON.stringify(json)}`);
    stable(json.state, body.type);
    return json;
  }
  const action = (type: string, payload?: Json) => send({ actionId: nextId(), cityId: CITY, type, ...(payload ? { payload } : {}) });
  async function ok(type: string, payload: Json | undefined, code?: string) {
    const result = await action(type, payload);
    assert.equal(result.ok, true, `${type} was refused: ${result.code} — ${result.state.message}`);
    if (code) assert.equal(result.code, code, type);
    return result.state;
  }
  /** Every state the server returns must survive a reload unchanged: nothing a system wrote may be lost at the next load. */
  const stable = (state: LifeState, what: string) => { assert.deepEqual(createLife(structuredClone(state), { now: time, cityId: CITY }), state, `${what}: reloading the returned state changes nothing`); return state; };
  const life = async () => stable((await http<LifeResponse>(`/api/life?city=${CITY}`)).json.state, 'GET /api/life');
  /** Let server time pass, then read the settled life. */
  async function wait(seconds: number) { time += seconds * 1000; return life(); }
  const view = (state: LifeState) => viewLife(createLife(state, { now: time, cityId: CITY }), { now: time, cityId: CITY });
  const say = (title: string, state: LifeState, note = '') => log(`${String(++step).padStart(2, '0')}  ${title.padEnd(46)} ${naira(state.cash).padStart(9)}  H/E/F/S/Hy/B ${needsOf(state).join('/')}${note ? `  · ${note}` : ''}`);
  const check = (state: LifeState, cash: number, needs: number[], label: string) => {
    assert.equal(state.cash, cash, `${label}: wallet`);
    assert.deepEqual(needsOf(state), needs, `${label}: needs (hunger, energy, fun, social, hygiene, bladder)`);
  };
  /**
   * Travel and wait out the trip; a roadside event on arrival is answered with its last choice, which
   * never costs money. Which event comes up is decided by the server from the trip's settlement, so it
   * is reported with whatever that answer does to the needs (read from the event content).
   */
  async function travel(id: string, mode: string, fare: number, label: string) {
    const before = (await life()).cash;
    const started = await ok('travel', { id, mode }, 'started');
    assert.equal(started.cash, before - fare, `${label}: the fare is charged at departure`);
    assert.equal(started.location !== id, true);
    let state = await wait(must(started.activeAction).duration);
    assert.equal(state.location, id, `${label}: arrived`);
    let event = '';
    if (state.travel.event) {
      const offer = must(view(state).travel.event);
      const lastChoice = must(offer.choices.at(-1));
      const cash = state.cash;
      state = await ok('world.roadside', { choice: lastChoice.id }, 'resolved');
      assert.equal(state.cash, cash, 'declining a roadside offer is free');
      const effects = must(must(EVENTS[offer.id]).choices.at(-1)).effects || {};
      const cost = Object.entries(effects).map(([need, amount]) => `${need.charAt(0).toUpperCase()}${need.slice(1)} ${amount > 0 ? '+' : '−'}${Math.abs(amount)}`).join(', ');
      event = `roadside “${offer.title}” answered “${lastChoice.label}”${cost ? ` (${cost})` : ''}`;
    }
    return { state, seconds: must(started.activeAction).duration, event };
  }

  try {
    await boot();
    log(`First day · server clock starts ${new Date(time).toISOString()} (Monday morning in Lagos, dry weather)`);

    // ---- a new device session, as the quick start opens it: a name, then a look --------------
    const opened = await http('/api/session', { name: 'Tunde', onboarding: true });
    assert.equal(opened.status, 200);
    cookie = must(opened.headers.get('set-cookie')).split(';')[0];
    // The server (this process) fixes the salt of the life it is about to create. Test-only hook; see the header.
    useSaltSourceForTests(() => salt);
    let state = await life();
    assert.deepEqual([state.onboarding.stage, state.onboarding.required, state.onboarding.done, state.cash, state.location], ['guest', true, false, 5000, 'park']);
    const early = await action('travel', { id: 'library', mode: 'trek' });
    assert.deepEqual([early.ok, early.code], [false, 'onboarding_required'], 'nothing is accepted before the look is confirmed');
    state = await ok('onboarding.quick-start', { look: LOOK }, 'playing');
    check(state, 5000, [80, 85, 70, 60, 75, 70], 'quick start');
    let shown = view(state);
    assert.deepEqual([state.location, state.spot, shown.onboarding.guest, shown.goals.chip.title, goalChip(shown).step, goalChip(shown).go], ['park', 'trees', true, 'Play a round of Ayo', 1, ['park', 'trees']]);
    say('quick start: Tunde is in Freedom Park, a guest', state, 'no traits, dream, lottery or home asked; first goal “Play a round of Ayo”');

    // ---- goal 1: something enjoyable right where he stands -----------------------------------
    await ok('activity', { id: 'play-ayo' }, 'started');
    state = await wait(7);
    check(state, 5500, [80, 85, 78, 68, 75, 70], 'ayo');
    assert.deepEqual([state.goals.stars, must(state.ledger.at(-1)).reason, must(state.onboarding.firstAt) - must(state.onboarding.bornAt)], [1, 'Goal: Play a round of Ayo', 7000]);
    say('Play Ayo under the trees (7s)', state, 'Fun +8, Social +8, goal 1 +₦500 +1✨ — 7 seconds after landing');

    // ---- goal 2: say hello to one of the park's regulars --------------------------------------
    const regular = must(view(state).social.here[0]);
    await ok('spot', { id: 'people' }, 'selected');
    await ok('activity', { id: `npc-${regular.id}-hello` }, 'started');
    state = await wait(6);
    check(state, 6000, [80, 85, 80, 80, 75, 70], 'hello');
    assert.deepEqual([state.goals.stars, must(state.ledger.at(-1)).reason, view(state).goals.chip.title, view(state).goals.chip.open], [2, 'Goal: Say hello to someone', 'Settle in', 'onboarding']);
    say(`Say Hello to ${regular.name} in the park (6s)`, state, 'Social +12, Fun +2, goal 2 +₦500 +1✨; next: “Settle in”');

    // ---- a guest has no home: the home-only actions say so, and nothing is billed ---------------
    const noHome = await action('travel', { id: 'home', mode: 'trek' });
    assert.deepEqual([noHome.ok, noHome.code], [false, 'settle_required']);
    assert.match(noHome.state.message, /^Settle in to get your home/);
    assert.deepEqual([state.economy.rent.house, state.economy.loan, state.economy.billedWeek], [null, null, null]);
    say('Home as a guest: “Settle in to get your home”', noHome.state, 'refused, nothing changed');

    // ---- goal 3: settle in — two traits, a dream, the birth lottery, Yaba -----------------------
    await ok('onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }, 'traits_saved');
    state = await ok('onboarding.dream', { dream: 'yaba-unicorn' }, 'dream_saved');
    // The roll is decided by the action ID, the server clock and the life's secret salt: it cannot
    // be found by trying IDs. Under this run's fixed salt the outcome is always the same.
    const rollId = nextId();
    const rolled = await send({ actionId: rollId, cityId: CITY, type: 'onboarding.lottery', payload: {} });
    assert.deepEqual([rolled.code, must(rolled.state.onboarding.lottery).id], ['rolled', 'lapo-baby'], 'the fixed salt rolls LAPO Baby (if content changed, run with --find-salt)');
    const noPlace = await action('onboarding.home', {});
    assert.deepEqual([noPlace.ok, noPlace.code], [false, 'lga_required'], 'settling in needs a local government: that is where the house stands');
    state = await ok('onboarding.home', { lga: LGA, via: 'manual' }, 'life_started');
    // ₦76,000 is a LAPO Baby's start in the free starter house (the same as its Mushin start, with no weekly rent); the guest keeps the ₦1,000 he earned, and "Settle in" pays ₦1,000.
    check(state, 78000, [80, 85, 80, 80, 75, 70], 'move in');
    shown = view(state);
    assert.deepEqual([state.location, state.estate.lga, state.estate.lgaConfirmed, state.estate.living, state.estate.tier, shown.onboarding.mood.word, shown.skills.hustle.level, state.goals.stars], ['home', LGA, true, 'own', 'starter', 'Very Happy', 2, 3]);
    assert.deepEqual([must(shown.economy.loan).left, must(shown.economy.loan).weekly, state.economy.rent.house], [72000, 12000, null], 'the loan is his; there is no rent on his own house');
    // The server sets a plot aside for him in that local government as soon as the choice is saved.
    const mine = (await http<WorldMe>(`/api/world/me?city=${CITY}`)).json;
    assert.deepEqual([mine.placed, mine.lga, mine.plot?.lga], [true, LGA, LGA]);
    state = await life();
    assert.deepEqual(state.estate.plot, mine.plot, 'the plot is recorded in the life');
    assert.deepEqual([shown.goals.chip.kind, shown.goals.chip.title, goalChip(shown).step], ['goal', 'Eat something', 4]);
    assert.deepEqual(shown.goals.wishes.map((wish) => wish.label), ['Make ₦15,000 today', 'See art at Freedom Park', 'See a movie at The Palms']);
    assert.deepEqual(state.inventory, { rice: 2, 'tomato-paste': 2, seasoning: 6, 'veg-oil': 4, garri: 4, sugar: 5, noodles: 3, eggs: 6, bread: 2, zobo: 1, plantain: 2 });
    assert.deepEqual(state.ledger.slice(-2).map((entry) => [entry.amount, entry.reason]), [[71000, 'Start cash · Starter house, Lagos Mainland (includes ₦60,000 LAPO loan)'], [1000, 'Goal: Settle in']]);
    say('settled in: LAPO Baby, own starter house in Lagos Mainland', state, `start cash +₦71,000 (₦76,000 less the ₦5,000 seed), goal 3 +₦1,000 +1✨, mood ${shown.onboarding.mood.word}, Hustle 2, loan ₦72,000 at ₦12,000/week`);

    // ---- goal 4: eat from the cooler --------------------------------------------------------
    await ok('spot', { id: 'kitchen' }, 'selected');
    await ok('activity', { id: 'home-soak-garri' }, 'started');
    state = await wait(5);
    check(state, 78500, [100, 85, 80, 80, 75, 70], 'soak garri');
    assert.deepEqual([state.inventory.garri, state.inventory.sugar, state.goals.stars, must(state.ledger.at(-1)).reason], [3, 4, 4, 'Goal: Eat something']);
    say('Soak Garri & Sugar from the cooler (5s)', state, 'goal 4 +₦500 +1✨, garri 4→3, sugar 5→4');

    // ---- goal 5: bucket bath — start, cancel, then to completion ----------------------------
    await ok('spot', { id: 'bathroom' }, 'selected');
    await ok('activity', { id: 'bath' }, 'started');
    state = await ok('cancel', undefined, 'cancelled');
    check(state, 78500, [100, 85, 80, 80, 75, 70], 'bath cancelled');
    assert.equal(state.goals.stars, 4);
    say('bucket bath started, cancelled at once', state, 'nothing changed');
    await ok('activity', { id: 'bath' }, 'started');
    state = await wait(6);
    check(state, 79000, [100, 85, 80, 80, 100, 70], 'bath');
    assert.deepEqual([view(state).onboarding.mood.word, state.goals.stars, must(state.ledger.at(-1)).reason], ['Very Happy', 5, 'Goal: Freshen up']);
    say('bucket bath to completion (6s)', state, 'goal 5 +₦500 +1✨, mood Very Happy');

    // ---- goal 6: Jobs → apply for Tech --------------------------------------------------------
    state = await ok('apply-job', { id: 'tech' }, 'applied');
    check(state, 80000, [100, 85, 80, 80, 100, 70], 'apply');
    shown = view(state);
    assert.deepEqual([state.job, shown.career.role, shown.career.pay, shown.career.performance, state.goals.stars], ['tech', 'Intern', 3600, 50, 6]);
    assert.equal(shown.career.hours, 'CcHub · Open 8AM – 10PM — you can only travel there while it is open');
    // "Go automatically" is on and CcHub is open, but the tutorial is not at "Work a shift" yet,
    // so nobody is whisked away: the commute waits.
    assert.deepEqual([state.career.auto, state.location, state.activeAction], [true, 'home', null]);
    say('applied for Tech: hired as Intern', state, 'goal 6 +₦1,000 +1✨; “Go automatically” waits until the tutorial asks for a shift');

    // ---- goal 7: Buy → place a plastic chair --------------------------------------------------
    const chair = FURNITURE['plastic-chair'];
    assert.equal(view(state).home.prices['plastic-chair'], 500);
    const tile = findFreeSpot(HOUSE_TIERS.starter.grid, state.home.items, must(chair));
    const chairsBefore = state.home.items.filter((item) => item.itemId === 'plastic-chair').length;
    const chairBody = { actionId: nextId(), cityId: CITY, type: 'home.furniture-buy', payload: { item: 'plastic-chair', ...tile } };
    const bought = await send(chairBody);
    assert.deepEqual([bought.ok, bought.code], [true, 'bought']);
    state = bought.state;
    check(state, 80500, [100, 85, 80, 80, 100, 70], 'chair');
    assert.equal(state.home.items.filter((item) => item.itemId === 'plastic-chair').length, chairsBefore + 1);
    assert.deepEqual(state.ledger.slice(-2).map((entry) => [entry.amount, entry.reason]), [[-500, 'Bought Plastic Chair'], [1000, 'Goal: Buy something new']]);
    say('bought and placed a Plastic Chair', state, 'chair −₦500, goal 7 +₦1,000 +1✨');

    // ---- goal 8: Map → Danfo to Amala Shitta ---------------------------------------------------
    let trip = await travel('amala-shitta', 'danfo', 150, 'Danfo to Amala Shitta');
    state = trip.state;
    check(state, 81850, [100, 85, 80, 80, 100, 70], 'arrive Amala Shitta');
    assert.deepEqual([state.goals.stars, must(state.ledger.at(-1)).reason, must(state.ledger.at(-2)).reason], [8, 'Goal: Visit the buka', 'Danfo to Amala Shitta']);
    say(`Danfo Home → Amala Shitta (${trip.seconds}s)`, state, `fare −₦150 at departure, goal 8 +₦1,500 +1✨${trip.event ? `, ${trip.event}` : ''}`);

    // ---- a paid meal: start, cancel, then to completion ----------------------------------------
    assert.equal(state.spot, 'counter');
    state = await ok('activity', { id: 'buka-jollof' }, 'started');
    assert.equal(state.cash, 81850, 'nothing is charged when a paid activity starts');
    state = await ok('cancel', undefined, 'cancelled');
    check(state, 81850, [100, 85, 80, 80, 100, 70], 'meal cancelled');
    say('Jollof, Dodo & Chicken started, cancelled', state, 'wallet unchanged');
    await ok('activity', { id: 'buka-jollof' }, 'started');
    state = await wait(8);
    check(state, 81300, [100, 85, 90, 80, 100, 70], 'meal');
    assert.equal(state.ledger.filter((entry) => entry.reason === 'Jollof, Dodo & Chicken').length, 1, 'charged once');
    assert.ok(state.moodlets.some((moodlet) => moodlet.id === 'party-jollof'));
    say('Jollof, Dodo & Chicken to completion (8s)', state, 'meal −₦550 once, Fun +10, feeling Party Jollof');

    // ---- goal 9: make a friend — Say Hello to Amaka, who serves at the buka ---------------------
    assert.deepEqual(view(state).social.here.map((npc) => [npc.name, npc.role]), [['Amaka', 'Serving']]); // Baba Sege has had his lunch and is not back for supper yet
    assert.deepEqual([view(state).goals.chip.title, view(state).goals.chip.hint], ['Make a new friend', 'Tap someone at a venue']);
    await ok('spot', { id: 'people' }, 'selected');
    const hello = await ok('activity', { id: 'npc-amaka-hello' }, 'started');
    assert.equal(must(hello.activeAction).duration, 6);
    state = await wait(6);
    // Effect of Say Hello: Social +12, Fun +2 (80 → 92, 90 → 92).
    check(state, 82800, [100, 85, 92, 92, 100, 70], 'say hello');
    assert.deepEqual([state.goals.stars, must(state.ledger.at(-1)).reason], [9, 'Goal: Make a new friend']);
    assert.deepEqual([must(state.social.rel.amaka).p, must(state.social.rel.amaka).npc], [2, true]);
    say('Say Hello to Amaka at the buka (6s)', state, 'Social +12, Fun +2, goal 9 +₦1,500 +1✨, closeness with Amaka 0→2');

    // ---- goal 10: the tutorial now asks for a shift, so "Go automatically" starts the free commute ---
    assert.equal(view(state).goals.chip.title, 'Work a shift');
    assert.deepEqual([state.activeAction?.kind, state.activeAction?.id, state.career.auto], ['commute', 'cchub', true]);
    assert.match(state.message, /^Go automatically: heading to CcHub for today’s shift/);
    const commute = must(state.activeAction).duration;
    state = await wait(commute);
    assert.deepEqual([state.location, state.spot, state.activeAction], ['cchub', 'work', null]);
    check(state, 82800, [100, 85, 92, 92, 100, 70], 'arrive CcHub');
    const shift = await ok('activity', { id: 'tech-shift' }, 'started');
    assert.equal(shift.cash, 82800, 'a shift pays on completion');
    state = await wait(must(shift.activeAction).duration);
    check(state, 88400, [88, 65, 92, 92, 100, 70], 'shift');
    shown = view(state);
    assert.deepEqual([shown.career.performance, state.completedShifts, state.goals.stars, state.goals.chain], [60, 1, 10, 10]);
    assert.deepEqual(state.ledger.slice(-2).map((entry) => [entry.amount, entry.reason]), [[3600, 'Tech shift'], [2000, 'Goal: Work a shift']]);
    say(`automatic commute to CcHub (${commute}s), Tech shift (${must(shift.activeAction).duration}s)`, state, 'no fare, pay +₦3,600 in the ledger, performance 50→60%, goal 10 +₦2,000 +1✨');

    // ---- trek home; decline any roadside offer ---------------------------------------------------
    assert.equal(weatherAt(time + 20000, CITY).raining, false, 'the trek happens in dry weather');
    trip = await travel('home', 'trek', 0, 'Trek home');
    state = trip.state;
    // Energy −10 and Hygiene −7 for the trek, and Hygiene −3 for bracing against the puddle splash.
    assert.equal(trip.event, 'roadside “Bus versus puddle” answered “Turn your back and brace” (Hygiene −3)');
    check(state, 88400, [88, 55, 92, 92, 90, 70], 'trek home');
    say(`trek CcHub → Home (${trip.seconds}s)`, state, `Energy −10, Hygiene −7${trip.event ? `, ${trip.event}` : ', no roadside offer'}`);

    // ---- nap, wake early: the energy gained so far is kept -----------------------------------------
    await ok('spot', { id: 'bedroom' }, 'selected');
    await ok('activity', { id: 'nap' }, 'started');
    state = await wait(8);
    assert.equal(must(state.activeAction).id, 'nap');
    state = await ok('cancel', undefined, 'cancelled');
    check(state, 88400, [88, 71, 92, 92, 90, 70], 'nap woken early');
    assert.equal(state.message, 'Tunde woke up. The rest you got is kept.', 'waking is not "Action cancelled."');
    say('nap, woken after 8 of 15 seconds', state, 'Energy +16 kept · “Tunde woke up. The rest you got is kept.”');

    // ---- cook Jollof: ingredients are used once, when the meal finishes ------------------------------
    await ok('spot', { id: 'kitchen' }, 'selected');
    const cooking = await ok('activity', { id: 'home-cook-jollof' }, 'started');
    assert.deepEqual([cooking.inventory.rice, cooking.inventory['tomato-paste'], cooking.inventory.seasoning, cooking.inventory['veg-oil']], [2, 2, 6, 4], 'nothing is used at the start');
    state = await wait(11);
    check(state, 88400, [100, 71, 92, 92, 90, 70], 'cook jollof');
    assert.deepEqual([state.inventory.rice, state.inventory['tomato-paste'], state.inventory.seasoning, state.inventory['veg-oil']], [1, 1, 5, 3]);
    state = await wait(30);
    assert.deepEqual([state.inventory.rice, state.inventory['tomato-paste'], state.inventory.seasoning, state.inventory['veg-oil']], [1, 1, 5, 3], 'used once');
    say('Cook Jollof on the stove (11s)', state, 'rice 2→1, tomato paste 2→1, seasoning 6→5, oil 4→3');

    // ---- reload: the same life comes back, even from a restarted server ------------------------------
    const beforeReload = await life();
    assert.deepEqual(await life(), beforeReload, 'fetching again changes nothing');
    await halt();
    await boot();
    const afterRestart = await life();
    assert.deepEqual(afterRestart, beforeReload, 'the life read back from disk by a new server process is identical');
    say('reload (server restarted on the same data)', afterRestart, 'identical state');

    // ---- replay: the same action ID has no second effect -----------------------------------------------
    const replay = await send(chairBody);
    assert.deepEqual([replay.duplicate, replay.ok, replay.code], [true, true, 'bought']);
    check(replay.state, 88400, [100, 71, 92, 92, 90, 70], 'replay');
    assert.equal(replay.state.home.items.filter((item) => item.itemId === 'plastic-chair').length, chairsBefore + 1);
    assert.equal(replay.state.ledger.filter((entry) => entry.reason === 'Bought Plastic Chair').length, 1);
    const conflict = await http<ErrorBody>('/api/action', { ...chairBody, payload: { item: 'velvet-sofa', ...tile } });
    assert.deepEqual([conflict.status, conflict.json.error], [409, 'action_id_conflict'], 'the same ID with different contents is rejected');
    say('replayed the chair purchase (same action ID)', replay.state, 'duplicate: no second charge, no second chair');

    // ---- Saturday: rent and the loan instalment are collected exactly once ---------------------------
    const saturday = Date.UTC(2026, 0, 9, 23, 0, 5); // Saturday 10 January 2026, 00:00:05 in Lagos
    assert.ok(saturday > time);
    time = saturday;
    state = await life();
    const bills = state.ledger.filter((entry) => /^(Rent|Loan repayment)/.test(entry.reason));
    assert.deepEqual(bills.map((entry) => [entry.amount, entry.reason]), [[-12000, 'Loan repayment (due Sat 10 Jan)']]);
    // However long the player was away, one settlement applies at most four hours of need decay
    // (hunger 6, energy 4, fun 5, social 4, hygiene 3, bladder 8 points an hour).
    check(state, 76400, [76, 55, 72, 76, 78, 38], 'Saturday');
    assert.equal(must(view(state).economy.loan).left, 60000);
    say('Saturday 00:00: the loan instalment, and no rent', state, 'loan −₦12,000 with a ledger line; loan ₦60,000 left; he lives in his own starter house, so no rent is due');
    await wait(3600);
    const later = await wait(86350); // Sunday
    assert.equal(later.ledger.filter((entry) => /^(Rent|Loan repayment)/.test(entry.reason)).length, 1, 'not collected again on later settlements that week');
    assert.equal(later.cash, 76400);
    const stale = await http<ErrorBody>('/api/action', chairBody);
    assert.deepEqual([stale.status, stale.json.error], [409, 'action_expired'], 'an action ID older than 24 hours is refused');
    say('a day later: nothing collected twice', later, 'wallet unchanged; the week-old action ID is refused as expired');
    state = later;

    log('');
    log('Ledger (every wallet change of the day has a line):');
    for (const entry of state.ledger) log(`    ${(entry.amount > 0 ? '+' : '−') + naira(Math.abs(entry.amount))}`.padEnd(14) + ` ${entry.reason}`.padEnd(64) + naira(entry.balance).padStart(9));
    const total = state.ledger.reduce((sum, entry) => sum + entry.amount, 0);
    assert.equal(5000 + total, state.cash, 'the ledger explains the whole balance');
    log(`First day complete: ${step} steps, final wallet ${naira(state.cash)}.`);
    return { steps: step, cash: state.cash };
  } finally {
    useSaltSourceForTests(); // back to random salts for anything else in this process
    if (server?.listening) await halt();
    await rm(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--find-salt')) {
    // Maintenance: try salts until the whole run holds, and print the first that does.
    let found = null;
    for (let i = 0; i < 5000 && !found; i++) {
      const salt = `first-day-salt-${String(i).padStart(4, '0')}`;
      try { await runFirstDay({ log: () => {}, salt }); found = salt; } catch { /* not this one */ }
    }
    console.log(found ? `FIRST_DAY_SALT = '${found}'` : 'No salt in the first 5,000 makes the run hold: the script itself needs updating.');
    process.exitCode = found ? 0 : 1;
  } else runFirstDay().catch((error) => { console.error(`\nFIRST DAY FAILED: ${error.message}`); process.exitCode = 1; });
}
