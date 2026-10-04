/**
 * WEBSOCKET MESSAGE REGISTRY — the contract for server/ws/*.js
 * ===========================================================================
 * OWNER: foundation. Feature owners edit only their own module (social.js); every module is
 * already imported and registered here.
 *
 * A ws module default-exports a function that receives the same server context as route
 * modules (see server/routes/index.ts) and returns:
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
 *       open(ws) {},    // optional: a socket connected (already authenticated)
 *       close(ws) {},   // optional: a socket closed
 *       restore(ws) {}, // optional: a host that can lose its memory while sockets stay connected (the Worker's
 *                       // hibernation) hands back each socket with the fields it carried (ws.room, ws.position,
 *                       // ws.voice, …): put it back in your in-memory registries. Nothing is announced and nothing
 *                       // is reset; what the socket may still do is re-checked before its next message (revalidate).
 *                       // The Node host never calls it.
 *       lifecycle: {},  // optional: see ROOM LIFECYCLE below
 *     };
 *   }
 *
 * ROOM LIFECYCLE — what the host tells socket modules about, outside socket messages
 *   The HTTP routes change things a room depends on: a player's life moves, a name changes, a
 *   voice configuration is asked for. The host reaches socket modules for those through four
 *   functions on ctx.core, and THIS REGISTRY defines all four, always — whichever modules are
 *   registered, including none. A module takes part by returning `lifecycle` hooks; the foundation
 *   room module (rooms.js) is an ordinary participant, so a module that replaces or extends room
 *   handling receives exactly the calls the foundation's own rooms do:
 *     validateMemberships(secret, cityId, state, publicId)   a life was settled or acted on and
 *                              committed: drop sockets whose room it no longer allows. May be async.
 *     revalidate(publicId)     re-check that player's sockets against the STORED lives, whatever
 *                              just happened. The route host (server.js) calls it after every API
 *                              request of a player who has a socket in a room — also when the request
 *                              failed or its write was undone. ONE signature, the public id; the
 *                              registry's function never throws. May be async.
 *     roomStillValid(ws, db, session, cityId, state) → boolean   would this socket's room still be
 *                              granted? Asked before voice configuration is handed out. The answer
 *                              is true only if some module says so: with no room module registered
 *                              nobody is in a room, so it is false.
 *     refreshNames(session)    a session was created or renamed. The registry itself first brings
 *                              every socket of that player up to date (ws.session.name and the
 *                              renewed expiry); the hook is for re-announcing presence.
 *   Without any hook the calls are safe no-ops, so core routes work under any set of modules.
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
 *   - Message types are global: prefix yours with your area (dm-*, group-*, friend-*, invite-*, table-*).
 *     A duplicate type aborts start-up. join, move, voice-state, signal and chat are core.
 *   - Never send ws.secret or a stored session.secret to anyone.
 *   - Do not mutate ws.room, ws.voice or ws.position; rooms belong to ws/rooms.js.
 *   - Same import rules as route modules.
 *
 * HOW TO TEST   (server/social.test.ts)
 *   const f = await fixture(t); const ada = await f.device('Ada');
 *   const a = await f.socket(ada);                       // { ws, next() }
 *   a.ws.send(JSON.stringify({ type: 'dm-send', to: bola.id, body: 'Hi' }));
 *   assert.equal((await b.next()).type, 'dm');
 */
import rooms from './rooms.ts';
import social from './social.ts';
import world from './world.ts';
import tables from './tables.ts';
import type { RouteContext, WsConnection, WsDispatch, WsHandlerModule, WsLifecycle, WsMessageHandler } from '../types.ts';

export const WS_MODULES: readonly WsHandlerModule[] = [rooms, social, world, tables];

const LIFECYCLE = ['validateMemberships', 'revalidate', 'roomStillValid', 'refreshNames'] as const satisfies readonly (keyof WsLifecycle)[];
type LifecycleName = (typeof LIFECYCLE)[number];
const isLifecycleName = (name: string): name is LifecycleName => LIFECYCLE.some((item) => item === name);
const messageOf = (error: unknown): unknown => (typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined);

/**
 * Build the dispatch table. Returns { messages: Map<type, { room, handle }>, open(ws), close(ws), restore(ws) }
 * and installs the room lifecycle functions on ctx.core (see ROOM LIFECYCLE above).
 */
export function buildSocketHandlers(ctx: RouteContext, modules: readonly WsHandlerModule[] = WS_MODULES): WsDispatch {
  const messages = new Map<string, { room: boolean; handle: WsMessageHandler }>();
  const opens: ((ws: WsConnection) => void)[] = [];
  const closes: ((ws: WsConnection) => void)[] = [];
  const restores: ((ws: WsConnection) => void)[] = [];
  const hooks: { [Name in LifecycleName]: NonNullable<WsLifecycle[Name]>[] } = { validateMemberships: [], revalidate: [], roomStillValid: [], refreshNames: [] };
  for (const module of modules) {
    const built = module(ctx) || {};
    for (const [type, entry] of Object.entries(built.messages || {})) {
      const handle = typeof entry === 'function' ? entry : entry?.handle;
      if (typeof handle !== 'function' || !/^[a-z][a-z0-9-]{1,39}$/.test(type)) throw new Error(`Invalid socket message handler: ${type}`);
      if (messages.has(type)) throw new Error(`Duplicate socket message type: ${type}`);
      messages.set(type, { room: typeof entry === 'function' ? false : entry.room === true, handle });
    }
    if (built.open) opens.push(built.open);
    if (built.close) closes.push(built.close);
    if (built.restore) restores.push(built.restore);
    const lifecycle = built.lifecycle;
    if (lifecycle) {
      for (const name of Object.keys(lifecycle)) {
        if (!isLifecycleName(name) || typeof lifecycle[name] !== 'function') throw new Error(`Invalid socket lifecycle hook: ${name}`);
      }
      if (lifecycle.validateMemberships) hooks.validateMemberships.push(lifecycle.validateMemberships);
      if (lifecycle.revalidate) hooks.revalidate.push(lifecycle.revalidate);
      if (lifecycle.roomStillValid) hooks.roomStillValid.push(lifecycle.roomStillValid);
      if (lifecycle.refreshNames) hooks.refreshNames.push(lifecycle.refreshNames);
    }
  }
  const core = ctx.core;
  if (core && typeof core === 'object') {
    const everySocket = () => (typeof core.sockets === 'function' ? core.sockets() : []);
    // One failing module must not stop the others from revoking: every hook runs, then the first error is raised.
    const runAll = async <Args extends unknown[]>(list: ((...args: Args) => void | Promise<void>)[], args: Args): Promise<void> => {
      let failure: unknown = null;
      for (const hook of list) { try { await hook(...args); } catch (error) { failure ||= error; } }
      if (failure) throw failure;
    };
    core.validateMemberships = (...args) => runAll(hooks.validateMemberships, args);
    // revalidate never throws (the route host calls it in a `finally`): a failing hook is logged, the others still ran.
    core.revalidate = async (publicId) => {
      if (typeof publicId !== 'string') return;
      try { await runAll(hooks.revalidate, [publicId]); } catch (error) { (typeof core.log === 'function' ? core.log : console.error)(`Room revalidation failed: ${String(messageOf(error) ?? error).split('\n')[0]}`); }
    };
    core.roomStillValid = (...args) => hooks.roomStillValid.some((hook) => hook(...args) === true);
    core.refreshNames = (session) => {
      if (!session || typeof session.id !== 'string') return;
      const renewed = typeof ctx.now === 'function' ? ctx.now() : null;
      for (const ws of everySocket()) {
        if (ws.session?.id !== session.id) continue;
        ws.session.name = session.name;
        if (renewed !== null && Number.isFinite(ctx.config?.sessionTtlMs)) { ws.expiresAt = renewed + ctx.config.sessionTtlMs; ws.lastSessionRenewedAt = renewed; }
      }
      for (const hook of hooks.refreshNames) { try { hook(session); } catch (error) { console.error('Socket refreshNames hook failed:', messageOf(error)); } }
    };
  }
  return {
    messages,
    open(ws) { for (const fn of opens) fn(ws); },
    restore(ws) { for (const fn of restores) { try { fn(ws); } catch (error) { console.error('Socket restore handler failed:', messageOf(error)); } } },
    close(ws) { for (const fn of closes) { try { fn(ws); } catch (error) { console.error('Socket close handler failed:', messageOf(error)); } } },
  };
}
