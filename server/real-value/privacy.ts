/** Account privacy hooks. Call erasure inside the account-deletion transaction for every owned character. */
import { integer, isListing, parseContact, parseInput, REAL_VALUE, record, text } from '../../src/game/real-value/model.ts'
import type { Contact } from '../../src/types/real-value.ts'
import type { Db } from '../types.ts'

/** Erasure also handles partial records: never replace the collection or silently retain a recognisable contact. */
export function eraseRealValue(db: Db, publicIds: readonly string[]): void {
  const ids = new Set(publicIds), collection: unknown = db.realValue
  if (!ids.size || !record(collection)) return
  const removedListings = new Set<string>()
  if (record(collection.listings)) {
    for (const [id, listing] of Object.entries(collection.listings)) {
      if (!record(listing)) continue
      if (typeof listing.owner === 'string' && ids.has(listing.owner)) {
        removedListings.add(id)
        if (typeof listing.id === 'string') removedListings.add(listing.id)
        delete collection.listings[id]
      } else if (Array.isArray(listing.hiddenBy)) {
        listing.hiddenBy = listing.hiddenBy.filter((actor) => typeof actor !== 'string' || !ids.has(actor))
      }
    }
  }
  if (record(collection.contacts)) {
    for (const [id, exchange] of Object.entries(collection.contacts)) {
      if (!record(exchange)) continue
      if ((typeof exchange.owner === 'string' && ids.has(exchange.owner)) || (typeof exchange.requester === 'string' && ids.has(exchange.requester))
        || (typeof exchange.listingId === 'string' && removedListings.has(exchange.listingId))) delete collection.contacts[id]
    }
  }
  if (record(collection.analytics)) {
    for (const [id, analytics] of Object.entries(collection.analytics)) {
      if (removedListings.has(id)) { delete collection.analytics[id]; continue }
      if (!record(analytics)) continue
      for (const event of ['view', 'link', 'save']) {
        const actors = analytics[event]
        if (record(actors)) for (const actor of ids) delete actors[actor]
      }
    }
  }
}

/** Only data supplied by these characters. `now` makes aggregates use the UI's rolling 30-day window. */
export function exportRealValue(db: Db, publicIds: readonly string[], now?: number) {
  const ids = new Set(publicIds), collection: unknown = db.realValue
  const result: {
    listings: object[]
    contacts: { id: string; listingId: string; owner: string; requester: string; status: string; revision: number; createdAt: number; expiresAt: number; ownContacts: { providedBy: string; contact: Contact }[] }[]
    analytics: { listingId: string; uniqueClaimedViewers: number; uniqueLinkTappers: number; uniqueSavers: number; capped: boolean }[]
    analyticsScope: 'retained-events' | 'last-30-days'
    capPerMetric: number
  } = { listings: [], contacts: [], analytics: [], analyticsScope: now === undefined ? 'retained-events' : 'last-30-days', capPerMetric: REAL_VALUE.analyticsActors }
  if (!ids.size || !record(collection)) return result
  const ownedListings = new Set<string>()
  if (record(collection.listings)) {
    for (const [id, listing] of Object.entries(collection.listings)) {
      if (!isListing(listing) || !ids.has(listing.owner)) continue
      const input = parseInput(listing)
      if (!input) continue
      // Reconstruct known fields: do not export reporter identities or unknown private fields from old records.
      result.listings.push({ ...input, v: listing.v, id: listing.id, owner: listing.owner, createdAt: listing.createdAt, updatedAt: listing.updatedAt, revision: listing.revision })
      ownedListings.add(id)
    }
  }
  if (record(collection.contacts)) {
    for (const exchange of Object.values(collection.contacts)) {
      if (!record(exchange) || !text(exchange.id, 120) || !text(exchange.listingId, 40) || !text(exchange.owner, 80) || !text(exchange.requester, 80)
        || !integer(exchange.revision, 1) || !integer(exchange.createdAt) || !integer(exchange.expiresAt)
        || !['awaiting-owner', 'mutual', 'revoked', 'expired'].includes(String(exchange.status))) continue
      if (!ids.has(exchange.owner) && !ids.has(exchange.requester)) continue
      const ownContacts: { providedBy: string; contact: Contact }[] = []
      if (exchange.status === 'awaiting-owner' || exchange.status === 'mutual') {
        const requesterContact = ids.has(exchange.requester) ? parseContact(exchange.requesterContact) : null
        const ownerContact = exchange.status === 'mutual' && ids.has(exchange.owner) ? parseContact(exchange.ownerContact) : null
        if (requesterContact) ownContacts.push({ providedBy: exchange.requester, contact: requesterContact })
        if (ownerContact) ownContacts.push({ providedBy: exchange.owner, contact: ownerContact })
      }
      result.contacts.push({ id: exchange.id, listingId: exchange.listingId, owner: exchange.owner, requester: exchange.requester, status: String(exchange.status), revision: exchange.revision, createdAt: exchange.createdAt, expiresAt: exchange.expiresAt, ownContacts })
    }
  }
  if (record(collection.analytics)) {
    for (const listingId of ownedListings) {
      const analytics = collection.analytics[listingId]
      if (!record(analytics)) continue
      const count = (event: string): number => {
        const actors = analytics[event]
        return record(actors) ? Object.values(actors).filter((at) => integer(at) && (now === undefined || at >= now - REAL_VALUE.retention)).length : 0
      }
      const views = count('view'), links = count('link'), saves = count('save')
      result.analytics.push({ listingId, uniqueClaimedViewers: Math.min(views, REAL_VALUE.analyticsActors), uniqueLinkTappers: Math.min(links, REAL_VALUE.analyticsActors), uniqueSavers: Math.min(saves, REAL_VALUE.analyticsActors), capped: Math.max(views, links, saves) >= REAL_VALUE.analyticsActors })
    }
  }
  return result
}
