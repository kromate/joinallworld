// What the growth screens (Missions, Events, Bring a friend, Stay in touch, the away card) say and
// decide, worked out from the server's answers. Pure: no DOM, no network, no storage, so all of it
// is tested without a browser. The one client that talks to /api/growth/* is useGrowth.ts.
import type { ClientSignal, HelloResult, ShareKind } from '../../../types/growth.ts'

/** The hello that succeeded: what the growth screens read. */
export type HelloOk = Extract<HelloResult, { ok: true }>

/** A hello at most every five minutes, and never from a timer: it is asked for when a screen is drawn. */
export const HELLO_MAX_AGE = 5 * 60000
/** Is the last hello (at `at`, 0 when none) too old to reuse? */
export const helloStale = (at: number, now: number): boolean => !at || now - at >= HELLO_MAX_AGE

/** A growth call that did not succeed: a refusal by the rules (HTTP 200), or the transport (`transport`). */
export interface GrowthFailure { ok: false; code: string; reason: string; transport?: boolean }
/** One POST's outcome: the route's own answer, or a failure. Never thrown. */
export type GrowthCall<R> = R | GrowthFailure

/** What `fetchJson` rejects with (a network failure has no status). */
export interface TransportError { status?: number; code?: string; reason?: string }

/** The sentence and code for a request that threw. */
export function failureOf(error: unknown): GrowthFailure {
  const e: TransportError = typeof error === 'object' && error !== null ? error : {}
  const reason = e.reason
    || (e.status === 429 ? 'Too many requests. Wait a minute and try again.'
      : e.status === 401 ? 'Your device session expired. Reconnect to continue.'
        : 'The server could not be reached. Nothing was changed; try again.')
  return { ok: false, code: e.code || 'network', transport: !e.status, reason }
}

/** The growth calls need a connection and a life that has settled in (not a guest held for the quick start). */
export const growthReady = (view: { connected: boolean; onboarding?: { required?: boolean } | null }): boolean => Boolean(view.connected) && view.onboarding?.required !== true

/** A WhatsApp Channel link is shown only when the server configured one and it is https. */
export const channelHref = (channel: unknown): string => (typeof channel === 'string' && /^https:\/\//.test(channel) ? channel : '')

/** The share kinds that also count as an invitation made. */
export const isInvite = (kind: ShareKind): boolean => kind === 'invite' || kind === 'house' || kind === 'table'

/**
 * Product events for whatever analytics the game has: a decoupled DOM event, never an SDK call.
 * Props are fixed small values — a kind, an id from the game's own content, a result. Never a
 * name, a message, an address or a position.
 */
export function track(name: string, props: Record<string, string | number | boolean> = {}): void {
  try { globalThis.window?.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props } })) } catch { /* no listener is fine */ }
}
/** The age answer, as the server holds it, is told to whoever listens ('jaw:age'): telemetry switches analytics off for "under 18". */
export function announceAge(age: unknown): void {
  if (age !== 'minor' && age !== 'adult') return
  try { globalThis.window?.dispatchEvent(new CustomEvent('jaw:age', { detail: { age } })) } catch { /* not a browser */ }
}
/** What to report after a hello: the two things a player did that the previous hello did not show. */
export function helloEvents(next: HelloOk, previous: HelloOk | null): string[] {
  const events: string[] = []
  if (next.contact.email?.confirmed && previous && !previous.contact.email?.confirmed) events.push('email_optin_confirmed')
  if ((next.referral.paid?.paidTotal ?? 0) > (previous?.referral.paid?.paidTotal ?? Infinity)) events.push('referral_rewarded')
  return events
}
export type { ClientSignal }

// ---- time ----------------------------------------------------------------------------------
/** "2d 4h", "3h 12m", "5m" until a server time. */
export function until(at: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((at - now) / 60000))
  if (minutes >= 2880) return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m`
}
const DAY_TIME = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
const CLOCK = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true })
/** "Fri, 8:00 pm – 2:00 am" in Lagos time. */
export const span = (start: number, end: number): string => `${DAY_TIME.format(new Date(start))} – ${CLOCK.format(new Date(end))}`
