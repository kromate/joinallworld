#!/usr/bin/env node
/**
 * The scripted first minute: one brand-new player, from the landing screen's Play to a settled
 * life, against the real server.
 *
 *   node scripts/first-minute.mjs        (also run by server/first-minute.test.js under `npm test`)
 *
 * Starts the server in-process on an ephemeral port with a temporary data directory and a clock
 * this script controls, then drives one device session over HTTP exactly as the browser does
 * (POST /api/session, GET /api/life, POST /api/action). Every step asserts what the server answered
 * and prints one transcript line; the timings are SERVER time, read from the life the server
 * returned (state.onboarding.bornAt / playedAt / firstAt / completedAt).
 *
 * What it proves, in order:
 *   1. a new session is a guest that accepts nothing until Play, and Play is exactly once
 *   2. the guest stands in Freedom Park and the first goal is a free, seconds-long activity there
 *   3. the first reward lands inside the first minute, and settling in is then OFFERED (the client's
 *      own rule, src/quick-start/model.js nextNudge, fed with the server's state)
 *   4. play goes on without settling: two more activities and a trip; Home is refused with the
 *      one-tap explanation and nothing home-shaped exists (no rent house, no loan, no furniture stocked)
 *   5. settling in fires 'life.started' exactly once: the home with its furniture and kitchen, the rent
 *      schedule and the lottery outcome are created then, and a repeat is refused
 *   6. the totals equal the old flow's: the start cash line is the same amount the old enforced flow
 *      granted for that outcome and home (checked against a control life played the old way through
 *      the rules engine), and everything earned or spent as a guest is still there — nothing lost,
 *      nothing counted twice
 *   7. a reload, and a restart of the server on the same data, return the identical life
 *
 * The engine is imported only to read derived display data from states the server returned, to
 * check that reloading a returned state changes nothing, to play the control life of step 6, and to
 * COUNT 'life.started': this process is the server, so the script wraps one listener of that event
 * (the economy's) for the length of the run and asserts it was called once, with the agreed payload.
 * Random outcomes are keyed with a salt this process (which IS the server here) fixes through the
 * test-only hook in server/life-service.js, so the run is the same every time.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/server.js';
import { useSaltSourceForTests } from '../server/life-service.js';
import { createLife, viewLife, dispatch } from '../src/life.ts';
import { systems } from '../src/game/registry.ts';
import { weatherAt } from '../src/game/systems/health.ts';
import { LOTTERY } from '../src/game/content/traits.ts';
import { STARTER_GOALS } from '../src/game/content/goals.ts';
import { EVENTS } from '../src/game/content/events.ts';
import { nextNudge, nudgeMemory, nudged, funnelSnap, funnelEvents } from '../src/quick-start/model.ts';
import { presetLook } from '../src/quick-start/look-model.ts';

const CITY = 'lagos';
/** The local government picked at settle-in: the free starter house stands on a plot there. */
const LGA = 'ikeja';
const NEEDS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'];
const naira = (value) => `₦${value.toLocaleString('en-NG')}`;
export const FIRST_MINUTE_SALT = 'first-minute-salt-0001';
/** How long the scripted player takes on the landing screen before tapping Play (the measured UI run is in the report). */
const LANDING_SECONDS = 4;

/** Monday 5 January 2026, 10:00 in Lagos, moved forward to a dry stretch (a trek in the rain would change the needs). */
function dryMondayMorning() {
  let start = Date.UTC(2026, 0, 5, 9);
  while ([0, 1, 2].some((block) => weatherAt(start + block * 20 * 60000, CITY).raining)) start += 20 * 60000;
  return start;
}

export async function runFirstMinute({ log = console.log, salt = FIRST_MINUTE_SALT } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'allworld-first-minute-'));
  let time = dryMondayMorning();
  const landedAt = time;
  let server, base, cookie, ids = 0, step = 0;
  const serverOptions = { dataDir, now: () => time, distDir: join(dataDir, 'no-dist') };
  async function boot() { server = await createServer(serverOptions); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; }
  async function halt() { server.closeAllConnections(); await new Promise((done) => server.close(done)); await server.store.close(); }
  async function http(path, body) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
    return { status: response.status, headers: response.headers, json: await response.json() };
  }
  const nextId = () => `${time}:00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
  /** Every state the server returns must survive a reload unchanged. */
  const stable = (state, what) => { assert.deepEqual(createLife(structuredClone(state), { now: time, cityId: CITY }), state, `${what}: reloading the returned state changes nothing`); return state; };
  // The funnel as the browser reports it: from one server state to the next.
  const funnel = [];
  let seen = funnelSnap(null);
  const watch = (state) => { const now = funnelSnap(state); for (const event of funnelEvents(seen, now)) funnel.push({ name: event.name, at: time - landedAt }); seen = now; return state; };
  async function send(body) {
    const { status, json } = await http('/api/action', body);
    assert.equal(status, 200, `${body.type}: HTTP ${status} ${JSON.stringify(json)}`);
    stable(json.state, body.type); watch(json.state);
    return json;
  }
  const action = (type, payload) => send({ actionId: nextId(), cityId: CITY, type, ...(payload ? { payload } : {}) });
  async function ok(type, payload, code) {
    const result = await action(type, payload);
    assert.equal(result.ok, true, `${type} was refused: ${result.code} — ${result.state.message}`);
    if (code) assert.equal(result.code, code, type);
    return result.state;
  }
  const life = async () => watch(stable((await http(`/api/life?city=${CITY}`)).json.state, 'GET /api/life'));
  async function wait(seconds) { time += seconds * 1000; return life(); }
  const view = (state) => viewLife(createLife(state, { now: time, cityId: CITY }), { now: time, cityId: CITY });
  const secs = (ms) => `${(ms / 1000).toFixed(0)}s`;
  const say = (title, state, note = '') => log(`${String(++step).padStart(2, '0')}  +${secs(time - landedAt).padStart(4)}  ${title.padEnd(44)} ${naira(state.cash).padStart(8)}  ${note}`);
  async function activity(spot, id, seconds) {
    if (spot) await ok('spot', { id: spot }, 'selected');
    const started = await ok('activity', { id }, 'started');
    assert.equal(started.activeAction.duration, seconds, `${id} takes ${seconds} seconds`);
    return wait(seconds);
  }

  // Count 'life.started' as the server's own rules engine delivers it (see the header).
  const economy = systems().find((system) => system.id === 'economy'), original = economy.on['life.started'];
  const startedEvents = [];
  economy.on['life.started'] = (life, data, ctx) => { startedEvents.push(structuredClone(data)); return original(life, data, ctx); };

  try {
    await boot();
    log(`First minute · the player lands at ${new Date(time).toISOString()} (server clock; Monday morning in Lagos, dry). Times are seconds since landing.`);

    // ---- 1. landing → Play: a session, then the look, exactly once --------------------------------
    time += LANDING_SECONDS * 1000; // the landing screen: a name is suggested, a character is shown, Play is tapped
    const opened = await http('/api/session', { name: 'Sunny Tobi', onboarding: true });
    assert.equal(opened.status, 200);
    cookie = opened.headers.get('set-cookie').split(';')[0];
    useSaltSourceForTests(() => salt);
    let state = await life();
    assert.deepEqual([state.onboarding.stage, state.onboarding.required, state.onboarding.bornAt, state.cash, state.location], ['guest', true, time, 5000, 'park']);
    const held = await action('activity', { id: 'play-ayo' });
    assert.deepEqual([held.ok, held.code], [false, 'onboarding_required'], 'nothing is accepted before Play');
    const look = presetLook('street');
    const play = { actionId: nextId(), cityId: CITY, type: 'onboarding.quick-start', payload: { look } };
    const [first, second] = await Promise.all([send(play), send(play)]); // a double tap
    assert.deepEqual([first.code, second.code, [first.duplicate, second.duplicate].filter(Boolean).length], ['playing', 'playing', 1], 'a double tap on Play is one start');
    state = await life();
    assert.deepEqual([state.onboarding.required, state.onboarding.stage, state.onboarding.playedAt - state.onboarding.bornAt, state.location, state.spot, state.name], [false, 'guest', 0, 'park', 'trees', 'Sunny Tobi']);
    assert.deepEqual(NEEDS.map((need) => state.needs[need]), [80, 85, 70, 60, 75, 70]);
    let shown = view(state);
    assert.deepEqual([shown.goals.chip.kind, shown.goals.chip.title, shown.goals.chip.go, shown.goals.chip.activity, shown.goals.chip.reward], ['goal', 'Play a round of Ayo', ['park', 'trees'], 'play-ayo', '+₦500 +1✨']);
    const regulars = shown.social.here.map((npc) => npc.name);
    assert.ok(regulars.length >= 2, 'the park has regulars to meet');
    say('Play: Sunny Tobi is in Freedom Park, a guest', state, `two requests (session, look); regulars here: ${regulars.join(', ')}; first goal “${shown.goals.chip.title}”`);

    // ---- 2. the first activity and the first reward -------------------------------------------------
    time += 2000; // one tap on the highlighted card
    state = await activity(null, 'play-ayo', 7);
    assert.deepEqual([state.cash, state.goals.stars, state.ledger.at(-1).reason, state.ledger.at(-1).amount], [5500, 1, 'Goal: Play a round of Ayo', 500]);
    const toFirst = state.onboarding.firstAt - landedAt, serverToFirst = state.onboarding.firstAt - state.onboarding.bornAt;
    assert.ok(toFirst <= 60000, `the first reward is inside the first minute (${secs(toFirst)})`);
    assert.deepEqual([toFirst, serverToFirst], [(LANDING_SECONDS + 2 + 7) * 1000, 9000]);
    say('Play Ayo under the trees (7s) → first reward', state, `+₦500 +1✨, Fun +8, Social +8 · ${secs(toFirst)} after landing, ${secs(serverToFirst)} after the session was made`);

    // ---- 3. settling in is offered, not forced -------------------------------------------------------
    const day = Math.floor((time + 3600000) / 86400000);
    let memory = nudgeMemory(null);
    const offer = () => nextNudge({ guest: view(state).onboarding.guest, activities: state.onboarding.activities, firstAt: state.onboarding.firstAt, busy: Boolean(state.activeAction), day }, memory);
    assert.equal(offer(), 'first-reward');
    memory = nudged(memory, 'first-reward', day);
    assert.equal(offer(), null, 'offered once; play is never blocked');
    shown = view(state);
    assert.deepEqual([shown.goals.chip.title, shown.onboarding.guest, shown.onboarding.step], ['Say hello to someone', true, 1]);
    say('“Make this life yours” is offered — Not now', state, 'the sheet opens once after the first reward; the guest keeps playing');

    // ---- 4. play goes on without settling: two more activities and a trip -----------------------------
    const regular = shown.social.here[0];
    state = await activity('people', `npc-${regular.id}-hello`, 6);
    assert.deepEqual([state.cash, state.goals.stars, state.ledger.at(-1).reason, view(state).goals.chip.title], [6000, 2, 'Goal: Say hello to someone', 'Settle in']);
    say(`Say Hello to ${regular.name} (6s)`, state, 'goal 2 +₦500 +1✨; the goal chip now reads “Settle in”');
    state = await activity('trees', 'chill', 11);
    assert.deepEqual([state.cash, state.onboarding.activities], [6000, 3]);
    assert.equal(offer(), 'third-activity', 'after the third activity it is offered once more');
    memory = nudged(memory, 'third-activity', day);
    say('Chill Under the Trees (11s)', state, 'third activity: settling in is offered a second time, and again declined');
    const home = await action('travel', { id: 'home', mode: 'trek' });
    assert.deepEqual([home.ok, home.code], [false, 'settle_required']);
    assert.match(home.state.message, /^Settle in to get your home/);
    const fare = view(state).travel.destinations.find((item) => item.id === 'amala-shitta')?.modes?.find((mode) => mode.id === 'danfo')?.fare ?? 200;
    const started = await ok('travel', { id: 'amala-shitta', mode: 'danfo' }, 'started');
    assert.deepEqual([fare, started.cash], [200, 6000 - fare], 'the Danfo fare from the Island is charged at departure');
    state = await wait(started.activeAction.duration);
    if (state.travel.event) { assert.ok(EVENTS[state.travel.event.id]); state = await ok('world.roadside', { choice: view(state).travel.event.choices.at(-1).id }, 'resolved'); }
    assert.deepEqual([state.location, state.cash, state.onboarding.stage], ['amala-shitta', 5800, 'guest']);
    assert.deepEqual([state.economy.rent.house, state.economy.loan, state.economy.billedWeek, state.economy.started, state.home.stocked, state.inventory], [null, null, null, false, false, {}], 'a guest has nothing the economy takes as settled');
    const guestNet = state.cash - 5000; // +₦1,000 in goals, −₦200 fare
    assert.equal(guestNet, 800);
    say(`Home refused (“Settle in to get your home”); Danfo to Amala Shitta (${started.activeAction.duration}s)`, state, 'fare −₦200; still a guest: no rent house, no loan, no kitchen');

    // ---- 5. settling in: life.started exactly once ----------------------------------------------------
    assert.equal((await action('onboarding.home', { lga: LGA })).code, 'step_required', 'the deferred steps are still validated in order');
    assert.equal((await action('estate.set-lga', { lga: LGA })).code, 'settle_required', 'a guest cannot take a local government (and its free house) without settling in');
    assert.equal((await action('onboarding.traits', { traits: ['musical'] })).code, 'invalid_traits');
    await ok('onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }, 'traits_saved');
    await ok('onboarding.dream', { dream: 'yaba-unicorn' }, 'dream_saved');
    const rolled = await ok('onboarding.lottery', {}, 'rolled');
    const outcome = LOTTERY[rolled.onboarding.lottery.id];
    const stars = rolled.goals.stars, before = rolled.cash;
    const move = { actionId: nextId(), cityId: CITY, type: 'onboarding.home', payload: { lga: LGA, via: 'manual', stay: true } };
    const moved = await send(move);
    assert.deepEqual([moved.ok, moved.code], [true, 'life_started']);
    state = moved.state;
    const again = await send(move);
    assert.deepEqual([again.duplicate, again.code, again.state.cash], [true, 'life_started', state.cash], 'the same request again is the same answer');
    assert.equal((await action('onboarding.home', { lga: LGA })).code, 'already_onboarded', 'a second move-in is refused');
    state = await life();
    assert.equal(startedEvents.length, 1, "'life.started' fired exactly once: not on the replay, not on the refused second move-in");
    assert.deepEqual(Object.keys(startedEvents[0]).sort(), ['body', 'dream', 'house', 'lga', 'loan', 'look', 'lottery', 'own', 'rent', 'startCash', 'traits', 'via'], 'with the payload other systems expect');
    assert.deepEqual([startedEvents[0].body, startedEvents[0].traits, startedEvents[0].dream, startedEvents[0].lottery, startedEvents[0].house, startedEvents[0].rent, startedEvents[0].startCash, startedEvents[0].loan, startedEvents[0].lga, startedEvents[0].via, startedEvents[0].own],
      [look.body, ['musical', 'tech-bro-or-sis'], 'yaba-unicorn', outcome.id, null, 0, outcome.ownCash, outcome.loan ? { ...outcome.loan } : null, LGA, 'manual', true]);
    // What 'life.started' does, each of its listeners exactly once:
    const startLines = state.ledger.filter((entry) => entry.reason.startsWith('Start cash'));
    assert.equal(startLines.length, 1, 'one start-cash line');
    assert.equal(state.ledger.filter((entry) => entry.reason === 'Goal: Settle in').length, 1, 'the Settle in goal paid once');
    assert.deepEqual([state.onboarding.done, state.onboarding.stage, state.onboarding.house, state.onboarding.completedAt, state.location], [true, 'settled', null, time, 'amala-shitta'], 'moved in without leaving the buka');
    assert.deepEqual([state.estate.lga, state.estate.lgaConfirmed, state.estate.lgaVia, state.estate.living, state.estate.tier, state.economy.rent.house, state.economy.started], [LGA, true, 'manual', 'own', 'starter', null, true], 'the local government and the own starter house are recorded; no rent house');
    const mine = (await http(`/api/world/me?city=${CITY}`)).json;
    assert.deepEqual([mine.placed, mine.lga, mine.plot?.lga], [true, LGA, LGA], 'the server set a plot aside in that local government');
    state = await life();
    assert.deepEqual(state.estate.plot, mine.plot);
    assert.ok(state.home.items.length > 0 && state.home.stocked && Object.keys(state.inventory).length > 0, 'the home has its starter furniture and kitchen');
    shown = view(state);
    assert.deepEqual([Boolean(shown.economy.loan), state.goals.dream, state.goals.stars], [Boolean(outcome.loan), 'yaba-unicorn', stars + 1]);
    if (outcome.loan) assert.deepEqual([shown.economy.loan.left, shown.economy.loan.weekly], [outcome.loan.owed, outcome.loan.weekly]);
    assert.deepEqual(shown.goals.chip.title, 'Eat something', 'the home goals follow');
    say(`settled in: ${outcome.label}, own starter house in ${shown.estate.lga.name}`, state, `'life.started' once · furniture ${state.home.items.length} pieces · ${shown.estate.plot.address} · no rent${outcome.loan ? ` · loan ${naira(outcome.loan.owed)}` : ''}`);

    // ---- 6. totals equal the old flow's ---------------------------------------------------------------
    // The control: the same outcome and home played the old way (create → look → traits → dream → lottery → home,
    // nothing in between), through the rules engine. Its move-in is what the old enforced flow gave.
    const fired = startedEvents.length;
    let control = createLife(null, { now: landedAt, cityId: CITY, isNew: true });
    const run = (type, payload, actionId) => dispatch(control, { type, payload, actionId }, { now: landedAt, cityId: CITY, actionId });
    run('onboarding.look', { look }, 'c-look'); run('onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }, 'c-traits'); run('onboarding.dream', { dream: 'yaba-unicorn' }, 'c-dream');
    for (let i = 0; i < 5000 && control.onboarding.lottery?.id !== outcome.id; i++) { control.onboarding.lottery = null; run('onboarding.lottery', {}, `c-roll-${i}`); }
    assert.equal(control.onboarding.lottery.id, outcome.id);
    assert.equal(run('onboarding.home', { lga: LGA, via: 'manual' }, 'c-home').code, 'life_started');
    assert.deepEqual(startedEvents.at(-1), startedEvents[0], 'the old flow emits the very same event');
    startedEvents.length = fired; // the control's own event is not the server's
    const oldGrant = control.ledger.find((entry) => entry.reason.startsWith('Start cash'));
    assert.deepEqual([startLines[0].amount, startLines[0].reason], [oldGrant.amount, oldGrant.reason], 'the same start-cash ledger line as the old flow');
    assert.equal(control.cash, outcome.ownCash, 'the control starts with the outcome’s start cash for the own house');
    const settleGoal = STARTER_GOALS.find((goal) => goal.id === 'settle-in').cash;
    assert.equal(state.cash, control.cash + guestNet + settleGoal, 'old start cash + what the guest earned and spent + the Settle in goal: minus nothing, plus nothing');
    assert.equal(state.cash, before + oldGrant.amount + settleGoal);
    assert.equal(5000 + state.ledger.reduce((sum, entry) => sum + entry.amount, 0), state.cash, 'the ledger explains the whole balance');
    assert.deepEqual([state.estate.lga, state.estate.living, state.economy.rent.house, state.economy.loan, state.home.items.map((item) => item.itemId), state.inventory],
      [control.estate.lga, control.estate.living, control.economy.rent.house, control.economy.loan, control.home.items.map((item) => item.itemId), control.inventory], 'the same house, no rent, the same loan, furniture and kitchen as the old flow');
    for (const [skill, level] of Object.entries(outcome.skills || {})) assert.ok(view(state).skills[skill].level >= level, `${skill} starts at level ${level} or better`);
    assert.ok(state.social.rel[regular.id], 'the regular met as a guest is still known');
    assert.deepEqual(state.onboarding.look, control.onboarding.look, 'the look chosen on the landing screen');
    say('totals match the old flow', state, `old start ${naira(control.cash)} + guest ${guestNet >= 0 ? '+' : '−'}${naira(Math.abs(guestNet))} + Settle in +${naira(settleGoal)} = ${naira(state.cash)}`);

    // ---- 7. reload: identical, also from a restarted server ---------------------------------------------
    const beforeReload = await life();
    assert.deepEqual(await life(), beforeReload, 'reading again changes nothing');
    await halt(); await boot();
    assert.deepEqual(await life(), beforeReload, 'the life read back from disk by a new server process is identical');
    const replay = await send(play);
    assert.deepEqual([replay.duplicate, replay.code, replay.state.cash], [true, 'playing', beforeReload.cash], 'Play sent again after the restart is still the first Play');
    say('reload (server restarted on the same data)', beforeReload, 'identical state; the kept Play request replays as a duplicate');

    const settled = state.onboarding.completedAt - landedAt;
    assert.equal(startedEvents.length, 1, "still one 'life.started' after the reload and the replay");
    assert.deepEqual(funnel.map((event) => event.name), ['arrived', 'first_activity_started', 'first_activity_completed', 'settle_traits_done', 'settle_dream_done', 'settle_lottery_done', 'save_character_done']);
    log('');
    log('Funnel (server state → jaw:track), seconds since landing:');
    for (const event of funnel) log(`    ${secs(event.at).padStart(4)}  ${event.name}`);
    log('');
    log('Ledger:');
    for (const entry of state.ledger) log(`    ${(entry.amount > 0 ? '+' : '−') + naira(Math.abs(entry.amount))}`.padEnd(14) + ` ${entry.reason}`.padEnd(62) + naira(entry.balance).padStart(9));
    log(`First minute complete: ${step} steps. First reward ${secs(toFirst)} after landing (${secs(serverToFirst)} of server time from the session); settled in at ${secs(settled)}; wallet ${naira(state.cash)}.`);
    return { steps: step, cash: state.cash, firstRewardMs: toFirst, serverFirstRewardMs: serverToFirst, settledMs: settled, outcome: outcome.id, lga: LGA, funnel };
  } finally {
    economy.on['life.started'] = original;
    useSaltSourceForTests();
    if (server?.listening) await halt();
    await rm(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFirstMinute().catch((error) => { console.error(`\nFIRST MINUTE FAILED: ${error.message}`); process.exitCode = 1; });
}
