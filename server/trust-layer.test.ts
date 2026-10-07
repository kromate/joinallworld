import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await preloadCityContent('lagos');
// OWNER: trust — tiers, complaints, the admin's hand check, and venue chat's no-fee filter and stall links (server/trust/, routes/trust.ts).
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import type { Device, TestSocket } from './test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { emailHash } from './social/founder.ts';
import { peekTrust } from './trust/service.ts';
import type { ServerFrame } from '../src/types/protocol.ts';
import type { Database } from './types.ts';

const PROJECT = 'allworld-test-project', FOUNDER = 'founder.test@example.com';
const DAY = 86400000;
type Json = Record<string, any>;

async function setup(t: TestContext) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const env = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', FOUNDER_EMAIL_SHA256: emailHash(FOUNDER), NEW_SESSIONS_PER_ADDRESS: '1000' };
  const f = await fixture(t, { env, fetch: (url, init) => provider.fetch(url, init as { body?: unknown }) });
  const call = async (path: string, body?: unknown, cookie?: string): Promise<Json> => {
    const res = await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: f.base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, ...(await res.json() as object) };
  };
  let minted = 0;
  const guest = async (name: string): Promise<Device> => { const d = await f.device(name); await f.request('/api/life?city=lagos', null, d.cookie); return d; };
  async function account(address: string, name: string): Promise<Device> {
    const d = await guest(name);
    const idToken = await signToken(key, claimsFor(PROJECT, f.now(), { subject: `Uid${address.replace(/\W/g, '')}`, email: address, n: ++minted }));
    const { csrf } = await call('/api/account', undefined, d.cookie);
    const res = await fetch(f.base + '/api/account/sign-in', { method: 'POST', headers: { Origin: f.base, 'Content-Type': 'application/json', Cookie: d.cookie }, body: JSON.stringify({ idToken, csrf }) });
    assert.equal(res.status, 200);
    return { ...d, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? d.cookie };
  }
  const admin = (path: string, cookie: string, body: Json) => call(path, { clientId: f.id(), ...body }, cookie);
  const trust = (): Promise<ReturnType<typeof peekTrust>> => f.server.store.read((db) => JSON.parse(JSON.stringify(peekTrust(db))));
  return { f, call, guest, account, admin, trust };
}
async function until(peer: TestSocket, type: string): Promise<ServerFrame & Json> {
  for (let i = 0; i < 40; i += 1) { const frame = await peer.next(); if (frame.type === type) return frame as ServerFrame & Json; }
  throw new Error(`No ${type} frame`);
}

test('an old save without the trust collection, or a damaged one, reads as nobody checked', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada');
  for (const damaged of [undefined, 'garbage', { players: 7, reports: 'x', seq: -1 }, { players: { [ada.id]: { tier: 'king', at: 1 } }, reports: [{ id: 1 }] }]) {
    await s.f.server.store.transact((db: Database) => { (db as Json).trust = damaged; });
    const me = await s.call('/api/trust/me', undefined, ada.cookie);
    assert.deepEqual([me.status, me.tier, me.complaints, me.held], [200, 'claimed', 0, false], JSON.stringify(damaged));
  }
  const bola = await s.guest('Bola');
  assert.equal((await s.call('/api/trust/report', { about: ada.id, reason: 'scam' }, bola.cookie)).code, 'reported', 'a write repairs the damaged collection');
  assert.equal((await s.trust()).reports.length, 1);
});

test('a guest browses but cannot be checked; checks are coming soon; gates say why', async (t) => {
  const s = await setup(t);
  const g = await s.guest('Guest'), ada = await s.account('ada@example.com', 'Ada');
  const mine = await s.call('/api/trust/me', undefined, g.cookie);
  assert.deepEqual([mine.tier, mine.checks], ['guest', { phone: 'unavailable', id: 'unavailable' }]);
  assert.equal(mine.can.stall.code, 'account_required');
  assert.equal((await s.call('/api/trust/check/phone/start', {}, g.cookie)).code, 'account_required');
  for (const kind of ['phone', 'id']) {
    const started = await s.call(`/api/trust/check/${kind}/start`, {}, ada.cookie);
    assert.deepEqual([started.ok, started.code], [false, 'provider_unavailable']); assert.match(started.reason, /coming soon/);
  }
  assert.equal((await s.call('/api/trust/check/bvn/start', {}, ada.cookie)).status, 404);
  const can = (await s.call('/api/trust/me', undefined, ada.cookie)).can;
  assert.equal(can.stall.code, 'verification_required'); assert.equal(can.meetup.code, 'age_required');
  const badge = (await s.call(`/api/trust/profile/${ada.id}`, undefined, g.cookie)).badge;
  assert.deepEqual(badge, { id: ada.id, name: 'Ada', tier: 'claimed', label: 'Account', complaints: 0, held: false });
  assert.equal((await s.call('/api/trust/profile/not-an-id', undefined, g.cookie)).status, 400);
});

test('reports, the admin hand check, upheld complaints and the hold after three', async (t) => {
  const s = await setup(t);
  const founder = await s.account(FOUNDER, 'Founder'), seller = await s.account('seller@example.com', 'Seller'), ada = await s.account('ada@example.com', 'Ada');
  const buyers = [await s.guest('Buyer One'), await s.guest('Buyer Two'), await s.guest('Buyer Three')];
  // Not an admin: the admin routes are not there.
  for (const path of ['/api/admin/trust/reports', `/api/admin/trust/players/${seller.id}/act`]) {
    assert.equal((path.endsWith('/act') ? await s.admin(path, ada.cookie, { action: 'verify', tier: 'phone', reason: 'met' }) : await s.call(path, undefined, ada.cookie)).status, 404, path);
  }
  // The founder checks the seller by hand: a reason is required, a guest cannot be checked.
  const players = (id: string) => `/api/admin/trust/players/${id}/act`;
  assert.equal((await s.admin(players(seller.id), founder.cookie, { action: 'verify', tier: 'phone' })).error, 'reason_required');
  assert.equal((await s.admin(players(buyers[0]!.id), founder.cookie, { action: 'verify', tier: 'phone', reason: 'video call' })).code, 'account_required');
  const done = await s.admin(players(seller.id), founder.cookie, { action: 'verify', tier: 'phone', reason: 'video call with CAC certificate' });
  assert.deepEqual([done.ok, done.tier], [true, 'phone']);
  const me = await s.call('/api/trust/me', undefined, seller.cookie);
  assert.equal(me.tier, 'phone'); assert.equal(me.can.stall.code, 'account_too_new', 'a new account waits a day');
  s.f.advance(DAY + 1);
  assert.equal((await s.call('/api/trust/me', undefined, seller.cookie)).can.stall, null);
  assert.equal((await s.call('/api/trust/me', undefined, seller.cookie)).can.gig.code, 'verification_required');
  // Reports: reasons are checked, one open report per reporter and player, nobody reports themselves.
  assert.equal((await s.call('/api/trust/report', { about: seller.id, reason: 'rude' }, ada.cookie)).status, 400);
  assert.equal((await s.call('/api/trust/report', { about: seller.id, reason: 'scam' }, seller.cookie)).code, 'self');
  const ids: string[] = [];
  for (const [i, buyer] of buyers.entries()) {
    const filed = await s.call('/api/trust/report', { about: seller.id, reason: i ? 'fake-item' : 'fee-request', note: 'asked for 5k first' }, buyer.cookie);
    assert.equal(filed.code, 'reported'); ids.push(filed.id);
  }
  assert.equal((await s.call('/api/trust/report', { about: seller.id, reason: 'scam' }, buyers[0]!.cookie)).duplicate, true);
  const queue = await s.call('/api/admin/trust/reports', undefined, founder.cookie);
  assert.equal(queue.reports.length, 3); assert.equal('by' in queue.reports[0], false, 'the reporter is not shown');
  // Two upheld and one dismissed: counted, not held. A third upheld one holds the seller's listings.
  const act = (id: string, action: string) => s.admin(`/api/admin/trust/reports/${id}/act`, founder.cookie, { action });
  await act(ids[0]!, 'uphold'); await act(ids[1]!, 'uphold');
  assert.deepEqual([(await act(ids[2]!, 'dismiss')).held], [false]);
  assert.equal((await s.call(`/api/trust/profile/${seller.id}`, undefined, ada.cookie)).badge.complaints, 2);
  const more = await s.call('/api/trust/report', { about: seller.id, reason: 'scam' }, ada.cookie);
  const third = await act(more.id, 'uphold');
  assert.deepEqual([third.upheld, third.held], [3, true]);
  assert.equal((await s.call('/api/trust/me', undefined, seller.cookie)).can.stall.code, 'listings_held');
  // A review releases the hold; the count stays public for 90 days, then drops.
  assert.equal((await s.admin(players(seller.id), founder.cookie, { action: 'release', reason: 'spoke with both sides' })).code, 'released');
  const after = await s.call(`/api/trust/profile/${seller.id}`, undefined, ada.cookie);
  assert.deepEqual([after.badge.complaints, after.badge.held], [3, false]);
  // Every decision is in the audit log.
  const audit = await s.call('/api/admin/audit?limit=50', undefined, founder.cookie);
  const actions = (audit.lines as Json[]).map((line) => line.action);
  for (const action of ['trust-verify', 'trust-uphold', 'trust-dismiss', 'trust-release']) assert.ok(actions.includes(action), action);
  // The seller keeps playing; an account device must sign in again after 90 days, so a fresh visitor looks.
  for (let week = 0; week < 13; week += 1) { s.f.advance(7 * DAY + 1); await s.f.request('/api/life?city=lagos', null, seller.cookie); }
  const later = await s.call(`/api/trust/profile/${seller.id}`, undefined, (await s.guest('Visitor')).cookie);
  assert.equal(later.badge?.complaints, 0, JSON.stringify(later));
});

test('venue chat refuses fee requests; a checked stall owner may share allow-listed links in their own venue only', async (t) => {
  const s = await setup(t);
  const founder = await s.account(FOUNDER, 'Founder'), seller = await s.account('seller@example.com', 'Seller'), bola = await s.guest('Bola');
  const a = await s.f.joinRoom(seller), b = await s.f.joinRoom(bola); await until(a, 'presence');
  const say = async (body: string, clientId: string): Promise<ServerFrame & Json> => { a.ws.send(JSON.stringify({ type: 'chat', body, clientId })); return until(a, 'error'); };
  for (const [body, code] of [['Pay 5k to register for the job', 'fee_request'], ['registration na 2k', 'fee_request'], ['Double your money in 7 days', 'money_doubling']] as const) {
    const refused = await say(body, `fee-${code}-${body.length}`);
    assert.equal(refused.code, code, body); assert.match(refused.reason, /was not sent/);
  }
  // Not checked yet: links are refused like anyone's.
  assert.equal((await say('Order here wa.me/2348012345678', 'link-1')).code, 'links_not_allowed');
  await s.admin(`/api/admin/trust/players/${seller.id}/act`, founder.cookie, { action: 'verify', tier: 'phone', reason: 'checked by hand' });
  s.f.advance(DAY + 1);
  assert.equal((await say('Order here wa.me/2348012345678', 'link-2')).code, 'links_not_allowed', 'a checked player without a stall here');
  const stall = (venue: string) => s.f.server.store.transact((db: Database) => { (db as Json).business = { v: 1, shops: { [seller.id]: { by: { id: seller.id, name: 'Seller' }, city: 'lagos', venue, status: 'open' } }, reports: [], seq: 0 }; });
  await stall('market');
  assert.equal((await say('Order here wa.me/2348012345678', 'link-3')).code, 'links_not_allowed', 'a stall in another venue');
  await stall('park');
  for (const [body, code] of [['see evil.com/x', 'links_not_allowed'], ['wa.me/2348012345678 or call 08012345678', 'contact_not_allowed'], ['pay 2k to register: wa.me/2348012345678', 'fee_request']] as const) {
    assert.equal((await say(body, `bad-${body.length}`)).code, code, body);
  }
  a.ws.send(JSON.stringify({ type: 'chat', body: 'Fresh agege bread! Order here wa.me/2348012345678 or instagram.com/seller.bakes', clientId: 'link-ok' }));
  assert.equal((await until(b, 'chat')).body, 'Fresh agege bread! Order here wa.me/2348012345678 or instagram.com/seller.bakes');
});
