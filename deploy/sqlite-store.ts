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
}
/** A change held in memory: the text to store, and the text the row holds now. */
interface Held { text: string; stored: string }

/** server/protocol.ts storageError: { status: 503, code: 'storage_unavailable' } with the cause kept for the log. */
const toStorageError = storageError as (error: unknown) => Error;

type Cache<T> = Map<string, T | undefined>;
interface ReceiptEntry<R extends ReceiptRecord> { cache: Cache<R>; original: Map<string, string | undefined>; map: Record<string, R | undefined> }

export function createSqliteStore(storage: SqliteStorage, { beforeCommit, chunk = CHUNK, barrier = () => storage.sync(), lazyFlushMs = 0 }: SqliteStoreOptions = {}): SqliteStore {
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
  let serial: Promise<unknown> = Promise.resolve(), failed = false, executing = false;
  const stats = { transactions: 0, reads: 0, writes: 0, aborted: 0, writeFailures: 0, lazy: 0 };
  // Lazy changes not yet written (LAZY above): the newest text of a session or a collection, by key.
  const held = { sessions: new Map<string, Held>(), collections: new Map<string, Held>() };
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
  /** Store a collection's text. What is there is read first (reading is not a row written), and only what differs is written. */
  function writeCollection(name: string, text: string): void {
    const head = sql.exec<{ value: string }>('SELECT value FROM collections WHERE name = ?', name).toArray()[0]?.value;
    const old = new Map(sql.exec<{ part: number; value: string }>('SELECT part,value FROM collection_parts WHERE name = ?', name).toArray().map(row => [Number(row.part), row.value]));
    const putHead = (value: string): void => { if (value !== head) sql.exec('INSERT INTO collections(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value', name, value); };
    if (text.length <= chunk) { if (old.size) sql.exec('DELETE FROM collection_parts WHERE name = ?', name); putHead(text); return; }
    let parts = 0;
    for (let start = 0; start < text.length; start += chunk) {
      const value = text.slice(start, start + chunk);
      if (old.get(parts) !== value) sql.exec('INSERT INTO collection_parts(name,part,value) VALUES(?,?,?) ON CONFLICT(name,part) DO UPDATE SET value=excluded.value', name, parts, value);
      parts += 1;
    }
    if ([...old.keys()].some(part => part >= parts)) sql.exec('DELETE FROM collection_parts WHERE name = ? AND part >= ?', name, parts);
    putHead(`{"$parts":${parts}}`);
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
      for (const key of [...held.collections.keys()]) { const text = heldText(held.collections, key, collectionText(key)); if (text !== undefined) { writeCollection(key, text); wrote += 1; } }
    });
    held.sessions.clear(); held.collections.clear();
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
  const holding = (): boolean => held.sessions.size > 0 || held.collections.size > 0;

  function view(): { db: Db; commit: (lazy: boolean) => number } {
    const sessions: Cache<SessionRecord> = new Map(), archives: Cache<unknown> = new Map(), collections: Cache<unknown> = new Map();
    const accounts: Cache<AccountRecord> = new Map(), devices: Cache<AccountDeviceRecord> = new Map();
    /** A map whose keys are read from a table on demand; `cache` holds what this transaction read or wrote (undefined = removed). */
    function lazyMap<T>(cache: Cache<T>, keys: () => string[], load: (key: string) => T | undefined): Record<string, T | undefined> {
      let known: Set<string> | undefined;
      const storedKeys = (): Set<string> => known ??= new Set(keys());
      const handler: ProxyHandler<Record<string, T | undefined>> = {
        get(_, key) { if (typeof key !== 'string') return undefined; if (!cache.has(key)) cache.set(key, load(key)); return cache.get(key); },
        set(_, key, value: T | undefined) { if (typeof key !== 'string') throw Error('invalid_store_key'); cache.set(key, value); return true; },
        deleteProperty(_, key) { cache.set(key as string, undefined); return true; },
        ownKeys() { return [...new Set([...storedKeys(), ...cache.keys()])].filter(key => !cache.has(key) || cache.get(key) !== undefined); },
        getOwnPropertyDescriptor(target, key) { if ((cache.has(key as string) && cache.get(key as string) !== undefined) || (!cache.has(key as string) && storedKeys().has(key as string))) return { enumerable: true, configurable: true, writable: true, value: handler.get?.(target, key, target) }; return undefined; },
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
            const map = lazyMap<R>(cache,
              () => sql.exec<{ id: string }>(`SELECT ${idColumn} AS id FROM ${table} WHERE sender = ?`, publicId).toArray().map(row => row.id),
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
      if (!collections.has(key)) {
        const stored = collectionText(key), text = heldText(held.collections, key, stored) ?? stored;
        originals.collections.set(key, stored); collections.set(key, text === undefined ? undefined : JSON.parse(text) as unknown);
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
      set(target, key, value: unknown) { if (Object.hasOwn(target, key)) target[key as string] = value; else collections.set(key as string, value); return true; },
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
      const soft = heldChanges(texts);
      if (soft && soft.sessions.length === 0 && soft.collections.length === 0) return 0;
      if (soft && lazy) {
        for (const [key, change] of soft.sessions) { if (change) held.sessions.set(key, change); else held.sessions.delete(key); }
        for (const [key, change] of soft.collections) { if (change) held.collections.set(key, change); else held.collections.delete(key); }
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
          const value = JSON.stringify(item); if (value !== originals.collections.get(key)) { writeCollection(key, value); wrote += 1; }
        }
      });
      // What this transaction held of a session or a collection is what is stored now: nothing of theirs is left to write.
      for (const key of sessions.keys()) held.sessions.delete(key);
      for (const [key, item] of collections) if (item !== undefined) held.collections.delete(key);
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
  return {
    transact: (fn, options) => run(fn, options, true),
    read: fn => run(fn, null, false),
    executing: () => executing,
    stats: () => ({ mode: 'sqlite', failed, failing: failed, ...stats, held: held.sessions.size + held.collections.size }),
    flush, close: flush,
  };
}
