// OWNER: accounts — the launch bonus on the Node host (server/bonus/service.ts, server/routes/bonus.ts). The sign-in provider is the
// stand-in of server/accounts/test-tokens.ts. Rules of the money itself: src/game/admin.test.ts. The Worker's run: deploy/bonus.edge.test.ts.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import type { FixtureOptions } from './test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { BONUS_DEFAULTS, bonusConfig, claimedOf, publicOffer } from './bonus/service.ts';
import { ROUTE_MODULES } from './routes/index.ts';
import { sanctionsOf } from './admin/sanctions.ts';
import { sharePageHtml } from './growth/share.ts';
import { accountWelcomeMail } from './growth/email/templates.ts';
import type { RouteContext } from './types.ts';
import type { BonusClaimResponse, BonusOfferResponse, SignInResponse } from '../src/types/account.ts';

const PROJECT = 'allworld-test-project';
const ACCOUNTS = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' };
type Json = Record<string, unknown>;
const DAY = 86400000;

/** The shared helpers of the bonus tests (also used by the Worker's run through `bonusJourney`-style calls: they only use HTTP). */
export async function bonusHost(t: TestContext, env: Record<string, unknown> = {}, options: FixtureOptions = {}) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const f = await fixture(t, { env: { ...ACCOUNTS, NEW_SESSIONS_PER_ADDRESS: '1000', ...env }, fetch: (url, init) => provider.fetch(url, init as { body?: unknown }), log: () => {}, ...options });
  const call = (path: string, body?: unknown, cookie?: string | null): Promise<Response> => {
    const headers: Record<string, string> = { Origin: f.base, ...(body !== undefined && body !== null ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) };
    return fetch(f.base + path, { method: body !== undefined && body !== null ? 'POST' : 'GET', headers, body: body !== undefined && body !== null ? JSON.stringify(body) : undefined });
  };
  let minted = 0;
  const token = (subject: string): Promise<string> => signToken(key, claimsFor(PROJECT, f.now(), { subject, email: `${subject.toLowerCase()}@example.com`, n: ++minted }));
  const csrf = async (cookie: string): Promise<string | null> => ((await (await call('/api/account', null, cookie)).json()) as { csrf: string | null }).csrf;
  const post = async (path: string, body: Json, cookie: string): Promise<Response> => call(path, { ...body, csrf: await csrf(cookie) }, cookie);
  async function signIn(subject: string, cookie?: string | null) {
    const response = cookie ? await post('/api/account/sign-in', { idToken: await token(subject) }, cookie) : await call('/api/account/sign-in', { idToken: await token(subject) });
    const set = response.headers.get('set-cookie');
    return { status: response.status, body: await response.json() as SignInResponse, cookie: set ? set.split(';')[0] ?? '' : '' };
  }
  /** A guest with a played life in Lagos. */
  async function player(name: string) { const device = await f.device(name); await f.request('/api/life?city=lagos', null, device.cookie); return device; }
  /** An account made the way a guest makes one: signs up with a played life. */
  async function account(subject: string, name: string) { const guest = await player(name); const signed = await signIn(subject, guest.cookie); return { ...signed, id: guest.id, guest }; }
  const life = async (cookie: string) => (await (await f.request('/api/life?city=lagos', null, cookie)).json() as { state: { cash: number; social: { earned: number }; ledger: { amount: number; reason: string; balance: number }[] } }).state;
  const claim = async (cookie: string, seen = false): Promise<BonusClaimResponse & { status: number }> => { const r = await post('/api/account/bonus', seen ? { seen: true } : {}, cookie); return { status: r.status, ...(await r.json() as BonusClaimResponse) }; };
  const offer = async (): Promise<{ status: number; cache: string | null; body: BonusOfferResponse }> => { const r = await call('/api/world/bonus'); return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() as BonusOfferResponse }; };
  const stored = <T>(read: (db: Parameters<Parameters<typeof f.server.store.read>[0]>[0]) => T): Promise<T> => f.server.store.read(read) as Promise<T>;
  return { f, call, post, token, signIn, player, account, life, claim, offer, stored };
}
const LABEL = 'Launch bonus: one of the first 10,000 players';
const START = 5000;

test('the public offer: tiny, cached, no personal data; left is rounded down above 100 and exact at 100 or fewer', async (t) => {
  const b = await bonusHost(t);
  const first = await b.offer();
  assert.deepEqual([first.status, first.cache], [200, 'public, max-age=45']);
  const { serverTime, ...offer } = first.body as BonusOfferResponse & { serverTime?: number };
  assert.ok(serverTime);
  assert.deepEqual(offer, { on: true, amount: 1_000_000, places: 10_000, left: 10_000 });
  const config = { on: true, amount: 1, places: 10_000, perAddressDay: 20 };
  assert.equal(publicOffer(config, 9_873).left, 120);
  assert.equal(publicOffer(config, 9_899).left, 100, 'at 101 left: rounded down to 100');
  assert.equal(publicOffer(config, 9_900).left, 100, 'exact at 100');
  assert.equal(publicOffer(config, 9_945).left, 55, 'exact at 100 or fewer');
  assert.deepEqual([publicOffer(config, 10_000).on, publicOffer(config, 10_000).left, publicOffer(config, 12_000).left], [false, 0, 0], 'ended');
  assert.equal(publicOffer({ ...config, on: false }, 0).on, false);
});

test('the settings: the defaults, the environment, a bad value ignored, and a runtime setting wins', () => {
  const none = bonusConfig({ env: () => '', checks: {} });
  assert.deepEqual(none, { on: true, amount: BONUS_DEFAULTS.amount, places: BONUS_DEFAULTS.places, perAddressDay: BONUS_DEFAULTS.perAddressDay });
  const env: Record<string, string> = { LAUNCH_BONUS: 'off', LAUNCH_BONUS_AMOUNT: '250000', LAUNCH_BONUS_PLACES: '500', LAUNCH_BONUS_PER_ADDRESS_DAY: '3' };
  assert.deepEqual(bonusConfig({ env: (name) => env[name] ?? '', checks: {} }), { on: false, amount: 250_000, places: 500, perAddressDay: 3 });
  assert.equal(bonusConfig({ env: () => 'lots', checks: {} }).amount, BONUS_DEFAULTS.amount, 'a value that is not a number is ignored');
  const set: Record<string, boolean | number> = { launchBonus: true, launchBonusAmount: 7, launchBonusPlaces: 9 };
  assert.deepEqual(bonusConfig({ env: (name) => env[name] ?? '', checks: { setting: (key) => set[key] } }), { on: true, amount: 7, places: 9, perAddressDay: 3 }, 'the admin screen changes the offer without a release');
});

test('a guest gets nothing; signing up pays once, as its own ledger line, never counted as earned from work', async (t) => {
  const b = await bonusHost(t);
  const guest = await b.player('Ada');
  const before = await b.life(guest.cookie);
  assert.equal(before.cash, START);
  assert.equal((await b.call('/api/account/bonus', { csrf: 'x' }, guest.cookie)).status, 403, 'a guest cannot even ask');
  assert.equal(await b.stored(claimedOf), 0);
  const signed = await b.signIn('UidAda', guest.cookie);
  assert.equal(signed.status, 200);
  const now = await b.life(signed.cookie);
  assert.equal(now.cash, START + 1_000_000);
  assert.deepEqual(now.ledger.filter((line) => line.reason === LABEL).map((line) => line.amount), [1_000_000]);
  assert.equal(now.social.earned, before.social.earned, 'it unlocks no gifting and no buying from players');
  const first = now.ledger[0]!;
  assert.equal(now.cash, first.balance - first.amount + now.ledger.reduce((sum, line) => sum + line.amount, 0), 'cash equals what the life started with plus its ledger');
  const mine = await b.claim(signed.cookie);
  assert.deepEqual([mine.state, mine.n, mine.amount, mine.show], ['paid', 1, 1_000_000, true]);
  assert.equal((await b.claim(signed.cookie, true)).show, true, 'the answer that carries `seen` still says it was news');
  assert.equal((await b.claim(signed.cookie)).show, false, 'told once: not again');
  const marker = await b.stored((db) => Object.values(db.accounts ?? {})[0]?.bonus);
  assert.deepEqual([marker?.n, marker?.amount, marker?.held, marker?.told], [1, 1_000_000, undefined, true]);
  assert.equal(await b.stored(claimedOf), 1);
  assert.equal((await b.offer()).body.left, 9_990, '9,999 left is shown as 9,990');
});

test('an account that existed before the offer is paid the next time it opens the game; a replay changes nothing', async (t) => {
  const b = await bonusHost(t, { LAUNCH_BONUS: 'off' });
  const ada = await b.account('UidAda', 'Ada');
  assert.equal((await b.life(ada.cookie)).cash, START, 'the offer is off: nothing at sign-up');
  assert.deepEqual([(await b.offer()).body.on, (await b.claim(ada.cookie)).state], [false, 'ended']);
  assert.equal(await b.stored(claimedOf), 0);
  // The offer comes on: the same account, opening the game, is paid.
  const host = await bonusHost(t);
  const legacy = await host.account('UidLegacy', 'Lee');
  await host.f.server.store.transact((db) => { const entry = Object.values(db.accounts ?? {})[0]; assert.ok(entry); delete entry.bonus; const record = db.sessions[entry.sessionKey ?? '']; assert.ok(record); const state = record.cities.lagos?.state; assert.ok(state); state.cash = START; state.ledger = []; state.ledgerDays = []; delete (db as Record<string, unknown>)['launchBonus']; delete (db as Record<string, unknown>)['launchBonusSeen']; });
  assert.equal((await host.life(legacy.cookie)).cash, START);
  const paid = await host.claim(legacy.cookie);
  assert.deepEqual([paid.state, paid.n, paid.show], ['paid', 1, true]);
  assert.equal((await host.life(legacy.cookie)).cash, START + 1_000_000);
  const again = await Promise.all([host.claim(legacy.cookie), host.claim(legacy.cookie), host.claim(legacy.cookie)]);
  assert.ok(again.every((answer) => answer.state === 'paid' && answer.n === 1));
  assert.equal((await host.life(legacy.cookie)).cash, START + 1_000_000, 'replays pay nothing more');
  assert.equal(await host.stored(claimedOf), 1);
});

test('one bonus per account, ever: another device, another character, a restored character and signing in again pay nothing more', async (t) => {
  const b = await bonusHost(t);
  const ada = await b.account('UidAda', 'Ada');
  assert.equal((await b.life(ada.cookie)).cash, START + 1_000_000);
  // A second browser with its own played life signs in to the same account: that life is set aside, nobody is paid.
  const other = await b.player('Other');
  const second = await b.signIn('UidAda', other.cookie);
  assert.equal(second.body.outcome, 'parked');
  assert.equal(await b.stored(claimedOf), 1);
  assert.equal((await b.life(second.cookie)).cash, START + 1_000_000, 'the account\'s character is the one in play: no second payment');
  // Both devices at once.
  const both = await Promise.all([b.claim(ada.cookie), b.claim(second.cookie)]);
  assert.ok(both.every((answer) => answer.state === 'paid' && answer.n === 1));
  // Signing out and in again, and a plain restore on a clean browser.
  const out = await b.post('/api/account/sign-out', {}, second.cookie);
  assert.equal(out.status, 200);
  const back = await b.signIn('UidAda');
  assert.equal(back.body.outcome, 'restored');
  assert.equal((await b.life(back.cookie)).cash, START + 1_000_000);
  assert.equal(await b.stored(claimedOf), 1);
  // The set-aside character was not paid and does not qualify: the account's marker is what counts.
  const parked = await b.stored((db) => Object.values(db.archivedLives ?? {}).map((life) => life.cities.lagos?.state?.cash));
  assert.deepEqual(parked, [START]);
  // Deleting the account and making it again does not claim a second time.
  const gone = await b.post('/api/account/delete', { idToken: await b.token('UidAda'), confirm: 'delete' }, back.cookie);
  assert.equal(gone.status, 200);
  const cookie = (gone.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const again = await b.signIn('UidAda', cookie);
  assert.equal(again.body.created, true);
  assert.equal(await b.stored(claimedOf), 1, 'no second place');
  assert.equal((await b.claim(again.cookie)).state, 'none');
  assert.equal((await b.life(again.cookie)).cash, START + 1_000_000, 'and no second payment');
});

test('the counter is exact at the boundary: at most the places are paid, however many ask at once', async (t) => {
  const b = await bonusHost(t, { LAUNCH_BONUS_PLACES: '3', LAUNCH_BONUS_PER_ADDRESS_DAY: '100' });
  const guests = [];
  for (const name of ['Aaron', 'Bella', 'Chidi', 'Dayo', 'Efe']) guests.push(await b.player(name));
  const signed = await Promise.all(guests.map((guest, i) => b.signIn(`UidRace${i}`, guest.cookie)));
  assert.ok(signed.every((entry) => entry.status === 200));
  const cash = await Promise.all(signed.map(async (entry) => (await b.life(entry.cookie)).cash));
  assert.equal(cash.filter((value) => value === START + 1_000_000).length, 3);
  assert.equal(cash.filter((value) => value === START).length, 2);
  assert.equal(await b.stored(claimedOf), 3);
  const numbers = await b.stored((db) => Object.values(db.accounts ?? {}).map((entry) => entry.bonus?.n).filter((n) => n !== undefined).sort());
  assert.deepEqual(numbers, [1, 2, 3], 'each place is a different number');
  const late = await Promise.all(signed.map((entry) => b.claim(entry.cookie)));
  assert.equal(late.filter((answer) => answer.state === 'paid').length, 3);
  assert.equal(late.filter((answer) => answer.state === 'ended').length, 2);
  assert.deepEqual([(await b.offer()).body.on, (await b.offer()).body.left], [false, 0]);
});

test('signing up before a character exists reserves the place; it is paid when the character starts', async (t) => {
  const b = await bonusHost(t);
  const bob = await b.signIn('UidBob');
  assert.equal(bob.body.outcome, 'signed_in');
  const waiting = await b.claim(bob.cookie);
  assert.deepEqual([waiting.state, waiting.held, waiting.n], ['held', 'character', 1]);
  assert.equal(await b.stored(claimedOf), 1, 'the place is reserved at once');
  // Somebody else signs up and takes place 2 while he waits.
  const cy = await b.account('UidCy', 'Cyrus');
  assert.equal((await b.claim(cy.cookie)).n, 2);
  const started = await b.call('/api/session', { name: 'Bobby' }, bob.cookie);
  assert.equal(started.status, 200);
  await b.f.request('/api/life?city=lagos', null, bob.cookie);
  const paid = await b.claim(bob.cookie);
  assert.deepEqual([paid.state, paid.n, paid.show], ['paid', 1, true]);
  assert.equal((await b.life(bob.cookie)).cash, START + 1_000_000);
});

test('over the address cap the payment is held, not lost, and arrives on a later day', async (t) => {
  const b = await bonusHost(t, { LAUNCH_BONUS_PER_ADDRESS_DAY: '2' });
  const one = await b.account('UidOne', 'Olamide'), two = await b.account('UidTwo', 'Tunde'), three = await b.account('UidThree', 'Thelma');
  assert.equal((await b.life(one.cookie)).cash, START + 1_000_000);
  assert.equal((await b.life(two.cookie)).cash, START + 1_000_000);
  assert.equal((await b.life(three.cookie)).cash, START, 'a third from the same address waits');
  const waiting = await b.claim(three.cookie);
  assert.deepEqual([waiting.state, waiting.held, waiting.n], ['held', 'address', 3]);
  assert.equal((await b.claim(three.cookie)).state, 'held', 'asking again the same day counts for nothing');
  b.f.advance(DAY + 1000);
  const later = await b.claim(three.cookie);
  assert.deepEqual([later.state, later.n, later.show], ['paid', 3, true]);
  assert.equal((await b.life(three.cookie)).cash, START + 1_000_000);
  assert.equal(await b.stored(claimedOf), 3);
});

test('the amount and the places come from the settings; off gives nobody a new place', async (t) => {
  const b = await bonusHost(t, { LAUNCH_BONUS_AMOUNT: '2500' });
  const ada = await b.account('UidAda', 'Ada');
  assert.equal((await b.life(ada.cookie)).cash, START + 2500);
  assert.equal((await b.offer()).body.amount, 2500);
  const off = await bonusHost(t, { LAUNCH_BONUS: 'off' });
  const bea = await off.account('UidBea', 'Bea');
  assert.equal((await off.life(bea.cookie)).cash, START);
  assert.equal((await off.offer()).body.on, false);
});

test('a banned account gets nothing, and a refused place is not taken', async (t) => {
  const held: { ctx?: RouteContext } = {};
  const b = await bonusHost(t, {}, { routes: [...ROUTE_MODULES, (ctx: RouteContext) => { held.ctx = ctx; return {}; }] });
  const guest = await b.player('Banned');
  sanctionsOf(held.ctx!).sync({ [guest.id]: { ban: { until: 0, reason: 'test', at: 1, by: 'x' } } }, {});
  const signed = await b.signIn('UidBanned', guest.cookie);
  assert.equal(signed.status, 200);
  assert.deepEqual(await b.stored((db) => Object.values(db.sessions).map((record) => record.cities.lagos?.state?.cash)), [START], 'nothing was paid');
  assert.deepEqual([(await b.claim(signed.cookie)).state, await b.stored(claimedOf)], ['none', 0]);
});

test('the welcome mail names the bonus only when the account holds one', () => {
  const plain = accountWelcomeMail({ name: 'Ada', playUrl: 'https://example.test/' });
  assert.ok(!plain.text.includes('first 10,000 players'));
  const paid = accountWelcomeMail({ name: 'Ada', playUrl: 'https://example.test/', bonus: { amount: 1_000_000, places: 10_000, paid: true } });
  assert.ok(paid.text.includes('You are one of the first 10,000 players: ₦1,000,000 in-game is in your wallet.'));
  assert.ok(paid.html.includes('in-game is in your wallet'));
  const held = accountWelcomeMail({ name: 'Ada', playUrl: 'https://example.test/', bonus: { amount: 1_000_000, places: 10_000, paid: false } });
  assert.ok(held.text.includes('is reserved for you'));
});

test('the share preview page names the offer only while it is open', () => {
  const share = { by: '11111111-2222-4333-8444-555555555555', facts: { kind: 'invite', name: 'Ada', city: 'Lagos', district: 'Yaba' } } as unknown as Parameters<typeof sharePageHtml>[0];
  const open = sharePageHtml(share, 'abcd1234', 'https://example.test', { on: true, amount: 1_000_000, places: 10_000 });
  assert.ok(open.includes('The first 10,000 players get ₦1,000,000 in the game.'));
  assert.ok(!sharePageHtml(share, 'abcd1234', 'https://example.test', { on: false, amount: 1_000_000, places: 10_000 }).includes('first 10,000'));
  assert.ok(!sharePageHtml(share, 'abcd1234', 'https://example.test').includes('first 10,000'));
});
