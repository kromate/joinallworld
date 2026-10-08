/**
 * KEYED COLLECTIONS: the layer that lets a stored collection be kept ONE ENTRY AT A TIME while route code goes on seeing
 * the plain object it always saw (`db.social.players[id]`, `db.civic.cities.lagos.residents`, …).
 *
 * A collection that is listed in KEYED_SPECS is stored as
 *   a ROOT      the collection's JSON with every keyed map replaced by the marker `{"$keyed":"<map id>"}`
 *               (its scalars, its small maps and its arrays stay in it, in their own places), and
 *   ENTRIES     one stored text per key of each keyed map, in the order the keys were added.
 * A transaction reads the root, finds the markers and puts a lazy map in the marker's place. The map reads an entry the
 * first time somebody asks for it (the source answers from one row or one memory slot), hands out ONE parsed object per
 * key for the rest of the transaction, and at the end writes only the entries whose text changed, plus the root when
 * its text changed. Nothing here knows about SQLite or files: a host gives a LayerSource to read from and applies the
 * CollectionWrite list this returns (deploy/sqlite-store.ts, server/store.ts).
 *
 * WHAT STAYS THE SAME FOR ROUTE CODE
 *   - the same object shape and the same key order (integer-like keys first, ascending, then the order of adding —
 *     exactly what a plain object does), `in`, `delete`, `Object.keys/values/entries`, `for … in`, spread;
 *   - one object per key within a transaction, a fresh one in the next, so nothing mutated and not committed is ever
 *     seen again;
 *   - reads that mutate are harmless: a read never commits.
 * WHAT COSTS NOTHING TO ASK: whether a key exists (one point lookup), the number of keys, the key list (the keys only).
 * WHAT COSTS THE WHOLE MAP: asking for every value (`Object.values`, `Object.entries`, `for … of`). Those sites are
 * listed in docs/STORAGE.md; the ones that run on a request were given an index (keyedScan) or a bound.
 */

/**
 * How a host stores the collections in KEYED_SPECS. `legacy`: one JSON value each. `entries`: a root and one entry per key.
 * `shadow`: the legacy value is the truth while the entries are kept beside it and compared (the Worker only; Node's file
 * is the same in every layout, so on Node `shadow` is `legacy`).
 */
export type StoreLayout = 'legacy' | 'shadow' | 'entries'
export const parseLayout = (value: unknown): StoreLayout | undefined => (value === 'legacy' || value === 'shadow' || value === 'entries' ? value : undefined);

/** A projection of one entry, kept beside its text so that a scan can pick entries without reading and parsing all of them. */
export interface Projection {
  /** A number to compare (a last-seen time, an expiry). */
  n?: number | undefined
  /** Lower-case text to search in (a name). */
  t?: string | undefined
  /** A small JSON payload a scan returns with the key (a player's blocked ids). */
  j?: string | undefined
}
export type ProjectionName = 'socialPlayer' | 'socialPending' | 'growthPlayer' | 'growthShare' | 'growthComeback' | 'civicResident' | 'businessShop'
export interface KeyedSpec {
  /** Where the map is in the collection: `['players']`, `['cities', '*', 'residents']` (`*`: every key of the map before it). */
  readonly path: readonly string[]
  /** What a scan may ask of an entry (PROJECTIONS). */
  readonly project?: ProjectionName
}
/** What a scan may ask, ANDed together (`orKey` is ORed with `tContains`). An entry whose number is missing never matches a number test, except under `missing`. */
export interface ScanQuery {
  /** n < this. */
  nBelow?: number
  /** n >= this. */
  nAtLeast?: number
  /** With nBelow: entries that have no number match too (a record whose time is damaged is treated as the oldest). */
  missing?: boolean
  /** t contains this (lower-case). */
  tContains?: string
  /** An entry whose key is this matches whatever else was asked (a player is found by id as well as by name). */
  orKey?: string
  /** t is exactly this. */
  tEquals?: string
  /** j contains this text. */
  jIncludes?: string
  /** j is present. */
  hasJ?: boolean
}
export interface ScanHit { key: string; ord: number; /** The entry's number, when it has one. */ n?: number | undefined; /** The entry's `j`, when it has one. */ j?: string | undefined }
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const idList = (value: unknown): string[] => (isRecord(value) ? Object.keys(value) : []);
/** What each map tells a scan about its entries. Computed from the parsed entry when it is written (and in plain form by the legacy layout's scans). */
const PROJECTIONS: Readonly<Record<ProjectionName, (value: unknown) => Projection | undefined>> = Object.freeze({
  /** n: last seen. t: the name in lower case. j: { b: ids this player blocked, f: [the founder this player is automatic friends with, since], i: who invited them }. */
  socialPlayer: (value: unknown): Projection | undefined => {
    if (!isRecord(value)) return undefined;
    const j: { b?: string[]; f?: [string, number]; i?: string } = {}, blocked = idList(value['blocked']);
    if (blocked.length) j.b = blocked;
    const founder = value['founder'], friends = value['friends'];
    if (isRecord(founder) && typeof founder['id'] === 'string' && isRecord(friends) && typeof friends[founder['id']] === 'number') j.f = [founder['id'], friends[founder['id']] as number];
    const invite = value['invite'];
    if (isRecord(invite) && typeof invite['by'] === 'string') j.i = invite['by'];
    return { n: num(value['seen']), t: typeof value['name'] === 'string' ? value['name'].toLowerCase() : undefined, j: Object.keys(j).length ? JSON.stringify(j) : undefined };
  },
  /** n: the time of the oldest effect waiting. */
  socialPending: (value: unknown): Projection | undefined => {
    if (!Array.isArray(value)) return undefined;
    let oldest: number | undefined;
    for (const effect of value) { const at = isRecord(effect) ? num(effect['at']) : undefined; if (at !== undefined && (oldest === undefined || at < oldest)) oldest = at; }
    return { n: oldest };
  },
  growthPlayer: (value: unknown): Projection | undefined => (isRecord(value) ? { n: num(value['seen']) } : undefined),
  growthShare: (value: unknown): Projection | undefined => (isRecord(value) ? { n: num(value['at']) } : undefined),
  /** n: when to look at this player next. */
  growthComeback: (value: unknown): Projection | undefined => (isRecord(value) ? { n: num(value['next']) } : undefined),
  /** n: the last check-in. */
  civicResident: (value: unknown): Projection | undefined => (isRecord(value) ? { n: num(value['lastSeen']) } : undefined),
  /** A sound shop only. t: `city`, a NUL and `venue` of a shop that is open for customers. n: when a closed shop closed; 9e15 while it is open (it is never "old"). */
  businessShop: (value: unknown): Projection | undefined => {
    if (!isRecord(value) || !isRecord(value['by']) || typeof value['by']['id'] !== 'string' || typeof value['city'] !== 'string' || typeof value['venue'] !== 'string' || typeof value['type'] !== 'string') return undefined;
    const closed = value['status'] === 'closed';
    return { t: closed ? undefined : `${value['city']}\u0000${value['venue']}`, n: closed ? (num(value['closedAt']) ?? num(value['at'])) : 9e15 };
  },
});
/** Does an entry with this key and projection answer the query? */
export function matches(query: ScanQuery, key: string, projection: Projection | undefined): boolean {
  if (query.orKey !== undefined && key === query.orKey) return true;
  const p = projection ?? {};
  if (query.nBelow !== undefined && !(p.n !== undefined ? p.n < query.nBelow : query.missing === true)) return false;
  if (query.nAtLeast !== undefined && !(p.n !== undefined && p.n >= query.nAtLeast)) return false;
  if (query.tContains !== undefined && !(p.t !== undefined && p.t.includes(query.tContains))) return false;
  if (query.tEquals !== undefined && p.t !== query.tEquals) return false;
  if (query.jIncludes !== undefined && !(p.j !== undefined && p.j.includes(query.jIncludes))) return false;
  if (query.hasJ === true && p.j === undefined) return false;
  return true;
}
/** The projection an entry of a map has (the map is named by its spec). */
export const projectionOf = (name: ProjectionName | undefined, value: unknown): Projection | undefined => (name === undefined ? undefined : PROJECTIONS[name](value));

/** The collections kept per entry, and where their big maps are. Everything else in a collection stays in its root. */
export const KEYED_SPECS: Readonly<Record<string, readonly KeyedSpec[]>> = Object.freeze({
  social: [{ path: ['players'], project: 'socialPlayer' }, { path: ['convs'] }, { path: ['houses'] }, { path: ['pending'], project: 'socialPending' }],
  growth: [{ path: ['players'], project: 'growthPlayer' }, { path: ['shares'], project: 'growthShare' }, { path: ['comeback'], project: 'growthComeback' }, { path: ['push'] }, { path: ['contacts'] }],
  civic: [{ path: ['cities', '*', 'residents'], project: 'civicResident' }, { path: ['cities', '*', 'gov', 'elections'] }],
  business: [{ path: ['shops'], project: 'businessShop' }],
  commerce: [{ path: ['stores'] }],
  records: [{ path: ['entries'] }, { path: ['terms'] }],
  realValue: [{ path: ['listings'] }, { path: ['contacts'] }, { path: ['analytics'] }],
  trustChecks: [{ path: ['checks'] }],
  street: [{ path: ['journeys'] }],
  livingWorld: [{ path: ['driving'] }, { path: ['qualifications'] }],
});
export const isKeyedCollection = (name: string): boolean => Object.hasOwn(KEYED_SPECS, name);

const MARKER_KEY = '$keyed';
/** What stands in a root where a keyed map was. */
export const markerText = (id: string): string => `{"${MARKER_KEY}":${JSON.stringify(id)}}`;
const MARKER = /\{"\$keyed":("(?:[^"\\]|\\.)*")\}/g;
/** The id of one keyed map: its path with each `*` filled in by the key it stood for. */
const mapIdOf = (actual: readonly string[]): string => actual.map((segment) => encodeURIComponent(segment)).join('/');

/** Integer-like keys first and ascending, then the rest as they come: the order a plain object lists its keys in. */
export function plainOrder(keys: readonly string[]): string[] {
  const integers: [number, string][] = [], rest: string[] = [];
  for (const key of keys) {
    if (/^(?:0|[1-9]\d{0,9})$/.test(key) && Number(key) < 4294967295) integers.push([Number(key), key]); else rest.push(key);
  }
  if (!integers.length) return rest.length === keys.length ? rest : [...keys];
  return [...integers.sort((a, b) => a[0] - b[0]).map(([, key]) => key), ...rest];
}

/** Where the keyed maps of a value are: the holder of each, the key it sits under, and the map's id. */
interface Location { id: string; holder: Record<string, unknown>; key: string; value: unknown; spec: KeyedSpec }
function locate(root: unknown, specs: readonly KeyedSpec[]): Location[] {
  const found: Location[] = [];
  for (const spec of specs) {
    const path = spec.path;
    const walk = (node: unknown, depth: number, actual: readonly string[]): void => {
      if (!isRecord(node)) return;
      const segment = path[depth] as string;
      if (depth === path.length - 1) { if (Object.hasOwn(node, segment)) found.push({ id: mapIdOf([...actual, segment]), holder: node, key: segment, value: node[segment], spec }); return; }
      if (segment === '*') { for (const key of Object.keys(node)) walk(node[key], depth + 1, [...actual, key]); return; }
      if (Object.hasOwn(node, segment)) walk(node[segment], depth + 1, [...actual, segment]);
    };
    walk(root, 0, []);
  }
  return found;
}
/** The spec a map id belongs to (the path with the same shape). */
export function specOf(coll: string, id: string): KeyedSpec | undefined {
  const parts = id.split('/').map((part) => decodeURIComponent(part));
  return (KEYED_SPECS[coll] ?? []).find((spec) => spec.path.length === parts.length && spec.path.every((segment, at) => segment === '*' || segment === parts[at]));
}

// ---- splitting stored text without parsing it -----------------------------------------------------------------------

export interface SplitResult {
  /** The collection's text with each keyed map replaced by its marker. */
  rootText: string
  /** Each keyed map found, with its entries as stored text, in the order they were written. */
  maps: { id: string; entries: [string, string][] }[]
}
/**
 * Cut a collection's stored JSON text into its root and its entries WITHOUT parsing the entries: they are slices of the
 * text, so a 20 MB collection is never turned into 20 MB of objects (the Worker's memory is 128 MB). The text must be
 * valid JSON (it was made by JSON.stringify); a keyed map that is not an object in it is left in the root as it is.
 */
export function splitText(coll: string, text: string): SplitResult {
  const specs = KEYED_SPECS[coll] ?? [];
  const maps: SplitResult['maps'] = [], pieces: string[] = [];
  let copied = 0;
  const fail = (at: number): never => { throw new Error(`Collection ${coll} is not valid JSON near ${at}`); };
  const skipSpace = (at: number): number => { while (at < text.length) { const c = text.charCodeAt(at); if (c === 32 || c === 10 || c === 13 || c === 9) at += 1; else break; } return at; };
  /** `at` is the opening quote; the answer is the index after the closing one. */
  function skipString(at: number): number {
    let from = at + 1;
    for (;;) {
      const close = text.indexOf('"', from);
      if (close < 0) return fail(at);
      let back = close - 1, slashes = 0;
      while (back > at && text.charCodeAt(back) === 92) { slashes += 1; back -= 1; }
      if (slashes % 2 === 0) return close + 1;
      from = close + 1;
    }
  }
  function skipValue(start: number): number {
    const at = skipSpace(start), c = text.charCodeAt(at);
    if (c === 34) return skipString(at);
    if (c === 123 || c === 91) {
      let depth = 0, i = at;
      for (; i < text.length; i += 1) {
        const d = text.charCodeAt(i);
        if (d === 34) { i = skipString(i) - 1; continue; }
        if (d === 123 || d === 91) depth += 1;
        else if (d === 125 || d === 93) { depth -= 1; if (depth === 0) return i + 1; }
      }
      return fail(at);
    }
    let i = at;
    while (i < text.length) { const d = text.charCodeAt(i); if (d === 44 || d === 125 || d === 93 || d === 32 || d === 10 || d === 13 || d === 9) break; i += 1; }
    if (i === at) return fail(at);
    return i;
  }
  /** Members of an object: calls `each(rawKey, keyStart, valueStart)` and moves on to the end of each value. Answers the index after `}`. */
  function members(open: number, each: (key: string, valueStart: number) => number): number {
    let at = skipSpace(open + 1);
    if (text.charCodeAt(at) === 125) return at + 1;
    for (;;) {
      at = skipSpace(at);
      if (text.charCodeAt(at) !== 34) return fail(at);
      const keyEnd = skipString(at), raw = text.slice(at, keyEnd);
      const key = raw.includes('\\') ? JSON.parse(raw) as string : raw.slice(1, -1);
      at = skipSpace(keyEnd);
      if (text.charCodeAt(at) !== 58) return fail(at);
      at = skipSpace(at + 1);
      at = each(key, at);
      at = skipSpace(at);
      const c = text.charCodeAt(at);
      if (c === 44) { at += 1; continue; }
      if (c === 125) return at + 1;
      return fail(at);
    }
  }
  function walk(start: number, actual: readonly string[], live: readonly KeyedSpec[]): number {
    const at = skipSpace(start);
    if (!live.length || text.charCodeAt(at) !== 123) return skipValue(at);
    if (live.some((spec) => spec.path.length === actual.length)) {
      const id = mapIdOf(actual), entries: [string, string][] = [];
      const end = members(at, (key, valueStart) => { const valueEnd = skipValue(valueStart); entries.push([key, text.slice(valueStart, valueEnd)]); return valueEnd; });
      pieces.push(text.slice(copied, at), markerText(id)); copied = end;
      maps.push({ id, entries });
      return end;
    }
    return members(at, (key, valueStart) => {
      const next = live.filter((spec) => { const segment = spec.path[actual.length]; return segment === '*' || segment === key; });
      return walk(valueStart, [...actual, key], next);
    });
  }
  // The root is the collection itself: a spec's first segment names a key of it.
  const end = walk(0, [], specs);
  if (skipSpace(end) !== text.length) fail(end);
  pieces.push(text.slice(copied));
  return { rootText: pieces.join(''), maps };
}

/** Put the entries back into a root's markers: the text the collection had before it was split. */
export function assembleText(rootText: string, entriesOf: (id: string) => Iterable<[string, string]>): string {
  return rootText.replace(MARKER, (_, quoted: string) => {
    const parts: string[] = [];
    for (const [key, text] of entriesOf(JSON.parse(quoted) as string)) parts.push(`${JSON.stringify(key)}:${text}`);
    return `{${parts.join(',')}}`;
  });
}
/** The ids of the keyed maps a root text names, in the order it names them. */
export function markerIds(rootText: string): string[] {
  const ids: string[] = [];
  for (const match of rootText.matchAll(MARKER)) ids.push(JSON.parse(match[1] as string) as string);
  return ids;
}

// ---- the layer ------------------------------------------------------------------------------------------------------

/** What a host answers for a layered collection (the committed state, held changes included). `stored` is what the row holds now. */
export interface LayerSource {
  root(coll: string): { text: string; stored: string } | undefined
  entry(coll: string, id: string, key: string): { text: string; stored: string } | undefined
  /** The keys of a map in the order they were added (not integer-sorted). */
  keys(coll: string, id: string): string[]
  /** The stored entries that answer a scan, in the order they were added (changes held in memory laid over the rows). Absent: the layer reads every entry. */
  scan?(coll: string, id: string, query: ScanQuery): ScanHit[]
  /** Where a stored key stands in the order (a scan merges entries this transaction changed). */
  ord?(coll: string, id: string, key: string): number | undefined
}
export interface EntryPut { key: string; text: string; /** The text the row holds now; undefined: a new entry. */ stored: string | undefined; value: unknown }
export interface MapWrite { id: string; puts: EntryPut[]; deletes: string[] }
export interface CollectionWrite {
  coll: string
  /** The root's new text, when it differs from what is stored. */
  root: { text: string; stored: string | undefined } | null
  /** The whole collection was removed: its root and all its entries go. */
  removed: boolean
  maps: MapWrite[]
}

interface Entry { value: unknown; stored: string | undefined }
/** One keyed map as one transaction sees it. */
class KeyedMap {
  readonly proxy: Record<string, unknown>
  /** Entries read, made or changed in this transaction, by key. */
  readonly loaded = new Map<string, Entry>()
  /** Stored keys this transaction removed (a key removed and made again is in both). */
  readonly deleted = new Set<string>()
  private readonly raw = new Map<string, { text: string; stored: string } | null>()
  private listed: string[] | undefined
  private listedSet: Set<string> | undefined
  /** A map handed back by a finished transaction cannot be changed through. */
  frozen = false
  private readonly source: LayerSource
  readonly coll: string
  readonly id: string
  constructor(source: LayerSource, coll: string, id: string, onTouch: () => void) {
    this.source = source; this.coll = coll; this.id = id;
    const target: Record<string, unknown> = {};
    const peek = (key: string): { text: string; stored: string } | null => {
      let found = this.raw.get(key);
      if (found === undefined) { found = this.source.entry(coll, id, key) ?? null; this.raw.set(key, found); }
      return found;
    };
    const exists = (key: string): boolean => {
      if (this.loaded.has(key)) return true;
      if (this.deleted.has(key)) return false;
      if (this.listedSet) return this.listedSet.has(key);
      return peek(key) !== null;
    };
    const remove = (key: string): void => {
      this.loaded.delete(key);
      if (this.deleted.has(key)) return;
      const known = this.listedSet ? this.listedSet.has(key) : peek(key) !== null;
      if (known) this.deleted.add(key);
    };
    this.proxy = new Proxy(target, {
      get: (_, key, receiver) => {
        if (typeof key !== 'string') return Reflect.get(target, key, receiver) as unknown;
        const have = this.loaded.get(key);
        if (have) return have.value;
        if (key !== 'toJSON' && key !== 'then' && !this.deleted.has(key) && (!this.listedSet || this.listedSet.has(key))) {
          const row = peek(key);
          if (row) { const value = JSON.parse(row.text) as unknown; this.loaded.set(key, { value, stored: row.stored }); onTouch(); return value; }
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
      set: (_, key, value: unknown) => {
        if (typeof key !== 'string' || this.frozen) return false;
        onTouch();
        if (value === undefined) { remove(key); return true; }
        const have = this.loaded.get(key);
        if (have) { have.value = value; return true; }
        // A key removed in this transaction and made again goes to the end, as a plain object would put it.
        const stored = this.deleted.has(key) ? undefined : peek(key)?.stored;
        this.loaded.set(key, { value, stored });
        return true;
      },
      deleteProperty: (_, key) => { if (this.frozen) return false; if (typeof key === 'string') { onTouch(); remove(key); } return true; },
      has: (_, key) => (typeof key === 'string' ? exists(key) || Reflect.has(target, key) : Reflect.has(target, key)),
      ownKeys: () => this.keys(),
      getOwnPropertyDescriptor: (_, key) => (typeof key === 'string' && exists(key) ? { value: undefined, writable: true, enumerable: true, configurable: true } : undefined),
      defineProperty: (_, key, descriptor) => {
        if (typeof key !== 'string' || !('value' in descriptor) || this.frozen) return false;
        this.proxy[key] = descriptor.value as unknown;
        return true;
      },
    });
    keyedMaps.set(this.proxy, this);
  }
  private stored(): string[] {
    if (!this.listed) { this.listed = this.source.keys(this.coll, this.id); this.listedSet = new Set(this.listed); }
    return this.listed;
  }
  /** Every key, in the order a plain object would list them. Reads keys only, never entries. */
  keys(): string[] {
    const stored = this.stored(), out: string[] = [];
    for (const key of stored) if (!this.deleted.has(key)) out.push(key);
    for (const key of this.loaded.keys()) if (!this.listedSet?.has(key) || this.deleted.has(key)) out.push(key);
    return plainOrder(out);
  }
  /** An entry as it is now without keeping it: this transaction's own object when it has one, else a throwaway parse of the stored text. */
  peekValue(key: string): unknown {
    const have = this.loaded.get(key);
    if (have) return have.value;
    if (this.deleted.has(key)) return undefined;
    const row = this.source.entry(this.coll, this.id, key);
    return row ? JSON.parse(row.text) as unknown : undefined;
  }
  /** The keys that answer a scan, as this transaction sees the map, in key order. */
  scan(query: ScanQuery): ScanHit[] {
    const name = specOf(this.coll, this.id)?.project;
    let stored: ScanHit[];
    if (this.source.scan) stored = this.source.scan(this.coll, this.id, query);
    else {
      stored = [];
      let ord = 0;
      for (const key of this.stored()) { ord += 1; const row = this.source.entry(this.coll, this.id, key); if (!row) continue; const p = projectionOf(name, JSON.parse(row.text)); if (matches(query, key, p)) stored.push({ key, ord, n: p?.n, j: p?.j }); }
    }
    if (!this.loaded.size && !this.deleted.size) return stored;
    // What this transaction changed is judged by its present value, not by the row.
    const changed = new Set<string>([...this.loaded.keys(), ...this.deleted]);
    const merged: ScanHit[] = stored.filter((hit) => !changed.has(hit.key));
    let created = 0;
    for (const [key, entry] of this.loaded) {
      const p = projectionOf(name, entry.value);
      if (!matches(query, key, p)) continue;
      const kept = entry.stored !== undefined && !this.deleted.has(key);
      merged.push({ key, ord: kept ? (this.source.ord?.(this.coll, this.id, key) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER + (created += 1), n: p?.n, j: p?.j });
    }
    return merged.sort((a, b) => a.ord - b.ord);
  }
  /** Every entry read or made is frozen, and the map refuses changes from now on. */
  freeze(seen: WeakSet<object>): void { this.frozen = true; for (const entry of this.loaded.values()) freezeValue(entry.value, seen); }
  /** What to write for this map. */
  write(): MapWrite {
    const puts: EntryPut[] = [], deletes: string[] = [...this.deleted];
    for (const [key, entry] of this.loaded) {
      const text = JSON.stringify(entry.value) as string | undefined;
      if (text === undefined) { if (entry.stored !== undefined && !this.deleted.has(key)) deletes.push(key); continue; }
      if (text !== entry.stored) puts.push({ key, text, stored: entry.stored, value: entry.value });
    }
    return { id: this.id, puts, deletes };
  }
}
const keyedMaps = new WeakMap<object, KeyedMap>();
/** Freeze a value all the way down; a keyed map is frozen as a map (it is not walked: that would read every entry). */
function freezeValue(value: unknown, seen: WeakSet<object>): void {
  const stack: unknown[] = [value];
  while (stack.length) {
    const item = stack.pop();
    if (item === null || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    const keyed = keyedMaps.get(item);
    if (keyed) { keyed.freeze(seen); continue; }
    Object.freeze(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) stack.push(child);
  }
}
/** Is this one of the lazy maps the layer made? */
export const isKeyedMap = (value: unknown): boolean => typeof value === 'object' && value !== null && keyedMaps.has(value);
/** The keys of a map (a lazy one lists its keys without reading any entry). Works on a plain object too. */
export function keysOf(map: Record<string, unknown>): string[] { const keyed = keyedMaps.get(map); return keyed ? keyed.keys() : Object.keys(map); }

/**
 * The keys of a map that answer a scan, in key order, and for each what its projection says. A lazy map asks the store, which
 * reads no entry; a plain object (the legacy layout, or a map the route just made) is walked and each value projected the same
 * way, so both answer alike. `name` names the map's projection (KEYED_SPECS).
 */
export function scanKeys(map: Record<string, unknown>, name: ProjectionName, query: ScanQuery): ScanHit[] {
  const keyed = keyedMaps.get(map);
  if (keyed) {
    if (specOf(keyed.coll, keyed.id)?.project !== name) throw new Error(`The keyed map ${keyed.id} has no projection ${name}`);
    return keyed.scan(query);
  }
  const hits: ScanHit[] = [];
  let ord = 0;
  for (const key of plainOrder(Object.keys(map))) { ord += 1; const p = projectionOf(name, map[key]); if (matches(query, key, p)) hits.push({ key, ord, n: p?.n, j: p?.j }); }
  return hits;
}
/**
 * Look at every entry of a map, one at a time, READ-ONLY: a lazy map reads, parses and lets go of each entry in turn, so a map
 * of any size is walked in the memory of one entry (changes to `value` are not kept). For the operator's tools and the rare
 * walks that have no index. The order is the order of `Object.entries`; `each` answering true stops the walk.
 */
export function forEachValue<T>(map: Record<string, T>, each: (value: T, key: string) => void | boolean): void {
  const keyed = keyedMaps.get(map);
  if (!keyed) { for (const [key, value] of Object.entries(map)) if (each(value, key) === true) return; return; }
  for (const key of keyed.keys()) { const value = keyed.peekValue(key); if (value !== undefined && each(value as T, key) === true) return; }
}

/** One collection as a transaction sees it. */
interface State { obj: unknown; stored: string | undefined; existed: Set<string>; removed: boolean }

/** The layered collections of one transaction. */
export class Layer {
  private readonly states = new Map<string, State | null>()
  private readonly source: LayerSource
  private readonly touch: (coll: string) => void
  constructor(source: LayerSource, touch: (coll: string) => void = () => {}) { this.source = source; this.touch = touch; }
  private load(coll: string): State | null {
    const known = this.states.get(coll);
    if (known !== undefined) return known;
    const root = this.source.root(coll);
    let state: State | null = null;
    if (root) {
      const obj = JSON.parse(root.text) as unknown, existed = new Set<string>();
      for (const found of locate(obj, KEYED_SPECS[coll] ?? [])) {
        if (isRecord(found.value) && found.value[MARKER_KEY] === found.id) {
          existed.add(found.id);
          found.holder[found.key] = new KeyedMap(this.source, coll, found.id, () => this.touch(coll)).proxy;
        }
      }
      state = { obj, stored: root.stored, existed, removed: false };
    }
    this.states.set(coll, state);
    return state;
  }
  /** Does the collection exist? */
  has(coll: string): boolean { this.touch(coll); const state = this.load(coll); return state !== null && !state.removed; }
  get(coll: string): unknown { this.touch(coll); const state = this.load(coll); return state && !state.removed ? state.obj : undefined; }
  set(coll: string, value: unknown): void {
    this.touch(coll);
    const before = this.load(coll);
    this.states.set(coll, { obj: value, stored: before?.stored, existed: before ? before.existed : new Set(), removed: false });
  }
  remove(coll: string): void {
    this.touch(coll);
    const before = this.load(coll);
    if (before) this.states.set(coll, { ...before, removed: true }); else this.states.set(coll, null);
  }
  /** Freeze everything this transaction loaded or made, as the Node store freezes what it commits (nothing handed back can be changed). */
  freeze(): void { const seen = new WeakSet<object>(); for (const state of this.states.values()) if (state && !state.removed) freezeValue(state.obj, seen); }
  /** The collections this transaction has loaded or made. */
  names(): string[] { return [...this.states.keys()]; }
  /** Does the collection exist as this transaction sees it (without asking the source: only what was loaded or made counts)? */
  known(coll: string): boolean | undefined { const state = this.states.get(coll); return state === undefined ? undefined : state !== null && !state.removed; }
  /** What the transaction changed, as writes. Pure: it asks the source only for the keys of maps it must clear. */
  changes(): CollectionWrite[] {
    const out: CollectionWrite[] = [];
    for (const [coll, state] of this.states) {
      if (state === null) continue;
      if (state.removed) {
        const maps: MapWrite[] = [...state.existed].map((id) => ({ id, puts: [], deletes: this.source.keys(coll, id) }));
        out.push({ coll, root: null, removed: true, maps });
        continue;
      }
      const spots = locate(state.obj, KEYED_SPECS[coll] ?? []), markers = new Map<object, string>(), writes: MapWrite[] = [], present = new Set<string>();
      for (const spot of spots) {
        if (!isRecord(spot.value)) continue;
        const keyed = keyedMaps.get(spot.value);
        if (keyed && keyed.id !== spot.id) throw new Error(`The keyed map ${keyed.id} was moved to ${spot.id}`);
        if (!keyed && Object.hasOwn(spot.value, MARKER_KEY) && Object.keys(spot.value).length === 1) continue;
        present.add(spot.id);
        markers.set(spot.value, spot.id);
        if (keyed) { writes.push(keyed.write()); continue; }
        // A plain object where a map belongs (made by the route, or put in place of the old one): it is all entries; whatever else was stored goes.
        const wanted = new Map<string, string>(), puts: EntryPut[] = [], deletes: string[] = [];
        for (const [key, value] of Object.entries(spot.value)) { const text = JSON.stringify(value) as string | undefined; if (text !== undefined) wanted.set(key, text); }
        const storedKeys = this.source.keys(coll, spot.id), stored = new Set(storedKeys);
        for (const key of storedKeys) if (!wanted.has(key)) deletes.push(key);
        // The new object fixes the order of its keys. Entries keep their place while the keys that are stored and wanted come in
        // the order they are stored; from the first place where they do not, every entry is taken out and put again in order.
        const kept = plainOrder(storedKeys.filter((key) => wanted.has(key))), order = [...wanted.keys()];
        let same = 0;
        while (same < kept.length && same < order.length && kept[same] === order[same]) same += 1;
        const again = new Set(order.slice(same).filter((key) => stored.has(key)));
        for (const key of again) deletes.push(key);
        for (const [key, text] of wanted) {
          const before = stored.has(key) && !again.has(key) ? this.source.entry(coll, spot.id, key)?.stored : undefined;
          if (text !== before) puts.push({ key, text, stored: before, value: (spot.value as Record<string, unknown>)[key] });
        }
        writes.push({ id: spot.id, puts, deletes });
      }
      // A map the collection had and no longer has: all of it goes.
      for (const id of state.existed) if (!present.has(id)) writes.push({ id, puts: [], deletes: this.source.keys(coll, id) });
      const text = JSON.stringify(state.obj, (_key, value: unknown) => (typeof value === 'object' && value !== null && markers.has(value) ? { [MARKER_KEY]: markers.get(value) } : value));
      const rootChanged = text !== state.stored;
      if (!rootChanged && writes.every((write) => !write.puts.length && !write.deletes.length)) continue;
      out.push({ coll, root: rootChanged ? { text, stored: state.stored } : null, removed: false, maps: writes.filter((write) => write.puts.length || write.deletes.length) });
    }
    return out;
  }
}

/** The whole collection as a plain value, read through a source: for the operator's export and the tests (reads every entry). */
export function readWhole(source: LayerSource, coll: string): unknown {
  const root = source.root(coll);
  if (!root) return undefined;
  return JSON.parse(assembleText(root.text, (id) => source.keys(coll, id).flatMap((key): [string, string][] => { const row = source.entry(coll, id, key); return row ? [[key, row.text]] : []; })));
}
