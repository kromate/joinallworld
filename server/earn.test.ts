import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await preloadCityContent('lagos');
// OWNER: social — Earn (docs/EARN.md): a Bachs payout account opened on Bachs's own page, tickets and gig pay as direct charges on the
// earner's account with Allworld's fee, the creator pool from real revenue, the founder's transfers, and erasure.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { fixture } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { earnService, forgetEarnPlayers } from './earn/service.ts';
import { promoteOf } from './promote/service.ts';
import { poolSplit, feeOf, monthOf } from '../src/earn/model.ts';

const PROJECT = 'allworld-test-project', FOUNDER = 'founder.test@example.com', DAY = 86400000;
type Json = Record<string, any>;
const emailHash = (e: string): string => createHash('sha256').update(e.trim().toLowerCase()).digest('hex');
const BASE = 'https://sandbox-api.bachs.io';

/** A small fake of Bachs: accounts (ready once onboarded), checkouts (paid when the test says), payments, transfers. */
function fakeBachs() {
  const accounts = new Map<string, { email: string; onboarded: boolean }>(), checkouts = new Map<string, Json>(), paid = new Set<string>(), transfers: Json[] = [], seen: Json[] = [];
  let n = 0;
  async function handle(url: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Response> {
    const path = url.slice(BASE.length), body = init?.body ? JSON.parse(String(init.body)) : null, acct = init?.headers?.['X-Account-Id'];
    assert.equal(init?.headers?.Authorization, 'Bearer sk_sandbox_abcdefghijklmnop');
    seen.push({ path, body, acct, key: init?.headers?.['Idempotency-Key'] });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    const caps = (on: boolean) => Object.fromEntries(['ngn_card_collection', 'bank_transfer', 'transfers', 'payouts'].map((c) => [c, { status: on ? 'active' : 'restricted', requested: true }]));
    if (path === '/v1/accounts') { const id = `acct_${++n}x`; accounts.set(id, { email: body.contact_email, onboarded: false }); return json({ id, capabilities: caps(false), requirements: { currently_due: ['persons.x.id_document'], past_due: [] }, is_active: true }, 201); }
    let m = /^\/v1\/accounts\/(acct_\w+)\/account-links$/.exec(path);
    if (m) return json({ id: 'alnk_1', url: `https://connect.bachs.io/setup/c/${m[1]}/al_token` }, 201);
    m = /^\/v1\/accounts\/(acct_\w+)$/.exec(path);
    if (m) { const a = accounts.get(m[1]!)!; return json({ id: m[1], capabilities: caps(a.onboarded), requirements: { currently_due: a.onboarded ? [] : ['x'], past_due: [] }, is_active: true }); }
    if (path === '/v1/checkout-sessions') { const id = `chk_${++n}x`; checkouts.set(id, { ...body, acct }); return json({ checkout_id: id, checkout_url: `https://checkout.bachs.io/c/${id}`, status: 'open', reference: body.reference }, 201); }
    m = /^\/v1\/checkout-sessions\/(chk_\w+)$/.exec(path);
    if (m) { const c = checkouts.get(m[1]!)!; assert.equal(acct, c.acct, 'asked as the same account'); return json({ checkout_id: m[1], reference: c.reference, amount: c.pricing.amount, currency: 'NGN', ...(paid.has(c.reference) ? { charge: { payment_id: `pay_${m[1]}` } } : {}) }); }
    m = /^\/v1\/payments\/pay_(chk_\w+)$/.exec(path);
    if (m) { const c = checkouts.get(m[1]!)!; return json({ payment_id: `pay_${m[1]}`, checkout_id: m[1], reference: c.reference, amount: c.pricing.amount, currency: 'NGN', status: 'succeeded' }); }
    if (path === '/v1/transfers') { transfers.push({ ...body, key: init?.headers?.['Idempotency-Key'] }); return json({ status: 'paid', kind: 'manual', amount: body.amount, currency: 'NGN' }, 201); }
    return json({ detail: 'not found' }, 404);
  }
  return { handle, accounts, checkouts, paid, transfers, seen, onboard: (email: string) => { for (const a of accounts.values()) if (a.email === email) a.onboarded = true; }, payRef: (ref: string) => paid.add(ref) };
}

async function setup(t: TestContext) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]), bachs = fakeBachs();
  const fetcher = async (url: string, init?: { body?: unknown; headers?: Record<string, string> }) => (url.startsWith(BASE) ? bachs.handle(url, init) : provider.fetch(url, init as { body?: unknown }));
  const f = await fixture(t, { env: { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', FOUNDER_EMAIL_SHA256: emailHash(FOUNDER), NEW_SESSIONS_PER_ADDRESS: '1000', BACHS_API_KEY: 'sk_sandbox_abcdefghijklmnop' }, fetch: fetcher as never });
  const call = async (path: string, body?: unknown, cookie?: string): Promise<Json> => { const res = await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: f.base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, ...(await res.json() as object) }; };
  let minted = 0;
  async function account(address: string, name: string, adult = true): Promise<Device & { email: string }> {
    const d = await f.device(name); await f.request('/api/life?city=lagos', null, d.cookie);
    const { csrf } = await call('/api/account', undefined, d.cookie);
    const res = await fetch(f.base + '/api/account/sign-in', { method: 'POST', headers: { Origin: f.base, 'Content-Type': 'application/json', Cookie: d.cookie }, body: JSON.stringify({ idToken: await signToken(key, claimsFor(PROJECT, f.now(), { subject: `Uid${address.replace(/\W/g, '')}`, email: address, n: ++minted })), csrf }) });
    assert.equal(res.status, 200);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? d.cookie;
    await f.acceptSharingTerms(cookie);
    const out = { ...d, email: address, cookie };
    await call('/api/growth/hello', { cityId: 'lagos' }, out.cookie);
    await call('/api/growth/consent', { cityId: 'lagos', age: adult ? 'adult' : 'minor' }, out.cookie);
    await call('/api/social/me', undefined, out.cookie);
    return out;
  }
  /** Open a payout account and finish Bachs's onboarding for it. */
  async function earner(d: Device & { email: string }): Promise<void> {
    const r = await call('/api/earn/account', { email: d.email }, d.cookie);
    assert.match(r.url, /^https:\/\/connect\.bachs\.io\//);
    bachs.onboard(d.email);
    assert.equal((await call('/api/earn/account/refresh', {}, d.cookie)).status, 'ready');
  }
  const founder = await account(FOUNDER, 'Founder');
  return { f, call, account, earner, founder, bachs, earn: earnService(f.server.context) };
}

test('earn: the pool split is proportional, capped, and needs a minimum', () => {
  assert.deepEqual(poolSplit(10000, { a: 30, b: 10, c: 5 }, { minPoints: 10, capShare: 100 }), { a: 7500, b: 2500 });
  assert.deepEqual(poolSplit(10000, { a: 90, b: 10 }, { minPoints: 1, capShare: 10 }), { a: 1000, b: 1000 }, 'nobody takes more than the cap');
  assert.deepEqual(poolSplit(0, { a: 90 }, { minPoints: 1, capShare: 10 }), {});
  assert.equal(feeOf(1000, 10), 100);
  assert.equal(feeOf(1, 50), 0, 'the fee is always less than the price');
});

test('earn: a payout account is opened on Bachs\'s own page; guests and minors cannot; a ticket is a direct charge with Allworld\'s fee', async (t) => {
  const { f, call, account, earner, bachs } = await setup(t);
  const kid = await account('kid@example.com', 'Kid', false);
  assert.equal((await call('/api/earn/account', { email: 'kid@example.com' }, kid.cookie)).code, 'adults_only');
  const ada = await account('ada@example.com', 'Ada'), bola = await account('bola@example.com', 'Bola');
  const start = f.now() + 2 * DAY;
  const ev = await call('/api/feed/events', { title: 'Comedy night', start, hours: 3, place: 'The Square', cap: 10 }, ada.cookie);
  assert.equal((await call('/api/earn/price', { event: ev.event.id, price: 2000 }, ada.cookie)).code, 'payout_account', 'no price before the host can be paid');
  await earner(ada);
  assert.equal((await call('/api/earn/me', undefined, ada.cookie)).status, 'ready');
  assert.equal((await call('/api/earn/price', { event: ev.event.id, price: 2000 }, ada.cookie)).price, 2000);
  assert.equal((await call('/api/earn/price', { event: ev.event.id, price: 2000 }, bola.cookie)).code, 'unknown_event', 'only the host prices it');
  assert.equal((await call('/api/feed/events/rsvp', { id: ev.event.id, answer: 'going' }, bola.cookie)).code, 'ticket_needed');
  const order = await call('/api/earn/pay', { kind: 'ticket', id: ev.event.id, email: 'bola@example.com' }, bola.cookie);
  assert.match(order.pay, /^https:\/\/checkout\.bachs\.io\//);
  const sent = bachs.seen.find((s) => s.path === '/v1/checkout-sessions')!;
  assert.equal(sent.acct?.startsWith('acct_'), true, 'charged on the host\'s own account');
  assert.equal(sent.body.pricing.amount, '2000.00');
  assert.equal(sent.body.platform_fee, '100.00', '5% for Allworld');
  assert.equal((await call('/api/earn/pay/verify', { ref: order.sale.ref }, bola.cookie)).code, 'not_paid');
  bachs.payRef(order.sale.ref);
  assert.equal((await call('/api/earn/pay/verify', { ref: order.sale.ref }, ada.cookie)).code, 'unknown_sale', 'only the buyer checks');
  assert.equal((await call('/api/earn/pay/verify', { ref: order.sale.ref }, bola.cookie)).sale.status, 'paid');
  const seen = await call(`/api/feed/events/one?id=${ev.event.id}`, undefined, bola.cookie);
  assert.equal(seen.event.me, 'going');
  assert.equal(seen.event.ticket, true);
  const sold = await call('/api/earn/me', undefined, ada.cookie);
  assert.deepEqual(sold.sales.map((s: Json) => [s.side, s.status, s.amount, s.fee]), [['seller', 'paid', 2000, 100]]);
  assert.equal((await call('/api/earn/pay', { kind: 'ticket', id: ev.event.id, email: 'bola@example.com' }, bola.cookie)).code, 'has_ticket');
});

test('earn: a gig poster pays the worker directly with a 10% fee, once', async (t) => {
  const { call, account, earner, bachs } = await setup(t);
  const ada = await account('ada@example.com', 'Ada'), bola = await account('bola@example.com', 'Bola');
  const gig = await call('/api/feed/gigs', { title: 'Paint my shop sign', reward: 0 }, ada.cookie);
  await call('/api/feed/gigs/act', { id: gig.gig.id, op: 'apply' }, bola.cookie);
  assert.equal((await call('/api/earn/pay', { kind: 'gig', id: gig.gig.id, amount: 15000, email: 'ada@example.com' }, ada.cookie)).code, 'unknown_gig', 'nobody is doing it yet');
  await call('/api/feed/gigs/act', { id: gig.gig.id, op: 'choose', worker: bola.id }, ada.cookie);
  assert.equal((await call('/api/earn/pay', { kind: 'gig', id: gig.gig.id, amount: 15000, email: 'ada@example.com' }, ada.cookie)).code, 'earner_not_ready');
  await earner(bola);
  assert.equal((await call(`/api/earn/ready?id=${bola.id}`, undefined, ada.cookie)).ready, true);
  assert.equal((await call('/api/earn/pay', { kind: 'gig', id: gig.gig.id, amount: 15000, email: 'ada@example.com' }, bola.cookie)).code, 'unknown_gig', 'only the poster pays');
  const order = await call('/api/earn/pay', { kind: 'gig', id: gig.gig.id, amount: 15000, email: 'ada@example.com' }, ada.cookie);
  assert.equal(bachs.seen.filter((s) => s.path === '/v1/checkout-sessions').at(-1)!.body.platform_fee, '1500.00');
  bachs.payRef(order.sale.ref);
  assert.equal((await call('/api/earn/pay/verify', { ref: order.sale.ref }, ada.cookie)).sale.status, 'paid');
  assert.equal((await call('/api/feed/gigs?city=lagos', undefined, bola.cookie)).mine[0].paid, 15000);
  assert.equal((await call('/api/earn/pay', { kind: 'gig', id: gig.gig.id, amount: 15000, email: 'ada@example.com' }, ada.cookie)).code, 'paid');
});

test('earn: the creator pool shares real revenue by real engagement, held 30 days, sent by the founder only; erasure', async (t) => {
  const { f, call, account, earner, bachs, earn } = await setup(t);
  const ada = await account('ada@example.com', 'Ada'), givers = [await account('b@example.com', 'Bola'), await account('c@example.com', 'Chidi'), await account('d@example.com', 'Dayo'), await account('e@example.com', 'Emeka')];
  const post = await call('/api/feed/post', { body: 'Market is loud today' }, ada.cookie);
  const month = monthOf(f.now());
  // Four people a day for six days: 24 points (the same person twice in a day counts once).
  for (let day = 0; day < 6; day++) {
    for (const g of givers) await call('/api/feed/react', { id: post.post.id, emoji: day % 2 ? '🔥' : '❤️' }, g.cookie);
    await call('/api/feed/reply', { id: post.post.id, body: 'True talk' }, givers[0]!.cookie);
    if (monthOf(f.now() + DAY) !== month) break;
    f.advance(DAY);
  }
  const mine = await call('/api/earn/me', undefined, ada.cookie);
  assert.equal(mine.pool.points >= 4, true);
  // A month of real revenue: ₦100,000 of boosts.
  await f.server.store.transact((db) => { const c = promoteOf(f.server.context, db); c.revenue.months[month] = 100000; c.revenue.all += 100000; });
  const points = mine.pool.points;
  while (monthOf(f.now()) === month) f.advance(DAY);
  await f.server.store.transact((db) => earn.closeMonths(db));
  let founder = await account(FOUNDER, 'Founder');
  ada.cookie = (await account('ada@example.com', 'Ada')).cookie;
  const admin = await call('/api/admin/earn', undefined, founder.cookie);
  assert.equal(admin.ok, true, JSON.stringify(admin));
  const closed = admin.months.find((m: Json) => m.month === month);
  assert.equal(closed.pot, 30000, '30% of revenue');
  assert.equal(points >= 20, true, `enough points (${points})`);
  assert.deepEqual(closed.creators, [], 'one creator is capped at 10% (₦3,000), under the ₦10,000 payout: carried over');
  assert.equal((await call('/api/earn/me', undefined, ada.cookie)).pool.carried, 3000);
  // A month with a share big enough to pay.
  await f.server.store.transact((db) => { const m = earn.peek(db)!.pool.months[month]!; m.due = { [ada.id]: 12000 }; });
  assert.equal((await call('/api/admin/earn/pay', { month }, founder.cookie)).code, 'held', 'held 30 days after the month');
  f.advance(31 * DAY);
  founder = await account(FOUNDER, 'Founder');
  const other = await account('admin2@example.com', 'Admin Two');
  assert.equal((await call('/api/admin/earn/pay', { month }, other.cookie)).status, 404, 'not an admin');
  const r = await call('/api/admin/earn/pay', { month }, founder.cookie);
  assert.deepEqual([r.paid, r.waiting], [0, 1], 'Ada has no ready payout account yet');
  ada.cookie = (await account('ada@example.com', 'Ada')).cookie;
  await earner(ada);
  const r2 = await call('/api/admin/earn/pay', { month }, founder.cookie);
  assert.deepEqual([r2.paid, r2.waiting], [1, 0]);
  assert.deepEqual(bachs.transfers.map((x) => [x.amount, x.currency, x.key]), [['12000.00', 'NGN', `aw-pool-${month}-${ada.id}`]]);
  assert.equal((await call('/api/admin/earn/pay', { month }, founder.cookie)).paid, 0, 'never sent twice');
  assert.equal((await call('/api/earn/me', undefined, ada.cookie)).pool.months.find((m: Json) => m.month === month).status, 'paid');
  await f.server.store.transact((db) => forgetEarnPlayers(db, new Set([ada.id])));
  const stored = await f.server.store.read((db) => JSON.stringify((db as Record<string, unknown>).earn));
  assert.equal(stored.includes(ada.id), false);
});
