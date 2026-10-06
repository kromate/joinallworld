// OWNER: growth — the phone notification a message may cause (server/growth/message-push.ts): who is told of what, what is said,
// the caps, the courtesy rules, and the bytes themselves (encrypted for the subscription and decrypted here with its keys).
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fixture, snapshot } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';
import { b64u } from './growth/webpush.ts';
import { MESSAGE_PUSH, hourOn, quietHour, tagOf } from './growth/message-push.ts';
import type { GrowthCollection } from './types.ts';

const subtle = webcrypto.subtle;
interface Sent { url: string; headers: Record<string, string>; body: Uint8Array }
interface Pushed { title: string; body: string; url: string; tag: string; kind: string; conv?: string; count?: number; badge?: number }
type Reply = Record<string, unknown> & { status: number; code: string; ok: boolean; conv: { id: string }; message: { seq: number } }
const concat = (...parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A browser's subscription: a key pair and an auth secret the test keeps, so it can open what the server sends. */
async function browser(n: number, tz?: number) {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  const endpoint = `https://fcm.googleapis.com/fcm/send/phone-${n}`;
  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8));
  return {
    endpoint, tz,
    subscription: { endpoint, keys: { p256dh: b64u.encode(publicKey), auth: b64u.encode(auth) } },
    /** RFC 8291: open one aes128gcm record addressed to this subscription. */
    async open(body: Uint8Array): Promise<Pushed> {
      const salt = body.subarray(0, 16), idLength = body[20] ?? 0, serverKey = body.subarray(21, 21 + idLength), sealed = body.subarray(21 + idLength);
      const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await subtle.importKey('raw', serverKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, pair.privateKey, 256));
      const ikm = await hkdf(auth, shared, concat(new TextEncoder().encode('WebPush: info\0'), publicKey, serverKey), 32);
      const key = await subtle.importKey('raw', await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
      const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12), tagLength: 128 }, key, sealed));
      assert.equal(plain.at(-1), 2, 'the last record ends with the delimiter');
      return JSON.parse(new TextDecoder().decode(plain.subarray(0, -1))) as Pushed;
    },
  };
}

async function world(t: TestContext, env: Record<string, string> = {}, answer = 201) {
  const sent: Sent[] = [];
  const f = await fixture(t, { env: { CHAT_PUSH_UNSEEN_MS: '30', CHAT_PUSH_WINDOW_MS: '400', ...env }, fetch: async (url, init) => {
    const request = init as unknown as { headers: Record<string, string>; body: Uint8Array };
    sent.push({ url: String(url), headers: request.headers, body: request.body });
    return new Response(null, { status: answer });
  } });
  const get = async (path: string, who: Device) => ({ status: 0, ...(await (await f.request(path, null, who.cookie)).json() as object) }) as Reply & Record<string, never>;
  const post = async (path: string, body: unknown, who: Device): Promise<Reply> => { const res = await f.request(path, body, who.cookie); return { status: res.status, ...(await res.json() as object) } as Reply; };
  const player = async (name: string): Promise<Device> => { const who = await f.device(name); await f.request('/api/life?city=lagos', null, who.cookie); await f.request('/api/social/me', null, who.cookie); return who; };
  const friends = async (a: Device, b: Device): Promise<void> => { await post('/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a); await post('/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b); };
  /** `who` is an adult with this browser subscribed (the same two requests the Stay in touch screen makes). */
  async function subscribe(who: Device, phone: Awaited<ReturnType<typeof browser>>): Promise<void> {
    await post('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, who);
    assert.equal((await post('/api/growth/push/subscribe', { cityId: 'lagos', subscription: phone.subscription, consent: true, ...(phone.tz !== undefined ? { tz: phone.tz } : {}) }, who)).code, 'subscribed');
  }
  const dm = (from: Device, to: Device, body: string, extra: object = {}) => post('/api/social/messages', { to: to.id, body, clientId: f.id(), ...extra }, from);
  const say = (from: Device, conv: string, body: string, extra: object = {}) => post('/api/social/messages', { conv, body, clientId: f.id(), ...extra }, from);
  const stored = async (): Promise<GrowthCollection> => f.server.store.read((db) => snapshot(db.growth as GrowthCollection));
  return { f, sent, get, post, player, friends, subscribe, dm, say, stored, wait: () => pause(200) };
}
const noon = 12 * 3600000;

test('a direct message reaches the phone encrypted, once the recipient has not read it; the words follow the text setting', async (t) => {
  const w = await world(t);
  const [ada, bola] = [await w.player('Ada'), await w.player('Bola')];
  await w.friends(ada, bola);
  const phone = await browser(1);
  await w.subscribe(bola, phone);
  const first = await w.dm(ada, bola, 'Are you coming to the jollof party tonight? Bring chairs and a loud speaker for the whole street to enjoy it with us please');
  await w.wait();
  assert.equal(w.sent.length, 1);
  const call = w.sent[0]!;
  assert.equal(call.url, phone.endpoint);
  assert.match(call.headers['Authorization'] ?? '', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.deepEqual([call.headers['Content-Encoding'], call.headers['TTL'], call.headers['Urgency'], call.headers['Topic']], ['aes128gcm', '3600', 'normal', tagOf(first.conv.id)]);
  assert.ok(call.body.length > 100 && !new TextDecoder().decode(call.body).includes('jollof'), 'the body is ciphertext');
  const note = await phone.open(call.body);
  assert.deepEqual([note.title, note.kind, note.conv, note.url, note.tag], ['Ada', 'chat', first.conv.id, `/?chat=${encodeURIComponent(first.conv.id)}`, tagOf(first.conv.id)]);
  assert.equal(note.body, 'Are you coming to the jollof party tonight? Bring chairs and a loud speaker for the whole'.slice(0, 80));
  assert.ok(Array.from(note.body).length <= MESSAGE_PUSH.textChars && note.count === 1 && note.badge === 1);
  // With the text switched off the phone only says who.
  await w.post('/api/social/notify', { text: false }, bola);
  await w.f.advance(5000); await w.dm(ada, bola, 'a secret');
  await w.wait();
  assert.equal((await phone.open(w.sent[1]!.body)).body, '2 new messages · New message from Ada'.replace('2 new messages · ', '2 new messages · '));
  assert.ok(!JSON.stringify(await phone.open(w.sent[1]!.body)).includes('secret'));
});

test('no phone notification for a conversation that is read, a sender who is blocked or muted, a pause, or a player who is not subscribed', async (t) => {
  const w = await world(t);
  const [ada, bola, chi] = [await w.player('Ada'), await w.player('Bola'), await w.player('Chidi')];
  await w.friends(ada, bola); await w.friends(ada, chi);
  const phone = await browser(1);
  await w.subscribe(bola, phone);
  // Read in time: the page that has the chat open marks it read at once, on every device.
  const sent = await w.dm(ada, bola, 'seen quickly');
  await w.post(`/api/social/conversations/${sent.conv.id}/read`, {}, bola);
  await w.wait();
  assert.equal(w.sent.length, 0, 'an active chat does not buzz the phone');
  // Not subscribed: nothing leaves the server.
  await w.dm(ada, chi, 'hello Chidi'); await w.wait();
  assert.equal(w.sent.length, 0);
  // Paused for an hour, then paused no more.
  await w.post('/api/social/notify', { pause: '1h' }, bola);
  await w.dm(ada, bola, 'during the pause'); await w.wait();
  assert.equal(w.sent.length, 0);
  const prefs: unknown = (await w.get('/api/social/me', bola))['prefs'];
  assert.ok(((prefs as { notify: { pausedUntil: number } }).notify.pausedUntil) > w.f.now());
  await w.post('/api/social/notify', { pause: 'off' }, bola);
  // A blocked sender never notifies.
  await w.post('/api/social/block', { id: ada.id, cityId: 'lagos' }, bola);
  await w.dm(ada, bola, 'after the block'); await w.wait();
  assert.equal(w.sent.length, 0);
  await w.post('/api/social/unblock', { id: ada.id }, bola);
  await w.friends(ada, bola);
  w.f.advance(600000);
  await w.dm(ada, bola, 'friends again'); await w.wait();
  assert.equal(w.sent.length, 1);
  // A player the operator muted cannot notify either: their messages are refused before anything is stored.
  assert.equal((await w.dm(chi, bola, 'x')).status, 200);
});

test('groups: a plain message does not notify by default; a mention and a reply do, even in a muted group unless that is off; all-messages is a choice', async (t) => {
  const w = await world(t);
  const [ada, bola, chi] = [await w.player('Ada'), await w.player('Bola'), await w.player('Chidi')];
  await w.friends(ada, bola); await w.friends(ada, chi);
  const phone = await browser(1);
  await w.subscribe(bola, phone);
  const gid = ((await w.post('/api/social/groups', { name: 'Crew', members: [bola.id, chi.id], clientId: w.f.id() }, ada)) as Reply).conv.id;
  await w.say(ada, gid, 'plain words'); await w.wait();
  assert.equal(w.sent.length, 0);
  const body = 'Hey @Bola look';
  await w.say(ada, gid, body, { mentions: [{ id: bola.id, start: body.indexOf('@Bola') }] }); await w.wait();
  assert.equal(w.sent.length, 1);
  const mention = await phone.open(w.sent[0]!.body);
  assert.equal(mention.title, 'Crew'); assert.ok(mention.body.endsWith('Ada: Hey @Bola look'), mention.body);
  // A reply to Bola's own message notifies, too.
  const mine = await w.say(bola, gid, 'my question');
  w.f.advance(500);
  await w.say(chi, gid, 'my answer', { replyTo: mine.message.seq }); await w.wait();
  assert.equal(w.sent.length, 2);
  // Muted: the mention still breaks through, until the player turns that off.
  await w.post(`/api/social/conversations/${gid}/prefs`, { mute: true }, bola);
  w.f.advance(500);
  await w.say(ada, gid, body, { mentions: [{ id: bola.id, start: body.indexOf('@Bola') }] }); await w.wait();
  assert.equal(w.sent.length, 3);
  await w.post('/api/social/prefs', { mentions: 'off' }, bola);
  w.f.advance(500);
  await w.say(ada, gid, body, { mentions: [{ id: bola.id, start: body.indexOf('@Bola') }] }); await w.wait();
  assert.equal(w.sent.length, 3, 'a muted group is silent with the setting off');
  // "All group messages": notified, unless the group is muted.
  await w.post('/api/social/prefs', { mentions: 'on' }, bola);
  await w.post('/api/social/notify', { groups: 'all' }, bola);
  w.f.advance(500);
  await w.say(ada, gid, 'muted plain'); await w.wait();
  assert.equal(w.sent.length, 3);
  await w.post(`/api/social/conversations/${gid}/prefs`, { mute: false }, bola);
  w.f.advance(500);
  await w.say(ada, gid, 'all messages please'); await w.wait();
  assert.equal(w.sent.length, 4);
  assert.equal((await phone.open(w.sent[3]!.body)).title, 'Crew');
});

test('messages in quick succession become one updating notification with a count; a reaction never notifies the phone', async (t) => {
  const w = await world(t);
  const [ada, bola] = [await w.player('Ada'), await w.player('Bola')];
  await w.friends(ada, bola);
  const phone = await browser(1);
  await w.subscribe(bola, phone);
  const first = await w.dm(ada, bola, 'one');
  await pause(80);
  for (const word of ['two', 'three', 'four']) await w.dm(ada, bola, word);
  await pause(120);
  assert.equal(w.sent.length, 1, 'one at once; the others wait for the window');
  w.f.advance(500);
  await pause(700);
  assert.equal(w.sent.length, 2, 'and one follows it');
  const latest = await phone.open(w.sent[1]!.body);
  assert.deepEqual([latest.count, latest.tag, latest.body], [4, tagOf(first.conv.id), '4 new messages · four']);
  // Bola reacts to Ada's message: Ada's phone hears nothing (and she is not subscribed anyway); Bola reading it ends the chat's pushes.
  await w.post(`/api/social/conversations/${first.conv.id}/react`, { seq: first.message.seq, emoji: '👍🏽' }, bola);
  await w.wait();
  assert.equal(w.sent.length, 2);
});

test('quiet hours follow the device clock: group messages are held back at night, direct ones only if asked; the hour maths', async (t) => {
  assert.deepEqual([quietHour(22), quietHour(3), quietHour(6), quietHour(7), quietHour(12)], [true, true, true, false, false]);
  assert.equal(hourOn(0, 60), 1); assert.equal(hourOn(0, -300), 19); assert.equal(hourOn(13 * 3600000, 0), 13);
  const w = await world(t);
  const [ada, bola] = [await w.player('Ada'), await w.player('Bola')];
  await w.friends(ada, bola);
  // The fixture's clock is 100 seconds past midnight UTC: a phone at UTC+0 is in its quiet hours; one 12 hours ahead is not.
  const night = await browser(1, 0), day = await browser(2, 12 * 60);
  await w.subscribe(bola, night); await w.subscribe(bola, day);
  await w.post('/api/social/notify', { groups: 'all' }, bola);
  const gid = ((await w.post('/api/social/groups', { name: 'Crew', members: [bola.id], clientId: w.f.id() }, ada)) as Reply).conv.id;
  await w.say(ada, gid, 'late chatter'); await w.wait();
  assert.deepEqual(w.sent.map((call) => call.url), [day.endpoint], 'only the phone where it is daytime');
  w.sent.length = 0;
  await w.dm(ada, bola, 'a direct one'); await w.wait();
  assert.deepEqual(w.sent.map((call) => call.url).sort(), [day.endpoint, night.endpoint].sort(), 'direct messages are not held back by default');
  w.sent.length = 0; w.f.advance(600000);
  await w.post('/api/social/notify', { quietDm: true }, bola);
  await w.dm(ada, bola, 'another direct one'); await w.wait();
  assert.deepEqual(w.sent.map((call) => call.url), [day.endpoint]);
  void noon;
});

test('a subscription the push service dropped is deleted', async (t) => {
  const gone = await world(t, {}, 410);
  const [ada, bola] = [await gone.player('Ada'), await gone.player('Bola')];
  await gone.friends(ada, bola);
  await gone.subscribe(bola, await browser(1));
  await gone.dm(ada, bola, 'hello'); await gone.wait();
  assert.equal(gone.sent.length, 1);
  assert.deepEqual(Object.keys((await gone.stored()).push ?? {}), [], 'the subscription is forgotten');
});

test('the test notification reaches the caller\'s own phones only, three an hour', async (t) => {
  const w = await world(t);
  const [cy, dee] = [await w.player('Cyril'), await w.player('Deedee')];
  const phone = await browser(3);
  assert.equal((await w.post('/api/growth/push/test', {}, cy)).code, 'no_devices');
  await w.subscribe(cy, phone);
  assert.equal((await w.post('/api/growth/push/test', {}, cy)).code, 'sent');
  assert.equal(w.sent.length, 1); assert.equal((await phone.open(w.sent[0]!.body)).kind, 'test');
  assert.equal((await w.post('/api/growth/push/test', {}, dee)).code, 'no_devices', 'nobody else\'s phone');
  for (let i = 0; i < 3; i += 1) await w.post('/api/growth/push/test', {}, cy);
  assert.equal((await w.post('/api/growth/push/test', {}, cy)).code, 'rate_limited');
});

test('a picture is only ever the word Picture on the phone', async (t) => {
  const w = await world(t, { CHAT_IMAGES: 'friends' });
  const [ada, bola] = [await w.player('Ada'), await w.player('Bola')];
  await w.friends(ada, bola);
  const phone = await browser(1);
  await w.subscribe(bola, phone);
  const bytes = Buffer.from(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 8, 0, 8, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0, 1, 2, 3, 0xff, 0xd9));
  const up = await w.post('/api/social/images', { to: bola.id, clientId: w.f.id(), type: 'image/jpeg', data: bytes.toString('base64') }, ada);
  assert.equal(up.code, 'sent');
  await w.wait();
  const note = await phone.open(w.sent[0]!.body);
  assert.deepEqual([note.title, note.body], ['Ada', 'Picture']);
});
