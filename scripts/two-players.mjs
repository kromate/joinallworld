#!/usr/bin/env node
/**
 * Two players, one city: the multiplayer seams played end to end against the real server.
 *
 *   npm run two-players
 *
 * Starts the server in-process on an ephemeral port with a temporary data directory and a clock
 * this script controls. Two device sessions (Ada and Bola) are driven exactly as two browsers
 * would drive them: HTTP for sessions, lives, actions and the social and civic routes, and two
 * sockets each — a room socket (what the community panel opens) and a social socket (what the
 * social panels open: live pushes, who-is-here, and a guest's place in a host's Home room).
 *
 * Every step asserts what the server answered and prints one transcript line. Nothing here
 * reaches into the rules engine to change state: the engine and its content are imported only
 * to read derived display data (which starting homes a lottery outcome allows, opening hours,
 * which regular can be greeted) from what the server returned.
 *
 * Plain Node, no new dependencies. `runTwoPlayers({ log })` is also run by server/two-players.test.js.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServer } from '../server/server.js';
import { createLife, viewLife } from '../src/life.js';
import { VENUES } from '../src/game/content/venues.js';
import { NPCS } from '../src/game/content/npcs.js';
import { EVENTS } from '../src/game/content/events.js';
import { isOpen, minutesUntilOpen, lagosTime } from '../src/game/clock.js';

const CITY = 'lagos';
const HOUR = 3600000, DAY = 24 * HOUR;
const naira = (value) => `₦${value.toLocaleString('en-NG')}`;
const LOOKS = {
  Ada: { body: 'woman', hair: 'afro', outfit: 'owambe', fabric: 'ankara', skin: 'skin-3', hairColor: 'black', outfitColor: 'gold', bottomsColor: 'teal' },
  Bola: { body: 'man', hair: 'low-cut', outfit: 'hoodie', fabric: 'plain', skin: 'skin-5', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' },
};
/** Saturday 3 January 2026, 10:00 in Lagos: two Lagos days before Monday's nominations open. */
const START = Date.UTC(2026, 0, 3, 9);
const at = (day, hour, minute = 0) => Date.UTC(2026, 0, day, hour - 1, minute); // Lagos wall time → server ms

export async function runTwoPlayers({ log = console.log } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'joinallworld-two-players-'));
  let time = START, step = 0, ids = 0;
  const server = await createServer({ dataDir, now: () => time, distDir: join(dataDir, 'no-dist') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = [], heard = [];

  const say = (title, note = '') => log(`${String(++step).padStart(2, '0')}  ${title.padEnd(64)}${note ? `· ${note}` : ''}`);
  const stamp = () => { const t = lagosTime(time); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.weekday]} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`; };
  // Client ids and request ids are made the way the browser makes them: server time, then a UUID (server/routes/once.js).
  const clientId = () => `${time}:00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
  const nextAction = () => `${time}:00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

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
    const result = await post('/api/action', { actionId: nextAction(), cityId: CITY, type, ...(payload ? { payload } : {}) }, who);
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
  const goTo = (when) => { assert.ok(when >= time, 'the clock only moves forward'); time = when; };

  /** A socket as the browser opens it: the session cookie and a same-origin Origin header. */
  async function socket(who) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket', { headers: { Cookie: who.cookie, Origin: base } });
    sockets.push(ws);
    const queue = [], waiting = [];
    ws.on('message', (data) => { const message = JSON.parse(data.toString()); heard.push(message); const next = waiting.shift(); if (next) next(message); else queue.push(message); });
    await once(ws, 'open');
    const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((done, fail) => { const timer = setTimeout(() => fail(Error(`${who.name}: no socket message`)), 3000); waiting.push((message) => { clearTimeout(timer); done(message); }); }));
    return {
      send: (message) => ws.send(JSON.stringify(message)),
      next,
      /** Read until a message of this type arrives. */
      async until(type) { for (let i = 0; i < 200; i++) { const message = await next(); if (message.type === type) return message; } throw Error(`${who.name}: no ${type} message`); },
      /** Everything already received and not yet read. */
      drain() { return queue.splice(0); },
    };
  }

  /** Travel and wait out the trip. A roadside event on arrival is answered with its last choice (never costs money). */
  async function travel(who, id, mode = 'danfo') {
    const started = await ok(who, 'travel', { id, mode }, 'started');
    wait(started.activeAction.duration * 1000);
    let state = await life(who);
    assert.equal(state.location, id, `${who.name} arrived at ${id}`);
    if (state.travel.event) {
      assert.ok(EVENTS[state.travel.event.id]);
      state = await ok(who, 'world.roadside', { choice: view(state).travel.event.choices.at(-1).id }, 'resolved');
    }
    return state;
  }
  /** One Community helper shift at Freedom Park (the player is already there and already has the job). */
  async function helperShift(who) {
    await ok(who, 'spot', { id: 'work' }, 'selected');
    const shift = await ok(who, 'activity', { id: 'helper-shift' }, 'started');
    wait(shift.activeAction.duration * 1000);
    return life(who);
  }

  async function joinRoom(peer, venueId) { peer.send({ type: 'join', cityId: CITY, venueId }); return peer.until('presence'); }

  async function create(name) {
    const opened = await post('/api/session', { name, onboarding: true });
    assert.equal(opened.status, 200);
    const who = { name, cookie: opened.headers.get('set-cookie').split(';')[0], id: opened.session.id };
    assert.notEqual(who.id, who.cookie.slice(4), 'the public id is not the cookie');
    const blocked = await act(who, 'travel', { id: 'park', mode: 'trek' });
    assert.equal(blocked.code, 'onboarding_required');
    await ok(who, 'onboarding.look', { look: LOOKS[name] }, 'look_saved');
    await ok(who, 'onboarding.traits', { traits: ['smooth-talker', 'clean-pikin'] }, 'traits_saved');
    await ok(who, 'onboarding.dream', { dream: 'everybodys-padi' }, 'dream_saved');
    const rolled = await ok(who, 'onboarding.lottery', {}, 'rolled');
    const home = view(rolled).onboarding.homes.find((item) => !item.locked);
    const moved = await ok(who, 'onboarding.home', { house: home.id }, 'life_started');
    assert.deepEqual([moved.location, moved.onboarding.done], ['home', true]);
    return { who, outcome: view(moved).onboarding.lottery.label, home: home.label, cash: moved.cash };
  }

  try {
    log(`Two players · server clock starts ${new Date(time).toISOString()} (${stamp()} in Lagos)`);

    // ---- 1. both create a Sim; until then neither exists for the other ---------------------------
    const a = await create('Ada'), b = await create('Bola');
    const ada = a.who, bola = b.who;
    assert.equal((await get('/api/social/me', ada)).me.name, 'Ada');
    assert.equal((await get('/api/social/me', bola)).me.name, 'Bola');
    say('Ada and Bola create their Sims and move in', `Ada: ${a.outcome}, ${a.home}, ${naira(a.cash)} · Bola: ${b.outcome}, ${b.home}, ${naira(b.cash)}`);

    // ---- 2. they meet at Freedom Park: truthful presence --------------------------------------------
    const roomA = await socket(ada), roomB = await socket(bola), liveA = await socket(ada), liveB = await socket(bola);
    await travel(ada, 'park'); await travel(bola, 'park');
    liveA.send({ type: 'people-list', cityId: CITY });
    let listing = await liveA.until('people');
    assert.deepEqual([listing.venue, listing.self, listing.players], ['park', 'not_joined', []], 'before the room is joined the listing says so instead of showing an empty park');
    await joinRoom(roomA, 'park');
    const together = await joinRoom(roomB, 'park');
    assert.deepEqual(together.members.map((member) => member.name).sort(), ['Ada', 'Bola']);
    assert.ok(together.members.every((member) => member.enabled === false && member.muted === true), 'nobody is in voice');
    assert.deepEqual(await liveA.until('people-changed'), { type: 'people-changed', cityId: CITY, venueId: 'park' });
    listing = await get(`/api/social/people?city=${CITY}`, ada);
    assert.deepEqual(listing.players.map((player) => [player.id, player.name, player.here]), [[bola.id, 'Bola', true]]);
    assert.deepEqual(listing.players[0].look, LOOKS.Bola, 'Bola’s avatar is drawn from the look the server holds');
    assert.deepEqual((await get(`/api/social/people?city=${CITY}`, bola)).players.map((player) => player.name), ['Ada']);
    // Bola walks off: both views follow at once; he comes back.
    liveA.drain();
    const leaving = await ok(bola, 'travel', { id: 'library', mode: 'trek' }, 'started');
    await liveA.until('people-changed');
    assert.deepEqual((await get(`/api/social/people?city=${CITY}`, ada)).players, []);
    assert.equal((await get(`/api/social/people?city=${CITY}`, bola)).self, 'travelling');
    wait(leaving.activeAction.duration * 1000);
    await life(bola);
    await travel(bola, 'park', 'trek');
    await joinRoom(roomB, 'park');
    assert.deepEqual((await get(`/api/social/people?city=${CITY}`, ada)).players.map((player) => player.name), ['Bola']);
    say('they meet at Freedom Park', 'each sees the other in the room; Bola leaves and the list empties at once; he returns');

    // ---- 3. friend request → accept ----------------------------------------------------------------
    const asked = await post('/api/social/friends/request', { to: ada.id, cityId: CITY }, bola);
    assert.equal(asked.code, 'requested');
    assert.deepEqual((await liveA.until('friend-request')).from, { id: bola.id, name: 'Bola' });
    const accepted = await post('/api/social/friends/answer', { from: bola.id, accept: true, cityId: CITY }, ada);
    assert.equal(accepted.code, 'accepted');
    assert.equal((await post('/api/social/friends/answer', { from: bola.id, accept: true, cityId: CITY }, ada)).duplicate, true, 'accepting twice changes nothing');
    assert.deepEqual((await liveB.until('friend-accepted')).by, { id: ada.id, name: 'Ada' });
    const friendsA = (await get('/api/social/me', ada)).friends, friendsB = (await get('/api/social/me', bola)).friends;
    assert.deepEqual([friendsA.map((friend) => [friend.name, friend.status, friend.venue]), friendsB.map((friend) => [friend.name, friend.status, friend.venue])], [[['Bola', 'online', 'park']], [['Ada', 'online', 'park']]]);
    assert.deepEqual([(await life(ada)).social.rel[bola.id].friend, (await life(bola)).social.rel[ada.id].friend], [true, true], 'the friendship is in both lives');
    say('Bola asks, Ada accepts', 'friends in both lists and both lives; each sees the other online at Freedom Park');

    // ---- 4. a direct message, sent twice by a retry, stored once -------------------------------------
    liveB.drain();
    const messageId = clientId();
    const sent = await post('/api/social/messages', { to: bola.id, body: 'Come and see my place <3', clientId: messageId }, ada);
    const retried = await post('/api/social/messages', { to: bola.id, body: 'Come and see my place <3', clientId: messageId }, ada);
    assert.deepEqual([sent.code, sent.duplicate, retried.code, retried.duplicate, retried.message.id], ['sent', undefined, 'sent', true, sent.message.id]);
    assert.equal((await post('/api/social/messages', { to: bola.id, body: 'A different text', clientId: messageId }, ada)).status, 409, 'the same client id with another body is refused');
    assert.equal((await post('/api/social/messages', { conv: sent.conv.id, body: 'On my way!', clientId: clientId() }, bola)).code, 'sent');
    const first = await liveB.until('dm'), second = await liveB.until('dm');
    assert.deepEqual([first.message.body, second.message.body], ['Come and see my place <3', 'On my way!'], 'the retry was not delivered a second time');
    const thread = await get(`/api/social/conversations/${sent.conv.id}`, bola);
    assert.deepEqual(thread.messages.map((message) => [message.from.name, message.body]), [['Ada', 'Come and see my place <3'], ['Bola', 'On my way!']]);
    say('Ada messages Bola; her client retries the send', 'stored once, delivered once; Bola replies');

    // ---- 5. a house visit: knock → let in → the host’s Home room → house chat → the visit ends ---------
    liveB.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
    assert.equal((await liveB.until('error')).code, 'not_a_guest', 'a friend is not a guest');
    assert.equal((await post('/api/social/house/knock', { host: ada.id, cityId: CITY }, bola)).code, 'host_not_home');
    await travel(ada, 'home');
    roomA.drain(); // presence messages from the park are still queued; wait for the one this join produces
    await joinRoom(roomA, 'home');
    const knock = await post('/api/social/house/knock', { host: ada.id, cityId: CITY }, bola);
    assert.equal(knock.code, 'knocking');
    assert.deepEqual((await liveA.until('invite-knock')).from, { id: bola.id, name: 'Bola' });
    const letIn = await post('/api/social/house/answer', { visitor: bola.id, answer: 'accept' }, ada);
    assert.equal(letIn.code, 'accepted');
    assert.equal((await liveB.until('invite-answer')).answer, 'accepted');
    assert.equal((await get('/api/social/me', bola)).visiting.host.id, ada.id);
    liveB.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
    const inside = await liveB.until('presence');
    assert.deepEqual(inside.members.map((member) => member.name).sort(), ['Ada', 'Bola']);
    assert.ok(inside.members.every((member) => member.enabled === false && member.muted === true), 'a house visit does not turn voice on');
    await roomA.until('presence');
    assert.deepEqual((await get(`/api/social/people?city=${CITY}`, ada)).players.map((player) => [player.name, player.here]), [['Bola', true]], 'the host sees her guest in her home');
    // Chat in the room, and the stored house conversation.
    liveB.send({ type: 'chat', body: 'Nice place!', clientId: 'house-1' });
    assert.deepEqual([(await roomA.until('chat')).body, (await liveB.until('chat')).from.name], ['Nice place!', 'Bola']);
    roomA.send({ type: 'chat', body: 'Thank you o', clientId: 'house-2' });
    assert.equal((await liveB.until('chat')).body, 'Thank you o');
    assert.equal((await post('/api/social/messages', { conv: `h.${ada.id}`, body: 'There is jollof', clientId: clientId() }, ada)).code, 'sent');
    const houseDm = await liveB.until('dm');
    assert.deepEqual([houseDm.conv.kind, houseDm.message.body], ['house', 'There is jollof']);
    // The visit ends: Bola leaves, is out of the room at once, and cannot walk back in.
    assert.equal((await post('/api/social/house/leave', { host: ada.id }, bola)).code, 'left');
    assert.equal((await liveB.until('error')).code, 'visit_ended');
    liveB.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
    assert.equal((await liveB.until('error')).code, 'not_a_guest');
    assert.deepEqual([(await get('/api/social/me', ada)).house.guests, (await get('/api/social/me', bola)).visiting], [[], null]);
    assert.equal((await get(`/api/social/conversations/h.${ada.id}`, bola)).code, 'not_a_member');
    say('Bola knocks, Ada lets him in, he joins her home room', 'room chat and house chat both ways; he leaves and the room and chat close to him');

    // ---- 6. Ada works a shift, and a day later gives part of her wages to Bola -----------------------
    await travel(ada, 'park');
    await ok(ada, 'apply-job', { id: 'teaching' }, 'applied');
    assert.equal((await life(ada)).activeAction, null, '“Go automatically” waits for the tutorial');
    await ok(ada, 'spot', { id: 'work' }, 'selected');
    const shift = await ok(ada, 'activity', { id: 'teaching-shift' }, 'started');
    wait(shift.activeAction.duration * 1000);
    const paid = await life(ada);
    assert.deepEqual([paid.ledger.at(-1).reason, paid.ledger.at(-1).amount, paid.social.earned], ['Teaching shift', 3000, 3000]);
    const tooSoon = await post('/api/social/transfers', { to: bola.id, amount: 1500, cityId: CITY, clientId: clientId() }, ada);
    assert.equal(tooSoon.code, 'account_too_new');
    goTo(START + 25 * HOUR);
    const beforeA = (await life(ada)).cash, beforeB = (await life(bola)).cash;
    const tooMuch = await post('/api/social/transfers', { to: bola.id, amount: 4000, cityId: CITY, clientId: clientId() }, ada);
    assert.equal(tooMuch.code, 'gift_exceeds_earned'); assert.match(tooMuch.reason, /You can still give ₦3,000/);
    const giftId = clientId();
    const gift = await post('/api/social/transfers', { to: bola.id, amount: 1500, cityId: CITY, clientId: giftId }, ada);
    const giftAgain = await post('/api/social/transfers', { to: bola.id, amount: 1500, cityId: CITY, clientId: giftId }, ada);
    assert.deepEqual([gift.code, gift.credited, gift.balance, giftAgain.code, giftAgain.duplicate, giftAgain.balance], ['sent', true, beforeA - 1500, 'sent', true, beforeA - 1500]);
    const afterA = await life(ada), afterB = await life(bola);
    assert.deepEqual([afterA.cash, afterB.cash], [beforeA - 1500, beforeB + 1500]);
    assert.equal(afterA.ledger.filter((entry) => entry.reason === 'Transfer to Bola').length, 1, 'debited once');
    assert.equal(afterB.ledger.filter((entry) => entry.reason === 'Transfer from Ada').length, 1, 'credited once');
    assert.equal((await liveB.until('transfer')).amount, 1500);
    assert.ok((await get('/api/social/me', bola)).updates.some((update) => update.text === 'Ada sent you ₦1,500.'));
    assert.equal((await post('/api/social/transfers', { to: ada.id, amount: 500, cityId: CITY, clientId: clientId() }, bola)).code, 'earn_first', 'a gift is not wages: Bola cannot pass it on');
    // Bola takes the starter job and works his first paid shift: Sunday is his first day worked.
    await ok(bola, 'apply-job', { id: 'community-helper' }, 'applied');
    assert.equal((await helperShift(bola)).civic.work.days, 1);
    say('Ada earns ₦3,000 teaching and, a day later, sends Bola ₦1,500', `refused while her account was under a day old and above what she earned; one debit (${naira(afterA.cash)}), one credit (${naira(afterB.cash)})`);

    // ---- 7. Monday: Ada declares for Governor ------------------------------------------------------
    goTo(at(5, 9));
    let gov = await get(`/api/civic/gov?city=${CITY}`, ada);
    // Old enough, but paid for work on one day only (Saturday): the server says exactly what is missing.
    assert.deepEqual([gov.phase, gov.you.days, gov.you.run.ok, gov.you.run.code], ['nominations', 2, false, 'work_days']);
    assert.match(gov.you.run.reason, /paid for work on 1 day\. Finish a paid shift or gig on 1 more day/);
    assert.equal((await post('/api/civic/gov/run', { cityId: CITY, slogan: 'Light for every street', requestId: clientId() }, ada)).code, 'work_days');
    await ok(ada, 'spot', { id: 'drinks' }, 'selected');
    const lunch = await ok(ada, 'activity', { id: 'park-palmwine' }, 'started');
    wait(lunch.activeAction.duration * 1000);
    await life(ada);
    await ok(ada, 'spot', { id: 'work' }, 'selected');
    const monday = await ok(ada, 'activity', { id: 'teaching-shift' }, 'started');
    wait(monday.activeAction.duration * 1000);
    assert.equal((await life(ada)).civic.work.days, 2);
    assert.equal((await helperShift(bola)).civic.work.days, 2, 'Bola’s second day worked');
    gov = await get(`/api/civic/gov?city=${CITY}`, ada);
    assert.deepEqual([gov.phase, gov.you.days, gov.you.run.ok], ['nominations', 2, true]);
    const fee = (await life(ada)).cash;
    const declared = await post('/api/civic/gov/run', { cityId: CITY, slogan: 'Light for every street', requestId: clientId() }, ada);
    assert.deepEqual([declared.code, declared.state.cash, declared.state.ledger.at(-1).reason], ['declared', fee - 2000, 'Governorship filing fee']);
    assert.equal((await post('/api/civic/gov/run', { cityId: CITY, slogan: 'Again', requestId: clientId() }, ada)).code, 'already_candidate');
    assert.equal((await act(ada, 'civic.run', {})).code, 'server_only', 'the fee cannot be paid outside the election route');
    assert.equal((await post('/api/civic/gov/vote', { cityId: CITY, candidate: ada.id }, bola)).code, 'polls_closed');
    say('Monday: Ada declares for Governor', `refused until she had been paid for work on two different days; filing fee ₦2,000 paid once (${naira(declared.state.cash)}); voting is not open yet`);

    // ---- 8. Tuesday: Bola completes the daily gem hunt and is paid once ------------------------------
    goTo(at(6, 9));
    let hunter = await life(bola);
    const huntDay = hunter.civic.hunt.day;
    assert.equal(hunter.civic.hunt.gems.length, 3);
    for (let round = 0; round < 3; round++) {
      hunter = await life(bola);
      const left = hunter.civic.hunt.gems.filter((gem) => !gem.found);
      if (!left.length) break;
      let gem = left.find((item) => isOpen(VENUES[item.venue].hours, time));
      if (!gem) {
        gem = left.reduce((best, item) => (minutesUntilOpen(VENUES[item.venue].hours, time) < minutesUntilOpen(VENUES[best.venue].hours, time) ? item : best));
        assert.equal((await act(bola, 'travel', { id: gem.venue, mode: 'trek' })).code, 'closed');
        wait(minutesUntilOpen(VENUES[gem.venue].hours, time) * 60000);
      }
      if (hunter.location !== gem.venue) hunter = await travel(bola, gem.venue, 'danfo');
      const index = hunter.civic.hunt.gems.findIndex((item) => item.venue === gem.venue && item.kind === gem.kind && item.spot === gem.spot);
      if (!hunter.civic.hunt.gems[index].found) {
        if (gem.kind === 'activity') {
          assert.equal((await act(bola, 'civic.hunt-search')).code, 'activity_needed');
          const regular = Object.values(NPCS).find((npc) => npc.venue === gem.venue);
          await ok(bola, 'spot', { id: 'people' }, 'selected');
          const hello = await ok(bola, 'activity', { id: `npc-${regular.id}-hello` }, 'started');
          wait(hello.activeAction.duration * 1000);
        } else {
          if (gem.spot && hunter.spot !== gem.spot) await ok(bola, 'spot', { id: gem.spot }, 'selected');
          await ok(bola, 'civic.hunt-search', undefined, 'found');
        }
      }
      hunter = await life(bola);
      assert.equal(hunter.civic.hunt.gems[index].found, true, JSON.stringify(gem));
    }
    assert.equal(hunter.civic.hunt.day, huntDay, 'all three gems were found within one Lagos day');
    assert.equal((await act(bola, 'civic.hunt-search')).code, 'hunt_complete');
    const prizeBefore = hunter.cash;
    const [claimA, claimB] = await Promise.all([act(bola, 'civic.hunt-claim'), act(bola, 'civic.hunt-claim')]);
    assert.deepEqual([claimA.code, claimB.code].sort(), ['already_claimed', 'claimed'], 'two claims at once pay once');
    hunter = await life(bola);
    assert.equal(hunter.cash, prizeBefore + 3000);
    assert.equal(hunter.ledger.filter((entry) => entry.reason === 'Daily gem hunt prize').length, 1);
    assert.equal((await act(bola, 'civic.hunt-claim')).code, 'already_claimed');
    const counter = await get(`/api/civic/pulse?city=${CITY}`, bola);
    assert.deepEqual([counter.hunt.found >= 3, counter.hunt.claims], [true, 1]);
    say('Tuesday: Bola finds all three gems and claims the prize', `${hunter.civic.hunt.gems.map((gem) => VENUES[gem.venue].label).join(', ')} · +₦3,000 once (${naira(hunter.cash)})`);

    // ---- 9. Thursday: Bola votes at the Polling Unit -------------------------------------------------
    goTo(at(8, 9));
    await life(bola);
    const afar = await post('/api/civic/gov/vote', { cityId: CITY, candidate: ada.id }, bola);
    assert.equal(afar.code, 'wrong_place'); assert.match(afar.reason, /Travel to Polling Unit/);
    await travel(bola, 'polling-unit', 'danfo');
    const voted = await post('/api/civic/gov/vote', { cityId: CITY, candidate: ada.id }, bola);
    assert.deepEqual([voted.code, voted.gov.election.yourVote, voted.gov.election.totalVotes], ['voted', ada.id, 1]);
    assert.equal((await post('/api/civic/gov/vote', { cityId: CITY, candidate: ada.id }, bola)).code, 'already_voted');
    assert.equal((await act(bola, 'civic.vote', {})).code, 'server_only');
    say('Thursday: Bola votes for Ada at the Polling Unit', 'refused from elsewhere; one vote, counted once');

    // ---- 10. Sunday: Ada is Governor; her announcement reaches Bola’s Updates -------------------------
    goTo(at(11, 0, 30));
    gov = await get(`/api/civic/gov?city=${CITY}`, ada);
    assert.deepEqual([gov.phase, gov.governor.id, gov.governor.name, gov.you.isGovernor, gov.lastResult.winner.votes], ['results', ada.id, 'Ada', true, 1]);
    assert.equal((await post('/api/civic/gov/announce', { cityId: CITY, text: 'Everybody is in charge' }, bola)).code, 'not_governor');
    const announced = await post('/api/civic/gov/announce', { cityId: CITY, text: 'Sanitation day is <b>Saturday</b>' }, ada);
    assert.deepEqual([announced.code, announced.gov.announcements[0].text], ['announced', 'Sanitation day is <b>Saturday</b>']);
    wait(15000);
    const pulse = await get(`/api/civic/pulse?city=${CITY}`, bola);
    assert.deepEqual([pulse.checkedIn, pulse.gov.governor.name, pulse.notices[0].kind], [true, 'Ada', 'announcement']);
    const updates = (await life(bola)).social.notices.map((notice) => notice.text);
    assert.ok(updates.includes('Ada is the new Governor of Lagos: Elected with 1 of 1 vote.'), 'the result is in Bola’s Updates');
    assert.ok(updates.includes('Governor Ada announced: Sanitation day is <b>Saturday</b>'), 'the announcement is in Bola’s Updates, stored as text');
    wait(15000);
    await get(`/api/civic/pulse?city=${CITY}`, bola);
    const again = (await life(bola)).social.notices.map((notice) => notice.text);
    assert.equal(again.filter((text) => text.startsWith('Governor Ada announced')).length, 1, 'posted once, however often he checks in');
    assert.ok(again.some((text) => text.startsWith('Rent paid:') || text.startsWith('Rent missed:')), 'Saturday’s rent is in the same feed');
    say('Sunday: Ada is Governor and posts an announcement', 'it and the result are in Bola’s Updates, once, beside his rent notice');

    // ---- 11. Bola rents a sea plot; it is in the public ads listing ---------------------------------
    const seaBefore = (await life(bola)).cash;
    const rented = await post('/api/civic/ads/rent', { cityId: CITY, kind: 'sea', slot: 'sea-3-4', text: 'Bola Fabrics', colour: 'gold', icon: 'shop', link: 'https://example.com', image: 'x', requestId: clientId() }, bola);
    assert.deepEqual([rented.code, rented.state.cash], ['rented', seaBefore - 100]);
    assert.equal((await post('/api/civic/ads/rent', { cityId: CITY, kind: 'sea', slot: 'sea-3-4', text: 'Ada Books', colour: 'blue', icon: 'book', requestId: clientId() }, ada)).code, 'slot_taken');
    const ads = await get(`/api/civic/ads?city=${CITY}`);
    assert.deepEqual(ads.sea.plots.map((plot) => [plot.slot, plot.row, plot.col, plot.text, plot.colour, plot.icon, plot.by.name, plot.mine]), [['sea-3-4', 3, 4, 'Bola Fabrics', 'gold', 'shop', 'Bola', false]]);
    assert.deepEqual(Object.keys(ads.sea.plots[0]).sort(), ['at', 'by', 'col', 'colour', 'expiresAt', 'icon', 'mine', 'price', 'row', 'slot', 'text'], 'text, colour and icon only: no link, no image');
    say('Bola rents sea plot 4·5', `₦100 for 30 days (${naira(rented.state.cash)}); it is in the public listing with his text, colour and icon`);

    // ---- nothing that reached a player or was stored for others carries a cookie secret ---------------
    const everything = JSON.stringify(heard);
    for (const who of [ada, bola]) assert.ok(!everything.includes(who.cookie.slice(4)), `${who.name}’s cookie secret never left the server`);
    const stored = JSON.parse(await readFile(join(dataDir, 'devices.json'), 'utf8'));
    for (const who of [ada, bola]) for (const key of ['social', 'civic']) assert.ok(!JSON.stringify(stored[key]).includes(who.cookie.slice(4)), `${key} never stores a secret`);
    assert.deepEqual(Object.keys(stored).sort(), ['civic', 'sessions', 'social', 'version']);

    log(`Two players complete: ${step} steps. Ada ${naira((await life(ada)).cash)}, Bola ${naira((await life(bola)).cash)}.`);
    return { steps: step };
  } finally {
    for (const ws of sockets) ws.terminate();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await server.store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTwoPlayers().catch((error) => { console.error(`\nTWO PLAYERS FAILED: ${error.message}`); process.exitCode = 1; });
}
