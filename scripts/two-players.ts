#!/usr/bin/env node
import { loadCityContent } from '../src/game/cities/registry.ts';
await loadCityContent('lagos');
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
 * REPRODUCIBLE ROLLS. A real server keys every random outcome with a secret salt per life, so no
 * two runs would roll alike. This process is the server here, so it fixes the salts its lives are
 * given (the test-only hook in server/life-service.ts; no request can do that): the run is the
 * same every time, as it was before salts existed.
 *
 * Plain Node, no new dependencies. `runTwoPlayers({ log })` is also run by server/two-players.test.ts.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServer } from '../server/server.ts';
import { useSaltSourceForTests } from '../server/life-service.ts';
import { createLife, viewLife } from '../src/life.ts';
import { VENUES } from '../src/game/cities/lagos/venues.ts';

import { NPCS } from '../src/game/cities/lagos/regulars.ts';

import { EVENTS } from '../src/game/content/events.ts';
import { isOpen, minutesUntilOpen, lagosTime } from '../src/game/clock.ts';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { LifeState, Look } from '../src/types/index.ts';
import type { ActionResponse, LifeResponse } from '../src/types/protocol.ts';

/** What this script uses of the server (server/server.ts is still untyped JavaScript). */
interface TwoPlayersServer extends Server { store: { close(): Promise<void> } }
type Json = Record<string, unknown>;
/** What every HTTP answer carries beside its JSON body. */
interface Meta { status: number; headers: Headers; error?: string }
type Reply<T extends object = Json> = Meta & T;
type ActionReply = Reply<ActionResponse>;
/** The fields of each route's JSON that this script reads. */
interface Ref { id: string; name: string }
interface SessionBody { session: { id: string } }
interface SocialMeBody {
  me: { name: string };
  friends: { name: string; status: string; venue: string }[];
  visiting: { host: { id: string } } | null;
  house: { guests: unknown[] };
  updates: { text: string }[];
}
interface JoinBody { ok: boolean; code: string; host: Ref; venue: keyof typeof VENUES }
interface PeopleBody { venue: string; self: string; players: { id: string; name: string; here: boolean; look: Look }[] }
interface MessageBody { code: string; duplicate?: boolean; message: { id: string }; conv: { id: string } }
interface ThreadBody { code?: string; messages: { from: Ref; body: string }[] }
interface TransferBody { code: string; reason?: string; credited: boolean; balance: number; duplicate?: boolean }
interface GovBody {
  phase: string;
  you: { days: number; run: { ok: boolean; code: string; reason: string }; isGovernor: boolean };
  governor: Ref;
  lastResult: { winner: { votes: number } };
}
interface StateBody { code: string; state: LifeState }
interface VoteBody { code: string; reason: string; gov: { election: { yourVote: string; totalVotes: number } } }
interface AnnounceBody { code: string; gov: { announcements: { text: string }[] } }
interface PulseBody { checkedIn: boolean; hunt: { found: number; claims: number }; gov: { governor: Ref }; notices: { kind: string }[] }
interface AdsBody { sea: { plots: { slot: string; row: number; col: number; text: string; colour: string; icon: string; by: Ref; mine: boolean }[] } }
/** A player: the session cookie and the public id. */
interface Who { name: string; cookie: string; id: string }
/** The socket messages this script reads. */
interface Member { name: string; enabled: boolean; muted: boolean }
interface SocketMessage { type: string }
interface PresenceMessage extends SocketMessage { members: Member[] }
interface PeopleMessage extends SocketMessage { venue: string; self: string; players: unknown[] }
interface FromMessage extends SocketMessage { from: Ref }
interface ByMessage extends SocketMessage { by: Ref }
interface AnswerMessage extends SocketMessage { answer: string }
interface ErrorMessage extends SocketMessage { code: string }
interface ChatMessage extends SocketMessage { body: string; from: Ref }
interface DmMessage extends SocketMessage { message: { body: string }; conv: { kind: string } }
interface TransferMessage extends SocketMessage { amount: number }
interface Peer {
  send(message: Json): void;
  next(): Promise<SocketMessage>;
  /** Read until a message of this type arrives. */
  until<T extends SocketMessage = SocketMessage>(type: string): Promise<T>;
  /** Everything already received and not yet read. */
  drain(): SocketMessage[];
  close(): void;
}
export interface TwoPlayersOptions { log?: (line: string) => void; saltPrefix?: string }

/** Narrow away null and undefined; the script fails here, as a property read on the missing value would. */
function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new TypeError(`${what} is missing`);
  return value;
}

const CITY = 'lagos';
const HOUR = 3600000, DAY = 24 * HOUR;
const naira = (value: number) => `₦${value.toLocaleString('en-NG')}`;
const LOOKS: Record<string, Look> = {
  Ada: { body: 'woman', hair: 'afro', outfit: 'owambe', fabric: 'ankara', skin: 'skin-3', hairColor: 'black', outfitColor: 'gold', bottomsColor: 'teal' },
  Bola: { body: 'man', hair: 'low-cut', outfit: 'hoodie', fabric: 'plain', skin: 'skin-5', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' },
};
/** Saturday 3 January 2026, 10:00 in Lagos: two Lagos days before Monday's nominations open. */
/** Where each of them settles: the local government they pick, and so where their free starter house stands. */
const LGAS: Record<string, string> = { Ada: 'ikeja', Bola: 'surulere' };
const START = Date.UTC(2026, 0, 3, 9);
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 0, day, hour - 1, minute); // Lagos wall time → server ms

/** Salts are handed out in the order lives are created: `<SALT_PREFIX>-0000`, `-0001`, … (see the header). */
export const SALT_PREFIX = 'two-players-salt';

export async function runTwoPlayers({ log = console.log, saltPrefix = SALT_PREFIX }: TwoPlayersOptions = {}): Promise<{ steps: number }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'joinallworld-two-players-'));
  let time = START, step = 0, ids = 0, lives = 0;
  useSaltSourceForTests(() => `${saltPrefix}-${String(lives++).padStart(4, '0')}`);
  const server = await createServer({ dataDir, now: () => time, distDir: join(dataDir, 'no-dist') }) as unknown as TwoPlayersServer;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sockets: WebSocket[] = [], heard: unknown[] = [];

  const say = (title: string, note = '') => log(`${String(++step).padStart(2, '0')}  ${title.padEnd(64)}${note ? `· ${note}` : ''}`);
  const stamp = () => { const t = lagosTime(time); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.weekday]} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`; };
  // Client ids and request ids are made the way the browser makes them: server time, then a UUID (server/routes/once.ts).
  const clientId = () => `${time}:00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
  const nextAction = () => `${time}:00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

  async function http<T extends object = Json>(path: string, body: unknown, who?: Who): Promise<Reply<T>> {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(who ? { Cookie: who.cookie } : {}) } });
    const json = await response.json() as T;
    heard.push(json);
    return { status: response.status, headers: response.headers, ...json };
  }
  const get = <T extends object = Json>(path: string, who?: Who) => http<T>(path, null, who);
  const post = <T extends object = Json>(path: string, body: unknown, who?: Who) => http<T>(path, body, who);
  const life = async (who: Who) => (await get<LifeResponse>(`/api/life?city=${CITY}`, who)).state;
  async function act(who: Who, type: string, payload?: Json): Promise<ActionReply> {
    const result = await post<ActionResponse>('/api/action', { actionId: nextAction(), cityId: CITY, type, ...(payload ? { payload } : {}) }, who);
    assert.equal(result.status, 200, `${type}: HTTP ${result.status} ${result.error ?? ''}`);
    return result;
  }
  async function ok(who: Who, type: string, payload: Json | undefined, code?: string) {
    const result = await act(who, type, payload);
    assert.equal(result.ok, true, `${who.name} ${type} was refused: ${result.code} — ${result.reason}`);
    if (code) assert.equal(result.code, code, `${who.name} ${type}`);
    return result.state;
  }
  const view = (state: LifeState) => viewLife(createLife(state, { now: time, cityId: CITY }), { now: time, cityId: CITY });
  const wait = (ms: number) => { time += ms; };
  const goTo = (when: number) => { assert.ok(when >= time, 'the clock only moves forward'); time = when; };

  /** A socket as the browser opens it: the session cookie and a same-origin Origin header. */
  async function socket(who: Who): Promise<Peer> {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket', { headers: { Cookie: who.cookie, Origin: base } });
    sockets.push(ws);
    const queue: SocketMessage[] = [], waiting: Array<(message: SocketMessage) => void> = [];
    ws.on('message', (data) => { const message = JSON.parse(data.toString()) as SocketMessage; heard.push(message); const next = waiting.shift(); if (next) next(message); else queue.push(message); });
    await once(ws, 'open');
    const next = (): Promise<SocketMessage> => { const queued = queue.shift(); return queued ? Promise.resolve(queued) : new Promise<SocketMessage>((done, fail) => { const timer = setTimeout(() => fail(Error(`${who.name}: no socket message`)), 3000); waiting.push((message) => { clearTimeout(timer); done(message); }); }); };
    return {
      send: (message: Json) => ws.send(JSON.stringify(message)),
      next,
      async until<T extends SocketMessage = SocketMessage>(type: string): Promise<T> { for (let i = 0; i < 200; i++) { const message = await next(); if (message.type === type) return message as T; } throw Error(`${who.name}: no ${type} message`); },
      drain() { return queue.splice(0); },
      close() { ws.terminate(); },
    };
  }

  const huntOf = (state: LifeState) => must(state.civic.hunt);
  /** Travel and wait out the trip. A roadside event on arrival is answered with its last choice (never costs money). */
  async function travel(who: Who, id: string, mode = 'danfo') {
    const started = await ok(who, 'travel', { id, mode }, 'started');
    wait(must(started.activeAction).duration * 1000);
    let state = await life(who);
    assert.equal(state.location, id, `${who.name} arrived at ${id}`);
    if (state.travel.event) {
      assert.ok(EVENTS[state.travel.event.id]);
      state = await ok(who, 'world.roadside', { choice: must(must(view(state).travel.event).choices.at(-1)).id }, 'resolved');
    }
    return state;
  }
  /** One Community helper shift at Freedom Park (the player is already there and already has the job). */
  async function helperShift(who: Who) {
    await ok(who, 'spot', { id: 'work' }, 'selected');
    const shift = await ok(who, 'activity', { id: 'helper-shift' }, 'started');
    wait(must(shift.activeAction).duration * 1000);
    return life(who);
  }

  async function joinRoom(peer: Peer, venueId: string) { peer.send({ type: 'join', cityId: CITY, venueId }); return peer.until<PresenceMessage>('presence'); }

  /** A new device session, as the quick start makes it: a name, a look, and straight into Freedom Park as a guest. */
  async function arrive(name: string) {
    const opened = await post<SessionBody>('/api/session', { name, onboarding: true });
    assert.equal(opened.status, 200);
    const who: Who = { name, cookie: must(opened.headers.get('set-cookie')).split(';')[0] ?? '', id: opened.session.id };
    assert.notEqual(who.id, who.cookie.slice(4), 'the public id is not the cookie');
    const blocked = await act(who, 'travel', { id: 'park', mode: 'trek' });
    assert.equal(blocked.code, 'onboarding_required');
    const playing = await ok(who, 'onboarding.quick-start', { look: LOOKS[name] }, 'playing');
    assert.deepEqual([playing.location, playing.onboarding.stage, playing.onboarding.required, playing.spot], ['park', 'guest', false, 'trees']);
    // The first goal is the first thing a new player does: a round of Ayo under the trees.
    const round = await ok(who, 'activity', { id: 'play-ayo' }, 'started');
    wait(must(round.activeAction).duration * 1000);
    assert.ok((await life(who)).ledger.some((entry) => entry.reason === 'Goal: Play a round of Ayo'), `${name}: the round of Ayo paid the first goal`);
    return who;
  }
  /** Settle in: the deferred choices, then the home. Everything earned as a guest is kept. */
  async function settle(who: Who) {
    const before = (await life(who)).cash;
    await ok(who, 'onboarding.traits', { traits: ['smooth-talker', 'clean-pikin'] }, 'traits_saved');
    await ok(who, 'onboarding.dream', { dream: 'everybodys-padi' }, 'dream_saved');
    const rolled = await ok(who, 'onboarding.lottery', {}, 'rolled');
    // Where they live: each picks a local government and is given the free starter house on a plot there. No weekly rent.
    const own = view(rolled).onboarding.own, lga = must(LGAS[who.name]);
    const moved = await ok(who, 'onboarding.home', { lga, via: 'manual' }, 'life_started');
    assert.deepEqual([moved.location, moved.onboarding.done, moved.onboarding.stage, moved.estate.lga, moved.estate.lgaConfirmed, moved.estate.living, moved.economy.rent.house], ['home', true, 'settled', lga, true, 'own', null]);
    assert.equal(moved.cash, must(own.startCash) + (before - 5000) + (moved.ledger.some((entry) => entry.reason === 'Goal: Settle in') ? 1000 : 0), `${who.name}: the start cash of the birth lottery, plus what was earned as a guest`);
    return { who, outcome: must(view(moved).onboarding.lottery).label, home: `starter house in ${must(view(moved).estate.lga).name}`, cash: moved.cash };
  }

  try {
    log(`Two players · server clock starts ${new Date(time).toISOString()} (${stamp()} in Lagos)`);

    // ---- 1. the quick start: Ada is playing in seconds; Bola arrives by her link and is told he is joining her ----
    const ada = await arrive('Ada');
    const firstRoom = await socket(ada);
    await joinRoom(firstRoom, 'park');
    assert.equal((await get<SocialMeBody>('/api/social/me', ada)).me.name, 'Ada'); // her Invite app is open: that is where the link comes from
    const bola = await arrive('Bola');
    const landing = await post<JoinBody>('/api/social/join', { host: ada.id, cityId: CITY }, bola);
    assert.deepEqual([landing.ok, landing.code, landing.host, landing.venue], [true, 'here', { id: ada.id, name: 'Ada' }, 'park'], 'her link puts him where she is: the park they both arrived in');
    assert.equal((await post<JoinBody>('/api/social/join', { host: bola.id, cityId: CITY }, bola)).code, 'self');
    firstRoom.close();
    say('Ada and Bola quick-start into Freedom Park as guests', `Bola opened Ada’s link: “You’re joining ${landing.host.name}” at ${must(VENUES[landing.venue], 'registered venue').label}`);

    // ---- 1b. both settle in; nothing earned as a guest is lost ---------------------------------------
    const a = await settle(ada), b = await settle(bola);
    assert.equal((await get<SocialMeBody>('/api/social/me', ada)).me.name, 'Ada');
    assert.equal((await get<SocialMeBody>('/api/social/me', bola)).me.name, 'Bola');
    say('Ada and Bola settle in and move in', `Ada: ${a.outcome}, ${a.home}, ${naira(a.cash)} · Bola: ${b.outcome}, ${b.home}, ${naira(b.cash)}`);

    // ---- 2. they meet at Freedom Park: truthful presence --------------------------------------------
    const roomA = await socket(ada), roomB = await socket(bola), liveA = await socket(ada), liveB = await socket(bola);
    await travel(ada, 'park'); await travel(bola, 'park');
    liveA.send({ type: 'people-list', cityId: CITY });
    const before = await liveA.until<PeopleMessage>('people');
    assert.deepEqual([before.venue, before.self, before.players], ['park', 'not_joined', []], 'before the room is joined the listing says so instead of showing an empty park');
    await joinRoom(roomA, 'park');
    const together = await joinRoom(roomB, 'park');
    assert.deepEqual(together.members.map((member) => member.name).sort(), ['Ada', 'Bola']);
    assert.ok(together.members.every((member) => member.enabled === false && member.muted === true), 'nobody is in voice');
    assert.deepEqual(await liveA.until('people-changed'), { type: 'people-changed', cityId: CITY, venueId: 'park' });
    const listing = await get<PeopleBody>(`/api/social/people?city=${CITY}`, ada);
    assert.deepEqual(listing.players.map((player) => [player.id, player.name, player.here]), [[bola.id, 'Bola', true]]);
    assert.deepEqual(must(listing.players[0]).look, LOOKS.Bola, 'Bola’s avatar is drawn from the look the server holds');
    assert.deepEqual((await get<PeopleBody>(`/api/social/people?city=${CITY}`, bola)).players.map((player) => player.name), ['Ada']);
    // Bola walks off: both views follow at once; he comes back.
    liveA.drain();
    const leaving = await ok(bola, 'travel', { id: 'library', mode: 'trek' }, 'started');
    await liveA.until('people-changed');
    assert.deepEqual((await get<PeopleBody>(`/api/social/people?city=${CITY}`, ada)).players, []);
    assert.equal((await get<PeopleBody>(`/api/social/people?city=${CITY}`, bola)).self, 'travelling');
    wait(must(leaving.activeAction).duration * 1000);
    await life(bola);
    await travel(bola, 'park', 'trek');
    await joinRoom(roomB, 'park');
    assert.deepEqual((await get<PeopleBody>(`/api/social/people?city=${CITY}`, ada)).players.map((player) => player.name), ['Bola']);
    say('they meet at Freedom Park', 'each sees the other in the room; Bola leaves and the list empties at once; he returns');

    // ---- 3. friend request → accept ----------------------------------------------------------------
    const asked = await post('/api/social/friends/request', { to: ada.id, cityId: CITY }, bola);
    assert.equal(asked.code, 'requested');
    assert.deepEqual((await liveA.until<FromMessage>('friend-request')).from, { id: bola.id, name: 'Bola' });
    const accepted = await post('/api/social/friends/answer', { from: bola.id, accept: true, cityId: CITY }, ada);
    assert.equal(accepted.code, 'accepted');
    assert.equal((await post('/api/social/friends/answer', { from: bola.id, accept: true, cityId: CITY }, ada)).duplicate, true, 'accepting twice changes nothing');
    assert.deepEqual((await liveB.until<ByMessage>('friend-accepted')).by, { id: ada.id, name: 'Ada' });
    const friendsA = (await get<SocialMeBody>('/api/social/me', ada)).friends, friendsB = (await get<SocialMeBody>('/api/social/me', bola)).friends;
    assert.deepEqual([friendsA.map((friend) => [friend.name, friend.status, friend.venue]), friendsB.map((friend) => [friend.name, friend.status, friend.venue])], [[['Bola', 'online', 'park']], [['Ada', 'online', 'park']]]);
    assert.deepEqual([must((await life(ada)).social.rel[bola.id]).friend, must((await life(bola)).social.rel[ada.id]).friend], [true, true], 'the friendship is in both lives');
    say('Bola asks, Ada accepts', 'friends in both lists and both lives; each sees the other online at Freedom Park');

    // ---- 4. a direct message, sent twice by a retry, stored once -------------------------------------
    liveB.drain();
    const messageId = clientId();
    const sent = await post<MessageBody>('/api/social/messages', { to: bola.id, body: 'Come and see my place <3', clientId: messageId }, ada);
    const retried = await post<MessageBody>('/api/social/messages', { to: bola.id, body: 'Come and see my place <3', clientId: messageId }, ada);
    assert.deepEqual([sent.code, sent.duplicate, retried.code, retried.duplicate, retried.message.id], ['sent', undefined, 'sent', true, sent.message.id]);
    assert.equal((await post<MessageBody>('/api/social/messages', { to: bola.id, body: 'A different text', clientId: messageId }, ada)).status, 409, 'the same client id with another body is refused');
    assert.equal((await post<MessageBody>('/api/social/messages', { conv: sent.conv.id, body: 'On my way!', clientId: clientId() }, bola)).code, 'sent');
    const first = await liveB.until<DmMessage>('dm'), second = await liveB.until<DmMessage>('dm');
    assert.deepEqual([first.message.body, second.message.body], ['Come and see my place <3', 'On my way!'], 'the retry was not delivered a second time');
    const thread = await get<ThreadBody>(`/api/social/conversations/${sent.conv.id}`, bola);
    assert.deepEqual(thread.messages.map((message) => [message.from.name, message.body]), [['Ada', 'Come and see my place <3'], ['Bola', 'On my way!']]);
    say('Ada messages Bola; her client retries the send', 'stored once, delivered once; Bola replies');

    // ---- 5. a house visit: knock → let in → the host’s Home room → house chat → the visit ends ---------
    liveB.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
    assert.equal((await liveB.until<ErrorMessage>('error')).code, 'not_a_guest', 'a friend is not a guest');
    assert.equal((await post('/api/social/house/knock', { host: ada.id, cityId: CITY }, bola)).code, 'host_not_home');
    await travel(ada, 'home');
    roomA.drain(); // presence messages from the park are still queued; wait for the one this join produces
    await joinRoom(roomA, 'home');
    const knock = await post('/api/social/house/knock', { host: ada.id, cityId: CITY }, bola);
    assert.equal(knock.code, 'knocking');
    assert.deepEqual((await liveA.until<FromMessage>('invite-knock')).from, { id: bola.id, name: 'Bola' });
    const letIn = await post('/api/social/house/answer', { visitor: bola.id, answer: 'accept' }, ada);
    assert.equal(letIn.code, 'accepted');
    assert.equal((await liveB.until<AnswerMessage>('invite-answer')).answer, 'accepted');
    assert.equal(must((await get<SocialMeBody>('/api/social/me', bola)).visiting).host.id, ada.id);
    liveB.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
    const inside = await liveB.until<PresenceMessage>('presence');
    assert.deepEqual(inside.members.map((member) => member.name).sort(), ['Ada', 'Bola']);
    assert.ok(inside.members.every((member) => member.enabled === false && member.muted === true), 'a house visit does not turn voice on');
    await roomA.until<PresenceMessage>('presence');
    assert.deepEqual((await get<PeopleBody>(`/api/social/people?city=${CITY}`, ada)).players.map((player) => [player.name, player.here]), [['Bola', true]], 'the host sees her guest in her home');
    // Chat in the room, and the stored house conversation.
    liveB.send({ type: 'chat', body: 'Nice place!', clientId: 'house-1' });
    assert.deepEqual([(await roomA.until<ChatMessage>('chat')).body, (await liveB.until<ChatMessage>('chat')).from.name], ['Nice place!', 'Bola']);
    roomA.send({ type: 'chat', body: 'Thank you o', clientId: 'house-2' });
    assert.equal((await liveB.until<ChatMessage>('chat')).body, 'Thank you o');
    assert.equal((await post<MessageBody>('/api/social/messages', { conv: `h.${ada.id}`, body: 'There is jollof', clientId: clientId() }, ada)).code, 'sent');
    const houseDm = await liveB.until<DmMessage>('dm');
    assert.deepEqual([houseDm.conv.kind, houseDm.message.body], ['house', 'There is jollof']);
    // The visit ends: Bola leaves, is out of the room at once, and cannot walk back in.
    assert.equal((await post('/api/social/house/leave', { host: ada.id }, bola)).code, 'left');
    assert.equal((await liveB.until<ErrorMessage>('error')).code, 'visit_ended');
    liveB.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
    assert.equal((await liveB.until<ErrorMessage>('error')).code, 'not_a_guest');
    assert.deepEqual([(await get<SocialMeBody>('/api/social/me', ada)).house.guests, (await get<SocialMeBody>('/api/social/me', bola)).visiting], [[], null]);
    assert.equal((await get<ThreadBody>(`/api/social/conversations/h.${ada.id}`, bola)).code, 'not_a_member');
    say('Bola knocks, Ada lets him in, he joins her home room', 'room chat and house chat both ways; he leaves and the room and chat close to him');

    // ---- 6. Ada works a shift, and a day later gives part of her wages to Bola -----------------------
    await travel(ada, 'park');
    await ok(ada, 'apply-job', { id: 'teaching' }, 'applied');
    assert.equal((await life(ada)).activeAction, null, '“Go automatically” waits for the tutorial');
    await ok(ada, 'spot', { id: 'work' }, 'selected');
    const shift = await ok(ada, 'activity', { id: 'teaching-shift' }, 'started');
    wait(must(shift.activeAction).duration * 1000);
    const paid = await life(ada);
    // A shift is work, not the first goal: nothing but the wage is paid for it (the opening goals were paid when they were met).
    const wage = must(paid.ledger.findLast((entry) => entry.reason === 'Teaching shift'));
    assert.deepEqual([wage.amount, paid.social.earned, paid.ledger.slice(paid.ledger.indexOf(wage) + 1).map((entry) => entry.reason)], [3000, 3000, []]);
    goTo(START + 25 * HOUR);
    const beforeA = (await life(ada)).cash, beforeB = (await life(bola)).cash;
    const tooMuch = await post<TransferBody>('/api/social/transfers', { to: bola.id, amount: 4000, cityId: CITY, clientId: clientId() }, ada);
    assert.equal(tooMuch.code, 'gift_exceeds_earned'); assert.match(must(tooMuch.reason), /You can still give ₦3,000/);
    const giftId = clientId();
    const gift = await post<TransferBody>('/api/social/transfers', { to: bola.id, amount: 1500, cityId: CITY, clientId: giftId }, ada);
    const giftAgain = await post<TransferBody>('/api/social/transfers', { to: bola.id, amount: 1500, cityId: CITY, clientId: giftId }, ada);
    assert.deepEqual([gift.code, gift.credited, gift.balance, giftAgain.code, giftAgain.duplicate, giftAgain.balance], ['sent', true, beforeA - 1500, 'sent', true, beforeA - 1500]);
    const afterA = await life(ada), afterB = await life(bola);
    assert.deepEqual([afterA.cash, afterB.cash], [beforeA - 1500, beforeB + 1500]);
    assert.equal(afterA.ledger.filter((entry) => entry.reason === 'Transfer to Bola').length, 1, 'debited once');
    assert.equal(afterB.ledger.filter((entry) => entry.reason === 'Transfer from Ada').length, 1, 'credited once');
    assert.equal((await liveB.until<TransferMessage>('transfer')).amount, 1500);
    assert.ok((await get<SocialMeBody>('/api/social/me', bola)).updates.some((update) => update.text === 'Ada sent you ₦1,500.'));
    assert.equal((await post<TransferBody>('/api/social/transfers', { to: ada.id, amount: 500, cityId: CITY, clientId: clientId() }, bola)).code, 'earn_first', 'a gift is not wages: Bola cannot pass it on');
    // Bola takes the starter job and works his first paid shift: Sunday is his first day worked.
    await ok(bola, 'apply-job', { id: 'community-helper' }, 'applied');
    assert.equal((await helperShift(bola)).civic.work.days, 1);
    say('Ada earns ₦3,000 teaching and, a day later, sends Bola ₦1,500', `refused above what she earned; one debit (${naira(afterA.cash)}), one credit (${naira(afterB.cash)})`);

    // ---- 7. Monday: Ada declares for Governor ------------------------------------------------------
    goTo(at(5, 9));
    let gov = await get<GovBody>(`/api/civic/gov?city=${CITY}`, ada);
    // Old enough, but paid for work on one day only (Saturday): the server says exactly what is missing.
    assert.deepEqual([gov.phase, gov.you.days, gov.you.run.ok, gov.you.run.code], ['nominations', 2, false, 'work_days']);
    assert.match(gov.you.run.reason, /paid for work on 1 day\. Finish a paid shift or gig on 1 more day/);
    assert.equal((await post<StateBody>('/api/civic/gov/run', { cityId: CITY, slogan: 'Light for every street', requestId: clientId() }, ada)).code, 'work_days');
    await ok(ada, 'spot', { id: 'drinks' }, 'selected');
    const lunch = await ok(ada, 'activity', { id: 'park-palmwine' }, 'started');
    wait(must(lunch.activeAction).duration * 1000);
    await life(ada);
    await ok(ada, 'spot', { id: 'work' }, 'selected');
    const monday = await ok(ada, 'activity', { id: 'teaching-shift' }, 'started');
    wait(must(monday.activeAction).duration * 1000);
    assert.equal((await life(ada)).civic.work.days, 2);
    assert.equal((await helperShift(bola)).civic.work.days, 2, 'Bola’s second day worked');
    gov = await get<GovBody>(`/api/civic/gov?city=${CITY}`, ada);
    assert.deepEqual([gov.phase, gov.you.days, gov.you.run.ok], ['nominations', 2, true]);
    const fee = (await life(ada)).cash;
    const declared = await post<StateBody>('/api/civic/gov/run', { cityId: CITY, slogan: 'Light for every street', requestId: clientId() }, ada);
    assert.deepEqual([declared.code, declared.state.cash, must(declared.state.ledger.at(-1)).reason], ['declared', fee - 2000, 'Governorship filing fee']);
    assert.equal((await post<StateBody>('/api/civic/gov/run', { cityId: CITY, slogan: 'Again', requestId: clientId() }, ada)).code, 'already_candidate');
    assert.equal((await act(ada, 'civic.run', {})).code, 'server_only', 'the fee cannot be paid outside the election route');
    assert.equal((await post<VoteBody>('/api/civic/gov/vote', { cityId: CITY, candidate: ada.id }, bola)).code, 'polls_closed');
    say('Monday: Ada declares for Governor', `refused until she had been paid for work on two different days; filing fee ₦2,000 paid once (${naira(declared.state.cash)}); voting is not open yet`);

    // ---- 8. Tuesday: Bola completes the daily gem hunt and is paid once ------------------------------
    goTo(at(6, 9));
    let hunter = await life(bola);
    const huntDay = huntOf(hunter).day;
    assert.equal(huntOf(hunter).gems.length, 3);
    for (let round = 0; round < 3; round++) {
      hunter = await life(bola);
      const left = huntOf(hunter).gems.filter((gem) => !gem.found);
      if (!left.length) break;
      let gem = left.find((item) => isOpen(must(VENUES[item.venue], 'registered venue').hours, time));
      if (!gem) {
        gem = left.reduce((best, item) => (minutesUntilOpen(must(VENUES[item.venue], 'registered venue').hours, time) < minutesUntilOpen(must(VENUES[best.venue], 'registered venue').hours, time) ? item : best));
        assert.equal((await act(bola, 'travel', { id: gem.venue, mode: 'trek' })).code, 'closed');
        wait(minutesUntilOpen(must(VENUES[gem.venue], 'registered venue').hours, time) * 60000);
      }
      if (hunter.location !== gem.venue) hunter = await travel(bola, gem.venue, 'danfo');
      const index = huntOf(hunter).gems.findIndex((item) => item.venue === gem.venue && item.kind === gem.kind && item.spot === gem.spot);
      if (!must(huntOf(hunter).gems[index]).found) {
        if (gem.kind === 'activity') {
          assert.equal((await act(bola, 'civic.hunt-search')).code, 'activity_needed');
          const regular = must(Object.values(NPCS).find((npc) => npc.venue === gem.venue));
          await ok(bola, 'spot', { id: 'people' }, 'selected');
          const hello = await ok(bola, 'activity', { id: `npc-${regular.id}-hello` }, 'started');
          wait(must(hello.activeAction).duration * 1000);
        } else {
          if (gem.spot && hunter.spot !== gem.spot) await ok(bola, 'spot', { id: gem.spot }, 'selected');
          await ok(bola, 'civic.hunt-search', undefined, 'found');
        }
      }
      hunter = await life(bola);
      assert.equal(must(huntOf(hunter).gems[index]).found, true, JSON.stringify(gem));
    }
    assert.equal(huntOf(hunter).day, huntDay, 'all three gems were found within one Lagos day');
    assert.equal((await act(bola, 'civic.hunt-search')).code, 'hunt_complete');
    const prizeBefore = hunter.cash;
    const [claimA, claimB] = await Promise.all([act(bola, 'civic.hunt-claim'), act(bola, 'civic.hunt-claim')]);
    assert.deepEqual([claimA.code, claimB.code].sort(), ['already_claimed', 'claimed'], 'two claims at once pay once');
    hunter = await life(bola);
    assert.equal(hunter.cash, prizeBefore + 3000);
    assert.equal(hunter.ledger.filter((entry) => entry.reason === 'Daily gem hunt prize').length, 1);
    assert.equal((await act(bola, 'civic.hunt-claim')).code, 'already_claimed');
    const counter = await get<PulseBody>(`/api/civic/pulse?city=${CITY}`, bola);
    assert.deepEqual([counter.hunt.found >= 3, counter.hunt.claims], [true, 1]);
    say('Tuesday: Bola finds all three gems and claims the prize', `${huntOf(hunter).gems.map((gem) => must(VENUES[gem.venue], 'registered venue').label).join(', ')} · +₦3,000 once (${naira(hunter.cash)})`);

    // ---- 9. Thursday: Bola votes at the Polling Unit -------------------------------------------------
    goTo(at(8, 9));
    await life(bola);
    const afar = await post<VoteBody>('/api/civic/gov/vote', { cityId: CITY, candidate: ada.id }, bola);
    assert.equal(afar.code, 'wrong_place'); assert.match(afar.reason, /Travel to Polling Unit/);
    await travel(bola, 'polling-unit', 'danfo');
    const voted = await post<VoteBody>('/api/civic/gov/vote', { cityId: CITY, candidate: ada.id }, bola);
    assert.deepEqual([voted.code, voted.gov.election.yourVote, voted.gov.election.totalVotes], ['voted', ada.id, 1]);
    assert.equal((await post<VoteBody>('/api/civic/gov/vote', { cityId: CITY, candidate: ada.id }, bola)).code, 'already_voted');
    assert.equal((await act(bola, 'civic.vote', {})).code, 'server_only');
    say('Thursday: Bola votes for Ada at the Polling Unit', 'refused from elsewhere; one vote, counted once');

    // ---- 10. Sunday: Ada is Governor; her announcement reaches Bola’s Updates -------------------------
    goTo(at(11, 0, 30));
    gov = await get<GovBody>(`/api/civic/gov?city=${CITY}`, ada);
    assert.deepEqual([gov.phase, gov.governor.id, gov.governor.name, gov.you.isGovernor, gov.lastResult.winner.votes], ['results', ada.id, 'Ada', true, 1]);
    assert.equal((await post<AnnounceBody>('/api/civic/gov/announce', { cityId: CITY, text: 'Everybody is in charge' }, bola)).code, 'not_governor');
    const announced = await post<AnnounceBody>('/api/civic/gov/announce', { cityId: CITY, text: 'Sanitation day is <b>Saturday</b>' }, ada);
    assert.deepEqual([announced.code, must(announced.gov.announcements[0]).text], ['announced', 'Sanitation day is <b>Saturday</b>']);
    wait(15000);
    const pulse = await get<PulseBody>(`/api/civic/pulse?city=${CITY}`, bola);
    assert.deepEqual([pulse.checkedIn, pulse.gov.governor.name, must(pulse.notices[0]).kind], [true, 'Ada', 'announcement']);
    const updates = (await life(bola)).social.notices.map((notice) => notice.text);
    assert.ok(updates.includes('Ada is the new Governor of Lagos: Elected with 1 of 1 vote.'), 'the result is in Bola’s Updates');
    assert.ok(updates.includes('Governor Ada announced: Sanitation day is <b>Saturday</b>'), 'the announcement is in Bola’s Updates, stored as text');
    wait(15000);
    await get<PulseBody>(`/api/civic/pulse?city=${CITY}`, bola);
    const again = (await life(bola)).social.notices.map((notice) => notice.text);
    assert.equal(again.filter((text) => text.startsWith('Governor Ada announced')).length, 1, 'posted once, however often he checks in');
    assert.ok(!again.some((text) => text.startsWith('Rent paid:') || text.startsWith('Rent missed:')), 'he lives in his own starter house: Saturday brought no rent');
    say('Sunday: Ada is Governor and posts an announcement', 'it and the result are in Bola’s Updates, once; no rent notice — he lives in his own house');

    // ---- 11. Bola rents a sea plot; it is in the public ads listing ---------------------------------
    const seaBefore = (await life(bola)).cash;
    const rented = await post<StateBody>('/api/civic/ads/rent', { cityId: CITY, kind: 'sea', slot: 'sea-3-4', text: 'Bola Fabrics', colour: 'gold', icon: 'shop', link: 'https://example.com', image: 'x', requestId: clientId() }, bola);
    assert.deepEqual([rented.code, rented.state.cash], ['rented', seaBefore - 100]);
    assert.equal((await post<StateBody>('/api/civic/ads/rent', { cityId: CITY, kind: 'sea', slot: 'sea-3-4', text: 'Ada Books', colour: 'blue', icon: 'book', requestId: clientId() }, ada)).code, 'slot_taken');
    const ads = await get<AdsBody>(`/api/civic/ads?city=${CITY}`);
    assert.deepEqual(ads.sea.plots.map((plot) => [plot.slot, plot.row, plot.col, plot.text, plot.colour, plot.icon, plot.by.name, plot.mine]), [['sea-3-4', 3, 4, 'Bola Fabrics', 'gold', 'shop', 'Bola', false]]);
    assert.deepEqual(Object.keys(must(ads.sea.plots[0])).sort(), ['at', 'by', 'col', 'colour', 'expiresAt', 'icon', 'mine', 'price', 'row', 'slot', 'text'], 'text, colour and icon only: no link, no image');
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
    useSaltSourceForTests(); // back to random salts for anything else in this process
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
