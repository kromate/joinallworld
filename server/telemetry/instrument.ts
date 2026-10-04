/**
 * What the server's own traffic means as analytics events (pure: no I/O, no clock of its own).
 * The host (server/server.ts) hands these functions what it already has — a route's result, a
 * socket reply, who is in which room — and they answer with events to record. None of them reads
 * a message body, a name or a position; they look at types, codes and ids only.
 *
 * @typedef {{ to: string, name: string, props?: Record<string, string | number | boolean> }} Recorded   `to` is a PUBLIC id
 */

/** Routes whose result is a social operation, by route key. */
const ROUTE_OPS = { 'POST /api/social/friends/request': 'friend-request', 'POST /api/social/friends/answer': 'friend-answer', 'POST /api/social/house/knock': 'knock',
  'POST /api/social/house/answer': 'knock-answer', 'POST /api/social/messages': 'message' };

/** The kind of conversation an id names: dm.<a>.<b>, h.<host> (a home's guest chat), anything else a group. */
const convKind = (conv) => { const id = typeof conv === 'string' ? conv : conv?.id; return typeof id !== 'string' ? 'unknown' : id.startsWith('dm.') ? 'direct' : id.startsWith('h.') ? 'house' : 'group'; };

/**
 * A social operation's result → events. `result` is what the social service answered:
 * { ok, code, duplicate?, player?: { id }, conv? }. A refusal or a repeat records nothing.
 * @returns {Recorded[]}
 */
export function socialEvents(op, selfId, result) {
  if (!result || result.ok !== true || result.duplicate === true || typeof selfId !== 'string') return [];
  const other = typeof result.player?.id === 'string' ? result.player.id : null;
  if (op === 'friend-request' || op === 'friend-answer') {
    if (result.code === 'requested') return [{ to: selfId, name: 'friend_request_sent' }];
    if (result.code === 'accepted') return [{ to: selfId, name: 'friend_made', props: { role: 'accepter' } }, ...(other ? [{ to: other, name: 'friend_made', props: { role: 'asker' } }] : [])];
    return [];
  }
  if (op === 'knock') return result.code === 'knocking' ? [{ to: selfId, name: 'house_knock_sent' }] : [];
  if (op === 'knock-answer') return result.code === 'accepted' || result.code === 'declined' ? [{ to: selfId, name: 'house_knock_answered', props: { accepted: result.code === 'accepted' } }] : [];
  if (op === 'message') return [{ to: selfId, name: 'dm_sent', props: { kind: convKind(result.conv) } }];
  return [];
}

/** An answered HTTP route → events. */
export function routeEvents(method, key, selfId, body) {
  const op = ROUTE_OPS[`${method} ${key}`];
  return op ? socialEvents(op, selfId, body) : [];
}

/** A message the server sent to a socket of `selfId` → events (replies to that player's own requests). */
export function replyEvents(selfId, message) {
  switch (message?.type) {
    case 'friend-result': return socialEvents('friend-answer', selfId, message);
    case 'invite-result': return socialEvents(message.op === 'answer' ? 'knock-answer' : 'knock', selfId, message);
    // 'dm-sent' is only ever sent for a stored message (a failure is 'dm-failed'), so it carries no `ok`.
    case 'dm-sent': return socialEvents('message', selfId, { ok: true, duplicate: message.duplicate, conv: message.conv });
    default: return [];
  }
}

const venueOf = (room) => String(room ?? '').split(':')[1] || 'unknown';

/**
 * Time spent in a room with another real player, and house visits, from snapshots of who is where.
 * beat(rooms, seconds) is called on every server heartbeat with Map<roomKey, Set<publicId>>;
 * it returns the events for stretches that ended. end(publicId) closes one player's stretch.
 */
export function createCoPresence({ minSeconds = 30 } = {}) {
  /** publicId → { room, seconds, peers } */
  const together = new Map();
  /** `${room}|${guest}` for visits already reported */
  const visits = new Set();
  const finish = (id, events) => {
    const run = together.get(id);
    together.delete(id);
    if (run && run.seconds >= minSeconds) events.push({ to: id, name: 'co_presence', props: { venue_id: venueOf(run.room), seconds: Math.round(run.seconds), minutes: Math.round(run.seconds / 6) / 10, peers_max: run.peers } });
  };
  return {
    beat(rooms, seconds) {
      /** @type {Recorded[]} */
      const events = [];
      const seen = new Set(), live = new Set();
      for (const [room, members] of rooms) {
        if (members.size < 2) continue;
        const [, venue, owner] = room.split(':');
        for (const id of members) {
          seen.add(id);
          const run = together.get(id);
          if (run && run.room !== room) finish(id, events);
          const current = together.get(id) || { room, seconds: 0, peers: 0 };
          current.seconds += seconds; current.peers = Math.max(current.peers, members.size - 1);
          together.set(id, current);
          // A guest in the host's Home room while the host is there: one visit per stay.
          if (venue === 'home' && owner && id !== owner && members.has(owner)) {
            const key = `${room}|${id}`;
            live.add(key);
            if (!visits.has(key)) { visits.add(key); events.push({ to: id, name: 'house_visit', props: { role: 'guest' } }, { to: owner, name: 'house_visit', props: { role: 'host' } }); }
          }
        }
      }
      for (const id of [...together.keys()]) if (!seen.has(id)) finish(id, events);
      for (const key of [...visits]) if (!live.has(key)) visits.delete(key);
      return events;
    },
    /** Everything still running, closed (shutdown). */
    end() { const events = []; for (const id of [...together.keys()]) finish(id, events); return events; },
    get size() { return together.size; },
  };
}

/** Voice sessions per socket: on → voice_joined; off, room left or socket closed → voice_left with its length. */
export function createVoice({ now }) {
  const started = new WeakMap();
  const leave = (ws) => {
    const run = started.get(ws);
    if (!run) return [];
    started.delete(ws);
    const seconds = Math.max(0, Math.round((now() - run.at) / 1000));
    return [{ to: run.id, name: 'voice_left', props: { venue_id: run.venue, seconds } }];
  };
  return {
    /** A 'voice-state' message the room accepted. */
    state(ws, enabled) {
      if (enabled !== true) return leave(ws);
      if (started.has(ws) || typeof ws?.session?.id !== 'string') return [];
      started.set(ws, { at: now(), id: ws.session.id, venue: venueOf(ws.room) });
      return [{ to: ws.session.id, name: 'voice_joined', props: { venue_id: venueOf(ws.room) } }];
    },
    leave,
  };
}
