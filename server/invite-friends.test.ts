// OWNER: social / growth — a player who comes through an invite link and their inviter become friends, the inviter is
// told in the game, and one comeback mail says so (server/social/service.ts meetInviter, server/growth/comeback.ts).
// Fixture: see server/routes/index.ts ("HOW TO TEST").
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, snapshot } from './test-fixture.ts';
import { ENDPOINT } from './growth/email/zeptomail.ts';
import { LIMITS } from './social/service.ts';
import { RECONNECT_GRACE_MS } from './social/presence.ts';
import { COMEBACK, decide, defaultPrefs, emptyMemory } from '../src/game/comeback.ts';
import { mailWords } from '../src/game/comeback-words.ts';
import { notificationLines } from '../src/app/features/messages/messagesModel.ts';
import { updateLines } from '../src/app/features/messages/messagesThread.ts';
import { joinedState } from '../src/app/features/growth/inviteLines.ts';
import type { TestContext } from 'node:test';
import type { Db, SocialCollection } from './types.ts';
import type { HelloResult } from '../src/types/growth.ts';
import type { LifeState } from '../src/types/index.ts';
import type { ServerFrame } from '../src/types/protocol.ts';
import type { Friend, SocialOverview } from '../src/types/social.ts';

const HOUR = 3600000, DAY = 86400000, MINUTE = 60000;
const TOKEN = 'operator-token-for-invite-tests-0123456';
const LIVE: Record<string, string> = { ZEPTOMAIL_AUTH: 'Zoho-enczapikey TESTKEY-not-a-real-key', EMAIL_FROM_ADDRESS: 'hello@mail.play.example', EMAIL_FROM_NAME: 'Allworld', EMAIL_CONTACT_LINE: 'Allworld, 1 Example Street' };
interface Who { id: string; cookie: string }
interface Reply { status: number; ok?: boolean; code?: string; error?: string; friends: Friend[]; updates: SocialOverview['updates']; requests: SocialOverview['requests']; state: LifeState; share: { code: string } }
interface Mail { personalizations: { to: { email: string }[] }[]; subject: string; content: { type: string; value: string }[] }
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`expected ${what}`); return value; };
const ids = (list: { id: string }[]): string[] => list.map((item) => item.id);
const settleDown = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function harness(t: TestContext) {
  const calls: { url: string; body: string }[] = [];
  const f = await fixture(t, { moderatorToken: TOKEN, publicOrigin: 'https://play.example', env: LIVE, fetch: async (url, init) => { calls.push({ url: String(url), body: String((init as RequestInit).body) }); return new Response(null, { status: 202 }); } });
  const answer = async (res: Response): Promise<Reply> => ({ status: res.status, ...((await res.json()) as object) } as Reply);
  const post = async (path: string, body: unknown, who: Who): Promise<Reply> => answer(await f.request(path, body, who.cookie));
  const get = async (path: string, who: Who): Promise<Reply> => answer(await f.request(path, null, who.cookie));
  const me = (who: Who): Promise<Reply> => get('/api/social/me', who);
  const hello = async (who: Who): Promise<Extract<HelloResult, { ok: true }>> => (await f.request('/api/growth/hello', { cityId: 'lagos' }, who.cookie)).json() as Promise<Extract<HelloResult, { ok: true }>>;
  let devices = 0;
  /** A device with a life, known to the growth module. `arrive: false` leaves out their first social request. */
  async function player(name: string, { arrive = true } = {}): Promise<Who> {
    const who = await f.device(name);
    await f.request('/api/life?city=lagos', null, who.cookie);
    await hello(who);
    await post('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, who);
    if (arrive) await me(who);
    return who;
  }
  const linkOf = async (who: Who): Promise<string> => (await post('/api/growth/share', { cityId: 'lagos', kind: 'invite' }, who)).share.code;
  /** The newcomer opens the inviter's link on a phone of their own. */
  const join = async (who: Who, code: string): Promise<Reply> => post('/api/growth/referral/link', { cityId: 'lagos', code, device: `device-token-${String(++devices).padStart(6, '0')}` }, who);
  const mails = (): Mail[] => calls.filter((call) => call.url === ENDPOINT).map((call) => JSON.parse(call.body) as Mail);
  const sent = (): Mail[] => mails().filter((mail) => !/^(Confirm your e-mail|You are in)/.test(mail.subject));
  const page = async (path: string): Promise<void> => { await (await fetch(f.base + path, { method: 'POST' })).text(); };
  /** Give a player a confirmed address: their character's e-mails are then on, every kind. */
  async function optIn(who: Who, email: string): Promise<void> {
    await post('/api/growth/email', { email, consent: true }, who);
    const text = must(must(mails().at(-1), 'a confirmation').content[0]).value;
    await page(must(/https:\/\/play\.example(\/e\/confirm\?t=[A-Za-z0-9_.-]+)/.exec(text)?.[1], 'a confirm link'));
  }
  const run = async (): Promise<void> => { await (await fetch(`${f.base}/api/mod/growth/outreach/run`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: '{}' })).text(); };
  /** Move the clock to a Lagos day and hour (day 0 is where the fixture starts, at one in the morning). */
  const go = (day: number, hour: number): void => { const target = Date.UTC(1970, 0, 1 + day, hour - 1); assert.ok(target >= f.now()); f.advance(target - f.now()); };
  const social = (): Promise<SocialCollection> => f.server.store.read((db) => snapshot(must(db.social, 'db.social')));
  const edit = (fn: (db: Db) => void): Promise<void> => f.server.store.transact((db) => { fn(db); });
  return { f, post, get, me, hello, player, linkOf, join, mails, sent, optIn, run, go, social, edit };
}
const joinedUpdates = (reply: Reply) => reply.updates.filter((update) => update.kind === 'invite-joined');

test('a friend who joins through a link and their inviter are friends at once, exactly once; the inviter is told and the line opens that friend’s card', async (t) => {
  const h = await harness(t), { f } = h;
  const ada = await h.player('Ada');
  const code = await h.linkOf(ada);
  const peer = await f.socket(ada), heard: ServerFrame[] = [];
  peer.ws.on('message', (data) => { heard.push(JSON.parse(data.toString()) as ServerFrame); });

  // Tunde links, but has made no social request yet: he has not arrived, so nothing is made on the inviter's side alone.
  const tunde = await h.player('Tunde', { arrive: false });
  assert.equal((await h.join(tunde, code)).code, 'linked');
  assert.deepEqual([(await h.me(ada)).friends, joinedUpdates(await h.me(ada))], [[], []]);

  // His first request: friends both ways, with no request and no accept.
  const his = await h.me(tunde);
  assert.deepEqual([ids(his.friends), his.requests], [[ada.id], { in: [], out: [] }]);
  const hers = await h.me(ada);
  assert.deepEqual([ids(hers.friends), hers.requests], [[tunde.id], { in: [], out: [] }]);
  const told = joinedUpdates(hers);
  assert.deepEqual(told.map((update) => [update.text, update.data, update.read]), [['Tunde joined through your link. You are friends now: say hello.', { from: tunde.id }, false]]);
  await settleDown();
  assert.equal(heard.filter((frame) => frame.type === 'social-update' && frame.update.kind === 'invite-joined').length, 1, 'pushed to the inviter’s open game');
  // The line opens that player's card, in the Phone's notifications and in Messages → Updates.
  const note = must(notificationLines(hers as unknown as SocialOverview, { connected: true, now: f.now(), seen: 0 }).find((line) => line.text.startsWith('Tunde joined')));
  assert.deepEqual([note.app, note.params], ['person', { player: tunde.id }]);
  assert.equal(updateLines(hers.updates, [], 0).find((line) => line.id === 'invite-joined')?.player, tunde.id);
  // An ordinary friendship: both lives know it.
  assert.deepEqual([(await h.get('/api/life?city=lagos', ada)).state.social.rel[tunde.id]?.friend, (await h.get('/api/life?city=lagos', tunde)).state.social.rel[ada.id]?.friend], [true, true]);
  // The inviter's list of who joined names him.
  assert.deepEqual((await h.hello(ada)).referral.invited.map((friend) => [friend.id, friend.name, joinedState(friend)]), [[tunde.id, 'Tunde', 'Joined']]);
  assert.deepEqual([joinedState({ state: 'joined', welcomed: true }), joinedState({ state: 'counted', welcomed: true })], ['First paid day', 'Counted']);

  // Again and again: one friendship, one update.
  for (let i = 0; i < 3; i++) { f.advance(HOUR); await h.me(tunde); await h.me(ada); await h.hello(tunde); }
  assert.deepEqual([ids((await h.me(ada)).friends), joinedUpdates(await h.me(ada)).length], [[tunde.id], 1]);
  assert.deepEqual((await h.social()).players[tunde.id]?.invite, { by: ada.id, at: must(told[0]).at });

  // Ended by either of them: not made again.
  assert.equal((await h.post('/api/social/friends/remove', { id: ada.id, cityId: 'lagos' }, tunde)).code, 'removed');
  f.advance(DAY);
  assert.deepEqual([(await h.me(tunde)).friends, (await h.me(ada)).friends, joinedUpdates(await h.me(ada)).length], [[], [], 1]);
});

test('an invite recorded before this existed: the inviter finds that friend on their own next visit, once', async (t) => {
  const h = await harness(t);
  // Both were already playing, and the link was recorded: exactly what an earlier build left behind.
  const ada = await h.player('Ada'), tunde = await h.player('Tunde');
  assert.equal((await h.join(tunde, await h.linkOf(ada))).code, 'linked');
  const before = await h.social();
  assert.deepEqual([before.players[ada.id]?.friends, before.players[tunde.id]?.invite], [{}, undefined]);
  // The inviter comes back; the friend does not have to.
  const hers = await h.me(ada);
  assert.deepEqual([ids(hers.friends), joinedUpdates(hers).length], [[tunde.id], 1]);
  assert.deepEqual(ids((await h.me(tunde)).friends), [ada.id]);
  assert.equal(joinedUpdates(await h.me(ada)).length, 1);
});

test('a block is respected, and a full friends list falls back to a friend request that the notice names', async (t) => {
  const h = await harness(t), { f } = h;
  const ada = await h.player('Ada');
  const code = await h.linkOf(ada);
  // Blocked after the link, before they were introduced: no friendship, no notice, and none later.
  const bola = await h.player('Bola', { arrive: false });
  assert.equal((await h.join(bola, code)).code, 'linked');
  await h.edit((db) => { must(must(db.social).players[ada.id]).blocked[bola.id] = f.now(); });
  assert.deepEqual([(await h.me(bola)).friends, joinedUpdates(await h.me(ada))], [[], []]);
  await h.edit((db) => { delete must(must(db.social).players[ada.id]).blocked[bola.id]; });
  f.advance(DAY);
  assert.deepEqual([(await h.me(bola)).friends, (await h.me(ada)).friends, (await h.social()).players[bola.id]?.invite?.by], [[], [], ada.id]);

  // The inviter's list is full: the newcomer's friend request is sent instead, and the notice says so.
  await h.edit((db) => { const mine = must(must(db.social).players[ada.id]); for (let i = 0; i < LIMITS.friends; i++) mine.friends[randomUUID()] = 1; });
  const chidi = await h.player('Chidi', { arrive: false });
  assert.equal((await h.join(chidi, code)).code, 'linked');
  assert.deepEqual((await h.me(chidi)).friends, []);
  const stored = await h.social();
  assert.deepEqual([stored.players[ada.id]?.friends[chidi.id], stored.players[ada.id]?.in[chidi.id] !== undefined, stored.players[chidi.id]?.out[ada.id] !== undefined], [undefined, true, true]);
  assert.deepEqual(must(stored.players[ada.id]).updates.filter((update) => update.kind === 'invite-joined').map((update) => update.text), ['Chidi joined through your link. Your friends list is full, so they are waiting in your friend requests instead.']);
});

test('the mail: one, soon, for the joins together — not while the inviter is in the game, not past the caps, not with Friends off, not once it was read', async (t) => {
  const h = await harness(t), { f } = h;
  const ada = await h.player('Ada');
  await h.optIn(ada, 'ada@example.com');
  const code = await h.linkOf(ada);
  h.go(1, 12);
  await h.hello(ada); await h.me(ada);
  const peer = await f.socket(ada);
  await settleDown();

  // Two friends join three minutes apart while the inviter is in the game.
  const tunde = await h.player('Tunde', { arrive: false }), bola = await h.player('Bola', { arrive: false });
  await h.join(tunde, code); await h.me(tunde);
  f.advance(3 * MINUTE);
  await h.join(bola, code); await h.me(bola);
  await settleDown();
  await h.run();
  assert.equal(h.sent().length, 0, 'held for ten minutes after the newest join');
  f.advance(COMEBACK.join.holdMinutes * MINUTE + MINUTE);
  await h.run();
  assert.equal(h.sent().length, 0, 'the inviter is in the game: the notice there is enough');

  // She leaves without reading it. Minutes later — hours before the usual twelve — one mail names both.
  peer.ws.close();
  await settleDown();
  f.advance(RECONNECT_GRACE_MS + COMEBACK.join.recheckMinutes * MINUTE);
  await h.run();
  const first = h.sent();
  assert.deepEqual(first.map((mail) => [mail.subject, must(mail.personalizations[0]).to[0]?.email]), [['Tunde and Bola joined Allworld through your link', 'ada@example.com']]);
  assert.match(must(must(first[0]).content[0]).value, /Tunde and Bola are in Allworld now and waiting for you\. Say hello\./);
  assert.ok(f.now() - Date.UTC(1970, 0, 2, 11) < HOUR, 'within the hour of the joins, though she had just been playing');
  await h.run();
  assert.equal(h.sent().length, 1, 'once');

  // Another friend the same day: the caps hold it (one mail a day; a Friends mail every two days).
  const chidi = await h.player('Chidi', { arrive: false });
  await h.join(chidi, code); await h.me(chidi);
  f.advance(HOUR);
  await h.run();
  assert.equal(h.sent().length, 1);

  // With the Friends switch off there is no mail at all.
  const eze = await h.player('Eze');
  await h.optIn(eze, 'eze@example.com');
  await h.post('/api/growth/comeback', { cityId: 'lagos', types: { friends: false } }, eze);
  const femi = await h.player('Femi', { arrive: false });
  await h.join(femi, await h.linkOf(eze)); await h.me(femi);
  // And an inviter who read the notice in the game is not mailed about it.
  const gbenga = await h.player('Gbenga');
  await h.optIn(gbenga, 'gbenga@example.com');
  const habib = await h.player('Habib', { arrive: false });
  await h.join(habib, await h.linkOf(gbenga)); await h.me(habib);
  assert.equal(joinedUpdates(await h.me(gbenga)).length, 1);
  await h.post('/api/social/updates/read', {}, gbenga);
  f.advance(HOUR);
  await h.run();
  assert.deepEqual(h.sent().map((mail) => must(mail.personalizations[0]).to[0]?.email), ['ada@example.com']);
});

test('the rules: a join passes the "recently active" gate alone, after the hold, offline; quiet hours and the caps still apply', () => {
  const noon = Date.UTC(1970, 0, 5, 11), facts = { name: 'Ada', needs: { hunger: 5 }, needsAt: noon, nudges: [], milestones: [], events: [], waiting: [{ kind: 'joined' as const, from: 'Tunde', at: noon }] };
  const input = { lastActive: noon, facts, memory: emptyMemory(), prefs: defaultPrefs(true) };
  const hold = COMEBACK.join.holdMinutes * MINUTE;
  assert.deepEqual([decide({ ...input, now: noon + MINUTE }).why, decide({ ...input, now: noon + MINUTE }).next], ['active', noon + hold]);
  assert.deepEqual([decide({ ...input, now: noon + hold, online: true }).why, decide({ ...input, now: noon + hold, online: true }).next], ['active', noon + hold + COMEBACK.join.recheckMinutes * MINUTE]);
  const chosen = decide({ ...input, now: noon + hold });
  assert.deepEqual([chosen.why, chosen.plan?.type, chosen.plan?.type === 'waiting' ? [chosen.plan.joined, chosen.plan.names, chosen.plan.go] : null], ['chosen', 'waiting', [1, ['Tunde'], 'people']]);
  // Nothing else is sent to a player who was just here: without the join it is the usual wait.
  assert.equal(decide({ ...input, facts: { ...facts, waiting: [{ kind: 'message', from: 'Bola', at: noon }] }, now: noon + hold }).why, 'active');
  assert.equal(decide({ ...input, prefs: { ...defaultPrefs(true), types: { ...defaultPrefs(true).types, friends: false } }, now: noon + hold }).why, 'active');
  assert.equal(decide({ ...input, memory: { ...emptyMemory(), sent: [{ at: noon - HOUR, type: 'need' }] }, now: noon + hold }).why, 'capped');
  const night = Date.UTC(1970, 0, 5, 21);
  assert.equal(decide({ ...input, lastActive: night, facts: { ...facts, waiting: [{ kind: 'joined', from: 'Tunde', at: night }] }, now: night + hold }).why, 'quiet_hours');
  // The words: a join alone, and a join among other things.
  const alone = mailWords({ type: 'waiting', key: 'k', names: ['Tunde'], messages: 0, gifts: 0, requests: 0, joined: 1, newest: noon, go: 'people' }, { name: 'Ada', now: noon });
  assert.deepEqual([alone.subject, alone.intro, alone.button, alone.pref], ['Tunde joined Allworld through your link', 'Tunde is in Allworld now and waiting for you. Say hello.', { label: 'Say hello', go: 'people' }, 'friends']);
  const mixed = mailWords({ type: 'waiting', key: 'k', names: ['Tunde', 'Bola'], messages: 2, gifts: 0, requests: 0, joined: 2, newest: noon, go: 'messages' }, { name: 'Ada', now: noon });
  assert.deepEqual([mixed.subject, mixed.lines], ['Tunde and Bola are waiting for you', ['2 messages from your friends', '2 friends joined through your link']]);
});
