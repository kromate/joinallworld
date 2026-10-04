// The typed boundary to the social client (src/ui/panels/social-client.js): the browser-side
// state the People, Messages, Contacts, Family and Invite screens share, its one socket for live
// pushes, and the outbox that makes every sent message end as sent or failed.
//
// It is still JavaScript and still the single owner of that state — the existing panels shown
// through LegacyPanel and the Vue Messages app read the same `social` object, so a message sent
// in one shows in the other. It is not reactive: it calls `api.refresh()` whenever it changes, and
// Vue code reads `shell.legacyTick` to follow that.
import { S, call as callJs, cityId as cityIdJs, discard as discardJs, loadPeople as loadPeopleJs, newClientId as newClientIdJs, onPeople as onPeopleJs, openThread as openThreadJs, perform as performJs, reconnect as reconnectJs, retry as retryJs, send as sendJs, start as startJs, sync as syncJs, takeLinkHost as takeLinkHostJs, threadView as threadViewJs } from '../../ui/panels/social-client.js'
import type { Conversation, Message, OutboxEntry, SocialOverview, ThreadItem } from '../../types/social.ts'
import type { PanelApi } from '../types/panel.ts'

export interface SocialThread { messages: Message[]; loaded: boolean; error: string | null }
/** What the socket for live pushes is doing. 'offline' = the automatic reconnects ran out. */
export type SocialSocketState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline'
export interface SocialClientState {
  api: PanelApi | null
  /** The overview from GET /api/social/me, or null until it has loaded. */
  me: SocialOverview | null
  loading: boolean
  error: string | null
  socket: SocialSocketState
  /** The who-is-here listing, or { error }. */
  people: unknown
  threads: Map<string, SocialThread>
  /** The conversation on screen: messages that arrive for it are marked read. */
  openConv: string | null
}
/** A refusal comes back as { ok: false, code, reason }; `transport` is true when the server was not reached. */
export type SocialResult<T> = ({ ok: true } & T) | { ok: false; code: string; reason: string; transport?: boolean }
/** Where a message goes: a player (a new chat) or an existing conversation. */
export type SendTarget = { to: string } | { conv: string }

export const social = S as unknown as SocialClientState
/** Called by every social screen when it shows: idempotent. Opens the socket and reads the overview once. */
export const startSocial = startJs as unknown as (api: PanelApi) => void
/** One request. Never throws. */
export const call = callJs as unknown as <T = Record<string, unknown>>(path: string, body?: unknown) => Promise<SocialResult<T>>
/** A request the player asked for: toasts the reason when refused, then re-reads the overview. */
export const perform = performJs as unknown as <T = Record<string, unknown>>(path: string, body?: unknown, good?: string | null) => Promise<SocialResult<T>>
export const sync = syncJs as unknown as () => Promise<void>
export const loadPeople = loadPeopleJs as unknown as () => Promise<void>
export const onPeople = onPeopleJs as unknown as (listener: (people: unknown) => void) => () => void
export const openThread = openThreadJs as unknown as (id: string) => Promise<void>
/** Confirmed messages, then anything still pending or failed. */
export const threadView = threadViewJs as unknown as (key: string) => ThreadItem[]
/** Queue a message: it shows at once as pending, then becomes sent or failed. */
export const send = sendJs as unknown as (key: string, target: SendTarget, body: string) => void
/** Send a failed message again under the same client id, so the server stores it at most once. */
export const retry = retryJs as unknown as (clientId: string) => void
export const discard = discardJs as unknown as (clientId: string) => void
/** The landing handled the invite link itself: do not also open the Invite app for it. Returns the host it held. */
export const takeLinkHost = takeLinkHostJs as unknown as () => string | null
export const reconnectSocial = reconnectJs as unknown as () => void
export const socialCityId = cityIdJs as unknown as () => string
export const newClientId = newClientIdJs as unknown as () => string
export type { Conversation, Message, SocialOverview, OutboxEntry, ThreadItem }
