import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * JSON file store (Node only). The storage interface the rest of the server relies on is just:
 *   transact(fn(db), { durable = true }?) → Promise<result>   serialised read-modify-write; a throw discards changes
 *                                                             (`durable` is a boolean, or a function of the result)
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
 *   been renamed into place — exactly the guarantee the previous store gave: an acknowledged
 *   action, receipt, message or payment is on disk. Transactions that commit while a write is in
 *   flight share the next write (group commit), so N concurrent actions cost about two writes,
 *   not N.
 *
 *   LAZY transactions ({ durable: false }) commit in memory and resolve at once; the file catches
 *   up with the next durable write or within `lazyFlushMs` (default 1 s), whichever is first. They
 *   are for requests that acknowledge nothing — a poll that only settles the clock. After a crash
 *   such a settlement is simply computed again from the last stored state. A request that turns
 *   out to have done something a player could see as an outcome (money moved, an activity
 *   finished) passes `durable` as a function and is then durable like any other.
 *
 *   read() never writes. It waits for durable commits it could have observed to reach the disk,
 *   so a reader is never shown a payment that a crash could still undo.
 *
 *   WRITE BUDGET. Every write is the whole file, so writes are paced: after writing B bytes the
 *   next write waits B / (STORE_WRITE_MB_PER_S, default 50 MB/s). A small file is never held back
 *   noticeably (400 KB → 8 ms); a large one trades a little action latency (at most 2 s) for a disk
 *   that is not rewritten hundreds of times a second. Commits arriving in the pause share one write.
 *
 *   Only what changed is re-serialised: each session's JSON text is cached and reused until a
 *   committed transaction touches that session.
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
 */
const KEYED = ['sessions', 'archivedLives'];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The longest a write is held back by the write budget, whatever the file size (an action must still be answered). */
const MAX_WRITE_PAUSE_MS = 2000;

export async function createStore(dataDir, { mode = process.env.STORE_MODE === 'legacy' ? 'legacy' : 'grouped', lazyFlushMs = 1000,
  writeMegabytesPerSecond = Number(process.env.STORE_WRITE_MB_PER_S || 50) } = {}) {
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
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, file);
    stats.writes += 1; stats.bytes += text.length;
  }

  if (mode === 'legacy') {
    let pending = Promise.resolve();
    return {
      transact(operation) {
        const work = pending.then(async () => {
          stats.transactions += 1;
          const next = structuredClone(database);
          let value;
          try { value = await operation(next); } catch (error) { stats.aborted += 1; throw error; }
          await writeOut(JSON.stringify(next));
          database = next;
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
    function commit() {
      let changed = false;
      for (const key of removed) if (Object.hasOwn(base, key)) { delete base[key]; partText.delete(key); if (KEYED.includes(key)) textOf[key].clear(); changed = true; }
      for (const name of KEYED) {
        const part = keyed[name];
        if (!part) continue;
        if (part.created && !isRecord(base[name])) { base[name] = {}; changed = true; }
        if (!isRecord(base[name])) continue;
        for (const key of part.deleted) { delete base[name][key]; textOf[name].delete(key); if (name === 'sessions') indexSession(key, null); changed = true; }
        for (const [key, record] of part.copies) { base[name][key] = record; textOf[name].delete(key); if (name === 'sessions') indexSession(key, record); changed = true; }
      }
      for (const [key, value] of parts) { base[key] = value; partText.delete(key); changed = true; }
      return changed;
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
  let commitSeq = 0, durableSeq = 0, flushedSeq = 0, flushing = null, lazyTimer = null, closed = false;
  let nextFlushAt = 0;
  function startFlush() {
    const work = (async () => {
      // Write budget: after a write of B bytes the next one may start B / writeBytesPerMs later, so
      // the disk never takes more than the budget however many actions arrive. Commits made while
      // waiting are part of the write that follows, which is why the text is built after the wait.
      const wait = nextFlushAt - Date.now();
      if (wait > 0) await new Promise((done) => setTimeout(done, Math.min(wait, MAX_WRITE_PAUSE_MS)));
      const upto = commitSeq, text = serialise();
      await writeOut(text);
      flushedSeq = Math.max(flushedSeq, upto);
      nextFlushAt = Date.now() + text.length / writeBytesPerMs;
    })().finally(() => { if (flushing === work) flushing = null; });
    flushing = work;
    return work;
  }
  /** Resolve once a write containing commit `seq` is on disk; reject if that write fails. */
  async function onDisk(seq) {
    while (flushedSeq < seq) {
      if (flushing) { try { await flushing; } catch { /* that write was not ours; try our own below */ } continue; }
      await startFlush();
    }
  }
  function scheduleLazy() {
    if (lazyTimer || closed) return;
    lazyTimer = setTimeout(() => {
      lazyTimer = null;
      if (flushedSeq < commitSeq) onDisk(commitSeq).catch((error) => { if (error?.code !== 'ENOENT') console.error('Store write failed:', error.message); });
    }, lazyFlushMs);
    lazyTimer.unref?.();
  }

  return {
    transact(operation, { durable = true } = {}) {
      const work = queue.then(async () => {
        stats.transactions += 1;
        const view = open();
        let value;
        try { value = await operation(view.db); } catch (error) { stats.aborted += 1; throw error; }
        // `durable` may be a function of the result, so a request can decide after it has run
        // whether it acknowledged anything (a poll that completed an activity did; a quiet one did not).
        const wait = typeof durable === 'function' ? durable(value) !== false : durable !== false;
        if (view.commit()) { commitSeq += 1; if (wait) durableSeq = commitSeq; }
        return { value, seq: commitSeq, wait };
      });
      queue = work.catch(() => {});
      return work.then(async ({ value, seq, wait }) => {
        if (wait) await onDisk(seq);
        else { stats.lazy += 1; if (flushedSeq < seq) scheduleLazy(); }
        return value;
      });
    },
    read(operation) {
      stats.reads += 1;
      const work = queue.then(async () => ({ value: await operation(open().db), seq: durableSeq }));
      queue = work.catch(() => {});
      return work.then(async ({ value, seq }) => { await onDisk(seq); return value; });
    },
    async flush() { await queue; await onDisk(commitSeq); },
    async close() { closed = true; if (lazyTimer) { clearTimeout(lazyTimer); lazyTimer = null; } await queue; await onDisk(commitSeq); },
    stats: () => ({ ...stats }),
  };
}
