// OWNER: foundation — checks that a player cannot reach what belongs to other players, and that shared limits hold.
// Pattern and rules: see "HOW TO TEST" at the top of server/routes/index.ts and server/ws/index.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';

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

test('a call can only be placed by a player the callee could block: a session that never arrived in the city rings nobody', async t => {
  const f = await fixture(t);
  const [ada] = await people(f, ['Ada']) as [Device];
  const a = await f.socket(ada);
  // A session with a name and a socket, which has not played and so is no player anybody can find, message or block.
  const ghost = await f.device('Unknown caller');
  assert.equal((await post(f, '/api/social/block', { id: ghost.id, cityId: 'lagos' }, ada)).code, 'unknown_player', 'there is nobody to block yet');
  const g = await f.socket(ghost);
  g.ws.send(JSON.stringify({ type: 'call-invite', to: ada.id, clientId: 'ring-1' }));
  const answer = await g.next();
  assert.deepEqual([answer.type, 'state' in answer ? answer.state : null], ['call-state', 'unreachable']);
  // Nothing rang: the next frame Ada's socket is sent is the answer to her own question.
  a.ws.send(JSON.stringify({ type: 'call-settings' }));
  assert.equal((await a.next()).type, 'call-settings');
  // Once the caller is a player like any other the call rings, and the callee can block them.
  await get(f, '/api/social/me', ghost);
  g.ws.send(JSON.stringify({ type: 'call-invite', to: ada.id, clientId: 'ring-2' }));
  let rang = await g.next();
  while (rang.type !== 'call-state') rang = await g.next();
  assert.equal('state' in rang ? rang.state : null, 'ringing');
  assert.equal((await post(f, '/api/social/block', { id: ghost.id, cityId: 'lagos' }, ada)).code, 'blocked');
});
