import { venueFor } from '../../src/game/cities/runtime.ts';
/**
 * OWNER: foundation
 * Venue rooms: presence, movement, text chat, voice state and proximity-gated signalling.
 * Behaviour is unchanged from the pre-registry server. Public venues share one room per
 * city; Home rooms are keyed per identity, so a home is never shared between devices.
 *
 * GUESTS IN A HOST'S HOME ROOM. `join` accepts { venueId: 'home', hostId }. For a hostId other
 * than the sender's own id the server admits the socket to the HOST's Home room only if
 * ctx.checks.homeGuest(db, senderPublicId, hostId, cityId) — provided by the social module —
 * says the sender is an accepted, unexpired guest of that host and the host's life is at home.
 * The room key is built from the validated hostId, so the message cannot name any other room.
 * A join (as a guest or to one's own venue) puts the socket in the room only once everything its
 * check read is in the data file — never on a host's accept that is still being written and may
 * yet be undone. A join whose basis was undone by a failed write is answered
 * 'storage_unavailable' and may be sent again.
 * A guest whose visit expired, was ended or whose host left home is dropped with 'visit_ended'
 * (see MEMBERSHIP below for when that is checked). A host who leaves home empties their Home room
 * of guests, and a 'visit-ended' event drops one guest at once.
 * Inside the room a guest is an ordinary member: same chat, same proximity-gated signalling,
 * same voice cap, and — as for everyone — voice off and muted on join. Nothing enables it.
 *
 * ONBOARDING GATE. A life still held for the quick start (state.onboarding.required and not done:
 * its Play has not been confirmed) cannot join any room, so it never appears in presence or chat.
 * A guest who has tapped Play joins venue rooms like anyone else; it has no Home room of its own
 * because its life is never at Home (the rules engine refuses it), and it may be a guest in a host's.
 * LOOK. On join the server records the joining life's appearance on the socket (ws.look) from the
 * server-held state, re-validated against the appearance option lists (checkLook): eight option
 * ids, nothing a client sent. It is not added to `presence` (which is re-sent on every move); the
 * social module's who-is-here listing carries it so other players' avatars can be drawn.
 * POSITION. `move` { x, z } (finite, within ±20 — protocol.js validatePosition; at most 5 a second per
 * socket) records where the sender's avatar stands in the venue's scene. It is the ONE position:
 * `presence` carries it to the room (the message is unchanged), and the proximity gate for voice
 * signalling measures between these same positions. (The UNILAG campus alone uses campus coordinates, valid only on
 * its walkable ground, and a join there starts at the main gate: protocol.js.) A join resets it to the origin { x: 0, z: 0 },
 * which clients read as "has not reported a position yet" (a client never reports exactly the origin).
 * GROUPS. A public venue's room is split into groups of bounded size (src/game/roomGroups.ts, rules in ./groups.ts, docs/CAPACITY.md
 * "Room groups"). Presence, moves, chat, signalling and the voice circle (and its cap) are the GROUP's; `ws.room` stays the venue's key and
 * `ws.group` names the group. A page that joined with `deltas` is sent one `presence` snapshot (with `counts`), then `presence-delta`
 * frames; a page that did not gets its group's whole list as the room. Moves are gathered per group. `groups` lists the venue's groups
 * (a friend is named, a stranger is a count); `group-join` hops, or waits for room in a friend's group. Home rooms are not grouped.
 * Groups live in memory only; a host that lost its memory rebuilds them from the sockets' `group`.
 * ROOM-CHANGED. When a room's membership or a member's name changes, this module raises the
 * server event 'room-changed' { room, cityId, venueId, members: [publicId] } (ctx.emit). It sends
 * nothing itself, so the room protocol is unchanged; the social module turns the event into a
 * nudge for sockets that asked to watch who is here.
 *
 * BLOCKS, PER RECIPIENT. Two players of whom either has blocked the other (ctx.checks.blocked, the
 * social module's in-memory index) do not exist for each other in a public room: each is left out
 * of the `presence` list sent to the other, a chat line from one is not delivered to the other,
 * and signalling between them is refused exactly as if the peer were not in the room. Everyone
 * else in the room sees and hears both. Nothing tells either player that the other is present:
 * a join, leave, move or voice change of one sends no presence frame to the other, and the
 * 'room-changed' event names its cause so the who-is-here nudge skips them too. (One thing is
 * still shared: the room's voice cap counts everyone, so a blocked pair can fill it for each other.)
 * CHAT TEXT. A chat line passes the text filter (server/moderation/text.ts) and the sender's mute
 * state (ctx.checks.muted). A refused line is answered with an `error` carrying the code
 * ('text_blocked' | 'muted'), a `reason` sentence (repeated as `message`, the field the community
 * panel prints in its status line) and the line's clientId; it is delivered to nobody.
 * MEMBERSHIP IS RE-CHECKED AGAINST THE STORED LIFE, NOT REMEMBERED
 *   Who may be in a room is one rule, protocol.js canOccupyVenue: recorded at the venue and not
 *   departing (a trip, the automatic commute, any timed action registered with `moves: true`).
 *   A socket's `ws.room` is only a record of an admission; it is re-checked:
 *   - WHEN THE LIFE CHANGES. life-service.js tells this module, synchronously, every time a life is
 *     settled or acted on. If the result no longer allows one of that player's rooms (or, for a
 *     host, their guests) the sockets are MARKED at once — a marked socket forwards nothing — and
 *     re-checked against the store straight after the transaction, whichever route, socket message
 *     or timer made the change. The re-check takes its verdict from the stored document only once
 *     that is in the data file: if the write succeeded the membership and the voice state end; if
 *     it failed the change was undone (store.js), the departure did not happen, and the mark is
 *     lifted with the player still in the room.
 *   - BEFORE ANY ROOM MESSAGE IS FORWARDED. move, voice-state, signal and chat first ask
 *     `admitted(ws)`: a marked socket is re-checked before anything is delivered, and one that is
 *     no longer allowed is dropped and answered 'join_required'. Nothing is forwarded on the
 *     strength of a remembered membership for a life that is departing.
 *   - FOR GUESTS, AT THE VISIT'S OWN EXPIRY. A guest's entitlement is remembered for at most
 *     GUEST_RECHECK_MS and never past the visit's expiry timestamp, so the first room message at or
 *     after that instant is refused. Blocks and removals drop the guest at once ('visit-ended').
 *   - WHEN THE HOST IS GONE. A host whose life leaves home (including by commute) ends every
 *     visit. A host with no socket in their own Home room for HOST_ABSENCE_GRACE_MS (a reload fits
 *     inside it) ends them too: the guests are dropped and 'host-absent' is raised so the social
 *     module closes the stored visits.
 *   - ON EVERY HEARTBEAT, for sockets that send nothing: guests and marked sockets are swept, so an
 *     idle guest leaves at most one heartbeat interval (10 s by default) after the visit ends.
 *   - BY THE ROUTE HOST: validateMemberships(secret, city, state, publicId) after a settlement that
 *     was saved, and revalidate(publicId) after every API request of a player who has a socket,
 *     whether the request succeeded or failed (server.js; lifecycle hooks, ws/index.js).
 *   A verdict is never taken from a change that is not in the data file. If the store cannot be
 *   read at all the sockets concerned are dropped — unknown is treated as "not allowed".
 *   When a check ends a visit this module raises, for the social module to close the stored visit:
 *   'home-closed' { hostId, cityId } (the host's life left home), 'host-absent' { hostId, guestId,
 *   cityId } (no host connection in the room) or 'guest-expired' with the same fields (anything else).
 */
import { MAX_VOICE_MEMBERS, UUID_PATTERN, canOccupyVenue, initialVenuePosition, validatePosition, withinVoiceDistance, venueRoomKey } from '../protocol.ts';
import { ROOM_CHAT_QUIET_MS, ROOM_FRIEND_NEAR, ROOM_GROUP_LIST, ROOM_GROUP_MAX, ROOM_GROUP_MIN, ROOM_GROUP_OVERFLOW, ROOM_GROUP_TARGET, ROOM_MOVE_FLUSH_MS, groupNotice } from '../../src/game/roomGroups.ts';
import type { RoomGroupLimits } from '../../src/game/roomGroups.ts';
import { newVenue, place, planMerge, seat, unseat } from './groups.ts';
import type { Venue } from './groups.ts';
import { presenceAudience } from '../social/founder.ts';
import { watchLives } from '../life-service.ts';
import { characterCity } from '../character.ts';
import { checkLook } from '../../src/game/systems/onboarding.ts';
import { screenText } from '../moderation/text.ts';
import type { CityId, ChatFrame, GroupSummary, PresenceDeltaFrame, PresenceMember, PublicSession, RoomCounts, SignalData } from '../../src/types/protocol.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { Db, IncomingFrame, RouteContext, ServerEvents, SessionRecord, WsConnection, WsHandlers, WsMessageEntry } from '../types.ts';

/** The longest a guest's entitlement is remembered between checks (and never past the visit's expiry). */
export const GUEST_RECHECK_MS = 3000;
/** How long a host may have no socket in their own Home room before their guests are sent away (a page reload fits). */
export const HOST_ABSENCE_GRACE_MS = 60000;

/** The retry receipts of one sender in one room: the Map this module keeps, or the one a host whose memory does not last keeps (ctx.core.chatHistory). */
interface ChatHistory {
  has(id: string): boolean
  get(id: string): unknown
  set(id: string, chat: ChatFrame): void
  delete(id: string): void
  keys(): Iterable<string>
  readonly size: number
}
/** What re-checking one socket against the stored document found. */
type Verdict =
  | { stay: boolean }
  | { hostId: string; city: string; live: boolean; until: number; hostOut: boolean; open: boolean }
/** An event that ends a visit, raised once the verdicts are in. */
type Ended =
  | { event: 'host-absent' | 'guest-expired'; detail: { hostId: string; guestId: string; cityId: string } }
  | { event: 'home-closed'; detail: { hostId: string; cityId: string } }
type RoomHandler = (ws: WsConnection, message: IncomingFrame, room: string) => void | Promise<void>

/** A frame the Worker stored as a retry receipt is the chat line it sent. */
const isChatFrame = (value: unknown): value is ChatFrame => typeof value === 'object' && value !== null && 'type' in value && value.type === 'chat' && 'body' in value && typeof value.body === 'string';

export default function roomSocket(ctx: RouteContext): WsHandlers {
  const { store, now, allow, settle, send, core } = ctx;
  /** One frame to several sockets, as text made once where the host can (ctx.broadcast). */
  const sendAll = (list: Iterable<WsConnection>, message: Parameters<typeof send>[1]): void => { if (ctx.broadcast) ctx.broadcast(list, message); else for (const ws of list) send(ws, message); };
  const rooms = new Map<string, Set<WsConnection>>();
  const chatHistory = new Map<string, ChatHistory>();
  /** Retry histories kept in memory (each at most 100 lines of one player in one room). */
  const CHAT_HISTORIES = 5000;
  const inRooms = new Map<string, Set<WsConnection>>(); // public id → Set<ws> of that player's sockets that are in a room
  const hostGone = new Map<string, number>(); // Home room key → server ms since which its host has had no socket in it

  // ---- groups (in memory only: nothing here is stored, and a host that lost its memory rebuilds it from the sockets) ----
  const limits: RoomGroupLimits = { target: ctx.config.roomGroupTarget ?? ROOM_GROUP_TARGET, max: ctx.config.roomGroupMax ?? ROOM_GROUP_MAX, min: ctx.config.roomGroupMin ?? ROOM_GROUP_MIN };
  const venues = new Map<string, Venue>(); // public venue room key → its groups
  const groupSockets = new Map<string, Set<WsConnection>>(); // `${room}#${group}` → the sockets in that group
  const friendsCache = new Map<string, { at: number; set: ReadonlySet<string> }>(); // player → mutual friends, read when they joined
  const FRIENDS_FRESH_MS = 60000;
  const chatAt = new Map<string, number>(); // player → server ms of their last chat line in a venue
  const recent = new Map<string, { room: string; group: string; at: number }>(); // player → the group they just left (a reload goes back to it)
  const RECENT_MS = 60000;
  const seeking = new Map<string, { room: string; friend: string }>(); // player → the friend whose group they will be moved to when it has room
  const dirty = new Set<string>(); // venues whose total changed since it was last sent
  const pendingMoves = new Map<string, { moves: Map<string, { x: number; z: number }>; timer: unknown; last: number }>();
  const grouped = (room: string): boolean => room.split(':')[1] !== 'home';
  const gkey = (room: string, group: string): string => `${room}#${group}`;
  const NONE: ReadonlySet<WsConnection> = new Set();
  /** The sockets that share presence with ws: its group of a public venue, or a whole Home room. */
  const audience = (room: string, group: string | null | undefined): ReadonlySet<WsConnection> => (group ? groupSockets.get(gkey(room, group)) : rooms.get(room)) ?? NONE;
  const hidden = (a: string, b: string) => a !== b && ctx.checks?.blocked?.(a, b) === true;
  /** Is this socket told of its group by changes (after one snapshot), rather than by whole lists? */
  const deltaOf = (ws: WsConnection): boolean => ws.deltas === true && Boolean(ws.group);
  const countsOf = (room: string, group: string): RoomCounts | null => {
    const venue = venues.get(room), found = venue?.groups.get(group);
    return venue && found ? { here: found.players.size, total: venue.where.size, groups: venue.groups.size, cap: limits.max } : null;
  };
  /** One entry per player of a set of sockets: a player with two sockets is one member, in voice if either is. */
  function membersOf(list: Iterable<WsConnection>): Map<string, PresenceMember> {
    const members = new Map<string, PresenceMember>();
    for (const ws of list) {
      const old = members.get(ws.session.id);
      members.set(ws.session.id, { ...ws.session, position: { ...ws.position }, enabled: (old?.enabled || ws.voice.enabled), muted: old ? old.muted && ws.voice.muted : ws.voice.muted });
    }
    return members;
  }
  /** A way to ask "can this recipient not see that player?", or null while nobody has blocked anybody (then one list serves everyone). */
  const blockFilter = (): ((a: string, b: string) => boolean) | null => (ctx.checks?.anyBlocks?.() === true ? hidden : null);
  /** The group as one socket sees it, whole: its first `presence` on joining, and again whenever what it can see is rebuilt. */
  function snapshot(ws: WsConnection): void {
    if (!ws.room) return;
    const hide = blockFilter(), me = ws.session.id;
    const all = [...membersOf(audience(ws.room, ws.group)).values()];
    const members = hide ? all.filter(member => member.id === me || !hide(me, member.id)) : all;
    const counts = deltaOf(ws) && ws.group ? countsOf(ws.room, ws.group) : null;
    send(ws, counts ? { type: 'presence', members, counts, delta: true } : { type: 'presence', members });
  }
  interface Change { joined?: string[]; left?: string[]; voice?: string[]; causes?: readonly string[]; snapshotted?: readonly WsConnection[] }
  /**
   * Tell a group what changed. A page that reads the venue by changes gets one frame holding the joins, leaves, voice changes
   * and the moves gathered since the last frame; a page that does not gets the group's whole list, as the room's list was always
   * sent — but of the group, never of the venue. `causes` are who made the change: a recipient all of them are hidden from gets nothing.
   */
  function announce(room: string, group: string | null, change: Change = {}): void {
    const sockets = audience(room, group);
    if (!sockets.size) return;
    const gk = group ? gkey(room, group) : room;
    const queued = pendingMoves.get(gk);
    const moves = queued?.moves.size ? [...queued.moves] : [];
    if (queued) { queued.moves = new Map(); queued.last = now(); }
    const hide = blockFilter(), causes = [...(change.causes ?? []), ...moves.map(([id]) => id)];
    const whole: WsConnection[] = [], fresh: WsConnection[] = [];
    for (const ws of sockets) (deltaOf(ws) ? (change.snapshotted?.includes(ws) ? [] : fresh) : whole).push(ws);
    if (whole.length) {
      const everyone = [...membersOf(sockets).values()];
      if (!hide) sendAll(whole, { type: 'presence', members: everyone });
      else for (const ws of whole) {
        if (causes.length && causes.every(cause => cause !== ws.session.id && hide(ws.session.id, cause))) continue;
        send(ws, { type: 'presence', members: everyone.filter(member => member.id === ws.session.id || !hide(ws.session.id, member.id)) });
      }
    }
    if (!fresh.length) return;
    const members = membersOf(sockets);
    const counts = group && (change.joined || change.left) ? countsOf(room, group) ?? undefined : undefined;
    const frameFor = (seen: (id: string) => boolean): PresenceDeltaFrame | null => {
      const joined = (change.joined ?? []).filter(id => seen(id)).flatMap(id => { const member = members.get(id); return member ? [member] : []; });
      const voice = (change.voice ?? []).filter(id => seen(id)).flatMap(id => { const member = members.get(id); return member ? [{ id, enabled: member.enabled, muted: member.muted }] : []; });
      const moved = moves.filter(([id]) => members.has(id) && seen(id)).map(([id, at]) => ({ id, x: at.x, z: at.z }));
      const left = (change.left ?? []).filter(id => seen(id));
      if (!joined.length && !voice.length && !moved.length && !left.length && !counts) return null;
      return { type: 'presence-delta', ...(joined.length ? { joined } : {}), ...(left.length ? { left } : {}), ...(moved.length ? { moved } : {}), ...(voice.length ? { voice } : {}), ...(counts ? { counts } : {}) };
    };
    if (!hide) { const frame = frameFor(() => true); if (frame) sendAll(fresh, frame); return; }
    for (const ws of fresh) { const frame = frameFor(id => id === ws.session.id || !hide(ws.session.id, id)); if (frame) send(ws, frame); }
  }
  /** A member moved: gathered with the group's other moves and sent at most every ROOM_MOVE_FLUSH_MS (the first one at once). */
  function queueMove(ws: WsConnection, room: string, position: { x: number; z: number }): void {
    const gk = ws.group ? gkey(room, ws.group) : room;
    const entry = pendingMoves.get(gk) ?? { moves: new Map<string, { x: number; z: number }>(), timer: null, last: 0 };
    pendingMoves.set(gk, entry);
    entry.moves.set(ws.session.id, position);
    if (entry.timer !== null) return;
    const wait = ROOM_MOVE_FLUSH_MS - (now() - entry.last);
    const group = ws.group ?? null;
    const flush = (): void => { entry.timer = null; if (entry.moves.size) announce(room, group); };
    if (wait <= 0) { flush(); return; }
    const timer: unknown = setTimeout(flush, Math.min(wait, ROOM_MOVE_FLUSH_MS));
    if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') timer.unref();
    entry.timer = timer;
  }
  const dropMoves = (room: string, group: string): void => {
    const entry = pendingMoves.get(gkey(room, group));
    if (entry && typeof entry.timer !== 'undefined' && entry.timer !== null) clearTimeout(entry.timer as ReturnType<typeof setTimeout>);
    pendingMoves.delete(gkey(room, group));
  };
  // A block or unblock changes who each of the two can see: they are sent their group again, and so is everyone in it who reads whole lists.
  ctx.on?.('blocks-changed', ({ a, b }) => {
    const touched = new Set<string>();
    for (const id of [a, b]) for (const ws of inRooms.get(id) ?? []) if (ws.room) touched.add(ws.group ? gkey(ws.room, ws.group) : ws.room);
    for (const key of touched) {
      const [room = '', group = ''] = key.split('#');
      for (const ws of group ? groupSockets.get(key) ?? NONE : rooms.get(room) ?? NONE) if (!deltaOf(ws) || ws.session.id === a || ws.session.id === b) snapshot(ws);
    }
  });
  /** Announce (inside the server only) that who is in a group of `room` changed. `also` is someone who just left. */
  function roomChanged(room: string, group: string | null, also: string | null, cause: string | null = also ?? null): void {
    const members = new Set([...audience(room, group)].map(ws => ws.session.id));
    if (also) members.add(also);
    const [cityId = '', venueId = ''] = room.split(':');
    // `cause` is who joined, left or was renamed: listeners must not nudge anyone that player is hidden from.
    ctx.emit?.('room-changed', { room, cityId, venueId, members: [...members], cause });
  }
  const homeOwner = (room: string): string | null => { const [, venue, owner] = room.split(':'); return venue === 'home' ? owner ?? null : null; };
  const hostPresent = (room: string, hostId: string) => [...(rooms.get(room) || [])].some(peer => peer.session.id === hostId);
  const nameOf = (id: string, room: string): string | null => { for (const ws of inRooms.get(id) ?? []) if (ws.room === room) return ws.session.name; return null; };
  const inVoice = (id: string, room: string): boolean => [...(inRooms.get(id) ?? [])].some(ws => ws.room === room && ws.voice.enabled);
  /** Put a socket in a group of its room: the one a restored socket carries, its player's own group (a second socket), or the one placement chooses. */
  function placeIn(ws: WsConnection, room: string, wish: { friends: ReadonlySet<string>; follow: string | null } | null): { apart: string | null } {
    if (!grouped(room)) { ws.group = null; return { apart: null }; }
    let venue = venues.get(room);
    if (!venue) { venue = newVenue(); venues.set(room, venue); }
    const id = ws.session.id;
    let apart: string | null = null, group = venue.where.get(id) ?? null;
    if (group === null && wish === null && ws.group) group = seat(venue, id, ws.group).id; // a socket handed back by a host that slept: where it was
    if (group === null) {
      const before = recent.get(id);
      const placement = place(venue, limits, { player: id, friends: wish?.friends ?? friendsCache.get(id)?.set ?? new Set(), follow: wish?.follow ?? null, previous: before && before.room === room && now() - before.at < RECENT_MS ? before.group : null, blocked: hidden });
      group = seat(venue, id, placement.group).id; apart = placement.apart;
      dirty.add(room);
    }
    ws.group = group;
    const key = gkey(room, group), set = groupSockets.get(key) ?? new Set<WsConnection>();
    groupSockets.set(key, set); set.add(ws);
    return { apart };
  }
  function enter(ws: WsConnection, room: string, wish: { friends: ReadonlySet<string>; follow: string | null } | null = null): { apart: string | null } {
    ws.room = room;
    const members = rooms.get(room) ?? new Set<WsConnection>();
    rooms.set(room, members);
    members.add(ws);
    const mine = inRooms.get(ws.session.id) ?? new Set<WsConnection>();
    inRooms.set(ws.session.id, mine);
    mine.add(ws);
    if (homeOwner(room) === ws.session.id) hostGone.delete(room); // the host is (back) in their own Home room
    return placeIn(ws, room, wish);
  }
  function leave(ws: WsConnection): void {
    if (!ws.room) return;
    const room = ws.room, group = ws.group ?? null, id = ws.session.id;
    rooms.get(room)?.delete(ws);
    if (!rooms.get(room)?.size) rooms.delete(room);
    const mine = inRooms.get(id);
    if (mine) { mine.delete(ws); if (!mine.size) inRooms.delete(id); }
    if (group) { const key = gkey(room, group), set = groupSockets.get(key); set?.delete(ws); if (set && !set.size) groupSockets.delete(key); }
    ws.room = null; ws.group = null; ws.stale = false; ws.guestUntil = 0;
    // The host's last socket left their own Home room while guests are inside: the absence clock starts.
    if (homeOwner(room) === id && rooms.has(room) && !hostPresent(room, id) && !hostGone.has(room)) hostGone.set(room, now());
    const stays = [...(mine ?? [])].some(other => other.room === room);
    if (group && !stays) forget(room, group, id);
    if (!mine?.size) { friendsCache.delete(id); chatAt.delete(id); seeking.delete(id); }
    if (stays && group) announce(room, group, { voice: [id], causes: [id] });
    else announce(room, group, { left: [id], causes: [id] });
    roomChanged(room, group, id);
    if (group && !stays) tidy(room);
  }
  /** A player's last socket left a group: take them out of the venue's books. */
  function forget(room: string, group: string, id: string): void {
    const venue = venues.get(room);
    if (!venue) return;
    unseat(venue, id);
    recent.set(id, { room, group, at: now() });
    if (recent.size > 5000) for (const [key, item] of recent) if (now() - item.at > RECENT_MS) recent.delete(key);
    if (!venue.groups.has(group)) dropMoves(room, group);
    if (!venue.where.size) venues.delete(room);
    dirty.add(room);
  }
  /** After somebody left a venue: players waiting to be with a friend are moved if there is room now, and small groups are merged. */
  function tidy(room: string): void {
    const venue = venues.get(room);
    if (!venue) return;
    for (const [player, wish] of [...seeking]) {
      if (wish.room !== room) continue;
      const home = venue.where.get(wish.friend), target = home === undefined ? undefined : venue.groups.get(home);
      if (!target) { seeking.delete(player); continue; }
      if (venue.where.get(player) === target.id) { seeking.delete(player); continue; }
      if (target.players.size < limits.max + ROOM_GROUP_OVERFLOW && !inVoice(player, room) && !hidden(player, wish.friend)) { seeking.delete(player); relocate(room, [player], target.id, 'moved'); }
    }
    for (const group of [...venue.groups.values()]) {
      if (group.players.size >= limits.min || !venue.groups.has(group.id)) continue;
      const plan = planMerge(venue, limits, group, {
        seated: id => ctx.checks?.seated?.(id) === true,
        voice: id => inVoice(id, room),
        chatting: id => now() - (chatAt.get(id) ?? -Infinity) < ROOM_CHAT_QUIET_MS,
        together: (a, b) => (friendsCache.get(a)?.set.has(b) ?? false) && near(a, b, room),
        blocked: hidden,
        voiceCap: MAX_VOICE_MEMBERS,
      });
      if (plan) relocate(room, plan.movers, plan.to, 'moved');
    }
  }
  /** Two players have each reported where they stand, and it is close. */
  function near(a: string, b: string, room: string): boolean {
    const at = (id: string) => [...(inRooms.get(id) ?? [])].find(ws => ws.room === room)?.position;
    const first = at(a), second = at(b);
    if (!first || !second || (first.x === 0 && first.z === 0) || (second.x === 0 && second.z === 0)) return false;
    return Math.hypot(first.x - second.x, first.z - second.z) < ROOM_FRIEND_NEAR;
  }
  /** Move whole players (every socket they have in the room) to another group, and tell both groups and the movers. */
  function relocate(room: string, players: readonly string[], to: string, event: 'moved'): void {
    const venue = venues.get(room);
    if (!venue || !venue.groups.has(to)) return;
    const left = new Map<string, string[]>(), arrived: string[] = [], movedSockets: WsConnection[] = [];
    for (const id of players) {
      const from = venue.where.get(id);
      if (from === undefined || from === to) continue;
      for (const ws of inRooms.get(id) ?? []) {
        if (ws.room !== room) continue;
        const key = gkey(room, from), set = groupSockets.get(key);
        set?.delete(ws); if (set && !set.size) groupSockets.delete(key);
        ws.group = to;
        const next = groupSockets.get(gkey(room, to)) ?? new Set<WsConnection>();
        groupSockets.set(gkey(room, to), next); next.add(ws); movedSockets.push(ws);
      }
      seat(venue, id, to);
      if (!venue.groups.has(from)) dropMoves(room, from);
      left.set(from, [...(left.get(from) ?? []), id]); arrived.push(id);
    }
    if (!arrived.length) return;
    dirty.add(room);
    for (const [from, ids] of left) { announce(room, from, { left: ids, causes: ids }); roomChanged(room, from, null, null); }
    for (const ws of movedSockets) snapshot(ws);
    announce(room, to, { joined: arrived, causes: arrived, snapshotted: movedSockets });
    roomChanged(room, to, null, null);
    const here = venue.groups.get(to)?.players.size ?? 0;
    for (const ws of movedSockets) if (deltaOf(ws)) send(ws, { type: 'group', event, here, text: groupNotice(here) });
  }
  function drop(ws: WsConnection, code: 'venue_mismatch' | 'visit_ended'): void {
    leave(ws); ws.voice = { enabled: false, muted: true };
    send(ws, { type: 'error', code, error: code });
  }
  /** The host id of the Home room a socket is visiting as a guest, or null (also null in its own Home room). */
  const visitedHost = (ws: WsConnection, city: string): string | null => {
    const [roomCity, venue, owner] = (ws.room || '').split(':');
    return roomCity === city && venue === 'home' && owner && owner !== ws.session.id ? owner : null;
  };
  const cityOf = (ws: WsConnection): string => (ws.room || '').split(':')[0] ?? '';
  /** The stored life of a session in the city a room key names, if that is one of the server's cities. */
  const lifeIn = (session: SessionRecord, city: string): LifeState | undefined => {
    const cityId = ctx.cityIds.find((item) => item === city);
    return cityId === undefined ? undefined : (session.cities as SessionRecord['cities'] | undefined)?.[cityId]?.state;
  };
  /**
   * Until when (server ms) is this player an accepted guest of that host, or 0 if they are not.
   * The social module answers: checks.homeGuestUntil gives the visit's expiry; with only the
   * yes/no checks.homeGuest the answer is good for this instant alone, so nothing is remembered.
   * While neither exists nobody is anybody's guest.
   */
  function guestUntil(db: Db, guestId: string, hostId: string, city: string): number {
    const cityId = ctx.cityIds.find((item) => item === city);
    if (cityId === undefined) return 0;
    if (typeof ctx.checks?.homeGuestUntil === 'function') {
      const until = ctx.checks.homeGuestUntil(db, guestId, hostId, cityId);
      return Number.isFinite(until) && until > now() ? until : 0;
    }
    return ctx.checks?.homeGuest?.(db, guestId, hostId, cityId) === true ? now() : 0;
  }
  /** Does the host keep their home open for friends while they are out ("Friends can visit while I am out")? Then an empty room is not a reason to end a visit. */
  const openWhileOut = (db: Db, hostId: string): boolean => ctx.checks?.homeOpenOut?.(db, hostId) === true;
  /** Has this Home room been without its host for longer than the grace period? Starts the clock if nobody has. */
  function hostAbsent(room: string, hostId: string): boolean {
    if (hostPresent(room, hostId)) { hostGone.delete(room); return false; }
    if (!hostGone.has(room)) {
      if (hostGone.size >= 2000) { const oldest = hostGone.keys().next(); if (!oldest.done) hostGone.delete(oldest.value); }
      hostGone.set(room, now());
    }
    const since = hostGone.get(room);
    return since !== undefined && now() - since >= HOST_ABSENCE_GRACE_MS;
  }
  /** Is this socket's own-venue room the one the life occupies right now? (Never true for a departing life.) */
  const occupies = (ws: WsConnection, city: string, state: LifeState | null | undefined): boolean => state !== undefined && state !== null && canOccupyVenue(state, state.location) && ws.room === venueRoomKey(city, state.location, ws.session.id);

  /**
   * Re-check sockets against the STORED document and drop the ones that are no longer allowed.
   * The read only collects verdicts; nothing is dropped until the read has resolved, and a store
   * read resolves only once everything it could have seen is in the data file (and runs again if a
   * failed write took some of it back). So a verdict is never taken from a change that was then
   * undone: a departure whose write failed did not happen, and the socket stays. Until the verdict
   * is in, a marked socket forwards nothing (see admitted()). If the read itself cannot be
   * completed, every socket in the list is dropped — unknown is treated as "not allowed".
   */
  function verify(list: WsConnection[]): Promise<void> {
    const items = [...new Set(list)].flatMap((ws) => (ws.room ? [{ ws, room: ws.room }] : []));
    if (!items.length) return Promise.resolve();
    const failClosed = () => { for (const { ws, room } of items) if (ws.room === room) drop(ws, visitedHost(ws, cityOf(ws)) ? 'visit_ended' : 'venue_mismatch'); };
    let reading: Promise<(Verdict | null)[]>;
    try { reading = store.read((db) => items.map(({ ws, room }): Verdict | null => {
      if (ws.room !== room) return null;
      const city = cityOf(ws), hostId = visitedHost(ws, city);
      const session = core.sessionOf(ws, db);
      const live = Boolean(session) && (session?.expiresAt ?? 0) > now();
      if (!hostId) return { stay: live && occupies(ws, city, session ? lifeIn(session, city) : undefined) };
      const until = live && session ? guestUntil(db, session.publicId, hostId, city) : 0;
      // Why a visit is over, so the social module closes the stored visit with the right words.
      return { hostId, city, live, until, hostOut: !until && typeof ctx.atHome === 'function' && ctx.atHome(db, hostId, city) === false, open: openWhileOut(db, hostId) };
    })); } catch { failClosed(); return Promise.resolve(); }
    return Promise.resolve(reading).then((verdicts) => {
      const ended: Ended[] = [];
      items.forEach(({ ws, room }, index) => {
        const verdict = verdicts[index];
        if (!verdict || ws.room !== room) return;
        if (!('hostId' in verdict)) { if (verdict.stay) ws.stale = false; else drop(ws, 'venue_mismatch'); return; }
        const { hostId, city } = verdict, guestId = ws.session.id;
        if (verdict.live && !verdict.open && hostAbsent(room, hostId)) { drop(ws, 'visit_ended'); ended.push({ event: 'host-absent', detail: { hostId, guestId, cityId: city } }); return; }
        if (verdict.until) { ws.guestUntil = Math.min(now() + GUEST_RECHECK_MS, verdict.until); return; }
        drop(ws, 'visit_ended');
        if (!verdict.hostOut) ended.push({ event: 'guest-expired', detail: { hostId, guestId, cityId: city } });
        else if (!ended.some((item) => item.event === 'home-closed' && item.detail.hostId === hostId && item.detail.cityId === city)) ended.push({ event: 'home-closed', detail: { hostId, cityId: city } });
      });
      for (const item of ended) {
        if (item.event === 'home-closed') ctx.emit?.(item.event, item.detail);
        else ctx.emit?.(item.event, item.detail);
      }
    }, failClosed);
  }
  /** Everything that depends on one player's lives: their own sockets in rooms, and the guests in their Home rooms. */
  function dependants(publicId: string): WsConnection[] {
    const list = [...(inRooms.get(publicId) || [])];
    // A player's Home room has one key per city: looked up, not searched for among every room.
    for (const city of ctx.cityIds) for (const ws of rooms.get(venueRoomKey(city, 'home', publicId)) ?? []) if (ws.session.id !== publicId) list.push(ws);
    return list;
  }
  const revalidate = (publicId: unknown): Promise<void> => (typeof publicId === 'string' ? verify(dependants(publicId)) : Promise.resolve());

  // A life was settled or acted on (inside somebody's transaction). If what it now says no longer
  // allows a room, mark the sockets and re-check them against the store right after that
  // transaction: the mark stops forwarding at once, the re-check drops them and tells the room.
  const scheduled = new Set<string>();
  const onLife = (publicId: string, city: CityId, state: LifeState): void => {
    // The watcher list is process-wide. A life announced inside ANOTHER store's transaction (an earlier Durable Object instance in
    // this isolate that has not been collected) is not ours: re-checking sockets would read this instance's storage on that request's behalf.
    if (ctx.store.executing && !ctx.store.executing()) return;
    let due = false;
    for (const ws of inRooms.get(publicId) || []) {
      if (cityOf(ws) !== city || visitedHost(ws, city)) continue;
      if (!occupies(ws, city, state)) { ws.stale = true; due = true; }
    }
    if (!canOccupyVenue(state, 'home')) {
      for (const ws of rooms.get(venueRoomKey(city, 'home', publicId)) || []) if (ws.session.id !== publicId) { ws.guestUntil = 0; due = true; }
    }
    if (!due || scheduled.has(publicId)) return;
    scheduled.add(publicId);
    queueMicrotask(() => { scheduled.delete(publicId); revalidate(publicId); });
  };
  watchLives(onLife);
  core.lifeWatcher = onLife; // watchLives holds it weakly: this keeps it for as long as the server exists

  /**
   * The check every room message passes before anything is forwarded: a socket marked by a life
   * change, a guest whose remembered entitlement has run out (or whose host has no socket in the
   * room) is re-checked first. Throws 'join_required' if the socket is no longer in the room.
   */
  async function admitted(ws: WsConnection): Promise<void> {
    const hostId = visitedHost(ws, cityOf(ws));
    if (hostId ? (!(now() < ws.guestUntil) || !hostPresent(ws.room ?? '', hostId)) : ws.stale === true) await verify([ws]);
    if (!ws.room) throw Error('join_required');
  }
  const guarded = (handle: RoomHandler): { room: true; handle: (ws: WsConnection, message: IncomingFrame) => Promise<void> } => ({
    room: true,
    async handle(ws, message) {
      await admitted(ws);
      const room = ws.room;
      if (!room) throw Error('join_required'); // admitted() has just checked this
      return handle(ws, message, room);
    },
  });

  // Heartbeat: sockets that send nothing are re-checked here — every guest (expiry, host absence) and every marked socket.
  let sweeping = false;
  async function sweep(): Promise<void> {
    if (sweeping) return;
    const due = core.sockets().filter(ws => ws.room && (ws.stale === true || visitedHost(ws, cityOf(ws))));
    if (!due.length) return;
    sweeping = true;
    try { await verify(due); } finally { sweeping = false; }
  }
  ctx.on?.('heartbeat', () => { sweep().catch(() => {}); sendTotals(); });
  /** The venue's total moves by itself as people come and go: it is sent to each group, once per heartbeat, for the venues where it changed. */
  function sendTotals(): void {
    for (const room of [...dirty]) {
      dirty.delete(room);
      const venue = venues.get(room);
      if (!venue) continue;
      for (const group of venue.groups.values()) {
        const fresh = [...(groupSockets.get(gkey(room, group.id)) ?? NONE)].filter(deltaOf), counts = countsOf(room, group.id);
        if (fresh.length && counts) sendAll(fresh, { type: 'presence-delta', counts });
      }
    }
  }
  if (ctx.checks) {
    ctx.checks.groupPeers = (id, room) => { const venue = venues.get(room), group = venue?.groups.get(venue.where.get(id) ?? ''); return group ? [...group.players] : null; };
    ctx.checks.venueCounts = (room) => { const venue = venues.get(room); return venue ? { total: venue.where.size, groups: venue.groups.size } : null; };
  }
  // A visit the social module ended (left, removed, blocked): that guest leaves the host's Home room at once.
  ctx.on?.('visit-ended', ({ hostId, guestId }) => {
    for (const ws of [...(inRooms.get(guestId) ?? [])]) if (ws.room?.endsWith(`:home:${hostId}`)) drop(ws, 'visit_ended');
  });

  /** A player's mutual friends: what was read when they joined, read again when it is older than a minute (or was lost with the host's memory). */
  async function friendsOf(ws: WsConnection): Promise<ReadonlySet<string>> {
    const id = ws.session.id, known = friendsCache.get(id);
    if (known && now() - known.at < FRIENDS_FRESH_MS) return known.set;
    const set = new Set(await store.read(db => presenceAudience(db.social?.players, id)));
    friendsCache.set(id, { at: now(), set });
    return set;
  }

  const messages: Record<string, WsMessageEntry> = {
    async join(ws, message) {
      const cityId = ctx.cityIds.find((item) => item === message.cityId), venueId = message.venueId;
      if (cityId === undefined || typeof venueId !== 'string' || !venueFor(cityId, venueId)) throw Error('invalid_room');
      // hostId is only meaningful for Home, and only as a well-formed public id.
      const rawHostId = message.hostId;
      if (rawHostId !== undefined && (venueId !== 'home' || typeof rawHostId !== 'string' || !UUID_PATTERN.test(rawHostId))) throw Error('invalid_room');
      const hostId = rawHostId === undefined ? null : String(rawHostId).toLowerCase();
      const guestOf = hostId !== null && hostId !== ws.session.id ? hostId : null; // the host whose Home room a guest is joining
      const visiting = guestOf !== null;
      const { until, look, friends, follow, open } = await store.transact(db => {
        const session = core.sessionOf(ws, db);
        if (!session || session.expiresAt <= now()) throw Error('device_session_required');
        // A guest's own life is the one they play (a visit is a room, not a journey): in the host's city too, they need no life of theirs there.
        const ownCity = guestOf !== null ? characterCity(session) ?? cityId : cityId;
        const state = settle(session, ownCity);
        // A life still held for the quick start (Play not confirmed) is not in the city yet: no room, so no presence and no chat.
        if (state.onboarding?.required === true && state.onboarding.done !== true) throw Error('onboarding_required');
        // The look comes from the server-held life and is validated again: option ids only.
        const look = checkLook(state.onboarding?.look).look ?? null;
        // A guest is admitted by the social module's server-side guest list, never by their own location;
        // everyone else only to the venue their life occupies (not while departing).
        // WHO THEY BELONG WITH, for a public venue's group: their mutual friends, and whoever they came to be with (a friend named in
        // `with`, or the friend whose ping they just joined). Read here, with the admission, so the group is chosen from what is stored.
        const friends = new Set(venueId === 'home' ? [] : presenceAudience(db.social?.players, session.publicId));
        let follow: string | null = null;
        if (venueId !== 'home') {
          follow = typeof message.with === 'string' && friends.has(message.with) ? message.with : null;
          if (follow === null) {
            let latest = -Infinity;
            for (const record of Object.values(db.social?.pings ?? {})) {
              if (record.to === session.publicId && record.state === 'joined' && record.cityId === cityId && record.venue === venueId && record.expires > now() && record.at > latest) { latest = record.at; follow = record.from; }
            }
          }
        }
        return { until: guestOf !== null ? guestUntil(db, session.publicId, guestOf, cityId) : canOccupyVenue(state, venueId) ? Infinity : 0, look, friends, follow, open: guestOf !== null && openWhileOut(db, guestOf) };
      // ADMISSION FOLLOWS WHAT IS IN THE FILE. The check can read a permission that is applied in
      // memory but not yet written (a host's "let them in", an arrival). `waitForObserved` holds the
      // join until those changes are in the file and rejects it ('storage_unavailable') if their
      // write failed and they were undone — so there is no presence, chat or signalling on a
      // permission that never became real. The join writes nothing of its own to wait for, and with
      // nothing unwritten beneath it it is answered at once. Whatever took the permission away in
      // the meantime is caught below: by the absent-host check and by verify() after admission.
      }, { durable: false, waitForObserved: true });
      const room = venueRoomKey(cityId, venueId, guestOf ?? ws.session.id);
      // A guest cannot come back into a Home room its host has been missing from for longer than the grace period.
      if (!until || (guestOf !== null && !open && hostAbsent(room, guestOf))) throw Error(visiting ? 'not_a_guest' : 'venue_mismatch');
      if (!core.isOpen(ws)) return;
      leave(ws); ws.voice = { enabled: false, muted: true }; ws.position = initialVenuePosition(venueId); ws.lastMoves = []; ws.look = look;
      ws.deltas = message.deltas === true;
      if (grouped(room)) friendsCache.set(ws.session.id, { at: now(), set: friends });
      const { apart } = enter(ws, room, { friends, follow });
      ws.stale = false; ws.guestUntil = visiting ? Math.min(now() + GUEST_RECHECK_MS, until) : 0;
      if (deltaOf(ws)) snapshot(ws);
      announce(room, ws.group ?? null, { joined: [ws.session.id], causes: [ws.session.id], snapshotted: [ws] });
      roomChanged(room, ws.group ?? null, null, ws.session.id);
      // They could not be placed with the friend they came to be with: say where that friend is, and let them join with one tap.
      if (apart !== null && deltaOf(ws)) {
        const name = nameOf(apart, room) ?? 'Your friend';
        send(ws, { type: 'group', event: 'apart', here: venues.get(room)?.groups.get(ws.group ?? '')?.players.size ?? 1, text: `${name} is in another part of the venue.`, friend: { id: apart, name } });
      }
      // A visit that ended between the check above and this admission found no socket to drop:
      // look once more now that there is one, so the guest list and the room cannot disagree.
      if (visiting) await verify([ws]);
    },
    move: guarded((ws, message, room) => {
      const position = validatePosition(message, room.split(':')[1]);
      ws.lastMoves = ws.lastMoves.filter(time => time > now() - 1000);
      if (ws.lastMoves.length >= 5) throw Error('move_rate_limited');
      ws.lastMoves.push(now());
      for (const peer of rooms.get(room) ?? []) if (peer.session.id === ws.session.id) peer.position = position;
      queueMove(ws, room, position);
    }),
    'voice-state': guarded((ws, message, room) => {
      if (typeof message.enabled !== 'boolean' || typeof message.muted !== 'boolean') throw Error('invalid_voice_state');
      // The voice circle is the group's: its cap counts the people around you, not the whole venue.
      const enabled = new Set([...audience(room, ws.group)].filter(peer => peer.voice.enabled).map(peer => peer.session.id));
      if (message.enabled && !enabled.has(ws.session.id) && enabled.size >= MAX_VOICE_MEMBERS) throw Error('voice_room_full');
      ws.voice = { enabled: message.enabled, muted: message.muted }; announce(room, ws.group ?? null, { voice: [ws.session.id], causes: [ws.session.id] });
    }),
    signal: guarded((ws, message, room) => {
      const data = message.data;
      if (typeof message.to !== 'string' || !data || typeof data !== 'object' || JSON.stringify(data).length > 12000) throw Error('invalid_signal');
      const to = message.to;
      // A blocked pair cannot signal: the answer is the same as for a peer who is not there.
      const peers = hidden(ws.session.id, to) ? [] : [...audience(room, ws.group)].filter(peer => peer.session.id === to && peer !== ws);
      if (!peers.length) throw Error('peer_not_in_room');
      const nearby = peers.filter(peer => withinVoiceDistance(ws.position, peer.position));
      if (!nearby.length) throw Error('peer_out_of_range');
      // The server relays `data` untouched: any object of at most 12 000 characters of JSON. The protocol type SignalData
      // only says what the browser puts in it (the tests relay `{ probe }`), so this is the one place the object is named as it.
      const relayed = data as SignalData;
      for (const peer of nearby) send(peer, { type: 'signal', from: ws.session.id, data: relayed });
    }),
    groups: guarded(async (ws, _message, room) => {
      const venue = venues.get(room), me = ws.session.id;
      if (!venue || !ws.group) { send(ws, { type: 'groups', here: 1, total: 1, groups: [], more: 0 }); return; }
      if (!allow(`groups:${me}`, 30)) throw Error('rate_limited');
      const friends = await friendsOf(ws);
      // Friends are looked up (a few hundred at most), never the venue's people: a stranger is only ever a count.
      const named = new Map<string, PublicSession[]>();
      for (const friend of friends) {
        const home = venue.where.get(friend), name = nameOf(friend, room);
        if (home !== undefined && name !== null && !hidden(me, friend)) named.set(home, [...(named.get(home) ?? []), { id: friend, name }]);
      }
      const all: GroupSummary[] = [...venue.groups.values()].map(group => ({ id: group.id, no: group.no, size: group.players.size, open: group.players.size < limits.max, mine: group.id === ws.group, friends: (named.get(group.id) ?? []).slice(0, 5) }));
      all.sort((a, b) => Number(b.mine) - Number(a.mine) || b.friends.length - a.friends.length || b.size - a.size || a.no - b.no);
      send(ws, { type: 'groups', here: venue.groups.get(ws.group)?.players.size ?? 1, total: venue.where.size, groups: all.slice(0, ROOM_GROUP_LIST), more: Math.max(0, all.length - ROOM_GROUP_LIST) });
    }),
    'group-join': guarded(async (ws, message, room) => {
      const venue = venues.get(room), me = ws.session.id;
      if (!venue || !ws.group) throw Error('group_gone');
      if (!allow(`group-join:${me}`, 20)) throw Error('rate_limited');
      if (inVoice(me, room)) throw Object.assign(Error('in_voice'), { reason: 'Leave voice before you change group.' });
      let target: string | undefined, friendId: string | null = null;
      if (typeof message.friend === 'string') {
        friendId = message.friend;
        if (!(await friendsOf(ws)).has(friendId) || hidden(me, friendId)) throw Object.assign(Error('not_a_friend'), { reason: 'You can only join the group of a friend.' });
        target = venue.where.get(friendId);
      } else if (typeof message.group === 'string') target = message.group;
      else throw Error('group_gone');
      const found = target === undefined ? undefined : venue.groups.get(target);
      if (!found) throw Object.assign(Error('group_gone'), { reason: 'That group is not there any more.' });
      if (found.id === ws.group) { seeking.delete(me); return; }
      // A friend's group takes friends past the usual maximum; any other group is refused when it is full.
      const reach = friendId !== null ? limits.max + ROOM_GROUP_OVERFLOW : limits.max;
      if (found.players.size >= reach) {
        if (friendId === null) throw Object.assign(Error('group_full'), { reason: 'That group is full right now.' });
        seeking.set(me, { room, friend: friendId });
        const name = nameOf(friendId, room) ?? 'your friend';
        send(ws, { type: 'group', event: 'waiting', here: venue.groups.get(ws.group)?.players.size ?? 1, text: `${name}'s group is full. You will be moved when there is room.`, friend: { id: friendId, name } });
        return;
      }
      seeking.delete(me);
      relocate(room, [me], found.id, 'moved');
      // A player who chose where to be is not moved again soon (they count as mid-conversation); their old group may be small now.
      chatAt.set(me, now());
      tidy(room);
    }),
    chat: guarded((ws, message, room) => {
      const body = typeof message.body === 'string' ? message.body.trim() : '';
      const clientId = message.clientId;
      if (!body || body.length > 500 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body) || (clientId !== undefined && (typeof clientId !== 'string' || clientId.length > 80 || !clientId))) throw Error('invalid_chat');
      if (!allow(`chat:${ws.session.id}`, 30)) throw Error('rate_limited');
      const key = `${ws.session.id}:${room}`;
      // A host whose memory does not last (the Worker) keeps these retry receipts itself: core.chatHistory(ws, body).
      const hosted = core.chatHistory?.(ws, body);
      const history: ChatHistory = hosted || chatHistory.get(key) || new Map<string, ChatFrame>();
      if (clientId && history.has(clientId)) { const replay = history.get(clientId); if (isChatFrame(replay)) { send(ws, replay); return; } }
      // Refused, never altered: a muted sender or a blocked text gets a reason and nobody receives the line.
      const refusal = ctx.checks?.muted?.(ws.session.id) ?? screenText(body, { what: 'Your message' });
      if (refusal) throw Object.assign(Error(refusal.code), { reason: refusal.reason });
      const chat: ChatFrame = { type: 'chat', id: core.newId(), ...(typeof clientId === 'string' ? { clientId } : {}), from: { ...ws.session }, body, at: now() };
      if (clientId) {
        history.set(clientId, chat);
        if (history.size > 100) { const oldest = history.keys()[Symbol.iterator]().next(); if (!oldest.done) history.delete(oldest.value); }
        if (!core.chatHistory) {
          chatHistory.set(key, history);
          // One retry history per player and room, and a bound on how many are kept: the oldest goes first.
          if (chatHistory.size > CHAT_HISTORIES) { const first = chatHistory.keys().next(); if (!first.done) chatHistory.delete(first.value); }
        }
      }
      chatAt.set(ws.session.id, now());
      sendAll([...audience(room, ws.group)].filter(peer => !hidden(ws.session.id, peer.session.id)), chat);
    }),
  };

  return {
    open(ws) {
      // Everyone starts outside voice and muted; joining voice is an explicit later message.
      ws.voice = { enabled: false, muted: true };
      ws.position = { x: 0, z: 0 };
      ws.lastMoves = [];
      ws.look = null;
      ws.stale = false;
      ws.guestUntil = 0;
    },
    close: leave,
    /** A host that lost its memory hands a connected socket back: it is in its room again, exactly as it was (ws/index.js). Nothing is announced. */
    restore(ws) {
      ws.voice ||= { enabled: false, muted: true }; ws.position ||= { x: 0, z: 0 }; ws.lastMoves ||= []; ws.look ??= null; ws.guestUntil ||= 0;
      // What the room remembered about the stored life is gone with the memory: the next room message re-checks it.
      if (ws.room) { const room = ws.room; enter(ws, room); ws.stale = true; }
    },
    lifecycle: {
      /**
       * Drop sockets whose room no longer matches where the server says the player is. A socket
       * visiting a host's Home room is checked against the guest list instead of the player's own
       * location. `publicId` is the player's public id; when their own life is not at home, their
       * Home room is emptied of guests.
       */
      async validateMemberships(secret, city, state, publicId) {
        const visiting: WsConnection[] = [];
        // The player's own sockets in rooms are indexed by public id; without one, every socket is looked at.
        for (const ws of typeof publicId === 'string' ? [...(inRooms.get(publicId) ?? [])] : core.sockets()) {
          if (ws.secret !== secret || !ws.room?.startsWith(`${city}:`)) continue;
          if (visitedHost(ws, city)) { visiting.push(ws); continue; }
          if (!occupies(ws, city, state)) drop(ws, 'venue_mismatch'); else ws.stale = false;
        }
        if (typeof publicId === 'string') {
          const home = venueRoomKey(city, 'home', publicId);
          const guests = [...(rooms.get(home) || [])].filter(ws => ws.session.id !== publicId);
          // A host who left home sends their guests out, unless they keep the home open while they are out.
          const open = guests.length > 0 && !canOccupyVenue(state, 'home') && await Promise.resolve(store.read((db) => openWhileOut(db, publicId))).catch(() => false);
          if (!canOccupyVenue(state, 'home') && !open) {
            for (const ws of guests) drop(ws, 'visit_ended');
            if (guests.length) ctx.emit?.('home-closed', { hostId: publicId, cityId: city });
          } else visiting.push(...guests); // the host's own validation also re-checks the guests in their room
        }
        await verify(visiting);
      },
      revalidate,
      /** Is this socket's room one the server would admit it to right now? Used by the voice-config route. */
      roomStillValid(ws, db, session, city, state) {
        const hostId = visitedHost(ws, city);
        if (hostId) return (openWhileOut(db, hostId) || !hostAbsent(ws.room ?? '', hostId)) && guestUntil(db, session.publicId, hostId, city) > 0;
        return occupies(ws, city, state);
      },
      refreshNames(session: PublicSession) {
        const told = new Set<string>();
        for (const ws of inRooms.get(session.id) || []) {
          if (!ws.room || told.has(`${ws.room}#${ws.group ?? ''}`)) continue;
          told.add(`${ws.room}#${ws.group ?? ''}`);
          announce(ws.room, ws.group ?? null, { joined: [session.id], causes: [session.id] });
          roomChanged(ws.room, ws.group ?? null, null, session.id);
        }
      },
    },
    messages,
  };
}
