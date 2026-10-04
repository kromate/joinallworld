/**
 * OWNER: social
 * Live presence, derived only from what the server itself knows: which sockets are open and
 * which venue room the foundation's room module has admitted each of them to (`ws.room`, which
 * the foundation revokes the moment the player's life says they are somewhere else).
 * Nothing here trusts a client's claim about where it is.
 *
 * A player is exactly one of:
 *   online        at least one open socket that is in a venue room
 *   away          connected, but in no venue room (travelling, or the room is being rejoined)
 *   reconnecting  every socket closed less than RECONNECT_GRACE_MS ago
 *   offline       no socket, and the grace period has passed
 * FRESHNESS BOUND. The host pings every socket every `heartbeatMs` (10 s by default). A connection
 * that dies without closing stops counting as online once a ping has gone unanswered for the
 * pong grace (5 s): it reads 'reconnecting' at most heartbeatMs + 5 s = 15 s after it died, is
 * closed by the next beat (at most 20 s), and reads 'offline' RECONNECT_GRACE_MS after that
 * (at most 40 s). Before this the bounds were 60 s and 80 s.
 * `status().seenAt` is the server time a live connection was last heard from; for a player who
 * has disconnected it is the time their last connection closed (kept in memory only, so it is
 * absent after a server restart and for someone who has not connected since).
 *
 * Portable: no Node imports. One registry per server context, kept in memory only.
 */
import type { LookIds } from '../../src/types/social.ts';
import type { PresenceStatus } from '../../src/types/social.ts';
import type { RouteContext, WsConnection } from '../types.ts';

export const RECONNECT_GRACE_MS = 20000;
const OPEN = 1;
/** One answer of status(): `seenAt` is absent for a player who has not connected since the server started. */
export interface PresenceReport { state: Exclude<PresenceStatus, 'away'>; rooms: string[]; seenAt?: number }
export type PresenceRegistry = ReturnType<typeof buildRegistry>;
const registries = new WeakMap<RouteContext, PresenceRegistry>();

/** `lagos:park` → { cityId, venue }, `lagos:home:<id>` → { cityId, venue: 'home', home: true, hostId }. */
export function describeRoom(room: unknown): { cityId: string; venue: string; home: true; hostId: string } | { cityId: string; venue: string; home: false; hostId?: undefined } {
  const [cityId = '', venue = '', hostId = ''] = String(room).split(':');
  return venue === 'home' ? { cityId, venue, home: true, hostId } : { cityId, venue, home: false };
}

export function presenceOf(ctx: RouteContext): PresenceRegistry {
  const cached = registries.get(ctx);
  if (cached) return cached;
  const registry = buildRegistry(ctx);
  registries.set(ctx, registry);
  return registry;
}

function buildRegistry(ctx: RouteContext) {
  const sockets = new Map<string, Set<WsConnection>>(); // public id → Set<ws>
  const lastSeen = new Map<string, number>(); // public id → ms of the last socket close
  // A socket whose last ping has gone unanswered (the host's `unresponsive`) is not counted as live.
  const open = (id: string): WsConnection[] => [...(sockets.get(id) || [])].filter((ws) => ws.readyState === OPEN && !(ws.expiresAt <= ctx.now()));
  const live = (id: string): WsConnection[] => open(id).filter((ws) => ctx.core?.unresponsive?.(ws) !== true);
  return {
    open(ws: WsConnection): void {
      const id = ws.session?.id;
      if (!id) return;
      if (!sockets.has(id)) sockets.set(id, new Set());
      sockets.get(id)!.add(ws);
      lastSeen.delete(id);
    },
    close(ws: WsConnection): void {
      const id = ws.session?.id;
      const set = id === undefined ? undefined : sockets.get(id);
      if (!id || !set) return;
      set.delete(ws);
      if (set.size) return;
      sockets.delete(id);
      if (lastSeen.size > 5000) for (const [key, at] of lastSeen) if (ctx.now() - at > RECONNECT_GRACE_MS) lastSeen.delete(key);
      lastSeen.set(id, ctx.now());
    },
    /** Open sockets of a player (used to reach their stored session inside a transaction). */
    sockets: live,
    status(id: string): PresenceReport {
      const alive = live(id);
      if (alive.length) return { state: 'online', rooms: [...new Set(alive.map((ws) => ws.room).filter((room): room is string => Boolean(room)))], seenAt: Math.max(...alive.map((ws) => (Number.isFinite(ws.seenAt) ? ws.seenAt : 0))) };
      // Connected on paper but not answering pings: say so instead of showing a stale "online".
      if (open(id).length) return { state: 'reconnecting', rooms: [] };
      const closedAt = lastSeen.get(id);
      // A player who left since this server started carries the time their last connection closed.
      return { state: closedAt !== undefined && ctx.now() - closedAt < RECONNECT_GRACE_MS ? 'reconnecting' : 'offline', rooms: [], ...(closedAt !== undefined ? { seenAt: closedAt } : {}) };
    },
    isIn: (id: string, room: string): boolean => live(id).some((ws) => ws.room === room),
    /**
     * Everyone the foundation currently has in `room`, one entry per player. `look` is the
     * appearance the room module recorded from that player's server-held life when they joined
     * (eight option ids, or null) — never anything a client supplied.
     */
    inRoom(room: string): { id: string; name: string; look: LookIds | null }[] {
      const members: { id: string; name: string; look: LookIds | null }[] = [];
      for (const id of sockets.keys()) {
        const ws = live(id).find((socket) => socket.room === room);
        if (ws) members.push({ id, name: ws.session.name, look: ws.look ?? null });
      }
      return members;
    },
  };
}
