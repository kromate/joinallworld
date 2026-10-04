/**
 * OWNER: world
 * SHARD STORE — one append-only log per shard, opened lazily. This file is the store itself and is portable (no Node
 * imports): where a log is kept is a BACKEND. server/world/shards.js keeps each one in a file (the Node host);
 * deploy/sqlite-shards.js keeps them in the Durable Object's SQLite (the Worker host). Both run this same code, so the
 * guarantee, the bounded reads, the group commit and the compaction below are the same on both hosts.
 *
 * The main store (server/store.js) is one JSON document rewritten whole; it cannot hold a hundred
 * thousand residents of one local government, let alone twenty of them. The world registry is
 * therefore kept beside it, one shard per local government: `<dataDir>/world/<city>.<lga>.log`.
 *
 * THE INTERFACE (what server/world/service.js relies on)
 *   transact(name, fn(state) → { records?: [...], result })  → Promise<result>
 *       `fn` reads the shard's in-memory state and returns the records that change it. It must not
 *       change the state itself: the store applies the records through `reduce`, the same function
 *       that rebuilds the state from the file, so memory and file can never be two code paths.
 *   read(name, fn(state) → result)                            → Promise<result>
 *   peek(name)       → the state if the shard is open, else null (never loads anything)
 *   readMeta() / writeMeta(value)   one small derived JSON file beside the shards (the city summary)
 *   stats()          → counters (loads, recordsRead, appends, bytes, compactions, open, …)
 *   flush(), close()
 *
 * THE GUARANTEE (the same one as the main store)
 *   A transaction whose promise REJECTS has no effect: not in memory, not in the file, not later.
 *   A transaction whose promise RESOLVES is in the file (appended; not fsynced, so it survives a
 *   crash of the process, not necessarily a power cut).
 *   Transactions on one shard run one after another. Their records are applied to memory at once
 *   and appended together with those of the transactions queued behind them (group commit). If
 *   the append fails, every transaction whose records were not yet in the file is rejected with
 *   { status: 503, code: 'storage_unavailable' } and the shard's memory is thrown away: the next
 *   use reads the file again, so memory is exactly what the file holds.
 *   A line that was cut off by a crash (the last one of a file, not valid JSON) is ignored when the
 *   file is read and removed by the next compaction.
 *
 * WHAT ONE REQUEST COSTS
 *   Warm shard: no file read; one append of the request's own records (tens to a few hundred bytes).
 *   Cold shard: the file of ONE shard is read and replayed once (bounded by the shard's caps), then
 *   it stays open. At most `maxOpen` shards are in memory; the least recently used one that has
 *   nothing unwritten is closed to make room. No request reads or rewrites another shard.
 *   COMPACTION rewrites one shard's file from its state (temporary file, then rename) when the log
 *   holds more than twice the records the state needs: amortised, one shard at a time, never on
 *   the path of more than one request in that many.
 *
 * THE BACKEND (all async; a rejection means "not saved")
 *   read(name)            → the shard's whole log as text ('' when it does not exist)
 *   append(name, text)    add complete lines to the end of the log
 *   replace(name, text)   put `text` in place of the whole log, atomically (compaction)
 *   size(name)            → bytes of the log (0 when it does not exist)
 *   readMeta() / writeMeta(value)   one small derived JSON value beside the shards
 */
import { storageError } from '../protocol.js';

const encoder = new TextEncoder();
const byteLength = (text) => encoder.encode(text).length;

const NAME = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$/;

export const SHARD_NAME = NAME;

export function createShardStoreOn(backend, { empty, reduce, snapshot, loaded = (state) => state, live = () => 0, maxOpen = 8, compactSlack = 2000, log = (line) => console.error(line) } = {}) {
  if (typeof empty !== 'function' || typeof reduce !== 'function' || typeof snapshot !== 'function') throw new Error('A shard store needs empty(), reduce() and snapshot()');
  for (const method of ['read', 'append', 'replace', 'size', 'readMeta', 'writeMeta']) if (typeof backend?.[method] !== 'function') throw new Error(`A shard backend needs ${method}()`);
  const stats = { loads: 0, recordsRead: 0, appends: 0, records: 0, bytes: 0, compactions: 0, failures: 0, evictions: 0, torn: 0 };
  const shards = new Map(); // name → { state, lines, bytes, queue, pending: [{ text, resolve, reject }], flushing, used }
  let tick = 0, closed = false;

  async function load(name) {
    const text = await backend.read(name);
    const state = empty(name);
    let lines = 0;
    for (let start = 0; start < text.length;) {
      let end = text.indexOf('\n', start);
      const last = end < 0;
      if (last) end = text.length;
      if (end > start) {
        let record = null;
        try { record = JSON.parse(text.slice(start, end)); } catch { record = null; }
        // Only the very last line may be damaged (a crash in the middle of an append); anything else is corruption.
        if (!Array.isArray(record)) { if (!last && text.indexOf('\n', end + 1) >= 0) throw new Error(`Corrupt world shard ${name}: line ${lines + 1}`); stats.torn += 1; }
        else { reduce(state, record); lines += 1; }
      }
      start = end + 1;
    }
    loaded(state);
    stats.loads += 1; stats.recordsRead += lines;
    return { state, lines, bytes: byteLength(text), queue: Promise.resolve(), pending: [], flushing: null, used: ++tick, broken: false };
  }
  /** The open shard, loading it (and closing the least recently used idle one) if needed. */
  async function open(name) {
    if (!NAME.test(name)) throw new Error(`Invalid shard name: ${name}`);
    let shard = shards.get(name);
    if (shard && !(shard instanceof Promise) && shard.broken) { shards.delete(name); shard = undefined; }
    if (!shard) {
      const loading = load(name).then((loaded) => { shards.set(name, loaded); return loaded; }, (error) => { shards.delete(name); throw error; });
      shards.set(name, loading);
      shard = loading;
    }
    const ready = await shard;
    ready.used = ++tick;
    if (shards.size > maxOpen) {
      const idle = [...shards].filter(([key, item]) => key !== name && !(item instanceof Promise) && !item.pending.length && !item.flushing && !item.busy).sort((a, b) => a[1].used - b[1].used);
      for (const [key] of idle.slice(0, shards.size - maxOpen)) { shards.delete(key); stats.evictions += 1; }
    }
    return ready;
  }

  async function compact(name, shard) {
    const records = snapshot(shard.state);
    const text = records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
    await backend.replace(name, text);
    shard.lines = records.length; shard.bytes = byteLength(text);
    stats.compactions += 1;
  }
  /** Append everything that is waiting. One write for however many transactions queued up meanwhile. */
  function flush(name, shard) {
    if (shard.flushing || !shard.pending.length) return shard.flushing;
    const batch = shard.pending.splice(0);
    const text = batch.map((item) => item.text).join('');
    shard.flushing = (async () => {
      try {
        await backend.append(name, text);
        stats.appends += 1; stats.bytes += byteLength(text);
        shard.bytes += byteLength(text);
        for (const item of batch) item.resolve();
      } catch (error) {
        // Not in the file means not done: this batch and whatever was applied on top of it are rejected,
        // and the shard is read again from the file the next time it is used.
        stats.failures += 1; shard.broken = true;
        try { log(`World shard ${name} could not be written (${error?.code || 'error'}): its unsaved changes were undone.`); } catch { /* a failing logger changes nothing */ }
        const failure = storageError(error);
        for (const item of [...batch, ...shard.pending.splice(0)]) item.reject(failure);
      } finally { shard.flushing = null; if (!shard.broken && shard.pending.length) flush(name, shard); }
    })();
    return shard.flushing;
  }

  async function transact(name, fn) {
    if (closed) throw storageError(new Error('closed'));
    for (;;) {
      const shard = await open(name);
      if (shard.broken) continue;
      let done;
      const work = shard.queue.then(async () => {
        if (shard.broken) return { retry: true };
        shard.busy = true;
        try {
          const outcome = (await fn(shard.state)) || {};
          const records = Array.isArray(outcome.records) ? outcome.records : [];
          if (!records.length) return { value: outcome.result, saved: Promise.resolve() };
          let text = '';
          for (const record of records) { reduce(shard.state, record); text += `${JSON.stringify(record)}\n`; }
          shard.lines += records.length; stats.records += records.length;
          const saved = new Promise((resolve, reject) => shard.pending.push({ text, resolve, reject }));
          flush(name, shard);
          return { value: outcome.result, saved };
        } finally { shard.busy = false; }
      });
      shard.queue = work.then(() => {}, () => {});
      done = await work;
      if (done.retry) continue;
      await done.saved;
      // Keep the file from growing without bound: rewrite it from the state once it is mostly history.
      if (shard.lines > live(shard.state) * 2 + compactSlack && !shard.compacting && !shard.broken) {
        shard.compacting = true;
        shard.queue = shard.queue.then(async () => {
          try { if (shard.flushing) await shard.flushing.catch(() => {}); if (!shard.broken && !shard.pending.length) await compact(name, shard); }
          catch (error) { try { log(`World shard ${name} could not be compacted: ${error?.message}`); } catch { /* ignore */ } }
          finally { shard.compacting = false; }
        });
      }
      return done.value;
    }
  }
  async function read(name, fn) {
    for (;;) {
      const shard = await open(name);
      if (shard.broken) continue;
      const work = shard.queue.then(() => (shard.broken ? { retry: true } : { value: fn(shard.state) }));
      shard.queue = work.then(() => {}, () => {});
      const done = await work;
      if (done.retry) continue;
      // A read never shows something that is not in the file: it waits for the append in flight.
      if (shard.flushing || shard.pending.length) { try { await (shard.flushing || flush(name, shard)); } catch { /* handled below */ } if (shard.broken) continue; }
      return done.value;
    }
  }
  const settled = async () => { for (const [name, shard] of shards) { if (shard instanceof Promise) { await shard.catch(() => {}); continue; } await shard.queue; if (shard.pending.length) await flush(name, shard); if (shard.flushing) await shard.flushing; } };

  return {
    transact, read,
    peek(name) { const shard = shards.get(name); return shard && !(shard instanceof Promise) && !shard.broken ? shard.state : null; },
    /** Bytes of the shard's file as this process knows it (0 when it has never been opened here and does not exist). */
    async size(name) { const shard = shards.get(name); if (shard && !(shard instanceof Promise)) return shard.bytes; try { return await backend.size(name); } catch { return 0; } },
    /** Rewrite one shard's file from its state now (used by the load generator to report the compact size). */
    async compact(name) { const shard = await open(name); await shard.queue; if (shard.flushing) await shard.flushing; await compact(name, shard); return shard.bytes; },
    open: () => [...shards.keys()],
    /** One small JSON file beside the shards (the city summary). Derived data: losing it costs a re-count, nothing else. */
    async readMeta() { try { return (await backend.readMeta()) ?? null; } catch { return null; } },
    writeMeta: (value) => backend.writeMeta(value),
    stats: () => ({ ...stats, open: shards.size }),
    flush: settled,
    async close() { await settled(); closed = true; },
  };
}
