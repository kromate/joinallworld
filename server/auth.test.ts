// OWNER: accounts — the account routes on the Node host (server/routes/auth.ts, server/accounts/service.ts).
// The sign-in provider is a stand-in made here (server/accounts/test-tokens.ts): no test reaches a real one.
// Pattern and rules: see "HOW TO TEST" at the top of server/routes/index.ts.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { fixture, flakyDisk } from './test-fixture.ts';
import type { FixtureOptions } from './test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { MAX_DEVICES, MAX_PARKED } from './accounts/service.ts';
import { RESET_URL, csrfOf, resetAddress } from './routes/auth.ts';
import { accountsConfig } from './host-context.ts';
import type { Database } from './types.ts';
import type { AccountExportResponse, AccountStateResponse, SignInResponse } from '../src/types/account.ts';

const PROJECT = 'allworld-test-project';
/** Placeholders in the shape of the provider's public configuration; none of them names anything real. */
const ENV = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', ACCOUNTS_GOOGLE_CLIENT_ID: '1234567890-testclient.apps.googleusercontent.com' };
type Json = Record<string, unknown>;

async function accounts(t: TestContext, options: FixtureOptions = {}) {
  const key = await makeKey('key-1');
  const provider = fakeProvider([key]);
  /** What the server logged: read by the tests, and kept off the console. */
  const logs: string[] = [];
  const f = await fixture(t, { env: ENV, fetch: (url, init) => provider.fetch(url, init as { body?: unknown }), log: (line) => { logs.push(String(line)); }, ...options });
  /** A request as the game's own page makes it: it names this host as its origin. `headers` may replace or (with null) remove any of them. */
  const call = (path: string, body?: unknown, cookie?: string | null, headers: Record<string, string | null> = {}): Promise<Response> => {
    const all: Record<string, string | null> = { Origin: f.base, ...(body !== undefined && body !== null ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers };
    return fetch(f.base + path, { method: body !== undefined && body !== null ? 'POST' : 'GET', headers: Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== null)), body: body !== undefined && body !== null ? JSON.stringify(body) : undefined });
  };
  // Each sign-in at the provider yields a different token; `n` stands for whatever makes two of them differ.
  let minted = 0;
  const token = (subject: string, extra: Json = {}): Promise<string> => signToken(key, claimsFor(PROJECT, f.now(), { subject, email: `${subject.toLowerCase()}@example.com`, n: ++minted, ...extra }));
  const state = async (cookie?: string | null): Promise<AccountStateResponse> => (await call('/api/account', null, cookie)).json() as Promise<AccountStateResponse>;
  const csrf = async (cookie?: string | null): Promise<string | null> => (cookie ? (await state(cookie)).csrf : null);
  /** POST a state-changing account route with this cookie's own anti-forgery token. */
  const change = async (path: string, body: Json, cookie?: string | null): Promise<Response> => call(path, { ...body, csrf: await csrf(cookie) }, cookie);
  async function signIn(subject: string, cookie?: string | null, extra: Json = {}) {
    const response = await change('/api/account/sign-in', { idToken: await token(subject, extra) }, cookie);
    const set = response.headers.get('set-cookie');
    return { status: response.status, body: await response.json() as SignInResponse & { error?: string }, cookie: set ? set.split(';')[0] ?? '' : '', setCookie: set ?? '' };
  }
  /** A guest with a played life in Lagos. */
  async function player(name: string) { const device = await f.device(name); await f.request('/api/life?city=lagos', null, device.cookie); return device; }
  const whoAmI = async (cookie: string): Promise<{ status: number; id?: string; name?: string }> => { const response = await call('/api/session', null, cookie); const body = await response.json() as { session?: { id: string; name: string } }; return { status: response.status, ...(body.session ? { id: body.session.id, name: body.session.name } : {}) }; };
  const stored = async (): Promise<Database> => { await f.flush(); return JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')) as Database; };
  return { f, key, provider, logs, call, token, state, csrf, change, signIn, player, whoAmI, stored };
}
const errorOf = async (response: Response): Promise<[number, unknown]> => [response.status, (await response.json() as { error?: unknown }).error];

test('configuration: accounts need a well-formed project id and API key; the Google button needs its client id', () => {
  assert.equal(accountsConfig({}), null);
  assert.equal(accountsConfig({ ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT }), null, 'a project without its key is not a configuration');
  assert.equal(accountsConfig({ ...ENV, ACCOUNTS_FIREBASE_PROJECT_ID: 'Not A Project' }), null);
  assert.equal(accountsConfig({ ...ENV, ACCOUNTS_FIREBASE_API_KEY: 'short' }), null);
  assert.deepEqual(accountsConfig(ENV), { projectId: PROJECT, apiKey: ENV.ACCOUNTS_FIREBASE_API_KEY, googleClientId: ENV.ACCOUNTS_GOOGLE_CLIENT_ID });
  assert.equal(accountsConfig({ ...ENV, ACCOUNTS_GOOGLE_CLIENT_ID: 'not-a-client-id' })?.googleClientId, '', 'a malformed client id only hides the Google button');
  assert.equal(accountsConfig(null), null);
});

test('GET /api/account: the public configuration, the state of this browser, and no token, cookie or subject id', async t => {
  const a = await accounts(t);
  const nobody = await a.state();
  assert.deepEqual(nobody, { enabled: true, provider: { apiKey: ENV.ACCOUNTS_FIREBASE_API_KEY, googleClientId: ENV.ACCOUNTS_GOOGLE_CLIENT_ID }, csrf: null, account: null, character: null, parked: [], guest: false, serverTime: a.f.now() });
  const ada = await a.player('Ada');
  const guest = await a.state(ada.cookie);
  assert.equal(guest.guest, true); assert.equal(guest.account, null); assert.match(guest.csrf ?? '', /^[A-Za-z0-9_-]{43}$/);
  const signed = await a.signIn('UidAda', ada.cookie);
  const mine = await a.state(signed.cookie);
  assert.deepEqual(mine.account, { email: 'uidada@example.com', provider: 'password', createdAt: a.f.now(), devices: 1 });
  assert.deepEqual(mine.character, { id: ada.id, name: 'Ada' });
  const text = JSON.stringify(mine);
  for (const secret of [signed.cookie.slice(4), ada.cookie.slice(4), 'UidAda', 'eyJ']) assert.ok(!text.includes(secret), `the account state must not carry ${secret}`);
  assert.equal(a.provider.requests.some(request => request.url.includes('identitytoolkit')), false, 'reading the state asks the provider nothing');
});

test('save your character: signing in links this browser’s life to the account, under a new cookie', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const signed = await a.signIn('UidAda', ada.cookie);
  assert.equal(signed.status, 200);
  assert.deepEqual({ outcome: signed.body.outcome, created: signed.body.created, character: signed.body.character, parked: signed.body.parked }, { outcome: 'linked', created: true, character: { id: ada.id, name: 'Ada' }, parked: null });
  // The cookie is new, made by the server, with the flags the device cookie has always had.
  assert.match(signed.cookie, /^sid=[0-9a-f-]{36}$/); assert.notEqual(signed.cookie, ada.cookie);
  assert.match(signed.setCookie, /HttpOnly/); assert.match(signed.setCookie, /SameSite=Lax/); assert.match(signed.setCookie, /Path=\//); assert.match(signed.setCookie, /Max-Age=2592000/);
  assert.equal(signed.body.csrf, await csrfOf(signed.cookie.slice(4)), 'the answer carries the token of the NEW cookie');
  // Same character, same public id; the old cookie is dead.
  assert.deepEqual(await a.whoAmI(signed.cookie), { status: 200, id: ada.id, name: 'Ada' });
  assert.equal((await a.whoAmI(ada.cookie)).status, 401, 'the cookie presented at sign-in is never kept');
  assert.equal((await a.call('/api/life?city=lagos', null, signed.cookie)).status, 200);
  assert.equal((await a.f.action(signed.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true, 'the game plays on under the new cookie');
  // What is stored: the character is filed under a key no browser holds, and only what the design names is kept about the person.
  const db = await a.stored(), account = Object.values(db.accounts ?? {})[0];
  assert.ok(account);
  assert.deepEqual(Object.keys(account).sort(), ['createdAt', 'devices', 'email', 'id', 'lastSeenAt', 'parked', 'provider', 'publicId', 'sessionKey', 'subject', 'v']);
  assert.deepEqual({ provider: account.provider, subject: account.subject, email: account.email, publicId: account.publicId, devices: account.devices }, { provider: 'password', subject: 'UidAda', email: 'uidada@example.com', publicId: ada.id, devices: [signed.cookie.slice(4)] });
  const record = db.sessions[account.sessionKey ?? ''];
  assert.equal(record?.account, account.id); assert.equal(record?.publicId, ada.id);
  assert.notEqual(account.sessionKey, signed.cookie.slice(4)); assert.notEqual(account.sessionKey, ada.cookie.slice(4));
  assert.equal(db.sessions[ada.cookie.slice(4)], undefined);
  assert.deepEqual(Object.keys(db.accountDevices?.[signed.cookie.slice(4)] ?? {}).sort(), ['account', 'createdAt', 'expiresAt', 'seenAt']);
});

test('a guest in the middle of the quick start saves that same unfinished character', async t => {
  const a = await accounts(t);
  const made = await a.f.request('/api/session', { name: 'Newcomer', onboarding: true });
  const cookie = made.headers.get('set-cookie')?.split(';')[0] ?? '', id = (await made.json() as { session: { id: string } }).session.id;
  await a.f.request('/api/life?city=lagos', null, cookie);
  const signed = await a.signIn('UidNew', cookie);
  assert.equal(signed.body.outcome, 'linked');
  assert.deepEqual(await a.whoAmI(signed.cookie), { status: 200, id, name: 'Newcomer' });
  const life = await (await a.call('/api/life?city=lagos', null, signed.cookie)).json() as { state: { onboarding: { required: boolean } } };
  assert.equal(life.state.onboarding.required, true, 'the quick start is still to be finished, exactly as before');
});

test('restore: signing in on another device attaches it to the account’s character, and both devices play it', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const laptop = await a.signIn('UidAda', ada.cookie);
  const phone = await a.signIn('UidAda');
  assert.deepEqual({ status: phone.status, outcome: phone.body.outcome, created: phone.body.created, character: phone.body.character }, { status: 200, outcome: 'restored', created: false, character: { id: ada.id, name: 'Ada' } });
  assert.notEqual(phone.cookie, laptop.cookie);
  assert.deepEqual(await a.whoAmI(phone.cookie), { status: 200, id: ada.id, name: 'Ada' });
  assert.deepEqual(await a.whoAmI(laptop.cookie), { status: 200, id: ada.id, name: 'Ada' }, 'the first device stays signed in');
  // One life: what one device does, the other sees.
  const moved = await a.f.action(phone.cookie, { type: 'travel', id: 'library', mode: 'trek' });
  assert.equal(moved.ok, true);
  const seen = await (await a.call('/api/life?city=lagos', null, laptop.cookie)).json() as { state: { activeAction: { kind: string } | null } };
  assert.equal(seen.state.activeAction?.kind, 'travel');
  assert.equal((await a.state(phone.cookie)).account?.devices, 2);
  // A browser holding an unplayed session (a nickname, no life) is attached too; that empty session leaves nothing behind.
  const empty = await a.f.device('Tablet');
  const tablet = await a.signIn('UidAda', empty.cookie);
  assert.equal(tablet.body.outcome, 'restored'); assert.deepEqual(await a.whoAmI(tablet.cookie), { status: 200, id: ada.id, name: 'Ada' });
  const db = await a.stored();
  assert.equal(db.sessions[empty.cookie.slice(4)], undefined); assert.equal(db.archivedLives?.[empty.id], undefined);
  assert.equal(Object.keys(db.sessions).length, 1, 'three browsers, one character record');
});

test('signing in before there is any character: the next new life becomes the account’s character', async t => {
  const a = await accounts(t);
  const signed = await a.signIn('UidNew');
  assert.deepEqual({ outcome: signed.body.outcome, character: signed.body.character, created: signed.body.created }, { outcome: 'signed_in', character: null, created: true });
  assert.equal((await a.whoAmI(signed.cookie)).status, 401, 'no character yet: the client asks for a nickname as it does on any new device');
  const made = await a.call('/api/session', { name: 'Chidi', onboarding: true }, signed.cookie);
  assert.equal(made.status, 200);
  assert.equal(made.headers.get('set-cookie')?.split(';')[0], signed.cookie, 'the browser keeps its sign-in cookie: the new record’s key is never sent');
  const id = (await made.json() as { session: { id: string } }).session.id;
  assert.deepEqual(await a.whoAmI(signed.cookie), { status: 200, id, name: 'Chidi' });
  const db = await a.stored(), account = Object.values(db.accounts ?? {})[0];
  assert.equal(account?.publicId, id); assert.equal(db.sessions[account?.sessionKey ?? '']?.account, account?.id); assert.equal(db.sessions[account?.sessionKey ?? '']?.onboarding, true);
  assert.equal(Object.keys(db.sessions).length, 1);
  // And from another device that character is restored.
  const other = await a.signIn('UidNew');
  assert.equal(other.body.outcome, 'restored'); assert.equal((await a.whoAmI(other.cookie)).id, id);
});

test('merge: a device with a played life signs in to an account that has a character — neither is lost, and the choice is explicit', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  await a.signIn('UidAda', ada.cookie);
  const bola = await a.player('Bola');
  assert.equal((await a.f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
  const signed = await a.signIn('UidAda', bola.cookie);
  // The default: the account's character is the active one; the device's life is set aside, recoverable.
  assert.deepEqual({ outcome: signed.body.outcome, character: signed.body.character }, { outcome: 'parked', character: { id: ada.id, name: 'Ada' } });
  assert.deepEqual(signed.body.parked, { id: bola.id, name: 'Bola', at: a.f.now() });
  assert.deepEqual(await a.whoAmI(signed.cookie), { status: 200, id: ada.id, name: 'Ada' });
  assert.equal((await a.whoAmI(bola.cookie)).status, 401);
  let db = await a.stored();
  const aside = db.archivedLives?.[bola.id];
  assert.equal(aside?.account, Object.keys(db.accounts ?? {})[0]); assert.equal(aside?.name, 'Bola'); assert.ok(aside?.cities.lagos?.state, 'the set-aside life is kept whole');
  assert.equal(JSON.stringify(aside).includes(bola.cookie.slice(4)), false, 'without its cookie');
  assert.deepEqual((await a.state(signed.cookie)).parked, [{ id: bola.id, name: 'Bola', at: a.f.now() }]);
  // The choice: play the set-aside character instead. The one that was active is set aside in its place.
  const adaCash = (await (await a.call('/api/life?city=lagos', null, signed.cookie)).json() as { state: { cash: number } }).state.cash;
  const chosen = await a.change('/api/account/character', { use: bola.id }, signed.cookie);
  assert.equal(chosen.status, 200);
  const choice = await chosen.json() as { character: unknown; parked: { id: string }[] };
  assert.deepEqual(choice.character, { id: bola.id, name: 'Bola' }); assert.deepEqual(choice.parked.map(item => item.id), [ada.id]);
  assert.equal(chosen.headers.get('set-cookie'), null, 'choosing a character changes no cookie');
  assert.deepEqual(await a.whoAmI(signed.cookie), { status: 200, id: bola.id, name: 'Bola' });
  // And back again: nothing was lost on either side.
  assert.equal((await a.change('/api/account/character', { use: ada.id }, signed.cookie)).status, 200);
  assert.deepEqual(await a.whoAmI(signed.cookie), { status: 200, id: ada.id, name: 'Ada' });
  assert.equal((await (await a.call('/api/life?city=lagos', null, signed.cookie)).json() as { state: { cash: number } }).state.cash, adaCash);
  db = await a.stored();
  assert.equal(Object.keys(db.sessions).length, 1); assert.ok(db.archivedLives?.[bola.id]); assert.equal(db.archivedLives?.[ada.id], undefined);
  // An account whose own character was never played takes the played life in hand instead of setting it aside.
  const fresh = await a.signIn('UidFresh');
  await a.call('/api/session', { name: 'Unplayed', onboarding: true }, fresh.cookie);
  await a.change('/api/account/sign-out', {}, fresh.cookie);
  const dayo = await a.player('Dayo');
  const taken = await a.signIn('UidFresh', dayo.cookie);
  assert.deepEqual({ outcome: taken.body.outcome, character: taken.body.character, parked: taken.body.parked }, { outcome: 'linked', character: { id: dayo.id, name: 'Dayo' }, parked: null });
});

test('merge abuse: only the account’s own set-aside characters can be chosen, and setting aside is bounded', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const mine = await a.signIn('UidAda', ada.cookie);
  // Another account sets a life aside; a stranger's expired life sits in the archive too.
  const eve = await a.player('Eve'), other = await a.signIn('UidEve', eve.cookie);
  const spare = await a.player('Spare'), parkedByEve = await a.signIn('UidEve', spare.cookie);
  assert.equal(parkedByEve.body.outcome, 'parked');
  const stranger = await a.player('Stranger');
  await a.f.server.store.transact((db) => { const session = db.sessions[stranger.cookie.slice(4)]; if (session) session.expiresAt = a.f.now() - 1; });
  await a.f.request('/api/session', { name: 'Sweeper' }); // the sweep archives the expired stranger
  assert.ok((await a.stored()).archivedLives?.[stranger.id]);
  for (const target of [spare.id, stranger.id, eve.id, ada.id, 'constructor', '', null, 42, { id: spare.id }]) {
    assert.deepEqual(await errorOf(await a.change('/api/account/character', { use: target }, mine.cookie)), [404, 'character_not_found'], JSON.stringify(target));
  }
  assert.deepEqual(await a.whoAmI(mine.cookie), { status: 200, id: ada.id, name: 'Ada' });
  assert.equal((await a.stored()).archivedLives?.[spare.id]?.account, 'fb:UidEve', 'the other account’s character is untouched');
  // A guest cannot choose anything, and neither can a signed-out browser.
  const guest = await a.player('Guest');
  assert.deepEqual(await errorOf(await a.change('/api/account/character', { use: spare.id }, guest.cookie)), [409, 'account_required']);
  assert.deepEqual(await errorOf(await a.change('/api/account/character', { use: spare.id }, null)), [409, 'account_required']);
  // Setting lives aside is bounded: the sixth is refused and that device simply stays a guest, life intact.
  for (let i = 1; i < MAX_PARKED; i++) { const extra = await a.player(`Extra${i}`); a.f.advance(61000); assert.equal((await a.signIn('UidEve', extra.cookie)).body.outcome, 'parked'); }
  a.f.advance(301000);
  const last = await a.player('OneTooMany'), refused = await a.signIn('UidEve', last.cookie);
  assert.deepEqual([refused.status, refused.body.error, refused.setCookie], [409, 'parked_full', '']);
  assert.deepEqual(await a.whoAmI(last.cookie), { status: 200, id: last.id, name: 'OneTooMany' }, 'the refused sign-in changed nothing');
  assert.equal((await a.state(other.cookie)).parked.length, MAX_PARKED);
});

test('sign out unbinds this device only; the character stays with the account', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const laptop = await a.signIn('UidAda', ada.cookie), phone = await a.signIn('UidAda');
  const out = await a.change('/api/account/sign-out', {}, phone.cookie);
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie') ?? '', /^sid=; HttpOnly; SameSite=Lax; Path=\/; Max-Age=0/, 'the cookie is removed with the attributes it was set with');
  assert.equal((await a.whoAmI(phone.cookie)).status, 401, 'the signed-out cookie is dead on the server, not only in the browser');
  assert.equal((await a.call('/api/life?city=lagos', null, phone.cookie)).status, 401);
  assert.deepEqual(await a.whoAmI(laptop.cookie), { status: 200, id: ada.id, name: 'Ada' });
  assert.equal((await a.state(laptop.cookie)).account?.devices, 1);
  // Signing in again brings the same character back.
  const again = await a.signIn('UidAda');
  assert.equal(again.body.outcome, 'restored'); assert.equal((await a.whoAmI(again.cookie)).id, ada.id);
  // A guest has no account to sign out of — and is not signed out of its only key to its life.
  const guest = await a.player('Guest');
  assert.deepEqual(await errorOf(await a.change('/api/account/sign-out', {}, guest.cookie)), [409, 'account_required']);
  assert.equal((await a.whoAmI(guest.cookie)).status, 200);
  assert.deepEqual(await errorOf(await a.change('/api/account/sign-out', {}, phone.cookie)), [409, 'account_required'], 'a second sign-out finds nothing');
});

test('sign out everywhere ends every other device; this one stays', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const laptop = await a.signIn('UidAda', ada.cookie), phone = await a.signIn('UidAda'), tablet = await a.signIn('UidAda');
  const response = await a.change('/api/account/sign-out-everywhere', {}, laptop.cookie);
  assert.deepEqual([response.status, (await response.json() as { ended: number }).ended, response.headers.get('set-cookie')], [200, 2, null]);
  assert.equal((await a.whoAmI(phone.cookie)).status, 401); assert.equal((await a.whoAmI(tablet.cookie)).status, 401);
  assert.deepEqual(await a.whoAmI(laptop.cookie), { status: 200, id: ada.id, name: 'Ada' });
  const db = await a.stored();
  assert.deepEqual(Object.keys(db.accountDevices ?? {}), [laptop.cookie.slice(4)]); assert.deepEqual(Object.values(db.accounts ?? {})[0]?.devices, [laptop.cookie.slice(4)]);
  // The eleventh device makes room by ending the one signed in first.
  const many = [];
  for (let i = 0; i < MAX_DEVICES; i++) { a.f.advance(61000); many.push(await a.signIn('UidAda')); }
  assert.equal((await a.whoAmI(laptop.cookie)).status, 401, 'the oldest binding made room');
  assert.equal((await a.whoAmI(many.at(-1)?.cookie ?? '')).status, 200); assert.equal((await a.state(many.at(-1)?.cookie)).account?.devices, MAX_DEVICES);
});

test('a socket opened under a session that was signed out, moved or signed out elsewhere is closed', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const guestSocket = await a.f.socket(ada);
  const closedGuest = once(guestSocket.ws, 'close');
  const laptop = await a.signIn('UidAda', ada.cookie);
  assert.equal((await closedGuest)[0], 4401, 'the guest socket ends when its session becomes the account’s character');
  const phone = await a.signIn('UidAda');
  const laptopSocket = await a.f.socket(laptop), phoneSocket = await a.f.socket(phone);
  phoneSocket.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  assert.equal((await phoneSocket.next()).type, 'presence', 'a signed-in device joins rooms as the character');
  const closedPhone = once(phoneSocket.ws, 'close');
  await a.change('/api/account/sign-out-everywhere', {}, laptop.cookie);
  assert.equal((await closedPhone)[0], 4401);
  assert.equal(laptopSocket.ws.readyState, 1, 'the device that asked keeps its socket');
  const closedLaptop = once(laptopSocket.ws, 'close');
  await a.change('/api/account/sign-out', {}, laptop.cookie);
  assert.equal((await closedLaptop)[0], 4401);
  // A signed-out cookie cannot open a socket either.
  const refused = await a.f.socket(laptop).then(() => 'opened', () => 'refused');
  assert.equal(refused, 'refused');
});

test('session fixation: a cookie chosen before sign-in is never the signed-in cookie, and a record’s key is not a credential', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  await a.signIn('UidAda', ada.cookie);
  // The attacker plants THEIR cookie in the victim's browser; the victim then signs in with it.
  const attacker = await a.player('Mallory');
  const victim = await a.signIn('UidAda', attacker.cookie);
  assert.equal(victim.status, 200); assert.notEqual(victim.cookie, attacker.cookie);
  assert.equal((await a.whoAmI(attacker.cookie)).status, 401, 'the planted cookie opens nothing after the sign-in');
  assert.equal((await a.state(attacker.cookie)).account, null);
  // A value the server never issued is not adopted either.
  const invented = 'sid=11111111-2222-4333-8444-555555555555';
  const withInvented = await a.signIn('UidAda', invented);
  assert.equal(withInvented.status, 200); assert.notEqual(withInvented.cookie, invented); assert.equal((await a.whoAmI(invented)).status, 401);
  // The key the character is stored under is refused as a cookie, on every route.
  const db = await a.stored(), key = Object.values(db.accounts ?? {})[0]?.sessionKey ?? '';
  assert.match(key, /^[0-9a-f-]{36}$/);
  assert.equal((await a.whoAmI(`sid=${key}`)).status, 401);
  assert.equal((await a.call('/api/life?city=lagos', null, `sid=${key}`)).status, 401);
  assert.equal((await a.state(`sid=${key}`)).account, null);
  assert.equal(await a.f.socket({ cookie: `sid=${key}` }).then(() => 'opened', () => 'refused'), 'refused');
  // No answer ever sends that key: not the session routes, not a renewal, not the upgrade.
  for (const response of [await a.call('/api/session', null, victim.cookie), await a.call('/api/session', { name: 'Ada' }, victim.cookie), await a.call('/api/life?city=lagos', null, victim.cookie)]) {
    assert.equal(response.headers.get('set-cookie')?.split(';')[0], victim.cookie);
    assert.ok(!(await response.text()).includes(key));
  }
});

test('CSRF: account state changes need this host as Origin and the session’s own token', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const mine = await a.signIn('UidAda', ada.cookie), good = await a.csrf(mine.cookie);
  const routes: [string, Json][] = [['/api/account/sign-out', {}], ['/api/account/sign-out-everywhere', {}], ['/api/account/character', { use: ada.id }], ['/api/account/delete', { confirm: 'delete', idToken: 'x' }], ['/api/account/sign-in', { idToken: 'x' }], ['/api/account/password-reset', { email: 'ada@example.com' }]];
  for (const [path, body] of routes) {
    // No Origin header (the host's general check lets that through): refused here.
    assert.deepEqual(await errorOf(await a.call(path, { ...body, csrf: good }, mine.cookie, { Origin: null })), [403, 'origin_required'], `${path} without an Origin`);
    // Another site's page, or a request the browser itself marks as cross-site.
    assert.deepEqual(await errorOf(await a.call(path, { ...body, csrf: good }, mine.cookie, { Origin: 'https://evil.example' })), [403, 'origin_rejected'], `${path} from another origin`);
    assert.deepEqual(await errorOf(await a.call(path, { ...body, csrf: good }, mine.cookie, { 'Sec-Fetch-Site': 'cross-site' })), [403, 'origin_required'], `${path} marked cross-site`);
    assert.deepEqual(await errorOf(await a.call(path, { ...body, csrf: good }, mine.cookie, { 'Sec-Fetch-Site': 'same-site' })), [403, 'origin_required'], `${path} from a sibling subdomain`);
    // The right origin without the token, with a wrong one, or with another session's.
    assert.deepEqual(await errorOf(await a.call(path, body, mine.cookie)), [403, 'csrf_rejected'], `${path} without a token`);
    assert.deepEqual(await errorOf(await a.call(path, { ...body, csrf: 'A'.repeat(43) }, mine.cookie)), [403, 'csrf_rejected']);
    assert.deepEqual(await errorOf(await a.call(path, { ...body, csrf: await csrfOf(ada.cookie.slice(4)) }, mine.cookie)), [403, 'csrf_rejected'], `${path} with the token of the cookie before sign-in`);
    assert.deepEqual(await errorOf(await a.call(path, { ...body, csrf: [good] }, mine.cookie)), [403, 'csrf_rejected']);
    // A form post cannot reach the routes at all.
    const form = await fetch(a.f.base + path, { method: 'POST', headers: { Origin: a.f.base, Cookie: mine.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `csrf=${good}` });
    assert.equal(form.status, 415, `${path} as a form`);
  }
  assert.deepEqual(await a.whoAmI(mine.cookie), { status: 200, id: ada.id, name: 'Ada' }, 'none of the refused requests changed anything');
  assert.equal((await a.state(mine.cookie)).account?.devices, 1);
  // The token belongs to the cookie: it changed at sign-in, and each session has its own.
  assert.notEqual(good, await csrfOf(ada.cookie.slice(4)));
  const other = await a.player('Other');
  assert.notEqual(await a.csrf(other.cookie), good);
  // Login CSRF: a forged sign-in (the attacker's own valid token) cannot be planted into a victim's session from another site.
  const planted = await a.call('/api/account/sign-in', { idToken: await a.token('UidMallory') }, other.cookie, { Origin: 'https://evil.example' });
  assert.equal(planted.status, 403); assert.equal((await a.state(other.cookie)).account, null);
  assert.deepEqual(await errorOf(await a.call('/api/account/sign-in', { idToken: await a.token('UidMallory') }, other.cookie)), [403, 'csrf_rejected']);
  // The state and export routes are reads; another origin is refused by the host and cannot read them.
  assert.equal((await a.call('/api/account', null, mine.cookie, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await a.call('/api/account/export', null, mine.cookie, { Origin: 'https://evil.example' })).status, 403);
});

test('token replay: an ID token signs in once', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const idToken = await a.token('UidAda');
  const first = await a.call('/api/account/sign-in', { idToken, csrf: await a.csrf(ada.cookie) }, ada.cookie);
  assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie')?.split(';')[0] ?? '';
  // The same token again — from a thief with no session, from another guest, from the owner.
  assert.deepEqual(await errorOf(await a.call('/api/account/sign-in', { idToken })), [401, 'invalid_token']);
  const thief = await a.player('Thief');
  assert.deepEqual(await errorOf(await a.change('/api/account/sign-in', { idToken }, thief.cookie)), [401, 'invalid_token']);
  assert.deepEqual(await errorOf(await a.change('/api/account/sign-in', { idToken }, cookie)), [401, 'invalid_token']);
  assert.deepEqual(await errorOf(await a.change('/api/account/delete', { idToken, confirm: 'delete' }, cookie)), [401, 'invalid_token'], 'a used token deletes nothing either');
  assert.equal((await a.state(thief.cookie)).account, null); assert.equal((await a.state(cookie)).account?.devices, 1);
  // What is remembered is a digest, never the token; and it is forgotten once the token is too old to be accepted anyway.
  let db = await a.stored();
  const text = JSON.stringify(db);
  for (const part of idToken.split('.')) assert.ok(!text.includes(part), 'no part of a token is stored');
  assert.equal(Object.keys(db.accountLog?.used ?? {}).length, 1); assert.match(Object.keys(db.accountLog?.used ?? {})[0] ?? '', /^[A-Za-z0-9_-]{43}$/);
  a.f.advance(8 * 60000);
  assert.deepEqual(await errorOf(await a.call('/api/account/sign-in', { idToken })), [401, 'invalid_token'], 'by then the token is stale');
  await a.signIn('UidAda');
  db = await a.stored();
  assert.equal(Object.keys(db.accountLog?.used ?? {}).length, 1, 'the old digest was dropped when the next one was written');
});

test('an unverified address links nothing; the same account works once the provider says it is verified', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const unverified = await a.signIn('UidAda', ada.cookie, { verified: false });
  assert.deepEqual([unverified.status, unverified.body.error, unverified.setCookie], [403, 'email_unverified', '']);
  assert.deepEqual(await a.whoAmI(ada.cookie), { status: 200, id: ada.id, name: 'Ada' }, 'the guest plays on');
  const db = await a.stored();
  assert.equal(db.accounts, undefined); assert.equal(db.accountDevices, undefined); assert.equal(db.accountLog, undefined, 'nothing at all was stored');
  // A Google sign-in whose address the provider has not verified is refused the same way.
  assert.equal((await a.signIn('UidGoogle', null, { provider: 'google.com', verified: false })).body.error, 'email_unverified');
  const verified = await a.signIn('UidAda', ada.cookie);
  assert.deepEqual([verified.status, verified.body.outcome], [200, 'linked']);
  // A request cannot vouch for itself: fields beside the token are ignored.
  const bola = await a.player('Bola');
  const forged = await a.call('/api/account/sign-in', { idToken: await a.token('UidBola', { verified: false }), csrf: await a.csrf(bola.cookie), uid: 'UidAda', subject: 'UidAda', email: 'uidada@example.com', emailVerified: true, email_verified: true }, bola.cookie);
  assert.deepEqual(await errorOf(forged), [403, 'email_unverified']);
  const asBola = await a.call('/api/account/sign-in', { idToken: await a.token('UidBola'), csrf: await a.csrf(bola.cookie), uid: 'UidAda', subject: 'UidAda', localId: 'UidAda' }, bola.cookie);
  assert.equal(asBola.status, 200);
  assert.equal((await a.state(asBola.headers.get('set-cookie')?.split(';')[0])).account?.email, 'uidbola@example.com', 'the account is the token’s subject, never a uid sent beside it');
});

test('enumeration: every refused token gets the same answer, and a reset request says the same thing for every address', async t => {
  const a = await accounts(t, { trustProxy: true });
  const stranger = await makeKey('key-1'), at = Math.floor(a.f.now() / 1000);
  const bad: [string, string][] = [
    ['expired', await a.token('UidAda', { exp: at - 5 })], ['stale', await a.token('UidAda', { iat: at - 900 })], ['wrong audience', await a.token('UidAda', { aud: 'another-project' })],
    ['wrong issuer', await a.token('UidAda', { iss: 'https://accounts.google.com' })], ['bad signature', await signToken(stranger, claimsFor(PROJECT, a.f.now()))],
    ['unknown account provider', await a.token('UidAda', { firebase: { sign_in_provider: 'anonymous' } })], ['not a token', 'not.a.token'], ['empty', ''],
  ];
  const answers = new Set<string>();
  let n = 0;
  for (const [what, idToken] of bad) {
    const response = await a.call('/api/account/sign-in', { idToken }, null, { 'X-Forwarded-For': `203.0.113.${++n}` });
    assert.equal(response.status, 401, what); assert.equal(response.headers.get('set-cookie'), null);
    answers.add(JSON.stringify({ ...(await response.json() as Json), serverTime: 0 }));
  }
  assert.deepEqual([...answers], ['{"error":"invalid_token","serverTime":0}'], 'one answer for every kind of bad token');
  assert.ok(a.logs.some(line => line === 'Account token refused: audience'), 'the operator can see why, without the token');
  assert.ok(!a.logs.some(line => line.includes('eyJ')), 'no token is ever logged');
  // Password reset: the provider is asked, but its answer never reaches the browser.
  const replies: Record<string, Response> = { 'known@example.com': new Response('{"kind":"ok","email":"known@example.com"}', { status: 200 }), 'unknown@example.com': new Response('{"error":{"code":400,"message":"EMAIL_NOT_FOUND"}}', { status: 400 }) };
  const original = a.provider.fetch;
  a.provider.fetch = async (url, init = {}) => { const reply = await original(url, init); const body = a.provider.requests.at(-1)?.body as { email?: string } | null; return String(url).startsWith(RESET_URL) ? replies[body?.email ?? ''] ?? reply : reply; };
  const seen: string[] = [];
  for (const email of ['known@example.com', 'unknown@example.com']) {
    const response = await a.call('/api/account/password-reset', { email }, null, { 'X-Forwarded-For': '203.0.113.50' });
    seen.push(JSON.stringify([response.status, { ...(await response.json() as Json), serverTime: 0 }, response.headers.get('set-cookie')]));
  }
  assert.deepEqual(seen, [seen[0], seen[0]]); assert.equal(seen[0], '[200,{"ok":true,"serverTime":0},null]');
  await new Promise(resolve => setTimeout(resolve, 20));
  const sent = a.provider.requests.filter(request => request.url === RESET_URL);
  assert.deepEqual(sent.map(request => request.body), [{ requestType: 'PASSWORD_RESET', email: 'known@example.com' }, { requestType: 'PASSWORD_RESET', email: 'unknown@example.com' }]);
  assert.ok(!a.logs.some(line => /example\.com/.test(line)), 'no address is logged');
  // The answer does not wait for the provider: one that never answers changes nothing about the reply.
  a.provider.fetch = () => new Promise<Response>(() => {});
  const hung = await a.call('/api/account/password-reset', { email: 'slow@example.com' }, null, { 'X-Forwarded-For': '203.0.113.51' });
  assert.deepEqual([hung.status, (await hung.json() as Json).ok], [200, true]);
  // Only the SHAPE of an address is ever judged, which says nothing about accounts.
  for (const email of ['', 'no-at', 'a@b@c', 'spa ce@example.com', '<x>@example.com', 42, null]) assert.deepEqual(await errorOf(await a.call('/api/account/password-reset', { email }, null, { 'X-Forwarded-For': '203.0.113.52' })), [400, 'invalid_email'], String(email));
  assert.equal(resetAddress('  Ada@Example.COM '), 'ada@example.com');
  assert.deepEqual(await a.f.server.store.read(db => [db.accounts, db.accountDevices, db.accountLog]), [undefined, undefined, undefined], 'neither a refused token nor a reset request stores anything');
});

test('rate limits: per address and per account for sign-in, per address and per address written to for a reset', async t => {
  const a = await accounts(t, { trustProxy: true });
  const from = (ip: string) => ({ 'X-Forwarded-For': ip });
  // Ten sign-in attempts a minute from one address, good or bad.
  for (let i = 0; i < 10; i++) assert.equal((await a.call('/api/account/sign-in', { idToken: 'not.a.token' }, null, from('198.51.100.1'))).status, 401);
  assert.deepEqual(await errorOf(await a.call('/api/account/sign-in', { idToken: await a.token('UidAda') }, null, from('198.51.100.1'))), [429, 'account_rate_limited'], 'even a good token waits');
  assert.equal((await a.call('/api/account/sign-in', { idToken: await a.token('UidAda') }, null, from('198.51.100.2'))).status, 200, 'another address is not affected');
  a.f.advance(61000);
  assert.equal((await a.call('/api/account/sign-in', { idToken: await a.token('UidAda') }, null, from('198.51.100.1'))).status, 200, 'the window passes');
  // Eight sign-ins per five minutes for one account, however many addresses they come from.
  a.f.advance(301000);
  for (let i = 0; i < 8; i++) assert.equal((await a.call('/api/account/sign-in', { idToken: await a.token('UidBusy') }, null, from(`198.51.100.${10 + i}`))).status, 200, `sign-in ${i + 1}`);
  assert.deepEqual(await errorOf(await a.call('/api/account/sign-in', { idToken: await a.token('UidBusy') }, null, from('198.51.100.99'))), [429, 'account_rate_limited']);
  assert.equal((await a.call('/api/account/sign-in', { idToken: await a.token('UidQuiet') }, null, from('198.51.100.99'))).status, 200, 'another account is not affected');
  // Resets: five per fifteen minutes from one address …
  for (let i = 0; i < 5; i++) assert.equal((await a.call('/api/account/password-reset', { email: `person${i}@example.com` }, null, from('198.51.100.200'))).status, 200);
  assert.deepEqual(await errorOf(await a.call('/api/account/password-reset', { email: 'person9@example.com' }, null, from('198.51.100.200'))), [429, 'account_rate_limited']);
  // … and three an hour to one address, wherever they come from and whatever its capitalisation.
  for (let i = 0; i < 3; i++) assert.equal((await a.call('/api/account/password-reset', { email: i === 1 ? 'Target@Example.com' : 'target@example.com' }, null, from(`198.51.100.${210 + i}`))).status, 200);
  assert.deepEqual(await errorOf(await a.call('/api/account/password-reset', { email: 'target@example.com' }, null, from('198.51.100.220'))), [429, 'account_rate_limited']);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(a.provider.requests.filter(request => request.url === RESET_URL).length, 8, 'a refused request never reaches the provider');
});

test('delete: needs a fresh token for the same account; the character is kept as a guest life or erased, as asked', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const laptop = await a.signIn('UidAda', ada.cookie), phone = await a.signIn('UidAda');
  const spare = await a.player('Spare'); a.f.advance(1000);
  const tablet = await a.signIn('UidAda', spare.cookie);
  assert.equal(tablet.body.outcome, 'parked');
  // A cookie alone deletes nothing; neither does another person's token, a guest, or a missing confirmation.
  assert.deepEqual(await errorOf(await a.change('/api/account/delete', { confirm: 'delete' }, laptop.cookie)), [401, 'invalid_token']);
  assert.deepEqual(await errorOf(await a.change('/api/account/delete', { confirm: 'delete', idToken: await a.token('UidMallory') }, laptop.cookie)), [403, 'account_mismatch']);
  assert.deepEqual(await errorOf(await a.change('/api/account/delete', { idToken: await a.token('UidAda') }, laptop.cookie)), [400, 'confirmation_required']);
  const guest = await a.player('Guest');
  assert.deepEqual(await errorOf(await a.change('/api/account/delete', { confirm: 'delete', idToken: await a.token('UidAda') }, guest.cookie)), [409, 'account_required']);
  assert.equal((await a.state(laptop.cookie)).account?.devices, 3);
  // Delete, keeping the character on this device.
  const gone = await a.change('/api/account/delete', { confirm: 'delete', idToken: await a.token('UidAda') }, laptop.cookie);
  assert.deepEqual([gone.status, await gone.json().then(body => (body as { kept: boolean }).kept)], [200, true]);
  const guestCookie = gone.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.match(guestCookie, /^sid=[0-9a-f-]{36}$/); assert.notEqual(guestCookie, laptop.cookie);
  assert.deepEqual(await a.whoAmI(guestCookie), { status: 200, id: ada.id, name: 'Ada' }, 'the character plays on as an ordinary guest life');
  assert.deepEqual({ account: (await a.state(guestCookie)).account, guest: (await a.state(guestCookie)).guest }, { account: null, guest: true });
  for (const cookie of [laptop.cookie, phone.cookie, tablet.cookie]) assert.equal((await a.whoAmI(cookie)).status, 401, 'every signed-in device is ended');
  let db = await a.stored();
  assert.deepEqual(db.accounts, {}); assert.deepEqual(db.accountDevices, {});
  assert.equal(db.archivedLives?.[spare.id], undefined, 'set-aside characters go with the account');
  assert.equal(db.sessions[guestCookie.slice(4)]?.publicId, ada.id); assert.ok(!('account' in (db.sessions[guestCookie.slice(4)] ?? {})), 'an ordinary session record again: no account field');
  const text = JSON.stringify(db);
  assert.ok(!text.includes('uidada@example.com') && !text.includes('UidAda'), 'neither the address nor the subject id is left anywhere');
  assert.deepEqual(db.accountLog?.audit.at(-1)?.event, 'deleted');
  // Delete, erasing the character too.
  a.f.advance(61000);
  const bola = await a.player('Bola'), signed = await a.signIn('UidBola', bola.cookie);
  const erased = await a.change('/api/account/delete', { confirm: 'delete', erase: true, idToken: await a.token('UidBola') }, signed.cookie);
  assert.deepEqual([erased.status, await erased.json().then(body => (body as { kept: boolean }).kept)], [200, false]);
  assert.match(erased.headers.get('set-cookie') ?? '', /^sid=; .*Max-Age=0/);
  assert.equal((await a.whoAmI(signed.cookie)).status, 401);
  db = await a.stored();
  assert.ok(!Object.values(db.sessions).some(session => session.publicId === bola.id)); assert.equal(db.archivedLives?.[bola.id], undefined);
  // The same person can start again: a new account, nothing carried over.
  const again = await a.signIn('UidAda');
  assert.deepEqual({ outcome: again.body.outcome, created: again.body.created, character: again.body.character }, { outcome: 'signed_in', created: true, character: null });
});

test('export: everything stored about the account, for its owner only, with no cookie, key or subject id', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const laptop = await a.signIn('UidAda', ada.cookie); a.f.advance(5000);
  const phone = await a.signIn('UidAda');
  const response = await a.call('/api/account/export', null, phone.cookie);
  assert.equal(response.status, 200);
  const data = await response.json() as AccountExportResponse;
  assert.deepEqual(data.account, { provider: 'password', email: 'uidada@example.com', createdAt: a.f.now() - 5000, lastSeenAt: a.f.now() });
  assert.deepEqual(data.devices.map(device => device.thisDevice), [false, true]);
  assert.deepEqual(data.character, { id: ada.id, name: 'Ada', cities: ['lagos'] });
  assert.deepEqual(data.history.map(line => line.event), ['created', 'linked', 'restored']);
  const db = await a.stored(), text = JSON.stringify(data);
  for (const secret of [laptop.cookie.slice(4), phone.cookie.slice(4), Object.values(db.accounts ?? {})[0]?.sessionKey ?? 'x', 'UidAda']) assert.ok(!text.includes(secret));
  const guest = await a.player('Guest');
  assert.deepEqual(await errorOf(await a.call('/api/account/export', null, guest.cookie)), [409, 'account_required']);
  assert.deepEqual(await errorOf(await a.call('/api/account/export')), [409, 'account_required']);
});

test('audit trail: link, restore, set aside, switch and sign-out are recorded without a token, an address or a cookie', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const laptop = await a.signIn('UidAda', ada.cookie);
  const bola = await a.player('Bola'), phone = await a.signIn('UidAda', bola.cookie);
  await a.change('/api/account/character', { use: bola.id }, phone.cookie);
  await a.change('/api/account/sign-out-everywhere', {}, phone.cookie);
  await a.change('/api/account/sign-out', {}, phone.cookie);
  const db = await a.stored(), log = db.accountLog;
  assert.deepEqual(log?.audit.map(line => line.event), ['created', 'linked', 'parked', 'parked', 'switched', 'signed_out_everywhere', 'signed_out']);
  assert.deepEqual(log?.audit.map(line => line.n), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(log?.audit.map(line => line.ref)).size, 1, 'one reference for the one account');
  for (const line of log?.audit ?? []) assert.deepEqual(Object.keys(line).filter(key => !['n', 'at', 'event', 'ref', 'life'].includes(key)), []);
  const text = JSON.stringify(log?.audit);
  for (const secret of ['UidAda', 'example.com', laptop.cookie.slice(4), phone.cookie.slice(4), 'eyJ']) assert.ok(!text.includes(secret), `the audit trail must not hold ${secret}`);
});

test('an account’s character that expired is brought back from the archive at the next sign-in', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const signed = await a.signIn('UidAda', ada.cookie);
  a.f.advance(31 * 86400000);
  assert.equal((await a.whoAmI(signed.cookie)).status, 401, 'thirty days without use ends the device binding like any session');
  await a.f.request('/api/session', { name: 'Sweeper' }); // the sweep archives the expired character
  let db = await a.stored();
  assert.ok(db.archivedLives?.[ada.id]); assert.equal(Object.values(db.sessions).some(session => session.publicId === ada.id), false);
  const back = await a.signIn('UidAda');
  assert.deepEqual({ outcome: back.body.outcome, character: back.body.character }, { outcome: 'restored', character: { id: ada.id, name: 'Ada' } });
  assert.deepEqual(await a.whoAmI(back.cookie), { status: 200, id: ada.id, name: 'Ada' });
  db = await a.stored();
  assert.equal(db.archivedLives?.[ada.id], undefined); assert.deepEqual(Object.keys(db.accountDevices ?? {}), [back.cookie.slice(4)], 'the expired binding was forgotten');
});

test('a sign-in whose write fails has no effect: no account, no cookie, and the token is still unused', async t => {
  const disk = flakyDisk();
  const a = await accounts(t, { disk }), ada = await a.player('Ada');
  const idToken = await a.token('UidAda'), csrf = await a.csrf(ada.cookie);
  disk.fail = 'ENOSPC';
  const failed = await a.call('/api/account/sign-in', { idToken, csrf }, ada.cookie);
  assert.deepEqual([failed.status, (await failed.json() as Json).error, failed.headers.get('set-cookie')], [503, 'storage_unavailable', null]);
  disk.fail = null;
  assert.deepEqual(await a.whoAmI(ada.cookie), { status: 200, id: ada.id, name: 'Ada' }, 'the guest session is exactly as it was');
  assert.equal((await a.state(ada.cookie)).account, null);
  const retried = await a.call('/api/account/sign-in', { idToken, csrf }, ada.cookie);
  assert.equal(retried.status, 200, 'the same token works on the retry: a failed write spent nothing');
  assert.equal((await retried.json() as SignInResponse).outcome, 'linked');
});

test('when the provider’s keys cannot be fetched, sign-in says so and changes nothing', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  a.provider.down = true;
  const refused = await a.signIn('UidAda', ada.cookie);
  assert.deepEqual([refused.status, refused.body.error, refused.setCookie], [503, 'accounts_unavailable', '']);
  a.provider.down = false;
  assert.equal((await a.signIn('UidAda', ada.cookie)).status, 200);
});
