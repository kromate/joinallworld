// OWNER: politics — the public record: an append-only, hash-chained list of what the world's government did. Design: docs/POLITICS.md.
// Portable: plain objects only. Only public ids, names and counts are stored — never who voted for whom, and never a session secret.
//
// db.records = {
//   v: 1, seq: last entry number, head: hash of the last entry (GENESIS before the first), 
//   entries: { [`e<8-digit n>`]: { n, at, kind, scope, scopeName, week, title, facts, prev, hash } }   one stored entry each (keyed.ts)
//   terms:   { [`<scope>|<week>`]: n }                                                                  the terms already written, so each is written once
// }
// Nothing is ever edited or removed. An operator's action is itself an entry, with its reason.
import { GENESIS, entryHash } from '../../src/records/chain.ts';
import type { ChainEntry } from '../../src/records/chain.ts';
import type { RecordFacts, RecordKind } from '../../src/types/records.ts';
import type { Db, RouteContext } from '../types.ts';

export interface RecordsCollection {
  v: 1
  seq: number
  head: string
  entries: Record<string, ChainEntry>
  terms: Record<string, number>
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const emptyRecords = (): RecordsCollection => ({ v: 1, seq: 0, head: GENESIS, entries: {}, terms: {} });
export const keyOf = (n: number): string => `e${String(n).padStart(8, '0')}`;

/** The collection, created or repaired in place so damaged data cannot crash a route. */
export function recordsOf(ctx: Pick<RouteContext, 'collection'>, db: Db): RecordsCollection {
  const found = ctx.collection(db, 'records', emptyRecords()) as Partial<RecordsCollection>;
  if (typeof found.seq !== 'number' || !Number.isSafeInteger(found.seq) || found.seq < 0) found.seq = 0;
  if (typeof found.head !== 'string' || found.head.length !== 64) found.head = GENESIS;
  if (!record(found.entries)) found.entries = {};
  if (!record(found.terms)) found.terms = {};
  found.v = 1;
  return found as RecordsCollection;
}
/** The collection as a read sees it: nothing is created. */
export const peekRecords = (db: Db): RecordsCollection => {
  const found = (db as unknown as Record<string, unknown>).records;
  return record(found) && record(found.entries) && record(found.terms) && typeof found.seq === 'number' && typeof found.head === 'string' ? found as unknown as RecordsCollection : emptyRecords();
};

export interface NewEntry { kind: RecordKind; scope: string; scopeName: string; week: number | null; title: string; facts: RecordFacts }

/** The most entries one page reads. */
export const SCAN_MAX = 1500;
const clean = (text: string, max: number): string => text.replace(/\s+/g, ' ').trim().slice(0, max);

/** Add one entry to the end of the chain. */
export function append(records: RecordsCollection, now: number, entry: NewEntry): ChainEntry {
  const n = records.seq + 1;
  const facts: RecordFacts = {};
  for (const [key, value] of Object.entries(entry.facts).slice(0, 12)) facts[clean(key, 24)] = typeof value === 'string' ? clean(value, 160) : value;
  const body = { n, at: now, kind: entry.kind, scope: clean(entry.scope, 40), scopeName: clean(entry.scopeName, 60), week: entry.week, title: clean(entry.title, 280), facts };
  const written: ChainEntry = { ...body, prev: records.head, hash: entryHash(body, records.head) };
  records.entries[keyOf(n)] = written;
  records.seq = n;
  records.head = written.hash;
  return written;
}

/** The newest `limit` entries before `before` (an entry number), newest first, optionally of one scope or kind. */
export function page(records: RecordsCollection, { before, limit, scope, kind }: { before?: number; limit: number; scope?: string; kind?: RecordKind }): { entries: ChainEntry[]; before: number | null } {
  const found: ChainEntry[] = [];
  let next: number | null = null, scanned = 0;
  for (let n = Math.min(records.seq, before !== undefined ? before - 1 : records.seq); n >= 1; n--) {
    // A filtered page looks at a bounded number of entries: past that it hands back where it got to, and the reader asks again from there.
    if (++scanned > SCAN_MAX) { next = n + 1; break; }
    const entry = records.entries[keyOf(n)];
    if (!entry) continue;
    if ((scope && entry.scope !== scope) || (kind && entry.kind !== kind)) continue;
    if (found.length >= limit) { next = found[found.length - 1]?.n ?? null; break; }
    found.push(entry);
  }
  return { entries: found, before: next };
}
