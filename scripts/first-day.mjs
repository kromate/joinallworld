#!/usr/bin/env node
/**
 * The scripted first day: one new life played end to end against the real server.
 *
 *   npm run first-day
 *
 * Starts the server in-process on an ephemeral port with a temporary data directory and a
 * clock this script controls, then drives one device session over HTTP exactly as the browser
 * client does (POST /api/session, GET /api/life, POST /api/action). Every step asserts the
 * exact wallet and need values and prints one transcript line. Nothing here reaches into the
 * rules engine to change state: the engine is imported only to read derived display data
 * (mood word, goal chip, prices) from the state the server returned, and to find an action ID
 * whose birth-lottery roll is the outcome this run needs.
 *
 * Plain Node, no dependencies. `runFirstDay({ log })` is also run by server/first-day.test.js.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from '../server/server.js';
import { createLife, dispatch, viewLife } from '../src/life.js';
import { weatherAt } from '../src/game/systems/health.js';
import { findFreeSpot } from '../src/game/home-layout.js';
import { FURNITURE } from '../src/game/content/furniture.js';
import { HOUSES } from '../src/game/content/housing.js';

const CITY = 'lagos';
const NEEDS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'];
const naira = (value) => `₦${value.toLocaleString('en-NG')}`;
const needsOf = (state) => NEEDS.map((need) => state.needs[need]);
const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };

/** Monday 5 January 2026, 10:00 in Lagos, moved forward to the first 20-minute block that is dry and stays dry. */
function dryMondayMorning() {
  let start = Date.UTC(2026, 0, 5, 9);
  while ([0, 1, 2].some((block) => weatherAt(start + block * 20 * 60000, CITY).raining)) start += 20 * 60000;
  return start;
}

export async function runFirstDay({ log = console.log } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'joinallworld-first-day-'));
  let time = dryMondayMorning();
  let server, base, cookie, ids = 0, step = 0;
  const serverOptions = { dataDir, now: () => time, distDir: join(dataDir, 'no-dist') };

  async function boot() {
    server = await createServer(serverOptions);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function halt() { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
  async function http(path, body) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
    return { status: response.status, headers: response.headers, json: await response.json() };
  }
  /** A fresh, valid action ID: "<server ms>:<uuid>". The uuid counts up so the run is reproducible. */
  const nextId = () => `${time}:00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
  async function send(body) {
    const { status, json } = await http('/api/action', body);
    assert.equal(status, 200, `${body.type}: HTTP ${status} ${JSON.stringify(json)}`);
    return json;
  }
  const action = (type, payload) => send({ actionId: nextId(), cityId: CITY, type, ...(payload ? { payload } : {}) });
  async function ok(type, payload, code) {
    const result = await action(type, payload);
    assert.equal(result.ok, true, `${type} was refused: ${result.code} — ${result.state.message}`);
    if (code) assert.equal(result.code, code, type);
    return result.state;
  }
  const life = async () => (await http(`/api/life?city=${CITY}`)).json.state;
  /** Let server time pass, then read the settled life. */
  async function wait(seconds) { time += seconds * 1000; return life(); }
  const view = (state) => viewLife(createLife(state, { now: time, cityId: CITY }), { now: time, cityId: CITY });
  const say = (title, state, note = '') => log(`${String(++step).padStart(2, '0')}  ${title.padEnd(46)} ${naira(state.cash).padStart(9)}  H/E/F/S/Hy/B ${needsOf(state).join('/')}${note ? `  · ${note}` : ''}`);
  const check = (state, cash, needs, label) => {
    assert.equal(state.cash, cash, `${label}: wallet`);
    assert.deepEqual(needsOf(state), needs, `${label}: needs (hunger, energy, fun, social, hygiene, bladder)`);
  };
  /** Travel and wait out the trip; a roadside event on arrival is declined (its last answer is always free). */
  async function travel(id, mode, fare, label) {
    const before = (await life()).cash;
    const started = await ok('travel', { id, mode }, 'started');
    assert.equal(started.cash, before - fare, `${label}: the fare is charged at departure`);
    assert.equal(started.location !== id, true);
    let state = await wait(started.activeAction.duration);
    assert.equal(state.location, id, `${label}: arrived`);
    let event = '';
    if (state.travel.event) {
      const offer = view(state).travel.event;
      const cash = state.cash;
      state = await ok('world.roadside', { choice: offer.choices.at(-1).id }, 'resolved');
      assert.equal(state.cash, cash, 'declining a roadside offer is free');
      event = `declined “${offer.title}”`;
    }
    return { state, seconds: started.activeAction.duration, event };
  }

  try {
    await boot();
    log(`First day · server clock starts ${new Date(time).toISOString()} (Monday morning in Lagos, dry weather)`);

    // ---- a new device session that declares it can show character creation ---------------
    const opened = await http('/api/session', { name: 'Tunde', onboarding: true });
    assert.equal(opened.status, 200);
    cookie = opened.headers.get('set-cookie').split(';')[0];
    let state = await life();
    assert.deepEqual([state.onboarding.required, state.onboarding.done, state.cash], [true, false, 5000]);
    const early = await action('travel', { id: 'home', mode: 'trek' });
    assert.deepEqual([early.ok, early.code], [false, 'onboarding_required'], 'a new life cannot be played before creation is finished');
    say('new session: play is refused until creation', early.state, early.state.message);

    // ---- onboarding: man, two traits, a dream, the birth lottery, Yaba ---------------------
    await ok('onboarding.look', { look: LOOK }, 'look_saved');
    await ok('onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }, 'traits_saved');
    state = await ok('onboarding.dream', { dream: 'yaba-unicorn' }, 'dream_saved');
    // The roll is decided by the action ID and the server clock. Find an ID that rolls the
    // outcome observed in the reference game by running the same pure rule on a copy.
    let rollId = null;
    for (let i = 0; i < 200 && !rollId; i++) {
      const candidate = nextId();
      const copy = createLife(state, { now: time, cityId: CITY });
      dispatch(copy, { type: 'onboarding.lottery', payload: {}, actionId: candidate }, { now: time, cityId: CITY, actionId: candidate });
      if (copy.onboarding.lottery?.id === 'lapo-baby') rollId = candidate;
    }
    assert.ok(rollId, 'an action ID that rolls LAPO Baby exists');
    const rolled = await send({ actionId: rollId, cityId: CITY, type: 'onboarding.lottery', payload: {} });
    assert.deepEqual([rolled.code, rolled.state.onboarding.lottery.id], ['rolled', 'lapo-baby']);
    state = await ok('onboarding.home', { house: 'yaba' }, 'life_started');
    check(state, 96000, [80, 85, 70, 60, 75, 70], 'move in');
    let shown = view(state);
    assert.deepEqual([state.location, state.property.house, shown.onboarding.mood.word, shown.skills.hustle.level, state.goals.stars], ['home', 'yaba', 'Happy', 2, 0]);
    assert.deepEqual([shown.economy.loan.left, shown.economy.loan.weekly, shown.economy.rent.amount], [72000, 12000, 6000]);
    assert.deepEqual([shown.goals.chip.kind, shown.goals.chip.title, shown.goals.chip.step], ['goal', 'Eat something', 1]);
    assert.deepEqual(shown.goals.wishes.map((wish) => wish.label), ['Make ₦15,000 today', 'See art at Freedom Park', 'See a movie at The Palms']);
    assert.deepEqual(state.inventory, { rice: 2, 'tomato-paste': 2, seasoning: 6, 'veg-oil': 4, garri: 4, sugar: 5, noodles: 3, eggs: 6, bread: 2, zobo: 1, plantain: 2 });
    assert.equal(state.ledger.at(-1).reason, 'Start cash · Self-contain, Yaba (includes ₦60,000 LAPO loan)');
    say('moved in: LAPO Baby, Self-contain in Yaba', state, `mood ${shown.onboarding.mood.word}, Hustle 2, loan ₦72,000 at ₦12,000/week`);

    // ---- goal 1: eat from the cooler --------------------------------------------------------
    await ok('spot', { id: 'kitchen' }, 'selected');
    await ok('activity', { id: 'home-soak-garri' }, 'started');
    state = await wait(5);
    check(state, 96500, [100, 85, 70, 60, 75, 70], 'soak garri');
    assert.deepEqual([state.inventory.garri, state.inventory.sugar, state.goals.stars, state.ledger.at(-1).reason], [3, 4, 1, 'Goal: Eat something']);
    say('Soak Garri & Sugar from the cooler (5s)', state, 'goal 1 +₦500 +1✨, garri 4→3, sugar 5→4');

    // ---- goal 2: bucket bath — start, cancel, then to completion ----------------------------
    await ok('spot', { id: 'bathroom' }, 'selected');
    await ok('activity', { id: 'bath' }, 'started');
    state = await ok('cancel', undefined, 'cancelled');
    check(state, 96500, [100, 85, 70, 60, 75, 70], 'bath cancelled');
    assert.equal(state.goals.stars, 1);
    say('bucket bath started, cancelled at once', state, 'nothing changed');
    await ok('activity', { id: 'bath' }, 'started');
    state = await wait(6);
    check(state, 97000, [100, 85, 70, 60, 100, 70], 'bath');
    assert.deepEqual([view(state).onboarding.mood.word, state.goals.stars, state.ledger.at(-1).reason], ['Very Happy', 2, 'Goal: Freshen up']);
    say('bucket bath to completion (6s)', state, 'goal 2 +₦500 +1✨, mood Very Happy');

    // ---- goal 3: Jobs → apply for Tech --------------------------------------------------------
    state = await ok('apply-job', { id: 'tech' }, 'applied');
    check(state, 98000, [100, 85, 70, 60, 100, 70], 'apply');
    shown = view(state);
    assert.deepEqual([state.job, shown.career.role, shown.career.pay, shown.career.performance, state.goals.stars], ['tech', 'Intern', 3600, 50, 3]);
    assert.equal(shown.career.hours, 'CcHub · Open 8AM – 10PM — you can only travel there while it is open');
    // "Go automatically" is on by default and CcHub is open, so the commute starts at once. Stay home for now.
    assert.deepEqual([state.activeAction?.kind, state.activeAction?.id], ['commute', 'cchub']);
    state = await ok('cancel', undefined, 'cancelled');
    assert.deepEqual([state.location, state.activeAction], ['home', null]);
    say('applied for Tech: hired as Intern', state, 'goal 3 +₦1,000 +1✨; automatic commute cancelled to stay home');

    // ---- goal 4: Buy → place a plastic chair --------------------------------------------------
    const chair = FURNITURE['plastic-chair'];
    assert.equal(view(state).home.prices['plastic-chair'], 500);
    const tile = findFreeSpot(HOUSES.yaba.grid, state.home.items, chair);
    const chairsBefore = state.home.items.filter((item) => item.itemId === 'plastic-chair').length;
    const chairBody = { actionId: nextId(), cityId: CITY, type: 'home.furniture-buy', payload: { item: 'plastic-chair', ...tile } };
    const bought = await send(chairBody);
    assert.deepEqual([bought.ok, bought.code], [true, 'bought']);
    state = bought.state;
    check(state, 98500, [100, 85, 70, 60, 100, 70], 'chair');
    assert.equal(state.home.items.filter((item) => item.itemId === 'plastic-chair').length, chairsBefore + 1);
    assert.deepEqual(state.ledger.slice(-2).map((entry) => [entry.amount, entry.reason]), [[-500, 'Bought Plastic Chair'], [1000, 'Goal: Buy something new']]);
    say('bought and placed a Plastic Chair', state, 'chair −₦500, goal 4 +₦1,000 +1✨');

    // ---- goal 5: Map → Danfo to Amala Shitta ---------------------------------------------------
    let trip = await travel('amala-shitta', 'danfo', 100, 'Danfo to Amala Shitta');
    state = trip.state;
    check(state, 99900, [100, 85, 70, 60, 100, 70], 'arrive Amala Shitta');
    assert.deepEqual([state.goals.stars, state.ledger.at(-1).reason, state.ledger.at(-2).reason], [5, 'Goal: Visit the buka', 'Danfo to Amala Shitta']);
    say(`Danfo Home → Amala Shitta (${trip.seconds}s)`, state, `fare −₦100 at departure, goal 5 +₦1,500 +1✨${trip.event ? `, ${trip.event}` : ''}`);

    // ---- a paid meal: start, cancel, then to completion ----------------------------------------
    assert.equal(state.spot, 'counter');
    state = await ok('activity', { id: 'buka-jollof' }, 'started');
    assert.equal(state.cash, 99900, 'nothing is charged when a paid activity starts');
    state = await ok('cancel', undefined, 'cancelled');
    check(state, 99900, [100, 85, 70, 60, 100, 70], 'meal cancelled');
    say('Jollof, Dodo & Chicken started, cancelled', state, 'wallet unchanged');
    await ok('activity', { id: 'buka-jollof' }, 'started');
    state = await wait(8);
    check(state, 99350, [100, 85, 80, 60, 100, 70], 'meal');
    assert.equal(state.ledger.filter((entry) => entry.reason === 'Jollof, Dodo & Chicken').length, 1, 'charged once');
    assert.ok(state.moodlets.some((moodlet) => moodlet.id === 'party-jollof'));
    say('Jollof, Dodo & Chicken to completion (8s)', state, 'meal −₦550 once, Fun +10, feeling Party Jollof');

    // ---- goal 6: make a friend (interim: a social activity at a venue) -------------------------
    await ok('spot', { id: 'kitchen' }, 'selected');
    await ok('activity', { id: 'buka-gist' }, 'started');
    state = await wait(8);
    check(state, 100850, [100, 85, 84, 72, 100, 70], 'gist');
    assert.deepEqual([state.goals.stars, state.ledger.at(-1).reason], [6, 'Goal: Make a new friend']);
    say('Gist with Mama (8s)', state, 'Social +12, Fun +4, goal 6 +₦1,500 +1✨');

    // ---- goal 7: travel to the workplace while it is open and work a shift ----------------------
    assert.equal(view(state).travel.destinations.find((item) => item.id === 'cchub').open, true);
    trip = await travel('cchub', 'danfo', 150, 'Danfo to CcHub');
    state = trip.state;
    check(state, 100700, [100, 85, 84, 72, 100, 70], 'arrive CcHub');
    await ok('spot', { id: 'work' }, 'selected');
    const shift = await ok('activity', { id: 'tech-shift' }, 'started');
    assert.equal(shift.cash, 100700, 'a shift pays on completion');
    state = await wait(shift.activeAction.duration);
    check(state, 106300, [88, 65, 84, 72, 100, 70], 'shift');
    shown = view(state);
    assert.deepEqual([shown.career.performance, state.completedShifts, state.goals.stars, state.goals.chain], [60, 1, 7, 7]);
    assert.deepEqual(state.ledger.slice(-2).map((entry) => [entry.amount, entry.reason]), [[3600, 'Tech shift'], [2000, 'Goal: Work a shift']]);
    say(`Danfo to CcHub (${trip.seconds}s), Tech shift (${shift.activeAction.duration}s)`, state, `fare −₦150, pay +₦3,600 in the ledger, performance 50→60%, goal 7 +₦2,000 +1✨${trip.event ? `, ${trip.event}` : ''}`);

    // ---- trek home; decline any roadside offer ---------------------------------------------------
    assert.equal(weatherAt(time + 20000, CITY).raining, false, 'the trek happens in dry weather');
    trip = await travel('home', 'trek', 0, 'Trek home');
    state = trip.state;
    check(state, 106300, [88, 55, 84, 72, 93, 70], 'trek home');
    say(`trek CcHub → Home (${trip.seconds}s)`, state, `Energy −10, Hygiene −7${trip.event ? `, ${trip.event}` : ', no roadside offer'}`);

    // ---- nap, wake early: the energy gained so far is kept -----------------------------------------
    await ok('spot', { id: 'bedroom' }, 'selected');
    await ok('activity', { id: 'nap' }, 'started');
    state = await wait(8);
    assert.equal(state.activeAction.id, 'nap');
    state = await ok('cancel', undefined, 'cancelled');
    check(state, 106300, [88, 71, 84, 72, 93, 70], 'nap woken early');
    say('nap, woken after 8 of 15 seconds', state, 'Energy +16 kept');

    // ---- cook Jollof: ingredients are used once, when the meal finishes ------------------------------
    await ok('spot', { id: 'kitchen' }, 'selected');
    const cooking = await ok('activity', { id: 'home-cook-jollof' }, 'started');
    assert.deepEqual([cooking.inventory.rice, cooking.inventory['tomato-paste'], cooking.inventory.seasoning, cooking.inventory['veg-oil']], [2, 2, 6, 4], 'nothing is used at the start');
    state = await wait(11);
    check(state, 106300, [100, 71, 84, 72, 93, 70], 'cook jollof');
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
    check(replay.state, 106300, [100, 71, 84, 72, 93, 70], 'replay');
    assert.equal(replay.state.home.items.filter((item) => item.itemId === 'plastic-chair').length, chairsBefore + 1);
    assert.equal(replay.state.ledger.filter((entry) => entry.reason === 'Bought Plastic Chair').length, 1);
    const conflict = await http('/api/action', { ...chairBody, payload: { item: 'velvet-sofa', ...tile } });
    assert.deepEqual([conflict.status, conflict.json.error], [409, 'action_id_conflict'], 'the same ID with different contents is rejected');
    say('replayed the chair purchase (same action ID)', replay.state, 'duplicate: no second charge, no second chair');

    // ---- Saturday: rent and the loan instalment are collected exactly once ---------------------------
    const saturday = Date.UTC(2026, 0, 9, 23, 0, 5); // Saturday 10 January 2026, 00:00:05 in Lagos
    assert.ok(saturday > time);
    time = saturday;
    state = await life();
    const bills = state.ledger.filter((entry) => /^(Rent|Loan repayment)/.test(entry.reason));
    assert.deepEqual(bills.map((entry) => [entry.amount, entry.reason]), [[-6000, 'Rent: Yaba self-contain (due Sat 10 Jan)'], [-12000, 'Loan repayment (due Sat 10 Jan)']]);
    // However long the player was away, one settlement applies at most four hours of need decay
    // (hunger 6, energy 4, fun 5, social 4, hygiene 3, bladder 8 points an hour).
    check(state, 88300, [76, 55, 64, 56, 81, 38], 'Saturday');
    assert.equal(view(state).economy.loan.left, 60000);
    say('Saturday 00:00: rent and loan instalment', state, 'rent −₦6,000 and loan −₦12,000, each with a ledger line; loan ₦60,000 left');
    await wait(3600);
    const later = await wait(86400); // Sunday
    assert.equal(later.ledger.filter((entry) => /^(Rent|Loan repayment)/.test(entry.reason)).length, 2, 'not collected again on later settlements that week');
    assert.equal(later.cash, 88300);
    const stale = await http('/api/action', chairBody);
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
    if (server?.listening) await halt();
    await rm(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFirstDay().catch((error) => { console.error(`\nFIRST DAY FAILED: ${error.message}`); process.exitCode = 1; });
}
