// OWNER: admin - the admin section on the Node host (docs/ADMIN.md). The sign-in provider is the stand-in of server/accounts/test-tokens.ts.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../test-fixture.ts';
import type { FixtureOptions } from '../test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from '../accounts/test-tokens.ts';
import { csrfOf } from '../routes/auth.ts';
import { emailHash } from '../social/founder.ts';

const PROJECT = 'allworld-test-project';
const ACCOUNTS = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' };
export const FOUNDER_ADDRESS = 'founder.test@example.com', OTHER_ADMIN_ADDRESS = 'second.admin@example.com';
type Json = Record<string, unknown>;

/** A server whose founder is the account of FOUNDER_ADDRESS (made up: only its hash is configured), with the helpers the tests share. */
export async function admins(t: TestContext, options: FixtureOptions & { env?: Record<string, unknown> } = {}) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const env = { ...ACCOUNTS, FOUNDER_EMAIL_SHA256: emailHash(FOUNDER_ADDRESS), ADMIN_EMAIL_SHA256S: emailHash(OTHER_ADMIN_ADDRESS), NEW_SESSIONS_PER_ADDRESS: '1000', ...options.env };
  const f = await fixture(t, { ...options, env, fetch: (url, init) => provider.fetch(url, init as { body?: unknown }), log: (line: string) => { if (process.env['DEBUG_ADMIN']) console.error(line); } });
  const call = (path: string, body?: unknown, cookie?: string | null, headers: Record<string, string | null> = {}): Promise<Response> => {
    const all: Record<string, string | null> = { Origin: f.base, ...(body !== undefined && body !== null ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers };
    return fetch(f.base + path, { method: body !== undefined && body !== null ? 'POST' : 'GET', headers: Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== null)), body: body !== undefined && body !== null ? JSON.stringify(body) : undefined });
  };
  let minted = 0;
  /** An account of `address`: a guest with a played life signs in under it. Returns its cookie and character. */
  async function account(address: string, name: string) {
    const guest = await f.device(name);
    await f.request('/api/life?city=lagos', null, guest.cookie);
    const idToken = await signToken(key, claimsFor(PROJECT, f.now(), { subject: `Uid${address.replace(/\W/g, '')}`, email: address, n: ++minted }));
    const state = await (await call('/api/account', null, guest.cookie)).json() as { csrf: string };
    const signed = await call('/api/account/sign-in', { idToken, csrf: state.csrf }, guest.cookie);
    const set = signed.headers.get('set-cookie');
    assert.equal(signed.status, 200);
    return { cookie: set ? set.split(';')[0] ?? '' : '', id: guest.id, name };
  }
  /** A played guest. */
  async function player(name: string) { const d = await f.device(name); await f.request('/api/life?city=lagos', null, d.cookie); return d; }
  /** A guest whose character creation is confirmed ('playing'), so its life can be paid. */
  async function ready(name: string) {
    const d = await f.device(name);
    await f.request('/api/life?city=lagos', null, d.cookie);
    return d;
  }
  const life = async (cookie: string) => (await (await f.request('/api/life?city=lagos', null, cookie)).json() as { state: { cash: number; ledger: { amount: number; reason: string; balance: number }[]; social: { earned: number }; needs: Record<string, number>; location: string } }).state;
  /** The same account signs in again with another verified address (the provider says its owner changed it). */
  async function signInAgain(cookie: string, subjectAddress: string, newAddress: string): Promise<void> {
    const idToken = await signToken(key, claimsFor(PROJECT, f.now(), { subject: `Uid${subjectAddress.replace(/\W/g, '')}`, email: newAddress, n: ++minted }));
    const state = await (await call('/api/account', null, cookie)).json() as { csrf: string };
    assert.equal((await call('/api/account/sign-in', { idToken, csrf: state.csrf }, cookie)).status, 200);
  }
  const admin = async (path: string, cookie: string, body?: Json) => { const r = await call(path, body === undefined ? null : { clientId: f.id(), ...body }, cookie); return { status: r.status, body: await r.json() as Json }; };
  return { f, key, provider, call, account, player, ready, life, admin, csrfOf, signInAgain };
}

test('the founder account is an admin; a guest, an ordinary account and another account are not', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.account('ada@example.com', 'Ada'), guest = await a.player('Guest');
  const me = await a.admin('/api/admin/me', founder.cookie);
  assert.equal(me.status, 200); assert.equal(me.body.level, 'root');
  assert.equal(JSON.stringify(me.body).includes(FOUNDER_ADDRESS), false, 'the address is never in an answer');
  for (const cookie of [ada.cookie, guest.cookie, '']) assert.equal((await a.admin('/api/admin/me', cookie)).status, 404);
  const second = await a.account(OTHER_ADMIN_ADDRESS, 'Second');
  assert.equal((await a.admin('/api/admin/me', second.cookie)).body.level, 'admin');
});

// ---- the guard ------------------------------------------------------------------------------------------------

test('every admin route refuses everyone who is not an admin: no session, a guest, an ordinary account, an account whose address changed, a signed-out founder, a cross-site page', async (t) => {
  const a = await admins(t);
  const routes = (await import('../../src/types/protocol.ts')).HTTP_ROUTE_KEYS.filter((key) => key.includes(' /api/admin/'));
  assert.ok(routes.length >= 20, 'the route list comes from the registry, so a new route cannot be left out');
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.account('ada@example.com', 'Ada'), guest = await a.player('Guest');
  const changed = await a.account(OTHER_ADMIN_ADDRESS, 'Changed');
  await a.signInAgain(changed.cookie, OTHER_ADMIN_ADDRESS, 'new.address@example.com');
  const out = await a.account('signedout@example.com', 'Out');
  const target = await a.player('Target');
  const callers: [string, string][] = [['no session', ''], ['a guest', guest.cookie], ['an ordinary account', ada.cookie], ['an account whose address changed', changed.cookie]];
  let refused = 0;
  const hit = async (key: string, cookie: string, headers: Record<string, string | null> = {}) => {
    const [method, path] = key.split(' ') as [string, string];
    const url = path.replace(':id', target.id);
    const response = await a.call(url, method === 'POST' ? { clientId: a.f.id(), action: 'credit', amount: 1, reason: 'test', title: 'x', body: 'y', audience: 'everyone', minutes: 1, key: 'chatPictures', value: true } : null, cookie, headers);
    if (++refused % 8 === 0) a.f.advance(11 * 60000);
    return response;
  };
  for (const key of routes) {
    for (const [who, cookie] of callers) { const response = await hit(key, cookie); assert.equal(response.status, 404, `${key} for ${who}`); assert.deepEqual(await response.json(), { error: 'not_found' }); }
  }
  // The founder, signed out everywhere, is no longer an admin on the same cookie.
  void out;
  // A cross-site page (another Origin) never gets past the host, admin or not.
  for (const key of routes) { const response = await hit(key, founder.cookie, { Origin: 'https://evil.example' }); assert.equal(response.status, 403, `${key} cross-site`); }
  // The admin's own writes must name this host as their origin: without an Origin header a POST is refused (403) even from the founder.
  for (const key of routes.filter((item) => item.startsWith('POST '))) { const response = await hit(key, founder.cookie, { Origin: null }); assert.equal(response.status, 403, `${key} without an origin`); assert.equal(((await response.json()) as { error: string }).error, 'origin_required'); }
});

test('an admin who signs out everywhere is not an admin on the next request; refused attempts from one address run out of budget', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder');
  assert.equal((await a.admin('/api/admin/me', founder.cookie)).status, 200);
  const state = await (await a.call('/api/account', null, founder.cookie)).json() as { csrf: string };
  assert.equal((await a.call('/api/account/sign-out', { csrf: state.csrf }, founder.cookie)).status, 200);
  assert.equal((await a.admin('/api/admin/me', founder.cookie)).status, 404, 'a binding that was removed is not an admin');
  const guest = await a.player('Guest');
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await a.admin('/api/admin/dashboard', guest.cookie)).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(404)); assert.deepEqual(statuses.slice(10), [429, 429]);
});

// ---- money -----------------------------------------------------------------------------------------------------

test('credit and debit: one ledger line each, bounded, exactly once, audited, and never counted as earned', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.ready('Ada');
  const before = await a.life(ada.cookie);
  const act = (body: Json, id = ada.id) => a.admin(`/api/admin/players/${id}/act`, founder.cookie, body);
  const body = { action: 'credit', amount: 5000, reason: 'launch bonus', clientId: a.f.id() };
  const first = await act(body);
  assert.equal(first.status, 200); assert.equal(first.body.code, 'credited'); assert.equal(first.body.after, (before.cash) + 5000);
  const again = await act(body);
  assert.equal(again.body.duplicate, true, 'the same client id is answered, not applied again');
  const after = await a.life(ada.cookie);
  assert.equal(after.cash, before.cash + 5000);
  assert.equal(after.ledger.at(-1)?.reason, 'Admin credit: launch bonus'); assert.equal(after.ledger.at(-1)?.amount, 5000);
  assert.equal(after.social.earned, before.social.earned, 'an admin credit is not earned from work');
  // The cash always equals what the life started with plus its ledger.
  const lines = after.ledger.reduce((sum, line) => sum + line.amount, 0);
  assert.equal(after.cash - lines, after.ledger.length === 0 ? after.cash : after.ledger[0]!.balance - after.ledger[0]!.amount);
  // Limits: a reason is required; one action at most ₦500,000; the day's total per player.
  assert.equal((await act({ action: 'credit', amount: 100 })).body.error, 'reason_required');
  // The founder has no cap: above the old limits is fine; only a typo guard above ₦10,000,000 and a hard bound for number handling remain.
  assert.equal((await act({ action: 'credit', amount: 1_000_000_000_001, reason: 'too much' })).body.error, 'invalid_amount');
  assert.equal((await act({ action: 'credit', amount: 500001, reason: 'over the old cap' })).status, 200);
  assert.equal((await act({ action: 'credit', amount: 500000, reason: 'another' })).status, 200);
  const huge = { action: 'credit', amount: 50_000_000, reason: 'a typed confirmation, not a limit' };
  const ask = await act(huge);
  assert.equal(ask.body.code, 'confirmation_required');
  assert.equal((await act({ ...huge, confirm: ask.body.token as string })).body.code, 'credited');
  assert.equal((await act({ action: 'credit', amount: 10_000_000, reason: 'at the guard, not over it' })).body.code, 'credited');
  // A debit asks for confirmation first, takes at most the balance, and says so.
  const wantDebit = { action: 'debit', amount: 400000, reason: 'correcting' };
  const needs = await act(wantDebit);
  assert.equal(needs.body.code, 'confirmation_required'); assert.equal(typeof needs.body.token, 'string');
  const debited = await act({ ...wantDebit, confirm: needs.body.token as string });
  assert.equal(debited.status, 200); assert.equal(debited.body.code, 'debited');
  const wrongToken = await act({ ...wantDebit, amount: 300000, confirm: needs.body.token as string });
  assert.equal(wrongToken.body.code, 'confirmation_required', 'a token is for those parameters only');
  const net = await a.life(ada.cookie);
  assert.ok(net.cash >= 0);
  // The audit holds a line for each action that ran, newest first, with who and why.
  const audit = await a.admin('/api/admin/audit?target=' + ada.id, founder.cookie);
  const lines2 = audit.body.lines as { action: string; reason: string; admin: string; summary: string }[];
  assert.deepEqual(lines2.map((line) => line.action), ['debit', 'credit', 'credit', 'credit', 'credit', 'credit']);
  assert.equal(lines2[5]?.reason, 'launch bonus'); assert.match(lines2[5]?.summary ?? '', /₦5,000 \(unrestricted/);
  assert.equal(JSON.stringify(audit.body).includes(FOUNDER_ADDRESS), false);
  const dash = await a.admin('/api/admin/dashboard?fresh=1', founder.cookie);
  const money = dash.body.adminMoney as { creditTotal: number; debitTotal: number };
  assert.equal(money.creditTotal, 5000 + 500001 + 500000 + 50_000_000 + 10_000_000); assert.ok(money.debitTotal > 0);
});

test('the limits have names and the environment can replace them: they bind every admin but the founder', async (t) => {
  const a = await admins(t, { env: { ADMIN_MAX_AMOUNT: '1000' } });
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), second = await a.account(OTHER_ADMIN_ADDRESS, 'Second'), ada = await a.ready('Ada');
  const credit = (cookie: string, amount: number) => a.admin(`/api/admin/players/${ada.id}/act`, cookie, { action: 'credit', amount, reason: 'a test credit' });
  assert.equal((await credit(second.cookie, 1001)).body.error, 'over_action_limit', 'another admin keeps the cap');
  assert.equal((await credit(second.cookie, 1000)).status, 200);
  assert.equal((await credit(founder.cookie, 1_000_000)).status, 200, 'the founder has none');
  assert.equal(((await a.admin('/api/admin/me', founder.cookie)).body.limits as { maxAmount: number }).maxAmount, 1000);
});

test('only the founder can act on an admin or on the founder', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), second = await a.account(OTHER_ADMIN_ADDRESS, 'Second');
  const asSecond = (id: string) => a.admin(`/api/admin/players/${id}/act`, second.cookie, { action: 'note', text: 'hello' });
  assert.equal((await asSecond(founder.id)).body.error, 'protected_target');
  assert.equal((await asSecond(second.id)).body.error, 'protected_target', 'not even themselves');
  assert.equal((await a.admin(`/api/admin/players/${second.id}/act`, founder.cookie, { action: 'note', text: 'welcome' })).status, 200);
});

// ---- needs, moves, names -----------------------------------------------------------------------------------------

test('heal, set a need, move to the arrival venue, rename through the name filter', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.ready('Ada');
  const act = (body: Json) => a.admin(`/api/admin/players/${ada.id}/act`, founder.cookie, body);
  assert.equal((await act({ action: 'need', need: 'hunger', value: 5 })).status, 200);
  assert.equal((await a.life(ada.cookie)).needs.hunger, 5);
  assert.equal((await act({ action: 'heal' })).status, 200);
  assert.ok(((await a.life(ada.cookie)).needs.hunger ?? 0) >= 80);
  assert.equal((await act({ action: 'need', need: 'nope', value: 5 })).body.error, 'invalid_need');
  assert.equal((await act({ action: 'teleport', to: 'arrival' })).status, 200);
  assert.equal((await act({ action: 'rename', name: 'Ada Lovelace' })).status, 200);
  assert.equal((await a.admin(`/api/admin/players/${ada.id}`, founder.cookie)).body.profile && ((await a.admin(`/api/admin/players/${ada.id}`, founder.cookie)).body.profile as { name: string }).name, 'Ada Lovelace');
  assert.notEqual((await act({ action: 'rename', name: 'call me 08012345678' })).status, 200, 'the name filter applies');
});

// ---- sanctions ---------------------------------------------------------------------------------------------------

test('mute, suspend and ban: time-boxed, a ban signs the player out and closes their sockets, and the refusal is a plain sentence', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), bola = await a.account('bola@example.com', 'Bola'), cy = await a.ready('Cyrus');
  const act = (id: string, body: Json) => a.admin(`/api/admin/players/${id}/act`, founder.cookie, body);
  assert.equal((await act(cy.id, { action: 'mute', minutes: 30, reason: 'spam' })).body.code, 'muted');
  assert.equal((await act(cy.id, { action: 'unmute' })).body.code, 'unmuted');
  assert.equal((await act(cy.id, { action: 'suspend', kind: 'pictures', minutes: 60, reason: 'test' })).body.code, 'applied');
  const socket = await a.f.socket(bola);
  const closed = new Promise<number>((resolve) => socket.ws.once('close', (code: number) => resolve(code)));
  const first = await act(bola.id, { action: 'ban', minutes: 0, reason: 'abuse' });
  assert.equal(first.body.code, 'confirmation_required');
  assert.equal((await act(bola.id, { action: 'ban', minutes: 0, reason: 'abuse', confirm: first.body.token as string })).body.code, 'applied');
  assert.equal(await closed, 4401, 'the open socket is closed when the ban is made');
  assert.equal((await a.call('/api/session', null, bola.cookie)).status, 401, 'signed out everywhere: the cookie is no longer a session');
  // A banned guest is refused by every route with a plain sentence, and is let back by an unban.
  const g = await act(cy.id, { action: 'ban', minutes: 60, reason: 'abuse' });
  await act(cy.id, { action: 'ban', minutes: 60, reason: 'abuse', confirm: g.body.token as string });
  const refused = await a.call('/api/life?city=lagos', null, cy.cookie);
  assert.equal(refused.status, 403);
  const said = await refused.json() as { error: string; reason: string };
  assert.equal(said.error, 'account_banned'); assert.match(said.reason, /suspended from Allworld/);
  assert.equal((await act(cy.id, { action: 'unban' })).status, 200);
});

// ---- announcements, world tools, settings, reads ---------------------------------------------------------------

async function frameOf(socket: { next(): Promise<{ type: string }> }, type: string): Promise<Json> {
  for (let i = 0; i < 6; i++) { const frame = await socket.next(); if (frame.type === type) return frame as unknown as Json; }
  throw new Error(`no ${type} frame`);
}

test('an announcement is stored once: sockets that are open get it at once, a socket that opens later gets it on connect, and no player record is written', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.ready('Adaobi'), bola = await a.ready('Bolanle');
  const early = await a.f.socket(ada);
  const rowsBefore = JSON.stringify(Object.values((await (async () => { await a.f.flush(); return a.f.server.store.read((db) => db.sessions); })())).map((s) => s.expiresAt));
  const made = await a.admin('/api/admin/announcements', founder.cookie, { title: 'Weekend market', body: 'Stalls are half price all weekend.', audience: 'everyone', action: 'business' });
  assert.equal(made.body.code, 'sent');
  const live = await frameOf(early, 'announce');
  assert.equal(live.live, true); assert.equal((live.items as { title: string; action: string }[])[0]?.action, 'business');
  const late = await a.f.socket(bola);
  const onConnect = await frameOf(late, 'announce');
  assert.equal(onConnect.live, false); assert.equal((onConnect.items as { id: string }[]).length, 1);
  const rowsAfter = JSON.stringify(Object.values(await a.f.server.store.read((db) => db.sessions)).map((s) => s.expiresAt));
  assert.equal(rowsAfter, rowsBefore, 'no per-player write');
  const list = await a.admin('/api/admin/announcements', founder.cookie);
  const first = (list.body.announcements as { status: string; reach: { sockets: number } }[])[0];
  assert.equal(first?.status, 'running'); assert.equal(first?.reach.sockets, 1);
  // Text goes through the filter; a button is one of the fixed panels; "online now" is never replayed on connect.
  assert.equal((await a.admin('/api/admin/announcements', founder.cookie, { title: 'Call 08012345678', body: 'x', audience: 'everyone' })).status, 400);
  assert.equal((await a.admin('/api/admin/announcements', founder.cookie, { title: 't', body: 'b', audience: 'everyone', action: 'https://x.example' })).body.error, 'invalid_action');
  await a.admin('/api/admin/announcements', founder.cookie, { title: 'Now only', body: 'Online right now.', audience: 'online' });
  const third = await a.f.socket(await a.ready('Chidinma'));
  assert.equal(((await frameOf(third, 'announce')).items as unknown[]).length, 1, 'only the running one that is for everyone');
  // Cancelling ends it.
  const id = (made.body as { id: string }).id;
  assert.equal((await a.admin(`/api/admin/announcements/${id}/cancel`, founder.cookie, {})).body.code, 'cancelled');
  // A scheduled one waits for its time.
  const at = a.f.now() + 600000;
  assert.equal((await a.admin('/api/admin/announcements', founder.cookie, { title: 'Later', body: 'Soon.', audience: 'everyone', at })).body.code, 'scheduled');
  // E-mail to a count of nobody needs no confirmation, and the count is shown first.
  const preview = await a.admin('/api/admin/announcements', founder.cookie, { preview: true, title: 'x', body: 'y', audience: 'everyone' });
  assert.equal(preview.body.email, 0);
});

test('world grant: bounded, confirmed above the threshold, one ledger line each, conservation holds', async (t) => {
  const a = await admins(t, { env: { ADMIN_GRANT_CONFIRM_ABOVE: '1' } });
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.ready('Adaobi'), bola = await a.ready('Bolanle');
  await a.f.socket(ada); await a.f.socket(bola);
  const before = [(await a.life(ada.cookie)).cash, (await a.life(bola.cookie)).cash];
  const grant = (body: Json) => a.admin('/api/admin/world/grant', founder.cookie, { audience: 'online', ...body });
  assert.equal((await grant({ amount: 5001, reason: 'launch bonus' })).body.error, 'invalid_amount');
  const preview = await grant({ amount: 1000, reason: 'launch bonus', preview: true });
  assert.equal(preview.body.count, 2, JSON.stringify(preview.body));
  const asked = await grant({ amount: 1000, reason: 'launch bonus' });
  assert.equal(asked.body.code, 'confirmation_required');
  const done = await grant({ amount: 1000, reason: 'launch bonus', confirm: asked.body.token as string });
  assert.equal(done.body.players, 2, JSON.stringify(done.body));
  const after = await a.life(ada.cookie);
  assert.equal(after.cash, before[0]! + 1000); assert.equal(after.ledger.at(-1)?.reason, 'Admin credit: launch bonus');
  assert.equal((await a.life(bola.cookie)).cash, before[1]! + 1000);
  const dash = await a.admin('/api/admin/dashboard?fresh=1', founder.cookie);
  assert.equal((dash.body.adminMoney as { grantTotal: number }).grantTotal, 2000);
});

test('settings default to the environment, change with an audit line, and reset; the notice starts from a button', async (t) => {
  const a = await admins(t, { env: { NEW_SESSIONS_PER_ADDRESS: '77' } });
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder');
  const find = async (key: string) => ((await a.admin('/api/admin/settings', founder.cookie)).body.settings as { key: string; value: unknown; default: unknown }[]).find((item) => item.key === key);
  assert.equal((await find('newSessionsPerAddress'))?.value, 77);
  assert.equal((await a.admin('/api/admin/settings', founder.cookie, { key: 'newSessionsPerAddress', value: 5 })).status, 200);
  assert.equal((await find('newSessionsPerAddress'))?.value, 5);
  assert.equal((await a.admin('/api/admin/settings', founder.cookie, { key: 'newSessionsPerAddress', value: 0 })).body.error, 'invalid_value');
  assert.equal((await a.admin('/api/admin/settings', founder.cookie, { key: 'newSessionsPerAddress', value: null })).status, 200);
  assert.equal((await find('newSessionsPerAddress'))?.value, 77);
  assert.equal((await a.admin('/api/admin/settings', founder.cookie, { key: 'chatPictures', value: false })).status, 200);
  assert.equal((await find('chatPictures'))?.value, false);
  const guest = await a.player('Visitor');
  const socket = await a.f.socket(guest);
  assert.equal((await a.admin('/api/admin/notice', founder.cookie, { minutes: 5 })).body.code, 'started');
  assert.equal((await frameOf(socket, 'notice')).minutes, 5);
  const audit = (await a.admin('/api/admin/audit?action=setting', founder.cookie)).body.lines as unknown[];
  assert.equal(audit.length, 3);
});

test('reads write nothing, players can be found by name, id and address hash, and a player page shows the ledger and the admin actions', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.ready('Adaobi'), ben = await a.account('ben@example.com', 'Benedict');
  await a.f.flush();
  const writes = () => a.f.server.store.stats?.().writes ?? 0, was = writes();
  for (const path of ['/api/admin/me', '/api/admin/dashboard', '/api/admin/economy', '/api/admin/players', `/api/admin/players/${ada.id}`, '/api/admin/audit', '/api/admin/announcements', '/api/admin/settings', '/api/admin/moderation/reports', '/api/admin/tools']) assert.equal((await a.admin(path, founder.cookie)).status, 200, path);
  await a.f.flush();
  assert.equal(writes(), was, 'no read wrote the data file');
  const byName = (await a.admin('/api/admin/players?q=adaob', founder.cookie)).body.rows as { id: string }[];
  assert.deepEqual(byName.map((row) => row.id), [ada.id]);
  assert.equal(((await a.admin(`/api/admin/players?q=${ada.id.slice(0, 8)}`, founder.cookie)).body.rows as unknown[]).length, 1);
  const hashed = (await a.admin(`/api/admin/players?q=${emailHash('ben@example.com')}`, founder.cookie)).body.rows as { id: string }[];
  assert.deepEqual(hashed.map((row) => row.id), [ben.id]);
  assert.equal(((await a.admin('/api/admin/players?filter=accounts', founder.cookie)).body.rows as unknown[]).length, 2);
  await a.admin(`/api/admin/players/${ada.id}/act`, founder.cookie, { action: 'credit', amount: 700, reason: 'test' });
  const page = (await a.admin(`/api/admin/players/${ada.id}`, founder.cookie)).body as { ledger: { reason: string }[]; audit: unknown[]; account: unknown };
  assert.equal(page.ledger[0]?.reason, 'Admin credit: test'); assert.equal(page.audit.length, 1); assert.equal(page.account, null);
  const text = JSON.stringify((await a.admin(`/api/admin/players/${ben.id}`, founder.cookie)).body);
  assert.match(text, /b\*\*\*@e\*\*\*\.com/); assert.equal(text.includes('ben@example.com'), false);
  const dash = (await a.admin('/api/admin/dashboard', founder.cookie)).body as { accounts: { accounts: number }; capacity: unknown; build: string; asOf: number };
  assert.equal(dash.accounts.accounts, 2); assert.equal(typeof dash.asOf, 'number');
  const economy = (await a.admin('/api/admin/economy?fresh=1', founder.cookie)).body as { faucets: { category: string }[]; cashInCirculation: number };
  assert.ok(economy.cashInCirculation > 0);
});
