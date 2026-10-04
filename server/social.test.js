// OWNER: social — tests for server/routes/social.js, server/ws/social.js and server/social/.
// Pattern and rules: see "HOW TO TEST" at the top of server/routes/index.js and server/ws/index.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.js';
import { LIMITS } from './social/service.js';
import { RECONNECT_GRACE_MS } from './social/presence.js';
import { SHIFT_SECONDS } from '../src/game/content/jobs.ts';
import { DEFAULT_LOOK } from '../src/game/content/traits.ts';

const HOUR = 3600000;
const get = async (f, path, who) => { const res = await f.request(path, null, who?.cookie); return { status: res.status, ...(await res.json()) }; };
const post = async (f, path, body, who) => { const res = await f.request(path, body, who?.cookie); return { status: res.status, ...(await res.json()) }; };
const database = async (f) => JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8'));
const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));
/** Read socket messages until one of the given type arrives. */
async function until(peer, type) {
  for (let i = 0; i < 300; i++) { const message = await peer.next(); if (message.type === type) return message; }
  throw Error(`No ${type} message`);
}
async function eventually(check) {
  for (let i = 0; i < 100; i++) { const value = await check(); if (value) return value; await tick(); }
  throw Error('Condition never became true');
}
async function befriend(f, a, b) {
  assert.equal((await post(f, '/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a)).code, 'requested');
  assert.equal((await post(f, '/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b)).code, 'accepted');
}
async function people(f, names) {
  const devices = [];
  for (const name of names) { const device = await f.device(name); await get(f, '/api/social/me', device); devices.push(device); }
  return devices;
}
async function goHome(f, device) {
  await f.action(device.cookie, { type: 'travel', id: 'home', mode: 'trek' });
  f.advance(20000); // the longest trek in the merged city is 18 seconds
  const peer = await f.socket(device);
  peer.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home' }));
  await until(peer, 'presence');
  return peer;
}
/**
 * One paid career shift: ₦3,000 earned from work. (The branch earned with four back-to-back
 * starter shifts; the merged career rules give that job a four-hour break, so a Teaching shift
 * at Freedom Park — open all day, where a new life starts — is the honest way to earn here.)
 */
async function earn(f, device) {
  assert.equal((await f.action(device.cookie, { type: 'apply-job', id: 'teaching' })).code, 'applied');
  await f.action(device.cookie, { type: 'spot', id: 'work' });
  const started = await f.action(device.cookie, { type: 'activity', id: 'teaching-shift' });
  assert.equal(started.code, 'started', started.reason);
  f.advance(SHIFT_SECONDS * 1000);
  return (await get(f, '/api/life?city=lagos', device)).state;
}

test('social routes need a device session and a same-origin request', async t => {
  const f = await fixture(t);
  for (const path of ['/api/social/me', '/api/social/people?city=lagos', '/api/social/conversations', '/api/social/search?q=ada']) assert.equal((await get(f, path)).status, 401, path);
  assert.equal((await post(f, '/api/social/messages', { to: randomUUID(), body: 'hi', clientId: f.id() })).error, 'device_session_required');
  const ada = await f.device('Ada');
  const hostile = await fetch(`${f.base}/api/social/me`, { headers: { Cookie: ada.cookie, Origin: 'https://evil.example' } });
  assert.equal(hostile.status, 403);
  assert.equal((await get(f, '/api/social/friends', ada)).status, 404, 'the friends list is part of /me');
  assert.equal((await get(f, '/api/life?city=lagos', ada)).status, 200);
  const me = await get(f, '/api/social/me', ada);
  assert.deepEqual(me.me, { id: ada.id, name: 'Ada', since: 100000 }); assert.equal(me.invitePath, `/v/${ada.id}`);
  assert.deepEqual([me.friends, me.conversations, me.updates, me.blocked], [[], [], [], []]);
});

test('find a player, friend request → accept exactly once, friend.made lands in both lives', async t => {
  const f = await fixture(t);
  const [ada, bola, chi] = await people(f, ['Ada', 'Bola', 'Chidinma']);
  assert.deepEqual((await get(f, '/api/social/search?q=bol', ada)).results, [{ id: bola.id, name: 'Bola', friend: false }]);
  assert.deepEqual((await get(f, `/api/social/search?q=${bola.id}`, ada)).results.map((item) => item.id), [bola.id]);
  assert.deepEqual((await get(f, '/api/social/search?q=@ada', ada)).results, [], 'never lists yourself');
  assert.equal((await get(f, '/api/social/search?q=a', ada)).status, 400);
  assert.equal((await post(f, '/api/social/friends/request', { to: ada.id, cityId: 'lagos' }, ada)).code, 'self');
  assert.equal((await post(f, '/api/social/friends/request', { to: randomUUID(), cityId: 'lagos' }, ada)).code, 'unknown_player');
  assert.equal((await post(f, '/api/social/friends/request', { to: 'nope', cityId: 'lagos' }, ada)).status, 400);

  const b = await f.socket(bola);
  const first = await post(f, '/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada);
  assert.equal(first.code, 'requested'); assert.equal(first.push, undefined, 'push lists never reach the client');
  assert.deepEqual((await until(b, 'friend-request')).from, { id: ada.id, name: 'Ada' });
  assert.equal((await post(f, '/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada)).duplicate, true);
  let me = await get(f, '/api/social/me', bola);
  assert.deepEqual(me.requests.in.map((item) => item.id), [ada.id]); assert.equal(me.updates[0].kind, 'friend-request');
  assert.equal((await post(f, '/api/social/friends/answer', { from: chi.id, accept: true, cityId: 'lagos' }, bola)).code, 'no_request');

  const accepted = await post(f, '/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola);
  assert.equal(accepted.code, 'accepted');
  assert.equal((await post(f, '/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola)).duplicate, true);
  // Ada had no socket open: her life learns of the friendship on her next request.
  me = await get(f, '/api/social/me', ada);
  assert.deepEqual(me.friends.map((friend) => [friend.id, friend.status]), [[bola.id, 'away']]);
  // She had no life yet either. Nothing is created to hold the friendship: it waits until she has one.
  await get(f, '/api/life?city=lagos', ada); await get(f, '/api/social/me', ada);
  const adaLife = (await get(f, '/api/life?city=lagos', ada)).state, bolaLife = (await get(f, '/api/life?city=lagos', bola)).state;
  assert.equal(adaLife.social.rel[bola.id].friend, true); assert.equal(adaLife.social.rel[bola.id].name, 'Bola');
  assert.equal(bolaLife.social.rel[ada.id].friend, true);
  // A crossed request is accepted, not duplicated.
  await post(f, '/api/social/friends/request', { to: ada.id, cityId: 'lagos' }, chi);
  assert.equal((await post(f, '/api/social/friends/request', { to: chi.id, cityId: 'lagos' }, ada)).code, 'accepted');
  // Decline, then remove.
  const [dayo] = await people(f, ['Dayo']);
  await post(f, '/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, dayo);
  assert.equal((await post(f, '/api/social/friends/answer', { from: dayo.id, accept: false, cityId: 'lagos' }, bola)).code, 'declined');
  assert.equal((await post(f, '/api/social/friends/remove', { id: ada.id, cityId: 'lagos' }, bola)).code, 'removed');
  assert.deepEqual((await get(f, '/api/social/me', ada)).friends.map((friend) => friend.id), [chi.id]);
  assert.equal((await get(f, '/api/life?city=lagos', ada)).state.social.rel[bola.id].friend, undefined);
});

test('messages: pending → sent, retry with the same client id never duplicates, offline recipients fetch on open', async t => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  const id = f.id();
  const sent = await post(f, '/api/social/messages', { to: bola.id, body: '  How far?  ', clientId: id }, ada);
  assert.equal(sent.code, 'sent'); assert.equal(sent.message.body, 'How far?'); assert.equal(sent.message.clientId, id); assert.equal(sent.message.seq, 1);
  // The reply was lost: the client retries the same client id. Same message back, nothing stored twice.
  const retry = await post(f, '/api/social/messages', { to: bola.id, body: 'How far?', clientId: id }, ada);
  assert.equal(retry.duplicate, true); assert.equal(retry.message.id, sent.message.id);
  assert.equal((await post(f, '/api/social/messages', { to: bola.id, body: 'Different', clientId: id }, ada)).status, 409);
  // Bola was offline: unread count and history are there when he opens Messages.
  let list = await get(f, '/api/social/conversations', bola);
  assert.equal(list.unread, 1); assert.equal(list.conversations[0].name, 'Ada'); assert.equal(list.conversations[0].last.body, 'How far?');
  const history = await get(f, `/api/social/conversations/${sent.conv.id}`, bola);
  assert.deepEqual(history.messages.map((message) => [message.seq, message.body, message.from.name, message.clientId]), [[1, 'How far?', 'Ada', undefined]]);
  assert.equal((await post(f, `/api/social/conversations/${sent.conv.id}/read`, {}, bola)).conv.unread, 0);
  // Live delivery over the socket, once, when the recipient is online.
  const a = await f.socket(ada), b = await f.socket(bola);
  const reply = f.id();
  b.ws.send(JSON.stringify({ type: 'dm-send', conv: sent.conv.id, body: 'I dey o', clientId: reply }));
  b.ws.send(JSON.stringify({ type: 'dm-send', conv: sent.conv.id, body: 'I dey o', clientId: reply }));
  const live = await until(a, 'dm');
  assert.equal(live.message.body, 'I dey o'); assert.equal(live.conv.unread, 1); assert.equal(live.message.clientId, undefined);
  assert.equal((await until(b, 'dm-sent')).clientId, reply);
  assert.equal((await until(b, 'dm-sent')).duplicate, true);
  assert.equal((await get(f, `/api/social/conversations/${sent.conv.id}`, ada)).messages.length, 2);
  assert.equal((await get(f, `/api/social/conversations/${sent.conv.id}?after=1`, ada)).messages.length, 1);
  // A failure is tied to the client id so the pending bubble can offer Retry instead of stalling.
  b.ws.send(JSON.stringify({ type: 'dm-send', conv: sent.conv.id, body: 'x'.repeat(501), clientId: 'c-too-long-1' }));
  assert.deepEqual(await until(b, 'dm-failed'), { type: 'dm-failed', clientId: 'c-too-long-1', code: 'invalid_message', reason: 'That message could not be sent as written.' });
  b.ws.send(JSON.stringify({ type: 'dm-read', conv: sent.conv.id }));
  assert.equal((await until(b, 'dm-read-ok')).conv.unread, 0);
  // Malformed input.
  for (const body of ['', '   ', 'bad\u0007bell', 'x'.repeat(501), 7, null]) assert.equal((await post(f, '/api/social/messages', { to: bola.id, body, clientId: f.id() }, ada)).status, 400, String(body));
  for (const clientId of ['short', 'has space in it', 'x'.repeat(81), undefined]) assert.equal((await post(f, '/api/social/messages', { to: bola.id, body: 'hi', clientId }, ada)).status, 400);
  assert.equal((await post(f, '/api/social/messages', { conv: `dm.${randomUUID()}.${randomUUID()}`, body: 'hi', clientId: f.id() }, ada)).code, 'not_a_member');
  assert.equal((await get(f, `/api/social/conversations/${sent.conv.id}`, await f.device('Eve'))).code, 'not_a_member');
  // History is bounded.
  f.advance(120000);
  for (let i = 0; i < 2; i++) await post(f, '/api/social/messages', { conv: sent.conv.id, body: `m${i}`, clientId: f.id() }, ada);
  const stored = (await database(f)).social.convs[sent.conv.id];
  assert.ok(stored.messages.length <= LIMITS.history); assert.equal(stored.seq, 4);
  assert.ok(!JSON.stringify((await database(f)).social).includes(ada.cookie.slice(4)), 'the cookie secret is never stored in the social collection');
});

test('anti-spam: strangers get three messages until a reply, and the per-minute limit fails softly', async t => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  for (let i = 0; i < 3; i++) assert.equal((await post(f, '/api/social/messages', { to: bola.id, body: `hey ${i}`, clientId: f.id() }, ada)).code, 'sent');
  const waiting = await post(f, '/api/social/messages', { to: bola.id, body: 'hello??', clientId: f.id() }, ada);
  assert.equal(waiting.code, 'awaiting_reply'); assert.match(waiting.reason, /Bola has not replied yet/);
  await post(f, '/api/social/messages', { to: ada.id, body: 'who be this', clientId: f.id() }, bola);
  let limited = null;
  for (let i = 0; i < 30 && !limited; i++) { const res = await post(f, '/api/social/messages', { to: bola.id, body: `spam ${i}`, clientId: f.id() }, ada); if (!res.ok) limited = res; }
  assert.equal(limited.code, 'rate_limited'); assert.match(limited.reason, /too quickly/);
  f.advance(61000);
  assert.equal((await post(f, '/api/social/messages', { to: bola.id, body: 'calm now', clientId: f.id() }, ada)).code, 'sent');
});

test('block hides both players from each other and stops DMs and knocks; reports leave a receipt', async t => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  await befriend(f, ada, bola);
  const hello = await post(f, '/api/social/messages', { to: ada.id, body: 'buy my coin', clientId: f.id() }, bola);
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola);
  assert.deepEqual((await get(f, '/api/social/people?city=lagos', ada)).players.map((player) => player.id), [bola.id]);

  assert.equal((await post(f, '/api/social/block', { id: bola.id, cityId: 'lagos' }, ada)).code, 'blocked');
  assert.equal((await post(f, '/api/social/block', { id: bola.id, cityId: 'lagos' }, ada)).duplicate, true);
  const me = await get(f, '/api/social/me', ada);
  assert.deepEqual([me.friends, me.conversations, me.blocked.map((item) => item.id)], [[], [], [bola.id]]);
  assert.deepEqual((await get(f, '/api/social/me', bola)).friends, []);
  for (const [who, target] of [[ada, bola], [bola, ada]]) {
    assert.deepEqual((await get(f, '/api/social/people?city=lagos', who)).players, []);
    assert.deepEqual((await get(f, `/api/social/search?q=${target.name.toLowerCase()}`, who)).results, []);
    assert.equal((await post(f, '/api/social/messages', { to: target.id, body: 'hi', clientId: f.id() }, who)).code, 'blocked');
    assert.equal((await post(f, '/api/social/friends/request', { to: target.id, cityId: 'lagos' }, who)).code, 'blocked');
    assert.equal((await post(f, '/api/social/house/knock', { host: target.id, cityId: 'lagos' }, who)).code, 'blocked');
  }
  assert.equal((await get(f, `/api/social/players/${ada.id}`, bola)).code, 'unknown_player');
  assert.equal((await post(f, '/api/social/messages', { conv: hello.conv.id, body: 'hi', clientId: f.id() }, bola)).code, 'blocked');

  const report = await post(f, '/api/social/reports', { id: bola.id, reason: 'spam', text: 'Keeps advertising.' }, ada);
  assert.equal(report.code, 'reported'); assert.match(report.receipt.id, /^R-\d+$/); assert.equal(report.receipt.status, 'received');
  assert.equal((await post(f, '/api/social/reports', { id: bola.id, reason: 'spam' }, ada)).duplicate, true);
  assert.equal((await post(f, '/api/social/reports', { id: bola.id, reason: 'because' }, ada)).status, 400);
  assert.equal((await post(f, '/api/social/reports', { id: bola.id, reason: 'other', text: 'x'.repeat(301) }, ada)).status, 400);
  const after = await get(f, '/api/social/me', ada);
  assert.equal(after.reports[0].id, report.receipt.id); assert.match(after.updates[0].text, /was received/);
  const stored = (await database(f)).social.reports[0];
  assert.deepEqual([stored.by, stored.about, stored.reason, stored.text, stored.evidence], [ada.id, bola.id, 'spam', 'Keeps advertising.', ['buy my coin']]);

  assert.equal((await post(f, '/api/social/unblock', { id: bola.id }, ada)).code, 'unblocked');
  assert.deepEqual((await get(f, '/api/social/people?city=lagos', ada)).players.map((player) => player.id), [bola.id]);
  a.ws.close(); b.ws.close();
});

test('presence is truthful: two clients agree, leaving shows at once, a dropped socket is reconnecting then offline', async t => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  await befriend(f, ada, bola);
  const status = async (viewer) => { const friend = (await get(f, '/api/social/me', viewer)).friends[0]; return [friend.status, friend.venue]; };
  assert.deepEqual(await status(ada), ['offline', undefined]);
  let here = await get(f, '/api/social/people?city=lagos', ada);
  assert.deepEqual([here.venue, here.self, here.count], ['park', 'not_joined', 0], 'not in the room yet: says so instead of showing an empty venue as fact');

  const a = await f.joinRoom(ada);
  const b = await f.joinRoom(bola);
  assert.deepEqual(await until(a, 'people-presence'), { type: 'people-presence', id: bola.id, status: 'online' });
  const view = async (who) => { const list = await get(f, '/api/social/people?city=lagos', who); return [list.self, list.players.map((player) => player.name)]; };
  assert.deepEqual(await view(ada), ['joined', ['Bola']]);
  assert.deepEqual(await view(bola), ['joined', ['Ada']]);
  assert.deepEqual(await status(ada), ['online', 'park']); assert.deepEqual(await status(bola), ['online', 'park']);
  a.ws.send(JSON.stringify({ type: 'people-list', cityId: 'lagos' }));
  assert.deepEqual((await until(a, 'people')).players.map((player) => player.id), [bola.id]);

  // Bola sets off: the foundation revokes his room at once, and both views follow.
  await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' });
  assert.deepEqual(await view(ada), ['joined', []]);
  assert.deepEqual(await view(bola), ['travelling', []]);
  assert.deepEqual(await status(ada), ['away', undefined]);
  f.advance(20000);
  b.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'library' }));
  await until(b, 'presence');
  assert.deepEqual(await status(ada), ['online', 'library']);
  assert.deepEqual(await view(bola), ['joined', []]);
  // A stranger sees that Bola is connected, not where.
  const eve = await f.device('Eve');
  const card = (await get(f, `/api/social/players/${bola.id}`, eve)).player;
  assert.deepEqual([card.status, card.venue, card.friend], ['online', undefined, false]);

  b.ws.close();
  await eventually(async () => (await status(ada))[0] === 'reconnecting');
  assert.equal((await until(a, 'people-presence')).status, 'reconnecting');
  f.advance(RECONNECT_GRACE_MS + 1);
  assert.deepEqual(await status(ada), ['offline', undefined]);
});

test('who-is-here carries each player’s server-held look, and a watching socket is nudged when the room changes', async t => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  // Bola's life is a created character: the look is whatever the server stored through onboarding.
  const look = { body: 'woman', hair: 'afro', outfit: 'owambe', fabric: 'ankara', skin: 'skin-2', hairColor: 'auburn', outfitColor: 'gold', bottomsColor: 'teal' };
  assert.equal((await f.action(bola.cookie, { type: 'onboarding.look', payload: { look } })).code, 'look_saved');
  const a = await f.joinRoom(ada);
  const watcher = await f.socket(ada); // a second socket of Ada's that is in no room, as the browser's social socket is
  const b = await f.socket(bola);
  // A client cannot supply a look: whatever the join message carries is ignored.
  b.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park', look: { body: '<img>', hair: 'x'.repeat(5000) }, name: 'Mallory' }));
  const joined = await until(b, 'presence');
  assert.deepEqual(Object.keys(joined.members[0]).sort(), ['enabled', 'id', 'muted', 'name', 'position'], 'the room presence message itself is unchanged');
  watcher.ws.send(JSON.stringify({ type: 'people-list', cityId: 'lagos' }));
  const listing = await until(watcher, 'people');
  assert.deepEqual(listing.players.map((player) => [player.id, player.name, player.here]), [[bola.id, 'Bola', true]]);
  assert.deepEqual(listing.players[0].look, look);
  assert.deepEqual(Object.keys(listing.players[0]).sort(), ['friend', 'here', 'id', 'incoming', 'look', 'name', 'requested']);
  assert.deepEqual((await get(f, '/api/social/people?city=lagos', bola)).players[0].look, DEFAULT_LOOK, 'Ada never created a character: she has the default look');
  // Bola leaves for the Library: Ada's watching socket is nudged — with no member data — and re-reads.
  await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' });
  assert.deepEqual(await until(watcher, 'people-changed'), { type: 'people-changed', cityId: 'lagos', venueId: 'park' });
  assert.deepEqual((await get(f, '/api/social/people?city=lagos', ada)).players, []);
  // A socket that never asked is not sent anything: the room socket only sees the room's own messages.
  const quiet = await f.socket(ada);
  f.advance(20000);
  b.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  assert.equal((await b.next()).code, 'venue_mismatch');
  b.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'library' })); await until(b, 'presence');
  quiet.ws.send(JSON.stringify({ type: 'dm-read', conv: 'dm.x' }));
  assert.equal((await quiet.next()).type, 'error', 'the first thing the quiet socket hears is the answer to its own message');
  const seen = JSON.stringify([listing, joined]);
  assert.ok(!seen.includes(ada.cookie.slice(4)) && !seen.includes(bola.cookie.slice(4)));
  a.ws.close();
});

test('house invite: knock needs the host at home, is accepted exactly once, caps at five guests, and expires', async t => {
  const f = await fixture(t);
  const [host, guest, ...others] = await people(f, ['Host', 'Guest', 'Gst2', 'Gst3', 'Gst4', 'Gst5', 'Gst6']);
  const knock = (who) => post(f, '/api/social/house/knock', { host: host.id, cityId: 'lagos' }, who);
  assert.equal((await knock(host)).code, 'self');
  let refused = await knock(guest);
  assert.equal(refused.code, 'host_offline'); assert.match(refused.reason, /Host is offline/);
  const atPark = await f.joinRoom(host);
  refused = await knock(guest);
  assert.equal(refused.code, 'host_not_home'); assert.match(refused.reason, /online but not at home/);
  atPark.ws.close();
  await eventually(async () => (await knock(guest)).code === 'host_reconnecting');

  const h = await goHome(f, host);
  const g = await f.socket(guest);
  const knocking = await knock(guest);
  assert.equal(knocking.code, 'knocking'); assert.equal(knocking.expiresAt, knocking.serverTime + LIMITS.knockMs);
  assert.deepEqual((await until(h, 'invite-knock')).from, { id: guest.id, name: 'Guest' });
  assert.equal((await knock(guest)).duplicate, true, 'a second knock while waiting does not ring twice');
  assert.deepEqual((await get(f, '/api/social/me', host)).house.knocks.map((item) => item.from.id), [guest.id]);

  // Let them in — twice, as a double-tap or a retry would. One guest, one outcome.
  const answer = () => post(f, '/api/social/house/answer', { visitor: guest.id, answer: 'accept' }, host);
  const [first, second] = await Promise.all([answer(), answer()]);
  assert.deepEqual([first.code, second.code], ['accepted', 'accepted']); assert.equal(Boolean(first.duplicate) !== Boolean(second.duplicate), true);
  assert.equal((await post(f, '/api/social/house/answer', { visitor: guest.id, answer: 'decline' }, host)).code, 'already_answered');
  const told = await until(g, 'invite-answer');
  assert.equal(told.answer, 'accepted'); assert.equal(told.house.role, 'guest');
  // Both sides read the same state.
  const hostSide = (await get(f, `/api/social/house/${host.id}`, host)).house, guestSide = (await get(f, `/api/social/house/${host.id}`, guest)).house;
  assert.deepEqual(hostSide.guests, guestSide.guests); assert.deepEqual(hostSide.guests.map((item) => item.id), [guest.id]);
  assert.deepEqual([hostSide.role, guestSide.role, hostSide.hostStatus, guestSide.conv], ['host', 'guest', 'home', `h.${host.id}`]);
  assert.equal((await get(f, '/api/social/me', guest)).visiting.host.id, host.id);
  assert.deepEqual((await get(f, '/api/social/people?city=lagos', host)).players.map((player) => player.id), [guest.id]);
  assert.equal((await knock(guest)).code, 'inside');
  // House chat reaches exactly the people inside.
  const said = await post(f, '/api/social/messages', { conv: `h.${host.id}`, body: 'Welcome!', clientId: f.id() }, host);
  assert.equal(said.code, 'sent'); assert.equal((await until(g, 'dm')).conv.kind, 'house');
  assert.equal((await post(f, '/api/social/messages', { conv: `h.${host.id}`, body: 'let me in', clientId: f.id() }, others[0])).code, 'not_a_member');

  // Not now → cooldown; then fill the house.
  await knock(others[0]);
  assert.equal((await post(f, '/api/social/house/answer', { visitor: others[0].id, answer: 'decline' }, host)).code, 'declined');
  assert.equal((await knock(others[0])).code, 'knock_cooldown');
  f.advance(LIMITS.knockCooldownMs + 1000);
  for (const other of others.slice(0, 4)) { assert.equal((await knock(other)).code, 'knocking'); assert.equal((await post(f, '/api/social/house/answer', { visitor: other.id, answer: 'accept' }, host)).code, 'accepted'); }
  assert.equal((await get(f, `/api/social/house/${host.id}`, host)).house.guests.length, 5);
  const full = await knock(others[4]);
  assert.equal(full.code, 'house_full'); assert.match(full.reason, /5 guests/);
  // A guest leaves; the host removes one; a knock nobody answers expires.
  assert.equal((await post(f, '/api/social/house/leave', { host: host.id }, guest)).code, 'left');
  assert.equal((await post(f, '/api/social/house/leave', { host: host.id, guest: others[1].id }, others[0])).code, 'host_only');
  assert.equal((await post(f, '/api/social/house/leave', { host: host.id, guest: others[1].id }, host)).code, 'left');
  assert.equal((await get(f, '/api/social/me', guest)).visiting, null);
  assert.equal((await get(f, `/api/social/conversations/h.${host.id}`, guest)).code, 'not_a_member');
  assert.equal((await knock(others[4])).code, 'knocking');
  f.advance(LIMITS.knockMs + 1);
  assert.equal((await post(f, '/api/social/house/answer', { visitor: others[4].id, answer: 'accept' }, host)).code, 'knock_expired');
  // Visits end on their own.
  f.advance(LIMITS.visitMs);
  const later = (await get(f, `/api/social/house/${host.id}`, host)).house;
  assert.deepEqual([later.guests, later.conv], [[], null]);
  g.ws.send(JSON.stringify({ type: 'invite-knock', host: host.id, cityId: 'lagos' }));
  assert.equal((await until(g, 'invite-result')).code, 'knocking');
  h.ws.send(JSON.stringify({ type: 'invite-answer', visitor: guest.id, answer: 'accept' }));
  assert.equal((await until(h, 'invite-result')).code, 'accepted');
});

test('groups: friends only, capped, owner manages members, leaving hands over or deletes', async t => {
  const f = await fixture(t);
  const [ada, bola, chi, dayo] = await people(f, ['Ada', 'Bola', 'Chidi', 'Dayo']);
  await befriend(f, ada, bola); await befriend(f, ada, chi);
  const create = f.id();
  assert.equal((await post(f, '/api/social/groups', { name: 'Owambe', members: [bola.id, dayo.id], clientId: f.id() }, ada)).code, 'friends_only');
  const made = await post(f, '/api/social/groups', { name: ' Owambe crew ', members: [bola.id], clientId: create }, ada);
  assert.equal(made.code, 'created'); assert.equal(made.conv.name, 'Owambe crew'); assert.equal(made.conv.members.length, 2);
  assert.equal((await post(f, '/api/social/groups', { name: 'Owambe crew', members: [bola.id], clientId: create }, ada)).duplicate, true);
  const gid = made.conv.id;
  assert.equal((await get(f, '/api/social/me', bola)).updates[0].kind, 'group-added');
  assert.equal((await post(f, '/api/social/messages', { conv: gid, body: 'Who is bringing jollof?', clientId: f.id() }, bola)).code, 'sent');
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'rename', name: 'Takeover' }, bola)).code, 'owner_only');
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'rename', name: 'Owambe 2026' }, ada)).conv.name, 'Owambe 2026');
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'add', id: dayo.id }, ada)).code, 'friends_only');
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'add', id: chi.id }, ada)).conv.members.length, 3);
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'remove', id: chi.id }, ada)).conv.members.length, 2);
  assert.equal((await post(f, '/api/social/messages', { conv: gid, body: 'still here?', clientId: f.id() }, chi)).code, 'not_a_member');
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'explode' }, ada)).status, 400);
  assert.equal((await post(f, '/api/social/groups', { name: 'Big', members: Array.from({ length: LIMITS.groupSize }, () => randomUUID()), clientId: f.id() }, ada)).code, 'group_full');
  assert.equal((await post(f, '/api/social/groups', { name: 'x'.repeat(33), members: [], clientId: f.id() }, ada)).status, 400);
  assert.equal((await post(f, `/api/social/groups/${gid}`, { op: 'leave' }, ada)).code, 'left');
  const left = (await get(f, '/api/social/conversations', bola)).conversations.find((conv) => conv.id === gid);
  assert.equal(left.owner, bola.id); assert.equal(left.last.body, 'Ada left.');
  await post(f, `/api/social/groups/${gid}`, { op: 'leave' }, bola);
  assert.equal((await database(f)).social.convs[gid], undefined);
});

test('transfers: friends only, aged accounts, earned money, atomic, in both ledgers, idempotent', async t => {
  const f = await fixture(t);
  const [ada, bola, chi] = await people(f, ['Ada', 'Bola', 'Chi']);
  const send = (body, who = ada) => post(f, '/api/social/transfers', { to: bola.id, amount: 500, cityId: 'lagos', clientId: f.id(), ...body }, who);
  let refused = await send();
  assert.equal(refused.code, 'friends_only'); assert.match(refused.reason, /Add Bola as a friend first/);
  await befriend(f, ada, bola); await befriend(f, ada, chi);
  refused = await send();
  assert.equal(refused.code, 'account_too_new'); assert.match(refused.reason, /24 hours/);
  const earned = await earn(f, ada);
  assert.equal(earned.cash, 8000); assert.equal(earned.social.earned, 3000);
  f.advance(24 * HOUR);
  for (const amount of [0, -5, 2.5, '500', null, 1e21]) assert.equal((await send({ amount })).status, 400, String(amount));
  assert.equal((await send({ amount: 50 })).code, 'amount_too_small');
  assert.equal((await send({ amount: 5001 })).code, 'amount_too_large');
  assert.equal((await send({ cityId: 'atlantis' })).status, 400);

  // Bola is offline: the debit and the stored credit commit together; he is paid on his next request.
  const id = f.id();
  const sent = await send({ clientId: id });
  assert.deepEqual([sent.code, sent.amount, sent.credited, sent.balance], ['sent', 500, false, 7500]);
  const db = await database(f);
  assert.equal(db.social.pending[bola.id][0].payload.amount, 500);
  const replay = await send({ clientId: id });
  assert.deepEqual([replay.code, replay.duplicate, replay.balance], ['sent', true, 7500]);
  assert.equal((await send({ clientId: id, amount: 600 })).status, 409);
  const adaLife = (await get(f, '/api/life?city=lagos', ada)).state;
  assert.equal(adaLife.cash, 7500); assert.deepEqual([adaLife.ledger.at(-1).amount, adaLife.ledger.at(-1).reason], [-500, 'Transfer to Bola']);
  await get(f, '/api/social/me', bola); await get(f, '/api/social/me', bola);
  let bolaLife = (await get(f, '/api/life?city=lagos', bola)).state;
  assert.equal(bolaLife.cash, 5500, 'credited exactly once');
  assert.deepEqual([bolaLife.ledger.at(-1).amount, bolaLife.ledger.at(-1).reason], [500, 'Transfer from Ada']);
  assert.equal((await database(f)).social.pending[bola.id], undefined);
  // Bola is online: credited in the same transaction.
  f.advance(61000);
  const b = await f.socket(bola);
  const live = await send({ amount: 400 });
  assert.equal(live.credited, true);
  assert.deepEqual([(await until(b, 'transfer')).amount, (await get(f, '/api/life?city=lagos', bola)).state.cash], [400, 5900]);
  // Only earned money can be given, and only three gifts a day.
  refused = await send({ amount: 2200 });
  assert.equal(refused.code, 'gift_exceeds_earned'); assert.match(refused.reason, /You can still give ₦2,100/);
  assert.equal((await send({ amount: 100 })).code, 'sent');
  assert.equal((await send({ amount: 100 })).code, 'daily_transfer_limit');
  // A gift cannot be passed straight on: it is not earnings.
  assert.equal((await post(f, '/api/social/transfers', { to: ada.id, amount: 500, cityId: 'lagos', clientId: f.id() }, bola)).code, 'earn_first');
  // Money is conserved: 3 lives × ₦5,000 + ₦3,000 earned.
  bolaLife = (await get(f, '/api/life?city=lagos', bola)).state;
  const total = (await get(f, '/api/life?city=lagos', ada)).state.cash + bolaLife.cash + (await get(f, '/api/life?city=lagos', chi)).state.cash;
  assert.equal(total, 18000);
  // The life action behind it cannot be called from the client.
  const direct = await f.action(bola.cookie, { type: 'social.server', payload: { op: 'transfer-in', from: ada.id, name: 'Ada', amount: 5000 } });
  assert.equal(direct.code, 'server_only'); assert.equal(direct.state.cash, bolaLife.cash);
});

test('player interactions need both players in the same venue room; Bae opens at closeness 40', async t => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  const act = (body = {}) => post(f, `/api/social/players/${bola.id}/interact`, { action: 'hello', cityId: 'lagos', clientId: f.id(), ...body }, ada);
  assert.equal((await act()).code, 'not_joined');
  const a = await f.joinRoom(ada);
  const away = await act();
  assert.equal(away.code, 'not_here'); assert.match(away.reason, /Bola is not at Freedom Park with you/);
  const b = await f.joinRoom(bola);
  const id = f.id();
  const hello = await act({ clientId: id });
  assert.equal(hello.code, 'interacted'); assert.equal(hello.closeness, 2);
  assert.deepEqual((await until(b, 'people-interaction')).from, { id: ada.id, name: 'Ada' });
  assert.equal((await act({ clientId: id })).duplicate, true);
  let life = (await get(f, '/api/life?city=lagos', ada)).state;
  assert.equal(life.needs.social, 60); assert.equal(life.social.rel[bola.id].p, 2); assert.equal(life.social.rel[bola.id].n, 1);
  assert.equal((await act({ action: 'steal' })).status, 400);
  for (let i = 0; i < 3; i++) await act({ action: 'gist' });
  assert.equal((await act()).code, 'daily_limit');
  await befriend(f, ada, bola);
  const early = await post(f, '/api/social/bae/ask', { id: bola.id, cityId: 'lagos' }, ada);
  assert.equal(early.code, 'closeness_required'); assert.match(early.reason, /11\/40/);
  a.ws.close();
});

test('nothing sent to another player contains a secret, and hostile ids cannot reach object internals', async t => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  await befriend(f, ada, bola);
  const b = await f.socket(bola);
  await post(f, '/api/social/messages', { to: bola.id, body: '<img src=x onerror=alert(1)>', clientId: f.id() }, ada);
  const pushed = await until(b, 'dm');
  assert.equal(pushed.message.body, '<img src=x onerror=alert(1)>', 'stored as text; the client escapes on render');
  const seen = JSON.stringify([pushed, await get(f, '/api/social/me', bola), await get(f, `/api/social/players/${ada.id}`, bola), await get(f, '/api/social/people?city=lagos', bola)]);
  assert.ok(!seen.includes(ada.cookie.slice(4)) && !seen.includes(bola.cookie.slice(4)));
  for (const id of ['__proto__', 'constructor', 'toString']) {
    assert.equal((await get(f, `/api/social/players/${id}`, ada)).status, 400);
    assert.equal((await get(f, `/api/social/conversations/${id}`, ada)).status, 400);
    assert.equal((await post(f, '/api/social/block', { id, cityId: 'lagos' }, ada)).status, 400);
    assert.equal((await post(f, `/api/social/groups/${id}`, { op: 'leave' }, ada)).status, 400);
  }
  assert.equal((await get(f, '/api/social/people?city=__proto__', ada)).status, 400);
});

test('Bae: asked once closeness reaches 40, accepted once, both lives agree, either can end it', async t => {
  const f = await fixture(t);
  const [ada, bola, chi] = await people(f, ['Ada', 'Bola', 'Chi']);
  await befriend(f, ada, bola); await befriend(f, chi, bola);
  await f.joinRoom(ada); await f.joinRoom(bola);
  for (let day = 0; day < 4; day++) {
    for (let i = 0; i < 4; i++) assert.equal((await post(f, `/api/social/players/${bola.id}/interact`, { action: 'gist', cityId: 'lagos', clientId: f.id() }, ada)).code, 'interacted');
    f.advance(24 * HOUR);
  }
  assert.equal((await post(f, '/api/social/bae/ask', { id: chi.id, cityId: 'lagos' }, ada)).code, 'friends_only');
  assert.equal((await post(f, '/api/social/bae/ask', { id: bola.id, cityId: 'lagos' }, ada)).code, 'asked');
  assert.equal((await post(f, '/api/social/bae/ask', { id: bola.id, cityId: 'lagos' }, ada)).duplicate, true);
  assert.deepEqual((await get(f, '/api/social/me', bola)).baeRequests.map((item) => item.id), [ada.id]);
  assert.equal((await post(f, '/api/social/bae/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola)).code, 'accepted');
  assert.equal((await post(f, '/api/social/bae/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola)).duplicate, true);
  assert.equal((await get(f, '/api/social/me', ada)).bae.id, bola.id);
  assert.equal((await get(f, '/api/life?city=lagos', ada)).state.social.bae, bola.id);
  assert.equal((await get(f, '/api/life?city=lagos', bola)).state.social.bae, ada.id);
  assert.equal((await post(f, '/api/social/bae/end', { cityId: 'lagos' }, bola)).code, 'ended');
  assert.equal((await get(f, '/api/social/me', ada)).bae, null);
  assert.equal((await get(f, '/api/life?city=lagos', ada)).state.social.bae, null);
});

test('a gift nobody collects goes back to the sender after a week; nothing is lost or doubled', async t => {
  const f = await fixture(t);
  const [ada, bola] = await people(f, ['Ada', 'Bola']);
  await befriend(f, ada, bola);
  await earn(f, ada);
  f.advance(24 * HOUR);
  assert.equal((await post(f, '/api/social/transfers', { to: bola.id, amount: 700, cityId: 'lagos', clientId: f.id() }, ada)).credited, false);
  assert.equal((await get(f, '/api/life?city=lagos', ada)).state.cash, 7300);
  f.advance(LIMITS.escrowMs + HOUR);
  await get(f, '/api/social/me', ada); await get(f, '/api/social/me', ada);
  const life = (await get(f, '/api/life?city=lagos', ada)).state;
  assert.equal(life.cash, 8000); assert.equal(life.ledger.at(-1).reason, 'Refund: transfer to Bola');
  await get(f, '/api/social/me', bola);
  assert.equal((await get(f, '/api/life?city=lagos', bola)).state.cash, 5000);
  assert.deepEqual((await database(f)).social.pending, {});
});
