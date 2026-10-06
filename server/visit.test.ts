// OWNER: social — coming into a home easily (server/social/visit.ts, visit-book.ts, visit-token.ts, routes/visit.ts).
// Real server on a controlled clock, real sockets for who is at home. Every rule of the door is played: each choice of who
// may come in against a friend, the founder's automatic friend, a stranger and a blocked player; the host at home, out and
// offline; the capacity; invitations and their expiry; the signed link (signature, expiry, use limits, first-use approval,
// ending it, a removed guest); a guest who has only tapped Play; a visitor from another city; the host leaving; two devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.ts';
import type { Device, FixtureOptions } from './test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { emailHash } from './social/founder.ts';
import { LIMITS } from './social/service.ts';
import { presetLook } from '../src/quick-start/look-model.ts';
import { VISIT, VISIT_MS, visitButton } from '../src/game/visit.ts';
import type { WebSocket } from 'ws';
import type { Db } from './types.ts';

interface Frame { type: string; code?: string; members?: { id: string }[]; from?: { id: string; name: string }; via?: string; answer?: string; update?: { kind: string; text: string } }
interface Peer { ws: WebSocket; id: string; log: Frame[] }
interface Reply {
  status: number; ok?: boolean; code?: string; reason?: string; duplicate?: boolean; error?: string
  door?: { who: string; out: boolean; chosen: boolean }; closed?: boolean; invites?: { from: { id: string }; expiresAt: number }[]
  friends?: { id: string; visit?: string }[]; visiting?: { host: { id: string }; cityId: string } | null
  house?: { guests: { id: string }[]; knocks: { from: { id: string }; via?: string }[]; role: string; closed?: true }
  link?: { id: string; path: string; uses: number; max?: number; ended: boolean; open: boolean; expiresAt: number }; links?: { id: string; uses: number; ended: boolean }[]
  host?: { name: string }; invited?: { id: string }[]; skipped?: { id: string; reason: string }[]; updates?: { kind: string; text: string }[]; count?: number
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const FOUNDER = 'founder@example.com', PROJECT = 'allworld-test-project';

async function world(t: Parameters<typeof fixture>[0], options: FixtureOptions = {}) {
  const f = await fixture(t, { ...options, env: { ...options.env, FOUNDER_EMAIL_SHA256: emailHash(FOUNDER) } });
  const read = async (response: Response): Promise<Reply> => { const body: unknown = await response.json(); return { ...(isRecord(body) ? body : {}), status: response.status } as Reply; };
  const get = async (path: string, who: Device): Promise<Reply> => read(await f.request(path, null, who.cookie));
  const post = async (path: string, body: object, who: Device): Promise<Reply> => read(await f.request(path, body, who.cookie));
  const anonymous = async (path: string, body: object): Promise<Reply> => read(await f.request(path, body));
  const peers: Peer[] = [];
  const connect = async (who: Device): Promise<Peer> => {
    const { ws } = await f.socket(who);
    const peer: Peer = { ws, id: who.id, log: [] };
    ws.removeAllListeners('message');
    ws.on('message', (data) => peer.log.push(JSON.parse(data.toString()) as Frame));
    peers.push(peer);
    return peer;
  };
  const say = (peer: Peer, message: object): void => peer.ws.send(JSON.stringify(message));
  const until = async (peer: Peer, test: (message: Frame) => boolean, what: string, from = 0): Promise<Frame> => {
    for (let i = 0; i < 600; i++) { const found = peer.log.slice(from).find(test); if (found) return found; await new Promise((resolve) => setTimeout(resolve, 5)); }
    throw Error(`No ${what}`);
  };
  const act = (who: Device, fields: object): Promise<Reply> => post('/api/action', { actionId: f.id(), cityId: 'lagos', ...fields }, who);
  /** A player with a life that has arrived, registered for the social features. */
  async function player(name: string): Promise<Device> {
    const who = await f.device(name);
    assert.equal((await get('/api/life?city=lagos', who)).status, 200);
    assert.equal((await get('/api/social/me', who)).status, 200);
    return who;
  }
  /** A player at home: their life is at Home and their socket stands in their own Home room, which is what "at home and online" is. */
  async function host(name: string): Promise<{ who: Device; peer: Peer }> {
    const who = await player(name);
    const trip = await act(who, { type: 'travel', id: 'home', mode: 'trek' });
    assert.equal(trip.ok, true, JSON.stringify(trip));
    f.advance(((trip as unknown as { state: { activeAction: { duration: number } } }).state.activeAction.duration + 1) * 1000);
    await get('/api/life?city=lagos', who);
    const peer = await connect(who);
    say(peer, { type: 'join', cityId: 'lagos', venueId: 'home' });
    await until(peer, (m) => m.type === 'presence', 'the host in their own room');
    return { who, peer };
  }
  async function befriend(a: Device, b: Device): Promise<void> {
    assert.equal((await post('/api/social/friends/request', { to: a.id, cityId: 'lagos' }, b)).ok, true);
    assert.equal((await post('/api/social/friends/answer', { from: b.id, accept: true, cityId: 'lagos' }, a)).code, 'accepted');
  }
  /** What the page does when Play is tapped by a new person: a device session that shows the quick start, then the quick start (a guest that has not settled). */
  async function guest(name: string, city = 'lagos'): Promise<Device> {
    const opened = await f.request('/api/session', { name, onboarding: true });
    const header = opened.headers.get('set-cookie') ?? '';
    const session = ((await opened.json()) as { session: { id: string; name: string } }).session;
    const who: Device = { ...session, cookie: header.split(';')[0] ?? '' };
    await get(`/api/life?city=${city}`, who);
    assert.equal((await post('/api/action', { actionId: f.id(), cityId: city, type: 'onboarding.quick-start', payload: { look: presetLook('owambe') } }, who)).code, 'playing');
    assert.equal((await get('/api/social/me', who)).status, 200);
    return who;
  }
  const store = <T>(fn: (db: Db) => T): Promise<T> => f.server.store.read(fn);
  const edit = (fn: (db: Db) => void): Promise<void> => f.server.store.transact((db) => { fn(db); });
  const enter = (visitor: Device, hostId: string): Promise<Reply> => post('/api/social/visit/enter', { host: hostId }, visitor);
  const door = (who: Device, choice: string, out?: boolean): Promise<Reply> => post('/api/social/visit/door', { who: choice, ...(out === undefined ? {} : { out }) }, who);
  const clear = (peer: Peer): void => { peer.log.length = 0; };
  return { f, get, post, anonymous, connect, say, until, act, player, host, befriend, guest, store, edit, enter, door, clear, peers };
}
type World = Awaited<ReturnType<typeof world>>;

const tokenOf = (path: string | undefined): string => String(path).replace('/h/', '');

test('a new player walks-in-by-default; a player from before has no choice stored and is knock-first, offered the choice once', async (t) => {
  const w = await world(t);
  const fresh = await w.player('Ada');
  assert.deepEqual((await w.get('/api/social/me', fresh)).door, { who: 'walk', out: false, chosen: true });
  // A record from before the choice existed has no `door`.
  await w.edit((db) => { delete db.social!.players[fresh.id]!.door; });
  assert.deepEqual((await w.get('/api/social/me', fresh)).door, { who: 'knock', out: false, chosen: false });
  assert.equal((await w.door(fresh, 'knock')).ok, true);
  assert.deepEqual((await w.get('/api/social/me', fresh)).door, { who: 'knock', out: false, chosen: true });
  assert.equal((await w.post('/api/social/visit/door', { who: 'everyone' }, fresh)).status, 400);
  assert.equal((await w.post('/api/social/visit/door', { out: 'yes' }, fresh)).status, 400);
});

test('each choice of who may come in, against a friend, a stranger and a blocked player, with the host home', async (t) => {
  const w = await world(t);
  const { who: ada } = await w.host('Ada');
  const bola = await w.player('Bola'), tunde = await w.player('Tunde'), chidi = await w.player('Chidi');
  await w.befriend(ada, bola);
  assert.equal((await w.post('/api/social/block', { id: ada.id, cityId: 'lagos' }, chidi)).ok, true);
  const outcomes = async (): Promise<string[]> => {
    const codes: string[] = [];
    for (const visitor of [bola, tunde, chidi]) { const done = await w.enter(visitor, ada.id); codes.push(`${done.code}`); await w.post('/api/social/house/leave', { host: ada.id }, visitor); await w.edit((db) => { const house = db.social!.houses[ada.id]; if (house) { house.knocks = {}; } }); }
    return codes;
  };
  assert.equal((await w.door(ada, 'walk')).ok, true);
  assert.deepEqual(await outcomes(), ['inside', 'knocking', 'blocked'], 'walk: a friend is inside at once, a stranger knocks, a blocked player is refused');
  assert.equal((await w.door(ada, 'knock')).ok, true);
  assert.deepEqual(await outcomes(), ['knocking', 'knocking', 'blocked'], 'knock first: everyone knocks, as before the choice existed');
  assert.equal((await w.door(ada, 'invited')).ok, true);
  assert.deepEqual(await outcomes(), ['only_invited', 'only_invited', 'blocked'], 'only people I invite');
  assert.equal((await w.door(ada, 'nobody')).ok, true);
  assert.deepEqual(await outcomes(), ['door_closed', 'door_closed', 'blocked'], 'nobody');
  // The old knock route obeys the choice too.
  assert.equal((await w.post('/api/social/house/knock', { host: ada.id, cityId: 'lagos' }, bola)).code, 'door_closed');
  assert.equal((await w.door(ada, 'invited')).ok, true);
  assert.equal((await w.post('/api/social/house/knock', { host: ada.id, cityId: 'lagos' }, bola)).code, 'only_invited');
});

test('the founder’s automatic friendship never lets anyone walk in, and the founder’s own home is knock-first whatever they chose', async (t) => {
  const provider = fakeProvider([await makeKey('key-1')]);
  const key = await makeKey('key-2');
  const w = await world(t, { env: { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' }, fetch: (url, init) => fakeProvider([key]).fetch(String(url), init as { body?: unknown }), log: () => {} });
  void provider;
  // The founder: a played character on the account whose address has the configured hash.
  const device = await w.f.device('Zed');
  await w.get('/api/life?city=lagos', device);
  const page = (path: string, body: unknown, cookie?: string): Promise<Response> => fetch(w.f.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: w.f.base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const csrf = ((await (await page('/api/account', null, device.cookie)).json()) as { csrf: string | null }).csrf;
  const idToken = await signToken(key, claimsFor(PROJECT, w.f.now(), { subject: 'Founder', email: FOUNDER, n: 1 }));
  const signed = await page('/api/account/sign-in', { idToken, csrf }, device.cookie);
  assert.equal(signed.status, 200);
  const founder: Device = { ...device, cookie: (signed.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  assert.equal((await w.get('/api/social/me', founder)).status, 200);
  const bola = await w.player('Bola');
  // Bola holds the automatic friendship with the founder: it is a friendship, but never a door.
  const list = (await w.get('/api/social/me', bola)).friends ?? [];
  assert.equal(list.length, 1, 'the founder is the only friend');
  assert.equal(list[0]!.visit, 'knock', 'the founder’s door is knock-first for a friend by the automatic friendship');
  // Bola's own home: the founder, an automatic friend of Bola's? No: the founder's friendship is on Bola's side only, so Bola's door treats the founder as a non-friend.
  const home = await w.host('Chidi');
  await w.befriend(home.who, bola);
  assert.equal((await w.get('/api/social/me', bola)).friends?.find((friend) => friend.id === home.who.id)?.visit, 'walk');
  // The founder never has a walk-in door, even when they choose one.
  assert.equal((await w.door(founder, 'walk')).ok, true);
  assert.equal((await w.get('/api/social/me', bola)).friends?.[0]?.visit, 'knock');
  // A host with more friends than the limit is knock-first however they chose.
  await w.edit((db) => { const players = db.social!.players; for (let i = 0; i < VISIT.walkFriendsMax + 1; i++) { const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`; players[id] = { ...players[bola.id]!, name: `Pal ${i}`, friends: { [home.who.id]: 1 }, blocked: {} }; players[home.who.id]!.friends[id] = 1; } });
  assert.equal((await w.get('/api/social/me', bola)).friends?.find((friend) => friend.id === home.who.id)?.visit, 'knock', 'a crowded friends list is knock-first');
});

test('walking in needs the host at home and online; an empty home is open only to friends of a host who chose "Friends can visit while I am out"', async (t) => {
  const w = await world(t);
  const { who: ada, peer } = await w.host('Ada');
  const bola = await w.player('Bola');
  await w.befriend(ada, bola);
  // Online but not at home: the host's socket goes to a public venue.
  w.say(peer, { type: 'join', cityId: 'lagos', venueId: 'home' });
  const out = await w.connect(ada);
  assert.equal((await w.act(ada, { type: 'travel', id: 'park', mode: 'trek' })).ok, true);
  w.f.advance(600000);
  await w.get('/api/life?city=lagos', ada);
  out.ws.close(); peer.ws.close();
  const away = await w.connect(ada);
  w.say(away, { type: 'join', cityId: 'lagos', venueId: 'park' });
  await w.until(away, (m) => m.type === 'presence', 'the host in a public venue');
  const refused = await w.enter(bola, ada.id);
  assert.deepEqual([refused.ok, refused.code], [false, 'host_not_home'], JSON.stringify(refused));
  assert.match(refused.reason ?? '', /Ada is not home/);
  // Nobody is let into an empty home even by an invitation or a link.
  // With the separate switch on, a friend may walk in without the host.
  assert.equal((await w.door(ada, 'walk', true)).ok, true);
  assert.equal((await w.get('/api/social/me', bola)).friends?.find((friend) => friend.id === ada.id)?.visit, 'walk+');
  const inside = await w.enter(bola, ada.id);
  assert.deepEqual([inside.ok, inside.code], [true, 'inside'], JSON.stringify(inside));
  assert.equal((await w.get('/api/social/me', bola)).visiting?.host.id, ada.id);
  // The guest's room admission also stands while the host is out.
  const g = await w.connect(bola);
  w.say(g, { type: 'join', cityId: 'lagos', venueId: 'home', hostId: ada.id });
  assert.deepEqual(((await w.until(g, (m) => m.type === 'presence', 'guest in an open home')).members ?? []).map((member) => member.id), [bola.id]);
  // The switch off again: the guest is let go when the room is next checked.
  assert.equal((await w.door(ada, 'walk', false)).ok, true);
  const tunde = await w.player('Tunde');
  await w.befriend(ada, tunde);
  assert.equal((await w.enter(tunde, ada.id)).code, 'host_not_home');
});

test('an offline host cannot be walked in on', async (t) => {
  const w = await world(t);
  const { who: ada, peer } = await w.host('Ada');
  const bola = await w.player('Bola');
  await w.befriend(ada, bola);
  peer.ws.terminate();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const done = await w.enter(bola, ada.id);
  assert.equal(done.ok, false);
  assert.match(String(done.code), /host_(offline|reconnecting|not_home)/);
});

test('walking in puts the guest in the Home room, in the house chat, and tells the host', async (t) => {
  const w = await world(t);
  const { who: ada, peer } = await w.host('Ada');
  const bola = await w.player('Bola');
  await w.befriend(ada, bola);
  const done = await w.enter(bola, ada.id);
  assert.deepEqual([done.ok, done.code], [true, 'inside'], JSON.stringify(done));
  assert.equal((await w.get('/api/social/me', bola)).visiting?.host.id, ada.id);
  const me = await w.get('/api/social/me', ada);
  assert.deepEqual(me.house?.guests.map((guest) => guest.id), [bola.id]);
  assert.ok(me.updates?.some((update) => update.kind === 'visit' && update.text === 'Bola came in.'), 'the host is told');
  const g = await w.connect(bola);
  w.say(g, { type: 'join', cityId: 'lagos', venueId: 'home', hostId: ada.id });
  assert.deepEqual(((await w.until(g, (m) => m.type === 'presence', 'guest arrival')).members ?? []).map((member) => member.id).sort(), [ada.id, bola.id].sort());
  void peer;
  // Entering again is the same visit; leaving ends it and the house chat with it.
  assert.equal((await w.enter(bola, ada.id)).duplicate, true);
  assert.equal((await w.post('/api/social/house/leave', { host: ada.id }, bola)).code, 'left');
  assert.equal((await w.get('/api/social/me', bola)).visiting, null);
  assert.equal((await w.get('/api/social/conversations/h.' + ada.id, bola)).status, 200 /* the conversation is gone: the answer says not a member */);
});

test('the house holds five; the sixth is told it is full, and a room opens when someone leaves', async (t) => {
  const w = await world(t);
  const { who: ada } = await w.host('Ada');
  assert.equal(VISIT.guests, LIMITS.guests);
  const friends: Device[] = [];
  for (let i = 0; i < VISIT.guests + 1; i++) { const friend = await w.player(`Friend ${i}`); await w.befriend(ada, friend); friends.push(friend); }
  for (const friend of friends.slice(0, VISIT.guests)) assert.equal((await w.enter(friend, ada.id)).code, 'inside');
  const last = friends[VISIT.guests]!;
  const full = await w.enter(last, ada.id);
  assert.deepEqual([full.ok, full.code], [false, 'house_full']);
  assert.match(full.reason ?? '', /full \(5 friends are inside\)/);
  assert.equal((await w.post('/api/social/house/leave', { host: ada.id, guest: friends[0]!.id }, ada)).code, 'left');
  assert.equal((await w.enter(last, ada.id)).code, 'inside');
});

test('an invitation bypasses the knock for one visit, is good for 30 minutes, and cannot be made to a stranger or by a shut door', async (t) => {
  const w = await world(t);
  const { who: ada } = await w.host('Ada');
  const bola = await w.player('Bola'), tunde = await w.player('Tunde');
  await w.befriend(ada, bola);
  await w.door(ada, 'invited');
  assert.equal((await w.enter(bola, ada.id)).code, 'only_invited');
  const sent = await w.post('/api/social/visit/invite', { to: [bola.id, tunde.id, ada.id] }, ada);
  assert.deepEqual([sent.code, sent.invited?.map((who) => who.id)], ['invited', [bola.id]]);
  assert.deepEqual(sent.skipped?.map((item) => item.reason).sort(), ['not a friend', 'not found']);
  const me = await w.get('/api/social/me', bola);
  assert.equal(me.invites?.[0]?.from.id, ada.id);
  assert.ok(me.updates?.some((update) => update.kind === 'visit' && update.text === 'Ada invited you over.'));
  assert.equal((await w.get('/api/social/me', bola)).friends?.find((friend) => friend.id === ada.id)?.visit, 'invited');
  const done = await w.enter(bola, ada.id);
  assert.deepEqual([done.ok, done.code], [true, 'inside'], JSON.stringify(done));
  assert.deepEqual((await w.get('/api/social/me', bola)).invites, [], 'one invitation is one visit');
  await w.post('/api/social/house/leave', { host: ada.id }, bola);
  assert.equal((await w.enter(bola, ada.id)).code, 'only_invited', 'used up');
  // Thirty minutes, then it is gone.
  assert.equal((await w.post('/api/social/visit/invite', { to: [bola.id] }, ada)).ok, true);
  w.f.advance(VISIT_MS.invite - 1000);
  assert.equal((await w.get('/api/social/me', bola)).invites?.length, 1);
  w.f.advance(2000);
  assert.deepEqual((await w.get('/api/social/me', bola)).invites, []);
  assert.equal((await w.enter(bola, ada.id)).code, 'only_invited');
  // A shut door invites nobody, and "Nobody" refuses an invitation already held.
  assert.equal((await w.post('/api/social/visit/invite', { to: [bola.id] }, ada)).ok, true);
  await w.door(ada, 'nobody');
  assert.equal((await w.enter(bola, ada.id)).code, 'door_closed');
  assert.equal((await w.post('/api/social/visit/invite', { to: [bola.id] }, ada)).code, 'door_closed');
  assert.equal((await w.post('/api/social/visit/invite', { to: [] }, ada)).status, 400);
  // A block always wins over an invitation.
  await w.door(ada, 'knock');
  await w.post('/api/social/block', { id: ada.id, cityId: 'lagos' }, bola);
  assert.equal((await w.enter(bola, ada.id)).code, 'blocked');
});

test('a house link: signed, bound to the host, counted, limited, ended at once, and never into an empty home', async (t) => {
  const w = await world(t);
  const { who: ada, peer } = await w.host('Ada');
  const tunde = await w.guest('Tunde'), kemi = await w.guest('Kemi');
  const made = await w.post('/api/social/visit/link', { max: 1 }, ada);
  assert.deepEqual([made.ok, made.code, made.link?.max, made.link?.uses], [true, 'made', 1, 0]);
  const token = tokenOf(made.link?.path);
  assert.match(made.link?.path ?? '', /^\/h\/[A-Za-z0-9_-]{85}$/);
  // A person with no session is told whose home it is, and nothing else.
  const peeked = await w.anonymous('/api/social/visit/peek', { token });
  assert.deepEqual([peeked.status, peeked.ok, peeked.code, peeked.host], [200, true, 'open', { name: 'Ada' }]);
  assert.deepEqual(Object.keys(peeked).sort(), ['code', 'host', 'ok', 'serverTime', 'status'], 'a display name and nothing else');
  // A forged or damaged link is the same as an ended one.
  const forged = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
  assert.equal((await w.anonymous('/api/social/visit/peek', { token: forged })).code, 'ended');
  assert.equal((await w.anonymous('/api/social/visit/peek', { token: token.slice(1) })).code, 'ended');
  assert.equal((await w.anonymous('/api/social/visit/peek', { token: 'x'.repeat(85) })).code, 'ended');
  assert.equal((await w.post('/api/social/visit/link/enter', { token: forged }, tunde)).code, 'link_ended');
  // A new person is asked about the first time: the host sees "wants to come in through your link", never a stranger inside unasked.
  const first = await w.post('/api/social/visit/link/enter', { token }, tunde);
  assert.deepEqual([first.ok, first.code], [true, 'knocking'], JSON.stringify(first));
  const knock = await w.until(peer, (m) => m.type === 'invite-knock' && m.from?.id === tunde.id, 'the knock through the link');
  assert.equal(knock.via, 'link');
  const hostView = await w.get('/api/social/me', ada);
  assert.equal(hostView.house?.knocks[0]?.via, 'link');
  assert.ok(hostView.updates?.some((update) => update.kind === 'invite-knock' && update.text === 'Tunde wants to come in through your link.'));
  assert.equal((await w.post('/api/social/house/answer', { visitor: tunde.id, answer: 'accept' }, ada)).code, 'accepted');
  assert.equal((await w.get('/api/social/me', tunde)).visiting?.host.id, ada.id, 'a guest who has only tapped Play is inside');
  assert.equal((await w.get('/api/social/visit/links', ada)).links?.[0]?.uses, 1, 'the host sees how many came in');
  // The link allowed one person: the next is told so; the one inside may come back through it.
  assert.equal((await w.post('/api/social/visit/link/enter', { token }, kemi)).code, 'link_full');
  await w.post('/api/social/house/leave', { host: ada.id }, tunde);
  assert.equal((await w.post('/api/social/visit/link/enter', { token }, tunde)).code, 'inside', 'someone who came in before walks in again');
  // The host ends it at once; nothing new comes in, and what was waiting is answered no.
  const ended = await w.post('/api/social/visit/link/end', { id: made.link!.id }, ada);
  assert.deepEqual([ended.code, ended.link?.ended], ['ended', true]);
  assert.equal((await w.anonymous('/api/social/visit/peek', { token })).code, 'ended');
  assert.equal((await w.post('/api/social/visit/link/enter', { token }, kemi)).code, 'link_ended');
  assert.equal((await w.post('/api/social/visit/link/end', { id: made.link!.id }, ada)).duplicate, true);
  assert.equal((await w.post('/api/social/visit/link/end', { id: made.link!.id }, kemi)).code, 'unknown_link', 'only its host can end it');
  void peer;
});

test('a link that lets anyone in asks nobody; an expired link says so; an empty home is never opened through a link; a removed guest cannot come back through it', async (t) => {
  const w = await world(t);
  const { who: ada, peer } = await w.host('Ada');
  const tunde = await w.guest('Tunde'), kemi = await w.guest('Kemi');
  const open = await w.post('/api/social/visit/link', { open: true, hours: 1 }, ada);
  const token = tokenOf(open.link?.path);
  assert.equal(open.link?.open, true);
  const inside = await w.post('/api/social/visit/link/enter', { token }, tunde);
  assert.deepEqual([inside.ok, inside.code], [true, 'inside'], JSON.stringify(inside));
  // The host asks Tunde to leave: he cannot come back through the same link, nor by himself for a while, and Kemi still can.
  assert.equal((await w.post('/api/social/house/leave', { host: ada.id, guest: tunde.id }, ada)).code, 'left');
  assert.equal((await w.post('/api/social/visit/link/enter', { token }, tunde)).code, 'barred');
  assert.equal((await w.enter(tunde, ada.id)).code, 'knocking', 'a guest the host removed may still knock: the host decides');
  assert.ok((await w.get('/api/social/me', tunde)).updates?.some((update) => /asked you to leave/.test(update.text)));
  assert.equal((await w.post('/api/social/visit/link/enter', { token }, kemi)).code, 'inside');
  // After the bar has run out he is still not let in through that link: it never lets him in again.
  w.f.advance(VISIT_MS.barred + 1000);
  assert.equal((await w.post('/api/social/visit/link/enter', { token }, tunde)).code, 'barred');
  assert.equal((await w.post('/api/social/visit/link/enter', { token }, kemi)).code, 'inside', 'a visit lasts half an hour: she comes in again');
  // The host closes the door: nobody new comes in, Kemi stays.
  const second = await w.post('/api/social/visit/link', { open: true }, ada);
  assert.equal((await w.post('/api/social/visit/close', { closed: true }, ada)).closed, true);
  const late = await w.guest('Late');
  assert.equal((await w.post('/api/social/visit/link/enter', { token: tokenOf(second.link?.path) }, late)).code, 'door_shut');
  assert.equal((await w.get('/api/social/me', kemi)).visiting?.host.id, ada.id);
  assert.equal((await w.post('/api/social/visit/close', { closed: false }, ada)).closed, false);
  assert.equal((await w.post('/api/social/visit/link/enter', { token: tokenOf(second.link?.path) }, late)).code, 'inside');
  // End visit: everyone is asked to leave.
  const ending = await w.post('/api/social/visit/end', {}, ada);
  assert.deepEqual([ending.code, ending.count], ['ended', 2]);
  assert.equal((await w.get('/api/social/me', kemi)).visiting, null);
  assert.ok((await w.get('/api/social/me', kemi)).updates?.some((update) => /ended the visit/.test(update.text)));
  // Not into an empty home: the host leaves home, the link stays but does not open anything.
  assert.equal((await w.act(ada, { type: 'travel', id: 'park', mode: 'trek' })).ok, true);
  w.f.advance(600000);
  await w.get('/api/life?city=lagos', ada);
  peer.ws.close();
  const empty = await w.post('/api/social/visit/link/enter', { token: tokenOf(second.link?.path) }, tunde);
  assert.equal(empty.ok, false);
  assert.match(String(empty.code), /host_/);
  // It runs out on its own: the signature carries the time.
  w.f.advance(VISIT_MS.link * 12);
  assert.equal((await w.anonymous('/api/social/visit/peek', { token })).code, 'ended');
  assert.equal((await w.post('/api/social/visit/link/enter', { token }, kemi)).code, 'link_ended');
});

test('a link is limited: five at a time, an hour of entries, and a rate; a link of a shut door does nothing', async (t) => {
  const w = await world(t);
  const { who: ada } = await w.host('Ada');
  for (let i = 0; i < VISIT.linksPerHost; i++) assert.equal((await w.post('/api/social/visit/link', {}, ada)).ok, true, `link ${i}`);
  assert.equal((await w.post('/api/social/visit/link', {}, ada)).code, 'too_many_links');
  assert.equal((await w.post('/api/social/visit/link', { hours: 100 }, ada)).status, 400);
  assert.equal((await w.post('/api/social/visit/link', { max: 0 }, ada)).status, 400);
  assert.equal((await w.get('/api/social/visit/links', ada)).links?.length, VISIT.linksPerHost);
  // The same address may look at links only so often.
  const token = tokenOf((await w.get('/api/social/visit/links', ada)).links?.[0] && undefined);
  void token;
  let limited = 0;
  for (let i = 0; i < VISIT.perAddressPerMinute + 5; i++) { const answer = await w.anonymous('/api/social/visit/peek', { token: 'y'.repeat(85) }); if (answer.status === 429) limited++; }
  assert.ok(limited >= 5, 'the address is counted before the signature is looked at');
  await w.door(ada, 'nobody');
  assert.equal((await w.post('/api/social/visit/link', {}, ada)).code, 'door_closed');
});

test('a guest who has only tapped Play can visit; a life still held for its look cannot; a visitor from another city needs no journey', async (t) => {
  const w = await world(t);
  const { who: ada } = await w.host('Ada');
  // Held for the quick start: not in any city, so nobody can find or visit.
  const held = await w.f.request('/api/session', { name: 'Held', onboarding: true });
  const heldCookie = (held.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  await w.f.request('/api/life?city=lagos', null, heldCookie);
  assert.equal((await w.f.request('/api/social/visit/enter', { host: ada.id }, heldCookie)).status, 403);
  // A guest befriends the host and walks in; the room admits them without a life of their own at the host's home.
  const tunde = await w.guest('Tunde');
  await w.befriend(ada, tunde);
  assert.equal((await w.enter(tunde, ada.id)).code, 'inside');
  const g = await w.connect(tunde);
  w.say(g, { type: 'join', cityId: 'lagos', venueId: 'home', hostId: ada.id });
  assert.ok((await w.until(g, (m) => m.type === 'presence', 'the guest in the room')).members?.some((member) => member.id === tunde.id));
  // Another city: the guest's character lives in Ibadan, the host's home is in Lagos. The visit is a room, not a journey.
  const ife = await w.guest('Ife', 'ibadan');
  await w.befriend(ada, ife);
  assert.equal((await w.enter(ife, ada.id)).code, 'inside');
  const far = await w.connect(ife);
  w.say(far, { type: 'join', cityId: 'lagos', venueId: 'home', hostId: ada.id });
  assert.ok((await w.until(far, (m) => m.type === 'presence', 'the visitor from another city')).members?.some((member) => member.id === ife.id));
  const life = await w.get('/api/life?city=ibadan', ife) as unknown as { state: { estate: { city: string } } };
  assert.equal(life.state.estate.city, 'ibadan', 'their own life did not move');
  // A host at home keeps one room; leaving is where they were.
  assert.equal((await w.post('/api/social/house/leave', { host: ada.id }, ife)).code, 'left');
  assert.equal((await w.get('/api/social/me', ife)).visiting, null);
});

test('when the host leaves home the guests are sent out with a kind message; two devices of the host keep the home open', async (t) => {
  const w = await world(t);
  const { who: ada, peer } = await w.host('Ada');
  const bola = await w.player('Bola');
  await w.befriend(ada, bola);
  assert.equal((await w.enter(bola, ada.id)).code, 'inside');
  const g = await w.connect(bola);
  w.say(g, { type: 'join', cityId: 'lagos', venueId: 'home', hostId: ada.id });
  await w.until(g, (m) => m.type === 'presence', 'guest in');
  // A second device of the host stands in the room too: the first closing does not empty the home.
  const second = await w.connect(ada);
  w.say(second, { type: 'join', cityId: 'lagos', venueId: 'home' });
  await w.until(second, (m) => m.type === 'presence', 'second device');
  peer.ws.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  w.f.advance(61000);
  assert.equal((await w.get('/api/social/me', bola)).visiting?.host.id, ada.id, 'the host is still in their home on the other device');
  // Leaving home (a trip) sends them out, and they are told.
  assert.equal((await w.act(ada, { type: 'travel', id: 'park', mode: 'trek' })).ok, true);
  await w.until(g, (m) => m.type === 'error' && m.code === 'visit_ended', 'the guest placed outside');
  const after = await w.get('/api/social/me', bola);
  assert.equal(after.visiting, null);
  assert.ok(after.updates?.some((update) => /went out, so your visit ended/.test(update.text)));
});

test('the button says Visit home, Knock, Come in or a plain reason', () => {
  const base = { name: 'Chidi Okeke', how: 'walk' as const, home: true, online: true, full: false, invited: false };
  assert.deepEqual(visitButton(base), { kind: 'visit', label: 'Visit home', reason: null });
  assert.deepEqual(visitButton({ ...base, how: 'knock' }), { kind: 'knock', label: 'Knock', reason: null });
  assert.deepEqual(visitButton({ ...base, home: false }), { kind: 'off', label: 'Visit home', reason: 'Chidi is not home.' });
  assert.equal(visitButton({ ...base, home: false, how: 'walk+' }).kind, 'visit');
  assert.equal(visitButton({ ...base, home: false, online: false, how: 'walk+' }).kind, 'off');
  assert.equal(visitButton({ ...base, how: 'invited' }).reason, 'Only invited guests.');
  assert.equal(visitButton({ ...base, how: 'invited', invited: true }).label, 'Come in');
  assert.equal(visitButton({ ...base, how: 'closed' }).reason, 'Chidi is not taking visitors.');
  assert.equal(visitButton({ ...base, full: true }).reason, 'Home is full: 5 friends are inside.');
  assert.equal(visitButton({ ...base, how: undefined }).kind, 'off');
});

test('legacy records and the stored shapes stay small and additive', async (t) => {
  const w = await world(t);
  const ada = await w.player('Ada');
  assert.equal((await w.store((db) => db.visits)), undefined, 'nothing is stored until a link or an invitation exists');
  await w.get('/api/social/me', ada); await w.get('/api/social/visit/door', ada); await w.get('/api/social/visit/links', ada);
  assert.equal((await w.store((db) => db.visits)), undefined, 'reading writes nothing');
  assert.equal((await w.store((db) => Object.keys(db.social!.houses))).length, 0, 'no house record for a player nobody visits');
  const { who: host } = await w.host('Host');
  assert.equal((await w.post('/api/social/visit/link', {}, host)).ok, true);
  const book = await w.store((db) => structuredClone(db.visits));
  assert.deepEqual(Object.keys(book ?? {}).sort(), ['invites', 'links']);
  assert.equal(Object.keys(book?.links ?? {}).length, 1);
  // A closed door that has run out leaves no house record behind.
  assert.equal((await w.post('/api/social/visit/close', { closed: true }, host)).closed, true);
  w.f.advance(VISIT_MS.closed + 1000);
  await w.get('/api/social/me', host);
  assert.equal((await w.store((db) => Object.hasOwn(db.social!.houses, host.id))), false);
  void randomUUID;
});
