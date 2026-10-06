// OWNER: social — paged lists: the Players view, the chat list, a conversation's older lines (server/social/pages.ts, docs/LISTS.md).
// The founder here is a made-up account of the stand-in provider, named to the server by the hash of its made-up address.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.ts';
import type { FixtureOptions } from './test-fixture.ts';
import type { TestContext } from 'node:test';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { emailHash } from './social/founder.ts';
import { LIMITS } from './social/service.ts';
import { DIRECTORY_TTL_MS } from './social/pages.ts';
import type { Db, SocialCollection, SocialPlayerRecord } from './types.ts';
import type { LifeState } from '../src/types/index.ts';
import type { ServerFrame } from '../src/types/protocol.ts';
import type { Conversation, Friend, ManyResult, Message, PersonCard, PlayerRow, SearchResult, SocialOverview } from '../src/types/social.ts';

const PROJECT = 'allworld-test-project';
const ACCOUNTS = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' };
/** The stand-in provider gives subject `Founder` this address. */
const FOUNDER_ADDRESS = 'founder@example.com', FOUNDER_HASH = emailHash(FOUNDER_ADDRESS);
const OTHER_ADMIN = 'otheradmin@example.com';

interface Who { id: string; cookie: string }
interface Reply {
  status: number; error?: string; ok?: boolean; code?: string; reason?: string; duplicate?: boolean; note?: string
  friends: Friend[]; friendsMore?: SocialOverview['friendsMore']; conversations: Conversation[]; updates: SocialOverview['updates']; requests: SocialOverview['requests']
  messages: Message[]; message: Message; conv: Conversation; results: SearchResult[]; player: PersonCard; state: LifeState; total: number | null; next: string | null
  players: PlayerRow[]; gone: number; online?: number; sort: string; more: boolean; unreadOlder: number; unread: number
  results: (Reply['results'][number] | { id: string; ok: boolean; code?: string })[]; sent: number
}
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`expected ${what}`); return value; };

async function world(t: TestContext, options: FixtureOptions = {}) {
  const key = await makeKey('key-1');
  const provider = fakeProvider([key]);
  const f = await fixture(t, { fetch: (url, init) => provider.fetch(String(url), init as { body?: unknown }), log: () => {}, ...options, env: { ...ACCOUNTS, FOUNDER_EMAIL_SHA256: FOUNDER_HASH, ADMIN_EMAIL_SHA256S: emailHash(OTHER_ADMIN), ...options.env } });
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
  const social = (): Promise<SocialCollection> => f.server.store.read((db) => structuredClone(must(db.social, 'db.social')));
  const edit = (fn: (db: Db) => void): Promise<void> => f.server.store.transact((db) => { fn(db); });
  return { f, get, post, signIn, playAs, me, player, founder, social, edit };
}
type World = Awaited<ReturnType<typeof world>>;
const ids = (list: { id: string }[]): string[] => list.map((item) => item.id);
const mk = (name: string, first: number, founder: string): SocialPlayerRecord => ({ name, first, seen: first, friends: { [founder]: first }, in: {}, out: {}, blocked: {}, convs: {}, updates: [], reports: [], baeIn: {}, bae: null, visiting: null,
  recv: { day: 0, amount: 0 }, chats: { day: 0, count: 0 }, founder: { id: founder, at: first } });
/** Players who exist only in the stored collection, each the founder's automatic friend: `first` rises with the index. */
async function seed(w: World, founder: string, names: string[], base = 1000): Promise<string[]> {
  const made = names.map((name, index) => [randomUUID(), name, base + index * 1000] as const);
  await w.edit((db) => { for (const [id, name, first] of made) must(db.social, 'db.social').players[id] = mk(name, first, founder); });
  w.f.advance(DIRECTORY_TTL_MS + 1000); // players written straight into the store are found when the index is next rebuilt
  return made.map(([id]) => id);
}
const query = (params: Record<string, string | number | undefined>): string => `?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`;
/** Every page of the Players view for one query, following `next`. */
async function walk(w: World, who: Who, params: Record<string, string | number | undefined>, pages = 100): Promise<{ rows: PlayerRow[]; calls: number; first: Reply }> {
  const rows: PlayerRow[] = [];
  let cursor: string | undefined, calls = 0, first: Reply | undefined;
  do {
    const got = await w.get(`/api/social/everyone${query({ ...params, after: cursor })}`, who);
    assert.equal(got.status, 200);
    first ??= got; calls += 1; rows.push(...got.players); cursor = got.next ?? undefined;
  } while (cursor && calls < pages);
  return { rows, calls, first: must(first) };
}

test('the Players view is the founder\'s (and a listed admin\'s): a player, a guest and a stranger are answered like a route that does not exist', async (t) => {
  const w = await world(t), { f } = w;
  const zed = await w.founder(), ada = await w.player('Ada');
  const admin = { id: (await f.device('Chi')).id, cookie: '' };
  const device = await f.device('Chi2'); await f.request('/api/life?city=lagos', null, device.cookie);
  const other: Who = { id: device.id, cookie: await w.signIn('OtherAdmin', device.cookie) };
  void admin;
  const table: [string, Who | null, number][] = [['founder', zed, 200], ['listed admin', other, 200], ['player', ada, 404], ['no session', null, 401]];
  for (const [who, caller, status] of table) {
    const got = caller ? await w.get('/api/social/everyone', caller) : { status: (await f.request('/api/social/everyone', null)).status };
    assert.equal(got.status, status, who);
  }
  assert.equal((await w.post('/api/social/messages/many', { to: [zed.id], body: 'hi', clientId: f.id() }, ada)).status, 404, 'a player cannot send to many');
  assert.equal((await w.get('/api/social/players/' + ada.id, ada)).status, 200, 'People is as before');
});

test('newest first is exact and stable: rows added while paging neither repeat nor skip a row', async (t) => {
  const w = await world(t), { f } = w;
  const zed = await w.founder();
  const seeded = await seed(w, zed.id, Array.from({ length: 120 }, (_, index) => `Player ${String(index).padStart(3, '0')}`));
  const wanted = seeded.slice().reverse();
  const got: PlayerRow[] = [];
  let cursor: string | undefined, calls = 0;
  for (;;) {
    const page = await w.get(`/api/social/everyone${query({ limit: 25, after: cursor })}`, zed);
    got.push(...page.players); calls += 1;
    // A player arrives between pages, and a seeded one is removed from the founder's friends.
    if (calls === 2) { await w.player('Latecomer'); await w.edit((db) => { delete must(db.social).players[wanted[60]!]!.friends[zed.id]; }); }
    if (!page.next) break;
    cursor = page.next;
  }
  const order = ids(got);
  assert.equal(new Set(order).size, order.length, 'no row twice');
  const without = wanted.filter((id) => id !== wanted[60]);
  assert.deepEqual(order.filter((id) => wanted.includes(id)), without.filter((id) => order.includes(id)), 'the original rows keep their order');
  assert.deepEqual(without.filter((id) => !order.includes(id)), [], 'no row was skipped (the one removed is the only one missing)');
  assert.ok(!order.includes(wanted[60]!), 'a player who is no longer a friend is not listed');
  assert.equal(calls, 5, '120 rows at 25 a page');
  const first = await w.get('/api/social/everyone', zed);
  assert.equal(first.players.length, LIMITS.playersPage);
  assert.equal((await w.get('/api/social/everyone?limit=9999', zed)).players.length, 100, 'the page size is capped on the server');
  assert.equal((await w.get('/api/social/everyone?limit=abc', zed)).players.length, LIMITS.playersPage);
  assert.ok(first.total! >= 120 && first.online !== undefined);
  void f;
});

test('name order, prefix then contains search, cursors that are checked, and no address anywhere', async (t) => {
  const w = await world(t);
  const zed = await w.founder();
  await seed(w, zed.id, ['Ada Obi', 'Adaeze', 'Bada', 'Chidi Ada', 'Dada', 'Ngozi', 'adam', 'Zara', 'Ben Adams'], 5000);
  const names = async (params: Record<string, string | number | undefined>): Promise<string[]> => (await walk(w, zed, { limit: 2, ...params })).rows.map((row) => row.name);
  assert.deepEqual(await names({ sort: 'name' }), ['Ada Obi', 'Adaeze', 'adam', 'Bada', 'Ben Adams', 'Chidi Ada', 'Dada', 'Ngozi', 'Zara', 'Zed'].filter((name) => name !== 'Zed'));
  // A prefix match first (in name order), then the names that only contain it.
  assert.deepEqual(await names({ q: 'ada' }), ['Ada Obi', 'Adaeze', 'adam', 'Bada', 'Ben Adams', 'Chidi Ada', 'Dada']);
  assert.deepEqual(await names({ q: '@ADA' }), ['Ada Obi', 'Adaeze', 'adam', 'Bada', 'Ben Adams', 'Chidi Ada', 'Dada']);
  assert.deepEqual(await names({ q: 'ngo' }), ['Ngozi']);
  assert.deepEqual(await names({ q: 'qqq' }), []);
  const found = await walk(w, zed, { q: 'ada', limit: 3 });
  assert.equal(found.first.total, null, 'a search does not claim a total');
  assert.ok(found.calls >= 2);
  // Cursors from nowhere are refused; so is a query with a control character.
  assert.equal((await w.get('/api/social/everyone?after=nonsense', zed)).status, 400);
  assert.equal((await w.get('/api/social/everyone?sort=name&after=n:1:2', zed)).status, 400);
  assert.equal((await w.get('/api/social/everyone?q=a%00b', zed)).status, 400);
  const raw = JSON.stringify((await w.get('/api/social/everyone', zed)));
  assert.equal(/example\.com|email|@/.test(raw), false, raw.slice(0, 400));
});

test('a player who removed or blocked the founder is not listed and cannot be messaged; they are only counted', async (t) => {
  const w = await world(t);
  const zed = await w.founder(), ada = await w.player('Ada'), bola = await w.player('Bola'), chi = await w.player('Chi');
  assert.equal((await w.get('/api/social/everyone', zed)).total, 3);
  assert.equal((await w.post('/api/social/friends/remove', { id: zed.id, cityId: 'lagos' }, ada)).ok, true);
  assert.equal((await w.post('/api/social/block', { id: zed.id, cityId: 'lagos' }, bola)).ok, true);
  const after = await w.get('/api/social/everyone', zed);
  assert.deepEqual(after.players.map((row) => row.name), ['Chi']);
  assert.deepEqual([after.total, after.gone], [1, 2]);
  assert.equal(JSON.stringify(after).includes('Ada'), false, 'no names of those who left');
  assert.equal((await w.post('/api/social/chats/open', { with: bola.id }, zed)).ok, false, 'a blocked player cannot be opened');
  assert.equal((await w.post('/api/social/messages', { to: bola.id, body: 'hi', clientId: w.f.id() }, zed)).ok, false);
});

test('online first and by city come from the connected players; the rest follow newest first', async (t) => {
  const w = await world(t), { f: fx } = w;
  const zed = await w.founder(), ada = await w.player('Ada'), bola = await w.player('Bola'), chi = await w.player('Chi');
  const room = await fx.joinRoom(bola);
  void room;
  const online = await w.get('/api/social/everyone?sort=online', zed);
  // The connected player first, then everyone newest first (the connected player is named again there; a list keeps the first).
  const named = [...new Set(online.players.map((row) => row.name))];
  assert.deepEqual([named[0], named.slice(1).sort()], ['Bola', ['Ada', 'Chi']]);
  assert.equal(online.players[0]?.status, 'online');
  assert.equal(online.players[0]?.cityId, 'lagos', 'the founder sees where a friend is');
  assert.equal(online.total, 3, 'the total is the whole list when the rest follow');
  const city = await w.get('/api/social/everyone?sort=city&city=lagos', zed);
  assert.deepEqual(city.players.map((row) => row.name), ['Bola']);
  assert.equal((await w.get('/api/social/everyone?sort=city&city=nowhere', zed)).status, 400);
  void ada; void chi;
});

test('the founder messages a player who never chatted: it is delivered, notified, answered; a dropped chat comes back when opened', async (t) => {
  const w = await world(t), { f: fx } = w;
  const zed = await w.founder(), ada = await w.player('Ada');
  // The player's welcome note is the only thing in their chat so far: delete the founder's chat to simulate a dropped one.
  const listed = (await w.get('/api/social/everyone', zed)).players[0]!;
  assert.equal(listed.chat, undefined, 'only the automatic note: no conversation yet');
  assert.equal((await w.post('/api/social/chats/open', { with: ada.id }, zed)).conv, null, 'nothing to open yet');
  const peer = await fx.socket(ada), heard: ServerFrame[] = [];
  peer.ws.on('message', (data) => { heard.push(JSON.parse(data.toString()) as ServerFrame); });
  const sent = await w.post('/api/social/messages', { to: ada.id, body: 'Welcome, Ada', clientId: fx.id() }, zed);
  assert.equal(sent.code, 'sent');
  await settleDown();
  assert.ok(heard.some((frame) => frame.type === 'dm'), 'the player is pushed the message');
  const mine = (await w.me(ada)).conversations.find((conv) => conv.with === zed.id)!;
  assert.deepEqual([mine.unread >= 1, mine.last?.body], [true, 'Welcome, Ada']);
  assert.equal((await w.post('/api/social/messages', { conv: mine.id, body: 'Thank you!', clientId: fx.id() }, ada)).code, 'sent');
  const row = (await w.get('/api/social/everyone', zed)).players.find((item) => item.id === ada.id)!;
  assert.deepEqual([row.chat?.unread, row.chat?.listed], [1, true], 'the reply reaches the founder and shows on the row');
  // The chat drops out of the founder's list (as the quietest does when the list is full); it is still reachable and comes back.
  await w.edit((db) => { delete must(db.social).players[zed.id]!.convs[mine.id]; });
  assert.deepEqual((await w.me(zed)).conversations, []);
  const dropped = (await w.get('/api/social/everyone', zed)).players.find((item) => item.id === ada.id)!;
  assert.deepEqual([dropped.chat?.listed, dropped.chat?.unread], [false, 0]);
  const opened = await w.post('/api/social/chats/open', { with: ada.id }, zed);
  assert.equal(opened.conv?.id, mine.id);
  assert.deepEqual(ids((await w.me(zed)).conversations), [mine.id]);
  assert.deepEqual((await w.get(`/api/social/conversations/${mine.id}`, zed)).messages.map((message) => message.body).slice(-2), ['Welcome, Ada', 'Thank you!']);
});

test('the founder keeps more chats than anyone, and the chat list is read a page at a time by cursor', async (t) => {
  const w = await world(t), { f: fx } = w;
  const zed = await w.founder();
  const people = await seed(w, zed.id, Array.from({ length: 130 }, (_, index) => `Chatter ${index}`), 2000);
  // 130 chats of the founder's own, each with one line, the newest last.
  await w.edit((db) => {
    const s = must(db.social, 'db.social');
    people.forEach((id, index) => {
      const key = `dm.${[id, zed.id].sort().join('.')}`;
      s.convs[key] = { id: key, kind: 'dm', members: [id, zed.id].sort(), seq: 1, created: 1, messages: [{ seq: 1, from: id, body: `line ${index}`, at: 10000 + index * 10 }] };
      s.players[zed.id]!.convs[key] = { read: 0 }; s.players[id]!.convs[key] = { read: 1 };
    });
  });
  const everything = (await w.get('/api/social/me', zed)).conversations;
  assert.equal(everything.length, LIMITS.convs, 'an old client still gets one hundred');
  const lite = await w.get('/api/social/me?lite=1', zed);
  assert.equal(lite.conversations.length, LIMITS.chatPage);
  assert.deepEqual(lite.friends, [], 'no automatic friends in the lite overview');
  assert.deepEqual(lite.friendsMore, { total: 130, next: null });
  const more = lite as unknown as { conversationsMore: { total: number; next: string; unreadOlder: number } };
  assert.deepEqual([more.conversationsMore.total, more.conversationsMore.unreadOlder], [130, 100]);
  // Page the rest; a new line arrives in an old chat meanwhile and moves it to the top without repeating or losing anything.
  const seen = lite.conversations.map((conv) => conv.id);
  let cursor: string | null = more.conversationsMore.next, calls = 0;
  while (cursor) {
    const page: Reply = await w.get(`/api/social/conversations?limit=30&after=${encodeURIComponent(cursor)}`, zed);
    seen.push(...ids(page.conversations)); cursor = page.next; calls += 1;
    // A chat that is spoken in moves to the top: where the reader already is, it is pushed live; it is never repeated lower down.
    if (calls === 1) await w.post('/api/social/messages', { to: people[129], body: 'bump', clientId: fx.id() }, zed);
  }
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen.length, 130, 'every chat is reachable, the founder\'s list does not drop any');
  assert.ok(seen.slice(0, 31).every((id, index) => index === 0 || id !== seen[0]));
  // Without a limit: one hundred at most for everyone else, a long list is never cut to nothing.
  assert.equal((await w.get('/api/social/conversations', zed)).conversations.length, 130);
  assert.equal((await w.get('/api/social/conversations?limit=5&after=bad', zed)).status, 400);
});

test('a conversation\'s lines come a page at a time: the newest forty on open, older ones by cursor, with `more`', async (t) => {
  const w = await world(t);
  const zed = await w.founder(), ada = await w.player('Ada');
  const key = `dm.${[ada.id, zed.id].sort().join('.')}`;
  await w.edit((db) => {
    const s = must(db.social, 'db.social');
    s.convs[key] = { id: key, kind: 'dm', members: [ada.id, zed.id].sort(), seq: 200, created: 1, messages: Array.from({ length: 200 }, (_, index) => ({ seq: index + 1, from: index % 2 ? zed.id : ada.id, body: `m${index + 1}`, at: 100 + index })) };
    s.players[ada.id]!.convs[key] = { read: 200 };
  });
  const open = await w.get(`/api/social/conversations/${key}`, ada);
  assert.deepEqual([open.messages.length, open.messages[0]?.seq, open.messages.at(-1)?.seq, open.more], [40, 161, 200, true]);
  const older = await w.get(`/api/social/conversations/${key}?before=161&limit=40`, ada);
  assert.deepEqual([older.messages.length, older.messages[0]?.seq, older.messages.at(-1)?.seq, older.more], [40, 121, 160, true]);
  const last = await w.get(`/api/social/conversations/${key}?before=41&limit=100`, ada);
  assert.deepEqual([last.messages.length, last.messages[0]?.seq, last.more], [40, 1, false]);
  // New lines keep arriving: the cursor is a line number, so the page before 121 is the same whatever was added after.
  await w.post('/api/social/messages', { conv: key, body: 'new', clientId: w.f.id() }, ada);
  assert.deepEqual(ids((await w.get(`/api/social/conversations/${key}?before=121&limit=3`, ada)).messages.map((m) => ({ id: String(m.seq) }))), ['118', '119', '120']);
  // The old way of asking still works: what came after a line, at most fifty.
  const caught = await w.get(`/api/social/conversations/${key}?after=150`, ada);
  assert.deepEqual([caught.messages.length, caught.messages[0]?.seq], [50, 152], 'the newest fifty after it');
  assert.equal((await w.get(`/api/social/conversations/${key}`, zed)).status, 200);
  assert.equal((await w.get(`/api/social/conversations/${key}?before=-4&limit=0`, ada)).status, 200);
});

test('Message selected: up to twenty, each an ordinary message with the usual rules; refused for anyone else and past its rate', async (t) => {
  const w = await world(t), { f: fx } = w;
  const zed = await w.founder(), ada = await w.player('Ada'), bola = await w.player('Bola'), chi = await w.player('Chi');
  await w.post('/api/social/block', { id: zed.id, cityId: 'lagos' }, bola);
  const peer = await fx.socket(ada), heard: ServerFrame[] = [];
  peer.ws.on('message', (data) => { heard.push(JSON.parse(data.toString()) as ServerFrame); });
  const clientId = fx.id();
  const done = await w.post('/api/social/messages/many', { to: [ada.id, bola.id, chi.id, ada.id], body: 'Hello all', clientId }, zed);
  assert.equal(done.code, 'sent', JSON.stringify(done));
  assert.deepEqual((done.results as { id: string; ok: boolean; code?: string }[]).map((item) => [item.id, item.ok, item.code]), [[ada.id, true, undefined], [bola.id, false, 'blocked'], [chi.id, true, undefined]]);
  assert.equal(done.sent, 2);
  await settleDown();
  assert.equal(heard.filter((frame) => frame.type === 'dm').length, 1, 'notified by the normal path');
  assert.equal((await w.get(`/api/social/conversations/${(await w.me(chi)).conversations.find((conv) => conv.with === zed.id)!.id}`, chi)).messages.at(-1)?.body, 'Hello all');
  // The same request again changes nothing.
  const again = await w.post('/api/social/messages/many', { to: [ada.id, bola.id, chi.id], body: 'Hello all', clientId }, zed);
  assert.equal(again.code, 'sent', JSON.stringify(again));
  assert.deepEqual((again.results as { duplicate?: boolean }[]).map((item) => item.duplicate), [true, undefined, true]);
  const tooMany = Array.from({ length: LIMITS.batchTo + 1 }, () => randomUUID());
  assert.equal((await w.post('/api/social/messages/many', { to: tooMany, body: 'x', clientId: fx.id() }, zed)).status, 400);
  assert.equal((await w.post('/api/social/messages/many', { to: [], body: 'x', clientId: fx.id() }, zed)).status, 400);
  assert.equal((await w.post('/api/social/messages/many', { to: [ada.id], body: '   ', clientId: fx.id() }, zed)).status, 400);
  let limited = 0;
  for (let i = 0; i < LIMITS.batchPerWindow + 2; i++) limited += (await w.post('/api/social/messages/many', { to: [chi.id], body: `again ${i}`, clientId: fx.id() }, zed)).code === 'rate_limited' ? 1 : 0;
  assert.ok(limited >= 1, 'a named limit holds');
  void ({} as ManyResult);
});

test('reads write nothing: the same overview and pages twice leave the stored collection as it was', async (t) => {
  const w = await world(t);
  const zed = await w.founder();
  await seed(w, zed.id, ['A One', 'B Two', 'C Three']);
  await w.get('/api/social/everyone', zed); await w.get('/api/social/me?lite=1', zed);
  const before = JSON.stringify(await w.social());
  for (const path of ['/api/social/everyone', '/api/social/everyone?sort=name', '/api/social/everyone?q=one', '/api/social/everyone?sort=online', '/api/social/conversations?limit=5']) await w.get(path, zed);
  const after = JSON.parse(JSON.stringify(await w.social())) as SocialCollection;
  const was = JSON.parse(before) as SocialCollection;
  assert.deepEqual(Object.keys(after.players).sort(), Object.keys(was.players).sort());
  for (const id of Object.keys(was.players)) assert.deepEqual({ ...after.players[id], seen: 0 }, { ...was.players[id], seen: 0 }, 'only the time of the last request moves');
  assert.deepEqual(after.convs, was.convs);
});
const settleDown = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
