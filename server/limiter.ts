/**
 * OWNER: foundation
 * THE RATE LIMITER'S RULES, shared by both hosts (ctx.allow, ctx.peek). Portable: no Node imports, no clock of its own.
 *
 *   allow(key, count = 120, windowMs = 60000) → boolean    at most `count` calls per `windowMs` for one key
 *   peek(key, count = 120)                    → boolean    would a call be allowed now? Counts nothing and creates nothing.
 *
 * A LIMITER THAT IS FULL MUST NOT REFUSE NEWCOMERS. Each key is a row; rows are bounded. When a table is full the rows
 * that expire soonest are dropped to make room — never "every new key is refused", which would let whoever filled the
 * table turn everybody else away for as long as their rows live. Dropping a row early only forgets a count; it cannot
 * lock anyone out.
 *
 * KEYS ARE KEPT IN CLASSES, each with its own table and its own bound, so that keys an outsider can mint cheaply and
 * that live long (a password-reset per address written to: an hour) can never crowd out the keys the game itself
 * depends on (a visitor's first request, a session's actions, a socket):
 *   account   keys starting `account:`   sign-in, reset and the other account routes
 *   core      everything else
 * The operator's own budget (`mod:` keys: the failed-token window) is never dropped to make room.
 *
 * To keep a table small in the first place, a route checks what is cheap and shared FIRST (peek at a global bucket)
 * and only then counts against a key of its own: a request that is going to be refused anyway creates no row.
 */
export type LimiterClass = 'core' | 'account';
export const limiterClass = (key: string): LimiterClass => (String(key).startsWith('account:') ? 'account' : 'core');
/** Rows a class may hold. */
export const LIMITER_CAPS: Readonly<Record<LimiterClass, number>> = Object.freeze({ core: 10000, account: 4000 });
/** How many of the soonest-to-expire rows are dropped at once when a class is full (so making room is not paid on every call). */
export const LIMITER_EVICT = 200;
/** The batch for a table of this bound: never more than a tenth of it, so making room cannot empty a small table. */
export const limiterBatch = (cap: number): number => Math.max(1, Math.min(LIMITER_EVICT, Math.floor(cap / 10)));
/** Rows that are never dropped to make room. */
export const limiterKeeps = (key: string): boolean => String(key).startsWith('mod:');

interface Entry { start: number; count: number; windowMs: number }
/** The in-memory limiter of the Node host. */
export function createMemoryLimiter({ now, caps = LIMITER_CAPS }: { now: () => number; caps?: Readonly<Record<LimiterClass, number>> }) {
  const tables: Record<LimiterClass, Map<string, Entry>> = { core: new Map(), account: new Map() };
  const live = (entry: Entry | undefined, time: number): entry is Entry => entry !== undefined && time >= entry.start && time - entry.start < entry.windowMs;
  /** Make room in a full table: what has expired goes first, then the rows that expire soonest. */
  function makeRoom(table: Map<string, Entry>, cap: number, time: number): void {
    for (const [id, entry] of table) if (!live(entry, time)) table.delete(id);
    if (table.size < cap) return;
    const soonest = [...table].filter(([id]) => !limiterKeeps(id)).sort((a, b) => (a[1].start + a[1].windowMs) - (b[1].start + b[1].windowMs)).slice(0, table.size - cap + limiterBatch(cap));
    for (const [id] of soonest) table.delete(id);
  }
  return {
    allow(key: string, count = 120, windowMs = 60000): boolean {
      const time = now(), kind = limiterClass(key), table = tables[kind];
      const entry = table.get(key);
      if (live(entry, time)) return ++entry.count <= count;
      if (!entry && table.size >= caps[kind]) makeRoom(table, caps[kind], time);
      table.set(key, { start: time, count: 1, windowMs });
      return true;
    },
    peek(key: string, count = 120): boolean {
      const entry = tables[limiterClass(key)].get(key);
      return live(entry, now()) ? entry.count < count : true;
    },
    /** Rows held per class (for tests and the operator's view). */
    sizes: (): Record<LimiterClass, number> => ({ core: tables.core.size, account: tables.account.size }),
  };
}
