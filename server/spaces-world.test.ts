// OWNER: spaces — a space in 3D on the Node host (server/spaces/world.ts, docs/SPACES-3D.md phase 2): off until an operator turns it
// on; the owner of a home sees it and arranges their own models in it, a stranger without an accepted visit sees nothing; a group
// room's members see and arrange it, others do not; only one's own models can be placed, inside the space and the limits; a model
// deleted or hidden leaves the space; erasure takes a player's layouts and their models out of every room.
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
import { WORLD } from '../src/spaces/layout.ts';

const PROJECT = 'allworld-test-project', FOUNDER = 'founder.test@example.com', OPERATOR = 'operator-token-for-tests-0123456789';
type Json = Record<string, any>;
const CHAIR = new Uint8Array(readFileSync(new URL('../src/housing-studio/assets/dining-chair-near.glb', import.meta.url)));

async function setup(t: TestContext, { on = true, scripts = true }: { on?: boolean; scripts?: boolean } = {}) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const dir = await mkdtemp(join(tmpdir(), 'spaces-world-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await createStore(dir, { log: () => {} });
  await store.transact((db) => { (db as Record<string, unknown>)['adminSettings'] = { values: { spacesModels: { value: true, at: 1, by: 'test' }, ...(on ? { spaces3d: { value: true, at: 1, by: 'test' } } : {}), ...(scripts ? { spacesScripts: { value: true, at: 1, by: 'test' } } : {}) } }; });
  const f = await fixture(t, { moderatorToken: OPERATOR, env: { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', FOUNDER_EMAIL_SHA256: emailHash(FOUNDER), NEW_SESSIONS_PER_ADDRESS: '1000' }, fetch: provider.fetch, store } as never);
  const call = async (path: string, body?: unknown, cookie?: string): Promise<Json> => {
    const raw = body instanceof Uint8Array;
    const res = await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: f.base, ...(body ? { 'Content-Type': raw ? 'model/gltf-binary' : 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? (raw ? body as Uint8Array<ArrayBuffer> : JSON.stringify(body)) : undefined });
    return { status: res.status, ...(await res.json() as object) };
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
  const upload = async (d: Device, name = 'Chair') => { const r = await call(`/api/spaces/models?name=${name}`, CHAIR, d.cookie); assert.equal(r.ok, true, JSON.stringify(r)); return r.model; };
  const place = (model: Json, over: Json = {}) => ({ k: `p${Math.random().toString(36).slice(2, 8)}`, m: model.id, by: model.by, hash: model.hash, x: 2, y: 0, z: 2, ry: 90, s: 1, floor: 0, ...over });
  const post = async (path: string, body: Json, d: Device) => call(path, { clientId: f.id(), ...body }, d.cookie);
  async function group(owner: Device, members: Device[]): Promise<string> {
    for (const member of members) {
      const asked = await post('/api/social/friends/request', { to: member.id, cityId: 'lagos' }, owner); assert.equal(asked.ok, true, JSON.stringify(asked));
      assert.equal((await post('/api/social/friends/answer', { from: owner.id, accept: true, cityId: 'lagos' }, member)).ok, true);
    }
    const made = await post('/api/social/groups', { name: 'Night shift', members: members.map((m) => m.id) }, owner);
    assert.equal(made.code, 'created', JSON.stringify(made));
    return made.conv.id;
  }
  return { f, call, account, upload, place, group };
}

test('world: off until an operator turns it on', async (t) => {
  const s = await setup(t, { on: false });
  const ada = await s.account('ada@example.com', 'Ada');
  const seen = await s.call('/api/spaces/world?target=home', undefined, ada.cookie);
  assert.equal(seen.code, 'world_off');
});

test('world: my home in 3D, with my models placed, saved and read back; a stranger needs a visit', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola');
  const seen = await s.call('/api/spaces/world?target=home', undefined, ada.cookie);
  assert.equal(seen.ok, true, JSON.stringify(seen));
  assert.equal(seen.world.canEdit, true);
  assert.equal(seen.world.kind, 'home');
  assert.ok(seen.world.plot.w >= 6 && seen.world.items.length > 0, 'the starter home and its furniture');
  assert.deepEqual(seen.world.models, []);
  const chair = await s.upload(ada);
  assert.equal((await s.call('/api/spaces/world?target=home', undefined, ada.cookie)).world.mine.length, 1);

  const saved = await s.call('/api/spaces/world/layout', { target: 'home', models: [s.place(chair), s.place(chair, { x: 4, ry: 500 })] }, ada.cookie);
  assert.equal(saved.code, 'saved', JSON.stringify(saved));
  assert.equal(saved.placed, 2);
  const again = await s.call('/api/spaces/world?target=home', undefined, ada.cookie);
  assert.equal(again.world.models.length, 2);
  assert.equal(again.world.models[1].ry, 140, 'turns are kept within a circle');
  assert.equal(again.world.models[0].name, 'Chair');

  const stranger = await s.call(`/api/spaces/world?target=home&host=${ada.id}`, undefined, bola.cookie);
  assert.equal(stranger.code, 'visit_required');
  assert.equal((await s.call('/api/spaces/world?target=home&host=not-a-player', undefined, bola.cookie)).status, 400);
  // Saving always means one's own home: Bola cannot write Ada's.
  const bolas = await s.call('/api/spaces/world/layout', { target: 'home', host: ada.id, models: [s.place(chair)] }, bola.cookie);
  assert.equal(bolas.code, 'not_yours', 'Bola saved to her own home and cannot use Ada\'s model');
  assert.equal((await s.call('/api/spaces/world?target=home', undefined, ada.cookie)).world.models.length, 2);
});

test('world: layouts are checked: own models only, inside the space, within the limits', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada');
  const chair = await s.upload(ada);
  const save = (models: unknown) => s.call('/api/spaces/world/layout', { target: 'home', models }, ada.cookie);
  assert.equal((await save([s.place(chair, { x: 500 })])).code, 'out_of_bounds');
  assert.equal((await save([s.place(chair, { s: 99 })])).code, 'out_of_bounds');
  assert.equal((await save([s.place(chair, { floor: 3 })])).code, 'out_of_bounds');
  assert.equal((await save([s.place(chair, { m: 'mzzzzzzzzz' })])).code, 'unknown_model');
  assert.equal((await save('nope')).code, 'invalid_layout');
  const same = s.place(chair);
  assert.equal((await save([same, same])).code, 'invalid_layout', 'two placements with one key');
  assert.equal((await save(Array.from({ length: WORLD.placements + 1 }, () => s.place(chair)))).code, 'too_many');
  assert.equal((await save(Array.from({ length: WORLD.placements }, () => s.place(chair)))).code, 'saved');
  assert.equal((await save([])).code, 'saved', 'an empty layout clears the space');
  assert.equal((await s.call('/api/spaces/world?target=home', undefined, ada.cookie)).world.models.length, 0);
});

test('world: a group room is arranged by its members; a deleted model leaves it; erasure takes a player\'s models out', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola'), chidi = await s.account('chidi@example.com', 'Chidi');
  const room = await s.group(ada, [bola]);
  const adaChair = await s.upload(ada, 'Ada%20chair'), bolaChair = await s.upload(bola, 'Bola%20chair');
  const seen = await s.call(`/api/spaces/world?target=room&id=${room}`, undefined, bola.cookie);
  assert.equal(seen.ok, true, JSON.stringify(seen));
  assert.equal(seen.world.canEdit, true);
  assert.equal(seen.world.kind, 'room');
  assert.equal((await s.call(`/api/spaces/world?target=room&id=${room}`, undefined, chidi.cookie)).ok, false, 'not a member');
  const first = await s.call('/api/spaces/world/layout', { target: 'room', id: room, models: [s.place(adaChair)] }, ada.cookie);
  assert.equal(first.code, 'saved');
  // Bola keeps Ada's chair where it is and adds her own; she cannot add a new copy of Ada's.
  const kept = (await s.call(`/api/spaces/world?target=room&id=${room}`, undefined, bola.cookie)).world.models.map(({ name: _n, size: _s, triangles: _t, ...p }: Json) => p);
  assert.equal((await s.call('/api/spaces/world/layout', { target: 'room', id: room, models: [...kept, s.place(bolaChair, { x: 5 })] }, bola.cookie)).code, 'saved');
  assert.equal((await s.call('/api/spaces/world/layout', { target: 'room', id: room, models: [...kept, s.place(adaChair, { x: 1 })] }, chidi.cookie)).code, 'not_admitted');
  assert.equal((await s.call(`/api/spaces/world?target=room&id=${room}`, undefined, ada.cookie)).world.models.length, 2);

  assert.equal((await s.call('/api/spaces/models/delete', { id: bolaChair.id }, bola.cookie)).code, 'deleted');
  assert.equal((await s.call(`/api/spaces/world?target=room&id=${room}`, undefined, ada.cookie)).world.models.length, 1, 'a deleted model leaves the room');
  await s.call('/api/spaces/world/layout', { target: 'home', models: [s.place(adaChair)] }, ada.cookie);
  await s.f.server.store.transact((db) => { eraseSpaces(db, [ada.id]); });
  const layouts = await s.f.server.store.read((db) => JSON.parse(JSON.stringify((db as any).spaces.layouts ?? {})));
  assert.deepEqual(Object.keys(layouts), [], 'her home layout and her chair in the room are gone');
});

test('world: a space\'s script is saved by its owner, its lines filtered, sent with the space, and erased with the player', async (t) => {
  const off = await setup(t, { scripts: false });
  const zed = await off.account('zed@example.com', 'Zed');
  assert.equal((await off.call('/api/spaces/world/script', { target: 'home', code: 'space.score(1)', lines: [] }, zed.cookie)).code, 'scripts_off');
  assert.equal((await off.call('/api/spaces/world?target=home', undefined, zed.cookie)).world.scripts, false);

  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola');
  const save = (body: Json, who = ada) => s.call('/api/spaces/world/script', { target: 'home', ...body }, who.cookie);
  const blocked = await save({ code: 'space.say(0)', lines: ['Call me on 08031234567'] });
  assert.equal(blocked.code, 'line_blocked');
  assert.match(blocked.reason, /Line 1/);
  assert.equal((await save({ code: 'x'.repeat(40_001), lines: [] }).catch(() => ({ status: 413 }))).status, 413, 'a body past the limit is cut off: 413 or a closed connection');
  assert.equal((await save({ code: 'space.say(0, 2)', lines: ['Welcome, {1} mangoes inside!', ''] })).code, 'saved');
  const seen = await s.call('/api/spaces/world?target=home', undefined, ada.cookie);
  assert.deepEqual(seen.world.script, { code: 'space.say(0, 2)', lines: ['Welcome, {1} mangoes inside!'] });
  // Saving always means one's own home: Bola's script lands in hers, not Ada's.
  assert.equal((await save({ code: 'space.score(9)', lines: [] }, bola)).code, 'saved');
  assert.equal((await s.call('/api/spaces/world?target=home', undefined, ada.cookie)).world.script.code, 'space.say(0, 2)');
  assert.equal((await save({ code: '' })).code, 'removed');
  assert.equal((await s.call('/api/spaces/world?target=home', undefined, ada.cookie)).world.script, undefined);
  await save({ code: 'space.score(1)', lines: [] });
  await s.f.server.store.transact((db) => { eraseSpaces(db, [ada.id]); });
  const scripts = await s.f.server.store.read((db) => Object.keys((db as any).spaces.scripts ?? {}));
  assert.deepEqual(scripts, [`home:${bola.id}`]);
});

test('together: members of a room walk it live; the host passes on models, score and lines; the host moves on when they leave', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola'), chidi = await s.account('chidi@example.com', 'Chidi');
  const room = await s.group(ada, [bola]);
  const open = async (who: Device) => {
    const peer = await s.f.socket(who);
    const frames: Json[] = [];
    peer.ws.on('message', (data) => { const frame = JSON.parse(data.toString()); if (/^space-|^error$/.test(frame.type)) frames.push(frame); });
    return { peer, frames, send: (frame: Json) => peer.ws.send(JSON.stringify(frame)) };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  const a = await open(ada), b = await open(bola), c = await open(chidi);
  a.send({ type: 'space-join', target: 'room', id: room });
  await settle();
  assert.equal(a.frames.at(-1)?.type, 'space-room');
  assert.equal(a.frames.at(-1)?.host, ada.id, 'the first one in hosts a room');
  b.send({ type: 'space-join', target: 'room', id: room });
  c.send({ type: 'space-join', target: 'room', id: room });
  await settle();
  assert.deepEqual(b.frames.at(-1)?.members.map((m: Json) => m.name).sort(), ['Ada', 'Bola']);
  assert.equal(c.frames.at(-1)?.type, 'error', 'not a member, not admitted');

  // Bola's tick reaches Ada with her place only; Ada's (the host's) carries the models, score and line.
  b.send({ type: 'space-tick', p: [1, 0, 2, 0.5], o: [[0, 9, 9, 9, 0, 0, 0, 1]], s: 99 });
  a.send({ type: 'space-tick', p: [3.333333, 0, 4, 1], o: [[0, 1, 0.5, 2, 0, 0, 0, 1]], s: 7, say: [0, 7] });
  await settle();
  const fromBola = a.frames.find((f) => f.type === 'space-peer' && f.id === bola.id);
  assert.deepEqual(fromBola, { type: 'space-peer', id: bola.id, p: [1, 0, 2, 0.5] });
  const fromAda = b.frames.find((f) => f.type === 'space-peer' && f.id === ada.id);
  assert.deepEqual(fromAda?.p, [3.33, 0, 4, 1]);
  assert.deepEqual(fromAda?.o, [[0, 1, 0.5, 2, 0, 0, 0, 1]]);
  assert.equal(fromAda?.s, 7);
  assert.deepEqual(fromAda?.say, [0, 7]);
  // Bad ticks are dropped.
  const before = a.frames.length;
  b.send({ type: 'space-tick', p: [1, 0, 'x', 0] });
  b.send({ type: 'space-tick', p: [1e9, 0, 0, 0] });
  await settle();
  assert.equal(a.frames.length, before);

  a.peer.ws.close();
  await settle();
  assert.equal(b.frames.at(-1)?.type, 'space-room');
  assert.equal(b.frames.at(-1)?.host, bola.id, 'the host moves on');
  assert.deepEqual(b.frames.at(-1)?.members.map((m: Json) => m.name), ['Bola']);
});
