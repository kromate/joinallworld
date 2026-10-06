// The "update is coming" notice (server/notice.ts) on the Worker host: a signature checked by the Workers runtime's own
// WebCrypto against the public key (both names of the algorithm are tried there), the announcement reaching a socket
// that is open and one that connects later, nothing stored, and the same refusals as on Node.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { noticeText } from '../server/notice.ts';
import type { NoticeFrame } from '../src/types/notice.ts';
import { layoutBindings } from './test-storage.ts';

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

const pause = (ms = 25): Promise<void> => new Promise((done) => setTimeout(done, ms));
const pair = () => { const { privateKey, publicKey } = generateKeyPairSync('ed25519'); return { privateKey, publicKey: String(publicKey.export({ format: 'jwk' }).x) }; };
type Keys = ReturnType<typeof pair>;
function signed(keys: Keys, fields: { minutes?: number; issuedAt?: number; nonce?: string } = {}) {
  const body = { kind: 'update' as const, minutes: fields.minutes ?? 3, issuedAt: fields.issuedAt ?? Date.now(), nonce: fields.nonce ?? randomBytes(12).toString('base64url') };
  return { ...body, sig: sign(null, Buffer.from(noticeText(body.kind, body.minutes, body.issuedAt, body.nonce)), keys.privateKey).toString('base64url') };
}

async function fixture(t: TestContext, bindings: Record<string, string>) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-notice-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-notice', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { ...layoutBindings(), BUILD_ID: 'local-notice', FOUNDER_EMAIL_SHA256: '', ...bindings } };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} });
  const sockets: StubSocket[] = [], handed: MiniflareResponse[] = [];
  const send = async (url: string, init?: RequestInit & { headers?: Record<string, string> }) => { const response = await mf.dispatchFetch(url, init); handed.push(response); return response; };
  t.after(async () => {
    for (const socket of sockets.splice(0)) try { socket.close(); } catch { /* closed */ }
    for (const response of handed.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {});
    await mf.dispose();
    await rm(folder, { recursive: true, force: true });
  });
  await mf.ready;
  const origin = 'https://joinallworld.test';
  // The announcer sends no Origin header and no cookie: it is not a browser.
  const announce = async (body: object) => { const response = await send(origin + '/api/notice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, ...(await response.json() as { ok?: boolean; error?: string; until?: number }) }; };
  async function player(name: string) {
    const response = await send(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    assert.equal(response.status, 200);
    return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }
  async function socket(cookie: string) {
    const response = await send(origin + '/socket', { headers: { origin, cookie, upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const ws = response.webSocket as StubSocket, notices: NoticeFrame[] = [];
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data) as { type: string };
      if (frame.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat-ack' }));
      if (frame.type === 'notice') notices.push(frame as NoticeFrame);
    });
    ws.accept(); sockets.push(ws);
    return { notices, first: async (): Promise<NoticeFrame> => { for (let i = 0; i < 200; i++) { const found = notices[0]; if (found) return found; await pause(); } throw new Error('No notice frame'); } };
  }
  return { announce, player, socket, count: async (path: string) => (await send(origin + path)).status };
}

test('Cloudflare notice: signed by the key, shown to open and late sockets, refused when wrong', { timeout: 120000 }, async (t) => {
  const keys = pair();
  const f = await fixture(t, { NOTICE_PUBLIC_KEY: keys.publicKey });
  const open = await f.socket(await f.player('Ada'));
  const good = signed(keys, { minutes: 5 });
  const done = await f.announce(good);
  assert.equal(done.status, 200); assert.equal(done.ok, true);
  const frame = await open.first();
  assert.deepEqual([frame.kind, frame.minutes, frame.build, frame.id], ['update', 5, 'local-notice', good.nonce]);
  assert.equal(frame.until, done.until);
  const late = await f.socket(await f.player('Bola'));
  assert.equal((await late.first()).until, done.until, 'a socket that opens during the window is told');
  assert.equal((await f.announce(good)).error, 'notice_replayed');
  assert.equal((await f.announce(signed(pair()))).error, 'notice_unverified');
  assert.equal((await f.announce(signed(keys, { issuedAt: Date.now() - 6 * 60000 }))).error, 'notice_stale');
  assert.equal((await f.announce(signed(keys, { minutes: 99 }))).error, 'invalid_notice');
});

test('Cloudflare notice: the Workers runtime verifies Ed25519 under at least one of the two algorithm names', { timeout: 60000 }, async (t) => {
  const keys = pair(), message = 'allworld-notice-v1\nupdate\n3\n1\nabcdefgh';
  const sig = sign(null, Buffer.from(message), keys.privateKey).toString('base64url');
  const script = `
    const raw = (text) => { const plain = text.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(plain + '='.repeat((4 - plain.length % 4) % 4)), (c) => c.charCodeAt(0)); };
    const tryName = async (algorithm, body) => { try { const key = await crypto.subtle.importKey('raw', raw(${JSON.stringify(keys.publicKey)}), algorithm, false, ['verify']); return await crypto.subtle.verify(algorithm, key, raw(${JSON.stringify(sig)}), new TextEncoder().encode(body)); } catch { return null; } };
    export default { async fetch() {
      const names = { Ed25519: 'Ed25519', node: { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' } };
      const out = {};
      for (const [label, algorithm] of Object.entries(names)) out[label] = { good: await tryName(algorithm, ${JSON.stringify(message)}), bad: await tryName(algorithm, ${JSON.stringify(message + 'x')}) };
      return Response.json(out);
    } };`;
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ name: 'joinallworld-ed25519', modules: true, script, compatibilityDate: '2026-10-01' }), handleStructuredLogs: () => {} });
  t.after(() => mf.dispose());
  await mf.ready;
  const seen = await (await mf.dispatchFetch('https://x.test/')).json() as Record<string, { good: boolean | null; bad: boolean | null }>;
  const working = Object.values(seen).filter((entry) => entry.good === true && entry.bad === false);
  assert.ok(working.length >= 1, `neither algorithm name verified: ${JSON.stringify(seen)}`);
  assert.equal(seen['Ed25519']?.good, true, 'the standard name works on this runtime');
});
