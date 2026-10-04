import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { storageError } from './protocol.ts';
import type { NodeStoreStats, StoreStats } from '../src/types/support.ts';
import type { Db, SessionRecord, Store, StoreHelpers, TransactOptions } from './types.ts';

/**
 * JSON file store (Node only). The storage interface the rest of the server relies on is just:
 *   transact(fn(db), { durable = true, committed, waitForObserved }?) → Promise<result>
 *                                          serialised read-modify-write; a throw discards changes
 *   read(fn(db))                          → Promise<result>   read-only snapshot
 * over one JSON document `{ version, sessions, archivedLives?, <namespaced collections> }`.
 * Route and ws modules reach their own collection with collection(db, name) from protocol.js,
 * which creates it on first use; nothing outside this file may assume a file on disk.
 *
 * THE GUARANTEE (one store, one set of semantics)
 *   A transaction whose promise REJECTS has no effect: not in memory, not in the file, not later.
 *   A DURABLE transaction (the default) whose promise RESOLVES is in the data file (written to a
 *   temporary file and renamed into place; not fsynced, so this survives a process crash, not
 *   necessarily a power cut).
 *
 * HOW IT WRITES
 *   The document lives in memory. A transaction works on copies: a session (or archived life) is
 *   cloned the first time the transaction touches it, any other top-level collection is cloned
 *   whole on first touch. Throwing discards the copies. Returning APPLIES them to the document in
 *   memory, remembers how to undo that, and queues the change for the next file write. Transactions
 *   applied while a write is in flight share the next write (group commit), so N concurrent actions
 *   cost about two writes, not N.
 *
 *   WHEN A WRITE FAILS (a full disk, a missing directory) every change that is not yet in the file
 *   is undone, newest first — the transactions that were in the failed write AND any applied on
 *   top of them since — and each of their callers is rejected with
 *   { status: 503, code: 'storage_unavailable' }. Memory is then exactly what the file holds. A
 *   transaction or read that was still running across the failure is rejected (or, for a read,
 *   run again), because it may have looked at state that no longer exists. Nothing is retried in
 *   the background: the caller retries, and for an action the same action id is then applied once.
 *
 *   `committed(result)` runs once the transaction's change IS IN THE FILE, in commit order, before
 *   the caller's promise resolves. It never runs for a transaction that was undone or aborted.
 *   Anything a caller keeps in memory about the document (a block index, a mute list) is updated
 *   there, so such a cache can never hold a change the document lost.
 *
 *   LAZY transactions ({ durable: false }) resolve at once; the file catches up with the next
 *   durable write or about `lazyFlushMs` (default 1 s) later, whichever is first. They are for
 *   requests that acknowledge nothing — a poll that only settles the clock. If the process dies,
 *   or the write that would have carried them fails, such a change is simply gone and is computed
 *   again from the stored state: a lazy transaction is the one case where "resolved" does not mean
 *   "kept". A request that turns out to have done something a player could see as an outcome
 *   passes `durable` as a function of its result and is then durable like any other. With
 *   `waitForObserved: true` a lazy transaction still waits for the durable changes of OTHER
 *   transactions it may have seen (and is rejected if those are undone), so it never shows a
 *   player an outcome that is not in the file.
 *
 *   read() never writes and works on copies. It waits for the durable changes it could have seen
 *   to reach the file; if they are undone instead it runs again against what is left. Reads keep
 *   working while writes fail. "Could have seen" is decided by what was touched: a read (or a
 *   waitForObserved transaction) of one session waits only for unsaved changes to that session or
 *   to a collection it also touched; one that scanned every session waits for all of them.
 *
 *   NO ALIASING. Everything applied to the document is deep-frozen. A value a transaction hands
 *   back may be one of those stored objects, so changing it afterwards throws instead of silently
 *   changing committed state. Inside a transaction (and a read) every object is a private copy.
 *
 *   WRITE BUDGET. Every write is the whole file, so writes are paced: after writing B bytes the
 *   next write waits B / (STORE_WRITE_MB_PER_S, default 50 MB/s). A small file is never held back
 *   noticeably (400 KB → 8 ms); a large one trades a little action latency (at most 2 s) for a disk
 *   that is not rewritten hundreds of times a second. Commits arriving in the pause share one write.
 *
 *   Only what an applied transaction touched is re-serialised: each session's JSON text is cached
 *   and reused until a transaction reads or writes that session. (Touching counts even if nothing
 *   changed, and a collection other than sessions is copied and re-serialised whole.)
 *
 * Extras for the host (server.js) only — feature modules must not rely on them:
 *   db.$store.scanSessions(predicate) → [key]      keys of sessions matching predicate(record), without copying
 *   db.$store.sessionKeyByPublicId(id) → key|undefined
 *   store.flush() → Promise      write anything not yet on disk (rejects, having undone it, if that fails)
 *   store.close() → Promise      flush and stop the lazy timer
 *   store.stats() → { transactions, lazy, reads, writes, bytes, aborted, writeFailures, undone, failing, lastFailureAt }
 *                   `failing` is true from a failed write until the next successful one
 * `io` ({ writeFile, rename }) replaces the file calls; tests use it to make a write fail or wait.
 */
const KEYED = ['sessions', 'archivedLives'] as const;
type KeyedName = (typeof KEYED)[number];
const isKeyed = (key: string): key is KeyedName => key === 'sessions' || key === 'archivedLives';
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
/** The `code` of whatever was thrown, when it has one. */
const errorCode = (error: unknown): unknown => (isRecord(error) ? error['code'] : undefined);
const errorMessage = (error: unknown): unknown => (isRecord(error) ? error['message'] : undefined);

/** The file calls createStore makes; `io` replaces them (tests use it to make a write fail or wait). */
export interface StoreIo {
  writeFile?: (path: string, text: string, options: { mode: number }) => Promise<void>
  rename?: (from: string, to: string) => Promise<void>
}
export interface StoreOptions {
  lazyFlushMs?: number
  writeMegabytesPerSecond?: number
  io?: StoreIo
  now?: () => number
  log?: (line: string) => void
  mode?: string
}
/**
 * The store createStore makes: the host-only extras are always present. `D` is the document a transaction sees:
 * the game uses Db (the default); a test of the generic store may name its own small document type.
 */
export interface JsonFileStore<D extends object = Db> {
  transact<T>(operation: (db: D & { readonly $store?: StoreHelpers }) => T | Promise<T>, options?: TransactOptions<T>): Promise<T>
  read<T>(operation: (db: D & { readonly $store?: StoreHelpers }) => T | Promise<T>): Promise<T>
  flush(): Promise<void>
  close(): Promise<void>
  stats(): StoreStats
}
/** The part of one transaction that is applied or undone later. */
interface PendingChange { seq: number; undo: (() => void)[]; hook: ((value: unknown) => void) | undefined; value: unknown; durable: boolean; names: Set<string> | null }
/** One keyed map (sessions, archivedLives) as one transaction sees it. */
interface KeyedPart { copies: Map<string, unknown>; deleted: Set<string>; created: boolean; proxy: Record<string, unknown> }

/** The longest a write is held back by the write budget, whatever the file size (an action must still be answered). */
const MAX_WRITE_PAUSE_MS = 2000;

// What a caller gets when the file could not be written: defined in protocol.js so the Worker's stores answer with the same error.
export { storageError };
/** Objects this module has frozen all the way down (so a second visit, or a cycle, stops). */
const frozen = new WeakSet<object>();
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  const stack: object[] = [value];
  while (stack.length) {
    const item = stack.pop();
    if (item === undefined || frozen.has(item)) continue;
    frozen.add(item);
    Object.freeze(item);
    const children: unknown[] = Array.isArray(item) ? item : Object.values(item);
    for (const child of children) if (child !== null && typeof child === 'object') stack.push(child);
  }
  return value;
}

export async function createStore<D extends object = Db>(dataDir: string, { lazyFlushMs = 1000, writeMegabytesPerSecond = Number(process.env.STORE_WRITE_MB_PER_S || 50),
  io = {}, now = Date.now, log = (line: string) => console.error(line), mode }: StoreOptions = {}): Promise<JsonFileStore<D>> {
  if (mode !== undefined && mode !== 'grouped') throw new Error(`Unknown store mode "${mode}": there is one store now (STORE_MODE=legacy was removed).`);
  if (!Number.isFinite(writeMegabytesPerSecond) || writeMegabytesPerSecond <= 0) throw new Error('Invalid STORE_WRITE_MB_PER_S');
  const writeBytesPerMs = writeMegabytesPerSecond * 1000;
  const write: NonNullable<StoreIo['writeFile']> = io.writeFile ?? writeFile, move: NonNullable<StoreIo['rename']> = io.rename ?? rename;
  await mkdir(dataDir, { recursive: true });
  const file = join(dataDir, 'devices.json');
  let database: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!isRecord(parsed) || parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== 'object') throw new Error('Invalid device database');
    database = parsed;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    database = { version: 1, sessions: {} };
  }
  const stats: NodeStoreStats = { mode: 'grouped', transactions: 0, lazy: 0, reads: 0, writes: 0, bytes: 0, aborted: 0, writeFailures: 0, undone: 0, failing: false, lastFailureAt: null };
  const temporary = `${file}.tmp`;
  async function writeOut(text: string): Promise<void> {
    await write(temporary, text, { mode: 0o600 });
    await move(temporary, file);
    stats.writes += 1; stats.bytes += text.length;
  }

  const base: Record<string, unknown> = database;
  /** A keyed map of the document as stored (an empty one when there is none). */
  const mapOf = (name: string): Record<string, unknown> => { const map = base[name]; return isRecord(map) ? map : {}; };
  for (const name of KEYED) if (base[name] !== undefined && !isRecord(base[name])) throw new Error('Invalid device database');
  // Stored values are frozen; the containers they sit in (the document, the session map) are not.
  for (const [key, value] of Object.entries(base)) { if (isKeyed(key)) Object.values(mapOf(key)).forEach(deepFreeze); else deepFreeze(value); }
  const textOf: Record<KeyedName, Map<string, string>> = { sessions: new Map(), archivedLives: new Map() }; // key → cached JSON text of one entry
  const partText = new Map<string, string>(); // other top-level key → cached JSON text
  const keyOfPublicId = new Map<string, string>(), publicIdOfKey = new Map<string, string>();
  function indexSession(key: string, record: unknown): void {
    const old = publicIdOfKey.get(key);
    if (old !== undefined && keyOfPublicId.get(old) === key) keyOfPublicId.delete(old);
    publicIdOfKey.delete(key);
    if (isRecord(record) && typeof record.publicId === 'string') { keyOfPublicId.set(record.publicId, key); publicIdOfKey.set(key, record.publicId); }
  }
  function reindex(): void { keyOfPublicId.clear(); publicIdOfKey.clear(); for (const [key, record] of Object.entries(mapOf('sessions'))) indexSession(key, record); }
  reindex();

  type View = D & { readonly $store?: StoreHelpers };
  /** The working view one transaction (or read) sees. Nothing reaches `base` until commit(). */
  function open() {
    const keyed: Partial<Record<KeyedName, KeyedPart>> = {};
    const parts = new Map<string, unknown>(), removed = new Set<string>();
    let scanned = false; // looked across every session (a scan, a lookup by public id, a key listing)
    const peeked = new Set<string>(); // asked "is it there?" without reading it
    function keyedPart(name: KeyedName): KeyedPart {
      const existing = keyed[name];
      if (existing) return existing;
      const part: KeyedPart = { copies: new Map(), deleted: new Set(), created: false, proxy: {} };
      const source = () => mapOf(name);
      const has = (key: string | symbol): boolean => { if (typeof key !== 'string') return false; peeked.add(`${name}/${key}`); return !part.deleted.has(key) && (part.copies.has(key) || Object.hasOwn(source(), key)); };
      part.proxy = new Proxy<Record<string, unknown>>({}, {
        get(target, key) {
          if (typeof key !== 'string' || part.deleted.has(key)) return undefined;
          if (part.copies.has(key)) return part.copies.get(key);
          if (!Object.hasOwn(source(), key)) { peeked.add(`${name}/${key}`); return undefined; }
          const copy = structuredClone(source()[key]);
          part.copies.set(key, copy);
          return copy;
        },
        set(target, key, value) { if (typeof key !== 'string') return false; part.copies.set(key, value); part.deleted.delete(key); return true; },
        has: (target, key) => has(key),
        deleteProperty(target, key) { if (typeof key !== 'string') return true; part.copies.delete(key); if (Object.hasOwn(source(), key)) part.deleted.add(key); return true; },
        ownKeys() { scanned = true; return [...Object.keys(source()).filter((key) => !part.deleted.has(key)), ...[...part.copies.keys()].filter((key) => !Object.hasOwn(source(), key))]; },
        // The value is fetched through get(); the descriptor only has to say "an enumerable own property".
        getOwnPropertyDescriptor: (target, key) => (has(key) ? { value: undefined, writable: true, enumerable: true, configurable: true } : undefined),
        defineProperty: () => false,
      });
      keyed[name] = part;
      return part;
    }
    const keyedExists = (name: KeyedName): boolean => !removed.has(name) && (keyed[name]?.created === true || isRecord(base[name]));
    const helpers: StoreHelpers = Object.freeze({
      /** Keys of sessions whose record satisfies `predicate`. Records are shown as stored: do not change them. */
      scanSessions(predicate: (record: SessionRecord, key: string) => boolean): string[] {
        scanned = true;
        const part = keyedPart('sessions'), found: string[] = [], sessions = mapOf('sessions');
        for (const [key, record] of Object.entries(sessions)) if (!part.deleted.has(key) && predicate((part.copies.get(key) ?? record) as SessionRecord, key)) found.push(key);
        for (const [key, record] of part.copies) if (!Object.hasOwn(sessions, key) && predicate(record as SessionRecord, key)) found.push(key);
        return found;
      },
      sessionKeyByPublicId(id: string): string | undefined {
        scanned = true;
        const part = keyedPart('sessions');
        for (const [key, record] of part.copies) if (isRecord(record) && record.publicId === id) return key;
        const key = keyOfPublicId.get(id);
        return key !== undefined && !part.deleted.has(key) && !part.copies.has(key) ? key : undefined;
      },
    });
    const dbHas = (key: string | symbol): boolean => { if (typeof key === 'string') peeked.add(key); return typeof key === 'string' && !removed.has(key) && (key === 'version' || (isKeyed(key) ? keyedExists(key) : parts.has(key) || Object.hasOwn(base, key))); };
    const db = new Proxy<View>({} as View, {
      get(target, key) {
        if (key === '$store') return helpers;
        if (typeof key !== 'string' || removed.has(key)) return undefined;
        if (key === 'version') return base.version;
        if (isKeyed(key)) return keyedExists(key) ? keyedPart(key).proxy : undefined;
        if (parts.has(key)) return parts.get(key);
        if (!Object.hasOwn(base, key)) { peeked.add(key); return undefined; }
        const copy = structuredClone(base[key]);
        parts.set(key, copy);
        return copy;
      },
      set(target, key, value) {
        if (typeof key !== 'string' || key === 'version' || key === '$store') return false;
        removed.delete(key);
        if (isKeyed(key)) {
          if (!isRecord(value)) return false;
          const part = keyedPart(key);
          if (value === part.proxy) return true;
          // Replacing the whole map: everything stored is dropped and the given entries take its place.
          for (const old of Object.keys(mapOf(key))) part.deleted.add(old);
          part.copies.clear(); part.created = true;
          for (const [entry, record] of Object.entries(value)) { part.copies.set(entry, record); part.deleted.delete(entry); }
          return true;
        }
        parts.set(key, value);
        return true;
      },
      has: (target, key) => dbHas(key),
      deleteProperty(target, key) { if (typeof key !== 'string' || key === 'version' || key === 'sessions') return false; parts.delete(key); if (isKeyed(key)) delete keyed[key]; removed.add(key); return true; },
      ownKeys() {
        scanned = true;
        const keys = new Set(['version']);
        for (const key of Object.keys(base)) keys.add(key);
        for (const key of parts.keys()) keys.add(key);
        for (const name of KEYED) if (keyed[name]?.created) keys.add(name);
        for (const key of removed) keys.delete(key);
        return [...keys];
      },
      getOwnPropertyDescriptor(target, key) { return dbHas(key) ? { value: undefined, writable: true, enumerable: true, configurable: true } : undefined; },
      defineProperty: () => false,
    });
    /**
     * Apply this view to the document. Returns null when nothing was touched, otherwise the list of
     * steps that put the document back exactly as it was (run them last-to-first).
     */
    function commit(): (() => void)[] | null {
      const undo: (() => void)[] = [];
      const restoreTop = (key: string, had: boolean, old: unknown): void => { undo.push(() => { if (had) base[key] = old; else delete base[key]; partText.delete(key); if (isKeyed(key)) { textOf[key].clear(); if (key === 'sessions') reindex(); } }); };
      for (const key of removed) if (Object.hasOwn(base, key)) { restoreTop(key, true, base[key]); delete base[key]; partText.delete(key); if (isKeyed(key)) textOf[key].clear(); }
      for (const name of KEYED) {
        const part = keyed[name];
        if (!part) continue;
        if (part.created && !isRecord(base[name])) { restoreTop(name, Object.hasOwn(base, name), base[name]); base[name] = {}; }
        const map = base[name];
        if (!isRecord(map)) continue;
        const put = (key: string, record: unknown): void => { if (record === undefined) delete map[key]; else map[key] = record; textOf[name].delete(key); if (name === 'sessions') indexSession(key, record ?? null); };
        for (const key of part.deleted) { if (!Object.hasOwn(map, key)) continue; const old = map[key]; undo.push(() => put(key, old)); put(key, undefined); }
        for (const [key, record] of part.copies) { const old = Object.hasOwn(map, key) ? map[key] : undefined; undo.push(() => put(key, old)); put(key, deepFreeze(record)); }
      }
      for (const [key, value] of parts) { restoreTop(key, Object.hasOwn(base, key), base[key]); base[key] = deepFreeze(value); partText.delete(key); }
      return undo.length ? undo : null;
    }
    /**
     * What this view has looked at, as names like 'sessions/<key>' or 'social' — or null when it
     * looked across all sessions. Used to decide which unsaved changes of others it may have seen.
     */
    function touched(): Set<string> | null {
      if (scanned) return null;
      const names = new Set([...parts.keys(), ...removed, ...peeked]);
      for (const name of KEYED) if (removed.has(name)) return null;
      for (const name of KEYED) { const part = keyed[name]; if (!part) continue; if (part.created) return null; for (const key of part.copies.keys()) names.add(`${name}/${key}`); for (const key of part.deleted) names.add(`${name}/${key}`); }
      return names;
    }
    return { db, commit, touched };
  }

  function serialise(): string {
    const out = [`"version":${JSON.stringify(base.version)}`];
    for (const name of KEYED) {
      const map = base[name];
      if (!isRecord(map)) continue;
      const cache = textOf[name], entries: string[] = [];
      for (const [key, record] of Object.entries(map)) {
        let text = cache.get(key);
        if (text === undefined) { text = JSON.stringify(record) ?? 'null'; cache.set(key, text); }
        entries.push(`${JSON.stringify(key)}:${text}`);
      }
      out.push(`${JSON.stringify(name)}:{${entries.join(',')}}`);
    }
    for (const [key, value] of Object.entries(base)) {
      if (key === 'version' || isKeyed(key)) continue;
      let text = partText.get(key);
      if (text === undefined) { text = JSON.stringify(value); if (text === undefined) continue; partText.set(key, text); }
      out.push(`${JSON.stringify(key)}:${text}`);
    }
    return `{${out.join(',')}}`;
  }

  let queue: Promise<unknown> = Promise.resolve();
  // commitSeq: the last change applied to memory. flushedSeq: the last one known to be in the file.
  // durableSeq: the last applied change some caller is waiting to see in the file.
  // epoch: counts undo passes; work that started in an earlier epoch may have read state that is gone.
  let commitSeq = 0, durableSeq = 0, flushedSeq = 0, epoch = 0, closed = false;
  let flushing: Promise<void> | null = null, lazyTimer: ReturnType<typeof setTimeout> | null = null;
  let nextFlushAt = 0, lastError: unknown = null, lastLogAt = -Infinity, unlogged = 0;
  const pending: PendingChange[] = []; // applied, not yet in the file, oldest first: { seq, undo, hook, value, durable, names }
  /**
   * The newest unsaved change someone is waiting on (a durable one) that a view may have seen:
   * one that touched something the view touched. A view that looked across all sessions may have
   * seen any of them.
   */
  function observedBy(names: Set<string> | null): number {
    if (names === null) return durableSeq;
    if (!pending.length) return 0;
    const list = [...names];
    let seq = 0;
    for (const entry of pending) if (entry.durable && entry.seq > seq && (entry.names === null || list.some((name) => entry.names?.has(name)))) seq = entry.seq;
    return seq;
  }
  const lost: { from: number; to: number; epoch: number }[] = []; // { from, to, epoch }: change numbers undone by the pass that started `epoch`, newest last (bounded)
  const waiters: { seq: number; resolve: () => void; reject: (error: unknown) => void }[] = []; // { seq, resolve, reject } — callers waiting for change `seq` to be in the file
  /** A listener must never be able to stop the store: whatever it throws is logged and dropped. */
  function runHook(hook: ((value: unknown) => void) | undefined, value: unknown): void {
    if (!hook) return;
    try { hook(value); } catch (error) { try { log(`Commit listener failed: ${String(errorMessage(error) ?? error).split('\n')[0]}`); } catch { /* nor may the logger */ } }
  }

  function noteFailure(error: unknown): void {
    lastError = error; stats.writeFailures += 1; stats.failing = true; stats.lastFailureAt = now();
    // One line per failure burst, then at most one every 30 s with a count: an outage must not flood the log.
    try {
      if (now() - lastLogAt >= 30000 || now() < lastLogAt) { log(`Store write failed (${errorCode(error) || 'error'}): ${errorMessage(error)}${unlogged ? ` — and ${unlogged} more since the last line` : ''}. Unsaved changes were undone.`); lastLogAt = now(); unlogged = 0; }
      else unlogged += 1;
    } catch { /* a failing logger must not stop the undo that follows */ }
  }
  /** The write holding every change up to `upto` is in the file. */
  function settle(upto: number): void {
    flushedSeq = Math.max(flushedSeq, upto);
    stats.failing = false;
    while (pending[0] && pending[0].seq <= upto) {
      const entry = pending.shift();
      if (entry) runHook(entry.hook, entry.value);
    }
    release();
  }
  function release(): void { for (let i = 0; i < waiters.length;) { const waiter = waiters[i]; if (waiter && waiter.seq <= flushedSeq) { waiters.splice(i, 1); waiter.resolve(); } else i += 1; } }
  /** A write failed: take back everything that is not in the file and reject everyone waiting on it. */
  function undoAll(error: unknown): void {
    for (let i = pending.length - 1; i >= 0; i--) { const steps = pending[i]?.undo ?? []; for (let j = steps.length - 1; j >= 0; j--) steps[j]?.(); }
    stats.undone += pending.length;
    // Remember which changes were taken back: a caller whose change (or whose read) was applied but who has
    // not yet asked for it to be on disk must be told it is gone, not that it is saved (see onDisk).
    pending.length = 0; epoch += 1;
    if (commitSeq > flushedSeq) { lost.push({ from: flushedSeq + 1, to: commitSeq, epoch }); if (lost.length > 64) lost.shift(); }
    flushedSeq = commitSeq; durableSeq = commitSeq; // memory is the file again
    const failure = storageError(error);
    for (const waiter of waiters.splice(0)) waiter.reject(failure);
  }
  function startFlush(): Promise<void> {
    const work = (async (): Promise<void> => {
      // Write budget: after a write of B bytes the next one may start B / writeBytesPerMs later, so
      // the disk never takes more than the budget however many actions arrive. Commits made while
      // waiting are part of the write that follows, which is why the text is built after the wait.
      const wait = nextFlushAt - Date.now();
      if (wait >= 1) await new Promise<void>((done) => setTimeout(done, Math.min(wait, MAX_WRITE_PAUSE_MS))); // under a millisecond is not worth a timer
      if (!pending.length) return;
      const upto = commitSeq, text = serialise();
      try { await writeOut(text); } catch (error) { noteFailure(error); undoAll(error); return; }
      nextFlushAt = Date.now() + text.length / writeBytesPerMs;
      settle(upto);
    })().finally(() => { flushing = null; pump(); });
    flushing = work;
    return work;
  }
  /** Start a write if someone is waiting for one; otherwise let the lazy timer pick the changes up. */
  function pump(): void {
    if (flushing) return;
    if (!pending.length) { release(); return; }
    if (waiters.length || closed) { startFlush(); return; }
    if (lazyTimer) return;
    lazyTimer = setTimeout(() => { lazyTimer = null; if (pending.length && !flushing) startFlush(); }, lazyFlushMs);
    lazyTimer.unref?.();
  }
  /** Resolve once change `seq` is in the file; reject (storage_unavailable) if it was undone instead. */
  function onDisk(seq: number, began = epoch): Promise<void> {
    // After an undo `flushedSeq` jumps to `commitSeq` ("memory is the file again"), so a change that was undone
    // AFTER the caller started (`began`, the caller's epoch) must be recognised by its own number: it was never written.
    if (lost.some((range) => range.epoch > began && seq >= range.from && seq <= range.to)) return Promise.reject(storageError(lastError));
    if (seq <= flushedSeq) return Promise.resolve();
    const promise = new Promise<void>((resolve, reject) => { waiters.push({ seq, resolve, reject }); });
    pump();
    return promise;
  }
  return {
    transact<T>(operation: (db: D & { readonly $store?: StoreHelpers }) => T | Promise<T>, { durable = true, committed, waitForObserved = false }: TransactOptions<T> = {}): Promise<T> {
      const hook = committed ? (result: unknown) => committed(result as T) : undefined;
      const work = queue.then(async () => {
        stats.transactions += 1;
        const view = open(), began = epoch;
        let value: T;
        try { value = await operation(view.db); } catch (error) { stats.aborted += 1; throw error; }
        // A write failed while this was running: what it read may have been undone. It changes nothing.
        if (epoch !== began) { stats.aborted += 1; throw storageError(lastError); }
        // `durable` may be a function of the result, so a request can decide after it has run
        // whether it acknowledged anything (a poll that completed an activity did; a quiet one did not).
        const wait = typeof durable === 'function' ? durable(value) !== false : durable !== false;
        const names = view.touched();
        const observed = observedBy(names); // unsaved durable changes of earlier transactions this one may have read
        const undo = view.commit();
        let seq: number | null = null;
        if (undo) { seq = commitSeq += 1; pending.push({ seq, undo, hook, value, durable: wait, names }); if (wait) durableSeq = seq; }
        return { value, wait, seq, observed, began };
      });
      queue = work.catch(() => {});
      return work.then(async ({ value, wait, seq, observed, began }) => {
        if (wait) { await onDisk(seq ?? observed, began); if (seq === null) runHook(hook, value); return value; }
        stats.lazy += 1;
        if (seq === null) runHook(hook, value); else pump();
        if (waitForObserved) await onDisk(observed, began);
        return value;
      });
    },
    read<T>(operation: (db: D & { readonly $store?: StoreHelpers }) => T | Promise<T>): Promise<T> {
      stats.reads += 1;
      const attempt = (tries: number): Promise<T> => {
        const work = queue.then(async () => { const began = epoch, view = open(); const value = await operation(view.db); return { value, seq: observedBy(view.touched()), stale: epoch !== began, began }; });
        queue = work.catch(() => {});
        return work.then(async ({ value, seq, stale, began }) => {
          if (!stale) { try { await onDisk(seq, began); return value; } catch (error) { if (errorCode(error) !== 'storage_unavailable') throw error; } }
          // What this read saw was undone by a failed write: answer from what is actually stored.
          if (tries >= 3) throw storageError(lastError);
          return attempt(tries + 1);
        });
      };
      return attempt(0);
    },
    async flush() { await queue; if (pending.length) await onDisk(commitSeq); },
    async close() { closed = true; if (lazyTimer) { clearTimeout(lazyTimer); lazyTimer = null; } await queue; if (pending.length) await onDisk(commitSeq); },
    stats: () => ({ ...stats }),
  };
}
