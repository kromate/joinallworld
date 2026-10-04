import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

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
const KEYED = ['sessions', 'archivedLives'];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The longest a write is held back by the write budget, whatever the file size (an action must still be answered). */
const MAX_WRITE_PAUSE_MS = 2000;

/** What a caller gets when the file could not be written. Carries the HTTP shape the route host answers with. */
export function storageError(cause) {
  return Object.assign(new Error('storage_unavailable'), { status: 503, code: 'storage_unavailable',
    reason: 'The server could not save this, so nothing was changed. Try again in a moment.', cause });
}
/** Objects this module has frozen all the way down (so a second visit, or a cycle, stops). */
const frozen = new WeakSet();
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (frozen.has(item)) continue;
    frozen.add(item);
    Object.freeze(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) if (child !== null && typeof child === 'object') stack.push(child);
  }
  return value;
}

export async function createStore(dataDir, { lazyFlushMs = 1000, writeMegabytesPerSecond = Number(process.env.STORE_WRITE_MB_PER_S || 50),
  io = {}, now = Date.now, log = (line) => console.error(line), mode } = {}) {
  if (mode !== undefined && mode !== 'grouped') throw new Error(`Unknown store mode "${mode}": there is one store now (STORE_MODE=legacy was removed).`);
  if (!Number.isFinite(writeMegabytesPerSecond) || writeMegabytesPerSecond <= 0) throw new Error('Invalid STORE_WRITE_MB_PER_S');
  const writeBytesPerMs = writeMegabytesPerSecond * 1000;
  const write = io.writeFile ?? writeFile, move = io.rename ?? rename;
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
  const stats = { mode: 'grouped', transactions: 0, lazy: 0, reads: 0, writes: 0, bytes: 0, aborted: 0, writeFailures: 0, undone: 0, failing: false, lastFailureAt: null };
  const temporary = `${file}.tmp`;
  async function writeOut(text) {
    await write(temporary, text, { mode: 0o600 });
    await move(temporary, file);
    stats.writes += 1; stats.bytes += text.length;
  }

  const base = database;
  for (const name of KEYED) if (base[name] !== undefined && !isRecord(base[name])) throw new Error('Invalid device database');
  // Stored values are frozen; the containers they sit in (the document, the session map) are not.
  for (const [key, value] of Object.entries(base)) { if (KEYED.includes(key)) Object.values(value).forEach(deepFreeze); else deepFreeze(value); }
  const textOf = { sessions: new Map(), archivedLives: new Map() }; // key → cached JSON text of one entry
  const partText = new Map(); // other top-level key → cached JSON text
  const keyOfPublicId = new Map(), publicIdOfKey = new Map();
  function indexSession(key, record) {
    const old = publicIdOfKey.get(key);
    if (old !== undefined && keyOfPublicId.get(old) === key) keyOfPublicId.delete(old);
    publicIdOfKey.delete(key);
    if (record && typeof record.publicId === 'string') { keyOfPublicId.set(record.publicId, key); publicIdOfKey.set(key, record.publicId); }
  }
  function reindex() { keyOfPublicId.clear(); publicIdOfKey.clear(); for (const [key, record] of Object.entries(base.sessions)) indexSession(key, record); }
  reindex();

  /** The working view one transaction (or read) sees. Nothing reaches `base` until commit(). */
  function open() {
    const keyed = {}; // name → { copies: Map, deleted: Set, created: boolean, proxy }
    const parts = new Map(), removed = new Set();
    let scanned = false; // looked across every session (a scan, a lookup by public id, a key listing)
    const peeked = new Set(); // asked "is it there?" without reading it
    function keyedPart(name) {
      if (keyed[name]) return keyed[name];
      const part = { copies: new Map(), deleted: new Set(), created: false };
      const source = () => (isRecord(base[name]) ? base[name] : {});
      const has = (key) => { if (typeof key !== 'string') return false; peeked.add(`${name}/${key}`); return !part.deleted.has(key) && (part.copies.has(key) || Object.hasOwn(source(), key)); };
      part.proxy = new Proxy({}, {
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
    const keyedExists = (name) => !removed.has(name) && (keyed[name]?.created || isRecord(base[name]));
    const helpers = Object.freeze({
      /** Keys of sessions whose record satisfies `predicate`. Records are shown as stored: do not change them. */
      scanSessions(predicate) {
        scanned = true;
        const part = keyedPart('sessions'), found = [];
        for (const [key, record] of Object.entries(base.sessions)) if (!part.deleted.has(key) && predicate(part.copies.get(key) ?? record, key)) found.push(key);
        for (const [key, record] of part.copies) if (!Object.hasOwn(base.sessions, key) && predicate(record, key)) found.push(key);
        return found;
      },
      sessionKeyByPublicId(id) {
        scanned = true;
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
        if (!Object.hasOwn(base, key)) { peeked.add(key); return undefined; }
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
      has: (target, key) => { if (typeof key === 'string') peeked.add(key); return typeof key === 'string' && !removed.has(key) && (key === 'version' || (KEYED.includes(key) ? keyedExists(key) : parts.has(key) || Object.hasOwn(base, key))); },
      deleteProperty(target, key) { if (typeof key !== 'string' || key === 'version' || key === 'sessions') return false; parts.delete(key); delete keyed[key]; removed.add(key); return true; },
      ownKeys() {
        scanned = true;
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
     * Apply this view to the document. Returns null when nothing was touched, otherwise the list of
     * steps that put the document back exactly as it was (run them last-to-first).
     */
    function commit() {
      const undo = [];
      const restoreTop = (key, had, old) => undo.push(() => { if (had) base[key] = old; else delete base[key]; partText.delete(key); if (KEYED.includes(key)) { textOf[key].clear(); if (key === 'sessions') reindex(); } });
      for (const key of removed) if (Object.hasOwn(base, key)) { restoreTop(key, true, base[key]); delete base[key]; partText.delete(key); if (KEYED.includes(key)) textOf[key].clear(); }
      for (const name of KEYED) {
        const part = keyed[name];
        if (!part) continue;
        if (part.created && !isRecord(base[name])) { restoreTop(name, Object.hasOwn(base, name), base[name]); base[name] = {}; }
        if (!isRecord(base[name])) continue;
        const map = base[name];
        const put = (key, record) => { if (record === undefined) delete map[key]; else map[key] = record; textOf[name].delete(key); if (name === 'sessions') indexSession(key, record ?? null); };
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
    function touched() {
      if (scanned) return null;
      const names = new Set([...parts.keys(), ...removed, ...peeked]);
      for (const name of KEYED) if (removed.has(name)) return null;
      for (const name of KEYED) { const part = keyed[name]; if (!part) continue; if (part.created) return null; for (const key of part.copies.keys()) names.add(`${name}/${key}`); for (const key of part.deleted) names.add(`${name}/${key}`); }
      return names;
    }
    return { db, commit, touched };
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
  // commitSeq: the last change applied to memory. flushedSeq: the last one known to be in the file.
  // durableSeq: the last applied change some caller is waiting to see in the file.
  // epoch: counts undo passes; work that started in an earlier epoch may have read state that is gone.
  let commitSeq = 0, durableSeq = 0, flushedSeq = 0, epoch = 0, flushing = null, lazyTimer = null, closed = false;
  let nextFlushAt = 0, lastError = null, lastLogAt = -Infinity, unlogged = 0;
  const pending = []; // applied, not yet in the file, oldest first: { seq, undo, hook, value, durable, names }
  /**
   * The newest unsaved change someone is waiting on (a durable one) that a view may have seen:
   * one that touched something the view touched. A view that looked across all sessions may have
   * seen any of them.
   */
  function observedBy(names) {
    if (names === null) return durableSeq;
    if (!pending.length) return 0;
    const list = [...names];
    let seq = 0;
    for (const entry of pending) if (entry.durable && entry.seq > seq && (entry.names === null || list.some((name) => entry.names.has(name)))) seq = entry.seq;
    return seq;
  }
  const lost = []; // { from, to, epoch }: change numbers undone by the pass that started `epoch`, newest last (bounded)
  const waiters = []; // { seq, resolve, reject } — callers waiting for change `seq` to be in the file
  /** A listener must never be able to stop the store: whatever it throws is logged and dropped. */
  function runHook(hook, value) {
    if (!hook) return;
    try { hook(value); } catch (error) { try { log(`Commit listener failed: ${String(error?.message ?? error).split('\n')[0]}`); } catch { /* nor may the logger */ } }
  }

  function noteFailure(error) {
    lastError = error; stats.writeFailures += 1; stats.failing = true; stats.lastFailureAt = now();
    // One line per failure burst, then at most one every 30 s with a count: an outage must not flood the log.
    try {
      if (now() - lastLogAt >= 30000 || now() < lastLogAt) { log(`Store write failed (${error?.code || 'error'}): ${error?.message}${unlogged ? ` — and ${unlogged} more since the last line` : ''}. Unsaved changes were undone.`); lastLogAt = now(); unlogged = 0; }
      else unlogged += 1;
    } catch { /* a failing logger must not stop the undo that follows */ }
  }
  /** The write holding every change up to `upto` is in the file. */
  function settle(upto) {
    flushedSeq = Math.max(flushedSeq, upto);
    stats.failing = false;
    while (pending.length && pending[0].seq <= upto) {
      const entry = pending.shift();
      runHook(entry.hook, entry.value);
    }
    release();
  }
  function release() { for (let i = 0; i < waiters.length;) { if (waiters[i].seq <= flushedSeq) waiters.splice(i, 1)[0].resolve(); else i += 1; } }
  /** A write failed: take back everything that is not in the file and reject everyone waiting on it. */
  function undoAll(error) {
    for (let i = pending.length - 1; i >= 0; i--) { const steps = pending[i].undo; for (let j = steps.length - 1; j >= 0; j--) steps[j](); }
    stats.undone += pending.length;
    // Remember which changes were taken back: a caller whose change (or whose read) was applied but who has
    // not yet asked for it to be on disk must be told it is gone, not that it is saved (see onDisk).
    pending.length = 0; epoch += 1;
    if (commitSeq > flushedSeq) { lost.push({ from: flushedSeq + 1, to: commitSeq, epoch }); if (lost.length > 64) lost.shift(); }
    flushedSeq = commitSeq; durableSeq = commitSeq; // memory is the file again
    const failure = storageError(error);
    for (const waiter of waiters.splice(0)) waiter.reject(failure);
  }
  function startFlush() {
    const work = (async () => {
      // Write budget: after a write of B bytes the next one may start B / writeBytesPerMs later, so
      // the disk never takes more than the budget however many actions arrive. Commits made while
      // waiting are part of the write that follows, which is why the text is built after the wait.
      const wait = nextFlushAt - Date.now();
      if (wait >= 1) await new Promise((done) => setTimeout(done, Math.min(wait, MAX_WRITE_PAUSE_MS))); // under a millisecond is not worth a timer
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
  function pump() {
    if (flushing) return;
    if (!pending.length) { release(); return; }
    if (waiters.length || closed) { startFlush(); return; }
    if (lazyTimer) return;
    lazyTimer = setTimeout(() => { lazyTimer = null; if (pending.length && !flushing) startFlush(); }, lazyFlushMs);
    lazyTimer.unref?.();
  }
  /** Resolve once change `seq` is in the file; reject (storage_unavailable) if it was undone instead. */
  function onDisk(seq, began = epoch) {
    // After an undo `flushedSeq` jumps to `commitSeq` ("memory is the file again"), so a change that was undone
    // AFTER the caller started (`began`, the caller's epoch) must be recognised by its own number: it was never written.
    if (lost.some((range) => range.epoch > began && seq >= range.from && seq <= range.to)) return Promise.reject(storageError(lastError));
    if (seq <= flushedSeq) return Promise.resolve();
    const promise = new Promise((resolve, reject) => waiters.push({ seq, resolve, reject }));
    pump();
    return promise;
  }
  return {
    transact(operation, { durable = true, committed, waitForObserved = false } = {}) {
      const work = queue.then(async () => {
        stats.transactions += 1;
        const view = open(), began = epoch;
        let value;
        try { value = await operation(view.db); } catch (error) { stats.aborted += 1; throw error; }
        // A write failed while this was running: what it read may have been undone. It changes nothing.
        if (epoch !== began) { stats.aborted += 1; throw storageError(lastError); }
        // `durable` may be a function of the result, so a request can decide after it has run
        // whether it acknowledged anything (a poll that completed an activity did; a quiet one did not).
        const wait = typeof durable === 'function' ? durable(value) !== false : durable !== false;
        const names = view.touched();
        const observed = observedBy(names); // unsaved durable changes of earlier transactions this one may have read
        const undo = view.commit();
        let seq = null;
        if (undo) { seq = commitSeq += 1; pending.push({ seq, undo, hook: committed, value, durable: wait, names }); if (wait) durableSeq = seq; }
        return { value, wait, seq, observed, began };
      });
      queue = work.catch(() => {});
      return work.then(async ({ value, wait, seq, observed, began }) => {
        if (wait) { await onDisk(seq ?? observed, began); if (seq === null) runHook(committed, value); return value; }
        stats.lazy += 1;
        if (seq === null) runHook(committed, value); else pump();
        if (waitForObserved) await onDisk(observed, began);
        return value;
      });
    },
    read(operation) {
      stats.reads += 1;
      const attempt = (tries) => {
        const work = queue.then(async () => { const began = epoch, view = open(); const value = await operation(view.db); return { value, seq: observedBy(view.touched()), stale: epoch !== began, began }; });
        queue = work.catch(() => {});
        return work.then(async ({ value, seq, stale, began }) => {
          if (!stale) { try { await onDisk(seq, began); return value; } catch (error) { if (error?.code !== 'storage_unavailable') throw error; } }
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
