/**
 * OWNER: world
 * The pulse: how many people are in the game right now, and how many visits it has had.
 *
 * ONLINE   ONE meaning, used by the header pill, the gem hunt chip, Neighbours, the rich list and the counts frame:
 *          a player is online when they have a live socket (open, not expired, answering the host's heartbeat: the
 *          same test the presence registry uses, server/social/presence.ts) or lost their last one less than
 *          RECONNECT_GRACE_MS ago, so a page reload never drops a player and puts them back. A player with two tabs
 *          or two devices counts once; a guest counts (a life still held for the quick start too: it is a person on the
 *          page); nothing that is not a session can hold a socket, so non-player characters never count. Blocks and
 *          the directory preference change nobody's count: a count that left a player out for one viewer would tell
 *          that viewer who they blocked. `online` is everyone; `cities[id]` is the online players whose character is
 *          in that city, visitors and residents alike: the city of the room the socket is in, else the last city the
 *          player was seen in, else the city of the viewer's own stored life. The viewer is always counted in their
 *          own answer (a request is itself a sign of life), so nobody is ever shown 0, and `online` is never below
 *          any city. Everything is read from memory the host already holds: no row is read or written for a count.
 * PUSH     a socket that sent `pulse-watch` is sent a `pulse` frame (the same numbers) at once, and again whenever the
 *          counts changed, at most once every PUSH_MS and never written to storage. A watching socket's `pulseWatch`
 *          travels with it through a Worker's sleep. The poll of GET /api/world/pulse is the fallback.
 * TODAY    `today`: distinct players seen on this Lagos day (the same day-counter bookkeeping as VISITS, one more
 *          number in the same document). Never below the players online now.
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
import { RECONNECT_GRACE_MS } from './social/presence.ts';
import type { PulseFrame } from '../src/types/protocol.ts';
import type { Db, RouteContext, WsConnection } from './types.ts';

/** What GET /api/world/pulse answers (besides `serverTime`). */
export interface Pulse { online: number; visits: number; today: number; cities: Record<string, number> }
/** Who is asking: always counted, in `city` when it is known. */
export interface Viewer { id: string; city: string | null }
export interface PulseService {
  /** The numbers, from a cache that any arrival or departure empties; `viewer` is counted in them. */
  pulse(viewer?: Viewer | null): Pulse
  /** Counts these players' visit for today, once each. Never throws. */
  see(ids: readonly string[]): Promise<void>
  /** A socket opened, was handed back after a sleep, or closed: the counts may have changed. */
  /** A socket asked for the counts frames: it is sent the counts now (its player counted, in `city`), and whenever they change. */
  watch(ws: WsConnection, city: string | null): void
  opened(ws: WsConnection): void
  closed(ws: WsConnection): void
}

export const CACHE_MS = 3000;
/** The counts frame goes out at most this often. */
export const PUSH_MS = 2000;
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
  /** Distinct players counted on `day`; read with the visits and written with them. */
  let seen: { day: number; count: number } | null = null;
  /** The base numbers and who is in them. Rebuilt after any arrival or departure, and at the latest after CACHE_MS. */
  let cached: { at: number; value: Pulse; members: Map<string, string | null> } | null = null;
  let dirty = true;
  /** The Lagos day each player still connected was last counted on, in memory: it spares a write per beat. Entries of earlier days are dropped on each beat. */
  const counted = new Map<string, number>();
  /** The last city each connected player was seen in, so a socket that has not joined a room yet is still placed. Dropped with the player. */
  const lastCity = new Map<string, string>();
  /** Players whose last socket closed lately: still online until the grace has run. */
  const gone = new Map<string, { city: string | null; at: number }>();
  let busy: Promise<void> = Promise.resolve();

  // Load the stored count before the host takes requests. Reading creates nothing: the collection is made (and seeded) by the first count.
  ctx.startup?.push(ctx.store.read((db) => {
    const stored = Object.hasOwn(db, 'pulse') ? (db['pulse'] as Record<string, unknown> | null) : undefined;
    const total = stored?.['visits'], day = stored?.['seenDay'] as Record<string, unknown> | undefined;
    return { visits: isCount(total) ? total : null, seen: day && isCount(day['day']) && isCount(day['count']) ? { day: day['day'], count: day['count'] } : null };
  }).then((value) => { visits = value.visits; seen = value.seen; }));

  const liveSockets = () => (ctx.core?.sockets?.() ?? []).filter((ws) => ws.readyState === OPEN && !(ws.expiresAt <= ctx.now()) && ctx.core?.unresponsive?.(ws) !== true);
  const known = new Set<string>(ctx.cityIds);
  const roomCity = (ws: WsConnection): string | null => { const city = typeof ws.room === 'string' ? ws.room.split(':')[0] : ''; return city && known.has(city) ? city : null; };

  /** Everyone online, each with their city (null: in the world, city not known yet). */
  function members(): Map<string, string | null> {
    const found = new Map<string, string | null>();
    for (const ws of liveSockets()) {
      const id = ws.session?.id;
      if (!id) continue;
      const city = roomCity(ws);
      if (!found.has(id) || (found.get(id) === null && city)) found.set(id, city);
    }
    for (const [id, city] of found) { if (city) lastCity.set(id, city); else found.set(id, lastCity.get(id) ?? null); }
    const at = ctx.now();
    for (const [id, away] of gone) {
      if (at - away.at >= RECONNECT_GRACE_MS || at < away.at) { gone.delete(id); continue; }
      if (!found.has(id)) found.set(id, away.city);
    }
    // A player who is neither connected nor in the grace is forgotten.
    for (const id of lastCity.keys()) if (!found.has(id)) lastCity.delete(id);
    return found;
  }

  function base(fresh: boolean): NonNullable<typeof cached> {
    const at = ctx.now();
    if (cached && at >= cached.at && at - cached.at < CACHE_MS && !(dirty && fresh)) return cached;
    const everyone = members();
    const cities: Record<string, number> = {};
    for (const id of ctx.cityIds) cities[id] = 0;
    for (const city of everyone.values()) if (city) cities[city] = (cities[city] ?? 0) + 1;
    dirty = false;
    cached = { at, members: everyone, value: { online: everyone.size, visits: 0, today: 0, cities } };
    return cached;
  }

  function pulse(viewer?: Viewer | null, fresh = true): Pulse {
    const { value, members: everyone } = base(fresh);
    let online = value.online;
    const cities = { ...value.cities };
    if (viewer?.id) {
      const city = viewer.city && known.has(viewer.city) ? viewer.city : null;
      const placed = everyone.get(viewer.id);
      if (placed === undefined) { online += 1; if (city) cities[city] = (cities[city] ?? 0) + 1; }
      else if (placed === null && city) cities[city] = (cities[city] ?? 0) + 1;
    }
    // `today` is never below the players online now: they are players of today.
    return { online, visits: visits ?? 0, today: Math.max(online, seen && seen.day === today() ? seen.count : 0), cities };
  }

  // ---- the counts frame -------------------------------------------------------------------------
  let sentKey = '', sentAt = -Infinity, timer: ReturnType<typeof setTimeout> | null = null;
  const keyOf = (value: Pulse): string => `${value.online}|${value.visits}|${value.today}|${ctx.cityIds.map((id) => value.cities[id] ?? 0).join(',')}`;
  /** Something may have changed: the counts are looked at soon, and sent when they differ from what was sent, at most every PUSH_MS. */
  function changed(): void {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const frame: PulseFrame = { type: 'pulse', ...pulse(null) }, key = keyOf(frame);
      if (key === sentKey) return;
      sentKey = key; sentAt = ctx.now();
      const open = liveSockets().filter((ws) => ws.pulseWatch === true);
      if (!open.length) return;
      if (ctx.broadcast) ctx.broadcast(open, frame); else for (const ws of open) ctx.send(ws, frame);
    }, Math.max(50, sentAt + PUSH_MS - ctx.now()));
    timer.unref?.();
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
          const was = stored['seenDay'] as Record<string, unknown> | undefined;
          let first = was && was['day'] === day && isCount(was['count']) ? was['count'] : 0;
          for (const id of todo) {
            const session = ctx.core?.sessionByPublicId(db, id);
            if (!session || session.visitDay === day) continue;
            session.visitDay = day;
            count += 1; first += 1;
          }
          stored['visits'] = count;
          stored['seenDay'] = { day, count: first };
          return { count, today: first };
        }, { durable: false });
        visits = total.count; seen = { day, count: total.today };
        for (const id of todo) counted.set(id, day);
        changed();
      } catch { /* storage is unavailable: the next beat tries again */ }
    });
    return busy;
  }

  ctx.on?.('heartbeat', () => {
    const ids = [...new Set(liveSockets().map((ws) => ws.session?.id).filter((id): id is string => Boolean(id)))];
    const day = today();
    for (const [id, was] of counted) if (was !== day) counted.delete(id);
    void see(ids);
    changed(); // a player whose grace ran out, or a connection that stopped answering
  });
  ctx.on?.('room-changed', () => changed());

  return {
    pulse,
    see,
    watch(ws, city) {
      const id = ws.session?.id;
      if (!id) return;
      ws.pulseWatch = true;
      if (city && !roomCity(ws) && !lastCity.has(id)) { lastCity.set(id, city); changed(); }
      dirty = true;
      ctx.send(ws, { type: 'pulse', ...pulse({ id, city: roomCity(ws) ?? city ?? lastCity.get(id) ?? null }) });
    },
    opened(ws) {
      const id = ws.session?.id;
      if (!id) return;
      gone.delete(id);
      const city = roomCity(ws);
      if (city) lastCity.set(id, city);
      changed();
    },
    closed(ws) {
      const id = ws.session?.id;
      if (!id) return;
      if (!liveSockets().some((other) => other !== ws && other.session?.id === id)) {
        gone.set(id, { city: roomCity(ws) ?? lastCity.get(id) ?? null, at: ctx.now() });
        // The grace ends by itself: the next heartbeat looks at the counts again (at most one beat after it).
      }
      changed();
    },
  };
}
