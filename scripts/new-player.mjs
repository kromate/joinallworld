#!/usr/bin/env node
/**
 * The new-player journey: the merged game, end to end, against the real server.
 *
 *   npm run new-player
 *
 * Two brand-new device sessions, driven over HTTP and WebSockets exactly as the browser drives them, on a clock this
 * script controls. Nothing here reaches into the rules engine to change state; the engine is imported only to read
 * derived display data (the goal line, missions, the banner words) from states the server returned.
 *
 *   Ada   lands, taps Play, plays a round of Ayo, is rewarded, says hello, settles in WITH HER LOCAL GOVERNMENT (picked
 *         from the list), is given the free starter house on a plot there (it is in that local government's estate
 *         listing and directory), eats and freshens up at home, sees her daily missions, finishes one and collects it,
 *         goes to the buka and makes a share link that invites a friend to the Whot table there.
 *   Bola  opens that link as a crawler would (the preview page: Open Graph tags, no script), follows it, taps Play and
 *         lands in the buka beside Ada — one banner, no welcome line beside it — with the referral attached.
 *   Both  sit at the table the link named and play a whole game of Whot against each other over their own sockets.
 *   Then  the referral pays both sides, and only after Bola has been paid for real work on real Lagos days.
 *   Last  the server is stopped and started again on the same data: every life, plot and record reads back identical.
 *
 * Every step asserts what it claims and prints one transcript line. `runNewPlayer({ log })` is also run by
 * server/new-player.test.js.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServer } from '../server/server.js';
import { useSaltSourceForTests } from '../server/life-service.js';
import { createLife, viewLife } from '../src/life.js';
import { lagosTime } from '../src/game/clock.js';
import { EVENTS } from '../src/game/content/events.js';
import { NPCS } from '../src/game/content/npcs.js';
import { HELPER_COOLDOWN_SECONDS } from '../src/game/content/jobs.js';
import { REFERRAL, TABLE_REWARDS } from '../src/game/content/growth.js';
import { MISSION_REWARDS } from '../src/game/content/missions.js';
import { STARTER_GOALS } from '../src/game/content/goals.js';
import { venueLabel } from '../src/game/content/venues.js';
import { joinIdFrom, linkParts, joinBanner, GIFT_LINE } from '../src/quick-start/model.js';
import { presetLook } from '../src/quick-start/look-model.js';
import { tableById } from '../src/tables/places.js';

const CITY = 'lagos', ORIGIN = 'https://play.example';
const HOUR = 3600000, DAY = 24 * HOUR;
const naira = (value) => `₦${value.toLocaleString('en-NG')}`;
/** Saturday 3 January 2026, 10:00 in Lagos. */
const START = Date.UTC(2026, 0, 3, 9);
/** Where Ada settles: the local government she picks from the list. */
const LGA = 'ikeja';
/** The table the share link invites to (src/tables/places.js): the corner table at the buka. */
const TABLE = 'buka-corner';
export const SALT_PREFIX = 'new-player-salt';

export async function runNewPlayer({ log = console.log, saltPrefix = SALT_PREFIX } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'joinallworld-new-player-'));
  let time = START, step = 0, ids = 0, lives = 0, server = null, base = '';
  useSaltSourceForTests(() => `${saltPrefix}-${String(lives++).padStart(4, '0')}`);
  const sockets = [], heard = [];
  async function boot() {
    server = await createServer({ dataDir, now: () => time, distDir: join(dataDir, 'no-dist'), publicOrigin: ORIGIN, env: {}, log: () => {} });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function halt() {
    for (const ws of sockets.splice(0)) ws.terminate();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }

  const say = (title, note = '') => log(`${String(++step).padStart(2, '0')}  ${title.padEnd(66)}${note ? `· ${note}` : ''}`);
  const nextId = () => `${time}:00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
  async function http(path, body, who) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(who ? { Cookie: who.cookie } : {}) } });
    const json = await response.json();
    heard.push(json);
    return { status: response.status, headers: response.headers, ...json };
  }
  const get = (path, who) => http(path, null, who);
  const post = (path, body, who) => http(path, body, who);
  const life = async (who) => (await get(`/api/life?city=${CITY}`, who)).state;
  async function act(who, type, payload) {
    const result = await post('/api/action', { actionId: nextId(), cityId: CITY, type, ...(payload ? { payload } : {}) }, who);
    assert.equal(result.status, 200, `${type}: HTTP ${result.status} ${result.error ?? ''}`);
    return result;
  }
  async function ok(who, type, payload, code) {
    const result = await act(who, type, payload);
    assert.equal(result.ok, true, `${who.name} ${type} was refused: ${result.code} — ${result.reason}`);
    if (code) assert.equal(result.code, code, `${who.name} ${type}`);
    return result.state;
  }
  const view = (state) => viewLife(createLife(state, { now: time, cityId: CITY }), { now: time, cityId: CITY });
  const wait = (ms) => { time += ms; };
  const reasons = (state, prefix) => state.ledger.filter((line) => line.reason.startsWith(prefix)).map((line) => [line.amount, line.reason]);
  const hello = (who) => post('/api/growth/hello', { cityId: CITY, device: who.device }, who);

  /** Stand at a spot and run one activity to its end. */
  async function run(who, spot, id) {
    if ((await life(who)).spot !== spot) await ok(who, 'spot', { id: spot }, 'selected');
    const started = await ok(who, 'activity', { id }, 'started');
    wait(started.activeAction.duration * 1000);
    return life(who);
  }
  /** Travel and wait out the trip. A roadside event on arrival is answered with its last choice (never costs money). */
  async function travel(who, id, mode = 'danfo') {
    const started = await ok(who, 'travel', { id, mode }, 'started');
    wait(started.activeAction.duration * 1000);
    let state = await life(who);
    assert.equal(state.location, id, `${who.name} arrived at ${id}`);
    if (state.travel.event) { assert.ok(EVENTS[state.travel.event.id]); state = await ok(who, 'world.roadside', { choice: view(state).travel.event.choices.at(-1).id }, 'resolved'); }
    return state;
  }
  /** One paid Community helper shift at Freedom Park: a Lagos day of paid work. */
  async function paidWork(who) {
    if ((await life(who)).location !== 'park') await travel(who, 'park', 'trek');
    if (!(await life(who)).job) await ok(who, 'apply-job', { id: 'community-helper' }, 'applied');
    return run(who, 'work', 'helper-shift');
  }

  /** A socket as the browser opens it: the session cookie and a same-origin Origin header. */
  async function socket(who) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket', { headers: { Cookie: who.cookie, Origin: base } });
    sockets.push(ws);
    const peer = { who, ws, state: null, errors: [], all: [], waiting: [], presence: null };
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      peer.all.push(message); heard.push(message);
      if (message.type === 'table-state') peer.state = message;
      if (message.type === 'presence') peer.presence = message;
      if (message.type === 'error') peer.errors.push(message);
      if (message.type === 'tables') for (const done of peer.waiting.splice(0)) done();
    });
    await once(ws, 'open');
    return peer;
  }
  const send = (peer, type, body = {}) => peer.ws.send(JSON.stringify({ type, cityId: CITY, table: TABLE, ...body }));
  /** Wait until the server has handled everything this socket sent (messages of one socket are handled in order). */
  const settled = (peer) => new Promise((done) => { peer.waiting.push(done); peer.ws.send(JSON.stringify({ type: 'table-list', cityId: CITY })); });
  const tell = async (peer, type, body, ...others) => { send(peer, type, body); for (const one of [peer, ...others]) await settled(one); return peer.state; };
  async function joinRoom(peer, venueId) {
    peer.presence = null;
    peer.ws.send(JSON.stringify({ type: 'join', cityId: CITY, venueId }));
    for (let i = 0; i < 100 && !peer.presence; i++) await new Promise((done) => setTimeout(done, 10));
    assert.ok(peer.presence, `${peer.who.name} joined the ${venueId} room`);
    return peer.presence;
  }

  /** What the landing screen does when Play is tapped: a session for the name, then the look, confirmed exactly once. */
  async function play(name, { preset, joining = false, device }) {
    const opened = await post('/api/session', { name, onboarding: true });
    assert.equal(opened.status, 200);
    const who = { name, cookie: opened.headers.get('set-cookie').split(';')[0], id: opened.session.id, device };
    assert.notEqual(who.id, who.cookie.slice(4), 'the public id is not the cookie');
    const held = await life(who);
    assert.deepEqual([held.onboarding.stage, held.onboarding.required, held.location], ['guest', true, 'park']);
    assert.equal((await act(who, 'spot', { id: 'trees' })).code, 'onboarding_required', 'nothing can be done before Play');
    const request = { actionId: nextId(), cityId: CITY, type: 'onboarding.quick-start', payload: { look: presetLook(preset), ...(joining ? { joining: true } : {}) } };
    const first = await post('/api/action', request, who), again = await post('/api/action', request, who);
    assert.deepEqual([first.code, again.code, again.duplicate], ['playing', 'playing', true], 'a double tap on Play is one start');
    // The HUD's inbox chip reads the social overview as soon as the player is in the city (that is what makes them findable).
    assert.equal((await get('/api/social/me', who)).me.name, name);
    return { who, state: first.state };
  }

  try {
    await boot();
    log(`New player · server clock starts ${new Date(time).toISOString()} (Sat 10:00 in Lagos) · public origin ${ORIGIN}`);

    // ---- 1. landing → Play: in the park in two requests, a guest with one line of guidance ---------------------------------
    const landedAt = time;
    wait(4000); // looks at the suggested name and character, taps Play
    const { who: ada, state: arrived } = await play('Ada', { preset: 'owambe', device: 'device-ada-0000000001' });
    let state = arrived, shown = view(state);
    assert.deepEqual([state.location, state.spot, state.onboarding.stage, state.onboarding.required, state.cash, state.message], ['park', 'trees', 'guest', false, 5000, 'Welcome to Freedom Park, Ada.']);
    assert.deepEqual([shown.goals.chip.kind, shown.goals.chip.title, shown.goals.chip.step, shown.goals.chip.of, shown.goals.chip.go, shown.goals.chip.activity], ['goal', 'Play a round of Ayo', 1, 10, ['park', 'trees'], 'play-ayo']);
    // A guest's first minutes: no missions yet, no local government, no house, no place in any directory.
    assert.match(shown.missions.locked, /Missions open once you have settled in/);
    assert.deepEqual([shown.missions.daily.length, shown.estate.placed, state.estate.plot, state.economy.rent.house], [0, false, null, null]);
    assert.deepEqual([(await get(`/api/world/me?city=${CITY}`, ada)).placed, (await get(`/api/civic/pulse?city=${CITY}`, ada)).checkedIn], [false, false]);
    assert.equal((await act(ada, 'estate.set-lga', { lga: LGA })).code, 'settle_required');
    say('Ada lands and taps Play: a guest in Freedom Park', `${(time - landedAt) / 1000}s after landing · one goal line: “Play a round of Ayo” · no missions, no house, in no directory yet`);

    // ---- 2. the first goal: a round of Ayo, and only that ---------------------------------------------------------------
    state = await run(ada, 'trees', 'chill');
    assert.equal(state.goals.chain, 0, 'another pastime is not the first goal');
    state = await run(ada, 'trees', 'play-ayo');
    assert.deepEqual([state.goals.chain, state.cash, state.goals.stars, state.ledger.at(-1).reason], [1, 5500, 1, 'Goal: Play a round of Ayo']);
    say('Play Ayo under the trees → the first reward', `+₦500 +1✨ ${Math.round((state.onboarding.firstAt - landedAt) / 1000)}s after landing; chilling first did not count as the goal`);

    // ---- 3. say hello, then settle in with a local government picked from the list ----------------------------------------
    const regular = Object.values(NPCS).find((npc) => npc.venue === 'park');
    state = await run(ada, 'people', `npc-${regular.id}-hello`);
    assert.deepEqual([state.goals.chain, view(state).goals.chip.title, view(state).goals.chip.open], [2, 'Settle in', 'onboarding']);
    await ok(ada, 'onboarding.traits', { traits: ['smooth-talker', 'clean-pikin'] }, 'traits_saved');
    await ok(ada, 'onboarding.dream', { dream: 'everybodys-padi' }, 'dream_saved');
    const rolled = await ok(ada, 'onboarding.lottery', {}, 'rolled');
    const outcome = view(rolled).onboarding.lottery, own = view(rolled).onboarding.own;
    assert.equal((await act(ada, 'onboarding.home', {})).code, 'lga_required', 'settling in needs a local government');
    const before = rolled.cash;
    state = await ok(ada, 'onboarding.home', { lga: LGA, via: 'manual' }, 'life_started');
    assert.deepEqual([state.location, state.onboarding.stage, state.estate.lga, state.estate.lgaConfirmed, state.estate.lgaVia, state.estate.living, state.estate.tier, state.economy.rent.house],
      ['home', 'settled', LGA, true, 'manual', 'own', 'starter', null]);
    assert.equal(state.cash, own.startCash + (before - 5000) + 1000, 'the birth lottery’s start cash for the own house, what she earned as a guest, and the Settle in goal');
    assert.equal(state.goals.chain, 3);
    // The server sets a plot aside for her in that local government and files the house in its registry.
    const mine = await get(`/api/world/me?city=${CITY}`, ada);
    assert.deepEqual([mine.placed, mine.lga, mine.plot?.lga], [true, LGA, LGA]);
    state = await life(ada);
    assert.deepEqual(state.estate.plot, mine.plot, 'the plot is recorded in her life');
    const address = view(state).estate.plot.address;
    const page = await get(`/api/world/lga/${LGA}/estate/${mine.plot.estate}/houses?city=${CITY}`, ada);
    const house = page.houses.find((item) => item.id === ada.id);
    assert.ok(house && house.you === true && house.p === mine.plot.plot && house.name === 'Ada', 'her house is in that estate’s listing, on her plot, under her name');
    assert.equal(page.houses.length, 1, 'the only house in the estate so far');
    const estates = await get(`/api/world/lga/${LGA}/estates?city=${CITY}`, ada), area = await get(`/api/world/lga/${LGA}?city=${CITY}`, ada);
    assert.deepEqual([area.yours, area.residents, area.houses], [true, 1, 1]);
    assert.equal(estates.status, 200, 'the estates page of her local government answers');
    const directory = await get(`/api/world/lga/${LGA}/people?city=${CITY}`, ada);
    assert.deepEqual(directory.items.map((item) => [item.id, item.name, item.home, item.estate, item.plot]), [[ada.id, 'Ada', 'own', mine.plot.estate, mine.plot.plot]], 'and she is in the residents directory of her local government, living in her own house');
    assert.equal((await get(`/api/civic/pulse?city=${CITY}`, ada)).checkedIn, true, 'a resident now');
    say(`Say hello to ${regular.name}; settle in: ${outcome.label}, own starter house in ${view(state).estate.lga.name}`, `${naira(state.cash)} · ${address} · no rent${state.economy.loan ? ` · loan ${naira(state.economy.loan.left)}` : ''} · goals 1–3 paid`);

    // ---- 4. eat and freshen up at home ---------------------------------------------------------------------------------
    state = await run(ada, 'kitchen', 'home-soak-garri');
    assert.equal(state.ledger.at(-1).reason, 'Goal: Eat something');
    state = await run(ada, 'bathroom', 'bath');
    assert.deepEqual([state.ledger.at(-1).reason, state.goals.chain, view(state).goals.chip.title], ['Goal: Freshen up', 5, 'Get a job']);
    say('Eat from the cooler and take a bucket bath at home', `goals 4 and 5 paid (${naira(state.cash)}); next: “Get a job”`);

    // ---- 5. daily missions: dealt when she settled in; she finishes one and collects it ------------------------------------
    let missions = view(state).missions;
    assert.deepEqual([missions.locked, missions.daily.length, missions.weekly.length], [null, 3, 3]);
    assert.deepEqual(missions.daily.map((mission) => mission.kind), ['life', 'discovery', 'social'], 'one about her life, one about the city, one about people');
    // What each of today's missions takes; the first one she can finish with what the game has taught her so far is done.
    const recipes = {
      'd-meal': async () => run(ada, 'kitchen', 'home-soak-garri'), 'd-fresh': async () => run(ada, 'bathroom', 'bath'),
      'd-fun': async () => { await travel(ada, 'park'); return run(ada, 'trees', 'play-ayo'); },
      'd-paid': async () => paidWork(ada),
      'd-two-places': async () => { await travel(ada, 'park'); return travel(ada, 'amala-shitta'); },
      'd-new-place': async () => travel(ada, 'amala-shitta'),
      'd-greet': async () => { await travel(ada, 'park'); const here = view(await life(ada)).social.here; for (const npc of here.slice(0, 2)) await run(ada, 'people', `npc-${npc.id}-hello`); return life(ada); },
    };
    let chosen = missions.daily.find((mission) => mission.done && !mission.claimed) ?? missions.daily.find((mission) => Object.hasOwn(recipes, mission.id));
    assert.ok(chosen, `one of today’s missions can be done: ${missions.daily.map((mission) => mission.id).join(', ')}`);
    if (!chosen.done) state = await recipes[chosen.id]();
    missions = view(await life(ada)).missions;
    const finished = missions.daily.find((mission) => mission.id === chosen.id);
    assert.deepEqual([finished.done, finished.claimed, missions.claimable >= 1], [true, false, true], `“${finished.label}” is finished and waiting to be collected`);
    const purse = (await life(ada)).cash;
    const claimed = await act(ada, 'missions.claim', { id: chosen.id });
    assert.deepEqual([claimed.code, claimed.state.cash, claimed.state.ledger.at(-1).reason], ['claimed', purse + MISSION_REWARDS.daily.cash, `Mission: ${finished.label}`]);
    assert.equal((await act(ada, 'missions.claim', { id: chosen.id })).code, 'already_claimed', 'a mission pays once');
    state = claimed.state;
    say(`Missions: ${missions.daily.map((mission) => `“${mission.label}”`).join(', ')}`, `finished and collected “${finished.label}”: +${naira(MISSION_REWARDS.daily.cash)} (${naira(state.cash)})`);

    // ---- 6. to the buka; a share link that invites a friend to the Whot table there ---------------------------------------
    if (state.location !== 'amala-shitta') state = await travel(ada, 'amala-shitta');
    const adaSocket = await socket(ada);
    await joinRoom(adaSocket, 'amala-shitta');
    assert.equal((await hello(ada)).ok, true);
    const shared = await post('/api/growth/share', { cityId: CITY, kind: 'table', table: TABLE }, ada);
    assert.deepEqual([shared.ok, shared.code, shared.share.path, shared.share.facts.tableId, shared.share.facts.name], [true, 'shared', `/s/${shared.share.code}`, TABLE, 'Ada']);
    assert.equal((await post('/api/growth/share', { cityId: CITY, kind: 'table', table: TABLE }, ada)).share.code, shared.share.code, 'the same card twice is the same link');
    const code = shared.share.code;
    say(`Ada takes a Danfo to ${venueLabel('amala-shitta', CITY)} and shares the ${tableById(TABLE).label}`, `${ORIGIN}/s/${code} · “${shared.share.facts.game}” at ${shared.share.facts.venue}`);

    // ---- 7. a second, brand-new visitor opens the link: first as a crawler sees it ---------------------------------------
    const pageResponse = await fetch(`${base}/s/${code}`, { redirect: 'manual' });
    const html = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.equal(pageResponse.headers.get('set-cookie'), null, 'the preview page sets no cookie');
    assert.match(pageResponse.headers.get('content-security-policy'), /default-src 'none'/);
    assert.deepEqual([pageResponse.headers.get('x-frame-options'), pageResponse.headers.get('x-content-type-options'), pageResponse.headers.get('referrer-policy')], ['DENY', 'nosniff', 'no-referrer']);
    assert.ok(!/<script/i.test(html) && !/\son[a-z]+=/i.test(html), 'no script and no inline handler: a crawler that runs nothing sees everything');
    const meta = (key) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
    assert.match(meta('og:title'), /Ada/); assert.match(meta('og:title'), /Whot/);
    assert.ok(meta('og:description').length > 20);
    assert.deepEqual([meta('og:type'), meta('og:site_name'), meta('og:url'), meta('og:image'), meta('twitter:card'), meta('twitter:image')],
      ['website', 'Allworld', `${ORIGIN}/s/${code}`, `${ORIGIN}/og/allworld.jpg`, 'summary_large_image', `${ORIGIN}/og/allworld.jpg`]);
    const target = /<meta http-equiv="refresh" content="0;url=([^"]+)"/.exec(html)[1].replaceAll('&amp;', '&');
    assert.equal(target, `/?join=${ada.id}&ref=${code}&table=${TABLE}`);
    assert.ok(html.includes(`href="${target.replaceAll('&', '&amp;')}"`), 'and an ordinary link for a person');
    // …then as the game's own landing reads it (the same pure functions the browser runs).
    const url = new URL(target, ORIGIN), link = { join: joinIdFrom(url.pathname, url.search), ...linkParts(url.pathname, url.search) };
    assert.deepEqual(link, { join: ada.id, ref: code, table: TABLE });
    say('A new visitor opens the link: the preview page, read without running a script', `og:title “${meta('og:title')}” · absolute og:image · no script, no cookie · leads to ?join=…&ref=${code}&table=${TABLE}`);

    // ---- 8. Play: he lands beside Ada — one banner, no welcome line beside it — with the referral attached ---------------
    const { who: bola, state: fresh } = await play('Bola', { preset: 'street', joining: true, device: 'device-bola-000000002' });
    assert.deepEqual([fresh.location, fresh.message], ['park', ''], 'the quick start holds back its welcome: the banner says it');
    const linked = await post('/api/growth/referral/link', { cityId: CITY, code: link.ref, device: bola.device }, bola);
    assert.deepEqual([linked.ok, linked.code, linked.by], [true, 'linked', 'Ada']);
    const answer = await post('/api/social/join', { host: link.join, cityId: CITY }, bola);
    assert.deepEqual([answer.ok, answer.code, answer.venue, answer.host?.name], [true, 'joined', 'amala-shitta', 'Ada'], JSON.stringify(answer));
    const banner = joinBanner(answer, (id) => venueLabel(id, CITY), { gift: true });
    assert.deepEqual([banner.title, banner.text.endsWith(GIFT_LINE), banner.knock], ['You’re joining Ada', true, false]);
    let bolaState = await life(bola);
    assert.deepEqual([bolaState.location, bolaState.message, bolaState.onboarding.joined, bolaState.onboarding.stage, bolaState.cash], ['amala-shitta', '', true, 'guest', 5000], 'in the buka, free, with no second welcome');
    const bolaSocket = await socket(bola);
    const room = await joinRoom(bolaSocket, 'amala-shitta');
    assert.deepEqual(room.members.map((member) => member.name).sort(), ['Ada', 'Bola'], 'the two of them are in the same room');
    assert.equal((await post('/api/social/join', { host: link.join, cityId: CITY }, bola)).code, 'here', 'asking again changes nothing');
    assert.deepEqual([reasons(bolaState, 'Welcome gift'), reasons(await life(ada), 'Referral reward')], [[], []], 'the link has paid nobody');
    say('Bola taps Play and lands in the buka beside Ada', `“${banner.title}” — ${banner.text} · referral attached, nothing paid yet`);

    // ---- 9. the table the link named: one human against the other, a whole game of Whot over their sockets ----------------
    assert.equal(tableById(link.table).venue, 'amala-shitta');
    await tell(adaSocket, 'table-sit', {}); await tell(bolaSocket, 'table-sit', {}, adaSocket);
    await tell(adaSocket, 'table-start', {}, bolaSocket);
    assert.deepEqual([adaSocket.state.table.id, adaSocket.state.table.status, adaSocket.state.table.seats.map((seat) => [seat.name, Boolean(seat.bot)]), adaSocket.state.you, bolaSocket.state.you],
      [TABLE, 'playing', [['Ada', false], ['Bola', false]], 0, 1]);
    assert.deepEqual([adaSocket.state.view.hand.length, bolaSocket.state.view.hand.length], [5, 5]);
    const choose = (table) => (table.playable.length ? { t: 'play', i: table.playable[0], ...(table.hand[table.playable[0]].s === 'whot' ? { shape: 'circle' } : {}) } : { t: 'draw' });
    const peers = [adaSocket, bolaSocket];
    let moves = 0;
    while (adaSocket.state.table.status === 'playing') {
      const mover = peers.find((peer) => peer.state.toMove.includes(peer.state.you));
      assert.ok(mover && moves < 2000, 'someone seated is to move');
      await tell(mover, 'table-move', { n: mover.state.n, move: choose(mover.state.view) }, ...peers.filter((peer) => peer !== mover));
      assert.deepEqual(mover.errors, [], JSON.stringify(mover.errors.at(-1)));
      moves += 1; wait(2000);
    }
    const result = adaSocket.state.result;
    assert.deepEqual([adaSocket.state.table.status, result.calledOff, typeof result.text], ['over', false, 'string']);
    // No socket was ever sent the other player's hand, the market's order or the seed.
    assert.equal(peers.some((peer) => peer.all.some((message) => /"hands"|"market":\[|"seed"/.test(JSON.stringify(message)))), false);
    const winner = result.winners.length ? peers[result.winners[0]] : null;
    for (const peer of peers) {
      const purseBefore = (await life(peer.who)).cash, paid = await post('/api/growth/tables/claim', { cityId: CITY }, peer.who);
      const won = peer === winner;
      assert.deepEqual(paid.results.map((item) => [item.game, item.won, item.code]), [['whot', won, won ? 'paid' : 'counted']]);
      assert.equal((await life(peer.who)).cash - purseBefore, won ? TABLE_REWARDS.win : 0, `${peer.who.name}: a win pays ${TABLE_REWARDS.win} from the game, a loss costs nothing`);
      assert.deepEqual((await post('/api/growth/tables/claim', { cityId: CITY }, peer.who)).results, [], 'and it is applied once');
    }
    say(`They sit at the ${tableById(TABLE).label} and play Whot: ${moves} moves`, `${result.text}${winner ? ` · ${winner.who.name} +${naira(TABLE_REWARDS.win)}, paid by the game, once` : ' · a draw pays nobody'}`);

    // ---- 10. the referral pays both sides — only after real work on real Lagos days ---------------------------------------
    const gifts = async () => ({ welcome: reasons(await life(bola), 'Welcome gift'), reward: reasons(await life(ada), 'Referral reward') });
    await hello(bola); await hello(ada);
    assert.deepEqual(await gifts(), { welcome: [], reward: [] }, 'playing a game together pays no referral');
    // Day one: Bola is paid for a shift → his welcome gift. Ada's reward still waits.
    bolaState = await paidWork(bola);
    assert.equal(bolaState.civic.work.days, 1);
    assert.deepEqual(await gifts(), { welcome: [], reward: [] }, 'it is paid when he is next here, not by the shift itself');
    const day1 = await hello(bola);
    assert.equal(day1.ok, true); await hello(ada);
    assert.deepEqual(await gifts(), { welcome: [[REFERRAL.welcome, (await life(bola)).ledger.find((line) => line.reason.startsWith('Welcome gift')).reason]], reward: [] });
    // A second shift on the SAME Lagos day is not a second day of work.
    wait(HELPER_COOLDOWN_SECONDS * 1000 + 60000); await paidWork(bola); await hello(bola); await hello(ada);
    assert.deepEqual([(await life(bola)).civic.work.days, (await gifts()).reward], [1, []], 'two shifts in one day are one day');
    // The next Lagos day: a second day of paid work → the referral counts, and Ada is paid when she is next here.
    time = Math.ceil(time / DAY) * DAY + 9 * HOUR;
    await paidWork(bola);
    assert.equal((await life(bola)).civic.work.days, REFERRAL.countWorkDays);
    await hello(bola);
    assert.deepEqual((await gifts()).reward, [], 'counted, and owed to Ada until she is here');
    const adaBefore = await life(ada), told = await hello(ada), adaAfter = await life(ada);
    assert.deepEqual([told.referral.counted, told.referral.invited.map((friend) => [friend.name, friend.state])], [1, [['Bola', 'counted']]]);
    assert.deepEqual([adaAfter.cash - adaBefore.cash, adaAfter.goals.stars - adaBefore.goals.stars, reasons(adaAfter, 'Referral reward').length], [REFERRAL.reward, REFERRAL.rewardStars, 1]);
    // Once each, however often either of them comes back.
    for (let i = 0; i < 3; i++) { await hello(bola); await hello(ada); }
    assert.deepEqual([(await gifts()).welcome.length, (await gifts()).reward.length], [1, 1]);
    say('The referral pays only after real work', `Bola +${naira(REFERRAL.welcome)} after his first paid day; Ada +${naira(REFERRAL.reward)} +${REFERRAL.rewardStars}✨ after his second (the next Lagos day); each once`);

    // ---- 11. reload: the server stopped and started on the same data reads back identical ---------------------------------
    const kept = { ada: await life(ada), bola: await life(bola), plot: await get(`/api/world/me?city=${CITY}`, ada), area: await get(`/api/world/lga/${LGA}?city=${CITY}`, ada) };
    assert.deepEqual(await life(ada), kept.ada, 'reading again changes nothing');
    await halt(); await boot();
    const again = { ada: await life(ada), bola: await life(bola), plot: await get(`/api/world/me?city=${CITY}`, ada), area: await get(`/api/world/lga/${LGA}?city=${CITY}`, ada) };
    assert.deepEqual(again.ada, kept.ada, 'Ada’s life read back from disk by a new server process is identical');
    assert.deepEqual(again.bola, kept.bola, 'and Bola’s');
    assert.deepEqual([again.plot.plot, again.plot.lga, again.area.residents, again.area.houses], [kept.plot.plot, LGA, 1, 1], 'her house is where it was; Bola, still a guest, has none');
    assert.equal((await get(`/api/world/me?city=${CITY}`, bola)).placed, false);
    const afterRestart = await hello(ada);
    assert.deepEqual([afterRestart.referral.counted, reasons(await life(ada), 'Referral reward').length, reasons(await life(bola), 'Welcome gift').length], [1, 1, 1], 'nothing is paid again after a restart');
    const replayed = await post('/api/growth/referral/link', { cityId: CITY, code, device: bola.device }, bola);
    assert.deepEqual([replayed.code, replayed.duplicate], ['linked', true], 'the same link again is the same link');
    say('Reload (server restarted on the same data)', `both lives identical · ${address} still Ada’s · gifts not paid again`);

    // ---- nothing that reached a player or was stored for others carries a cookie secret --------------------------------------
    const everything = JSON.stringify(heard);
    for (const who of [ada, bola]) assert.ok(!everything.includes(who.cookie.slice(4)), `${who.name}’s cookie secret never left the server`);
    const stored = JSON.parse(await readFile(join(dataDir, 'devices.json'), 'utf8'));
    for (const who of [ada, bola]) for (const key of ['social', 'civic', 'growth']) assert.ok(!JSON.stringify(stored[key] ?? {}).includes(who.cookie.slice(4)), `${key} never stores a secret`);
    assert.ok(!JSON.stringify(stored.growth).includes('device-bola') && !JSON.stringify(stored.growth).includes('device-ada'), 'a device token is stored only as a salted hash');
    assert.ok(!JSON.stringify(stored.growth).includes('127.0.0.1'), 'and no network address is stored');

    const final = { ada: (await life(ada)).cash, bola: (await life(bola)).cash };
    log('');
    log('Ada’s ledger:');
    for (const entry of (await life(ada)).ledger) log(`    ${(entry.amount >= 0 ? '+' : '−') + naira(Math.abs(entry.amount))}`.padEnd(15) + `${entry.reason.padEnd(64)}${naira(entry.balance)}`);
    log(`New player complete: ${step} steps. Ada ${naira(final.ada)} (${STARTER_GOALS.length - (await life(ada)).goals.chain} starter goals to go), Bola ${naira(final.bola)}.`);
    return { steps: step, cash: final, outcome: outcome.id, mission: chosen.id, moves, winner: winner?.who.name ?? null };
  } finally {
    useSaltSourceForTests();
    try { await halt(); } catch { /* already stopped */ }
    await rm(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNewPlayer().catch((error) => { console.error(`\nNEW PLAYER FAILED: ${error.message}`); process.exitCode = 1; });
}
