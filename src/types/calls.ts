/**
 * One-to-one calls over the social socket (server/social/calls.ts, server/ws/calls.ts).
 *
 * The server only introduces the two players and relays signalling (the offer, the answer and the
 * network candidates). It never carries audio. Nothing is sent and no microphone opens on either side
 * until the callee has accepted.
 *
 * CLIENT -> SERVER
 *   call-invite   { to, clientId }                 ring a player. Answered `call-state` ringing or unreachable.
 *   call-accept   { callId }                       the callee takes the call.
 *   call-decline  { callId }                       the callee refuses.
 *   call-cancel   { callId }                       the caller gives up while it rings.
 *   call-hangup   { callId }                       either side ends an accepted call (also cancels or declines a ringing one).
 *   call-signal   { callId, kind, data }           offer | answer | ice, for the other side of an ACCEPTED call only.
 *   call-settings { calls? }                       who may ring you; without `calls` it only reads the current value.
 * SERVER -> CLIENT
 *   call-incoming { callId, from, expiresAt }      to the callee's open sockets.
 *   call-state    { callId, state, ... }           every change of one call, to both sides.
 *   call-signal   { callId, kind, data }           relayed signalling; the target comes from the call record.
 *   call-settings { calls }
 * The caller learns `unreachable` and nothing else when the callee cannot be rung for any reason
 * (blocked either way, muted, not accepting calls from them, busy, offline, unknown).
 */
import type { PlayerRef } from './protocol.ts'

/** Who may ring a player. The default is `everyone`: any online player can be rung, and the callee still has to accept. */
export type CallsFrom = 'everyone' | 'friends' | 'nobody'
export const CALLS_FROM = ['everyone', 'friends', 'nobody'] as const satisfies readonly CallsFrom[]
export const CALLS_FROM_DEFAULT: CallsFrom = 'everyone'

export type CallStateName = 'ringing' | 'accepted' | 'declined' | 'cancelled' | 'timeout' | 'ended' | 'unreachable'
export type CallSignalKind = 'offer' | 'answer' | 'ice'

/** offer and answer carry the session description text; ice carries one candidate. Sizes are capped by the server. */
export interface CallSessionData { sdp: string }
export interface CallIceData { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null }
export type CallSignalData = CallSessionData | CallIceData

/** How long a call rings, in ms. */
export const CALL_RING_MS = 30000
/** How long an accepted call may go without an offer before the server ends it. */
export const CALL_SETUP_MS = 60000

export interface CallInviteFrame { type: 'call-invite'; to: string; clientId: string }
export interface CallAcceptFrame { type: 'call-accept'; callId: string }
export interface CallDeclineFrame { type: 'call-decline'; callId: string }
export interface CallCancelFrame { type: 'call-cancel'; callId: string }
export interface CallHangupFrame { type: 'call-hangup'; callId: string }
export interface CallSignalSendFrame { type: 'call-signal'; callId: string; kind: CallSignalKind; data: CallSignalData }
export interface CallSettingsSendFrame { type: 'call-settings'; calls?: CallsFrom }
export type CallClientFrame = CallInviteFrame | CallAcceptFrame | CallDeclineFrame | CallCancelFrame | CallHangupFrame | CallSignalSendFrame | CallSettingsSendFrame

export interface CallIncomingFrame { type: 'call-incoming'; callId: string; from: PlayerRef; expiresAt: number }
/**
 * `role` says which side of the call this socket's player is. `peer` is the other player. `clientId` is echoed to the
 * caller. `elsewhere` marks the callee's other tabs when one tab answered. An empty `callId` is a refusal to ring
 * (`unreachable`, never saying why); `limited` and `busy` say it was the caller's own attempts or call. A frame naming
 * a call the server does not hold is answered `ended`.
 */
export interface CallStateFrame { type: 'call-state'; callId: string; state: CallStateName; role?: 'caller' | 'callee'; peer?: PlayerRef; clientId?: string; expiresAt?: number; elsewhere?: true; limited?: true; busy?: true }
export interface CallSignalRelayFrame { type: 'call-signal'; callId: string; kind: CallSignalKind; data: CallSignalData }
export interface CallSettingsFrame { type: 'call-settings'; calls: CallsFrom }
export type CallServerFrame = CallIncomingFrame | CallStateFrame | CallSignalRelayFrame | CallSettingsFrame

export const CALL_CLIENT_FRAME_TYPES = ['call-invite', 'call-accept', 'call-decline', 'call-cancel', 'call-hangup', 'call-signal', 'call-settings'] as const satisfies readonly CallClientFrame['type'][]
export const CALL_SERVER_FRAME_TYPES = ['call-incoming', 'call-state', 'call-signal', 'call-settings'] as const satisfies readonly CallServerFrame['type'][]
