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
  /** The same, with PROOF: a fresh ID token of `subject`, as the routes that reach past this browser require. */
  const proved = async (path: string, body: Json, cookie: string | null | undefined, subject: string): Promise<Response> => change(path, { ...body, idToken: await token(subject) }, cookie);
  async function signIn(subject: string, cookie?: string | null, extra: Json = {}) {
    const response = await change('/api/account/sign-in', { idToken: await token(subject, extra) }, cookie);
    const set = response.headers.get('set-cookie');
    return { status: response.status, body: await response.json() as SignInResponse & { error?: string }, cookie: set ? set.split(';')[0] ?? '' : '', setCookie: set ?? '' };
  }
  /** A guest with a played life in Lagos. */
  async function player(name: string) { const device = await f.device(name); await f.request('/api/life?city=lagos', null, device.cookie); return device; }
  const whoAmI = async (cookie: string): Promise<{ status: number; id?: string; name?: string }> => { const response = await call('/api/session', null, cookie); const body = await response.json() as { session?: { id: string; name: string } }; return { status: response.status, ...(body.session ? { id: body.session.id, name: body.session.name } : {}) }; };
  const stored = async (): Promise<Database> => { await f.flush(); return JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')) as Database; };
  return { f, key, provider, logs, call, token, state, csrf, change, proved, signIn, player, whoAmI, stored };
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
  assert.deepEqual(Object.keys(account).sort(), ['createdAt', 'devices', 'email', 'id', 'lastSeenAt', 'mailOptIn', 'parked', 'provider', 'publicId', 'sessionKey', 'subject', 'v']);
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
  const chosen = await a.proved('/api/account/character', { use: bola.id }, signed.cookie, 'UidAda');
  assert.equal(chosen.status, 200);
  const choice = await chosen.json() as { character: unknown; parked: { id: string }[] };
  assert.deepEqual(choice.character, { id: bola.id, name: 'Bola' }); assert.deepEqual(choice.parked.map(item => item.id), [ada.id]);
  assert.equal(chosen.headers.get('set-cookie'), null, 'choosing a character changes no cookie');
  assert.deepEqual(await a.whoAmI(signed.cookie), { status: 200, id: bola.id, name: 'Bola' });
  // And back again: nothing was lost on either side.
  assert.equal((await a.proved('/api/account/character', { use: ada.id }, signed.cookie, 'UidAda')).status, 200);
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
    a.f.advance(61000);
    assert.deepEqual(await errorOf(await a.proved('/api/account/character', { use: target }, mine.cookie, 'UidAda')), [404, 'character_not_found'], JSON.stringify(target));
  }
  assert.deepEqual(await a.whoAmI(mine.cookie), { status: 200, id: ada.id, name: 'Ada' });
  assert.equal((await a.stored()).archivedLives?.[spare.id]?.account, 'fb:UidEve', 'the other account’s character is untouched');
  // A guest cannot choose anything, and neither can a signed-out browser.
  const guest = await a.player('Guest');
  assert.deepEqual(await errorOf(await a.proved('/api/account/character', { use: spare.id }, guest.cookie, 'UidEve')), [409, 'account_required']);
  assert.deepEqual(await errorOf(await a.proved('/api/account/character', { use: spare.id }, null, 'UidEve')), [409, 'account_required']);
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
  const response = await a.proved('/api/account/sign-out-everywhere', {}, laptop.cookie, 'UidAda');
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
  // One character, two devices: when the laptop sends the character away, the phone's room is revoked too.
  assert.equal((await a.f.action(laptop.cookie, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
  assert.equal((await phoneSocket.next() as { code?: string }).code, 'venue_mismatch');
  const closedPhone = once(phoneSocket.ws, 'close');
  await a.proved('/api/account/sign-out-everywhere', {}, laptop.cookie, 'UidAda');
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
  const routes: [string, Json][] = [['/api/account/sign-out', {}], ['/api/account/sign-out-everywhere', { idToken: 'x' }], ['/api/account/character', { use: ada.id, idToken: 'x' }], ['/api/account/export', { idToken: 'x' }], ['/api/account/delete', { confirm: 'delete', idToken: 'x' }], ['/api/account/sign-in', { idToken: 'x' }], ['/api/account/password-reset', { email: 'ada@example.com' }]];
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
  assert.equal((await a.call('/api/account/export', null, mine.cookie)).status, 404, 'the account’s data is not something a GET can fetch');
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
  const response = await a.proved('/api/account/export', {}, phone.cookie, 'UidAda');
  assert.equal(response.status, 200);
  const data = await response.json() as AccountExportResponse;
  assert.deepEqual(data.account, { provider: 'password', email: 'uidada@example.com', createdAt: a.f.now() - 5000, lastSeenAt: a.f.now() });
  assert.deepEqual(data.devices.map(device => device.thisDevice), [false, true]);
  assert.deepEqual(data.character, { id: ada.id, name: 'Ada', cities: ['lagos'] });
  assert.deepEqual(data.history.map(line => line.event), ['created', 'linked', 'restored']);
  const db = await a.stored(), text = JSON.stringify(data);
  for (const secret of [laptop.cookie.slice(4), phone.cookie.slice(4), Object.values(db.accounts ?? {})[0]?.sessionKey ?? 'x', 'UidAda']) assert.ok(!text.includes(secret));
  const guest = await a.player('Guest');
  assert.deepEqual(await errorOf(await a.proved('/api/account/export', {}, guest.cookie, 'UidAda')), [409, 'account_required']);
  assert.deepEqual(await errorOf(await a.proved('/api/account/export', {}, null, 'UidAda')), [409, 'account_required']);
});

test('audit trail: link, restore, set aside, switch and sign-out are recorded without a token, an address or a cookie', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const laptop = await a.signIn('UidAda', ada.cookie);
  const bola = await a.player('Bola'), phone = await a.signIn('UidAda', bola.cookie);
  await a.proved('/api/account/character', { use: bola.id }, phone.cookie, 'UidAda');
  await a.proved('/api/account/sign-out-everywhere', {}, phone.cookie, 'UidAda');
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
  assert.equal((await a.signIn('UidAda', ada.cookie)).status, 503, 'the provider is left alone for a moment after a failed fetch');
  a.f.advance(15000);
  assert.equal((await a.signIn('UidAda', ada.cookie)).status, 200);
});

// ---- hardening: one test per finding of the security review ----

/** The 64 characters of base64url, in value order. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Other spellings of the same token: the fifteen trailing-bit variants of its signature, padding, whitespace and the standard alphabet. */
function respellings(token: string): string[] {
  const [head, body, signature] = token.split('.') as [string, string, string], last = B64.indexOf(signature.at(-1) as string);
  return [...Array.from({ length: 15 }, (_, n) => `${head}.${body}.${signature.slice(0, -1)}${B64[last - (last % 16) + ((last % 16) + n + 1) % 16]}`),
    `${token}=`, `${token}==`, ` ${token}`, `${token} `, `${token}\n`, `${head}.${body}.${signature.slice(0, 50)}\n${signature.slice(50)}`, `${head}.${body}.${signature.replace(/-/g, '+').replace(/_/g, '/')}`].filter(variant => variant !== token);
}
/** Requests as a browser makes them over HTTPS through the one trusted proxy. */
const tls = (base: string, extra: Record<string, string | null> = {}): Record<string, string | null> => ({ 'X-Forwarded-Proto': 'https', Origin: base.replace('http://', 'https://'), ...extra });
const cookiesOf = (response: Response): string[] => response.headers.getSetCookie();

test('H1 — a used token cannot be replayed under another spelling: not to sign in, and not as the fresh token of a delete', async t => {
  const a = await accounts(t, { trustProxy: true }), ada = await a.player('Ada');
  const idToken = await a.token('UidAda');
  let n = 0;
  const from = () => ({ 'X-Forwarded-For': `203.0.113.${(n++ % 250) + 1}` });
  const first = await a.call('/api/account/sign-in', { idToken, csrf: await a.csrf(ada.cookie) }, ada.cookie, from());
  assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie')?.split(';')[0] ?? '', csrf = await a.csrf(cookie);
  const variants = respellings(idToken);
  assert.equal(variants.length, 22);
  for (const variant of variants) {
    assert.deepEqual(await errorOf(await a.call('/api/account/sign-in', { idToken: variant }, null, from())), [401, 'invalid_token'], `sign-in with ${JSON.stringify(variant.slice(-6))}`);
    assert.deepEqual(await errorOf(await a.call('/api/account/delete', { idToken: variant, confirm: 'delete', erase: true, csrf }, cookie, from())), [401, 'invalid_token'], `delete with ${JSON.stringify(variant.slice(-6))}`);
  }
  // Each proof route spends its token too: the token of one cannot be the token of the next.
  const proof = await a.token('UidAda');
  assert.equal((await a.call('/api/account/export', { idToken: proof, csrf }, cookie, from())).status, 200);
  for (const path of ['/api/account/export', '/api/account/sign-out-everywhere', '/api/account/character', '/api/account/delete']) assert.deepEqual(await errorOf(await a.call(path, { idToken: proof, csrf, confirm: 'delete', use: ada.id }, cookie, from())), [401, 'invalid_token'], path);
  for (const variant of respellings(proof).slice(0, 3)) assert.deepEqual(await errorOf(await a.call('/api/account/delete', { idToken: variant, confirm: 'delete', csrf }, cookie, from())), [401, 'invalid_token']);
  assert.deepEqual(await a.whoAmI(cookie), { status: 200, id: ada.id, name: 'Ada' }, 'the account and its character are untouched');
  assert.equal((await a.state(cookie)).account?.devices, 1, 'and nobody else got in');
  assert.equal(Object.keys((await a.stored()).accountLog?.used ?? {}).length, 2, 'two tokens were used; no respelling added a third entry');
});

test('M1 — junk cannot spend the shared sign-in bucket: 300 garbage sign-ins from 30 addresses, then a valid token from a new address signs in', async t => {
  const a = await accounts(t, { trustProxy: true });
  const stranger = await makeKey('key-1');
  const forged = await signToken(stranger, claimsFor(PROJECT, a.f.now()));
  let refused = 0;
  for (let address = 0; address < 30; address++) for (let i = 0; i < 10; i++) {
    const response = await a.call('/api/account/sign-in', { idToken: i % 2 ? forged : `garbage.${address}.${i}` }, null, { 'X-Forwarded-For': `198.51.100.${address + 1}` });
    assert.equal(response.status, 401); refused += 1; await response.arrayBuffer();
  }
  assert.equal(refused, 300);
  const good = await a.call('/api/account/sign-in', { idToken: await a.token('UidAda') }, null, { 'X-Forwarded-For': '203.0.113.200' });
  assert.equal(good.status, 200, 'a real sign-in is not refused because others sent junk');
  // The shared bucket does count verified tokens (it bounds what one sign-in costs the store), and each address still has its own ten a minute.
  assert.deepEqual(await errorOf(await a.call('/api/account/sign-in', { idToken: await a.token('UidAda') }, null, { 'X-Forwarded-For': '198.51.100.1' })), [429, 'account_rate_limited']);
});

test('H2 — a flood of reset requests leaves the site open: a new visitor gets a session and a real sign-in still works', async t => {
  const a = await accounts(t, { trustProxy: true });
  const statuses = new Map<number, number>();
  for (let i = 0; i < 1500; i++) {
    const response = await a.call('/api/account/password-reset', { email: `victim${i}@example.com` }, null, { 'X-Forwarded-For': `2001:db8:${(i >> 8).toString(16)}:${(i & 255).toString(16)}::1` });
    statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1); await response.arrayBuffer();
  }
  assert.equal(statuses.get(200), 120, 'the shared bucket lets 120 through a minute'); assert.equal(statuses.get(429), 1380);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(a.provider.requests.filter(request => request.url === RESET_URL).length, 120, 'a refused request never reaches the provider');
  const visitor = await fetch(`${a.f.base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.77' }, body: JSON.stringify({ name: 'Newcomer' }) });
  assert.equal(visitor.status, 200, 'a new visitor is not turned away');
  assert.equal((await a.call('/api/account/sign-in', { idToken: await a.token('UidAda') }, null, { 'X-Forwarded-For': '203.0.113.78' })).status, 200);
});

test('M2 — over HTTPS the cookie is __Host-sid: a sibling host cannot plant it, an old `sid` guest is upgraded without losing anything, and a binding is honoured under the new name only', async t => {
  const a = await accounts(t, { trustProxy: true }), base = a.f.base, secure = tls(base);
  const HOST = (value: string) => `__Host-sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure`;
  // A guest who has played under the old cookie name (made here over plain http, as every cookie before this change was named).
  const old = await a.player('Oldtimer');
  assert.match(old.cookie, /^sid=[0-9a-f-]{36}$/);
  const secret = old.cookie.slice(4), upgraded = `__Host-sid=${secret}`;
  // Their next visit over HTTPS: the same life, and the cookie is ALSO set under the new name. The old one is left alone (N1):
  // the build before this one reads only `sid`, so a rollback must still find every guest.
  const visit = await a.call('/api/session', null, old.cookie, secure);
  assert.equal(visit.status, 200); assert.equal((await visit.json() as { session: { id: string } }).session.id, old.id);
  assert.deepEqual(cookiesOf(visit), [HOST(secret)], 'the new name is set, and nothing removes `sid`');
  // From now on the browser holds both, and that works; so does `sid` alone (a browser that never got the answer, or the previous build's view of it).
  const who = async (cookie: string) => { const response = await a.call('/api/session', null, cookie, secure); return response.status === 200 ? (await response.json() as { session: { id: string } }).session.id : response.status; };
  assert.equal(await who(`${old.cookie}; ${upgraded}`), old.id); assert.equal(await who(old.cookie), old.id); assert.equal(await who(upgraded), old.id);
  const both = await a.call('/api/life?city=lagos', null, `${old.cookie}; ${upgraded}`, secure);
  assert.equal(both.status, 200); assert.deepEqual(cookiesOf(both), [HOST(secret)]);
  // A route that does not renew still upgrades a legacy guest; no answer to a guest ever removes `sid`.
  assert.deepEqual(cookiesOf(await a.call('/api/account', null, old.cookie, secure)), [HOST(secret)]);
  for (const response of [await a.call('/api/session', { name: 'Oldtimer' }, old.cookie, secure), await a.call('/api/life?city=lagos', null, old.cookie, secure), await a.call('/api/session', null, `${old.cookie}; ${upgraded}`, secure)]) assert.ok(!cookiesOf(response).some(line => line.startsWith('sid=')), 'a rollback finds the guest’s `sid` untouched');
  // A new visitor over HTTPS gets the new name from the start.
  const fresh = await a.call('/api/session', { name: 'Newcomer' }, null, secure);
  assert.match(cookiesOf(fresh).join('|'), /^__Host-sid=[0-9a-f-]{36}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure$/);
  // COOKIE TOSSING. The sibling host can only set `sid`. The attacker plants THEIR guest session's value.
  const attacker = await a.player('Mallory'), planted = attacker.cookie;
  assert.equal(await who(`${planted}; ${upgraded}`), old.id, 'sid=attacker; __Host-sid=victim → the victim, whatever the order');
  assert.equal(await who(`${upgraded}; ${planted}`), old.id);
  assert.equal(await who(`__Host-sid=${attacker.cookie.slice(4)}; ${upgraded}`), 401, 'two values under the protected name are nobody');
  // N4 — a guest who has NOT been upgraded yet sees exactly what the previous build did: the first `sid` is the cookie. No new way to end up in a new life.
  assert.equal(await who(`${old.cookie}; ${planted}`), old.id, 'sid=victim; sid=attacker → the first, as before');
  assert.equal(await who(`${planted}; ${old.cookie}`), attacker.id, 'sid=attacker; sid=victim → the first, as before (and the next answer protects whoever it is)');
  assert.equal(await who(`${old.cookie}; ${old.cookie}`), old.id);
  // SIGNED IN. The sign-in answer sets the new name; `sid` is still not removed.
  const signedIn = await a.call('/api/account/sign-in', { idToken: await a.token('UidOld'), csrf: await csrfOf(secret) }, old.cookie, secure);
  assert.equal(signedIn.status, 200);
  const lines = cookiesOf(signedIn), binding = /^__Host-sid=([0-9a-f-]{36});/.exec(lines[0] ?? '')?.[1] ?? '';
  assert.deepEqual(lines, [HOST(binding)]); assert.notEqual(binding, secret);
  assert.equal(await who(`__Host-sid=${binding}`), old.id);
  assert.equal(await who(`${old.cookie}; __Host-sid=${binding}`), old.id, 'the browser now holds the old guest value as `sid` and the binding as __Host-sid: the binding wins');
  // A binding's value under the old name — the only name a sibling host can set — opens nothing: not the game, not the account. Duplicates change nothing about that.
  assert.equal(await who(`sid=${binding}`), 401, 'a device binding is not honoured from a cookie a sibling host could have planted');
  assert.equal(await who(`sid=${binding}; ${planted}`), 401);
  const viaLegacy = await (await a.call('/api/account', null, `sid=${binding}`, secure)).json() as AccountStateResponse;
  assert.deepEqual([viaLegacy.account, viaLegacy.guest], [null, false]);
  assert.deepEqual(await errorOf(await a.call('/api/account/sign-out', { csrf: await csrfOf(binding) }, `sid=${binding}`, secure)), [409, 'account_required']);
  assert.equal(await a.f.socket({ cookie: `sid=${binding}` }).then(() => 'opened', () => 'refused'), 'opened', 'on plain http — development — the one name is honoured for everything');
  // Planting a guest cookie under the old name beside a signed-in browser changes nothing: the binding wins.
  assert.equal(await who(`${planted}; __Host-sid=${binding}`), old.id);
  // Signing out is where `sid` IS removed: a signed-out browser must not fall back to whatever `sid` it still holds.
  const out = await a.call('/api/account/sign-out', { csrf: await csrfOf(binding) }, `${planted}; __Host-sid=${binding}`, secure);
  assert.deepEqual(cookiesOf(out), ['__Host-sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure']);
  // THE ORIGIN'S SCHEME. Over HTTPS, a page served over plain http from the same host name is another origin.
  assert.deepEqual(await errorOf(await a.call('/api/session', { name: 'Downgrade' }, null, { ...secure, Origin: base })), [403, 'origin_rejected']);
  assert.deepEqual(await errorOf(await a.call('/api/account/password-reset', { email: 'ada@example.com' }, null, { ...secure, Origin: base })), [403, 'origin_rejected']);
  assert.equal((await a.call('/api/session', { name: 'Proper' }, null, secure)).status, 200);
});

test('N3 — validly signed tokens of throwaway, unconfirmed accounts cannot spend the shared sign-in bucket: 320 of them from 320 addresses, then a real sign-in works', async t => {
  const a = await accounts(t, { trustProxy: true });
  for (let i = 0; i < 320; i++) {
    const response = await a.call('/api/account/sign-in', { idToken: await a.token(`UidThrowaway${i}`, { verified: false }) }, null, { 'X-Forwarded-For': `2001:db8::${(i + 1).toString(16)}` });
    assert.equal(response.status, 403, `attempt ${i}`); await response.arrayBuffer();
  }
  const real = await a.call('/api/account/sign-in', { idToken: await a.token('UidAda') }, null, { 'X-Forwarded-For': '203.0.113.200' });
  assert.equal(real.status, 200, 'a real player is not refused because others sent unconfirmed sign-ups');
  // An unconfirmed attempt still counts against its own address, and against nothing else: not the shared bucket, not the per-account one.
  for (let i = 0; i < 10; i++) await a.call('/api/account/sign-in', { idToken: await a.token('UidAda', { verified: false }) }, null, { 'X-Forwarded-For': '198.51.100.1' });
  assert.deepEqual(await errorOf(await a.call('/api/account/sign-in', { idToken: await a.token('UidAda', { verified: false }) }, null, { 'X-Forwarded-For': '198.51.100.1' })), [429, 'account_rate_limited'], 'ten a minute per address');
  for (let i = 0; i < 7; i++) assert.equal((await a.call('/api/account/sign-in', { idToken: await a.token('UidAda') }, null, { 'X-Forwarded-For': `203.0.113.${i + 1}` })).status, 200, 'ten unconfirmed tokens for this account did not use up its eight a five minutes');
  // A proof with an unconfirmed token proves nothing either.
  const mine = await a.signIn('UidBola');
  assert.deepEqual(await errorOf(await a.change('/api/account/export', { idToken: await a.token('UidBola', { verified: false }) }, mine.cookie)), [403, 'email_unverified']);
});

test('M3 — when the real owner arrives, an earlier binding goes: the pre-hijack, another way of signing in, and a 90-day absolute lifetime', async t => {
  const a = await accounts(t);
  // PRE-HIJACK. Someone signs up with the victim's address before the victim does and — the address having been confirmed — holds a binding.
  const attacker = await a.signIn('UidVictim');
  assert.deepEqual([attacker.status, attacker.body.outcome, attacker.body.devices, attacker.body.ended], [200, 'signed_in', 1, 0]);
  // The victim arrives with their own character and saves it to "their" account.
  const victim = await a.player('Victim');
  const arrived = await a.signIn('UidVictim', victim.cookie);
  assert.deepEqual([arrived.body.outcome, arrived.body.created, arrived.body.ended, arrived.body.devices], ['linked', false, 1, 1], 'linking into an account that already existed ends every other binding');
  assert.equal((await a.whoAmI(attacker.cookie)).status, 401, 'the earlier binding is gone');
  assert.equal((await a.state(attacker.cookie)).account, null);
  assert.deepEqual(await a.whoAmI(arrived.cookie), { status: 200, id: victim.id, name: 'Victim' });
  assert.deepEqual(Object.keys((await a.stored()).accountDevices ?? {}), [arrived.cookie.slice(4)]);
  // An ordinary second device does not end the first: same way of signing in, nothing brought.
  const second = await a.signIn('UidVictim');
  assert.deepEqual([second.body.outcome, second.body.ended, second.body.devices], ['restored', 0, 2]);
  assert.equal((await a.whoAmI(arrived.cookie)).status, 200);
  // ANOTHER WAY OF SIGNING IN than the account last used (a password account now signed in to with Google): the others go.
  const google = await a.signIn('UidVictim', null, { provider: 'google.com' });
  assert.deepEqual([google.body.outcome, google.body.ended, google.body.devices], ['restored', 2, 1]);
  assert.equal((await a.whoAmI(arrived.cookie)).status, 401); assert.equal((await a.whoAmI(second.cookie)).status, 401);
  assert.equal((await a.state(google.cookie)).account?.provider, 'google');
  assert.ok((await a.stored()).accountLog?.audit.filter(line => line.event === 'signed_out_everywhere').length === 2, 'each is in the audit trail');
  // ABSOLUTE LIFETIME. A binding used every week still ends 90 days after it was made.
  let alive = 0;
  for (let day = 7; day <= 98; day += 7) { a.f.advance(7 * 86400000); if ((await a.whoAmI(google.cookie)).status === 200) alive = day; }
  assert.equal(alive, 84, 'alive at day 84, gone by day 91');
  const back = await a.signIn('UidVictim', null, { provider: 'google.com' });
  assert.deepEqual([back.body.outcome, back.body.character, back.body.devices], ['restored', { id: victim.id, name: 'Victim' }, 1], 'signing in again brings the character back; the expired binding was forgotten');
});

test('M4 — a character archived by the 30-day sweep comes back whole: its city, its set-aside lives and its quick-start flag', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const signed = await a.signIn('UidAda', ada.cookie);
  const lagos = await a.f.server.store.transact((db) => {
    const key = Object.values(db.accounts ?? {})[0]?.sessionKey ?? '', record = db.sessions[key];
    if (!record?.cities.lagos) throw new Error('no record');
    record.character = { v: 1, city: 'lagos', movedAt: 123, from: 'ibadan' };
    record.legacyLives = { 'lagos:99': structuredClone(record.cities.lagos) };
    record.legacyLifeCities = { 'lagos:99': 'lagos' };
    record.onboarding = true;
    return structuredClone(record.cities.lagos);
  });
  a.f.advance(31 * 86400000);
  await a.f.request('/api/session', { name: 'Sweeper' }); // the sweep archives the expired character
  let db = await a.stored();
  assert.deepEqual(Object.keys(db.archivedLives?.[ada.id] ?? {}).sort(), ['archivedAt', 'character', 'cities', 'legacyLifeCities', 'legacyLives', 'name', 'onboarding', 'publicId']);
  assert.equal((await a.whoAmI(signed.cookie)).status, 401);
  const back = await a.signIn('UidAda');
  assert.equal(back.body.outcome, 'restored');
  db = await a.stored();
  const record = db.sessions[Object.values(db.accounts ?? {})[0]?.sessionKey ?? ''];
  assert.deepEqual(record?.character, { v: 1, city: 'lagos', movedAt: 123, from: 'ibadan' });
  assert.deepEqual(record?.legacyLives, { 'lagos:99': lagos });
  assert.deepEqual(record?.legacyLifeCities, { 'lagos:99': 'lagos' }, 'where each set-aside life belongs travels with the record, through the archive and back');
  assert.equal(record?.onboarding, true); assert.equal(record?.publicId, ada.id);
  // A guest's expired life is archived whole as well (nothing restores it, but nothing is dropped from it).
  const guest = await a.player('Guest');
  await a.f.server.store.transact((store) => { const session = store.sessions[guest.cookie.slice(4)]; if (session) { session.character = { v: 1, city: 'lagos' }; session.expiresAt = a.f.now() - 1; } });
  await a.f.request('/api/session', { name: 'Sweeper2' });
  assert.deepEqual((await a.stored()).archivedLives?.[guest.id]?.character, { v: 1, city: 'lagos' });
});

test('a binding alone plays and signs itself out; ending other sign-ins, reading the address’s export and swapping the character need a fresh token for the same account', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const laptop = await a.signIn('UidAda', ada.cookie), bola = await a.player('Bola'), phone = await a.signIn('UidAda', bola.cookie);
  // A thief holding only the phone's cookie.
  for (const [path, body] of [['/api/account/sign-out-everywhere', {}], ['/api/account/export', {}], ['/api/account/character', { use: bola.id }], ['/api/account/delete', { confirm: 'delete', erase: true }]] as const) {
    assert.deepEqual(await errorOf(await a.change(path, body, phone.cookie)), [401, 'invalid_token'], `${path} with the cookie alone`);
    assert.deepEqual(await errorOf(await a.proved(path, body, phone.cookie, 'UidMallory')), [403, 'account_mismatch'], `${path} with another account’s token`);
  }
  assert.equal((await a.whoAmI(laptop.cookie)).status, 200, 'the owner’s other device is still signed in');
  assert.deepEqual(await a.whoAmI(phone.cookie), { status: 200, id: ada.id, name: 'Ada' }, 'and the character in play was not swapped');
  assert.equal((await a.call('/api/account/export', null, phone.cookie)).status, 404, 'no GET reads the account’s data');
  // With proof, each works.
  a.f.advance(61000);
  assert.equal((await a.proved('/api/account/export', {}, phone.cookie, 'UidAda')).status, 200);
  assert.equal((await a.proved('/api/account/character', { use: bola.id }, phone.cookie, 'UidAda')).status, 200);
  assert.equal((await (await a.proved('/api/account/sign-out-everywhere', {}, phone.cookie, 'UidAda')).json() as { ended: number }).ended, 1);
  // Signing out this browser needs only its own binding.
  assert.equal((await a.change('/api/account/sign-out', {}, phone.cookie)).status, 200);
});

test('Node: a set-aside character keeps its exactly-once receipts, so an action sent before it was set aside is still the same action after it comes back', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  await a.signIn('UidAda', ada.cookie);
  const bola = await a.player('Bola');
  const action = { actionId: `${a.f.now()}:11111111-2222-4333-8444-555555555555`, cityId: 'lagos', type: 'travel', id: 'library', mode: 'cab' };
  const first = await (await a.f.request('/api/action', action, bola.cookie)).json() as { ok: boolean; state: { cash: number } };
  assert.equal(first.ok, true);
  const signed = await a.signIn('UidAda', bola.cookie);
  assert.equal(signed.body.outcome, 'parked');
  assert.ok(Object.keys((await a.stored()).archivedLives?.[bola.id]?.actions ?? {}).includes(action.actionId), 'the receipt went into the archive with the life');
  assert.equal((await a.proved('/api/account/character', { use: bola.id }, signed.cookie, 'UidAda')).status, 200);
  const repeat = await (await a.call('/api/action', action, signed.cookie)).json() as { duplicate?: boolean; state: { cash: number } };
  assert.equal(repeat.duplicate, true, 'the retry is recognised: the fare is not paid twice');
  assert.equal(repeat.state.cash, first.state.cash);
  // And the account's own character, set aside by that switch, kept its receipts the same way.
  assert.ok((await a.stored()).archivedLives?.[ada.id]?.actions, 'receipts travel with every set-aside character');
});

test('housekeeping: expired bindings and accounts nobody can come back to are swept, and both tables stay bounded', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  await a.signIn('UidAda', ada.cookie);
  const ghost = await a.signIn('UidGhost'); // signed in once, never made a character
  assert.equal(ghost.body.outcome, 'signed_in');
  let db = await a.stored();
  assert.deepEqual(Object.keys(db.accounts ?? {}).sort(), ['fb:UidAda', 'fb:UidGhost']); assert.equal(db.accountLog?.accounts, 2);
  a.f.advance(31 * 86400000);
  // The next sign-in by anyone sweeps: both bindings have expired; the ghost account has nothing to come back to and goes, Ada's has a character and stays.
  await a.f.request('/api/session', { name: 'Sweeper' });
  const other = await a.signIn('UidOther');
  db = await a.stored();
  assert.deepEqual(Object.keys(db.accounts ?? {}).sort(), ['fb:UidAda', 'fb:UidOther']);
  assert.deepEqual(Object.keys(db.accountDevices ?? {}), [other.cookie.slice(4)], 'expired bindings are gone');
  assert.equal(db.accountLog?.accounts, 2);
  assert.ok(!JSON.stringify(db).includes('uidghost@example.com'), 'the swept account’s address went with it');
  assert.equal((await a.signIn('UidAda')).body.outcome, 'restored', 'the kept account still has its character');
  // A count that says the store is full is checked against what is really there before anyone is refused.
  await a.f.server.store.transact((store) => { if (store.accountLog) store.accountLog.accounts = 999999; });
  const next = await a.signIn('UidNew');
  assert.equal(next.status, 200); assert.equal((await a.stored()).accountLog?.accounts, 3);
});

test('accounts switched off after being on: a signed-in browser keeps playing, is told who it is, and can still sign out', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  const signed = await a.signIn('UidAda', ada.cookie);
  await a.f.flush();
  // The same data, served by a host with no account configuration.
  const off = await fixture(t, { dataDir: a.f.dir, now: () => a.f.now() });
  const call = (path: string, body?: unknown, cookie?: string) => fetch(off.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: off.base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await call('/api/life?city=lagos', undefined, signed.cookie)).status, 200, 'the character is still played');
  const state = await (await call('/api/account', undefined, signed.cookie)).json() as { enabled: boolean; csrf: string; account: { email: string } | null; provider?: unknown };
  assert.deepEqual([state.enabled, state.account?.email, state.provider], [false, 'uidada@example.com', undefined]);
  assert.deepEqual(Object.keys(await (await call('/api/account')).json() as object).sort(), ['enabled', 'serverTime'], 'a browser that is not signed in is told only that accounts are off');
  for (const path of ['/api/account/sign-in', '/api/account/delete', '/api/account/export', '/api/account/sign-out-everywhere', '/api/account/character', '/api/account/password-reset']) assert.equal((await call(path, { idToken: 'x', csrf: state.csrf, confirm: 'delete', email: 'a@example.com' }, signed.cookie)).status, 404, path);
  assert.deepEqual(await errorOf(await call('/api/account/sign-out', {}, signed.cookie)), [403, 'csrf_rejected'], 'the guards still apply');
  const out = await call('/api/account/sign-out', { csrf: state.csrf }, signed.cookie);
  assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie') ?? '', /^sid=; .*Max-Age=0/);
  assert.equal((await call('/api/session', undefined, signed.cookie)).status, 401);
});

// ---- the welcome message (server/accounts/welcome.ts) ----

const MAIL_URL = 'https://api.zeptomail.com/v1.1/sg/email';
/** The mailer's settings, as placeholders. */
const MAIL_ENV = { ...ENV, ZEPTOMAIL_AUTH: 'Zoho-enczapikey placeholder-not-a-key', EMAIL_FROM_ADDRESS: 'hello@mail.example.com', EMAIL_CONTACT_LINE: 'Allworld, 1 Example Road' };
interface SentMail { personalizations: { to: { email: string }[] }[]; from: { email: string; name: string }; subject: string; content: { type: string; value: string }[]; headers?: Record<string, string> }
async function mailing(t: TestContext, options: FixtureOptions = {}) {
  const a = await accounts(t, { env: MAIL_ENV, publicOrigin: 'https://play.example', ...options });
  const mails = (): SentMail[] => a.provider.requests.filter(request => request.url === MAIL_URL).map(request => request.body as SentMail);
  /** Let what was started after an answer (the send) finish. */
  const settled = async (count: number, ms = 1500): Promise<void> => { const until = Date.now() + ms; while (mails().length < count && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10)); await new Promise(resolve => setTimeout(resolve, 30)); };
  const account = async (subject: string) => (await a.stored()).accounts?.[`fb:${subject}`];
  return { ...a, mails, settled, account };
}

test('welcome: a new account with a verified address gets ONE message — not a guest, not an unverified address, not a second device, not a restore', async t => {
  const m = await mailing(t);
  // A guest, however much they play, is sent nothing.
  const ada = await m.player('Ada');
  // An unverified address is refused sign-in, so no account is made and nothing is sent.
  assert.equal((await m.signIn('UidAda', ada.cookie, { verified: false })).status, 403);
  await m.settled(1, 150); assert.equal(m.mails().length, 0);
  // The first sign-in that creates the account.
  const first = await m.signIn('UidAda', ada.cookie);
  assert.deepEqual([first.status, first.body.created, first.body.outcome], [200, true, 'linked']);
  await m.settled(1);
  assert.equal(m.mails().length, 1);
  const mail = m.mails()[0] as SentMail;
  assert.deepEqual(mail.personalizations, [{ to: [{ email: 'uidada@example.com' }] }]); assert.deepEqual(mail.from, { email: 'hello@mail.example.com', name: 'Allworld' });
  assert.equal(mail.subject, 'Welcome to Allworld');
  assert.equal(typeof (await m.account('UidAda'))?.welcome, 'number', 'the account records when it was sent');
  assert.deepEqual((await m.stored()).accountLog?.welcome, [], 'nothing is left owed');
  // Later sign-ins — another device, a restore after signing out, the merge of a second life — send nothing more.
  const phone = await m.signIn('UidAda');
  await m.change('/api/account/sign-out', {}, phone.cookie);
  await m.signIn('UidAda');
  const bola = await m.player('Bola'); await m.signIn('UidAda', bola.cookie);
  await m.settled(2, 200);
  assert.equal(m.mails().length, 1, 'exactly once per account');
  // Another person's new account gets its own.
  m.f.advance(301000);
  await m.signIn('UidEve'); await m.settled(2);
  assert.deepEqual(m.mails().map(item => item.personalizations[0]?.to[0]?.email), ['uidada@example.com', 'uidada@example.com'.replace('ada', 'eve')]);
  assert.ok(!m.logs.some(line => /example\.com/.test(line)), 'no address is logged');
});

test('welcome: the message — short, about the account, text and HTML saying the same, nothing that tracks, everything escaped', async t => {
  const m = await mailing(t);
  const made = await m.f.request('/api/session', { name: 'Ada' });
  const cookie = made.headers.get('set-cookie')?.split(';')[0] ?? '';
  await m.f.request('/api/life?city=lagos', null, cookie);
  await m.signIn('UidAda', cookie); await m.settled(1);
  const mail = m.mails()[0] as SentMail, text = mail.content.find(part => part.type === 'text/plain')?.value ?? '', html = mail.content.find(part => part.type === 'text/html')?.value ?? '';
  assert.deepEqual(mail.content.map(part => part.type), ['text/plain', 'text/html']);
  for (const body of [text, html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/\s+/g, ' ')]) {
    for (const said of ['Welcome to Allworld, Ada', 'Allworld is a digital world you can live in.', 'Ada is saved to this account — sign in on any device to continue.', 'Finish your character', 'Find your home', 'Invite a friend with your link', 'You got this because you created an Allworld account with this address. It is sent once.', 'Report a problem', 'Allworld, 1 Example Road']) assert.ok(body.includes(said), said);
  }
  assert.ok(text.includes('Open Allworld: https://play.example/')); assert.match(html, /<a href="https:\/\/play\.example\/"[^>]*>Open Allworld<\/a>/);
  assert.ok(!/<img|<script|<link|<iframe|url\(|http:\/\//i.test(html), 'no image, no script, nothing fetched when it is opened');
  assert.deepEqual([...new Set([...html.matchAll(/https?:\/\/[^"'\s<)]+/g)].map(match => match[0]))], ['https://play.example/'], 'the only address in it is the game’s own');
  assert.equal(mail.headers, undefined, 'no list headers: it is not a subscription');
  assert.ok(!/Lagos|Ibadan/.test(text), 'it presents a world, not one city');
  // A hostile character name is text in both parts. (The name filter would refuse this one; the template must not rely on that.)
  const { accountWelcomeMail } = await import('./growth/email/templates.ts');
  const hostile = accountWelcomeMail({ name: '<img src=x onerror=alert(1)>"\'&\r\nBcc: x@evil.example', playUrl: 'https://play.example/', contact: '<b>contact</b>' });
  assert.ok(!/<img|<b>|onerror=alert\(1\)>/.test(hostile.html)); assert.ok(hostile.html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;') && hostile.html.includes('&lt;b&gt;contact&lt;/b&gt;'));
  assert.equal(hostile.subject, 'Welcome to Allworld', 'the subject carries nothing a person chose');
  assert.ok(!/[\r\n]Bcc:/.test(hostile.text.split('\n')[0] ?? ''), 'a name cannot start a new line of its own in the heading');
  assert.equal(accountWelcomeMail({ playUrl: 'https://play.example/' }).text.split('\n')[0], 'Welcome to Allworld'); assert.ok(accountWelcomeMail({ playUrl: 'https://play.example/' }).text.includes('Your character is saved to this account'));
});

test('welcome: two first sign-ins at the same moment send one message; a failed send never fails the sign-in and is retried later, once', async t => {
  const m = await mailing(t, { trustProxy: true });
  const [one, two] = await Promise.all([m.token('UidAda'), m.token('UidAda')]);
  const answers = await Promise.all([one, two].map((idToken, index) => m.call('/api/account/sign-in', { idToken }, null, { 'X-Forwarded-For': `203.0.113.${index + 1}` })));
  assert.deepEqual(answers.map(answer => answer.status), [200, 200]);
  assert.deepEqual((await Promise.all(answers.map(answer => answer.json() as Promise<SignInResponse>))).map(body => body.created).sort(), [false, true]);
  await m.settled(2, 300);
  assert.equal(m.mails().length, 1, 'one account was created, so one message');
  // The mailer refuses to take a message for good (a 4xx): the sign-in is unaffected, and it is not tried again.
  const original = m.provider.fetch;
  let status = 400;
  m.provider.fetch = async (url, init = {}) => { const reply = await original(url, init); return String(url) === MAIL_URL ? new Response('{}', { status }) : reply; };
  const eve = await m.signIn('UidEve');
  assert.deepEqual([eve.status, eve.body.created], [200, true]);
  await m.settled(2);
  assert.equal((await m.account('UidEve'))?.welcome, 'failed');
  // The mailer is down (a 5xx, after its own three attempts): the sign-in still succeeded at once; the message stays owed and is sent by a later tick.
  status = 503;
  const before = Date.now();
  const bo = await m.signIn('UidBo');
  assert.equal(bo.status, 200); assert.ok(Date.now() - before < 400, 'the sign-in did not wait for the mailer');
  await m.settled(5, 4000); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await m.account('UidBo'))?.welcome, 'pending');
  const owed = (await m.stored()).accountLog?.welcome ?? [];
  assert.deepEqual(owed.map(item => [item.id, item.tries, item.nextAt - m.f.now(), item.claimedAt]), [['fb:UidBo', 1, 300000, undefined]]);
  assert.ok(m.logs.includes('Welcome message was not sent: http_503'));
  status = 200;
  const sent = m.mails().length;
  m.f.server.beat(); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(m.mails().length, sent, 'not before its turn');
  m.f.advance(300000); m.f.server.beat(); await m.settled(sent + 1);
  assert.equal(m.mails().length, sent + 1); assert.equal(typeof (await m.account('UidBo'))?.welcome, 'number');
  m.f.advance(3600000); m.f.server.beat(); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(m.mails().length, sent + 1, 'and never again');
});

test('welcome: with the mailer not configured nothing is marked, queued, sent or logged; the operator’s e-mail switch holds it back', async t => {
  const a = await accounts(t), ada = await a.player('Ada');
  assert.equal((await a.signIn('UidAda', ada.cookie)).status, 200);
  await new Promise(resolve => setTimeout(resolve, 80));
  const db = await a.stored();
  assert.equal(db.accounts?.['fb:UidAda']?.welcome, undefined); assert.equal(db.accountLog?.welcome, undefined);
  assert.ok(!a.provider.requests.some(request => request.url === MAIL_URL)); assert.deepEqual(a.logs, []);
  // Configured but without a public origin there is no link to put in the message: also off.
  const noOrigin = await accounts(t, { env: MAIL_ENV });
  await noOrigin.signIn('UidAda'); await new Promise(resolve => setTimeout(resolve, 80));
  assert.ok(!noOrigin.provider.requests.some(request => request.url === MAIL_URL)); assert.equal((await noOrigin.stored()).accounts?.['fb:UidAda']?.welcome, undefined);
  // The operator has switched e-mail off: owed, not sent.
  const m = await mailing(t);
  await m.f.server.store.transact((store) => { store.growth = { ...(store.growth ?? { salt: 's', players: {}, shares: {}, metrics: {}, tables: {}, sweptAt: 0 }), outreach: { off: { email: true }, log: [], sent: {}, previews: [] } }; });
  await m.signIn('UidAda'); await m.settled(1, 200);
  assert.equal(m.mails().length, 0); assert.equal((await m.account('UidAda'))?.welcome, 'pending'); assert.deepEqual(m.logs, []);
});

test('N5 — an address is welcomed once in thirty days however often its account is deleted and made again, and a welcome counts against the day’s e-mail allowance', async t => {
  const m = await mailing(t, { env: { ...MAIL_ENV, EMAIL_DAILY_CAP: '2' } });
  const first = await m.signIn('UidAda'); await m.settled(1);
  assert.equal(m.mails().length, 1);
  // Delete and re-create, three times over: no second message.
  let cookie = first.cookie;
  for (let round = 0; round < 3; round++) {
    m.f.advance(301000);
    assert.equal((await m.proved('/api/account/delete', { confirm: 'delete', erase: true }, cookie, 'UidAda')).status, 200);
    const again = await m.signIn('UidAda'); cookie = again.cookie;
    assert.deepEqual([again.status, again.body.created], [200, true]);
    await m.settled(2, 150);
    assert.equal((await m.account('UidAda'))?.welcome, 'skipped');
  }
  assert.equal(m.mails().length, 1, 'one address, one message');
  const db = await m.stored();
  assert.equal(Object.keys(db.accountLog?.welcomed ?? {}).length, 1); assert.ok(!JSON.stringify(db.accountLog?.welcomed).includes('example.com'), 'what is remembered is a salted hash, not the address');
  // After thirty days a new account for that address is welcomed again.
  m.f.advance(30 * 86400000);
  await m.proved('/api/account/delete', { confirm: 'delete', erase: true }, (await m.signIn('UidAda')).cookie, 'UidAda');
  m.f.advance(301000);
  await m.signIn('UidAda'); await m.settled(2);
  assert.equal(m.mails().length, 2);
  // THE DAILY ALLOWANCE (2 here). One has gone out today; the next uses the allowance up; the one after waits — unsent, still owed, no attempt spent.
  assert.equal((await m.stored()).growth?.outreach?.sent[Object.keys((await m.stored()).growth?.outreach?.sent ?? {}).at(-1) ?? '']?.email, 1, 'a welcome is counted where the mailer’s other messages are');
  await m.signIn('UidBo'); await m.settled(3);
  assert.equal(m.mails().length, 3);
  await m.signIn('UidCy'); await m.settled(4, 200);
  assert.equal(m.mails().length, 3, 'at the allowance nothing more goes out today');
  assert.equal((await m.account('UidCy'))?.welcome, 'pending');
  assert.deepEqual((await m.stored()).accountLog?.welcome?.map(item => [item.id, item.tries, item.claimedAt]), [['fb:UidCy', 0, undefined]]);
  assert.deepEqual(m.logs, [], 'waiting for the allowance is not an error');
  // The next day it goes.
  m.f.advance(86400000); m.f.server.beat(); await m.settled(4);
  assert.equal(m.mails().length, 4); assert.equal(typeof (await m.account('UidCy'))?.welcome, 'number');
});

test('N6 — a claim nobody settled does not sit in the queue for good: after a day it gets one last attempt, and is abandoned if that one is not settled either', async t => {
  const m = await mailing(t);
  // A send that never returns: the claim is made and never settled (as when the host stops in the middle of a send).
  const original = m.provider.fetch;
  let hang = true, attempts = 0;
  // (A held request is let go after a few real seconds, long after the test has looked, so that the server can stop.)
  m.provider.fetch = (url, init = {}) => (String(url) === MAIL_URL ? (attempts += 1, hang ? new Promise<Response>((resolve) => { setTimeout(() => resolve(new Response('{}', { status: 400 })), 4000); }) : original(url, init)) : original(url, init));
  await m.signIn('UidAda'); await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(attempts, 1);
  const stuck = (await m.stored()).accountLog?.welcome ?? [];
  assert.equal(stuck.length, 1); assert.equal(typeof stuck[0]?.claimedAt, 'number');
  // Within the day nothing touches it: a message that may be on its way is not sent again.
  m.f.advance(23 * 3600000); m.f.server.beat(); await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(attempts, 1);
  // After a day: ONE last attempt.
  m.f.advance(2 * 3600000); m.f.server.beat(); await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(attempts, 2);
  assert.deepEqual((await m.stored()).accountLog?.welcome?.map(item => [item.id, item.last, typeof item.claimedAt]), [['fb:UidAda', true, 'number']]);
  // That one is not settled either: abandoned. Never a third.
  m.f.advance(25 * 3600000); m.f.server.beat(); await new Promise(resolve => setTimeout(resolve, 80));
  m.f.advance(25 * 3600000); m.f.server.beat(); await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(attempts, 2);
  const db = await m.stored();
  assert.deepEqual(db.accountLog?.welcome, []); assert.equal(db.accounts?.['fb:UidAda']?.welcome, 'failed');
  // A queue full of stuck claims no longer stops new accounts' messages: the stale ones are cleared when the next account is made.
  hang = false;
  await m.f.server.store.transact((store) => { const log = store.accountLog; if (log) log.welcome = Array.from({ length: 500 }, (_, n) => ({ id: `fb:Ghost${n}`, at: 0, tries: 0, nextAt: 0, claimedAt: m.f.now() - 2 * 86400000, last: true as const })); });
  m.f.advance(301000);
  const next = await m.signIn('UidEve'); await m.settled(3);
  assert.equal(next.status, 200); assert.equal(typeof (await m.account('UidEve'))?.welcome, 'number', 'the new account was not marked skipped');
  assert.equal((await m.stored()).accountLog?.welcome?.length, 0);
});
