// OWNER: store — one server on the legacy layout and one on the per-entry layout are given the same random sequence of requests
// (friends, messages, groups, reactions, blocks, gifts, pings, civic check-ins, reads, searches). Every answer must be the same
// and so must the stored collections, which are compared as they are exported by the store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { fixture } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';
import { createStore } from './store.ts';
import type { StoreLayout } from './keyed.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Random tokens (public ids, salts, nonces, the ids a request made up) are replaced by the order they first appear in. */
function canon(value: unknown, names: Map<string, string>): string {
  return JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[0-9a-f]{20,}\b/g, (token) => { let name = names.get(token); if (!name) { name = `#${names.size}`; names.set(token, name); } return name; });
}
/**
 * Ids are drawn from `randomUUID`; a run of this test makes each server draw from a counter of its own, so that the two servers
 * given the same requests make the same ids (and so sort, and order the members of a conversation, the same).
 */
const draws = { current: 0, counters: [0, 0] };
function useCounters(t: Parameters<typeof fixture>[0]): void {
  const real = crypto.randomUUID;
  crypto.randomUUID = (() => { const n = (draws.counters[draws.current] = (draws.counters[draws.current] ?? 0) + 1); return `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${(n * 7919).toString(16).padStart(12, '0')}`; }) as typeof crypto.randomUUID;
  syncBuiltinESMExports();
  t.after(() => { crypto.randomUUID = real; syncBuiltinESMExports(); });
}
async function world(t: Parameters<typeof fixture>[0], layout: StoreLayout): Promise<{ f: Fixture; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'allworld-model-'));
  const store = await createStore(dir, { layout });
  t.after(async () => { await store.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  return { f: await fixture(t, { store, dataDir: dir }), dir };
}

for (const seed of [11, 12, 13]) {
  test(`the same requests give the same answers and the same stored collections on both layouts (seed ${seed})`, async (t) => {
    useCounters(t); draws.counters = [0, 0];
    draws.current = 0; const a = (await world(t, 'legacy')).f;
    draws.current = 1; const b = (await world(t, 'entries')).f;
    const random = rng(seed), namesA = new Map<string, string>(), namesB = new Map<string, string>();
    const names = ['Ada', 'Bola', 'Chidi', 'Dayo', 'Emeka', 'Funmi'];
    const peopleA: Device[] = [], peopleB: Device[] = [];
    for (const name of names) { draws.current = 0; peopleA.push(await a.device(name)); draws.current = 1; peopleB.push(await b.device(name)); }
    const pick = (): number => Math.floor(random() * names.length), clients = new Map<number, string>();
    let tick = 0;
    const compare = async (what: string): Promise<void> => {
      const x = await a.server.store.layout?.logical(), y = await b.server.store.layout?.logical();
      assert.equal(canon(y, namesB), canon(x, namesA), `stored collections after ${what}`);
    };
    const both = async (what: string, call: (f: Fixture, people: Device[], names: Map<string, string>) => Promise<unknown>): Promise<void> => {
      draws.current = 0; const x = await call(a, peopleA, namesA);
      draws.current = 1; const y = await call(b, peopleB, namesB);
      assert.equal(canon(y, namesB), canon(x, namesA), `answer to ${what}`);
    };
    const post = async (f: Fixture, who: Device, path: string, body: unknown): Promise<unknown> => { const res = await f.request(path, body, who.cookie); return { status: res.status, ...(await res.json() as object) }; };
    const get = async (f: Fixture, who: Device, path: string): Promise<unknown> => { const res = await f.request(path, undefined, who.cookie); return { status: res.status, ...(await res.json() as object) }; };
    for (let step = 0; step < 220; step += 1) {
      const i = pick(), j = (i + 1 + Math.floor(random() * (names.length - 1))) % names.length, r = random(), n = (tick += 1);
      const label = `step ${step} (${r.toFixed(3)} ${names[i]}->${names[j]})`;
      const cid = (f: Fixture): string => { const key = n; const existing = clients.get(key); if (existing) return existing; void f; return `${a.now()}:${key.toString(16).padStart(8, '0')}-0000-4000-8000-${key.toString(16).padStart(12, '0')}`; };
      const accept = random() < 0.8;
      if (r < 0.14) await both(label, (f, p) => post(f, p[i] as Device, '/api/social/friends/request', { to: (p[j] as Device).id, cityId: 'lagos' }));
      else if (r < 0.24) await both(label, (f, p) => post(f, p[i] as Device, '/api/social/friends/answer', { from: (p[j] as Device).id, accept, cityId: 'lagos' }));
      else if (r < 0.50) { const text = `msg ${step} \u{1F469}‍\u{1F4BB}`; await both(label, (f, p) => post(f, p[i] as Device, '/api/social/messages', { to: (p[j] as Device).id, body: text, clientId: cid(f) })); }
      else if (r < 0.56) { const members = [j, (j + 1) % names.length].filter((m) => m !== i); await both(label, (f, p) => post(f, p[i] as Device, '/api/social/groups', { name: `Crew ${step}`, members: members.map((m) => (p[m] as Device).id), clientId: cid(f) })); }
      else if (r < 0.62) await both(label, async (f, p) => { const convs = await get(f, p[i] as Device, '/api/social/conversations') as { conversations?: { id: string }[] }; const first = convs.conversations?.[0]; return first ? post(f, p[i] as Device, `/api/social/conversations/${encodeURIComponent(first.id)}/react`, { seq: 1, emoji: '\u{1F44D}' }) : convs; });
      else if (r < 0.66) await both(label, (f, p) => post(f, p[i] as Device, '/api/social/block', { id: (p[j] as Device).id, cityId: 'lagos' }));
      else if (r < 0.69) await both(label, (f, p) => post(f, p[i] as Device, '/api/social/unblock', { id: (p[j] as Device).id, cityId: 'lagos' }));
      else if (r < 0.74) await both(label, (f, p) => post(f, p[i] as Device, '/api/social/transfers', { to: (p[j] as Device).id, amount: 500, cityId: 'lagos', clientId: cid(f) }));
      else if (r < 0.78) await both(label, (f, p) => post(f, p[i] as Device, '/api/social/ping', { to: (p[j] as Device).id, clientId: cid(f) }));
      else if (r < 0.84) await both(label, (f, p) => get(f, p[i] as Device, '/api/social/me'));
      else if (r < 0.88) await both(label, (f, p) => get(f, p[i] as Device, `/api/social/search?q=${encodeURIComponent(names[j]?.slice(0, 3).toLowerCase() ?? 'ada')}`));
      else if (r < 0.92) await both(label, (f, p) => get(f, p[i] as Device, '/api/civic/pulse?city=lagos'));
      else if (r < 0.95) await both(label, (f, p) => get(f, p[i] as Device, '/api/life?city=lagos'));
      else if (r < 0.98) await both(label, (f, p) => post(f, p[i] as Device, '/api/social/friends/remove', { id: (p[j] as Device).id, cityId: 'lagos' }));
      else { const ms = 3600000 * (1 + Math.floor(random() * 30)); a.advance(ms); b.advance(ms); }
      if (step % 20 === 19) await compare(label);
    }
    await a.flush(); await b.flush();
    await compare('the end');
    const social = (await a.server.store.layout?.logical())?.['social'] as { players: object; convs: object } | undefined;
    assert.ok(Object.keys(social?.players ?? {}).length >= 6 && Object.keys(social?.convs ?? {}).length >= 3, 'the run did something');
  });
}
