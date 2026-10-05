// The wording and small rules the social screens draw with (people, cards, calls, the gate note). Fetched with those screens:
// the first download needs only the two badge counts in socialModel.ts.
import type { PresenceStatus } from '../../../types/social.ts'
import { PRESENCE } from '../../../game/social-model.ts'

/** The who-is-here listing is read again after this long (server time). */
export const STALE_MS = 20000
/** How many whole stale periods the listing is old: it changes when a re-read is due. */
export const staleSteps = (now: number, readAt: number): number => Math.floor(Math.max(0, now - readAt) / STALE_MS)
/** The name of a venue in a list of the city's venues, else its id. */
export const venueNameOf = (venues: readonly { id: string; label: string }[], id: string): string => venues.find((venue) => venue.id === id)?.label ?? id
/** "Friend · 12/20 to Paddy Mi", or "Paddy Mi · 40/60" at the top. */
export function closenessText(rel: { tierLabel: string; points: number; next: { label: string; min: number } | null }, maxCloseness: number): string {
  return `${rel.tierLabel} · ${Math.floor(rel.points)}/${rel.next ? rel.next.min : maxCloseness}${rel.next ? ` to ${rel.next.label}` : ''}`
}
/** What a stranger's closeness reads. */
export const STRANGER_TEXT = 'Stranger · 0/5 to Acquaintance'
/** The fill of a closeness meter, 0–100. */
export const meterPercent = (points: number, max: number): number => Math.min(100, (points / max) * 100)
/** The dot class of a presence word; an unknown word is offline. */
export const dotOf = (status: string | undefined): string => (status && status in PRESENCE ? PRESENCE[status as PresenceStatus].dot : 'off')
export const dotHint = (status: string | undefined): string => (status && status in PRESENCE ? PRESENCE[status as PresenceStatus].hint : '')
/** The presence class of a status word; an unknown word is offline. */
export const presenceClass = (status: string | undefined): string => (status && status in PRESENCE ? status : 'offline')
/** 'harassment' → 'Harassment', 'offensive-name' → 'Offensive name'. */
export const reasonLabel = (reason: string): string => `${reason.charAt(0).toUpperCase()}${reason.slice(1).replace('-', ' ')}`
/** 'hunger' → '+Hunger', for an action's tags. */
export const tagLabel = (tag: string): string => `+${tag.charAt(0).toUpperCase()}${tag.slice(1)}`
/** Why the Call button is off, or null. `cannot` is the connection wording for "call". */
export function callReason(input: { connected: boolean; cannot: string; calling: string | null; memberId: string; busy: boolean }): string | null {
  return !input.connected ? input.cannot : input.calling === input.memberId ? 'On the phone…' : input.busy ? 'Finish or cancel your current action first.' : null
}
/** The line under a list of calls when nothing can be called, else ''. */
export function callNote(input: { connected: boolean; cannot: string; busy: boolean }): string {
  return !input.connected ? input.cannot : input.busy ? 'Finish or cancel your current action to call.' : ''
}
/** What a social screen shows instead of its content until the overview has loaded; null when it has. */
export interface Gate { text: string; warn: boolean; /** Offer the way out of the connection state. */ link: boolean; retry: boolean }
export function gateOf(input: { onboardingRequired: boolean; connected: boolean; why: string; error: string | null; hasOverview: boolean }): Gate | null {
  if (input.onboardingRequired) return { text: 'Choose your look and tap Play first. People and messages open as soon as you are in the city.', warn: false, link: false, retry: false }
  if (!input.connected) return { text: `${input.why} People and messages are read-only until that is resolved.`, warn: true, link: true, retry: false }
  if (input.error && !input.hasOverview) return { text: `Could not load: ${input.error}`, warn: true, link: false, retry: true }
  if (!input.hasOverview) return { text: 'Loading…', warn: false, link: false, retry: false }
  return null
}
