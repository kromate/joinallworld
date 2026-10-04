// The socket registry owns the room lifecycle (server/ws/index.js): whichever socket modules are
// registered, the core routes can always call it, and a module that replaces or extends room
// handling receives the same calls the foundation's own room module does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.js';
import { buildSocketHandlers, WS_MODULES } from './ws/index.js';

const json = async (response) => ({ status: response.status, ...(await response.json()) });

test('core routes work under a replacement socket module that provides nothing', async (t) => {
  const f = await fixture(t, { wsModules: [() => ({})] });
  const opened = await f.request('/api/session', { name: 'Solo Player' });
  assert.equal(opened.status, 200, 'creating a session no longer depends on a function only the room module installed');
  const cookie = opened.headers.get('set-cookie').split(';')[0];
  assert.equal((await json(await f.request('/api/life?city=lagos', null, cookie))).status, 200);
  const acted = await f.action(cookie, { type: 'travel', id: 'library', mode: 'trek' });
  assert.deepEqual([acted.ok, acted.code], [true, 'started']);
  assert.equal((await json(await f.request('/api/session', { name: 'Solo Renamed' }, cookie))).session.name, 'Solo Renamed');
  // No room module, so nobody is in a room: voice configuration is refused, not crashed on.
  const voice = await json(await f.request('/api/voice-config', null, cookie));
  assert.deepEqual([voice.status, voice.error], [403, 'room_membership_required']);
  assert.equal((await f.request('/api/session', null, cookie)).status, 200, 'the server is still answering');
});

test('a replacement room module receives the lifecycle the foundation rooms receive', async (t) => {
  const calls = [];
  let admit = false;
  function customRooms(ctx) {
    return {
      messages: {
        'custom-enter': (ws) => { ws.room = 'lagos:custom'; ctx.send(ws, { type: 'custom-entered', name: ws.session.name }); },
        'custom-name': (ws) => ctx.send(ws, { type: 'custom-name', name: ws.session.name }),
      },
      lifecycle: {
        validateMemberships(secret, cityId, state, publicId) { calls.push(['validateMemberships', typeof secret, cityId, state.location, state.activeAction?.kind ?? null, publicId]); },
        revalidate(publicId) { calls.push(['revalidate', publicId]); },
        roomStillValid(ws, db, session, cityId, state) { calls.push(['roomStillValid', ws.room, session.publicId, cityId, state.location]); return admit; },
        refreshNames(session) { calls.push(['refreshNames', session.id, session.name]); },
      },
    };
  }
  const f = await fixture(t, { wsModules: [customRooms] });
  const ada = await f.device('Ada Custom');
  assert.deepEqual(calls.shift(), ['refreshNames', ada.id, 'Ada Custom'], 'told about the new session');
  await f.request('/api/life?city=lagos', null, ada.cookie);
  assert.deepEqual(calls.shift(), ['validateMemberships', 'string', 'lagos', 'park', null, ada.id], 'told after a settlement');
  await f.action(ada.cookie, { type: 'travel', id: 'library', mode: 'trek' });
  assert.deepEqual(calls.shift(), ['validateMemberships', 'string', 'lagos', 'park', 'travel', ada.id], 'told after an action, with the state it produced');
  // Voice configuration asks the module whether the socket's room still stands.
  const peer = await f.socket(ada);
  peer.ws.send(JSON.stringify({ type: 'custom-enter' }));
  assert.equal((await peer.next()).type, 'custom-entered');
  assert.equal((await f.request('/api/voice-config', null, ada.cookie)).status, 403, 'the module said no');
  assert.deepEqual(calls.shift(), ['roomStillValid', 'lagos:custom', ada.id, 'lagos', 'park']);
  admit = true;
  assert.equal((await f.request('/api/voice-config', null, ada.cookie)).status, 200, 'the module said yes');
  // The route host re-checks a player's rooms after each of their requests once they have a socket in one.
  assert.ok(calls.some((call) => call[0] === 'revalidate' && call[1] === ada.id), 'revalidate(publicId) was called');
  assert.ok(calls.every((call) => call[0] !== 'revalidate' || (call.length === 2 && call[1] === ada.id)), 'always with the public id alone');
  calls.length = 0;
  // A rename reaches the socket (done by the registry itself) and the module's hook.
  assert.equal((await f.request('/api/session', { name: 'Ada Renamed' }, ada.cookie)).status, 200);
  assert.deepEqual(calls.filter((call) => call[0] !== 'revalidate').shift(), ['refreshNames', ada.id, 'Ada Renamed']);
  peer.ws.send(JSON.stringify({ type: 'custom-name' }));
  assert.deepEqual(await peer.next(), { type: 'custom-name', name: 'Ada Renamed' });
});

test('a module that extends the foundation rooms is called alongside them, and one failing hook does not stop the others', async (t) => {
  const calls = [];
  const extra = () => ({ lifecycle: {
    validateMemberships() { calls.push('extra'); },
    revalidate(publicId) { calls.push(`revalidate:${publicId}`); },
    roomStillValid: () => false,
  } });
  const broken = () => ({ lifecycle: { validateMemberships() { calls.push('broken'); throw Error('hook failed'); } } });
  const f = await fixture(t, { wsModules: [broken, ...WS_MODULES, extra] });
  const ada = await f.device('Ada Extend'), bola = await f.device('Bola Extend');
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola);
  await a.next(); // Bola's arrival
  // The broken hook makes the request fail — loudly — but the foundation rooms and the other module were still called:
  const moved = await f.request('/api/action', { actionId: `${f.now()}:11111111-1111-4111-8111-111111111111`, cityId: 'lagos', type: 'travel', id: 'library', mode: 'trek' }, ada.cookie);
  assert.equal(moved.status, 500);
  assert.deepEqual(calls, ['broken', 'extra']);
  let revoked = null;
  for (let i = 0; i < 5 && !revoked; i++) { const message = await a.next(); if (message.type === 'error') revoked = message.code; }
  assert.equal(revoked, 'venue_mismatch', 'the departure was revoked all the same');
  let roster = null;
  for (let i = 0; i < 5 && !roster; i++) { const message = await b.next(); if (message.type === 'presence' && message.members.length === 1) roster = message.members; }
  assert.deepEqual(roster.map((member) => member.id), [bola.id]);
  // The foundation rooms still vouch for Bola's room although the extra module does not (any module may say yes).
  assert.equal((await f.request('/api/voice-config', null, bola.cookie)).status, 200);
});

test('the registry defines the lifecycle for any module list and refuses hooks it does not know', () => {
  const sockets = [{ session: { id: 'p1', name: 'Old' } }, { session: { id: 'p2', name: 'Other' } }];
  const other = { core: { sockets: () => sockets }, now: () => 5000, config: { sessionTtlMs: 1000 } };
  buildSocketHandlers(other, []);
  for (const name of ['validateMemberships', 'revalidate', 'roomStillValid', 'refreshNames']) assert.equal(typeof other.core[name], 'function', name);
  assert.equal(other.core.roomStillValid({}, {}, {}, 'lagos', {}), false, 'no module vouches for a room: not valid');
  other.core.refreshNames({ id: 'p1', name: 'New' });
  assert.deepEqual(sockets.map((ws) => [ws.session.name, ws.expiresAt ?? null]), [['New', 6000], ['Other', null]], 'the registry itself brings the player’s sockets up to date');
  assert.doesNotThrow(() => other.core.refreshNames(undefined));
  return Promise.all([other.core.validateMemberships('s', 'lagos', {}, 'p1'), other.core.revalidate('p1')]).then(() => {
    assert.throws(() => buildSocketHandlers({ core: {} }, [() => ({ lifecycle: { onTeleport() {} } })]), /Invalid socket lifecycle hook: onTeleport/);
    assert.throws(() => buildSocketHandlers({ core: {} }, [() => ({ lifecycle: { revalidate: 'yes' } })]), /Invalid socket lifecycle hook: revalidate/);
    assert.doesNotThrow(() => buildSocketHandlers({}, [() => ({ messages: { 'bare-ping': () => {} } })]), 'a bare context (no core) still builds');
  });
});
