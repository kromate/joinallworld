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
 * A connection that dies without closing is dropped by the host's heartbeat (30 s ping, so at
 * most 60 s), after which the grace period starts; stale presence therefore expires within
 * 60 s + RECONNECT_GRACE_MS.
 *
 * Portable: no Node imports. One registry per server context, kept in memory only.
 */
export const RECONNECT_GRACE_MS = 20000;
const OPEN = 1;
const registries = new WeakMap();

/** `lagos:park` → { cityId, venue }, `lagos:home:<id>` → { cityId, venue: 'home', home: true, hostId }. */
export function describeRoom(room) {
  const [cityId, venue, hostId] = String(room).split(':');
  return venue === 'home' ? { cityId, venue, home: true, hostId } : { cityId, venue, home: false };
}

export function presenceOf(ctx) {
  let registry = registries.get(ctx);
  if (registry) return registry;
  const sockets = new Map(); // public id → Set<ws>
  const lastSeen = new Map(); // public id → ms of the last socket close
  const live = (id) => [...(sockets.get(id) || [])].filter((ws) => ws.readyState === OPEN && !(ws.expiresAt <= ctx.now()));
  registry = {
    open(ws) {
      const id = ws.session?.id;
      if (!id) return;
      if (!sockets.has(id)) sockets.set(id, new Set());
      sockets.get(id).add(ws);
      lastSeen.delete(id);
    },
    close(ws) {
      const id = ws.session?.id, set = sockets.get(id);
      if (!set) return;
      set.delete(ws);
      if (set.size) return;
      sockets.delete(id);
      if (lastSeen.size > 5000) for (const [key, at] of lastSeen) if (ctx.now() - at > RECONNECT_GRACE_MS) lastSeen.delete(key);
      lastSeen.set(id, ctx.now());
    },
    /** Open sockets of a player (used to reach their stored session inside a transaction). */
    sockets: live,
    status(id) {
      const open = live(id);
      if (open.length) return { state: 'online', rooms: [...new Set(open.map((ws) => ws.room).filter(Boolean))] };
      const closedAt = lastSeen.get(id);
      return { state: closedAt !== undefined && ctx.now() - closedAt < RECONNECT_GRACE_MS ? 'reconnecting' : 'offline', rooms: [] };
    },
    isIn: (id, room) => live(id).some((ws) => ws.room === room),
    /** Everyone the foundation currently has in `room`, one entry per player. */
    inRoom(room) {
      const members = [];
      for (const id of sockets.keys()) {
        const ws = live(id).find((socket) => socket.room === room);
        if (ws) members.push({ id, name: ws.session.name });
      }
      return members;
    },
  };
  registries.set(ctx, registry);
  return registry;
}
