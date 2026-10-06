/**
 * THE MAIN STORE ON THE WORKER HOST: transaction-local views over the Durable Object's SQLite tables.
 * The same interface as server/store.ts — transact(fn(db), { committed }?) and read(fn(db)) over one
 * document `{ version, sessions, archivedLives, <collections> }` — and the same guarantee:
 *
 *   A transaction whose promise REJECTS has no effect. Every callback gets a fresh draft; nothing a
 *   callback changed outlives it unless its commit — ONE synchronous SQLite transaction that writes the
 *   sessions, their receipts, the archives and the collections together — succeeded.
 *   A transaction whose promise RESOLVES is durable: the commit is followed by `storage.sync()` before
 *   `committed(result)` runs and before the caller is answered (`barrier`; the host passes its own so that the writes
 *   it makes while the object is starting — when nothing can be answered yet — do not wait on it).
 *   LAZY transactions ({ durable: false }, or a `durable` function answering false: a poll that only settles the clock,
 *   a check-in, a counter) follow the Node store's rule when the host asks for it (`lazyFlushMs` > 0): such a change is
 *   HELD IN MEMORY, seen by every later transaction and read, and written `lazyFlushMs` later at the latest — sooner
 *   when a durable transaction that changes something has read the same session or collection, which it then writes
 *   with its own change (a transaction that changes nothing writes nothing). A row
 *   written is a row billed (and an index entry is another), so a poll must not cost one. Only a change to a session
 *   or a collection that already exists is ever held; a transaction that creates or removes anything, or touches a
 *   receipt, an account, a device binding or an archive, is written at once whatever it asked for. If the object loses
 *   its memory first, a held change is simply gone and is computed again from what is stored — the one case, as on
 *   Node, where "resolved" does not mean "kept". Without `lazyFlushMs` every write is durable (`waitForObserved` is
 *   accepted and has nothing to wait for: a held change is never one somebody was promised).
 *   A commit that fails is rejected as { status: 503, code: 'storage_unavailable' } with the cause kept
 *   for the log, never sent to a client. A failed durability barrier is an UNCERTAIN outcome: the store
 *   refuses everything until the object restarts (stats().failing), and a retry then meets the receipt
 *   if the commit had in fact been kept.
 *
 * WHERE THINGS LIVE
 *   sessions(secret, public_id, expires_at, value)   one row per device session, WITHOUT its receipts
 *   action_receipts(sender, action_id, action_at, value)   session.actions — exactly-once for game actions
 *   once_receipts(sender, id, at, kind, value)       session.once — exactly-once for every other write
 *                                                    (server/routes/once.ts). Receipts are rows of their own so that
 *                                                    a player's thousands of receipts are never rewritten with their
 *                                                    life, and a session row stays far below SQLite's 2 MB row limit.
 *   archived_lives(public_id, value)
 *   accounts(id, public_id, value)                   one row per account (server/accounts/service.ts): `db.accounts`
 *   account_devices(secret, account_id, expires_at, value)   one row per signed-in browser: `db.accountDevices`. Both are
 *                                                    rows of their own, read by key, so a request by a signed-in browser
 *                                                    reads two rows and a sign-in never rewrites every account. The two
 *                                                    tables were added beside the others: a database made before them
 *                                                    gains them empty on its next start, and no existing table changes.
 *   collections(name, value) + collection_parts(name, part, value)   each feature collection as JSON; one larger
 *                                                    than CHUNK characters is split over rows of collection_parts.
 *                                                    Only the parts whose text changed are written.
 * A row that exists is UPDATEd by its key and only in the columns that changed: naming an indexed column in a statement
 * rewrites its index entry, which is a second row written for nothing.
 * Inside a transaction, `session.actions` and `session.once` are lazy maps over their tables: reading one id
 * reads one row, and only the receipts a transaction added, changed or removed are written.
 *
 * Extras for the host only: db.$store.scanSessions(predicate) → [secret] (records are read without receipts),
 * db.$store.expiredSessionKeys(now) → [secret] (by the stored expiry: only the records that have run out are read),
 * db.$store.sessionKeyByPublicId(id), db.$store.onceCounts(liveSince, lightKinds) → { money, light }.
 */
import { storageError } from '../server/protocol.ts';
import type { SqlBinding, SqliteStorage } from './cf-types.ts';
import type { AccountDeviceRecord, AccountRecord, ActionReceipt, Db, OnceReceipt, SessionRecord, StoreHelpers, TransactOptions } from '../server/types.ts';
import type { SqliteStore } from './host-seam.ts';
import { Layer, KEYED_SPECS, assembleText, isKeyedCollection, matches, parseLayout, projectionOf, specOf, splitText } from '../server/keyed.ts';
import type { CollectionWrite, LayerSource, ScanHit, ScanQuery, StoreLayout } from '../server/keyed.ts';

/** One row of `action_receipts` or `once_receipts`. */
type ReceiptRecord = ActionReceipt | OnceReceipt;
/** A session's receipts as the transaction sees them: keyed by action or client id, read lazily from their table. */
type ReceiptMap<R extends ReceiptRecord> = Record<`${number}:${string}`, R>;

/** The most characters of a collection kept in one row (a row may hold 2 MB; four bytes a character at worst). */
export const CHUNK = 400000;

export interface SqliteStoreOptions {
  beforeCommit?: () => void; chunk?: number; barrier?: () => Promise<void>
  /** Hold lazy changes in memory for at most this long (see LAZY above). 0, the default: every write is durable at once. */
  lazyFlushMs?: number
  /** How the collections of server/keyed.ts are stored: `legacy` (one JSON value each, the default) or `entries` (see docs/STORAGE.md). The operator's own choice, once made, overrides it. */
  layout?: StoreLayout
  /** Say what the store does that is worth a line in the log (a migration, a refusal). */
  log?: (line: string) => void
  /** In `shadow`, compare the entry copy with the legacy value on one in this many loads of a collection (1: every load). */
  shadowSample?: number
}
export type { StoreLayout };
/** How long the legacy rows are kept after the switch to `entries`. */
export const SAFETY_DAYS = 14;
/** A short fingerprint of a text (FNV-1a over its characters, 53 bits), for comparing stores without moving them. */
function hashOf(text: string | undefined): string | null {
  if (text === undefined) return null;
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) { a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0; b = (Math.imul(b + text.charCodeAt(i), 0x85ebca6b) ^ (b >>> 13)) >>> 0; }
  return `${text.length}:${a.toString(16)}${b.toString(16)}`;
}
/** A change held in memory: the text to store, and the text the row holds now. */
interface Held { text: string; stored: string }
/** The head a row holds in place of a text that was split over rows of collection_parts. */
const PARTS_HEAD = /^\{"\$parts":(\d{1,6})\}$/;
const entryName = (coll: string, id: string, key: string): string => `${coll}\u0000${id}\u0000${key}`;

/** server/protocol.ts storageError: { status: 503, code: 'storage_unavailable' } with the cause kept for the log. */
const toStorageError = storageError as (error: unknown) => Error;

type Cache<T> = Map<string, T | undefined>;
interface ReceiptEntry<R extends ReceiptRecord> { cache: Cache<R>; original: Map<string, string | undefined>; map: Record<string, R | undefined> }

export function createSqliteStore(storage: SqliteStorage, { beforeCommit, chunk = CHUNK, barrier = () => storage.sync(), lazyFlushMs = 0, layout: wantedLayout = 'legacy', log = () => {}, shadowSample = 50 }: SqliteStoreOptions = {}): SqliteStore {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS sessions (secret TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS archived_lives (public_id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS action_receipts (sender TEXT NOT NULL, action_id TEXT NOT NULL, action_at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,action_id))');
  // An index by action time was made here once and never read by any query: it only made every receipt cost a second
  // index entry. Dropping it removes no row; a database that never had it is left as it is.
  sql.exec('DROP INDEX IF EXISTS action_expiry');
  sql.exec('CREATE TABLE IF NOT EXISTS once_receipts (sender TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,id))');
  sql.exec('CREATE INDEX IF NOT EXISTS once_expiry ON once_receipts(at)');
  sql.exec('CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, public_id TEXT, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS account_devices (secret TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL, value TEXT NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS account_devices_account ON account_devices(account_id)');
  sql.exec('CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS collection_parts (name TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(name,part))');
  // The per-entry layout (server/keyed.ts, docs/STORAGE.md): one row per key of a keyed map, in the order the keys were added.
  // ix, tx and jx are what a scan may ask without reading the entry (server/keyed.ts Projection). A root is a collection named `root:<name>`.
  sql.exec('CREATE TABLE IF NOT EXISTS entries (coll TEXT NOT NULL, map TEXT NOT NULL, key TEXT NOT NULL, ord INTEGER NOT NULL, ix INTEGER, tx TEXT, jx TEXT, value TEXT NOT NULL, PRIMARY KEY(coll,map,key)) WITHOUT ROWID');
  sql.exec('CREATE INDEX IF NOT EXISTS entries_order ON entries(coll,map,ord)');
  sql.exec('CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  let serial: Promise<unknown> = Promise.resolve(), failed = false, executing = false;
  const stats = { transactions: 0, reads: 0, writes: 0, aborted: 0, writeFailures: 0, lazy: 0 };
  // Lazy changes not yet written (LAZY above): the newest text of a session or a collection, by key.
  const held = { sessions: new Map<string, Held>(), collections: new Map<string, Held>(), entries: new Map<string, Held>() };
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** A collection's JSON text, put together from its parts when it was split. */
  function collectionText(name: string): string | undefined {
    const row = sql.exec<{ value: string }>('SELECT value FROM collections WHERE name = ?', name).toArray()[0];
    if (!row) return undefined;
    const split = /^\{"\$parts":(\d{1,6})\}$/.exec(row.value);
    if (!split) return row.value;
    const parts = sql.exec<{ value: string }>('SELECT value FROM collection_parts WHERE name = ? ORDER BY part', name).toArray();
    if (parts.length !== Number(split[1])) throw new Error(`Collection ${name} is incomplete`);
    return parts.map(part => part.value).join('');
  }
  /** Write `text` over rows of collection_parts under `name`: only the parts that differ, and the rows past the last one are dropped. Answers the number of parts. */
  function writeParts(name: string, text: string): number {
    const old = new Map(sql.exec<{ part: number; value: string }>('SELECT part,value FROM collection_parts WHERE name = ?', name).toArray().map(row => [Number(row.part), row.value]));
    let parts = 0;
    for (let start = 0; start < text.length; start += chunk) {
      const value = text.slice(start, start + chunk);
      if (old.get(parts) !== value) sql.exec('INSERT INTO collection_parts(name,part,value) VALUES(?,?,?) ON CONFLICT(name,part) DO UPDATE SET value=excluded.value', name, parts, value);
      parts += 1;
    }
    if ([...old.keys()].some(part => part >= parts)) sql.exec('DELETE FROM collection_parts WHERE name = ? AND part >= ?', name, parts);
    return parts;
  }
  /** Store a collection's text. What is there is read first (reading is not a row written), and only what differs is written. */
  function writeCollection(name: string, text: string): void {
    const head = sql.exec<{ value: string }>('SELECT value FROM collections WHERE name = ?', name).toArray()[0]?.value;
    const putHead = (value: string): void => { if (value !== head) sql.exec('INSERT INTO collections(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value', name, value); };
    if (text.length <= chunk) { if (head !== undefined && PARTS_HEAD.test(head)) sql.exec('DELETE FROM collection_parts WHERE name = ?', name); putHead(text); return; }
    putHead(`{"$parts":${writeParts(name, text)}}`);
  }
  // ---- the per-entry layout (server/keyed.ts) -----------------------------------------------------------------------------
  /** The text of an entry row: its value, or the parts it was split into. */
  function entryText(coll: string, id: string, key: string, value: string): string {
    const split = PARTS_HEAD.exec(value);
    if (!split) return value;
    const name = `entry:${entryName(coll, id, key)}`, parts = sql.exec<{ value: string }>('SELECT value FROM collection_parts WHERE name = ? ORDER BY part', name).toArray();
    if (parts.length !== Number(split[1])) throw new Error(`Entry ${coll}/${id}/${key} is incomplete`);
    return parts.map(part => part.value).join('');
  }
  /** What the stored entry is, with no held change applied. */
  function storedEntry(coll: string, id: string, key: string): string | undefined {
    const row = sql.exec<{ value: string }>('SELECT value FROM entries WHERE coll = ? AND map = ? AND key = ?', coll, id, key).toArray()[0];
    return row ? entryText(coll, id, key, row.value) : undefined;
  }
  const heldKey = (coll: string, id: string, key: string): string => JSON.stringify([coll, id, key]);
  /** What a transaction reads of a layered collection: the stored rows, with held changes laid over them. */
  const entrySource: LayerSource = {
    root(coll) {
      const name = `root:${coll}`, stored = collectionText(name);
      return stored === undefined ? undefined : { text: heldText(held.collections, name, stored) ?? stored, stored };
    },
    entry(coll, id, key) {
      const stored = storedEntry(coll, id, key);
      return stored === undefined ? undefined : { text: heldText(held.entries, heldKey(coll, id, key), stored) ?? stored, stored };
    },
    keys: (coll, id) => sql.exec<{ key: string }>('SELECT key FROM entries WHERE coll = ? AND map = ? ORDER BY ord', coll, id).toArray().map(row => row.key),
    ord: (coll, id, key) => { const row = sql.exec<{ ord: number }>('SELECT ord FROM entries WHERE coll = ? AND map = ? AND key = ?', coll, id, key).toArray()[0]; return row ? Number(row.ord) : undefined; },
    scan(coll, id, query) { return scanRows(coll, id, query); },
  };
  /** The entries of a map that answer a scan: by the columns beside each row (no entry is read or parsed), held changes judged by their text. */
  function scanRows(coll: string, id: string, query: ScanQuery): ScanHit[] {
    const conditions: string[] = [], params: SqlBinding[] = [];
    if (query.nBelow !== undefined) { conditions.push(query.missing ? '(ix < ? OR ix IS NULL)' : 'ix < ?'); params.push(query.nBelow); }
    if (query.nAtLeast !== undefined) { conditions.push('ix >= ?'); params.push(query.nAtLeast); }
    if (query.tContains !== undefined) { conditions.push('instr(tx, ?) > 0'); params.push(query.tContains); }
    if (query.tEquals !== undefined) { conditions.push('tx = ?'); params.push(query.tEquals); }
    if (query.jIncludes !== undefined) { conditions.push('instr(jx, ?) > 0'); params.push(query.jIncludes); }
    if (query.hasJ === true) conditions.push('jx IS NOT NULL');
    let where = conditions.length ? conditions.join(' AND ') : '1';
    if (query.orKey !== undefined) { where = `(${where} OR key = ?)`; params.push(query.orKey); }
    const hits = new Map<string, ScanHit>();
    for (const row of sql.exec<{ key: string; ord: number; ix: number | null; jx: string | null }>(`SELECT key, ord, ix, jx FROM entries WHERE coll = ? AND map = ? AND ${where} ORDER BY ord`, coll, id, ...params).toArray()) hits.set(row.key, { key: row.key, ord: Number(row.ord), n: row.ix === null ? undefined : Number(row.ix), ...(row.jx !== null ? { j: row.jx } : {}) });
    // A change held in memory is not in the columns yet: it is judged by its own text.
    const name = specOf(coll, id)?.project;
    for (const hk of [...held.entries.keys()]) {
      const [c, m, key] = JSON.parse(hk) as [string, string, string];
      if (c !== coll || m !== id) continue;
      const stored = storedEntry(coll, id, key), text = heldText(held.entries, hk, stored);
      if (text === undefined) continue;
      const p = projectionOf(name, JSON.parse(text));
      if (!matches(query, key, p)) { hits.delete(key); continue; }
      const ord = entrySource.ord?.(coll, id, key);
      if (ord !== undefined) hits.set(key, { key, ord, n: p?.n, ...(p?.j !== undefined ? { j: p.j } : {}) });
    }
    return [...hits.values()].sort((a, b) => a.ord - b.ord);
  }
  /** Write one entry row (a new one at `ord`); a text longer than a chunk goes over collection_parts. */
  function putEntry(coll: string, id: string, key: string, text: string, value: unknown, ord: number | null, hadParts: boolean): void {
    const name = `entry:${entryName(coll, id, key)}`;
    let stored = text;
    if (text.length > chunk) stored = `{"$parts":${writeParts(name, text)}}`; else if (hadParts) sql.exec('DELETE FROM collection_parts WHERE name = ?', name);
    const projection = projectionOf(specOf(coll, id)?.project, value), ix = projection?.n ?? null, tx = projection?.t ?? null, jx = projection?.j ?? null;
    if (ord === null) sql.exec('UPDATE entries SET ix=?, tx=?, jx=?, value=? WHERE coll=? AND map=? AND key=?', ix, tx, jx, stored, coll, id, key);
    else sql.exec('INSERT INTO entries(coll,map,key,ord,ix,tx,jx,value) VALUES(?,?,?,?,?,?,?,?)', coll, id, key, ord, ix, tx, jx, stored);
  }
  function removeEntry(coll: string, id: string, key: string): void {
    const row = sql.exec<{ value: string }>('SELECT value FROM entries WHERE coll = ? AND map = ? AND key = ?', coll, id, key).toArray()[0];
    if (!row) return;
    sql.exec('DELETE FROM entries WHERE coll = ? AND map = ? AND key = ?', coll, id, key);
    if (PARTS_HEAD.test(row.value)) sql.exec('DELETE FROM collection_parts WHERE name = ?', `entry:${entryName(coll, id, key)}`);
  }
  /** Write what a transaction changed in layered collections. Answers the rows written. Runs inside the commit's SQLite transaction. */
  function writeLayer(writes: readonly CollectionWrite[]): number {
    let wrote = 0;
    for (const write of writes) {
      if (write.removed) {
        for (const map of write.maps) for (const key of map.deletes) { removeEntry(write.coll, map.id, key); wrote += 1; }
        sql.exec('DELETE FROM collections WHERE name = ?', `root:${write.coll}`); sql.exec('DELETE FROM collection_parts WHERE name = ?', `root:${write.coll}`); wrote += 1;
        continue;
      }
      if (write.root) { writeCollection(`root:${write.coll}`, write.root.text); wrote += 1; }
      for (const map of write.maps) {
        for (const key of map.deletes) { removeEntry(write.coll, map.id, key); wrote += 1; }
        let next: number | null = null;
        for (const put of map.puts) {
          if (put.stored === undefined) {
            next ??= Number(sql.exec<{ top: number | null }>('SELECT MAX(ord) AS top FROM entries WHERE coll = ? AND map = ?', write.coll, map.id).toArray()[0]?.top ?? 0);
            next += 1;
            putEntry(write.coll, map.id, put.key, put.text, put.value, next, false);
          } else putEntry(write.coll, map.id, put.key, put.text, put.value, null, put.stored.length > chunk);
          wrote += 1;
        }
      }
    }
    return wrote;
  }
  /**
   * What of a layered write may be held in memory instead of being written now: changes to rows that exist (an entry or a
   * root that is there already). A new key, a removed key or a new collection is written at once. null: not all of it may.
   */
  function heldLayer(writes: readonly CollectionWrite[]): { roots: [string, Held | undefined][]; entries: [string, Held | undefined][] } | null {
    const out: { roots: [string, Held | undefined][]; entries: [string, Held | undefined][] } = { roots: [], entries: [] };
    for (const write of writes) {
      if (write.removed) return null;
      if (write.root) {
        const text = write.root.text, stored = write.root.stored, key = `root:${write.coll}`;
        if (stored === undefined) return null;
        if (text !== (held.collections.get(key)?.text ?? stored)) out.roots.push([key, text === stored ? undefined : { text, stored }]);
      }
      for (const map of write.maps) {
        if (map.deletes.length) return null;
        for (const put of map.puts) {
          if (put.stored === undefined) return null;
          const key = heldKey(write.coll, map.id, put.key);
          if (put.text !== (held.entries.get(key)?.text ?? put.stored)) out.entries.push([key, put.text === put.stored ? undefined : { text: put.text, stored: put.stored }]);
        }
      }
    }
    return out;
  }
  /** What a held change to an entry writes, when the flush comes. */
  function writeHeldEntries(): number {
    let wrote = 0;
    for (const key of [...held.entries.keys()]) {
      const [coll, id, entry] = JSON.parse(key) as [string, string, string];
      const stored = storedEntry(coll, id, entry), text = heldText(held.entries, key, stored);
      if (text === undefined || stored === undefined) continue;
      putEntry(coll, id, entry, text, JSON.parse(text) as unknown, null, stored.length > chunk); wrote += 1;
    }
    return wrote;
  }
  // ---- which layout is the truth ------------------------------------------------------------------------------------------
  const metaGet = (key: string): string | undefined => sql.exec<{ value: string }>('SELECT value FROM store_meta WHERE key = ?', key).toArray()[0]?.value;
  const metaPut = (key: string, value: string): void => { sql.exec('INSERT INTO store_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value); };
  let layout: StoreLayout = wantedLayout;
  const storedLayout = parseLayout(metaGet('layout'));
  if (storedLayout) layout = storedLayout;
  /** The collections whose rows in `entries` hold everything the legacy value holds (and are kept so while the layout is `entries`). */
  const synced = new Set<string>(sql.exec<{ key: string }>("SELECT key FROM store_meta WHERE key LIKE 'synced:%'").toArray().map(row => row.key.slice(7)));
  // The entry rows are only kept up to date while the layout is `entries`: after any other start they may be old.
  if (layout === 'legacy' && synced.size) { sql.exec("DELETE FROM store_meta WHERE key LIKE 'synced:%'"); synced.clear(); }
  /** Is this collection read and written per entry now? */
  const isLayered = (name: string): boolean => layout === 'entries' && synced.has(name) && isKeyedCollection(name);
  const migrationErrors = new Map<string, string>();
  /**
   * Make a collection's entry rows from its legacy value, in ONE SQLite transaction, and read them back: the rows put
   * together again must be the legacy text to the character. Anything else rolls the whole step back and leaves the
   * collection as it was (legacy). The legacy rows are never touched.
   */
  function backfill(coll: string): { entries: number; rows: number; ms: number } {
    const began = Date.now();
    let entries = 0, rows = 0;
    storage.transactionSync(() => {
      sql.exec('DELETE FROM entries WHERE coll = ?', coll);
      sql.exec('DELETE FROM collection_parts WHERE name >= ? AND name < ?', `entry:${coll}\u0000`, `entry:${coll}\u0001`);
      sql.exec('DELETE FROM collections WHERE name = ?', `root:${coll}`); sql.exec('DELETE FROM collection_parts WHERE name = ?', `root:${coll}`);
      const legacy = collectionText(coll);
      if (legacy !== undefined) {
        const split = splitText(coll, legacy);
        writeCollection(`root:${coll}`, split.rootText); rows += 1;
        for (const map of split.maps) {
          let ord = 0;
          const wantsProjection = specOf(coll, map.id)?.project !== undefined;
          for (const [key, text] of map.entries) { ord += 1; putEntry(coll, map.id, key, text, wantsProjection ? JSON.parse(text) as unknown : undefined, ord, false); entries += 1; rows += 2; }
        }
        const back = collectionText(`root:${coll}`);
        const rebuilt = back === undefined ? undefined : assembleText(back, (id) => sql.exec<{ key: string; value: string }>('SELECT key, value FROM entries WHERE coll = ? AND map = ? ORDER BY ord', coll, id).toArray().map((row): [string, string] => [row.key, entryText(coll, id, row.key, row.value)]));
        if (rebuilt !== legacy) throw new Error(`The entries of ${coll} do not read back as the stored value`);
        const count = Number(sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM entries WHERE coll = ?', coll).toArray()[0]?.n ?? 0);
        if (count !== entries) throw new Error(`The entries of ${coll} number ${count}, not ${entries}`);
      }
      metaPut(`synced:${coll}`, JSON.stringify({ at: Date.now(), entries }));
    });
    synced.add(coll);
    return { entries, rows, ms: Date.now() - began };
  }
  // ---- shadow: the legacy value is the truth, the entry rows follow it ------------------------------------------------------
  const shadow = { mismatches: 0, checks: 0, errors: 0, first: [] as string[], applied: 0 };
  let sampleEvery = Math.max(1, Math.floor(shadowSample));
  /** Write a legacy collection value; when the layout is `shadow` the entry rows are brought to the same state in the same SQLite transaction. */
  function writeLegacy(name: string, text: string, old: string | undefined): void {
    const shadowed = layout === 'shadow' && synced.has(name) && isKeyedCollection(name);
    // A value written over one this transaction never read (a collection made fresh) is compared with what is stored.
    const before = shadowed ? (old ?? collectionText(name)) : undefined;
    writeCollection(name, text);
    if (!shadowed) return;
    try { shadowApply(name, before, text); shadow.applied += 1; }
    catch (error) {
      // The entry rows are only a copy: whatever went wrong, the player's write stands, and the copy is rebuilt (backfill) at the next start.
      shadow.errors += 1; synced.delete(name); sql.exec('DELETE FROM store_meta WHERE key = ?', `synced:${name}`); migrationErrors.set(name, `shadow write failed: ${error instanceof Error ? error.message : String(error)}`);
      log(`Store: the entry copy of ${name} stopped being kept and will be made again: ${migrationErrors.get(name)}`);
    }
  }
  /** Bring the entry rows of a collection from the state of `old` to the state of `text` (both legacy texts): only the entries that differ are written. */
  function shadowApply(coll: string, old: string | undefined, text: string): void {
    const before = old === undefined ? null : splitText(coll, old), after = splitText(coll, text);
    const writes: CollectionWrite = { coll, root: before && before.rootText === after.rootText ? null : { text: after.rootText, stored: before?.rootText }, removed: false, maps: [] };
    const beforeMaps = new Map((before?.maps ?? []).map(map => [map.id, new Map(map.entries)]));
    for (const map of after.maps) {
      const was = beforeMaps.get(map.id) ?? new Map<string, string>(), now = new Map(map.entries), wantsProjection = specOf(coll, map.id)?.project !== undefined;
      const deletes: string[] = [], puts: CollectionWrite['maps'][number]['puts'] = [];
      for (const key of was.keys()) if (!now.has(key)) deletes.push(key);
      // Entries keep their place while the keys both states have come in the same order; from the first that does not, entries are taken out and put again.
      const kept = [...was.keys()].filter(key => now.has(key)), order = [...now.keys()];
      let same = 0;
      while (same < kept.length && same < order.length && kept[same] === order[same]) same += 1;
      const again = new Set(order.slice(same).filter(key => was.has(key)));
      for (const key of again) deletes.push(key);
      for (const [key, value] of now) {
        const stored = was.has(key) && !again.has(key) ? was.get(key) : undefined;
        if (value !== stored) puts.push({ key, text: value, stored, value: wantsProjection ? JSON.parse(value) as unknown : undefined });
      }
      beforeMaps.delete(map.id);
      if (deletes.length || puts.length) writes.maps.push({ id: map.id, puts, deletes });
    }
    for (const [id, was] of beforeMaps) writes.maps.push({ id, puts: [], deletes: [...was.keys()] });
    if (writes.root || writes.maps.length) writeLayer([writes]);
  }
  /** Does the entry copy of a collection hold exactly what its legacy text holds? Answers what differs (at most a few lines). */
  function shadowDiff(coll: string, legacy: string | undefined): string[] {
    const lines: string[] = [];
    const root = collectionText(`root:${coll}`);
    if (legacy === undefined) return root === undefined ? lines : [`${coll}: entries exist but the collection does not`];
    const split = splitText(coll, legacy);
    if (root !== split.rootText) lines.push(`${coll}: the root differs`);
    const ids = new Set(split.maps.map(map => map.id));
    for (const map of split.maps) {
      const keys = entrySource.keys(coll, map.id);
      if (keys.length !== map.entries.length) lines.push(`${coll}/${map.id}: ${keys.length} entries stored, ${map.entries.length} expected`);
      map.entries.forEach(([key, text], at) => {
        if (lines.length >= 10) return;
        if (keys[at] !== key) { lines.push(`${coll}/${map.id}: key ${at} is not ${key}`); return; }
        if (storedEntry(coll, map.id, key) !== text) lines.push(`${coll}/${map.id}/${key}: differs`);
      });
    }
    for (const row of sql.exec<{ map: string }>('SELECT DISTINCT map FROM entries WHERE coll = ?', coll).toArray()) if (!ids.has(row.map)) lines.push(`${coll}/${row.map}: stored but not in the collection`);
    return lines.slice(0, 10);
  }
  /** In shadow mode, now and then: read back the entry copy of a collection this transaction loaded and compare it with the legacy text it was read as. */
  function sampleCheck(coll: string, stored: string | undefined): void {
    if (layout !== 'shadow' || !synced.has(coll)) return;
    shadow.checks += 1;
    if (shadow.checks % sampleEvery !== 0) return;
    try {
      const lines = shadowDiff(coll, stored);
      if (lines.length) { shadow.mismatches += 1; for (const line of lines) if (shadow.first.length < 20) shadow.first.push(line); log(`Store: the entry copy of ${coll} differs from the stored value (${lines[0]})`); }
    } catch (error) { shadow.errors += 1; log(`Store: comparing the entry copy of ${coll} failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  /** Before a transaction runs: bring every collection the layout asks for into it. A failure leaves that collection legacy and is tried again at the next start. */
  function prepare(): void {
    if (layout === 'legacy') return;
    for (const coll of Object.keys(KEYED_SPECS)) {
      if (synced.has(coll) || migrationErrors.has(coll)) continue;
      if (!isKeyedCollection(coll)) continue;
      try {
        if (holding()) writeHeld();
        const result = backfill(coll);
        log(`Store: ${coll} now kept per entry (${result.entries} entries, ${result.ms} ms)`);
      } catch (error) {
        migrationErrors.set(coll, error instanceof Error ? error.message : String(error));
        log(`Store: ${coll} could not be moved to per-entry storage and stays as it was: ${migrationErrors.get(coll)}`);
      }
    }
  }
  /** Write one session row. One that exists under the same public id is updated by its key, so no index entry is rewritten. */
  function writeSession(key: string, publicId: string, expiresAt: number, value: string, samePublicId: boolean): void {
    if (samePublicId) sql.exec('UPDATE sessions SET expires_at=?, value=? WHERE secret=?', expiresAt, value, key);
    else sql.exec('INSERT INTO sessions(secret,public_id,expires_at,value) VALUES(?,?,?,?) ON CONFLICT(secret) DO UPDATE SET public_id=excluded.public_id,expires_at=excluded.expires_at,value=excluded.value', key, publicId, expiresAt, value);
  }
  /** The stored columns of a session's text (a held change is written without the record it came from). */
  const sessionColumns = (value: string): { publicId: string; expiresAt: number } => { const record = JSON.parse(value) as SessionRecord; return { publicId: record.publicId, expiresAt: record.expiresAt }; };
  /** Write everything that is held, in one transaction. Runs in the store's queue (flush). A failure keeps what is held for the next attempt. */
  function writeHeld(): number {
    let wrote = 0;
    storage.transactionSync(() => {
      for (const key of [...held.sessions.keys()]) {
        const text = heldText(held.sessions, key, sql.exec<{ value: string }>('SELECT value FROM sessions WHERE secret = ?', key).toArray()[0]?.value);
        if (text === undefined) continue;
        const columns = sessionColumns(text); writeSession(key, columns.publicId, columns.expiresAt, text, true); wrote += 1;
      }
      for (const key of [...held.collections.keys()]) { const text = heldText(held.collections, key, collectionText(key)); if (text !== undefined) { writeLegacy(key, text, collectionText(key)); wrote += 1; } }
      wrote += writeHeldEntries();
    });
    held.sessions.clear(); held.collections.clear(); held.entries.clear();
    return wrote;
  }
  /**
   * The held text of a row, given what the row holds now. A held change was made from one stored text and is only good
   * on top of that text: when the row holds something else (it was written by other means), the held change is dropped.
   */
  function heldText(map: Map<string, Held>, key: string, stored: string | undefined): string | undefined {
    const change = map.get(key);
    if (!change) return undefined;
    if (change.stored === stored) return change.text;
    map.delete(key);
    return undefined;
  }
  const holding = (): boolean => held.sessions.size > 0 || held.collections.size > 0 || held.entries.size > 0;

  function view(): { db: Db; commit: (lazy: boolean) => number } {
    const sessions: Cache<SessionRecord> = new Map(), archives: Cache<unknown> = new Map(), collections: Cache<unknown> = new Map();
    const accounts: Cache<AccountRecord> = new Map(), devices: Cache<AccountDeviceRecord> = new Map();
    /** The collections of server/keyed.ts that this store keeps per entry (STORE_LAYOUT), as this transaction sees them. */
    const layer = new Layer(entrySource);
    /** A map whose keys are read from a table on demand; `cache` holds what this transaction read or wrote (undefined = removed). */
    function lazyMap<T>(cache: Cache<T>, keys: () => string[], load: (key: string) => T | undefined): Record<string, T | undefined> {
      let known: Set<string> | undefined;
      const storedKeys = (): Set<string> => known ??= new Set(keys());
      const handler: ProxyHandler<Record<string, T | undefined>> = {
        get(_, key) { if (typeof key !== 'string') return undefined; if (!cache.has(key)) cache.set(key, load(key)); return cache.get(key); },
        set(_, key, value: T | undefined) { if (typeof key !== 'string') throw Error('invalid_store_key'); cache.set(key, value); return true; },
        deleteProperty(_, key) { cache.set(key as string, undefined); return true; },
        ownKeys() { return [...new Set([...storedKeys(), ...cache.keys()])].filter(key => !cache.has(key) || cache.get(key) !== undefined); },
        // The descriptor READS NOTHING: its value is fetched when somebody asks for it. Listing or counting the keys of a table
        // (`Object.keys(db.sessions).length`) asks for every key's descriptor, and must not read and parse every record to answer.
        getOwnPropertyDescriptor(target, key) { if ((cache.has(key as string) && cache.get(key as string) !== undefined) || (!cache.has(key as string) && storedKeys().has(key as string))) return { enumerable: true, configurable: true, get: () => handler.get?.(target, key, target) as T | undefined, set: (value: T | undefined) => { cache.set(key as string, value); } }; return undefined; },
        has(_, key) { return cache.has(key as string) ? cache.get(key as string) !== undefined : storedKeys().has(key as string); },
      };
      return new Proxy(Object.create(null) as Record<string, T | undefined>, handler);
    }
    /** One kind of receipt (a table keyed by sender and id) as lazy maps per player. `legacy`: receipts found inline in a session record. */
    function receiptTable<R extends ReceiptRecord>(table: string, idColumn: string) {
      const entries = new Map<string, ReceiptEntry<R>>();
      return {
        entries,
        of(publicId: string, legacy: Record<string, R> = {}): ReceiptMap<R> {
          let entry = entries.get(publicId);
          if (!entry) {
            const cache: Cache<R> = new Map(Object.entries(legacy)), original = new Map<string, string | undefined>();
            // LISTING a player's receipts (the shared code does, to drop the expired ones and to count the rest) reads them all
            // with this ONE statement. Read one at a time as they are walked, a player holding thousands of receipts would
            // cost thousands of statements on every action they send.
            const map = lazyMap<R>(cache,
              () => sql.exec<{ id: string; value: string }>(`SELECT ${idColumn} AS id, value FROM ${table} WHERE sender = ?`, publicId).toArray().map((row) => {
                if (!cache.has(row.id)) { original.set(row.id, row.value); cache.set(row.id, JSON.parse(row.value) as R); }
                return row.id;
              }),
              key => { const row = sql.exec<{ value: string }>(`SELECT value FROM ${table} WHERE sender = ? AND ${idColumn} = ?`, publicId, key).toArray()[0]; original.set(key, row?.value); return row ? JSON.parse(row.value) as R : undefined; });
            entry = { cache, original, map }; entries.set(publicId, entry);
          }
          return entry.map as ReceiptMap<R>;
        },
      };
    }
    const actions = receiptTable<ActionReceipt>('action_receipts', 'action_id'), once = receiptTable<OnceReceipt>('once_receipts', 'id');
    const originals = { sessions: new Map<string, string | undefined>(), archives: new Map<string, string | undefined>(), collections: new Map<string, string | undefined>(),
      accounts: new Map<string, string | undefined>(), devices: new Map<string, string | undefined>() };
    /** The public id each session was loaded with: a row whose public id did not change is updated without touching that index. */
    const loadedPublicIds = new Map<string, string>();
    const sessionMap = lazyMap<SessionRecord>(sessions, () => sql.exec<{ secret: string }>('SELECT secret FROM sessions').toArray().map(row => row.secret), key => {
      const row = sql.exec<{ value: string }>('SELECT value FROM sessions WHERE secret = ?', key).toArray()[0]; originals.sessions.set(key, row?.value);
      if (!row) return undefined;
      // A held change is the session as it is now; `originals` stays what the row holds, so a durable commit writes it.
      const session = JSON.parse(heldText(held.sessions, key, row.value) ?? row.value) as SessionRecord;
      loadedPublicIds.set(key, session.publicId);
      session.actions = actions.of(session.publicId, session.actions || {});
      session.once = once.of(session.publicId, session.once || {});
      return session;
    });
    const archiveMap = lazyMap<unknown>(archives, () => sql.exec<{ public_id: string }>('SELECT public_id FROM archived_lives').toArray().map(row => row.public_id), key => {
      const row = sql.exec<{ value: string }>('SELECT value FROM archived_lives WHERE public_id = ?', key).toArray()[0]; originals.archives.set(key, row?.value); return row ? JSON.parse(row.value) as unknown : undefined;
    });
    const accountMap = lazyMap<AccountRecord>(accounts, () => sql.exec<{ id: string }>('SELECT id FROM accounts').toArray().map(row => row.id), key => {
      const row = sql.exec<{ value: string }>('SELECT value FROM accounts WHERE id = ?', key).toArray()[0]; originals.accounts.set(key, row?.value); return row ? JSON.parse(row.value) as AccountRecord : undefined;
    });
    const deviceMap = lazyMap<AccountDeviceRecord>(devices, () => sql.exec<{ secret: string }>('SELECT secret FROM account_devices').toArray().map(row => row.secret), key => {
      const row = sql.exec<{ value: string }>('SELECT value FROM account_devices WHERE secret = ?', key).toArray()[0]; originals.devices.set(key, row?.value); return row ? JSON.parse(row.value) as AccountDeviceRecord : undefined;
    });
    /** A feature collection, read from its row the first time this transaction asks for it (undefined: it does not exist). */
    function collectionOf(key: string): unknown {
      if (isLayered(key)) return layer.get(key);
      if (!collections.has(key)) {
        const stored = collectionText(key), text = heldText(held.collections, key, stored) ?? stored;
        originals.collections.set(key, stored); collections.set(key, text === undefined ? undefined : JSON.parse(text) as unknown);
        if (isKeyedCollection(key)) sampleCheck(key, stored);
      }
      return collections.get(key);
    }
    const helpers: StoreHelpers = {
      // What this transaction has already read, changed, added or removed is scanned as the draft holds it.
      scanSessions: predicate => {
        const keys: string[] = [], seen = new Set<string>();
        for (const row of sql.exec<{ secret: string; value: string }>('SELECT secret,value FROM sessions').toArray()) {
          seen.add(row.secret);
          if (sessions.has(row.secret)) { const held = sessions.get(row.secret); if (held !== undefined && predicate(held, row.secret)) keys.push(row.secret); }
          else if (predicate(JSON.parse(heldText(held.sessions, row.secret, row.value) ?? row.value) as SessionRecord, row.secret)) keys.push(row.secret);
        }
        for (const [key, held] of sessions) if (!seen.has(key) && held !== undefined && predicate(held, key)) keys.push(key);
        return keys;
      },
      // Found by the stored expiry, so a sweep reads the records that have run out and no others (scanSessions reads and
      // parses every one). A row whose expiry a held change or this transaction has pushed out is not expired: each
      // candidate is judged as the draft holds it.
      expiredSessionKeys: now => {
        const keys: string[] = [], seen = new Set<string>();
        for (const row of sql.exec<{ secret: string }>('SELECT secret FROM sessions WHERE expires_at <= ?', now).toArray()) {
          seen.add(row.secret);
          const session = sessionMap[row.secret];
          if (session !== undefined && !(session.expiresAt > now)) keys.push(row.secret);
        }
        for (const [key, session] of sessions) if (!seen.has(key) && session !== undefined && !(session.expiresAt > now)) keys.push(key);
        return keys;
      },
      sessionKeyByPublicId: publicId => {
        for (const [key, session] of sessions) if (session?.publicId === publicId) return key;
        return sql.exec<{ secret: string }>('SELECT secret FROM sessions WHERE public_id = ?', publicId).toArray()[0]?.secret;
      },
      onceCounts: (liveSince, lightKinds = []) => {
        const sum = { money: 0, light: 0 };
        for (const row of sql.exec<{ kind: string; n: number }>('SELECT kind, COUNT(*) AS n FROM once_receipts WHERE at >= ? GROUP BY kind', liveSince).toArray()) sum[lightKinds.includes(row.kind) ? 'light' : 'money'] += Number(row.n);
        return sum;
      },
    };
    const base: Record<string, unknown> = { version: 1, sessions: sessionMap, archivedLives: archiveMap, accounts: accountMap, accountDevices: deviceMap };
    const db = new Proxy(base, {
      get(target, key) {
        if (key === '$store') return helpers;
        if (Object.hasOwn(target, key)) return target[key as string];
        return typeof key === 'string' ? collectionOf(key) : undefined;
      },
      set(target, key, value: unknown) { if (Object.hasOwn(target, key)) target[key as string] = value; else if (isLayered(key as string)) layer.set(key as string, value); else collections.set(key as string, value); return true; },
      // A collection that exists is the document's OWN property, exactly as on Node (protocol.js collection() asks).
      has(target, key) { return Object.hasOwn(target, key) || (typeof key === 'string' && key !== '$store' && collectionOf(key) !== undefined); },
      getOwnPropertyDescriptor(target, key) {
        if (Object.hasOwn(target, key)) return Reflect.getOwnPropertyDescriptor(target, key);
        const value = typeof key === 'string' && key !== '$store' ? collectionOf(key) : undefined;
        return value === undefined ? undefined : { enumerable: true, configurable: true, writable: true, value };
      },
    }) as unknown as Db;
    /**
     * What a lazy transaction changed, when all of it may be held in memory: only sessions and collections that are
     * stored already, each under the key (and public id) it has. null: something else changed — the commit is durable.
     */
    function heldChanges(texts: Map<string, string>): { sessions: [string, Held | undefined][]; collections: [string, Held | undefined][] } | null {
      const out: { sessions: [string, Held | undefined][]; collections: [string, Held | undefined][] } = { sessions: [], collections: [] };
      /** Read and found missing: nothing to remove. Anything else that is undefined is a removal. */
      const absent = (original: Map<string, string | undefined>, key: string): boolean => original.has(key) && original.get(key) === undefined;
      for (const [key, session] of sessions) {
        const stored = originals.sessions.get(key);
        if (session === undefined) { if (stored !== undefined || !originals.sessions.has(key)) return null; continue; }
        const text = texts.get(key) as string;
        if (text === (held.sessions.get(key)?.text ?? stored)) continue;
        if (stored === undefined || loadedPublicIds.get(key) !== session.publicId) return null;
        out.sessions.push([key, text === stored ? undefined : { text, stored }]);
      }
      for (const table of [actions, once]) for (const entry of table.entries.values()) for (const [id, receipt] of entry.cache) {
        if (receipt === undefined ? !absent(entry.original, id) : JSON.stringify(receipt) !== entry.original.get(id)) return null;
      }
      for (const [cache, original] of [[archives, originals.archives], [accounts, originals.accounts], [devices, originals.devices]] as const) for (const [key, item] of cache) {
        if (item === undefined ? !absent(original, key) : JSON.stringify(item) !== original.get(key)) return null;
      }
      for (const [key, item] of collections) {
        if (item === undefined) continue;
        const stored = originals.collections.get(key), text = JSON.stringify(item);
        if (text === (held.collections.get(key)?.text ?? stored)) continue;
        if (stored === undefined) return null;
        out.collections.push([key, text === stored ? undefined : { text, stored }]);
      }
      return out;
    }
    /** Write what this transaction changed. `lazy`: hold it in memory instead, when all of it may be held (answers 0: nothing was written). */
    function commit(lazy: boolean): number {
      beforeCommit?.();
      // Each session's text, without its receipts. Receipts a route put on a session it has just made (plain objects) join the tables too.
      const texts = new Map<string, string>();
      for (const [key, session] of sessions) {
        if (session === undefined) continue;
        if (!actions.entries.has(session.publicId)) actions.of(session.publicId, session.actions || {});
        if (!once.entries.has(session.publicId)) once.of(session.publicId, session.once || {});
        const { actions: ignoredActions, once: ignoredOnce, ...record } = session;
        texts.set(key, JSON.stringify(record));
      }
      // A transaction that changed nothing writes nothing, whatever it read. One that changed something durably writes
      // that, and with it the held change of every session and collection it read: what it decided may rest on them.
      const layered = layer.changes(), softLayer = heldLayer(layered), soft = softLayer ? heldChanges(texts) : null;
      if (soft && softLayer && soft.sessions.length === 0 && soft.collections.length === 0 && softLayer.roots.length === 0 && softLayer.entries.length === 0) return 0;
      if (soft && softLayer && lazy) {
        for (const [key, change] of soft.sessions) { if (change) held.sessions.set(key, change); else held.sessions.delete(key); }
        for (const [key, change] of soft.collections) { if (change) held.collections.set(key, change); else held.collections.delete(key); }
        for (const [key, change] of softLayer.roots) { if (change) held.collections.set(key, change); else held.collections.delete(key); }
        for (const [key, change] of softLayer.entries) { if (change) held.entries.set(key, change); else held.entries.delete(key); }
        return 0;
      }
      let wrote = 0;
      storage.transactionSync(() => {
        for (const [key, session] of sessions) {
          if (session === undefined) { if (originals.sessions.get(key) !== undefined) { sql.exec('DELETE FROM sessions WHERE secret = ?', key); wrote += 1; } continue; }
          const value = texts.get(key) as string, stored = originals.sessions.get(key);
          if (value !== stored) { writeSession(key, session.publicId, session.expiresAt, value, stored !== undefined && loadedPublicIds.get(key) === session.publicId); wrote += 1; }
        }
        for (const [publicId, entry] of actions.entries) for (const [id, receipt] of entry.cache) {
          if (receipt === undefined) { sql.exec('DELETE FROM action_receipts WHERE sender = ? AND action_id = ?', publicId, id); wrote += 1; }
          else { const value = JSON.stringify(receipt); if (value !== entry.original.get(id)) { sql.exec('INSERT INTO action_receipts(sender,action_id,action_at,value) VALUES(?,?,?,?) ON CONFLICT(sender,action_id) DO UPDATE SET action_at=excluded.action_at,value=excluded.value', publicId, id, receipt.actionAt as SqlBinding, value); wrote += 1; } }
        }
        for (const [publicId, entry] of once.entries) for (const [id, receipt] of entry.cache) {
          if (receipt === undefined) { sql.exec('DELETE FROM once_receipts WHERE sender = ? AND id = ?', publicId, id); wrote += 1; }
          else { const value = JSON.stringify(receipt); if (value !== entry.original.get(id)) { sql.exec('INSERT INTO once_receipts(sender,id,at,kind,value) VALUES(?,?,?,?,?) ON CONFLICT(sender,id) DO UPDATE SET at=excluded.at,kind=excluded.kind,value=excluded.value', publicId, id, Number(receipt.at) || 0, String(receipt.kind ?? ''), value); wrote += 1; } }
        }
        for (const [key, item] of archives) {
          if (item === undefined) { sql.exec('DELETE FROM archived_lives WHERE public_id = ?', key); wrote += 1; }
          else { const value = JSON.stringify(item); if (value !== originals.archives.get(key)) { sql.exec('INSERT INTO archived_lives(public_id,value) VALUES(?,?) ON CONFLICT(public_id) DO UPDATE SET value=excluded.value', key, value); wrote += 1; } }
        }
        for (const [key, account] of accounts) {
          // Removed without having been read first is still removed: the delete does not depend on what this transaction loaded.
          if (account === undefined) { sql.exec('DELETE FROM accounts WHERE id = ?', key); wrote += 1; continue; }
          const value = JSON.stringify(account);
          if (value !== originals.accounts.get(key)) { sql.exec('INSERT INTO accounts(id,public_id,value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET public_id=excluded.public_id,value=excluded.value', key, account.publicId ?? null, value); wrote += 1; }
        }
        for (const [key, device] of devices) {
          if (device === undefined) { sql.exec('DELETE FROM account_devices WHERE secret = ?', key); wrote += 1; continue; }
          const value = JSON.stringify(device), stored = originals.devices.get(key);
          if (value === stored) continue;
          // A binding that stays with its account is updated by its key: the index by account is not rewritten.
          if (stored !== undefined && (JSON.parse(stored) as AccountDeviceRecord).account === device.account) sql.exec('UPDATE account_devices SET expires_at=?, value=? WHERE secret=?', Number(device.expiresAt) || 0, value, key);
          else sql.exec('INSERT INTO account_devices(secret,account_id,expires_at,value) VALUES(?,?,?,?) ON CONFLICT(secret) DO UPDATE SET account_id=excluded.account_id,expires_at=excluded.expires_at,value=excluded.value', key, device.account, Number(device.expiresAt) || 0, value);
          wrote += 1;
        }
        for (const [key, item] of collections) {
          if (item === undefined) continue;
          const value = JSON.stringify(item); if (value !== originals.collections.get(key)) { writeLegacy(key, value, originals.collections.get(key)); wrote += 1; }
        }
        wrote += writeLayer(layered);
      });
      // What this transaction held of a session or a collection is what is stored now: nothing of theirs is left to write.
      for (const key of sessions.keys()) held.sessions.delete(key);
      for (const [key, item] of collections) if (item !== undefined) held.collections.delete(key);
      for (const write of layered) {
        if (write.root || write.removed) held.collections.delete(`root:${write.coll}`);
        for (const map of write.maps) { for (const put of map.puts) held.entries.delete(heldKey(write.coll, map.id, put.key)); for (const key of map.deletes) held.entries.delete(heldKey(write.coll, map.id, key)); }
      }
      return wrote;
    }
    return { db, commit };
  }
  /**
   * Write what is held, some time from now. The timer also keeps the object in memory until it has run, so nothing held
   * is lost to a sleep; with nothing left to write there is no timer, and the object may sleep.
   */
  function scheduleFlush(): void {
    if (!holding() || lazyFlushMs <= 0) { if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; } return; }
    if (flushTimer === null) flushTimer = setTimeout(() => { flushTimer = null; void flush().catch(() => {}).then(scheduleFlush); }, lazyFlushMs);
  }
  /** Everything held is written and durable when this resolves. A failed write keeps what is held; a failed barrier is uncertain, as for any commit. */
  function flush(): Promise<void> {
    const operation = serial.then(async (): Promise<void> => {
      if (!holding()) { scheduleFlush(); return; }
      if (failed) throw toStorageError(new Error('The durability of an earlier write is unknown'));
      try { writeHeld(); } catch (error) { stats.writeFailures += 1; throw toStorageError(error); } finally { scheduleFlush(); }
      stats.writes += 1;
      try { await barrier(); } catch (error) { failed = true; stats.writeFailures += 1; throw toStorageError(error); }
    });
    serial = operation.catch(() => {});
    return operation;
  }
  function run<T>(fn: (db: Db) => T | Promise<T>, options: TransactOptions<T> | null | undefined, write: boolean): Promise<T> {
    const operation = serial.then(async (): Promise<T> => {
      if (failed) throw toStorageError(new Error('The durability of an earlier write is unknown'));
      try { prepare(); } catch (error) { stats.writeFailures += 1; throw toStorageError(error); }
      const draft = view();
      let result: T;
      // `executing` is true only while THIS store's callback runs, so a watcher can tell whose transaction announced a life.
      executing = true;
      try { result = await fn(draft.db); } catch (error) { if (write) stats.aborted += 1; throw error; } finally { executing = false; }
      if (write) {
        stats.transactions += 1;
        // `durable` may be a function of the result, as on Node: a poll that completed something is durable, a quiet one is lazy.
        const lazy = lazyFlushMs > 0 && options != null && (typeof options.durable === 'function' ? options.durable(result) === false : options.durable === false);
        let wrote: number;
        // A commit that fails wrote nothing (one SQLite transaction): the caller is told so in the store's own words.
        try { wrote = draft.commit(lazy); } catch (error) { stats.writeFailures += 1; throw toStorageError(error); }
        if (wrote) {
          stats.writes += 1;
          // Every acknowledgement is durable. A failed barrier is uncertain: fail closed until restart.
          try { await barrier(); } catch (error) { failed = true; stats.writeFailures += 1; throw toStorageError(error); }
        } else if (lazy) stats.lazy += 1;
        scheduleFlush();
        options?.committed?.(result);
      } else stats.reads += 1;
      return result;
    });
    serial = operation.catch(() => {});
    return operation;
  }
  // ---- the operator's tools (server/routes/storage-mod.ts) -------------------------------------------------------------------
  const keyedNames = (): string[] => Object.keys(KEYED_SPECS);
  const legacyRow = (name: string): boolean => sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM collections WHERE name = ?', name).toArray()[0]?.n === 1;
  const entryCount = (coll: string): number => Number(sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM entries WHERE coll = ?', coll).toArray()[0]?.n ?? 0);
  const metaNumber = (key: string): number | null => { const value = metaGet(key); return value === undefined ? null : Number(value); };
  function layoutStatus() {
    return {
      requested: layout, stored: metaGet('layout') ?? null, safetyDays: SAFETY_DAYS, cutoverAt: metaNumber('cutover'), safetyDroppedAt: metaNumber('safety-dropped'),
      shadow: { mismatches: shadow.mismatches, checks: shadow.checks, sampleEvery, errors: shadow.errors, applied: shadow.applied, first: shadow.first },
      collections: Object.fromEntries(keyedNames().map(name => [name, { mode: isLayered(name) ? 'entries' : 'legacy', synced: synced.has(name), legacyRow: legacyRow(name), entries: entryCount(name), error: migrationErrors.get(name) ?? null }])),
    };
  }
  /** Every layered collection's whole text as the entry rows hold it, or as the legacy value holds it. */
  function wholeText(coll: string, from: 'entries' | 'legacy'): string | undefined {
    if (from === 'legacy') return collectionText(coll);
    const root = collectionText(`root:${coll}`);
    return root === undefined ? undefined : assembleText(root, (id) => sql.exec<{ key: string; value: string }>('SELECT key, value FROM entries WHERE coll = ? AND map = ? ORDER BY ord', coll, id).toArray().map((row): [string, string] => [row.key, entryText(coll, id, row.key, row.value)]));
  }
  /** Compare every synced collection's entry rows with its legacy value. While `entries` is the layout the legacy value is the safety copy, so the answer says how far they have drifted apart. */
  function compare() {
    return Object.fromEntries(keyedNames().map(name => {
      const legacy = collectionText(name), entries = synced.has(name) ? wholeText(name, 'entries') : undefined;
      return [name, { synced: synced.has(name), legacy: legacy !== undefined, equal: synced.has(name) && legacy === entries, differences: synced.has(name) && legacy !== entries && layout !== 'entries' ? shadowDiff(name, legacy) : [], legacyChars: legacy?.length ?? 0, entryChars: entries?.length ?? 0 }];
    }));
  }
  /** Put the legacy value of every synced collection back in step with the entry rows (the way back from `entries`). */
  function reverse(): number {
    let wrote = 0;
    for (const name of keyedNames()) {
      if (!synced.has(name)) continue;
      const text = wholeText(name, 'entries');
      if (text === undefined) { if (legacyRow(name)) { sql.exec('DELETE FROM collections WHERE name = ?', name); sql.exec('DELETE FROM collection_parts WHERE name = ?', name); wrote += 1; } continue; }
      writeCollection(name, text); wrote += 1;
    }
    return wrote;
  }
  /** Run `fn` as one durable write. `own`: `fn` opens its own SQLite transaction. */
  async function commitTools<T>(fn: () => T, own = false): Promise<T> {
    let result: T;
    try { if (holding()) writeHeld(); result = own ? fn() : storage.transactionSync(fn); } catch (error) { stats.writeFailures += 1; throw toStorageError(error); }
    stats.writes += 1;
    try { await barrier(); } catch (error) { failed = true; throw toStorageError(error); }
    return result;
  }
  const refuse = (code: string, reason: string): Error => Object.assign(new Error(reason), { status: 409, code });
  async function setLayout(next: StoreLayout, force: boolean): Promise<ReturnType<typeof layoutStatus>> {
    if (next === layout) return layoutStatus();
    if (next !== 'legacy') for (const name of keyedNames()) if (!synced.has(name)) { migrationErrors.delete(name); try { await commitTools(() => backfill(name), true); } catch (error) { throw refuse('migration_failed', `${name}: ${error instanceof Error ? error.message : String(error)}`); } }
    if (next === 'entries') {
      if (layout === 'shadow' && !force && (shadow.mismatches > 0 || shadow.errors > 0)) throw refuse('shadow_mismatch', 'The entry copy has differed from the stored value. Look at the first differences in the status, or pass force.');
      if (layout !== 'entries') { const bad = keyedNames().flatMap(name => shadowDiff(name, collectionText(name))); if (bad.length) throw refuse('not_equal', `The entry copy does not equal the stored value: ${bad[0]}`); }
      await commitTools(() => { metaPut('layout', 'entries'); metaPut('cutover', String(Date.now())); sql.exec("DELETE FROM store_meta WHERE key = 'safety-dropped'"); });
      layout = 'entries'; shadow.mismatches = 0; shadow.first = [];
    } else {
      await commitTools(() => { if (layout === 'entries') reverse(); metaPut('layout', next); sql.exec("DELETE FROM store_meta WHERE key = 'cutover'"); if (next === 'legacy') sql.exec("DELETE FROM store_meta WHERE key LIKE 'synced:%'"); });
      if (next === 'legacy') synced.clear();
      layout = next;
    }
    return layoutStatus();
  }
  /** `drop`: delete the legacy rows (the safety copy) once the retention has passed (or `force`). `restore`: go back to the legacy rows as they were at the switch, losing what was written since. */
  async function safety(action: 'drop' | 'restore', force: boolean): Promise<ReturnType<typeof layoutStatus>> {
    if (layout !== 'entries') throw refuse('not_switched', 'The layout is not `entries`: there is no safety copy to drop or restore.');
    const since = metaNumber('cutover');
    if (action === 'drop') {
      if (!force && (since === null || Date.now() - since < SAFETY_DAYS * 86400000)) throw refuse('too_early', `The safety copy is kept ${SAFETY_DAYS} days from the switch.`);
      await commitTools(() => { for (const name of keyedNames()) { sql.exec('DELETE FROM collections WHERE name = ?', name); sql.exec('DELETE FROM collection_parts WHERE name = ?', name); } metaPut('safety-dropped', String(Date.now())); });
    } else {
      if (metaGet('safety-dropped') !== undefined) throw refuse('dropped', 'The safety copy was deleted.');
      await commitTools(() => { metaPut('layout', 'legacy'); sql.exec("DELETE FROM store_meta WHERE key IN ('cutover') OR key LIKE 'synced:%'"); });
      synced.clear(); layout = 'legacy';
    }
    return layoutStatus();
  }
  /** Run `fn` between transactions, never inside one. */
  function exclusive<T>(fn: () => T): Promise<T> { const operation = serial.then(() => { if (failed) throw toStorageError(new Error('The durability of an earlier write is unknown')); return fn(); }); serial = operation.catch(() => {}); return operation; }
  /** Every layered collection as a plain value, whichever way it is stored (held changes included). Reads every entry: for the operator and the tests. */
  function logical(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const coll of Object.keys(KEYED_SPECS)) {
      if (isLayered(coll)) { const root = entrySource.root(coll); if (root) out[coll] = JSON.parse(assembleText(root.text, (id) => entrySource.keys(coll, id).flatMap((key): [string, string][] => { const row = entrySource.entry(coll, id, key); return row ? [[key, row.text]] : []; }))); continue; }
      const stored = collectionText(coll), text = heldText(held.collections, coll, stored) ?? stored;
      if (text !== undefined) out[coll] = JSON.parse(text);
    }
    return out;
  }
  return {
    transact: (fn, options) => run(fn, options, true),
    read: fn => run(fn, null, false),
    executing: () => executing,
    stats: () => ({ mode: 'sqlite', failed, failing: failed, ...stats, held: held.sessions.size + held.collections.size + held.entries.size }),
    flush, close: flush,
    layout: {
      status: () => exclusive(layoutStatus),
      logical: () => exclusive(logical),
      migrate: (names) => exclusive(async () => { const done: Record<string, { entries: number; rows: number; ms: number }> = {}; for (const name of names ?? keyedNames()) { if (!isKeyedCollection(name)) throw refuse('unknown_collection', name); migrationErrors.delete(name); done[name] = await commitTools(() => backfill(name), true); } return done; }).then(r => r),
      compare: () => exclusive(compare),
      setLayout: (next, force = false) => exclusive(() => setLayout(next, force)).then(r => r),
      safety: (action, force = false) => exclusive(() => safety(action, force)).then(r => r),
      hashes: () => exclusive(() => Object.fromEntries(keyedNames().map(name => [name, hashOf(isLayered(name) ? wholeText(name, 'entries') : heldText(held.collections, name, collectionText(name)) ?? collectionText(name))]))),
    },
  };
}
