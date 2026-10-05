/**
 * OWNER: foundation
 * THE RATE LIMITER'S RULES, shared by both hosts (ctx.allow, ctx.peek). Portable: no Node imports, no clock of its own.
 *
 *   allow(key, count = 120, windowMs = 60000) → boolean    at most `count` calls per `windowMs` for one key
 *   peek(key, count = 120)                    → boolean    would a call be allowed now? Counts nothing and creates nothing.
 *
 * A LIMITER THAT IS FULL MUST NOT REFUSE NEWCOMERS. Each key is a row; rows are bounded. When a table is full the rows
 * that expire soonest are dropped to make room: dropping a row early only forgets a count; it cannot lock anyone out.
 *
 * ROWS ARE KEPT IN THREE CLASSES, each with its own table and its own bound, so that one kind of row cannot push out another:
 *   short      windows of a minute or less: a visitor's first request, a session's actions, a socket. These guard gameplay.
 *   long       windows longer than a minute (an hour of e-mails, reports, groups). They live long, so they must not be able to
 *              fill the table the short rows share, and a flood of short rows must not erase them.
 *   protected  keys that must never be forgotten, whatever else is going on (PROTECTED_PREFIXES): the operator's budget and the
 *              failed-token guard (`mod:`, `mod-fail:`, including `mod-fail:all`), and the sign-in and reset limits of accounts.
 *              Their rows are NEVER dropped to make room. The class has a generous bound of its own; when it is full of live
 *              rows a NEW protected key is refused (fail closed: only guessers and repeated sign-in attempts can fill it).
 *
 * To keep a table small in the first place, a route checks what is cheap and shared FIRST (peek at a global bucket), and a
 * route that anyone can reach without a session must not count against a long window before it knows who is asking.
 */
export type LimiterClass = 'short' | 'long' | 'protected';
/** Key prefixes that are never evicted. */
export const PROTECTED_PREFIXES: readonly string[] = Object.freeze(['mod:', 'mod-fail:', 'account:sign-in', 'account:reset']);
export const limiterProtects = (key: string): boolean => PROTECTED_PREFIXES.some((prefix) => String(key).startsWith(prefix));
/** The longest window that still counts as short. */
export const SHORT_WINDOW_MS = 60000;
export const limiterClass = (key: string, windowMs = SHORT_WINDOW_MS): LimiterClass => (limiterProtects(key) ? 'protected' : windowMs > SHORT_WINDOW_MS ? 'long' : 'short');
/** Rows a class may hold. */
export const LIMITER_CAPS: Readonly<Record<LimiterClass, number>> = Object.freeze({ short: 10000, long: 10000, protected: 20000 });
/** How many of the soonest-to-expire rows are dropped at once when a class is full (so making room is not paid on every call). */
export const LIMITER_EVICT = 200;
/** The batch for a table of this bound: never more than a tenth of it, so making room cannot empty a small table. */
export const limiterBatch = (cap: number): number => Math.max(1, Math.min(LIMITER_EVICT, Math.floor(cap / 10)));

interface Entry { start: number; count: number; windowMs: number }
/** The in-memory limiter of the Node host. */
export function createMemoryLimiter({ now, caps = LIMITER_CAPS }: { now: () => number; caps?: Readonly<Record<LimiterClass, number>> }) {
  const tables: Record<LimiterClass, Map<string, Entry>> = { short: new Map(), long: new Map(), protected: new Map() };
  const live = (entry: Entry | undefined, time: number): entry is Entry => entry !== undefined && time >= entry.start && time - entry.start < entry.windowMs;
  /** Make room in a full table: what has expired goes first, then (never in the protected class) the rows that expire soonest. */
  function makeRoom(kind: LimiterClass, table: Map<string, Entry>, cap: number, time: number): void {
    for (const [id, entry] of table) if (!live(entry, time)) table.delete(id);
    if (table.size < cap || kind === 'protected') return;
    const soonest = [...table].sort((a, b) => (a[1].start + a[1].windowMs) - (b[1].start + b[1].windowMs)).slice(0, table.size - cap + limiterBatch(cap));
    for (const [id] of soonest) table.delete(id);
  }
  return {
    allow(key: string, count = 120, windowMs = 60000): boolean {
      const time = now(), kind = limiterClass(key, windowMs), table = tables[kind];
      const entry = table.get(key);
      if (live(entry, time)) return ++entry.count <= count;
      if (!entry && table.size >= caps[kind]) { makeRoom(kind, table, caps[kind], time); if (kind === 'protected' && table.size >= caps[kind]) return false; }
      table.set(key, { start: time, count: 1, windowMs });
      return true;
    },
    peek(key: string, count = 120): boolean {
      const time = now();
      for (const table of Object.values(tables)) { const entry = table.get(key); if (entry !== undefined) return live(entry, time) ? entry.count < count : true; }
      return true;
    },
    /** Drop what has expired. A host calls this now and then, so a table that was busy once does not stay at its high-water mark. */
    sweep(): void { const time = now(); for (const table of Object.values(tables)) for (const [id, entry] of table) if (!live(entry, time)) table.delete(id); },
    /** Rows held per class (for tests and the operator's view). */
    sizes: (): Record<LimiterClass, number> => ({ short: tables.short.size, long: tables.long.size, protected: tables.protected.size }),
  };
}
