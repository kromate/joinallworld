/**
 * THE WRITE METER: how many rows the object's storage was asked to write, by table and by the kind of work that wrote them.
 *
 * A SQLite Durable Object is billed per row written, and every index entry a statement touches is a row of its own, so
 * the number that matters is the one the runtime reports for each statement (`cursor.rowsWritten`), not the number of
 * statements. The meter wraps `sql.exec`, reads that number for every statement that can write, and adds it to two
 * tallies kept in memory: one per table, one per source (a route, a socket message type, the alarm, start-up).
 * Setting the alarm is a write too, and is counted under the table name `(alarm)`.
 *
 * The tallies are counters only: no key, no value, no player. They start again when the object loses its memory.
 * The operator's overview shows them (server/routes/moderation.ts, `store.rows`).
 *
 * A source is whatever was named last (`from`). The object runs one piece of code at a time but requests interleave at
 * every await, so a row written by a commit that waited behind another request may be counted under that request's
 * name. The per-table numbers are exact; the per-source numbers are exact for a lone player and close under load.
 */
import type { SqlBinding, SqlCursor, SqlRow, SqlStorageLike } from './cf-types.ts';
import type { RowsWritten } from '../src/types/support.ts';

/** The table name the meter gives a write to the alarm. */
export const ALARM_TABLE = '(alarm)';
/** Sources are route keys and message types, which are few; a bound all the same, so a mistake cannot grow the tally without limit. */
const MAX_SOURCES = 400;

export interface WriteMeter {
  /** The storage's `sql`, counted. */
  sql: SqlStorageLike
  /** Name the work that starts now; one call of that work is counted. */
  from(source: string): void
  /** Count rows that did not go through `sql.exec` (the alarm). */
  add(table: string, rows: number): void
  snapshot(): RowsWritten
}

/** The table name the meter gives a statement that changes the schema (a table or an index made, changed or dropped). */
export const SCHEMA_TABLE = '(schema)';
/** The table a statement writes, or null for one that cannot write a row (a read, a pragma). */
function tableOf(query: string): string | null {
  const found = /^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(query);
  if (found) return found[1] as string;
  return /^\s*(?:CREATE|DROP|ALTER)\s/i.test(query) ? SCHEMA_TABLE : null;
}

export function createWriteMeter(sql: SqlStorageLike, now: () => number = Date.now): WriteMeter {
  const tables = new Map<string, number>(), sources = new Map<string, { calls: number; rows: number; tables: Map<string, number> }>(), parsed = new Map<string, string | null>();
  const since = now();
  let total = 0, current = 'start';
  const sourceOf = (name: string) => {
    let entry = sources.get(name);
    if (!entry) { if (sources.size >= MAX_SOURCES) name = 'other'; entry = sources.get(name) ?? { calls: 0, rows: 0, tables: new Map() }; sources.set(name, entry); }
    return entry;
  };
  function add(table: string, rows: number): void {
    if (!(rows > 0)) return;
    total += rows; tables.set(table, (tables.get(table) ?? 0) + rows);
    const entry = sourceOf(current); entry.rows += rows; entry.tables.set(table, (entry.tables.get(table) ?? 0) + rows);
  }
  return {
    sql: {
      exec<Row extends SqlRow = SqlRow>(query: string, ...bindings: SqlBinding[]): SqlCursor<Row> {
        const cursor = sql.exec<Row>(query, ...bindings);
        let table = parsed.get(query);
        if (table === undefined) { table = tableOf(query); if (parsed.size < 1000) parsed.set(query, table); }
        // A statement that writes returns no rows, so it has run to its end by now and its count is final.
        if (table !== null) add(table, Number(cursor.rowsWritten) || 0);
        return cursor;
      },
    },
    from(source: string): void { current = source; sourceOf(source).calls += 1; },
    add,
    snapshot: () => ({
      since, total, tables: Object.fromEntries(tables),
      sources: Object.fromEntries([...sources].map(([name, entry]) => [name, { calls: entry.calls, rows: entry.rows, tables: Object.fromEntries(entry.tables) }])),
    }),
  };
}
