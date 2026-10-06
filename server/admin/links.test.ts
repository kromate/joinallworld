// OWNER: admin - what calls, the hosted guide and pictures in chat put into the admin section (server/admin/links.ts), and the two sanctions that
// the picture and call paths now enforce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { admins, FOUNDER_ADDRESS } from './admin.test.ts';

type Json = Record<string, any>;
const bytes = (...parts: number[][]): Uint8Array => Uint8Array.from(parts.flat());
const u16 = (n: number): number[] => [n >> 8, n & 255];
const seg = (marker: number, body: number[]): number[] => [0xff, marker, ...u16(body.length + 2), ...body];
/** The smallest JPEG the server's own reader accepts: 64 x 48, no metadata. */
const jpeg = (): Uint8Array => bytes([0xff, 0xd8], seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), seg(0xdb, new Array(65).fill(0)),
  seg(0xc0, [8, ...u16(48), ...u16(64), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]), [1, 2, 3, 4, 5, 6, 7, 8], [0xff, 0xd9]);
const b64 = (data: Uint8Array): string => Buffer.from(data).toString('base64');

async function world(t: Parameters<typeof admins>[0]) {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.player('Ada'), bola = await a.player('Bola');
  for (const who of [ada, bola]) await a.f.request('/api/social/me', null, who.cookie);
  assert.equal(((await (await a.f.request('/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada.cookie)).json()) as Json).code, 'requested');
  assert.equal(((await (await a.f.request('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola.cookie)).json()) as Json).code, 'accepted');
  const upload = async (who: { cookie: string }, to: string): Promise<Json> => (await (await a.f.request('/api/social/images', { to, clientId: a.f.id(), type: 'image/jpeg', data: b64(jpeg()) }, who.cookie)).json()) as Json;
  const act = (id: string, body: Json) => a.admin(`/api/admin/players/${id}/act`, founder.cookie, body);
  return { a, founder, ada, bola, upload, act };
}

test('the dashboard carries the numbers of calls, the hosted guide and pictures, and only an admin can read it', async (t) => {
  const { a, founder, ada } = await world(t);
  const dash = (await a.admin('/api/admin/dashboard?fresh=1', founder.cookie)).body as Json;
  const groups = new Set((dash.extra as Json[]).map((item) => item.group));
  for (const name of ['Calls today', 'AI guide today', 'Pictures in chat']) assert.ok(groups.has(name), name);
  const value = (id: string): unknown => (dash.extra as Json[]).find((item) => item.id === id)?.value;
  assert.equal(value('calls-placed'), 0); assert.equal(value('calls-relay-set'), 'no'); assert.equal(value('guide-on'), 'no'); assert.equal(value('guide-requests'), 0);
  assert.equal(value('pictures-on'), 'no', 'the environment leaves pictures off'); assert.equal(value('pictures-stored'), 0);
  assert.equal((await a.admin('/api/admin/dashboard', ada.cookie)).status, 404);
  assert.equal((await a.admin('/api/admin/companion/test', founder.cookie, {})).body.error, 'off', 'the guide test says the gateway is not configured');
  assert.equal((await a.admin('/api/admin/companion/test', ada.cookie, {})).status, 404);
});

test('pictures in chat: off by default, turned on from the admin settings only with the typed confirmation, and the sanction is enforced', async (t) => {
  const { a, founder, ada, bola, upload, act } = await world(t);
  assert.equal((await upload(ada, bola.id)).code, 'pictures_off');
  const setting = async (key: string): Promise<Json | undefined> => (((await a.admin('/api/admin/settings', founder.cookie)).body.settings as Json[]).find((item) => item.key === key));
  assert.equal((await setting('chatPictures'))?.value, false); assert.equal((await setting('chatPictures'))?.confirmOn, true); assert.equal((await setting('chatPush'))?.value, true);
  const first = await a.admin('/api/admin/settings', founder.cookie, { key: 'chatPictures', value: true });
  assert.equal(first.body.code, 'confirmation_required'); assert.equal((await setting('chatPictures'))?.value, false, 'the first request changed nothing');
  assert.equal((await a.admin('/api/admin/settings', founder.cookie, { key: 'chatPictures', value: true, confirm: 'nonsense' })).body.code, 'confirmation_required');
  assert.equal((await a.admin('/api/admin/settings', founder.cookie, { key: 'chatPictures', value: true, confirm: first.body.token })).body.code, 'changed');
  assert.equal((await setting('chatPictures'))?.value, true);
  const sent = await upload(ada, bola.id);
  assert.equal(sent.code, 'sent');
  // Suspending picture-sending stops the next upload; lifting it lets it through; turning the switch off refuses again.
  assert.equal((await act(ada.id, { action: 'suspend', kind: 'pictures', minutes: 30, reason: 'test' })).body.code, 'applied');
  assert.equal((await upload(ada, bola.id)).code, 'pictures_blocked');
  assert.equal((await act(ada.id, { action: 'unsuspend', kind: 'pictures', reason: 'test' })).body.code, 'lifted');
  assert.equal((await upload(ada, bola.id)).code, 'sent');
  assert.equal((await a.admin('/api/admin/settings', founder.cookie, { key: 'chatPictures', value: false })).body.code, 'changed');
  assert.equal((await upload(ada, bola.id)).code, 'pictures_off');
});

test('the pictures queue: list, view, remove, restore and stop a player sending, all under the admin guard', async (t) => {
  const { a, founder, ada, bola, upload } = await world(t);
  assert.equal((await a.admin('/api/admin/settings', founder.cookie, { key: 'chatPictures', value: true, confirm: (await a.admin('/api/admin/settings', founder.cookie, { key: 'chatPictures', value: true })).body.token })).body.code, 'changed');
  const sent = await upload(ada, bola.id), image = (sent.message as Json).image.id as string;
  assert.equal(((await (await a.f.request('/api/social/reports', { conv: (sent.conv as Json).id, image, reason: 'harassment' }, bola.cookie)).json()) as Json).code, 'reported');
  const listed = async (): Promise<Json[]> => (await a.admin('/api/admin/moderation/pictures', founder.cookie)).body.pictures as Json[];
  const entry = (await listed()).find((item) => item.id === image);
  assert.equal(entry?.from, ada.id); assert.equal(entry?.reports, 1);
  const viewed = await a.call(`/api/admin/moderation/pictures/${image}`, null, founder.cookie);
  assert.equal(viewed.status, 200); assert.equal(viewed.headers.get('content-type'), 'image/jpeg');
  assert.equal((await a.call(`/api/admin/moderation/pictures/${image}`, null, bola.cookie)).status, 404, 'not an admin');
  assert.equal((await a.admin(`/api/admin/moderation/pictures/${image}/act`, founder.cookie, { action: 'remove' })).body.code, 'removed');
  assert.equal((await a.call(`/api/admin/moderation/pictures/${image}`, null, founder.cookie)).status, 404, 'the bytes are gone');
  assert.equal((await a.admin(`/api/admin/moderation/pictures/${image}/act`, founder.cookie, { action: 'restore' })).body.code, 'gone');
  assert.equal((await a.admin('/api/admin/moderation/pictures/player', founder.cookie, { player: ada.id, allowed: false })).body.code, 'banned');
  assert.equal(((await upload(ada, bola.id)).code), 'pictures_blocked');
  assert.equal((await a.admin('/api/admin/moderation/pictures/player', founder.cookie, { player: ada.id, allowed: true })).body.code, 'allowed');
  assert.equal((await a.admin(`/api/admin/moderation/pictures/${image}/act`, bola.cookie, { action: 'remove' })).status, 404);
  const audit = (await a.admin('/api/admin/audit?q=picture', founder.cookie)).body.lines as Json[];
  assert.ok(audit.some((line) => line.action === 'picture-remove'));
});

test('a player whose calls are suspended cannot place one; lifting it lets the call ring', async (t) => {
  const { a, ada, bola, act } = await world(t);
  const caller = await a.f.socket(ada), callee = await a.f.socket(bola);
  const state = async (peer: typeof caller): Promise<Json> => { for (let i = 0; i < 100; i += 1) { const message = await peer.next() as Json; if (message.type === 'call-state') return message; } throw Error('no call-state'); };
  const ring = (id: string): void => caller.ws.send(JSON.stringify({ type: 'call-invite', to: id, clientId: `c${Math.random().toString(36).slice(2, 10)}` }));
  assert.equal((await act(ada.id, { action: 'suspend', kind: 'calls', minutes: 30, reason: 'test' })).body.code, 'applied');
  ring(bola.id);
  assert.equal((await state(caller)).state, 'unreachable');
  assert.equal((await act(ada.id, { action: 'unsuspend', kind: 'calls', reason: 'test' })).body.code, 'lifted');
  ring(bola.id);
  assert.equal((await state(caller)).state, 'ringing');
  void callee;
});
