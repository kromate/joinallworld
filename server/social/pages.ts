/**
 * OWNER: social
 * PAGING FOR LONG LISTS. Every list here is paged by a CURSOR, never an offset: a cursor names the sort key of the last
 * row the client holds, and the next page is the rows that sort strictly after it. A row added or removed meanwhile can
 * therefore neither repeat a row nor skip one. A cursor is opaque to clients (they hand back the `next` they were given).
 * Portable: no Node imports, no storage.
 *
 * THE PLAYER DIRECTORY (founder's and admins' Players view). A small in-memory index of the players, built lazily from
 * the social collection and rebuilt when it is DIRECTORY_TTL_MS old or when a player was added or renamed in this
 * process (`stamp`). It holds only plain rows (id, name, first-seen time), so it does not depend on which copy of the
 * collection a transaction sees. Each page re-checks its rows against the collection it is given, so a player who
 * removed or blocked the founder after the index was built is never listed. Cost of one page: O(log N + page) for
 * newest-first and for a name prefix; a name-contains search reads at most DIRECTORY_SCAN rows' lower-cased names and
 * hands back a cursor if it did not finish; online-first and by-city read the presence registry (O(connected players)).
 * The index is rebuilt in O(N log N) at most once per DIRECTORY_TTL_MS per viewer, not per request.
 */

/** Rows a page may hold, whatever the client asks for. */
export const PAGE_MAX = 100;
/** How long a directory index is trusted. */
export const DIRECTORY_TTL_MS = 15000;
/** The most names one name-contains request reads before it hands back a cursor. */
export const DIRECTORY_SCAN = 20000;
/** Most directory indexes kept at once (one per viewer and mode). */
const DIRECTORY_KEPT = 4;

/** `limit` from a query: a whole number from 1 to `max`, else `fallback`. */
export function pageLimit(raw: unknown, fallback: number, max = PAGE_MAX): number {
  const value = typeof raw === 'string' && /^\d{1,4}$/.test(raw) ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isSafeInteger(value) && value >= 1 ? Math.min(value, max) : fallback;
}

/** A cursor made of parts; a part never holds a ':' (it is escaped), so the cursor splits back into the same parts. */
export const cursorOf = (...parts: (string | number)[]): string => parts.map((part) => encodeURIComponent(String(part))).join(':');
/** The parts of a cursor, or null when it is not one of ours (too long, or the wrong number of parts). */
export function readCursor(raw: unknown, length: number): string[] | null {
  if (typeof raw !== 'string' || !raw || raw.length > 240) return null;
  const parts = raw.split(':');
  if (parts.length !== length) return null;
  try { return parts.map((part) => decodeURIComponent(part)); } catch { return null; }
}

/** The first index of `rows` (sorted) for which `after(row)` is true, by binary search. `after` must flip once, false to true. */
export function firstAfter<T>(rows: readonly T[], after: (row: T) => boolean): number {
  let low = 0, high = rows.length;
  while (low < high) { const mid = (low + high) >>> 1; if (after(rows[mid]!)) high = mid; else low = mid + 1; }
  return low;
}

/** One player of the index. `lower` is the name lower-cased, for matching and ordering. */
export interface DirectoryRow { id: string; name: string; lower: string; first: number }
export interface Directory {
  builtAt: number
  stamp: number
  /** Newest first (first-seen desc, id asc). */
  byNewest: DirectoryRow[]
  /** Name order (lower asc, id asc). */
  byName: DirectoryRow[]
  rows: Map<string, DirectoryRow>
  /** Players the viewer may list, and players who are not (removed or blocked the viewer, or were blocked by them). */
  listed: number
  gone: number
}
export const newestFirst = (a: DirectoryRow, b: DirectoryRow): number => b.first - a.first || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const byNameOrder = (a: DirectoryRow, b: DirectoryRow): number => (a.lower < b.lower ? -1 : a.lower > b.lower ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The indexes kept for a process: `key` names the viewer and the mode. */
export function directoryCache() {
  const kept = new Map<string, Directory>();
  return {
    /** The index for `key`, rebuilt when it is old, or older than `stamp`. `accept` says whether a player is listed for this viewer. */
    get(key: string, now: number, stamp: number, players: Readonly<Record<string, { name: string; first: number }>>, accept: (id: string) => boolean, skip: string): Directory {
      const found = kept.get(key);
      if (found && found.stamp === stamp && now - found.builtAt < DIRECTORY_TTL_MS) return found;
      const byNewest: DirectoryRow[] = [], rows = new Map<string, DirectoryRow>();
      let gone = 0;
      for (const id in players) {
        if (id === skip) continue;
        if (!accept(id)) { gone += 1; continue; }
        const player = players[id]!, row: DirectoryRow = { id, name: player.name, lower: player.name.toLowerCase(), first: player.first };
        byNewest.push(row); rows.set(id, row);
      }
      byNewest.sort(newestFirst);
      const built: Directory = { builtAt: now, stamp, byNewest, byName: byNewest.slice().sort(byNameOrder), rows, listed: byNewest.length, gone };
      kept.delete(key);
      kept.set(key, built);
      for (const old of kept.keys()) { if (kept.size <= DIRECTORY_KEPT) break; kept.delete(old); }
      return built;
    },
    drop(): void { kept.clear(); },
  };
}

/** Rows of `rows` strictly after the cursor position, `limit` of them, and whether more follow. */
export function slice<T>(rows: readonly T[], start: number, limit: number): { items: T[]; more: boolean } {
  const items = rows.slice(start, start + limit);
  return { items, more: start + items.length < rows.length };
}
