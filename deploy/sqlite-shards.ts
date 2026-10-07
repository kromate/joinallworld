/**
 * THE WORLD'S SHARDS ON THE WORKER HOST — the backend that server/world/shard-core.ts writes through.
 * On Node a shard (one local government's registry) is an append-only file; here it is the rows of one
 * `name` in `world_shards`, in the order they were appended. The store above this backend is the same
 * code on both hosts, so its guarantee and its bounds hold here unchanged:
 *   - a transaction whose promise resolves is durable (the rows are written in one SQLite transaction and
 *     `storage.sync()` has returned); one that rejects left nothing behind;
 *   - a warm shard costs no read; a cold one reads the rows of that ONE shard, once; at most `maxOpen`
 *     shards are held in memory; no request reads or rewrites another shard;
 *   - compaction replaces one shard's rows with its current state, atomically.
 * A row holds at most CHUNK characters (SQLite's row limit is 2 MB), so a long append or a compacted
 * shard spans several rows; reading puts them back together in order.
 * The city summary (derived data) is one row of `world_meta`.
 */
import type { SqliteStorage } from './cf-types.ts';

export const SHARD_CHUNK = 400000;

export interface ShardBackend {
  read(name: string): Promise<string>
  append(name: string, text: string): Promise<void>
  replace(name: string, text: string): Promise<void>
  size(name: string): Promise<number>
  readMeta(): Promise<unknown>
  writeMeta(value: unknown): Promise<void>
}

export function sqliteShardBackend(storage: SqliteStorage, { chunk = SHARD_CHUNK, barrier = () => storage.sync(), beforeWrite = () => {} }:
  { chunk?: number; barrier?: () => Promise<void>; beforeWrite?: () => void } = {}): ShardBackend {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS world_shards (seq INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, text TEXT NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS world_shard_name ON world_shards(name, seq)');
  sql.exec('CREATE TABLE IF NOT EXISTS world_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const insert = (name: string, text: string): void => { for (let start = 0; start < text.length; start += chunk) sql.exec('INSERT INTO world_shards(name,text) VALUES(?,?)', name, text.slice(start, start + chunk)); };
  return {
    async read(name: string) { return sql.exec<{ text: string }>('SELECT text FROM world_shards WHERE name = ? ORDER BY seq', name).toArray().map(row => row.text).join(''); },
    async append(name: string, text: string) { storage.transactionSync(() => { beforeWrite(); insert(name, text); }); await barrier(); },
    async replace(name: string, text: string) { storage.transactionSync(() => { beforeWrite(); sql.exec('DELETE FROM world_shards WHERE name = ?', name); insert(name, text); }); await barrier(); },
    async size(name: string) { return Number(sql.exec<{ bytes: number }>('SELECT COALESCE(SUM(LENGTH(CAST(text AS BLOB))), 0) AS bytes FROM world_shards WHERE name = ?', name).toArray()[0]?.bytes) || 0; },
    async readMeta() { const row = sql.exec<{ value: string }>("SELECT value FROM world_meta WHERE key = 'summary'").toArray()[0]; return row ? JSON.parse(row.value) as unknown : null; },
    async writeMeta(value: unknown) { storage.transactionSync(() => { beforeWrite(); sql.exec("INSERT INTO world_meta(key,value) VALUES('summary',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(value)); }); await barrier(); },
  };
}
