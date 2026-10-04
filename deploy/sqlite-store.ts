/**
 * THE MAIN STORE ON THE WORKER HOST: transaction-local views over the Durable Object's SQLite tables.
 * The same interface as server/store.js — transact(fn(db), { committed }?) and read(fn(db)) over one
 * document `{ version, sessions, archivedLives, <collections> }` — and the same guarantee:
 *
 *   A transaction whose promise REJECTS has no effect. Every callback gets a fresh draft; nothing a
 *   callback changed outlives it unless its commit — ONE synchronous SQLite transaction that writes the
 *   sessions, their receipts, the archives and the collections together — succeeded.
 *   A transaction whose promise RESOLVES is durable: the commit is followed by `storage.sync()` before
 *   `committed(result)` runs and before the caller is answered (`barrier`; the host passes its own so that the writes
 *   it makes while the object is starting — when nothing can be answered yet — do not wait on it). (Stronger than Node, where a poll that
 *   acknowledges nothing may be saved a moment later: `durable` and `waitForObserved` are accepted and
 *   every write is treated as durable.)
 *   A commit that fails is rejected as { status: 503, code: 'storage_unavailable' } with the cause kept
 *   for the log, never sent to a client. A failed durability barrier is an UNCERTAIN outcome: the store
 *   refuses everything until the object restarts (stats().failing), and a retry then meets the receipt
 *   if the commit had in fact been kept.
 *
 * WHERE THINGS LIVE
 *   sessions(secret, public_id, expires_at, value)   one row per device session, WITHOUT its receipts
 *   action_receipts(sender, action_id, action_at, value)   session.actions — exactly-once for game actions
 *   once_receipts(sender, id, at, kind, value)       session.once — exactly-once for every other write
 *                                                    (server/routes/once.js). Receipts are rows of their own so that
 *                                                    a player's thousands of receipts are never rewritten with their
 *                                                    life, and a session row stays far below SQLite's 2 MB row limit.
 *   archived_lives(public_id, value)
 *   collections(name, value) + collection_parts(name, part, value)   each feature collection as JSON; one larger
 *                                                    than CHUNK characters is split over rows of collection_parts.
 * Inside a transaction, `session.actions` and `session.once` are lazy maps over their tables: reading one id
 * reads one row, and only the receipts a transaction added, changed or removed are written.
 *
 * Extras for the host only: db.$store.scanSessions(predicate) → [secret] (records are read without receipts),
 * db.$store.sessionKeyByPublicId(id), db.$store.onceCounts(liveSince, lightKinds) → { money, light }.
 */
import { storageError } from '../server/protocol.js';
import type { SqlBinding, SqliteStorage } from './cf-types.ts';
import type { Draft, ReceiptRecord, SessionRecord, Store, StoreHelpers, TransactOptions } from './host-seam.ts';

/** The most characters of a collection kept in one row (a row may hold 2 MB; four bytes a character at worst). */
export const CHUNK = 400000;

export interface SqliteStoreOptions { beforeCommit?: () => void; chunk?: number; barrier?: () => Promise<void> }

/** server/protocol.js storageError: { status: 503, code: 'storage_unavailable' } with the cause kept for the log. */
const toStorageError = storageError as (error: unknown) => Error;

type Cache<T> = Map<string, T | undefined>;
interface ReceiptEntry { cache: Cache<ReceiptRecord>; original: Map<string, string | undefined>; map: Record<string, ReceiptRecord | undefined> }

export function createSqliteStore(storage: SqliteStorage, { beforeCommit, chunk = CHUNK, barrier = () => storage.sync() }: SqliteStoreOptions = {}): Store {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS sessions (secret TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS archived_lives (public_id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS action_receipts (sender TEXT NOT NULL, action_id TEXT NOT NULL, action_at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,action_id))');
  sql.exec('CREATE INDEX IF NOT EXISTS action_expiry ON action_receipts(action_at)');
  sql.exec('CREATE TABLE IF NOT EXISTS once_receipts (sender TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,id))');
  sql.exec('CREATE INDEX IF NOT EXISTS once_expiry ON once_receipts(at)');
  sql.exec('CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS collection_parts (name TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(name,part))');
  let serial: Promise<unknown> = Promise.resolve(), failed = false;
  const stats = { transactions: 0, reads: 0, writes: 0, aborted: 0, writeFailures: 0 };

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
  function writeCollection(name: string, text: string): void {
    sql.exec('DELETE FROM collection_parts WHERE name = ?', name);
    if (text.length <= chunk) { sql.exec('INSERT INTO collections(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value', name, text); return; }
    let parts = 0;
    for (let start = 0; start < text.length; start += chunk) { sql.exec('INSERT INTO collection_parts(name,part,value) VALUES(?,?,?)', name, parts, text.slice(start, start + chunk)); parts += 1; }
    sql.exec('INSERT INTO collections(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value', name, `{"$parts":${parts}}`);
  }

  function view(): { db: Draft; commit: () => number } {
    const sessions: Cache<SessionRecord> = new Map(), archives: Cache<unknown> = new Map(), collections: Cache<unknown> = new Map();
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
    function receiptTable(table: string, idColumn: string) {
      const entries = new Map<string, ReceiptEntry>();
      return {
        entries,
        of(publicId: string, legacy: Record<string, ReceiptRecord | undefined> = {}): Record<string, ReceiptRecord | undefined> {
          let entry = entries.get(publicId);
          if (!entry) {
            const cache: Cache<ReceiptRecord> = new Map(Object.entries(legacy)), original = new Map<string, string | undefined>();
            const map = lazyMap<ReceiptRecord>(cache,
              () => sql.exec<{ id: string }>(`SELECT ${idColumn} AS id FROM ${table} WHERE sender = ?`, publicId).toArray().map(row => row.id),
              key => { const row = sql.exec<{ value: string }>(`SELECT value FROM ${table} WHERE sender = ? AND ${idColumn} = ?`, publicId, key).toArray()[0]; original.set(key, row?.value); return row ? JSON.parse(row.value) as ReceiptRecord : undefined; });
            entry = { cache, original, map }; entries.set(publicId, entry);
          }
          return entry.map;
        },
      };
    }
    const actions = receiptTable('action_receipts', 'action_id'), once = receiptTable('once_receipts', 'id');
    const originals = { sessions: new Map<string, string | undefined>(), archives: new Map<string, string | undefined>(), collections: new Map<string, string | undefined>() };
    const sessionMap = lazyMap<SessionRecord>(sessions, () => sql.exec<{ secret: string }>('SELECT secret FROM sessions').toArray().map(row => row.secret), key => {
      const row = sql.exec<{ value: string }>('SELECT value FROM sessions WHERE secret = ?', key).toArray()[0]; originals.sessions.set(key, row?.value);
      if (!row) return undefined;
      const session = JSON.parse(row.value) as SessionRecord;
      session.actions = actions.of(session.publicId, session.actions || {});
      session.once = once.of(session.publicId, session.once || {});
      return session;
    });
    const archiveMap = lazyMap<unknown>(archives, () => sql.exec<{ public_id: string }>('SELECT public_id FROM archived_lives').toArray().map(row => row.public_id), key => {
      const row = sql.exec<{ value: string }>('SELECT value FROM archived_lives WHERE public_id = ?', key).toArray()[0]; originals.archives.set(key, row?.value); return row ? JSON.parse(row.value) as unknown : undefined;
    });
    /** A feature collection, read from its row the first time this transaction asks for it (undefined: it does not exist). */
    function collectionOf(key: string): unknown {
      if (!collections.has(key)) { const text = collectionText(key); originals.collections.set(key, text); collections.set(key, text === undefined ? undefined : JSON.parse(text) as unknown); }
      return collections.get(key);
    }
    const helpers: StoreHelpers = {
      // What this transaction has already read, changed, added or removed is scanned as the draft holds it.
      scanSessions: predicate => {
        const keys: string[] = [], seen = new Set<string>();
        for (const row of sql.exec<{ secret: string; value: string }>('SELECT secret,value FROM sessions').toArray()) {
          seen.add(row.secret);
          if (sessions.has(row.secret)) { const held = sessions.get(row.secret); if (held !== undefined && predicate(held)) keys.push(row.secret); }
          else if (predicate(JSON.parse(row.value) as SessionRecord)) keys.push(row.secret);
        }
        for (const [key, held] of sessions) if (!seen.has(key) && held !== undefined && predicate(held)) keys.push(key);
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
    const base: Record<string, unknown> = { version: 1, sessions: sessionMap, archivedLives: archiveMap };
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
    }) as unknown as Draft;
    function commit(): number {
      beforeCommit?.();
      let wrote = 0;
      storage.transactionSync(() => {
        for (const [key, session] of sessions) {
          if (session === undefined) { if (originals.sessions.get(key) !== undefined) { sql.exec('DELETE FROM sessions WHERE secret = ?', key); wrote += 1; } continue; }
          // Receipts a route put on a session it has just made (plain objects) join the tables too.
          if (!actions.entries.has(session.publicId)) actions.of(session.publicId, session.actions || {});
          if (!once.entries.has(session.publicId)) once.of(session.publicId, session.once || {});
          const { actions: ignoredActions, once: ignoredOnce, ...record } = session;
          const value = JSON.stringify(record);
          if (value !== originals.sessions.get(key)) { sql.exec('INSERT INTO sessions(secret,public_id,expires_at,value) VALUES(?,?,?,?) ON CONFLICT(secret) DO UPDATE SET public_id=excluded.public_id,expires_at=excluded.expires_at,value=excluded.value', key, session.publicId, session.expiresAt, value); wrote += 1; }
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
        for (const [key, item] of collections) {
          if (item === undefined) continue;
          const value = JSON.stringify(item); if (value !== originals.collections.get(key)) { writeCollection(key, value); wrote += 1; }
        }
      });
      return wrote;
    }
    return { db, commit };
  }
  function run<T>(fn: (db: Draft) => T | Promise<T>, options: TransactOptions<T> | null | undefined, write: boolean): Promise<T> {
    const operation = serial.then(async (): Promise<T> => {
      if (failed) throw toStorageError(new Error('The durability of an earlier write is unknown'));
      const draft = view();
      let result: T;
      try { result = await fn(draft.db); } catch (error) { if (write) stats.aborted += 1; throw error; }
      if (write) {
        stats.transactions += 1;
        let wrote: number;
        // A commit that fails wrote nothing (one SQLite transaction): the caller is told so in the store's own words.
        try { wrote = draft.commit(); } catch (error) { stats.writeFailures += 1; throw toStorageError(error); }
        if (wrote) {
          stats.writes += 1;
          // Every acknowledgement is durable. A failed barrier is uncertain: fail closed until restart.
          try { await barrier(); } catch (error) { failed = true; stats.writeFailures += 1; throw toStorageError(error); }
        }
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
    stats: () => ({ mode: 'sqlite', failed, failing: failed, ...stats }),
    flush: () => serial.then(() => undefined), close: () => serial.then(() => undefined),
  };
}
