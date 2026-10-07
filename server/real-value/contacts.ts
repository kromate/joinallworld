import { adultKind, parseContact, REAL_VALUE } from '../../src/game/real-value/model.ts'
import type { ContactExchange, Listing } from '../../src/types/real-value.ts'
import type { Db, RouteContext, SessionRecord } from '../types.ts'
import { isExchange, peekRealValue, prune, realValueOf } from './data.ts'
import type { ListingService } from './listings.ts'

export function contactService(ctx: RouteContext, listings: ListingService) {
  function admit(db: Db, session: SessionRecord, listing: Listing): void {
    listings.claimed(db, session)
    if (listings.trust.complaints(db, session.publicId).held) throw ctx.fail(403, 'listings_held')
    if (listing.status !== 'open' || listing.expiresAt <= ctx.now() || !listings.visible(db, listing, session.publicId)) throw ctx.fail(404, 'listing_unavailable')
    if (adultKind(listing.kind) && listings.trust.adult(db, session.publicId) !== true) throw ctx.fail(403, 'adult_self_declaration_required')
    if (listing.kind === 'meetup' && !listings.trust.verifiedAdult(db, session.publicId)) throw ctx.fail(403, 'verified_adult_required')
    const owner = ctx.core.sessionByPublicId?.(db, listing.owner)
    if (!owner) throw ctx.fail(404, 'listing_unavailable')
    listings.gate(db, owner, listing.kind)
  }
  function exchange(db: Db, session: SessionRecord, id: string): ContactExchange {
    const found = peekRealValue(db).contacts[id]
    if (!isExchange(found) || found.id !== id || (found.owner !== session.publicId && found.requester !== session.publicId)) throw ctx.fail(404, 'contact_unavailable')
    return found
  }
  function recheck(db: Db, session: SessionRecord, found: ContactExchange): void {
    const listing = listings.get(db, found.listingId, session.publicId)
    admit(db, session, listing)
    const requester = ctx.core.sessionByPublicId?.(db, found.requester)
    if (!requester || listings.blocked(db, found.owner, found.requester)) throw ctx.fail(404, 'contact_unavailable')
    admit(db, requester, listing)
  }
  function view(found: ContactExchange, now: number) {
    return { id: found.id, listingId: found.listingId, owner: found.owner, requester: found.requester, revision: found.revision, expiresAt: found.expiresAt, status: found.expiresAt <= now ? 'expired' : found.status }
  }
  return {
    read(db: Db, session: SessionRecord, id: string) {
      listings.claimed(db, session)
      const found = exchange(db, session, id)
      if (found.expiresAt <= ctx.now() || found.status !== 'mutual') return view(found, ctx.now())
      recheck(db, session, found)
      return { ...view(found, ctx.now()), contact: session.publicId === found.owner ? found.requesterContact : found.ownerContact }
    },
    mine(db: Db, session: SessionRecord) {
      listings.claimed(db, session)
      // Metadata only. Contacts are released by read() after current permission checks.
      return Object.values(peekRealValue(db).contacts).filter(isExchange).filter((found) => found.owner === session.publicId || found.requester === session.publicId).slice(-100).reverse().map((found) => view(found, ctx.now()))
    },
    request(db: Db, session: SessionRecord, listingId: string, body: Record<string, unknown>) {
      const listing = listings.get(db, listingId, session.publicId); admit(db, session, listing)
      listings.revision(body.expectedRevision, listing.revision)
      if (listing.owner === session.publicId) throw ctx.fail(400, 'self_contact')
      const contact = parseContact(body.contact)
      if (!contact) throw ctx.fail(400, 'invalid_contact')
      const collection = realValueOf(ctx, db); prune(collection, ctx.now())
      const existing = Object.values(collection.contacts).find((found) => found.listingId === listingId && found.requester === session.publicId && found.expiresAt > ctx.now() && (found.status === 'awaiting-owner' || found.status === 'mutual'))
      if (existing) return { ok: true, code: 'contact_exists', id: existing.id, revision: existing.revision }
      const contacts = Object.values(collection.contacts)
      if (contacts.length >= REAL_VALUE.contacts || contacts.filter((found) => found.listingId === listingId).length >= REAL_VALUE.contactsPerListing || contacts.filter((found) => found.requester === session.publicId && found.expiresAt > ctx.now()).length >= 20) throw ctx.fail(429, 'contact_capacity')
      const id = `RC-${++collection.seq}`, now = ctx.now()
      collection.contacts[id] = { v: 1, id, listingId, owner: listing.owner, requester: session.publicId, revision: 1, createdAt: now, expiresAt: Math.min(listing.expiresAt, now + 7 * REAL_VALUE.day), status: 'awaiting-owner', requesterContact: contact }
      return { ok: true, code: 'awaiting_owner', id, revision: 1 }
    },
    answer(db: Db, session: SessionRecord, id: string, body: Record<string, unknown>, revoke = false) {
      listings.claimed(db, session)
      const found = exchange(db, session, id); listings.revision(body.expectedRevision, found.revision)
      if (!revoke && found.owner !== session.publicId) throw ctx.fail(403, 'owner_required')
      if (!revoke && found.status !== 'awaiting-owner') throw ctx.fail(409, 'contact_state_conflict')
      const collection = realValueOf(ctx, db)
      const base = { v: 1 as const, id: found.id, listingId: found.listingId, owner: found.owner, requester: found.requester, revision: found.revision + 1, createdAt: found.createdAt, expiresAt: found.expiresAt }
      if (revoke || body.accept === false) collection.contacts[id] = { ...base, status: 'revoked' }
      else {
        if (body.accept !== true) throw ctx.fail(400, 'accept_required')
        if (found.status !== 'awaiting-owner' || found.expiresAt <= ctx.now()) throw ctx.fail(409, 'contact_expired')
        recheck(db, session, found)
        const contact = parseContact(body.contact)
        if (!contact) throw ctx.fail(400, 'invalid_contact')
        collection.contacts[id] = { ...base, status: 'mutual', requesterContact: found.requesterContact, ownerContact: contact }
      }
      return { ok: true, code: collection.contacts[id]?.status ?? 'revoked', id, revision: base.revision }
    },
  }
}
