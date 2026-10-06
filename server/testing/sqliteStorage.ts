/** The Durable Object storage surface backed by node:sqlite, for tests of the store (deploy/sqlite-store.ts). */
import { DatabaseSync } from 'node:sqlite';
import { assembleText, projectionOf, specOf, splitText } from '../keyed.ts';
import type { SqlBinding, SqliteStorage, SqlCursor, SqlRow } from '../../deploy/cf-types.ts';

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

/** What an edge test reads and writes stored collections through: an async `exec` over the object's storage (rows as plain objects). */
export type AsyncExec = (query: string, ...bindings: (string | number | null)[]) => Promise<Record<string, unknown>[]>;
/** The whole text of a stored collection, whichever layout holds it (the legacy row, or the root and entries put together). */
export async function readStoredCollection(exec: AsyncExec, name: string): Promise<string | undefined> {
  const root = (await exec('SELECT value FROM collections WHERE name = ?', `root:${name}`))[0]?.['value'];
  if (typeof root !== 'string') return (await exec('SELECT value FROM collections WHERE name = ?', name))[0]?.['value'] as string | undefined;
  const entries = new Map<string, [string, string][]>();
  for (const row of await exec('SELECT map, key, value FROM entries WHERE coll = ? ORDER BY map, ord', name)) {
    const list = entries.get(row['map'] as string) ?? []; list.push([row['key'] as string, row['value'] as string]); entries.set(row['map'] as string, list);
  }
  return assembleText(root, (id) => entries.get(id) ?? []);
}
/** Replace a stored collection with `text`, in the layout that holds it now (entries get their projections too). */
export async function writeStoredCollection(exec: AsyncExec, name: string, text: string): Promise<void> {
  const root = (await exec('SELECT value FROM collections WHERE name = ?', `root:${name}`))[0]?.['value'];
  if (typeof root !== 'string') { await exec('UPDATE collections SET value = ? WHERE name = ?', text, name); return; }
  const split = splitText(name, text);
  await exec('UPDATE collections SET value = ? WHERE name = ?', split.rootText, `root:${name}`);
  await exec('DELETE FROM entries WHERE coll = ?', name);
  for (const map of split.maps) {
    const project = specOf(name, map.id)?.project;
    let ord = 0;
    for (const [key, entry] of map.entries) {
      ord += 1;
      const p = projectionOf(project, project ? JSON.parse(entry) as unknown : undefined);
      await exec('INSERT INTO entries(coll,map,key,ord,ix,tx,jx,value) VALUES(?,?,?,?,?,?,?,?)', name, map.id, key, ord, p?.n ?? null, p?.t ?? null, p?.j ?? null, entry);
    }
  }
}
