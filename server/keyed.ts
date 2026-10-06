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

/** A projection of one entry, kept beside its text so that a scan can pick entries without reading and parsing all of them. */
export interface Projection {
  /** A number to compare (a last-seen time, an expiry). */
  n?: number | undefined
  /** Lower-case text to search in (a name). */
  t?: string | undefined
  /** A small JSON payload a scan returns with the key (a player's blocked ids). */
  j?: string | undefined
}
export interface KeyedSpec {
  /** Where the map is in the collection: `['players']`, `['cities', '*', 'residents']` (`*`: every key of the map before it). */
  readonly path: readonly string[]
  /** What a scan may ask of an entry. */
  readonly project?: (value: unknown) => Projection | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** The collections kept per entry, and where their big maps are. Everything else in a collection stays in its root. */
export const KEYED_SPECS: Readonly<Record<string, readonly KeyedSpec[]>> = Object.freeze({
  social: [
    { path: ['players'], project: (value: unknown): Projection | undefined => {
      if (!isRecord(value)) return undefined;
      const blocked = isRecord(value['blocked']) ? Object.keys(value['blocked']) : [];
      return { n: num(value['seen']), t: typeof value['name'] === 'string' ? value['name'].toLowerCase() : undefined, j: blocked.length ? JSON.stringify(blocked) : undefined };
    } },
    { path: ['convs'] },
    { path: ['houses'] },
    { path: ['pending'], project: (value: unknown): Projection | undefined => {
      if (!Array.isArray(value)) return undefined;
      let oldest: number | undefined;
      for (const effect of value) { const at = isRecord(effect) ? num(effect['at']) : undefined; if (at !== undefined && (oldest === undefined || at < oldest)) oldest = at; }
      return { n: oldest };
    } },
  ],
  growth: [
    { path: ['players'], project: (value: unknown): Projection | undefined => (isRecord(value) ? { n: num(value['seen']) } : undefined) },
    { path: ['shares'], project: (value: unknown): Projection | undefined => (isRecord(value) ? { n: num(value['at']) } : undefined) },
    { path: ['comeback'] },
    { path: ['push'] },
    { path: ['contacts'] },
  ],
  civic: [
    { path: ['cities', '*', 'residents'], project: (value: unknown): Projection | undefined => (isRecord(value) ? { n: num(value['lastSeen']) } : undefined) },
    { path: ['cities', '*', 'gov', 'elections'] },
  ],
  business: [
    { path: ['shops'] },
  ],
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
        if (typeof key !== 'string') return false;
        onTouch();
        if (value === undefined) { remove(key); return true; }
        const have = this.loaded.get(key);
        if (have) { have.value = value; return true; }
        // A key removed in this transaction and made again goes to the end, as a plain object would put it.
        const stored = this.deleted.has(key) ? undefined : peek(key)?.stored;
        this.loaded.set(key, { value, stored });
        return true;
      },
      deleteProperty: (_, key) => { if (typeof key === 'string') { onTouch(); remove(key); } return true; },
      has: (_, key) => (typeof key === 'string' ? exists(key) || Reflect.has(target, key) : Reflect.has(target, key)),
      ownKeys: () => this.keys(),
      getOwnPropertyDescriptor: (_, key) => (typeof key === 'string' && exists(key) ? { value: undefined, writable: true, enumerable: true, configurable: true } : undefined),
      defineProperty: (_, key, descriptor) => {
        if (typeof key !== 'string' || !('value' in descriptor)) return false;
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
/** Is this one of the lazy maps the layer made? */
export const isKeyedMap = (value: unknown): boolean => typeof value === 'object' && value !== null && keyedMaps.has(value);
/** The keys of a map (a lazy one lists its keys without reading any entry). Works on a plain object too. */
export function keysOf(map: Record<string, unknown>): string[] { const keyed = keyedMaps.get(map); return keyed ? keyed.keys() : Object.keys(map); }

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
  /** The collections this transaction has loaded or made. */
  names(): string[] { return [...this.states.keys()]; }
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
