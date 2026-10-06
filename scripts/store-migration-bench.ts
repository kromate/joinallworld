#!/usr/bin/env node
/**
 * Time the move of a legacy store to per-entry rows (docs/STORAGE.md) on a node:sqlite database.
 *   node --experimental-strip-types scripts/store-migration-bench.ts --players 10000 [--profile typical|heavy]
 * Prints, per collection and in all: milliseconds, entries, rows the engine counts as written (a row and its index entry), the
 * process's peak memory, and the time of the verification (every entry read back and compared with the legacy text).
 */
import { DatabaseSync } from 'node:sqlite';
import { createSqliteStore } from '../deploy/sqlite-store.ts';
import { testStorage } from '../server/testing/sqliteStorage.ts';
import { legacySeed } from '../server/testing/legacySeed.ts';
import type { StoreLayoutTools } from '../server/types.ts';

const args = process.argv.slice(2), option = (name: string, fallback: string): string => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
const players = Number(option('players', '10000')), profile = option('profile', 'typical') === 'heavy' ? 'heavy' : 'typical';
const t = testStorage(new DatabaseSync(':memory:'));
const store = createSqliteStore(t.storage) as unknown as { layout: Required<StoreLayoutTools> };
const seed = legacySeed({ players, profile });
let legacyChars = 0;
for (const [name, value] of Object.entries(seed.collections)) { const text = JSON.stringify(value); legacyChars += text.length; t.db.prepare('INSERT INTO collections(name,value) VALUES(?,?)').run(name, text); }
const rss = (): number => Math.round(process.memoryUsage().rss / 1048576);
global.gc?.();
const rssBefore = rss();
console.log(`${players} players (${profile}): ${(legacyChars / 1e6).toFixed(1)} MB of legacy text, rss ${rssBefore} MB`);
let total = 0, rows = 0;
for (const name of Object.keys(seed.collections)) {
  const changesBefore = t.changes(), began = performance.now();
  const done = await store.layout.migrate([name]);
  const ms = performance.now() - began, written = t.changes() - changesBefore;
  total += ms; rows += written;
  console.log(`  ${name}: ${Math.round(ms)} ms, ${done[name]?.entries} entries, ${written} table rows (+ ${done[name]?.entries} index entries), rss ${rss()} MB`);
}
const began = performance.now();
const compared = await store.layout.compare();
console.log(`  compare of all collections: ${Math.round(performance.now() - began)} ms, equal: ${Object.values(compared).every((row) => (row as { equal: boolean }).equal)}`);
console.log(`total ${Math.round(total)} ms, ${rows} table rows written (each entry row has one more index entry on the platform); peak rss ${rss()} MB (started at ${rssBefore})`);
