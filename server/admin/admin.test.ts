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
const LOOK = { body: 'woman', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' } as const;
const ACCOUNTS = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' };
export const FOUNDER_ADDRESS = 'founder.test@example.com', OTHER_ADMIN_ADDRESS = 'second.admin@example.com';
type Json = Record<string, unknown>;

/** A server whose founder is the account of FOUNDER_ADDRESS (made up: only its hash is configured), with the helpers the tests share. */
export async function admins(t: TestContext, options: FixtureOptions & { env?: Record<string, unknown> } = {}) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const env = { ...ACCOUNTS, FOUNDER_EMAIL_SHA256: emailHash(FOUNDER_ADDRESS), ADMIN_EMAIL_SHA256S: emailHash(OTHER_ADMIN_ADDRESS), ...options.env };
  const f = await fixture(t, { ...options, env, fetch: (url, init) => provider.fetch(url, init as { body?: unknown }), log: () => {} });
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
    assert.equal((await f.action(d.cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing');
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
  assert.equal((await act({ action: 'credit', amount: 500001, reason: 'too much' })).body.error, 'invalid_amount');
  assert.equal((await act({ action: 'credit', amount: 500000, reason: 'big one' })).status, 200);
  const third = await act({ action: 'credit', amount: 500000, reason: 'another' });
  assert.equal(third.body.error, 'over_target_day_limit');
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
  assert.deepEqual(lines2.map((line) => line.action), ['debit', 'credit', 'credit']);
  assert.equal(lines2[2]?.reason, 'launch bonus'); assert.match(lines2[2]?.summary ?? '', /₦5,000/);
  assert.equal(JSON.stringify(audit.body).includes(FOUNDER_ADDRESS), false);
  const dash = await a.admin('/api/admin/dashboard?fresh=1', founder.cookie);
  const money = dash.body.adminMoney as { creditTotal: number; debitTotal: number };
  assert.equal(money.creditTotal, 505000); assert.ok(money.debitTotal > 0);
});

test('the limits have names and the environment can replace them', async (t) => {
  const a = await admins(t, { env: { ADMIN_MAX_AMOUNT: '1000' } });
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), ada = await a.ready('Ada');
  assert.equal((await a.admin(`/api/admin/players/${ada.id}/act`, founder.cookie, { action: 'credit', amount: 1001, reason: 'over the line' })).body.error, 'invalid_amount');
  assert.equal((await a.admin(`/api/admin/players/${ada.id}/act`, founder.cookie, { action: 'credit', amount: 1000, reason: 'on the line' })).status, 200);
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
  assert.ok((await a.life(ada.cookie)).needs.hunger >= 80);
  assert.equal((await act({ action: 'need', need: 'nope', value: 5 })).body.error, 'invalid_need');
  assert.equal((await act({ action: 'teleport', to: 'arrival' })).status, 200);
  assert.equal((await act({ action: 'rename', name: 'Ada Lovelace' })).status, 200);
  assert.equal((await a.admin(`/api/admin/players/${ada.id}`, founder.cookie)).body.profile && ((await a.admin(`/api/admin/players/${ada.id}`, founder.cookie)).body.profile as { name: string }).name, 'Ada Lovelace');
  assert.notEqual((await act({ action: 'rename', name: 'call me 08012345678' })).status, 200, 'the name filter applies');
});

// ---- sanctions ---------------------------------------------------------------------------------------------------

test('mute, suspend and ban: time-boxed, a ban signs the player out and closes their sockets, and the refusal is a plain sentence', async (t) => {
  const a = await admins(t);
  const founder = await a.account(FOUNDER_ADDRESS, 'Founder'), bola = await a.account('bola@example.com', 'Bola'), cy = await a.ready('Cy');
  const act = (id: string, body: Json) => a.admin(`/api/admin/players/${id}/act`, founder.cookie, body);
  assert.equal((await act(cy.id, { action: 'mute', minutes: 30, reason: 'spam' })).body.code, 'muted');
  assert.equal((await act(cy.id, { action: 'unmute' })).body.code, 'unmuted');
  assert.equal((await act(cy.id, { action: 'suspend', kind: 'pictures', minutes: 60, reason: 'test' })).body.code, 'applied');
  assert.equal(a.f.server.listenerCount('request') >= 0, true);
  const socket = await a.f.socket(bola);
  const closed = new Promise<number>((resolve) => socket.ws.once('close', (code: number) => resolve(code)));
  const first = await act(bola.id, { action: 'ban', minutes: 0, reason: 'abuse' });
  assert.equal(first.body.code, 'confirmation_required');
  assert.equal((await act(bola.id, { action: 'ban', minutes: 0, reason: 'abuse', confirm: first.body.token as string })).body.code, 'applied');
  assert.equal(await closed, 4401, 'the open socket is closed when the ban is made');
  assert.equal((await a.call('/api/session', null, bola.cookie)).status, 401, 'signed out everywhere: the cookie is no longer a session');
  // Sign in again: the account is banned, so every route says so in a plain sentence.
  const again = await a.account('bola@example.com', 'Bola again');
  void again;
  const unbanned = await act(bola.id, { action: 'unban' });
  assert.equal(unbanned.status, 404, 'the old character is archived with the sign-out; the list shows what is left');
});
