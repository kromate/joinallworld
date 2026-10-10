// Requests for money on the Worker host (server/social/service.ts requestMoney / answerMoneyRequest), against the real Durable Object
// and its SQLite tables in Miniflare. A request made before the object is evicted is still there afterwards and is paid once. The one
// piece of state that is seeded is the payer's earned money (the gift rule), written to the stored session row; every call is a real route.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { layoutBindings } from '../server/testing/sqliteStorage.ts';

type MiniflareResponse = Response
interface MiniflareInstance {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<MiniflareResponse>
  unsafeEvictDurableObject(script: string, className: string, id: { name: string; webSockets?: 'hibernate' }): Promise<void>
  unsafeGetDurableObjectStorage(script: string, name: string, id: { name: string }): Promise<{ exec(query: string, ...bindings: (string | number | null)[]): Promise<unknown[]> }>
}
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external: string[] }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: BundleOptions): Promise<unknown> };

interface Device { id: string; name: string; cookie: string }
interface View { id: string; amount: number; note?: string; state: string; mine: boolean; payable: boolean; receipt?: string }
interface Answer { ok?: boolean; code?: string; error?: string; reason?: string; duplicate?: boolean; request?: View; receipt?: string; balance?: number; amount?: number; state?: { cash: number }; messages?: { request?: View; gift?: { amount: number } }[]; conversations?: { id: string; with: string | null }[] }

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-money-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-money', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { ...layoutBindings(), BUILD_ID: 'local-money', FOUNDER_EMAIL_SHA256: '' } };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} });
  const handed: MiniflareResponse[] = [];
  const within = <T>(step: string, work: Promise<T>, ms = 30000) => { let timer: NodeJS.Timeout; return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${step} did not finish within ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer)); };
  const send = async (url: string, init?: RequestInit & { headers?: Record<string, string> }) => { const response = await mf.dispatchFetch(url, init); handed.push(response); return response; };
  t.after(async () => {
    for (const response of handed.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {});
    await within('Miniflare dispose', mf.dispose());
    await rm(folder, { recursive: true, force: true });
  });
  await mf.ready;
  const origin = 'https://joinallworld.test';
  const request = async (path: string, body: object | null, who?: Device): Promise<Answer & { status: number }> => {
    const response = await send(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(who ? { cookie: who.cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, ...(await response.json() as Answer) };
  };
  async function player(name: string): Promise<Device> {
    const response = await send(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    assert.equal(response.status, 200);
    const who: Device = { ...(await response.json() as { session: { id: string; name: string } }).session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    await request('/api/life?city=lagos', null, who); await request('/api/social/me', null, who);
    return who;
  }
  const id = (): string => `${Date.now()}:${randomUUID()}`;
  const storage = () => mf.unsafeGetDurableObjectStorage('joinallworld-money', 'JoinAllworldState', { name: 'joinallworld-v1' });
  /** SEEDED: the payer has earned ₦3,000 from work, which the gift rule asks for. Written to the stored session row; the object is evicted after. */
  async function seedEarned(who: Device): Promise<void> {
    const db = await storage(), secret = who.cookie.slice(who.cookie.indexOf('=') + 1);
    const rows = await db.exec('SELECT value FROM sessions WHERE secret = ?', secret);
    assert.equal(rows.length, 1);
    const session = JSON.parse(String((rows[0] as { value: unknown }).value)) as { cities: { lagos: { state: { social: { earned: number } } } } };
    session.cities.lagos.state.social.earned = 3000;
    await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), secret);
  }
  return { request, player, id, seedEarned, restart: () => mf.unsafeEvictDurableObject('joinallworld-money', 'JoinAllworldState', { name: 'joinallworld-v1' }), page: (path: string) => send(origin + path) };
}


test('Cloudflare requests for money: a pending request survives the object being evicted and is paid once, as a gift', { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const ada = await f.player('Ada'), bola = await f.player('Bola');
  assert.equal((await f.request('/api/social/friends/request', { to: ada.id, cityId: 'lagos' }, bola)).code, 'requested');
  assert.equal((await f.request('/api/social/friends/answer', { from: bola.id, accept: true, cityId: 'lagos' }, ada)).code, 'accepted');
  const made = await f.request('/api/social/money-requests', { to: ada.id, amount: 600, note: 'taxi', clientId: f.id() }, bola);
  assert.deepEqual([made.code, made.request?.state, made.request?.mine, made.request?.payable], ['requested', 'open', true, false]);
  const id = made.request?.id as string;
  // A refusal is the same on this host: no waiting, no stored change.
  assert.equal((await f.request('/api/social/money-requests', { to: ada.id, amount: 600, clientId: f.id() }, bola)).code, 'request_open');
  // Without earned money the payment is the gift refusal, and the request stays open.
  const early = await f.request('/api/social/money-requests/answer', { id, op: 'pay', cityId: 'lagos', clientId: f.id() }, ada);
  assert.deepEqual([early.code, early.ok], ['earn_first', false]);
  await f.seedEarned(ada);
  await f.restart();
  const conv = (await f.request('/api/social/conversations', null, ada)).conversations?.find((item) => item.with === bola.id);
  const seen = (await f.request(`/api/social/conversations/${encodeURIComponent(conv?.id as string)}`, null, ada)).messages?.find((line) => line.request)?.request;
  assert.deepEqual([seen?.id, seen?.state, seen?.payable, seen?.note ?? null, seen?.amount], [id, 'open', true, 'taxi', 600], 'the request is there after the object was evicted');
  const clientId = f.id();
  const paid = await f.request('/api/social/money-requests/answer', { id, op: 'pay', cityId: 'lagos', clientId }, ada);
  assert.deepEqual([paid.code, paid.amount, paid.balance, paid.request?.state], ['paid', 600, 4400, 'paid']);
  assert.match(paid.receipt ?? '', /\S/);
  await f.restart();
  const replay = await f.request('/api/social/money-requests/answer', { id, op: 'pay', cityId: 'lagos', clientId }, ada);
  assert.deepEqual([replay.code, replay.duplicate, replay.receipt, replay.balance], ['paid', true, paid.receipt, 4400]);
  assert.equal((await f.request('/api/social/money-requests/answer', { id, op: 'pay', cityId: 'lagos', clientId: f.id() }, ada)).code, 'request_paid');
  assert.equal((await f.request('/api/life?city=lagos', null, ada)).state?.cash, 4400, 'paid once');
  await f.request('/api/social/me', null, bola);
  assert.equal((await f.request('/api/life?city=lagos', null, bola)).state?.cash, 5600, 'received once');
});

test('Cloudflare requests for money: decline and cancel are kept across an eviction and close the request for good', { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const ada = await f.player('Ada'), bola = await f.player('Bola');
  assert.equal((await f.request('/api/social/friends/request', { to: ada.id, cityId: 'lagos' }, bola)).code, 'requested');
  assert.equal((await f.request('/api/social/friends/answer', { from: bola.id, accept: true, cityId: 'lagos' }, ada)).code, 'accepted');
  const first = (await f.request('/api/social/money-requests', { to: ada.id, amount: 300, clientId: f.id() }, bola)).request?.id as string;
  await f.restart();
  assert.equal((await f.request('/api/social/money-requests/answer', { id: first, op: 'decline', clientId: f.id() }, ada)).request?.state, 'declined');
  await f.restart();
  assert.equal((await f.request('/api/social/money-requests/answer', { id: first, op: 'pay', cityId: 'lagos', clientId: f.id() }, ada)).code, 'request_declined');
  const second = (await f.request('/api/social/money-requests', { to: ada.id, amount: 300, clientId: f.id() }, bola)).request?.id as string;
  assert.equal((await f.request('/api/social/money-requests/answer', { id: second, op: 'cancel', clientId: f.id() }, bola)).request?.state, 'cancelled');
  await f.restart();
  assert.equal((await f.request('/api/social/money-requests/answer', { id: second, op: 'pay', cityId: 'lagos', clientId: f.id() }, ada)).code, 'request_cancelled');
});
