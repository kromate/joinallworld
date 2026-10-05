/**
 * OWNER: social
 * One-to-one calls: the call table, the rules for ringing a player, and the relay of signalling.
 * server/ws/calls.ts is the thin socket adapter over this; the frames are documented in
 * src/types/calls.ts.
 *
 * WHAT THE SERVER DOES AND DOES NOT DO
 *   It introduces two players and relays the offer, the answer and the network candidates between them.
 *   It never carries audio. Nothing is relayed until the callee has accepted, and every relayed frame
 *   is checked against the call record: the sender must be the caller (offer) or the callee (answer) of
 *   an ACCEPTED call, or either one (candidate). The target is always the other party of that record;
 *   a frame never names who it is for.
 *
 * WHO CAN BE RUNG. All of these must hold, and when any one fails the caller sees `unreachable` and
 * nothing else (so nobody learns whether they were blocked, whether the other player is busy, or what
 * the other player's setting is):
 *   - the callee is a stored, unexpired session with a social record (so a bot or an unknown id is not);
 *   - neither has blocked the other, and neither is muted by moderation;
 *   - the callee's setting allows it: `everyone` (the default), `friends` (mutual friends only) or `nobody`;
 *   - the callee has an open, responsive socket, and neither side is in another call.
 * Attempts are limited per caller and per caller-and-callee pair, before any of the above is looked at,
 * so the limit tells a caller nothing about the callee either.
 *
 * ONE CALL, SEVERAL DEVICES (docs/DEVICES.md). A player may have several sockets open: tabs, or the browsers signed in to
 * one account. A call belongs to the player, and is CARRIED by exactly one socket on each side: the caller's is the one
 * that sent the invite, the callee's is the one that accepted.
 *   - An incoming call is announced to every open socket of the callee, and to one that opens while it rings.
 *   - Any of the callee's sockets may accept or decline while it rings. The first accept carries the call; the others
 *     are told `accepted` with `elsewhere`. A decline is for all of them.
 *   - The caller's other sockets are told `ringing` and then `accepted`, each with `elsewhere`: they show that the player
 *     is in a call on another device, and that is all they can do with it.
 *   - Signalling is taken from a carrying socket and handed to the other side's carrying socket, and to no other.
 *   - Only a carrying socket can cancel or hang up; the same frame from another socket of that player is refused
 *     (`call_elsewhere`). So a device that did not answer cannot end the call, whether by a button or by being closed.
 *   - When a carrying socket closes, the call is over for everyone, as it is for a player with one device. Closing any
 *     other socket changes nothing, and nothing rings again.
 *   - Every end is announced to every socket of both players.
 *
 * LIFETIME. A call rings for 30 s (a timer, the host's heartbeat, and a check on every call frame all
 * apply it). An accepted call without an offer is ended after 60 s. A call ends when either side hangs up,
 * when all of a player's sockets are gone, when a block appears between the two, or when a side becomes
 * muted. Calls live in memory only. While a call exists a host that sleeps when idle (the Worker) is kept awake
 * by a timer, so memory is lost only when the object is replaced, which closes its sockets and ends the call for
 * the other side. A frame about a call nobody holds is answered `ended`, so a client that outlived the table
 * drops its call.
 *
 * Portable: no Node imports. One table per server context.
 */
import { UUID_PATTERN } from '../protocol.ts';
import { CALL_RING_MS, CALL_SETUP_MS, CALLS_FROM, CALLS_FROM_DEFAULT } from '../../src/types/calls.ts';
import type { CallSignalData, CallSignalKind, CallsFrom, CallStateFrame, CallStateName } from '../../src/types/calls.ts';
import type { PlayerRef } from '../../src/types/protocol.ts';
import type { Db, IncomingFrame, RouteContext, WsConnection } from '../types.ts';
import { presenceOf } from './presence.ts';
import { friendsIn } from './founder.ts';

export const CALL_LIMITS = { perCallerPerMinute: 8, perPairPerMinute: 3, sdpChars: 8000, candidateChars: 1000, nameChars: 64, ice: 200, offers: 8, answers: 8, settingsPerMinute: 20, keepAwakeMs: 15000 } as const;
const CLIENT_ID = /^[A-Za-z0-9:_-]{1,80}$/;
const CALL_ID = /^[A-Za-z0-9-]{1,80}$/;
const OPEN = 1;

interface CallRecord {
  id: string
  caller: PlayerRef
  callee: PlayerRef
  clientId: string
  state: 'ringing' | 'accepted'
  expiresAt: number
  /** While ringing: the ring's end. Once accepted: the end of the setup window, until the first offer. */
  deadline: number
  offered: boolean
  counts: { offer: number; answer: number; ice: number }
  /** The socket that carries the call on each side: the one that invited, and (once accepted) the one that answered. */
  sockets: { caller: WsConnection; callee: WsConnection | null }
}
export type CallService = ReturnType<typeof buildService>;
const services = new WeakMap<RouteContext, CallService>();

export function callService(ctx: RouteContext): CallService {
  const cached = services.get(ctx);
  if (cached) return cached;
  const built = buildService(ctx);
  services.set(ctx, built);
  return built;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length <= max ? value : null);
const optionalText = (value: unknown, max: number): string | null | undefined => (value === undefined || value === null ? null : text(value, max) ?? undefined);

/**
 * The signalling payload the server will pass on, rebuilt field by field, or null. An offer or answer is
 * the session description text; a candidate is one line plus its small identifiers. Nothing else survives.
 */
export function cleanSignal(kind: CallSignalKind, data: unknown): CallSignalData | null {
  if (!isRecord(data)) return null;
  if (kind === 'offer' || kind === 'answer') {
    const sdp = text(data.sdp, CALL_LIMITS.sdpChars);
    return sdp && sdp.length > 0 ? { sdp } : null;
  }
  const candidate = text(data.candidate, CALL_LIMITS.candidateChars);
  const mid = optionalText(data.sdpMid, CALL_LIMITS.nameChars);
  const fragment = optionalText(data.usernameFragment, CALL_LIMITS.nameChars);
  const index = data.sdpMLineIndex === undefined || data.sdpMLineIndex === null ? null : data.sdpMLineIndex;
  if (candidate === null || mid === undefined || fragment === undefined) return null;
  if (index !== null && !(typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= 64)) return null;
  return { candidate, sdpMid: mid, sdpMLineIndex: index, usernameFragment: fragment };
}

function buildService(ctx: RouteContext) {
  const presence = presenceOf(ctx);
  const now = (): number => ctx.now();
  const calls = new Map<string, CallRecord>();
  const byPlayer = new Map<string, string>(); // player id → the call they are in (ringing or accepted, either side)
  const byClient = new Map<string, string>(); // `${caller}:${clientId}` → call id
  let timer: ReturnType<typeof setTimeout> | null = null;

  const otherOf = (call: CallRecord, id: string): PlayerRef => (call.caller.id === id ? call.callee : call.caller);
  const sideOf = (call: CallRecord, id: string): 'caller' | 'callee' | null => (call.caller.id === id ? 'caller' : call.callee.id === id ? 'callee' : null);
  /** To the socket that carries the call on that side, if it is open. Never to another socket of the player. */
  function toCarrier(call: CallRecord, side: 'caller' | 'callee', frame: Parameters<RouteContext['send']>[1]): void {
    const ws = call.sockets[side];
    if (ws && ws.readyState === OPEN) ctx.send(ws, frame);
  }
  const stateFrame = (call: CallRecord, side: 'caller' | 'callee', state: CallStateName, extra: Partial<CallStateFrame> = {}): CallStateFrame => ({
    type: 'call-state', callId: call.id, state, role: side, peer: { ...(side === 'caller' ? call.callee : call.caller) },
    ...(side === 'caller' ? { clientId: call.clientId } : {}), ...extra,
  });
  /** What a socket that does not carry the call is told: the call is on another device. It never carries the caller's client id. */
  const elsewhereFrame = (call: CallRecord, side: 'caller' | 'callee', state: 'ringing' | 'accepted'): CallStateFrame => ({
    type: 'call-state', callId: call.id, state, role: side, peer: { ...(side === 'caller' ? call.callee : call.caller) }, elsewhere: true,
  });
  /** Tell every other open socket of that side's player that the call is on another device. */
  function tellOthers(call: CallRecord, side: 'caller' | 'callee', state: 'ringing' | 'accepted'): void {
    const carrier = call.sockets[side];
    for (const other of presence.sockets((side === 'caller' ? call.caller : call.callee).id)) if (other !== carrier) ctx.send(other, elsewhereFrame(call, side, state));
  }
  /** A carrying socket that can no longer carry: closed, or not answering the host's pings. */
  const gone = (ws: WsConnection | null): boolean => !ws || ws.readyState !== OPEN || ctx.core?.unresponsive?.(ws) === true;

  /** Remove the call and tell both sides. `callerState` differs from `state` only when the caller must not learn why. */
  function end(call: CallRecord, state: CallStateName, callerState: CallStateName = state): void {
    if (calls.get(call.id) !== call) return;
    calls.delete(call.id);
    if (byPlayer.get(call.caller.id) === call.id) byPlayer.delete(call.caller.id);
    if (byPlayer.get(call.callee.id) === call.id) byPlayer.delete(call.callee.id);
    if (byClient.get(`${call.caller.id}:${call.clientId}`) === call.id) byClient.delete(`${call.caller.id}:${call.clientId}`);
    ctx.push(call.caller.id, stateFrame(call, 'caller', callerState));
    ctx.push(call.callee.id, stateFrame(call, 'callee', state));
    arm();
  }
  const refuse = (ws: WsConnection, clientId: string, extra: Partial<CallStateFrame> = {}): void => { ctx.send(ws, { type: 'call-state', callId: '', state: 'unreachable', clientId, ...extra }); };
  /** The same answer for an id nobody holds and for one the sender has no part in. */
  const unknown = (ws: WsConnection, callId: unknown): void => { ctx.send(ws, { type: 'call-state', callId: typeof callId === 'string' && CALL_ID.test(callId) ? callId : '', state: 'ended' }); };

  const barred = (a: string, b: string): boolean => ctx.checks?.blocked?.(a, b) === true || Boolean(ctx.checks?.muted?.(a)) || Boolean(ctx.checks?.muted?.(b));
  const hasLive = (id: string): boolean => presence.sockets(id).length > 0;

  /** Apply what can lapse: a ring that ran out, a setup window that ran out, a player gone, a block or mute that appeared. */
  function sweep(): void {
    const t = now();
    for (const call of [...calls.values()]) {
      if (call.state === 'ringing' && t >= call.deadline) { end(call, 'timeout'); continue; }
      if (call.state === 'accepted' && !call.offered && t >= call.deadline) { end(call, 'ended'); continue; }
      if (barred(call.caller.id, call.callee.id)) { end(call, call.state === 'ringing' ? 'cancelled' : 'ended', call.state === 'ringing' ? 'unreachable' : 'ended'); continue; }
      if (!hasLive(call.caller.id) || !hasLive(call.callee.id)) { end(call, call.state === 'ringing' ? 'cancelled' : 'ended', call.state === 'ringing' ? 'unreachable' : 'ended'); continue; }
      // The device that carries a side has gone, though another device of that player is still connected.
      if (gone(call.sockets.caller)) { end(call, call.state === 'ringing' ? 'cancelled' : 'ended'); continue; }
      if (call.state === 'accepted' && gone(call.sockets.callee)) end(call, 'ended');
    }
  }
  /** One timer while any call exists: at the next deadline, and (on a host that sleeps when idle) often enough to stay awake. */
  function arm(): void {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (!calls.size) return;
    let due = Infinity;
    for (const call of calls.values()) due = Math.min(due, call.state === 'ringing' || !call.offered ? call.deadline : Infinity);
    if (ctx.core?.hibernates === true) due = Math.min(due, now() + CALL_LIMITS.keepAwakeMs);
    if (!Number.isFinite(due)) return;
    const handle = setTimeout(() => { timer = null; sweep(); arm(); }, Math.max(250, Math.min(due - now() + 50, 60000)));
    (handle as { unref?: () => void }).unref?.();
    timer = handle;
  }
  ctx.on?.('heartbeat', () => { sweep(); arm(); });
  ctx.on?.('blocks-changed', ({ a, b }) => {
    for (const call of [...calls.values()]) {
      if ((call.caller.id === a && call.callee.id === b) || (call.caller.id === b && call.callee.id === a)) end(call, call.state === 'ringing' ? 'cancelled' : 'ended', call.state === 'ringing' ? 'unreachable' : 'ended');
    }
  });

  /** The callee as the caller may ring them, or null for every reason there is not to (see the header). Reads only. */
  function ringable(db: Db, caller: string, callee: string): PlayerRef | null {
    const session = ctx.core.sessionByPublicId(db, callee);
    if (!session || !(session.expiresAt > now())) return null;
    const social = db.social;
    const record = social?.players?.[callee];
    if (!social || !record) return null;
    if (record.blocked?.[caller] || social.players?.[caller]?.blocked?.[callee]) return null;
    const mode: CallsFrom = CALLS_FROM.find((item) => item === record.calls) ?? CALLS_FROM_DEFAULT;
    if (mode === 'nobody') return null;
    if (mode === 'friends' && !friendsIn(social.players, caller, callee)) return null;
    return { ...ctx.publicSession(session) };
  }

  const lookup = (callId: unknown): CallRecord | undefined => (typeof callId === 'string' ? calls.get(callId) : undefined);

  return {
    /** For tests and the adapter: the number of calls in the table. */
    get size(): number { return calls.size; },
    sweep,
    callOf: (id: string): string | undefined => byPlayer.get(id),

    async invite(ws: WsConnection, message: IncomingFrame): Promise<void> {
      const caller = ws.session.id;
      const clientId = typeof message.clientId === 'string' && CLIENT_ID.test(message.clientId) ? message.clientId : null;
      const to = typeof message.to === 'string' && UUID_PATTERN.test(message.to) ? message.to.toLowerCase() : null;
      if (!clientId || !to || to === caller) throw Error('invalid_call');
      sweep();
      const earlier = calls.get(byClient.get(`${caller}:${clientId}`) ?? '');
      if (earlier && earlier.caller.id === caller) { ctx.send(ws, stateFrame(earlier, 'caller', 'ringing', { expiresAt: earlier.expiresAt })); return; }
      // The limits come first and look at nothing about the callee.
      if (!ctx.allow(`call:from:${caller}`, CALL_LIMITS.perCallerPerMinute) || !ctx.allow(`call:pair:${caller}:${to}`, CALL_LIMITS.perPairPerMinute)) { refuse(ws, clientId, { limited: true }); return; }
      if (byPlayer.has(caller)) { refuse(ws, clientId, { busy: true }); return; }
      if (barred(caller, to)) { refuse(ws, clientId); return; }
      const callee = await ctx.store.read((db) => ringable(db, caller, to));
      // Everything from here is synchronous, so two calls cannot both take the same player.
      sweep();
      if (!callee || ws.readyState !== OPEN || byPlayer.has(caller) || byPlayer.has(to) || barred(caller, to) || !hasLive(to)) { refuse(ws, clientId); return; }
      const t = now();
      const call: CallRecord = {
        id: ctx.randomId(), caller: { id: caller, name: ws.session.name }, callee, clientId, state: 'ringing', expiresAt: t + CALL_RING_MS, deadline: t + CALL_RING_MS,
        offered: false, counts: { offer: 0, answer: 0, ice: 0 }, sockets: { caller: ws, callee: null },
      };
      calls.set(call.id, call);
      byPlayer.set(caller, call.id); byPlayer.set(to, call.id); byClient.set(`${caller}:${clientId}`, call.id);
      if (byClient.size > 5000) byClient.clear();
      ctx.push(to, { type: 'call-incoming', callId: call.id, from: { ...call.caller }, expiresAt: call.expiresAt });
      ctx.send(ws, stateFrame(call, 'caller', 'ringing', { expiresAt: call.expiresAt }));
      tellOthers(call, 'caller', 'ringing');
      arm();
    },

    accept(ws: WsConnection, message: IncomingFrame): void {
      sweep();
      const call = lookup(message.callId);
      if (!call || call.callee.id !== ws.session.id) { unknown(ws, message.callId); return; }
      if (call.state !== 'ringing') return;
      if (barred(call.caller.id, call.callee.id) || !hasLive(call.caller.id)) { end(call, 'cancelled', 'unreachable'); return; }
      call.state = 'accepted'; call.sockets.callee = ws; call.deadline = now() + CALL_SETUP_MS;
      tellOthers(call, 'callee', 'accepted');
      ctx.send(ws, stateFrame(call, 'callee', 'accepted'));
      toCarrier(call, 'caller', stateFrame(call, 'caller', 'accepted'));
      tellOthers(call, 'caller', 'accepted');
      arm();
    },

    /**
     * `cancel` (caller), `decline` (callee) or `hangup` (either side; on a ringing call it means cancel or decline).
     * Any socket of the callee may decline a ringing call. Everything else is for the socket that carries the call.
     */
    leave(ws: WsConnection, message: IncomingFrame, how: 'cancel' | 'decline' | 'hangup'): void {
      sweep();
      const call = lookup(message.callId);
      const side = call ? sideOf(call, ws.session.id) : null;
      if (!call || !side) { unknown(ws, message.callId); return; }
      if ((how === 'cancel' && side !== 'caller') || (how === 'decline' && side !== 'callee')) throw Error('invalid_call');
      if (call.state === 'accepted' || side === 'caller') { if (ws !== call.sockets[side]) throw Error('call_elsewhere'); }
      if (call.state === 'accepted') { end(call, 'ended'); return; }
      if (side === 'callee') end(call, 'declined');
      else end(call, 'cancelled');
    },

    signal(ws: WsConnection, message: IncomingFrame): void {
      sweep();
      const call = lookup(message.callId);
      const side = call ? sideOf(call, ws.session.id) : null;
      if (!call || !side) { unknown(ws, message.callId); return; }
      // Nothing is exchanged before the callee has accepted.
      if (call.state !== 'accepted') throw Error('invalid_call');
      const kind = message.kind === 'offer' || message.kind === 'answer' || message.kind === 'ice' ? message.kind : null;
      if (!kind) throw Error('invalid_call');
      if ((kind === 'offer' && side !== 'caller') || (kind === 'answer' && side !== 'callee')) throw Error('invalid_call');
      const data = cleanSignal(kind, message.data);
      if (!data) throw Error('invalid_call');
      // Only the device that carries this side may signal, and what it sends goes to the other side's carrying device alone.
      if (ws !== call.sockets[side]) throw Error('call_elsewhere');
      if (call.counts[kind === 'ice' ? 'ice' : kind]++ >= (kind === 'ice' ? CALL_LIMITS.ice : kind === 'offer' ? CALL_LIMITS.offers : CALL_LIMITS.answers)) throw Error('rate_limited');
      if (kind === 'offer') call.offered = true;
      toCarrier(call, side === 'caller' ? 'callee' : 'caller', { type: 'call-signal', callId: call.id, kind, data });
    },

    /** Read or change who may ring the sender. Needs the sender to have a social record (the client reads its overview first). */
    async settings(ws: WsConnection, message: IncomingFrame): Promise<CallsFrom> {
      const id = ws.session.id;
      if (!ctx.allow(`call:settings:${id}`, CALL_LIMITS.settingsPerMinute)) throw Error('rate_limited');
      const wanted = message.calls === undefined ? null : CALLS_FROM.find((item) => item === message.calls) ?? null;
      if (message.calls !== undefined && !wanted) throw Error('invalid_call_setting');
      const apply = (db: Db): CallsFrom => {
        const record = ctx.collection(db, 'social').players?.[id];
        if (!record) throw Error('social_not_ready');
        if (wanted) record.calls = wanted;
        return CALLS_FROM.find((item) => item === record.calls) ?? CALLS_FROM_DEFAULT;
      };
      return wanted ? ctx.store.transact(apply) : ctx.store.read(apply);
    },

    /**
     * A socket opened while its player is in a call: a ringing call rings here too, and any other call is shown as being
     * on another device. Nothing about the call changes.
     */
    open(ws: WsConnection): void {
      const id = ws.session?.id;
      if (!id || !byPlayer.has(id)) return;
      sweep();
      const call = calls.get(byPlayer.get(id) ?? '');
      const side = call ? sideOf(call, id) : null;
      if (!call || !side) return;
      if (call.state === 'ringing' && side === 'callee') ctx.send(ws, { type: 'call-incoming', callId: call.id, from: { ...call.caller }, expiresAt: call.expiresAt });
      else ctx.send(ws, elsewhereFrame(call, side, call.state));
    },

    /**
     * A socket closed. The call ends when it was the socket that carried it (the caller's, or the one that answered),
     * and when a ringing callee has no socket left. Any other socket of either player closing changes nothing.
     */
    close(ws: WsConnection): void {
      const id = ws.session?.id;
      if (!id) return;
      const call = calls.get(byPlayer.get(id) ?? '');
      if (!call) return;
      if (ws === call.sockets.caller) { end(call, call.state === 'accepted' ? 'ended' : 'cancelled'); return; }
      if (call.state === 'accepted') { if (ws === call.sockets.callee) end(call, 'ended'); return; }
      if (call.callee.id === id && !presence.sockets(id).some((other) => other !== ws)) end(call, 'cancelled', 'unreachable');
    },

  };
}
