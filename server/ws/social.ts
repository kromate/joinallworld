/**
 * OWNER: social
 * Social socket messages and live presence. Thin adapters over server/social/service.ts — the
 * same rules as the HTTP routes in server/routes/social.ts.
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
 *   people-presence   { id, status }               a friend connected or dropped ('online' | 'reconnecting'); not sent
 *                                                  across an automatic friendship with the founder (server/social/founder.ts)
 *   people-changed    { cityId, venueId }          who shares your venue room changed — re-read people-list.
 *                                                  Sent only to sockets that have asked people-list, and
 *                                                  carries no member data.
 *   people-interaction{ from, action, label, landed }
 *   invite-knock      { from, expiresAt }          invite-answer { host, answer, house }      invite-house { house }
 *   transfer          { from, amount, credited }
 *   social-read       { conv? , updates? }         you read a conversation, or your updates, on one of your devices
 *   social-changed    {}                           your own request changed your friends, groups, blocks or visits: re-read /api/social/me
 * Clients must ignore types they do not know (the community panel's socket receives these too).
 *
 * Nothing here touches voice, the microphone, ws.room, ws.voice or ws.position.
 */
import { socialService } from '../social/service.ts';
import { presenceAudience } from '../social/founder.ts';
import type { Db, IncomingFrame, RouteContext, SessionRecord, WsConnection, WsHandlers } from '../types.ts';

/** The longest pause between two reads of the store that tell friends who connected or dropped (announce below). */
export const ANNOUNCE_PAUSE_MS = 200;

export default function socialSocket(ctx: RouteContext): WsHandlers {
  const service = socialService(ctx);
  const { presence } = service;

  /** Run a service call for the socket's stored session, commit, push, and return the result. */
  async function run<Result>(ws: WsConnection, call: (db: Db, session: SessionRecord) => Result) {
    const result = await ctx.store.transact((db) => {
      const session = ctx.core.sessionOf(ws, db);
      if (!session || session.expiresAt <= ctx.now()) throw Error('device_session_required');
      return service.finish(db, call(db, session));
    }, { committed: (value) => service.committed(value) });
    return service.deliver(result);
  }
  /** A change the sender made to their own friends or visits: their other open sockets read the overview again (as the HTTP routes do). */
  const changed = (ws: WsConnection, result: { ok: boolean }): void => { if (result.ok) ctx.push(ws.session.id, { type: 'social-changed' }); };
  /**
   * Tell a player's friends that they connected or dropped. Best effort; never blocks the socket.
   * Finding a player's friends reads the social collection, so ONE read serves everyone who connected or dropped while
   * the read before it was on its way: a read per socket was time in proportion to everyone who ever played, for every
   * page that opened or closed, and a wave of reconnecting pages could keep the host from doing anything else. On a
   * quiet host the read starts at once, as it always did. When reads take long, the next one waits a little (at most
   * ANNOUNCE_PAUSE_MS), so announcing stays a small share of the host's time. A player who came and went meanwhile is
   * announced once, as they are now.
   */
  const announcing = new Map<string, 'online' | 'reconnecting'>();
  let announcingNow = false;
  async function announcePending(): Promise<void> {
    announcingNow = true;
    try {
      while (announcing.size) {
        const batch = [...announcing], began = ctx.now();
        announcing.clear();
        const audiences = await ctx.store.read((db) => batch.map(([id]) => presenceAudience(db.social?.players, id))).catch(() => null);
        batch.forEach(([id, status], index) => { for (const friend of audiences?.[index] ?? []) ctx.push(friend, { type: 'people-presence', id, status }); });
        const took = ctx.now() - began;
        if (announcing.size && took > 0) await new Promise<void>((done) => { setTimeout(done, Math.min(ANNOUNCE_PAUSE_MS, took * 4)); });
      }
    } finally { announcingNow = false; }
  }
  function announce(id: string, status: 'online' | 'reconnecting'): void {
    announcing.set(id, status);
    if (!announcingNow) ctx.waitUntil?.(announcePending().catch(() => {}));
  }
  // The foundation announces room changes in-process; pass a nudge to the members' watching sockets.
  ctx.on?.('room-changed', ({ room, cityId, venueId, members, cause }) => {
    for (const id of members) {
      // A player the cause is hidden from (a blocked pair) is not nudged: their list has not changed.
      if (cause && cause !== id && ctx.checks?.blocked?.(cause, id) === true) continue;
      for (const ws of presence.sockets(id)) if (ws.peopleWatch === true && ws.room !== room) ctx.send(ws, { type: 'people-changed', cityId, venueId });
    }
  });
  // The room module admits a guest to a host's Home room only if this says so (see server/ws/rooms.ts).
  if (ctx.checks) {
    ctx.checks.homeGuest = (db, guestId, hostId, cityId) => service.homeGuest(db, guestId, hostId, cityId);
    // The same answer with the visit's own expiry (server ms), or 0 for "not a guest": the room module
    // remembers an entitlement only up to that instant, so an expired visit is refused exactly on time.
    ctx.checks.homeGuestUntil = (db, guestId, hostId, cityId) => {
      if (!service.homeGuest(db, guestId, hostId, cityId)) return 0;
      const expires = ctx.collection(db, 'social').houses?.[hostId]?.guests?.[guestId]?.expires;
      return typeof expires === 'number' && Number.isFinite(expires) ? expires : 0;
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
  const echo = (message: IncomingFrame): { clientId?: string } => (typeof message.clientId === 'string' && message.clientId.length <= 80 ? { clientId: message.clientId } : {});

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
          ctx.send(ws, result.ok ? { type: 'dm-sent', ...echo(message), conv: result.conv, message: result.message, ...('duplicate' in result && result.duplicate ? { duplicate: true as const } : {}) }
            : { type: 'dm-failed', ...echo(message), code: result.code, reason: result.reason });
        } catch (error) {
          // Malformed input still gets an answer tied to the client id, so a pending message can fail instead of stalling.
          ctx.send(ws, { type: 'dm-failed', ...echo(message), code: error instanceof Error ? error.message : String(error), reason: 'That message could not be sent as written.' });
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
        changed(ws, result);
        ctx.send(ws, { type: 'friend-result', ...result });
      },
      async 'friend-answer'(ws, message) {
        const result = await run(ws, (db, session) => service.friendAnswer(db, session, message));
        changed(ws, result);
        ctx.send(ws, { type: 'friend-result', ...result });
      },
      async 'invite-knock'(ws, message) {
        const result = await run(ws, (db, session) => service.knock(db, session, message));
        changed(ws, result);
        ctx.send(ws, { type: 'invite-result', op: 'knock', ...result });
      },
      async 'invite-answer'(ws, message) {
        const result = await run(ws, (db, session) => service.knockAnswer(db, session, message));
        changed(ws, result);
        ctx.send(ws, { type: 'invite-result', op: 'answer', ...result });
      },
    },
  };
}
