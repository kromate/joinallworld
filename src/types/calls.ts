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
 *   call-ice      { callId }                       the carrying side asks for its connection servers, after the call is accepted.
 *   call-report   { callId, path }                 how the audio connected (`direct`, `relay`) or that it did not (`failed`): counted, nothing else.
 * SERVER -> CLIENT
 *   call-incoming { callId, from, expiresAt }      to every open socket of the callee, and to one that opens while it rings.
 *   call-state    { callId, state, ... }           every change of one call, to both sides.
 *   call-signal   { callId, kind, data }           relayed signalling; the target comes from the call record.
 *   call-settings { calls }                        the answer to a read; a change goes to every open socket of the player.
 *   call-ice      { callId, relay, iceServers?, expiresAt? }  the answer to call-ice: STUN only (`relay` says why) or with short-lived relay servers (`on`).
 * A call is carried by one socket on each side (the one that invited, the one that accepted): signalling goes between
 * those two only, and only they can cancel or hang up (server/social/calls.ts, ONE CALL, SEVERAL DEVICES).
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
export interface CallIceRequestFrame { type: 'call-ice'; callId: string }
export type CallPath = 'direct' | 'relay' | 'failed'
export const CALL_PATHS = ['direct', 'relay', 'failed'] as const satisfies readonly CallPath[]
export interface CallReportFrame { type: 'call-report'; callId: string; path: CallPath }
export type CallClientFrame = CallIceRequestFrame | CallReportFrame | CallInviteFrame | CallAcceptFrame | CallDeclineFrame | CallCancelFrame | CallHangupFrame | CallSignalSendFrame | CallSettingsSendFrame

export interface CallIncomingFrame { type: 'call-incoming'; callId: string; from: PlayerRef; expiresAt: number }
/**
 * `role` says which side of the call this socket's player is. `peer` is the other player. `clientId` is echoed to the
 * caller's own socket. `elsewhere` (with `ringing` or `accepted`) is for a socket that does not carry the call: another
 * socket of the same player placed it or answered it. Such a socket shows the call and can do nothing to it; a
 * cancel, hang-up or signal from it is refused with the error `call_elsewhere`. An empty `callId` is a refusal to ring
 * (`unreachable`, never saying why); `limited` and `busy` say it was the caller's own attempts or call. A frame naming
 * a call the server does not hold is answered `ended`.
 */
export interface CallStateFrame { type: 'call-state'; callId: string; state: CallStateName; role?: 'caller' | 'callee'; peer?: PlayerRef; clientId?: string; expiresAt?: number; elsewhere?: true; limited?: true; busy?: true }
export interface CallSignalRelayFrame { type: 'call-signal'; callId: string; kind: CallSignalKind; data: CallSignalData }
export interface CallSettingsFrame { type: 'call-settings'; calls: CallsFrom }
/** `relay`: `on` (relay servers are in the list), `off` (this host has no relay), `limited` (a limit was reached), `error` (the provider did not answer). Without `on` the list is STUN only. */
export type CallRelayState = 'on' | 'off' | 'limited' | 'error'
export interface CallIceServer { urls: string | string[]; username?: string; credential?: string }
export interface CallIceFrame { type: 'call-ice'; callId: string; relay: CallRelayState; iceServers: CallIceServer[]; expiresAt?: number }
export type CallServerFrame = CallIceFrame | CallIncomingFrame | CallStateFrame | CallSignalRelayFrame | CallSettingsFrame

export const CALL_CLIENT_FRAME_TYPES = ['call-invite', 'call-accept', 'call-decline', 'call-cancel', 'call-hangup', 'call-signal', 'call-settings', 'call-ice', 'call-report'] as const satisfies readonly CallClientFrame['type'][]
export const CALL_SERVER_FRAME_TYPES = ['call-incoming', 'call-state', 'call-signal', 'call-settings', 'call-ice'] as const satisfies readonly CallServerFrame['type'][]
