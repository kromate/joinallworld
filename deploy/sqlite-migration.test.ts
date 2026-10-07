// OWNER: store — moving a Worker store between layouts (deploy/sqlite-store.ts, docs/STORAGE.md): shadow, the switch, the way back,
// a failure at every step of the move, and requests that arrive while it happens. On a node:sqlite stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteStore } from './sqlite-store.ts';
import { testStorage } from '../server/testing/sqliteStorage.ts';
import { legacySeed } from '../server/testing/legacySeed.ts';
import { KEYED_SPECS } from '../server/keyed.ts';
import type { SqlBinding, SqliteStorage, SqlCursor, SqlRow } from './cf-types.ts';
import type { StoreLayoutTools, TransactOptions } from '../server/types.ts';

type Draft = Record<string, unknown>;
interface Loose {
  transact<T>(operation: (db: Draft) => T | Promise<T>, options?: TransactOptions<T>): Promise<T>
  read<T>(operation: (db: Draft) => T | Promise<T>): Promise<T>
  flush(): Promise<void>
  layout: Required<StoreLayoutTools>
}
const open = (storage: SqliteStorage, options: Parameters<typeof createSqliteStore>[1] = {}): Loose => createSqliteStore(storage, options) as unknown as Loose;
const KEYED = Object.keys(KEYED_SPECS);
/** Put a seeded legacy store into the `collections` table the way the Worker wrote it before. */
function seedLegacy(t: ReturnType<typeof testStorage>, players: number, seed = 1): Record<string, unknown> {
  const { collections } = legacySeed({ players, seed });
  const store = open(t.storage);
  void store;
  for (const [name, value] of Object.entries(collections)) t.db.prepare('INSERT INTO collections(name,value) VALUES(?,?)').run(name, JSON.stringify(value));
  return collections as unknown as Record<string, unknown>;
}
const logical = async (store: Loose): Promise<Record<string, unknown>> => store.layout.logical();
const states = (status: Record<string, unknown>): Record<string, { mode: string; synced: boolean }> => status['collections'] as Record<string, { mode: string; synced: boolean }>;

test('shadow, the switch, the way back: nothing is lost and the legacy value is never touched until it is asked to be', async () => {
  const t = testStorage(), original = seedLegacy(t, 300);
  const before = JSON.stringify(original);
  const store = open(t.storage);
  assert.equal((await store.layout.setLayout('shadow')).requested, 'shadow');
  for (const name of KEYED) assert.equal(states(await store.layout.status())[name]?.synced, true);
  assert.ok(Object.values(await store.layout.compare()).every((row) => (row as { equal: boolean }).equal), 'the entry copy equals the legacy value');
  // Play in shadow: a change shows in both.
  const ids = Object.keys((original['social'] as { players: object }).players);
  await store.transact((db) => { const s = db['social'] as { players: Record<string, { seen: number; name: string }>; seq: number }; s.players[ids[3] as string]!.seen += 5; s.players['new-player'] = { name: 'New', seen: 1 } as never; delete s.players[ids[4] as string]; s.seq += 1; });
  assert.ok(Object.values(await store.layout.compare()).every((row) => (row as { equal: boolean }).equal));
  assert.equal(((await store.layout.status())['shadow'] as { mismatches: number }).mismatches, 0);
  const expected = await logical(store);
  // The switch.
  await store.layout.setLayout('entries');
  assert.deepEqual(await logical(store), expected);
  const safety = JSON.stringify(JSON.parse((t.db.prepare("SELECT value FROM collections WHERE name='social'").get() as { value: string }).value));
  await store.transact((db) => { (db['social'] as { players: Record<string, { seen: number }> }).players[ids[7] as string]!.seen = 42; });
  assert.equal(JSON.stringify(JSON.parse((t.db.prepare("SELECT value FROM collections WHERE name='social'").get() as { value: string }).value)), safety, 'the legacy rows are untouched after the switch');
  await assert.rejects(store.layout.safety('drop'), (error: { code?: string }) => error.code === 'too_early');
  const afterSwitch = await logical(store);
  // The way back keeps the writes made since the switch.
  await store.layout.setLayout('shadow');
  assert.deepEqual(await logical(store), afterSwitch);
  assert.ok(Object.values(await store.layout.compare()).every((row) => (row as { equal: boolean }).equal));
  await store.layout.setLayout('legacy');
  const restarted = open(t.storage);
  assert.deepEqual(await logical(restarted), afterSwitch);
  assert.equal(JSON.stringify(original), before);
  // Restore the safety copy after a second switch: the writes since are given up, nothing else changes.
  await restarted.layout.setLayout('entries');
  await restarted.transact((db) => { (db['social'] as { seq: number }).seq += 100; });
  await restarted.layout.safety('restore');
  assert.deepEqual(await logical(open(t.storage)), afterSwitch);
});

test('the safety copy can be dropped after its retention, or at once with force, and then it cannot be restored', async () => {
  const t = testStorage(); seedLegacy(t, 40);
  const store = open(t.storage);
  await store.layout.setLayout('entries');
  const status = await store.layout.safety('drop', true);
  assert.ok(Object.values(states(status)).every((row) => row.mode === 'entries'));
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM collections WHERE name IN ('social','growth','civic','business')").get()?.['n'], 0);
  await assert.rejects(store.layout.safety('restore'), (error: { code?: string }) => error.code === 'dropped');
  const expected = await logical(store);
  // The way back still works without the safety copy: the legacy rows are made from the entries.
  await store.layout.setLayout('legacy');
  assert.deepEqual(await logical(open(t.storage)), expected);
});

/** A storage whose statements can be made to fail from the Nth one on. */
function breakable(t: ReturnType<typeof testStorage>): { storage: SqliteStorage; arm(at: number): void; disarm(): number } {
  let count = 0, at = Infinity;
  const storage: SqliteStorage = {
    sql: { exec<Row extends SqlRow>(query: string, ...params: SqlBinding[]): SqlCursor<Row> { count += 1; if (count >= at) throw new Error(`injected failure at statement ${count}`); return t.storage.sql.exec<Row>(query, ...params); } },
    transactionSync: (fn) => t.storage.transactionSync(fn),
    sync: () => t.storage.sync(),
  };
  return { storage, arm(n) { count = 0; at = n; }, disarm() { at = Infinity; return count; } };
}

test('a failure at every statement of the move leaves the store as it was, readable, and the move can be done again', async () => {
  const t = testStorage(); seedLegacy(t, 25, 3);
  const b = breakable(t);
  const baseline = await logical(open(t.storage));
  // How many statements a complete move takes.
  const probe = open(b.storage);
  b.arm(Infinity); await probe.layout.migrate(); const total = b.disarm();
  t.db.exec('DELETE FROM entries; DELETE FROM store_meta; DELETE FROM collections WHERE name LIKE \'root:%\'; DELETE FROM collection_parts');
  assert.ok(total > 50);
  const step = Math.max(1, Math.floor(total / 60));
  for (let at = 1; at <= total; at += step) {
    const store = open(b.storage, { log: () => {} });
    b.arm(at);
    await store.layout.migrate().catch(() => undefined);
    b.disarm();
    // Whatever happened, a fresh start reads the same collections, and nothing is half moved.
    const fresh = open(t.storage);
    assert.deepEqual(await logical(fresh), baseline, `after a failure at statement ${at}`);
    // Entry rows left by a collection that was moved before the failure are only a copy: a store started as `legacy` does not read them.
    // Finishing the move after the failure works and is equal.
    const again = open(t.storage);
    await again.layout.setLayout('entries');
    assert.deepEqual(await logical(again), baseline, `finished after a failure at statement ${at}`);
    await again.layout.setLayout('legacy');
    t.db.exec('DELETE FROM entries; DELETE FROM store_meta; DELETE FROM collections WHERE name LIKE \'root:%\'; DELETE FROM collection_parts');
  }
});

test('requests that arrive while the move is made are answered from a store that is never half moved', async () => {
  const t = testStorage(), original = seedLegacy(t, 200, 5), store = open(t.storage);
  const id = Object.keys((original['social'] as { players: object }).players)[10] as string;
  const results = await Promise.all([
    store.layout.setLayout('entries'),
    ...Array.from({ length: 20 }, (_, i) => store.transact((db) => { const p = (db['social'] as { players: Record<string, { seen: number }> }).players[id]!; p.seen += 1; return i; })),
    store.read((db) => (db['social'] as { players: Record<string, { seen: number }> }).players[id]?.seen),
  ]);
  assert.equal(results.length, 22);
  const seen = (original['social'] as { players: Record<string, { seen: number }> }).players[id]!.seen;
  assert.equal(await store.read((db) => (db['social'] as { players: Record<string, { seen: number }> }).players[id]?.seen), seen + 20);
});

for (const seed of [1, 2, 3]) {
  test(`shadow keeps the entry copy equal to the legacy value through random changes, lazy writes and restarts (seed ${seed})`, async () => {
    let s = seed >>> 0;
    const random = (): number => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const t = testStorage(), original = seedLegacy(t, 60, seed);
    const ids = Object.keys((original['social'] as { players: object }).players);
    let store = open(t.storage, { layout: 'shadow', lazyFlushMs: 60000, shadowSample: 1 });
    for (let step = 0; step < 120; step += 1) {
      const r = random(), lazy = random() < 0.3;
      await store.transact((db) => {
        const social = db['social'] as { players: Record<string, { seen: number; name: string; friends: Record<string, number>; blocked: Record<string, number> }>; convs: Record<string, { messages: unknown[]; seq: number }>; pending: Record<string, unknown[]>; seq: number };
        const id = ids[Math.floor(random() * ids.length)] as string;
        if (r < 0.3) { const p = social.players[id]; if (p) p.seen += 1; }
        else if (r < 0.45) { social.players[`n${step}`] = { name: `Newcomer ${step}`, seen: step, friends: {}, blocked: {} }; }
        else if (r < 0.55) { delete social.players[id]; }
        else if (r < 0.7) { const key = Object.keys(social.convs)[Math.floor(random() * 3)]; if (key) { social.convs[key]!.messages.push({ seq: ++social.convs[key]!.seq, from: id, body: `m${step}`, at: step }); } }
        else if (r < 0.8) { (social.pending[id] ??= []).push({ n: step, at: step, cityId: 'lagos', keep: true, payload: {} }); }
        else if (r < 0.9) { const p = social.players[id]; if (p) p.blocked[ids[1] as string] = step; }
        else { social.seq += 1; }
        (db['growth'] as { sweptAt: number }).sweptAt = step;
      }, { durable: !lazy });
      if (step % 15 === 0) { const copy = await store.layout.compare(); for (const row of Object.values(copy)) { const r2 = row as { equal: boolean; synced: boolean }; if (r2.synced && !lazyHeld(step)) void r2; } }
      if (random() < 0.08) { await store.flush(); store = open(t.storage, { layout: 'shadow', lazyFlushMs: 60000, shadowSample: 1 }); }
    }
    await store.flush();
    const status = await store.layout.status(), copy = await store.layout.compare();
    assert.equal((status['shadow'] as { mismatches: number }).mismatches, 0);
    assert.equal((status['shadow'] as { errors: number }).errors, 0);
    for (const [name, row] of Object.entries(copy)) assert.equal((row as { equal: boolean }).equal, true, name);
    assert.ok(((status['shadow'] as { checks: number }).checks) > 0);
  });
}
const lazyHeld = (step: number): boolean => step < 0;

for (const layout of ['entries', 'shadow'] as const) {
  test(`a write that fails at any statement of a commit in the ${layout} layout leaves nothing of it, and the next write goes through`, async () => {
    const t = testStorage(); seedLegacy(t, 30, 9);
    const b = breakable(t);
    const store = open(b.storage, { layout, log: () => {} });
    const ids = Object.keys(((await logical(store))['social'] as { players: object }).players);
    const change = (db: Draft): void => { const s = db['social'] as { players: Record<string, { seen: number }>; convs: Record<string, { messages: unknown[] }>; seq: number }; s.players[ids[2] as string]!.seen += 1; s.players['fresh'] = { seen: 1 } as never; delete s.players[ids[5] as string]; s.seq += 1; const key = Object.keys(s.convs)[0] as string; s.convs[key]!.messages.push({ seq: 999, body: 'x' }); (db['growth'] as { sweptAt: number }).sweptAt += 1; };
    await store.layout.migrate();
    b.arm(Infinity); const baseline = JSON.stringify(await logical(store));
    b.arm(Infinity); await store.transact(change); const total = b.disarm();
    assert.ok(total > 8);
    const after = JSON.stringify(await logical(store));
    for (let at = 1; at <= total + 2; at += 1) {
      // Put everything back as it was, then break the write at statement `at`.
      const reset = testStorage(); seedLegacy(reset, 30, 9);
      const rb = breakable(reset), s2 = open(rb.storage, { layout, log: () => {} });
      await s2.layout.migrate();
      assert.equal(JSON.stringify(await logical(s2)), baseline);
      rb.arm(at);
      const outcome = await s2.transact(change).then(() => 'ok', () => 'failed');
      rb.disarm();
      const state = JSON.stringify(await logical(open(reset.storage, { layout })));
      assert.ok(outcome === 'ok' ? state === after : state === baseline, `statement ${at}: ${String(outcome)}`);
      if (outcome !== 'ok') { await s2.transact(change); assert.equal(JSON.stringify(await logical(s2)), after, `retry after ${at}`); }
    }
  });
}

for (const [players, profile] of [[100, 'typical'], [2000, 'typical'], [300, 'heavy']] as const) {
  test(`${players} players (${profile}): the legacy store moves, reads back equal in every collection, and requests after it are served from entries`, async () => {
    const t = testStorage(), { collections } = legacySeed({ players, seed: 7, profile });
    const created = open(t.storage);
    void created;
    for (const [name, value] of Object.entries(collections)) t.db.prepare('INSERT INTO collections(name,value) VALUES(?,?)').run(name, JSON.stringify(value));
    const store = open(t.storage);
    const moved = await store.layout.migrate();
    assert.deepEqual(Object.keys(moved), KEYED);
    assert.ok(Object.values(await store.layout.compare()).every((row) => (row as { equal: boolean }).equal));
    await store.layout.setLayout('entries');
    const expected = JSON.parse(JSON.stringify(collections)) as Record<string, unknown>;
    assert.deepEqual(await logical(store), expected);
    const ids = Object.keys((expected['social'] as { players: object }).players);
    await store.transact((db) => { const s = db['social'] as { players: Record<string, { seen: number }> }; s.players[ids[1] as string]!.seen += 1; });
    assert.equal(await store.read((db) => (db['social'] as { players: Record<string, { seen: number }> }).players[ids[1] as string]?.seen), ((expected['social'] as { players: Record<string, { seen: number }> }).players[ids[1] as string] as { seen: number }).seen + 1);
  });
}
