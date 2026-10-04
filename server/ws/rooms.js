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
 * check read is final in the store — never on a host's accept that is still being written and may
 * yet be undone — and in commit order with whatever takes the permission away again (see `join`).
 * A join whose basis was undone by a failed write is answered 'room_unavailable' and may be sent again.
 * Membership is re-validated on the same schedule as every venue membership (the guest's own
 * GET /api/life and POST /api/action — and the host's, for the guests in their room); a guest
 * whose visit expired, was ended or whose host left home is dropped with 'visit_ended'. A host who leaves home empties their Home room of
 * guests at their own next validation, and a 'visit-ended' event drops one guest at once.
 * Inside the room a guest is an ordinary member: same chat, same proximity-gated signalling,
 * same voice cap, and — as for everyone — voice off and muted on join. Nothing enables it.
 *
 * ONBOARDING GATE. A life that must finish character creation (state.onboarding.required and not
 * done) cannot join any room, so it never appears in presence or chat.
 * LOOK. On join the server records the joining life's appearance on the socket (ws.look) from the
 * server-held state, re-validated against the appearance option lists (checkLook): eight option
 * ids, nothing a client sent. It is not added to `presence` (which is re-sent on every move); the
 * social module's who-is-here listing carries it so other players' avatars can be drawn.
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
 * CHAT TEXT. A chat line passes the text filter (server/moderation/text.js) and the sender's mute
 * state (ctx.checks.muted). A refused line is answered with an `error` carrying the code
 * ('text_blocked' | 'muted'), a `reason` sentence and the line's clientId; it is delivered to nobody.
 * GUEST EXPIRY ON THE HEARTBEAT. On every host heartbeat (ctx.on('heartbeat')) each socket that is
 * visiting a host's Home room is re-checked against the guest list. A visit that ran out, or whose
 * host is no longer at home, is dropped then — so a guest who never polls leaves at most one
 * heartbeat interval (10 s by default) after the visit ends, not at the host's next request.
 * The module then raises 'guest-expired' { hostId, guestId, cityId } for the social module to
 * close the stored visit.
 */
import { MAX_VOICE_MEMBERS, UUID_PATTERN, canJoinVenue, initialVenuePosition, validatePosition, withinVoiceDistance, venueRoomKey } from '../protocol.js';
import { VENUES } from '../life-service.js';
import { checkLook } from '../../src/game/systems/onboarding.js';
import { screenText } from '../moderation/text.js';

export default function roomSocket(ctx) {
  const { store, now, allow, settle, send, core } = ctx;
  const rooms = new Map();
  const chatHistory = new Map();

  /**
   * Send the room's member list. `cause` is the public id of the player whose join, leave, move or
   * voice change triggered it: a recipient that player is hidden from gets no frame at all, so a
   * blocked player cannot infer from a burst of identical lists that someone they cannot see is there.
   */
  function presence(room, cause = null) {
    const members = new Map();
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
  const hidden = (a, b) => a !== b && ctx.checks?.blocked?.(a, b) === true;
  // A block or unblock changes who each of the two can see: re-send presence where either is.
  ctx.on?.('blocks-changed', ({ a, b }) => {
    const touched = new Set();
    for (const ws of core.sockets()) if (ws.room && (ws.session?.id === a || ws.session?.id === b)) touched.add(ws.room);
    for (const room of touched) presence(room);
  });
  /** Announce (inside the server only) that who is in `room` changed. `also` is someone who just left. */
  function roomChanged(room, also, cause = also ?? null) {
    const members = new Set([...(rooms.get(room) || [])].map(ws => ws.session.id));
    if (also) members.add(also);
    const [cityId, venueId] = room.split(':');
    // `cause` is who joined, left or was renamed: listeners must not nudge anyone that player is hidden from.
    ctx.emit?.('room-changed', { room, cityId, venueId, members: [...members], cause });
  }
  function leave(ws) {
    if (!ws.room) return;
    const room = ws.room;
    rooms.get(room)?.delete(ws);
    if (!rooms.get(room)?.size) rooms.delete(room);
    ws.room = null;
    presence(room, ws.session.id);
    roomChanged(room, ws.session.id);
  }
  function drop(ws, code) {
    leave(ws); ws.voice = { enabled: false, muted: true };
    send(ws, { type: 'error', code, error: code });
  }
  /** The host id of the Home room a socket is visiting as a guest, or null (also null in its own Home room). */
  const visitedHost = (ws, city) => {
    const [roomCity, venue, owner] = (ws.room || '').split(':');
    return roomCity === city && venue === 'home' && owner && owner !== ws.session.id ? owner : null;
  };
  const isGuest = (db, guestId, hostId, city) => ctx.checks?.homeGuest?.(db, guestId, hostId, city) === true;
  /**
   * Drop sockets whose room no longer matches where the server says the player is. A socket
   * visiting a host's Home room is checked against the guest list instead of the player's own
   * location. `publicId` is the player's public id; when their own life is not at home, their
   * Home room is emptied of guests.
   */
  core.validateMemberships = async (secret, city, state, publicId) => {
    const visiting = [];
    for (const ws of core.sockets()) {
      if (ws.secret !== secret || !ws.room?.startsWith(`${city}:`)) continue;
      if (visitedHost(ws, city)) { visiting.push(ws); continue; }
      if (ws.room !== venueRoomKey(city, state.location, ws.session.id) || !canJoinVenue(state, state.location)) drop(ws, 'venue_mismatch');
    }
    if (typeof publicId === 'string') {
      const home = venueRoomKey(city, 'home', publicId);
      const guests = [...(rooms.get(home) || [])].filter(ws => ws.session.id !== publicId);
      if (!canJoinVenue(state, 'home')) {
        for (const ws of guests) drop(ws, 'visit_ended');
        if (guests.length) ctx.emit?.('home-closed', { hostId: publicId, cityId: city });
      } else visiting.push(...guests); // the host's own validation also re-checks the guests in their room
    }
    if (!visiting.length) return;
    const allowed = await store.read(db => visiting.map(ws => isGuest(db, ws.session.id, visitedHost(ws, city), city)));
    visiting.forEach((ws, index) => { if (!allowed[index] && visitedHost(ws, city)) drop(ws, 'visit_ended'); });
  };
  /** Is this socket's room one the server would admit it to right now? Used by the voice-config route. */
  core.roomStillValid = (ws, db, session, city, state) => {
    const hostId = visitedHost(ws, city);
    if (hostId) return isGuest(db, session.publicId, hostId, city);
    return canJoinVenue(state, state.location) && ws.room === venueRoomKey(city, state.location, session.publicId);
  };
  core.validateRestoredMembership = (ws, db, session) => {
    if (!ws.room) return;
    const city = ws.room.split(':')[0];
    const state = session?.cities?.[city]?.state;
    if (!state || !core.roomStillValid(ws, db, session, city, state)) drop(ws, visitedHost(ws, city) ? 'visit_ended' : 'venue_mismatch');
  };
  // Heartbeat: end expired visits on time. Guests are looked up from the sockets actually in a Home room.
  let sweeping = false;
  async function sweepGuests() {
    if (sweeping) return;
    const visiting = core.sockets().map(ws => ({ ws, room: ws.room, city: (ws.room || '').split(':')[0] })).filter(item => visitedHost(item.ws, item.city));
    if (!visiting.length) return;
    sweeping = true;
    try {
      const allowed = await store.read(db => visiting.map(({ ws, city }) => isGuest(db, ws.session.id, visitedHost(ws, city), city)));
      visiting.forEach(({ ws, room, city }, index) => {
        if (allowed[index] || ws.room !== room) return;
        const hostId = visitedHost(ws, city);
        drop(ws, 'visit_ended');
        ctx.emit?.('guest-expired', { hostId, guestId: ws.session.id, cityId: city });
      });
    } finally { sweeping = false; }
  }
  ctx.on?.('heartbeat', () => { sweepGuests().catch(() => {}); });
  // A visit the social module ended (left, removed, blocked): that guest leaves the host's Home room at once.
  ctx.on?.('visit-ended', ({ hostId, guestId }) => {
    for (const ws of core.sockets()) if (ws.session?.id === guestId && ws.room?.endsWith(`:home:${hostId}`)) drop(ws, 'visit_ended');
  });
  core.refreshNames = (session) => {
    const changed = new Set();
    for (const ws of core.sockets()) if (ws.session.id === session.id) { ws.session.name = session.name; ws.expiresAt = now() + ctx.config.sessionTtlMs; ws.lastSessionRenewedAt = now(); if (ws.room) changed.add(ws.room); }
    for (const room of changed) { presence(room, session.id); roomChanged(room, null, session.id); }
  };

  return {
    restore(ws) {
      if (ws.room) { if (!rooms.has(ws.room)) rooms.set(ws.room, new Set()); rooms.get(ws.room).add(ws); }
    },
    open(ws) {
      // Everyone starts outside voice and muted; joining voice is an explicit later message.
      ws.voice = { enabled: false, muted: true };
      ws.position = { x: 0, z: 0 };
      ws.lastMoves = [];
      ws.look = null;
    },
    close: leave,
    messages: {
      async join(ws, message) {
        if (!ctx.cityIds.includes(message.cityId) || typeof message.venueId !== 'string' || !Object.hasOwn(VENUES, message.venueId)) throw Error('invalid_room');
        // hostId is only meaningful for Home, and only as a well-formed public id.
        if (message.hostId !== undefined && (message.venueId !== 'home' || typeof message.hostId !== 'string' || !UUID_PATTERN.test(message.hostId))) throw Error('invalid_room');
        const hostId = message.hostId === undefined ? null : message.hostId.toLowerCase();
        const visiting = hostId !== null && hostId !== ws.session.id;
        // ADMISSION FOLLOWS WHAT IS FINAL. The check below can read a permission that is committed in
        // memory but not yet on disk (a host's "let them in", an arrival). The socket is therefore put
        // in the room by the store's commit listener, which runs only once everything the check read is
        // final, and in commit order: a later transaction that takes the permission away (the host
        // removes the guest, leaves home, travels) has its own listener run AFTER this one and drops
        // the socket again. If the write underneath fails the listener never runs, so there is no
        // presence, chat or signalling on a permission that was undone. With nothing waiting to be
        // written — the usual case — the socket is admitted at once, as before.
        let entered = false;
        const admit = ({ allowed, look }) => {
          if (entered || !allowed) return;
          entered = true;
          if (!core.isOpen(ws)) return;
          const room = venueRoomKey(message.cityId, message.venueId, visiting ? hostId : ws.session.id);
          leave(ws); ws.voice = { enabled: false, muted: true }; ws.position = initialVenuePosition(room.split(':')[1]); ws.lastMoves = []; ws.room = room; ws.look = look;
          if (!rooms.has(room)) rooms.set(room, new Set());
          rooms.get(room).add(ws); presence(room, ws.session.id); roomChanged(room, null, ws.session.id);
        };
        let checked = false, result;
        try {
          result = await store.transact(db => {
            const session = core.sessionOf(ws, db);
            if (!session || session.expiresAt <= now()) throw Error('device_session_required');
            const state = settle(session, message.cityId);
            // A life that must still be created is not in the city yet: no room, so no presence and no chat.
            if (state.onboarding?.required === true && state.onboarding.done !== true) throw Error('onboarding_required');
            // The look comes from the server-held life and is validated again: option ids only.
            const look = checkLook(state.onboarding?.look).look ?? null;
            checked = true;
            // A guest is admitted by the social module's server-side guest list, never by their own location.
            return { allowed: visiting ? isGuest(db, session.publicId, hostId, message.cityId) : canJoinVenue(state, message.venueId), look };
          }, { durable: false, waitForDurable: true, committed: admit }); // a join acknowledges nothing of its own; it waits only for what it read
        } catch (error) {
          // Refusals raised by the check itself keep their code. Anything else is the store: what the
          // check read was undone by a failed write, so the socket was not admitted and may ask again.
          if (!checked) throw error;
          throw Error('room_unavailable');
        }
        if (!result.allowed) throw Error(visiting ? 'not_a_guest' : 'venue_mismatch');
        admit(result); // a store that takes no commit listener: admit now
      },
      move: { room: true, handle(ws, message) {
        const position = validatePosition(message, ws.room?.split(':')[1]);
        ws.lastMoves = ws.lastMoves.filter(time => time > now() - 1000);
        if (ws.lastMoves.length >= 5) throw Error('move_rate_limited');
        ws.lastMoves.push(now());
        for (const peer of rooms.get(ws.room)) if (peer.session.id === ws.session.id) peer.position = position;
        presence(ws.room, ws.session.id);
      } },
      'voice-state': { room: true, handle(ws, message) {
        if (typeof message.enabled !== 'boolean' || typeof message.muted !== 'boolean') throw Error('invalid_voice_state');
        const enabled = new Set([...rooms.get(ws.room)].filter(peer => peer.voice.enabled).map(peer => peer.session.id));
        if (message.enabled && !enabled.has(ws.session.id) && enabled.size >= MAX_VOICE_MEMBERS) throw Error('voice_room_full');
        ws.voice = { enabled: message.enabled, muted: message.muted }; presence(ws.room, ws.session.id);
      } },
      signal: { room: true, handle(ws, message) {
        if (typeof message.to !== 'string' || !message.data || typeof message.data !== 'object' || JSON.stringify(message.data).length > 12000) throw Error('invalid_signal');
        // A blocked pair cannot signal: the answer is the same as for a peer who is not there.
        const peers = hidden(ws.session.id, message.to) ? [] : [...rooms.get(ws.room)].filter(peer => peer.session.id === message.to && peer !== ws);
        if (!peers.length) throw Error('peer_not_in_room');
        const nearby = peers.filter(peer => withinVoiceDistance(ws.position, peer.position));
        if (!nearby.length) throw Error('peer_out_of_range');
        for (const peer of nearby) send(peer, { type: 'signal', from: ws.session.id, data: message.data });
      } },
      chat: { room: true, handle(ws, message) {
        const body = typeof message.body === 'string' ? message.body.trim() : '';
        const clientId = message.clientId;
        if (!body || body.length > 500 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body) || (clientId !== undefined && (typeof clientId !== 'string' || clientId.length > 80 || !clientId))) throw Error('invalid_chat');
        if (!allow(`chat:${ws.session.id}`, 30)) throw Error('rate_limited');
        const key = `${ws.session.id}:${ws.room}`;
        const history = core.chatHistory?.(ws, body) || chatHistory.get(key) || new Map();
        if (clientId && history.has(clientId)) { send(ws, history.get(clientId)); return; }
        // Refused, never altered: a muted sender or a blocked text gets a reason and nobody receives the line.
        const refusal = ctx.checks?.muted?.(ws.session.id) ?? screenText(body, { what: 'Your message' });
        if (refusal) throw Object.assign(Error(refusal.code), { reason: refusal.reason });
        const chat = { type: 'chat', id: core.newId(), clientId, from: { ...ws.session }, body, at: now() };
        if (clientId) { history.set(clientId, chat); if (history.size > 100) history.delete(history.keys().next().value); if (!core.chatHistory) chatHistory.set(key, history); }
        for (const peer of rooms.get(ws.room)) if (!hidden(ws.session.id, peer.session.id)) send(peer, chat);
      } },
    },
  };
}
