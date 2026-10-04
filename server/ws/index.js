/**
 * WEBSOCKET MESSAGE REGISTRY — the contract for server/ws/*.js
 * ===========================================================================
 * OWNER: foundation. Feature owners edit only their own module (social.js); every module is
 * already imported and registered here.
 *
 * A ws module default-exports a function that receives the same server context as route
 * modules (see server/routes/index.js) and returns:
 *
 *   export default function socialSocket(ctx) {
 *     return {
 *       messages: {
 *         // Plain function: allowed whether or not the socket has joined a venue room.
 *         'dm-send': async (ws, message) => {
 *           if (typeof message.to !== 'string') throw Error('invalid_dm');   // → error reply
 *           ...ctx.store.transact(...)...
 *           ctx.push(message.to, { type: 'dm', from: ws.session, body });    // to all their sockets
 *           ctx.send(ws, { type: 'dm-sent', clientId: message.clientId });   // to this socket
 *         },
 *         // { room: true, handle }: rejected with 'join_required' unless ws.room is set.
 *         'wave': { room: true, handle: async (ws, message) => {} },
 *       },
 *       restore(ws) {}, // optional: restore trusted host attachment after hibernation
 *       open(ws) {},    // optional: a socket connected (already authenticated)
 *       close(ws) {},   // optional: a socket closed
 *     };
 *   }
 *
 * WHAT A HANDLER GETS
 *   ws.session   { id, name } — the sender's PUBLIC identity (id === session.publicId)
 *   ws.room      current venue room key or null/undefined (read-only for feature modules)
 *   message      the parsed JSON object (≤ 16 KB frame); `message.type` selected your handler.
 *                Everything in it is untrusted — validate each field.
 *   To look up the sender's stored session inside a transaction: ctx.core.sessionOf(ws, db).
 * ERRORS   `throw Error('machine_code')` → the sender receives
 *          { type: 'error', code: 'machine_code', error: 'machine_code' }. Give the error a string
 *          `reason` (Object.assign(Error(code), { reason })) and it is sent along as `reason`.
 * The host has already applied the per-identity rate limit (600 messages/minute), rejected
 * expired sessions and serialised messages per socket (your handler finishes before the
 * same socket's next message starts).
 *
 * RULES
 *   - Message types are global: prefix yours with your area (dm-*, group-*, friend-*, invite-*).
 *     A duplicate type aborts start-up. join, move, voice-state, signal and chat are core.
 *   - Never send ws.secret or a stored session.secret to anyone.
 *   - Do not mutate ws.room, ws.voice or ws.position; rooms belong to ws/rooms.js.
 *   - Same import rules as route modules.
 *
 * HOW TO TEST   (server/social.test.js)
 *   const f = await fixture(t); const ada = await f.device('Ada');
 *   const a = await f.socket(ada);                       // { ws, next() }
 *   a.ws.send(JSON.stringify({ type: 'dm-send', to: bola.id, body: 'Hi' }));
 *   assert.equal((await b.next()).type, 'dm');
 */
import rooms from './rooms.js';
import social from './social.js';

export const WS_MODULES = [rooms, social];

/** Build the dispatch table. Returns { messages: Map<type, { room, handle }>, open(ws), close(ws) }. */
export function buildSocketHandlers(ctx, modules = WS_MODULES) {
  const messages = new Map();
  const restores = [];
  const opens = [];
  const closes = [];
  for (const module of modules) {
    const built = module(ctx) || {};
    for (const [type, entry] of Object.entries(built.messages || {})) {
      const handle = typeof entry === 'function' ? entry : entry?.handle;
      if (typeof handle !== 'function' || !/^[a-z][a-z0-9-]{1,39}$/.test(type)) throw new Error(`Invalid socket message handler: ${type}`);
      if (messages.has(type)) throw new Error(`Duplicate socket message type: ${type}`);
      messages.set(type, { room: typeof entry === 'function' ? false : entry.room === true, handle });
    }
    if (built.restore) restores.push(built.restore);
    if (built.open) opens.push(built.open);
    if (built.close) closes.push(built.close);
  }
  return {
    messages,
    restore(ws) { for (const fn of restores) fn(ws); },
    open(ws) { for (const fn of opens) fn(ws); },
    close(ws) { for (const fn of closes) { try { fn(ws); } catch (error) { console.error('Socket close handler failed:', error.message); } } },
  };
}
