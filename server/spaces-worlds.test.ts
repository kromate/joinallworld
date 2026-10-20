// OWNER: spaces — worlds on the Node host (server/spaces/worlds.ts, docs/WORLDS.md): off until an operator turns it on; a player
// makes a world, arranges it, sends its link; a world open to everyone is listed and anyone joins it, a link-only one is reached by its
// id alone; only the maker changes or deletes it; a cover is WebP only and swept with the world; erasure takes a player's worlds.
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
import { SPACE_LIMITS_BY_KIND, WORLDS } from '../src/spaces/worlds.ts';

const PROJECT = 'allworld-test-project', FOUNDER = 'founder.test@example.com', OPERATOR = 'operator-token-for-tests-0123456789';
type Json = Record<string, any>;
const CHAIR = new Uint8Array(readFileSync(new URL('../src/housing-studio/assets/dining-chair-near.glb', import.meta.url)));
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0x0d, 0, 0, 0, 0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0, 0]);

async function setup(t: TestContext, { worlds = true }: { worlds?: boolean } = {}) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const dir = await mkdtemp(join(tmpdir(), 'spaces-worlds-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await createStore(dir, { log: () => {} });
  const at = (value: boolean) => ({ value, at: 1, by: 'test' });
  await store.transact((db) => { (db as Record<string, unknown>)['adminSettings'] = { values: { spacesModels: at(true), spaces3d: at(true), spacesScripts: at(true), spacesScreen: at(true), ...(worlds ? { spacesWorlds: at(true) } : {}) } }; });
  const f = await fixture(t, { moderatorToken: OPERATOR, env: { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', FOUNDER_EMAIL_SHA256: emailHash(FOUNDER), NEW_SESSIONS_PER_ADDRESS: '1000' }, fetch: provider.fetch, store } as never);
  const call = async (path: string, body?: unknown, cookie?: string, type = 'model/gltf-binary'): Promise<Json> => {
    const raw = body instanceof Uint8Array;
    const res = await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: f.base, ...(body ? { 'Content-Type': raw ? type : 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? (raw ? body as Uint8Array<ArrayBuffer> : JSON.stringify(body)) : undefined });
    const kind = res.headers.get('content-type') ?? '';
    return { status: res.status, type: kind, ...(kind.includes('json') ? await res.json() as object : { bytes: new Uint8Array(await res.arrayBuffer()) }) };
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
  const make = async (d: Device, body: Json = {}) => { const r = await call('/api/spaces/worlds', { name: 'Ada park', ...body }, d.cookie); assert.equal(r.code, 'created', JSON.stringify(r)); return r.world as Json; };
  const befriend = async (a: Device, b: Device) => {
    const post = (path: string, body: Json, d: Device) => call(path, { clientId: f.id(), ...body }, d.cookie);
    assert.equal((await post('/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a)).ok, true);
    assert.equal((await post('/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b)).ok, true);
  };
  return { f, call, account, upload, place, make, befriend };
}

test('worlds: off until an operator turns it on', async (t) => {
  const s = await setup(t, { worlds: false });
  const ada = await s.account('ada@example.com', 'Ada');
  assert.equal((await s.call('/api/spaces/worlds', undefined, ada.cookie)).code, 'worlds_off');
  assert.equal((await s.call('/api/spaces/worlds', { name: 'Ada park' }, ada.cookie)).code, 'worlds_off');
});

test('worlds: made, listed, arranged by its maker, reached by anyone with its link; open ones are browsed', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola');
  const park = await s.make(ada, { size: 'big', ground: 'sand', open: 'everyone', blurb: 'Bring a ball' });
  assert.match(park.id, /^w[0-9a-z]{12}$/);
  assert.equal(park.mine, true);
  const yard = await s.make(ada, { name: 'Secret yard', open: 'link' });
  const mine = await s.call('/api/spaces/worlds?list=mine', undefined, ada.cookie);
  assert.deepEqual(mine.worlds.map((w: Json) => w.name), ['Secret yard', 'Ada park']);
  assert.equal(mine.mine, 2);
  assert.equal(mine.limit, WORLDS.perPlayer);
  // Bola browses: only the one open to everyone.
  const browsed = await s.call('/api/spaces/worlds?list=new', undefined, bola.cookie);
  assert.deepEqual(browsed.worlds.map((w: Json) => [w.name, w.by.name, w.mine, w.ground, w.visits, w.here]), [['Ada park', 'Ada', false, 'sand', 0, 0]]);
  // The 3D screen: Ada's park is open ground of its size with world limits; Ada edits, Bola may look but not arrange.
  const seen = await s.call(`/api/spaces/world?target=world&id=${park.id}`, undefined, ada.cookie);
  assert.equal(seen.ok, true, JSON.stringify(seen));
  assert.equal(seen.world.kind, 'world');
  assert.equal(seen.world.canEdit, true);
  assert.deepEqual(seen.world.plot, { w: 48, d: 48, floors: 1 });
  assert.deepEqual(seen.world.items, []);
  assert.deepEqual(seen.world.terrain, { ground: 'sand', size: 'big', open: 'everyone', blurb: 'Bring a ball', sky: 'day' });
  assert.deepEqual(seen.world.limits, SPACE_LIMITS_BY_KIND.world);
  const bolas = await s.call(`/api/spaces/world?target=world&id=${park.id}`, undefined, bola.cookie);
  assert.equal(bolas.world.canEdit, false);
  assert.equal((await s.call(`/api/spaces/world?target=world&id=${yard.id}`, undefined, bola.cookie)).ok, true, 'a link-only world is reached by its id');
  assert.equal((await s.call('/api/spaces/world?target=world&id=wnotaworld00', undefined, bola.cookie)).code, 'unknown_world');
  const chair = await s.upload(ada);
  const far = await s.call('/api/spaces/world/layout', { target: 'world', id: park.id, models: [s.place(chair, { x: 40, z: 44 })] }, ada.cookie);
  assert.equal(far.code, 'saved', 'a big world takes a model far from the corner');
  assert.equal((await s.call('/api/spaces/world/layout', { target: 'world', id: park.id, models: [s.place(chair)] }, bola.cookie)).code, 'not_allowed');
  assert.equal((await s.call('/api/spaces/world/script', { target: 'world', id: park.id, code: 'space.on("start", () => space.say(0))', lines: ['Welcome'] }, ada.cookie)).code, 'saved');
  assert.equal((await s.call(`/api/spaces/world?target=world&id=${park.id}`, undefined, bola.cookie)).world.script.lines[0], 'Welcome');
  // Changing it: words and who may come, never the size; only the maker.
  assert.equal((await s.call('/api/spaces/worlds/update', { id: park.id, open: 'link', size: 'small' }, ada.cookie)).world.size, 'big');
  assert.equal((await s.call('/api/spaces/worlds?list=new', undefined, bola.cookie)).worlds.length, 0, 'a link-only world leaves the list');
  assert.equal((await s.call('/api/spaces/worlds/update', { id: park.id, name: 'Bola park' }, bola.cookie)).code, 'not_yours');
  assert.equal((await s.call('/api/spaces/worlds', { name: 'Call me 0801 234 5678' }, ada.cookie)).code, 'contact_not_allowed');
  assert.equal((await s.call('/api/spaces/worlds', { name: 'X' }, ada.cookie)).code, 'invalid_name');
});

test('worlds: a cover is WebP only, served to anyone with a session, and swept with the world; at most twelve a player', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola');
  const park = await s.make(ada, { open: 'everyone' });
  assert.equal((await s.call(`/api/spaces/worlds/cover?id=${park.id}`, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), ada.cookie, 'image/webp')).code, 'invalid_cover');
  assert.equal((await s.call(`/api/spaces/worlds/cover?id=${park.id}`, WEBP, ada.cookie, 'image/png')).status, 415);
  assert.equal((await s.call(`/api/spaces/worlds/cover?id=${park.id}`, WEBP, bola.cookie, 'image/webp')).code, 'not_yours');
  const saved = await s.call(`/api/spaces/worlds/cover?id=${park.id}`, WEBP, ada.cookie, 'image/webp');
  assert.equal(saved.code, 'saved', JSON.stringify(saved));
  assert.equal((await s.call('/api/spaces/worlds?list=popular', undefined, bola.cookie)).worlds[0].cover, saved.cover);
  const got = await s.call(`/api/spaces/world-cover/${park.id}`, undefined, bola.cookie);
  assert.equal(got.status, 200);
  assert.match(got.type, /image\/webp/);
  assert.deepEqual([...got.bytes], [...WEBP]);
  assert.equal((await s.call('/api/spaces/worlds/delete', { id: park.id }, bola.cookie)).code, 'not_yours');
  assert.equal((await s.call('/api/spaces/worlds/delete', { id: park.id }, ada.cookie)).code, 'deleted');
  assert.equal((await s.call(`/api/spaces/world-cover/${park.id}`, undefined, bola.cookie)).status, 404);
  assert.equal((await s.call(`/api/spaces/world?target=world&id=${park.id}`, undefined, ada.cookie)).code, 'unknown_world');
  for (let i = 0; i < WORLDS.perPlayer; i++) await s.make(ada, { name: `World ${i}` });
  assert.equal((await s.call('/api/spaces/worlds', { name: 'One more' }, ada.cookie)).code, 'too_many');
});

test('worlds: erasure takes a player\'s worlds, their layouts, scripts and covers', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada');
  const park = await s.make(ada, { open: 'everyone' });
  const chair = await s.upload(ada);
  assert.equal((await s.call('/api/spaces/world/layout', { target: 'world', id: park.id, models: [s.place(chair)] }, ada.cookie)).code, 'saved');
  assert.equal((await s.call('/api/spaces/world/script', { target: 'world', id: park.id, code: 'space.on("start", () => 1)', lines: [] }, ada.cookie)).code, 'saved');
  assert.equal((await s.call(`/api/spaces/worlds/cover?id=${park.id}`, WEBP, ada.cookie, 'image/webp')).code, 'saved');
  await s.f.server.store.transact((db) => { eraseSpaces(db, [ada.id]); });
  const col = await s.f.server.store.read((db) => JSON.parse(JSON.stringify((db as any).spaces)));
  assert.deepEqual(col.worlds, {});
  assert.deepEqual(col.layouts ?? {}, {});
  assert.deepEqual(col.scripts ?? {}, {});
  assert.equal(col.modelTrash.length >= 2, true, 'the cover and the chair wait for the sweep');
});

test('worlds: a starter lays out shapes, furniture, a script and a ground; shapes are placed with no upload', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada');
  const hunt = await s.make(ada, { name: 'Gem hunt', template: 'treasure', size: 'big' });
  const seen = await s.call(`/api/spaces/world?target=world&id=${hunt.id}`, undefined, ada.cookie);
  assert.equal(seen.world.models.filter((m: Json) => m.m === 'p-gem').length, 12);
  assert.equal(seen.world.models[0].name, 'Gem');
  assert.match(seen.world.script.code, /Gem/);
  const island = await s.make(ada, { name: 'Isle', template: 'island' });
  assert.equal(island.ground, 'island');
  const hangout = await s.call(`/api/spaces/world?target=world&id=${(await s.make(ada, { name: 'Den', template: 'hangout' })).id}`, undefined, ada.cookie);
  assert.ok(hangout.world.items.some((i: Json) => i.itemId === 'flat-tv'));
  assert.equal(hangout.world.screen, true, 'the screen setting reaches the 3D screen');
  // A shape is anyone's: placed by key alone, kept with its name and size.
  const empty = await s.make(ada, { name: 'Blank' });
  const shape = { k: 'q1', m: 'p-crate', by: 'allworld', hash: '', x: 3, y: 0, z: 3, ry: 0, s: 1, floor: 0, loose: true };
  assert.equal((await s.call('/api/spaces/world/layout', { target: 'world', id: empty.id, models: [shape] }, ada.cookie)).code, 'saved');
  const back = (await s.call(`/api/spaces/world?target=world&id=${empty.id}`, undefined, ada.cookie)).world.models[0];
  assert.deepEqual([back.m, back.by, back.name, back.loose], ['p-crate', 'allworld', 'Crate', true]);
  assert.equal((await s.call('/api/spaces/world/layout', { target: 'world', id: empty.id, models: [{ ...shape, m: 'p-dragon' }] }, ada.cookie)).code, 'invalid_layout');
});

test('worlds: friends-only worlds, the friends tab, likes and friends who build', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola'), chidi = await s.account('chidi@example.com', 'Chidi');
  const den = await s.make(ada, { name: 'Ada den', open: 'friends' });
  const hidden = await s.make(ada, { name: 'Ada secret', open: 'link' });
  assert.equal((await s.call(`/api/spaces/world?target=world&id=${den.id}`, undefined, bola.cookie)).code, 'friends_only');
  assert.equal((await s.call('/api/spaces/worlds?list=new', undefined, bola.cookie)).worlds.length, 0, 'not listed for everyone');
  await s.befriend(ada, bola);
  assert.equal((await s.call(`/api/spaces/world?target=world&id=${den.id}`, undefined, bola.cookie)).ok, true);
  assert.deepEqual((await s.call('/api/spaces/worlds?list=friends', undefined, bola.cookie)).worlds.map((w: Json) => w.name), ['Ada den'], 'a link-only world stays off the friends tab');
  assert.ok(hidden.id);
  // Likes.
  assert.equal((await s.call('/api/spaces/worlds/like', { id: den.id, on: true }, ada.cookie)).code, 'own_world');
  assert.equal((await s.call('/api/spaces/worlds/like', { id: den.id, on: true }, chidi.cookie)).code, 'unknown_world', 'a friends-only world is not liked by a stranger');
  const liked = await s.call('/api/spaces/worlds/like', { id: den.id, on: true }, bola.cookie);
  assert.deepEqual([liked.likes, liked.liked], [1, true]);
  assert.equal((await s.call('/api/spaces/worlds/like', { id: den.id, on: true }, bola.cookie)).likes, 1, 'twice is once');
  assert.equal((await s.call('/api/spaces/worlds?list=mine', undefined, ada.cookie)).worlds.find((w: Json) => w.id === den.id).likes, 1);
  assert.equal((await s.call('/api/spaces/worlds/like', { id: den.id, on: false }, bola.cookie)).likes, 0);
  // Builders: friends only; a builder arranges and sees it in their own list.
  assert.equal((await s.call('/api/spaces/worlds/builders', { id: den.id, builders: [chidi.id] }, ada.cookie)).code, 'friends_only');
  const set = await s.call('/api/spaces/worlds/builders', { id: den.id, builders: [bola.id] }, ada.cookie);
  assert.deepEqual(set.world.builders.map((b: Json) => b.name), ['Bola']);
  assert.equal((await s.call(`/api/spaces/world?target=world&id=${den.id}`, undefined, bola.cookie)).world.canEdit, true);
  const mineForBola = (await s.call('/api/spaces/worlds?list=mine', undefined, bola.cookie)).worlds;
  assert.deepEqual(mineForBola.map((w: Json) => [w.name, w.mine, w.builder]), [['Ada den', false, true]]);
  const shape = { k: 'b1', m: 'p-tree', by: 'allworld', hash: '', x: 3, y: 0, z: 3, ry: 0, s: 1, floor: 0 };
  assert.equal((await s.call('/api/spaces/world/layout', { target: 'world', id: den.id, models: [shape] }, bola.cookie)).code, 'saved');
  assert.equal((await s.call('/api/spaces/worlds/update', { id: den.id, name: 'Bola den' }, bola.cookie)).code, 'not_yours', 'building is not owning');
  // A game to play in it.
  const games = (await s.call('/api/spaces/games', undefined, ada.cookie)).games;
  assert.ok(games.length > 0);
  const withGame = await s.call('/api/spaces/worlds/update', { id: den.id, game: games[0].id }, ada.cookie);
  assert.equal(withGame.world.game.id, games[0].id);
  assert.equal((await s.call(`/api/spaces/world?target=world&id=${den.id}`, undefined, bola.cookie)).world.terrain.game.id, games[0].id);
  assert.equal((await s.call('/api/spaces/worlds/update', { id: den.id, game: 'no-such-game' }, ada.cookie)).ok, false);
  assert.equal((await s.call('/api/spaces/worlds/update', { id: den.id, game: '' }, ada.cookie)).world.game, undefined);
});

test('worlds: the screen: the host puts a video on, everyone follows, a newcomer joins at the right second; only the host changes it', async (t) => {
  const s = await setup(t);
  const ada = await s.account('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola'), chidi = await s.account('chidi@example.com', 'Chidi');
  const park = await s.make(ada, { open: 'everyone' });
  const open = async (who: Device) => {
    const peer = await s.f.socket(who);
    const frames: Json[] = [];
    peer.ws.on('message', (data) => { const frame = JSON.parse(data.toString()); if (/^space-|^error$/.test(frame.type)) frames.push(frame); });
    return { peer, frames, send: (frame: Json) => peer.ws.send(JSON.stringify(frame)) };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  const a = await open(ada), b = await open(bola);
  a.send({ type: 'space-join', target: 'world', id: park.id });
  await settle();
  b.send({ type: 'space-join', target: 'world', id: park.id });
  await settle();
  a.send({ type: 'space-screen', v: 'dQw4w9WgXcQ', play: true, pos: 0 });
  await settle();
  const seen = b.frames.findLast((f) => f.type === 'space-screen');
  assert.deepEqual([seen?.v, seen?.play, seen?.pos], ['dQw4w9WgXcQ', true, 0]);
  assert.ok(a.frames.some((f) => f.type === 'space-screen'), 'the host hears it too');
  b.send({ type: 'space-screen', v: 'aaaaaaaaaaa', play: true, pos: 0 });
  await settle();
  assert.equal(b.frames.at(-1)?.code, 'space_not_host');
  a.send({ type: 'space-screen', v: 'not a video', play: true, pos: 0 });
  await settle();
  assert.equal(b.frames.filter((f) => f.type === 'space-screen').length, 1, 'a bad id is dropped');
  s.f.advance?.(30_000);
  const c = await open(chidi);
  c.send({ type: 'space-join', target: 'world', id: park.id });
  await settle();
  const late = c.frames.find((f) => f.type === 'space-screen');
  assert.equal(late?.v, 'dQw4w9WgXcQ');
  assert.ok(late && late.pos >= 0, 'the newcomer is told where it is now');
  a.send({ type: 'space-screen', play: false, pos: 31 });
  await settle();
  const paused = c.frames.findLast((f) => f.type === 'space-screen');
  assert.deepEqual([paused?.v, paused?.play, paused?.pos], ['dQw4w9WgXcQ', false, 31]);
  a.send({ type: 'space-screen', off: true });
  await settle();
  assert.equal(c.frames.findLast((f) => f.type === 'space-screen')?.v, null);
});
