// OWNER: social / growth — PING: who may ping whom, what leaves the game for it and what never does, the join link, and the
// join itself (server/social/ping.ts, server/growth/ping-mail.ts, src/game/systems/social.ts 'join').
// Fixture: see server/routes/index.ts ("HOW TO TEST"). No e-mail leaves the test: the mailer's endpoint is a fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import type { FixtureOptions } from './test-fixture.ts';
import { ENDPOINT } from './growth/email/zeptomail.ts';
import { RECONNECT_GRACE_MS } from './social/presence.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { emailHash } from './social/founder.ts';
import { PING } from '../src/game/ping.ts';
import { viewLife } from '../src/life.ts';
import { LODGING, SECOND_HOME, tierCost } from '../src/game/content/world.ts';
import type { TestContext } from 'node:test';
import type { Db, GrowthCollection, SocialCollection } from './types.ts';
import type { LifeState } from '../src/types/index.ts';
import type { ServerFrame } from '../src/types/protocol.ts';
import type { PingControl, PingNotice, PingPlace } from '../src/types/ping.ts';
import type { SocialOverview } from '../src/types/social.ts';

const HOUR = 3600000, DAY = 86400000, MINUTE = 60000;
const TOKEN = 'operator-token-for-ping-tests-01234567';
const LIVE: Record<string, string> = { ZEPTOMAIL_AUTH: 'Zoho-enczapikey TESTKEY-not-a-real-key', EMAIL_FROM_ADDRESS: 'hello@mail.play.example', EMAIL_FROM_NAME: 'Allworld', EMAIL_CONTACT_LINE: 'Allworld, 1 Example Street' };
const PROJECT = 'allworld-test-project';
const ACCOUNTS = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' };
const FOUNDER_ADDRESS = 'founder@example.com';

interface Who { id: string; cookie: string; name: string }
interface Reply {
  status: number; ok?: boolean; code?: string; error?: string; reason?: string; duplicate?: boolean
  note?: string; words?: string; link?: string; at?: number; expiresAt?: number; again?: number; place?: PingPlace; moved?: string; knock?: boolean; present?: boolean
  from?: { id: string; name: string }; to?: { id: string; name: string }; notice?: PingNotice | null; incoming?: PingNotice[]; control?: PingControl
  state: LifeState; updates: SocialOverview['updates']; city?: string
}
interface Mail { personalizations: { to: { email: string }[] }[]; subject: string; headers: Record<string, string>; content: { type: string; value: string }[] }
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`expected ${what}`); return value; };
const settleDown = (ms = 70): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
function listen(peer: { ws: { on(event: 'message', listener: (data: { toString(): string }) => void): unknown } }): ServerFrame[] {
  const frames: ServerFrame[] = [];
  peer.ws.on('message', (data) => { frames.push(JSON.parse(data.toString()) as ServerFrame); });
  return frames;
}

async function harness(t: TestContext, options: FixtureOptions = {}) {
  const calls: { url: string; body: string }[] = [], pushes: string[] = [];
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const f = await fixture(t, { moderatorToken: TOKEN, publicOrigin: 'https://play.example', log: () => {}, ...options, env: { ...LIVE, ...ACCOUNTS, FOUNDER_EMAIL_SHA256: emailHash(FOUNDER_ADDRESS), ...options.env },
    fetch: async (url, init) => { if (String(url).startsWith('https://fcm.googleapis.com/')) { pushes.push(String(url)); return new Response(null, { status: 201 }); } if (String(url) === ENDPOINT) { calls.push({ url: String(url), body: String((init as RequestInit).body) }); return new Response(null, { status: 202 }); } return provider.fetch(String(url), init as { body?: unknown }); } });
  const answer = async (res: Response): Promise<Reply> => ({ status: res.status, ...((await res.json()) as object) } as Reply);
  const post = async (path: string, body: unknown, who?: Pick<Who, 'cookie'>): Promise<Reply> => answer(await f.request(path, body, who?.cookie));
  const get = async (path: string, who: Pick<Who, 'cookie'>): Promise<Reply> => answer(await f.request(path, null, who.cookie));
  /** A device with a life, known to the social and growth modules, who said they are an adult. */
  async function player(name: string): Promise<Who> {
    const who = await f.device(name);
    await f.request('/api/life?city=lagos', null, who.cookie);
    await post('/api/growth/hello', { cityId: 'lagos' }, who);
    await post('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, who);
    await get('/api/social/me', who);
    return who;
  }
  const befriend = async (a: Who, b: Who): Promise<void> => { await post('/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a); await post('/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b); };
  const mails = (): Mail[] => calls.map((call) => JSON.parse(call.body) as Mail);
  const pingMails = (): Mail[] => mails().filter((mail) => /is waiting for you in Allworld$/.test(mail.subject));
  const textOf = (mail: Mail): string => must(mail.content.find((part) => part.type === 'text/plain') ?? mail.content[0], 'a text part').value;
  const htmlOf = (mail: Mail): string => must(mail.content.find((part) => part.type === 'text/html') ?? mail.content[1], 'an html part').value;
  const page = async (path: string, method = 'POST'): Promise<{ status: number; html: string }> => { const res = await fetch(f.base + path, { method }); return { status: res.status, html: await res.text() }; };
  /** Give a player a confirmed address: e-mails about their character are then on, every kind. */
  async function optIn(who: Who, email: string): Promise<void> {
    await post('/api/growth/email', { email, consent: true }, who);
    const text = textOf(must(mails().at(-1), 'a confirmation'));
    await page(must(/https:\/\/play\.example(\/e\/confirm\?t=[A-Za-z0-9_.-]+)/.exec(text)?.[1], 'a confirm link'));
  }
  const ping = (from: Who, to: Who, clientId = f.id()): Promise<Reply> => post('/api/social/ping', { to: to.id, clientId }, from);
  const join = (who: Who, from: Who, clientId = f.id()): Promise<Reply> => post('/api/social/ping/join', { from: from.id, clientId }, who);
  const life = async (who: Pick<Who, 'cookie'>, city = 'lagos'): Promise<LifeState> => (await get(`/api/life?city=${city}`, who)).state;
  const social = (): Promise<SocialCollection> => f.server.store.read((db) => structuredClone(must(db.social, 'db.social')));
  const growth = (): Promise<GrowthCollection> => f.server.store.read((db) => structuredClone(must(db.growth, 'db.growth')));
  const edit = (fn: (db: Db) => void): Promise<void> => f.server.store.transact((db) => { fn(db); });
  /** Move the clock to a Lagos day (0 = Thursday 1 January 1970) and hour. Never backwards. */
  const go = (day: number, hour = 12): void => { const target = Date.UTC(1970, 0, 1 + day, hour - 1); assert.ok(target >= f.now(), 'time only goes forward'); f.advance(target - f.now()); };
  /** Walk to a venue of Lagos and arrive. */
  async function walk(who: Who, venue: string, city = 'lagos'): Promise<void> {
    if ((await life(who, city)).location === venue) return;
    const started = await f.action(who.cookie, { cityId: city as 'lagos', type: 'travel', payload: { id: venue, mode: 'trek' } });
    assert.equal(started.ok, true, `set off for ${venue}: ${started.code}`);
    f.advance(20 * MINUTE);
    assert.equal((await life(who, city)).location, venue);
  }
  /** Take the road to Ibadan and arrive (a visitor there). */
  async function toIbadan(who: Who): Promise<void> {
    await edit((db) => { const session = must(Object.values(db.sessions).find((item) => item.publicId === who.id)); must(session.cities.lagos).state.cash += 10000; });
    const left = await f.action(who.cookie, { cityId: 'lagos', type: 'estate.relocate', payload: { to: 'ibadan', mode: 'road' } });
    assert.equal(left.ok, true, `left for Ibadan: ${left.code}`);
    f.advance(3 * MINUTE);
    await f.request('/api/life?city=lagos', null, who.cookie);
    assert.equal((await life(who, 'ibadan')).estate.city, 'ibadan');
  }
  /** Put naira in a player's pocket, in the city their life is filed under. */
  const fund = (who: Who, city: string, cash: number): Promise<void> => edit((db) => { const session = must(Object.values(db.sessions).find((item) => item.publicId === who.id)); must(session.cities[city as 'lagos']).state.cash = cash; });
  /** Take a paid trip between two cities and arrive. */
  async function trip(who: Who, from: string, to: string, mode: 'road' | 'rail' | 'air' = 'road'): Promise<void> {
    const left = await f.action(who.cookie, { cityId: from as 'lagos', type: 'estate.relocate', payload: { to: to as 'ibadan', mode } });
    assert.equal(left.ok, true, `left ${from} for ${to}: ${left.code}`);
    f.advance(3 * MINUTE);
    await f.request(`/api/life?city=${from}`, null, who.cookie);
    assert.equal((await life(who, to)).estate.city, to);
  }
  let minted = 0;
  const origin = (path: string, body: unknown, cookie?: string): Promise<Response> => fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: f.base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  /** The founder: a played character saved to the account whose address has the configured hash. */
  async function founder(name = 'Zed'): Promise<Who> {
    const device = await player(name);
    const csrf = ((await (await origin('/api/account', null, device.cookie)).json()) as { csrf: string | null }).csrf;
    const idToken = await signToken(key, claimsFor(PROJECT, f.now(), { subject: 'Founder', email: FOUNDER_ADDRESS, n: ++minted }));
    const response = await origin('/api/account/sign-in', { idToken, csrf }, device.cookie);
    assert.equal(response.status, 200, 'the founder signs in');
    await response.text();
    const who = { ...device, cookie: must(response.headers.get('set-cookie'), 'a cookie').split(';')[0] ?? '' };
    await get('/api/social/me', who);
    return who;
  }
  const mod = async (path: string, body: unknown): Promise<Reply> => answer(await fetch(f.base + path, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { f, calls, pushes, mod, post, get, player, befriend, mails, pingMails, textOf, htmlOf, page, optIn, ping, join, life, social, growth, edit, go, walk, toIbadan, fund, trip, founder };
}
type Harness = Awaited<ReturnType<typeof harness>>;
/** Ada (in the game, at the park) and Bayo (not connected, with a confirmed address), friends, at midday. */
async function pair(h: Harness) {
  const ada = await h.player('Ada'), bayo = await h.player('Bayo');
  await h.befriend(ada, bayo);
  await h.optIn(bayo, 'bayo@example.com');
  h.go(1, 12);
  const socket = await h.f.socket(ada);
  return { ada, bayo, socket };
}
const linkIn = (text: string): string => must(/https:\/\/play\.example(\/j\/[A-Za-z0-9_-]+)/.exec(text)?.[1], 'a join link');

test('a ping to a friend who is away: recorded once, one line in their Updates, one mail with the join link, and the pinger learns only "pinged"', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  const cid = h.f.id(), done = await h.ping(ada, bayo, cid);
  assert.deepEqual([done.status, done.ok, done.code, done.note], [200, true, 'pinged', 'later']);
  assert.equal(done.words, 'Pinged. Bayo will see it when they are back.');
  assert.equal(must(done.expiresAt) - must(done.at), PING.liveMinutes * MINUTE);
  assert.equal(must(done.again) - must(done.at), PING.pairMinutes * MINUTE);
  assert.match(must(done.link), /^\/j\/[A-Za-z0-9_-]{95}$/);
  assert.equal(must(done.place).cityId, 'lagos');
  assert.equal(must(done.place).label, 'at Freedom Park, Lagos');
  // Nothing in the answer is about delivery.
  assert.deepEqual(Object.keys(done).sort(), ['again', 'at', 'code', 'expiresAt', 'link', 'note', 'ok', 'place', 'serverTime', 'status', 'to', 'words']);
  await settleDown();
  const sent = h.pingMails();
  assert.equal(sent.length, 1);
  const mail = must(sent[0]);
  assert.equal(mail.subject, 'Ada is waiting for you in Allworld');
  assert.equal(must(mail.personalizations[0]?.to[0]).email, 'bayo@example.com');
  assert.equal(linkIn(h.textOf(mail)), done.link, 'the mail carries the same join link the pinger may share');
  assert.match(must(mail.headers['List-Unsubscribe']), /^<https:\/\/play\.example\/e\/unsub\?t=[A-Za-z0-9_.-]+>$/);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  // The same request again is the same ping: no second record, no second mail.
  const again = await h.ping(ada, bayo, cid);
  assert.deepEqual([again.code, again.duplicate, again.link], ['pinged', true, done.link]);
  await settleDown();
  assert.equal(h.pingMails().length, 1);
  const stored = await h.social();
  assert.deepEqual(Object.keys(must(stored.pings)), [`${ada.id}>${bayo.id}`]);
  assert.equal(must(stored.pings)[`${ada.id}>${bayo.id}`]?.state, 'open');
  const line = must(must(stored.players[bayo.id]).updates.at(-1));
  assert.deepEqual([line.kind, line.data?.from, line.read], ['ping', ada.id, false]);
  assert.match(line.text, /^Ada is at .+ and pinged you to come\.$/);
  // A new ping to the same friend waits, and says until when.
  const soon = await h.ping(ada, bayo);
  assert.deepEqual([soon.ok, soon.code, soon.again], [false, 'cooldown', done.again]);
  assert.match(must(soon.reason), /^You pinged Bayo a moment ago\. You can ping again in 30 minutes\.$/);
  const control = must((await h.get(`/api/social/ping/${bayo.id}`, ada)).control);
  assert.deepEqual([control.can, control.code, control.again, control.live?.link], [false, 'cooldown', done.again, done.link]);
  // The operator's counters know one ping mail; they hold no address, name or id.
  const stats = Object.values(must((await h.growth()).comebackStats))[0]?.ping;
  assert.deepEqual([stats?.queued, stats?.sent], [1, 1]);
});

test('a friend who is in the game is told there, with a frame and no mail; a friend who cannot be mailed gets the same answer as one who can', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  const peer = await h.f.socket(bayo), heard = listen(peer);
  const done = await h.ping(ada, bayo);
  assert.deepEqual([done.code, done.note, done.words], ['pinged', 'told', 'Bayo is in the game and has been told.']);
  await settleDown();
  const frame = must(heard.find((item) => item.type === 'ping-incoming'), 'a ping-incoming frame') as Extract<ServerFrame, { type: 'ping-incoming' }>;
  assert.deepEqual([frame.notice.from.id, frame.notice.from.name, frame.notice.place.cityId, frame.notice.expiresAt], [ada.id, 'Ada', 'lagos', done.expiresAt]);
  assert.equal(h.pingMails().length, 0, 'never a mail while they are connected');
  assert.deepEqual((await h.get('/api/social/ping', bayo)).incoming?.map((item) => item.from.id), [ada.id]);
  // Chidi has no address and no notification. What Ada is told about him has the same shape and the same sentence.
  const chidi = await h.player('Chidi');
  await h.befriend(ada, chidi);
  const quiet = await h.ping(ada, chidi);
  const eze = await h.player('Eze');
  await h.befriend(ada, eze);
  await h.optIn(eze, 'eze@example.com');
  const loud = await h.ping(ada, eze);
  assert.deepEqual([quiet.code, quiet.note, quiet.words], ['pinged', 'later', 'Pinged. Chidi will see it when they are back.']);
  assert.deepEqual([loud.code, loud.note, loud.words], ['pinged', 'later', 'Pinged. Eze will see it when they are back.']);
  assert.deepEqual(Object.keys(quiet).sort(), Object.keys(loud).sort());
  await settleDown();
  assert.deepEqual(h.pingMails().map((mail) => must(mail.personalizations[0]?.to[0]).email), ['eze@example.com']);
});

test('the Friends switch, the pause, an unsubscribe link of either kind, and the night all stop the mail — and the ping still stands in the game', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  await h.post('/api/growth/comeback', { cityId: 'lagos', types: { friends: false } }, bayo);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  await settleDown();
  assert.equal(h.pingMails().length, 0, 'Friends is off');
  await h.post('/api/growth/comeback', { cityId: 'lagos', types: { friends: true }, pause: true }, bayo);
  h.f.advance(31 * MINUTE);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  await settleDown();
  assert.equal(h.pingMails().length, 0, 'paused');
  await h.post('/api/growth/comeback', { cityId: 'lagos', pause: false }, bayo);
  h.f.advance(31 * MINUTE);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  await settleDown();
  assert.equal(h.pingMails().length, 1);
  // The mail's own "stop" link is for e-mails about friends: one tap, no sign-in, and Friends is off.
  const text = h.textOf(must(h.pingMails()[0]));
  const stop = must(/Stop e-mails about my friends: https:\/\/play\.example(\/e\/unsub\?t=[A-Za-z0-9_.-]+)/.exec(text)?.[1], 'a stop link');
  const all = must(/Unsubscribe from everything: https:\/\/play\.example(\/e\/unsub\?t=[A-Za-z0-9_.-]+)/.exec(text)?.[1], 'an unsubscribe link');
  assert.notEqual(stop, all);
  assert.match((await h.page(stop, 'GET')).html, /e-mails about your friends/);
  assert.equal((await h.page(stop)).status, 200);
  assert.equal(must((await h.growth()).comeback)[bayo.id]?.types.friends, false);
  h.go(2, 12);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  await settleDown();
  assert.equal(h.pingMails().length, 1, 'stopped by the link');
  // Friends back on; then the link for everything deletes the address.
  await h.post('/api/growth/comeback', { cityId: 'lagos', types: { friends: true } }, bayo);
  assert.equal((await h.page(all)).status, 200);
  assert.equal(must((await h.growth()).contacts)[bayo.id], undefined);
  h.go(3, 12);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  await settleDown();
  assert.equal(h.pingMails().length, 1, 'unsubscribed from everything');
  // Night (Lagos time): nothing leaves, whoever the friend is, and the pinger is told why they will see it later.
  const eze = await h.player('Eze');
  await h.befriend(ada, eze);
  await h.optIn(eze, 'eze@example.com');
  h.go(3, 22);
  const night = await h.ping(ada, eze);
  assert.deepEqual([night.code, night.note, night.words], ['pinged', 'night', 'It is night for Eze; they will see it when they are back.']);
  await settleDown();
  assert.equal(h.pingMails().length, 1);
  assert.equal(must((await h.social()).players[eze.id]).updates.at(-1)?.kind, 'ping', 'the notice in the game is kept');
});

test('the caps: a pair, a recipient across senders, a sender per hour, and no more mail to someone who never comes', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  const count = async (): Promise<number> => { await settleDown(); return h.pingMails().length; };
  const friends = [await h.player('Chi'), await h.player('Dayo'), await h.player('Efe')];
  for (const friend of friends) { await h.befriend(friend, bayo); await h.f.socket(friend); }
  h.f.advance(MINUTE);
  // ONE PAIR: once in four hours, twice in a day.
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  assert.equal(await count(), 1);
  h.f.advance(31 * MINUTE);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged', 'the ping itself is allowed again after half an hour');
  assert.equal(await count(), 1, 'but not a second mail inside four hours');
  h.f.advance(4 * HOUR);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  assert.equal(await count(), 2);
  h.f.advance(4 * HOUR + MINUTE);
  assert.equal(nightHour(h), false);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  assert.equal(await count(), 2, 'two a day from one friend');
  // ONE RECIPIENT: two a day from everybody together.
  assert.equal((await h.ping(must(friends[0]), bayo)).code, 'pinged');
  assert.equal((await h.ping(must(friends[1]), bayo)).code, 'pinged');
  assert.equal(await count(), 2, 'two ping mails in a day is the most one player gets, whoever pings');
  const ledger = must(must((await h.growth()).comeback)[bayo.id]).pings ?? [];
  assert.deepEqual(ledger.map((entry) => entry.from), [ada.id, ada.id]);
  const held = Object.values(must((await h.growth()).comebackStats)).reduce((sum, day) => sum + (day.ping?.suppressed ?? 0), 0);
  assert.equal(held, 4, 'what the caps held back is counted for the operator');
  assert.equal(must(must((await h.growth()).comeback)[bayo.id]).sent.length, 0, 'the ledger of the automatic mails is not touched');
  // NEVER COMES BACK: three mails from one friend with no visit since, and that friend's pings are not mailed any more.
  h.go(2, 18);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  assert.equal(await count(), 3, 'the third from Ada');
  h.go(3, 19);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  assert.equal(await count(), 3, 'held back: Bayo has not been here since the first');
  // He comes back: the next ping (he is away again) is mailed.
  await h.post('/api/growth/hello', { cityId: 'lagos' }, bayo);
  h.go(4, 20);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  assert.equal(await count(), 4);
});
const nightHour = (h: Harness): boolean => { const hour = new Date(h.f.now() + HOUR).getUTCHours(); return hour >= 21 || hour < 8; };

test('a sender may ping ten times an hour and thirty a day, whoever they are', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada');
  const friends: Who[] = [];
  for (let i = 0; i < 6; i++) { const friend = await h.player(`Friend${i}`); await h.befriend(ada, friend); friends.push(friend); }
  h.go(1, 12);
  await h.f.socket(ada);
  for (const friend of friends) assert.equal((await h.ping(ada, friend)).code, 'pinged');
  h.f.advance(31 * MINUTE);
  for (const friend of friends.slice(0, 4)) assert.equal((await h.ping(ada, friend)).code, 'pinged');
  const over = await h.ping(ada, must(friends[4]));
  assert.deepEqual([over.ok, over.code, over.reason], [false, 'rate_limited', `You have pinged ${PING.perHour} times this hour. Try again later.`]);
  assert.equal(must((await h.social()).pings)[`${ada.id}>${must(friends[4]).id}`]?.at, must((await h.social()).pings)[`${ada.id}>${must(friends[0]).id}`]!.at - 31 * MINUTE, 'a refused ping changed nothing');
});

test('strangers, blocked players and muted senders cannot ping; a block made after a ping closes it', async (t) => {
  const h = await harness(t, { moderatorToken: TOKEN }), { ada, bayo } = await pair(h);
  const stranger = await h.player('Chidi');
  const no = await h.ping(ada, stranger);
  assert.deepEqual([no.ok, no.code, no.reason], [false, 'not_friends', 'Add Chidi as a friend to ping them.']);
  assert.equal((await h.ping(ada, ada)).code, 'self');
  assert.equal((await h.post('/api/social/ping', { to: 'not-a-player', clientId: h.f.id() }, ada)).error, 'invalid_player');
  assert.equal((await h.post('/api/social/ping', { to: bayo.id }, ada)).error, 'client_id_required');
  // A pinger with no live connection has nowhere to be joined.
  const offline = await h.ping(bayo, ada);
  assert.deepEqual([offline.ok, offline.code], [false, 'not_live']);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  await settleDown();
  assert.equal(h.pingMails().length, 1);
  // Bayo blocks Ada: the ping is over for him, Ada cannot ping again, and the join says no more than "left".
  await h.post('/api/social/block', { id: ada.id, cityId: 'lagos' }, bayo);
  assert.deepEqual((await h.get('/api/social/ping', bayo)).incoming, []);
  const joined = await h.join(bayo, ada);
  assert.deepEqual([joined.ok, joined.code, joined.reason, joined.from], [false, 'left', 'That invitation is no longer open.', undefined]);
  h.f.advance(31 * MINUTE);
  const blocked = await h.ping(ada, bayo);
  assert.deepEqual([blocked.ok, blocked.code], [false, 'blocked']);
  await h.post('/api/social/unblock', { id: ada.id }, bayo);
  assert.equal((await h.ping(ada, bayo)).code, 'not_friends', 'a block ended the friendship');
  await settleDown();
  assert.equal(h.pingMails().length, 1);
});

test('the founder: a player with the automatic friendship cannot ping them at all; the founder pings such a friend under the caps everyone has', async (t) => {
  const h = await harness(t);
  const zed = await h.founder();
  const ngozi = await h.player('Ngozi');
  await h.optIn(ngozi, 'ngozi@example.com');
  await h.optIn(zed, 'founder-contact@example.com');
  h.go(1, 12);
  const peer = await h.f.socket(zed), heard = listen(peer);
  const stored = await h.social();
  assert.notEqual(must(stored.players[ngozi.id]).friends[zed.id], undefined, 'Ngozi holds the automatic friendship');
  assert.equal(must(stored.players[zed.id]).friends[ngozi.id], undefined);
  const up = await h.ping(ngozi, zed);
  assert.deepEqual([up.ok, up.code], [false, 'founder']);
  assert.match(must(up.reason), /is everyone’s first friend, so they cannot be pinged\. Send them a message instead\.$/);
  const control = must((await h.get(`/api/social/ping/${zed.id}`, ngozi)).control);
  assert.deepEqual([control.can, control.code], [false, 'founder']);
  await settleDown();
  assert.equal(heard.filter((frame) => frame.type === 'ping-incoming').length, 0, 'the founder is sent nothing');
  assert.equal(must((await h.social()).players[zed.id]).updates.length, 0);
  assert.equal((await h.social()).pings, undefined, 'and nothing is stored');
  assert.equal(h.pingMails().length, 0);
  // The other way it is an ordinary ping: one friend at a time, counted like anybody's.
  const down = await h.ping(zed, ngozi);
  assert.deepEqual([down.ok, down.code, down.note], [true, 'pinged', 'later']);
  await settleDown();
  assert.deepEqual(h.pingMails().map((mail) => must(mail.personalizations[0]?.to[0]).email), ['ngozi@example.com']);
  // A friendship the founder made by request is a friendship like any other: that friend may ping them.
  const kemi = await h.player('Kemi');
  await h.post('/api/social/friends/remove', { id: zed.id, cityId: 'lagos' }, kemi);
  await h.befriend(kemi, zed);
  assert.notEqual(must((await h.social()).players[zed.id]).friends[kemi.id], undefined);
  await h.f.socket(kemi);
  assert.equal((await h.ping(kemi, zed)).code, 'pinged');
});

test('the join link: forged, expired, somebody else’s, or no session at all — it never signs anyone in and never moves the wrong life', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  await h.walk(bayo, 'library');
  const done = await h.ping(ada, bayo), token = must(done.link).slice(3);
  // No session: 401, like every other social request. A link is not a login.
  const anonymous = await h.f.request('/api/social/ping/open', { token });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('set-cookie'), null, 'opening a link sets no cookie');
  // The player it was made for.
  const mine = await h.post('/api/social/ping/open', { token }, bayo);
  assert.deepEqual([mine.ok, mine.code, mine.from?.id, mine.notice?.from.id, mine.notice?.place.venue], [true, 'yours', ada.id, ada.id, 'park']);
  // Somebody else: told only that, and nothing about whose it was.
  const chidi = await h.player('Chidi');
  await h.walk(chidi, 'library');
  const theirs = await h.post('/api/social/ping/open', { token }, chidi);
  assert.deepEqual([theirs.ok, theirs.code], [true, 'other']);
  assert.deepEqual(Object.keys(theirs).sort(), ['code', 'ok', 'serverTime', 'status']);
  // A token is no authority for the join either: Chidi has no ping from Ada.
  const stolen = await h.join(chidi, ada);
  assert.deepEqual([stolen.ok, stolen.code], [false, 'left']);
  assert.equal((await h.life(chidi)).location, 'library');
  // Forged: any change to the body or the signature.
  const flip = (text: string, at: number, by: number): string => { const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; return `${text.slice(0, at)}${letters[(letters.indexOf(text[at] ?? 'A') + by) % 64]}${text.slice(at + 1)}`; };
  // The last character carries four bits of the signature and two that mean nothing: neither kind of change is accepted.
  for (const forged of [flip(token, 20, 1), flip(token, 60, 1), flip(token, 94, 4), flip(token, 94, 1), flip(token, 94, 2), flip(token, 94, 3), token.slice(0, -2), `${token}AA`, 'x', '']) {
    const bad = await h.post('/api/social/ping/open', { token: forged }, bayo);
    assert.deepEqual([bad.ok, bad.code], [false, 'invalid_link'], forged.slice(0, 12));
  }
  assert.equal((await h.post('/api/social/ping/open', { token: 12 }, bayo)).code, 'invalid_link');
  // Past its hour.
  h.f.advance(PING.liveMinutes * MINUTE + 1000);
  assert.deepEqual([(await h.post('/api/social/ping/open', { token }, bayo)).code], ['invalid_link']);
  const late = await h.join(bayo, ada);
  assert.deepEqual([late.ok, late.code, late.reason, late.from?.id], [false, 'left', 'Ada has left. You can message them.', ada.id]);
  assert.equal((await h.life(bayo)).location, 'library');
});

test('the join, same city: the friend lands at the pinger’s venue at once, free, exactly once; both are told; the ping is used up', async (t) => {
  const h = await harness(t), { ada, bayo, socket } = await pair(h);
  await h.walk(bayo, 'library');
  const heard = listen(socket);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  const before = await h.life(bayo);
  assert.equal(before.location, 'library');
  const cid = h.f.id(), done = await h.join(bayo, ada, cid);
  assert.deepEqual([done.ok, done.code, done.moved, done.knock, done.present, done.from?.id], [true, 'joined', 'venue', false, true, ada.id]);
  assert.equal(done.words, `You joined Ada ${must(done.place).label}.`);
  assert.equal(must(done.place).venue, 'park');
  const after = await h.life(bayo);
  assert.deepEqual([after.location, after.cash, after.activeAction], ['park', before.cash, null]);
  // The same request again answers the same and moves nothing.
  await h.walk(bayo, 'radio');
  const again = await h.join(bayo, ada, cid);
  assert.deepEqual([again.code, again.duplicate], ['joined', true]);
  assert.equal((await h.life(bayo)).location, 'radio');
  // A new request finds the ping used up.
  assert.equal((await h.join(bayo, ada)).code, 'left');
  await settleDown();
  const frame = must(heard.find((item) => item.type === 'ping-joined'), 'a ping-joined frame') as Extract<ServerFrame, { type: 'ping-joined' }>;
  assert.deepEqual([frame.by.id, frame.by.name, frame.place.venue], [bayo.id, 'Bayo', 'park']);
  const stored = await h.social();
  assert.equal(must(stored.pings)[`${ada.id}>${bayo.id}`]?.state, 'joined');
  assert.match(must(must(stored.players[ada.id]).updates.at(-1)).text, /^Bayo joined you at .+, Lagos\.$/);
});

test('the join follows the pinger: a new venue, a trip in between, and a pinger who has left the game', async (t) => {
  const h = await harness(t), { ada, bayo, socket } = await pair(h);
  await h.walk(bayo, 'radio');
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  // On the way somewhere: not yet.
  assert.equal((await h.f.action(ada.cookie, { cityId: 'lagos', type: 'travel', payload: { id: 'library', mode: 'trek' } })).ok, true);
  const moving = await h.join(bayo, ada);
  assert.deepEqual([moving.ok, moving.code, moving.from?.id], [false, 'travelling', ada.id]);
  assert.match(must((await h.ping(ada, await friendOf(h, ada))).reason), /^You are on the way somewhere\./);
  h.f.advance(20 * MINUTE);
  assert.equal((await h.life(ada)).location, 'library');
  // Bayo is in the middle of something of his own: it is not thrown away.
  assert.equal((await h.f.action(bayo.cookie, { cityId: 'lagos', type: 'travel', payload: { id: 'park', mode: 'trek' } })).ok, true);
  const busy = await h.join(bayo, ada);
  assert.deepEqual([busy.ok, busy.code], [false, 'busy']);
  assert.equal(must((await h.life(bayo)).activeAction).kind, 'travel');
  assert.equal((await h.f.action(bayo.cookie, { cityId: 'lagos', type: 'cancel' })).ok, true);
  // Now he joins her where she is NOW, not where she pinged from.
  const done = await h.join(bayo, ada);
  assert.deepEqual([done.code, must(done.place).venue], ['joined', 'library']);
  assert.equal((await h.life(bayo)).location, 'library');
  // A second ping; Ada closes the game for good. It is over, he is told she has left, and he stays where he is.
  h.f.advance(31 * MINUTE);
  await h.walk(bayo, 'radio');
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  socket.ws.close();
  await settleDown();
  assert.equal((await h.join(bayo, ada)).code, 'reconnecting', 'a dropped connection gets its few seconds');
  h.f.advance(RECONNECT_GRACE_MS + 1000);
  assert.deepEqual((await h.get('/api/social/ping', bayo)).incoming, []);
  const gone = await h.join(bayo, ada);
  assert.deepEqual([gone.ok, gone.code, gone.reason, gone.from?.id], [false, 'left', 'Ada has left. You can message them.', ada.id]);
  assert.equal((await h.life(bayo)).location, 'radio');
  assert.equal(must((await h.social()).pings)[`${ada.id}>${bayo.id}`]?.state, 'ended');
});
async function friendOf(h: Harness, who: Who): Promise<Who> { const friend = await h.player('Spare'); await h.befriend(who, friend); return friend; }

test('the join, another city: a free arrival at the pinger’s venue through the trip’s own arrival — a visitor there, the home left behind kept', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  await h.toIbadan(ada);
  const there = await h.life(ada, 'ibadan');
  assert.notEqual(there.location, 'home');
  const pinged = await h.ping(ada, bayo);
  assert.deepEqual([pinged.code, must(pinged.place).cityId, must(pinged.place).cityName], ['pinged', 'ibadan', 'Ibadan']);
  const before = await h.life(bayo);
  const done = await h.join(bayo, ada);
  assert.deepEqual([done.ok, done.code, done.moved, must(done.place).venue], [true, 'joined', 'city', there.location]);
  // The life is in Ibadan now, filed there, and asking for it in Lagos says where it went.
  const moved = await h.get('/api/life?city=lagos', bayo);
  assert.deepEqual([moved.status, moved.error, moved.city], [409, 'city_moved', 'ibadan']);
  const after = await h.life(bayo, 'ibadan');
  assert.deepEqual([after.estate.city, after.location, after.cash, after.activeAction], ['ibadan', there.location, before.cash, null]);
  assert.equal(after.estate.lga, null, 'a visitor: no local government chosen there');
  assert.equal(must(after.estate.away.lagos).lga, before.estate.lga, 'the Lagos home is kept as it was');
  assert.deepEqual(must((await h.social()).pingJoins)[bayo.id]?.length, 1);
  // The way home is the ordinary paid trip.
  const fare = must(after.cash);
  await h.edit((db) => { const session = must(Object.values(db.sessions).find((item) => item.publicId === bayo.id)); must(session.cities.ibadan).state.cash = 5000; });
  const home = await h.f.action(bayo.cookie, { cityId: 'ibadan', type: 'estate.relocate', payload: { to: 'lagos', mode: 'road' } });
  assert.equal(home.ok, true);
  assert.equal(home.state.cash, 5000 - 3500);
  assert.ok(Number.isFinite(fare));
});

test('free journeys by joining are counted: three a day, then the Map and its fare', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  await h.toIbadan(ada);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  const t0 = h.f.now();
  await h.edit((db) => { must(db.social).pingJoins = { [bayo.id]: [t0 - 3 * HOUR, t0 - 2 * HOUR, t0 - HOUR] }; });
  const capped = await h.join(bayo, ada);
  assert.deepEqual([capped.ok, capped.code, capped.from?.id], [false, 'join_cap', ada.id]);
  assert.equal(capped.reason, `You have joined friends in other cities ${PING.freeJoinsPerDay} times today. You can travel to Ibadan from the Map, or join again tomorrow.`);
  assert.equal((await h.life(bayo)).estate.city, 'lagos');
  // The oldest of the three is a day old: one journey is free again.
  await h.edit((db) => { must(db.social).pingJoins = { [bayo.id]: [t0 - DAY - 1, t0 - 2 * HOUR, t0 - HOUR] }; });
  assert.equal((await h.join(bayo, ada)).code, 'joined');
  assert.equal(must((await h.social()).pingJoins)[bayo.id]?.length, 3);
});

test('a ping from home never says more than the city, and brings the friend to the door, not through it', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  await h.walk(ada, 'home');
  assert.equal((await h.life(bayo)).location, 'park');
  const pinged = await h.ping(ada, bayo);
  assert.deepEqual([must(pinged.place).venue, must(pinged.place).home, must(pinged.place).label], ['home', true, 'at home in Lagos']);
  await settleDown();
  const mail = must(h.pingMails()[0]), text = h.textOf(mail), estate = (await h.life(ada)).estate;
  assert.match(text, /Ada is in Allworld right now, at home in Lagos, and pinged you to come\./);
  for (const secret of [estate.lga, String(estate.plot?.estate ?? 'no-plot-yet'), 'Estate', 'Plot']) if (secret) assert.ok(!text.includes(String(secret)), `the mail says nothing of ${String(secret)}`);
  assert.equal(must((await h.social()).pings)[`${ada.id}>${bayo.id}`]?.venue, 'home');
  // Same city: nobody is moved; coming in is the house's own knock.
  const done = await h.join(bayo, ada);
  assert.deepEqual([done.ok, done.code, done.moved, done.knock, done.words], [true, 'at_home', 'none', true, 'Ada is at home in Lagos. Knock to come in.']);
  assert.equal((await h.life(bayo)).location, 'park');
  assert.equal((await h.social()).houses[ada.id], undefined, 'no visit was made by the join');
});

test('a life still held for its look can do none of this, and a guest who has not settled in does not leave the city', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  const opened = await h.f.request('/api/session', { name: 'Ngozi', onboarding: true });
  const ngozi: Who = { name: 'Ngozi', id: ((await opened.json()) as { session: { id: string } }).session.id, cookie: must(opened.headers.get('set-cookie')).split(';')[0] ?? '' };
  await h.f.request('/api/life?city=lagos', null, ngozi.cookie);
  for (const answer of [await h.ping(ngozi, ada), await h.join(ngozi, ada), await h.get('/api/social/ping', ngozi), await h.get(`/api/social/ping/${ada.id}`, ngozi), await h.post('/api/social/ping/cancel', { to: ada.id }, ngozi)]) assert.deepEqual([answer.status, answer.error], [403, 'onboarding_required']);
  // She taps Play: a guest. Friends with Ada, who is in Ibadan.
  const look = { body: 'woman', hair: 'braids', outfit: 'casual', fabric: 'ankara', skin: 'skin-6', hairColor: 'soft-black', outfitColor: 'orange', bottomsColor: 'teal' };
  assert.equal((await h.f.action(ngozi.cookie, { cityId: 'lagos', type: 'onboarding.quick-start', payload: { look } })).code, 'playing');
  await h.get('/api/social/me', ngozi);
  await h.befriend(ada, ngozi);
  await h.toIbadan(ada);
  assert.equal((await h.ping(ada, ngozi)).code, 'pinged');
  const held = await h.join(ngozi, ada);
  assert.deepEqual([held.ok, held.code], [false, 'settle_required']);
  assert.match(must(held.reason), /^Ada is in Ibadan\. Settle in first/);
  assert.equal((await h.life(ngozi)).estate.city, 'lagos');
  assert.equal(bayo.name, 'Bayo');
});

test('a store from before pings reads as it was, and a damaged ping record cannot break a request', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  assert.equal((await h.social()).pings, undefined);
  assert.deepEqual((await h.get('/api/social/ping', bayo)).incoming, []);
  assert.equal(must((await h.get(`/api/social/ping/${bayo.id}`, ada)).control).can, true);
  await h.edit((db) => { Reflect.set(must(db.social), 'pings', { junk: null, [`${ada.id}>${bayo.id}`]: 7 }); Reflect.set(must(db.social), 'pingJoins', 'x'); });
  assert.equal((await h.get('/api/social/ping', bayo)).status, 200);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  assert.equal((await h.join(bayo, ada)).ok, true);
});

test('a muted sender cannot ping; a ping can be taken back; and it ends by itself when the pinger has left the game', async (t) => {
  const h = await harness(t), { ada, bayo, socket } = await pair(h);
  const peer = await h.f.socket(bayo), heard = listen(peer);
  assert.equal((await h.mod('/api/mod/mutes', { id: ada.id, minutes: 10, reason: 'Testing' })).ok, true);
  const muted = await h.ping(ada, bayo);
  assert.deepEqual([muted.ok, muted.code, muted.reason], [false, 'muted', 'You cannot send pings right now.']);
  h.f.advance(11 * MINUTE);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  assert.equal((await h.get('/api/social/ping', bayo)).incoming?.length, 1);
  // Taken back: the friend's notice goes, the wait before the next ping stays.
  const cancelled = await h.post('/api/social/ping/cancel', { to: bayo.id }, ada);
  assert.deepEqual([cancelled.ok, cancelled.code, cancelled.duplicate], [true, 'cancelled', undefined]);
  assert.equal((await h.post('/api/social/ping/cancel', { to: bayo.id }, ada)).duplicate, true);
  await settleDown();
  assert.deepEqual(heard.filter((frame) => frame.type === 'ping-ended').map((frame) => (frame as { from: string }).from), [ada.id]);
  assert.deepEqual((await h.get('/api/social/ping', bayo)).incoming, []);
  assert.equal((await h.join(bayo, ada)).code, 'left');
  assert.equal((await h.ping(ada, bayo)).code, 'cooldown');
  // A live ping whose owner leaves: one heartbeat after the grace period ends it and tells the friend.
  h.f.advance(31 * MINUTE);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  heard.length = 0;
  socket.ws.close();
  await settleDown();
  h.f.advance(RECONNECT_GRACE_MS + 1000);
  h.f.server.beat();
  await settleDown(150);
  assert.deepEqual(heard.filter((frame) => frame.type === 'ping-ended').map((frame) => (frame as { from: string }).from), [ada.id]);
  assert.equal(must((await h.social()).pings)[`${ada.id}>${bayo.id}`]?.state, 'ended');
});

test('a notification goes to a subscribed browser of a friend who is away, with the join link as its address — never while they are in the game, never at night', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  const UA = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
  assert.equal((await h.post('/api/growth/push/subscribe', { cityId: 'lagos', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/device-1', keys: UA }, consent: true }, bayo)).ok, true);
  h.f.advance(MINUTE);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  await settleDown(150);
  assert.deepEqual(h.pushes, ['https://fcm.googleapis.com/fcm/send/device-1']);
  // In the game: the frame is enough.
  const peer = await h.f.socket(bayo);
  h.f.advance(31 * MINUTE);
  assert.equal((await h.ping(ada, bayo)).note, 'told');
  await settleDown(150);
  assert.equal(h.pushes.length, 1);
  peer.ws.close();
  await settleDown();
  h.go(1, 22);
  assert.equal((await h.ping(ada, bayo)).note, 'night');
  await settleDown(150);
  assert.equal(h.pushes.length, 1, 'nothing at night');
});

/** The Home tab of a life, as the page works it out from the state the server answered with. */
const homeTab = (state: LifeState, now: number) => viewLife(state, { now, cityId: state.estate.city }).estate;

test('a ping from home in another city brings the friend to that city’s public arrival place, and to the door', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  await h.toIbadan(ada);
  // A visitor is never made to choose: a local government with no word on how is refused, and nothing is given away.
  const plain = await h.f.action(ada.cookie, { cityId: 'ibadan', type: 'estate.set-lga', payload: { lga: 'ibadan-north', via: 'manual' } });
  assert.deepEqual([plain.ok, plain.code], [false, 'choice_required']);
  // Ada makes Ibadan her main home: her one free starter house stands there now.
  assert.equal((await h.f.action(ada.cookie, { cityId: 'ibadan', type: 'estate.set-lga', payload: { lga: 'ibadan-north', via: 'manual', home: 'main' } })).ok, true);
  await h.walk(ada, 'home', 'ibadan');
  const pinged = await h.ping(ada, bayo);
  assert.deepEqual([must(pinged.place).label, must(pinged.place).venue], ['at home in Ibadan', 'home']);
  const before = await h.life(bayo);
  const done = await h.join(bayo, ada);
  assert.deepEqual([done.ok, done.code, done.moved, done.knock, done.words], [true, 'at_home', 'city', true, 'Ada is at home in Ibadan. Knock to come in.']);
  const after = await h.life(bayo, 'ibadan');
  assert.deepEqual([after.estate.city, after.location, after.activeAction], ['ibadan', 'agodi-gardens', null]);
  // A visitor: no fare, no free house, no local government chosen for him, and his one main home is where it was.
  assert.equal(after.cash, before.cash, 'the join is free');
  assert.deepEqual([after.estate.lga, after.estate.lgaConfirmed, after.estate.plot, after.estate.home, after.estate.homeAt], [null, false, null, 'lagos', before.estate.homeAt]);
  assert.deepEqual(Object.keys(after.estate.away), ['lagos']);
  const kept = must(after.estate.away.lagos);
  assert.deepEqual([kept.lga, kept.tier, kept.living, kept.lgaConfirmed], [before.estate.lga, before.estate.tier, before.estate.living, before.estate.lgaConfirmed]);
  // What is said: the life's own line names the place and where home is, and it is not the trip's welcome (the page says that one aloud).
  assert.equal(after.message, 'You joined Ada at Agodi Gardens, Ibadan. You are visiting: your home is in Lagos.');
  assert.ok(!after.message.startsWith('Welcome to '));
  // His Home tab: a visitor with both choices open, a guest house, and nothing that must be answered.
  const tab = homeTab(after, h.f.now());
  assert.deepEqual([tab.visiting, tab.home, tab.makeMain], [true, { city: 'lagos', name: 'Lagos', here: false }, null]);
  assert.deepEqual([must(tab.settle).main.blocked, must(tab.settle).buy.prices['ibadan-north']], [null, tierCost('ibadan', 'ibadan-north', SECOND_HOME.tier)]);
  assert.match(must(must(tab.settle).main.gives), /^your starter house( and rented place)? in Lagos$/);
  assert.equal(tab.lodging.fee, LODGING.fee);
  assert.deepEqual(tab.away.map((home) => home.city), ['lagos']);
  // Going home, and going about the city, are not held up by anything: the visitor plays on.
  assert.equal((await h.f.action(bayo.cookie, { cityId: 'ibadan', type: 'travel', payload: { id: 'cocoa-house', mode: 'trek' } })).ok, true);
});

test('the join and the one main home: a friend who owns a second home there arrives at the venue as its owner, and at the public place when the pinger is at home', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  // Bayo buys a home in Ibadan, then goes back to Lagos: his main home never moved.
  await h.fund(bayo, 'lagos', 500000);
  await h.trip(bayo, 'lagos', 'ibadan');
  const price = must(tierCost('ibadan', 'ibadan-south-east', SECOND_HOME.tier));
  const bought = await h.f.action(bayo.cookie, { cityId: 'ibadan', type: 'estate.set-lga', payload: { lga: 'ibadan-south-east', via: 'manual', home: 'buy' } });
  assert.deepEqual([bought.ok, bought.code, bought.state.cash], [true, 'home_bought', 500000 - 3500 - price]);
  await h.trip(bayo, 'ibadan', 'lagos');
  const before = await h.life(bayo);
  assert.deepEqual([before.estate.home, must(before.estate.away.ibadan).lga, must(before.estate.away.ibadan).tier], ['lagos', 'ibadan-south-east', SECOND_HOME.tier]);
  // Ada is out in Ibadan and pings: he lands beside her, free, and the house he owns there is his again.
  await h.toIbadan(ada);
  const there = await h.life(ada, 'ibadan');
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  const done = await h.join(bayo, ada);
  assert.deepEqual([done.code, done.moved, must(done.place).venue, done.knock], ['joined', 'city', there.location, false]);
  const after = await h.life(bayo, 'ibadan');
  assert.deepEqual([after.location, after.cash, after.estate.lga, after.estate.tier, after.estate.living, after.estate.home], [there.location, before.cash, 'ibadan-south-east', SECOND_HOME.tier, 'own', 'lagos']);
  assert.deepEqual([Object.keys(after.estate.away), must(after.estate.away.lagos).lga, must(after.estate.away.lagos).tier], [['lagos'], before.estate.lga, before.estate.tier]);
  assert.equal(after.message, 'You joined Ada at Agodi Gardens, Ibadan. You have a house here.');
  const tab = homeTab(after, h.f.now());
  assert.deepEqual([tab.visiting, tab.settle, tab.home, tab.makeMain], [false, null, { city: 'lagos', name: 'Lagos', here: false }, { blocked: null }]);
  assert.match(must(tab.lodging.blocked), /^You have a home in Ibadan/);
  // One vote: the house in Ibadan does not put him on its roll while his main home is in Lagos.
  const civic = viewLife(after, { now: h.f.now(), cityId: 'ibadan' }).civic;
  assert.ok(civic.eligibility.vote.some((check) => check.code === 'not_main_home' && !check.met));
  // Back in Lagos; this time Ada is at home in Ibadan (her main home now). He is brought to the public place, not to his own door or hers.
  await h.trip(bayo, 'ibadan', 'lagos');
  assert.equal((await h.f.action(ada.cookie, { cityId: 'ibadan', type: 'estate.set-lga', payload: { lga: 'ibadan-north', via: 'manual', home: 'main' } })).ok, true);
  await h.walk(ada, 'home', 'ibadan');
  h.f.advance(31 * MINUTE);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  const knock = await h.join(bayo, ada);
  assert.deepEqual([knock.code, knock.moved, knock.knock], ['at_home', 'city', true]);
  const door = await h.life(bayo, 'ibadan');
  assert.deepEqual([door.location, door.estate.lga, door.estate.home], ['agodi-gardens', 'ibadan-south-east', 'lagos']);
  assert.deepEqual(must((await h.social()).pingJoins)[bayo.id]?.length, 2, 'each free journey is counted, homeowner or not');
});

test('the join from a city that is only being visited: nothing is left behind there, home is still home, and a join across the country is free too', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  await h.fund(bayo, 'lagos', 100000);
  await h.trip(bayo, 'lagos', 'abeokuta');
  const visiting = await h.life(bayo, 'abeokuta');
  assert.deepEqual([visiting.estate.lga, visiting.estate.home, Object.keys(visiting.estate.away)], [null, 'lagos', ['lagos']]);
  // Ada flies to Abuja. Every open city reaches every other, so he can join her there and come back.
  await h.fund(ada, 'lagos', 200000);
  await h.trip(ada, 'lagos', 'abuja', 'air');
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  const far = await h.join(bayo, ada);
  assert.deepEqual([far.ok, far.code, must(far.place).cityId], [true, 'joined', 'abuja']);
  assert.equal((await h.life(bayo, 'abuja')).cash, visiting.cash, 'a join is free');
  // She takes the bus to Ibadan. The ping follows her; he joins her there.
  await h.trip(ada, 'abuja', 'ibadan');
  h.f.advance(31 * MINUTE);
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  const there = await h.life(ada, 'ibadan');
  const done = await h.join(bayo, ada);
  assert.deepEqual([done.code, done.moved, must(done.place).cityId, must(done.place).venue], ['joined', 'city', 'ibadan', there.location]);
  const after = await h.life(bayo, 'ibadan');
  assert.deepEqual([after.estate.city, after.estate.lga, after.estate.home, after.cash], ['ibadan', null, 'lagos', visiting.cash]);
  assert.ok(Object.keys(after.estate.away).includes('lagos'));
  assert.match(after.message, / You are visiting: your home is in Lagos\.$/);
  // Asking for the life where it was says where it went.
  const moved = await h.get('/api/life?city=abeokuta', bayo);
  assert.deepEqual([moved.status, moved.error, moved.city], [409, 'city_moved', 'ibadan']);
});

test('free journeys by joining under the shorter trips: the limit is three a day whatever the timetable, a join in the same city is never counted, and a trip in progress is not thrown away', async (t) => {
  const h = await harness(t), { ada, bayo } = await pair(h);
  await h.fund(bayo, 'lagos', 100000);
  await h.toIbadan(ada);
  // Three round trips in one day: out free by joining, back by the paid bus.
  for (let round = 0; round < PING.freeJoinsPerDay; round++) {
    assert.equal((await h.ping(ada, bayo)).code, 'pinged', `ping ${round + 1}`);
    const cash = must((await h.life(bayo)).cash);
    assert.equal((await h.join(bayo, ada)).code, 'joined', `join ${round + 1}`);
    assert.equal((await h.life(bayo, 'ibadan')).cash, cash, 'out: free');
    await h.trip(bayo, 'ibadan', 'lagos');
    assert.equal((await h.life(bayo)).cash, cash - 3500, 'back: the fare');
    h.f.advance(31 * MINUTE);
  }
  assert.equal((await h.ping(ada, bayo)).code, 'pinged');
  const capped = await h.join(bayo, ada);
  assert.deepEqual([capped.ok, capped.code], [false, 'join_cap']);
  assert.equal((await h.life(bayo)).estate.city, 'lagos');
  // The paid bus still runs, and on the bus the join is refused rather than the trip lost.
  const left = await h.f.action(bayo.cookie, { cityId: 'lagos', type: 'estate.relocate', payload: { to: 'ibadan', mode: 'road' } });
  assert.equal(left.ok, true);
  const riding = await h.join(bayo, ada);
  assert.deepEqual([riding.ok, riding.code], [false, 'join_cap']);
  assert.equal(must((await h.life(bayo)).activeAction).kind, 'intercity');
  h.f.advance(3 * MINUTE);
  await h.f.request('/api/life?city=lagos', null, bayo.cookie);
  // In the same city now: joining her there is not a journey, so the limit does not apply.
  await h.walk(bayo, 'cocoa-house', 'ibadan');
  const near = await h.join(bayo, ada);
  assert.deepEqual([near.ok, near.code, near.moved], [true, 'joined', 'venue']);
  assert.equal(must((await h.social()).pingJoins)[bayo.id]?.length, PING.freeJoinsPerDay);
});

test('a new player who came through an invite link: the inviter is offered the same Join, and a newcomer whose inviter is in another city is told which', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada');
  h.go(1, 12);
  const peer = await h.f.socket(ada), heard = listen(peer);
  const code = (await h.post('/api/growth/share', { cityId: 'lagos', kind: 'invite' }, ada) as unknown as { share: { code: string } }).share.code;
  // Bayo arrives through the link, on a phone of his own, and is in the game.
  const opened = await h.f.request('/api/session', { name: 'Bayo', onboarding: true });
  const bayo: Who = { name: 'Bayo', id: ((await opened.json()) as { session: { id: string } }).session.id, cookie: must(opened.headers.get('set-cookie')).split(';')[0] ?? '' };
  await h.f.request('/api/life?city=lagos', null, bayo.cookie);
  const look = { body: 'woman', hair: 'braids', outfit: 'casual', fabric: 'ankara', skin: 'skin-6', hairColor: 'soft-black', outfitColor: 'orange', bottomsColor: 'teal' };
  assert.equal((await h.f.action(bayo.cookie, { cityId: 'lagos', type: 'onboarding.quick-start', payload: { look } })).code, 'playing');
  await h.f.socket(bayo);
  assert.equal((await h.post('/api/growth/referral/link', { cityId: 'lagos', code, device: 'device-token-000001' }, bayo)).ok, true);
  await h.get('/api/social/me', bayo);
  await settleDown(150);
  const frame = must(heard.find((item) => item.type === 'ping-incoming'), 'the inviter is told where the newcomer is') as Extract<ServerFrame, { type: 'ping-incoming' }>;
  assert.deepEqual([frame.notice.from.id, frame.notice.invite, frame.notice.place.cityId], [bayo.id, true, 'lagos']);
  assert.equal(must((await h.social()).pings)[`${bayo.id}>${ada.id}`]?.auto, true);
  assert.equal(h.pingMails().length, 0, 'nobody pressed Ping: nothing leaves the game for it');
  // Ada walks off and joins him where he is.
  await h.walk(ada, 'library');
  const done = await h.join(ada, bayo);
  assert.deepEqual([done.code, must(done.place).venue], ['joined', (await h.life(bayo)).location]);
  // An automatic ping does not hold back a real one.
  assert.equal(must((await h.get(`/api/social/ping/${ada.id}`, bayo)).control).can, true);
  // Chidi comes through the same link while Ada is in Ibadan: he is told the city, and stays in his own.
  await h.toIbadan(ada);
  const room = await h.f.socket(ada);
  room.ws.send(JSON.stringify({ type: 'join', cityId: 'ibadan', venueId: (await h.life(ada, 'ibadan')).location }));
  await room.next();
  const second = await h.f.request('/api/session', { name: 'Chidi', onboarding: true });
  const chidi: Who = { name: 'Chidi', id: ((await second.json()) as { session: { id: string } }).session.id, cookie: must(second.headers.get('set-cookie')).split(';')[0] ?? '' };
  await h.f.request('/api/life?city=lagos', null, chidi.cookie);
  assert.equal((await h.f.action(chidi.cookie, { cityId: 'lagos', type: 'onboarding.quick-start', payload: { look } })).code, 'playing');
  assert.equal((await h.post('/api/growth/referral/link', { cityId: 'lagos', code, device: 'device-token-000002' }, chidi)).ok, true);
  const landed = await h.post('/api/social/join', { host: ada.id, cityId: 'lagos' }, chidi) as Reply & { elsewhere?: string };
  assert.deepEqual([landed.code, landed.elsewhere], ['out', 'Ibadan']);
  // A stranger holding only the house link learns no city.
  const eze = await h.player('Eze');
  await h.post('/api/social/friends/remove', { id: ada.id, cityId: 'lagos' }, eze);
  const stranger = await h.post('/api/social/join', { host: ada.id, cityId: 'lagos' }, eze) as Reply & { elsewhere?: string };
  assert.deepEqual([stranger.code, stranger.elsewhere], ['out', undefined]);
});
