// OWNER: spaces — copy my real house (server/spaces/home-house.ts, docs/HOUSE-FROM-PHOTOS.md): off until an operator turns it on; a
// house description is checked, kept and shown to the owner and visitors with the game's furniture set aside; a model stands as the
// house; a one-time upload link takes a .glb with no cookie, once, and can set it as the house; a house model may be bigger and
// replaces the last one; erasure takes links and the house with the player.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';
import { createStore } from './store.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { emailHash } from './social/founder.ts';
import { eraseSpaces } from './spaces/store.ts';
import { EXAMPLE_SPEC } from '../src/spaces/house-spec.ts';

const PROJECT = 'allworld-test-project', FOUNDER = 'founder.test@example.com', OPERATOR = 'operator-token-for-tests-0123456789';
type Json = Record<string, any>;
const CHAIR = new Uint8Array(readFileSync(new URL('../src/housing-studio/assets/dining-chair-near.glb', import.meta.url)));
const SOFA = new Uint8Array(readFileSync(new URL('../src/housing-studio/assets/two-seat-sofa-near.glb', import.meta.url)));

async function setup(t: TestContext, { on = true }: { on?: boolean } = {}) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const dir = await mkdtemp(join(tmpdir(), 'spaces-house-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await createStore(dir, { log: () => {} });
  const at = (value: boolean) => ({ value, at: 1, by: 'test' });
  await store.transact((db) => { (db as Record<string, unknown>)['adminSettings'] = { values: { spacesModels: at(true), spaces3d: at(true), ...(on ? { spacesHouseCopy: at(true) } : {}) } }; });
  const f = await fixture(t, { moderatorToken: OPERATOR, env: { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', FOUNDER_EMAIL_SHA256: emailHash(FOUNDER), NEW_SESSIONS_PER_ADDRESS: '1000' }, fetch: provider.fetch, store } as never);
  const call = async (path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Json> => {
    const raw = body instanceof Uint8Array;
    const res = await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { ...(cookie ? { Origin: f.base, Cookie: cookie } : {}), ...(body ? { 'Content-Type': raw ? 'model/gltf-binary' : 'application/json' } : {}), ...headers }, body: body ? (raw ? body as Uint8Array<ArrayBuffer> : JSON.stringify(body)) : undefined });
    const kind = res.headers.get('content-type') ?? '';
    return { status: res.status, ...(kind.includes('json') ? await res.json() as object : {}) };
  };
  let minted = 0;
  const token = (address: string) => signToken(key, claimsFor(PROJECT, f.now(), { subject: `Uid${address.replace(/\W/g, '')}`, email: address, n: ++minted }));
  async function account(address: string, name: string): Promise<Device> {
    const d = await f.device(name); await f.request('/api/life?city=lagos', undefined, d.cookie);
    const { csrf } = await call('/api/account', undefined, d.cookie);
    const res = await fetch(f.base + '/api/account/sign-in', { method: 'POST', headers: { Origin: f.base, 'Content-Type': 'application/json', Cookie: d.cookie }, body: JSON.stringify({ idToken: await token(address), csrf }) });
    assert.equal(res.status, 200);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? d.cookie;
    await f.acceptSharingTerms(cookie);
    await f.request('/api/social/me', undefined, cookie);
    return { ...d, cookie };
  }
  return { f, call, account };
}

test('house: off until an operator turns it on', async (t) => {
  const s = await setup(t, { on: false });
  const ada = await s.account('ada@example.com', 'Ada');
  assert.equal((await s.call('/api/spaces/house', { spec: EXAMPLE_SPEC }, ada.cookie)).code, 'house_off');
});

test('house: a description is checked, kept, built for the owner without the game furniture, and cleared', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada');
  const before = await s.call('/api/spaces/world?target=home', undefined, ada.cookie);
  assert.ok(before.world.items.length > 0 && !before.world.house);
  const saved = await s.call('/api/spaces/house', { spec: EXAMPLE_SPEC }, ada.cookie);
  assert.deepEqual([saved.code, saved.kind, saved.rooms], ['saved', 'spec', 6]);
  const seen = (await s.call('/api/spaces/world?target=home', undefined, ada.cookie)).world;
  assert.equal(seen.house.kind, 'spec');
  assert.equal(seen.house.spec.rooms[0].name, 'Living room');
  assert.deepEqual(seen.plot, { w: 10, d: 8, floors: 2 });
  assert.deepEqual(seen.items, [], 'the game furniture is not drawn in a copied house');
  assert.equal((await s.call('/api/spaces/house', { spec: { v: 2 } }, ada.cookie)).ok, false);
  assert.equal((await s.call('/api/spaces/house', { spec: { ...EXAMPLE_SPEC, name: 'Call 0801 234 5678' } }, ada.cookie)).ok, false, 'names pass the filter');
  assert.equal((await s.call('/api/spaces/house', { clear: true }, ada.cookie)).code, 'cleared');
  assert.ok(!(await s.call('/api/spaces/world?target=home', undefined, ada.cookie)).world.house);
});

test('house: a one-time link takes a .glb with no cookie, once, sets it as the house, and a new house model replaces the last', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada');
  const link = await s.call('/api/spaces/models/upload-link', { name: 'Our house', use: 'house' }, ada.cookie);
  assert.equal(link.ok, true, JSON.stringify(link));
  assert.match(link.url, /^\/api\/spaces\/models\/upload\/[0-9a-z]{16,80}$/i);
  assert.equal(link.limits.bytes, 50_000_000);
  const sent = await s.call(link.url, CHAIR, undefined);
  assert.equal(sent.code, 'uploaded', JSON.stringify(sent));
  assert.equal((await s.call(link.url, CHAIR, undefined)).status, 404, 'once');
  assert.equal((await s.call('/api/spaces/models/upload/nottherighttoken000', CHAIR, undefined)).status, 404);
  const home = (await s.call('/api/spaces/world?target=home', undefined, ada.cookie)).world;
  assert.equal(home.house.kind, 'model');
  assert.equal(home.house.model.name, 'Our house');
  // A second house model replaces the first everywhere.
  const again = await s.call('/api/spaces/models?name=Bigger%20house&house=1', SOFA, ada.cookie);
  assert.equal(again.code, 'uploaded', JSON.stringify(again));
  const list = (await s.call('/api/spaces/models', undefined, ada.cookie)).models;
  assert.deepEqual(list.map((m: Json) => m.name), ['Bigger house'], 'one house model a player');
  assert.equal((await s.call('/api/spaces/world?target=home', undefined, ada.cookie)).world.house.model.name, 'Bigger house');
  // An ordinary model set as the house by its id.
  const chair = await s.call('/api/spaces/models?name=Chair', CHAIR, ada.cookie);
  assert.equal((await s.call('/api/spaces/house', { model: chair.model.id }, ada.cookie)).kind, 'model');
  assert.equal((await s.call('/api/spaces/house', { model: 'mzzzzzzzzz' }, ada.cookie)).code, 'unknown_model');
  // A guest cannot make a link.
  const guest = await s.f.device('Guest'); await s.f.request('/api/life?city=lagos', undefined, guest.cookie);
  assert.equal((await s.call('/api/spaces/models/upload-link', { name: 'x' }, guest.cookie)).code, 'account_required');
  // Erasure.
  await s.call('/api/spaces/models/upload-link', { name: 'Spare' }, ada.cookie);
  await s.f.server.store.transact((db) => { eraseSpaces(db, [ada.id]); });
  const col = await s.f.server.store.read((db) => JSON.parse(JSON.stringify((db as any).spaces)));
  assert.deepEqual(col.links ?? {}, {});
  assert.equal(col.homes[ada.id], undefined);
});
