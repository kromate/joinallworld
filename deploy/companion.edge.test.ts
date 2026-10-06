// The hosted companion on the Worker host: the same route through the Durable Object, calling a fake gateway (the Worker's
// outside request is answered by this test, which forwards it to a local port), the health boolean, the durable daily keys,
// the operator overview and self-test, and the key in no answer.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fakeGateway } from '../server/testing/fakeGateway.ts';

interface MiniflareInstance { ready: Promise<URL>; dispose(): Promise<void>; dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<Response> }
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external: string[] }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: BundleOptions): Promise<unknown> };

const KEY = 'sk-edge-KEY-77aa-do-not-leak';
const TOKEN = 'operator-token-for-edge-tests-0123456789';
const PORT = 4144;
interface Answer { ok?: boolean; via?: string; text?: string | null; suggest?: string[]; error?: string; companionAi?: unknown; companion?: { enabled: boolean; today: { requests: number; outcomes: Record<string, number> } } }

async function fixture(t: TestContext, bindings: Record<string, string>) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-companion-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const gateway = await fakeGateway(PORT);
  const options = {
    name: 'joinallworld-companion', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'),
    bindings: { BUILD_ID: 'local-companion', FOUNDER_EMAIL_SHA256: '', ...bindings },
    // The Worker's call to the gateway's https address comes here and is forwarded to the fake on this machine.
    outboundService: async (request: Request): Promise<Response> => {
      const target = new URL(request.url);
      return fetch(`${gateway.base}${target.pathname}`, { method: request.method, headers: request.headers, body: request.method === 'GET' ? undefined : await request.text() });
    },
  };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} });
  t.after(async () => { await mf.dispose(); await gateway.stop(); await rm(folder, { recursive: true, force: true }); });
  await mf.ready;
  const origin = 'https://joinallworld.test';
  const call = async (path: string, body: object | null, headers: Record<string, string> = {}): Promise<Answer & { status: number; raw: string }> => {
    const response = await mf.dispatchFetch(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { ...(JSON.parse(text) as Answer), status: response.status, raw: text };
  };
  async function player(name: string): Promise<string> {
    const response = await mf.dispatchFetch(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    await response.text();
    await call('/api/life?city=lagos', null, { cookie }); await call('/api/social/me', null, { cookie });
    return cookie;
  }
  const ask = (cookie: string, body: Record<string, unknown>) => call('/api/companion/ask', { clientId: `${Date.now()}:${randomUUID()}`, ...body }, { cookie });
  return { gateway, call, player, ask, mod: (path: string, post = false) => call(path, post ? {} : null, { authorization: `Bearer ${TOKEN}` }) };
}

test('on the Worker: no key means off, no call, health false', async (t) => {
  const f = await fixture(t, {});
  const cookie = await f.player('Ada');
  const got = await f.ask(cookie, { message: 'what should I do' });
  assert.deepEqual([got.via, got.text], ['local', null]);
  assert.equal(f.gateway.seen.length, 0);
  assert.equal((await f.call('/api/health', null)).companionAi, false);
});

test('on the Worker: a reply from the gateway, the exact request, limits kept in the object, the overview and the self-test, and no key anywhere', async (t) => {
  const f = await fixture(t, { AI_GATEWAY_API_KEY: KEY, MODERATOR_TOKEN: TOKEN, COMPANION_PLAYER_DAILY: '2', COMPANION_PLAYER_BURST: '50' });
  const cookie = await f.player('Ada');
  const health = await f.call('/api/health', null);
  assert.equal(health.companionAi, true); assert.ok(!health.raw.includes(KEY));

  const first = await f.ask(cookie, { message: 'how do I get a job' });
  assert.deepEqual([first.via, first.text, first.suggest], ['primary', 'Hello! Try Jobs to find work.', ['open-jobs']]);
  const seen = f.gateway.seen[0]!;
  assert.equal(seen.path, '/v1/chat/completions');
  assert.equal(seen.headers['authorization'], `Bearer ${KEY}`);
  assert.equal(seen.body['model'], 'openai/gpt-5.6-luna');
  assert.ok(!seen.raw.includes('Ada') || seen.raw.includes('Player: Ada'));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(seen.raw));

  assert.equal((await f.ask(cookie, { message: 'and a second one' })).via, 'primary');
  const third = await f.ask(cookie, { message: 'and a third one' });
  assert.deepEqual([third.via, third.text], ['local', null], 'the stored daily key refuses the third');
  assert.equal(f.gateway.seen.length, 2);

  const overview = await f.mod('/api/mod/overview');
  assert.equal(overview.companion?.enabled, true);
  assert.equal(overview.companion?.today.requests, 2);
  assert.equal(overview.companion?.today.outcomes['quota'], 1);
  const test = await f.mod('/api/mod/companion-test', true);
  assert.deepEqual([test.ok, test.error], [true, undefined]);
  for (const text of [first.raw, third.raw, overview.raw, test.raw]) assert.ok(!String(text).includes(KEY));
});
