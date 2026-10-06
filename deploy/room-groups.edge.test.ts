// ROOM GROUPS on the Worker host: the group sizes are settings of the object, a venue's room is split into groups held in memory,
// a join, move or leave reaches the group only, and a group is put back where it was when the object wakes from a sleep.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { layoutBindings } from './test-storage.ts';

interface StubSocket { addEventListener(type: 'message', listener: (event: { data: string }) => void): void; addEventListener(type: 'close', listener: (event: { code: number; reason: string }) => void): void; accept(): void; send(data: string): void; close(): void }
type MiniflareResponse = Response & { webSocket?: StubSocket | null }
interface MiniflareInstance {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<MiniflareResponse>
  unsafeEvictDurableObject(script: string, className: string, id: { name: string; webSockets?: 'hibernate' }): Promise<void>
}
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external: string[] }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: BundleOptions): Promise<unknown> };

interface Device { id: string; name: string; cookie: string }
interface Member { id: string; name: string; position: { x: number; z: number } }
interface Frame { type: string; members?: Member[]; counts?: { here: number; total: number; groups: number; cap: number }; joined?: Member[]; left?: string[]; moved?: { id: string; x: number; z: number }[]; event?: string; groups?: { id: string; size: number; open: boolean; mine: boolean }[] }
const pause = (ms = 25): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function fixture(t: TestContext, bindings: Record<string, string> = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-groups-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-groups', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { ...layoutBindings(), BUILD_ID: 'groups', ...bindings }, serviceBindings: { ASSETS: () => new Response('asset') } };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} });
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
  let address = 0;
  async function player(name: string): Promise<Device> {
    const response = await send(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}` }, body: JSON.stringify({ name }) });
    assert.equal(response.status, 200);
    const who: Device = { ...(await response.json() as { session: { id: string; name: string } }).session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    await (await send(origin + '/api/life?city=lagos', { headers: { origin, cookie: who.cookie } })).arrayBuffer();
    return who;
  }
  /** A page that reads its group by changes. */
  async function page(who: Device) {
    const response = await send(origin + '/socket', { headers: { origin, cookie: who.cookie, upgrade: 'websocket', 'cf-connecting-ip': `203.0.113.${1 + (address++ % 200)}` } });
    assert.equal(response.status, 101);
    const ws = response.webSocket as StubSocket, frames: Frame[] = [], view = new Map<string, Member>();
    let counts: Frame['counts'] | null = null;
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data) as Frame;
      if (frame.type === 'heartbeat') { ws.send(JSON.stringify({ type: 'heartbeat-ack' })); return; }
      frames.push(frame);
      if (frame.type === 'presence') { view.clear(); for (const member of frame.members ?? []) view.set(member.id, member); counts = frame.counts ?? counts; }
      if (frame.type === 'presence-delta') {
        for (const member of frame.joined ?? []) view.set(member.id, member);
        for (const id of frame.left ?? []) view.delete(id);
        for (const at of frame.moved ?? []) { const member = view.get(at.id); if (member) member.position = { x: at.x, z: at.z }; }
        counts = frame.counts ?? counts;
      }
    });
    ws.addEventListener('close', () => {});
    ws.accept(); sockets.push(ws);
    async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
      for (let i = 0; i < 200; i++) { const value = read(); if (value) return value; await pause(); }
      throw new Error(`Never happened: ${what}`);
    }
    ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park', deltas: true }));
    await until(() => frames.some((frame) => frame.type === 'presence'), `${who.name}'s first list`);
    return { ws, who, frames, view, counts: () => counts, until };
  }
  return { player, page, hibernate: () => mf.unsafeEvictDurableObject('joinallworld-groups', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }) };
}

test('on the Worker: the group sizes are settings; a venue is split into groups, and a move, a join and a leave reach the group only', async (t) => {
  const f = await fixture(t, { ROOM_GROUP_TARGET: '2', ROOM_GROUP_MAX: '3', ROOM_GROUP_MIN: '1' });
  const names = ['Ada', 'Bola', 'Chidi', 'Dami', 'Efe'];
  const pages = [];
  for (const name of names) pages.push(await f.page(await f.player(name)));
  const [ada, bola, chidi, dami, efe] = pages as [typeof pages[number], typeof pages[number], typeof pages[number], typeof pages[number], typeof pages[number]];
  assert.deepEqual([...ada.view.keys()].sort(), [ada.who.id, bola.who.id].sort(), 'the first two share a group');
  assert.deepEqual([...chidi.view.keys()].sort(), [chidi.who.id, dami.who.id].sort(), 'the next two share another');
  assert.deepEqual([...efe.view.keys()], [efe.who.id], 'the fifth starts a third group');
  assert.deepEqual(efe.counts(), { here: 1, total: 5, groups: 3, cap: 3 });
  const before = chidi.frames.length;
  ada.ws.send(JSON.stringify({ type: 'move', x: 4, z: -3 }));
  await bola.until(() => bola.view.get(ada.who.id)?.position.x === 4, 'the move reaches the group');
  await pause(150);
  assert.equal(chidi.frames.length, before, 'and nobody else');
  // A leave reaches the group: Bola goes, Ada is told.
  bola.ws.close();
  await ada.until(() => !ada.view.has(bola.who.id), 'Ada is told Bola left');
});

test('on the Worker: groups survive the object\'s sleep: sockets are back in the groups they were in, and a newcomer is placed among them', { timeout: 120000 }, async (t) => {
  const f = await fixture(t, { ROOM_GROUP_TARGET: '2', ROOM_GROUP_MAX: '3', ROOM_GROUP_MIN: '1', SLEEP_BETWEEN_BEATS: '1' });
  const ada = await f.page(await f.player('Ada')), bola = await f.page(await f.player('Bola'));
  const chidi = await f.page(await f.player('Chidi'));
  await f.hibernate();
  ada.ws.send(JSON.stringify({ type: 'move', x: -2, z: 9 }));
  await bola.until(() => bola.view.get(ada.who.id)?.position.x === -2, 'a move after the sleep reaches the group');
  const before = chidi.frames.length;
  await pause(150);
  assert.equal(chidi.frames.length, before, 'and not the other group');
  const dami = await f.page(await f.player('Dami'));
  assert.deepEqual([...dami.view.keys()].sort(), [chidi.who.id, dami.who.id].sort(), 'a newcomer fills the group that has room');
  assert.equal(dami.counts()?.total, 4, 'the venue total counts everyone');
  dami.ws.send(JSON.stringify({ type: 'groups' }));
  const list = await dami.until(() => dami.frames.find((frame) => frame.type === 'groups'), 'the list of groups');
  assert.deepEqual(list.groups?.map((group) => group.size).sort(), [2, 2]);
});
