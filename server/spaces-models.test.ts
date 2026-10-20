// OWNER: spaces — players' 3D models on the Node host (server/spaces/models.ts, docs/SPACES-3D.md phase 1): off until an operator
// turns it on, accounts only, every file checked byte by byte and kept once by its hash, names filtered, per-player limits, the
// bytes served to anyone with a session, three reports hide a model, the operator's review, and erasure taking the bytes along.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createStore } from './store.ts';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { emailHash } from './social/founder.ts';
import { eraseSpaces } from './spaces/store.ts';
import { makeGlb } from './testing/glb.ts';
import { MODELS } from '../src/types/spaces.ts';

const PROJECT = 'allworld-test-project', FOUNDER = 'founder.test@example.com', OPERATOR = 'operator-token-for-tests-0123456789';
type Json = Record<string, any>;
const CHAIR = new Uint8Array(readFileSync(new URL('../src/housing-studio/assets/dining-chair-near.glb', import.meta.url)));
/** A small valid model, different for every `n` (a name in the file), so each has its own hash. */
const tiny = (n: number): Uint8Array => makeGlb({
  asset: { version: '2.0', extras: { n } }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }], bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }],
}, new Uint8Array(36));

async function setup(t: TestContext, { on = true }: { on?: boolean } = {}) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  // The operator's choice is stored before the server starts, as a stored setting is.
  const dir = await mkdtemp(join(tmpdir(), 'spaces-models-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await createStore(dir, { log: () => {} });
  if (on) await store.transact((db) => { (db as Record<string, unknown>)['adminSettings'] = { values: { spacesModels: { value: true, at: 1, by: 'test' } } }; });
  const f = await fixture(t, { moderatorToken: OPERATOR, env: { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', FOUNDER_EMAIL_SHA256: emailHash(FOUNDER), NEW_SESSIONS_PER_ADDRESS: '1000' }, fetch: provider.fetch, store } as never);
  const call = async (path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Json> => {
    const raw = body instanceof Uint8Array;
    const res = await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: f.base, ...(body ? { 'Content-Type': raw ? 'model/gltf-binary' : 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? (raw ? body as Uint8Array<ArrayBuffer> : JSON.stringify(body)) : undefined });
    const type = res.headers.get('content-type') ?? '';
    return type.includes('json') ? { status: res.status, ...(await res.json() as object) } : { status: res.status, type, cache: res.headers.get('cache-control'), bytes: new Uint8Array(await res.arrayBuffer()) };
  };
  let minted = 0;
  const guest = async (name: string): Promise<Device> => { const d = await f.device(name); await f.request('/api/life?city=lagos', undefined, d.cookie); return d; };
  const token = (address: string) => signToken(key, claimsFor(PROJECT, f.now(), { subject: `Uid${address.replace(/\W/g, '')}`, email: address, n: ++minted }));
  async function account(address: string, name: string): Promise<Device> {
    const d = await guest(name);
    const { csrf } = await call('/api/account', undefined, d.cookie);
    const res = await fetch(f.base + '/api/account/sign-in', { method: 'POST', headers: { Origin: f.base, 'Content-Type': 'application/json', Cookie: d.cookie }, body: JSON.stringify({ idToken: await token(address), csrf }) });
    assert.equal(res.status, 200);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? d.cookie;
    await f.acceptSharingTerms(cookie);
    return { ...d, cookie };
  }
  const upload = (d: Device, bytes: Uint8Array, name = 'My chair') => call(`/api/spaces/models?name=${encodeURIComponent(name)}`, bytes, d.cookie);
  const op = (body?: unknown) => call('/api/mod/spaces/models', body, undefined, { Authorization: `Bearer ${OPERATOR}` });
  const files = async (): Promise<string[]> => { try { return (await readdir(join(f.dir, 'space-models'))).filter((n) => n.endsWith('.glb')); } catch { return []; } };
  const sweep = async () => { f.server.beat(); await new Promise((resolve) => setTimeout(resolve, 30)); };
  return { f, call, guest, account, upload, op, files, sweep };
}

test('models: off until an operator turns it on; then accounts only', async (t) => {
  const off = await setup(t, { on: false });
  const ada = await off.account('ada@example.com', 'Ada');
  const mine = await off.call('/api/spaces/models', undefined, ada.cookie);
  assert.equal(mine.on, false); assert.equal(mine.canUpload, false);
  assert.equal((await off.upload(ada, CHAIR)).code, 'models_off');
  assert.deepEqual(await off.files(), []);

  const s = await setup(t);
  const guest = await s.guest('Tunde');
  const refused = await s.upload(guest, CHAIR);
  assert.equal(refused.code, 'account_required'); assert.match(refused.reason, /Sign in/);
  assert.equal((await s.call('/api/spaces/models', undefined, guest.cookie)).canUpload, false);
});

test('models: an upload is checked, kept once by hash, listed and served to anyone with a session', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola'), visitor = await s.guest('Visitor');
  const done = await s.upload(ada, CHAIR, 'Dining chair.glb');
  assert.equal(done.ok, true, JSON.stringify(done)); assert.equal(done.code, 'uploaded');
  assert.equal(done.model.name, 'Dining chair');
  assert.match(done.model.hash, /^[0-9a-f]{64}$/);
  assert.ok(done.model.triangles > 0 && done.model.size.every((v: number) => v > 0.2 && v < 2));
  assert.equal((await s.upload(ada, CHAIR, 'Again')).code, 'already');
  assert.equal((await s.upload(bola, CHAIR, 'Bola chair')).code, 'uploaded');
  assert.equal((await s.files()).length, 1, 'the same bytes are kept once');
  const list = await s.call('/api/spaces/models', undefined, ada.cookie);
  assert.equal(list.models.length, 1); assert.equal(list.used.bytes, CHAIR.byteLength); assert.equal(list.limits.count, MODELS.perPlayer);

  const file = await s.call(`/api/spaces/model-file/${done.model.hash}`, undefined, visitor.cookie);
  assert.equal(file.status, 200); assert.equal(file.type, 'model/gltf-binary'); assert.match(file.cache, /immutable/);
  assert.deepEqual(file.bytes, CHAIR);
  assert.equal((await s.call(`/api/spaces/model-file/${done.model.hash}`)).status, 401);
  assert.equal((await s.call(`/api/spaces/model-file/${'0'.repeat(64)}`, undefined, visitor.cookie)).status, 404);
  assert.equal((await s.call('/api/spaces/model-file/..%2F..%2Fdevices.json', undefined, visitor.cookie)).status, 404);
});

test('models: bad files, wrong types and bad names are refused in plain words', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada');
  const notGlb = await s.upload(ada, new TextEncoder().encode('hello'));
  assert.equal(notGlb.code, 'not_glb'); assert.match(notGlb.reason, /glTF binary/);
  const linked = await s.upload(ada, makeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4, uri: 'https://example.com/x.bin' }] }));
  assert.equal(linked.code, 'outside_file');
  const json = await s.call('/api/spaces/models?name=x', { hello: 1 }, ada.cookie);
  assert.equal(json.status, 415);
  const huge = await s.call('/api/spaces/models?name=x', new Uint8Array(20_000_001), ada.cookie).catch(() => ({ status: 413 }));
  assert.equal(huge.status, 413);
  assert.equal((await s.upload(ada, tiny(1), '')).code, 'invalid_name');
  assert.equal((await s.upload(ada, tiny(1), 'call 08031234567')).code, 'contact_not_allowed');
  assert.deepEqual(await s.files(), []);
});

test('models: rename, delete, the hourly limit and the per-player count', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada');
  const ids: string[] = [];
  for (let n = 0; n < MODELS.uploadsPerHour; n++) { const r = await s.upload(ada, tiny(n), `Box ${n}`); assert.equal(r.code, 'uploaded', JSON.stringify(r)); ids.push(r.model.id); }
  assert.equal((await s.upload(ada, tiny(99))).code, 'rate_limited');
  const renamed = await s.call('/api/spaces/models/rename', { id: ids[0], name: 'Red box' }, ada.cookie);
  assert.equal(renamed.model.name, 'Red box');
  assert.equal((await s.call('/api/spaces/models/rename', { id: 'mnope', name: 'x' }, ada.cookie)).code, 'unknown_model');
  assert.equal((await s.call('/api/spaces/models/delete', { id: ids[1] }, ada.cookie)).code, 'deleted');
  assert.equal((await s.files()).length, MODELS.uploadsPerHour);
  await s.sweep();
  assert.equal((await s.files()).length, MODELS.uploadsPerHour - 1, 'the deleted file goes on the next heartbeat');
  // Fill to the count (an hour later each time the hourly limit runs out).
  for (let n = 100; (await s.call('/api/spaces/models', undefined, ada.cookie)).models.length < MODELS.perPlayer; n++) {
    const r = await s.upload(ada, tiny(n));
    if (r.code === 'rate_limited') { s.f.advance(3_600_001); continue; }
    assert.equal(r.code, 'uploaded');
  }
  s.f.advance(3_600_001);
  assert.equal((await s.upload(ada, tiny(999))).code, 'too_many');
});

test('models: three reports hide a model from others; the operator clears, hides or removes it', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada');
  const done = await s.upload(ada, CHAIR);
  const others = await Promise.all(['A', 'B', 'C', 'D'].map((n) => s.guest(`Guest ${n}`)));
  assert.equal((await s.call('/api/spaces/models/report', { by: ada.id, id: done.model.id }, ada.cookie)).code, 'own_model');
  for (const who of others.slice(0, 3)) assert.equal((await s.call('/api/spaces/models/report', { by: ada.id, id: done.model.id }, who.cookie)).code, 'reported');
  const path = `/api/spaces/model-file/${done.model.hash}`;
  assert.equal((await s.call(path, undefined, others[3]!.cookie)).status, 404, 'hidden from others');
  assert.equal((await s.call(path, undefined, ada.cookie)).status, 200, 'its owner still sees it');
  assert.equal((await s.call('/api/spaces/models', undefined, ada.cookie)).models[0].hidden, true);

  assert.notEqual((await s.call('/api/mod/spaces/models')).status, 200, 'the operator view needs the token');
  const queue = await s.op();
  assert.equal(queue.items.length, 1); assert.equal(queue.items[0].reports, 3);
  assert.equal((await s.op({ by: ada.id, id: done.model.id, action: 'clear' })).code, 'cleared');
  assert.equal((await s.call(path, undefined, others[3]!.cookie)).status, 200);
  assert.equal((await s.call('/api/spaces/models/report', { by: ada.id, id: done.model.id }, others[3]!.cookie)).code, 'reported');
  assert.equal((await s.call(path, undefined, others[3]!.cookie)).status, 200, 'a cleared model stays visible');
  assert.equal((await s.op({ by: ada.id, id: done.model.id, action: 'remove' })).code, 'removed');
  await s.sweep();
  assert.deepEqual(await s.files(), []);
  assert.equal((await s.call('/api/spaces/models', undefined, ada.cookie)).models.length, 0);
});

test('models: erasure forgets a player\'s models and their reports; bytes another player keeps stay', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola');
  const shared = await s.upload(ada, CHAIR), own = await s.upload(ada, tiny(5));
  await s.upload(bola, CHAIR);
  await s.call('/api/spaces/models/report', { by: bola.id, id: (await s.call('/api/spaces/models', undefined, bola.cookie)).models[0].id }, ada.cookie);
  assert.equal((await s.files()).length, 2);
  await s.f.server.store.transact((db) => { assert.equal(eraseSpaces(db, [ada.id]), 2); });
  await s.sweep();
  const left = await s.files();
  assert.deepEqual(left, [`${shared.model.hash}.glb`]);
  assert.ok(!left.includes(`${own.model.hash}.glb`));
  const bolas = await s.f.server.store.read((db) => JSON.parse(JSON.stringify((db as any).spaces.models[bola.id])));
  assert.deepEqual(bolas[0].reports ?? [], []);
});
