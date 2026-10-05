/**
 * What the server's own traffic means as analytics events (pure: no I/O, no clock of its own).
 * The host (server/server.ts) hands these functions what it already has — a route's result, a
 * socket reply, who is in which room — and they answer with events to record. None of them reads
 * a message body, a name or a position; they look at types, codes and ids only.
 *
*/

import type { WsConnection } from '../types.ts';

/** One event to record. `to` is a PUBLIC id. */
export interface Recorded { to: string; name: string; cityId?: string; props?: Record<string, string | number | boolean> }
type SocialOp = 'friend-request' | 'friend-answer' | 'knock' | 'knock-answer' | 'message';
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
/** A field of anything that may be an object; undefined for every other value. */
const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

/** Routes whose result is a social operation, by route key. */
const ROUTE_OPS: Record<string, SocialOp | undefined> = { 'POST /api/social/friends/request': 'friend-request', 'POST /api/social/friends/answer': 'friend-answer', 'POST /api/social/house/knock': 'knock',
  'POST /api/social/house/answer': 'knock-answer', 'POST /api/social/messages': 'message' };

/** The kind of conversation an id names: dm.<a>.<b>, h.<host> (a home's guest chat), anything else a group. */
const convKind = (conv: unknown): string => { const id = typeof conv === 'string' ? conv : field(conv, 'id'); return typeof id !== 'string' ? 'unknown' : id.startsWith('dm.') ? 'direct' : id.startsWith('h.') ? 'house' : 'group'; };

/**
 * A social operation's result → events. `result` is what the social service answered:
 * { ok, code, duplicate?, player?: { id }, conv? }. A refusal or a repeat records nothing.
 */
export function socialEvents(op: string, selfId: unknown, result: unknown): Recorded[] {
  if (!result || field(result, 'ok') !== true || field(result, 'duplicate') === true || typeof selfId !== 'string') return [];
  const playerId = field(field(result, 'player'), 'id');
  const other = typeof playerId === 'string' ? playerId : null;
  const code = field(result, 'code');
  if (op === 'friend-request' || op === 'friend-answer') {
    if (code === 'requested') return [{ to: selfId, name: 'friend_request_sent' }];
    if (code === 'accepted') return [{ to: selfId, name: 'friend_made', props: { role: 'accepter' } }, ...(other ? [{ to: other, name: 'friend_made', props: { role: 'asker' } }] : [])];
    return [];
  }
  if (op === 'knock') return code === 'knocking' ? [{ to: selfId, name: 'house_knock_sent' }] : [];
  if (op === 'knock-answer') return code === 'accepted' || code === 'declined' ? [{ to: selfId, name: 'house_knock_answered', props: { accepted: code === 'accepted' } }] : [];
  if (op === 'message') return [{ to: selfId, name: 'dm_sent', props: { kind: convKind(field(result, 'conv')) } }];
  return [];
}

/** An answered HTTP route → events. */
export function routeEvents(method: string, key: string, selfId: unknown, body: unknown): Recorded[] {
  const op = ROUTE_OPS[`${method} ${key}`];
  return op ? socialEvents(op, selfId, body) : [];
}

/** A message the server sent to a socket of `selfId` → events (replies to that player's own requests). */
export function replyEvents(selfId: unknown, message: unknown): Recorded[] {
  switch (field(message, 'type')) {
    case 'friend-result': return socialEvents('friend-answer', selfId, message);
    case 'invite-result': return socialEvents(field(message, 'op') === 'answer' ? 'knock-answer' : 'knock', selfId, message);
    // 'dm-sent' is only ever sent for a stored message (a failure is 'dm-failed'), so it carries no `ok`.
    case 'dm-sent': return socialEvents('message', selfId, { ok: true, duplicate: field(message, 'duplicate'), conv: field(message, 'conv') });
    default: return [];
  }
}

const venueOf = (room: unknown): string => String(room ?? '').split(':')[1] || 'unknown';
const cityOf = (room: unknown): string | undefined => String(room ?? '').split(':')[0] || undefined;
const cityEvent = (event: Recorded, cityId: string | undefined): Recorded => {
  if (cityId) Object.defineProperty(event, 'cityId', { value: cityId });
  return event;
};

/**
 * Time spent in a room with another real player, and house visits, from snapshots of who is where.
 * beat(rooms, seconds) is called on every server heartbeat with Map<roomKey, Set<publicId>>;
 * it returns the events for stretches that ended. end(publicId) closes one player's stretch.
 */
export function createCoPresence({ minSeconds = 30 }: { minSeconds?: number } = {}) {
  /** publicId → { room, seconds, peers } */
  const together = new Map<string, { room: string; seconds: number; peers: number }>();
  /** `${room}|${guest}` for visits already reported */
  const visits = new Set<string>();
  const finish = (id: string, events: Recorded[]): void => {
    const run = together.get(id);
    together.delete(id);
    if (run && run.seconds >= minSeconds) events.push(cityEvent({ to: id, name: 'co_presence', props: { venue_id: venueOf(run.room), seconds: Math.round(run.seconds), minutes: Math.round(run.seconds / 6) / 10, peers_max: run.peers } }, cityOf(run.room)));
  };
  return {
    beat(rooms: Map<string, Set<string>>, seconds: number): Recorded[] {
      const events: Recorded[] = [];
      const seen = new Set<string>(), live = new Set<string>();
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
            if (!visits.has(key)) { visits.add(key); events.push(cityEvent({ to: id, name: 'house_visit', props: { role: 'guest' } }, cityOf(room)), cityEvent({ to: owner, name: 'house_visit', props: { role: 'host' } }, cityOf(room))); }
          }
        }
      }
      for (const id of [...together.keys()]) if (!seen.has(id)) finish(id, events);
      for (const key of [...visits]) if (!live.has(key)) visits.delete(key);
      return events;
    },
    /** Everything still running, closed (shutdown). */
    end(): Recorded[] { const events: Recorded[] = []; for (const id of [...together.keys()]) finish(id, events); return events; },
    get size() { return together.size; },
  };
}

/** Voice sessions per socket: on → voice_joined; off, room left or socket closed → voice_left with its length. */
export type VoiceSocket = Pick<WsConnection, 'room'> & { session?: { id?: unknown } | undefined };
export function createVoice({ now }: { now: () => number }) {
  const started = new WeakMap<object, { at: number; id: string; cityId?: string; venue: string }>();
  const leave = (ws: VoiceSocket): Recorded[] => {
    const run = started.get(ws);
    if (!run) return [];
    started.delete(ws);
    const seconds = Math.max(0, Math.round((now() - run.at) / 1000));
    return [cityEvent({ to: run.id, name: 'voice_left', props: { venue_id: run.venue, seconds } }, run.cityId)];
  };
  return {
    /** A 'voice-state' message the room accepted. */
    state(ws: VoiceSocket, enabled: unknown): Recorded[] {
      if (enabled !== true) return leave(ws);
      const id = ws?.session?.id;
      if (started.has(ws) || typeof id !== 'string') return [];
      started.set(ws, { at: now(), id, cityId: cityOf(ws.room), venue: venueOf(ws.room) });
      return [cityEvent({ to: id, name: 'voice_joined', props: { venue_id: venueOf(ws.room) } }, cityOf(ws.room))];
    },
    leave,
  };
}
