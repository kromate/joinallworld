// OWNER: foundation — checks that a player cannot reach what belongs to other players, and that shared limits hold.
// Pattern and rules: see "HOW TO TEST" at the top of server/routes/index.ts and server/ws/index.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import type { Device, TestSocket } from './test-fixture.ts';
import type { LiveCity, LiveSnapshotFrame } from '../src/types/live.ts';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { addressBucket } from './host-context.ts';
import { isSharedAddress, NEW_SESSIONS_PER_ADDRESS, SOCKETS_PER_ADDRESS } from './protocol.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
interface Reply { status: number; [field: string]: unknown }
const answer = async (res: Response): Promise<Reply> => ({ ...((await res.json()) as Record<string, unknown>), status: res.status });
const get = async (f: Fixture, path: string, who: Device): Promise<Reply> => answer(await f.request(path, null, who.cookie));
const post = async (f: Fixture, path: string, body: unknown, who: Device): Promise<Reply> => answer(await f.request(path, body, who.cookie));
async function people(f: Fixture, names: readonly string[]): Promise<Device[]> {
  const devices: Device[] = [];
  for (const name of names) { const device = await f.device(name); await get(f, '/api/social/me', device); devices.push(device); }
  return devices;
}
const dmId = (a: Device, b: Device): string => `dm.${[a.id, b.id].sort().join('.')}`;

test('a direct chat takes messages from its two players only, and shows itself to nobody else', async t => {
  const f = await fixture(t);
  const [ada, bola, chi] = await people(f, ['Ada', 'Bola', 'Chidinma']) as [Device, Device, Device];
  assert.equal((await post(f, '/api/social/messages', { to: bola.id, body: 'The key is under the mat.', clientId: f.id() }, ada)).code, 'sent');
  assert.equal((await post(f, '/api/social/messages', { to: ada.id, body: 'Thanks, see you at six.', clientId: f.id() }, bola)).code, 'sent');
  const conv = dmId(ada, bola);

  // A third player names the chat by its id, over HTTP and over the socket.
  const pushed = await post(f, '/api/social/messages', { conv, body: 'Let me in.', clientId: f.id() }, chi);
  assert.equal(pushed.ok, false);
  assert.equal(pushed.code, 'not_a_member');
  const c = await f.socket(chi);
  c.ws.send(JSON.stringify({ type: 'dm-send', conv, body: 'Let me in.', clientId: f.id() }));
  const frame = await c.next();
  assert.equal(frame.type, 'dm-failed');

  // Nothing was stored or listed: the two players see their own two messages, and the third has no such chat.
  const history = await get(f, `/api/social/conversations/${conv}`, ada);
  assert.deepEqual((history.messages as { body: string }[]).map(message => message.body), ['The key is under the mat.', 'Thanks, see you at six.']);
  assert.equal((await post(f, '/api/social/messages', { to: bola.id, body: 'Six it is.', clientId: f.id() }, ada)).code, 'sent');
  const listed = await get(f, '/api/social/conversations', chi);
  assert.deepEqual(listed.conversations, []);
  assert.equal(JSON.stringify(listed).includes('Six it is'), false);
  assert.equal((await get(f, `/api/social/conversations/${conv}`, chi)).code, 'not_a_member');
});

/** Send `live-watch` and answer the snapshot it is answered with. */
async function liveSnapshot(peer: TestSocket): Promise<LiveSnapshotFrame> {
  peer.ws.send(JSON.stringify({ type: 'live-watch', cityId: 'lagos' }));
  for (let i = 0; i < 50; i++) { const frame = await peer.next(); if (frame.type === 'live-snapshot') return frame; }
  throw new Error('No snapshot');
}
const counts = (city: LiveCity | null): Record<string, number> => ({ ...(city?.venues ?? {}), moving: city?.moving ?? 0 });

test('the counts of a city are the same for every watcher, so a block cannot be used to find one player in them', async t => {
  const f = await fixture(t);
  const [bola, cy, mallory] = await people(f, ['Bola', 'Cyril', 'Mallory']) as [Device, Device, Device];
  for (const who of [bola, cy, mallory]) await get(f, '/api/life?city=lagos', who);
  // Two strangers to Mallory are out in the city: one walking to the library, one standing where a life starts.
  await f.socket(bola); await f.socket(cy);
  assert.equal((await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
  const m = await f.socket(mallory);
  let before: Record<string, number> = {};
  for (let i = 0; i < 100 && before.moving !== 1; i++) { before = counts((await liveSnapshot(m)).city); await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(before.moving, 1, 'one player is on a trip');

  // Mallory blocks one of them, then the other blocks Mallory: what Mallory is given does not change either time.
  assert.equal((await post(f, '/api/social/block', { id: bola.id, cityId: 'lagos' }, mallory)).ok, true);
  assert.deepEqual(counts((await liveSnapshot(m)).city), before);
  assert.equal((await post(f, '/api/social/block', { id: mallory.id, cityId: 'lagos' }, cy)).ok, true);
  assert.deepEqual(counts((await liveSnapshot(m)).city), before);
});

/** A server whose mail provider is a fake that accepts everything, with players who have answered the age question. */
async function mailServer(t: Parameters<typeof fixture>[0], cap: string) {
  const sent: string[] = [];
  const provider = async (_url: string, init: RequestInit): Promise<Response> => { sent.push(String(init.body)); return new Response(null, { status: 202 }); };
  const f = await fixture(t, { publicOrigin: 'https://play.example', fetch: provider, env: { ZEPTOMAIL_AUTH: 'Zoho-enczapikey TESTKEY-not-a-real-key', EMAIL_FROM_ADDRESS: 'hello@mail.play.example', EMAIL_DAILY_CAP: cap } });
  const adult = async (name: string): Promise<Device> => {
    const who = await f.device(name);
    await get(f, '/api/life?city=lagos', who);
    await post(f, '/api/growth/hello', { cityId: 'lagos' }, who);
    assert.equal((await post(f, '/api/growth/consent', { cityId: 'lagos', age: 'adult' }, who)).status, 200);
    return who;
  };
  return { f, sent, adult };
}

test('confirmation e-mails: one address is written to a few times a day whoever asks, and they stay inside the daily total', async t => {
  // Four different players name the same address, which belongs to none of them.
  const one = await mailServer(t, '500');
  const codes: unknown[] = [];
  for (const name of ['Ada', 'Bola', 'Chidi', 'Dayo']) codes.push((await post(one.f, '/api/growth/email', { email: 'Somebody@Example.com', consent: true }, await one.adult(name))).code);
  assert.deepEqual(codes, ['confirm_sent', 'confirm_sent', 'confirm_sent', 'confirm_limit']);
  assert.equal(one.sent.length, 3, 'the fourth request sent nothing');
  // The next day the address may be asked again.
  one.f.advance(86400000);
  assert.equal((await post(one.f, '/api/growth/email', { email: 'somebody@example.com', consent: true }, await one.adult('Efe'))).code, 'confirm_sent');

  // With a daily total of four, confirmations may use two of it, to whatever addresses.
  const two = await mailServer(t, '4');
  const more: unknown[] = [];
  for (const name of ['Ada', 'Bola', 'Chidi']) more.push((await post(two.f, '/api/growth/email', { email: `${name.toLowerCase()}@example.com`, consent: true }, await two.adult(name))).code);
  assert.deepEqual(more, ['confirm_sent', 'confirm_sent', 'try_later']);
  assert.equal(two.sent.length, 2);
});

test('the address a limit is keyed on: an IPv6 address is its /64, an IPv4 address is itself, and a digest is never a private network', () => {
  assert.equal(addressBucket('2001:db8:12:34:aaaa:bbbb:cccc:dddd'), addressBucket('2001:db8:12:34::1'));
  assert.notEqual(addressBucket('2001:db8:12:34::1'), addressBucket('2001:db8:12:35::1'));
  assert.equal(addressBucket('2001:DB8::1'), '2001:db8:0:0');
  assert.equal(addressBucket('203.0.113.9'), '203.0.113.9');
  assert.equal(addressBucket('::ffff:203.0.113.9'), '203.0.113.9', 'an IPv4 address written as IPv6 is that IPv4 address');
  assert.notEqual(addressBucket('::ffff:203.0.113.9'), addressBucket('::ffff:203.0.113.10'));
  assert.equal(addressBucket('::1'), '::1');
  assert.equal(isSharedAddress(addressBucket('fd00::1')), true);
  assert.equal(isSharedAddress(addressBucket('fe80::1234')), true);
  // The Worker host keys on a SHA-256 of the address: one that begins with these letters is not a private range.
  for (const digest of ['fc', 'fd', 'fe80'].map(head => head.padEnd(64, '0'))) assert.equal(isSharedAddress(digest), false, digest);
});

test('one network address makes a bounded number of new sessions an hour, wherever in its /64 it asks from', async t => {
  const f = await fixture(t, { trustProxy: true });
  const create = async (address: string, name: string): Promise<number> => {
    const res = await fetch(`${f.base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': address }, body: JSON.stringify({ name }) });
    await res.arrayBuffer();
    return res.status;
  };
  let made = 0;
  for (let i = 0; i < NEW_SESSIONS_PER_ADDRESS + 5; i++) if (await create(`2001:db8:1:2::${(i + 1).toString(16)}`, `Guest ${i}`) === 200) made += 1;
  assert.equal(made, NEW_SESSIONS_PER_ADDRESS);
  assert.equal(await create('2001:db8:1:2:ffff::9', 'One more'), 429);
  // Another network is not affected, a session that exists is not counted, and the hour passes.
  assert.equal(await create('2001:db8:1:3::1', 'Neighbour'), 200);
  assert.equal(await create('198.51.100.7', 'Elsewhere'), 200);
  f.advance(3600000);
  assert.equal(await create('2001:db8:1:2::1', 'Later'), 200);
});

test('one network address holds a bounded number of sockets, so it cannot take every place on the server', async t => {
  const f = await fixture(t, { trustProxy: true });
  const from = '203.0.113.40';
  const open = async (device: Device, address: string): Promise<boolean> => {
    const ws = new WebSocket(`${f.base.replace('http', 'ws')}/socket`, { headers: { Cookie: device.cookie, Origin: f.base, 'X-Forwarded-For': address } });
    ws.on('error', () => {});
    t.after(() => ws.terminate());
    const [event] = await Promise.race([once(ws, 'open').then(() => ['open']), once(ws, 'unexpected-response').then(() => ['refused']), once(ws, 'close').then(() => ['refused'])]);
    return event === 'open';
  };
  // Eight sockets a session: five sessions would be forty.
  const devices: Device[] = [];
  for (let i = 0; i < 5; i++) devices.push(await f.device(`Holder ${i}`));
  let held = 0;
  for (const device of devices) for (let i = 0; i < 8; i++) if (await open(device, from)) held += 1;
  assert.equal(held, SOCKETS_PER_ADDRESS);
  assert.equal(await open(await f.device('Visitor'), '203.0.113.41'), true, 'a visitor from another address still connects');
});
