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
import { watchLives } from '../life-service.ts';
import { checkLook } from '../../src/game/systems/onboarding.ts';
import { screenText } from '../moderation/text.ts';
import type { CityId, ChatFrame, PresenceMember, PublicSession, SignalData } from '../../src/types/protocol.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { Db, IncomingFrame, RouteContext, ServerEvents, SessionRecord, WsConnection, WsHandlers, WsMessageEntry } from '../types.ts';

/** The longest a guest's entitlement is remembered between checks (and never past the visit's expiry). */
export const GUEST_RECHECK_MS = 3000;
/** How long a host may have no socket in their own Home room before their guests are sent away (a page reload fits). */
export const HOST_ABSENCE_GRACE_MS = 20000;

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
  | { hostId: string; city: string; live: boolean; until: number; hostOut: boolean }
/** An event that ends a visit, raised once the verdicts are in. */
type Ended =
  | { event: 'host-absent' | 'guest-expired'; detail: { hostId: string; guestId: string; cityId: string } }
  | { event: 'home-closed'; detail: { hostId: string; cityId: string } }
type RoomHandler = (ws: WsConnection, message: IncomingFrame, room: string) => void | Promise<void>

/** A frame the Worker stored as a retry receipt is the chat line it sent. */
const isChatFrame = (value: unknown): value is ChatFrame => typeof value === 'object' && value !== null && 'type' in value && value.type === 'chat' && 'body' in value && typeof value.body === 'string';

export default function roomSocket(ctx: RouteContext): WsHandlers {
  const { store, now, allow, settle, send, core } = ctx;
  const rooms = new Map<string, Set<WsConnection>>();
  const chatHistory = new Map<string, ChatHistory>();
  const inRooms = new Map<string, Set<WsConnection>>(); // public id → Set<ws> of that player's sockets that are in a room
  const hostGone = new Map<string, number>(); // Home room key → server ms since which its host has had no socket in it

  /**
   * Send the room's member list. `cause` is the public id of the player whose join, leave, move or
   * voice change triggered it: a recipient that player is hidden from gets no frame at all, so a
   * blocked player cannot infer from a burst of identical lists that someone they cannot see is there.
   */
  function presence(room: string, cause: string | null = null): void {
    const members = new Map<string, PresenceMember>();
    for (const ws of rooms.get(room) || []) {
      const old = members.get(ws.session.id);
      members.set(ws.session.id, { ...ws.session, position: { ...ws.position }, enabled: (old?.enabled || ws.voice.enabled), muted: old ? old.muted && ws.voice.muted : ws.voice.muted });
    }
    const everyone = [...members.values()];
    // Only filter when somebody has blocked somebody: the common case sends one shared list.
    const hide = ctx.checks?.anyBlocks?.() === true ? ctx.checks.blocked : null;
    for (const ws of rooms.get(room) || []) {
      if (hide && cause && cause !== ws.session.id && hide(ws.session.id, cause)) continue;
      send(ws, { type: 'presence', members: hide ? everyone.filter(member => member.id === ws.session.id || !hide(ws.session.id, member.id)) : everyone });
    }
  }
  const hidden = (a: string, b: string) => a !== b && ctx.checks?.blocked?.(a, b) === true;
  // A block or unblock changes who each of the two can see: re-send presence where either is.
  ctx.on?.('blocks-changed', ({ a, b }) => {
    const touched = new Set<string>();
    for (const ws of core.sockets()) if (ws.room && (ws.session?.id === a || ws.session?.id === b)) touched.add(ws.room);
    for (const room of touched) presence(room);
  });
  /** Announce (inside the server only) that who is in `room` changed. `also` is someone who just left. */
  function roomChanged(room: string, also: string | null, cause: string | null = also ?? null): void {
    const members = new Set([...(rooms.get(room) || [])].map(ws => ws.session.id));
    if (also) members.add(also);
    const [cityId = '', venueId = ''] = room.split(':');
    // `cause` is who joined, left or was renamed: listeners must not nudge anyone that player is hidden from.
    ctx.emit?.('room-changed', { room, cityId, venueId, members: [...members], cause });
  }
  const homeOwner = (room: string): string | null => { const [, venue, owner] = room.split(':'); return venue === 'home' ? owner ?? null : null; };
  const hostPresent = (room: string, hostId: string) => [...(rooms.get(room) || [])].some(peer => peer.session.id === hostId);
  function enter(ws: WsConnection, room: string): void {
    ws.room = room;
    const members = rooms.get(room) ?? new Set<WsConnection>();
    rooms.set(room, members);
    members.add(ws);
    const mine = inRooms.get(ws.session.id) ?? new Set<WsConnection>();
    inRooms.set(ws.session.id, mine);
    mine.add(ws);
    if (homeOwner(room) === ws.session.id) hostGone.delete(room); // the host is (back) in their own Home room
  }
  function leave(ws: WsConnection): void {
    if (!ws.room) return;
    const room = ws.room;
    rooms.get(room)?.delete(ws);
    if (!rooms.get(room)?.size) rooms.delete(room);
    const mine = inRooms.get(ws.session.id);
    if (mine) { mine.delete(ws); if (!mine.size) inRooms.delete(ws.session.id); }
    ws.room = null; ws.stale = false; ws.guestUntil = 0;
    // The host's last socket left their own Home room while guests are inside: the absence clock starts.
    if (homeOwner(room) === ws.session.id && rooms.has(room) && !hostPresent(room, ws.session.id) && !hostGone.has(room)) hostGone.set(room, now());
    presence(room, ws.session.id);
    roomChanged(room, ws.session.id);
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
      return { hostId, city, live, until, hostOut: !until && typeof ctx.atHome === 'function' && ctx.atHome(db, hostId, city) === false };
    })); } catch { failClosed(); return Promise.resolve(); }
    return Promise.resolve(reading).then((verdicts) => {
      const ended: Ended[] = [];
      items.forEach(({ ws, room }, index) => {
        const verdict = verdicts[index];
        if (!verdict || ws.room !== room) return;
        if (!('hostId' in verdict)) { if (verdict.stay) ws.stale = false; else drop(ws, 'venue_mismatch'); return; }
        const { hostId, city } = verdict, guestId = ws.session.id;
        if (verdict.live && hostAbsent(room, hostId)) { drop(ws, 'visit_ended'); ended.push({ event: 'host-absent', detail: { hostId, guestId, cityId: city } }); return; }
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
    for (const [room, members] of rooms) if (homeOwner(room) === publicId) for (const ws of members) if (ws.session.id !== publicId) list.push(ws);
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
  ctx.on?.('heartbeat', () => { sweep().catch(() => {}); });
  // A visit the social module ended (left, removed, blocked): that guest leaves the host's Home room at once.
  ctx.on?.('visit-ended', ({ hostId, guestId }) => {
    for (const ws of core.sockets()) if (ws.session?.id === guestId && ws.room?.endsWith(`:home:${hostId}`)) drop(ws, 'visit_ended');
  });

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
      const { until, look } = await store.transact(db => {
        const session = core.sessionOf(ws, db);
        if (!session || session.expiresAt <= now()) throw Error('device_session_required');
        const state = settle(session, cityId);
        // A life still held for the quick start (Play not confirmed) is not in the city yet: no room, so no presence and no chat.
        if (state.onboarding?.required === true && state.onboarding.done !== true) throw Error('onboarding_required');
        // The look comes from the server-held life and is validated again: option ids only.
        const look = checkLook(state.onboarding?.look).look ?? null;
        // A guest is admitted by the social module's server-side guest list, never by their own location;
        // everyone else only to the venue their life occupies (not while departing).
        return { until: guestOf !== null ? guestUntil(db, session.publicId, guestOf, cityId) : canOccupyVenue(state, venueId) ? Infinity : 0, look };
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
      if (!until || (guestOf !== null && hostAbsent(room, guestOf))) throw Error(visiting ? 'not_a_guest' : 'venue_mismatch');
      if (!core.isOpen(ws)) return;
      leave(ws); ws.voice = { enabled: false, muted: true }; ws.position = initialVenuePosition(venueId); ws.lastMoves = []; ws.look = look;
      enter(ws, room);
      ws.stale = false; ws.guestUntil = visiting ? Math.min(now() + GUEST_RECHECK_MS, until) : 0;
      presence(room, ws.session.id); roomChanged(room, null, ws.session.id);
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
      presence(room, ws.session.id);
    }),
    'voice-state': guarded((ws, message, room) => {
      if (typeof message.enabled !== 'boolean' || typeof message.muted !== 'boolean') throw Error('invalid_voice_state');
      const enabled = new Set([...(rooms.get(room) ?? [])].filter(peer => peer.voice.enabled).map(peer => peer.session.id));
      if (message.enabled && !enabled.has(ws.session.id) && enabled.size >= MAX_VOICE_MEMBERS) throw Error('voice_room_full');
      ws.voice = { enabled: message.enabled, muted: message.muted }; presence(room, ws.session.id);
    }),
    signal: guarded((ws, message, room) => {
      const data = message.data;
      if (typeof message.to !== 'string' || !data || typeof data !== 'object' || JSON.stringify(data).length > 12000) throw Error('invalid_signal');
      const to = message.to;
      // A blocked pair cannot signal: the answer is the same as for a peer who is not there.
      const peers = hidden(ws.session.id, to) ? [] : [...(rooms.get(room) ?? [])].filter(peer => peer.session.id === to && peer !== ws);
      if (!peers.length) throw Error('peer_not_in_room');
      const nearby = peers.filter(peer => withinVoiceDistance(ws.position, peer.position));
      if (!nearby.length) throw Error('peer_out_of_range');
      // The server relays `data` untouched: any object of at most 12 000 characters of JSON. The protocol type SignalData
      // only says what the browser puts in it (the tests relay `{ probe }`), so this is the one place the object is named as it.
      const relayed = data as SignalData;
      for (const peer of nearby) send(peer, { type: 'signal', from: ws.session.id, data: relayed });
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
        if (!core.chatHistory) chatHistory.set(key, history);
      }
      for (const peer of rooms.get(room) ?? []) if (!hidden(ws.session.id, peer.session.id)) send(peer, chat);
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
        for (const ws of core.sockets()) {
          if (ws.secret !== secret || !ws.room?.startsWith(`${city}:`)) continue;
          if (visitedHost(ws, city)) { visiting.push(ws); continue; }
          if (!occupies(ws, city, state)) drop(ws, 'venue_mismatch'); else ws.stale = false;
        }
        if (typeof publicId === 'string') {
          const home = venueRoomKey(city, 'home', publicId);
          const guests = [...(rooms.get(home) || [])].filter(ws => ws.session.id !== publicId);
          if (!canOccupyVenue(state, 'home')) {
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
        if (hostId) return !hostAbsent(ws.room ?? '', hostId) && guestUntil(db, session.publicId, hostId, city) > 0;
        return occupies(ws, city, state);
      },
      refreshNames(session: PublicSession) {
        const changed = new Set<string>();
        for (const ws of inRooms.get(session.id) || []) if (ws.room) changed.add(ws.room);
        for (const room of changed) { presence(room, session.id); roomChanged(room, null, session.id); }
      },
    },
    messages,
  };
}
