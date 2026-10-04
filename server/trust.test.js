// Trust pass: the operator surface, the text filter, mutes, blocks in public rooms, problem
// reports, the wallet statement, presence freshness, the heartbeat guest sweep, the vote cap and
// the storage behaviour of polls. Everything runs against the real server through the shared fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fixture } from './test-fixture.js';
import { createServer } from './server.js';
import { presenceOf } from './social/presence.js';
import { isSharedAddress } from './protocol.js';
import { statementOf } from '../src/game/systems/wallet.js';
import { createLife } from '../src/life.js';

const TOKEN = 'operator-token-for-tests-0123456789';
const DAY = 86400000, HOUR = 3600000;
const MONDAY = 4 * DAY - HOUR; // the Monday after the fixture's start (a Thursday, 01:01 Lagos time), 00:00 Lagos time

/** Stop a second server started by a test: its sockets first, or close() would wait for them for ever. */
async function stop(server) {
  for (const ws of server.wss.clients) ws.terminate();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await server.store.close().catch(() => {});
}

async function harness(t, options = {}) {
  const f = await fixture(t, { moderatorToken: TOKEN, ...options });
  const json = async (res) => ({ status: res.status, ...(await res.json()) });
  const get = async (path, device) => json(await f.request(path, null, device?.cookie));
  const post = async (path, body, device) => json(await f.request(path, body, device?.cookie));
  const mod = async (path, body, headers = { Authorization: `Bearer ${TOKEN}` }) => json(await fetch(f.base + path, { method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }));
  const database = async () => { await f.flush(); return JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')); };
  const clientId = () => `c-${randomUUID()}`;
  /** Drain a socket until a message of `type` arrives. */
  const until = async (peer, type) => { for (let i = 0; i < 50; i++) { const message = await peer.next(); if (message.type === type) return message; } throw Error(`no ${type}`); };
  /** Resolve true if no message of `type` arrives shortly (a later marker message proves delivery order). */
  const register = async (...devices) => { for (const device of devices) assert.equal((await get('/api/social/me', device)).ok, true); };
  return { f, get, post, mod, database, clientId, until, register };
}

test('operator routes: off without a token; with one, only a bearer header opens them', async (t) => {
  const off = await fixture(t);
  assert.equal((await fetch(`${off.base}/api/mod/overview`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404, 'no MODERATOR_TOKEN: the routes do not exist');
  const short = await fixture(t, { moderatorToken: 'too-short' });
  assert.equal((await fetch(`${short.base}/api/mod/overview`, { headers: { Authorization: 'Bearer too-short' } })).status, 404, 'a token under 24 characters does not enable anything');
  const spaced = await fixture(t, { moderatorToken: 'a token with spaces in it 0123456789' });
  assert.equal((await fetch(`${spaced.base}/api/mod/overview`, { headers: { Authorization: 'Bearer a token with spaces in it 0123456789' } })).status, 404, 'nor does one a Bearer header cannot carry');

  const { f, mod, database } = await harness(t);
  const ada = await f.device('Ada');
  assert.deepEqual(await mod('/api/mod/overview', null, {}), { status: 401, error: 'moderator_token_required' });
  assert.equal((await mod('/api/mod/overview', null, { Cookie: ada.cookie })).status, 401, 'a device session is not an operator');
  assert.equal((await mod(`/api/mod/overview?token=${TOKEN}`, null, {})).status, 401, 'the token is never read from the URL');
  assert.equal((await mod('/api/mod/overview', null, { Authorization: TOKEN })).status, 401, 'the Bearer scheme is required');
  assert.equal((await mod('/api/mod/overview', null, { Authorization: `Bearer ${TOKEN}x` })).status, 401);
  assert.equal((await mod('/api/mod/overview', null, { Authorization: `Bearer ${TOKEN.slice(0, -1)}` })).status, 401);
  assert.equal((await mod('/api/mod/mutes', { id: ada.id, minutes: 5, reason: '' }, { Cookie: ada.cookie })).status, 401, 'nor can a player act');
  const overview = await mod('/api/mod/overview');
  assert.equal(overview.status, 200); assert.equal(overview.sessions, 1); assert.deepEqual(overview.reports, { total: 0, open: 0 }); assert.equal(typeof overview.store.writes, 'number');
  // Not tied to an origin (curl has none; a foreign Origin with the right header still works), but nothing is exposed to other origins.
  const foreign = await fetch(`${f.base}/api/mod/overview`, { headers: { Authorization: `Bearer ${TOKEN}`, Origin: 'https://ops.example' } });
  assert.equal(foreign.status, 200); assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(`${f.base}/api/life?city=lagos`, { headers: { Cookie: ada.cookie, Origin: 'https://ops.example' } })).status, 403, 'player routes keep the origin check');
  assert.equal((await mod('/api/mod/nothing')).status, 404);
  // Wrong tokens are counted per address: after ten the address is refused for the rest of the window, right token or not... for wrong ones.
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await mod('/api/mod/overview', null, { Authorization: 'Bearer wrong-wrong-wrong-wrong-wrong' })).status;
  assert.equal(last, 429, 'guessing is rate limited');
  assert.equal((await mod('/api/mod/overview')).status, 200, 'the real operator is not locked out by someone else’s failures');
  const stored = JSON.stringify(await database());
  assert.ok(!stored.includes(TOKEN), 'the token is never written to the data file');
  assert.ok(!JSON.stringify(overview).includes(TOKEN));
});

test('text filter: refused with a reason, never altered — names, venue chat, messages, group names', async (t) => {
  const { f, get, post, clientId, until, register } = await harness(t);
  for (const [name, code] of [['faggot', 'name_not_allowed'], ['call 08012345678', 'name_not_allowed'], ['see spam.com', 'name_not_allowed']]) {
    const refused = await post('/api/session', { name });
    assert.deepEqual([refused.status, refused.error], [400, code]); assert.match(refused.reason, /^That name /);
  }
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  const renamed = await f.request('/api/session', { name: 'retard' }, ada.cookie);
  assert.equal(renamed.status, 400); assert.equal((await get('/api/session', ada)).session.name, 'Ada', 'a refused rename changes nothing');
  await register(ada, bola);
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola); await until(a, 'presence');
  // Venue chat: the sender gets an error with a reason and the client id; nobody receives the line.
  a.ws.send(JSON.stringify({ type: 'chat', body: 'you should kill yourself', clientId: 'bad-1' }));
  const refused = await until(a, 'error');
  assert.deepEqual([refused.code, refused.clientId], ['text_blocked', 'bad-1']); assert.match(refused.reason, /^Your message was not accepted because/);
  a.ws.send(JSON.stringify({ type: 'chat', body: 'How far? Niger State next week', clientId: 'ok-1' }));
  assert.equal((await until(b, 'chat')).body, 'How far? Niger State next week', 'the first chat line Bola receives is the clean one, unaltered');
  // Messages and group names.
  const dm = await post('/api/social/messages', { to: bola.id, body: 'k y s', clientId: clientId() }, ada);
  assert.deepEqual([dm.status, dm.ok, dm.code], [200, false, 'text_blocked']); assert.match(dm.reason, /Nothing was sent or saved/);
  assert.equal((await get('/api/social/conversations', bola)).conversations.length, 0, 'nothing reached Bola');
  const link = await post('/api/social/messages', { to: bola.id, body: 'my site is example.org, plain text only', clientId: clientId() }, ada);
  assert.equal(link.code, 'sent', 'a private message may mention an address as plain text');
  // Friends, so a group can be made.
  await post('/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada); await post('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola);
  for (const [name, code] of [['WhatsApp: 08012345678', 'contact_not_allowed'], ['join at spam.com', 'links_not_allowed'], ['the retards', 'text_blocked']]) {
    assert.equal((await post('/api/social/groups', { name, members: [bola.id], clientId: clientId() }, ada)).code, code, name);
  }
  const group = await post('/api/social/groups', { name: 'Owambe crew', members: [bola.id], clientId: clientId() }, ada);
  assert.equal(group.code, 'created');
  assert.equal((await post(`/api/social/groups/${group.conv.id}`, { op: 'rename', name: 'ring 0801 234 5678' }, ada)).code, 'contact_not_allowed');
  assert.equal((await get(`/api/social/conversations/${group.conv.id}`, bola)).conv.name, 'Owambe crew');
});

test('reports reach an operator; a mute silences text everywhere and leaves the life untouched', async (t) => {
  const { f, get, post, mod, database, clientId, until, register } = await harness(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  await register(ada, bola);
  assert.equal((await post('/api/social/messages', { to: ada.id, body: 'buy my gold now', clientId: clientId() }, bola)).code, 'sent');
  const filed = await post('/api/social/reports', { id: bola.id, reason: 'spam', text: 'Keeps selling gold' }, ada);
  assert.equal(filed.code, 'reported');
  const listed = await mod('/api/mod/reports');
  assert.equal(listed.reports.length, 1);
  assert.deepEqual([listed.reports[0].id, listed.reports[0].by, listed.reports[0].byName, listed.reports[0].about, listed.reports[0].reason, listed.reports[0].text, listed.reports[0].evidence],
    [filed.receipt.id, ada.id, 'Ada', bola.id, 'spam', 'Keeps selling gold', ['buy my gold now']]);
  for (const [body, error] of [[{ id: 'x', minutes: 5 }, 'invalid_player'], [{ id: bola.id, minutes: 0 }, 'invalid_minutes'], [{ id: bola.id, minutes: 5, reason: 'a'.repeat(201) }, 'invalid_note'], [{ id: bola.id, minutes: 5, report: '../x' }, 'invalid_report']]) {
    assert.deepEqual(await mod('/api/mod/mutes', body), { status: 400, error });
  }
  const before = await get('/api/life?city=lagos', bola);
  const live = await f.socket(bola);
  const muted = await mod('/api/mod/mutes', { id: bola.id, minutes: 30, reason: 'Spam in messages', report: filed.receipt.id });
  assert.deepEqual([muted.status, muted.code, muted.mute.id, muted.mute.until], [200, 'muted', bola.id, f.now() + 30 * 60000]);
  assert.match((await until(live, 'social-update')).update.text, /^A moderator has muted you for 30 minutes: Spam in messages\. You can keep playing/);
  // The reporter sees the outcome on their own receipt.
  const mine = await get('/api/social/me', ada);
  assert.equal(mine.reports[0].status, 'actioned'); assert.ok(mine.updates.some((update) => /a moderator acted on it/.test(update.text)));
  // Everything that posts text is refused, with the reason and the time it ends.
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola); await until(a, 'presence');
  b.ws.send(JSON.stringify({ type: 'chat', body: 'hello', clientId: 'm-1' }));
  const chat = await until(b, 'error');
  assert.deepEqual([chat.code, chat.clientId], ['muted', 'm-1']); assert.match(chat.reason, /A moderator has muted you until .* UTC \(Spam in messages\)\. You can keep playing/);
  const dm = await post('/api/social/messages', { to: ada.id, body: 'hello', clientId: clientId() }, bola);
  assert.deepEqual([dm.ok, dm.code], [false, 'muted']);
  const ad = await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-01', text: 'Gold here', colour: 'gold', icon: 'star' }, bola);
  assert.deepEqual([ad.ok, ad.code, ad.state.cash], [false, 'muted', before.state.cash], 'a refused ad charges nothing');
  assert.equal((await post('/api/social/groups', { name: 'Gold club', members: [], clientId: clientId() }, bola)).code, 'muted');
  const rename = await post('/api/session', { name: 'Gold Seller' }, bola);
  assert.deepEqual([rename.status, rename.error], [403, 'muted']); assert.match(rename.reason, /A moderator has muted you until/);
  assert.equal((await post('/api/session', { name: 'Bola' }, bola)).status, 200, 'keeping the same name still renews the session');
  // …and nothing else changed: same session, same life, still playable, still able to read and to ask for help.
  const after = await get('/api/life?city=lagos', bola);
  assert.equal(after.status, 200); assert.equal(after.state.cash, before.state.cash); assert.deepEqual(after.state.ledger, before.state.ledger);
  assert.equal((await f.action(bola.cookie, { type: 'spot', payload: { id: 'trees' } })).ok, true, 'a muted player can still play');
  assert.equal((await post('/api/social/messages', { to: bola.id, body: 'are you there?', clientId: clientId() }, ada)).code, 'sent', 'and still receives messages');
  assert.equal((await post('/api/support/reports', { cityId: 'lagos', category: 'other', text: 'I think this mute is a mistake' }, bola)).code, 'filed', 'and can still report a problem');
  let db = await database();
  assert.ok(db.sessions[bola.cookie.slice(4)], 'the session is still there'); assert.equal(db.archivedLives, undefined, 'nothing was archived or deleted');
  assert.deepEqual((await mod('/api/mod/mutes')).mutes.map((mute) => [mute.id, mute.reason, mute.report]), [[bola.id, 'Spam in messages', filed.receipt.id]]);
  // A restart keeps the mute (it is stored, and loaded before the server takes requests).
  const again = await createServer({ dataDir: f.dir, now: f.now, moderatorToken: TOKEN, distDir: join(f.dir, 'none') });
  again.listen(0, '127.0.0.1'); await once(again, 'listening');
  t.after(() => stop(again));
  const restarted = await (await fetch(`http://127.0.0.1:${again.address().port}/api/social/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: bola.cookie }, body: JSON.stringify({ to: ada.id, body: 'hi', clientId: clientId() }) })).json();
  assert.equal(restarted.code, 'muted');
  // It ends by itself, or when lifted.
  assert.equal((await mod(`/api/mod/mutes/${bola.id}/lift`, {})).code, 'lifted');
  assert.equal((await post('/api/social/messages', { to: ada.id, body: 'sorry about that', clientId: clientId() }, bola)).code, 'sent');
  await mod('/api/mod/mutes', { id: bola.id, minutes: 1, reason: '' });
  assert.equal((await post('/api/social/messages', { to: ada.id, body: 'x', clientId: clientId() }, bola)).code, 'muted');
  f.advance(61000);
  assert.equal((await post('/api/social/messages', { to: ada.id, body: 'time served', clientId: clientId() }, bola)).code, 'sent');
  // Dismissing a report, and the audit trail of everything above.
  const second = await post('/api/social/reports', { id: bola.id, reason: 'other', text: '' }, ada);
  assert.equal((await mod(`/api/mod/reports/${second.receipt.id}/dismiss`, { note: 'Not against the rules' })).code, 'dismissed');
  assert.equal((await mod('/api/mod/reports/R-999/dismiss', {})).status, 404);
  assert.equal((await get('/api/social/me', ada)).reports[0].status, 'dismissed');
  assert.deepEqual((await mod('/api/mod/reports?status=all')).reports.map((report) => report.status), ['dismissed', 'actioned']);
  const audit = (await mod('/api/mod/audit')).audit;
  assert.deepEqual(audit.map((line) => line.action), ['report-dismiss', 'mute', 'unmute', 'mute']);
  assert.ok(audit.every((line) => line.at > 0 && line.n > 0 && typeof line.from === 'string'));
  db = await database();
  assert.ok(!JSON.stringify([db.moderation, db.support]).includes(bola.cookie.slice(4)), 'moderation and support data never hold a session secret');
});

test('operator can remove an ad and see live content; the owner is told and not refunded', async (t) => {
  const { f, get, post, mod, register } = await harness(t);
  const ada = await f.device('Ada');
  await register(ada);
  const rented = await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-03', text: 'Suya at the junction', colour: 'red', icon: 'food' }, ada);
  assert.equal(rented.code, 'rented'); assert.equal(rented.state.cash, 3500);
  const content = await mod('/api/mod/content?city=lagos');
  assert.deepEqual(content.ads.map((ad) => [ad.kind, ad.slot, ad.text, ad.by.id]), [['billboard', 'bb-03', 'Suya at the junction', ada.id]]);
  assert.equal((await mod('/api/mod/content?city=atlantis')).error, 'invalid_city');
  for (const [body, status] of [[{ cityId: 'lagos', kind: 'billboard', slot: 'bb-04' }, 404], [{ cityId: 'lagos', kind: 'poster', slot: 'bb-03' }, 400], [{ cityId: 'lagos', kind: 'radio', venue: '__proto__', id: 'r1' }, 404], [{ cityId: 'lagos', kind: 'announcement', id: 'a1' }, 404]]) {
    assert.equal((await mod('/api/mod/content/remove', body)).status, status, JSON.stringify(body));
  }
  const removed = await mod('/api/mod/content/remove', { cityId: 'lagos', kind: 'billboard', slot: 'bb-03', reason: 'Misleading' });
  assert.deepEqual([removed.code, removed.removed.text], ['removed', 'Suya at the junction']);
  assert.equal((await get('/api/civic/ads?city=lagos', ada)).billboards.slots.find((slot) => slot.slot === 'bb-03').ad, null);
  assert.equal((await get('/api/life?city=lagos', ada)).state.cash, 3500, 'no refund');
  assert.ok((await get('/api/social/me', ada)).updates.some((update) => update.text === 'A moderator removed your billboard ad “Suya at the junction”: Misleading. What you paid for it is not refunded.'));
  assert.deepEqual((await mod('/api/mod/audit')).audit.map((line) => [line.action, line.target]), [['remove-billboard', 'lagos:bb-03']]);
});

test('a blocked player is not seen, heard or signalled in a public venue — per recipient, and only for the two of them', async (t) => {
  const { f, get, post, until, register } = await harness(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola'), chidi = await f.device('Chidi');
  await register(ada, bola, chidi);
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola), c = await f.joinRoom(chidi);
  const names = (message) => message.members.map((member) => member.name).sort();
  assert.deepEqual(names(await until(a, 'presence')), ['Ada', 'Bola'], 'before any block everyone is listed');
  assert.equal((await post('/api/social/block', { id: bola.id, cityId: 'lagos' }, ada)).code, 'blocked');
  // Presence is re-sent at once, each list built for its recipient.
  const seen = async (peer) => { let last; for (let i = 0; i < 20; i++) { const message = await peer.next(); if (message.type === 'presence') { last = names(message); if (last.length < 3 || peer === c) return last; } } return last; };
  assert.deepEqual(await seen(a), ['Ada', 'Chidi'], 'the blocker does not see the blocked player');
  assert.deepEqual(await seen(b), ['Bola', 'Chidi'], 'and the blocked player does not see the blocker');
  assert.deepEqual(await seen(c), ['Ada', 'Bola', 'Chidi'], 'everyone else sees both');
  assert.deepEqual((await get('/api/social/people?city=lagos', ada)).players.map((player) => player.name), ['Chidi']);
  assert.deepEqual((await get('/api/social/people?city=lagos', bola)).players.map((player) => player.name), ['Chidi']);
  // Movement: a move by one of the pair sends the other NO frame at all (not even an unchanged list),
  // so the first presence Bola receives next is the one caused by Chidi's move.
  a.ws.send(JSON.stringify({ type: 'move', x: 5, z: 5 }));
  let adaMoved; for (let i = 0; i < 20 && !adaMoved; i++) { const message = await c.next(); if (message.type === 'presence') adaMoved = message.members.find((member) => member.name === 'Ada').position; }
  assert.deepEqual(adaMoved, { x: 5, z: 5 }, 'Chidi saw Ada move');
  c.ws.send(JSON.stringify({ type: 'move', x: 3, z: 0 }));
  const next = await until(b, 'presence');
  assert.deepEqual(next.members.map((member) => [member.name, member.position.x]).sort(), [['Bola', 0], ['Chidi', 3]], 'Bola’s next frame is Chidi’s move: Ada’s produced nothing for him');
  // Chat: Bola's line reaches Chidi and Bola, never Ada. Chidi's next line proves Ada's socket got nothing in between.
  b.ws.send(JSON.stringify({ type: 'chat', body: 'from Bola', clientId: 'b-1' }));
  assert.equal((await until(c, 'chat')).body, 'from Bola'); assert.equal((await until(b, 'chat')).body, 'from Bola');
  c.ws.send(JSON.stringify({ type: 'chat', body: 'from Chidi', clientId: 'c-1' }));
  assert.equal((await until(a, 'chat')).body, 'from Chidi', 'the first chat line Ada receives is Chidi’s');
  // And the other way round.
  a.ws.send(JSON.stringify({ type: 'chat', body: 'from Ada', clientId: 'a-1' }));
  assert.equal((await until(c, 'chat')).body, 'from Chidi'); assert.equal((await until(c, 'chat')).body, 'from Ada');
  c.ws.send(JSON.stringify({ type: 'chat', body: 'again', clientId: 'c-2' }));
  assert.deepEqual([(await until(b, 'chat')).body, (await until(b, 'chat')).body], ['from Chidi', 'again'], 'Bola never received Ada’s line');
  // Voice signalling between the two is refused exactly like a peer who is not there.
  for (const [peer, to] of [[a, bola.id], [b, ada.id]]) {
    peer.ws.send(JSON.stringify({ type: 'signal', to, data: { sdp: 'offer' } }));
    assert.deepEqual([(await until(peer, 'error')).code], ['peer_not_in_room']);
  }
  a.ws.send(JSON.stringify({ type: 'signal', to: chidi.id, data: { sdp: 'offer' } }));
  assert.equal((await until(c, 'signal')).from, ada.id, 'signalling to anyone else still works');
  // Unblock: they see and hear each other again.
  assert.equal((await post('/api/social/unblock', { id: bola.id }, ada)).code, 'unblocked');
  b.ws.send(JSON.stringify({ type: 'chat', body: 'peace', clientId: 'b-2' }));
  let got; for (let i = 0; i < 20 && got !== 'peace'; i++) { const message = await a.next(); if (message.type === 'chat') got = message.body; }
  assert.equal(got, 'peace');
  // The block list is loaded at start-up, so a restart does not forget it.
  await post('/api/social/block', { id: bola.id, cityId: 'lagos' }, ada);
  const again = await createServer({ dataDir: f.dir, now: f.now, distDir: join(f.dir, 'none') });
  again.listen(0, '127.0.0.1'); await once(again, 'listening');
  t.after(() => stop(again));
  const { WebSocket } = await import('ws');
  const base = `http://127.0.0.1:${again.address().port}`;
  const open = async (device) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/socket`, { headers: { Cookie: device.cookie, Origin: base } });
    const queue = []; ws.on('message', (data) => queue.push(JSON.parse(data.toString())));
    await once(ws, 'open'); t.after(() => ws.terminate());
    ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
    return { ws, queue };
  };
  const a2 = await open(ada), b2 = await open(bola);
  await new Promise((done) => setTimeout(done, 150));
  assert.deepEqual(b2.queue.filter((message) => message.type === 'presence').at(-1).members.map((member) => member.name), ['Bola']);
  assert.deepEqual(a2.queue.filter((message) => message.type === 'presence').at(-1).members.map((member) => member.name), ['Ada']);
});

test('report a problem: a receipt with automatic context and a status the player can read later; no secret, rate limited', async (t) => {
  const { f, get, post, mod, database, clientId, register } = await harness(t, { buildId: 'test-build-7' });
  const ada = await f.device('Ada');
  await register(ada);
  assert.equal((await post('/api/support/reports', { cityId: 'lagos', category: 'money', text: 'x' })).status, 401, 'signed out: no report');
  for (const [body, error] of [[{ cityId: 'atlantis', category: 'money', text: 'abc' }, 'invalid_city'], [{ cityId: 'lagos', category: 'gossip', text: 'abc' }, 'invalid_category'],
    [{ cityId: 'lagos', category: 'money', text: 'ab' }, 'invalid_report_text'], [{ cityId: 'lagos', category: 'money', text: 'a'.repeat(601) }, 'invalid_report_text'], [{ cityId: 'lagos', category: 'money', text: 'abc', clientId: 'x' }, 'invalid_client_id']]) {
    assert.deepEqual(await post('/api/support/reports', body, ada), { status: 400, error });
  }
  // Some history: thirteen actions, the last of which is refused.
  await f.action(ada.cookie, { type: 'travel', payload: { id: 'library', mode: 'cab' } });
  f.advance(10000);
  for (let i = 0; i < 11; i++) { f.advance(1000); await f.action(ada.cookie, { type: 'spot', payload: { id: i % 2 ? 'bar' : 'lounge' } }); }
  f.advance(1000);
  const failed = await f.action(ada.cookie, { type: 'activity', payload: { id: 'lib-gold-bottle' } });
  assert.equal(failed.code, 'unavailable');
  const cid = clientId();
  const filed = await post('/api/support/reports', { cityId: 'lagos', category: 'money', text: '  My balance dropped and I do not know why  ', clientId: cid }, ada);
  assert.deepEqual([filed.status, filed.ok, filed.code, filed.receipt.id, filed.receipt.status, filed.receipt.category, filed.receipt.text], [200, true, 'filed', 'P-1', 'received', 'money', 'My balance dropped and I do not know why']);
  const retry = await post('/api/support/reports', { cityId: 'lagos', category: 'money', text: 'My balance dropped and I do not know why', clientId: cid }, ada);
  assert.deepEqual([retry.duplicate, retry.receipt.id], [true, 'P-1'], 'a retried filing is stored once');
  // What the operator sees: the automatic context.
  const [problem] = (await mod('/api/mod/problems')).problems;
  assert.deepEqual([problem.id, problem.by, problem.name, problem.context.build, problem.context.cityId], ['P-1', ada.id, 'Ada', 'test-build-7', 'lagos']);
  assert.deepEqual(problem.context.life, { cash: 4600, location: 'library', spot: 'lounge', job: null, action: null, message: failed.reason });
  assert.equal(problem.context.actions.length, 10);
  assert.deepEqual(problem.context.actions[0], { at: f.now(), type: 'activity', ok: false, code: 'unavailable' });
  assert.deepEqual(problem.context.lastError, problem.context.actions[0]);
  assert.ok(problem.context.actions.slice(1).every((action) => action.type === 'spot' && action.ok && action.code === 'selected'));
  assert.deepEqual(problem.context.ledger, [{ at: 100000, amount: -400, reason: 'Cab to The Library', balance: 4600 }]);
  const db = await database();
  assert.ok(!JSON.stringify(db.support).includes(ada.cookie.slice(4)), 'the session secret is not in the report');
  assert.deepEqual(Object.keys(db.support.reports[0].context).sort(), ['actions', 'at', 'build', 'cityId', 'ledger', 'lastError', 'life'].sort());
  // The receipt is still there after a "reload", and its status follows what the operator does.
  assert.deepEqual((await get('/api/support/reports', ada)).reports.map((report) => [report.id, report.status, report.note]), [['P-1', 'received', '']]);
  assert.equal((await mod('/api/mod/problems/P-1/status', { status: 'banana' })).status, 400);
  assert.equal((await mod('/api/mod/problems/P-9/status', { status: 'resolved' })).status, 404);
  assert.equal((await mod('/api/mod/problems/P-1/status', { status: 'resolved', note: 'That was Saturday rent: see Phone → Statement.' })).code, 'updated');
  const mine = await get('/api/support/reports', ada);
  assert.deepEqual([mine.reports[0].status, mine.reports[0].note], ['resolved', 'That was Saturday rent: see Phone → Statement.']);
  assert.ok((await get('/api/social/me', ada)).updates.some((update) => update.text.startsWith('Problem report P-1 is now “resolved”.')));
  const other = await f.device('Bola');
  assert.deepEqual((await get('/api/support/reports', other)).reports, [], 'a player only ever sees their own receipts');
  // Three filings an hour per player; the limit says so instead of failing silently.
  assert.equal((await post('/api/support/reports', { cityId: 'lagos', category: 'bug', text: 'second' }, ada)).code, 'filed');
  assert.equal((await post('/api/support/reports', { cityId: 'lagos', category: 'bug', text: 'third' }, ada)).code, 'filed');
  const limited = await post('/api/support/reports', { cityId: 'lagos', category: 'bug', text: 'fourth' }, ada);
  assert.deepEqual([limited.ok, limited.code], [false, 'rate_limited']); assert.match(limited.reason, /the ones you filed are kept/);
  assert.deepEqual((await mod('/api/mod/overview')).problems, { total: 3, open: 2 });
});

test('statement: the server explains the balance — opening, every change, closing — and it reconciles', async (t) => {
  const { f, get } = await harness(t);
  const ada = await f.device('Ada');
  assert.equal((await get('/api/support/statement?city=lagos')).status, 401);
  assert.equal((await get('/api/support/statement?city=mars', ada)).error, 'invalid_city');
  const empty = (await get('/api/support/statement?city=lagos', ada)).statement;
  assert.deepEqual([empty.opening, empty.closing, empty.lines, empty.days, empty.reconciled], [{ balance: 5000, day: null }, 5000, [], [], true]);
  await f.action(ada.cookie, { type: 'travel', payload: { id: 'library', mode: 'cab' } });
  f.advance(10000);
  await f.action(ada.cookie, { type: 'travel', payload: { id: 'park', mode: 'danfo' } });
  f.advance(DAY);
  await f.action(ada.cookie, { type: 'spot', payload: { id: 'drinks' } });
  await f.action(ada.cookie, { type: 'activity', payload: { id: 'park-zobo' } });
  f.advance(6000);
  const { statement, name, city } = await get('/api/support/statement?city=lagos', ada);
  assert.deepEqual([name, city, statement.opening.balance, statement.closing, statement.reconciled, statement.problems], ['Ada', 'lagos', 5000, 4250, true, []]);
  assert.deepEqual(statement.lines.map((line) => [line.amount, line.reason, line.balance]), [[-400, 'Cab to The Library', 4600], [-150, 'Danfo to Freedom Park', 4450], [-200, 'Chilled Zobo', 4250]]);
  assert.deepEqual(statement.days.map((day) => [day.open, day.in, day.out, day.close, day.changes, day.groups]),
    [[5000, 0, 550, 4450, 2, [{ group: 'Cab', net: -400, count: 1 }, { group: 'Danfo', net: -150, count: 1 }]], [4450, 0, 200, 4250, 1, [{ group: 'Chilled Zobo', net: -200, count: 1 }]]]);
  assert.deepEqual(statement.totals, { in: 0, out: 750, changes: 3, net: -750 });
  // It is the same statement the rules engine derives from the stored life.
  const life = (await get('/api/life?city=lagos', ada)).state;
  assert.deepEqual(statementOf(createLife(life, { now: f.now(), cityId: 'lagos' })), statement);
});

test('polls do not write unless something happened; an outcome is on disk before the poll is answered', async (t) => {
  const { f, get } = await harness(t, { lazyFlushMs: 60000, storeMode: 'grouped' });
  const ada = await f.device('Ada');
  const file = join(f.dir, 'devices.json');
  const signature = async () => { const info = await stat(file, { bigint: true }); return `${info.ino}:${info.mtimeNs}`; };
  const stored = async () => JSON.parse(await readFile(file, 'utf8')).sessions[ada.cookie.slice(4)].cities?.lagos?.state;
  const started = await f.action(ada.cookie, { type: 'spot', payload: { id: 'trees' } });
  assert.equal(started.ok, true);
  const baseline = await signature(), writes = f.server.store.stats().writes;
  for (let i = 0; i < 20; i++) { f.advance(1000); assert.equal((await get('/api/life?city=lagos', ada)).status, 200); }
  assert.equal(await signature(), baseline, 'twenty quiet polls wrote nothing');
  assert.equal(f.server.store.stats().writes, writes);
  assert.equal((await get('/api/life?city=lagos', ada)).state.t, f.now(), 'though each was answered with the settled state');
  // An action is on disk when it is answered, together with everything the polls had settled.
  assert.equal((await f.action(ada.cookie, { type: 'activity', payload: { id: 'chill' } })).code, 'started');
  assert.equal((await stored()).activeAction.id, 'chill'); assert.equal((await stored()).t, f.now());
  // The poll that completes the activity is an outcome: durable before the answer.
  f.advance(12000);
  const done = await get('/api/life?city=lagos', ada);
  assert.equal(done.state.activeAction, null); assert.equal(done.state.needs.fun > 50, true);
  assert.equal((await stored()).activeAction, null, 'the completion was written before the poll returned');
  assert.equal((await stored()).message, done.state.message);
});

test('a session that never created a life leaves nothing behind; a lived life is archived, never deleted', async (t) => {
  const { f, get, post, database } = await harness(t);
  const empty = await post('/api/session', { name: 'Ghost', onboarding: true });
  assert.equal(empty.status, 200);
  const lived = await f.device('Ada');
  await f.action(lived.cookie, { type: 'travel', payload: { id: 'library', mode: 'cab' } });
  f.advance(30 * DAY + 1);
  await f.device('Newcomer'); // any new session sweeps the expired ones
  const db = await database();
  assert.deepEqual(Object.keys(db.archivedLives), [lived.id]); assert.equal(db.archivedLives[lived.id].cities.lagos.state.cash, 4600);
  assert.equal(Object.keys(db.sessions).length, 1);
  assert.equal((await get('/api/life?city=lagos', lived)).status, 401);
});

test('presence freshness: a connection that stops answering pings stops counting as online within one beat', async (t) => {
  const { f, get, post, register } = await harness(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  await register(ada, bola);
  await post('/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada); await post('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola);
  const b = await f.joinRoom(bola);
  const status = async () => (await get('/api/social/me', ada)).friends[0];
  const fresh = await status();
  assert.deepEqual([fresh.status, fresh.venue, fresh.seenAt], ['online', 'park', f.now()]);
  // A healthy connection answers the ping: still online however much later we look, and seenAt moves.
  f.server.beat(); await new Promise((done) => setTimeout(done, 60));
  f.advance(8000);
  f.server.beat(); await new Promise((done) => setTimeout(done, 60));
  assert.deepEqual([(await status()).status, (await status()).seenAt], ['online', f.now()]);
  assert.equal((await get('/api/civic/pulse?city=lagos', bola)).counters.online >= 0, true);
  // The connection dies silently: the client stops reading, so the next ping is never answered.
  b.ws._socket.pause(); b.ws.pong = () => {};
  f.server.beat();
  f.advance(4000);
  assert.equal((await status()).status, 'online', 'inside the pong grace it still counts');
  f.advance(1500);
  const stale = await status();
  assert.deepEqual([stale.status, stale.venue, stale.seenAt], ['reconnecting', undefined, undefined], 'unanswered for the grace period: no longer shown as online or in a venue');
  assert.deepEqual((await get(`/api/social/players/${bola.id}`, ada)).player.status, 'reconnecting');
  const knock = await post('/api/social/house/knock', { host: bola.id, cityId: 'lagos' }, ada);
  assert.equal(knock.code, 'host_reconnecting', 'and an invitation says so instead of pretending the host is in');
  // The next beat closes it; after the reconnect grace it reads offline.
  f.server.beat(); await new Promise((done) => setTimeout(done, 60));
  assert.equal((await status()).status, 'reconnecting');
  f.advance(20001);
  assert.equal((await status()).status, 'offline');
});

test('presence registry: unresponsive sockets are ignored, and say "reconnecting" rather than "online"', () => {
  let now = 1000;
  const dead = new Set();
  const ctx = { now: () => now, core: { unresponsive: (ws) => dead.has(ws) } };
  const presence = presenceOf(ctx);
  const one = { session: { id: 'p', name: 'P' }, readyState: 1, expiresAt: 9e15, room: 'lagos:park', seenAt: 900 };
  const two = { session: { id: 'p', name: 'P' }, readyState: 1, expiresAt: 9e15, room: null, seenAt: 950 };
  presence.open(one); presence.open(two);
  assert.deepEqual(presence.status('p'), { state: 'online', rooms: ['lagos:park'], seenAt: 950 });
  dead.add(one);
  assert.deepEqual(presence.status('p'), { state: 'online', rooms: [], seenAt: 950 }, 'the room of a dead socket is not reported');
  assert.equal(presence.isIn('p', 'lagos:park'), false); assert.deepEqual(presence.inRoom('lagos:park'), []);
  dead.add(two);
  assert.deepEqual(presence.status('p'), { state: 'reconnecting', rooms: [] });
  presence.close(one); presence.close(two);
  assert.equal(presence.status('p').state, 'reconnecting'); now += 20001; assert.equal(presence.status('p').state, 'offline');
});

test('heartbeat ends an expired house visit even when neither the guest nor the host sends anything', async (t) => {
  const { f, get, post, until, register } = await harness(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  await register(ada, bola);
  // Ada goes home and joins her Home room; Bola knocks and is let in.
  await f.action(ada.cookie, { type: 'travel', payload: { id: 'home', mode: 'cab' } });
  f.advance(15000); await get('/api/life?city=lagos', ada);
  const host = await f.socket(ada); host.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home' })); await until(host, 'presence');
  assert.equal((await post('/api/social/house/knock', { host: ada.id, cityId: 'lagos' }, bola)).code, 'knocking');
  assert.equal((await post('/api/social/house/answer', { visitor: bola.id, answer: 'accept' }, ada)).code, 'accepted');
  const guest = await f.socket(bola); guest.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home', hostId: ada.id }));
  assert.equal((await until(guest, 'presence')).members.length, 2);
  // A beat before the visit runs out changes nothing.
  f.advance(29 * 60000); f.server.beat(); await new Promise((done) => setTimeout(done, 80));
  assert.equal((await get('/api/social/me', bola)).visiting.host.id, ada.id);
  // The visit runs out. Nobody polls, acts or sends a frame: only the heartbeat runs.
  f.advance(61000);
  f.server.beat();
  const ended = await until(guest, 'error');
  assert.equal(ended.code, 'visit_ended');
  let alone; for (let i = 0; i < 20 && alone !== 1; i++) { const message = await host.next(); if (message.type === 'presence') alone = message.members.length; }
  assert.equal(alone, 1, 'the host’s room no longer lists the guest');
  // The stored visit is closed too, and both sides were told.
  await new Promise((done) => setTimeout(done, 80));
  const after = await get('/api/social/me', bola);
  assert.equal(after.visiting, null); assert.ok(after.updates.some((update) => /^Your visit to Ada’s house ended\. A visit lasts 30 minutes/.test(update.text)));
  assert.deepEqual((await get('/api/social/me', ada)).house.guests, []);
  guest.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home', hostId: ada.id }));
  assert.equal((await until(guest, 'error')).code, 'not_a_guest');
});

test('votes per address: a soft cap that refuses with a reason from a public address and only logs from a shared one', async (t) => {
  const { f, mod } = await harness(t, { trustProxy: true, votesPerAddress: 2 });
  const call = async (path, body, device, address) => {
    const res = await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(device ? { Cookie: device.cookie } : {}), ...(address ? { 'X-Forwarded-For': address } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, ...(await res.json()) };
  };
  const act = (device, type, payload) => call('/api/action', { actionId: `${f.now()}:${randomUUID()}`, cityId: 'lagos', type, payload }, device);
  const people = [];
  for (const name of ['Ada', 'Bola', 'Chidi', 'Dayo', 'Eve', 'Femi']) people.push(await f.device(name));
  const workDay = async () => {
    for (const device of people) { await act(device, 'apply-job', { id: 'community-helper' }); await act(device, 'spot', { id: 'work' }); assert.equal((await act(device, 'activity', { id: 'helper-shift' })).ok, true); }
    f.advance(21000);
    for (const device of people) await call('/api/life?city=lagos', null, device);
  };
  await workDay(); f.advance(DAY - 21000); await workDay();
  const [ada, bola, chidi, dayo, eve, femi] = people;
  f.advance(MONDAY + 60000 - f.now());
  assert.equal((await call('/api/civic/gov/run', { cityId: 'lagos', slogan: 'Light for all' }, ada, '41.58.0.1')).code, 'declared');
  f.advance(MONDAY + 3 * DAY + 9 * HOUR - f.now());
  for (const device of people) assert.equal((await act(device, 'travel', { id: 'polling-unit', mode: 'trek' })).ok, true);
  f.advance(30000);
  const vote = (device, address) => call('/api/civic/gov/vote', { cityId: 'lagos', candidate: ada.id }, device, address);
  // Two votes from one public address are counted; the third is refused, with the reason, and can be cast from elsewhere.
  assert.equal((await vote(ada, '41.58.0.9')).code, 'voted');
  assert.equal((await vote(bola, '8.8.8.8, 41.58.0.9')).code, 'voted', 'only the address the trusted proxy saw counts; a client-supplied entry is ignored');
  const third = await vote(chidi, '41.58.0.9');
  assert.deepEqual([third.status, third.ok, third.code, third.gov.election.totalVotes], [200, false, 'address_vote_limit', 2]);
  assert.match(third.reason, /^2 votes have already been counted from your network connection in this election/); assert.match(third.reason, /Your vote was not counted/);
  assert.notEqual(third.state.message, 'Your vote was counted.', 'a capped vote leaves no trace of having been cast in the life');
  assert.equal((await vote(chidi, '41.58.0.9')).code, 'address_vote_limit');
  assert.equal((await vote(chidi, '197.210.1.1')).code, 'voted', 'the same player can vote from another connection');
  // A private-range address means the server is seeing a shared address: counted, and logged instead.
  for (const device of [dayo, eve, femi]) assert.equal((await vote(device, '10.0.0.7')).code, 'voted');
  assert.equal((await call('/api/civic/gov?city=lagos', null, ada)).election.totalVotes, 6);
  const audit = (await mod('/api/mod/audit')).audit.filter((line) => line.action.startsWith('vote-cap'));
  assert.deepEqual(audit.map((line) => line.action).sort(), ['vote-cap', 'vote-cap-shared'], 'one line per address, not one per attempt');
  assert.ok(audit.every((line) => !/41\.58|10\.0\.0/.test(JSON.stringify(line))), 'the audit line carries a key, not the address');
  const db = JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8'));
  assert.ok(!/41\.58\.0\.9|10\.0\.0\.7|197\.210/.test(JSON.stringify(db.civic)), 'no address is stored with the ballot');
  for (const [address, shared] of [['127.0.0.1', true], ['::1', true], ['::ffff:10.1.2.3', true], ['192.168.1.4', true], ['172.20.0.1', true], ['172.32.0.1', false], ['41.58.0.9', false], ['fd00::1', true], ['2a02:1::1', false], ['', true]]) {
    assert.equal(isSharedAddress(address), shared, address);
  }
});
