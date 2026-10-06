// OWNER: social — groups, mentions, replies, pins, gifts in the chat and pictures (server/social/service.ts, images.ts, routes/social.ts).
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import type { Device, FixtureOptions } from './test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { emailHash } from './social/founder.ts';
import { cleanPicture, sniff } from './social/images.ts';
import { SHIFT_SECONDS } from '../src/game/content/jobs.ts';
import type { Conversation, Message, SocialOverview } from '../src/types/social.ts';
import type { ServerFrame } from '../src/types/protocol.ts';
import type { SocialCollection } from './types.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
interface Reply {
  status: number; error: string; ok: boolean; code: string; reason: string; duplicate: boolean
  conv: Conversation; conversations: Conversation[]; messages: Message[]; message: Message; updates: SocialOverview['updates']; prefs: SocialOverview['prefs']
  results: { id: string; name: string }[]; friends: SocialOverview['friends']; limits: SocialOverview['limits']; receipt: { id: string }; pictures: { id: string; reports: number; hidden: boolean; removed: boolean }[]
  [key: string]: unknown
}
const HOUR = 3600000;
const get = async (f: Fixture, path: string, who?: Device): Promise<Reply> => { const res = await f.request(path, null, who?.cookie); return { status: res.status, ...(await res.json() as object) } as Reply; };
const post = async (f: Fixture, path: string, body: unknown, who?: Device): Promise<Reply> => { const res = await f.request(path, body, who?.cookie); return { status: res.status, ...(await res.json() as object) } as Reply; };
const defined = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new TypeError(`Expected ${what}`); return value; };
const social = (f: Fixture): Promise<SocialCollection> => f.server.store.read((db) => structuredClone(defined(db.social, 'social')));
async function people(f: Fixture, names: string[]): Promise<Device[]> {
  const made: Device[] = [];
  for (const name of names) { const who = await f.device(name); await get(f, '/api/life?city=lagos', who); await get(f, '/api/social/me', who); made.push(who); }
  return made;
}
async function befriend(f: Fixture, a: Device, b: Device): Promise<void> {
  assert.equal((await post(f, '/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a)).code, 'requested');
  assert.equal((await post(f, '/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b)).code, 'accepted');
}
const group = (f: Fixture, who: Device, name: string, members: Device[]): Promise<Reply> => post(f, '/api/social/groups', { name, members: members.map((m) => m.id), clientId: f.id() }, who);
const say = (f: Fixture, who: Device, conv: string, body: string, extra: object = {}): Promise<Reply> => post(f, '/api/social/messages', { conv, body, clientId: f.id(), ...extra }, who);
const mention = (body: string, who: Device, name: string): { id: string; start: number } => ({ id: who.id, start: body.indexOf(`@${name}`) });
const unreadUpdates = async (f: Fixture, who: Device, kind: string): Promise<SocialOverview['updates']> => (await get(f, '/api/social/me', who)).updates.filter((u) => u.kind === kind);
async function until(peer: { next(): Promise<ServerFrame> }, type: string): Promise<ServerFrame> {
  for (let i = 0; i < 40; i += 1) { const frame = await peer.next(); if (frame.type === type) return frame; }
  throw new Error(`No ${type} frame`);
}

// ---- groups -------------------------------------------------------------------------------------------------

test('groups: who can add whom, roles, mute, pins, hide, hand-over and system lines', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chi, dayo] = await people(f, ['Ada', 'Bola', 'Chidi', 'Dayo']);
  await befriend(f, ada, bola); await befriend(f, ada, chi);
  // A stranger cannot be added; a friend who blocked the adder cannot either; "nobody" refuses even friends.
  assert.equal((await group(f, ada, 'Crew', [dayo])).code, 'friends_only');
  await post(f, '/api/social/prefs', { groups: 'nobody' }, chi);
  assert.equal((await group(f, ada, 'Crew', [chi])).code, 'not_accepting');
  assert.deepEqual((await get(f, '/api/social/me', chi)).prefs, { groups: 'nobody', mentions: 'on', pictures: 'friends' });
  await post(f, '/api/social/prefs', { groups: 'friends' }, chi);
  assert.equal((await post(f, '/api/social/prefs', { groups: 'everyone' }, chi)).status, 400);
  const made = await group(f, ada, 'Weekend Crew', [bola]);
  assert.equal(made.code, 'created');
  const gid = made.conv.id;
  assert.equal(made.conv.owner, ada.id);
  // The added player is told, and can leave in one request.
  const notice = (await unreadUpdates(f, bola, 'group-added'))[0];
  assert.equal(defined(notice).data?.conv, gid);
  // Only the admin adds; an added player must accept invitations; a blocker is refused.
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'add', id: chi.id }, bola)).code, 'owner_only');
  await post(f, '/api/social/block', { id: ada.id, cityId: 'lagos' }, chi);
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'add', id: chi.id }, ada)).code, 'blocked');
  await post(f, '/api/social/unblock', { id: ada.id }, chi);
  await befriend(f, ada, chi);
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'add', id: chi.id }, ada)).code, 'updated');
  const lines = (await get(f, `/api/social/conversations/${gid}`, bola)).messages.filter((m) => m.sys).map((m) => m.body);
  assert.deepEqual(lines, ['Ada created “Weekend Crew”.', 'Ada added Chidi.']);
  // Mute and pin are the player's own, on their entry; two devices of one player see the same.
  assert.equal((await post(f, `/api/social/conversations/${gid}/prefs`, { mute: true, pin: true }, bola)).conv.muted, true);
  assert.equal(defined((await get(f, '/api/social/conversations', bola)).conversations.find((c) => c.id === gid)).pinned, true);
  assert.equal(defined((await get(f, '/api/social/conversations', ada)).conversations.find((c) => c.id === gid)).muted, undefined);
  assert.equal((await post(f, `/api/social/conversations/${gid}/prefs`, { mute: false, pin: false }, bola)).conv.muted, undefined);
  // Pins are limited to three.
  for (let i = 0; i < 4; i += 1) {
    const other = await group(f, bola, `Pinned ${i}`, []);
    const pinned = await post(f, `/api/social/conversations/${other.conv.id}/prefs`, { pin: true }, bola);
    assert.equal(pinned.code, i < 3 ? 'updated' : 'pin_limit');
  }
  // A direct chat cannot be muted, but can be removed from my list; it comes back with only the new message unread.
  const first = await post(f, '/api/social/messages', { to: bola.id, body: 'hello', clientId: f.id() }, ada);
  const dm = first.conv.id;
  assert.equal((await post(f, `/api/social/conversations/${dm}/prefs`, { mute: true }, bola)).code, 'not_allowed');
  await get(f, `/api/social/conversations/${dm}`, bola);
  await post(f, `/api/social/conversations/${dm}/read`, {}, bola);
  assert.equal((await post(f, `/api/social/conversations/${dm}/prefs`, { hide: true }, bola)).code, 'hidden');
  assert.equal((await get(f, '/api/social/conversations', bola)).conversations.some((c) => c.id === dm), false);
  await post(f, '/api/social/messages', { to: bola.id, body: 'again', clientId: f.id() }, ada);
  assert.equal(defined((await get(f, '/api/social/conversations', bola)).conversations.find((c) => c.id === dm)).unread, 1);
  // The admin leaves: the longest-standing member takes over, and the line says so.
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'leave' }, ada)).code, 'left');
  const left = defined((await get(f, '/api/social/conversations', bola)).conversations.find((c) => c.id === gid));
  assert.equal(left.owner, bola.id); assert.equal(defined(left.last).body, 'Ada left. Bola now runs the group.');
  // "Delete for me" on a group is leaving it.
  assert.equal((await post(f, `/api/social/conversations/${gid}/prefs`, { hide: true }, chi)).code, 'hidden');
  assert.equal(defined((await social(f)).convs[gid]).members.length, 1);
});

test('the friend picker searches friends by name, and strangers and the founder are never in it', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chi] = await people(f, ['Ada', 'Bolanle', 'Bolu']);
  await befriend(f, ada, bola);
  assert.deepEqual((await get(f, '/api/social/friends/search?q=bol', ada)).results.map((r) => r.name), ['Bolanle']);
  assert.equal((await get(f, '/api/social/friends/search?q=b', ada)).status, 400);
  assert.deepEqual((await get(f, '/api/social/friends/search?q=bol', chi)).results, []);
});

// ---- mentions and replies ------------------------------------------------------------------------------------

test('mentions: validated against the group, stored as ids, noticed even through mute, never for blocks or strangers', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chi, dayo] = await people(f, ['Ada', 'Bola', 'Chidi', 'Dayo']);
  await befriend(f, ada, bola); await befriend(f, ada, chi); await befriend(f, bola, chi);
  const gid = (await group(f, ada, 'Weekend Crew', [bola, chi])).conv.id;
  const body = 'Hello @Bola and welcome';
  const sent = await say(f, ada, gid, body, { mentions: [mention(body, bola, 'Bola')] });
  assert.equal(sent.code, 'sent');
  assert.deepEqual(sent.message.mentions, [{ id: bola.id, start: 6, end: 11 }]);
  // Stored as ids and positions only: this many bytes beyond a plain message.
  const stored = defined((await social(f)).convs[gid]).messages.at(-1);
  assert.deepEqual(stored?.men, [[bola.id, 6, 5]]);
  // The mentioned player gets a distinct notice; the others do not.
  const notices = await unreadUpdates(f, bola, 'mention');
  assert.equal(notices.length, 1); assert.equal(defined(notices[0]).text, 'Ada mentioned you in Weekend Crew.');
  assert.equal((await unreadUpdates(f, chi, 'mention')).length, 0);
  // Reading the group reads its mention notices.
  await post(f, `/api/social/conversations/${gid}/read`, {}, bola);
  assert.equal((await unreadUpdates(f, bola, 'mention'))[0]?.read, true);
  // Spoofing: a name that does not match the text, a non-member, yourself, a bad shape, overlapping or too many.
  assert.equal((await say(f, ada, gid, 'Hi @Chidi', { mentions: [{ id: bola.id, start: 3 }] })).code, 'invalid_mention');
  assert.equal((await say(f, ada, gid, 'Hi @Dayo', { mentions: [{ id: dayo.id, start: 3 }] })).code, 'not_in_group');
  assert.equal((await say(f, ada, gid, 'Hi @Ada', { mentions: [{ id: ada.id, start: 3 }] })).status, 400);
  assert.equal((await say(f, ada, gid, 'Hi', { mentions: 'bola' })).status, 400);
  assert.equal((await say(f, ada, gid, 'Hi @Bola', { mentions: [{ id: bola.id, start: 3 }, { id: bola.id, start: 3 }] })).status, 400);
  assert.equal((await say(f, ada, gid, 'x', { mentions: Array.from({ length: 6 }, () => ({ id: bola.id, start: 0 })) })).status, 400);
  assert.equal((await say(f, ada, gid, 'Hi @Bola', { mentions: [{ id: bola.id, start: 3.5 }] })).status, 400);
  // Even a name that looks right cannot be pointed at another player's id.
  assert.equal((await say(f, ada, gid, 'Hi @Bola', { mentions: [{ id: chi.id, start: 3 }] })).code, 'invalid_mention');
  // Muted group: the mention breaks through, unless the player turned that off.
  await post(f, `/api/social/conversations/${gid}/prefs`, { mute: true }, bola);
  const again = 'Yo @Bola';
  await say(f, ada, gid, again, { mentions: [mention(again, bola, 'Bola')] });
  assert.equal((await unreadUpdates(f, bola, 'mention')).length, 2);
  assert.equal(defined((await get(f, '/api/social/conversations', bola)).conversations.find((c) => c.id === gid)).mentions, 1);
  await post(f, '/api/social/prefs', { mentions: 'off' }, bola);
  await say(f, ada, gid, again, { mentions: [mention(again, bola, 'Bola')] });
  assert.equal((await unreadUpdates(f, bola, 'mention')).length, 2, 'a muted group stays silent with the setting off');
  assert.equal(defined((await get(f, '/api/social/conversations', bola)).conversations.find((c) => c.id === gid)).mentions, undefined);
  // A blocked player's mention does not notify, and their message is not shown to the blocker.
  await post(f, '/api/social/prefs', { mentions: 'on' }, bola);
  await post(f, `/api/social/conversations/${gid}/prefs`, { mute: false }, bola);
  await post(f, '/api/social/block', { id: chi.id, cityId: 'lagos' }, bola);
  const blocked = 'Hey @Bola';
  assert.equal((await say(f, chi, gid, blocked, { mentions: [mention(blocked, bola, 'Bola')] })).code, 'sent');
  assert.equal((await unreadUpdates(f, bola, 'mention')).length, 2);
});

test('@everyone: the admin only, once every ten minutes, and in direct chats mentions mean nothing', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chi] = await people(f, ['Ada', 'Bola', 'Chidi']);
  await befriend(f, ada, bola); await befriend(f, ada, chi);
  const gid = (await group(f, ada, 'Crew', [bola, chi])).conv.id;
  const all = { mentions: [{ id: 'everyone', start: 0 }] };
  assert.equal((await say(f, bola, gid, '@everyone hi', all)).code, 'owner_only');
  assert.equal((await say(f, ada, gid, '@everyone dinner', all)).code, 'sent');
  assert.equal((await unreadUpdates(f, bola, 'mention'))[0]?.text, 'Ada mentioned everyone in Crew.');
  assert.equal((await unreadUpdates(f, chi, 'mention')).length, 1);
  assert.equal((await say(f, ada, gid, '@everyone again', all)).code, 'rate_limited');
  f.advance(11 * 60000);
  assert.equal((await say(f, ada, gid, '@everyone later', all)).code, 'sent');
  const dm = await post(f, '/api/social/messages', { to: bola.id, body: 'Hi @Bola', clientId: f.id(), mentions: [{ id: bola.id, start: 3 }] }, ada);
  assert.equal(dm.code, 'sent'); assert.equal(dm.message.mentions, undefined);
});

test('replies quote the message they answer, frozen; a message that cannot be seen is sent without a quote', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chi] = await people(f, ['Ada', 'Bola', 'Chidi']);
  await befriend(f, ada, bola); await befriend(f, ada, chi); await befriend(f, bola, chi);
  const gid = (await group(f, ada, 'Crew', [bola, chi])).conv.id;
  const family = '👨‍👩‍👧‍👦🇳🇬👍🏽'.repeat(30);
  assert.ok(family.length > 500 && Array.from(family).length < 500, 'long in UTF-16 units, within the limit in characters');
  const original = await say(f, bola, gid, family);
  const reply = await say(f, ada, gid, 'Same here', { replyTo: original.message.seq });
  const quote = defined(reply.message.replyTo);
  assert.equal(quote.seq, original.message.seq); assert.equal(quote.from?.name, 'Bola');
  // The quote is the first 80 characters a person sees: never a half of a flag, of a skin tone or of a family.
  const clusters = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(family), (part) => part.segment);
  assert.equal(quote.text, clusters.slice(0, 80).join(''));
  assert.equal(Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(quote.text)).length, 80);
  assert.equal(defined((await social(f)).convs[gid]).messages.at(-1)?.re?.from, bola.id);
  // Unknown, system and not-yours-to-see messages: sent without a quote, and nothing is said about why.
  assert.equal((await say(f, ada, gid, 'x', { replyTo: 9999 })).message.replyTo, undefined);
  assert.equal((await say(f, ada, gid, 'x', { replyTo: 1 })).message.replyTo, undefined);
  await post(f, '/api/social/block', { id: bola.id, cityId: 'lagos' }, chi);
  const hidden = await say(f, chi, gid, 'reply to a blocked author', { replyTo: original.message.seq });
  assert.equal(hidden.message.replyTo, undefined);
  // Someone who blocked the quoted author does not see the quote.
  const view = await get(f, `/api/social/conversations/${gid}`, chi);
  assert.equal(view.messages.find((m) => m.id === reply.message.id)?.replyTo, undefined);
  assert.equal((await say(f, ada, gid, 'x', { replyTo: -2 })).status, 400);
  // Direct chats quote too.
  const dm = await post(f, '/api/social/messages', { to: ada.id, body: 'one', clientId: f.id() }, bola);
  const answered = await post(f, '/api/social/messages', { conv: dm.conv.id, body: 'two', replyTo: dm.message.seq, clientId: f.id() }, ada);
  assert.equal(answered.message.replyTo?.text, 'one');
});

// ---- stored data ------------------------------------------------------------------------------------------------

test('conversations stored before groups had roles, mutes, mentions, replies or pictures load unchanged', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  await befriend(f, ada, bola);
  await f.server.store.transact((db) => {
    const s = defined(db.social);
    s.convs['g.900'] = { id: 'g.900', kind: 'group', name: 'Old crew', owner: ada.id, members: [ada.id, bola.id], seq: 2, created: 1, messages: [{ seq: 1, from: null, body: 'Ada created “Old crew”.', at: 1, sys: true }, { seq: 2, from: bola.id, body: 'old words', at: 2 }] };
    s.players[ada.id]!.convs['g.900'] = { read: 1 }; s.players[bola.id]!.convs['g.900'] = { read: 2 };
  });
  const list = (await get(f, '/api/social/conversations', ada)).conversations;
  const old = defined(list.find((c) => c.id === 'g.900'));
  assert.equal(old.unread, 1); assert.equal(old.muted, undefined); assert.equal(old.pinned, undefined); assert.equal(old.mentions, undefined);
  const history = await get(f, '/api/social/conversations/g.900', ada);
  assert.deepEqual(history.messages.map((m) => [m.body, m.mentions, m.replyTo, m.image, m.gift]), [['Ada created “Old crew”.', undefined, undefined, undefined, undefined], ['old words', undefined, undefined, undefined, undefined]]);
  assert.equal((await say(f, ada, 'g.900', 'new words')).code, 'sent');
  assert.equal((await post(f, '/api/social/groups/g.900', { op: 'rename', name: 'Older crew' }, ada)).conv.name, 'Older crew');
});

test('two devices: a new group, mute and read state reach the other device of the same player', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  await befriend(f, ada, bola);
  const second = await f.socket(ada);
  const gid = (await group(f, ada, 'Crew', [bola])).conv.id;
  const changed = await until(second, 'social-changed');
  assert.equal(changed.type, 'social-changed');
  await post(f, `/api/social/conversations/${gid}/prefs`, { mute: true }, ada);
  const read = await until(second, 'social-read');
  assert.equal(read.type === 'social-read' && read.conv?.muted, true);
  const theirs = await f.socket(bola);
  await say(f, ada, gid, 'hi');
  const frame = await until(theirs, 'dm');
  assert.equal(frame.type === 'dm' && frame.message.body, 'hi');
});

// ---- gifts in the chat ---------------------------------------------------------------------------------------

async function earn(f: Fixture, device: Device): Promise<void> {
  assert.equal((await f.action(device.cookie, { type: 'apply-job', id: 'teaching' })).code, 'applied');
  await f.action(device.cookie, { type: 'spot', id: 'work' });
  assert.equal((await f.action(device.cookie, { type: 'activity', id: 'teaching-shift' })).code, 'started');
  f.advance(SHIFT_SECONDS * 1000);
  await get(f, '/api/life?city=lagos', device);
}

test('a gift is a money line in both threads at once, the recipient is told live, and an offline recipient finds it on return', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chi] = await people(f, ['Ada', 'Bola', 'Chi']);
  await befriend(f, ada, bola); await befriend(f, ada, chi);
  await earn(f, ada); f.advance(24 * HOUR);
  const send = (to: Device, amount: number) => post(f, '/api/social/transfers', { to: to.id, amount, cityId: 'lagos', clientId: f.id() }, ada);
  // Online recipient: the money line, the transfer frame, the update and the new balance arrive together.
  const peer = await f.socket(bola, { life: true });
  const sent = await send(bola, 1500);
  assert.equal(sent.code, 'sent');
  const dm = (await get(f, '/api/social/conversations', bola)).conversations[0];
  const theirs = (await get(f, `/api/social/conversations/${defined(dm).id}`, bola)).messages.at(-1);
  const mine = (await get(f, `/api/social/conversations/${defined(dm).id}`, ada)).messages.at(-1);
  assert.deepEqual(theirs?.gift, { amount: 1500 }); assert.deepEqual(mine?.gift, { amount: 1500 });
  assert.equal(theirs?.from?.name, 'Ada'); assert.equal(defined(dm).unread, 1);
  assert.equal((await get(f, '/api/life?city=lagos', bola)).state.cash, 6500);
  assert.equal(defined(defined(await until(peer, 'transfer'))).type, 'transfer');
  assert.ok(await until(peer, 'life-changed'));
  assert.equal((await unreadUpdates(f, bola, 'transfer')).length, 1);
  // Offline recipient: the line is there at once; the money arrives with their next request, exactly once.
  const away = await send(chi, 500);
  assert.equal(away.credited, false);
  const awayChat = (await get(f, '/api/social/conversations', ada)).conversations.find((c) => c.with === chi.id);
  assert.deepEqual((await get(f, `/api/social/conversations/${defined(awayChat).id}`, ada)).messages.at(-1)?.gift, { amount: 500 });
  await get(f, '/api/social/me', chi);
  assert.equal((await get(f, '/api/life?city=lagos', chi)).state.cash, 5500);
});

test('a share of a gift that went to a ride debt is written into the receiver\'s line only', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  await befriend(f, ada, bola);
  await earn(f, ada); f.advance(24 * HOUR);
  await f.server.store.transact((db) => { const life = defined(db.sessions[Object.keys(db.sessions).find((k) => db.sessions[k]!.publicId === bola.id)!]!.cities['lagos']?.state); life.travel.rideDebt = 1000; });
  const peer = await f.socket(bola);
  assert.equal((await post(f, '/api/social/transfers', { to: bola.id, amount: 1500, cityId: 'lagos', clientId: f.id() }, ada)).code, 'sent');
  const dm = defined((await get(f, '/api/social/conversations', bola)).conversations[0]).id;
  const repaid = defined((await get(f, `/api/social/conversations/${dm}`, bola)).messages.at(-1)?.gift?.repaid);
  assert.ok(repaid > 0 && repaid <= 1000);
  assert.equal((await get(f, `/api/social/conversations/${dm}`, ada)).messages.at(-1)?.gift?.repaid, undefined);
  void peer;
});

// ---- pictures --------------------------------------------------------------------------------------------------

const concat = (...parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const u16 = (n: number): Uint8Array => Uint8Array.of(n >> 8, n & 255);
const u32 = (n: number): Uint8Array => Uint8Array.of((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
const l32 = (n: number): Uint8Array => Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
const seg = (marker: number, body: Uint8Array): Uint8Array => concat(Uint8Array.of(0xff, marker), u16(body.length + 2), body);
/** A JPEG with the usual metadata around a picture of w × h: EXIF with a GPS position, an XMP block, a comment and a thumbnail-bearing JFXX. */
function jpeg(w: number, h: number, withMeta = true): Uint8Array {
  return concat(Uint8Array.of(0xff, 0xd8),
    withMeta ? seg(0xe1, text('Exif\0\0GPSLatitude=6.5244;GPSLongitude=3.3792')) : new Uint8Array(),
    seg(0xe0, concat(text('JFIF\0'), Uint8Array.of(1, 1, 0, 0, 1, 0, 1, 0, 0))),
    withMeta ? seg(0xe1, text('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>secret place</x:xmpmeta>')) : new Uint8Array(),
    withMeta ? seg(0xfe, text('shot at home')) : new Uint8Array(),
    seg(0xdb, new Uint8Array(65)),
    seg(0xc0, concat(Uint8Array.of(8), u16(h), u16(w), Uint8Array.of(3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1))),
    seg(0xda, Uint8Array.of(3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0)),
    Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8), Uint8Array.of(0xff, 0xd9));
}
const chunk = (name: string, body: Uint8Array): Uint8Array => concat(u32(body.length), text(name), body, Uint8Array.of(0, 0, 0, 0));
function png(w: number, h: number): Uint8Array {
  return concat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', concat(u32(w), u32(h), Uint8Array.of(8, 2, 0, 0, 0))),
    chunk('tEXt', text('Location\0Lagos, 6.5244 3.3792')), chunk('eXIf', text('Exif GPS')), chunk('IDAT', Uint8Array.of(1, 2, 3)), chunk('IEND', new Uint8Array()));
}
const riff = (name: string, body: Uint8Array): Uint8Array => concat(text(name), l32(body.length), body, body.length & 1 ? Uint8Array.of(0) : new Uint8Array());
function webp(w: number, h: number, extra: Uint8Array[] = []): Uint8Array {
  const vp8 = riff('VP8 ', concat(Uint8Array.of(0, 0, 0, 0x9d, 0x01, 0x2a), Uint8Array.of(w & 255, w >> 8, h & 255, h >> 8), Uint8Array.of(1, 2, 3, 4)));
  const body = concat(text('WEBP'), vp8, riff('EXIF', text('Exif GPS 6.5244')), riff('XMP ', text('<x:xmpmeta/>')), ...extra);
  return concat(text('RIFF'), l32(body.length), body);
}
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const contains = (bytes: Uint8Array, word: string): boolean => Buffer.from(bytes).includes(word);

test('picture bytes: sniffed by magic number, metadata left out, hostile files refused', () => {
  const clean = cleanPicture(jpeg(800, 600), 'jpeg');
  assert.ok(clean.ok);
  if (clean.ok) {
    for (const word of ['Exif', 'GPS', 'xmpmeta', 'shot at home', 'adobe']) assert.equal(contains(clean.picture.bytes, word), false, word);
    assert.deepEqual([clean.picture.width, clean.picture.height, sniff(clean.picture.bytes)], [800, 600, 'jpeg']);
    assert.ok(clean.picture.bytes.length < jpeg(800, 600).length);
  }
  const p = cleanPicture(png(640, 480), 'png');
  assert.ok(p.ok); if (p.ok) { for (const word of ['tEXt', 'eXIf', 'Lagos', 'GPS']) assert.equal(contains(p.picture.bytes, word), false, word); assert.deepEqual([p.picture.width, p.picture.height], [640, 480]); }
  const w = cleanPicture(webp(500, 300), 'webp');
  assert.ok(w.ok); if (w.ok) { for (const word of ['EXIF', 'XMP ', 'GPS', 'xmpmeta']) assert.equal(contains(w.picture.bytes, word), false, word); assert.deepEqual([w.picture.width, w.picture.height], [500, 300]); assert.equal(sniff(w.picture.bytes), 'webp'); }
  const fault = (bytes: Uint8Array, claimed: 'jpeg' | 'png' | 'webp' | null): string => { const result = cleanPicture(bytes, claimed); return result.ok ? 'ok' : result.fault; };
  assert.equal(fault(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'jpeg'), 'unknown_type');
  assert.equal(fault(text('<html><body>not a picture</body></html>'), 'jpeg'), 'unknown_type');
  assert.equal(fault(text('GIF89a\x01\x00\x01\x00'), 'jpeg'), 'unknown_type');
  assert.equal(fault(new Uint8Array(), 'jpeg'), 'empty');
  assert.equal(fault(jpeg(800, 600), 'png'), 'type_mismatch');
  assert.equal(fault(jpeg(800, 600), null), 'type_mismatch');
  assert.equal(fault(jpeg(60000, 60000), 'jpeg'), 'dimensions', 'a decompression bomb');
  assert.equal(fault(png(100000, 100000), 'png'), 'dimensions');
  assert.equal(fault(webp(16383, 16383), 'webp'), 'dimensions');
  assert.equal(fault(jpeg(2049, 10), 'jpeg'), 'dimensions');
  assert.equal(fault(jpeg(2048, 2048), 'jpeg'), 'dimensions', 'too many pixels');
  assert.equal(fault(concat(jpeg(10, 10).subarray(0, 40)), 'jpeg'), 'unreadable', 'cut short');
  assert.equal(fault(concat(new Uint8Array(250001)), 'jpeg'), 'too_large');
  assert.equal(fault(concat(png(10, 10).subarray(0, 30)), 'png'), 'unreadable');
  assert.equal(fault(concat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', concat(u32(10), u32(10), Uint8Array.of(8, 2, 0, 0, 0))), chunk('acTL', new Uint8Array(8)), chunk('IDAT', Uint8Array.of(1)), chunk('IEND', new Uint8Array())), 'png'), 'animated');
  assert.equal(fault(webp(10, 10, [riff('ANIM', new Uint8Array(6))]), 'webp'), 'animated');
});

async function pictureWorld(t: TestContext, options: FixtureOptions = {}) {
  const f = await fixture(t, options);
  const [ada, bola, chi, dayo] = await people(f, ['Ada', 'Bola', 'Chidi', 'Dayo']);
  await befriend(f, ada, bola); await befriend(f, ada, chi);
  const upload = (who: Device, target: object, bytes: Uint8Array = jpeg(800, 600), extra: object = {}): Promise<Reply> =>
    post(f, '/api/social/images', { ...target, clientId: f.id(), type: 'image/jpeg', data: b64(bytes), ...extra }, who);
  const fetchImage = async (id: string, who?: Device): Promise<Response> => fetch(`${f.base}/api/social/images/${id}`, { headers: who ? { Cookie: who.cookie } : {} });
  return { f, ada, bola, chi, dayo, upload, fetchImage };
}

test('pictures: friends only, stored outside the collection without metadata, served to members of the conversation only', async (t) => {
  const { f, ada, bola, chi, dayo, upload, fetchImage } = await pictureWorld(t);
  const sent = await upload(ada, { to: bola.id }, jpeg(800, 600), { body: 'The view' });
  assert.equal(sent.code, 'sent');
  const image = defined(sent.message.image);
  assert.deepEqual([image.width, image.height, sent.message.body], [800, 600, 'The view']);
  // The collection holds an id and numbers; nothing of the bytes.
  const record = defined((await social(f)).convs[sent.conv.id]).messages.at(-1);
  assert.deepEqual(Object.keys(defined(record?.img)).sort(), ['h', 'id', 'n', 'w']);
  assert.ok(!JSON.stringify(await social(f)).includes('/9j/'));
  // Members see the bytes with the right headers; nobody else does.
  const seen = await fetchImage(image.id, bola);
  assert.equal(seen.status, 200);
  assert.equal(seen.headers.get('content-type'), 'image/jpeg');
  assert.equal(seen.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(seen.headers.get('content-disposition'), 'inline');
  assert.match(defined(seen.headers.get('cache-control')), /^private/);
  const body = new Uint8Array(await seen.arrayBuffer());
  assert.equal(sniff(body), 'jpeg'); assert.equal(contains(body, 'Exif'), false); assert.equal(contains(body, 'GPS'), false);
  assert.equal((await fetchImage(image.id, ada)).status, 200);
  assert.equal((await fetchImage(image.id, chi)).status, 404, 'a friend of the sender who is not in the chat');
  assert.equal((await fetchImage(image.id, dayo)).status, 404);
  assert.equal((await fetchImage(image.id)).status, 401, 'signed out');
  assert.equal((await fetchImage('0'.repeat(32), bola)).status, 404);
  assert.equal((await fetchImage('../../etc/passwd', bola)).status, 404);
  // A block cuts the viewing too.
  await post(f, '/api/social/block', { id: ada.id, cityId: 'lagos' }, bola);
  assert.equal((await fetchImage(image.id, bola)).status, 404);
  // Strangers cannot be sent pictures; neither can anyone who does not take them.
  assert.equal((await upload(ada, { to: dayo.id })).code, 'friends_only');
  await post(f, '/api/social/unblock', { id: ada.id }, bola);
  await post(f, '/api/social/prefs', { pictures: 'nobody' }, chi);
  assert.equal((await upload(ada, { to: chi.id })).code, 'pictures_refused');
  // The picture shows blurred until tapped for a new friend's first picture.
  const theirs = (await get(f, `/api/social/conversations/${sent.conv.id}`, bola)).messages.at(-1)?.image;
  assert.equal(theirs?.blur, true); assert.equal((await get(f, `/api/social/conversations/${sent.conv.id}`, ada)).messages.at(-1)?.image?.blur, undefined);
});

test('pictures: hostile uploads are refused and keep nothing; limits per day, per conversation and by retention', async (t) => {
  const { f, ada, bola, upload, fetchImage } = await pictureWorld(t);
  const target = { to: bola.id };
  assert.equal((await upload(ada, target, text('<svg onload=alert(1)/>'))).code, 'picture_rejected');
  assert.equal((await upload(ada, target, jpeg(800, 600), { type: 'image/png' })).code, 'picture_rejected');
  assert.equal((await upload(ada, target, new Uint8Array())).status, 400);
  assert.equal((await upload(ada, target, jpeg(60000, 60000))).code, 'picture_rejected');
  assert.equal((await upload(ada, target, jpeg(800, 600), { type: 'image/gif' })).status, 400);
  assert.equal((await upload(ada, target, jpeg(800, 600), { data: '***not base64***' })).status, 400);
  // Far too large a body is cut off while it is still arriving; the answer is 413 or a closed connection.
  const huge = await upload(ada, target, jpeg(800, 600), { data: 'A'.repeat(400000) }).then((r) => r.status, () => 413);
  assert.equal(huge, 413);
  assert.equal((await upload(ada, target, jpeg(800, 600), { body: 'x'.repeat(201) })).status, 400);
  assert.deepEqual((await readdir(join(f.dir, 'chat-images')).catch(() => [])), [], 'nothing was kept');
  // A caption goes through the text filter.
  assert.equal((await upload(ada, target, jpeg(800, 600), { body: 'the retards' })).ok, false);
  // The number kept in one conversation: older pictures are deleted and say so.
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) ids.push(defined((await upload(ada, target)).message.image).id);
  const kept = await get(f, `/api/social/conversations/${(await upload(ada, target)).conv.id}`, bola);
  assert.equal(kept.messages.filter((m) => m.image && !m.image.state).length, 4);
  void fetchImage;
});

test('pictures: the per-conversation count, the daily limit and CHAT_IMAGES=off', async (t) => {
  const { f, ada, bola, upload, fetchImage } = await pictureWorld(t, { env: { CHAT_IMAGES_PER_CHAT: '2', CHAT_IMAGES_PER_DAY: '4' } });
  const target = { to: bola.id };
  const first = defined((await upload(ada, target)).message.image).id;
  await upload(ada, target);
  const third = await upload(ada, target);
  const view = (await get(f, `/api/social/conversations/${third.conv.id}`, bola)).messages.filter((m) => m.image);
  assert.deepEqual(view.map((m) => m.image?.state), ['expired', undefined, undefined]);
  assert.equal((await fetchImage(first, bola)).status, 404, 'the bytes of the oldest are gone');
  assert.equal((await upload(ada, target)).code, 'sent');
  assert.equal((await upload(ada, target)).code, 'rate_limited', 'four a day');
  const off = await pictureWorld(t, { env: { CHAT_IMAGES: 'off' } });
  assert.equal((await off.upload(off.ada, { to: off.bola.id })).code, 'pictures_off');
  assert.equal((await get(off.f, '/api/social/me', off.ada)).limits.pictures.on, false);
  assert.equal((await get(f, '/api/social/me', ada)).limits.pictures.on, true);
});

test('pictures in groups, the founder rule, reports that hide a picture, and operator removal and bans', async (t) => {
  const { f, ada, bola, chi, upload, fetchImage } = await pictureWorld(t, { moderatorToken: 'm'.repeat(32) });
  await befriend(f, bola, chi);
  const gid = (await group(f, ada, 'Crew', [bola, chi])).conv.id;
  const shot = await upload(ada, { conv: gid });
  assert.equal(shot.code, 'sent');
  const id = defined(shot.message.image).id;
  assert.equal((await fetchImage(id, chi)).status, 200);
  // A report hides it for the reporter at once and for everyone once two players have reported.
  assert.equal((await post(f, '/api/social/reports', { conv: gid, image: id, reason: 'harassment' }, bola)).code, 'reported');
  assert.equal((await post(f, '/api/social/reports', { conv: gid, image: id, reason: 'harassment' }, bola)).code, 'already_reported');
  assert.equal((await fetchImage(id, bola)).status, 404);
  assert.equal((await fetchImage(id, chi)).status, 200);
  assert.equal((await get(f, `/api/social/conversations/${gid}`, bola)).messages.at(-1)?.image?.state, 'reported');
  assert.equal((await post(f, '/api/social/reports', { conv: gid, image: id, reason: 'spam' }, ada)).code, 'unknown_picture', 'not your own');
  assert.equal((await post(f, '/api/social/reports', { conv: gid, image: id, reason: 'spam' }, chi)).code, 'reported');
  assert.equal((await fetchImage(id, ada)).status, 404, 'hidden for everyone pending review');
  assert.equal((await get(f, `/api/social/conversations/${gid}`, ada)).messages.at(-1)?.image?.state, 'hidden');
  // The operator sees it, looks at it, and decides.
  const mod = (path: string, body?: object) => fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${'m'.repeat(32)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await fetch(f.base + '/api/mod/pictures')).status, 401);
  const listed = await (await mod('/api/mod/pictures')).json() as Reply;
  assert.deepEqual([listed.pictures[0]?.id, listed.pictures[0]?.reports, listed.pictures[0]?.hidden], [id, 2, true]);
  const looked = await mod(`/api/mod/pictures/${id}`);
  assert.equal(looked.status, 200); assert.equal(looked.headers.get('content-type'), 'image/jpeg');
  assert.equal(((await (await mod(`/api/mod/pictures/${id}`, { action: 'restore' })).json()) as Reply).code, 'restored');
  assert.equal((await fetchImage(id, ada)).status, 200);
  assert.equal(((await (await mod(`/api/mod/pictures/${id}`, { action: 'remove' })).json()) as Reply).code, 'removed');
  assert.equal((await fetchImage(id, chi)).status, 404);
  assert.equal((await get(f, `/api/social/conversations/${gid}`, chi)).messages.at(-1)?.image?.state, 'expired');
  assert.equal((await mod(`/api/mod/pictures/${id}`)).status, 404);
  // Stopping a player's pictures, and giving them back.
  assert.equal(((await (await mod(`/api/mod/players/${ada.id}/pictures`, { allowed: false })).json()) as Reply).code, 'banned');
  assert.equal((await upload(ada, { conv: gid })).code, 'pictures_blocked');
  assert.equal(((await (await mod(`/api/mod/players/${ada.id}/pictures`, { allowed: true })).json()) as Reply).code, 'allowed');
  assert.equal((await upload(ada, { conv: gid })).code, 'sent');
  // Leaving the last place a picture lived in deletes it.
  const next = defined((await upload(ada, { conv: gid })).message.image).id;
  for (const who of [ada, bola, chi]) await post(f, `/api/social/groups/${gid}`, { op: 'leave' }, who);
  await new Promise((done) => setTimeout(done, 50));
  assert.equal((await fetchImage(next, ada)).status, 404);
});

test('the founder: strangers cannot add or mention him, he may add the players who hold his automatic friendship, pictures need him to write first', async (t) => {
  const PROJECT = 'allworld-test-project', ADDRESS = 'founder@example.com';
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const f = await fixture(t, { fetch: (url, init) => provider.fetch(String(url), init as { body?: unknown }), log: () => {}, env: { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', FOUNDER_EMAIL_SHA256: emailHash(ADDRESS) } });
  const page = (path: string, body: unknown, cookie?: string) => fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: f.base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const device = await f.device('Zed'); await get(f, '/api/life?city=lagos', device);
  const csrf = ((await (await page('/api/account', null, device.cookie)).json()) as { csrf: string | null }).csrf;
  const idToken = await signToken(key, claimsFor(PROJECT, f.now(), { subject: 'Founder', email: ADDRESS, n: 1 }));
  const signed = await page('/api/account/sign-in', { idToken, csrf }, device.cookie); await signed.text();
  const zed: Device = { ...device, cookie: (signed.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  await get(f, '/api/social/me', zed);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  await befriend(f, ada, bola);
  // Every player holds the automatic friendship; strangers (and ordinary friends) cannot put the founder in a group.
  assert.equal((await group(f, ada, 'Crew', [zed])).code, 'friends_only');
  // He may add players who hold it, and they can take pictures and mentions from him.
  const mine = await group(f, zed, 'Founders', [ada]);
  assert.equal(mine.code, 'created');
  const gid = mine.conv.id;
  const body = 'Hi @Ada';
  await say(f, zed, gid, body, { mentions: [mention(body, ada, 'Ada')] });
  assert.equal((await unreadUpdates(f, ada, 'mention')).length, 1);
  // A group Ada runs with Bola: a mention of someone who is only an automatic friend of the founder does not reach him.
  const adaGroup = defined((await post(f, '/api/social/groups/' + gid, { op: 'add', id: bola.id }, zed)).conv);
  assert.equal(adaGroup.members.length, 3, 'the founder adds a player he is friends with only automatically');
  const shout = 'Hello @Zed';
  await say(f, bola, gid, shout, { mentions: [mention(shout, zed, 'Zed')] });
  assert.equal((await unreadUpdates(f, zed, 'mention')).length, 0, 'not an ordinary friend of Bola');
  // Pictures across the automatic friendship: not from the player first; fine after the founder wrote.
  const pic = (who: Device, to: Device) => post(f, '/api/social/images', { to: to.id, clientId: f.id(), type: 'image/jpeg', data: b64(jpeg(100, 100)) }, who);
  assert.equal((await pic(ada, zed)).code, 'friends_only');
  await post(f, '/api/social/messages', { to: ada.id, body: 'hello Ada', clientId: f.id() }, zed);
  assert.equal((await pic(ada, zed)).code, 'sent');
});
