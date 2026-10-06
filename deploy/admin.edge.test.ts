// The admin section (server/routes/admin.ts) on the Worker host: the same registry, so the same guard. Without a sign-in nobody is an admin:
// a guest, no session and a cross-site page are refused on every admin route, and a refused read stores nothing. (Signing in needs the
// sign-in provider's stand-in, which the Node tests drive: server/admin/admin.test.ts.)
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { HTTP_ROUTE_KEYS } from '../src/types/protocol.ts';
import { layoutBindings } from '../server/testing/sqliteStorage.ts';

interface StubSocket { addEventListener(type: 'message', listener: (event: { data: string }) => void): void; accept(): void; send(data: string): void; close(): void }
type MiniflareResponse = Response & { webSocket?: StubSocket | null }
interface MiniflareInstance {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<MiniflareResponse>
}
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external: string[] }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: BundleOptions): Promise<unknown> };


test('on the Worker every admin route refuses a guest, a request without a session and a cross-site page', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-admin-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-admin', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { ...layoutBindings(), BUILD_ID: 'local-admin' } };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} });
  t.after(async () => { await mf.dispose(); await rm(folder, { recursive: true, force: true }); });
  await mf.ready;
  const origin = 'https://joinallworld.test';
  const made = await mf.dispatchFetch(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Visitor' }) });
  const cookie = (made.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  await made.arrayBuffer();
  const routes = HTTP_ROUTE_KEYS.filter((key) => key.includes(' /api/admin/'));
  assert.ok(routes.length >= 20);
  let n = 0;
  for (const key of routes) {
    const [method, path] = key.split(' ') as [string, string];
    const url = origin + path.replace(':id', '00000000-0000-4000-8000-000000000000');
    for (const [who, headers, expected] of [['a guest', { origin, cookie }, 404], ['no session', { origin }, 404], ['a cross-site page', { origin: 'https://evil.example', cookie }, 403]] as const) {
      if (++n % 4 === 0) await new Promise((done) => setTimeout(done, 5));
      const response = await mf.dispatchFetch(url, { method, headers: { ...headers, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify({ clientId: '1:2' }) } : {}) });
      const status = response.status;
      await response.arrayBuffer();
      // A refused attempt is counted per address; past the budget the answer is 429, which is also a refusal.
      assert.ok(status === expected || (status === 429 && expected === 404), `${key} for ${who}: ${status}`);
    }
  }
});
