import { REAL_VALUE, integer, isListing, parseContact, record, text } from '../../src/game/real-value/model.ts'
import type { AnalyticsRecord, ContactExchange, RealValueCollection } from '../../src/types/real-value.ts'
import type { Db, RouteContext } from '../types.ts'
export const emptyRealValue = (): RealValueCollection => ({ v: 1, seq: 0, listings: {}, contacts: {}, analytics: {} })
export function isExchange(value: unknown): value is ContactExchange {
  if (!record(value) || value.v !== 1 || !text(value.id, 120) || !text(value.listingId, 40) || !text(value.owner, 80) || !text(value.requester, 80) || !integer(value.revision, 1) || !integer(value.createdAt) || !integer(value.expiresAt)) return false
  return value.status === 'revoked' || value.status === 'expired' || (value.status === 'awaiting-owner' && parseContact(value.requesterContact) !== null) || (value.status === 'mutual' && parseContact(value.requesterContact) !== null && parseContact(value.ownerContact) !== null)
}
export function isAnalytics(value: unknown): value is AnalyticsRecord {
  return record(value) && [value.view, value.link, value.save].every((set) => record(set) && Object.keys(set).length <= REAL_VALUE.analyticsActors && Object.entries(set).every(([id, at]) => text(id, 80) && integer(at)))
}
export function isCollection(value: unknown): value is RealValueCollection {
  return record(value) && value.v === 1 && integer(value.seq) && record(value.listings) && record(value.contacts) && record(value.analytics)
    && Object.keys(value.listings).length <= REAL_VALUE.listings && Object.entries(value.listings).every(([id, listing]) => isListing(listing) && listing.id === id)
    && Object.keys(value.contacts).length <= REAL_VALUE.contacts && Object.entries(value.contacts).every(([id, exchange]) => isExchange(exchange) && exchange.id === id)
    && Object.keys(value.analytics).length <= REAL_VALUE.listings && Object.values(value.analytics).every(isAnalytics)
}
export function peekRealValue(db: Db): { listings: Record<string, unknown>; contacts: Record<string, unknown>; analytics: Record<string, unknown> } {
  const found: unknown = 'realValue' in db ? db.realValue : undefined
  // Keep keyed maps lazy. Callers validate only the entries they actually read.
  if (!record(found) || found.v !== 1 || !integer(found.seq) || !record(found.listings) || !record(found.contacts) || !record(found.analytics)
    || Object.keys(found.listings).length > REAL_VALUE.listings || Object.keys(found.contacts).length > REAL_VALUE.contacts || Object.keys(found.analytics).length > REAL_VALUE.listings) return emptyRealValue()
  return { listings: found.listings, contacts: found.contacts, analytics: found.analytics }
}
export function realValueOf(ctx: RouteContext, db: Db): RealValueCollection {
  const found = ctx.collection(db, 'realValue', emptyRealValue())
  // Fail closed rather than replace partial records. This collection never contains paid proof.
  if (!isCollection(found)) throw ctx.fail(503, 'real_value_storage_invalid')
  return found
}
export function prune(collection: RealValueCollection, now: number): void {
  for (const [id, listing] of Object.entries(collection.listings)) if (Math.min(listing.expiresAt, listing.status === 'closed' ? listing.updatedAt : Infinity) < now - REAL_VALUE.retention) { delete collection.listings[id]; delete collection.analytics[id] }
  for (const [id, exchange] of Object.entries(collection.contacts)) if (!collection.listings[exchange.listingId] || exchange.expiresAt < now - REAL_VALUE.retention) delete collection.contacts[id]
}
