import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * JSON file store (Node only). The storage interface the rest of the server relies on is just:
 *   transact(fn(db), { durable = true, committed }?) → Promise<result>   serialised read-modify-write; a throw discards changes
 *                                                             (`durable` is a boolean, or a function of the result;
 *                                                             `committed(result)` runs once the change is final —
 *                                                             never for a transaction that is rejected)
 *   read(fn(db))                          → Promise<result>   read-only snapshot
 * over one JSON document `{ version, sessions, archivedLives?, <namespaced collections> }`.
 * Route and ws modules reach their own collection with collection(db, name) from protocol.js,
 * which creates it on first use; nothing outside this file may assume a file on disk.
 *
 * HOW IT WRITES (mode 'grouped', the default)
 *   The document lives in memory. A transaction works on copies: a session (or archived life) is
 *   cloned the first time the transaction touches it, any other top-level collection is cloned
 *   whole on first touch. Returning commits the copies; throwing discards them, so a transaction
 *   is still all-or-nothing and a read can never change stored data.
 *
 *   DURABLE transactions (the default) resolve only after a file write that contains them has
 *   been renamed into place: an acknowledged action, receipt, message or payment is on disk, as
 *   it was with the previous store. Transactions that commit while a write is in flight share the
 *   next write (group commit), so N concurrent actions cost about two writes, not N.
 *
 *   A FAILED WRITE UNDOES WHAT IT WAS MEANT TO STORE. A durable transaction is applied to the
 *   document in memory first (so the transactions queued behind it run without waiting for the
 *   disk), and every such change is kept with the steps that undo it until its write has landed.
 *   If that write fails (a full disk), every durable commit it carried is undone in memory, and so
 *   is everything committed after the first of them — those transactions read state that no
 *   longer exists. Every durable one of them rejects; none of them is in memory or will ever
 *   reach the disk, exactly as with the previous store. A retry therefore runs as a new request
 *   and is not answered "already applied". Commits that were already acknowledged, and lazy
 *   commits made before the first failed durable one, are untouched. A transaction that was still
 *   running while the write failed is rejected too rather than committed on top of undone state.
 *
 *   `committed(result)` is how a caller keeps its own in-memory state (an index, a cache, room
 *   membership) in line with the document. It runs exactly once for a commit that is final and
 *   never for one that is rejected or undone: for a durable transaction — and for anything that
 *   committed on top of a durable commit still waiting for its write — it runs when that write
 *   has landed, in commit order, before the caller's promise resolves; otherwise right after the
 *   commit. Until then the document in memory can be a few milliseconds ahead of such an index.
 *
 *   THROUGHPUT TRADE-OFF. Group commit is kept, so the cost of this safety is paid only when a
 *   write fails: the whole batch waiting for that write is rejected together (a caller is not
 *   retried on a later write), and requests that arrive during the failure can be rejected with
 *   it. They are safe to send again.
 *
 *   LAZY transactions ({ durable: false }) commit in memory and resolve at once; the file catches
 *   up with the next durable write or about `lazyFlushMs` (default 1 s) later, whichever is first
 *   (plus any write-budget pause; a failed lazy write is tried again after the same interval). They
 *   are for requests that acknowledge nothing — a poll that only settles the clock. After a crash
 *   such a settlement is simply computed again from the last stored state. A request that turns
 *   out to have done something a player could see as an outcome (money moved, an activity
 *   finished) passes `durable` as a function and is then durable like any other. A lazy
 *   transaction still resolves at once when it commits on top of a durable commit that is waiting
 *   for its write. If that write fails, the lazy change is undone with it — the same loss as a
 *   crash, and for the same reason harmless: it acknowledged nothing — and its `committed`
 *   listener, which was waiting for that write, is never called.
 *
 *   ACTING ON A LAZY RESULT ({ durable: false, waitForDurable: true }). A lazy transaction whose
 *   caller is about to DO something with what it read (admit a socket to a room) must not act on a
 *   durable commit that may still be undone. Two rules make that safe, and the caller needs both:
 *     1. do the act in `committed` — it runs only once everything the transaction read is final,
 *        and in commit order, so a later transaction that takes the permission away has its own
 *        listener run AFTER this one and can undo the act (never before it, which would leave the
 *        act standing);
 *     2. pass `waitForDurable: true` — the promise then resolves after that listener has run, and
 *        rejects if the commit underneath was undone, so the caller can tell the client "no".
 *   With nothing unwritten beneath it such a transaction is exactly as fast as any lazy one. It
 *   never waits for its OWN change to be written. (Legacy mode writes every transaction before it
 *   answers, so there the option changes nothing.)
 *
 *   read() never writes. It waits for durable commits it could have observed to reach the disk,
 *   and rejects if they are undone, so a reader is never shown a payment that did not happen.
 *
 *   WRITE BUDGET. Every write is the whole file, so writes are paced: after writing B bytes the
 *   next write waits B / (STORE_WRITE_MB_PER_S, default 50 MB/s). A small file is never held back
 *   noticeably (400 KB → 8 ms); a large one trades a little action latency (at most 2 s) for a disk
 *   that is not rewritten hundreds of times a second. Commits arriving in the pause share one write.
 *
 *   Only what a committed transaction touched is re-serialised: each session's JSON text is cached
 *   and reused until a committed transaction reads or writes that session. (Touching counts even
 *   if nothing changed, and a collection other than sessions is copied and re-serialised whole.)
 *   Values handed back by a transaction are the stored objects: callers must not change them.
 *
 * mode 'legacy' (STORE_MODE=legacy) is the previous implementation, kept verbatim as a fallback
 * and as the baseline for scripts/load.mjs: every transact clones and rewrites the whole file.
 *
 * Extras for the host (server.js) only — feature modules must not rely on them:
 *   db.$store.scanSessions(predicate) → [key]      keys of sessions matching predicate(record), without copying
 *   db.$store.sessionKeyByPublicId(id) → key|undefined
 *   store.flush() → Promise      write anything not yet on disk
 *   store.close() → Promise      flush and stop the lazy timer
 *   store.stats() → { mode, transactions, lazy, reads, writes, bytes, aborted }
 *                   (`aborted` counts transactions that threw and commits undone by a failed write)
 * For tests and diagnostics only: createStore(dir, { beforeWrite }) — `await beforeWrite(text)` runs
 * before each file write, so a test can hold a write back or make it fail (a throw fails the write).
 */
const KEYED = ['sessions', 'archivedLives'];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The longest a write is held back by the write budget, whatever the file size (an action must still be answered). */
const MAX_WRITE_PAUSE_MS = 2000;

export async function createStore(dataDir, { mode = process.env.STORE_MODE === 'legacy' ? 'legacy' : 'grouped', lazyFlushMs = 1000,
  writeMegabytesPerSecond = Number(process.env.STORE_WRITE_MB_PER_S || 50), beforeWrite = null } = {}) {
  if (!Number.isFinite(writeMegabytesPerSecond) || writeMegabytesPerSecond <= 0) throw new Error('Invalid STORE_WRITE_MB_PER_S');
  const writeBytesPerMs = writeMegabytesPerSecond * 1000;
  await mkdir(dataDir, { recursive: true });
  const file = join(dataDir, 'devices.json');
  let database;
  try {
    database = JSON.parse(await readFile(file, 'utf8'));
    if (database.version !== 1 || !database.sessions || typeof database.sessions !== 'object') throw new Error('Invalid device database');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    database = { version: 1, sessions: {} };
  }
  const stats = { mode, transactions: 0, lazy: 0, reads: 0, writes: 0, bytes: 0, aborted: 0 };
  const temporary = `${file}.tmp`;
  async function writeOut(text) {
    if (beforeWrite) await beforeWrite(text);
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, file);
    stats.writes += 1; stats.bytes += text.length;
  }

  if (mode === 'legacy') {
    let pending = Promise.resolve();
    return {
      transact(operation, { committed } = {}) {
        const work = pending.then(async () => {
          stats.transactions += 1;
          const next = structuredClone(database);
          let value;
          try { value = await operation(next); } catch (error) { stats.aborted += 1; throw error; }
          await writeOut(JSON.stringify(next));
          database = next;
          try { committed?.(value); } catch (error) { console.error('Commit listener failed:', error.message); }
          return value;
        });
        pending = work.catch(() => {});
        return work;
      },
      read(operation) { stats.reads += 1; return pending.then(() => operation(structuredClone(database))); },
      flush: () => pending,
      close: () => pending,
      stats: () => ({ ...stats }),
    };
  }

  // ---- grouped mode ------------------------------------------------------------------------
  const base = database;
  for (const name of KEYED) if (base[name] !== undefined && !isRecord(base[name])) throw new Error('Invalid device database');
  const textOf = { sessions: new Map(), archivedLives: new Map() }; // key → cached JSON text of one entry
  const partText = new Map(); // other top-level key → cached JSON text
  const keyOfPublicId = new Map(), publicIdOfKey = new Map();
  function indexSession(key, record) {
    const old = publicIdOfKey.get(key);
    if (old !== undefined && keyOfPublicId.get(old) === key) keyOfPublicId.delete(old);
    publicIdOfKey.delete(key);
    if (record && typeof record.publicId === 'string') { keyOfPublicId.set(record.publicId, key); publicIdOfKey.set(key, record.publicId); }
  }
  for (const [key, record] of Object.entries(base.sessions)) indexSession(key, record);

  /** The working view one transaction (or read) sees. Nothing reaches `base` until commit(). */
  function open() {
    const keyed = {}; // name → { copies: Map, deleted: Set, created: boolean, proxy }
    const parts = new Map(), removed = new Set();
    function keyedPart(name) {
      if (keyed[name]) return keyed[name];
      const part = { copies: new Map(), deleted: new Set(), created: false };
      const source = () => (isRecord(base[name]) ? base[name] : {});
      const has = (key) => typeof key === 'string' && !part.deleted.has(key) && (part.copies.has(key) || Object.hasOwn(source(), key));
      part.proxy = new Proxy({}, {
        get(target, key) {
          if (typeof key !== 'string' || part.deleted.has(key)) return undefined;
          if (part.copies.has(key)) return part.copies.get(key);
          if (!Object.hasOwn(source(), key)) return undefined;
          const copy = structuredClone(source()[key]);
          part.copies.set(key, copy);
          return copy;
        },
        set(target, key, value) { if (typeof key !== 'string') return false; part.copies.set(key, value); part.deleted.delete(key); return true; },
        has: (target, key) => has(key),
        deleteProperty(target, key) { if (typeof key !== 'string') return true; part.copies.delete(key); if (Object.hasOwn(source(), key)) part.deleted.add(key); return true; },
        ownKeys() { return [...Object.keys(source()).filter((key) => !part.deleted.has(key)), ...[...part.copies.keys()].filter((key) => !Object.hasOwn(source(), key))]; },
        // The value is fetched through get(); the descriptor only has to say "an enumerable own property".
        getOwnPropertyDescriptor: (target, key) => (has(key) ? { value: undefined, writable: true, enumerable: true, configurable: true } : undefined),
        defineProperty: () => false,
      });
      keyed[name] = part;
      return part;
    }
    const keyedExists = (name) => !removed.has(name) && (keyed[name]?.created || isRecord(base[name]));
    const helpers = Object.freeze({
      /** Keys of sessions whose record satisfies `predicate`. Records are shown as stored: do not change them. */
      scanSessions(predicate) {
        const part = keyedPart('sessions'), found = [];
        for (const [key, record] of Object.entries(base.sessions)) if (!part.deleted.has(key) && predicate(part.copies.get(key) ?? record, key)) found.push(key);
        for (const [key, record] of part.copies) if (!Object.hasOwn(base.sessions, key) && predicate(record, key)) found.push(key);
        return found;
      },
      sessionKeyByPublicId(id) {
        const part = keyedPart('sessions');
        for (const [key, record] of part.copies) if (record?.publicId === id) return key;
        const key = keyOfPublicId.get(id);
        return key !== undefined && !part.deleted.has(key) && !part.copies.has(key) ? key : undefined;
      },
    });
    const db = new Proxy({}, {
      get(target, key) {
        if (key === '$store') return helpers;
        if (typeof key !== 'string' || removed.has(key)) return undefined;
        if (key === 'version') return base.version;
        if (KEYED.includes(key)) return keyedExists(key) ? keyedPart(key).proxy : undefined;
        if (parts.has(key)) return parts.get(key);
        if (!Object.hasOwn(base, key)) return undefined;
        const copy = structuredClone(base[key]);
        parts.set(key, copy);
        return copy;
      },
      set(target, key, value) {
        if (typeof key !== 'string' || key === 'version' || key === '$store') return false;
        removed.delete(key);
        if (KEYED.includes(key)) {
          if (!isRecord(value)) return false;
          const part = keyedPart(key);
          if (value === part.proxy) return true;
          // Replacing the whole map: everything stored is dropped and the given entries take its place.
          for (const old of Object.keys(isRecord(base[key]) ? base[key] : {})) part.deleted.add(old);
          part.copies.clear(); part.created = true;
          for (const [entry, record] of Object.entries(value)) { part.copies.set(entry, record); part.deleted.delete(entry); }
          return true;
        }
        parts.set(key, value);
        return true;
      },
      has: (target, key) => typeof key === 'string' && !removed.has(key) && (key === 'version' || (KEYED.includes(key) ? keyedExists(key) : parts.has(key) || Object.hasOwn(base, key))),
      deleteProperty(target, key) { if (typeof key !== 'string' || key === 'version' || key === 'sessions') return false; parts.delete(key); delete keyed[key]; removed.add(key); return true; },
      ownKeys() {
        const keys = new Set(['version']);
        for (const key of Object.keys(base)) keys.add(key);
        for (const key of parts.keys()) keys.add(key);
        for (const name of KEYED) if (keyed[name]?.created) keys.add(name);
        for (const key of removed) keys.delete(key);
        return [...keys];
      },
      getOwnPropertyDescriptor(target, key) { return this.has(target, key) ? { value: undefined, writable: true, enumerable: true, configurable: true } : undefined; },
      defineProperty: () => false,
    });
    /**
     * Apply the working copies to `base`. Returns the steps that undo exactly this commit (run them
     * newest first); the list is empty when the transaction touched nothing.
     */
    function commit() {
      const undo = [];
      const forget = (key) => { partText.delete(key); if (KEYED.includes(key)) textOf[key].clear(); };
      for (const key of removed) if (Object.hasOwn(base, key)) {
        const old = base[key];
        delete base[key]; forget(key);
        undo.push(() => { base[key] = old; forget(key); });
      }
      for (const name of KEYED) {
        const part = keyed[name];
        if (!part) continue;
        if (part.created && !isRecord(base[name])) {
          const had = Object.hasOwn(base, name), old = base[name];
          base[name] = {};
          undo.push(() => { if (had) base[name] = old; else delete base[name]; textOf[name].clear(); });
        }
        if (!isRecord(base[name])) continue;
        const map = base[name];
        const put = (key, record, remove) => {
          const had = Object.hasOwn(map, key), old = map[key];
          if (remove) delete map[key]; else map[key] = record;
          textOf[name].delete(key); if (name === 'sessions') indexSession(key, remove ? null : record);
          undo.push(() => {
            if (had) map[key] = old; else delete map[key];
            textOf[name].delete(key); if (name === 'sessions') indexSession(key, had ? old : null);
          });
        };
        for (const key of part.deleted) put(key, undefined, true);
        for (const [key, record] of part.copies) put(key, record, false);
      }
      for (const [key, value] of parts) {
        const had = Object.hasOwn(base, key), old = base[key];
        base[key] = value; partText.delete(key);
        undo.push(() => { if (had) base[key] = old; else delete base[key]; partText.delete(key); });
      }
      return undo;
    }
    return { db, commit };
  }

  function serialise() {
    const out = [`"version":${JSON.stringify(base.version)}`];
    for (const name of KEYED) {
      if (!isRecord(base[name])) continue;
      const cache = textOf[name], entries = [];
      for (const [key, record] of Object.entries(base[name])) {
        let text = cache.get(key);
        if (text === undefined) { text = JSON.stringify(record) ?? 'null'; cache.set(key, text); }
        entries.push(`${JSON.stringify(key)}:${text}`);
      }
      out.push(`${JSON.stringify(name)}:{${entries.join(',')}}`);
    }
    for (const [key, value] of Object.entries(base)) {
      if (key === 'version' || KEYED.includes(key)) continue;
      let text = partText.get(key);
      if (text === undefined) { text = JSON.stringify(value); if (text === undefined) continue; partText.set(key, text); }
      out.push(`${JSON.stringify(key)}:${text}`);
    }
    return `{${out.join(',')}}`;
  }

  let queue = Promise.resolve();
  let commitSeq = 0, flushedSeq = 0, flushing = null, lazyTimer = null, closed = false;
  let nextFlushAt = 0;
  // Commits that are in memory but not yet on disk, oldest first:
  //   { seq, durable, undo: [step], hooks: [fn], failed: Error | null }
  // `hooks` are the commit listeners waiting for this commit's write (its own, and those of later
  // transactions that committed on top of it). `failed` is set when a failed write undid the commit.
  const unflushed = [];
  // Counts failed writes that undid commits. A transaction (or read) that was running across one
  // may have seen state that no longer exists, so it is rejected with `lastFailure` instead.
  let epoch = 0, lastFailure = null;
  /** The newest durable commit still waiting for its write, or null. Anything committed now builds on it. */
  let pendingDurable = null;
  const runHook = (hook) => { try { hook(); } catch (error) { console.error('Commit listener failed:', error.message); } };
  /** A write holding every commit up to `upto` is on disk: those commits are final, so tell their listeners, in order. */
  function landed(upto) {
    flushedSeq = Math.max(flushedSeq, upto);
    if (pendingDurable && pendingDurable.seq <= upto) pendingDurable = null;
    let done = 0;
    while (done < unflushed.length && unflushed[done].seq <= upto) done += 1;
    for (const record of unflushed.splice(0, done)) for (const hook of record.hooks) runHook(hook);
  }
  /**
   * The write holding every commit up to `upto` failed. Undo the first durable commit it carried
   * and everything committed after it (newest first), so memory holds nothing that was rejected.
   * Lazy commits made before that point stay: they depend on nothing that failed and are written later.
   */
  function rollBack(upto, error) {
    const first = unflushed.findIndex((record) => record.durable && record.seq <= upto);
    if (first < 0) return; // only lazy commits were in that write: nothing was promised, it is tried again
    const dropped = unflushed.splice(first);
    for (let i = dropped.length - 1; i >= 0; i--) {
      const record = dropped[i];
      for (let step = record.undo.length - 1; step >= 0; step--) record.undo[step]();
      record.undo.length = 0; record.hooks.length = 0; record.failed = error;
    }
    stats.aborted += dropped.length;
    pendingDurable = null; // every durable commit still waiting was at or after `first`
    epoch += 1; lastFailure = error;
    if (!unflushed.length) flushedSeq = commitSeq; // memory equals the file again: there is nothing left to write
  }
  function startFlush() {
    const work = (async () => {
      // Write budget: after a write of B bytes the next one may start B / writeBytesPerMs later, so
      // the disk never takes more than the budget however many actions arrive. Commits made while
      // waiting are part of the write that follows, which is why the text is built after the wait.
      const wait = nextFlushAt - Date.now();
      if (wait > 0) await new Promise((done) => setTimeout(done, Math.min(wait, MAX_WRITE_PAUSE_MS)));
      const upto = commitSeq;
      let text;
      try { text = serialise(); await writeOut(text); } catch (error) { rollBack(upto, error); throw error; }
      landed(upto);
      nextFlushAt = Date.now() + text.length / writeBytesPerMs;
    })().finally(() => { if (flushing === work) flushing = null; });
    flushing = work;
    return work;
  }
  /**
   * Resolve once a write containing commit `seq` is on disk. `dep` is the durable commit the caller
   * depends on (its own, or the one it committed on top of): if a failed write undoes it, reject
   * with that write's error. Without `dep` a failed write of our own rejects and nothing is undone.
   */
  async function onDisk(seq, dep = null) {
    while (flushedSeq < seq) {
      if (dep?.failed) throw dep.failed;
      if (flushing) { try { await flushing; } catch { /* its outcome is read from `dep` and `flushedSeq` above */ } continue; }
      try { await startFlush(); } catch (error) { throw dep?.failed ?? error; }
    }
    if (dep?.failed) throw dep.failed;
  }
  function scheduleLazy() {
    if (lazyTimer || closed) return;
    lazyTimer = setTimeout(() => {
      lazyTimer = null;
      if (flushedSeq >= commitSeq) return;
      // A failed lazy write is not given up on: it is tried again after the same interval.
      onDisk(commitSeq).catch((error) => { if (error?.code !== 'ENOENT') console.error('Store write failed:', error.message); scheduleLazy(); });
    }, lazyFlushMs);
    lazyTimer.unref?.();
  }

  return {
    transact(operation, { durable = true, committed, waitForDurable = false } = {}) {
      const work = queue.then(async () => {
        stats.transactions += 1;
        const view = open(), opened = epoch;
        let value;
        try { value = await operation(view.db); } catch (error) { stats.aborted += 1; throw error; }
        // A write failed while this ran and commits it may have read were undone: it cannot commit on top of them.
        if (opened !== epoch) { stats.aborted += 1; throw lastFailure; }
        // `durable` may be a function of the result, so a request can decide after it has run
        // whether it acknowledged anything (a poll that completed an activity did; a quiet one did not).
        const wait = typeof durable === 'function' ? durable(value) !== false : durable !== false;
        const undo = view.commit();
        if (undo.length) {
          const record = { seq: commitSeq += 1, durable: wait, undo, hooks: [], failed: null };
          unflushed.push(record);
          if (wait) pendingDurable = record;
        }
        // The durable commit this one stands on (possibly itself). While it waits for its write this
        // commit is not final either, so its listener waits with it; with none pending it is final now.
        const dep = pendingDurable;
        if (committed) { const hook = () => committed(value); if (dep) dep.hooks.push(hook); else runHook(hook); }
        return { value, seq: commitSeq, wait, dep };
      });
      queue = work.catch(() => {});
      return work.then(async ({ value, seq, wait, dep }) => {
        if (wait) await onDisk(seq, dep);
        else {
          stats.lazy += 1; if (flushedSeq < seq) scheduleLazy();
          // The caller will act on what this read: wait for the durable commit it stood on (never for its own lazy change).
          if (waitForDurable && dep) await onDisk(dep.seq, dep);
        }
        return value;
      });
    },
    read(operation) {
      stats.reads += 1;
      const work = queue.then(async () => {
        const opened = epoch, value = await operation(open().db);
        if (opened !== epoch) throw lastFailure;
        return { value, dep: pendingDurable };
      });
      queue = work.catch(() => {});
      return work.then(async ({ value, dep }) => { if (dep) await onDisk(dep.seq, dep); return value; });
    },
    async flush() { await queue; await onDisk(commitSeq); },
    async close() { closed = true; if (lazyTimer) { clearTimeout(lazyTimer); lazyTimer = null; } await queue; await onDisk(commitSeq); },
    stats: () => ({ ...stats }),
  };
}
