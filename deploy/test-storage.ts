/** The Durable Object storage surface backed by node:sqlite, for tests of the store (deploy/sqlite-store.ts). */
import { DatabaseSync } from 'node:sqlite';
import type { SqlBinding, SqliteStorage, SqlCursor, SqlRow } from './cf-types.ts';

export interface TestStorage { db: DatabaseSync; storage: SqliteStorage; fail: { sync: boolean }; changes(): number; close(): void }
/** A fresh in-memory database, or the given one (a restart opens the same database again). */
export function testStorage(existing?: DatabaseSync): TestStorage {
  const db = existing ?? new DatabaseSync(':memory:');
  const fail = { sync: false };
  const storage: SqliteStorage = {
    sql: {
      exec<Row extends SqlRow>(query: string, ...params: SqlBinding[]): SqlCursor<Row> {
        const stmt = db.prepare(query);
        if (stmt.columns().length) { const rows = stmt.all(...params) as unknown as Row[]; return { toArray: () => rows, one: () => rows[0] as Row }; }
        stmt.run(...params);
        return { toArray: () => [], one: () => { throw Error('no rows'); } };
      },
    },
    transactionSync<T>(fn: () => T): T { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    async sync() { if (fail.sync) throw Error('barrier failed'); },
  };
  return { db, storage, fail, changes: () => Number((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n), close: () => db.close() };
}

/** The `STORE_LAYOUT` binding the edge tests hand the Worker when the run asks for one (`STORE_LAYOUT=entries npm run test:edge`). */
export function layoutBindings(): Record<string, string> {
  const layout = process.env['STORE_LAYOUT'];
  return layout === 'entries' || layout === 'shadow' ? { STORE_LAYOUT: layout } : {};
}
