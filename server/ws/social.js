/**
 * OWNER: social
 * Social socket messages and live presence. Thin adapters over server/social/service.js — the
 * same rules as the HTTP routes in server/routes/social.js.
 *
 * CLIENT → SERVER (each is answered on the sending socket; `clientId` is echoed when given)
 *   dm-send        { to | conv, body, clientId }   → dm-sent { clientId, conv, message, duplicate? }
 *                                                   | dm-failed { clientId, code, reason }
 *   dm-read        { conv, seq? }                  → dm-read-ok { conv }
 *   people-list    { cityId }                      → people { venue, self, players, count }
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
 *   people-interaction{ from, action, label, landed }
 *   invite-knock      { from, expiresAt }          invite-answer { host, answer, house }      invite-house { house }
 *   transfer          { from, amount, credited }
 * Clients must ignore types they do not know (the community panel's socket receives these too).
 *
 * Nothing here touches voice, the microphone, ws.room, ws.voice or ws.position.
 */
import { socialService } from '../social/service.js';
import { canHost } from '../routes/social.js';

export default function socialSocket(ctx) {
  if (!canHost(ctx) || typeof ctx.send !== 'function') return { messages: {} };
  const service = socialService(ctx);
  const { presence } = service;

  /** Run a service call for the socket's stored session, commit, push, and return the result. */
  async function run(ws, call) {
    const result = await ctx.store.transact((db) => {
      const session = ctx.core.sessionOf(ws, db);
      if (!session || session.expiresAt <= ctx.now()) throw Error('device_session_required');
      return call(db, session);
    });
    return service.deliver(result);
  }
  /** Tell a player's friends that they connected or dropped. Best effort; never blocks the socket. */
  function announce(id, status) {
    ctx.store.read((db) => Object.keys(db.social?.players?.[id]?.friends || {}))
      .then((friends) => { for (const friend of friends) ctx.push(friend, { type: 'people-presence', id, status }); })
      .catch(() => {});
  }
  const echo = (message) => (typeof message.clientId === 'string' && message.clientId.length <= 80 ? { clientId: message.clientId } : {});

  return {
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
