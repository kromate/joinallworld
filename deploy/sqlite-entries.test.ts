// OWNER: store — the Worker's per-entry layout (deploy/sqlite-store.ts, server/keyed.ts) on a node:sqlite stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteStore } from './sqlite-store.ts';
import { testStorage } from './test-storage.ts';
import type { Db, TransactOptions } from '../server/types.ts';

interface Player { name: string; seen: number; friends: Record<string, number>; convs: Record<string, number>; blocked: Record<string, number> }
interface Social { players: Record<string, Player>; convs: Record<string, { id: string; messages: { seq: number; text: string }[] }>; houses: Record<string, unknown>; pending: Record<string, { at: number }[]>; reports: unknown[]; seq: number }
interface Loose {
  transact<T>(operation: (db: Draft) => T | Promise<T>, options?: TransactOptions<T>): Promise<T>
  read<T>(operation: (db: Draft) => T | Promise<T>): Promise<T>
  flush(): Promise<void>
  layout: { status(): Promise<{ requested: string; entries: string[]; errors: Record<string, string> }>; logical(): Promise<Record<string, unknown>> }
}
type Draft = Db & { social?: Social; [name: string]: unknown };
const open = (storage: ReturnType<typeof testStorage>['storage'], options: Parameters<typeof createSqliteStore>[1] = {}): Loose => createSqliteStore(storage, options) as unknown as Loose;
const emptySocial = (): Social => ({ players: {}, convs: {}, houses: {}, pending: {}, reports: [], seq: 0 });
const player = (name: string): Player => ({ name, seen: 1, friends: {}, convs: {}, blocked: {} });
const count = (t: ReturnType<typeof testStorage>, query: string): number => Number((t.db.prepare(query).get() as { n: number }).n);

test('entries layout: a collection made by a route is stored as a root and one row per key', async () => {
  const t = testStorage(), store = open(t.storage, { layout: 'entries' });
  await store.transact((db) => { const s = (db['social'] = emptySocial()) as Social; s.players['a'] = player('Ada'); s.players['b'] = player('Bola'); s.convs['c1'] = { id: 'c1', messages: [{ seq: 1, text: 'hi \u{1F469}‍\u{1F4BB}' }] }; });
  assert.equal(count(t, "SELECT COUNT(*) AS n FROM entries WHERE coll='social' AND map='players'"), 2);
  assert.equal(count(t, "SELECT COUNT(*) AS n FROM entries WHERE coll='social' AND map='convs'"), 1);
  assert.equal(count(t, "SELECT COUNT(*) AS n FROM collections WHERE name='social'"), 0, 'the legacy row is not made');
  const root = (t.db.prepare("SELECT value FROM collections WHERE name='root:social'").get() as { value: string }).value;
  assert.ok(root.includes('{"$keyed":"players"}') && !root.includes('Ada'));
  const again = open(t.storage, { layout: 'entries' });
  assert.deepEqual((await again.read((db) => (db['social'] as Social).players['a']))?.name, 'Ada');
  assert.deepEqual(Object.keys(await again.read((db) => (db['social'] as Social).players)), ['a', 'b']);
});

test('entries layout: a change to one player writes one row, and a read writes none', async () => {
  const t = testStorage(), store = open(t.storage, { layout: 'entries' });
  await store.transact((db) => { const s = (db['social'] = emptySocial()) as Social; for (let i = 0; i < 50; i += 1) s.players[`p${i}`] = player(`Player ${i}`); });
  const before = t.changes();
  await store.read((db) => { const s = db['social'] as Social; return [s.players['p7']?.name, Object.keys(s.players).length]; });
  assert.equal(t.changes(), before, 'a read writes nothing');
  await store.transact((db) => { (db['social'] as Social).players['p7']!.seen = 99; });
  assert.equal(t.changes() - before, 1, 'one player changed, one row written');
  await store.transact((db) => { const s = db['social'] as Social; s.convs['c'] = { id: 'c', messages: [] }; });
  const mark = t.changes();
  await store.transact((db) => { (db['social'] as Social).convs['c']!.messages.push({ seq: 1, text: 'hello' }); });
  assert.equal(t.changes() - mark, 1, 'a message is one row');
});

test('entries layout: an existing legacy collection is moved when the layout asks for it, read back equal, and the legacy row stays', async () => {
  const t = testStorage();
  const legacy = open(t.storage);
  await legacy.transact((db) => { const s = (db['social'] = emptySocial()) as Social; for (let i = 0; i < 30; i += 1) { s.players[`p${i}`] = player(`Player ${i} \u{1F600}`); s.convs[`c${i}`] = { id: `c${i}`, messages: [{ seq: 1, text: `line ${i}` }] }; } s.seq = 5; db['growth'] = { salt: 'x'.repeat(16), players: { a: { seen: 1 } }, shares: {}, metrics: {}, tables: {}, sweptAt: 0 }; });
  const stored = (t.db.prepare("SELECT value FROM collections WHERE name='social'").get() as { value: string }).value;
  const before = await legacy.layout.logical();
  const store = open(t.storage, { layout: 'entries' });
  assert.deepEqual(await store.read((db) => (db['social'] as Social).players['p3']?.name), 'Player 3 \u{1F600}');
  assert.deepEqual((await store.layout.status()).entries, ['business', 'civic', 'growth', 'social']);
  assert.deepEqual(await store.layout.logical(), before);
  assert.equal((t.db.prepare("SELECT value FROM collections WHERE name='social'").get() as { value: string }).value, stored, 'the legacy value is untouched');
  assert.equal(count(t, "SELECT COUNT(*) AS n FROM entries WHERE coll='social'"), 60);
  // Start again in the legacy layout: it reads the legacy value, as it was.
  const back = open(t.storage);
  assert.deepEqual(await back.read((db) => (db['social'] as Social).seq), 5);
});

test('entries layout: a lazy change is held, seen by the next read, and written by a flush or by a durable change that read it', async () => {
  const t = testStorage(), store = open(t.storage, { layout: 'entries', lazyFlushMs: 60000 });
  await store.transact((db) => { const s = (db['social'] = emptySocial()) as Social; s.players['a'] = player('Ada'); s.players['b'] = player('Bola'); });
  const mark = t.changes();
  await store.transact((db) => { (db['social'] as Social).players['a']!.seen = 50; }, { durable: false });
  assert.equal(t.changes(), mark, 'held, not written');
  assert.equal(await store.read((db) => (db['social'] as Social).players['a']?.seen), 50);
  // A read that changes nothing writes nothing.
  await store.transact(() => 1, { durable: false });
  assert.equal(t.changes(), mark);
  await store.flush();
  assert.equal(t.changes() - mark, 1);
  assert.equal(JSON.parse((t.db.prepare("SELECT value FROM entries WHERE key='a'").get() as { value: string }).value).seen, 50);
  // A held change to b is written by a durable change that read b, and one it did not read stays held.
  await store.transact((db) => { const s = db['social'] as Social; s.players['a']!.seen = 60; s.players['b']!.seen = 61; }, { durable: false });
  const mark2 = t.changes();
  await store.transact((db) => { void (db['social'] as Social).players['b']; (db['social'] as Social).seq += 1; });
  assert.equal(JSON.parse((t.db.prepare("SELECT value FROM entries WHERE key='b'").get() as { value: string }).value).seen, 61);
  assert.equal(JSON.parse((t.db.prepare("SELECT value FROM entries WHERE key='a'").get() as { value: string }).value).seen, 50, 'a was not read: still held');
  assert.ok(t.changes() - mark2 >= 2);
  // Memory lost before the flush loses only what was lazy.
  const restarted = open(t.storage, { layout: 'entries' });
  assert.equal(await restarted.read((db) => (db['social'] as Social).players['a']?.seen), 50);
  await store.flush();
});

test('entries layout: a commit that fails halfway leaves no entry and no root changed', async () => {
  const t = testStorage(), store = open(t.storage, { layout: 'entries' });
  await store.transact((db) => { const s = (db['social'] = emptySocial()) as Social; s.players['a'] = player('Ada'); });
  const snapshot = JSON.stringify(await store.layout.logical());
  t.db.exec("CREATE TRIGGER fail_entry BEFORE INSERT ON entries WHEN NEW.key = 'z' BEGIN SELECT RAISE(ABORT,'injected'); END");
  await assert.rejects(store.transact((db) => { const s = db['social'] as Social; s.players['a']!.seen = 77; s.seq = 9; s.players['y'] = player('Yemi'); s.players['z'] = player('Zed'); }), (error: { code?: string }) => error.code === 'storage_unavailable');
  assert.equal(JSON.stringify(await store.layout.logical()), snapshot);
  t.db.exec('DROP TRIGGER fail_entry');
  await store.transact((db) => { const s = db['social'] as Social; s.players['z'] = player('Zed'); });
  assert.deepEqual(Object.keys((await store.layout.logical())['social'] ? ((await store.layout.logical())['social'] as Social).players : {}), ['a', 'z']);
});

test('entries layout: an entry longer than a row is split over parts and read back whole; a shorter one gives the parts back', async () => {
  const t = testStorage(), store = open(t.storage, { layout: 'entries', chunk: 100 });
  await store.transact((db) => { const s = (db['social'] = emptySocial()) as Social; s.convs['big'] = { id: 'big', messages: Array.from({ length: 30 }, (_, i) => ({ seq: i, text: `message ${i} \u{1F469}‍\u{1F4BB}`.repeat(2) })) }; });
  assert.ok(count(t, "SELECT COUNT(*) AS n FROM collection_parts WHERE name LIKE 'entry:%'") > 2);
  assert.equal(await store.read((db) => (db['social'] as Social).convs['big']?.messages.length), 30);
  await store.transact((db) => { (db['social'] as Social).convs['big']!.messages.length = 1; (db['social'] as Social).convs['big']!.messages[0]!.text = 'x'; });
  assert.equal(count(t, "SELECT COUNT(*) AS n FROM collection_parts WHERE name LIKE 'entry:%'"), 0);
  assert.equal(await store.read((db) => (db['social'] as Social).convs['big']?.messages[0]?.text), 'x');
  await store.transact((db) => { delete (db['social'] as Social).convs['big']; });
  assert.equal(count(t, "SELECT COUNT(*) AS n FROM entries WHERE coll='social' AND map='convs'"), 0);
});

/** A small deterministic random source. */
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
function operate(db: Draft, random: () => number): void {
  const s = (db['social'] ??= emptySocial()) as Social;
  const ids = Object.keys(s.players), id = (): string => ids[Math.floor(random() * ids.length)] ?? 'none';
  const r = random();
  if (r < 0.25 || !ids.length) { const key = `u${Math.floor(random() * 60)}`; s.players[key] ??= player(`Name ${key}`); }
  else if (r < 0.45) { const a = s.players[id()]; if (a) { a.seen += 1; a.friends[id()] = Math.floor(random() * 50); } }
  else if (r < 0.55) { delete s.players[id()]; }
  else if (r < 0.75) { const c = `c${Math.floor(random() * 12)}`; (s.convs[c] ??= { id: c, messages: [] }).messages.push({ seq: Math.floor(random() * 1e6), text: `t${Math.floor(random() * 1e5)}` }); }
  else if (r < 0.82) { delete s.convs[`c${Math.floor(random() * 12)}`]; }
  else if (r < 0.9) { (s.pending[id()] ??= []).push({ at: Math.floor(random() * 1000) }); }
  else if (r < 0.94) { delete s.pending[id()]; }
  else { s.seq += 1; s.reports.push({ n: s.seq }); }
}
for (const seed of [1, 2, 3]) {
  test(`entries layout and legacy layout hold the same collections after every transaction, restarts and lazy writes included (seed ${seed})`, async () => {
    const random = rng(seed), legacyT = testStorage(), entriesT = testStorage();
    let legacy = open(legacyT.storage, { lazyFlushMs: 60000 }), entries = open(entriesT.storage, { layout: 'entries', lazyFlushMs: 60000 });
    for (let step = 0; step < 250; step += 1) {
      const operations = 1 + Math.floor(random() * 3), seedOps = Math.floor(random() * 1e9), lazy = random() < 0.3, fail = random() < 0.08;
      const run = (store: Loose): Promise<unknown> => store.transact((db) => { const r = rng(seedOps); for (let i = 0; i < operations; i += 1) operate(db, r); if (fail) throw new Error('refused'); }, { durable: !lazy });
      const [a, b] = await Promise.allSettled([run(legacy), run(entries)]);
      assert.equal(a.status, b.status, `step ${step}`);
      if (step % 10 === 0) assert.deepEqual(await entries.layout.logical(), await legacy.layout.logical(), `logical state at step ${step}`);
      if (random() < 0.05) { await legacy.flush(); await entries.flush(); legacy = open(legacyT.storage, { lazyFlushMs: 60000 }); entries = open(entriesT.storage, { layout: 'entries', lazyFlushMs: 60000 }); }
    }
    assert.deepEqual(await entries.layout.logical(), await legacy.layout.logical());
    await legacy.flush(); await entries.flush();
    assert.deepEqual(await open(entriesT.storage, { layout: 'entries' }).layout.logical(), await open(legacyT.storage).layout.logical());
  });
}
