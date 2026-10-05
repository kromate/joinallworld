// OWNER: growth — comeback mail to an account holder: the verified address of the account is the recipient for its
// active character, "E-mail me about my character" starts on for an account made from now on, the welcome message and
// comeback mail share one ledger and one daily cap, and "unsubscribe from everything" works without signing in.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import { ENDPOINT } from './growth/email/zeptomail.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import type { ComebackView, HelloResult, OutreachRunResponse } from '../src/types/growth.ts';
import type { AccountStateResponse, SignInResponse } from '../src/types/account.ts';
import type { Db } from './types.ts';

const PROJECT = 'allworld-test-project';
const TOKEN = 'operator-token-for-comeback-tests-012345';
const ENV: Record<string, string> = {
  ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', ACCOUNTS_GOOGLE_CLIENT_ID: '1234567890-testclient.apps.googleusercontent.com',
  ZEPTOMAIL_AUTH: 'Zoho-enczapikey TESTKEY-not-a-real-key', EMAIL_FROM_ADDRESS: 'hello@mail.play.example', EMAIL_FROM_NAME: 'Allworld', EMAIL_CONTACT_LINE: 'Allworld, 1 Example Street',
};
interface Mail { personalizations: { to: { email: string }[] }[]; subject: string; headers: Record<string, string>; content: { type: string; value: string }[] }
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`expected ${what}`); return value; };

async function harness(t: TestContext) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]), sent: Mail[] = [];
  const f = await fixture(t, { moderatorToken: TOKEN, publicOrigin: 'https://play.example', env: ENV, fetch: async (url, init) => {
    if (String(url) === ENDPOINT) { sent.push(JSON.parse(String((init as RequestInit).body)) as Mail); return new Response(null, { status: 202 }); }
    return provider.fetch(String(url), init as { body?: unknown });
  } });
  const call = (path: string, body?: unknown, cookie?: string): Promise<Response> => fetch(f.base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: f.base, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let minted = 0;
  const token = (subject: string): Promise<string> => signToken(key, claimsFor(PROJECT, f.now(), { subject, email: `${subject.toLowerCase()}@example.com`, n: ++minted }));
  async function signIn(subject: string, cookie: string) {
    const state = await (await call('/api/account', undefined, cookie)).json() as AccountStateResponse;
    const response = await call('/api/account/sign-in', { idToken: await token(subject), csrf: state.csrf }, cookie);
    const set = response.headers.get('set-cookie');
    return { body: await response.json() as SignInResponse, cookie: set ? set.split(';')[0] ?? '' : '' };
  }
  const post = async <R = Record<string, unknown>>(path: string, body: unknown, cookie: string): Promise<R> => (await (await call(path, body, cookie)).json()) as R;
  const hello = async (cookie: string): Promise<Extract<HelloResult, { ok: true }>> => post('/api/growth/hello', { cityId: 'lagos' }, cookie);
  const run = async (): Promise<OutreachRunResponse> => (await (await fetch(f.base + '/api/mod/growth/outreach/run', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: '{}' })).json()) as OutreachRunResponse;
  const go = (day: number, hour = 12): void => { const target = Date.UTC(1970, 0, 1 + day, hour - 1); assert.ok(target >= f.now(), 'time only goes forward'); f.advance(target - f.now()); };
  const edit = (fn: (db: Db) => void) => f.server.store.transact((db) => { fn(db); });
  const read = <R>(fn: (db: Db) => R): Promise<R> => f.server.store.read(fn);
  const page = async (path: string, method = 'GET', body?: string) => { const res = await fetch(f.base + path, { method, ...(body ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body } : {}) }); return { status: res.status, html: await res.text() }; };
  /** A guest with a played life, then signed in to a NEW account. */
  async function newAccount(name: string, subject: string) {
    const guest = await f.device(name);
    await f.request('/api/life?city=lagos', null, guest.cookie);
    const signed = await signIn(subject, guest.cookie);
    assert.equal(signed.body.created, true);
    await hello(signed.cookie); await call('/api/social/me', undefined, signed.cookie);
    return { id: guest.id, cookie: signed.cookie };
  }
  return { f, sent, call, signIn, post, hello, run, go, edit, read, page, newAccount };
}
const mailsOf = (sent: Mail[]): Mail[] => sent.filter((mail) => !/^Welcome/i.test(mail.subject));

test('an account made now starts with the e-mails about its character on, to its verified address, and the welcome is one of its mails', async (t) => {
  const h = await harness(t);
  h.go(0, 12);
  const ada = await h.newAccount('Ada', 'UidAda');
  const view = (await h.hello(ada.cookie)).contact.comeback;
  assert.equal(view.source, 'account'); assert.equal(view.on, true);
  assert.ok(view.address && !view.address.includes('uidada'), 'the address is shown masked');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const welcome = h.sent.filter((mail) => mail.personalizations[0]?.to[0]?.email === 'uidada@example.com');
  assert.equal(welcome.length, 1, 'the welcome went out once');
  const stored = await h.read((db) => structuredClone({ rec: db.growth?.comeback?.[ada.id], acct: Object.values(db.accounts ?? {})[0] }));
  assert.equal(stored.rec?.acct, true); assert.equal(stored.rec?.on, true);
  assert.equal(stored.acct?.mailOptIn, true);
  assert.equal(JSON.stringify(stored.rec).includes('@'), false, 'no address in the comeback record');
});

test('one ledger and one daily cap: a new account is not sent a comeback mail within a day of its welcome', async (t) => {
  const h = await harness(t);
  h.go(0, 12);
  const ada = await h.newAccount('Ada', 'UidAda'), bola = await h.f.device('Bola');
  await h.f.request('/api/life?city=lagos', null, bola.cookie); await h.hello(bola.cookie); await h.post('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, bola.cookie); await h.f.request('/api/social/me', null, bola.cookie);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(h.sent.length, 1, 'the welcome');
  await h.post('/api/social/friends/request', { to: ada.id, cityId: 'lagos' }, bola.cookie);
  await h.post('/api/social/friends/answer', { from: bola.id, accept: true, cityId: 'lagos' }, ada.cookie);
  await h.post('/api/social/messages', { to: ada.id, body: 'hello', clientId: h.f.id() }, bola.cookie);
  // 13 hours later Ada has been away long enough and a friend is waiting; the welcome of that morning still holds the day.
  h.go(1, 10);
  await h.run();
  assert.equal(h.sent.length, 1, 'nothing but the welcome within a day of it');
  h.go(2, 14);
  await h.run();
  assert.equal(h.sent.length, 2, 'then the comeback mail, to the account address');
  const after = mailsOf(h.sent);
  assert.equal(after[0]?.personalizations[0]?.to[0]?.email, 'uidada@example.com');
  assert.match(after[0]?.subject ?? '', /Bola is waiting for you/);
  const ledger = await h.read((db) => db.growth?.comeback?.[ada.id]?.sent.map((entry) => entry.type));
  assert.deepEqual(ledger, ['welcome', 'waiting']);
});

test('unsubscribing from everything works for an account holder without signing in, and nothing more is sent', async (t) => {
  const h = await harness(t);
  h.go(0, 12);
  const ada = await h.newAccount('Ada', 'UidAda'), bola = await h.f.device('Bola');
  await h.f.request('/api/life?city=lagos', null, bola.cookie); await h.hello(bola.cookie); await h.post('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, bola.cookie); await h.f.request('/api/social/me', null, bola.cookie);
  await h.post('/api/social/friends/request', { to: ada.id, cityId: 'lagos' }, bola.cookie);
  await h.post('/api/social/friends/answer', { from: bola.id, accept: true, cityId: 'lagos' }, ada.cookie);
  await h.post('/api/social/messages', { to: ada.id, body: 'hello', clientId: h.f.id() }, bola.cookie);
  h.go(3, 14); await h.run();
  const mail = must(mailsOf(h.sent)[0]);
  assert.match(mail.subject, /Bola is waiting for you/);
  const header = must(/^<https:\/\/play\.example(\/e\/unsub\?t=[^>]+)>$/.exec(must(mail.headers['List-Unsubscribe'])))[1] ?? '';
  const shown = await h.page(header);
  assert.ok(shown.status === 200 && /Unsubscribe<\/button>/.test(shown.html));
  assert.equal((await h.read((db) => db.growth?.comeback?.[ada.id]?.on)), true, 'a GET changes nothing');
  // The one-click POST: no cookie, no sign-in.
  assert.equal((await h.page(header, 'POST', 'List-Unsubscribe=One-Click')).status, 200);
  const after = await h.read((db) => structuredClone({ rec: db.growth?.comeback?.[ada.id], acct: Object.values(db.accounts ?? {})[0] }));
  assert.equal(after.rec?.on, false); assert.equal(after.acct?.mailOptIn, undefined); assert.equal(after.acct?.email, 'uidada@example.com', 'the account itself is untouched');
  assert.equal((await h.hello(ada.cookie)).contact.comeback.on, false);
  await h.post('/api/social/messages', { to: ada.id, body: 'again', clientId: h.f.id() }, bola.cookie);
  h.go(30, 14); await h.run();
  assert.equal(mailsOf(h.sent).length, 1);
  // The same link is still done when used twice, and a forged one is refused.
  assert.equal((await h.page(header, 'POST', 'List-Unsubscribe=One-Click')).status, 200);
  const dot = header.lastIndexOf('.') + 1;
  assert.equal((await h.page(`${header.slice(0, dot)}${header[dot] === 'A' ? 'B' : 'A'}${header.slice(dot + 1)}`, 'POST')).status, 400);
  // The owner can switch it on again in Settings, with the same switches.
  const on = await h.post<{ ok: boolean; comeback: ComebackView }>('/api/growth/comeback', { cityId: 'lagos', on: true }, ada.cookie);
  assert.equal(on.ok, true); assert.equal(on.comeback.on, true); assert.equal(on.comeback.source, 'account');
});

test('an account made before this change is not switched on, and a character set aside is not written to', async (t) => {
  const h = await harness(t);
  h.go(0, 12);
  const ada = await h.newAccount('Ada', 'UidAda');
  await h.edit((db) => { for (const account of Object.values(db.accounts ?? {})) delete account.mailOptIn; delete db.growth?.comeback?.[ada.id]; });
  assert.equal((await h.hello(ada.cookie)).contact.comeback.on, false, 'an older account has to switch it on itself');
  const on = await h.post<{ ok: boolean; comeback: ComebackView }>('/api/growth/comeback', { cityId: 'lagos', on: true }, ada.cookie);
  assert.equal(on.ok, true); assert.equal(on.comeback.on, true);
  // A guest with nothing at all has no address to switch anything on for.
  const guest = await h.f.device('Guest'); await h.f.request('/api/life?city=lagos', null, guest.cookie); await h.hello(guest.cookie);
  assert.equal((await h.post<{ ok: boolean; code: string }>('/api/growth/comeback', { cityId: 'lagos', on: true }, guest.cookie)).code, 'no_address');
});
