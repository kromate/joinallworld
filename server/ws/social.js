/**
 * OWNER: social
 * Social socket messages and live presence. Thin adapters over server/social/service.js — the
 * same rules as the HTTP routes in server/routes/social.js.
 *
 * CLIENT → SERVER (each is answered on the sending socket; `clientId` is echoed when given)
 *   dm-send        { to | conv, body, clientId }   → dm-sent { clientId, conv, message, duplicate? }
 *                                                   | dm-failed { clientId, code, reason }
 *   dm-read        { conv, seq? }                  → dm-read-ok { conv }
 *   people-list    { cityId }                      → people { venue, self, players, count }; the socket
 *                                                   is then also told when that changes (people-changed)
 *   friend-request { to, cityId }                  → friend-result { ok, code, reason?, player? }
 *   friend-answer  { from, accept, cityId }        → friend-result { … }
 *   invite-knock   { host, cityId }                → invite-result { op: 'knock', ok, code, reason?, expiresAt? }
 *   invite-answer  { visitor, answer }             → invite-result { op: 'answer', ok, code, reason?, house? }
 * SERVER → CLIENT (pushed to every open socket of the player concerned)
 *   dm                { conv, message }            a message in one of your conversations (also your own, for other tabs)
 *   social-update     { update }                   a line for Messages → Updates
 *   social-sync       {}                           something of yours changed server-side: re-read /api/social/me
 *   friend-request    { from }      friend-accepted { by }
 *   people-presence   { id, status }               a friend connected or dropped ('online' | 'reconnecting')
 *   people-changed    { cityId, venueId }          who shares your venue room changed — re-read people-list.
 *                                                  Sent only to sockets that have asked people-list, and
 *                                                  carries no member data.
 *   people-interaction{ from, action, label, landed }
 *   invite-knock      { from, expiresAt }          invite-answer { host, answer, house }      invite-house { house }
 *   transfer          { from, amount, credited }
 * Clients must ignore types they do not know (the community panel's socket receives these too).
 *
 * Nothing here touches voice, the microphone, ws.room, ws.voice or ws.position.
 */
import { socialService } from '../social/service.js';

export default function socialSocket(ctx) {
  const service = socialService(ctx);
  const { presence } = service;

  /** Run a service call for the socket's stored session, commit, push, and return the result. */
  async function run(ws, call) {
    const result = await ctx.store.transact((db) => {
      const session = ctx.core.sessionOf(ws, db);
      if (!session || session.expiresAt <= ctx.now()) throw Error('device_session_required');
      return service.finish(db, call(db, session));
    }, { committed: (value) => service.committed(value) });
    return service.deliver(result);
  }
  /** Tell a player's friends that they connected or dropped. Best effort; never blocks the socket. */
  function announce(id, status) {
    ctx.store.read((db) => Object.keys(db.social?.players?.[id]?.friends || {}))
      .then((friends) => { for (const friend of friends) ctx.push(friend, { type: 'people-presence', id, status }); })
      .catch(() => {});
  }
  // The foundation announces room changes in-process; pass a nudge to the members' watching sockets.
  ctx.on?.('room-changed', ({ room, cityId, venueId, members, cause }) => {
    for (const id of members) {
      // A player the cause is hidden from (a blocked pair) is not nudged: their list has not changed.
      if (cause && cause !== id && ctx.checks?.blocked?.(cause, id) === true) continue;
      for (const ws of presence.sockets(id)) if (ws.peopleWatch === true && ws.room !== room) ctx.send(ws, { type: 'people-changed', cityId, venueId });
    }
  });
  // The room module admits a guest to a host's Home room only if this says so (see server/ws/rooms.js).
  if (ctx.checks) {
    ctx.checks.homeGuest = (db, guestId, hostId, cityId) => service.homeGuest(db, guestId, hostId, cityId);
    // The same answer with the visit's own expiry (server ms), or 0 for "not a guest": the room module
    // remembers an entitlement only up to that instant, so an expired visit is refused exactly on time.
    ctx.checks.homeGuestUntil = (db, guestId, hostId, cityId) => {
      if (!service.homeGuest(db, guestId, hostId, cityId)) return 0;
      const expires = ctx.collection(db, 'social').houses?.[hostId]?.guests?.[guestId]?.expires;
      return Number.isFinite(expires) ? expires : 0;
    };
  }
  // A host whose life left home has no visitors: when the room module empties their Home room, end the visits too.
  ctx.on?.('home-closed', ({ hostId }) => {
    ctx.store.transact((db) => service.finish(db, service.closeHouse(db, hostId))).then((result) => service.deliver(result)).catch(() => {});
  });
  // The room module dropped a guest on the heartbeat (the visit ran out): close the stored visit and tell both sides.
  ctx.on?.('guest-expired', ({ hostId }) => {
    ctx.store.transact((db) => service.finish(db, service.expireVisits(db, hostId))).then((result) => service.deliver(result)).catch(() => {});
  });
  // The room module sent a guest away because the host has had no connection in their own Home room for
  // longer than the grace period. The stored life still says "at home", so the visit is ended the way a
  // guest leaving ends it: through the service, as that guest. They must knock again — which needs the host back.
  ctx.on?.('host-absent', ({ hostId, guestId }) => {
    ctx.store.transact((db) => {
      const guest = ctx.core.sessionByPublicId?.(db, guestId);
      if (!guest || guest.expiresAt <= ctx.now()) return null;
      return service.finish(db, service.houseLeave(db, guest, { host: hostId }));
    }, { committed: (value) => service.committed(value) }).then((result) => service.deliver(result)).catch(() => {});
  });
  const echo = (message) => (typeof message.clientId === 'string' && message.clientId.length <= 80 ? { clientId: message.clientId } : {});

  return {
    /** A connected socket handed back after the host lost its memory: it counts as online again; nothing is announced. */
    restore(ws) { presence.open(ws); },
    open(ws) {
      const first = presence.status(ws.session.id).state !== 'online';
      presence.open(ws);
      if (first) announce(ws.session.id, 'online');
    },
    close(ws) {
      presence.close(ws);
      if (presence.status(ws.session.id).state !== 'online') announce(ws.session.id, 'reconnecting');
    },
    messages: {
      async 'dm-send'(ws, message) {
        try {
          const result = await run(ws, (db, session) => service.send(db, session, message));
          ctx.send(ws, result.ok ? { type: 'dm-sent', ...echo(message), conv: result.conv, message: result.message, ...(result.duplicate ? { duplicate: true } : {}) }
            : { type: 'dm-failed', ...echo(message), code: result.code, reason: result.reason });
        } catch (error) {
          // Malformed input still gets an answer tied to the client id, so a pending message can fail instead of stalling.
          ctx.send(ws, { type: 'dm-failed', ...echo(message), code: error.message, reason: 'That message could not be sent as written.' });
        }
      },
      async 'dm-read'(ws, message) {
        const result = await run(ws, (db, session) => service.read(db, session, message));
        ctx.send(ws, { type: 'dm-read-ok', ...result });
      },
      async 'people-list'(ws, message) {
        if (!ctx.allow(`social:people:${ws.session.id}`, 60)) throw Error('rate_limited');
        const result = await run(ws, (db, session) => service.people(db, session, message.cityId));
        ws.peopleWatch = true;
        ctx.send(ws, { type: 'people', ...result });
      },
      async 'friend-request'(ws, message) {
        const result = await run(ws, (db, session) => service.friendRequest(db, session, message));
        ctx.send(ws, { type: 'friend-result', ...result });
      },
      async 'friend-answer'(ws, message) {
        const result = await run(ws, (db, session) => service.friendAnswer(db, session, message));
        ctx.send(ws, { type: 'friend-result', ...result });
      },
      async 'invite-knock'(ws, message) {
        const result = await run(ws, (db, session) => service.knock(db, session, message));
        ctx.send(ws, { type: 'invite-result', op: 'knock', ...result });
      },
      async 'invite-answer'(ws, message) {
        const result = await run(ws, (db, session) => service.knockAnswer(db, session, message));
        ctx.send(ws, { type: 'invite-result', op: 'answer', ...result });
      },
    },
  };
}
