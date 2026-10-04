/**
 * OWNER: foundation
 * Venue rooms: presence, movement, text chat, voice state and proximity-gated signalling.
 * Behaviour is unchanged from the pre-registry server. Public venues share one room per
 * city; Home rooms are keyed per identity, so a home is never shared between devices.
 */
import { MAX_VOICE_MEMBERS, canJoinVenue, validatePosition, withinVoiceDistance, venueRoomKey } from '../protocol.js';
import { VENUES } from '../life-service.js';

export default function roomSocket(ctx) {
  const { store, now, allow, settle, send, core } = ctx;
  const rooms = new Map();
  const chatHistory = new Map();

  function presence(room) {
    const members = new Map();
    for (const ws of rooms.get(room) || []) {
      const old = members.get(ws.session.id);
      members.set(ws.session.id, { ...ws.session, position: { ...ws.position }, enabled: (old?.enabled || ws.voice.enabled), muted: old ? old.muted && ws.voice.muted : ws.voice.muted });
    }
    for (const ws of rooms.get(room) || []) send(ws, { type: 'presence', members: [...members.values()] });
  }
  function leave(ws) {
    if (!ws.room) return;
    const room = ws.room;
    rooms.get(room)?.delete(ws);
    if (!rooms.get(room)?.size) rooms.delete(room);
    ws.room = null;
    presence(room);
  }
  /** Drop sockets whose room no longer matches where the server says the player is. */
  core.validateMemberships = (secret, city, state) => {
    for (const ws of core.sockets()) if (ws.secret === secret && ws.room?.startsWith(`${city}:`)
      && (ws.room !== venueRoomKey(city, state.location, ws.session.id) || state.activeAction?.kind === 'travel')) {
      leave(ws); ws.voice = { enabled: false, muted: true };
      send(ws, { type: 'error', code: 'venue_mismatch', error: 'venue_mismatch' });
    }
  };
  core.refreshNames = (session) => {
    const changed = new Set();
    for (const ws of core.sockets()) if (ws.session.id === session.id) { ws.session.name = session.name; ws.expiresAt = now() + ctx.config.sessionTtlMs; ws.lastSessionRenewedAt = now(); if (ws.room) changed.add(ws.room); }
    for (const room of changed) presence(room);
  };

  return {
    open(ws) {
      // Everyone starts outside voice and muted; joining voice is an explicit later message.
      ws.voice = { enabled: false, muted: true };
      ws.position = { x: 0, z: 0 };
      ws.lastMoves = [];
    },
    close: leave,
    messages: {
      async join(ws, message) {
        if (!ctx.cityIds.includes(message.cityId) || typeof message.venueId !== 'string' || !Object.hasOwn(VENUES, message.venueId)) throw Error('invalid_room');
        const allowed = await store.transact(db => {
          const session = core.sessionOf(ws, db);
          if (!session || session.expiresAt <= now()) throw Error('device_session_required');
          const state = settle(session, message.cityId);
          return canJoinVenue(state, message.venueId);
        });
        if (!allowed) throw Error('venue_mismatch');
        if (!core.isOpen(ws)) return;
        const room = venueRoomKey(message.cityId, message.venueId, ws.session.id);
        leave(ws); ws.voice = { enabled: false, muted: true }; ws.position = { x: 0, z: 0 }; ws.lastMoves = []; ws.room = room;
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(ws); presence(room);
      },
      move: { room: true, handle(ws, message) {
        const position = validatePosition(message);
        ws.lastMoves = ws.lastMoves.filter(time => time > now() - 1000);
        if (ws.lastMoves.length >= 5) throw Error('move_rate_limited');
        ws.lastMoves.push(now());
        for (const peer of rooms.get(ws.room)) if (peer.session.id === ws.session.id) peer.position = position;
        presence(ws.room);
      } },
      'voice-state': { room: true, handle(ws, message) {
        if (typeof message.enabled !== 'boolean' || typeof message.muted !== 'boolean') throw Error('invalid_voice_state');
        const enabled = new Set([...rooms.get(ws.room)].filter(peer => peer.voice.enabled).map(peer => peer.session.id));
        if (message.enabled && !enabled.has(ws.session.id) && enabled.size >= MAX_VOICE_MEMBERS) throw Error('voice_room_full');
        ws.voice = { enabled: message.enabled, muted: message.muted }; presence(ws.room);
      } },
      signal: { room: true, handle(ws, message) {
        if (typeof message.to !== 'string' || !message.data || typeof message.data !== 'object' || JSON.stringify(message.data).length > 12000) throw Error('invalid_signal');
        const peers = [...rooms.get(ws.room)].filter(peer => peer.session.id === message.to && peer !== ws);
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
        const history = chatHistory.get(key) || new Map();
        if (clientId && history.has(clientId)) { send(ws, history.get(clientId)); return; }
        const chat = { type: 'chat', id: core.newId(), clientId, from: { ...ws.session }, body, at: now() };
        if (clientId) { history.set(clientId, chat); if (history.size > 100) history.delete(history.keys().next().value); chatHistory.set(key, history); }
        for (const peer of rooms.get(ws.room)) send(peer, chat);
      } },
    },
  };
}
