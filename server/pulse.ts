/**
 * OWNER: world
 * The pulse: how many people are in the game right now, and how many visits it has had.
 *
 * ONLINE   distinct players with at least one live socket: open, not expired, and answering the
 *          host's heartbeat (the same test the presence registry uses, server/social/presence.ts).
 *          A player with two tabs counts once; a guest counts; nothing that is not a session can
 *          hold a socket, so non-player characters never count. `cities` counts the players whose
 *          socket is in a room of that city, so a player who is connected but travelling is in the
 *          total only. Everything is read from memory the host already holds.
 * VISITS   a count of distinct player-days. A player adds one the first time they are seen
 *          (a live socket at a heartbeat, or a pulse request) on a Lagos day (src/game/clock.ts); seen
 *          again that day they add nothing. It never goes down.
 *
 * STORAGE  the document's `pulse` collection: { visits: number, seededAt: ms }. Which day a player was
 *          last counted is one number on their own session (`visitDay`), so the bookkeeping is as
 *          big as the session count and never grows with time. Sessions that predate the field are
 *          simply counted again on their next day.
 * SEED     the first count made while there is no `pulse` collection sets `visits` to the number of stored sessions
 *          plus archived lives (every device that has ever had a character, counted once), and
 *          marks each stored session as counted today so the seed is not counted twice. A fresh
 *          store seeds to 0. Nothing is written until then. No multiplier, no floor.
 * Portable: no Node imports.
 */
import { lagosTime } from '../src/game/clock.ts';
import type { Db, RouteContext } from './types.ts';

/** What GET /api/world/pulse answers (besides `serverTime`). */
export interface Pulse { online: number; visits: number; cities: Record<string, number> }
export interface PulseService {
  /** The numbers, from a cache at most CACHE_MS old. */
  pulse(): Pulse
  /** Counts these players' visit for today, once each. Never throws. */
  see(ids: readonly string[]): Promise<void>
}

export const CACHE_MS = 3000;
const OPEN = 1;
const services = new WeakMap<RouteContext, PulseService>();
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function pulseOf(ctx: RouteContext): PulseService {
  const known = services.get(ctx);
  if (known) return known;
  const built = build(ctx);
  services.set(ctx, built);
  return built;
}

function build(ctx: RouteContext): PulseService {
  const today = (): number => lagosTime(ctx.now()).day;
  /** null until the collection exists (nobody has been counted since it was introduced). */
  let visits: number | null = null;
  let cached: { at: number; value: Pulse } | null = null;
  /** The Lagos day each player still connected was last counted on, in memory: it spares a write per beat. Entries of earlier days are dropped on each beat. */
  const counted = new Map<string, number>();
  let busy: Promise<void> = Promise.resolve();

  // Load the stored count before the host takes requests. Reading creates nothing: the collection is made (and seeded) by the first count.
  ctx.startup?.push(ctx.store.read((db) => {
    const stored = Object.hasOwn(db, 'pulse') ? (db['pulse'] as Record<string, unknown> | null)?.['visits'] : undefined;
    return isCount(stored) ? stored : null;
  }).then((value) => { visits = value; }));

  const liveSockets = () => (ctx.core?.sockets?.() ?? []).filter((ws) => ws.readyState === OPEN && !(ws.expiresAt <= ctx.now()) && ctx.core?.unresponsive?.(ws) !== true);

  function compute(): Pulse {
    const everyone = new Set<string>();
    const inCity = new Map<string, Set<string>>();
    for (const ws of liveSockets()) {
      const id = ws.session?.id;
      if (!id) continue;
      everyone.add(id);
      const city = typeof ws.room === 'string' ? ws.room.split(':')[0] : '';
      if (city) { let set = inCity.get(city); if (!set) inCity.set(city, set = new Set()); set.add(id); }
    }
    const cities: Record<string, number> = {};
    for (const id of ctx.cityIds) cities[id] = inCity.get(id)?.size ?? 0;
    return { online: everyone.size, visits: visits ?? 0, cities };
  }

  /** The first count: start from what is stored (see SEED above). */
  function seed(db: Db, stored: Record<string, unknown>): void {
    let total = 0;
    for (const secret of Object.keys(db.sessions)) { const session = db.sessions[secret]; if (session) { session.visitDay = today(); total += 1; } }
    total += Object.keys(db.archivedLives ?? {}).length;
    stored['visits'] = total;
    stored['seededAt'] = ctx.now();
  }

  function see(ids: readonly string[]): Promise<void> {
    busy = busy.then(async () => {
      const day = today();
      const todo = [...new Set(ids)].filter((id) => counted.get(id) !== day);
      if (!todo.length) return;
      try {
        const total = await ctx.store.transact((db) => {
          const stored = ctx.collection(db, 'pulse');
          if (!isCount(stored['visits'])) seed(db, stored);
          let count = stored['visits'] as number;
          for (const id of todo) {
            const session = ctx.core?.sessionByPublicId(db, id);
            if (!session || session.visitDay === day) continue;
            session.visitDay = day;
            count += 1;
          }
          stored['visits'] = count;
          return count;
        }, { durable: false });
        visits = total;
        for (const id of todo) counted.set(id, day);
        cached = null;
      } catch { /* storage is unavailable: the next beat tries again */ }
    });
    return busy;
  }

  ctx.on?.('heartbeat', () => {
    const ids = [...new Set(liveSockets().map((ws) => ws.session?.id).filter((id): id is string => Boolean(id)))];
    const day = today();
    for (const [id, was] of counted) if (was !== day) counted.delete(id);
    void see(ids);
  });

  return {
    pulse() {
      const at = ctx.now();
      if (!cached || at - cached.at >= CACHE_MS || at < cached.at) cached = { at, value: compute() };
      return cached.value;
    },
    see,
  };
}
