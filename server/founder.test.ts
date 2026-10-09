// OWNER: social — the founder is every player's first friend (server/social/founder.ts, server/social/service.ts).
// The founder here is a made-up account of the stand-in provider (server/accounts/test-tokens.ts), named to the server
// by the hash of its made-up address through FOUNDER_EMAIL_SHA256. Fixture: see server/routes/index.ts ("HOW TO TEST").
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, snapshot } from './test-fixture.ts';
import type { FixtureOptions } from './test-fixture.ts';
import type { TestContext } from 'node:test';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { founderEmailHash } from './host-context.ts';
import { FOUNDER_EMAIL_SHA256, FOUNDER_PAGE, WELCOME_NOTE, emailHash, welcomeNote, friendsIn, presenceAudience } from './social/founder.ts';
import { LIMITS } from './social/service.ts';
import { NUDGE_NOTE } from './growth/comeback.ts';
import type { Db, SocialCollection, SocialPlayerRecord } from './types.ts';
import type { LifeState, Look } from '../src/types/index.ts';
import type { ServerFrame } from '../src/types/protocol.ts';
import type { Conversation, Friend, Message, PersonCard, SearchResult, SocialOverview } from '../src/types/social.ts';

const PROJECT = 'allworld-test-project';
const ACCOUNTS = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' };
/** The stand-in provider gives subject `Founder` this address. */
const FOUNDER_ADDRESS = 'founder@example.com', FOUNDER_HASH = emailHash(FOUNDER_ADDRESS);
const DAY = 86400000;
const LOOK: Look = { body: 'woman', hair: 'braids', outfit: 'casual', fabric: 'ankara', skin: 'skin-6', hairColor: 'soft-black', outfitColor: 'orange', bottomsColor: 'teal' };

interface Who { id: string; cookie: string }
interface Reply {
  status: number; error?: string; ok?: boolean; code?: string; reason?: string; duplicate?: boolean; note?: string
  friends: Friend[]; friendsMore?: SocialOverview['friendsMore']; conversations: Conversation[]; updates: SocialOverview['updates']; requests: SocialOverview['requests']
  messages: Message[]; message: Message; conv: Conversation; results: SearchResult[]; player: PersonCard; state: LifeState; total: number; next: string | null
}
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`expected ${what}`); return value; };

async function world(t: TestContext, options: FixtureOptions = {}) {
  const key = await makeKey('key-1');
  const provider = fakeProvider([key]);
  const f = await fixture(t, { fetch: (url, init) => provider.fetch(String(url), init as { body?: unknown }), log: () => {}, ...options, env: { ...ACCOUNTS, FOUNDER_EMAIL_SHA256: FOUNDER_HASH, ...options.env } });
  const answer = async (res: Response): Promise<Reply> => ({ status: res.status, ...((await res.json()) as object) } as Reply);
  const get = async (path: string, who: Who): Promise<Reply> => answer(await f.request(path, null, who.cookie));
  const post = async (path: string, body: unknown, who: Who): Promise<Reply> => answer(await f.request(path, body, who.cookie));
  /** A request as the game's own page makes it (the account routes need this host as Origin). */
  const page = (path: string, body: unknown, cookie?: string): Promise<Response> => fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: f.base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let minted = 0;
  /** Sign in as `subject` (address `<subject>@example.com`), with this browser's cookie when it has one. Returns the new cookie. */
  async function signIn(subject: string, cookie?: string): Promise<string> {
    const csrf = cookie ? ((await (await page('/api/account', null, cookie)).json()) as { csrf: string | null }).csrf : null;
    const idToken = await signToken(key, claimsFor(PROJECT, f.now(), { subject, email: `${subject.toLowerCase()}@example.com`, n: ++minted }));
    const response = await page('/api/account/sign-in', { idToken, csrf }, cookie);
    assert.equal(response.status, 200, `sign-in of ${subject}`);
    await response.text();
    return must(response.headers.get('set-cookie'), 'a cookie').split(';')[0] ?? '';
  }
  /** With a fresh token of the founder's account: bring one of its set-aside characters into play. */
  async function playAs(cookie: string, use: string): Promise<void> {
    const csrf = ((await (await page('/api/account', null, cookie)).json()) as { csrf: string | null }).csrf;
    const idToken = await signToken(key, claimsFor(PROJECT, f.now(), { subject: 'Founder', email: FOUNDER_ADDRESS, n: ++minted }));
    const response = await page('/api/account/character', { idToken, use, csrf }, cookie);
    assert.equal(response.status, 200, 'the character switch');
    await response.text();
  }
  const me = (who: Who): Promise<Reply> => get('/api/social/me', who);
  /** A player who exists for the social features: a device with a life, whose overview has been read. */
  async function player(name: string): Promise<Who> { const who = await f.device(name); await f.request('/api/life?city=lagos', null, who.cookie); await me(who); return who; }
  /** The founder: a played character saved to the account whose address has the configured hash. */
  async function founder(name = 'Zed'): Promise<Who> {
    const device = await f.device(name);
    await f.request('/api/life?city=lagos', null, device.cookie);
    const who = { id: device.id, cookie: await signIn('Founder', device.cookie) };
    assert.equal((await me(who)).status, 200);
    return who;
  }
  const social = (): Promise<SocialCollection> => f.server.store.read((db) => snapshot(must(db.social, 'db.social')));
  const edit = (fn: (db: Db) => void): Promise<void> => f.server.store.transact((db) => { fn(db); });
  return { f, get, post, signIn, playAs, me, player, founder, social, edit };
}
type World = Awaited<ReturnType<typeof world>>;
const ids = (list: { id: string }[]): string[] => list.map((item) => item.id);
/** Everything a socket is sent from now on. */
function listen(peer: { ws: { on(event: 'message', listener: (data: { toString(): string }) => void): unknown } }): ServerFrame[] {
  const frames: ServerFrame[] = [];
  peer.ws.on('message', (data) => { frames.push(JSON.parse(data.toString()) as ServerFrame); });
  return frames;
}
const settleDown = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('the setting: the built-in hash unless FOUNDER_EMAIL_SHA256 replaces it; empty or malformed means no founder', () => {
  assert.match(FOUNDER_EMAIL_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(founderEmailHash({}), FOUNDER_EMAIL_SHA256);
  assert.equal(founderEmailHash(null), FOUNDER_EMAIL_SHA256);
  assert.equal(founderEmailHash({ FOUNDER_EMAIL_SHA256: '' }), '');
  assert.equal(founderEmailHash({ FOUNDER_EMAIL_SHA256: 'not-a-hash' }), '');
  assert.equal(founderEmailHash({ FOUNDER_EMAIL_SHA256: ` ${FOUNDER_HASH.toUpperCase()} ` }), FOUNDER_HASH);
  // The address is compared trimmed and lower-cased, as SHA-256.
  assert.equal(emailHash('  Founder@Example.com '), FOUNDER_HASH);
  assert.equal(emailHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(emailHash(''), '');
});

test('a new guest and a new account holder each find the founder first, tagged, with one welcome note — and the founder is told nothing', async (t) => {
  const w = await world(t), { f } = w;
  const zed = await w.founder();
  const peer = await f.socket(zed), heard = listen(peer);

  // A quick-start life that has not confirmed Play is not a player yet: nothing is made for it.
  const opened = await f.request('/api/session', { name: 'Ngozi', onboarding: true });
  const ngozi: Who = { id: ((await opened.json()) as { session: { id: string } }).session.id, cookie: must(opened.headers.get('set-cookie')).split(';')[0] ?? '' };
  await f.request('/api/life?city=lagos', null, ngozi.cookie);
  assert.deepEqual([(await w.me(ngozi)).status, (await w.me(ngozi)).error], [403, 'onboarding_required']);
  assert.equal((await w.social()).players[ngozi.id], undefined);
  assert.equal((await f.action(ngozi.cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing');

  // Play confirmed: the first overview already has the founder, tagged, and the note.
  const first = await w.me(ngozi);
  assert.deepEqual(first.friends.map((friend) => [friend.id, friend.name, friend.founder]), [[zed.id, 'Zed', true]]);
  assert.deepEqual(first.requests, { in: [], out: [] }, 'no request and no accept step');
  assert.equal(first.conversations.length, 1);
  const chat = must(first.conversations[0]);
  assert.deepEqual([chat.kind, chat.with, chat.unread, chat.name], ['dm', zed.id, 1, 'Zed']);
  const note = must((await w.get(`/api/social/conversations/${chat.id}`, ngozi)).messages[0]).body;
  assert.equal(chat.last?.body, note.slice(0, 80));
  assert.match(note, /Ngozi/, 'the note is written for this player');
  assert.equal(chat.members.find((member) => member.id === zed.id)?.founder, true, 'the Messages header can tag the founder');
  const history = await w.get(`/api/social/conversations/${chat.id}`, ngozi);
  assert.deepEqual(history.messages.map((message) => [message.body, message.auto, message.from?.id, message.from?.founder]), [[note, true, zed.id, true]]);
  assert.match(WELCOME_NOTE, /automatic welcome note/);
  assert.match(note, /automatic welcome note from the founder/, 'it says plainly that it is automatic');
  assert.ok(WELCOME_NOTE.length <= LIMITS.body);

  // Another friend, whose name sorts before the founder's: the founder is still first.
  const aaron = await w.player('Aaron');
  assert.equal((await w.post('/api/social/friends/request', { to: ngozi.id, cityId: 'lagos' }, aaron)).code, 'requested');
  assert.equal((await w.post('/api/social/friends/answer', { from: aaron.id, accept: true, cityId: 'lagos' }, ngozi)).code, 'accepted');
  assert.deepEqual(ids((await w.me(ngozi)).friends), [zed.id, aaron.id]);
  assert.deepEqual((await w.me(aaron)).friends.map((friend) => [friend.id, friend.founder]), [[zed.id, true], [ngozi.id, undefined]]);

  // A new account holder: a device that signs in, then plays.
  const device = await f.device('Bisi');
  await f.request('/api/life?city=lagos', null, device.cookie);
  const bisi: Who = { id: device.id, cookie: await w.signIn('UidBisi', device.cookie) };
  assert.deepEqual((await w.me(bisi)).friends.map((friend) => [friend.id, friend.founder]), [[zed.id, true]]);
  assert.equal((await w.get(`/api/social/players/${zed.id}`, bisi)).player.founder, true);
  assert.deepEqual([(await w.get(`/api/social/players/${zed.id}`, bisi)).player.friend, (await w.get(`/api/social/players/${bisi.id}`, zed)).player.friend], [true, true], 'friends in both directions');

  // Repeated sessions and repeated reads make nothing twice.
  const before = await w.social();
  for (let i = 0; i < 3; i++) { f.advance(60000); await w.me(ngozi); await w.me(bisi); await w.get('/api/social/conversations', ngozi); }
  const after = await w.social();
  assert.deepEqual(after.players[ngozi.id]?.founder, before.players[ngozi.id]?.founder);
  assert.deepEqual(after.players[ngozi.id]?.founder, { id: zed.id, at: 100000 });
  assert.deepEqual(Object.keys(after.players[ngozi.id]?.friends ?? {}).sort(), [zed.id, aaron.id].sort());
  assert.equal(must((await w.me(ngozi)).conversations.find((conv) => conv.with === zed.id)).last?.seq, 1, 'one note, never a second');
  assert.equal(Object.values(after.convs).filter((conv) => conv.members.includes(zed.id)).reduce((sum, conv) => sum + conv.messages.length, 0), 3, 'one stored note per player');
  assert.equal(JSON.stringify(after.convs).includes('Welcome to Allworld'), false, 'the words of the note are not stored');

  // The founder: no update line, no conversation, no request, no pending effect, nothing pushed — and nothing in their own record.
  const mine = await w.me(zed);
  assert.deepEqual([mine.updates, mine.conversations, mine.requests], [[], [], { in: [], out: [] }]);
  assert.deepEqual(ids(mine.friends).sort(), [ngozi.id, aaron.id, bisi.id].sort());
  assert.equal(ids(mine.friends).includes(zed.id), false, 'never their own friend');
  assert.deepEqual(mine.friendsMore, { total: 3, next: null });
  assert.deepEqual(after.players[zed.id]?.friends, {});
  assert.equal(after.players[zed.id]?.founder, undefined);
  assert.equal(after.pending[zed.id], undefined);
  await settleDown();
  assert.deepEqual(heard.filter((frame) => ['social-update', 'friend-request', 'friend-accepted', 'dm', 'social-sync', 'people-presence'].includes(frame.type)), []);

  // No mission, goal or closeness counts it: the life was never told.
  const life = ((await w.get('/api/life?city=lagos', ngozi)).state);
  assert.equal(life.social.rel[zed.id], undefined);
  assert.equal(life.goals.stats.friends, 1, 'only the friend made by request counted');
  assert.equal((await w.get('/api/life?city=lagos', bisi)).state.goals.stats.friends, 0);

  // A reply is an ordinary message: it reaches the founder, and only then is the chat in the founder's list.
  const reply = await w.post('/api/social/messages', { to: zed.id, body: 'Hello from Ngozi', clientId: f.id() }, ngozi);
  assert.equal(reply.code, 'sent');
  const inbox = (await w.me(zed)).conversations;
  assert.deepEqual(inbox.map((conv) => [conv.with, conv.unread, conv.last?.body]), [[ngozi.id, 1, 'Hello from Ngozi']]);
});

test('players who were here before the founder get the friendship once, on their next session; a founder on another device is the same founder', async (t) => {
  const w = await world(t), { f } = w;
  const ada = await w.player('Ada'), bola = await w.player('Bola');
  assert.deepEqual([(await w.me(ada)).friends, (await w.me(ada)).conversations], [[], []]);
  const none = await w.social();
  assert.deepEqual([none.founder, none.players[ada.id]?.founder], [undefined, undefined], 'no founder yet: nothing is marked, so it is tried again');

  f.advance(DAY);
  const zed = await w.founder();
  assert.deepEqual((await w.me(ada)).friends.map((friend) => [friend.id, friend.founder]), [[zed.id, true]]);
  f.advance(DAY);
  assert.deepEqual(ids((await w.me(ada)).friends), [zed.id]);
  assert.deepEqual((await w.social()).players[ada.id]?.founder, { id: zed.id, at: 100000 + DAY }, 'made on the first session after the founder existed, and not again');
  assert.equal((await w.social()).players[bola.id]?.founder, undefined, 'Bola has not been back yet');

  // The founder signs in on a new device: the same account, the same character, the same founder.
  const elsewhere: Who = { id: zed.id, cookie: await w.signIn('Founder') };
  assert.equal((await w.me(elsewhere)).status, 200);
  assert.deepEqual((await w.me(bola)).friends.map((friend) => [friend.id, friend.founder]), [[zed.id, true]]);
  assert.deepEqual((await w.me(elsewhere)).friendsMore, { total: 2, next: null });
  assert.deepEqual((await w.social()).founder?.id, zed.id);
});

test('ending it is final: a removal or a block by either side is never undone, and a block made beforehand is respected', async (t) => {
  const w = await world(t), { f } = w;
  const zed = await w.founder();
  const peer = await f.socket(zed), heard = listen(peer);
  const [ada, bola, dayo] = [await w.player('Ada'), await w.player('Bola'), await w.player('Dayo')];
  const friendsOf = async (who: Who): Promise<string[]> => ids((await w.me(who)).friends);
  assert.deepEqual([await friendsOf(ada), await friendsOf(bola), await friendsOf(dayo)], [[zed.id], [zed.id], [zed.id]]);

  // The player removes the founder.
  const removed = await w.post('/api/social/friends/remove', { id: zed.id, cityId: 'lagos' }, ada);
  assert.deepEqual([removed.code, removed.duplicate], ['removed', undefined]);
  // The player blocks the founder, then thinks better of it.
  assert.equal((await w.post('/api/social/block', { id: zed.id, cityId: 'lagos' }, bola)).code, 'blocked');
  assert.equal((await w.post('/api/social/unblock', { id: zed.id }, bola)).code, 'unblocked');
  // The founder removes a player.
  const dropped = await w.post('/api/social/friends/remove', { id: dayo.id, cityId: 'lagos' }, zed);
  assert.deepEqual([dropped.code, dropped.duplicate], ['removed', undefined]);
  // The founder blocked someone before that player ever arrived; and a player blocked the founder before the founder's account existed is covered the same way.
  const eze = await f.device('Eze');
  await f.request('/api/life?city=lagos', null, eze.cookie);
  await w.edit((db) => { const players = must(db.social).players; must(players[zed.id]).blocked[eze.id] = f.now(); });
  assert.deepEqual([(await w.me(eze)).friends, (await w.me(eze)).conversations], [[], []]);

  for (let day = 0; day < 3; day++) {
    f.advance(DAY);
    assert.deepEqual([await friendsOf(ada), await friendsOf(bola), await friendsOf(dayo), await friendsOf(eze)], [[], [], [], []]);
  }
  assert.deepEqual((await w.me(zed)).friendsMore, { total: 0, next: null });
  const stored = await w.social();
  for (const who of [ada, bola, dayo, eze]) assert.equal(stored.players[who.id]?.founder?.id, zed.id, 'the marker stays, so it is not tried again');
  assert.equal(friendsIn(stored.players, ada.id, zed.id), false);
  assert.equal((await w.get(`/api/social/players/${zed.id}`, ada)).player.friend, false);
  await settleDown();
  assert.deepEqual(heard.filter((frame) => frame.type === 'social-sync'), [], 'players leaving do not make the founder’s client read everything again');

  // Nothing stops the two of them becoming friends the ordinary way afterwards.
  assert.equal((await w.post('/api/social/friends/request', { to: zed.id, cityId: 'lagos' }, ada)).code, 'requested');
  assert.equal((await w.post('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, zed)).code, 'accepted');
  assert.deepEqual([await friendsOf(ada), (await w.social()).players[zed.id]?.friends[ada.id] !== undefined], [[zed.id], true]);
});

test('the founder brings another character into play: the tag moves, players who kept the friendship follow, and one who ended it does not', async (t) => {
  const w = await world(t), { f } = w;
  const zed = await w.founder('Zed');
  const ada = await w.player('Ada'), bola = await w.player('Bola');
  await w.post('/api/social/friends/remove', { id: zed.id, cityId: 'lagos' }, bola);
  // A second played life, on another device, is set aside by the founder's sign-in there; then it is chosen.
  const yemi = await f.device('Yemi');
  await f.request('/api/life?city=lagos', null, yemi.cookie);
  const cookie = await w.signIn('Founder', yemi.cookie);
  await w.playAs(cookie, yemi.id);
  const now: Who = { id: yemi.id, cookie };
  // Until the new character is seen there is no founder at all: a new player is not marked, so nothing is lost.
  const chidi = await w.player('Chidi');
  assert.deepEqual([(await w.me(chidi)).friends, (await w.social()).players[chidi.id]?.founder], [[], undefined]);
  assert.equal((await w.me(now)).status, 200);
  assert.deepEqual((await w.me(ada)).friends.map((friend) => [friend.id, friend.name, friend.founder]), [[yemi.id, 'Yemi', true]]);
  assert.deepEqual((await w.me(chidi)).friends.map((friend) => [friend.id, friend.founder]), [[yemi.id, true]]);
  assert.deepEqual((await w.me(bola)).friends, [], 'Bola removed the founder: the new character is not given either');
  assert.equal((await w.get(`/api/social/players/${zed.id}`, ada)).player.founder, undefined, 'the set-aside character is no longer tagged');
  assert.deepEqual(ids((await w.me(now)).friends).sort(), [ada.id, chidi.id].sort());
  assert.deepEqual((await w.social()).players[ada.id]?.founder, { id: yemi.id, at: 100000 });
});

test('the tag is the server’s: the founder’s name, on anyone else, earns nothing', async (t) => {
  const w = await world(t);
  const zed = await w.founder('Zed');
  // A guest with the same name, and an account with the same name and another address.
  const copy = await w.player('Zed');
  const device = await w.f.device('Zed');
  await w.f.request('/api/life?city=lagos', null, device.cookie);
  const other: Who = { id: device.id, cookie: await w.signIn('NotTheFounder', device.cookie) };
  await w.me(other);
  const ada = await w.player('Ada');
  const found = (await w.get('/api/social/search?q=zed', ada)).results;
  assert.deepEqual(found.map((player) => [player.id, player.founder]).sort(), [[zed.id, true], [copy.id, undefined], [other.id, undefined]].sort());
  for (const fake of [copy, other]) {
    assert.equal((await w.get(`/api/social/players/${fake.id}`, ada)).player.founder, undefined);
    assert.deepEqual((await w.me(fake)).friends.map((friend) => [friend.id, friend.founder]), [[zed.id, true]], 'they are the founder’s friends like anyone else');
  }
  // A stored record cannot claim it either: the pointer is checked against the account every time.
  await w.edit((db) => { must(db.social).founder = { account: 'fb:NotTheFounder', id: other.id }; });
  assert.equal((await w.get(`/api/social/players/${other.id}`, ada)).player.founder, undefined);
  assert.equal((await w.get(`/api/social/players/${zed.id}`, ada)).player.founder, undefined, 'and with no valid pointer nobody is tagged until the founder is next seen');
  await w.me(zed);
  assert.equal((await w.get(`/api/social/players/${zed.id}`, ada)).player.founder, true);
});

test('an empty FOUNDER_EMAIL_SHA256 switches it off: no friendship, no note, no tag, and nothing marked', async (t) => {
  const w = await world(t, { env: { FOUNDER_EMAIL_SHA256: '' } });
  const zed = await w.founder();
  const ada = await w.player('Ada');
  assert.deepEqual([(await w.me(ada)).friends, (await w.me(ada)).conversations], [[], []]);
  assert.equal((await w.get(`/api/social/players/${zed.id}`, ada)).player.founder, undefined);
  assert.equal((await w.me(zed)).friendsMore, undefined);
  const stored = await w.social();
  assert.deepEqual([stored.founder, stored.players[ada.id]?.founder], [undefined, undefined]);
});

test('a founder with 5,000 friends: a small record, a bounded overview, pages that reach everyone once, and no presence fan-out', async (t) => {
  const w = await world(t), { f } = w;
  const zed = await w.founder();
  const real = await w.player('Ada');
  const many = 5000, simulated: string[] = [];
  let measuredAt = performance.now();
  let measuredStats = f.server.store.stats();
  const measure = (stage: string): void => {
    const current = f.server.store.stats();
    const previous = new Map(Object.entries(measuredStats));
    const counters = Object.fromEntries(Object.entries(current).flatMap(([key, value]) => {
      const before = previous.get(key);
      return typeof value === 'number' && typeof before === 'number' ? [[key, value - before]] : [];
    }));
    const now = performance.now();
    t.diagnostic(JSON.stringify({ profile: 'founder-5000-pagination', stage, elapsedMs: now - measuredAt, counters }));
    measuredAt = now; measuredStats = current;
  };
  await w.edit((db) => {
    const players = must(db.social).players;
    for (let i = 0; i < many; i++) {
      const id = randomUUID(), at = 200000 + i;
      simulated.push(id);
      const record: SocialPlayerRecord = { name: `Sim ${i}`, first: at, seen: f.now(), friends: { [zed.id]: at }, in: {}, out: {}, blocked: {}, convs: {}, updates: [], reports: [], baeIn: {}, bae: null, visiting: null, recv: { day: 0, amount: 0 }, chats: { day: 0, count: 0 }, founder: { id: zed.id, at } };
      players[id] = record;
    }
  });
  measure('seed-one-transaction');
  const res = await f.request('/api/social/me', null, zed.cookie);
  const text = await res.text(), overview = JSON.parse(text) as Reply;
  assert.equal(overview.friends.length, FOUNDER_PAGE);
  assert.equal(overview.friendsMore?.total, many + 1);
  assert.ok(text.length < 20000, `the founder’s overview is ${text.length} characters`);
  assert.deepEqual(ids(overview.friends).slice(0, 2), [simulated[many - 1], simulated[many - 2]], 'newest first');
  measure('first-overview');

  // Every page is FOUNDER_PAGE long, nobody is listed twice, and the pages end.
  const seen = new Set(ids(overview.friends));
  let next = overview.friendsMore?.next ?? null, pages = 1;
  while (next) {
    const page = await w.get(`/api/social/friends?after=${encodeURIComponent(next)}`, zed);
    assert.equal(page.code, 'ok');
    assert.ok(page.friends.length > 0 && page.friends.length <= FOUNDER_PAGE);
    for (const friend of page.friends) { assert.equal(seen.has(friend.id), false); seen.add(friend.id); }
    assert.equal(page.total, many + 1);
    next = page.next; pages += 1;
    assert.ok(pages <= Math.ceil((many + 1) / FOUNDER_PAGE), 'the pages end');
  }
  assert.equal(seen.size, many + 1);
  assert.equal(seen.has(real.id), true);
  measure('remaining-100-pages');
  // The cursor is validated, and nobody else has pages.
  assert.equal((await w.get('/api/social/friends?after=x', zed)).error, 'invalid_cursor');
  assert.deepEqual([(await w.get(`/api/social/friends?after=1:${zed.id}`, real)).friends, (await w.me(real)).friendsMore], [[], undefined]);

  // The founder's stored record did not grow, and their presence is announced to nobody for it.
  const stored = await w.social();
  assert.ok(JSON.stringify(stored.players[zed.id]).length < 1000, 'the founder’s record');
  assert.deepEqual(stored.players[zed.id]?.friends, {});
  assert.deepEqual(presenceAudience(stored.players, zed.id), []);
  assert.deepEqual(presenceAudience(stored.players, real.id), [], 'and a player’s arrival is not sent to the founder');
  assert.equal(friendsIn(stored.players, zed.id, must(simulated[17])), true);
  // Live: the founder is connected while a player comes and goes; no presence frame crosses the automatic friendship.
  const founderPeer = await f.socket(zed), founderHeard = listen(founderPeer);
  const playerPeer = await f.socket(real), playerHeard = listen(playerPeer);
  await settleDown();
  playerPeer.ws.close();
  await settleDown();
  assert.deepEqual([...founderHeard, ...playerHeard].filter((frame) => frame.type === 'people-presence'), []);
  // The friends cap is about friends made by request: the automatic one takes no place in it.
  assert.equal(LIMITS.friends, 200);
  await w.edit((db) => {
    const players = must(db.social).players, mine = must(players[real.id]);
    for (const id of simulated.slice(0, LIMITS.friends - 1)) { mine.friends[id] = 1; must(players[id]).friends[real.id] = 1; }
  });
  const last = await w.player('Lola');
  assert.equal((await w.post('/api/social/friends/request', { to: last.id, cityId: 'lagos' }, real)).code, 'requested', '199 by request plus the founder is not a full list');
});

test('a nudge across the automatic friendship is answered like any other and kept by nobody; one from a friend by request is kept', async (t) => {
  const mail = { ZEPTOMAIL_AUTH: 'Zoho-enczapikey TESTKEY-not-a-real-key', EMAIL_FROM_ADDRESS: 'hello@mail.play.example', EMAIL_FROM_NAME: 'Allworld', EMAIL_CONTACT_LINE: 'Allworld, 1 Example Street' };
  const w = await world(t, { env: mail, publicOrigin: 'https://play.example' }), { f } = w;
  const zed = await w.founder();
  // The founder's character has its e-mails on (an account's are, from its first visit).
  assert.equal((await w.post('/api/growth/hello', { cityId: 'lagos' }, zed)).status, 200);
  const ada = await w.player('Ada'), bola = await w.player('Bola');
  for (const who of [ada, bola]) await w.post('/api/growth/hello', { cityId: 'lagos' }, who);
  // Bola and the founder are friends by request as well: remove the automatic friendship, then ask and accept.
  await w.post('/api/social/friends/remove', { id: zed.id, cityId: 'lagos' }, bola);
  await w.post('/api/social/friends/request', { to: zed.id, cityId: 'lagos' }, bola);
  assert.equal((await w.post('/api/social/friends/answer', { from: bola.id, accept: true, cityId: 'lagos' }, zed)).code, 'accepted');
  const record = async () => f.server.store.read((db) => structuredClone(db.growth?.comeback?.[zed.id]));
  assert.ok(await record(), 'the founder has a comeback record to keep a nudge in');
  f.advance(3 * DAY);
  await w.me(ada); await w.me(bola);
  const automatic = await w.post('/api/growth/nudge', { cityId: 'lagos', to: zed.id }, ada);
  assert.deepEqual([automatic.code, automatic.note], ['nudged', NUDGE_NOTE]);
  assert.deepEqual((await record())?.nudges, []);
  const asked = await w.post('/api/growth/nudge', { cityId: 'lagos', to: zed.id }, bola);
  assert.deepEqual([asked.code, asked.note], ['nudged', NUDGE_NOTE]);
  assert.deepEqual((await record())?.nudges.map((item) => item.from), [bola.id]);
});

test('a collection stored before the founder existed reads unchanged, and its players are upgraded one by one as they return', async (t) => {
  const w = await world(t), { f } = w;
  const ada = await w.player('Ada'), bola = await w.player('Bola');
  await w.post('/api/social/messages', { to: bola.id, body: 'Hello Bola', clientId: f.id() }, ada);
  const old = await w.social();
  assert.deepEqual([old.founder, Object.values(old.players).some((player) => player.founder !== undefined), Object.values(old.convs).some((conv) => conv.messages.some((message) => message.auto !== undefined))], [undefined, false, false], 'the earlier shape has none of the new fields');
  const zed = await w.founder();
  await w.me(ada);
  const now = await w.social();
  // Bola's record, and the conversation, are exactly as they were stored (Bola has not been back).
  assert.deepEqual(now.players[bola.id], old.players[bola.id]);
  assert.deepEqual(now.convs[must(Object.keys(old.convs)[0])], old.convs[must(Object.keys(old.convs)[0])]);
  // Ada's gained the marker, the friendship and the note's conversation; nothing else of hers changed.
  const { founder, friends, convs, ...rest } = must(now.players[ada.id]), { friends: oldFriends, convs: oldConvs, ...oldRest } = must(old.players[ada.id]);
  assert.deepEqual({ ...rest, seen: 0 }, { ...oldRest, seen: 0 });
  assert.deepEqual([founder?.id, Object.keys(friends), Object.keys(convs).length - Object.keys(oldConvs).length, Object.keys(oldFriends)], [zed.id, [zed.id], 1, []]);
});

test('the welcome note is made from the player\'s own start, in three variations, and always says it is automatic', () => {
  const start = { name: 'Ngozi Eze', city: 'Ibadan', trait: 'Foodie', dream: 'Lekki Landlord' };
  const notes = [0, 1, 2].map((v) => welcomeNote({ ...start, v }));
  assert.equal(new Set(notes).size, 3);
  for (const text of notes) {
    assert.match(text, /Ngozi/); assert.match(text, /Ibadan/); assert.match(text, /Foodie/); assert.match(text, /Lekki Landlord/);
    assert.match(text, /automatic welcome note from the founder/); assert.ok(text.length <= LIMITS.body); assert.doesNotMatch(text, /typing|I am here right now|chatting/i);
  }
  assert.equal(welcomeNote(undefined), WELCOME_NOTE, 'an earlier note reads as it always did');
  assert.match(welcomeNote({ name: 'Bisi', v: 4 }), /Bisi/, 'a start with no city or choices still reads well');
});
