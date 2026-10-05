/**
 * OWNER: social
 * LIVE LOCATION: where a player's friends are in the game right now, pushed to the sockets that watch.
 * The wire types are src/types/live.ts; the socket messages are server/ws/live.ts.
 *
 * WHAT IS TRUE. A player's place is what their STORED life says (the city of their one character, the venue it is
 * recorded at, the timed action that takes it somewhere), and whether they are connected is what the presence
 * registry says (server/social/presence.ts). Nothing a client claims is used, and nothing about a device's real
 * position exists here.
 *
 * EVENTS, NOT POLLING. Every settlement and action of a life passes the life watcher (server/life-service.ts). It
 * compares a few fields with what it last saw for that player and, only when they differ, marks the player. A
 * timer TICK_MS later reads the marked players from the store — so what is published is what is in the data file,
 * never a change the store then undid — and sends each watcher ONE `live-move` frame with the latest spot of every
 * friend that changed. States in between are dropped. A trip is one frame when it starts (from, to, mode, the server
 * time it began, how long it takes) and one when it ends: the watcher works out the place on the route from its own
 * clock.
 *
 * WHO IS TOLD
 *   friends   the players who listed each other (presenceAudience): never an automatic friendship with the founder,
 *             in either direction, so the founder's tens of thousands of friends cost nothing here. A watcher follows
 *             at most LIVE.friends of them. The friendship and the absence of a block are checked again, against the
 *             stored document, each time a spot is delivered: an index that is a moment out of date reveals nothing.
 *   the city  a watcher is in the room of ONE city, the one their character is in. The room carries counts only: how
 *             many players are at each public venue and how many are on a trip. No names, and homes are not counted.
 *             Every watcher of a city is given the SAME counts. A count that left out the players of a watcher's blocks
 *             would differ from a stranger's by exactly those players, and so say where each of them is to anyone
 *             who blocks them (or whom they blocked). Sent at most every CITY_TICKS ticks.
 * A life still held for the quick start is not in the city: it has no spot and is in no count.
 *
 * BOUNDS. One frame per socket per tick (four a second); at most LIVE.batch players are read per tick, the rest
 * wait for the next; a frame carries at most LIVE.friends spots. Memory is one small record per connected player
 * and one index entry per watcher per friend.
 *
 * A HOST THAT FORGETS (the Worker). `ws.liveCity` (the city watched; '' for friends only) travels in the socket's attachment. After a sleep each socket is
 * handed back (restore): its subscription is rebuilt from the stored friendships and it is sent a fresh snapshot,
 * a bounded number of sockets per tick.
 *
 * Portable: no Node imports. One service per server context.
 */
import { characterCity } from '../character.ts';
import { isDeparting } from '../protocol.ts';
import { watchLives } from '../life-service.ts';
import { presenceOf, describeRoom } from './presence.ts';
import { presenceAudience } from './founder.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { LiveCity, LiveSnapshotFrame, LiveSpot } from '../../src/types/live.ts';
import type { Db, RouteContext, SessionRecord, WsConnection } from '../types.ts';

export const LIVE = Object.freeze({
  /** How long changes are gathered before they are sent. */
  tickMs: 250,
  /** A city's counts go out at most once in this many ticks. */
  cityTicks: 4,
  /** Players read from the store, and subscriptions rebuilt, per tick. */
  batch: 200,
  /** Friends one watcher follows. */
  friends: 200,
  /** `live-watch` messages a player may send a minute. */
  watchPerMinute: 30,
});
/** Two readings of one trip differ by rounding only: within this they are the same trip. */
const SAME_START_MS = 1500;

export type LiveService = ReturnType<typeof build>;
const services = new WeakMap<RouteContext, LiveService>();
export function liveOf(ctx: RouteContext): LiveService {
  const known = services.get(ctx);
  if (known) return known;
  const built = build(ctx);
  services.set(ctx, built);
  return built;
}

const held = (state: LifeState): boolean => state.onboarding?.required === true && state.onboarding.done !== true;
/** The few fields of a life that decide its spot: a different text is a different place. */
const signature = (state: LifeState): string => {
  const active = state.activeAction;
  return `${held(state) ? 'held' : ''}|${state.estate?.city ?? ''}|${state.location}|${active && isDeparting(state) ? `${active.kind}|${String(active.id)}|${active.duration}` : ''}`;
};
/** Are two spots the same place? A trip read twice may differ by a rounding of its start. */
function same(a: LiveSpot | undefined, b: LiveSpot | null): boolean {
  if (!a || !b) return !a && !b;
  if (a.status !== b.status || a.cityId !== b.cityId || a.venue !== b.venue || (a.seenAt ?? 0) !== (b.seenAt ?? 0)) return false;
  for (const key of ['trip', 'journey'] as const) {
    const x = a[key], y = b[key];
    if (!x !== !y) return false;
    if (x && y && (x.to !== y.to || x.mode !== y.mode || x.duration !== y.duration || Math.abs(x.startedAt - y.startedAt) > SAME_START_MS)) return false;
  }
  return a.trip?.from === b.trip?.from;
}

function build(ctx: RouteContext) {
  const presence = presenceOf(ctx);
  /** The spot last published for each connected player (and for one who has just left). */
  const known = new Map<string, LiveSpot>();
  /** What the life watcher last saw for a connected player: a hint, not the truth. */
  const hints = new Map<string, string>();
  const dirty = new Set<string>();
  /** Sockets whose subscription has to be rebuilt and answered with a snapshot. */
  const resync = new Set<WsConnection>();
  const cityRooms = new Map<string, Set<WsConnection>>();
  /** player → the sockets that follow them; and each socket's own list, to undo it. */
  const watchers = new Map<string, Set<WsConnection>>();
  const follows = new Map<WsConnection, Set<string>>();
  /** city → venue → players there; the venue '' holds the players on a trip. */
  const occupancy = new Map<string, Map<string, Set<string>>>();
  /** Cities whose counts changed, and the tick each city's counts last went out on. */
  const cityDue = new Set<string>(), citySent = new Map<string, number>();
  const outbox = new Map<WsConnection, Map<string, LiveSpot>>();
  let timer: ReturnType<typeof setTimeout> | null = null, running = false, tick = 0, quiet = true;

  // ---- what a stored life says ------------------------------------------------------------------
  function spotOf(db: Db, id: string): { spot: LiveSpot | null; sig: string | null } {
    const status = presence.status(id);
    if (status.state !== 'online') {
      // Offline, and this process never saw them connected: the stored time of their last request, as the friends list says it.
      const seenAt = status.seenAt ?? (status.state === 'offline' ? db.social?.players?.[id]?.seen : undefined);
      return { spot: { id, status: status.state, ...(typeof seenAt === 'number' && Number.isFinite(seenAt) ? { seenAt } : {}) }, sig: null };
    }
    const session = ctx.core.sessionByPublicId(db, id);
    const cityId = session && session.expiresAt > ctx.now() ? characterCity(session) : null;
    const state = cityId ? session?.cities?.[cityId]?.state : undefined;
    if (!cityId || !state || held(state)) return { spot: null, sig: null };
    const spot: LiveSpot = { id, status: 'online', cityId };
    const active = state.activeAction;
    if (active && isDeparting(state)) {
      const startedAt = Math.round(state.t - (active.duration - active.remaining) * 1000);
      if (active.kind === 'intercity') spot.journey = { to: active.id, mode: active.mode, startedAt, duration: active.duration };
      else if ((active.kind === 'travel' || active.kind === 'commute') && active.id !== state.location) {
        spot.trip = { from: state.location, to: active.id, mode: active.kind === 'commute' ? 'commute' : active.mode ?? 'danfo', startedAt, duration: active.duration };
      }
    } else {
      // A connection in someone else's Home room and none in a room of their own: a visit, as the friends list says it.
      const rooms = status.rooms.map(describeRoom);
      spot.venue = rooms.length && !rooms.some((room) => !room.home || room.hostId === id) ? 'visit' : state.location;
    }
    return { spot, sig: signature(state) };
  }

  // ---- counts ------------------------------------------------------------------------------------
  /** The public venue a spot counts at ('' on a trip inside the city), or null when it counts nowhere. */
  const countedAt = (spot: LiveSpot | undefined | null): string | null => {
    if (!spot || spot.status !== 'online' || !spot.cityId) return null;
    if (spot.trip) return '';
    return spot.venue && spot.venue !== 'home' && spot.venue !== 'visit' ? spot.venue : null;
  };
  function count(spot: LiveSpot | undefined | null, add: boolean): void {
    const venue = countedAt(spot);
    if (venue === null || !spot?.cityId) return;
    let city = occupancy.get(spot.cityId);
    if (!city) { if (!add) return; occupancy.set(spot.cityId, city = new Map()); }
    let here = city.get(venue);
    if (!here) { if (!add) return; city.set(venue, here = new Set()); }
    if (add) here.add(spot.id); else { here.delete(spot.id); if (!here.size) city.delete(venue); if (!city.size) occupancy.delete(spot.cityId); }
    cityDue.add(spot.cityId);
  }
  /** A city's counts: the same for every viewer (see WHO IS TOLD), so nothing about one player can be read out of them. */
  function cityFor(cityId: string): LiveCity {
    const venues: Record<string, number> = {};
    let moving = 0;
    for (const [venue, here] of occupancy.get(cityId) ?? []) { if (venue) venues[venue] = here.size; else moving = here.size; }
    return { cityId, venues, moving };
  }

  // ---- subscriptions -----------------------------------------------------------------------------
  function unfollow(ws: WsConnection): void {
    for (const id of follows.get(ws) ?? []) { const set = watchers.get(id); if (set) { set.delete(ws); if (!set.size) watchers.delete(id); } }
    follows.delete(ws);
  }
  function follow(ws: WsConnection, ids: readonly string[]): void {
    unfollow(ws);
    follows.set(ws, new Set(ids));
    for (const id of ids) { let set = watchers.get(id); if (!set) watchers.set(id, set = new Set()); set.add(ws); }
  }
  function leaveCity(ws: WsConnection): void {
    const room = ws.liveCity ? cityRooms.get(ws.liveCity) : undefined;
    if (room) { room.delete(ws); if (!room.size && ws.liveCity) cityRooms.delete(ws.liveCity); }
  }
  function enterCity(ws: WsConnection, cityId: string): void {
    leaveCity(ws);
    ws.liveCity = cityId;
    let room = cityRooms.get(cityId);
    if (!room) cityRooms.set(cityId, room = new Set());
    room.add(ws);
  }
  /** Friends by request who are not in a block with `me`, at most LIVE.friends. Never an automatic friendship with the founder. */
  const friendsOf = (db: Db, me: string): string[] => presenceAudience(db.social?.players, me).filter((other) => ctx.checks?.blocked?.(me, other) !== true).slice(0, LIVE.friends);
  /** May `viewer` be told where `target` is, as the stored document stands? */
  const mayFollow = (db: Db, viewer: string, target: string): boolean => {
    const players = db.social?.players;
    return players?.[viewer]?.friends[target] !== undefined && players[target]?.friends[viewer] !== undefined && ctx.checks?.blocked?.(viewer, target) !== true;
  };
  /**
   * What one socket may see, read inside a store read: its city (null when its character is elsewhere), its friends, and
   * the spot of each friend nothing is known about yet. The spots that are known are taken when the snapshot is made,
   * not here, so a change published while this read was waiting is in the snapshot.
   */
  function viewOf(db: Db, ws: WsConnection, wanted: string | null): { cityId: CityId | null; friends: string[]; fresh: Map<string, LiveSpot> } | null {
    const session: SessionRecord | undefined = ctx.core.sessionOf(ws, db);
    if (!session || session.expiresAt <= ctx.now() || session.publicId !== ws.session.id) return null;
    const cityId = characterCity(session), state = cityId ? session.cities?.[cityId]?.state : undefined;
    if (!cityId || !state || held(state)) return null;
    const friends = friendsOf(db, session.publicId);
    const fresh = new Map<string, LiveSpot>();
    for (const id of friends) if (!known.has(id)) { const spot = spotOf(db, id).spot; if (spot) fresh.set(id, spot); }
    return { cityId: wanted === null || wanted === cityId ? cityId : null, friends, fresh };
  }
  function snapshot(ws: WsConnection, view: NonNullable<ReturnType<typeof viewOf>>): void {
    if (view.cityId) enterCity(ws, view.cityId); else { leaveCity(ws); ws.liveCity = ''; }
    follow(ws, view.friends);
    outbox.delete(ws);
    const friends = view.friends.flatMap((id) => { const spot = known.get(id) ?? view.fresh.get(id); return spot ? [spot] : []; });
    const frame: LiveSnapshotFrame = { type: 'live-snapshot', at: ctx.now(), city: view.cityId ? cityFor(view.cityId) : null, friends };
    ctx.send(ws, frame);
  }
  function drop(ws: WsConnection): void { unfollow(ws); leaveCity(ws); ws.liveCity = null; outbox.delete(ws); resync.delete(ws); }

  // ---- the tick ----------------------------------------------------------------------------------
  function arm(): void {
    if (timer || running) return;
    timer = setTimeout(() => { timer = null; const work = flush(); ctx.waitUntil?.(work); }, LIVE.tickMs);
    timer.unref?.();
  }
  function mark(id: string): void { dirty.add(id); arm(); }
  const take = <T>(set: Set<T>, most: number): T[] => { const list: T[] = []; for (const item of set) { if (list.length >= most) break; list.push(item); } for (const item of list) set.delete(item); return list; };

  async function flush(): Promise<void> {
    if (running) return;
    // After a quiet spell the first tick counts as a long one, so a city's counts do not wait for their turn.
    running = true; tick += quiet ? LIVE.cityTicks : 1; quiet = false;
    const ids = take(dirty, LIVE.batch), again = take(resync, LIVE.batch).filter((ws) => ctx.core.isOpen(ws));
    try {
      if (ids.length || again.length) {
        // The read may run more than once (store.ts): it only collects, and nothing is changed until it has resolved.
        const read = await ctx.store.read((db) => ({
          spots: ids.map((id) => ({ id, ...spotOf(db, id), viewers: [...(watchers.get(id) ?? [])].filter((ws) => mayFollow(db, ws.session.id, id)) })),
          views: again.map((ws) => viewOf(db, ws, null)),
        }));
        for (const { id, spot, sig, viewers } of read.spots) {
          if (!presence.sockets(id).length) hints.delete(id); else if (sig !== null && hints.has(id)) hints.set(id, sig);
          const before = known.get(id);
          if (same(before, spot)) continue;
          count(before, false); count(spot, true);
          if (spot && spot.status !== 'offline') known.set(id, spot); else known.delete(id);
          const told: LiveSpot = spot ?? { id, status: 'offline' };
          for (const ws of viewers) { let box = outbox.get(ws); if (!box) outbox.set(ws, box = new Map()); box.set(id, told); }
          // A watcher whose own character changed city is moved to that city's room and told what is there.
          if (spot?.cityId && spot.cityId !== before?.cityId) for (const ws of presence.sockets(id)) if (ws.liveCity && ws.liveCity !== spot.cityId) resync.add(ws);
        }
        again.forEach((ws, index) => { const view = read.views[index]; if (view && ctx.core.isOpen(ws)) snapshot(ws, view); else drop(ws); });
      }
      // One frame per socket: the friends that moved, and the city's counts when their turn has come.
      const cities = [...cityDue].filter((cityId) => tick - (citySent.get(cityId) ?? -LIVE.cityTicks) >= LIVE.cityTicks);
      for (const cityId of cities) { cityDue.delete(cityId); citySent.set(cityId, tick); }
      const owed = new Set<WsConnection>(outbox.keys());
      for (const cityId of cities) for (const ws of cityRooms.get(cityId) ?? []) owed.add(ws);
      for (const ws of owed) {
        const spots = [...(outbox.get(ws)?.values() ?? [])].slice(0, LIVE.friends);
        const city = ws.liveCity && cities.includes(ws.liveCity) ? cityFor(ws.liveCity) : null;
        if (spots.length || city) ctx.send(ws, { type: 'live-move', at: ctx.now(), ...(spots.length ? { spots } : {}), ...(city ? { city } : {}) });
      }
      outbox.clear();
    } catch {
      // The store could not be read: the same players are tried again at the next tick.
      for (const id of ids) dirty.add(id);
      for (const ws of again) resync.add(ws);
    } finally {
      running = false;
      if (dirty.size || resync.size || cityDue.size) arm(); else quiet = true;
    }
  }

  // ---- what marks a player -------------------------------------------------------------------------
  const onLife = (publicId: string, _cityId: CityId, state: LifeState): void => {
    // The watcher list is process-wide: a life announced inside another store's transaction is not ours (see ws/rooms.ts).
    if (ctx.store.executing && !ctx.store.executing()) return;
    if (!hints.has(publicId)) return; // nobody connected as this player: nobody is shown where they are
    const sig = signature(state);
    if (hints.get(publicId) === sig) return;
    hints.set(publicId, sig);
    mark(publicId);
  };
  watchLives(onLife);
  // A guest's visit shows as 'visit' from the rooms their sockets are in.
  ctx.on?.('room-changed', ({ cause }) => { if (cause && hints.has(cause)) mark(cause); });
  // A block or an unblock changes which friends each of the two follows: both are given a fresh snapshot.
  ctx.on?.('blocks-changed', ({ a, b }) => {
    for (const id of [a, b]) for (const ws of presence.sockets(id)) if (follows.has(ws) || ws.liveCity) resync.add(ws);
    if (resync.size) arm();
  });
  // A connection that stopped answering is noticed here, and a player who has been gone past the grace period is forgotten.
  ctx.on?.('heartbeat', () => {
    for (const [id, spot] of known) {
      const state = presence.status(id).state;
      if (state === 'offline') { count(spot, false); known.delete(id); } else if (state !== spot.status) mark(id);
    }
    if (cityDue.size) arm();
  });

  return {
    /** Kept so the weakly held watcher lives as long as the service. */
    onLife,
    /** A socket connected (after the presence registry has it): its player is placed. */
    open(ws: WsConnection): void { const id = ws.session?.id; if (!id) return; if (!hints.has(id)) hints.set(id, ''); mark(id); },
    /** A socket closed (after the presence registry dropped it). */
    close(ws: WsConnection): void { const id = ws.session?.id; drop(ws); if (id && hints.has(id)) mark(id); },
    /** A connected socket handed back after the host lost its memory. */
    restore(ws: WsConnection): void {
      const id = ws.session?.id;
      if (!id) return;
      if (!hints.has(id)) hints.set(id, '');
      dirty.add(id);
      if (typeof ws.liveCity === 'string') resync.add(ws);
      arm();
    },
    /** `live-watch`: subscribe this socket and answer with a snapshot. Throws a machine code when it may not. */
    async watch(ws: WsConnection, cityId: CityId): Promise<void> {
      const view = await ctx.store.read((db) => viewOf(db, ws, cityId));
      if (!view) throw Error('onboarding_required');
      if (!ctx.core.isOpen(ws)) return;
      resync.delete(ws);
      snapshot(ws, view);
    },
    unwatch: drop,
    /** Send what is waiting now instead of at the next tick (tests). */
    flush,
    stats: () => ({ known: known.size, watchers: watchers.size, cities: cityRooms.size, dirty: dirty.size }),
  };
}
